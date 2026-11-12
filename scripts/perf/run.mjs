#!/usr/bin/env node
// Frame-time harness (README, Performance). Serves the production build (dist/, `npm run build` first)
// and plays each scenario in headless Chromium on this machine's real GPU (ANGLE Metal on a Mac), emulating
// a phone held sideways (Pixel 7: 915x412 CSS px at DPR 2.625, touch) with the CPU throttled through
// DevTools. It reads the game's own profiler (src/perf.js, window.__perf) after a warm-up.
//
//   node scripts/perf/run.mjs [--throttle 1,4,6] [--tier 3,2,1|auto] [--secs 8] [--scenes close,horde,...]
//                             [--device pixel7|pixel7up|desktop] [--gpu] [--rollback] [--load] [--json out.json]
//
//   --gpu       per-frame GPU time with no CPU throttle: each frame is followed by a 1-pixel readPixels,
//               which waits for the GPU to finish, so the step's time is CPU plus GPU (Apple M3 Pro here)
//   --rollback  the worst rollback burst: load a snapshot and re-run 12 steps (src/net/rollback.js's
//               MAX_ROLLBACK), saving a snapshot before each as the netcode does, timed in the page
//   --load      /play/ cold load: first frame drawn (__gauntlet.ready) and main-thread time, cache off
//
// The browser hides navigator.webdriver, so the game behaves as on a phone (its adaptive tier on unless
// ?tier= pins it, no preserveDrawingBuffer).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(process.execPath, '../../lib/node_modules/playwright')); }
const { chromium } = pw;

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes(k);
const THROTTLES = opt('--throttle', '1,4,6').split(',').map(Number);
const TIERS = opt('--tier', '2').split(',');
const SECS = +opt('--secs', 8), WARM = +opt('--warm', 3);
const DEVICE = opt('--device', 'pixel7');
const QUERY = opt('--query', '');

// The scenarios the task names. Each is a ?scene= test page (the flow is off there) plus a setup.
const SCENARIOS = {
  close: { scene: 'ai-fight', q: 'p1=manager&p2=wellness', note: '1v1 CPU fight, zoomed in close (cloth on both)' },
  horde: { scene: 'horde-ai', q: '', note: 'horde: 2 goons on screen and a growing body pile', warm: 12 },
  rain: { scene: 'ai-fight-2', q: 'p1=chef&p2=receptionist', note: 'night-rain, the default look (every stage rains through the pane)' },
  floor: { scene: 'floor-break-test', q: '', note: 'floor break: the fall, debris, both floors on screen' },
  attract: { scene: 'attract', q: '', note: 'the attract demo (two random fighters)' },
};
const PICK = (opt('--scenes', Object.keys(SCENARIOS).join(','))).split(',');

