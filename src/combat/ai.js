// AI controller. Returns a function (me, opp, sim) -> held input, same shape a human
// produces, so the sim treats it identically. difficulty in [0,1] scales reaction
// chance, aggression and think rate.
//
// Acts are held inputs with an `until` (steps, or a predicate). A plan is a queue of
// acts, so an approach can have a shape: dash-in, jump-in, walk-and-poke, or bait
// (step in, step out to draw a whiff, then punish or dash). Reflexes fire between
// think ticks. Priority when deciding:
//   follow-up   my hit just connected: cancel into the next move
//   pressure    opponent is stumbling or blocking and in reach: hit again, or hold a beat
//   guard       two of my hits were blocked in a row: change class (sweep or jump-in)
//   punish      opponent is in recovery and in reach
//   rising      opponent just stood up: be on him before he settles
//   wake-up     opponent is down: run to the body, hover over it, meaty timed to the rise
//   retreat     losing and low: back off unless cornered
//   approach    far: one of the approach plans
//   pocket      in reach: attack with a move that reaches, or footsies
//   counter     exiting hitstun with the opponent in reach: swing back
//   stale       in range with nothing started for a while: swing
//
// style 'showcase' (the attract mode's demo bout, opt-in; the normal CPU never sets it) plays
// like an expert instead of a scrapper: it holds spacing at the edge of reach, steps out of
// pokes to make them whiff and punishes the whiff, reads heights more often and blocks instead
// of mashing out of hitstun, opens with string starters at all three heights (not jab spam),
// jumps in more, and meets jump-ins with an uppercut or a standing guard.
//
// The arcade ladder's personalities (src/flow/ladder.ts), opt-in the same way, each a few knobs
// on the normal CPU: 'turtle' guards more, waits at range and punishes whiffs; 'rushdown' runs in,
// swings more and never backs off; 'grappler' throws up close and hunts the wall and the stairwell;
// 'aerial' jumps in from further out and much more often.

import { EMPTY_INPUT } from './input.js';
import { matchStrings } from './strings.js';
import { FRAME_DATA } from './frameData.js';

const DOWN_STATES = new Set(['knockdown', 'down', 'getup', 'ko']);
const HIT_STATES = new Set(['hitstun', 'blockstun']);
const GETUP_MS = 336;   // the rig's 672ms getup clip at the sim's 2x; a meaty is timed against it
const GRAV = 2000;      // the sim's gravity, to predict where a launched body lands
const SWEEP_STEPS = 21; // sweep startup in 120Hz steps as measured (rig blend included, after the 50ms pre-roll)
const CLASS = { jab: 'punch', cross: 'punch', lungeCross: 'punch', uppercut: 'punch', bodyBlow: 'mid', lkick: 'mid', roundhouse: 'kick', spinKick: 'kick', sweep: 'low', lowKick: 'low', lowJab: 'low', throw: 'throw', overhead: 'overhead', risingKnee: 'mid' };
const BTN = { 1: 'lp', 2: 'rp', 3: 'lk', 4: 'rk' };
const heightOf = (m) => (FRAME_DATA[m] ? FRAME_DATA[m].height : 'mid');

