#!/usr/bin/env node
// Frame strips for the floor work: a scene run through the real render path (window.__gauntlet.step, painted),
// cropped around one body each frame, with the surface under it drawn as a thin cyan line, side by side.
//   node scripts/floorlog/strip.mjs <out.png> <scene> '<opts json>' <unit> '<trigger js>' [--frames 12] [--every 3] [--after 0] [--w 340] [--h 190]
// trigger: a JS expression over (G, sim, u) that starts the strip, e.g. "u.rag" or "sim.ragdolls.length > 0";
// --after skips that many frames past the trigger. unit 'ragdoll' follows the first horde ragdoll, then its body.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const { createCanvas, loadImage } = await import(path.join(root, 'node_modules/@napi-rs/canvas/index.js'));

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const [out, scene, optsJson, unitArg, trigger] = argv;
const FRAMES = +opt('--frames', 12), EVERY = +opt('--every', 3), AFTER = +opt('--after', 0), CW = +opt('--w', 340), CH = +opt('--h', 190), LABEL = opt('--label', '');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
let executablePath;
try { if (!fs.existsSync(chromium.executablePath())) throw 0; } catch {
  const dir = path.join(process.env.HOME || '', '.cache/ms-playwright');
  executablePath = fs.readdirSync(dir).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse()
    .map(d => path.join(dir, d, 'chrome-headless-shell-linux64/chrome-headless-shell')).find(f => fs.existsSync(f));
}
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = []; pg.on('pageerror', e => errors.push(String(e)));
await pg.goto(`http://127.0.0.1:${server.address().port}/play/index.html?scene=idle`);
await pg.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 30000 });
await pg.evaluate(fs.readFileSync(path.join(root, 'scripts/floorlog/probe.js'), 'utf8'));
await pg.evaluate(({ scene, opts }) => { window.__gauntlet.setScene(scene, opts); }, { scene, opts: JSON.parse(optsJson || '{}') });
// run to the trigger without painting, then paint each strip frame
const started = await pg.evaluate(({ trigger, unitArg }) => {
  const G = window.__game, sim = G.sim, test = new Function('G', 'sim', 'u', 'return (' + trigger + ');');
  for (let n = 0; n < 20000; n++) {
    const u = unitArg === 'ragdoll' ? null : sim.units[+unitArg];
    if (test(G, sim, u)) return n;
    G.stepQuiet(1000 / 60);
  }
  return -1;
}, { trigger, unitArg });
if (started < 0) { console.error('trigger never fired'); process.exit(1); }
const shots = [];
for (let i = 0; i < FRAMES; i++) {
  const steps = i === 0 ? AFTER + 1 : EVERY;
  const info = await pg.evaluate(({ steps, unitArg, CW, CH }) => {
    const G = window.__game, sim = G.sim, cam = G.camera;
    for (let k = 0; k < steps; k++) window.__gauntlet.step(1000 / 60);
    const S = (x, y) => ({ x: (x - (cam.x + cam.shakeX)) * cam.zoom + 640, y: (y - (cam.y + cam.shakeY)) * cam.zoom + 360 });
    let cx, cy, line = [];
    if (unitArg === 'ragdoll') {
      const r = sim.ragdolls[0], b = G.arena.bodies[G.arena.bodies.length - 1];
      const at = r ? { x: r.x, y: r.floorY } : b ? { x: b.x, y: b.y } : { x: cam.x, y: sim.floors[0].y };
      const p = S(at.x, at.y); cx = p.x; cy = p.y - CH * 0.3;
      for (let sx = cx - CW / 2; sx <= cx + CW / 2; sx += 2) line.push({ x: sx, y: S(0, at.y).y });
    } else {
      const u = sim.units[+unitArg], h = u.rig.joints.hip, p = S(h.x, h.y);
      cx = p.x; cy = p.y;
      for (let sx = cx - CW / 2; sx <= cx + CW / 2; sx += 2) {
        const wx = (sx - 640) / cam.zoom + cam.x + cam.shakeX, s = window.__floorlog.surfaceAt(u, wx);
        line.push(s == null ? null : { x: sx, y: S(wx, s).y });
      }
      const fy = line.filter(Boolean).reduce((m, q) => Math.max(m, q.y), -1e9);
      if (fy > -1e9) cy = Math.min(cy, fy - CH * 0.3);   // keep the floor in the lower part of the crop
    }
    const u0 = unitArg === 'ragdoll' ? null : sim.units[+unitArg];
    return { cx, cy, line, zoom: cam.zoom, state: u0 ? u0.state + '/' + u0.rig.current.move : 'ragdoll', step: sim.stepCount };
  }, { steps, unitArg, CW, CH });
  const x = Math.round(Math.max(0, Math.min(1280 - CW, info.cx - CW / 2))), y = Math.round(Math.max(0, Math.min(720 - CH, info.cy - CH * 0.55)));
  const buf = await pg.screenshot({ clip: { x, y, width: CW, height: CH } });
  shots.push({ buf, x, y, ...info });
}
await browser.close(); server.close();
// compose: frames left to right in rows of 6, each with its state and the surface line
const cols = Math.min(6, shots.length), rows = Math.ceil(shots.length / cols), pad = 4, top = LABEL ? 26 : 0;
const cv = createCanvas(cols * (CW + pad) + pad, rows * (CH + pad + 14) + pad + top), c = cv.getContext('2d');
c.fillStyle = '#111'; c.fillRect(0, 0, cv.width, cv.height);
if (LABEL) { c.fillStyle = '#E85D00'; c.font = 'bold 16px monospace'; c.fillText(LABEL, pad + 2, 18); }
for (let i = 0; i < shots.length; i++) {
  const s = shots[i], ox = pad + (i % cols) * (CW + pad), oy = top + pad + Math.floor(i / cols) * (CH + pad + 14);
  c.drawImage(await loadImage(s.buf), ox, oy);
  c.strokeStyle = 'rgba(0,255,255,0.75)'; c.lineWidth = 1; c.beginPath();
  let pen = false;
  for (const q of s.line) { if (!q) { pen = false; continue; } const px = ox + q.x - s.x, py = oy + q.y - s.y + 0.5; if (pen) c.lineTo(px, py); else c.moveTo(px, py); pen = true; }
  c.stroke();
  c.fillStyle = '#ccc'; c.font = '11px monospace'; c.fillText(`${s.step} ${s.state}`, ox + 2, oy + CH + 11);
}
fs.writeFileSync(out, cv.toBuffer('image/png'));
console.log(JSON.stringify({ out, started, frames: shots.length, errors }));
