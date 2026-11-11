#!/usr/bin/env node
// What beats each fighter's unique moves, measured. The STRATEGY section on the fighter pages (the `strategy`
// field in src/characters/*.js; README, Site) is written from this script's output, so run it again whenever
// frame data, reach, stamina or the guard and parry rules change, and fix any tip that stopped being true.
//
//   node gauntlet/counters.mjs courier            one fighter (any number of ids), every unique move and string
//   node gauntlet/counters.mjs all                the whole roster, one fighter after another (about an hour on
//                                                 one core; it's one process per run, so start a shell per
//                                                 fighter, or `... | xargs -P 8`, to use the others)
//   node gauntlet/counters.mjs courier --move expressSlide     one case (a move id, or a string's name; --list shows them)
//   node gauntlet/counters.mjs courier --move "SAME DAY" --trace "crouch-block@80"
//                                                 one exchange behind that hold from 80 px: both fighters' states and the log
//   node gauntlet/counters.mjs courier --move expressSlide --trace "3@-10@180"
//                                                 one press (here 3), 10 steps before contact, from 180 px
//   node gauntlet/counters.mjs security --json    the raw rows instead of the tables
//   node gauntlet/counters.mjs all --list         just the cases, and how many tips each has
//   --step N                                      try every Nth step in the timed sweeps (2 by default; parries always every step)
//
// It runs the real sim in Node (no browser: the same setup as scripts/netsim), P1 the fighter and P2 a TEMP,
// both mid-floor, far from a wall. P1 does the move the way a player would: a dash and a press, a jump and a
// press, a string with each press buffered, a stance and its follow-up (pressed at once, and after holding
// it), a feint, and for a move that only sets up the next one (FOLLOW) each thing that comes next. P2 tries
// every answer a player has, from three start distances across the move's reach:
//   holds      nothing, stand-block (hold away, which also walks back), crouch-block (down and away), crouch,
//              and the right guard for each hit on reaction
//   timed      a parry tap (toward, and down-toward) at every step; a jump (up, back), a crouch held for a third
//              of a second, and each of thirteen presses (1 2 3 4, with down, toward and away, and a throw) at
//              every second step from the start of the move (or of its dash) to its end. A single move is met
//              standing; a string is blocked with the right guard up to the press
//   after      behind each hold that survives it, each press at every second step from the last block (or from
//              the step it went by) until he has recovered, standing still and stepping in first
// An answer works when P1 is hit out of his move or his run-in and P2 isn't touched (a hit on a P1 who had
// already recovered proves nothing and counts for nothing), when P2 parries, when P2 breaks a throw, or, for
// the crouch, when nothing touches P2. A trade, a block and getting hit don't count. The tables print the
// windows of steps where each answer worked, counted from the step the move connects on a TEMP who stands
// still (negative is before it; 1 step is 1/120 s, so 2 steps are one 60fps frame), and under them the tips
// the fighter page shows for that move, so each tip can be checked against its rows.
//
// Both sides are frame-perfect scripts, so a window here is the most a person can get, not what they will get.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const { installDom } = await load('scripts/netsim/env.mjs');
installDom();
const { createFighter, MOVES, MOVE_DATA } = await load('src/fighter/index.js');
const { createArena } = await load('src/arena/index.js');
const { createCombat } = await load('src/combat/sim.js');
const { EMPTY_INPUT } = await load('src/combat/input.js');
const { FRAME_DATA } = await load('src/combat/frameData.js');
const { roster, getCharacter } = await load('src/characters/index.js');
console.info = () => {};

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ids = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--move', '--step', '--trace'].includes(args[i - 1])));
const ONLY = opt('--move', null);
const COARSE = +opt('--step', 2);   // the timed sweeps try every Nth step (parries always every step)

