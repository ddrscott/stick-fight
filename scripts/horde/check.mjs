#!/usr/bin/env node
// Horde is endless (README, Arcade flow, Horde): `npm run test:horde`. Headless Chromium on the raw source, the sim
// stepped in the page.
//   1. clock      a run has no clock: a 30 s TIME rule going in leaves roundTime 0, and 150 s on one goon ends nothing
//   2. regen      the hero heals HORDE_REGEN a second after HORDE_REGEN_DELAY seconds untouched, to a full bar; a hit
//                 starts the wait over
//   3. trips      a CPU hero against weak goons, 12 seeds up to 12 floors: every trip to the next floor starts its wave
//                 (the old build left him upstairs on 4 of them, until TIME)
//   4. KOs        ?scene=horde-ko-test: a goon put down by a plain hit, a juggle, a counter on its wake-up strike, a
//                 hit through armor and a throw. Each keeps the run going and counts exactly once, the fifth clears
//                 the floor, and then a goon KOing the hero still ends the run (the old build ended it on a juggle,
//                 wake or armor KO of a goon)
//   5. flow       the same run inside the arcade flow (index.html, HORDE): run.goons goes up by one a goon and the
//                 flow reaches GAME OVER only after the hero goes down
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glsl': 'text/plain' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
const errors = [];
pg.on('pageerror', e => errors.push(String(e)));
await pg.goto(`http://127.0.0.1:${server.address().port}/play/index.html?scene=dummy`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await pg.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 30000 });

const results = await pg.evaluate(() => {
  const g = window.__game, sim = g.sim, out = [];
  const ok = (name, pass, detail) => out.push({ name, pass: !!pass, detail });
  const step = (secs, each) => { for (let i = 0; i < secs * 60; i++) { sim.step(1000 / 60); if (each && each(i) === false) return i; } return -1; };
  const WEAK = { goonHealth: 7, goonDifficulty: 0.02, heal: 40 };

  // 1. the clock
  g.setScene('horde-floors-ai', {});
  sim.roundTime = 30; sim.resetMatch({ seed: 3, skipIntro: true, horde: WEAK });
  ok('clock: a 30 s rule going in, roundTime is 0', sim.roundTime === 0, `roundTime ${sim.roundTime}`);
  sim.setController(0, 'script', () => ({ dx: 0, block: true }));
  sim.setController(1, 'script', () => ({ dx: 0 }));
  let ended = null;
  step(150, (i) => { if (sim.phase !== 'fight') { ended = `${(i / 60).toFixed(1)}s ${sim.phase} ${sim.banner}`; return false; } });
  ok('clock: 150 s with no goon down ends nothing', !ended, ended || 'still fighting');

  // 2. regen
  const p = sim.units[0], H = sim.horde;
  p.health = 40; H.lastHp = 40; H.calm = 0;
  step(2.9); const early = p.health;
  ok('regen: nothing in the first 3 s', early === 40, `at 2.9 s ${early.toFixed(2)}`);
  step(10.1); const t13 = p.health;
  ok('regen: 1 a second after that', Math.abs(t13 - 50) < 0.2, `at 13 s ${t13.toFixed(2)} (want 50)`);
  step(60); ok('regen: stops at a full bar', p.health === (p.maxHealth || 100), `at 73 s ${p.health}`);
  p.health = 60; H.lastHp = 60; step(5); const before = p.health; p.health -= 10; step(2.9); const held = p.health; step(2);
  ok('regen: a hit starts the wait over', held === before - 10 && p.health > held, `${before.toFixed(1)} -10 -> ${held.toFixed(1)} after 2.9 s -> ${p.health.toFixed(1)} after 4.9 s`);

  // 3. the trips between floors: a CPU hero against weak goons, 12 seeds, up to 12 floors each. The old build left
  // the hero upstairs after some trips (an attack on the vault's drop lands him high on the flight, still counted
  // as upstairs) with no wave coming, until TIME ended the run: 4 of these 12 runs. A KO is fair; a trip
  // over 9 s, or any TIME, is not.
  const runs = [], bad = [];
  let longest = 0, floors = 0;
  for (let seed = 1; seed <= 12; seed++) {
    g.setScene('horde-floors-ai', { seed }); sim.setAI(0, 1.0);
    let at = -1, res = '';
    step(300, (i) => {
      const H = sim.horde, p = sim.units[0];
      if (sim.phase === 'ko' || sim.phase === 'match') { res = sim.banner === 'TIME' ? 'TIME' : 'KO'; return false; }
      if (H.transit && at < 0) at = i; if (!H.transit) at = -1;
      if (at >= 0) longest = Math.max(longest, (i - at) / 60);
      if (at >= 0 && i - at > 9 * 60) { res = `STUCK heroFloor ${p.floor} stair ${p.stair}`; return false; }
      if (H.floorsCleared >= 12) { res = '12'; return false; }
    });
    floors += sim.horde.floorsCleared;
    runs.push(`${seed}:${res || sim.horde.floorsCleared}`);
    if (res === 'TIME' || res.startsWith('STUCK')) bad.push(`seed ${seed} ${res} after ${sim.horde.floorsCleared} floors`);
  }
  ok('trips: every trip to the next floor starts its wave, no TIME', !bad.length && longest <= 9, `${floors} floors over 12 runs (seed:floors or KO) ${runs.join(' ')}, longest trip ${longest.toFixed(1)} s${bad.length ? '; ' + bad.join('; ') : ''}`);

  // 4. every way a goon goes down
  g.setScene('horde-ko-test', {});
  const T = g.hordeKoTest;
  step(90, () => (T.done ? false : undefined));
  const kinds = ['plain', 'juggle', 'wake', 'armor', 'throw'];
  for (const k of kinds) {
    const r = T.results.find(x => x.kind === k);
    ok(`KOs: a goon down by ${k} keeps the run going, counts once`, r && r.ok, r ? JSON.stringify(r) : 'no result');
  }
  const last = T.results.find(x => x.kind === 'throw');
  ok('KOs: the fifth goon down clears the floor', last && last.floorsCleared === 1 && last.wave === '5/5', last ? `wave ${last.wave}, floors ${last.floorsCleared}` : 'none');
  const hk = T.results.find(x => x.kind === 'hero');
  ok('KOs: a goon KOing the hero still ends the run', hk && hk.ok && sim.phase === 'match', hk ? JSON.stringify(hk) + ` phase ${sim.phase}` : 'no result');
  return out;
});

