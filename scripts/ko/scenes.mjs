#!/usr/bin/env node
// Every ?scene= test timeline, phase by phase, recorded so two checkouts can be diffed (README, Fundamentals, How a KO resolves).
//
//   node scripts/ko/scenes.mjs record OUT.json [--root DIR] [--scenes a,b]   run each phase ({ only: k }) for 9 s at 60 fps
//   node scripts/ko/scenes.mjs diff A.json B.json                             what differs, phase by phase; exit 1 if anything
//
// Each phase keeps: the whole sim log it wrote (every entry, step included, in order), every unit's health at the end,
// and a digest of every frame: both bodies (position, state, move, health, stamina, hitstop, stun, every joint) plus
// the round's state (phase, timer, winner, banner, KO slow-mo, finisher, wins, the callouts in order). A change of
// order inside one step shows up, so a KO resolved on a different step, or a callout moved, is a difference.
// --root serves another checkout (say main, `git worktree add /tmp/main main`) with this same script.
// --omit stun leaves a body field out of the frame digest (README, Fundamentals, States and the flags they own: the
// state table puts `stun` back to 0 when a unit leaves hitstun, which changes the digest without changing the fight).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, executablePath } from '../../gauntlet/browser.mjs';

const [, , cmd, ...rest] = process.argv;
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };

if (cmd === 'diff') {
  const [a, b] = rest.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  let same = 0, diff = 0;
  const keys = [...new Set([...Object.keys(a.phases), ...Object.keys(b.phases)])];
  for (const k of keys) {
    const x = a.phases[k], y = b.phases[k];
    if (!x || !y) { diff++; console.log(`${k}: only in ${x ? 'A' : 'B'}`); continue; }
    const what = [];
    if (x.phase !== y.phase) what.push(`name ${x.phase} | ${y.phase}`);
    if (x.health !== y.health) what.push(`health ${x.health} | ${y.health}`);
    if (String(x.kos) !== String(y.kos)) what.push(`KOs ${x.kos} | ${y.kos}`);
    if (x.digest !== y.digest) what.push(`frames (first differs at frame ${x.frames.findIndex((h, i) => h !== y.frames[i])})`);
    if (JSON.stringify(x.log) !== JSON.stringify(y.log)) {
      const i = x.log.findIndex((e, j) => JSON.stringify(e) !== JSON.stringify(y.log[j]));
      what.push(`log (${x.log.length} | ${y.log.length} entries, first differs at ${i}: ${JSON.stringify(x.log[i])} | ${JSON.stringify(y.log[i])})`);
    }
    if (what.length) { diff++; console.log(`${k} ${x.phase}\n  ${what.join('\n  ')}`); } else same++;
  }
  const kos = Object.values(a.phases).reduce((n, x) => n + (x.kos || []).length, 0), withKO = Object.values(a.phases).filter((x) => (x.kos || []).length).length;
  console.log(`${keys.length} phases compared (${withKO} of them with a round end, ${kos} round ends in all): ${same} identical, ${diff} differ`);
  process.exit(diff ? 1 : 0);
}
if (cmd !== 'record') { console.error('usage: scenes.mjs record OUT.json [--root DIR] [--scenes a,b] | diff A.json B.json'); process.exit(2); }

const outFile = rest[0];
const root = path.resolve(opt('--root', path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.glsl': 'text/plain', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(String(e)));
const fresh = async () => {
  await pg.goto(`http://127.0.0.1:${server.address().port}/play/index.html?scene=dummy`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 60000 });
};
await fresh();
const all = await pg.evaluate(() => window.__gauntlet.scenes);
// the 1v1 timelines and fights; horde scenes are checked by scripts/horde/check.mjs and scripts/ko/horde.mjs
const names = opt('--scenes', '') ? opt('--scenes').split(',') : all.filter((n) => (/-test$|^(scripted-combo|combo-test|string-test|ko|ai-fight|ai-fight-2|ai-fight-3)$/.test(n)) && !/^horde/.test(n));
const out = { root, scenes: names, phases: {} };
for (const name of names) for (let k = 0; k < 80; k++) {
  if (k === 0) await fresh();   // a page of its own per scene: the reach table the sim learns from hits carries from one scene to the next
  const r = await pg.evaluate(({ name, k, omit }) => {
    const g = window.__game, sim = g.sim;
    try { window.__gauntlet.setScene(name, { only: k }); } catch (e) { return null; }
    const ph = sim.phaseName; if (!ph && k > 0) return null;
    const seen = new WeakSet(sim.log), log = [], frames = [], kos = [];
    let was = sim.phase;
    const clean = (e) => JSON.parse(JSON.stringify(e, (_k, v) => (v && typeof v === 'object' && v.rig ? `#unit${v.id}` : v)));
    for (let f = 0; f < 60 * 9; f++) {
      g.advance(1000 / 60);
      for (const e of sim.log) { if (seen.has(e)) continue; seen.add(e); log.push(clean(e)); }
      if (sim.phase === 'ko' && was !== 'ko') kos.push(`${sim.banner}>${sim.winner}@${sim.stepCount}`);
      was = sim.phase;
      let h = 0x811c9dc5;
      const mix = (s) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } };
      for (const u of sim.units) { mix(`${u.x},${u.y},${u.vx},${u.vy},${u.state},${u.move},${u.phase},${u.health},${u.stamina},${u.hitstop},${omit.includes('stun') ? '' : u.stun},${u.hidden}`); const j = u.rig.joints; for (const n in j) mix(`${j[n].x},${j[n].y}`); }
      mix(`${sim.phase},${sim.phaseTimer},${sim.timer},${sim.winner},${sim.banner},${sim.koSlow},${sim.finisher},${sim.wins},${sim.round},${sim.perfectT}`);
      for (const c of sim.callouts) mix(`${c.text},${c.by},${c.kind},${c.t}`);
      frames.push(h.toString(16));
      if (ph && sim.phaseName !== ph) break;
    }
    let d = 0x811c9dc5; for (const s of frames) for (let i = 0; i < s.length; i++) { d ^= s.charCodeAt(i); d = Math.imul(d, 0x01000193) >>> 0; }
    return { phase: ph || '(whole scene)', health: sim.units.map((u) => Math.round(u.health * 1000) / 1000).join('/'), digest: d.toString(16), frames, log, kos };
  }, { name, k, omit: opt('--omit', '').split(',') });
  if (!r) break;
  out.phases[`${name}#${k}`] = r;
  process.stderr.write(`${name}#${k} ${r.phase} hp ${r.health} log ${r.log.length}${r.kos.length ? ' ' + r.kos.join(' ') : ''}\n`);
  if (r.phase === '(whole scene)') break;
}
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`${Object.keys(out.phases).length} phases from ${names.length} scenes -> ${outFile}${errors.length ? `\npage errors: ${errors.slice(0, 5).join(' | ')}` : ''}`);
await browser.close(); server.close();
