#!/usr/bin/env node
// A hit path can't decide what a KO means (README, Fundamentals, How a KO resolves): `npm run test:ko`. Node, no browser.
//   1. source   in src/combat/sim.js only roundKO() and the clock end a round (sim.phase = 'ko'), only roundKO(),
//               the clock and the match end write sim.result, and only goonKO() calls goonDown()
//   2. horde    a goon dropped to 0 health with no KO reported (what a brand-new hit branch that forgot koBody would
//               do), on his feet, in the air, on the floor and in hitstun: each time sim.result stays not over, the
//               goon is counted once and the next one comes in; then the hero at 0 ends the run with reason heroDown
//   3. versus   the same 0-health drop in a 1v1 ends the round as a KO for the other side, and TIME says 'time'
import fs from 'node:fs';
import { installDom } from '../netsim/env.mjs';
installDom();
const { createFighter, MOVES, MOVE_DATA } = await import('../../src/fighter/index.js');
const { createArena } = await import('../../src/arena/index.js');
const { createCombat } = await import('../../src/combat/sim.js');
const { EMPTY_INPUT } = await import('../../src/combat/input.js');
await import('../../src/characters/index.js');   // registers every character's moves (FRAME_DATA)

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };

// 1. the source
const src = fs.readFileSync(new URL('../../src/combat/sim.js', import.meta.url), 'utf8');
// which function each line sits in: the nearest `function name(` or `sim.name =` above it, by indentation
const lines = src.split('\n'), owner = [];
let cur = '(top)';
for (const l of lines) { const m = l.match(/^  (?:function (\w+)|sim\.(\w+) = )/); if (m) cur = m[1] || m[2]; owner.push(cur); }
const where = (re) => lines.map((l, i) => (re.test(l) && !/^\s*\/\//.test(l) ? owner[i] : null)).filter(Boolean);
const ends = where(/sim\.phase = 'ko'/), results = where(/sim\.result = (?!PLAYING)/), downs = where(/[^.\w]goonDown\(/).filter((f) => f !== 'goonDown');
ok("source: only roundKO and the clock (roundFlow) set sim.phase = 'ko'", ends.every((f) => f === 'roundKO' || f === 'roundFlow') && ends.length === 2, ends.join(', '));
ok('source: only roundKO, the clock and the match end (roundFlow) write sim.result', results.every((f) => f === 'roundKO' || f === 'roundFlow'), results.join(', '));
ok('source: only goonKO calls goonDown', downs.length === 1 && downs[0] === 'goonKO', downs.join(', '));
ok('source: applyHit and absorb never call roundKO or goonKO themselves', !where(/roundKO\(|goonKO\(/).some((f) => f === 'applyHit' || f === 'absorb'));

function makeSim() {
  const arena = createArena('building'), sp = arena.spawns;
  const fighters = [createFighter({ x: sp[0].x, y: sp[0].y, facing: 1 }), createFighter({ x: sp[1].x, y: sp[1].y, facing: -1 })];
  let sim; const events = [];
  const makeRig = (c) => { const g = sim.units[0]; return createFighter({ color: c, x: g.x, y: g.y, facing: -1 }); };
  sim = createCombat({ fighters, arena, input: { snapshot: () => EMPTY_INPUT }, onEvent(e) { events.push(e.type); }, makeRig, moves: MOVES, moveData: MOVE_DATA });
  sim.events = events;
  sim.setController(0, 'none'); sim.setController(1, 'none');
  return sim;
}
const quiet = console.warn; let warned = 0;
console.warn = (...a) => { if (String(a[0]).includes('no KO reported')) warned++; else quiet(...a); };
const run = (sim, n) => { for (let i = 0; i < n; i++) sim.tick(); };

// 2. horde
{
  const sim = makeSim();
  sim.resetMatch({ seed: 7, skipIntro: true, horde: { goonHealth: 30, goonDifficulty: 0.2, heal: 10 } });
  for (const u of sim.units) sim.setController(u.id, 'none');
  run(sim, 60);
  const states = [
    ['on his feet', () => {}],
    ['in the air', (g) => { g.grounded = false; g.vy = -300; g.y -= 80; }],
    ['on the floor', (g) => { g.state = 'down'; g.downTimer = 60; }],
    ['in hitstun', (g) => { g.state = 'hitstun'; g.stun = 20; }],
  ];
  for (const [name, set] of states) {
    const g = sim.units.find((u) => u.id >= 1 && !u.hidden), count0 = sim.horde.count, w0 = warned;
    set(g); g.health = 0;   // a damage path that only lowers health: no koBody, no report
    run(sim, 1);
    ok(`horde: a goon at 0 health ${name} with no KO reported keeps the run going`, !sim.result.over && sim.phase === 'fight', `result ${JSON.stringify(sim.result)} phase ${sim.phase}`);
    ok(`horde: ... counted once, and the sweep said so`, sim.horde.count === count0 + 1 && warned === w0 + 1, `count ${count0} -> ${sim.horde.count}`);
    run(sim, 1);
    ok('horde: ... and not again on the next step', sim.horde.count === count0 + 1);
    run(sim, 200);
  }
  ok('horde: each sent the goonDown event the flow scores', sim.events.filter((e) => e === 'goonDown').length === 4);
  ok('horde: a goon going down never ended the round', !sim.result.over && sim.winner === -1);
  // a goon going down through the test hook (forceKO, the same resolution a hit uses)
  const g = sim.units.find((u) => u.id >= 1 && !u.hidden), c0 = sim.horde.count;
  ok('horde: forceKO on a goon keeps the run going', sim.forceKO(g, sim.units[0]) && !sim.result.over && sim.horde.count === c0 + 1);
  run(sim, 200);
  // the hero
  const p = sim.units[0];
  p.health = 0; run(sim, 1);
  ok('horde: the hero at 0 ends the run with reason heroDown', sim.result.over && sim.result.reason === 'heroDown' && sim.phase === 'ko', JSON.stringify(sim.result));
  let final = false; for (let i = 0; i < 2400 && !final; i++) { sim.tick(); final = sim.result.final; }
  ok('horde: ... and the run is over (final) once the KO card has held', final && sim.phase === 'match');
}
// 3. versus
{
  const sim = makeSim();
  sim.resetMatch({ seed: 3, skipIntro: true });
  run(sim, 30);
  sim.units[1].health = 0; run(sim, 1);
  ok('versus: P2 at 0 health with no KO reported is a KO for P1', sim.result.over && sim.result.reason === 'ko' && sim.result.winner === 0 && sim.phase === 'ko' && sim.units[1].state === 'ko', JSON.stringify(sim.result));
  const sim2 = makeSim();
  sim2.roundTime = 1; sim2.resetMatch({ seed: 3, skipIntro: true });
  sim2.units[1].health -= 5;
  run(sim2, 130);
  ok("versus: TIME ends the round with reason 'time'", sim2.result.over && sim2.result.reason === 'time' && sim2.result.winner === 0, JSON.stringify(sim2.result));
  ok('versus: a new round starts not over', (() => { sim2.startRound(2, { skipIntro: true }); return !sim2.result.over; })());
}
console.warn = quiet;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
