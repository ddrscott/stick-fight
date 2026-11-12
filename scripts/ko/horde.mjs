#!/usr/bin/env node
// The horde scenes for a minute each, for a before/after (README, Fundamentals, How a KO resolves):
//   node scripts/ko/horde.mjs [--root DIR] [--secs 60]
// Prints, per scene: goons down (sim.horde.count, summed over every run the minute held), floors cleared, how many
// times the hero went down (a run ended), the hero's health at the end.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const root = path.resolve(opt('--root', path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')));
const secs = +opt('--secs', 60);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glsl': 'text/plain' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
const warns = [];
pg.on('pageerror', (e) => warns.push(String(e)));
pg.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warns.push(m.text()); });
await pg.goto(`http://127.0.0.1:${server.address().port}/play/index.html?scene=dummy`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await pg.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 60000 });
for (const scene of ['horde', 'horde-ai', 'horde-floors-ai']) {
  const r = await pg.evaluate(({ scene, secs }) => {
    const g = window.__game, sim = g.sim;
    g.setScene(scene, {});
    let goons = 0, floors = 0, downs = 0, last = sim.horde, runEnded = false;
    for (let f = 0; f < secs * 60; f++) {
      g.advance(1000 / 60);
      if (sim.phase === 'match' && !runEnded) { runEnded = true; downs++; }
      if (sim.phase !== 'match') runEnded = false;
      if (sim.horde !== last) { goons += last ? last.count : 0; floors += last ? last.floorsCleared : 0; last = sim.horde; }
    }
    goons += sim.horde ? sim.horde.count : 0; floors += sim.horde ? sim.horde.floorsCleared : 0;
    return { scene, goons, floors, heroDowns: downs, heroHp: Math.round(sim.units[0].health), phase: sim.phase, steps: sim.stepCount };
  }, { scene, secs });
  console.log(JSON.stringify(r));
}
if (warns.length) console.log('warnings:', [...new Set(warns)].slice(0, 8).join(' | '));
await browser.close(); server.close();
