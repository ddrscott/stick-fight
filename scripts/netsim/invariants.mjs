#!/usr/bin/env node
// The sim's per-step invariants over thousands of CPU-vs-CPU steps (README, Run; README, Fundamentals, States and the
// flags they own). Node, no browser.
//   npm run netsim:invariants                 (node scripts/netsim/invariants.mjs [--steps 6000] [--seeds 11,22,33])
//   node scripts/netsim/invariants.mjs --durations    also print the longest each state lasted (for STUCK_STEPS)
// Every character, in versus (against a different character each seed, on short bars so rounds and matches turn over)
// and in horde (as the hero against CPU goons), for each seed in a fixed list, the CPUs at a mix of difficulties.
// src/combat/invariants.js checks after every tick. The first violation stops the run and prints the run, the seed,
// the step, the unit and the last sim.log entries, and the script exits 1.
import path from 'node:path';
import { installDom } from './env.mjs';
installDom();
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const { createFighter, MOVES, MOVE_DATA } = await import(root + '/src/fighter/index.js');
const { createArena } = await import(root + '/src/arena/index.js');
const { createCombat } = await import(root + '/src/combat/sim.js');
const { EMPTY_INPUT } = await import(root + '/src/combat/input.js');
const { roster } = await import(root + '/src/characters/index.js');
const { createInvariants } = await import(root + '/src/combat/invariants.js');

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const STEPS = +opt('steps', 6000), SEEDS = opt('seeds', '11,22,33').split(',').map(Number), DURATIONS = argv.includes('--durations');
const DIFF = [0.9, 0.5, 1];   // the CPUs' difficulty, by seed index: an expert, a middling hand, the showcase's best
const ids = roster().map((c) => c.id);
const t0 = Date.now(), longest = {};
let runs = 0, steps = 0;
for (const horde of [false, true]) for (let si = 0; si < SEEDS.length; si++) for (let i = 0; i < ids.length; i++) {
  const seed = SEEDS[si], pair = [ids[i], ids[(i + 1 + si * 5 + (horde ? 3 : 0)) % ids.length]];
  const arena = createArena('building'), sp = arena.spawns;
  const fighters = [createFighter({ x: sp[0].x, y: sp[0].y, facing: 1 }), createFighter({ x: sp[1].x, y: sp[1].y, facing: -1 })];
  let sim; const makeRig = (c) => { const g = sim.units[0]; return createFighter({ color: c, x: g.x, y: g.y, facing: -1 }); };
  sim = createCombat({ fighters, arena, input: { snapshot: () => EMPTY_INPUT }, onEvent() {}, makeRig, moves: MOVES, moveData: MOVE_DATA });
  sim.setCharacters(pair);
  const d = DIFF[si % DIFF.length];
  sim.setAI(0, d); sim.setAI(1, 0.9);
  sim.roundTime = 30;
  sim.resetMatch({ seed, startHealth: 40, fresh: true, horde: horde ? { goonHealth: 20, goonDifficulty: 0.7 } : null });
  const check = createInvariants(sim), run = `${horde ? 'horde' : 'versus'} ${pair.join(' v ')} seed ${seed} (CPU ${d} v 0.9)`;
  const at = new Map();
  for (let t = 0; t < STEPS; t++) {
    sim.tick(); steps++;
    const bad = check();
    if (bad) {
      console.log(`FAIL ${bad.rule}: ${run}, step ${t} (sim.stepCount ${sim.stepCount}, phase ${sim.phase}), unit ${bad.unit} in ${bad.state}: ${bad.detail}`);
      const u = sim.units[bad.unit];
      if (u) console.log(`  unit ${u.id} (${u.char.id}): x ${u.x.toFixed(1)} y ${u.y.toFixed(1)} vx ${u.vx.toFixed(1)} health ${u.health} move ${u.move} phase ${u.phase} hitstop ${u.hitstop} hidden ${u.hidden}`);
      console.log('  last sim.log entries:');
      for (const e of sim.log.slice(-8)) console.log('   ', JSON.stringify(e));
      console.log(`\nrepeat it: node scripts/netsim/invariants.mjs --seeds ${seed} --steps ${t + 1}`);
      process.exit(1);
    }
    if (DURATIONS) for (const u of sim.units) {
      const k = u.hidden ? '(hidden)' : u.state, p = at.get(u);
      if (!p || p.k !== k) { at.set(u, { k, t }); continue; }
      if (!longest[k] || t - p.t > longest[k].n) longest[k] = { n: t - p.t, run: `${run}, unit ${u.id}, step ${t}` };
    }
  }
  runs++;
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`invariants: ${runs} runs (${ids.length} characters, versus and horde, seeds ${SEEDS.join(' ')}), ${steps} steps, no violations (${secs} s)`);
if (DURATIONS) {
  console.log('\nlongest in one state (steps):');
  for (const [k, v] of Object.entries(longest).sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k.padEnd(10)} ${String(v.n).padStart(5)}  ${v.run}`);
}