// ---- the sim ---------------------------------------------------------------------------------------------
const arena = createArena('building');
const sp = arena.spawns;
const fighters = [createFighter({ color: '#f0f0f0', x: sp[0].x, y: sp[0].y, facing: 1 }), createFighter({ color: '#E85D00', x: sp[1].x, y: sp[1].y, facing: -1 })];
/** @type {any} */ let sim = null;
sim = createCombat({ fighters, arena, input: { snapshot: () => EMPTY_INPUT, swallowHeld() {} }, onEvent: () => {}, makeRig: (color) => createFighter({ color, x: sim.units[0].x, y: sim.units[0].y, facing: -1 }), moves: MOVES, moveData: MOVE_DATA });
const X0 = 1060;   // mid-floor: the walls are at 150 and 2410
const place = (i, x, f) => { const u = sim.units[i]; u.x = x; u.facing = f; u.rig.x = x; u.rig.facing = f; u.rig.update(0); };
const E = (o) => ({ ...EMPTY_INPUT, ...o });
let T = 0, curChar = '';

/** One exchange. p1 and p2 are (t, me, opp) => input; `final` the moves whose start and live step are noted. */
function run(char, d, p1, p2, steps, final) {
  if (char !== curChar) { sim.setCharacters([char, 'temp']); curChar = char; }
  sim.setController(0, 'script', (me, opp) => E(p1(T, me, opp)));
  sim.setController(1, 'script', (me, opp) => E(p2(T, me, opp)));
  sim.botchOn = true;
  sim.resetMatch({ seed: 1, skipIntro: true, fresh: true });
  place(0, X0, 1); place(1, X0 + d, -1);
  const [a, b] = sim.units, h = [a.health, b.health];
  const r = { start: -1, live: -1, end: -1, gap: 0, caught: null };
  let was = false;
  for (T = 0; T < steps; T++) {
    const hp = a.health, st = a.state;
    sim.tick();
    // the first time P1 is hurt or grabbed: was he committed (mid-move, or mid-dash) or just standing there?
    if (r.caught === null && (a.health < hp || (a.state === 'grabbed' && st !== 'grabbed'))) r.caught = was || st === 'attack' || st === 'run';
    was = a.state === 'attack' || a.state === 'run';
    const on = a.state === 'attack' && final.includes(a.move);
    if (on && r.start < 0) r.start = T;
    if (on && a.phase === 'active' && r.live < 0) r.live = T;
    if (!on && r.start >= 0 && r.end < 0) { r.end = T; r.gap = Math.round(Math.abs(b.x - a.x)); }
  }
  r.d1 = Math.round((h[0] - a.health) * 10) / 10; r.d2 = Math.round((h[1] - b.health) * 10) / 10;
  r.on1 = []; r.on2 = []; r.flags = new Set();
  for (const n of sim.log) {
    if (n.type === 'hit') { (n.att === 1 ? r.on1 : r.on2).push(n.move + (n.counter ? '!' : '')); if (n.att === 1 && n.counter) r.flags.add('counter'); }
    else if (n.type === 'block') { r.flags.add(n.att === 0 ? 'blocked' : 'heBlocked'); if (n.att === 0 && r.blockAt == null) r.blockAt = n.step; if (n.att === 0) r.lastBlock = n.step; }
    else if (n.type === 'parry') r.flags.add(n.att === 1 ? 'parried' : 'heParried');
    else if (n.type === 'grab') { r.flags.add(n.att === 0 ? 'grabbed' : 'threw'); if (n.att === 1) r.on1.push('throw'); }
    else if (n.type === 'throwCounter') r.flags.add('throwCountered');
    else if (n.type === 'armor') r.flags.add(n.att === 0 ? 'armored' : 'myArmor');
    else if (n.type === 'botch' && n.att === 1) r.flags.add('botch');
    else if (n.type === 'break') r.flags.add('break');
    else if (n.type === 'duck' && n.att === 1) r.flags.add('ducked');
    else if (n.type === 'trade') r.flags.add('trade');
  }
  const c0 = sim.log.find((n) => n.att === 0 && (n.type === 'hit' || n.type === 'block' || n.type === 'grab') && final.includes(n.move));
  r.contact = c0 ? c0.step : -1;
  // W: P1 was hit out of his move (or his run-in) and P2 wasn't touched. A hit on a P1 who had already
  // recovered and was standing there proves nothing, so it scores '-'.
  r.code = r.d1 > 0 && r.d2 === 0 ? (r.caught ? 'W' : '-') : r.d1 > 0 ? 'T' : r.d2 > 0 ? 'L' : r.flags.has('parried') ? 'P' : r.flags.has('break') ? 'K' : r.flags.has('blocked') ? 'B' : '-';
  r.down2 = b.state === 'down' || b.state === 'knockdown' || b.state === 'getup';
  return r;
}

