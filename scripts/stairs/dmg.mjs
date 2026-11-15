// Stairs hurt (README, Stairs hurt): `npm run test:stairs:dmg`. Headless, the sim on the raw source, ~5 s.
//
//   1. a floor break by a throw beside a flight's head: the body clatters down the treads, STAIR_DMG per tread,
//      on top of the throw and the landing; the DOWN THE STAIRS line carries the total
//   2. a knockdown on a flight: only the treads the body really touches count (0 to a few, it mostly flies)
//   3. walking down and up a flight, and running down it, costs nothing
//   4. one tread counts once: no tread pays twice in a tumble, and a body lying on a step pays nothing more
//   5. a tumble can KO: the round goes to whoever sent the body down
//   6. it's the same for both sides (mirrored on the other flight) and for a horde goon
//   7. deterministic: the same inputs give the same log, and a rollback (save, run, load, run) replays it exactly
//
// It also prints the treads and damage per case, the numbers README quotes.
import { installDom } from '../netsim/env.mjs';
installDom();
const R = '../../src/';
const { createFighter, MOVES, MOVE_DATA } = await import(R + 'fighter/index.js');
const { createArena } = await import(R + 'arena/index.js');
const { createCombat } = await import(R + 'combat/sim.js');
const { EMPTY_INPUT } = await import(R + 'combat/input.js');
await import(R + 'characters/index.js');

const STAIR_DMG = 5;
const fails = [];
const ok = (name, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); if (!pass) fails.push(name); };

// a fresh sim on the building; P1 (or P2, `who`) presses `seq` (step:keys,...), the other stands; each body placed
// `along` px from flight `fl`'s head (down the flight positive), on the flight (`onFl`) or on the floor above
function run({ fl = 0, a1, a2, on1 = false, on2 = false, seq = '', who = 0, hp2 = null, steps = 900, horde = null, ctl = null, rollback = null }) {
  const arena = createArena('building'), sp = arena.spawns;
  const fighters = [createFighter({ x: sp[0].x, y: sp[0].y, facing: 1 }), createFighter({ x: sp[1].x, y: sp[1].y, facing: -1 })];
  const events = [];
  const sim = createCombat({ fighters, arena, input: { snapshot: () => EMPTY_INPUT }, onEvent(e) { if (e.type === 'stairHit' || e.type === 'tread') events.push({ type: e.type, unit: e.unit.id, y: e.y, dmg: e.dmg, strength: e.strength }); }, makeRig: null, moves: MOVES, moveData: MOVE_DATA });
  sim.resetMatch({ seed: 7, skipIntro: true, horde });
  const st = sim.stairs[fl], X = (al) => st.head + st.dir * al;
  const presses = {};
  for (const p of seq ? seq.split(',') : []) { const [t, keys] = p.split(':'); presses[t] = {}; for (const kk of keys.split('+')) presses[t][kk] = true; }
  let t = -1;
  const att = who, def = 1 - who;
  sim.setController(att, 's', () => ({ ...EMPTY_INPUT, ...(presses[t] || {}) }));
  sim.setController(def, ctl ? 's' : 'none', ctl ? () => ({ ...EMPTY_INPUT, ...ctl(t, sim.units[def], sim) }) : undefined);
  for (let i = 0; i < 60; i++) sim.tick();
  const place = (i, onFl, al, f) => {
    const u = sim.units[i], x = X(al);
    u.x = x; u.facing = f; u.rig.x = x; u.rig.facing = f;
    if (onFl) { u.stair = fl; u.y = sim.stairY(fl, x); } else { u.stair = -1; u.y = sim.floors[0].y; }
    u.floor = 0; u.rig.y = u.y; u.rig.update(0); sim.rigUpd(u, 0);
  };
  // the attacker uphill of the defender, facing down the flight
  place(att, att === 0 ? on1 : on2, att === 0 ? a1 : a2, st.dir);
  place(def, def === 0 ? on1 : on2, def === 0 ? a1 : a2, -st.dir);
  if (hp2 != null) sim.units[def].health = hp2;
  const h0 = sim.units[def].health;
  let snap = null;
  for (t = 0; t < steps; t++) {
    if (rollback && t === rollback.save) snap = sim.saveState();
    sim.tick();
    if (rollback && snap && t === rollback.load) { sim.loadState(snap); t = rollback.save; rollback = null; }
  }
  const log = sim.log.filter((r) => r.type === 'stairHit' || r.type === 'floorBreak' || r.type === 'floorLand' || r.type === 'callout');
  const hits = log.filter((r) => r.type === 'stairHit' && r.def === def);
  const line = log.find((r) => r.type === 'callout' && r.kind === 'stairs');
  return { sim, def: sim.units[def], att: sim.units[att], h0, hits, line, log, events, stairDmg: hits.reduce((a, r) => a + r.dmg, 0) };
}
const desc = (r) => `hp ${r.h0}->${r.def.health}, ${r.hits.length} treads, -${r.stairDmg}${r.line ? `, "${r.line.text}"` : ''}`;
const eachDmg = (r) => r.hits.every((h) => h.dmg === STAIR_DMG);
const lineMatches = (r) => !r.hits.length ? !r.line : !!r.line && r.line.text === `DOWN THE STAIRS -${r.stairDmg}`;
// no tread twice: the y of each paid tread goes down the flight (larger y) strictly
const oncePerTread = (r) => r.hits.every((h, i) => i === 0 || h.y > r.hits[i - 1].y);

