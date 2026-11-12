#!/usr/bin/env node
// 1v1 KOs by the hundred, for a before/after (README, Fundamentals, How a KO resolves). Node, no browser.
//   node scripts/ko/fights.mjs OUT.txt [--root DIR] [--steps 6000]
//   then: diff A.txt B.txt   (cmp is enough: every line must match)
// CPU against CPU (0.9 both) on short bars (startHealth 30, 30 s rounds), for every pairing below and three seeds.
// Every step's deep hash of the state (scripts/netsim/client.mjs deepHash, without sim.result, which main doesn't
// have) goes in the file, and so does every round end with the hit that ended it: plain, juggle (air), wake, armor or
// throw, with FINISH when it was an ender. --root runs another checkout's src with this script.
import fs from 'node:fs';
import path from 'node:path';
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const out = argv[0];
const here = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const root = path.resolve(opt('--root', here)), STEPS = +opt('--steps', 6000);
// the hash and the DOM stand-in come from the checkout under test: deepHash knows the clips and characters by their
// module objects, so it has to see the same modules the sim does (copy client.mjs there: it needs deepHash's omit)
const { installDom } = await import(root + '/scripts/netsim/env.mjs'); installDom();
const { deepHash } = await import(root + '/scripts/netsim/client.mjs');
const { createFighter, MOVES, MOVE_DATA } = await import(root + '/src/fighter/index.js');
const { createArena } = await import(root + '/src/arena/index.js');
const { createCombat } = await import(root + '/src/combat/sim.js');
const { EMPTY_INPUT } = await import(root + '/src/combat/input.js');
await import(root + '/src/characters/index.js');

const PAIRS = [['temp', 'temp'], ['helpdesk', 'janitor'], ['courier', 'security'], ['windowWasher', 'intern'], ['manager', 'barista'], ['ceo', 'wellness'],
  ['chef', 'electrician'], ['receptionist', 'lawyer'], ['accountant', 'temp'], ['salesRep', 'hrRep'], ['chef', 'temp'], ['lawyer', 'ceo']];
const lines = [], tally = {};
for (const pair of PAIRS) for (const seed of [11, 22, 33]) {
  const arena = createArena('building'), sp = arena.spawns;
  const fighters = [createFighter({ x: sp[0].x, y: sp[0].y, facing: 1 }), createFighter({ x: sp[1].x, y: sp[1].y, facing: -1 })];
  let sim; const makeRig = (c) => { const g = sim.units[0]; return createFighter({ color: c, x: g.x, y: g.y, facing: -1 }); };
  sim = createCombat({ fighters, arena, input: { snapshot: () => EMPTY_INPUT }, onEvent() {}, makeRig, moves: MOVES, moveData: MOVE_DATA });
  try { sim.setCharacters(pair); } catch (e) { lines.push(`${pair} skipped: ${e.message}`); continue; }
  sim.setAI(0, 0.9); sim.setAI(1, 0.9);
  sim.roundTime = 30; sim.resetMatch({ seed, startHealth: 30, fresh: true });
  let was = sim.phase, lastHit = null, seen = new WeakSet();
  for (let t = 0; t < STEPS; t++) {
    sim.tick();
    for (const e of sim.log) {
      if (seen.has(e)) continue; seen.add(e);
      if (e.type === 'hit' || e.type === 'armor') lastHit = e;
    }
    if (sim.phase === 'ko' && was !== 'ko') {
      const fin = sim.log.some((e) => e.step === sim.stepCount && e.type === 'callout' && e.text === 'FINISH');
      const h = lastHit || {}, how = sim.banner === 'TIME' ? 'time' : h.type === 'armor' ? 'armor' : h.wake ? 'wake' : h.air ? 'juggle' : /throw|Throw|toss|Toss/.test(h.move || '') ? 'throw' : h.trade ? 'trade' : 'plain';
      tally[how] = (tally[how] || 0) + 1; if (fin) tally.finish = (tally.finish || 0) + 1;
      lines.push(`${pair.join(':')}#${seed} step ${sim.stepCount} ${sim.banner} winner ${sim.winner} by ${how}${fin ? ' FINISH' : ''} (${h.move || '-'})`);
    }
    was = sim.phase;
    lines.push(`${pair.join(':')}#${seed}:${t} ${deepHash(sim, ['result'])}`);
  }
}
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`${PAIRS.length * 3} fights, ${STEPS} steps each -> ${out}\nround ends by the hit that ended them: ${JSON.stringify(tally)}`);
