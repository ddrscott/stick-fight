#!/usr/bin/env node
// Held upright, does the camera keep the fight inside the view? Steps seeded scenes at each upright size (touch)
// and checks every frame outside hitstop: each drawn joint of the hero and the one he's on is inside the middle
// of the frame the view shows (camera.safeW: 720 px when it's square, wider on a short screen, up to all 1280)
// and inside its height. 395x700 and 412x640 are a phone with its browser's bars showing. Needs `npm run build`.
//   node scripts/shots/square-fit.mjs [--frames 1500] [--sizes 390x844,412x640]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../dist');
const FRAMES = +opt('--frames', 1500);
const SIZES = opt('--sizes', '390x844,412x915,375x667,395x700,412x640').split(',').map((n) => { const [w, h] = n.split('x').map(Number); return { name: n, w, h }; });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
const SCENES = ['ai-fight', 'ai-fight-2', 'ai-fight-3', 'ko', 'juggle-test', 'wall-test', 'throw-test', 'jump-in-test', 'air-recovery-test', 'floor-break-test', 'stair-test', 'horde-ai', 'horde-floors-ai', 'windowwasher-test', 'getup-test', 'perfect-test'];
const browser = await chromium.launch({ headless: true, executablePath, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
let bad = 0;
for (const size of SIZES) for (const scene of SCENES) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${/** @type {any} */ (server.address()).port}/play/?scene=${scene}&tier=1`);
  await page.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready && document.documentElement.classList.contains('sq'), null, { timeout: 60000 });
  const r = await page.evaluate(([s, n]) => {
    const g = window.__game, G = window.__gauntlet, cam = g.camera;
    G.setScene(s);
    let out = 0, worst = 0, seen = 0, zMin = 9, zMax = 0, first = '';
    const crop = cam.safeW > 0 ? Math.min(1280, cam.safeW) : 1280, xl = (1280 - crop) / 2, xr = 1280 - xl;   // the frame's span the view shows
    for (let i = 0; i < n; i++) {
      g.stepQuiet(1000 / 60);
      if (g.sim.hitstopActive > 0) continue;
      zMin = Math.min(zMin, cam.zoom); zMax = Math.max(zMax, cam.zoom);
      for (const u of [g.sim.units[0], g.sim.focus || g.sim.units[1]]) {
        if (!u || u.hidden) continue;
        const d0 = g.drawn(u);
        for (const p of d0 ? Object.values(d0.all) : []) {
          const x = (p.x - cam.x) * cam.zoom + 640, y = (p.y - cam.y) * cam.zoom + 360;
          const d = Math.max(xl - x, x - xr, -y, y - 720);
          seen++;
          if (d > 0.5) { out++; if (d > worst) { worst = d; first = first || `frame ${i} ${u.state}`; } }
        }
      }
    }
    return { crop: Math.round(crop), out, seen, worst: Math.round(worst), zMin: zMin.toFixed(2), zMax: zMax.toFixed(2), first };
  }, [scene, FRAMES]);
  if (r.out) bad++;
  console.log(`${size.name.padEnd(8)} crop ${String(r.crop).padEnd(5)} ${scene.padEnd(20)} zoom ${r.zMin}..${r.zMax}  ${r.out ? `${r.out} of ${r.seen} joints outside the view, worst ${r.worst} px (${r.first})` : `${r.seen} joints, all inside the view`}`);
  await ctx.close();
}
await browser.close(); server.close();
console.log(bad ? `${bad} scenes left the view` : 'every scene stayed inside the view at every size');
process.exit(bad ? 1 : 0);
