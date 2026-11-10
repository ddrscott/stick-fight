#!/usr/bin/env node
// The sim's cost in Node (README, Performance): sim.tick and saveState/loadState over CPU-vs-CPU bouts, and the
// worst 12-step rollback burst (load, then 12 ticks each preceded by a save, as src/net/rollback.js does).
//   node scripts/perf/simbench.mjs [--steps 6000] [--prof]   (--prof: run under node --cpu-prof yourself)
import { installDom } from '../netsim/env.mjs';
installDom();
const { createFighter, MOVES, MOVE_DATA } = await import('../../src/fighter/index.js');
const { createArena } = await import('../../src/arena/index.js');
const { createCombat } = await import('../../src/combat/sim.js');
const { EMPTY_INPUT } = await import('../../src/combat/input.js');
const { hashSim, dumpSim } = await import('../../src/net/hash.js');
await import('../../src/characters/index.js');   // registers every character
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? +argv[i + 1] : d; };
const STEPS = arg('steps', 6000);
function makeSim() {
  const arena = createArena('building'), sp = arena.spawns;
  const fighters = [createFighter({ x: sp[0].x, y: sp[0].y, facing: 1 }), createFighter({ x: sp[1].x, y: sp[1].y, facing: -1 })];
  let sim; const makeRig = (c) => { const g = sim.units[0]; return createFighter({ color: c, x: g.x, y: g.y, facing: -1 }); };
  sim = createCombat({ fighters, arena, input: { snapshot: () => EMPTY_INPUT }, onEvent() {}, makeRig, moves: MOVES, moveData: MOVE_DATA });
  return sim;
}
const pct = (v, q) => v.slice().sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(q * v.length))];
const now = () => performance.now();
for (const pair of [['manager', 'wellness'], ['chef', 'receptionist'], ['temp', 'security']]) {
  const sim = makeSim();
  sim.setCharacters(pair); sim.setAI(0, 0.9); sim.setAI(1, 0.9); sim.resetMatch({ seed: 7, fresh: true });
  const tick = [], save = [], load = [], burst = [], hash = [];
  let snap = null; const ring = Array.from({ length: 14 }, () => null);
  for (let t = 0; t < STEPS; t++) {
    let a = now(); sim.tick(); tick.push(now() - a);
    a = now(); snap = sim.saveState(snap); save.push(now() - a);
    if (t % 30 === 29) { a = now(); hashSim(sim); dumpSim(sim); hash.push(now() - a); }
    if (t % 50 === 49) {
      a = now(); sim.loadState(snap); load.push(now() - a);
      const b0 = now();
      for (let i = 0; i < 12; i++) { ring[i] = sim.saveState(ring[i]); sim.tick(); }
      burst.push(now() - b0);
      sim.loadState(snap);
    }
  }
  const f = (v) => `p50 ${pct(v, 0.5).toFixed(3)} p99 ${pct(v, 0.99).toFixed(3)} max ${Math.max(...v).toFixed(3)}`;
  console.log(`${pair.join(' v ')}\n  tick  ${f(tick)}\n  save  ${f(save)}\n  load  ${f(load)}\n  hash  ${f(hash)}\n  burst ${f(burst)} ms`);
}
