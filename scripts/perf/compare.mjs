#!/usr/bin/env node
// Before/after look check (README, Performance): the same seeded scenes stepped frame by frame in two builds
// (this one's dist/ and another checkout's, e.g. main), screenshots side by side, and how far apart they are
// (ImageMagick PSNR; identical is inf, above ~35 dB is hard to see).
//   node scripts/perf/compare.mjs <other-dist-dir> <outdir> [--tier 3] [--query ...]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(process.execPath, '../../lib/node_modules/playwright')); }
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const [other, out] = argv;
fs.mkdirSync(out, { recursive: true });
const mine = opt('--mine') ? path.resolve(opt('--mine')) : path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../dist');
function serve(root) {
  if (fs.existsSync(path.join(root, 'stick-fight', 'play'))) root = path.join(root, 'stick-fight');   // a build from before the move to neonstickfight.com
  const s = http.createServer((req, res) => {
    let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r(s)));
}
// [name, query, ms stepped before the shot]
const SHOTS = [
  ['close', 'scene=ai-fight&p1=manager&p2=wellness', 2600],
  ['close2', 'scene=ai-fight&p1=manager&p2=wellness', 5200],
  ['horde', 'scene=horde-ai', 14000],
  ['floor', 'scene=floor-break-test', 3000],
  ['rain', 'scene=ai-fight-2&p1=chef&p2=receptionist', 4000],
  ['idle', 'scene=idle', 500],
];
const tier = opt('--tier', '3');
const browser = await pw.chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const servers = [await serve(path.resolve(other)), await serve(mine)];
const rows = [];
for (const [name, q, ms] of SHOTS) {
  const files = [];
  for (const [i, srv] of servers.entries()) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    // every random draw seeded the same in both builds (particles, rain, the attract pick), so only the drawing differs
    await page.addInitScript(() => { let a = 12345; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; });
    await page.goto(`http://127.0.0.1:${srv.address().port}/play/?${q}&tier=${tier}${opt('--query', '')}`);
    await page.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 60000 });
    await page.evaluate(([q, ms]) => { const s = new URLSearchParams(q).get('scene'); window.__gauntlet.setScene(s); window.__game.fx.seed(1); window.__game.fx.particles.clear(); window.__game.arena.time = 0; for (let t = 0; t < ms; t += 1000 / 60) window.__gauntlet.step(1000 / 60); }, [q, ms]);
    const f = path.join(out, `${name}-${i ? 'after' : 'before'}.png`);
    await page.screenshot({ path: f });
    files.push(f);
    await ctx.close();
  }
  let psnr = '?', rmse = '?';
  try { execFileSync('magick', ['compare', '-metric', 'RMSE', ...files, 'null:'], { stdio: 'pipe' }); rmse = '0'; } catch (e) { rmse = (String(e.stderr || '').match(/\(([0-9.e-]+)\)/) || [])[1]; }
  try { execFileSync('magick', ['compare', '-metric', 'PSNR', ...files, path.join(out, `${name}-diff.png`)], { stdio: 'pipe' }); psnr = 'inf'; }
  catch (e) { psnr = String(e.stderr || '').trim().split(' ')[0]; }
  rows.push({ name, psnr, rmse });
  console.log(`${name.padEnd(8)} RMSE ${rmse}`);
}
await browser.close(); for (const s of servers) s.close();
fs.writeFileSync(path.join(out, 'psnr.json'), JSON.stringify(rows, null, 2));
