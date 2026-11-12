#!/usr/bin/env node
// Daily shifts (README, Progression, Daily shifts): `npm run test:shifts`. Node, no browser, no Worker.
//   - the date seed: the same three for everyone on a day (and the same on every call), different days differ, never
//     two shifts that each need their own mode, every kind shows up over a year, and a swap is the same for everyone
//   - completion: each kind counts only its own stat, "in one match" kinds take the best match, results add up,
//     a match cut short / training / the dummy count nothing, a finished shift pays once, the day rolls over
//   - swap: one a day, never a finished one, its progress starts over; a forged state is cleaned
//   - the sign-in merge: the larger progress, done on either side stays done, never paid twice
//   - mashing completes nothing: no shift reads anything but STATS (checked with a Proxy), a summary with 999 hits and
//     5,000 presses moves nothing, and the real sim with a masher at the controls (every fighter, two CPU levels,
//     through the real books) finishes no shift of any kind, alone or summed over all of them. Then a CPU playing P1
//     the same matches does finish technique shifts, so the bar is reachable.
import { shiftsFor, cleanShifts, advanceShifts, swapShift, mergeShifts, payMatch, matchCounts, KINDS, STATS, SHIFT_FIGHTERS, SHIFT_PAY, blankShifts } from '../../src/career/shifts.js';
import { blankCareer, applyAward, PAY } from '../../src/career/rules.js';
import { createBook } from '../../src/bookkeeping.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const D1 = '2026-11-12', D2 = '2026-11-13';
const m = (o) => ({ mode: 'arcade', won: false, cut: false, fought: 60, parries: 0, punishes: 0, enders: 0, accidents: 0, perfects: 0, floors: 0, fighter: 'temp', rounds: 0, stage: 1, ...o });
const ids = (l) => l.map((s) => s.id).join(',');
const days = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10));

// every shift that can exist: each kind at each target, the fighter one for every fighter
const ALL = [];
for (const k of KINDS) for (const n of k.ns) {
  if (k.kind === 'fighter') for (const f of Object.keys(SHIFT_FIGHTERS)) ALL.push({ ...shiftLike(k, n, f) });
  else ALL.push(shiftLike(k, n));
}
function shiftLike(k, n, f) { return { id: f ? `${k.kind}:${f}` : `${k.kind}:${n}`, kind: k.kind, n, f, stat: k.stat, how: k.how, title: k.title(n, f) }; }

// ---- the date seed ------------------------------------------------------------------------------------------------
{
  const a = shiftsFor(D1), b = shiftsFor(D1);
  ok('a day has three shifts', a.length === 3, ids(a));
  ok('the same day gives the same three, call after call', ids(a) === ids(b));
  // a fresh module instance (another player's page, the Worker) gets the same: no state outside the date
  const fresh = await import(`../../src/career/shifts.js?again=${Date.now()}`);
  ok('a fresh copy of the module picks the same three (the date is the only input)', ids(fresh.shiftsFor(D1)) === ids(a));
  ok('the next day differs', ids(shiftsFor(D2)) !== ids(a), `${ids(a)} / ${ids(shiftsFor(D2))}`);
  const distinct = new Set(days.map((d) => ids(shiftsFor(d))));
  ok('a year of days: almost every day is its own set', distinct.size > 300, `${distinct.size} distinct of 365`);
  let twoModes = 0, dupKinds = 0;
  const seenKinds = new Set(), seenFighters = new Set();
  for (const d of days) for (const sw of [-1, 0, 1, 2]) {
    const l = shiftsFor(d, sw);
    if (l.filter((s) => s.mode).length > 1) twoModes++;
    if (new Set(l.map((s) => s.kind)).size !== 3) dupKinds++;
    for (const s of l) { seenKinds.add(s.kind); if (s.f) seenFighters.add(s.f); }
  }
  ok('never two shifts that each need their own mode (arcade, horde, online), swapped or not', twoModes === 0, `${twoModes}`);
  ok('never the same kind twice in a day', dupKinds === 0);
  ok('every kind shows up over a year', seenKinds.size === KINDS.length, [...seenKinds].join(' '));
  ok('most fighters get a day', seenFighters.size >= 14, `${seenFighters.size} of ${Object.keys(SHIFT_FIGHTERS).length}`);
  const tech = days.flatMap((d) => shiftsFor(d)).filter((s) => s.mechanic).length / (days.length * 3);
  ok('most shifts teach a mechanic (they name it and link a guide page)', tech > 0.8, `${Math.round(tech * 100)}%`);
  ok('every shift with a mechanic links a page', days.flatMap((d) => shiftsFor(d)).every((s) => !s.mechanic || /^(how-to-play\/|fighters\/[a-zA-Z]+\/$)/.test(s.guide)));
  for (let sw = 0; sw < 3; sw++) {
    const l = shiftsFor(D1, sw);
    ok(`swapping slot ${sw}: the other two stay, the slot gets one not showing, the same for everyone`, l.every((s, i) => i === sw || s.id === a[i].id) && !a.some((s) => s.id === l[sw].id) && ids(fresh.shiftsFor(D1, sw)) === ids(l), ids(l));
  }
  ok('the words are plain: no glow is a CSS matter, but no title runs past 40 characters', days.flatMap((d) => shiftsFor(d)).every((s) => s.title.length <= 40), days.flatMap((d) => shiftsFor(d)).map((s) => s.title).sort((x, y) => y.length - x.length)[0]);
}

