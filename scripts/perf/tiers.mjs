#!/usr/bin/env node
// Tiers 3, 2, 1 and 0 side by side on the same seeded frame (README, Performance): node scripts/perf/tiers.mjs <out.png> [query] [ms]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(process.execPath, '../../lib/node_modules/playwright')); }
const [out, query = 'scene=ai-fight&p1=manager&p2=wellness', ms = '2600'] = process.argv.slice(2);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../dist');
const srv = http.createServer((q, r) => { let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p += '/index.html'; if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); fs.createReadStream(p).pipe(r); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const b = await pw.chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const files = [];
for (const tier of [3, 2, 1, 0]) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript(() => { let a = 12345; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; });
  await page.goto(`http://127.0.0.1:${srv.address().port}/play/?${query}&tier=${tier}`);
  await page.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 60000 });
  await page.evaluate((ms) => { const g = window.__gauntlet; g.setScene(new URLSearchParams(location.search).get('scene')); window.__game.fx.seed(1); window.__game.fx.particles.clear(); window.__game.arena.time = 0; for (let t = 0; t < ms; t += 1000 / 60) g.step(1000 / 60); }, +ms);
  const f = out.replace(/\.png$/, `-t${tier}.png`);
  await page.screenshot({ path: f }); files.push(f);
  await ctx.close();
}
await b.close(); srv.close();
const cell = (f, i) => ['(', f, '-resize', '853x480', '-gravity', 'north', '-background', '#07020f', '-splice', '0x34', '-fill', '#E85D00', '-font', 'Menlo', '-pointsize', '22', '-annotate', '+0+6', `// TIER_${3 - i}${['', '', '', ' (LOWEST)'][i]}`, ')'];
// two rows of two: 3 and 2 on top, 1 and 0 under them
execFileSync('magick', ['(', ...cell(files[0], 0), ...cell(files[1], 1), '+append', ')', '(', ...cell(files[2], 2), ...cell(files[3], 3), '+append', ')', '-append', out]);
console.log(out);
