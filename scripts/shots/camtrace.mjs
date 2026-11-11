#!/usr/bin/env node
// Does the camera frame a fight the same in two builds? Steps seeded scenes frame by frame at the sizes that
// must not change (desktop, a phone held sideways) and compares every frame's camera x, y and zoom.
//   node scripts/shots/camtrace.mjs <other-dist> [this-dist]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
const here = path.dirname(new URL(import.meta.url).pathname);
const dists = [path.resolve(process.argv[2]), path.resolve(process.argv[3] || path.join(here, '../../dist'))];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const serve = (root) => new Promise((r) => { const s = http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}); s.listen(0, '127.0.0.1', () => r(s)); });
const SIZES = [{ name: '1280x720 desktop', w: 1280, h: 720, touch: false }, { name: '844x390 touch', w: 844, h: 390, touch: true }, { name: '1024x768 touch', w: 1024, h: 768, touch: true }];
const SCENES = ['ai-fight', 'ai-fight-2', 'horde-ai', 'floor-break-test', 'juggle-test', 'wall-test', 'stair-test', 'throw-test', 'perfect-test'];
const browser = await chromium.launch({ headless: true, executablePath, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const servers = [await serve(dists[0]), await serve(dists[1])];
let bad = 0;
for (const size of SIZES) for (const scene of SCENES) {
  const traces = [];
  for (const srv of servers) {
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.touch ? 2 : 1, hasTouch: size.touch, isMobile: size.touch });
    await ctx.addInitScript(() => { let a = 12345; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${srv.address().port}/stick-fight/play/?scene=${scene}&tier=3`);
    await page.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 60000 });
    await page.waitForTimeout(700);   // the touch layout is read twice a second: let it settle before the trace
    traces.push(await page.evaluate((s) => {
      const g = window.__game, G = window.__gauntlet, out = [];
      G.step(1000 / 60); G.setScene(s); g.fx.seed(1); g.fx.particles.clear(); g.arena.time = 0;
      for (let i = 0; i < 900; i++) { G.step(1000 / 60); out.push(`${g.camera.x.toFixed(4)},${g.camera.y.toFixed(4)},${g.camera.zoom.toFixed(5)}`); }
      return out;
    }, scene));
    await ctx.close();
  }
  const diff = traces[0].findIndex((v, i) => v !== traces[1][i]);
  if (diff >= 0) bad++;
  console.log(`${size.name.padEnd(18)} ${scene.padEnd(18)} ${diff < 0 ? '900 frames, camera identical' : `DIFFERS at frame ${diff}: ${traces[0][diff]} vs ${traces[1][diff]}`}`);
}
await browser.close(); for (const s of servers) s.close();
console.log(bad ? `${bad} differ` : 'the camera is the same in both builds at every size');
process.exit(bad ? 1 : 0);