// ---- completion -----------------------------------------------------------------------------------------------------
{
  const pick = (kind, n, f) => ALL.find((s) => s.kind === kind && s.n === n && (!f || s.f === f));
  ok('a parry shift counts parries and nothing else', matchCounts(pick('parry', 2), m({ parries: 2, punishes: 9, enders: 9 })) === 2 && matchCounts(pick('parry', 2), m({ punishes: 9 })) === 0);
  ok('a fighter shift counts rounds won with that fighter only', matchCounts(pick('fighter', 1, 'barista'), m({ fighter: 'barista', rounds: 2 })) === 2 && matchCounts(pick('fighter', 1, 'barista'), m({ fighter: 'chef', rounds: 2 })) === 0);
  ok('an arcade shift needs the stage won', matchCounts(pick('arcade', 3), m({ stage: 3, won: true })) === 3 && matchCounts(pick('arcade', 3), m({ stage: 3, won: false })) === 0 && matchCounts(pick('arcade', 3), m({ mode: 'quick', stage: 3, won: true })) === 0);
  ok('a horde shift counts floors in horde only', matchCounts(pick('horde', 3), m({ mode: 'horde', floors: 4 })) === 4 && matchCounts(pick('horde', 3), m({ floors: 4 })) === 0);
  ok('the online shift counts quick and crew matches, win or lose', matchCounts(pick('online', 1), m({ mode: 'quick' })) === 1 && matchCounts(pick('online', 1), m({ mode: 'crew' })) === 1 && matchCounts(pick('online', 1), m({})) === 0);
  for (const bad of [{ cut: true, parries: 9, rounds: 2, won: true, stage: 6 }, { mode: 'training', parries: 9, rounds: 2 }, { mode: 'dummy', parries: 9 }, { mode: '', parries: 9 }]) {
    ok(`${bad.cut ? 'a match cut short' : bad.mode || 'no mode'} counts for no shift`, ALL.every((s) => matchCounts(s, m(bad)) === 0));
  }

  // a whole day through payMatch: find a day whose shifts are a parry, a punish and something else, then play it
  const day = days.find((d) => { const k = shiftsFor(d).map((s) => s.kind); return k.includes('parry') && k.includes('punish'); });
  const list = shiftsFor(day), pi = list.findIndex((s) => s.kind === 'parry'), ui = list.findIndex((s) => s.kind === 'punish');
  let c = { ...blankCareer(), winDay: day, onlineDay: day };
  const play = (o) => { const a = payMatch(m(o), c, day); c = applyAward(c, a, day); return a; };
  let a = play({ parries: 1 });
  ok('one parry in a match: the shift ticks to 1, nothing paid for it yet', c.shifts.prog[pi] === 1 && !c.shifts.done[pi] && a.moved[pi] && !a.lines.some((l) => l.id === 'shift'));
  a = play({ parries: 1 });
  ok('"in one match": another match with one parry doesn\'t add up to two', c.shifts.prog[pi] === 1 && !c.shifts.done[pi] && !a.moved[pi]);
  const before = c.sticks;
  a = play({ parries: list[pi].n });
  const sh = a.lines.find((l) => l.id === 'shift');
  ok(`${list[pi].n} parries in one match finish it: SHIFT DONE pays ${SHIFT_PAY.sticks} sticks and ${SHIFT_PAY.xp} XP on top`, c.shifts.done[pi] && sh && sh.sticks === SHIFT_PAY.sticks && sh.xp === SHIFT_PAY.xp && c.sticks - before === PAY.base.sticks + list[pi].n * PAY.parries.sticks + SHIFT_PAY.sticks, sh && sh.label);
  a = play({ parries: 9 });
  ok('a finished shift never pays again', !a.lines.some((l) => l.id === 'shift') && !a.moved[pi]);
  a = play({ punishes: list[ui].n - 1 });
  ok('one short of the punish target: no pay', !c.shifts.done[ui]);
  a = play({ punishes: list[ui].n, parries: 9 });
  ok('then the target in one match: done, and only that one pays', c.shifts.done[ui] && a.lines.filter((l) => l.id === 'shift').length === 1);
  const tomorrow = payMatch(m({ parries: 9 }), c, days[days.indexOf(day) + 1]);
  ok('the next day starts fresh: yesterday\'s state is dropped, nothing carries over (no streak, no penalty)', tomorrow.shifts.day === days[days.indexOf(day) + 1] && tomorrow.shifts.swap === -1 && cleanShifts(c.shifts, days[days.indexOf(day) + 1]).prog.every((p) => p === 0));
  // an "add" shift: rounds with a fighter add up over the day
  const fday = days.find((d) => shiftsFor(d).some((s) => s.kind === 'fighter'));
  const fs = shiftsFor(fday).find((s) => s.kind === 'fighter'), fi = shiftsFor(fday).indexOf(fs);
  const r1 = advanceShifts(blankShifts(fday), m({ fighter: fs.f, rounds: 1 }), fday);
  ok(`"${fs.title}": a round won with them finishes it`, r1.state.done[fi] && r1.finished.length === 1);
  const r0 = advanceShifts(blankShifts(fday), m({ fighter: fs.f === 'temp' ? 'chef' : 'temp', rounds: 2, won: true }), fday);
  ok('rounds won with someone else don\'t', !r0.state.done[fi]);
}

