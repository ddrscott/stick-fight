#!/usr/bin/env node
// Capture frames of a demo page for the critic.
// Usage: node gauntlet/capture.mjs <page> <scene> <outdir> [--frames 24] [--interval 40] [--keys "ArrowRight,KeyJ"]
//   <page>  path relative to repo root, e.g. demo/fighter.html
//   <scene> name from window.__gauntlet.scenes
// Writes <outdir>/<scene>_000.png ... and <outdir>/<scene>_sheet.png (contact sheet).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/spierce/.nvm/versions/node/v22.23.2/lib/node_modules/playwright');

const [,, page, scene, outdir, ...rest] = process.argv;
if (!page || !scene || !outdir) { console.error('usage: capture.mjs <page> <scene> <outdir> [--frames N] [--interval ms] [--keys a,b]'); process.exit(2); }
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
const FRAMES = +opt('--frames', 24), INTERVAL = +opt('--interval', 40), KEYS = (opt('--keys', '') || '').split(',').filter(Boolean);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.glsl': 'text/plain' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/${page}`;
fs.mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', e => errors.push(String(e)));
pg.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await pg.goto(url);
await pg.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 15000 }).catch(() => errors.push('__gauntlet.ready never became true'));
const hasStep = await pg.evaluate(() => !!(window.__gauntlet && typeof window.__gauntlet.step === 'function'));
await pg.evaluate(s => window.__gauntlet && window.__gauntlet.setScene && window.__gauntlet.setScene(s), scene);
for (const k of KEYS) await pg.keyboard.down(k);
const files = [];
for (let i = 0; i < FRAMES; i++) {
  if (hasStep) await pg.evaluate(ms => window.__gauntlet.step(ms), INTERVAL); else await pg.waitForTimeout(INTERVAL);
  const f = path.join(outdir, `${scene}_${String(i).padStart(3, '0')}.png`);
  await pg.screenshot({ path: f });
  files.push(f);
}
for (const k of KEYS) await pg.keyboard.up(k);
await browser.close(); server.close();
const cols = Math.min(6, files.length);
try { execFileSync('magick', ['montage', ...files, '-tile', `${cols}x`, '-geometry', '426x240+2+2', '-background', '#222', path.join(outdir, `${scene}_sheet.png`)]); } catch (e) { errors.push('montage failed: ' + e.message); }
console.log(JSON.stringify({ url: page, scene, frames: files.length, stepped: hasStep, sheet: path.join(outdir, `${scene}_sheet.png`), errors }, null, 2));
