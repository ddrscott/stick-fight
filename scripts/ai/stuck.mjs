#!/usr/bin/env node
// The CPU never gets stuck (README, Arcade flow, Never stuck): `npm run test:ai:stuck`. Node, no browser.
//   node scripts/ai/stuck.mjs [--secs 30] [--only main,stairs] [--seed 0] [--walk 3] [--stair 4] [--verbose] [--root DIR]
// --seed shifts every bout's seed (another sample); --walk and --stair change the limits in seconds.
// CPU against CPU, and the CPU against a dummy (one standing idle, one holding guard, one walking back and forth
// and jabbing, one pressing forward and jabbing), across the roster, three difficulties and five starts in the building:
//   main      the normal spawns on the main floor
//   well      both by the left stairwell's rail, the CPU with its back to it
//   stairs    the CPU halfway down a flight, the other on the main floor by the head
//   over      the CPU most of the way down the right flight, the other on the main floor right over it (the stairwell)
//   lower     the floor already broken, both on the lower floor
//   split     the CPU downstairs, the other upstairs across the building
// Each runs --secs seconds of fight (no clock, bars that never empty). A stretch is stuck when a CPU
//   walk       holds the stick the same way (forward, or back with or without a guard) for 3 s with no strike,
//              jump, dash or turn, while the two of them can touch (sameLevel), he's up and it isn't fainted (rooted)
//   stairs     stands on a flight's treads for 4 s while he isn't on one (counting the steps it could act in: knocked
//              down, rising, stunned, held or tangled in a botch, or trading blows with him in reach, the clock waits)
// It prints a table (matchup, start, kind, side, how long, the CPU's state and plan when it tripped) and exits 1
// on any. --root runs another checkout's src with this script (a before/after).
import path from 'node:path';
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const here = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const root = path.resolve(opt('--root', here)), SECS = +opt('--secs', 30), SEED = +opt('--seed', 0), VERBOSE = argv.includes('--verbose');
const ONLY = opt('--only', null), ONLY_SET = ONLY ? new Set(ONLY.split(',')) : null;
const { installDom } = await import(root + '/scripts/netsim/env.mjs'); installDom();
const { createFighter, MOVES, MOVE_DATA } = await import(root + '/src/fighter/index.js');
const { createArena } = await import(root + '/src/arena/index.js');
const { createCombat } = await import(root + '/src/combat/sim.js');
const { EMPTY_INPUT } = await import(root + '/src/combat/input.js');
const { FRAME_DATA } = await import(root + '/src/combat/frameData.js');
await import(root + '/src/characters/index.js');

const HZ = 120, WALK_LIMIT = +opt("--walk", 3) * HZ, STAIR_LIMIT = +opt("--stair", 4) * HZ;
const STARTS = ['main', 'well', 'stairs', 'over', 'lower', 'split'];
// every character at least twice as the CPU, the ladder styles included (char.ai.style)
const PAIRS = [['temp', 'temp'], ['intern', 'helpdesk'], ['courier', 'security'], ['janitor', 'manager'], ['accountant', 'windowWasher'],
  ['hrRep', 'salesRep'], ['barista', 'chef'], ['wellness', 'electrician'], ['receptionist', 'lawyer'], ['ceo', 'temp'],
  ['helpdesk', 'intern'], ['security', 'courier'], ['manager', 'janitor'], ['windowWasher', 'accountant'], ['salesRep', 'hrRep'],
  ['chef', 'barista'], ['electrician', 'wellness'], ['lawyer', 'receptionist'], ['temp', 'ceo']];
const DIFFS = [0.2, 0.55, 0.9];
// the dummies (P2 when it isn't a CPU)
const DUMMIES = {
  idle: () => () => ({ ...EMPTY_INPUT }),
  guard: () => (me, o) => ({ ...EMPTY_INPUT, dx: -(Math.sign(o.x - me.x) || 1), block: true }),
  // a human pressing forward: walks in, jabs in reach, now and then a kick
  presser: () => { let t = 0; return (me, o) => { t++; const toward = Math.sign(o.x - me.x) || 1, d = Math.abs(o.x - me.x); return { ...EMPTY_INPUT, dx: d > 70 ? toward : 0, lp: d < 110 && t % 36 === 0, lk: d < 120 && t % 97 === 0 }; }; },
  pacer: () => { let t = 0; return (me, o) => { t++; const toward = Math.sign(o.x - me.x) || 1, ph = Math.floor(t / 150) % 4; return { ...EMPTY_INPUT, dx: ph === 0 ? toward : ph === 2 ? -toward : 0, lp: ph === 1 && t % 40 === 0 }; }; },
};

