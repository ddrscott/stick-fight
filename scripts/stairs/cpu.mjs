// The CPU and the stairs (README, Stairs hurt): `node scripts/stairs/cpu.mjs [seeds]`. Headless, ~10 s. On a flight
// (where the stairwell's own rules, which already cover the floor above, don't apply):
//   backed:  the CPU (difficulty 0.8) starts a few steps down a flight, P1 above it on the same flight walks at it and
//            throws roundhouses and throws. Stair damage the CPU takes in 8 s, and how often it ends on the floor below
//   pusher:  P1 stands still a few steps down a flight, facing up; the CPU starts above him on the flight.
//            How many seeds it sends him down the steps within 8 s, and the stair damage
import { installDom } from '../netsim/env.mjs';
installDom();
const R = '../../src/';
const { createFighter, MOVES, MOVE_DATA } = await import(R + 'fighter/index.js');
const { createArena } = await import(R + 'arena/index.js');
const { createCombat } = await import(R + 'combat/sim.js');
const { EMPTY_INPUT } = await import(R + 'combat/input.js');
await import(R + 'characters/index.js');
const N = +(process.argv[2] || 24);

function setup(seed) {
  const arena = createArena('building'), sp = arena.spawns;
  const fighters = [createFighter({ x: sp[0].x, y: sp[0].y, facing: 1 }), createFighter({ x: sp[1].x, y: sp[1].y, facing: -1 })];
  const sim = createCombat({ fighters, arena, input: { snapshot: () => EMPTY_INPUT }, onEvent() {}, makeRig: null, moves: MOVES, moveData: MOVE_DATA });
  sim.resetMatch({ seed, skipIntro: true });
  for (let i = 0; i < 60; i++) sim.tick();
  return sim;
}
function place(sim, i, k, x, f) { const u = sim.units[i]; u.x = x; u.facing = f; u.rig.x = x; u.rig.facing = f; u.stair = k; u.floor = 0; u.y = sim.stairY(k, x); u.rig.y = u.y; u.rig.update(0); sim.rigUpd(u, 0); }
const paid = (sim, def) => sim.log.filter((r) => r.type === 'stairHit' && r.def === def).reduce((a, r) => a + r.dmg, 0);

let topDmg = 0, topKd = 0, topNear = 0, topSteps = 0, takenDmg = 0, below = 0, sent = 0, sentDmg = 0, kdTaken = 0, kdGiven = 0, downhill = 0, steps = 0;
// u knocked down (or launched) on a flight with the other one uphill of it: a knockdown down the stairs
function knocks(sim, i, prev) {
  const u = sim.units[i], o = sim.units[1 - i], down = u.state === 'knockdown' || !!u.rag;
  const n = down && !prev[i] && (u.stair >= 0 || prev.st[i] >= 0) && o.y < u.y ? 1 : 0;
  prev[i] = down; prev.st[i] = u.stair; return n;
}
for (let s = 0; s < N; s++) {
  const fl = s % 2;
  {
    const sim = setup(100 + s), st = sim.stairs[fl], X = (al) => st.head + st.dir * al;
    let t = 0;
    sim.setController(0, 's', () => {
      const me = sim.units[0], op = sim.units[1], d = Math.abs(op.x - me.x), dx = Math.sign(op.x - me.x);
      if (d > 95) return { ...EMPTY_INPUT, dx };
      return (t % 40) === 0 ? { ...EMPTY_INPUT, ...((t / 40) % 3 === 2 ? { lp: true, lk: true } : { rk: true }) } : { ...EMPTY_INPUT };
    });
    sim.setAI(1, 0.8);
    place(sim, 1, fl, X(90), -st.dir); place(sim, 0, fl, X(-10), st.dir);
    const prev = { st: [-1, -1] };
    for (t = 0; t < 480; t++) { sim.tick(); kdTaken += knocks(sim, 1, prev); const u = sim.units[1]; steps++; if (u.stair >= 0 && sim.units[0].y < u.y - 8) downhill++; }
    takenDmg += paid(sim, 1); if (sim.units[1].floor === 1 && sim.units[1].stair < 0) below++;
  }
  {
    const sim = setup(300 + s), st = sim.stairs[fl], X = (al) => st.head + st.dir * al;
    let t = 0;
    sim.setController(0, 's', () => {
      const me = sim.units[0], op = sim.units[1], d = Math.abs(op.x - me.x), dx = Math.sign(op.x - me.x);
      if (d > 95) return { ...EMPTY_INPUT, dx };
      return (t % 40) === 0 ? { ...EMPTY_INPUT, ...((t / 40) % 3 === 2 ? { lp: true, lk: true } : { rk: true }) } : { ...EMPTY_INPUT };
    });
    sim.setAI(1, 0.8);
    sim.floorBroken = s % 4 >= 2;   // half with the stairwell's own rule out of the way (as after a floor break, or in horde)
    const pl = (i, x, f) => { const u = sim.units[i]; u.x = x; u.facing = f; u.rig.x = x; u.rig.facing = f; u.stair = -1; u.floor = 0; u.y = sim.floors[0].y; u.rig.y = u.y; u.rig.update(0); sim.rigUpd(u, 0); };
    pl(1, X(-20), -st.dir); pl(0, X(-130), st.dir);
    for (t = 0; t < 480; t++) { sim.tick(); const u = sim.units[1]; topSteps++; if (u.stair < 0 && (u.floor || 0) === 0 && Math.abs(u.x - st.head) < 120) topNear++; }
    topDmg += paid(sim, 1); topKd += sim.log.filter((r) => r.type === 'floorBreak').length;
  }
  {
    const sim = setup(200 + s), st = sim.stairs[fl], X = (al) => st.head + st.dir * al;
    sim.setController(0, 'none');
    sim.setAI(1, 0.8);
    place(sim, 0, fl, X(110), -st.dir); place(sim, 1, fl, X(-20), st.dir);
    const prev = { st: [-1, -1] };
    for (let t = 0; t < 480; t++) { sim.tick(); kdGiven += knocks(sim, 0, prev); }
    const d = paid(sim, 0); if (d > 0) { sent++; sentDmg += d; }
  }
}
console.log(`top:     within 120 px of the head ${(100 * topNear / topSteps).toFixed(0)}% of the time, floor breaks ${topKd}, paid ${topDmg} on the steps`);
console.log(`backed:  downhill of him on a flight ${(100 * downhill / steps).toFixed(0)}% of the time, knocked down the stairs ${kdTaken} times, paid ${takenDmg} on the steps over ${N} fights, ended on the floor below ${below}/${N}`);
console.log(`pusher:  knocked him down the stairs ${kdGiven} times, sent him down the steps ${sent}/${N} (stair damage ${sentDmg})`);
