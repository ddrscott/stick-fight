#!/usr/bin/env node
// Trace a scene phase headless: node gauntlet/probe.mjs SCENE PHASE [steps] [every]
// prints P1/P2 state, root, hip, side (home), and the sim log (rolls, hits, grazes) as it goes
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require([(() => { try { return require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright'; } catch { return ''; } })(), '/Users/spierce/.nvm/versions/node/v22.23.2/lib/node_modules/playwright'].find((q) => q && require('node:fs').existsSync(q)));
const [,, scene = 'getup-test', only = '0', steps = '200', every = '6', chars = ''] = process.argv;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.glsl': 'text/plain' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const browser = await chromium.launch({ ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
const errors = [];
pg.on('pageerror', e => errors.push(String(e)));
pg.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await pg.goto(`http://127.0.0.1:${server.address().port}/play/index.html?scene=dummy`);
await pg.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 30000 });
const out = await pg.evaluate(({ scene, only, steps, every, chars }) => {
  const g = window.__game, sim = g.sim, lines = [], process_gap = true;
  g.setScene(scene, { only: +only, ...(chars ? { chars: chars.split(',') } : {}) });
  let seen = sim.log.length ? sim.log[sim.log.length - 1] : null;
  const r = (v) => Math.round(v);
  for (let i = 0; i < steps; i++) {
    g.advance(1000 / 60);
    const fresh = []; for (let k = sim.log.length - 1; k >= 0 && sim.log[k] !== seen; k--) fresh.unshift(sim.log[k]);
    if (sim.log.length) seen = sim.log[sim.log.length - 1];
    for (const e of fresh) if (/roll|hit|graze|wake|whiff|block|botch/.test(e.type)) lines.push(`  @${e.step} ${JSON.stringify(e)}`);
    if (sim.units[0].state === 'attack' && sim.units[1].state === 'down' && process_gap) lines.push(`   gap ${sim.units[0].move} ${sim.units[0].phase} ${r(sim.segGap(sim.units[0], sim.units[1]))} d${r(sim.units[1].rig.joints.hip.x - sim.units[0].x)}`);
    if (i % every === 0) {
      const s = sim.units.map(u => `${u.name} ${u.state}${u.move ? ':' + u.move : ''} x${r(u.x)} hip${r(u.rig.joints.hip.x)} f${u.facing} h${u.home} hp${r(u.health)}`).join(' | ');
      lines.push(`${i} ${s}`);
    }
  }
  return lines;
}, { scene, only, steps: +steps, every: +every, chars });
console.log(out.join('\n'));
if (errors.length) console.log('ERRORS', errors.slice(0, 5));
await browser.close(); server.close();
