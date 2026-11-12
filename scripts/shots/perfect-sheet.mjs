#!/usr/bin/env node
// A contact sheet of the perfect round finishers (README, Perfect rounds): for each fighter, ?scene=perfect-test&p1=<id>
// stepped to six moments (three through the windup from the grab, the release, and two early in the flight), each
// frame cropped around the thrower, one row per fighter. Needs `npm run build` (it serves dist/).
//   node scripts/shots/perfect-sheet.mjs [--out gauntlet/tmp/perfect] [--size 1280x720] [--only chef,janitor]
//                                        [--frames 6] [--video chef,janitor,receptionist] [--keep]
// Writes <out>/sheet-<size>.png, and with --video one PNG per frame per fighter in <out>/video-<id>/ (every 1/30 s
// from the grab to 0.45 s after the release) for ffmpeg to join; --keep also writes each crop as <id>-<n>.png.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../dist');
const OUT = path.resolve(opt('--out', 'gauntlet/tmp/perfect'));
const [VW, VH] = opt('--size', '1280x720').split('x').map(Number);
const VIDEO = (opt('--video', '') || '').split(',').filter(Boolean);
const IDS = ['temp', 'intern', 'accountant', 'barista', 'ceo', 'chef', 'courier', 'electrician', 'helpdesk', 'hrRep', 'janitor', 'lawyer', 'manager', 'receptionist', 'salesRep', 'security', 'wellness', 'windowWasher'];
const only = (opt('--only', '') || '').split(',').filter(Boolean);
const ids = only.length ? IDS.filter((i) => only.includes(i)) : IDS;
fs.mkdirSync(OUT, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
const port = /** @type {any} */ (server.address()).port;
const browser = await chromium.launch({ headless: true, executablePath, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const portrait = VH > VW;
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1, hasTouch: portrait, isMobile: portrait });
const rows = [];
const STEP = 1000 / 120;
for (const id of ids) {
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/play/?scene=perfect-test&p1=${id}&tier=3`);
  await page.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 60000 });
  // a dry run for the marks: when the body leaves the floor (grab) and the hand (release), in perfectT
  const marks = await page.evaluate((ms) => {
    const g = window.__game, G = window.__gauntlet; G.setScene('perfect-test');
    let grab = -1, rel = -1;
    for (let i = 0; i < 120 * 40 && rel < 0; i++) {
      g.stepQuiet(ms);
      const s = g.sim, l = s.units[1];
      if (s.perfectT >= 0 && grab < 0 && l.pfGrabT >= 0) grab = l.pfGrabT;
      if (s.perfectRel >= 0) rel = s.perfectRel;
    }
    return { grab, rel };
  }, STEP);
  if (marks.rel < 0) { console.log(`${id}: no finisher seen`); await page.close(); continue; }
  const span = marks.rel - marks.grab;
  const N = +opt('--frames', 6);
  const at = N === 6 ? [marks.grab + span * 0.35, marks.grab + span * 0.65, marks.grab + span * 0.88, marks.rel + 0.004, marks.rel + 0.09, marks.rel + 0.2]
    : Array.from({ length: N }, (_, i) => marks.grab + span * 0.3 + (span * 0.7 + 0.22) * i / (N - 1));
  const vid = VIDEO.includes(id) ? Array.from({ length: Math.ceil((marks.rel + 0.45 - marks.grab) * 30) }, (_, i) => marks.grab + i / 30) : [];
  const shots = [];
  // the real run: stepped and drawn (the life layer, the hand's swing), stopping on each moment for a picture
  await page.evaluate(() => { window.__gauntlet.setScene('perfect-test'); });
  const want = [...at.map((t) => ({ t, kind: 'sheet' })), ...vid.map((t, i) => ({ t, kind: 'vid', i }))].sort((a, b) => a.t - b.t);
  let box = null;
  for (const w of want) {
    const r = await page.evaluate(([t, ms]) => {
      const g = window.__game, G = window.__gauntlet;
      for (let i = 0; i < 120 * 40 && !(g.sim.perfectT >= t); i++) G.step(ms);
      const u = g.sim.units[0], cam = g.camera, h = u.rig.joints.hip;
      const sc = (p) => ({ x: (p.x - cam.x) * cam.zoom + 640, y: (p.y - cam.y) * cam.zoom + 360 });
      const cv = document.querySelector('canvas'), rc = cv.getBoundingClientRect();
      return { hip: sc(h), zoom: cam.zoom, rect: { x: rc.x, y: rc.y, w: rc.width, h: rc.height }, t: g.sim.perfectT };
    }, [w.t, STEP]);
    // the crop: around the thrower at the first moment, kept for the row (in stage px, mapped to the page)
    if (!box) box = { cx: Math.max(330, Math.min(1280 - 330, r.hip.x + 60 * (r.hip.x < 640 ? 1 : -1))), y0: 60, w: 660, h: 600 };
    const k = r.rect.w / 1280, oy = r.rect.y + (r.rect.h - 720 * k) / 2;
    const clip = { x: r.rect.x + (box.cx - box.w / 2) * k, y: oy + box.y0 * k, width: box.w * k, height: box.h * k };
    const buf = await page.screenshot({ clip: w.kind === 'vid' ? { x: r.rect.x, y: oy, width: 1280 * k, height: 720 * k } : clip });
    if (w.kind === 'sheet') { shots.push({ t: r.t - marks.rel, png: buf.toString('base64') }); if (argv.includes('--keep')) fs.writeFileSync(path.join(OUT, `${id}-${shots.length}.png`), buf); }
    else { const d = path.join(OUT, `video-${id}`); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, `f${String(w.i).padStart(3, '0')}.png`), buf); }
  }
  rows.push({ id, shots });
  console.log(`${id.padEnd(13)} grab ${marks.grab.toFixed(2)}s release ${marks.rel.toFixed(2)}s`);
  await page.close();
}
// the sheet: one row per fighter, the six crops left to right, times relative to the release
const sheet = await ctx.newPage();
await sheet.setViewportSize({ width: 800, height: 600 });
const png = await sheet.evaluate(async (rows) => {
  const CW = 264, CH = 240, L = 120, pad = 6, n = Math.max(...rows.map((r) => r.shots.length));
  const cv = document.createElement('canvas'); cv.width = L + n * (CW + pad); cv.height = rows.length * (CH + pad) + 30;
  const c = cv.getContext('2d'); c.fillStyle = '#0b0b10'; c.fillRect(0, 0, cv.width, cv.height);
  c.font = '14px monospace'; c.fillStyle = '#E85D00'; c.fillText('// PERFECT_FINISHERS  (t from release)', 8, 20);
  for (let r = 0; r < rows.length; r++) {
    const y = 30 + r * (CH + pad);
    c.fillStyle = '#ddd'; c.font = 'bold 15px monospace'; c.fillText(rows[r].id.toUpperCase(), 8, y + CH / 2);
    for (let i = 0; i < rows[r].shots.length; i++) {
      const s = rows[r].shots[i], im = new Image(); im.src = 'data:image/png;base64,' + s.png; await im.decode();
      const x = L + i * (CW + pad); c.drawImage(im, x, y, CW, CH);
      c.fillStyle = '#E85D00'; c.font = '12px monospace'; c.fillText(`${s.t >= 0 ? '+' : ''}${s.t.toFixed(2)}s`, x + 4, y + 14);
    }
  }
  return cv.toDataURL('image/png').split(',')[1];
}, rows);
const file = path.join(OUT, `sheet-${VW}x${VH}.png`);
fs.writeFileSync(file, Buffer.from(png, 'base64'));
console.log(`wrote ${file}`);
await browser.close(); server.close();