// ---- P1: the move, the way a player presses it -------------------------------------------------------------
const BTN = { 1: 'lp', 2: 'rp', 3: 'lk', 4: 'rk' };
const GLYPH = { '': '', f: '→ ', b: '← ', d: '↓ ', df: '↘ ', db: '↙ ', ff: '→→ ', run: 'run ', airDown: '↓ ', air: '', rise: '' };
function pressOf(button, motion, me) {
  const o = {};
  for (const b of String(button).split('+')) o[BTN[b]] = true;
  if (motion === 'f' || motion === 'ff' || motion === 'df' || motion === 'run') o.dx = me.facing;
  if (motion === 'b' || motion === 'db') o.dx = -me.facing;
  if (motion === 'd' || motion === 'df' || motion === 'db' || motion === 'airDown') o.down = true;
  return o;
}
const RUN = 24, PRESS = 10, AIR = 26;
/** a command: a dash first for →→, a jump first for an air move; `then` is a follow-up press some steps later (a feint) */
function command(c, then) {
  const at = c.motion === 'ff' || c.motion === 'run' ? RUN : PRESS;
  return () => (t, me) => {
    if ((c.motion === 'ff' || c.motion === 'run') && t < at) return { dx: me.facing, run: true };
    if (c.motion === 'air' || c.motion === 'airDown') {
      if (t >= PRESS && t < PRESS + 3) return { jump: true, dx: me.facing };
      if (t >= PRESS + AIR && t < PRESS + AIR + 3) return pressOf(c.button, c.motion, me);
      return t >= PRESS && !me.grounded ? { dx: me.facing } : {};
    }
    if (t >= at && t < at + 3) return pressOf(c.button, c.motion, me);
    if (then && t >= at + then.after && t < at + then.after + 3) return pressOf(then.button, then.motion, me);
    return {};
  };
}
/** a string: the first press at step 10, each next press buffered as early as the string takes it */
function string(s) {
  const inpOf = (k) => (k[0] === 'd' ? { down: true, [BTN[k[1]]]: true } : { [BTN[k]]: true });
  return () => {
    let i = 0, last = -99, hold = -1, cur = {};
    return (t, me) => {
      if (t < hold) return cur;
      if (i >= s.keys.length) return {};
      const inp = inpOf(s.keys[i]), k = s.keys[i], b = BTN[k[k.length - 1]];
      const ok = i === 0 ? t === PRESS : t >= last + 8 && me.state === 'attack' && sim.resolvePress(me, b, E(inp)).attack === s.moves[i] && !sim.pressMistimed(me, E(inp));
      if (!ok) return s.keys[i][0] === 'd' && i > 0 ? { down: true } : {};
      i++; last = t; hold = t + 3; cur = inp;
      return cur;
    };
  };
}
/** a stance held with its button, then one of its moves (or nothing: it steps out by itself) */
function stance(c, follow, after = 42) {
  return () => (t, me) => {
    const b = BTN[c.button];
    if (t >= PRESS && t < PRESS + 3) return pressOf(c.button, c.motion, me);
    if (follow && t >= PRESS + after && t < PRESS + after + 3) return { [b]: true, [BTN[follow]]: true };
    if (t >= PRESS && t < PRESS + after + (follow ? 0 : 20)) return { [b]: true };
    return {};
  };
}