function build(pair, seed) {
  const arena = createArena('building'), sp = arena.spawns;
  const fighters = [createFighter({ x: sp[0].x, y: sp[0].y, facing: 1 }), createFighter({ x: sp[1].x, y: sp[1].y, facing: -1 })];
  let sim; const makeRig = (c) => { const g = sim.units[0]; return createFighter({ color: c, x: g.x, y: g.y, facing: -1 }); };
  sim = createCombat({ fighters, arena, input: { snapshot: () => EMPTY_INPUT }, onEvent() {}, makeRig, moves: MOVES, moveData: MOVE_DATA });
  sim.setCharacters(pair);
  sim.setAI(0, 0.5); sim.setAI(1, 0.5);
  sim.roundTime = 0; sim.resetMatch({ seed, startHealth: 100, skipIntro: true, fresh: true });
  sim.roundTime = 0; sim.timer = 0;
  return sim;
}
// put unit i on flight k at x (k -1 the main floor, -2 the lower one), as the stair-test scene does
function put(sim, i, k, x, facing) {
  const u = sim.units[i];
  u.x = x; u.facing = facing; u.rig.x = x; u.rig.facing = facing; u.vx = 0;
  if (k >= 0) { u.stair = k; u.y = sim.stairY(k, x); u.floor = u.y < (sim.floors[0].y + sim.floors[1].y) / 2 ? 0 : 1; }
  else { u.stair = -1; u.floor = -k - 1; u.y = sim.floors[u.floor].y; }
  u.rig.y = u.y; u.grounded = true; u.rig.update(0); sim.rigUpd(u, 0);
}
function setStart(sim, start) {
  const S = sim.stairs, wells = sim.stairwells, L = S[0];
  const along = (k, a) => S[k].head + S[k].dir * a;
  if (start === 'well') { const w = wells[0]; put(sim, 0, -1, w.x1 + 60, 1); put(sim, 1, -1, w.x1 + 200, -1); }
  if (start === 'stairs') { put(sim, 0, 0, along(0, 200), -1); put(sim, 1, -1, L.head - 160, 1); }
  if (start === 'over') { put(sim, 0, 1, along(1, 300), 1); put(sim, 1, -1, along(1, 170), -1); }
  if (start === 'lower') { sim.floorBroken = true; sim.floor = 1; if (sim.refreshBounds) sim.refreshBounds(); const m = (S[0].foot + S[1].foot) / 2; put(sim, 0, -2, m - 200, 1); put(sim, 1, -2, m + 200, -1); }
  if (start === 'split') { put(sim, 0, -2, S[0].foot + 120, 1); put(sim, 1, -1, S[1].head + 300, -1); }
}

const where = (u) => `x${Math.round(u.x)} f${u.floor || 0}${u.stair >= 0 ? ' st' + u.stair : ''}`;
const snap = (w, me, opp) => `${me.state} ${where(me)} vs ${opp.state} ${where(opp)} ${JSON.stringify(w.ai.debug ? w.ai.debug() : {})}`;
// one bout: returns the stuck stretches
function bout({ pair, start, d0, p2, seed }) {
  const sim = build(pair, seed);
  setStart(sim, start);
  const watch = [], found = [];
  const wrap = (i, ai) => {
    const w = { i, ai, dir: 0, since: 0, last: null, stairSince: -1, tripped: { walk: false, stairs: false } };
    const f = (me, opp, s) => { const out = ai(me, opp, s); w.last = out; return out; };
    f.getDifficulty = ai.getDifficulty; f.setDifficulty = ai.setDifficulty; f.style = ai.style; f.debug = ai.debug;
    sim.setController(i, 'ai', f); watch.push(w);
  };
  wrap(0, sim.setAI(0, d0));
  if (p2 === 'cpu') wrap(1, sim.setAI(1, d0));
  else sim.setController(1, 'script', DUMMIES[p2]());
  const FREE = /^(idle|walk|run|block|crouch|blockstun)$/, ACTS = /^(idle|walk|run|block|crouch|blockstun|attack|jump|landing|dash)$/;
  for (let t = 0; t < SECS * HZ; t++) {
    for (const w of watch) w.last = null;
    sim.tick();
    // real bars, so losing, leading and breathing room all come up, topped back up before a KO ends the bout
    for (const u of sim.units) if (u.health < 25) for (const v of sim.units) v.health = Math.min(v.maxHealth || 100, v.health + 45);
    if (sim.phase !== 'fight') continue;
    for (const w of watch) {
      const me = sim.units[w.i], opp = sim.units[1 - w.i], out = w.last || EMPTY_INPUT;
      const step = sim.stepCount;
      // walk: the stick held one way, no strike, jump, dash or turn
      const pressed = out.lp || out.rp || out.lk || out.rk || out.jump || out.dash || Object.keys(out).some((k) => FRAME_DATA[k] && out[k]);
      const can = sim.sameLevel(me, opp) && FREE.test(me.state) && me.grounded && !(me.faint > 0) && !/^(knockdown|down|getup|ko|grabbed)$/.test(opp.state) && !opp.hidden;
      const dx = out.dx ? Math.sign(out.dx) : 0;
      if (!can || pressed || me.state === 'attack' || (dx && dx !== w.dir && w.dir)) { if (w.tripped.walk) w.tripped.walk.to = step; w.dir = dx; w.since = step; w.tripped.walk = false; }
      else if (dx && !w.dir) { w.dir = dx; w.since = step; }
      if (w.dir && !w.tripped.walk && step - w.since > WALK_LIMIT) {
        const fwd = w.dir === Math.sign(opp.x - me.x);
        found.push(w.tripped.walk = { kind: fwd ? 'walk-fwd' : out.block ? 'backpedal-block' : 'walk-back', w, at: step, from: w.since, snap: snap(w, me, opp) });
      }
      // stairs: on the treads 4 s while he isn't; the clock waits while I can't act (knocked down, rising, stunned,
      // held, tangled in a botch): that's being beaten on the stairs, not standing on them
      // and while the two trade blows in reach (he stands at the head of the flight swinging at me on the top steps)
      const NEUTRAL = /^(idle|walk|run|crouch)$/, trading = Math.abs(opp.x - me.x) < 150 && !(NEUTRAL.test(me.state) && NEUTRAL.test(opp.state));
      STAIRS.cpu++;
      if (sim.onStair(me) && !sim.onStair(opp) && !opp.hidden) { STAIRS.on++; if (w.stairSince < 0) { w.stairSince = step; w.stairT = 0; } if (ACTS.test(me.state) && !trading) w.stairT++; if (step - w.stairSince > STAIRS.longest) { STAIRS.longest = step - w.stairSince; STAIRS.at = `${pair.join(' v ')} ${p2} @${d0} ${start}`; } }
      else { if (w.tripped.stairs) w.tripped.stairs.to = step; w.stairSince = -1; w.tripped.stairs = false; }
      if (w.stairSince >= 0 && !w.tripped.stairs && w.stairT > STAIR_LIMIT) {
        found.push(w.tripped.stairs = { kind: 'stairs', w, at: step, from: w.stairSince, snap: snap(w, me, opp) });
      }
    }
  }
  for (const w of watch) { const t = w.ai.debug && w.ai.debug().tally; if (t) for (const k in t) TALLY[k] = (TALLY[k] || 0) + t[k]; }
  // how long each lasted: until it broke, or the end of the bout ('+')
  return found.map((f) => ({
    kind: f.kind, side: f.w.i, start: (f.from / HZ).toFixed(1),
    secs: ((f.to || sim.stepCount) - f.from) / HZ, open: !f.to, detail: f.snap,
  }));
}