const CROS_UA = 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const DEVICES = {
  pixel7: { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
  pixel7up: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },   // held upright: the square (README, Controls)
  desktop: { viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  // a school Chromebook (README, Performance, Chromebooks): the common 1366x768 panel at DPR 1, and a 1080p one at 1.25; a
  // trackpad, so a fine pointer. The UA says CrOS so the capability check sees one (a real Celeron reports 2 or 4 cores).
  cros: { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, userAgent: CROS_UA },
  croshd: { viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1.25, isMobile: false, hasTouch: false, userAgent: CROS_UA },
};

const root = opt('--dist') ? path.resolve(opt('--dist')) : path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../dist');
if (!fs.existsSync(path.join(root, 'play/index.html'))) { console.error('no build: run npm run build first'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  const type = types[path.extname(p)] || 'application/octet-stream';
  // compressed like Cloudflare serves it (gzip here; it sends brotli, a little smaller still)
  if (/text|javascript|json|manifest/.test(type) && /gzip/.test(req.headers['accept-encoding'] || '')) {
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'content-encoding': 'gzip' });
    return res.end(zlib.gzipSync(fs.readFileSync(p)));
  }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/play/`;

// --angle swiftshader: software GL, whose time grows with the shader work per pixel (a stand-in for a phone GPU's
// fill cost, relative between builds and tiers; the M3's GPU is too fast for its own time to show it)
const ANGLE = opt('--angle', 'metal');
const browser = await chromium.launch({ headless: true, args: [ANGLE === 'swiftshader' ? '--use-angle=swiftshader' : '--use-angle=metal', ...(ANGLE === 'swiftshader' ? ['--enable-unsafe-swiftshader'] : ['--enable-gpu', '--ignore-gpu-blocklist']), '--disable-blink-features=AutomationControlled'] });
const results = [];

async function open(url, throttle, extra = {}) {
  const ctx = await browser.newContext({ ...DEVICES[DEVICE], ...extra });
  const page = await ctx.newPage();
  if (opt('--init')) await page.addInitScript(opt('--init'));   // --init "<js>": runs before the page's own scripts
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  return { ctx, page, cdp, errors };
}

const ms = (v) => +v.toFixed(2);
function row(s) {
  return { fps: ms(s.fps), p50: ms(s.iv.p50), p95: ms(s.iv.p95), p99: ms(s.iv.p99), longPerMin: Math.round(s.longPerMin), work50: ms(s.work.p50), work95: ms(s.work.p95),
    sim50: ms(s.sim.p50), sim95: ms(s.sim.p95), draw50: ms(s.draw.p50), draw95: ms(s.draw.p95), gl50: ms(s.gl.p50), gl95: ms(s.gl.p95), hud50: ms(s.hud.p50), tier: s.info.tier };
}

if (!flag('--gpu') && !flag('--rollback') && !flag('--load')) {
  for (const name of PICK) {
    const S = SCENARIOS[name];
    for (const throttle of THROTTLES) for (const tier of TIERS) {
      const q = [`scene=${S.scene}`, S.q, tier === 'auto' ? '' : `tier=${tier}`, QUERY].filter(Boolean).join('&');
      const { ctx, page, errors } = await open(base + '?' + q, throttle);
      await page.goto(base + '?' + q);
      await page.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 60000 });
      if (opt('--eval')) await page.evaluate(opt('--eval'));   // --eval "<js>": an experiment run once the game is up
      await page.waitForTimeout((S.warm || WARM) * 1000);
      await page.evaluate(() => window.__perf.reset());
      await page.waitForTimeout(SECS * 1000);
      const s = await page.evaluate(() => window.__perf.summary());
      const r = { scenario: name, throttle, tier, device: DEVICE, ...row(s), errors: errors.length };
      results.push(r);
      console.log(JSON.stringify(r));
      await ctx.close();
    }
  }
}

if (flag('--gpu')) {
  // CPU + GPU per drawn frame, synchronous: step the game 16.7 ms, draw, then wait for the GPU with a 1-pixel read
  for (const name of PICK) for (const tier of TIERS) {
    const S = SCENARIOS[name];
    const q = [`scene=${S.scene}`, S.q, `tier=${tier === 'auto' ? 3 : tier}`, QUERY].filter(Boolean).join('&');
    const { ctx, page } = await open(base + '?' + q, 1);
    await page.goto(base + '?' + q);
    await page.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 60000 });
    await page.waitForTimeout(WARM * 1000);
    const r = await page.evaluate((off) => {
      // --off lighting,bloom,up:figures,fn:arena.drawEmissive...: what a pass, an upload or a drawing function costs
      // (fn: makes window.__game.<path> a no-op)
      for (const k of off) {
        if (k.startsWith('up:')) window.__game.fx.skip[k.slice(3)] = true;
        else if (k.startsWith('fn:')) { const ks = k.slice(3).split('.'), last = ks.pop(); let o = window.__game; for (const x of ks) o = o[x]; o[last] = () => {}; }
        else if (k.startsWith('win:')) window[k.slice(4)] = true;
        else window.__game.fx.options[k] = false;
      }
      const g = window.__gauntlet, gl = window.__game.fx.gl, px = new Uint8Array(4);
      const t = [], a = [];
      for (let i = 0; i < 240; i++) {
        const t0 = performance.now();
        g.step(1000 / 60);
        const t1 = performance.now();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t2 = performance.now();
        a.push(t1 - t0); t.push(t2 - t0);
      }
      const p = (v, q) => v.slice().sort((x, y) => x - y)[Math.floor(q * v.length)];
      return { cpu50: p(a, 0.5), synced50: p(t, 0.5), synced95: p(t, 0.95), gpuWait50: p(t.map((v, i) => v - a[i]), 0.5) };
    }, opt('--off', '').split(',').filter(Boolean));
    const out = { scenario: name, mode: 'gpu', angle: ANGLE, tier, off: opt('--off', ''), ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, ms(v)])) };
    results.push(out); console.log(JSON.stringify(out));
    await ctx.close();
  }
}

if (flag('--rollback')) {
  // the worst correction: 12 re-run steps, each saving a snapshot first (they all ran on a guess), plus the hash
  // the netcode takes every 30th frame; on a fight in progress (two CPUs, cloth characters, a body pile in horde)
  for (const name of ['close', 'horde']) for (const throttle of THROTTLES) {
    const S = SCENARIOS[name];
    const q = [`scene=${S.scene}`, S.q, 'tier=2'].filter(Boolean).join('&');
    const { ctx, page } = await open(base + '?' + q, throttle);
    await page.goto(base + '?' + q);
    await page.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 60000 });
    await page.waitForTimeout((S.warm || WARM) * 1000);
    const r = await page.evaluate(async () => {
      const sim = window.__game.sim, burst = [], save = [], load = [], step = [];
      const snaps = Array.from({ length: 14 }, () => ({ state: null }));
      for (let k = 0; k < 40; k++) {
        await new Promise(r => requestAnimationFrame(r));   // the live game keeps moving between bursts
        const t0 = performance.now();
        const base = sim.saveState();
        const t1 = performance.now();
        sim.loadState(base);
        const t2 = performance.now();
        for (let i = 0; i < 12; i++) {
          const a = performance.now();
          snaps[i].state = sim.saveState(snaps[i].state);
          const b = performance.now();
          sim.tick();
          step.push(performance.now() - b); save.push(b - a);
        }
        burst.push(performance.now() - t2); load.push(t2 - t1);
        sim.loadState(base);   // put the live game back where it was
      }
      const p = (v, q) => v.slice().sort((x, y) => x - y)[Math.min(v.length - 1, Math.floor(q * v.length))];
      return { burst50: p(burst, 0.5), burstMax: Math.max(...burst), save50: p(save, 0.5), load50: p(load, 0.5), tick50: p(step, 0.5), tickMax: Math.max(...step) };
    });
    const out = { scenario: name, mode: 'rollback', throttle, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, ms(v)])) };
    results.push(out); console.log(JSON.stringify(out));
    await ctx.close();
  }
}

if (flag('--load')) {
  // cold load of /play/ with the attract flow (no ?scene=), cache off, the network as fast as localhost
  for (const throttle of THROTTLES) {
    const runs = [];
    for (let k = 0; k < 3; k++) {
      const { ctx, page, cdp } = await open(base, throttle);
      await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Performance.enable');
      // a phone's 4G: 150 ms round trip, 9 Mbps down
      if (flag('--net')) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 3e6 / 8 });
      const t0 = Date.now();
      await page.goto(base, { waitUntil: 'commit' });
      await page.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 120000, polling: 16 });
      const ready = Date.now() - t0;
      const m = await cdp.send('Performance.getMetrics');
      const task = m.metrics.find(x => x.name === 'TaskDuration').value;
      const bytes = await page.evaluate(() => performance.getEntriesByType('resource').reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0) + (performance.getEntriesByType('navigation')[0]?.transferSize || 0));
      const fcp = await page.evaluate(() => (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0);
      // the game's first drawn frame (main.js marks it; the build before this pass didn't, so fall back to ready)
      const first = await page.evaluate(() => (performance.getEntriesByName('sf:first-frame')[0] || {}).startTime || 0);
      runs.push({ ready, task: task * 1000, kb: bytes / 1024, fcp, first: first || ready });
      await ctx.close();
    }
    const avg = (k) => runs.reduce((a, r) => a + r[k], 0) / runs.length;
    const out = { mode: 'load', throttle, net: flag('--net') ? '4g' : 'local', firstFrameMs: Math.round(avg('first')), readyMs: Math.round(avg('ready')), fcpMs: Math.round(avg('fcp')), mainThreadMs: Math.round(avg('task')), kb: Math.round(avg('kb')) };
    results.push(out); console.log(JSON.stringify(out));
  }
}

await browser.close(); server.close();
if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(results, null, 2));