const glyphKeys = (keys) => keys.map((k) => (k[0] === 'd' ? '↓' + k[1] : k)).join(', ');
const nameOf = (c, m) => { const fd = FRAME_DATA[m] || {}; const e = (c.moveList || []).find((x) => fd.callout && x.name === fd.callout); return e ? e.name : fd.callout || m.replace(/^[a-z]+_/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase(); };

// A move that is only there to set up the next one is measured with each thing that comes next, as a case of
// its own: LAWYER's Cross-Examination is plus on block, and then it's a throw or a mid.
const FOLLOW = { lawyer_crossExam: [['a throw', '1+3', '', 'throw'], ['a snap kick', '3', '', 'lkick'], ['an overhead', '4', 'f', 'overhead']] };
/** a command, then a second press on the first step he can move again */
function followed(c, btn, motion) {
  return () => {
    let at = -1;
    return (t, me) => {
      if (t >= PRESS && t < PRESS + 3) return pressOf(c.button, c.motion, me);
      if (at < 0 && t > PRESS + 3 && me.state !== 'attack') at = t;
      return at >= 0 && t < at + 3 ? pressOf(btn, motion, me) : {};
    };
  };
}

/** every unique move and string of a character, as cases: { key, name, input, make, final, kind, far } */
function casesFor(c) {
  const out = [], own = (m) => FRAME_DATA[m] && FRAME_DATA[m].owner === c.id, seen = new Set();
  for (const k of c.commands) {
    if (seen.has(k.move) || !own(k.move)) continue;
    seen.add(k.move);
    const fd = FRAME_DATA[k.move], input = GLYPH[k.motion] + k.button + (k.motion === 'air' || k.motion === 'airDown' ? ' in the air' : '');
    const base = { key: k.move, name: nameOf(c, k.move), input, final: [k.move], kind: fd.throw ? 'throw' : fd.noHit || fd.parry || fd.stance || fd.selfStatus ? 'quiet' : k.motion === 'ff' ? 'dash' : k.motion.startsWith('air') ? 'air' : 'strike' };
    if (fd.stance) {
      out.push({ ...base, make: stance(k), note: 'held, no follow-up' });
      // each stance move twice: pressed as soon as the stance is up, and after holding it for a third of a second
      for (const [btn, m] of Object.entries(fd.stance.moves)) for (const [after, note] of [[10, 'pressed at once'], [42, 'after holding the stance']]) {
        out.push({ key: after === 10 ? m : `${m}:held`, tipKey: m, name: nameOf(c, m), input: `${input}, ${btn}`, final: [m], kind: FRAME_DATA[m].noHit ? 'quiet' : 'strike', make: stance(k, btn, after), note });
      }
      continue;
    }
    out.push({ ...base, make: command(k) });
    for (const [what, btn, motion, move] of FOLLOW[k.move] || []) out.push({ key: `${k.move}>${move}`, tipKey: k.move, name: `${base.name}, then ${what}`, input: `${input}, ${GLYPH[motion]}${btn}`, final: [move], kind: 'string', make: followed(k, btn, motion) });
    if (fd.parry) out[out.length - 1].final.push(fd.parry.reversal);
    if (fd.throwCounter) out[out.length - 1].final.push(fd.throwCounter.reversal);
    if (fd.feint) {
      const done = new Set();
      for (const to of Object.values(fd.feint.into)) {
        if (done.has(to)) continue; done.add(to);
        const tf = FRAME_DATA[to], then = tf.throw ? { button: '1+3', motion: '', after: 5 } : (() => { const src = c.commands.find((x) => fd.feint.into[x.move] === to && x.move !== to); return { button: src.button, motion: src.motion, after: 5 }; })();
        out.push({ key: `${k.move}>${to}`, name: `${base.name} feinted into ${nameOf(c, to)}`, input: `${input}, then ${GLYPH[then.motion]}${then.button}`, final: [to], kind: tf.throw ? 'throw' : 'dash', make: command(k, then), feintOf: k.move });
      }
    }
  }
  const strings = c.id === 'temp' ? c.strings : c.strings.filter((s) => s.moves.some(own));
  for (const s of strings) out.push({ key: s.name, string: true, name: s.name, input: glyphKeys(s.keys), final: [s.moves[s.moves.length - 1]], moves: s.moves, kind: 'string', make: string(s) });
  return out;
}

// ---- P2: the answers ---------------------------------------------------------------------------------------
const away = (me, opp) => (me.x >= opp.x ? 1 : -1);
const HOLDS = {
  'nothing': () => ({}),
  'stand-block': (me, opp) => ({ dx: away(me, opp) }),
  'crouch-block': (me, opp) => ({ dx: away(me, opp), down: true }),
  'crouch': () => ({ down: true }),
  // the right guard for each hit as it comes, on reaction: up for highs, mids and overheads, down for lows
  'right guard': (me, opp) => {
    const threat = (opp.state === 'attack' && opp.phase !== 'recovery') || me.state === 'blockstun';
    if (!threat) return {};
    const fd = FRAME_DATA[opp.move] || {};
    return fd.height === 'low' ? { dx: away(me, opp), down: true } : { dx: away(me, opp) };
  },
};
// what P2 can press: label, input (toward is +1 here and turned to face P1 when pressed)
const PRESSES = [
  ['1', { lp: true }], ['2', { rp: true }], ['3', { lk: true }], ['4', { rk: true }],
  ['↓1', { lp: true, down: true }], ['↓2', { rp: true, down: true }], ['↓3', { lk: true, down: true }], ['↓4', { rk: true, down: true }],
  ['→1', { lp: true, dx: 1 }], ['→2', { rp: true, dx: 1 }], ['→4', { rk: true, dx: 1 }], ['←4', { rk: true, dx: -1 }],
  ['throw', { lp: true, lk: true }],
];
const faced = (inp, me, opp) => (inp.dx ? { ...inp, dx: -inp.dx * away(me, opp) } : inp);
/** hold `base`, and at step `at` do `inp` for `n` steps */
const timed = (base, at, inp, n = 3) => (t, me, opp) => (t >= at && t < at + n ? faced(inp, me, opp) : HOLDS[base](me, opp));
/** hold `base`, and from step `at` press `inp` (stepping in first when `walk`: toward him until 80 px, at most 40 steps) */
function later(base, at, inp, walk) {
  let pressed = -1;
  return (t, me, opp) => {
    if (t < at) return HOLDS[base](me, opp);
    if (pressed >= 0) return t < pressed + 3 ? faced(inp, me, opp) : {};
    if (walk && Math.abs(opp.x - me.x) > 80 && t < at + 40) return { dx: -away(me, opp) };
    pressed = t;
    return faced(inp, me, opp);
  };
}

// ---- measuring one case ------------------------------------------------------------------------------------
const uniq = (a) => [...new Set(a)];
function measure(c, k) {
  const P1 = () => k.make(), LEN = k.kind === 'string' ? 280 : 200;
  const still = (d) => run(c.id, d, P1(), () => ({}), LEN, k.final);
  // where it reaches: the start distances at which it touches a TEMP who just stands there
  let dists;
  if (k.kind === 'quiet') dists = [80, 110, 150];
  else {
    const reach = [];
    for (let d = 70; d <= 520; d += 10) { const r = still(d); if (r.d2 > 0 && r.on2.concat([...r.flags]).length && (r.on2.some((m) => k.final.includes(m.replace('!', ''))) || r.flags.has('grabbed'))) reach.push(d); }
    if (!reach.length) return { dists: [], rows: [], note: 'never touched a standing TEMP at any start distance' };
    const lo = reach[0], hi = reach[reach.length - 1];
    const near = k.kind === 'dash' ? Math.min(Math.max(lo, 180), hi) : k.kind === 'air' ? Math.min(Math.max(lo, 100), hi) : Math.max(lo, 80);
    dists = uniq([near, Math.round((near + hi) / 20) * 10, hi]);
    k.reach = [lo, hi];
  }
  const res = { dists, reach: k.reach || null, holds: {}, timed: {}, after: {}, ref: [], base: [] };
  dists.forEach((d, di) => {
    const b = still(d);
    const steps = Math.max(b.end, b.start, 40) + 110;
    const ref = b.contact >= 0 ? b.contact : b.start;
    const first = k.kind === 'dash' || k.kind === 'air' ? 0 : PRESS;   // a dash or a jump is part of the move; anything else starts at the press
    res.ref.push({ start: b.start, contact: b.contact, end: b.end });
    if (di === 0) res.hits = sim.log.filter((n) => n.att === 0 && n.type === 'hit').map((n) => `${n.move} ${n.step}`);
    // holds
    for (const h of Object.keys(HOLDS)) {
      const r = run(c.id, d, P1(), (t, me, opp) => HOLDS[h](me, opp), steps, k.final);
      (res.holds[h] = res.holds[h] || [])[di] = { code: r.code, d2: r.d2, on2: r.on2, gap: r.gap, flags: [...r.flags], open: r.lastBlock != null && r.end >= 0 ? r.end - r.lastBlock : null, down: r.down2, out: r.start >= 0, touched: r.contact >= 0 };
    }
    // timed answers: a string is blocked up to the press, a single move is met standing
    const base = k.kind === 'string' ? 'right guard' : 'nothing';
    const put = (label, at, r) => { const row = (res.timed[label] = res.timed[label] || []); (row[di] = row[di] || []).push({ at: at - ref, code: r.code, on1: r.on1, d1: r.d1, flags: [...r.flags] }); };
    const lastAt = Math.max(b.end, ref + 10);
    for (let at = Math.max(first, ref - 40); at <= ref + 6; at++) {
      put('parry →', at, run(c.id, d, P1(), timed(base, at, { dx: 1 }, 2), steps, k.final));
      put('parry ↘', at, run(c.id, d, P1(), timed(base === 'nothing' ? 'crouch' : base, at, { dx: 1, down: true }, 2), steps, k.final));
    }
    for (let at = first; at <= lastAt; at += COARSE) {
      put('jump up', at, run(c.id, d, P1(), timed(base, at, { jump: true }), steps + 40, k.final));
      put('jump back', at, run(c.id, d, P1(), timed(base, at, { jump: true, dx: -1 }, 30), steps + 40, k.final));
      put('crouch', at, run(c.id, d, P1(), timed(base, at, { down: true }, 40), steps, k.final));
      for (const [label, inp] of PRESSES) put(label, at, run(c.id, d, P1(), timed(base, at, inp), steps, k.final));
    }
    // after it: behind each hold that survives it (the one a player holds from the start, and the right
    // guard on reaction, which stands closer), each press at every step from the last block (or, when it
    // whiffed, from the step it went by) until he has recovered
    const ok = (h) => { const x = res.holds[h][di]; return x.code === 'B' || x.code === '-'; };
    const bases = uniq([['stand-block', 'crouch-block', 'crouch', 'nothing'].find(ok), k.kind === 'string' && ok('crouch-block') ? 'crouch-block' : null, ok('right guard') && k.kind !== 'throw' ? 'right guard' : null].filter(Boolean));
    res.base[di] = bases;
    for (const hb of bases) {
      const h0 = run(c.id, d, P1(), (t, me, opp) => HOLDS[hb](me, opp), steps, k.final);
      const from = h0.lastBlock != null ? h0.lastBlock : h0.live >= 0 ? h0.live : h0.start, to = (h0.end >= 0 ? h0.end : from + 60) + 8;
      for (const walk of [false, true]) for (const [label, inp] of PRESSES) {
        if (walk && !['1', '2', '3', '↓2', 'throw'].includes(label)) continue;
        const key = `${hb}: ${walk ? 'step in, ' : ''}${label}`;
        for (let at = from; at <= to; at += COARSE) {
          const r = run(c.id, d, P1(), later(hb, at, inp, walk), steps + 60, k.final);
          const row = (res.after[key] = res.after[key] || []);
          (row[di] = row[di] || []).push({ at: at - from, code: r.code, on1: r.on1, d1: r.d1, flags: [...r.flags] });
        }
      }
    }
  });
  return res;
}

// ---- printing ----------------------------------------------------------------------------------------------
const MOVE_NAME = { jab: 'jab', cross: 'cross', lkick: 'snap kick', roundhouse: 'roundhouse', lowJab: 'low jab', uppercut: 'uppercut', lowKick: 'low kick', sweep: 'sweep', bodyBlow: 'body blow', lungeCross: 'lunge cross', overhead: 'overhead', spinKick: 'spin kick', throw: 'throw', risingUppercut: 'rising uppercut', risingKnee: 'rising knee', jumpJab: 'jump jab', cometCross: 'comet cross' };
/** [{at, code}] -> "-30..-22" : the runs of tries, next to each other, where the answer worked */
function windows(list, dodge = false) {
  if (!list || !list.length) return 'n/a';
  const runs = [];
  let cur = null;
  list.forEach((x, i) => {
    if (x.code === 'W' || x.code === 'P' || x.code === 'K' || (dodge && x.code === '-')) { if (cur && cur.i === i - 1) { cur.to = x.at; cur.i = i; } else runs.push(cur = { from: x.at, to: x.at, i }); }
  });
  if (!runs.length) return list.some((x) => x.code === 'T') ? 'trade' : list.every((x) => x.code === '-' || x.code === 'B') ? 'whiff' : 'no';
  return runs.map((r) => (r.to !== r.from ? `${r.from}..${r.to}` : `${r.from}`)).join(', ');
}
const what = (row) => { const m = new Set(), f = new Set(); for (const cell of row) for (const x of cell || []) if (x.code === 'K') m.add('breaks the throw'); else if (x.code === 'W') { x.on1.forEach((n) => m.add(MOVE_NAME[n.replace('!', '')] || n.replace('!', ''))); if (x.on1.some((n) => n.endsWith('!'))) f.add('counter'); } return [...m].join('+') + (f.size ? ', counter hit' : ''); };
const per = (res, f) => { const v = res.dists.map((d, i) => f(i)); return v.every((x) => x === v[0]) ? String(v[0]) : v.join(' / '); };
const HOLD_WORD = { L: 'HIT', B: 'blocked', '-': 'whiffs', W: 'W', T: 'trade', P: 'parry' };

function print(c, k, res, tips) {
  console.log(`\n== ${c.name} · ${k.name} · ${k.input}   [${k.key}]${k.note ? ' (' + k.note + ')' : ''}`);
  if (!res.dists.length) { console.log('   ' + res.note); return; }
  console.log(`   from ${res.dists.join(' / ')} px${res.reach ? ` (touches a standing TEMP from ${res.reach[0]} to ${res.reach[1]} px)` : ''} · his move starts at step ${per(res, (i) => res.ref[i].start)} · contact ${per(res, (i) => res.ref[i].contact)} · over ${per(res, (i) => res.ref[i].end)}${k.kind === 'string' && res.hits ? ` · unguarded, the hits land at ${res.hits.join(', ')}` : ''}`);
  for (const [h, row] of Object.entries(res.holds)) {
    const hit = row.find((x) => x.code === 'L'), blk = row.find((x) => x.code === 'B');
    console.log(`   hold ${h.padEnd(13)} ${per(res, (i) => HOLD_WORD[row[i].code])}${hit ? `   (${hit.d2} damage${hit.down ? ', knocked down' : ''}${hit.flags.includes('grabbed') ? ', grabbed' : ''})` : ''}${blk ? `   (ends ${per(res, (i) => (row[i].code === 'B' && row[i].out ? row[i].gap : '-'))} px apart, he is still recovering ${per(res, (i) => (row[i].code === 'B' && row[i].out ? row[i].open : '-'))} steps after the last block)` : ''}${row.some((x) => !x.out) ? `   (his last move never came out from ${res.dists.filter((d, i) => !row[i].out).join(' and ')} px: the string stopped)` : ''}${row.some((x) => x.out && !x.touched && x.code === 'B') ? `   (his last move came out and missed from ${res.dists.filter((d, i) => row[i].out && !row[i].touched && row[i].code === 'B').join(' and ')} px)` : ''}`);
  }
  const rows = (table, pad, indent) => {
    const never = [];
    for (const [label, row] of table) {
      const cells = res.dists.map((d, i) => windows(row[i], label === 'crouch'));
      if (cells.every((x) => !/\d/.test(x))) { never.push(`${label}${cells.includes('trade') ? ' (trades)' : ''}`); continue; }
      console.log(`${indent}${label.padEnd(pad)} ${cells.join(' | ').padEnd(40)} ${what(row)}`);
    }
    if (never.length) console.log(`${indent}never: ${never.join(', ')}`);
  };
  console.log('   TIMED, steps from contact (negative is before it)');
  rows(Object.entries(res.timed), 14, '     ');
  console.log('   AFTER IT, behind a hold that survives it: steps after the last block, or after it went by');
  const held = uniq(res.base.flat());
  if (!held.length) console.log('     no hold survives it');
  for (const hb of held) {
    console.log(`     behind ${hb}${res.dists.length > 1 && res.base.some((b) => !b.includes(hb)) ? ` (from ${res.dists.filter((d, i) => res.base[i].includes(hb)).join(' and ')} px)` : ''}`);
    rows(Object.entries(res.after).filter(([key]) => key.startsWith(hb + ': ')).map(([key, row]) => [key.slice(hb.length + 2), row]), 14, '       ');
  }
  if (tips) { console.log('   TIPS ON THE PAGE'); for (const t of tips) console.log('     - ' + t); }
}

// ---- main --------------------------------------------------------------------------------------------------
const chars = (ids.includes('all') || !ids.length ? roster() : ids.map((id) => getCharacter(id) || roster().find((c) => c.id.toLowerCase() === id.toLowerCase()))).filter(Boolean);
if (!chars.length) { console.error('no such fighter. ids: ' + roster().map((c) => c.id).join(' ')); process.exit(1); }
const json = [];
// --trace "crouch-block@80": one run of each case behind that hold from that distance, with the sim's log
// --trace "3@-10@180": that press, 10 steps before contact, from 180 px (the base is the timed sweep's)
function trace(c, k, spec) {
  const [what, a, b] = spec.split('@'), d = +(b || a), P1 = () => k.make(), LEN = k.kind === 'string' ? 280 : 200;
  const base = run(c.id, d, P1(), () => ({}), LEN, k.final), ref = base.contact >= 0 ? base.contact : base.start;
  const press = PRESSES.find((x) => x[0] === what) || (what === 'parry →' ? [what, { dx: 1 }] : what === 'parry ↘' ? [what, { dx: 1, down: true }] : null);
  const p2 = HOLDS[what] ? (t, me, opp) => HOLDS[what](me, opp) : timed(k.kind === 'string' ? 'right guard' : 'nothing', ref + +a, press[1], what.startsWith('parry') ? 2 : 3);
  const seen = [];
  let lastS = '';
  const r = run(c.id, d, P1(), (t, me, opp) => {
    const st = `${opp.state}${opp.move ? ':' + opp.move + '/' + opp.phase : ''} | ${me.state}${me.move ? ':' + me.move + '/' + me.phase : ''}`;
    if (st !== lastS) { lastS = st; seen.push(`     step ${String(t).padStart(3)}  ${st}  (${Math.round(Math.abs(opp.x - me.x))} px)`); }
    return p2(t, me, opp);
  }, LEN, k.final);
  console.log(`\n== ${c.name} · ${k.name} · P2 ${what}${b ? ' at contact ' + a : ''} from ${d} px: ${r.code}, P1 lost ${r.d1}, P2 lost ${r.d2}, contact step ${ref}`);
  console.log('   P1 | P2');
  for (const x of seen) console.log(x);
  for (const n of sim.log) console.log('   log ' + JSON.stringify(n));
}
for (const c of chars) {
  const strat = c.strategy || [];
  for (const k of casesFor(c)) {
    if (ONLY && k.key !== ONLY && k.name !== ONLY) continue;
    const mine = [k.key, k.feintOf, k.tipKey].filter(Boolean);
    const tips = (strat.find((s) => (k.string ? s.string === k.key : !!s.move && (mine.includes(s.move) || (s.also || []).some((m) => mine.includes(m))))) || {}).tips || null;
    if (flag('--list')) { console.log(`${c.id.padEnd(13)} ${k.key.padEnd(28)} ${k.input.padEnd(16)} ${tips ? tips.length + ' tips' : 'NO TIPS'}`); continue; }
    if (opt('--trace', null)) { trace(c, k, opt('--trace', '')); continue; }
    const res = measure(c, k);
    if (flag('--json')) json.push({ char: c.id, key: k.key, name: k.name, input: k.input, ...res }); else print(c, k, res, tips);
  }
}
if (flag('--json')) console.log(JSON.stringify(json));
