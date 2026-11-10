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
//
// Human-paced (see perceive below): every reflex that answers the opponent (the startup guard, duck and
// parry, the whiff and botch punishes, the anti-air reads, the wake-up answer, the hitstun swing-back,
// the reflex specials) sees him as he was `lag` sim steps ago, a person's 180-330 ms to notice a move.
// A strike whose startup is shorter lands before it's seen, so up close the CPU holds a guard on a hunch
// now and then (the habit guard) instead of blocking everything on sight. After a combo of 3+ hits, or
// while it leads by 30% of the bar, it takes a breath (0.4-0.7 s of walking, guarding and spacing).
// All of it runs on sim step counts and the sim's rng, so a scene replays identically.

import { EMPTY_INPUT } from './input.js';
import { matchStrings } from './strings.js';
import { FRAME_DATA, AIR_TECH, STAMINA } from './frameData.js';
import { stairRoute } from './stairNav.js';

const DOWN_STATES = new Set(['knockdown', 'down', 'getup', 'ko']);
const STICK_DWELL = 16;   // steps (120Hz) the CPU's stick direction holds before it may change: ~133 ms, a person's reversal
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
  let counterFor = -1, counterAt = 0;   // the hit of his I may swing back at, and the step I notice it
  let nextThink = 0, lastReactedTo = -1, lastFollowed = -1, lastCounter = -1, lastBlockedId = -1, lastHitBlocked = false, blockedStreak = 0, mixupTurn = 0;
  let seenAttackId = -1, lastAttackStep = -9999, lastStale = -9999, myRun = 0, lastHitTakenId = -1;
  let plannedLaunch = -1, blockedClasses = new Set(), stringPick = null, lastPunish = -1, lastFaintPunish = -1;
  const mixLog = []; let lastStep = 0;
  // anti-air reads: the chance to read a jump-in at takeoff (0 at difficulty 0.3 and below), the
  // jump last looked at and the one being answered
  const aaReadChance = () => (show ? 0.75 : Math.max(0.12, Math.min(0.65, (difficulty - 0.3) * 0.9 + (aerial ? 0.15 : 0))));   // a 12% floor: even the INTERN sometimes swats a jump-in
  let aaSeen = -1, aaFor = -1;
  // perception: the reflexes see him as he was `lag` steps ago (330 ms at difficulty 0.2 down to 180 ms at
  // 1.0, the showcase 20 ms quicker, never under 160), give or take a fifth, re-rolled after each reaction.
  // A ring of shallow copies of him, one a step; a new opponent or a step count that went back (a new
  // round or match) starts it over. Scalars are his past; nested objects (the rig) are his present.
  const SEEN_N = 64, seenRing = Array.from({ length: SEEN_N }, () => ({})), seenStep = new Array(SEEN_N).fill(-1);
  let seenHead = -1, seenOpp = null;
  const baseLag = () => Math.round(Math.max(160, 330 - 150 * (Math.max(0.2, Math.min(1, difficulty)) - 0.2) / 0.8 - (show ? 20 : 0)) * 0.12);
  let lag = baseLag();
  const relag = () => { const b = baseLag(); lag = b + irnd(Math.max(1, Math.round(b * 0.2))); };
  function perceive(opp, step) {
    if (opp !== seenOpp || (seenHead >= 0 && step < seenStep[seenHead])) { seenStep.fill(-1); seenHead = -1; seenOpp = opp; }
    seenHead = (seenHead + 1) % SEEN_N; Object.assign(seenRing[seenHead], opp); seenStep[seenHead] = step;
    let best = seenHead;   // the newest record at least `lag` steps old, else the oldest kept
    for (let i = 1; i < SEEN_N; i++) { const k = (seenHead - i + SEEN_N) % SEEN_N; if (seenStep[k] < 0 || step - seenStep[best] >= lag) break; best = k; }
    return seenRing[best];
  }
  // what I saw is still what he's doing: the same strike in the same phase (a reaction to a strike that
  // has already landed or ended is too late to matter, and is dropped)
  const still = (saw, opp) => saw.state === opp.state && (saw.state !== 'attack' || (saw.attackId === opp.attackId && saw.phase === opp.phase));
  // breathing room: after a combo of 3+ hits or while well ahead, hold back for 0.4-0.7 s before pressing again;
  // the top of the ladder skips it more often (the showcase most)
  let comboRun = 0, breatheUntil = -1, breatheTry = -9999, oppSwungAt = -9999, seenOppAid = -1;
  const breathe = (step) => { breatheTry = step; if (chance(show ? 0.4 : 1 - 1.5 * Math.max(0, difficulty - 0.7))) breatheUntil = step + 48 + irnd(36); };
  // botches (src/combat/botch.js): a CPU mostly waits for a clean press; the lower its difficulty the more
  // often it lets a mistimed one go (and mashes on its own now and then), so the bottom of the ladder
  // shows the system off; the showcase never botches but now and then lands a happy accident
  const slipChance = (me) => (show ? 0 : Math.min(0.6, 0.45 * (1 - difficulty) * (1 - difficulty) + (me.char && me.char.id === 'intern' && difficulty < 0.5 ? 0.08 : 0)));   // the ladder's INTERN swings like it
  let mashFor = -1, mashAt = -1, mashTok = null, accFor = -1, lastBotchSeen = -1;
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
  // knocked down: when to get up and how (stand, roll, a wake-up strike, or lie there until the clock stands
  // him up), picked once per knockdown; a strike coming at the body or a whiff over it can change the plan
  let downFor = -1, downSeen = -1, stompGuard = -1;
  // the stick a human hand holds: the direction (and run) last sent and when it last changed (see STICK_DWELL)
  let stickDx = 0, stickRun = false, stickAt = -999;
  // falling: the air recovery out of a juggle (once per hit, the step to press it), a second jab on the way
  // down after a whiffed air attack (once per jump), an air attack out of the vault's drop (once per vault)
  let techFor = -1, techAt = -1, fallFor = -1, vaultFor = -1;
  // Shaking off a faint (sim.js shakeOff: alternating fresh left/right presses at least STAMINA.shakeGap
  // apart): decided once per faint, whether it shakes at all (always for the showcase, 45% at the bottom of
  // the ladder up to 95% at the top) and its rhythm, a press every 14 to 16 steps for the showcase (the best
  // rate is 12) up to about 30 to 44 at the bottom, after a reaction time. Each press is held half its beat
  // then let go; the lower the difficulty the more often it presses the same way twice (a shake that
  // doesn't count) or misses a beat.
  let shakeFor = -1, shakeNext = -1, shakeDir = 0, shakeBeat = 0, shakeOn = false;
  function shakeOff(me, out, step) {
    for (const k in out) out[k] = k === 'touch' ? out[k] : typeof out[k] === 'boolean' ? false : 0;
    if (me.faintAt !== shakeFor) {
      shakeFor = me.faintAt; shakeDir = chance(0.5) ? 1 : -1;
      shakeOn = show || chance(0.45 + 0.5 * difficulty);
      shakeBeat = show ? 14 : 14 + Math.round(22 * (1 - difficulty));
      shakeNext = step + lag;
    }
    if (!shakeOn) return;
    if (step >= shakeNext) {
      const sloppy = show ? 0 : 0.3 * (1 - difficulty);
      if (!chance(sloppy)) shakeDir = -shakeDir;   // sloppy: the same way again
      shakeNext = step + shakeBeat + irnd(show ? 3 : 3 + Math.round(10 * (1 - difficulty))) + (chance(sloppy * 0.5) ? shakeBeat : 0);
    }
    const beat = shakeNext - step;
    out.dx = beat > (shakeBeat >> 1) ? shakeDir : 0;
  }
  function wakePlan(me, opp) {
    const hip = me.rig.joints.hip.x, away = -(Math.sign(opp.x - hip) || 1), near = Math.abs(opp.x - hip) < 175 && opp.grounded;
    const k = rng(), wait = 10 + irnd(show ? 60 : 12 + Math.round(70 * difficulty));
    if (k < 0.05 + 0.35 * (1 - difficulty) && !show) return [];   // lie there: the clock stands him up
    const r = rng();
    if (near && r < 0.18 + 0.27 * difficulty) return [move(0, wait), attack(chance(0.55) ? 'wakeKick' : 'wakeSweep')];
    if (r < 0.72) return [move(0, wait), { ...move(0, (m) => m.state !== 'down'), jump: true }];   // up: stand in place
    return [move(0, wait), { ...move(chance(0.65) ? away : -away, 3), roll: true }];
  }
  // the string table of the character this CPU plays (src/characters/), the shared one for TEMP
  const strs = (me) => (me.char && me.char.strings) || undefined;
  // A character's specials (its definition's ai.specials): { move, min, max, chance, when, run, cooldown }.
  // In range [min, max] (px between roots) and when `when` holds (a function (me, opp, sim, dist), or one
  // of 'standing' 'crouching' 'guarding' 'attacking' 'whiff' 'wall' 'far'), it's pressed with that chance;
  // a little short of range it walks (or runs, run: true) in first. cooldown: frames before it's tried
  // again. TEMP has none, so its CPU is unchanged (no extra rng calls).
  const coolUntil = {};
  const WHEN = {
    standing: (m, o) => o.grounded && !o.crouch && !DOWN_STATES.has(o.state),
    crouching: (m, o) => !!o.crouch,
    guarding: (m, o) => o.state === 'block' || o.state === 'blockstun' || (!!o.backHeld && o.grounded),
    attacking: (m, o) => o.state === 'attack' && o.phase === 'startup',
    whiff: (m, o) => o.state === 'attack' && o.phase === 'recovery' && !o.hitConfirmed,
    wall: (m, o, sim) => Math.min(o.x - sim.bounds.x0, sim.bounds.x1 - o.x) < 220 && Math.sign(o.x - m.x) === Math.sign((o.x - sim.bounds.x0 < sim.bounds.x1 - o.x ? sim.bounds.x0 : sim.bounds.x1) - o.x),
    far: (m, o) => Math.abs(o.x - m.x) > 160,
  };
  function special(me, opp, sim, dist, toward, reflex = false) {
    const list = me.char && me.char.ai && me.char.ai.specials;
    if (!list || !list.length || me.faint > 0) return null;
    for (const sp of list) {
      if (!!sp.reflex !== reflex) continue;   // reflex: true specials are checked every step (think), the rest when deciding
      const key = sp.move || sp.name;   // a plan (sp.plan) may have no single move: its name keys the cooldown
      if ((coolUntil[key] || 0) > sim.stepCount) continue;
      const fd = FRAME_DATA[sp.move];
      if (sp.plan ? me.stamina - (sp.cost || (fd && fd.cost) || 8) <= 6 : !fd || me.stamina - fd.cost <= 6) continue;
      const min = sp.min || 0, max = sp.max || 120, lead = sp.lead != null ? sp.lead : 90;
      if (dist < min || dist > max + lead) continue;
      const w = typeof sp.when === 'function' ? sp.when : sp.when ? WHEN[sp.when] : null;
      if (w && !w(me, opp, sim, dist)) continue;
      if (!chance((sp.chance != null ? sp.chance : 0.3) * (0.5 + 0.5 * difficulty))) continue;
      coolUntil[key] = sim.stepCount + (sp.cooldown || 90);
      // plan(me, opp, sim, dist, toward, kit): the special's own list of acts (an air jump, a wall jump: inputs a single press can't make)
      if (sp.plan) { const p = sp.plan(me, opp, sim, dist, toward, { move, attack, press, blockFor, closer, landed, chance }); if (p && p.length) return p; continue; }
      const go = { ...attack(sp.move), ok: true };
      return dist <= max ? [go] : [move(toward, closer(max - 6), !!sp.run), go];
    }
    return null;
  }
  // the stairwell (v3): a live opening on this floor, and where it is relative to the two of us; of the two
  // openings, the one nearest `at` (him, to send him over its rail; me, not to back into it)
  function well(me, sim, at = me) {
    const sw = sim.wellNear ? sim.wellNear(at.x) : sim.stairwell;
    if (!sw || sw.toFloor == null || sim.floorBroken || sim.horde || (me.floor || 0) !== 0 || (sim.onStair && sim.onStair(me))) return null;
    if (show && (sim.roundClock || 0) < 14) return null;   // the demo saves the floor break for later in the round
    return { sw, cx: (sw.x0 + sw.x1) / 2 };
  }
  // he's near the opening and it lies beyond him (my push sends him toward it)
  const wellBeyond = (w, me, opp) => !!w && Math.abs(opp.x - w.cx) < 230 && Math.sign(w.cx - opp.x) === Math.sign(opp.x - me.x);
  // it's behind me and close: don't back up into it
  const wellBehindMe = (w, me, opp) => !!w && Math.abs(me.x - w.cx) < 200 && Math.sign(w.cx - me.x) === -Math.sign(opp.x - me.x);
  // which string to run from here: enders when there is stamina for them, a wall ender near a wall
  function chooseString(me, opp, sim, blocked) {
    if (!me.seq) return null;
    const m = matchStrings(me.seq, strs(me)).filter(st => st.keys.length > me.seq.length);
    if (!m.length) return null;
    const wallNear = (opp.x - sim.bounds.x0 < 230 && opp.x < me.x) || (sim.bounds.x1 - opp.x < 230 && opp.x > me.x);
    const score = (st) => {
      const last = FRAME_DATA[st.moves[st.moves.length - 1]] || {};
      let w = 1 + rng();
      // an ender only when the rest of the string fits in the bar (the last point faints); on a clean hit the
      // rest will connect too, and each press gives back refundHit of its price (README, Stamina)
      if (last.ender) w += me.stamina > restCost(st, me.seq.length) * (blocked || !me.hitConfirmed ? 1 : 1 - STAMINA.refundHit) + 4 && !me.faint ? 1.2 * difficulty : -3;
      if (last.splat && wallNear) w += 2;
      if (wellBeyond(well(me, sim, opp), me, opp) && (last.juggle || last.splat || (last.kb && last.kb.x >= 400))) w += 2.5;
      if (blocked && last.ender) w -= 1.5;   // a blocked string ends early more often
      return w;
    };
    return m.reduce((a, b) => (score(b) > score(a) ? b : a));
  }
  // stamina: what the rest of a string costs from press n on, and what an act's press will cost
  const restCost = (st, n) => st.moves.slice(n).reduce((t, m) => t + ((FRAME_DATA[m] && FRAME_DATA[m].cost) || 20), 0);
  const PLAIN = { 1: 'jab', 2: 'cross', 3: 'lkick', 4: 'roundhouse', d1: 'lowJab', d2: 'uppercut', d3: 'lowKick', d4: 'sweep' };
  function actCost(me, a) {
    if (a.attack) return (FRAME_DATA[a.attack] && FRAME_DATA[a.attack].cost) || 20;
    const tok = a.press;
    if (!tok) return 22;   // a press picked on the spot (pressFn): about a kick
    let m = PLAIN[tok];
    if (me.seq && me.state === 'attack') { const st = matchStrings([...me.seq, tok], strs(me)); if (st.length) m = st[0].moves[me.seq.length]; }
    return (FRAME_DATA[m] && FRAME_DATA[m].cost) || 20;
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
    if (grap && k < 0.2 + 0.2 * difficulty) return [move(toward, closer(80), true), attack('throw')];
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

  function decide(me, opp, sim, dist, toward, saw) {
    const r = (m) => reach(m);
    const cornered = me.x - sim.bounds.x0 < 70 || sim.bounds.x1 - me.x < 70;
    // open, as I saw him and still: a whiff's recovery, or a botch (as open as a whiff)
    const recovering = ((saw.state === 'attack' && saw.phase === 'recovery') || saw.state === 'botch') && still(saw, opp);

    if (HIT_STATES.has(opp.state) && me.state !== 'attack') {
      if (opp.state === 'blockstun' && blockedStreak >= 2) return mixup(dist, toward, opp);
      // a beat of guard now and then, and after two straight hits, so his counter has something to run into
      if (opp.state === 'hitstun' && (chance(0.25) || (myRun >= 2 && chance(0.6)))) { myRun = 0; return [blockFor(10 + irnd(6))]; }
      if (show) return dist < r('cross') ? [opener(opp, dist)] : [move(toward, closer(r('jab')), true), opener(opp, r('jab') - 1)];
      if (dist < r('cross')) return [attack(dist < r('jab') ? pick(['jab', 'cross', 'cross']) : 'cross')];
      return [move(toward, closer(r('cross') - 8), true), attack(chance(0.6) ? 'cross' : 'jab')];
    }
    if (blockedStreak >= 2 && dist < r('cross') + 40) return mixup(dist, toward, opp);
    { const sp = special(me, opp, sim, dist, toward); if (sp) return sp; }   // the character's own moves
    // jump-ins: a dive kick on a croucher, and now and then from jump range (the anti-air game)
    const free = !DOWN_STATES.has(opp.state) && opp.state !== 'attack' && !HIT_STATES.has(opp.state) && me.stamina > 45;   // the jump, the air attack and a string after it
    if (free && opp.crouch && dist > 100 && dist < 240 && chance(0.6)) return jumpIn(toward, 'jab');
    if (free && dist > 110 && dist < (aerial ? 300 : 230) && chance(show ? 0.3 : aerial ? 0.55 : 0.12 + 0.12 * difficulty)) return jumpIn(toward, 'jab');
    if (recovering && dist < r('roundhouse') + 8 && me.stamina > 26 && chance((opp.hitConfirmed ? 0.2 : 0.3) + 0.45 * difficulty)) {
      return [attack(dist < r('cross') - 5 ? 'cross' : 'roundhouse')];
    }
    // breathing room: walk off, stand, or drift, with no swing of my own (an opening above is still taken). It's
    // room for him, so a guard is rare and short (a wall of guard would be the opposite)
    if (sim.stepCount < breatheUntil) {
      const k = rng();
      if (k < 0.55 && dist < 200 && !cornered && !wellBehindMe(well(me, sim), me, opp)) return [move(-toward, 14 + irnd(10))];
      if (k < 0.85) return [move(0, 10 + irnd(10))];
      if (k < 0.92) return [blockFor(10)];
      return [move(chance(0.5) ? toward : -toward, 8 + irnd(8))];
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
      // a ground hit, once per knockdown: the stomp (real damage, but a body that rises through it punishes the
      // whiff) when it reaches, now and then the old low poke at the feet; otherwise wait over him, guard up
      if (floored && !opp.otgHit) {
        if (sim.stompOK && sim.stompOK(me) && me.stamina > 30 && chance(0.3 + 0.35 * difficulty)) return [attack('stomp')];
        if (chance(0.25)) return dist < 40 ? [attack('sweep')] : [move(toward, closer(36), true), attack('sweep')];
        if (chance(0.25 + 0.4 * difficulty)) return [blockFor(10 + irnd(10))];
      }
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
      // human-scale beats: a step is ~20 steps (170 ms), a pause longer (each used to be 2 to 4 steps, a seizure)
      if (dist > 95) return [move(toward, 18), move(0, 16)];
      if (dist < 50) return [move(-toward, 18), move(0, 16)];
      if (k < 0.5) return [move(toward, 20), move(0, 10), move(-toward, 20)];   // shuffle over him
      if (k < 0.7) return [move(toward, 16), blockFor(12), move(0, 14)];        // feint
      return [move(0, 20 + irnd(16))];
    }
    const losing = !rush && me.health < 0.3 * (sim.horde ? sim.startHealth : me.maxHealth || sim.startHealth) && me.health < opp.health;
    if (grap && dist < 95 && !opp.crouch && me.stamina > 30 && chance(0.1 + 0.27 * difficulty)) return [move(toward, closer(78)), attack('throw')];   // 0.25 at SECURITY's 0.55 (was a flat 0.4)
    if (losing && dist < 170 && !cornered && !wellBehindMe(well(me, sim), me, opp) && chance(0.4)) return [move(-toward, 10, chance(0.3))];
    if (dist > (show ? 230 : turtle ? 140 : 175)) return approach(me, opp, dist, toward);
    const aggression = Math.max(0.1, Math.min(0.95, 0.3 + 0.5 * difficulty + (rush ? 0.3 : turtle ? -0.2 : 0)));
    // spent: stay out and let the meter come back (it refills in about two seconds)
    if (me.stamina < (show ? 28 : 30) || me.faint > 0) return dist < 200 && !cornered && !wellBehindMe(well(me, sim), me, opp) ? [move(-toward, 10)] : [blockFor(10)];
    // the habit guard: his jab is faster than anyone sees, so inside his reach, with him swinging lately, a
    // person holds a guard on a hunch now and then (a height guessed: a third of the time low). Rolled every
    // think (several a second), so the odds per roll are small
    const oppReach = sim.reachOf ? sim.reachOf(opp, 'cross') : r('cross');
    if (dist < oppReach + 20 && sim.stepCount - oppSwungAt < 150 && opp.state !== 'attack' && chance(show ? 0.1 : 0.03 + 0.06 * difficulty + (turtle ? 0.05 : 0))) {
      return [{ ...(chance(0.33) ? lowGuard(14 + irnd(14)) : blockFor(14 + irnd(14))), habit: true }];
    }
    // the stairwell: send him over the railing when he's by it; never back up into it myself
    const w = well(me, sim, opp);
    if (wellBeyond(w, me, opp) && me.stamina > 40 && chance(0.35 + 0.45 * difficulty + (grap ? 0.3 : 0))) {
      if (dist < 95) return [move(toward, closer(78)), attack('throw')];   // a throw toward the opening goes over
      if (dist > 140 && dist < 320) return [move(toward, (m, o) => Math.abs(o.x - m.x) < 150, true), { ...move(toward, 2, true), attack: 'cometCross' }];
      if (dist < r('spinKick') && chance(0.4)) return [attack('spinKick')];
      if (dist < r('jab') + 10) return [press('1')];   // into 1,2,3,4 Neon Tornado or 2,1,4 when it lands
      return [move(toward, closer(r('jab')), true), press('2')];
    }
    if (wellBehindMe(well(me, sim), me, opp) && chance(0.6)) return dist < r('jab') + 10 ? [attack(pick(['jab', 'lowKick', 'throw']))] : [move(toward, 6, true)];
    // the wall is behind him: go for the wall payoffs
    const wallBehind = (toward > 0 ? sim.bounds.x1 - opp.x : opp.x - sim.bounds.x0) < 220;
    if (wallBehind && me.stamina > 45 && chance(0.35 + 0.4 * difficulty)) {
      const k = rng();
      if (k < 0.35 && dist < r('spinKick')) return [attack('spinKick')];
      if (k < 0.6 && dist > 140 && dist < 320) return [move(toward, (m, o) => Math.abs(o.x - m.x) < 150, true), { ...move(toward, 2, true), attack: 'cometCross' }];
      if (k < 0.8 && dist < 100) return [move(toward, closer(80)), attack('throw')];
      if (dist < r('cross')) return [press('2')];   // 2,1,4 Spin Heel when it lands
    }
    // he's crouching: mids, the overhead, or a jump-in dive kick from range; a standing guard: lows
    // (a d+1,d+1,d+3 crouch string) and throws
    if (opp.crouch && dist < r('lkick') + 10 && chance(0.6)) return [attack(pick(['lkick', 'bodyBlow', 'overhead', 'uppercut']))];
    if (opp.backHeld && !opp.crouch && dist < r('lowJab') && me.stamina > 50 && chance(0.35)) return [press('d1')];   // the whole d1,d1,d3
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
    // he's on another floor, or up or down the stairs out of reach: take the stairs to him (stairNav.js)
    const nav = stairRoute(me, opp, sim);
    if (nav) { queue = []; act = null; return nav; }
    if (me.attackId !== seenAttackId) { seenAttackId = me.attackId; lastAttackStep = step; }
    if (me.state === 'hitstun' && opp.attackId !== lastHitTakenId) { lastHitTakenId = opp.attackId; myRun = 0; counterFor = opp.attackId; counterAt = step + lag; }
    // what I can see of him: as he was `lag` steps ago
    const saw = perceive(opp, step), sawDist = Math.abs(saw.x - me.x);
    if (saw.state === 'attack' && saw.attackId !== seenOppAid) { seenOppAid = saw.attackId; oppSwungAt = step; }

    // bookkeeping: was my last attack blocked or did it land? (decided the tick it connects)
    if (me.state === 'attack' && me.hitConfirmed && me.attackId !== lastBlockedId) {
      lastBlockedId = me.attackId;
      lastHitBlocked = opp.state === 'blockstun';
      // on block a string may keep going (a mixup of its own), less often and never into a blocked ender
      if (lastHitBlocked && me.seq && chance(0.3 * difficulty)) { const st = chooseString(me, opp, sim, true); if (st && !FRAME_DATA[st.moves[me.seq.length]].ender) { queue = [press(st.keys[me.seq.length])]; act = null; lastFollowed = me.attackId; } }
      if (lastHitBlocked) { blockedStreak++; blockedClasses.add(CLASS[me.move] || 'punch'); }
      else { blockedStreak = 0; blockedClasses = new Set(); myRun++; comboRun++; }
    }
    // breathing room: a combo of mine ended (he's out of hitstun and off the air) after 3+ hits, or I lead by
    // 30% of the bar (a breath tried every 1 to 1.5 s while it lasts)
    if (comboRun && opp.state !== 'hitstun' && opp.state !== 'knockdown' && opp.state !== 'grabbed' && me.state !== 'attack') { if (comboRun >= 3) breathe(step); comboRun = 0; }
    const share = (u) => u.health / (u.maxHealth || sim.startHealth || 100);
    if (step >= breatheUntil && step - breatheTry > 120 + (breatheTry & 63) && share(me) - share(opp) >= 0.3 && !sim.horde && sim.phase === 'fight') breathe(step);
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
      const st = (me.seq && pickedString && matchStrings(me.seq, strs(me)).includes(pickedString)) ? pickedString : chooseString(me, opp, sim, false);
      pickedString = st;
      const n = me.seq ? me.seq.length : 1;
      if (st && n < st.keys.length && n < 1 + Math.round(3 * difficulty) + (FRAME_DATA[st.moves[st.moves.length - 1]].ender ? 1 : 0) && me.stamina > (FRAME_DATA[st.moves[n]].cost || 9) * (1 - STAMINA.refundHit) + 8 && chance(0.55 + 0.45 * difficulty)) { queue = [press(st.keys[n])]; act = null; }
      // a juggle: keep it in the air with jabs when no string continues
      else if (opp.state === 'knockdown' && opp.juggle && (opp.airHits || 0) < 4) { queue = [press('1')]; act = null; }
    }
    // reflex: he fainted (out of stamina, no guard for about a second and a half): get there and
    // open a string on him; the follow-up reflex carries it on. Once per faint; the better the CPU
    // the more often it sees it.
    if (saw.faint > 0 && opp.faint > 0 && opp.faintAt !== lastFaintPunish && opp.state === 'idle' && opp.grounded && /^(idle|walk|block|crouch|run)$/.test(me.state) && me.stamina > 40) {
      lastFaintPunish = opp.faintAt;
      if (chance(show ? 1 : 0.35 + 0.65 * difficulty)) {
        const tok = me.stamina > 80 ? pick(['1', '1', '2', '3']) : '1';
        queue = dist < reach('jab') - 2 ? [{ ...press(tok), ok: true }] : [move(toward, closer(reach('jab') - 8), true), { ...press(tok), ok: true }];
        act = null;
      }
    }
    // reflex: block or counter a visible startup, once per opponent attack
    // (an air attack from a jump-in I've read is left to the anti-air below)
    // seen late: by the time his startup shows, a fast strike has already landed (still() fails) and only a
    // guard that was already up (the habit guard) stopped it
    const readingJump = aaFor === saw.jumpAt && !saw.grounded && FRAME_DATA[saw.move] && FRAME_DATA[saw.move].air;
    if (saw.state === 'attack' && saw.phase === 'startup' && saw.attackId !== lastReactedTo && !readingJump && sawDist < reach(saw.move) + (show ? 90 : 30)
      && (lastReactedTo = saw.attackId, still(saw, opp)) && !HIT_STATES.has(me.state)) {
      relag();
      // read the height: duck a high (and rise into a launcher), down-back a low, stand guard a mid;
      // a misread guesses, so mixups work on the AI too
      const h = heightOf(opp.move), read = chance(show ? 0.8 : 0.25 + 0.5 * difficulty);
      const guess = read ? h : pick(['high', 'mid', 'low']);
      // the universal parry, only from difficulty 0.55 up (0.4 of strikes at the top, 0.3 for the showcase): wait
      // until the strike is about to go live, then tap toward him (down-forward for a low); throws can't be parried
      const parryP = show ? 0.3 : Math.max(0, difficulty - 0.55) * 0.7, pfd = FRAME_DATA[opp.move];
      if (parryP > 0 && pfd && !pfd.throw && h !== 'throw' && /^(idle|walk|crouch|block)$/.test(me.state) && me.grounded && chance(parryP)) {
        const low = h === 'low';
        queue = [{ ...move(0, (m, o) => o.state !== 'attack' || !(sim.toLive(o) > 3)), down: low }, { ...move(toward, 2), down: low, ok: true }, move(0, 4)];
        act = null;
      } else
      // showcase: at the tip of his reach, step back so it whiffs (the punish reflex takes it from there)
      if (show && dist > reach(opp.move) - 20 && opp.move !== 'throw' && chance(0.45)) { queue = [move(-toward, 10 + irnd(6))]; act = null; }
      else if (chance(show ? 0.7 : 0.1 + 0.5 * difficulty + (turtle ? 0.15 : rush ? -0.1 : 0))) {
        if (guess === 'high' || guess === 'throw') queue = dist < reach('risingKnee') + 10 && chance(0.6) ? [duck(16 + irnd(6)), { ...press(chance(0.5) ? '4' : '2'), ok: true }] : [duck(18 + irnd(8))];
        else if (guess === 'low') queue = [lowGuard(18 + irnd(10))];
        else queue = [blockFor(18 + irnd(10))];
        act = null;
      }
      else if (dist < reach('jab') && chance((show ? 0.1 : 0.35) * difficulty)) { queue = [{ ...attack('jab'), ok: true }]; act = null; }
    }
    // reflex (showcase): his strike whiffed and he's stuck in recovery: punish it, a string
    // starter or the launcher up close, the lunge from further, Comet Cross from a dash
    // reflex: he botched (tangled up, open): punish it, the better the CPU the more often (only ever
    // reached when botches are on and one happened, so it changes nothing otherwise)
    if (saw.state === 'botch' && opp.state === 'botch' && opp.botchAt !== lastBotchSeen && /^(idle|walk|block|crouch)$/.test(me.state) && me.stamina > 26 && dist < 300) {
      lastBotchSeen = opp.botchAt; relag();
      if (chance(show ? 0.8 : 0.2 + 0.5 * difficulty)) {
        queue = dist < reach('cross') + 6 ? [{ ...press(dist < reach('jab') - 12 ? pick(['2', '1', 'd2']) : '2'), ok: true }] : [move(toward, closer(reach('cross')), true), { ...press('2'), ok: true }];
        act = null;
      }
    }
    if ((show || turtle) && saw.state === 'attack' && saw.phase === 'recovery' && !saw.hitConfirmed && saw.attackId !== lastPunish && still(saw, opp) && /^(idle|walk|block|crouch)$/.test(me.state) && me.stamina > 26) {
      lastPunish = saw.attackId; relag();
      if (chance(show ? 0.75 : 0.45 + 0.3 * difficulty)) {
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
    // (seen late too: the takeoff shows `lag` steps after it happened, and he must still be in the air)
    const oppAir = !saw.grounded && (saw.state === 'jump' || (saw.state === 'attack' && FRAME_DATA[saw.move] && FRAME_DATA[saw.move].air)) && !opp.grounded && opp.jumpAt === saw.jumpAt;
    if (oppAir && !saw.rag && saw.jumpAt !== aaSeen && Math.sign(saw.vx || -toward) === -toward && sawDist < 380 && /^(idle|walk|block|crouch|run)$/.test(me.state)) {
      aaSeen = saw.jumpAt; relag();
      if (chance(aaReadChance())) { aaFor = saw.jumpAt; me.aaJump = saw.jumpAt; queue = antiAir(); act = null; }
    }
    // the old reflex: an uppercut on the way in now and then (once per jump)
    if (oppAir && saw.vy > (show ? -260 : -120) && sawDist < (show ? 140 : 125) && Math.sign(saw.vx || -toward) === -toward && me.aaJump !== saw.jumpAt && /^(idle|walk|block|crouch)$/.test(me.state)) {
      me.aaJump = saw.jumpAt;
      if (chance(show ? 0.6 : 0.1 + 0.5 * difficulty)) { queue = [{ ...press('d2'), ok: true }]; act = null; }
      else if (show) { queue = [blockFor(24)]; act = null; }   // air attacks are overheads: a standing guard
    }
    // reflex: grabbed: break with 1+3 (or 2+4) after a human-ish delay, decided once per grab
    if (me.state === 'grabbed' && me.grabId !== opp.attackId) {
      me.grabId = opp.attackId;
      if (chance(show ? 0.5 : 0.15 + 0.55 * difficulty)) { queue = [move(0, 4 + irnd(16)), { ...press('1'), lk: true, ok: true }]; act = null; }
    }
    // stamina: low, back off and let it come back (a beat of guard if he presses). Fainted it's rooted
    // and shakes its head instead (shakeOff, below)
    if (!(me.faint > 0) && me.stamina < (show ? 28 : 30) && !queue.length && /^(idle|walk|block)$/.test(me.state) && opp.state !== 'hitstun' && !DOWN_STATES.has(opp.state) && !(opp.faint > 0 && !me.faint)) {
      const cornered = me.x - sim.bounds.x0 < 90 || sim.bounds.x1 - me.x < 90 || wellBehindMe(well(me, sim), me, opp);
      queue = opp.state === 'attack' && dist < 200 ? [blockFor(14)] : cornered ? [blockFor(16)] : [move(-toward, 12 + irnd(10))]; act = null;
    }
    // reflex: swing back on the way out of hitstun instead of resetting to range, decided `lag` steps after
    // his last hit landed (a person takes that long to answer being hit), once per hit of his; the jab is the
    // fast one and his extended arm is in its reach. At most 40% at the top of the ladder, much less below it;
    // otherwise it eats it and resets: a guard, or a step back out of range.
    if (counterFor !== lastCounter && step >= counterAt && /^(hitstun|idle|walk|block|crouch)$/.test(me.state)) {
      lastCounter = counterFor;
      if (Math.abs(me.vx) < 420 && dist < reach('cross') + 20) {
        relag();
        if (me.stamina > 26 && step >= breatheUntil && chance(show ? 0.2 : Math.min(0.4, 0.03 + 0.4 * difficulty * difficulty))) { queue = [attack(dist < reach('jab') + 45 ? 'jab' : 'cross')]; act = null; }
        else if (chance(show ? 0.6 : 0.5)) { queue = chance(show ? 0.6 : 0.35) ? [blockFor(14)] : [move(-toward, 12 + irnd(8))]; act = null; }   // respect his advantage
      }
    }
    // my stomp landed: he's pinned for about my recovery, then a wake-up strike can come: guard it
    if (me.state === 'attack' && me.move === 'stomp' && me.hitConfirmed && me.attackId !== stompGuard) {
      stompGuard = me.attackId;
      if (chance(show ? 0.9 : 0.2 + 0.6 * difficulty)) { queue = [blockFor(40 + irnd(20))]; act = null; }
    }
    // knocked down: the getup plan, once per knockdown (sim.js 'down')
    if (me.state === 'down' && me.touchStep !== downFor) { downFor = me.touchStep; queue = wakePlan(me, opp); act = null; }
    // floored with him striking at the body, or open over it: rise through it with a wake-up strike (invulnerable
    // until live) or roll away; once per strike of his
    if (me.state === 'down' && saw.state === 'attack' && saw.attackId !== downSeen && still(saw, opp)) {
      const hip = me.rig.joints.hip.x, d = Math.abs(saw.x - hip);
      const coming = saw.phase === 'startup' && d < 200, open = saw.phase === 'recovery' && d < 175;
      if (coming || open) {
        downSeen = saw.attackId; relag();
        if (chance(show ? 0.8 : 0.1 + 0.6 * difficulty)) {
          queue = open || chance(0.6) ? [attack(chance(0.6) ? 'wakeKick' : 'wakeSweep')] : [{ ...move(-(Math.sign(opp.x - hip) || 1), 3), roll: true }];
          act = null;
        }
      }
    }
    // reflex: in range and nobody has swung for a while: swing
    // (a plan in progress, like a jump-in or a step into kick range, is left alone)
    const staleGap = show ? 60 : turtle ? 48 : 24;
    if (dist < 120 && me.stamina > 32 && step >= breatheUntil && step - lastAttackStep > staleGap && step - lastStale > staleGap && !queue.length && /^(idle|walk|block)$/.test(me.state) && opp.state !== 'attack' && !DOWN_STATES.has(opp.state)) {
      lastStale = step;
      queue = (opp.state === 'block' || blockedStreak >= 1) ? mixup(dist, toward, opp) : show ? [opener(opp, dist)] : [attack(dist < reach('jab') + 10 ? 'jab' : 'cross')]; act = null;
    }
    if (act && act.block && !act.habit && typeof act.until === 'number' && act.until > 4 && opp.state !== 'attack' && !HIT_STATES.has(opp.state)) act.until = 4;
    // reflex: a character's own reflex specials (ai.specials with reflex: true: LAWYER's Objection at a grab starting up,
    // THE CEO's Golden Parachute at a strike), looked at every step instead of only when deciding
    if (/^(idle|walk|block|crouch|blockstun)$/.test(me.state) && still(saw, opp)) { const rx = special(me, saw, sim, sawDist, toward, true); if (rx) { queue = rx; act = null; } }

    // stunned: the first plan after it waits half a reaction, a beat to take stock
    if (HIT_STATES.has(me.state)) nextThink = Math.max(nextThink, step + (lag >> 1));
    const done =!act || (typeof act.until === 'function' ? act.until(me, opp) : act.until <= 0);
    if (done) {
      if (queue.length) { act = queue.shift(); if (act.onlyIf && !act.onlyIf(me, opp)) act = null; }
      // no re-deciding during my own attack (each new plan would overwrite the buffered press);
      // over a downed body it is allowed, for the meaty cancel out of the stomp
      // no deciding in hit- or blockstun either: a strike picked there was buffered and came out on the first free
      // frame, an instant counter on every hit (the swing-back reflex above is the one, rationed, way out)
      else if (step >= nextThink && me.state !== 'down' && !HIT_STATES.has(me.state) && (me.state !== 'attack' || DOWN_STATES.has(opp.state))) {
        queue = decide(me, opp, sim, dist, toward, saw); act = queue.shift();
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
    // showcase: an expert doesn't swing himself toward a faint; under 24 he backs off to breathe
    else if (show && act && (act.attack || act.press || act.pressFn) && !act.ok && me.stamina < 24 && !DOWN_STATES.has(opp.state) && !(opp.faint > 0)) {
      act = dist < 200 ? move(-toward, 12) : blockFor(10); queue = [];
    }
    // stamina: never press the strike that would empty the bar (the last point faints). The bottom
    // of the ladder slips now and then and faints anyway; the showcase never does.
    // A string's next press after a clean hit counts on connecting: one that empties the bar and hits leaves him
    // on 1 (when the bar holds STAMINA.saveShare of its price), so that's all it needs
    const onHit = me.state === 'attack' && me.hitConfirmed && !lastHitBlocked;
    if (act && (act.attack || act.press || act.pressFn) && !act.pressed && me.stamina - actCost(me, act) * (onHit ? STAMINA.saveShare : 1) <= 0) {
      if (act.faintOK == null) act.faintOK = !show && chance((1 - difficulty) * 0.4);
      if (!act.faintOK) {
        const cornered = me.x - sim.bounds.x0 < 90 || sim.bounds.x1 - me.x < 90;
        act = dist < 200 && !cornered ? move(-toward, 10) : blockFor(10); queue = [];
      }
    }
    const out = { ...EMPTY_INPUT };
    // juggled: recover in the air, more often and closer to the perfect window the better the CPU (never mashing)
    if (me.state === 'knockdown' && !me.grounded && me.launchStep !== techFor && me.launchStep != null) {
      techFor = me.launchStep; techAt = -1;
      if (chance(show ? 0.7 : Math.max(0, 0.75 * difficulty - 0.1))) techAt = me.launchStep + AIR_TECH.min + (chance(show ? 0.6 : 0.5 * difficulty) ? irnd(AIR_TECH.perfect) : AIR_TECH.perfect + irnd(24));
    }
    if (me.state === 'knockdown' && step === techAt) out.lp = true;
    // a whiffed air attack, on the way down with him close: the second jab
    if (me.state === 'attack' && !me.grounded && FRAME_DATA[me.move] && FRAME_DATA[me.move].air && me.rig.current.done && !me.hitConfirmed && (me.airUsed || 0) < 2 && me.vy > 0 && dist < 120 && fallFor !== me.jumpAt) {
      fallFor = me.jumpAt;
      if (chance(0.25 + 0.5 * difficulty)) out.lp = true;
    }
    // dropping off the vault after a floor break, with him below: an air attack on the way down
    if (me.state === 'vault' && me.vaultPhase === 'clip' && me.rig.current.t > 0.5 && me.rig.current.t < 0.7 && vaultFor !== me.vaultAt) {
      vaultFor = me.vaultAt;
      if (dist < 260 && chance(0.25 + 0.45 * difficulty)) out[chance(0.5) ? 'rk' : 'lk'] = true;
    }
    if (!act && dist < 140 && (opp.state === 'block' || opp.state === 'blockstun') && /^(idle|walk)$/.test(me.state)) {
      out.dx = (Math.floor(step / 30) % 2) ? toward : -toward;   // a shuffle between thinks, not a stand (a quarter second each way)
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
      // a press that would botch (it lands in my own strike, outside anything that carries on from it):
      // decided once per act, the CPU holds it until it's clean (the grace at the end of the recovery)
      // or, the lower its difficulty, lets it go and tangles itself up
      let held = false;
      if (sim.botchOn && (act.attack || act.press) && me.state === 'attack' && sim.pressMistimed && sim.pressMistimed(me, out)) {
        if (act.slip == null) act.slip = chance(slipChance(me));
        if (!act.slip) {
          out.lp = out.rp = out.lk = out.rk = false; if (act.attack) out[act.attack] = false; out.down = !!act.down;
          held = true; act.held = (act.held || 0) + 1;
          if (act.held > 60) act = null;
        }
      }
      if (held) { /* the act waits, its clock stopped */ }
      else if (typeof act.until === 'number') act.until--;
      else if (act.until(me, opp)) act = null;
      if (act && (act.attack || act.jump || act.press) && typeof act.until === 'number' && act.until <= 0) act = null;
    }
    // launched or juggled: no buttons but the planned air recovery (a stray press would lock it out)
    if (me.state === 'knockdown') { for (const k in out) if (k === 'lp' || k === 'rp' || k === 'lk' || k === 'rk' || FRAME_DATA[k]) out[k] = false; if (step === techAt) out.lp = true; }
    // botches on: the low end of the ladder mashes a button in the middle of its own strike now and then
    // (decided once per strike, pressed a few steps in), and the showcase sometimes presses into a happy
    // accident's window (decided once per strike, the first step a window is open)
    if (sim.botchOn && me.state === 'attack' && me.grounded) {
      if (me.attackId !== mashFor) {
        mashFor = me.attackId; mashAt = -1;
        const p = slipChance(me) * 0.8;
        if (p > 0 && chance(p)) { mashAt = step + 3 + irnd(16); mashTok = pick(['1', '2', '3', '4']); }
      }
      if (step === mashAt && !out.lp && !out.rp && !out.lk && !out.rk) { out[BTN[mashTok]] = true; mashAt = -1; }
      if (show && accFor !== me.attackId && sim.openAccident) {
        const a = sim.openAccident(me);
        if (a) { accFor = me.attackId; if (chance(0.03)) { if (a.tok === 'T') { out.lp = true; out.lk = true; } else out[BTN[a.tok]] = true; out.down = false; } }
      }
    }
    // fainted on its feet: no plan moves it (the sim roots it); the stick shakes the head clear instead
    if (me.faint > 0 && me.grounded && me.state === 'idle') { shakeOff(me, out, step); stickDx = out.dx; stickAt = step; return out; }
    // A hand on a stick. Plans can be a few steps long, and back-to-back plans used to flip the direction
    // every 2 to 4 steps (25 ms) over a downed body, which restarted the walk, idle and run clips each time:
    // the arms seized. Walking, running or standing, the direction holds at least STICK_DWELL steps before
    // it changes, about as fast as a person reverses a stick. Jumps, rolls, guards and the floor pass through.
    if (/^(idle|walk|run)$/.test(me.state) && !out.jump && !out.block) {
      const dx = out.dx || 0, run = !!out.run && dx !== 0;
      if (dx !== stickDx || run !== stickRun) {
        if (step - stickAt < STICK_DWELL) { out.dx = stickDx; out.run = stickRun; }
        else { stickDx = dx; stickRun = run; stickAt = step; }
      }
    } else { stickDx = out.dx || 0; stickRun = !!out.run; }
    return out;
  }
  think.debug = () => ({ mixLog, blockedStreak, lastBlockedId, queue: queue.map(a => a.attack || (a.jump ? 'jump' : 'move')), act: act && (act.attack || (act.block ? 'block' : 'move')) });
  think.setDifficulty = (d) => { difficulty = Math.max(0, Math.min(1, d)); lag = baseLag(); };
  think.getDifficulty = () => difficulty;
  think.style = style;
  return think;
}
