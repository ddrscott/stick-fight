// Save/restore proof (README, Multiplayer, Rollback) and the resync proof, in Node.
//
//   npm run netsim:proof            (node scripts/netsim/proof.mjs [--steps 9000] [--bouts 4])
//
// 1. Rollback: CPU-vs-CPU bouts across round and match ends, their inputs recorded per step (the CPUs read
//    the reference sim; the inputs are then replayed through 'net'-style controllers). The replay saves at
//    random steps (and, more often, in hitstop, throws, ragdolls, KOs, stair falls and vaults), runs 1 to 16
//    steps, restores, runs again, and every step's deep hash of saveState() must match the reference.
// 2. Resync: at random steps the reference's state is encoded as text (src/net/state.js), decoded by a second
//    sim that has played something else entirely (its own characters, demo and reach table), and loaded there;
//    both then run 240 steps on the same inputs and must hash the same on every step.

import { installDom } from './env.mjs';
installDom();
const { createFighter, MOVES, MOVE_DATA } = await import('../../src/fighter/index.js');
const { createArena } = await import('../../src/arena/index.js');
const { createCombat } = await import('../../src/combat/sim.js');
const { EMPTY_INPUT } = await import('../../src/combat/input.js');
const { mulberry32 } = await import('../../src/combat/rng.js');
const { roster } = await import('../../src/characters/index.js');
const { encodeState, decodeState } = await import('../../src/net/state.js');
const { createAI } = await import('../../src/combat/ai.js');
// a CPU on its own rng that only reads the sim (what it writes on its unit goes to a shadow copy), so a replay
// of its recorded presses through plain controllers is the same match
function thumbs(sim, i, seed) {
  const ai = createAI({ rng: mulberry32(seed), difficulty: 0.9, reach: (m) => sim.reachOf(sim.units[i], m) });
  const shadow = {}, mine = ['aaJump', 'grabId', 'rollId'];
  return (me, opp, s) => { const keep = mine.map((k) => shadow[k]); Object.assign(shadow, me); mine.forEach((k, j) => { shadow[k] = keep[j]; }); return ai(shadow, opp, s) || EMPTY_INPUT; };
}
const { deepHash } = await import('./client.mjs');

function makeSim() {
  const arena = createArena('building'), sp = arena.spawns;
  const fighters = [createFighter({ x: sp[0].x, y: sp[0].y, facing: 1 }), createFighter({ x: sp[1].x, y: sp[1].y, facing: -1 })];
  let sim; const makeRig = (c) => { const g = sim.units[0]; return createFighter({ color: c, x: g.x, y: g.y, facing: -1 }); };
  sim = createCombat({ fighters, arena, input: { snapshot: () => EMPTY_INPUT }, onEvent() {}, makeRig, moves: MOVES, moveData: MOVE_DATA });
  return sim;
}
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? +argv[i + 1] : d; };
const STEPS = arg('steps', 9000), BOUTS = arg('bouts', 4);
const PAIRS = [['temp', 'temp'], ['helpdesk', 'janitor'], ['courier', 'security'], ['windowWasher', 'intern'], ['manager', 'barista'], ['ceo', 'wellness'], ['chef', 'electrician'], ['receptionist', 'lawyer']];
const INTERESTING = (sim) => sim.units.some((u) => u.hitstop > 0 || u.state === 'grabbed' || u.rag || u.state === 'ko' || u.falling || u.state === 'vault' || u.stair >= 0 || u.state === 'celebrate') || sim.phase !== 'fight';