// ---- swap, and forged states ----------------------------------------------------------------------------------------
{
  const s0 = cleanShifts(null, D1);
  const sw = swapShift({ ...s0, prog: [1, 0, 0] }, 0, D1);
  ok('a swap: slot 0 is a new shift with its progress back at 0', !sw.error && sw.state.swap === 0 && sw.state.prog[0] === 0 && shiftsFor(D1, 0)[0].id !== shiftsFor(D1)[0].id);
  ok('only one swap a day', swapShift(sw.state, 1, D1).error === 'used');
  const done = { ...s0, done: [false, true, false], prog: [0, shiftsFor(D1)[1].n, 0] };
  ok('a finished shift can\'t be swapped', swapShift(done, 1, D1).error === 'done');
  ok('a slot that doesn\'t exist can\'t be swapped', swapShift(s0, 3, D1).error === 'bad' && swapShift(s0, -1, D1).error === 'bad' && swapShift(s0, 0.5, D1).error === 'bad');
  ok('tomorrow the swap is back', !swapShift(sw.state, 1, D2).error);
  const forged = cleanShifts({ day: D1, swap: 7, prog: [999, -4, 'x'], done: 'yes' }, D1);
  ok('a forged state is cleaned: progress held to each target, a bad swap dropped, done only where it\'s reached', forged.swap === -1 && forged.prog[0] === shiftsFor(D1)[0].n && forged.prog[1] === 0 && forged.prog[2] === 0 && forged.done[0] && !forged.done[1]);
  ok('a state from another day reads as fresh', JSON.stringify(cleanShifts({ day: D2, swap: 1, prog: [1, 1, 1], done: [true, true, true] }, D1)) === JSON.stringify(blankShifts(D1)));
}