export function createAI({ rng, difficulty = 0.6, reach, style = null }) {
  const show = style === 'showcase';
  const turtle = style === 'turtle', rush = style === 'rushdown', grap = style === 'grappler', aerial = style === 'aerial';
  let queue = [];            // plan: acts run in order
  let act = null;
  let nextThink = 0, lastReactedTo = -1, lastFollowed = -1, lastCounter = -1, lastBlockedId = -1, lastHitBlocked = false, blockedStreak = 0, mixupTurn = 0;
  let seenAttackId = -1, lastAttackStep = -9999, lastStale = -9999, myRun = 0, lastHitTakenId = -1;
  let plannedLaunch = -1, blockedClasses = new Set(), stringPick = null, lastPunish = -1;
  const mixLog = []; let lastStep = 0;
  // anti-air reads: the chance to read a jump-in at takeoff (0 at difficulty 0.3 and below), the
  // jump last looked at and the one being answered
  const aaReadChance = () => (show ? 0.85 : Math.max(0, Math.min(0.8, (difficulty - 0.3) * 1.1 + (aerial ? 0.15 : 0))));
  let aaSeen = -1, aaFor = -1;
  // where and when a launched body lands (y down, vy positive down)
  const landTime = (o, floorY) => (-o.vy + Math.sqrt(Math.max(0, o.vy * o.vy + 2 * GRAV * Math.max(0, floorY - o.y)))) / GRAV;
  const landX = (o, floorY) => o.x + o.vx * landTime(o, floorY);
  const chance = (p) => rng() < p;
  const irnd = (n) => Math.floor(rng() * n);
  const pick = (arr) => arr[irnd(arr.length)];
  const move = (dx, until, run = false) => ({ dx, run, block: false, attack: null, jump: false, until });
  const attack = (name) => ({ dx: 0, run: false, block: false, attack: name, jump: false, until: 2 });
  const blockFor = (steps) => ({ dx: 0, run: false, block: true, attack: null, jump: false, until: steps });
  // guards: standing (back) against high/mid, crouching (down-back) against low, a plain duck under highs
  const lowGuard = (steps) => ({ dx: 0, run: false, block: true, down: true, attack: null, jump: false, until: steps });
  const duck = (steps) => ({ dx: 0, run: false, block: false, down: true, attack: null, jump: false, until: steps });
  // a button press by token ('1'..'4', 'd' prefix = down): strings go through the sim's table
  const press = (tok, extra) => ({ dx: 0, run: false, block: false, attack: null, jump: false, until: 2, press: tok, ...(extra || {}) });
  let pickedString = null;
  // the stairwell (v3): a live opening on this floor, and where it is relative to the two of us
  function well(me, sim) {
    const sw = sim.stairwell;
    if (!sw || sw.toFloor == null || sim.floorBroken || sim.horde || (me.floor || 0) !== 0) return null;
    if (show && sim.timer > 46) return null;   // the demo saves the floor break for later in the round
    return { sw, cx: (sw.x0 + sw.x1) / 2 };
  }
  // he's near the opening and it lies beyond him (my push sends him toward it)
  const wellBeyond = (w, me, opp) => !!w && Math.abs(opp.x - w.cx) < 230 && Math.sign(w.cx - opp.x) === Math.sign(opp.x - me.x);
  // it's behind me and close: don't back up into it
  const wellBehindMe = (w, me, opp) => !!w && Math.abs(me.x - w.cx) < 200 && Math.sign(w.cx - me.x) === -Math.sign(opp.x - me.x);
  // which string to run from here: enders when there is stamina for them, a wall ender near a wall
  function chooseString(me, opp, sim, blocked) {
    if (!me.seq) return null;
    const m = matchStrings(me.seq).filter(st => st.keys.length > me.seq.length);
    if (!m.length) return null;
    const wallNear = (opp.x - sim.bounds.x0 < 230 && opp.x < me.x) || (sim.bounds.x1 - opp.x < 230 && opp.x > me.x);
    const score = (st) => {
      const last = FRAME_DATA[st.moves[st.moves.length - 1]] || {};
      let w = 1 + rng();
      if (last.ender) w += me.stamina >= 30 && !me.gassed ? 1.2 * difficulty : -3;
      if (last.splat && wallNear) w += 2;
      if (wellBeyond(well(me, sim), me, opp) && (last.juggle || last.splat || (last.kb && last.kb.x >= 400))) w += 2.5;
      if (blocked && last.ender) w -= 1.5;   // a blocked string ends early more often
      return w;
    };
    return m.reduce((a, b) => (score(b) > score(a) ? b : a));
  }
  const landed = (me) => me.grounded && me.state !== 'jump' && me.state !== 'landing';
  const closer = (px) => (me, opp) => Math.abs(opp.x - me.x) <= px;
  // a jump-in: jump toward him, strike on the way down when close (a dive kick on a croucher), land
  // and go straight into a ground string
  const jumpIn = (toward, finish) => [
    { ...move(toward, 4), jump: true },
    { ...move(toward, (m, o) => landed(m) || (!m.grounded && m.vy > -60 && Math.abs(o.x - m.x) < 125)) },
    { ...move(0, 2), pressFn: (m, o) => (o.crouch ? 'd4' : pick(['3', '3', '4', '2'])) },
    move(0, (m) => landed(m)),
    press(finish === 'jab' ? '1' : finish === 'sweep' ? 'd4' : '1'),
  ];

  // the anti-air for a jump-in I've read: hold my ground until he comes into the uppercut's reach
  // about when it would go live, then press it (a jab instead if he is already close with a strike
  // out). Nothing if he lands or gets knocked out of the air first, and a jump that will land short
  // is let land (an uppercut into the air in front of him is a whiff to punish).
  const AA_T = 0.12;   // the uppercut is live about 120ms after the press (its startup after the sim's pre-roll, live 45ms early)
  const aaWindow = (m, o) => {
    if (o.grounded || o.rag) return true;
    if (Math.abs(o.x - m.x) < reach('jab') + 10) return true;
    const short = o.state === 'jump' && Math.abs(landX(o, m.y) - m.x) > reach('uppercut') + 60;
    return !short && Math.abs(o.x + o.vx * AA_T - m.x) < reach('uppercut') + 30;
  };
  const antiAir = () => [
    move(0, aaWindow),
    { ...press('d2'), ok: true, onlyIf: (m, o) => !o.grounded && !o.rag && Math.abs(o.x - m.x) < 220,
      pressFn: (m, o) => (o.state === 'attack' && o.vy > 120 && Math.abs(o.x - m.x) < reach('jab') + 12 ? '1' : 'd2') },
  ];

  function footsies(toward) {
    const k = rng();
    if (turtle && k < 0.5) return k < 0.3 ? [blockFor(10 + irnd(8))] : [move(-toward, 4 + irnd(4))];
    if (k < 0.3) return [move(toward, 3 + irnd(4))];
    if (k < 0.55) return [move(-toward, 3 + irnd(4))];
    if (k < 0.7) return [move(toward, 2)];                      // feint
    if (k < 0.82) return [move(toward, 5, true)];               // short dash
    if (k < 0.92) return [blockFor(6 + irnd(6))];
    return [move(0, 3)];
  }
  // showcase spacing: hover just outside his cross, probe with a long poke now and then (it may
  // whiff on purpose, and the other one punishes it), step in to bait, or dash in to start
  function spacing(me, opp, dist, toward) {
    const edge = reach('cross') + 22 + irnd(16);
    const k = rng();
    if (dist < edge - 28 && k < 0.55) return [move(-toward, 6 + irnd(6))];
    if (dist > edge + 30) return k < 0.7 ? [move(toward, 4 + irnd(5))] : [move(toward, 5, true)];
    if (k < 0.22) return [move(toward, 3), move(-toward, 4 + irnd(4))];                  // step in, step out (bait)
    if (k < 0.38) return [move(toward, closer(reach('lowKick') - 4), true), press('d3')]; // dash-in low
    if (k < 0.5) return [attack(pick(['roundhouse', 'lungeCross', 'sweep']))];             // a long poke (may whiff)
    if (k < 0.62) return [move(toward, closer(reach('jab') + 2), true), press(pick(['1', '2', '3', 'd1', 'd3']))];
    if (k < 0.72) return [blockFor(8 + irnd(6))];
    return [move(chance(0.5) ? toward : -toward, 3 + irnd(4))];
  }
  // showcase: an opener at a height picked for him (lows and mids on a standing guard, mids and
  // the overhead on a croucher), as a press so the string table can carry it on
  function opener(opp, dist) {
    const close = dist < reach('jab');
    const opts = opp.crouch ? ['3', '3', 'bodyBlow', 'overhead', 'd2']
      : close ? ['1', '2', '3', 'd1', 'd3', 'd3', 'bodyBlow', 'overhead'] : ['2', '2', '3', 'd3', 'lungeCross'];
    const o = pick(opts);
    return /^d?[1-4]$/.test(o) ? press(o) : attack(o);
  }
  function approach(me, opp, dist, toward) {
    const k = rng();
    if (show) {
      if (k < 0.3) return [move(toward, closer(reach('jab') + 4), true), opener(opp, reach('jab') - 1)];          // dash-in
      if (k < 0.5 && dist < 300) return jumpIn(toward, chance(0.5) ? 'sweep' : 'jab');                             // jump-in
      if (k < 0.75) return [move(toward, closer(reach('cross') + 30), dist > 260), move(0, 4 + irnd(8))];          // walk to the edge of range
      return [move(toward, closer(reach('cross') + 24), dist > 260), move(-toward, 7), move(toward, closer(reach('jab') + 6), true), opener(opp, reach('jab') - 1)]; // bait
    }
    const pokeAt = reach('jab') - 4;
    if (aerial && k < 0.55 && dist < 330) return jumpIn(toward, chance(0.5) ? 'sweep' : 'jab');
    if (rush && k < 0.6) return [move(toward, closer(reach('jab') + 6), true), press(pick(['1', '1', '2', 'd1', '3']))];
    if (grap && k < 0.45) return [move(toward, closer(80), true), attack('throw')];
    if (k < 0.3) return [move(toward, closer(reach('jab') + 6), true), attack(chance(0.6) ? 'cross' : 'jab')];   // dash-in to the pocket
    if (k < 0.45 && dist < 280) return jumpIn(toward, chance(0.5) ? 'sweep' : 'jab');                                      // jump-in
    if (k < 0.75) return [move(toward, closer(pokeAt), dist > 200), attack('jab')];                                       // walk and poke
    return [move(toward, closer(reach('cross') + 24), dist > 200), move(-toward, 7), move(toward, closer(reach('jab') + 6), true), attack('cross')]; // bait
  }
  // after two blocked hits the next attack is a different class: a low or a jump-in,
  // with a varied beat before it so the sweep has no fixed tell
  // after two blocked hits the next attack is a different class from the blocked ones:
  // low (sweep) 40, air (jump-in) 35, kick (roundhouse) 25, renormalized over what is allowed,
  // with a step in and out before it (never a still hover)
  function mixup(dist, toward, opp) {
    mixupTurn++;
    // read the guard: a standing guard gives to a low or a throw; a croucher gives to a mid or
    // the overhead (and throws whiff on him); air and kick are feints that make him hold it
    const crouched = opp && opp.crouch;
    const table = (crouched ? [['mid', 0.45], ['overhead', 0.35], ['air', 0.2]] : [['low', 0.32], ['throw', 0.32], ['overhead', 0.12], ['air', 0.12], ['kick', 0.12]]).filter(([c]) => !blockedClasses.has(c));
    blockedStreak = 0; blockedClasses = new Set();
    const total = table.reduce((t, [, w]) => t + w, 0) || 1;
    let k = rng() * total, cls = 'low';
    for (const [c, w] of table) { if (k < w) { cls = c; break; } k -= w; }
    mixLog.push(cls + '@' + (lastStep / 2).toFixed(0));
    const beat = chance(0.5) ? [move(toward, 2)] : [move(toward, 2), move(-toward, 2)];
    if (cls === 'throw') return [move(toward, (m, o) => Math.abs(o.x - m.x) <= 82 || Math.abs(m.vx) < 5 && Math.abs(o.x - m.x) < 100, true), attack('throw')];   // solid bodies settle 75px apart against a guard
    if (cls === 'air' && dist < 220) return [...beat, ...jumpIn(toward, 'jab')];
    if (cls === 'mid' || cls === 'overhead') {
      const m = cls === 'overhead' ? 'overhead' : pick(['lkick', 'bodyBlow', 'uppercut']);
      const r = reach(m) - 6;
      return dist < r ? [...beat, attack(m)] : [move(toward, closer(r), true), attack(m)];
    }
    if (cls === 'kick') { const k = chance(0.5) ? 'roundhouse' : 'spinKick'; return dist < reach(k) ? [...beat, attack(k)] : [move(toward, closer(reach(k) - 6), true), attack(k)]; }
    const low = pick(['sweep', 'lowKick', 'lowKick', 'lowJab']);
    return dist < reach(low) ? [...beat, attack(low)] : [move(toward, closer(reach(low) - 6), true), attack(low)];
  }

  function decide(me, opp, sim, dist, toward) {
    const r = (m) => reach(m);
    const cornered = me.x - sim.bounds.x0 < 70 || sim.bounds.x1 - me.x < 70;
    const recovering = opp.state === 'attack' && opp.phase === 'recovery';

    if (HIT_STATES.has(opp.state) && me.state !== 'attack') {
      if (opp.state === 'blockstun' && blockedStreak >= 2) return mixup(dist, toward, opp);
      // a beat of guard now and then, and after two straight hits, so his counter has something to run into
      if (opp.state === 'hitstun' && (chance(0.25) || (myRun >= 2 && chance(0.6)))) { myRun = 0; return [blockFor(10 + irnd(6))]; }
      if (show) return dist < r('cross') ? [opener(opp, dist)] : [move(toward, closer(r('jab')), true), opener(opp, r('jab') - 1)];
      if (dist < r('cross')) return [attack(dist < r('jab') ? pick(['jab', 'cross', 'cross']) : 'cross')];
      return [move(toward, closer(r('cross') - 8), true), attack(chance(0.6) ? 'cross' : 'jab')];
    }
    if (blockedStreak >= 2 && dist < r('cross') + 40) return mixup(dist, toward, opp);
    // jump-ins: a dive kick on a croucher, and now and then from jump range (the anti-air game)
    const free = !DOWN_STATES.has(opp.state) && opp.state !== 'attack' && !HIT_STATES.has(opp.state) && me.stamina > 25;
    if (free && opp.crouch && dist > 100 && dist < 240 && chance(0.6)) return jumpIn(toward, 'jab');
    if (free && dist > 110 && dist < (aerial ? 300 : 230) && chance(show ? 0.3 : aerial ? 0.55 : 0.12 + 0.12 * difficulty)) return jumpIn(toward, 'jab');
    if (recovering && dist < r('roundhouse') + 8 && me.stamina > 12 && chance((opp.hitConfirmed ? 0.3 : 0.4) + 0.6 * difficulty)) {
      return [attack(dist < r('cross') - 5 ? 'cross' : 'roundhouse')];
    }
    if ((opp.state === 'block' || opp.state === 'blockstun') && dist < r('sweep')) {
      return chance(0.35 + 0.5 * difficulty) ? mixup(dist, toward, opp) : [move(-toward, 5)];
    }
    if (typeof opp.stoodAt === 'number' && sim.stepCount - opp.stoodAt < 60 && !DOWN_STATES.has(opp.state)) {
      if (show) return dist < r('cross') ? [opener(opp, dist)] : [move(toward, closer(r('jab')), true), opener(opp, r('jab') - 1)];
      if (dist < r('cross')) return [attack(dist < r('jab') ? 'jab' : 'cross')];
      return [move(toward, closer(r('cross') - 8), true), attack('cross')];
    }
    if (DOWN_STATES.has(opp.state)) {
      // be on the body: one run up while it flies, then hit it on the ground, step over it,
      // or hover with movement, and a meaty timed so the active frames arrive as he stands
      const floored = opp.state === 'down';
      if (dist > 100) return [move(toward, closer(90), true)];
      // stomp: the body lies past its root, so close to within 40px of the root first
      if (floored && !opp.otgHit && chance(0.5 + 0.4 * difficulty)) return dist < 40 ? [attack('sweep')] : [move(toward, closer(36), true), attack('sweep')];
      const mid = (sim.bounds.x0 + sim.bounds.x1) / 2;
      const bodyBetweenMeAndCenter = Math.sign(mid - me.x) === toward && Math.abs(mid - me.x) > 160;
      if (floored && bodyBetweenMeAndCenter && chance(0.5)) return [move(toward, (m, o) => (o.x - m.x) * toward < -46), move(0, 4)];   // step over it
      const timeLeft = (o) => (1 - o.rig.current.t) * GETUP_MS;
      if (opp.state === 'getup') {
        const left = timeLeft(opp);
        // startups after the 50ms pre-roll: cross ~117ms, jab ~42ms; press so the active frames meet the rise
        // one plan, no think gap: wait on his getup clock, then press
        if (left <= 60) return [attack(dist < r('jab') + 10 ? 'jab' : 'cross')];
        const press = [move(0, (m, o) => o.state !== 'getup' || timeLeft(o) < 128), attack('cross')];
        if (dist >= r('cross')) return [move(toward, closer(r('cross') - 10), true), ...press];
        return press;
      }
      const k = rng();
      if (dist > 95) return [move(toward, 4), move(0, 4)];
      if (dist < 50) return [move(-toward, 3), move(0, 4)];
      if (k < 0.5) return [move(toward, 3), move(-toward, 3)];        // shuffle over him
      if (k < 0.7) return [move(toward, 2), blockFor(2), move(0, 3)]; // feint
      return [move(0, 4 + irnd(4))];
    }
    const losing = !rush && me.health < 0.3 * sim.startHealth && me.health < opp.health;
    if (grap && dist < 95 && !opp.crouch && me.stamina > 15 && chance(0.4)) return [move(toward, closer(78)), attack('throw')];
    if (losing && dist < 170 && !cornered && !wellBehindMe(well(me, sim), me, opp) && chance(0.4)) return [move(-toward, 10, chance(0.3))];
    if (dist > (show ? 230 : turtle ? 140 : 175)) return approach(me, opp, dist, toward);
    const aggression = Math.max(0.1, Math.min(0.95, 0.3 + 0.5 * difficulty + (rush ? 0.3 : turtle ? -0.2 : 0)));
    // spent: stay out and let the meter come back
    if (me.stamina < (show ? 38 : 28) || me.gassed > 0) return dist < 200 && !cornered && !wellBehindMe(well(me, sim), me, opp) ? [move(-toward, 10)] : [blockFor(10)];
    // the stairwell: send him over the railing when he's by it; never back up into it myself
    const w = well(me, sim);
    if (wellBeyond(w, me, opp) && me.stamina > 30 && chance(0.35 + 0.45 * difficulty + (grap ? 0.3 : 0))) {
      if (dist < 95) return [move(toward, closer(78)), attack('throw')];   // a throw toward the opening goes over
      if (dist > 140 && dist < 320) return [move(toward, (m, o) => Math.abs(o.x - m.x) < 150, true), { ...move(toward, 2, true), attack: 'cometCross' }];
      if (dist < r('spinKick') && chance(0.4)) return [attack('spinKick')];
      if (dist < r('jab') + 10) return [press('1')];   // into 1,2,3,4 Neon Tornado or 2,1,4 when it lands
      return [move(toward, closer(r('jab')), true), press('2')];
    }
    if (wellBehindMe(w, me, opp) && chance(0.6)) return dist < r('jab') + 10 ? [attack(pick(['jab', 'lowKick', 'throw']))] : [move(toward, 6, true)];
    // the wall is behind him: go for the wall payoffs
    const wallBehind = (toward > 0 ? sim.bounds.x1 - opp.x : opp.x - sim.bounds.x0) < 220;
    if (wallBehind && me.stamina > 35 && chance(0.35 + 0.4 * difficulty)) {
      const k = rng();
      if (k < 0.35 && dist < r('spinKick')) return [attack('spinKick')];
      if (k < 0.6 && dist > 140 && dist < 320) return [move(toward, (m, o) => Math.abs(o.x - m.x) < 150, true), { ...move(toward, 2, true), attack: 'cometCross' }];
      if (k < 0.8 && dist < 100) return [move(toward, closer(80)), attack('throw')];
      if (dist < r('cross')) return [press('2')];   // 2,1,4 Spin Heel when it lands
    }
    // he's crouching: mids, the overhead, or a jump-in dive kick from range; a standing guard: lows
    // (a d+1,d+1,d+3 crouch string) and throws
    if (opp.crouch && dist < r('lkick') + 10 && chance(0.6)) return [attack(pick(['lkick', 'bodyBlow', 'overhead', 'uppercut']))];
    if (opp.backHeld && !opp.crouch && dist < r('lowJab') && me.stamina > 25 && chance(0.35)) return [press('d1')];
    if (show) {
      // string starters at every height (the follow-up reflex carries them on), a launcher up
      // close, a throw on a standing guard; otherwise work the spacing
      if (chance(0.5)) {
        const opts = [];
        if (dist < r('jab')) opts.push('1', '2', '3', '3', 'd1', 'd3', 'd3', 'bodyBlow', 'overhead');
        if (dist < r('jab') - 15) opts.push('d2');
        if (dist >= r('jab') && dist < r('cross')) opts.push('2', 'lungeCross');
        if (dist < r('roundhouse')) opts.push('roundhouse');
        if (dist < 95 && !opp.crouch && chance(0.4)) opts.push('throw');
        if (opts.length) { const o = pick(opts); return [/^d?[1-4]$/.test(o) ? press(o) : attack(o)]; }
      }
      return spacing(me, opp, dist, toward);
    }
    if (chance(aggression)) {
      const options = [];
      if (opp.backHeld && dist < r('lowKick')) options.push('lowKick', 'lowJab', 'throw');
      if (dist < r('jab') - 10) options.push('uppercut');
      if (dist < r('lowJab')) options.push('lowJab', 'lowJab');   // starts d+1,d+1,d+3 (the follow-up continues it)
      if (dist < r('jab')) options.push('jab', 'jab', 'jab', 'cross', 'lkick');
      if (dist < r('jab') - 20) options.push('uppercut');
      if (dist < r('cross')) options.push('cross', 'cross');
      if (dist >= r('cross') - 10 && dist < r('lungeCross')) options.push('lungeCross');
      if (dist < r('roundhouse') && chance(0.5)) options.push('roundhouse');
      if (dist < r('sweep') && chance(0.5)) options.push('sweep');
      if (options.length) return [attack(pick(options))];
      return [move(toward, 4)];
    }
    return footsies(toward);
  }

  function think(me, opp, sim) {
    if (!(sim.phase === 'fight' || sim.phase === 'ko' || sim.phase === 'match')) return EMPTY_INPUT;
    const step = sim.stepCount; lastStep = step;
    // KO and WINS cards: the winner keeps living, a slow walk out and back with pauses
    if (sim.phase !== 'fight' && (opp.hidden || opp.koDone)) {
      const ph = Math.floor(step / 48) % 4;
      return { ...EMPTY_INPUT, dx: ph === 0 ? me.facing : ph === 2 ? -me.facing : 0 };
    }
    const toward = Math.sign(opp.x - me.x) || me.facing;
    const dist = Math.abs(opp.x - me.x);
    if (me.attackId !== seenAttackId) { seenAttackId = me.attackId; lastAttackStep = step; }
    if (me.state === 'hitstun' && opp.attackId !== lastHitTakenId) { lastHitTakenId = opp.attackId; myRun = 0; }

    // bookkeeping: was my last attack blocked or did it land? (decided the tick it connects)
    if (me.state === 'attack' && me.hitConfirmed && me.attackId !== lastBlockedId) {
      lastBlockedId = me.attackId;
      lastHitBlocked = opp.state === 'blockstun';
      // on block a string may keep going (a mixup of its own), less often and never into a blocked ender
      if (lastHitBlocked && me.seq && chance(0.3 * difficulty)) { const st = chooseString(me, opp, sim, true); if (st && !FRAME_DATA[st.moves[me.seq.length]].ender) { queue = [press(st.keys[me.seq.length])]; act = null; lastFollowed = me.attackId; } }
      if (lastHitBlocked) { blockedStreak++; blockedClasses.add(CLASS[me.move] || 'punch'); }
      else { blockedStreak = 0; blockedClasses = new Set(); myRun++; }
    }
    // reflex: I just launched him: the plan is made now, not when he lands. Run to the spot
    // he will land (stand 60px short), and press the stomp so it is active at touchdown.
    if (opp.state === 'knockdown' && !opp.grounded && !opp.juggle && !opp.rag && opp.launchedBy === me.id && opp.launchStep !== plannedLaunch) {
      plannedLaunch = opp.launchStep;
      // a floored body lies 45-180px past its root, away from the hit, and the sweep's foot
      // reaches 75px: stand 30px past the landing root, over the body
      const target = (m, o) => landX(o, m.y);
      queue = [
        { dx: (m, o) => { const d = target(m, o) - m.x; return Math.abs(d) < 10 ? 0 : Math.sign(d); }, run: true, block: false, attack: null, jump: false,
          until: (m, o) => o.state !== 'knockdown' || landTime(o, m.y) * 120 <= SWEEP_STEPS },
        attack('sweep'),
      ];
      act = queue.shift();
    }
    // reflex: my hit connected clean, cancel into the follow-up
    if (me.state === 'attack' && me.hitConfirmed && !lastHitBlocked && me.attackId !== lastFollowed) {
      lastFollowed = me.attackId;
      // strings of 2 to 4: jab, jab, cross, then a finisher; the chance to keep going rises with difficulty
      // continue whichever string this hit can belong to (the strings above), picked once per string
      // continue the string this hit belongs to (the sim's string table) with the next button;
      // length grows with difficulty, and a low meter stops it
      const st = (me.seq && pickedString && matchStrings(me.seq).includes(pickedString)) ? pickedString : chooseString(me, opp, sim, false);
      pickedString = st;
      const n = me.seq ? me.seq.length : 1;
      if (st && n < st.keys.length && n < 1 + Math.round(3 * difficulty) + (FRAME_DATA[st.moves[st.moves.length - 1]].ender ? 1 : 0) && me.stamina > (FRAME_DATA[st.moves[n]].cost || 9) + 8 && chance(0.55 + 0.45 * difficulty)) { queue = [press(st.keys[n])]; act = null; }
      // a juggle: keep it in the air with jabs when no string continues
      else if (opp.state === 'knockdown' && opp.juggle && (opp.airHits || 0) < 4) { queue = [press('1')]; act = null; }
    }
    // reflex: block or counter a visible startup, once per opponent attack
    // (an air attack from a jump-in I've read is left to the anti-air below)
    const readingJump = aaFor === opp.jumpAt && !opp.grounded && FRAME_DATA[opp.move] && FRAME_DATA[opp.move].air;
    if (opp.state === 'attack' && opp.phase === 'startup' && opp.attackId !== lastReactedTo && !readingJump && dist < reach(opp.move) + (show ? 90 : 30)) {
      lastReactedTo = opp.attackId;
      // read the height: duck a high (and rise into a launcher), down-back a low, stand guard a mid;
      // a misread guesses, so mixups work on the AI too
      const h = heightOf(opp.move), read = chance(show ? 0.8 : 0.25 + 0.5 * difficulty);
      const guess = read ? h : pick(['high', 'mid', 'low']);
      // showcase: at the tip of his reach, step back so it whiffs (the punish reflex takes it from there)
      if (show && dist > reach(opp.move) - 20 && opp.move !== 'throw' && chance(0.45)) { queue = [move(-toward, 10 + irnd(6))]; act = null; }
      else if (chance(show ? 0.85 : 0.1 + 0.65 * difficulty + (turtle ? 0.25 : rush ? -0.1 : 0))) {
        if (guess === 'high' || guess === 'throw') queue = dist < reach('risingKnee') + 10 && chance(0.6) ? [duck(16 + irnd(6)), { ...press(chance(0.5) ? '4' : '2'), ok: true }] : [duck(18 + irnd(8))];
        else if (guess === 'low') queue = [lowGuard(18 + irnd(10))];
        else queue = [blockFor(18 + irnd(10))];
        act = null;
      }
      else if (dist < reach('jab') && chance((show ? 0.1 : 0.35) * difficulty)) { queue = [{ ...attack('jab'), ok: true }]; act = null; }
    }
    // reflex (showcase): his strike whiffed and he's stuck in recovery: punish it, a string
    // starter or the launcher up close, the lunge from further, Comet Cross from a dash
    if ((show || turtle) && opp.state === 'attack' && opp.phase === 'recovery' && !opp.hitConfirmed && opp.attackId !== lastPunish && /^(idle|walk|block|crouch)$/.test(me.state) && me.stamina > 15) {
      lastPunish = opp.attackId;
      if (chance(0.85)) {
        if (dist < reach('jab') - 12) queue = [press(pick(['d2', '2', '1']))];
        else if (dist < reach('cross') + 6) queue = [press('2')];
        else if (dist < reach('lungeCross') + 6) queue = [attack('lungeCross')];
        else if (dist < 300) queue = [move(toward, closer(reach('cross')), true), chance(0.4) ? { ...move(toward, 2, true), attack: 'cometCross' } : press('2')];
        act = null;
      }
    }
    // reflex: he jumped at me. A CPU that reads it (the better it is the more often; never at the
    // bottom of the ladder, so INTERN still gets jumped on) drops its plan, stands its ground and
    // meets him: the uppercut as he comes into its reach (a counter hit that launches), or a jab if
    // he is already on top of it with a strike out. Decided once per jump, at takeoff.
    const oppAir = !opp.grounded && (opp.state === 'jump' || (opp.state === 'attack' && FRAME_DATA[opp.move] && FRAME_DATA[opp.move].air));
    if (oppAir && !opp.rag && opp.jumpAt !== aaSeen && Math.sign(opp.vx || -toward) === -toward && dist < 380 && /^(idle|walk|block|crouch|run)$/.test(me.state)) {
      aaSeen = opp.jumpAt;
      if (chance(aaReadChance())) { aaFor = opp.jumpAt; me.aaJump = opp.jumpAt; queue = antiAir(); act = null; }
    }
    // the old reflex: an uppercut on the way in now and then (once per jump)
    if (oppAir && opp.vy > (show ? -260 : -120) && dist < (show ? 140 : 125) && Math.sign(opp.vx || -toward) === -toward && me.aaJump !== opp.jumpAt && /^(idle|walk|block|crouch)$/.test(me.state)) {
      me.aaJump = opp.jumpAt;
      if (chance(show ? 0.7 : 0.15 + 0.65 * difficulty)) { queue = [{ ...press('d2'), ok: true }]; act = null; }
      else if (show) { queue = [blockFor(24)]; act = null; }   // air attacks are overheads: a standing guard
    }
    // reflex: grabbed: break with 1+3 (or 2+4) after a human-ish delay, decided once per grab
    if (me.state === 'grabbed' && me.grabId !== opp.attackId) {
      me.grabId = opp.attackId;
      if (chance(show ? 0.5 : 0.15 + 0.55 * difficulty)) { queue = [move(0, 4 + irnd(16)), { ...press('1'), lk: true, ok: true }]; act = null; }
    }
    // stamina: low or gassed, back off and let it come back (a beat of guard if he presses)
    if ((me.gassed > 0 || me.stamina < (show ? 38 : 28)) && !queue.length && /^(idle|walk|block)$/.test(me.state) && opp.state !== 'hitstun' && !DOWN_STATES.has(opp.state)) {
      const cornered = me.x - sim.bounds.x0 < 90 || sim.bounds.x1 - me.x < 90 || wellBehindMe(well(me, sim), me, opp);
      queue = opp.state === 'attack' && dist < 200 ? [blockFor(14)] : cornered ? [blockFor(16)] : [move(-toward, 12 + irnd(10))]; act = null;
    }
    // reflex: swing back on the way out of hitstun instead of resetting to range
    // (once per opponent attack; the jab is the fast one and his extended arm is in its reach)
    if (me.state === 'hitstun' && Math.abs(me.vx) < 420 && dist < reach('cross') + 20 && opp.attackId !== lastCounter) {
      lastCounter = opp.attackId;
      if (me.stamina > 18 && chance(show ? 0.2 : 0.55 + 0.6 * difficulty)) { queue = [attack(dist < reach('jab') + 45 ? 'jab' : 'cross')]; act = null; }
      else if (show && chance(0.6)) { queue = [blockFor(14)]; act = null; }   // respect his advantage
    }
    // reflex: floored with him standing over me: roll away (once per knockdown)
    // (an escape from the stomp, so only before a ground hit has landed)
    if (me.state === 'down' && !me.otgHit && dist < 110 && me.rollId !== opp.attackId) {
      me.rollId = opp.attackId;
      if (chance(0.06 + 0.12 * difficulty)) { queue = [{ ...move(-toward, 3), roll: true }]; act = null; }
    }
    // reflex: in range and nobody has swung for a while: swing
    // (a plan in progress, like a jump-in or a step into kick range, is left alone)
    const staleGap = show ? 60 : turtle ? 48 : 24;
    if (dist < 120 && me.stamina > 25 && step - lastAttackStep > staleGap && step - lastStale > staleGap && !queue.length && /^(idle|walk|block)$/.test(me.state) && opp.state !== 'attack' && !DOWN_STATES.has(opp.state)) {
      lastStale = step;
      queue = (opp.state === 'block' || blockedStreak >= 1) ? mixup(dist, toward, opp) : show ? [opener(opp, dist)] : [attack(dist < reach('jab') + 10 ? 'jab' : 'cross')]; act = null;
    }
    if (act && act.block && typeof act.until === 'number' && act.until > 4 && opp.state !== 'attack' && !HIT_STATES.has(opp.state)) act.until = 4;

    const done = !act || (typeof act.until === 'function' ? act.until(me, opp) : act.until <= 0);
    if (done) {
      if (queue.length) { act = queue.shift(); if (act.onlyIf && !act.onlyIf(me, opp)) act = null; }
      // no re-deciding during my own attack (each new plan would overwrite the buffered press);
      // over a downed body it is allowed, for the meaty cancel out of the stomp
      else if (step >= nextThink && (me.state !== 'attack' || DOWN_STATES.has(opp.state))) {
        queue = decide(me, opp, sim, dist, toward); act = queue.shift();
        // against a guard, think again fast so there is never a still beat
        const guarding = opp.state === 'block' || opp.state === 'blockstun';
        nextThink = step + (guarding ? 2 : Math.max(2, 4 + Math.round(6 * (1 - difficulty)) + irnd(3) - (rush ? 2 : 0)));
      }
      else act = null;
    }
    // catch-all: after two blocked hits, never the same class again until a different one lands
    if (act && act.attack && blockedStreak >= 2 && blockedClasses.has(CLASS[act.attack])) { queue = mixup(dist, toward, opp); act = queue.shift(); }
    // showcase: never swing into his strike that is already coming; guard it at its height
    // (a counter after a duck, the anti-air and the jab interrupt are marked ok)
    if (show && act && (act.attack || act.press || act.pressFn) && !act.ok && opp.state === 'attack' && opp.phase !== 'recovery' && dist < reach(opp.move) + 40 && /^(idle|walk|block|crouch|run)$/.test(me.state)) {
      act = heightOf(opp.move) === 'low' ? lowGuard(14) : blockFor(14); queue = [];
    }
    // showcase: an expert doesn't swing himself into the gassed state; under 30 he backs off to breathe
    else if (show && act && (act.attack || act.press || act.pressFn) && !act.ok && me.stamina < 30 && !DOWN_STATES.has(opp.state)) {
      act = dist < 200 ? move(-toward, 12) : blockFor(10); queue = [];
    }
    const out = { ...EMPTY_INPUT };
    if (!act && dist < 140 && (opp.state === 'block' || opp.state === 'blockstun') && /^(idle|walk)$/.test(me.state)) {
      out.dx = (Math.floor(step / 6) % 2) ? toward : -toward;   // a shuffle between thinks, not a stand
    }
    if (act) {
      out.dx = typeof act.dx === 'function' ? act.dx(me, opp) : act.dx; out.run = act.run; out.block = act.block; out.jump = act.jump;
      if (/^(down|getup|knockdown|roll)$/.test(me.state) && !act.roll) out.dx = 0;   // on the floor a direction means roll: only when meant
      if (act.attack) out[act.attack] = true;
      if (act.down) out.down = true;
      if (act.lk) out.lk = true;
      if (act.pressFn && !act.pressed) { act.press = act.pressFn(me, opp); act.pressed = true; }
      if (act.press) { const t = act.press; out[BTN[t[t.length - 1]]] = true; if (t[0] === 'd') out.down = true; }
      if (me.stamina < (show ? 55 : 40) && !act.attack) out.run = false;   // running drains the meter: walk when it's low
      if (typeof act.until === 'number') act.until--;
      else if (act.until(me, opp)) act = null;
      if (act && (act.attack || act.jump || act.press) && typeof act.until === 'number' && act.until <= 0) act = null;
    }
    return out;
  }
  think.debug = () => ({ mixLog, blockedStreak, lastBlockedId, queue: queue.map(a => a.attack || (a.jump ? 'jump' : 'move')), act: act && (act.attack || (act.block ? 'block' : 'move')) });
  think.setDifficulty = (d) => { difficulty = Math.max(0, Math.min(1, d)); };
  think.getDifficulty = () => difficulty;
  think.style = style;
  return think;
}