function diffJson(a, b, p) { if (JSON.stringify(a) === JSON.stringify(b)) return; if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffJson(a[k], b[k], p + '.' + k); return; } console.log('   ', p, JSON.stringify(a)?.slice(0, 120), '|', JSON.stringify(b)?.slice(0, 120)); }
let rbChecks = 0, rbBad = 0, rbCount = 0, syncChecks = 0, syncBad = 0, syncCount = 0, maxBytes = 0, sumBytes = 0;
for (let b = 0; b < BOUTS; b++) {
  const pair = PAIRS[b % PAIRS.length], seed = 1000 + b * 17;
  // the reference: two CPUs, their inputs recorded
  const ref = makeSim();
  ref.setCharacters(pair);
  const inputs = [[], []];
  ref.units.forEach((u, i) => { const ai = thumbs(ref, i, seed * 3 + i); ref.setController(i, 'net', (me, opp, s) => { const v = ai(me, opp, s); inputs[i][ref.tickNo] = v; return v; }); });
  ref.resetMatch({ seed, fresh: true }); ref.roundTime = 30;
  const hashes = [];
  ref.tickNo = 0;
  const texts = [];
  for (let t = 0; t < STEPS; t++) { ref.tickNo = t; ref.tick(); hashes.push(deepHash(ref)); if (process.env.DBG) texts.push(encodeState(ref, ref.saveState())); }
  // the replay with rollbacks
  const rep = makeSim();
  rep.setCharacters(pair);
  let tick = 0;
  rep.units.forEach((u, i) => rep.setController(i, 'net', () => inputs[i][tick] || EMPTY_INPUT));
  rep.resetMatch({ seed, fresh: true }); rep.roundTime = 30;
  const r = mulberry32(seed);
  for (tick = 0; tick < STEPS;) {
    if ((INTERESTING(rep) ? r() < 0.25 : r() < 0.04) && tick < STEPS - 20) {
      const s = rep.saveState(), from = tick, n = 1 + Math.floor(r() * 16);
      for (let k = 0; k < n; k++) { rep.tick(); tick++; }
      rep.loadState(s); tick = from; rbCount++;
      for (let k = 0; k < n; k++) { rep.tick(); rbChecks++; if (deepHash(rep) !== hashes[tick]) { rbBad++; if (process.env.DBG && rbBad < 3) { console.log('restored differs at', tick, 'saved', from, 'n', n); diffJson(JSON.parse(texts[tick]), JSON.parse(encodeState(rep, rep.saveState())), ''); } } tick++; }
      continue;
    }
    rep.tick();
    if (deepHash(rep) !== hashes[tick]) { rbBad++; if (process.env.DBG && rbBad < 3) console.log('plain differs at', tick); }
    tick++;
  }
  // the resync: a second machine with its own history loads the reference's state as text
  const other = makeSim();
  const r2 = mulberry32(seed ^ 0xabcdef);
  const ids = roster().map((c) => c.id);
  const play = makeSim();   // re-runs the reference to the save point
  play.setCharacters(pair);
  let pt = 0;
  play.units.forEach((u, i) => play.setController(i, 'net', () => inputs[i][pt] || EMPTY_INPUT));
  play.resetMatch({ seed, fresh: true }); play.roundTime = 30;
  const points = Array.from({ length: 6 }, () => 200 + Math.floor(r2() * (STEPS - 600))).sort((x, y) => x - y);
  for (const p of points) {
    while (pt < p) { play.tick(); pt++; }
    // the other machine: a demo of its own first (different characters, a bout, so its rigs, reach table and arena differ)
    other.setCharacters([ids[Math.floor(r2() * ids.length)], ids[Math.floor(r2() * ids.length)]]);
    other.setAI(0, 1, { style: 'showcase' }); other.setAI(1, 1, { style: 'showcase' });
    other.resetMatch({ seed: Math.floor(r2() * 1e9) });
    for (let k = 0, n = 500 + Math.floor(r2() * 3000); k < n; k++) other.tick();
    // then the match: the same characters and a fresh start, as online.js does, then the state as text
    other.setCharacters(pair);
    let ot = p;
    other.units.forEach((u, i) => other.setController(i, 'net', () => inputs[i][ot] || EMPTY_INPUT));
    other.resetMatch({ seed: 1, fresh: true }); other.roundTime = 30;
    const text = encodeState(play, play.saveState());
    maxBytes = Math.max(maxBytes, text.length); sumBytes += text.length;
    other.loadState(decodeState(other, text));
    syncCount++;
    if (deepHash(other) !== deepHash(play)) { syncBad++; console.log(`  resync at ${p}: differs right after loading`); }
    const keep = play.saveState(), keepT = pt;
    for (let k = 0; k < 240 && pt < STEPS; k++) {
      play.tick(); pt++; other.tick(); ot++;
      syncChecks++;
      if (deepHash(other) !== deepHash(play)) { syncBad++; if (syncBad < 5) console.log(`  resync at ${p}: differs ${k + 1} steps later`); break; }
    }
    play.loadState(keep); pt = keepT;
  }
  console.log(`bout ${b + 1} ${pair.join(' v ')}: rounds ${ref.wins.join('-')} (match ${ref.phase}), ${rbCount} rollbacks so far, resync points ${points.join(' ')}`);
}
console.log(`\nrollback: ${rbCount} rollbacks, ${rbChecks} restored steps checked, ${rbBad} differed from the reference`);
console.log(`resync: ${syncCount} states sent as text (avg ${(sumBytes / Math.max(1, syncCount) / 1024).toFixed(1)} KB, max ${(maxBytes / 1024).toFixed(1)} KB), ${syncChecks} steps after loading checked, ${syncBad} differed`);
process.exit(rbBad || syncBad ? 1 : 0);
