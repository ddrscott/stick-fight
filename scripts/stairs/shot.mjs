// A screenshot of stairs hurt in the real page: P1 throws P2 over the left rail, P2 clatters down the flight, and the
// frame is taken while DOWN THE STAIRS is up. `node scripts/stairs/shot.mjs [out.png]`, headless Chromium, raw source.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = process.argv[2] || path.join(root, 'scripts/stairs/results/down-the-stairs.png');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glsl': 'text/plain' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
pg.on('pageerror', (e) => console.error(String(e)));
await pg.goto(`http://127.0.0.1:${server.address().port}/play/index.html?scene=dummy`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await pg.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 30000 });
await pg.evaluate(() => {
  const g = window.__game, sim = g.sim;
  g.setScene('dummy', {});
  sim.resetMatch({ seed: 7, skipIntro: true });
  let t = 0;
  sim.setController(0, 'script', () => (t++ === 30 ? { lp: true, lk: true } : {}));
  sim.setController(1, 'none');
  const st = sim.stairs[0], X = (al) => st.head + st.dir * al;
  const place = (i, x, f) => { const u = sim.units[i]; u.x = x; u.facing = f; u.rig.x = x; u.rig.facing = f; u.stair = -1; u.floor = 0; u.y = sim.floors[0].y; u.rig.y = u.y; u.rig.update(0); sim.rigUpd(u, 0); };
  place(0, X(-50), st.dir); place(1, X(20), -st.dir);
});
// the line goes up when the body is on its feet again; take it a beat in
await pg.waitForFunction(() => (window.__game.sim.callouts || []).some((c) => c.kind === 'stairs'), null, { timeout: 30000, polling: 16 });
await pg.waitForTimeout(250);
await pg.screenshot({ path: out });
const info = await pg.evaluate(() => { const s = window.__game.sim; return { line: s.callouts.filter((c) => c.kind === 'stairs').map((c) => c.text), hp: s.units.map((u) => u.health), hits: s.log.filter((r) => r.type === 'stairHit').length }; });
console.log(out, JSON.stringify(info));
await browser.close(); server.close();
