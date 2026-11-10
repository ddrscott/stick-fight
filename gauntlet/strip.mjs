#!/usr/bin/env node
// Frame strips of scene phases, for review: node gauntlet/strip.mjs OUT.png SPEC [SPEC...]
//   SPEC: scene:phase:from:count:every[:label]   frames are 60fps; from/every in frames; label is the row's title
// Each row is one phase: `count` frames from frame `from`, `every` frames apart, cropped around the two fighters
// (their drawn joints, through the camera), each tile stamped with its frame and both fighters' states.
// --size WxH  tile size (default 300x190)   PW_CHROME=path picks a chromium binary
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { chromium, executablePath } from './browser.mjs';
const { createCanvas, loadImage } = await import('@napi-rs/canvas');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const [TW, TH] = opt('--size', '300x190').split('x').map(Number), WRAP = +opt('--cols', '6');
const [outFile, ...specs] = args;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.glsl': 'text/plain', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
pg.on('pageerror', e => errors.push(String(e)));
await pg.goto(`http://127.0.0.1:${server.address().port}/play/index.html?scene=dummy`);
await pg.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 30000 });
const rows = [];
for (const spec of specs) {
  const [scene, phase, from, count, every, label] = spec.split(':');
  await pg.evaluate(({ scene, phase }) => window.__gauntlet.setScene(scene, { only: +phase }), { scene, phase });
  const name = await pg.evaluate(() => window.__game.sim.phaseName || '');
  for (let i = 0; i < +from; i++) await pg.evaluate(() => window.__gauntlet.step(1000 / 60));
  const tiles = [];
  for (let n = 0; n < +count; n++) {
    if (n) for (let i = 0; i < +every; i++) await pg.evaluate(() => window.__gauntlet.step(1000 / 60));
    // the box around both fighters' drawn joints, on screen (canvas px = css px here)
    const info = await pg.evaluate(() => {
      const g = window.__game, sim = g.sim, cv = document.querySelector('canvas'), r = cv.getBoundingClientRect();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const u of sim.units) { if (u.hidden) continue; const d = g.drawn(u); if (!d) continue; for (const k in d.all) { const z = g.camera.zoom, q = d.all[k], p = { x: r.left + (640 + (q.x - g.camera.x - g.camera.shakeX) * z) * r.width / 1280, y: r.top + (360 + (q.y - g.camera.y - g.camera.shakeY) * z) * r.height / 720 }; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); } }
      const st = sim.units.map(u => u.state + (u.move ? ':' + u.move : '')).join(' / ');
      return { x0, x1, y0, y1, w: r.width, h: r.height, cw: cv.width, ch: cv.height, st, f: sim.stepCount };
    });
    tiles.push({ buf: await pg.screenshot(), info });
  }
  rows.push({ label: label ? label.replace(/_/g, ' ') : `${scene} ${phase}: ${name}`, tiles });
}
await browser.close(); server.close();
// fixed crop per row: the union of the fighters' boxes over the row, padded, at the tile's aspect
const cols = Math.min(WRAP, Math.max(...rows.map(r => r.tiles.length))), LH = 22;
const lines = rows.reduce((s2, r) => s2 + Math.ceil(r.tiles.length / cols), 0);
const canvas = createCanvas(cols * (TW + 4) + 4, rows.length * LH + lines * (TH + 4) + 4);
const c = canvas.getContext('2d');
c.fillStyle = '#16161a'; c.fillRect(0, 0, canvas.width, canvas.height);
let y = 4;
for (const row of rows) {
  c.fillStyle = '#E85D00'; c.font = 'bold 14px monospace'; c.fillText('// ' + row.label.toUpperCase(), 6, y + 15);
  y += LH;
  const I = row.tiles.map(t => t.info), sx = I[0].cw / I[0].w;
  let x0 = Math.min(...I.map(i => i.x0)), x1 = Math.max(...I.map(i => i.x1)), y0 = Math.min(...I.map(i => i.y0)), y1 = Math.max(...I.map(i => i.y1));
  if (!isFinite(x0)) { x0 = 0; x1 = I[0].w; y0 = 0; y1 = I[0].h; }
  let w = (x1 - x0) + 120, h = (y1 - y0) + 80; if (w / h < TW / TH) w = h * TW / TH; else h = w * TH / TW;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  for (let n = 0; n < row.tiles.length; n++) {
    if (n && n % cols === 0) y += TH + 4;
    const img = await loadImage(row.tiles[n].buf), X = 4 + (n % cols) * (TW + 4);
    c.drawImage(img, (cx - w / 2), (cy - h / 2), w, h, X, y, TW, TH);
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(X, y + TH - 16, TW, 16);
    c.fillStyle = '#ddd'; c.font = '11px monospace'; c.fillText(`${row.tiles[n].info.f} ${row.tiles[n].info.st}`, X + 4, y + TH - 4);
  }
  y += TH + 4;
}
fs.writeFileSync(outFile, canvas.toBuffer('image/png'));
console.log(JSON.stringify({ out: outFile, rows: rows.length, cols, errors }));