const rows = [], TALLY = {}, STAIRS = { cpu: 0, on: 0, longest: 0 };
let bouts = 0;
const t0 = Date.now();
for (const start of STARTS) {
  if (ONLY_SET && !ONLY_SET.has(start)) continue;
  PAIRS.forEach((pair, n) => {
    for (const d of DIFFS) {
      // every pair against its partner as a CPU; the dummies take turns down the list so each sees every start
      for (const p2 of ['cpu', ['idle', 'guard', 'presser', 'pacer'][(n + DIFFS.indexOf(d)) % 4]]) {
        const seed = 7 + n * 13 + DIFFS.indexOf(d) + SEED * 1000;
        const res = bout({ pair, start, d0: d, p2, seed });
        bouts++;
        for (const r of res) rows.push({ match: `${pair[0]} v ${pair[1]}${p2 === 'cpu' ? '' : ' (' + p2 + ')'} @${d}`, startAt: start, ...r });
      }
    }
  });
}
const pad = (s, n) => String(s).padEnd(n);
console.log(`// AI_STUCK  ${bouts} bouts, ${SECS} s each, ${((Date.now() - t0) / 1000).toFixed(0)} s wall`);
// the fixes at work and the last resort (ai.js think.debug().tally; a checkout without them prints nothing here)
console.log(`   on a flight's treads with him off them: ${(100 * STAIRS.on / STAIRS.cpu).toFixed(1)}% of CPU time, longest stint ${(STAIRS.longest / HZ).toFixed(1)} s (wall clock, nothing paused: ${STAIRS.at || '-'})`);
if (Object.keys(TALLY).length) console.log(`   chase ran him down ${TALLY.chaseRuns}, chase gave up ${TALLY.chaseDrops}, stepped off the stairs ${TALLY.stepOffs}; last resort: walk ${TALLY.breaks}, stairs ${TALLY.stairBreaks}`);
if (rows.length) {
  console.log(pad('matchup', 44) + pad('start', 8) + pad('kind', 17) + pad('cpu', 5) + pad('from', 8) + 'lasted');
  for (const r of rows) console.log(pad(r.match, 44) + pad(r.startAt, 8) + pad(r.kind, 17) + pad('P' + (r.side + 1), 5) + pad(r.start + 's', 8) + r.secs.toFixed(1) + 's' + (r.open ? '+' : '') + (VERBOSE ? '  ' + r.detail : ''));
  const by = {}; for (const r of rows) by[r.kind] = (by[r.kind] || 0) + 1;
  console.log(`FAIL  ${rows.length} stuck stretches: ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  process.exit(1);
}
console.log('PASS  no stuck stretches');
