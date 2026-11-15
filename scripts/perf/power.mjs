#!/usr/bin/env node
// Power proxy (README, Performance, The draw cap): how many pictures a second the game draws, and how much main-thread
// and GL time a second that costs, in a fight, a paused fight and a menu over a held fight. Work times pictures is the
// stand-in for heat on a phone. Measured the same way on any build, so it compares before and after:
//   main ms/s  every requestAnimationFrame callback's time, summed (the game's frame and its input polls)
//   gl ms/s    window.__game.fx.render's time, summed (the compositor's WebGL calls, on the main thread)
//   drawn/s    fx.render calls a second; raf/s is the game's own frame rate (window.__perf)
// Headless Chromium runs rAF at 120 Hz, the way a 120 Hz phone screen does.
//
//   node scripts/perf/power.mjs [--dist dist] [--device pixel7|desktop] [--throttle 4] [--tier 2] [--secs 6]
//                               [--query fps=max] [--scenes fight,paused,menu,title] [--json out.json]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(process.execPath, '../../lib/node_modules/playwright')); }
const { chromium } = pw;

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const DEVICE = opt('--device', 'pixel7'), THROTTLE = +opt('--throttle', 4), TIER = opt('--tier', '2'), SECS = +opt('--secs', 6);
const QUERY = opt('--query', ''), PICK = opt('--scenes', 'fight,paused,menu,title').split(',');
const DEVICES = {
  pixel7: { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
};
const root = path.resolve(opt('--dist', path.join(path.dirname(new URL(import.meta.url).pathname), '../../dist')));
if (!fs.existsSync(path.join(root, 'play/index.html'))) { console.error('no build: run npm run build first'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/play/`;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-blink-features=AutomationControlled'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// every rAF callback timed, before the page's scripts run
const INIT = () => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__pw = { main: 0 };
  window.requestAnimationFrame = (cb) => raf((t) => { const a = performance.now(); try { cb(t); } finally { window.__pw.main += performance.now() - a; } });
};
const HOOK = () => {
  const fx = window.__game.fx, r = fx.render.bind(fx);
  Object.assign(window.__pw, { gl: 0, drawn: 0 });
  fx.render = (...a) => { const t = performance.now(); try { return r(...a); } finally { window.__pw.gl += performance.now() - t; window.__pw.drawn++; } };
};
async function measure(page) {
  await page.evaluate(() => { Object.assign(window.__pw, { main: 0, gl: 0, drawn: 0, t0: performance.now() }); window.__perf.reset(); });
  await sleep(SECS * 1000);
  return page.evaluate(() => {
    const w = window.__pw, s = (performance.now() - w.t0) / 1000, p = window.__perf.summary();
    const r = (v) => Math.round(v * 10) / 10;
    return { raf: r(p.fps), drawn: r(w.drawn / s), mainMsPerSec: r(w.main / s), glMsPerSec: r(w.gl / s), tier: p.info.tier };
  });
}
const SCENES = {
  // a CPU 1v1 on a test page (the flow off), as run.mjs's close
  fight: { url: 'scene=ai-fight&p1=manager&p2=wellness', warm: 3000 },
  // the same, paused with P (the sim held, nothing on screen moving)
  paused: { url: 'scene=ai-fight&p1=manager&p2=wellness', warm: 2000, after: async (p) => { await p.keyboard.press('KeyP'); await sleep(2500); } },
  // an arcade fight with the PAUSED menu up (the flow's DOM menu over a held fight)
  menu: { url: '', warm: 2500, after: async (p) => {
    await p.evaluate(() => window.__flow.debug.go('modeSelect')); await sleep(500);
    await p.locator('#flow .fl-btn', { hasText: 'ARCADE' }).first().click({ force: true }); await sleep(800);
    await p.evaluate(() => { const f = window.__flow.debug; f.pickChar(f.sel.player); }); await sleep(800);
    await p.evaluate(() => window.__flow.debug.go('fighting')); await sleep(2500);
    await p.keyboard.press('Escape'); await sleep(2500);
    const st = await p.evaluate(() => window.__flow.state);
    if (st !== 'paused') console.error('  menu: not paused, at', st);
  } },
  // the title with the demo fight behind it (the demo keeps drawing)
  title: { url: '', warm: 4000 },
};
const out = [];
for (const name of PICK) {
  const S = SCENES[name];
  const ctx = await browser.newContext(DEVICES[DEVICE]);
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const cdp = await ctx.newCDPSession(page);
  const q = [S.url, TIER !== 'auto' ? `tier=${TIER}` : '', QUERY].filter(Boolean).join('&');
  await page.goto(base + (q ? `?${q}` : ''));
  await page.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready && window.__game, null, { timeout: 30000 });
  await page.evaluate(HOOK);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await sleep(S.warm);
  if (S.after) await S.after(page);
  const r = { scene: name, device: DEVICE, throttle: THROTTLE, query: QUERY, ...(await measure(page)), errors: errors.length };
  out.push(r); console.log(JSON.stringify(r));
  await ctx.close();
}
if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(out, null, 1));
await browser.close(); server.close();
