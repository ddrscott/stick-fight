#!/usr/bin/env node
// The HUD at tiers 3, 2, 1 and 0 on the same seeded mid-fight frame, with P1's stamina low and the hurry timer
// pulsing (README, Performance, the HUD at low tiers). Drawn at DPR 2, so a 1x HUD shows as 1x.
//   node scripts/perf/hud-tiers.mjs <out-dir> [--dist dist] [--label after]
// Writes <out-dir>/<label>-t<tier>.png (the whole frame) and <label>-strip-t<tier>.png (the left bar and the timer,
// in device px).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(process.execPath, '../../lib/node_modules/playwright')); }
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const outDir = args[0], label = opt('--label', 'after');
const root = path.resolve(opt('--dist', path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../dist')));
fs.mkdirSync(outDir, { recursive: true });
const srv = http.createServer((q, r) => { let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p += '/index.html'; if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : p.endsWith('.css') ? 'text/css' : 'application/octet-stream' }); fs.createReadStream(p).pipe(r); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const b = await pw.chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
for (const tier of [3, 2, 1, 0]) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => { let a = 12345; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; });
  await page.goto(`http://127.0.0.1:${srv.address().port}/play/?scene=ai-fight&p1=manager&p2=wellness&tier=${tier}`);
  await page.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 60000 });
  await page.evaluate(() => {
    const g = window.__gauntlet, G = window.__game;
    g.setScene('ai-fight'); G.fx.seed(1); G.fx.particles.clear(); G.arena.time = 0;
    for (let t = 0; t < 2600; t += 1000 / 60) g.step(1000 / 60);
    // low stamina on P1, part of P1's health gone, and the clock just ticked over into the last ten seconds
    const s = G.sim, u = s.units[0];
    for (let k = 0; k < 9; k++) { u.stamina = (u.staminaMax || 100) * 0.2; u.health = (u.maxHealth || 100) * 0.55; s.timer = 7.97 - k / 60; g.step(1000 / 60); }
  });
  await page.screenshot({ path: path.join(outDir, `${label}-t${tier}.png`) });
  await page.screenshot({ path: path.join(outDir, `${label}-strip-t${tier}.png`), clip: { x: 0, y: 0, width: 700, height: 130 } });
  await ctx.close();
}
await b.close(); srv.close();
console.log(outDir);