// 1. floor breaks beside the head (a throw, from two spots, and a roundhouse)
const breaks = [
  run({ a1: -50, a2: 20, seq: '10:lp+lk' }),
  run({ a1: -70, a2: 0, seq: '10:lp+lk' }),
  run({ a1: -70, a2: 0, seq: '10:rk' }),
];
for (const [i, r] of breaks.entries()) {
  const fell = r.log.some((x) => x.type === 'floorBreak');
  ok(`floor break ${i + 1}: the body goes down the treads, ${STAIR_DMG} each`, fell && r.hits.length >= 3 && eachDmg(r), desc(r));
  ok(`floor break ${i + 1}: DOWN THE STAIRS carries the total, credited to P1`, lineMatches(r) && r.line.by === 0 && r.hits.every((h) => h.by === 0), r.line ? `${r.line.text} by ${r.line.by}` : 'no line');
  ok(`floor break ${i + 1}: a flight costs 15-30 on top of the landing`, r.stairDmg >= 15 && r.stairDmg <= 30, `-${r.stairDmg}`);
  ok(`floor break ${i + 1}: each paid step knocks harder than the last`, r.events.filter((e) => e.type === 'tread').every((e, j, a) => j === 0 || e.strength > a[j - 1].strength));
}

// 2. knockdowns on a flight: some touch a tread or two, some fly clear (README: the physics decides)
const knocks = [
  run({ a1: -10, a2: 60, on1: true, on2: true, seq: '10:rk' }),
  run({ a1: -10, a2: 60, on1: true, on2: true, seq: '10:lp+lk' }),
  run({ a1: 30, a2: 100, on1: true, on2: true, seq: '10:rp,32:lp,50:rk' }),
];
for (const [i, r] of knocks.entries()) ok(`knockdown on the flight ${i + 1}: ${STAIR_DMG} per tread touched, the line matches`, eachDmg(r) && lineMatches(r) && r.hits.length <= 4, desc(r));
ok('knockdowns on the flight: at least one pays for a step', knocks.some((r) => r.hits.length >= 1));

// 3. walking and running on the flights cost nothing
const walkDown = run({ a1: -400, a2: -10, ctl: (t, _u, sim) => (t < 30 ? { dx: sim.stairs[0].dir, down: true } : t < 500 ? { dx: sim.stairs[0].dir } : {}), steps: 600 });
ok('walk down a flight: nothing paid', walkDown.hits.length === 0 && walkDown.def.health === walkDown.h0 && walkDown.def.floor === 1, `floor ${walkDown.def.floor}, ${desc(walkDown)}`);
const walkUp = run({ a1: -400, a2: 330, on2: true, ctl: (t, _u, sim) => (t < 500 ? { dx: -sim.stairs[0].dir } : {}), steps: 600 });
ok('walk up a flight: nothing paid', walkUp.hits.length === 0 && walkUp.def.health === walkUp.h0 && walkUp.def.stair < 0 && walkUp.def.floor === 0, `floor ${walkUp.def.floor}, ${desc(walkUp)}`);
const runDown = run({ a1: -400, a2: -10, ctl: (t, _u, sim) => { const d = sim.stairs[0].dir; return t < 30 ? { dx: d, down: true } : t === 34 || t === 40 ? {} : { dx: d }; }, steps: 600 });
ok('run down a flight: nothing paid', runDown.hits.length === 0 && runDown.def.health === runDown.h0 && runDown.def.floor === 1, `floor ${runDown.def.floor}, ${desc(runDown)}`);