// 5. the same run in the arcade flow: its own scoring and its GAME OVER
await pg.goto(`http://127.0.0.1:${server.address().port}/play/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await pg.waitForFunction(() => window.__flow && window.__game, null, { timeout: 30000 });
const flowRes = await pg.evaluate(async () => {
  const g = window.__game, sim = g.sim, F = window.__flow, out = [];
  const ok = (name, pass, detail) => out.push({ name, pass: !!pass, detail });
  F.debug.go('modeSelect'); F.debug.sel.player = 'temp'; F.debug.startHorde();
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 200 && sim.phase !== 'fight'; i++) await wait(50);
  g.installHordeKo({});
  const T = g.hordeKoTest, states = new Set();
  // real time, the flow's own loop; record every flow state on the way
  for (let i = 0; i < 1200 && !(T.done && F.state === 'gameOver'); i++) { states.add(F.state); await wait(50); }
  states.add(F.state);
  const goonRes = T.results.filter(r => r.kind !== 'hero');
  ok('flow: run.goons up by exactly one for each of the five goons', goonRes.length === 5 && goonRes.every(r => r.goonsUp === 1) && F.debug.run.goons === 5,
    `${goonRes.map(r => `${r.kind}:${r.goonsUp}`).join(' ')} run.goons ${F.debug.run.goons}`);
  ok('flow: every goon KO keeps the run going', goonRes.length === 5 && goonRes.every(r => r.ok), goonRes.map(r => `${r.kind}:${r.ok ? 'ok' : r.why || JSON.stringify(r)}`).join(' '));
  const hk = T.results.find(r => r.kind === 'hero');
  ok('flow: GAME OVER comes after the hero goes down, not before', hk && hk.heroDown && F.state === 'gameOver', `hero ${hk ? JSON.stringify(hk) : 'none'}, flow ${F.state}, states ${[...states].join(' > ')}`);
  return out;
}).catch(e => [{ name: 'flow: ran', pass: false, detail: String(e) }]);
results.push(...flowRes);

let fail = 0;
for (const r of results) { if (!r.pass) fail++; console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name}  (${r.detail})`); }
if (errors.length) { fail++; console.log('FAIL page errors:\n  ' + errors.join('\n  ')); }
console.log(`${results.length - (fail - (errors.length ? 1 : 0))} of ${results.length} passed`);
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