// ---- the sign-in merge ----------------------------------------------------------------------------------------------
{
  const l = shiftsFor(D1);
  const acct = { day: D1, swap: -1, prog: [1, 0, 0], done: [false, false, false] };
  const guest = { day: D1, swap: -1, prog: [0, l[1].n, 0], done: [false, true, false] };
  const mg = mergeShifts(acct, guest, D1);
  ok('the merge keeps the larger progress, and done on either side is done', mg.prog[0] === 1 && mg.done[1] && mg.prog[1] === l[1].n);
  ok('merging the same guest twice changes nothing', JSON.stringify(mergeShifts(mg, guest, D1)) === JSON.stringify(mg));
  const gSwap = { day: D1, swap: 2, prog: [0, 0, 1], done: [false, false, false] };
  const m2 = mergeShifts(acct, gSwap, D1);
  ok('a guest\'s swap carries over when the account hasn\'t swapped, with its progress', m2.swap === 2 && m2.prog[2] === Math.min(1, shiftsFor(D1, 2)[2].n) && m2.prog[0] === 1);
  const aSwap = { day: D1, swap: 0, prog: [0, 0, 0], done: [false, false, false] };
  ok('an account\'s own swap stands', mergeShifts(aSwap, gSwap, D1).swap === 0);
  ok('a guest\'s state from yesterday adds nothing', JSON.stringify(mergeShifts(acct, { ...guest, day: '2026-11-11' }, D1)) === JSON.stringify(cleanShifts(acct, D1)));
  // a shift the guest finished was paid in the guest's sticks; after the merge the account sees it done and won't pay it again
  const c = { ...blankCareer(), shifts: mg };
  const again = payMatch(m({ parries: 9, punishes: 9, enders: 9, rounds: 2, won: true, stage: 6, fighter: l[1].f || 'temp', floors: 9 }), c, D1);
  ok('a shift done before the merge isn\'t paid again after it', !again.lines.some((x) => x.id === 'shift' && x.label.endsWith(l[1].title)));
}