// 4. one tread, once
const all = [...breaks, ...knocks];
ok('no tread pays twice in a tumble', all.every(oncePerTread), all.map((r) => r.hits.map((h) => h.y).join('/')).join(' '));
const rest = run({ a1: -10, a2: 60, on1: true, on2: true, seq: '10:rk', steps: 2400 });
const lastHit = rest.hits.length ? rest.hits[rest.hits.length - 1].step : -1, lastStep = rest.sim.stepCount;
ok('a body on a step pays once, then nothing while it lies and rises (20 s)', rest.hits.length === knocks[0].hits.length && lastStep - lastHit > 1500, `${rest.hits.length} paid, last at step ${lastHit} of ${lastStep}`);

// 5. a KO by the steps, credited to the sender
const ko = run({ a1: -50, a2: 20, seq: '10:lp+lk', hp2: 20, steps: 400 });
ok('a tumble KOs: the round goes to P1', ko.def.health === 0 && ko.sim.winner === 0 && ko.hits.length >= 1 && ko.hits[ko.hits.length - 1].hp === 0, `hp ${ko.def.health}, winner ${ko.sim.winner}, ${ko.hits.map((h) => h.hp).join('/')}`);

// 6. both sides, and a horde goon
const mirror = run({ fl: 1, a1: 20, a2: -50, seq: '10:lp+lk', who: 1 });
ok('P2 throws P1 down the other flight: the same treads and damage', mirror.hits.length === breaks[0].hits.length && mirror.stairDmg === breaks[0].stairDmg && mirror.hits.every((h) => h.by === 1), `${desc(mirror)} vs ${desc(breaks[0])}`);
// (horde has no floor breaks: the goon is knocked down on the flight, like knockdown 2)
const goon = run({ a1: -10, a2: 60, on1: true, on2: true, seq: '10:lp+lk', horde: { goonHealth: 100, goonDifficulty: 0, heal: 0 } });
ok('horde: a goon knocked down the flight pays the same', goon.hits.length === knocks[1].hits.length && goon.stairDmg === knocks[1].stairDmg && goon.hits.every((h) => h.by === 0), `${desc(goon)} vs ${desc(knocks[1])}`);
const goonKO = run({ a1: -10, a2: 60, on1: true, on2: true, seq: '10:lp+lk', horde: { goonHealth: 16, goonDifficulty: 0, heal: 0 } });
ok('horde: the steps put a goon down, counted for the hero', goonKO.sim.log.some((r) => r.type === 'goonDown' && r.att === 0 && r.how === 'stairs'), goonKO.sim.log.filter((r) => r.type === 'goonDown').map((r) => `${r.att}:${r.how}`).join(' ') || 'no goonDown');

// 7. determinism and rollback
const again = run({ a1: -50, a2: 20, seq: '10:lp+lk' });
const key = (r) => JSON.stringify(r.sim.log.map((x) => ({ ...x }))) + r.def.health;
ok('the same inputs give the same log', key(again) === key(breaks[0]));
const rb = run({ a1: -50, a2: 20, seq: '10:lp+lk', rollback: { save: 220, load: 240 } });
ok('a rollback in mid-tumble replays it exactly', JSON.stringify(rb.hits.map(({ step, ...h }) => h)) === JSON.stringify(breaks[0].hits.map(({ step, ...h }) => h)) && rb.def.health === breaks[0].def.health, `${desc(rb)} vs ${desc(breaks[0])}`);

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
process.exit(fails.length ? 1 : 0);
