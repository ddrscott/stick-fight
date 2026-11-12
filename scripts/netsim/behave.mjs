#!/usr/bin/env node
// Same behavior, before and after a change to how state is kept (README, Fundamentals, States and the flags they own).
// Node, no browser.
//   node scripts/netsim/behave.mjs OUT.txt [--root DIR] [--steps 6000]
//   then: cmp A.txt B.txt, or diff them to see which run parts first
// CPU against CPU (0.9 both), every character, in versus (short bars, 30 s rounds) and in horde (the character as the
// hero), three seeds each. Every step writes a deep hash of the whole state (scripts/netsim/client.mjs deepHash)
// without sim.result and without the unit fields listed in OMIT: the transient flags enter() puts back to rest when a
// unit leaves the state that owns them. A run that hashes the same on every step played the same match: the same
// positions, health, clips, log and rng. A flag that only lingered (stale, and never read) can't show up here; one
// that was read while stale changes what happens next, and the run parts from main at that step.
// --root runs another checkout's src (copy this script and client.mjs there: deepHash needs its unitOmit).
import fs from 'node:fs';
import path from 'node:path';
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const out = argv[0];
const here = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const root = path.resolve(opt('--root', here)), STEPS = +opt('--steps', 6000);
// --only TAG runs one run (as named in OUT); --dump STEP prints every unit's fields and the last log entries at that step
const ONLY = opt('--only', null), DUMP = +opt('--dump', -1);
const { installDom } = await import(root + '/scripts/netsim/env.mjs'); installDom();
const { deepHash } = await import(root + '/scripts/netsim/client.mjs');
const { createFighter, MOVES, MOVE_DATA } = await import(root + '/src/fighter/index.js');
const { createArena } = await import(root + '/src/arena/index.js');
const { createCombat } = await import(root + '/src/combat/sim.js');
const { EMPTY_INPUT } = await import(root + '/src/combat/input.js');
const { roster } = await import(root + '/src/characters/index.js');
// the flags enter() clears (src/combat/sim.js FLAG_REST), written out so a checkout without them hashes the same way
const OMIT = ['move', 'phase', 'launchCancelAt', 'otgConfirm', 'lowStance', 'wakeUp', 'grabOK', 'glide', 'followThrough', 'chase', 'grabbedBy', 'grabTo',
  'grabT', 'grabNoBreak', 'splatPending', 'wallBounce', 'groundBounce', 'juggle', 'breakOK', 'stun', 'otgHit', 'downPin', 'rollCross', 'rolled', 'vaultPhase',
  'landLag', 'dashDir', 'pfStage'];
const ids = roster().map((c) => c.id);
const lines = [];
for (let i = 0; i < ids.length; i++) for (const horde of [false, true]) for (const seed of [11, 22, 33]) {
  const pair = [ids[i], ids[(i + (horde ? 3 : 5) + seed % 7) % ids.length]];
  if (ONLY && ONLY !== `${horde ? 'horde' : 'versus'}:${pair.join(':')}#${seed}`) continue;
  const arena = createArena('building'), sp = arena.spawns;
  const fighters = [createFighter({ x: sp[0].x, y: sp[0].y, facing: 1 }), createFighter({ x: sp[1].x, y: sp[1].y, facing: -1 })];
  let sim; const makeRig = (c) => { const g = sim.units[0]; return createFighter({ color: c, x: g.x, y: g.y, facing: -1 }); };
  sim = createCombat({ fighters, arena, input: { snapshot: () => EMPTY_INPUT }, onEvent() {}, makeRig, moves: MOVES, moveData: MOVE_DATA });
  sim.setCharacters(pair); sim.setAI(0, 0.9); sim.setAI(1, 0.9);
  sim.roundTime = 30; sim.resetMatch({ seed, startHealth: 40, fresh: true, horde: horde ? { goonHealth: 20, goonDifficulty: 0.7 } : null });
  const tag = `${horde ? 'horde' : 'versus'}:${pair.join(':')}#${seed}`;
  for (let t = 0; t < STEPS; t++) {
    sim.tick(); lines.push(`${tag}:${t} ${deepHash(sim, ['result'], OMIT)}`);
    if (t === DUMP) {
      for (const u of sim.units) for (const k of Object.keys(u).sort()) if (!['rig', 'controller', 'char', 'prevJoints', 'landJoints', 'last'].includes(k)) console.log(`u${u.id}.${k} = ${JSON.stringify(u[k])}`);
      for (const e of sim.log.slice(-12)) console.log('log', JSON.stringify(e));
    }
  }
}
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`${ids.length * 6} runs, ${STEPS} steps each -> ${out}`);