// ---- mashing completes nothing --------------------------------------------------------------------------------------
{
  // what a shift may read: a Proxy over the match records every field touched, for every shift that can exist
  const touched = new Set();
  const spy = (o) => new Proxy(o, { get(t, k) { if (typeof k === 'string') touched.add(k); return t[k]; } });
  for (const s of ALL) for (const mode of ['arcade', 'horde', 'quick', 'crew']) matchCounts(s, spy(m({ mode, won: true, parries: 1, punishes: 1, enders: 1, perfects: 1, rounds: 1, floors: 1, hits: 999, presses: 5000, combo: 40 })));
  const extra = [...touched].filter((k) => !STATS.includes(k) && !['mode', 'cut', 'won', 'fighter'].includes(k));
  ok('no shift reads anything but STATS (and the mode, whether it was cut short or won, the fighter)', extra.length === 0, [...touched].sort().join(' '));
  ok('nothing named hits, combo or presses is ever read', !touched.has('hits') && !touched.has('combo') && !touched.has('presses'));
  const mash = m({ hits: 999, presses: 5000, combo: 40 });
  ok('the mash case: 999 hits, 5,000 presses and a 40-hit combo, lost, move no shift of any kind', ALL.every((s) => matchCounts(s, mash) === 0));

  // the real sim, a masher at P1's controls, through the real books (src/bookkeeping.js), as main.js wires them
  const { installDom } = await import('../netsim/env.mjs'); installDom();
  const { createFighter, MOVES, MOVE_DATA } = await import('../../src/fighter/index.js');
  const { createArena } = await import('../../src/arena/index.js');
  const { createCombat } = await import('../../src/combat/sim.js');
  const { EMPTY_INPUT } = await import('../../src/combat/input.js');
  const { roster } = await import('../../src/characters/index.js');
  const fighters = roster().map((c) => c.id);
  /** one match, P1 mashing (a random button every 2 to 4 steps, holding toward most of the time) or a CPU at cpu */
  function match(id, opp, seed, level, cpu = 0) {
    const arena = createArena('building'), sp = arena.spawns;
    const rigs = [createFighter({ x: sp[0].x, y: sp[0].y, facing: 1 }), createFighter({ x: sp[1].x, y: sp[1].y, facing: -1 })];
    let r = seed * 7919, cur = EMPTY_INPUT, k = 0;
    const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const masher = () => {
      if (k-- <= 0) { k = 1 + Math.floor(rnd() * 3); const b = Math.floor(rnd() * 4); cur = { ...EMPTY_INPUT, dx: rnd() < 0.7 ? 1 : 0, lp: b === 0, rp: b === 1, lk: b === 2, rk: b === 3 }; }
      else cur = { ...cur, lp: false, rp: false, lk: false, rk: false };
      return cur;
    };
    let sim, book;
    const makeRig = (c) => { const g = sim.units[0]; return createFighter({ color: c, x: g.x, y: g.y, facing: -1 }); };
    sim = createCombat({ fighters: rigs, arena, input: { snapshot: masher }, onEvent(ev) { if (book) book.event(ev); }, makeRig, moves: MOVES, moveData: MOVE_DATA });
    sim.setCharacters([id, opp]);
    if (cpu) sim.setAI(0, cpu); else sim.setHuman(0);
    sim.setAI(1, level);
    sim.resetMatch({ seed, fresh: true });
    const closed = [];
    book = createBook(sim, { send: () => {}, store: null, page: `m${seed}`, onClose: (s) => closed.push(s) });
    book.begin({ mode: 'arcade', level, stage: 1, local: 0 });
    for (let t = 0; t < 120 * 240 && sim.phase !== 'match'; t++) sim.tick();
    book.end();
    return closed[0];
  }
  const runs = [];
  for (const [i, id] of fighters.entries()) for (const level of [0.2, 0.55]) runs.push(match(id, fighters[(i + 5) % fighters.length], 11 + i, level));
  const best = (f) => Math.max(...runs.map((s) => s[f] || 0));
  console.log(`      ${runs.length} mashed matches: best in one match ${best('parries')} parries, ${best('punishes')} punishes, ${best('enders')} enders, ${best('perfects')} perfect rounds, ${best('rounds')} rounds won`);
  const finishedBy = ALL.filter((s) => runs.some((x) => matchCounts(s, x) >= s.n));
  ok(`the real sim, ${runs.length} matches with a masher on P1 (every fighter, CPU 0.2 and 0.55): no single match finishes any shift`, finishedBy.length === 0, finishedBy.map((s) => s.title).join('; '));
  let pileDone = 0;
  for (const d of days.slice(0, 60)) for (const sw of [-1, 0, 1, 2]) {
    let st = { ...blankShifts(d), swap: sw };
    for (const x of runs) { const r = advanceShifts(st, x, d); st = r.state; pileDone += r.finished.length; }
  }
  ok('...and all of them played on one day, for 60 days of shifts (every swap too), finish nothing', pileDone === 0, `${pileDone}`);
  ok('...and the masher lost every match', runs.every((x) => !x.won));

  // the bar is reachable: a CPU (0.55) playing P1 in the same matches finishes technique shifts
  const cpuRuns = [];
  for (const [i, id] of fighters.slice(0, 8).entries()) cpuRuns.push(match(id, fighters[(i + 5) % fighters.length], 11 + i, 0.55, 0.55));
  const reached = ['punish', 'ender'].filter((kind) => ALL.filter((s) => s.kind === kind).every((s) => cpuRuns.some((x) => matchCounts(s, x) >= s.n)));
  ok('a CPU playing P1 the same way a decent player would finishes the punish and ender shifts in a match', reached.length === 2, `${reached.join(', ')}; best ${Math.max(...cpuRuns.map((x) => x.punishes))} punishes, ${Math.max(...cpuRuns.map((x) => x.enders))} enders`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
