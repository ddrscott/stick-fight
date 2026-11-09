// The combat simulation: fixed 120Hz steps, fighter state machines on top of the rigs,
// physics, hit resolution with hitstop, rounds and KO. step(ms) is deterministic given
// the same inputs and seed. Events for the glue (fx, camera) go through onEvent.

import { FRAME_DATA, ATTACKS, DT, f60, STAMINA, COMBO_STUN, COMBO_DMG, COMBO_SOFTCAP, COMBO_OVERCAP, comboScale } from './frameData.js';
import { matchStrings, MOVE_TOKEN } from './strings.js';
import { buildHitboxes, buildHurtboxes, testHit } from './hitboxes.js';
import { EMPTY_INPUT } from './input.js';
import { createAI } from './ai.js';
import { mulberry32 } from './rng.js';
import * as dm from './dmath.js';   // bit-identical hypot on every engine (online play)
import { saveSim, loadSim } from './snapshot.js';
import { characterOr, canUse, colorFor, pantsFor, TEMP_ID } from '../characters/registry.js';   // per-character stats, moves, strings (src/characters/)
import { BOTCH_GRACE, BOTCH_CALLOUT, ACCIDENTS, chooseBotch, botchCost, accidentFor, sideOf, isFoot } from './botch.js';   // mistimed presses (src/combat/botch.js)

let WALK = 180, RUN = 380, CROUCH_WALK = 70;           // replaced by the rig's own stride speeds (MOVE_DATA) so planted feet don't skate
const JUMP_VY = 500, GRAVITY = 2000;
const BODY_SEP = 64, WALL_PAD = 26;   // 64: the rigs lean 30-50px into a punch; closer and the torsos cross
const BUFFER_STEPS = 16;            // 133ms input buffer
const FLASH_STEPS = 6;              // 3 frames of tint at 60fps; the body stays readable under it
const ROUND_TIME = 60;
const INTRO_TIME = 1.4, KO_HOLD = 0.35, MATCH_HOLD = 1.8;
const STUMBLE_FRICTION = 0.95;      // hitstun slide; victim keeps stumbling until slow
const CHASE_FRICTION = 0.975;       // the attacker's ride after a launch: he follows the body across the room
const MOVE_STATES = new Set(['idle', 'walk', 'run']);
const FACE_STATES = new Set(['idle', 'walk', 'run', 'block', 'crouch']);
const NOT_SOLID_BODY = new Set(['knockdown', 'down', 'ko', 'roll', 'getup']);
const GUARD_STATES = new Set(['idle', 'walk', 'block', 'blockstun', 'crouch']);   // holding back here guards
const JUGGLE_MAX = 4, JUGGLE_POP = 220, JUGGLE_G = 0.3;   // airborne hits; each one adds 30% gravity, so juggles end on their own
const SPLAT_STEPS = 48, BREAK_STEPS = 36, RISE_STEPS = 24, DASH_STEPS = 14, COUNTER_DMG = 1.35, COUNTER_STUN = 1.5;
const CROUCH_SQUASH = 0.7;
const FLOOR_DMG = 10, VAULT_HOP_VY = 420;   // landing damage after a floor break; the vault's hop   // a crouch drawn by squashing the standing pose, until the rig has crouch clips
const INVULN = new Set(['getup', 'ko', 'roll']);
const OTG_MOVES = new Set(['sweep', 'cross', 'lowKick']);   // low enough to land on a floored body
const OTG = { damage: 3, hitstop: 3, bounce: 4 };   // a flinch: 3-frame freeze, then a 2-frame 6px pop; the body stays down
const ROLL_STEPS = 30, ROLL_SPEED = 340, GETUP_SPEED = 2;   // the rig's getup is 672ms at 1x; at 2x it is 336ms, about the old clip at 1.5x
const SQUASH_STEPS = 10;            // 5 frames on the floor after touchdown before up or a wake-up strike is read (a roll goes at once)
const DOWN_MAX = 120;               // lying with no input: he stands up by himself after 1s, so nobody can stall
const ROLL_GETUP_STEPS = 8;         // the roll is still available for the first 4 frames of the getup
const PREROLL = 0.05;               // an attack's first rendered frame is already 50ms into its anticipation (the rig's blend and dip are under 6px before that)
const GRAB_PULL = 6;                // px a step a grabbed body is pulled in to the throw's hold (720 px/s)
const HIT_SEP = 40;                 // a stumbling victim and his attacker may close to 40px (64 otherwise)
const SOLID = new Set(['idle', 'walk', 'run', 'block', 'blockstun', 'attack', 'hitstun', 'getup']);   // a rising body pushes the man standing on it to range
const LYING = new Set(['knockdown', 'ko', 'down', 'getup', 'roll']);
const LIE_PAD = 90, LIE_SLIDE = 300;   // px/s a resting body slides off a wall it lies too close to
let HAS_VAULT = false, HAS_THROWN = false, HAS_HITBODY = false, HAS_HITBACK = false, HAS_HITSTUN = false, HAS_HITLOW = false, MOVE_DATA_ = null;
// four buttons, one per limb from the fighter's own point of view (lead = left, orthodox)
const BUTTON_LIMB = { lp: 'lHand', rp: 'rHand', lk: 'lFoot', rk: 'rFoot' };
const BUTTON_MOVES = { lp: ['jab', 'lowJab', 'bodyBlow'], rp: ['cross', 'uppercut', 'lungeCross', 'risingUppercut'], lk: ['lkick', 'lowKick'], rk: ['roundhouse', 'sweep', 'spinKick', 'risingKnee', 'overhead'] };
const BTN_NUM = { lp: '1', rp: '2', lk: '3', rk: '4' };
// one button with the stick: down = crouch attacks, released-down = rising attacks, forward and
// back variants, a dash into 2 = comet cross
// A character's command inputs (src/characters/) come first: { button, motion, move }, the most specific
// motion first (the registry sorts them). A plain press with no command is the shared move.
function commandMove(btn, inp, u, step, air) {
  const cmds = u.char && u.char.commands;
  if (!cmds || !cmds.length) return null;
  const b = btn === 'throw13' ? '1+3' : btn === 'throw24' ? '2+4' : BTN_NUM[btn];
  const facing = u.facing, fwd = inp.dx * facing > 0, back = inp.dx * facing < 0, down = !!inp.down;
  const rising = !down && u.crouchEnd != null && step - u.crouchEnd <= RISE_STEPS;
  const dash = fwd && (u.state === 'run' || step - (u.lastRunStep || -999) <= DASH_STEPS);
  for (const c of cmds) {
    if (c.button !== b) continue;
    const m = c.motion;
    const ok = air ? (m === 'air' || (m === 'airDown' && down))
      : m === '' ? !fwd && !back && !down : m === 'f' ? fwd && !down : m === 'b' ? back && !down : m === 'd' ? down && !fwd && !back
      : m === 'df' ? down && fwd : m === 'db' ? down && back : m === 'ff' ? dash && !down : m === 'run' ? u.state === 'run' && !down : m === 'rise' ? rising : false;
    if (ok && canUse(u.char, c.move)) return c.move;
  }
  return null;
}
function resolveButton(btn, inp, u, step) {
  const air = u.state === 'jump' || (!u.grounded && u.state === 'attack' && FRAME_DATA[u.move] && FRAME_DATA[u.move].air);
  const cmd = commandMove(btn, inp, u, step, air);
  if (cmd) return cmd;
  // in the air: one air attack per jump (down+4 is the dive kick)
  if (air) {
    if (btn === 'lp') return 'jumpJab';
    if (btn === 'rp') return 'jumpCross';
    if (btn === 'lk') return 'flyingKick';
    return inp.down ? 'diveKick' : 'airRoundhouse';
  }
  const facing = u.facing, fwd = inp.dx * facing > 0, back = inp.dx * facing < 0, down = !!inp.down;
  const rising = !down && u.crouchEnd != null && step - u.crouchEnd <= RISE_STEPS;
  const dash = fwd && (u.state === 'run' || step - (u.lastRunStep || -999) <= DASH_STEPS);
  if (btn === 'lp') return down ? 'lowJab' : fwd ? 'bodyBlow' : 'jab';
  if (btn === 'rp') return down ? 'uppercut' : rising ? 'risingUppercut' : dash ? 'cometCross' : fwd ? 'lungeCross' : 'cross';
  if (btn === 'lk') return down ? 'lowKick' : 'lkick';
  return down ? 'sweep' : rising ? 'risingKnee' : back ? 'spinKick' : fwd ? 'overhead' : 'roundhouse';
}
const ANIM = {};
const missingAnim = new Set();
function warnOnce(key, msg) { if (!missingAnim.has(key)) { missingAnim.add(key); console.info('[combat] ' + msg); } }
const GOON_COLORS = ['#E85D00', '#3fa7ff', '#8cff5a', '#ff4fa3', '#ffd84f', '#c08bff', '#ff6a3d', '#5ee8d8'];

export function createCombat({ fighters, arena, input, onEvent: emitEvent = () => {}, makeRig = null, moves = [], moveData = null }) {
  // sim.eventFilter(ev) -> false holds an event back (online rollback re-simulates frames that
  // already showed their effects; see src/net/rollback.js)
  const onEvent = (ev) => { if (!sim.eventFilter || sim.eventFilter(ev)) emitEvent(ev); };
  HAS_HITBODY = moves.includes('hitBody'); HAS_HITBACK = moves.includes('hitBack'); MOVE_DATA_ = moveData;
  HAS_HITSTUN = moves.includes('hitStun'); HAS_HITLOW = moves.includes('hitLow'); HAS_THROWN = moves.includes('thrown'); HAS_VAULT = moves.includes('vault');
  // the striking limb comes from the rig: each move names its joint, and the button table is
  // checked against the rig's side/limb so button 1 really is the lead hand, etc.
  // each move's clip: its own name, else the first of its `anims` the rig has (new clips land
  // in the rig while the game keeps working on the old ones)
  const has = (n) => moves.includes(n) || !!(moveData && moveData[n]);
  for (const m of ATTACKS) {
    const fd = FRAME_DATA[m];
    const want = [m, ...(fd.anims || []), ...(fd.anim ? [fd.anim] : [])];
    const got = want.find(has) || 'jab';
    fd.anim = got;
    fd.ownClip = got === m || (fd.anims && fd.anims[0] === got);
    if (!fd.ownClip) warnOnce(m, `no '${(fd.anims && fd.anims[0]) || m}' clip in the rig yet, ${m} plays '${got}'`);
  }
  // state clips with fallbacks
  const pickAnim = (list, key) => { const a = list.find(has) || 'idle'; if (a !== list[0]) warnOnce(key, `no '${list[0]}' clip in the rig yet, using '${a}'`); return a; };
  ANIM.crouch = pickAnim(['crouch', 'crouchIdle', 'block'], 'crouch');
  ANIM.crouchBlock = pickAnim(['crouchBlock', 'crouch', 'block'], 'crouchBlock');
  ANIM.faint = pickAnim(['dizzy', 'gassed', 'idle'], 'faint');
  ANIM.throwTech = pickAnim(['throwTech', 'block'], 'throwTech');
  ANIM.fakeCrouch = !has('crouch') && !has('crouchIdle');
  ANIM.blockHit = has('blockHit') ? 'blockHit' : null;
  ANIM.airLand = has('airLand') ? 'airLand' : null;
  ANIM.crouchWalk = has('crouchWalk') ? 'crouchWalk' : null;
  CROUCH_WALK = (moveData && moveData.crouchWalk && moveData.crouchWalk.speed) || 70;
  ANIM.crouchBlockHit = has('crouchBlockHit') ? 'crouchBlockHit' : ANIM.crouchBlock;
  // a move with its own clip takes the rig's height ('high'|'mid'|'low'|'throw')
  if (moveData) for (const m of ATTACKS) { const fd = FRAME_DATA[m], d = moveData[fd.anim]; if (fd.ownClip && fd.anim === m && d && d.height) { fd.height = d.height; fd.low = d.height === 'low'; } }
  if (moveData) for (const m of ATTACKS) { const d = moveData[FRAME_DATA[m].anim]; if (d && d.limb) FRAME_DATA[m].joint = d.limb; }
  if (moveData) for (const [btn, list] of Object.entries(BUTTON_MOVES)) for (const m of list) {
    const d = FRAME_DATA[m].ownClip && moveData[FRAME_DATA[m].anim], want = BUTTON_LIMB[btn];
    if (d && d.limb && (d.limb[0] !== want[0] || /Hand/.test(d.limb) !== /Hand/.test(want))) warnOnce('limb' + m, `button ${btn} maps to ${m} but the rig strikes with ${d.limb}, not ${want}`);
  }
  if (moveData && moveData.walk && moveData.walk.speed) WALK = moveData.walk.speed;
  if (moveData && moveData.run && moveData.run.speed) RUN = moveData.run.speed;
  // The arena may swap floors between rounds, so geometry is read live, never cached.
  const floorsNow = () => (arena.floors && arena.floors.length ? arena.floors : [{ x0: 0, x1: 1280, y: 480 }]);
  const lowestY = () => floorsNow().reduce((m, f) => Math.max(m, f.y), -Infinity);
  const bounds = { x0: 0, x1: 1280 };
  // ---- floors (v3) ---------------------------------------------------------------------
  // The fight happens on one floor at a time (sim.floor). Each floor has its own walls, fight band,
  // spawns and doors (arena contract); older arenas get them derived from the floor line.
  function floorInfo(i) {
    const fl = floorsNow(), f = fl[i] || fl[0];
    const walls = f.walls || (arena.wallsByFloor && arena.wallsByFloor[i]) || (i === 0 && arena.walls) || { left: f.x0, right: f.x1 };
    const band = f.fightBand || (arena.fightBand && arena.fightBand[i]) || { x0: walls.left + WALL_PAD, x1: walls.right - WALL_PAD };
    const sp = (arena.spawnsByFloor && arena.spawnsByFloor[i]) || f.spawns || (i === 0 && arena.spawns) || null;
    const mid = (band.x0 + band.x1) / 2;
    const spawns = sp && sp.length >= 2 ? sp : [{ x: mid - 160, y: f.y, facing: 1 }, { x: mid + 160, y: f.y, facing: -1 }];
    const dr = arena.doors && arena.doors[i];
    const doors = dr && dr.length ? dr : [{ x: band.x0 + 30, y: f.y, side: -1 }, { x: band.x1 - 30, y: f.y, side: 1 }];
    return { y: f.y, walls, band, spawns, doors };
  }
  // the stairwell opening in the main floor (arena.stairwell); until the arena has one, a fallback
  // over the drawn staircase so the floor-break works
  function stairwellNow() {
    if (arena.stairwell) return arena.stairwell;
    const fl = floorsNow();
    if (fl.length < 2) return null;
    warnOnce('stairwell', 'no arena.stairwell yet, using a fallback opening at x 700..880');
    return { x0: 700, x1: 880, y: fl[0].y, rail: { x0: 700, x1: 880, h: 46 }, toFloor: 1 };
  }
  // where a body is: a lying or tumbling body's root can sit at its feet or be re-based when it settles,
  // so sides and facing go by its hip
  const bodyX = (u) => ((u.rag || NOT_SOLID_BODY.has(u.state) || (u.state === 'attack' && FRAME_DATA[u.move] && FRAME_DATA[u.move].wake)) && u.rig && u.rig.joints && u.rig.joints.hip ? u.rig.joints.hip.x : u.x);
  const bandOf = (u) => { const b = floorInfo(u && u.floor != null ? u.floor : simFloor()).band; return b && b.x1 > b.x0 ? b : bounds; };
  function refreshBounds() {
    const b = floorInfo(simFloor()).band;
    bounds.x0 = b.x0; bounds.x1 = b.x1;
  }
  let simRef = null;
  const simFloor = () => (simRef ? simRef.floor || 0 : 0);
  refreshBounds();
  // Reach per move: measured from the rig (max forward hitbox extent while active), plus
  // the defender's half-width. FRAME_DATA.reach is only the fallback before calibration.
  // Each character measures its own (a longer or bigger body reaches farther): TEMP's are keyed by the
  // move's name, another character's by 'id:move'.
  const reachSeen = {};
  const reachKey = (u, m) => (u && u.char && u.char.id !== TEMP_ID ? u.char.id + ':' + m : m);
  const reach = (m) => (FRAME_DATA[m] ? (reachSeen[m] ? reachSeen[m] + 12 : FRAME_DATA[m].reach) : 90);
  const reachOf = (u, m) => { const k = reachKey(u, m); return FRAME_DATA[m] ? (reachSeen[k] ? reachSeen[k] + 12 : FRAME_DATA[m].reach * ((u && u.rig && u.rig.scale) || 1)) : 90; };
  function calibrate(rig, ch = null) {
    const x = rig.x, y = rig.y, fc = rig.facing, pre = ch && ch.id !== TEMP_ID ? ch.id + ':' : '';
    for (const m of ATTACKS) {
      if (ch && !canUse(ch, m)) continue;
      rig.play(FRAME_DATA[m].anim || m);
      let active = false, n = 0;
      while (!rig.current.done && n++ < 1200) {
        rig.update(DT);
        for (const ev of rig.events) { if (ev.type === 'active') active = true; if (ev.type === 'recover') active = false; }
        rig.events.length = 0;
        if (active) for (const h of buildHitboxes(rig, m, fc)) reachSeen[pre + m] = Math.max(reachSeen[pre + m] || 0, (h.x - rig.x) * fc + h.r);
      }
    }
    rig.x = x; rig.y = y; rig.facing = fc; rig.play('idle'); rig.update(0); rig.events.length = 0;
  }
  calibrate(fighters[0]);
  const reachCalibrated = { ...reachSeen };   // reachSeen grows from real hits; a fresh match starts from this
  const calibrated = new Set([TEMP_ID]);

  const sim = {
    units: [], bounds, get floors() { return floorsNow(); }, phase: 'intro', phaseTimer: 0, stepCount: 0, round: 1, timer: ROUND_TIME,
    wins: [0, 0], winner: -1, banner: '', bannerT: 0, difficulty: 0.6, rng: mulberry32(1), reach, reachOf, reachSeen,
    accumulator: 0, hitstopActive: 0, koSlow: 0, finisher: false, startHealth: 100, introTime: INTRO_TIME, seed: 1, horde: null, card: null,
    callouts: [], log: [],
    botchOn: true,   // mistimed presses botch (src/combat/botch.js); the settings toggle and ?botch=0 turn it off, online the host's setting rides the start message
    floor: 0, floorBroken: false, floorInfo, get stairwell() { return stairwellNow(); },
  };
  simRef = sim;
  // callouts (enders, counters, trick shots) for the HUD, which places them clear of the fighters;
  // the log is for measurement (capped)
  function callout(text, by, kind = 'ender') {
    sim.callouts.push({ text, by, kind, t: 1.1, max: 1.1 });
    if (sim.callouts.length > 3) sim.callouts.shift();
    note({ type: 'callout', text, by, kind });
    onEvent({ type: 'callout', text, by, kind });   // enders, COUNTER, TRADE, BREAK, GASSED, trick shots (for audio)
  }
  function note(rec) { rec.step = sim.stepCount; sim.log.push(rec); if (sim.log.length > 400) sim.log.shift(); }
  sim.callout = callout;

  function makeUnit(rig, i) {
    const ch = rig.charDef || characterOr(TEMP_ID);
    return {
      char: ch, maxHealth: 100, staminaMax: STAMINA.max * ch.stats.stamina, armorLeft: 0, hitN: 0, airJumpsUsed: 0, wallJumps: 0,
      id: i, name: 'P' + (i + 1), rig, color: rig.color || (i === 0 ? '#f0f0f0' : '#E85D00'),
      x: rig.x, y: rig.y, vx: 0, vy: 0, grounded: true, facing: rig.facing || (i === 0 ? 1 : -1),
      state: 'idle', move: null, phase: null, hitConfirmed: false, attackId: 0,
      hitstop: 0, flash: 0, stun: 0, downTimer: 0, buffer: null, bufferAge: 0,
      health: 100, hidden: false, controller: null, kind: 'none', home: 0, prevX: 0, prevBX: 0, apartSteps: 0,
      last: EMPTY_INPUT, tapDir: 0, tapTimer: 0, running: false, koDone: false, prevJoints: null,
      stamina: STAMINA.max * ch.stats.stamina, faint: 0, faintDmg: 0, faintAt: -1, regenAt: 0, crouch: false, backHeld: false, downHeld: false,
      seq: null, seqName: '', bufferKeys: null, bufferName: '', airHits: 0, gScale: 1,
      combo: 0, comboBy: -1, comboDmg: 0, selfChain: 0, lastHitAt: -1,
      wakeUp: 0,   // a wake-up strike from the floor: 1 lying, 2 rising (sim.js isWake)
      botchKind: '', botchSev: 0, botchShift: 0, botchFwd: 0, botchAt: -1, activeAt: -1, recoverAt: -1, grabTo: null,
      shockT: 0, shockUsed: false, rootT: 0,   // character hooks: shock (extra stun), root (no walk or jump)
      dodgedId: -1,   // character hooks: the last strike an invuln move let pass (logged once)
      regenMul: 1, regenEnd: -1, regenLen: 0, regenTag: '', speedMul: 1, speedEnd: -1, speedLen: 0, speedTag: '',   // timed statuses (frame data status / selfStatus)
    };
  }
  sim.units = fighters.map(makeUnit);
  // Who a unit fights: the hero (unit 0) takes the nearest live goon; every goon takes the hero.
  function oppOf(u) {
    if (u.id !== 0) return sim.units[0];
    let best = null, bd = Infinity;
    for (let i = 1; i < sim.units.length; i++) {
      const g = sim.units[i];
      if (g.hidden) continue;
      const d = Math.abs(g.x - u.x) + (g.state === 'ko' ? 2000 : 0);
      if (d < bd) { bd = d; best = g; }
    }
    return best || sim.units[1];
  }
  sim.oppOf = oppOf;
  Object.defineProperty(sim, 'focus', { get: () => oppOf(sim.units[0]) });

  // ---- controllers -------------------------------------------------------------
  sim.setController = (i, kind, fn) => { const u = sim.units[i]; u.kind = kind; u.controller = fn || null; };
  sim.setHuman = (i) => sim.setController(i, 'human', () => input.snapshot());
  // opts.style: 'showcase' is the attract mode's expert flavor (ai.js); the default CPU leaves it unset
  sim.setAI = (i, difficulty = sim.difficulty, opts = {}) => {
    // the style a scene asks for, else the character's own (TEMP has none: the normal scrapper)
    const style = opts.style !== undefined ? opts.style : (sim.units[i] && sim.units[i].char.ai.style) || undefined;
    const ai = createAI({ rng: sim.rng, difficulty, reach: (m) => reachOf(sim.units[i], m), style });
    sim.setController(i, 'ai', ai);
    return ai;
  };
  sim.setDifficulty = (d) => {
    sim.difficulty = Math.max(0, Math.min(1, d));
    for (const u of sim.units) if (u.kind === 'ai' && u.controller.setDifficulty) u.controller.setDifficulty(sim.difficulty);
  };

  // ---- characters (src/characters/) -------------------------------------------------------
  // setCharacter(i, id): the fighter in slot i becomes that character (TEMP when it isn't registered):
  // its rig takes the body, the unit its stats, moves and strings, and its color unless one is given.
  // Call it between matches (a scene does, before resetMatch); a character's reach is measured the
  // first time it appears.
  sim.setCharacter = (i, id, { color = null } = {}) => {
    const u = sim.units[i];
    if (!u) return null;
    const ch = characterOr(id);
    u.char = ch; u.rig.charDef = ch;
    if (typeof u.rig.setBody === 'function' && u.rig.body !== ch.body) u.rig.setBody(ch.body, { accent: ch.accent });
    else if (u.rig) u.rig.accent = ch.accent;
    u.staminaMax = STAMINA.max * ch.stats.stamina;
    const other = sim.units[1 - i];
    u.color = color || colorFor(ch, i, other && other.char); u.rig.color = u.color;
    u.rig.pants = pantsFor(ch, i, other && other.char, other && other.rig ? other.rig.pants : null);
    if (!calibrated.has(ch.id)) {
      calibrated.add(ch.id);
      calibrate(u.rig, ch);
      for (const k in reachSeen) if (k.startsWith(ch.id + ':')) reachCalibrated[k] = reachSeen[k];
      u.rig.play('idle'); u.rig.update(0); u.rig.events.length = 0;
    }
    return ch;
  };
  sim.setCharacters = (ids, colors = []) => ids.forEach((id, i) => sim.setCharacter(i, id, { color: colors[i] || null }));

  // ---- rounds ----------------------------------------------------------------------
  function spawn(u, i) {
    const s = arena.spawns && arena.spawns[Math.min(i, 1)] ? arena.spawns[Math.min(i, 1)] : { x: 480 + i * 320, y: lowestY(), facing: i === 0 ? 1 : -1 };
    u.x = s.x; u.y = s.y; u.facing = s.facing; u.vx = 0; u.vy = 0; u.grounded = true;
    u.state = 'idle'; u.move = null; u.phase = null; u.hitstop = 0; u.flash = 0; u.stun = 0; u.buffer = null;
    // a character's health is its stat out of 100 times the match's starting health (100, the ko scene's 24)
    u.maxHealth = (sim.horde && i >= 1) ? sim.horde.goonHealth : u.char.stats.health === 100 ? sim.startHealth : Math.round(sim.startHealth * u.char.stats.health / 100);
    u.health = u.maxHealth; u.hidden = false; u.koDone = false; u.running = false; u.hitConfirmed = false;
    u.touched = false; u.otgHit = false; u.bounce = 0; u.followThrough = false; u.chase = false;
u.home = 0;     u.staminaMax = STAMINA.max * u.char.stats.stamina; u.stamina = u.staminaMax; u.faint = 0; u.faintDmg = 0; u.faintAt = -1; u.regenAt = 0; u.crouch = false; u.seq = null; u.bufferKeys = null;
    u.comboDmg = 0; u.selfChain = 0; u.blockedAt = -999; u.armorLeft = 0; u.hitN = 0; u.airJumpsUsed = 0; u.wallJumps = 0;
    u.botchKind = ''; u.botchSev = 0; u.botchShift = 0; u.botchFwd = 0; u.botchAt = -1; u.activeAt = -1; u.recoverAt = -1; u.wakeUp = 0;
    u.shockT = 0; u.shockUsed = false; u.rootT = 0;
    u.regenMul = 1; u.regenEnd = -1; u.regenLen = 0; u.regenTag = ''; u.speedMul = 1; u.speedEnd = -1; u.speedLen = 0; u.speedTag = '';
    // cancel the rig's point simulation, crossfade, reaction and springs (older rigs: a fresh one)
    if (typeof u.rig.reset === 'function') { u.rig.x = u.x; u.rig.y = u.y; u.rig.facing = u.facing; u.rig.reset(); }
    else if ((u.rig.airborne || u.ragUsed) && makeRig) { const r = makeRig(u.color); r.color = u.color; u.rig = r; }
    u.ragUsed = false;
    u.rag = false; u.ragLanded = false; u.queued = null; u.grabbedBy = -1; u.grabTo = null;
    u.combo = 0; u.comboBy = -1; u.airUsed = 0; u.landLag = 0; u.easeBand = false;
    u.floor = 0; u.falling = false; u.breakOK = false; u.fellLanded = false; u.vaultPhase = null;
    u.airHits = 0; u.gScale = 1; u.splatPending = false; u.wallBounce = false; u.groundBounce = false; u.splatT = 0; u.crouchEnd = null; u.glide = null;
    syncRig(u); u.rig.play('idle'); rigUpd(u, 0); u.rig.events.length = 0;
  }
  sim.startRound = (n, { skipIntro = false } = {}) => {
    sim.round = n; sim.floor = 0; sim.floorBroken = false; refreshBounds(); sim.timer = ROUND_TIME; sim.winner = -1; sim.koSlow = 0; sim.finisher = false; sim.callouts.length = 0;
    sim.units.forEach(spawn);
    if (skipIntro) { sim.phase = 'fight'; sim.phaseTimer = 0; sim.banner = ''; }
    else { sim.phase = 'intro'; sim.phaseTimer = sim.introTime; sim.banner = `ROUND ${n}`; }
    onEvent({ type: 'round', round: n });
  };
  // Ragdolls: a KO'd horde goon keeps flying after its unit has been respawned. Snapshot of
  // the rig's joints (as offsets), simple physics, slides to a stop within 150px of the hero,
  // then arena.addBody. main.js draws them with arena.drawJoints.
  sim.ragdolls = [];
  function launchRagdoll(u, vx, vy) {
    const joints = {};
    for (const k in u.rig.joints) joints[k] = { x: u.rig.joints[k].x - u.x, y: u.rig.joints[k].y - u.y };
    sim.ragdolls.push({ x: u.x, y: u.y, floorY: u.y, vx, vy, facing: u.facing, color: u.color, radius: u.rig.radius, joints, grounded: false, spin: 0 });
  }
  function stepRagdolls() {
    const hero = sim.units[0];
    void hero;
    for (let i = sim.ragdolls.length - 1; i >= 0; i--) {
      const r = sim.ragdolls[i];
      if (!r.grounded) { r.vy += GRAVITY * DT; r.y += r.vy * DT; r.spin += r.vx * DT * 0.02; }
      r.x += r.vx * DT;
      if (r.x < bounds.x0 + LIE_PAD) { r.x = bounds.x0 + LIE_PAD; r.vx = -r.vx * 0.3; }
      if (r.x > bounds.x1 - LIE_PAD) { r.x = bounds.x1 - LIE_PAD; r.vx = -r.vx * 0.3; }
      const fy = r.floorY;   // the floor it was standing on, not the building's lowest
      if (!r.grounded && r.vy > 0 && r.y >= fy) {
        // the frame it touches the floor it becomes the arena's (dimmed, settled by its tween),
        // placed within 150px of the hero so the pile grows where he stands
        r.y = fy; r.grounded = true;
        const x = Math.max(hero.x - 150, Math.min(hero.x + 150, r.x));
        const joints = {}; for (const k in r.joints) joints[k] = { x: x + r.joints[k].x, y: r.y + r.joints[k].y };
        arena.addBody({ x, y: r.y, facing: r.facing, color: r.color, radius: r.radius, joints });
        onEvent({ type: 'thud', x, y: r.y, dir: Math.sign(r.vx) || 1, strength: 0.6 });
        sim.ragdolls.splice(i, 1);
      }
    }
  }
  // Horde: P1 faces one goon after another; each KO adds a body and a fresh goon runs in.
  // { goonHealth, goonDifficulty, heal } ; sim.horde.count is the pile so far.
  // Horde, floor by floor: each floor sends a wave of 5 to 8 goons in through its doors (one at a
  // time, two at once from the wave's third goon). Clearing a floor calls FLOOR CLEAR and the hero
  // vaults down the stairwell to the next; after the lowest floor the run loops back to the top.
  // The pile stays on the floor where each goon fell. sim.horde: { floor, floorsCleared, count,
  // wave: { size, spawned, downed }, doorTurn, transit }.
  function goonsLive() { return sim.units.filter(u => u.id >= 1 && !u.hidden); }
  function placeGoon(g) {
    const p = sim.units[0], H = sim.horde, info = floorInfo(H.floor);
    if (!H.wave) H.wave = { size: 5 + Math.min(3, H.floorsCleared), spawned: 0, downed: 0 };
    // the next door in turn, not on top of the hero
    let door = null;
    for (let k = 0; k < info.doors.length; k++) {
      const d = info.doors[(H.doorTurn + k) % info.doors.length];
      if (Math.abs(d.x - p.x) > 160) { door = d; H.doorTurn = (H.doorTurn + k + 1) % info.doors.length; break; }
    }
    if (!door) { const mid = (info.band.x0 + info.band.x1) / 2; door = { x: p.x < mid ? info.band.x1 - 40 : info.band.x0 + 40, y: info.y }; }
    const j = info.doors.indexOf(door);
    if (j >= 0 && typeof arena.openDoor === 'function') arena.openDoor(H.floor, j, 1.2);
    g.floor = H.floor; g.y = info.y; g.grounded = true;
    g.x = Math.max(info.band.x0 + 20, Math.min(info.band.x1 - 20, door.x));
    g.facing = p.x >= g.x ? 1 : -1; g.vx = g.facing * WALK; syncRig(g); safePlay(g.rig, 'walk'); rigUpd(g, 0);
    g.health = H.goonHealth; g.maxHealth = H.goonHealth; g.hitstop = 0; g.flash = 0; g.hidden = false;
    if (g.kind === 'ai' || H.goonsAI) sim.setAI(g.id, H.goonDifficulty);
    H.wave.spawned++;
    onEvent({ type: 'goon', count: H.count, color: g.color, unit: g, floor: H.floor, door: j });
  }
  function freshGoon(g) {
    g.color = GOON_COLORS[(sim.horde.count + g.id) % GOON_COLORS.length]; g.rig.color = g.color;
    spawn(g, g.id);
    placeGoon(g);
  }
  function startWave() {
    const H = sim.horde;
    H.wave = { size: 5 + Math.min(3, H.floorsCleared), spawned: 0, downed: 0 };
    H.transit = null;
    for (let i = 1; i < sim.units.length; i++) sim.units[i].hidden = true;
    freshGoon(sim.units[1]);
    sim.card = { text: `FLOOR ${H.floorsCleared + 1}`, t: 1.0 };
  }
  // a goon went down: the next one comes in, a second joins from the third, the last clears the floor
  function goonDown(g) {
    const H = sim.horde, p = sim.units[0];
    if (!H.wave) H.wave = { size: 5 + Math.min(3, H.floorsCleared), spawned: 1, downed: 0 };   // a goon downed before any wave began
    H.wave.downed++;
    p.health = Math.min(p.maxHealth || sim.startHealth, p.health + H.heal);
    sim.winner = -1; sim.timer = ROUND_TIME;
    if (H.wave.downed >= H.wave.size) { g.hidden = true; floorClear(); return; }
    if (H.wave.spawned < H.wave.size) freshGoon(g); else g.hidden = true;
    if (H.wave.downed >= 2 && H.wave.spawned < H.wave.size && goonsLive().length < 2 && makeRig) {
      let u = sim.units[2];
      if (!u) { const color = GOON_COLORS[(H.count + 3) % GOON_COLORS.length]; u = makeUnit(makeRig(color), 2); u.color = color; u.rig.color = color; u.kind = 'ai'; sim.units.push(u); }
      freshGoon(u);
    }
  }
  function floorClear() {
    const H = sim.horde, p = sim.units[0];
    H.floorsCleared++;
    callout('FLOOR CLEAR', 0, 'trick');
    onEvent({ type: 'floorClear', floor: H.floor, floorsCleared: H.floorsCleared, count: H.count, unit: p });
    note({ type: 'floorClear', floor: H.floor });
    const sw = stairwellNow();
    if (sw && (H.floor === 0) && sw.toFloor != null) {
      // down the stairwell to the next floor (the hero vaults as soon as he's free)
      H.transit = { kind: 'down', to: sw.toFloor, t: 0 };
      p.followDown = sw;
    } else {
      // the lowest floor: the run loops back to the top after a beat
      H.transit = { kind: 'loop', to: 0, t: 0.9 };
    }
  }
  function hordeStep() {
    const H = sim.horde, p = sim.units[0];
    if (!H || !H.transit || sim.phase !== 'fight') return;
    const T = H.transit;
    if (T.kind === 'down') {
      if ((p.floor || 0) === T.to && p.state !== 'vault') { H.floor = T.to; sim.floor = T.to; refreshBounds(); startWave(); }
    } else if ((T.t -= DT) <= 0) {
      const info = floorInfo(T.to);
      H.floor = T.to; sim.floor = T.to; refreshBounds();
      p.floor = T.to; p.y = info.y; p.x = info.spawns[0].x; p.vx = 0; p.grounded = true; p.state = 'idle';
      if (typeof p.rig.reset === 'function') { syncRig(p); p.rig.reset(); }
      setState(p, 'idle'); syncRig(p); rigUpd(p, 0);
      onEvent({ type: 'land', x: p.x, y: p.y, dir: p.facing, strength: 0.4 });
      startWave();
    }
  }
  // fresh: also forget everything left over from earlier play (online: both machines must start a
  // match from the same state, whatever each was showing before, e.g. different attract demos)
  sim.resetMatch = ({ seed = 1, skipIntro = false, startHealth = 100, introTime = INTRO_TIME, horde = null, fresh = false } = {}) => {
    if (fresh) freshState();
    sim.seed = seed; sim.startHealth = startHealth; sim.introTime = introTime;
    sim.hordeCfg = horde;   // a lost run restarts as a fresh run, not as a 1v1
    sim.horde = horde ? { goonHealth: 40, goonDifficulty: 0.5, heal: 6, count: 0, goonsAI: true, floor: 0, floorsCleared: 0, doorTurn: 0, wave: null, transit: null, ...horde } : null;
    sim.ragdolls.length = 0; sim.card = null; sim.combo = null; sim.lastCombo = null;
    if (sim.units.length > 2) sim.units.length = 2;   // extra horde goons go away with the match
    sim.rng = mulberry32(seed);
    for (const u of sim.units) if (u.kind === 'ai') sim.setAI(u.id, u.controller.getDifficulty ? u.controller.getDifficulty() : sim.difficulty, { style: u.controller.style });
    sim.wins = [0, 0]; sim.stepCount = 0; sim.accumulator = 0;
    sim.startRound(1, { skipIntro });
    if (sim.horde) startWave();
  };

  function freshState() {
    if (sim.units.length > 2) sim.units.length = 2;
    sim.units.forEach((u, i) => {
      const { rig, controller, kind } = u;
      for (const k of Object.keys(u)) delete u[k];
      Object.assign(u, makeUnit(rig, i), { controller, kind });
      if (typeof rig.reset === 'function') rig.reset({ full: true });
    });
    for (const k of Object.keys(reachSeen)) delete reachSeen[k];
    Object.assign(reachSeen, reachCalibrated);
    sim.log.length = 0; sim.callouts.length = 0; sim.hitstopActive = 0; sim.koSlow = 0; sim.finisher = false; sim.banner = ''; sim.bannerT = 0;
  }

  // ---- helpers ---------------------------------------------------------------------
  function syncRig(u) {
    if (u.rag) { u.rig.y = u.ragFloor; return; }   // the rig's point simulation owns x while airborne
    u.rig.x = u.x; u.rig.y = u.y - (u.bounce > 0 ? 6 : 0); u.rig.facing = u.facing;
  }
  // Launched bodies (juggles, trick shots, KOs) go to the rig's point simulation; the sim follows
  // its hip and listens for its land / wall / bounce events. vx is world px/s, vy up is negative.
  function startRag(u, worldVx, vy, { wall = 'stop', spin = 300 } = {}) {
    if (typeof u.rig.launch !== 'function') return false;
    u.rig.walls = ragWalls(u);
    if (!u.rag) { u.ragFloor = u.grounded ? u.y : floorUnder(u); u.lastHipY = null; u.ragAt = sim.stepCount; }
    u.rig.y = u.ragFloor;
    try { u.rig.launch({ vx: -worldVx * u.rig.facing, vy, spin, wall }); }
    catch (e) { warnOnce('launch', 'rig.launch threw: ' + e.message); return false; }
    u.rag = true; u.ragLanded = false; u.grounded = false; u.ragUsed = true;
    return true;
  }
  // the walls a launched body meets: its floor's; while it falls down the stairwell, the outer
  // walls of both floors (the opening and the flights lie outside the lower floor's walls)
  // While it falls it is funnelled: at slab height the opening is its walls (so it can't bounce
  // back onto the main floor), through the flights the stair column, near the bottom the outer walls.
  function ragWalls(u) {
    const w = floorInfo(u.floor || 0).walls;
    if (!(u.falling && !u.fellLanded)) return [w.left, w.right];
    const sw = stairwellNow(), t = floorInfo(0), hipY = u.rig.joints && u.rig.joints.hip ? u.rig.joints.hip.y : t.y;
    const outer = [Math.min(t.walls.left, w.left), Math.max(t.walls.right, w.right)];
    if (!sw) return outer;
    if (hipY < t.y + 25) return [sw.x0 + 4, sw.x1 - 4];
    const T = arena.treads || [];
    if (hipY < floorInfo(u.floor).y - 120 && T.length) return [Math.min(sw.x0, ...T.map(q => q.x0)) - 4, Math.max(sw.x1, ...T.map(q => q.x1)) + 4];
    return outer;
  }
  const inAir = (u) => (u.rag ? !u.ragLanded : !u.grounded);
  // a wake-up strike from the floor (frame data wake): lying until its clip's 'stand' key (wakeUp 1), then rising (2)
  const isWake = (u) => u.state === 'attack' && !!FRAME_DATA[u.move] && !!FRAME_DATA[u.move].wake;
  const wakeLying = (u) => isWake(u) && u.wakeUp === 1;
  // touchdown: the body is on the floor (a hit, a throw, a trip, a floor break, a stair tumble), and stays
  // there until its player picks a getup option or DOWN_MAX runs out
  function toDown(u) {
    u.state = 'down'; u.downTimer = DOWN_MAX; u.touchStep = sim.stepCount; floored(u);
    u.buffer = null; u.bufferKeys = null; u.queued = null;   // a press made in the air isn't a getup choice
  }
  const wallMode = (u) => (u.splatPending ? 'splat' : u.wallBounce ? 'bounce' : 'stop');
  // every rig update goes through here: until the rig has crouch clips, a crouching body is the
  // standing pose squashed toward the feet (so highs pass over it, hurtboxes included)
  function rigUpd(u, dt) {
    if (u.rag && !(dt > 0)) return;   // a zero-step update would advance the point simulation
    u.rig.update(dt);
    if (u.crouch && ANIM.fakeCrouch && (u.state !== 'attack' || !FRAME_DATA[u.move] || !FRAME_DATA[u.move].ownClip)) {
      const j = u.rig.joints, y0 = u.rig.y;
      for (const k in j) j[k] = { x: j[k].x, y: y0 + (j[k].y - y0) * CROUCH_SQUASH };
    }
  }
  sim.rigUpd = rigUpd;
  // The first walkable line at or below the feet that spans this x; off an edge, the
  // lowest floor catches everything.
  // flat floors: a unit stands on the floor it is assigned to (stairs are scenery; bodies fall
  // down the stairwell on the rig's point simulation)
  function floorUnder(u) {
    const fl = floorsNow();
    return (fl[u.floor || 0] || fl[0]).y;
  }
  function safePlay(rig, name, opt) {
    // a clip cut short takes its root step (play() commits a travelling clip's shift): the sim's root
    // goes with it, or the next syncRig put the root back and the drawn body snapped by the step
    const u = sim.units.find(v => v.rig === rig), track = u && !u.rag;
    let x0 = 0;
    if (track) { syncRig(u); x0 = rig.x; }
    try { rig.play(name, opt); } catch (e) { warnOnce('play' + name, `rig can't play '${name}', using idle`); rig.play('idle'); }
    if (track && rig.x !== x0) { u.x += rig.x - x0; const b = bandOf(u); if (u.x < b.x0 || u.x > b.x1) u.easeBand = true; }
  }
  // after a rig update: a travelling clip that ended (a cross's step, a stagger, the getup's rise, a
  // botch's stumble, the vault) moved the rig's root under an unchanged pose; the sim's root follows
  // it here, the same step, so nothing (separation, the next syncRig) can put it back under the body
  function takeRoot(u) {
    if (u.rag || u.rig.x === u.x) return;
    const b = bandOf(u);
    u.x = u.rig.x;
    if (u.x < b.x0 || u.x > b.x1) u.easeBand = true;   // a step that ends past the wall eases back in (physics), no snap
  }
  function setState(u, state, anim = state) {
    if (state === 'idle' && anim === 'idle' && u.faint > 0) anim = ANIM.faint;   // out on his feet
    if (u.state === state && (state === 'walk' || state === 'run' || state === 'idle' || state === 'block' || state === 'crouch')) {
      if (anim && u.rig.current.move !== anim && (state === 'idle' || state === 'crouch')) safePlay(u.rig, anim);
      return;
    }
    u.state = state;
    if (state !== 'attack') { u.phase = null; u.move = null; }
    if (state !== 'crouch' && state !== 'blockstun') u.crouch = false;
    if (anim) safePlay(u.rig, anim);
  }
  // Stamina: every action spends, and at 0 the fighter faints. The strike (or jump) that emptied
  // the bar still comes out, but nothing cancels out of it; the faint itself starts when he is back
  // on his feet (see regen). Blocking spends too, but never takes the last point.
  const FAINT_STEPS = Math.round(STAMINA.faintTime * 120);
  function spend(u, n, { noFaint = false } = {}) {
    if (!n) return;
    u.stamina = Math.max(noFaint ? Math.min(u.stamina, 1) : 0, u.stamina - n);
    u.regenAt = sim.stepCount + Math.round(STAMINA.delay * 120);
    if (u.stamina <= 0 && !(u.faint > 0)) {
      u.faint = FAINT_STEPS; u.faintDmg = 0; u.faintAt = sim.stepCount; u.running = false; u.queued = null;
      callout('FAINT', u.id, 'faint');
      note({ type: 'faint', def: u.id });
    }
  }
  function endFaint(u) {
    u.faint = 0; u.faintDmg = 0;
    u.stamina = Math.max(u.stamina, STAMINA.faintRecover); u.regenAt = sim.stepCount;
    if (u.state === 'idle') safePlay(u.rig, 'idle');
  }
  sim.endFaint = endFaint;
  // knocked down (a hit, a throw, a trip, a floor break, a stair tumble): the bar refills to the top as he
  // hits the floor, and any faint ends; the HUD and the status effects flash it ('refill')
  function floored(u) {
    if (u.faint > 0) endFaint(u);
    u.rootT = 0;   // a root (frame data root) ends when he hits the floor
    const smax = u.staminaMax || STAMINA.max;
    if (u.stamina < smax) { u.stamina = smax; onEvent({ type: 'refill', unit: u }); }
  }
  function regen(u) {
    if (u.faint > 0) {
      // a knockdown (or a throw) knocks him out of it: he gets up with the recovery stamina
      if (LYING.has(u.state) || u.state === 'knockdown' || u.state === 'splat' || u.state === 'grabbed') { endFaint(u); return; }
      // the clock runs once he's back on his feet; the bar refills toward the recovery stamina
      if (u.state === 'attack' || !u.grounded) return;
      u.faint--;
      u.stamina = STAMINA.faintRecover * (1 - u.faint / FAINT_STEPS);
      if (u.faint <= 0) endFaint(u);
      return;
    }
    const guarding = u.state === 'block' || u.state === 'blockstun' || (u.state === 'crouch' && u.backHeld);
    if (u.state === 'attack' || u.state === 'run' || u.state === 'botch') return;
    const smax = u.staminaMax || STAMINA.max, rk = (u.char ? u.char.stats.regen : 1) * (sim.stepCount < u.regenEnd ? u.regenMul : 1);   // a timed regen status (applyStatus)
    if (guarding) u.stamina = Math.min(smax, u.stamina + STAMINA.regenBlock * rk * DT);
    else if (sim.stepCount >= u.regenAt) u.stamina = Math.min(smax, u.stamina + STAMINA.regen * rk * DT);
  }
  // timed statuses (frame data `status` lands on the defender with a hit, `selfStatus` on the attacker at
  // the move's first active key): { regen, speed, ms, tag }. regen multiplies his stamina regen, speed the
  // rate his strikes' startups play at; a fresh one replaces the old. Plain unit fields, cleared each round.
  function applyStatus(u, st) {
    const end = sim.stepCount + Math.round((st.ms || 2000) * 0.12);
    if (st.regen != null) { u.regenMul = st.regen; u.regenEnd = end; u.regenLen = end - sim.stepCount; u.regenTag = st.tag || ''; }
    if (st.speed != null) { u.speedMul = st.speed; u.speedEnd = end; u.speedLen = end - sim.stepCount; u.speedTag = st.tag || ''; }
    onEvent({ type: 'status', unit: u, tag: st.tag || '' });
  }
  // where the wall is behind a body pushed in direction dir
  const wallGap = (u, dir) => (dir > 0 ? bounds.x1 - u.x : u.x - bounds.x0);
  function startAttack(u, move, rigOpt = null) {
    const isCancel = u.state === 'attack';   // chained out of a strike that connected
    // a travelling clip cut short takes its step before he turns (the step is along the old facing)
    if (!u.rag && typeof u.rig.commitShift === 'function') { syncRig(u); const x0 = u.rig.x; u.rig.commitShift(); u.x += u.rig.x - x0; }
    // how many times in a row this move has cancelled into itself (cancelOK limits it)
    u.selfChain = isCancel && u.move === move ? (u.selfChain || 0) + 1 : 0;
    // turn to face the opponent as the attack starts: a chain of buffered attacks never
    // passes through an idle tick, and after a chase the two can have swapped sides
    const opp = oppOf(u);
    const fd0 = FRAME_DATA[move];
    if (u.grounded && opp && !fd0.wake) { const ox = bodyX(opp); if (Math.abs(ox - u.x) > 4) u.facing = ox > u.x ? 1 : -1; }   // a wake-up strike already faces him (startWake)
    u.wakeUp = fd0.wake ? 1 : 0;
    u.state = 'attack'; u.move = move; u.phase = 'startup'; u.hitConfirmed = false; u.attackId++; u.launchCancelAt = 0; u.otgConfirm = false;
    u.attackStart = sim.stepCount; u.crouch = !!fd0.tc; u.activeAt = -1; u.recoverAt = -1;
    // throws whiff on a croucher (crouch beats throws, mids beat crouch)
    u.grabOK = !!fd0.throw && opp && Math.abs(opp.x - u.x) <= (fd0.range || FRAME_DATA.throw.range) && !opp.crouch;
    u.armorLeft = fd0.armor ? (fd0.armor.hits || 1) : 0; u.hitN = 0; u.hitKey = 0;   // character hooks: armor, multi-hit
    // the string this press belongs to (a named move from the AI starts one from its token; a character's
    // own move that opens one of its strings, named by the CPU, starts it from that string's first key)
    const opens = !MOVE_TOKEN[move] && fd0.owner && u.char.strings.find(s => s.moves[0] === move);
    u.seq = u.bufferKeys || (MOVE_TOKEN[move] ? [MOVE_TOKEN[move]] : opens ? [opens.keys[0]] : null);
    u.seqName = u.bufferName || '';
    u.bufferKeys = null; u.bufferName = '';
    spend(u, fd0.cost);
    if (fd0.air) {
      u.airUsed = (u.airUsed || 0) + 1;
      // the dive kick ends the jump early: an angled stomp down and forward
      if (fd0.dive) { u.vy = Math.max(u.vy, 560); u.vx = u.facing * 240; }
    }
    u.buffer = null; u.running = false;
    if (u.queued) { const q = u.queued; u.queued = null; if (!(u.faint > 0)) { u.buffer = q.attack; u.bufferKeys = q.keys; u.bufferName = q.name; u.bufferAge = 0; } }
    const carry = u.followThrough;          // a cancel keeps the momentum of the hit it came from
    u.followThrough = false; u.chase = false;
    if (u.grounded && !carry) u.vx = 0;
    // a travelling move (a slide, a charge): the body glides from `at` ms into the clip (the pre-roll is
    // already 50ms in) for `ms`, at vx times the character's dash stat
    if (fd0.travel && u.grounded) {
      const tv = fd0.travel, from = sim.stepCount + Math.max(0, Math.round(((tv.at || 0) - PREROLL * 1000) * 0.12));
      u.glide = { vx: u.facing * tv.vx * u.char.stats.dash, from, until: from + Math.round((tv.ms || 200) * 0.12) };
    }
    // a string keeps its shape: a cancelled strike steps in during its startup when the
    // reeling victim is outside its reach (the cross connects long, the roundhouse is short)
    if (isCancel && opp && (opp.state === 'hitstun' || (opp.state === 'knockdown' && inAir(opp) && opp.comboBy === u.id))) {
      // an airborne body keeps drifting: aim at where it will be when the strike lands
      const md = MOVE_DATA_ && MOVE_DATA_[FRAME_DATA[move].anim];
      const lead = opp.state === 'knockdown' ? opp.vx * ((md && md.activeAt) || 150) / 1000 : 0;
      const gap = Math.abs(opp.x + lead - u.x) - (reachOf(u, move) - (opp.state === 'knockdown' ? 44 : 34));   // his reaction leans away; solid bodies stop the step at contact
      if (gap > 0 && !fd0.travel) u.glide = { vx: u.facing * Math.min(RUN * 1.6, gap / 0.18 + (opp.state === 'knockdown' ? 0 : Math.abs(opp.vx) * 0.6)), until: sim.stepCount + 22 };
    }
    // an air hit (a juggle, or a body splatted on the wall) aims its tip at the body's chest where
    // it will be at contact; the rig retargets the strike to reach it
    let opt;
    const mdT = MOVE_DATA_ && MOVE_DATA_[fd0.anim], tT = Math.max(0.02, ((mdT && mdT.activeAt) || 150) / 1000 - PREROLL);
    const oppJumping = opp && !opp.grounded && !opp.rag && (opp.state === 'jump' || (opp.state === 'attack' && FRAME_DATA[opp.move] && FRAME_DATA[opp.move].air));
    if (fd0.wake) { /* from the floor: thrown as keyed */ }
    else if (opp && !fd0.throw && !fd0.bothSides && ((fd0.air && opp.grounded) || (!fd0.air && u.grounded && oppJumping))) {   // a bothSides spin keeps its shape (no aiming)
      // the rig aims the striking segment's frontmost edge at the target: give it the defender's
      // surface nearest the strike's origin, where both bodies will be at contact (the jumper keeps
      // flying, the jumping attacker's root keeps moving and the tip moves with it)
      const g = 1000 * tT * tT;
      const odx = opp.grounded ? 0 : opp.vx * tT, ody = opp.grounded ? 0 : opp.vy * tT + g;
      const udx = u.grounded ? 0 : u.vx * tT, udy = u.grounded ? 0 : u.vy * tT + g;
      const j = u.rig.joints, origin = fd0.air ? { x: j.hip.x + udx, y: j.hip.y + udy } : { x: j.rShoulder.x, y: j.rShoulder.y };
      const sp = surfaceToward(opp, origin, odx, ody);
      // after an air jump (mechanics.airJumps / wallJump) he's above the reach the homing was built for:
      // it swung the leg back under him and lunged the hips past the body; the strike drops onto him as keyed
      const airJumped = fd0.air && (u.airJumpsUsed || u.wallJumps);
      if (sp && !airJumped) opt = { target: { x: sp.x - udx, y: sp.y - udy } };
    } else if (opp && !fd0.throw && !fd0.bothSides && (opp.state === 'splat' || (opp.state === 'knockdown' && opp.rag && inAir(opp)))) {
      const md = MOVE_DATA_ && MOVE_DATA_[fd0.anim], t = Math.max(0.02, ((md && md.activeAt) || 150) / 1000 - PREROLL);
      const c = opp.rig.joints.chest || opp.rig.joints.hip, moving = opp.state !== 'splat';
      let tx = c.x + (moving ? opp.vx * t : 0);
      const ty = Math.min(opp.ragFloor - 30, c.y + (moving ? opp.vy * t + 950 * t * t : 0));
      if (u.glide) tx -= u.glide.vx * Math.min(22, t * 120) / 120;   // the glide carries the root (and the tip) that far
      opt = { target: { x: tx, y: ty } };
    }
    // an air attack's body travel (the homing lunge, the ease onto the arc) is spread over the time
    // the player actually sees: from the pre-roll to the moment the strike goes live
    if (fd0.air) opt = { ...(opt || {}), shownAt: PREROLL * 1000, liveMs: earlyMs(u) };
    if (rigOpt) opt = { ...(opt || {}), ...rigOpt };   // the flail's forces (botch)
    safePlay(u.rig, FRAME_DATA[move].anim || move, opt);
    // pre-roll: the frame the button is seen already shows the anticipation (the rig's first
    // 17ms moves under 6px, which reads as no response)
    syncRig(u); rigUpd(u, PREROLL); drainRig(u);
    onEvent({ type: 'attack', unit: u, move });
  }
  // the point of a body's drawn silhouette nearest `origin`, with the body moved by (dx, dy)
  function surfaceToward(def, origin, dx = 0, dy = 0) {
    let best = null, bd = Infinity;
    for (const [p, q, r] of drawnShapes(def)) {
      const a = { x: p.x + dx, y: p.y + dy }, b = { x: q.x + dx, y: q.y + dy };
      const abx = b.x - a.x, aby = b.y - a.y, l2 = abx * abx + aby * aby;
      let t = l2 ? ((origin.x - a.x) * abx + (origin.y - a.y) * aby) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const c = { x: a.x + abx * t, y: a.y + aby * t }, d = dm.hypot(origin.x - c.x, origin.y - c.y) || 1;
      if (d - r < bd) { bd = d - r; best = { x: c.x + (origin.x - c.x) / d * r, y: c.y + (origin.y - c.y) / d * r }; }
    }
    return best;
  }
  function snapshot(u) {
    // the pile gets the landing pose (limbs splayed) rather than the settled flat one
    const src = u.landJoints || u.rig.joints;
    const joints = {};
    for (const k in src) joints[k] = { x: src[k].x, y: src[k].y };
    return { x: u.x, y: u.y, facing: u.facing, color: u.color, radius: u.rig.radius, joints, name: u.name };
  }

  // ---- per-step unit logic ----------------------------------------------------------
  function edges(u, inp) {
    const prev = u.last;
    // guard is holding back (away from the opponent); the touch BLOCK button and the AI's
    // `block` mean the same. Down is crouch; down-back is the crouching guard.
    const back = inp.dx * u.facing < 0 || !!inp.block;
    u.backHeld = back; u.downHeld = !!inp.down;
    // the GUARD button (B, touch GUARD, the AI's `block`) means hold back: it walks back too
    const e = { dx: inp.dx || (inp.block && !inp.down ? -u.facing : 0), dxPress: inp.dx && inp.dx !== prev.dx ? inp.dx : 0, run: inp.run, block: back, down: !!inp.down, jump: inp.jump && !prev.jump, up: !!inp.jump, attack: null, keys: null, name: '' };
    const press = (b) => inp[b] && !prev[b];
    const t13 = (press('lp') || press('lk')) && inp.lp && inp.lk, t24 = (press('rp') || press('rk')) && inp.rp && inp.rk;
    if ((t13 || t24) && !inStance(u)) e.attack = (u.grounded && commandMove(t13 ? 'throw13' : 'throw24', inp, u, sim.stepCount, false)) || 'throw';   // 1+3 or 2+4 (a character's command grab first; in a stance the buttons are read one by one)
    else for (const b of ['lp', 'rp', 'lk', 'rk']) if (press(b)) { Object.assign(e, resolvePress(u, b, inp)); break; }
    if (!e.attack) for (const m of ATTACKS) if (inp[m] && !prev[m] && !FRAME_DATA[m].botch && (!FRAME_DATA[m].owner || canUse(u.char, m))) { e.attack = m; break; }   // the AI names moves directly (its own character's)
    // double-tap run
    if (inp.dx && inp.dx !== prev.dx) {
      if (u.tapTimer > 0 && u.tapDir === inp.dx && !inp.touch) u.running = true;
      u.tapDir = inp.dx; u.tapTimer = 0.25;
    }
    if (!inp.dx) u.running = false;
    u.tapTimer = Math.max(0, u.tapTimer - DT);
    u.last = inp;
    return e;
  }

  // A press inside a live string continues it (the string table decides the move); otherwise
  // it is the plain button move and may start a string. An ender costs a big chunk of stamina;
  // one thrown with too little left still comes out, and the fighter faints after it.
  function seqLive(u) {
    if (!u.seq) return false;
    if (u.state === 'attack') return true;
    const o = oppOf(u);
    // between hits of a juggle, or a beat after the last strike while he still reels
    return !!o && o.comboBy === u.id && (o.state === 'hitstun' || o.state === 'blockstun' || (o.state === 'knockdown' && !o.grounded) || o.state === 'splat');
  }
  // A stance (frame data stance: { moves, hold, min, exit }, WELLNESS COACH's Tree Pose): until it recovers,
  // a press of one of its buttons is that button's stance move, whatever the stick says
  const inStance = (u) => u.state === 'attack' && u.phase !== 'recovery' && !!FRAME_DATA[u.move] && !!FRAME_DATA[u.move].stance;
  const stanceMoves = (u) => (inStance(u) ? Object.values(FRAME_DATA[u.move].stance.moves) : []);
  function resolvePress(u, b, inp) {
    const sm = inStance(u) && FRAME_DATA[u.move].stance.moves[BTN_NUM[b]];
    if (sm && canUse(u.char, sm)) return { attack: sm, keys: null, name: '' };
    const tok = (inp.down ? 'd' : '') + BTN_NUM[b];
    if (u.state === 'jump' || !u.grounded) return { attack: resolveButton(b, inp, u, sim.stepCount), keys: null, name: '' };
    if (seqLive(u)) {
      const cand = [...u.seq, tok], m = matchStrings(cand, u.char.strings);
      if (m.length) {
        const s0 = m.find(s => s.keys.length === cand.length) || m[0];
        const move = s0.moves[cand.length - 1];
        return { attack: move, keys: cand, name: s0.name };
      }
    }
    return { attack: resolveButton(b, inp, u, sim.stepCount), keys: [tok], name: '' };
  }
  sim.resolvePress = resolvePress;

  // Which buffered strike may cancel the one that just connected. A button press cancels only as
  // the next hit of a string in the table (strings.js), so mashing one button gives that button's
  // string and then has to wait out the recovery. A move named directly (the AI, the test scripts)
  // goes by the move's own `cancels` list, and cancels into itself at most once in a row.
  function cancelOK(u) {
    if (u.bufferKeys) return u.bufferKeys.length > 1;
    const fd = FRAME_DATA[u.move];
    if (!fd || !fd.cancels.includes(u.buffer)) return false;
    return !(u.buffer === u.move && (u.selfChain || 0) >= 1);
  }
  // a button pressed in the air but landing first is the ground move of that button (the jump-in
  // combo's first ground hit, and it starts a string)
  const GROUND_OF = { jumpJab: ['jab', '1'], jumpCross: ['cross', '2'], flyingKick: ['lkick', '3'], airRoundhouse: ['roundhouse', '4'], diveKick: ['sweep', 'd4'] };
  function tryAttack(u) {
    if (u.faint > 0) { u.buffer = null; u.bufferKeys = null; u.queued = null; return false; }   // fainted: nothing comes out
    if (!u.buffer || !u.grounded) return false;
    const g = GROUND_OF[u.buffer];
    if (g) { u.buffer = g[0]; u.bufferKeys = [g[1]]; u.bufferName = ''; }
    startAttack(u, u.buffer);
    return true;
  }

  // ---- botches and happy accidents (src/combat/botch.js) -------------------------------------
  // The token a press goes by for strings and accidents: a button's digit ('d' first when down is held),
  // 'T' for a throw; a move the CPU or a script names goes by its button.
  const pressTok = (e) => (e.keys && e.keys.length ? e.keys[e.keys.length - 1] : e.attack && FRAME_DATA[e.attack] && FRAME_DATA[e.attack].throw ? 'T' : (e.attack && MOVE_TOKEN[e.attack]) || null);
  const digitOf = (t) => (t && t[0] === 'd' ? t.slice(1) : t);
  // steps until the strike out now ends (the rig's clock over its blend and keys)
  function stepsLeft(u) {
    const md = MOVE_DATA_ && FRAME_DATA[u.move] && MOVE_DATA_[FRAME_DATA[u.move].anim];
    if (!md || !md.duration) return 0;
    return (1 - u.rig.current.t) * ((md.blend || 0) + md.duration) * 0.12;
  }
  // whole steps since a key of the strike out now ('start' the press, 'active' its contact key,
  // 'recover' its recovery key), on the strike's own clock: a hit's freeze stops it
  function stepsSince(u, rel) {
    const md = MOVE_DATA_ && FRAME_DATA[u.move] && MOVE_DATA_[FRAME_DATA[u.move].anim];
    if (!md || !md.duration || md.activeAt == null) return null;
    // the clock sits on the step grid (the pre-roll, then 1/120 s a step): count whole steps from the
    // press, and the key's step is the first one at or past it (no float lands on a floor's edge)
    const n = Math.round((u.rig.current.t * ((md.blend || 0) + md.duration) - PREROLL * 1000) * 0.12);
    if (rel === 'start') return n;
    const key = rel === 'active' ? (md.blend || 0) + md.activeAt : (md.blend || 0) + md.cancel[0];
    return n - Math.ceil((key - PREROLL * 1000) * 0.12 - 1e-6);
  }
  sim.stepsSince = stepsSince;
  // Is this press mistimed? Everything that legally carries on from the strike out now behaves as it
  // always has: a string's next press, a listed cancel, a throw replacing the first steps of a strike
  // (1, then 3 a frame late), any press after a launch or knockdown connected (its recovery is cut short
  // for the follow-up) or while my juggle is in the air, and anything in the last BOTCH_GRACE steps of
  // the recovery. Any other strike pressed in the startup, active frames or most of the recovery is
  // mistimed. In the air: a second air attack while the first is still swinging (one per jump), unless
  // it connected (the jump-in's ground string buffers for the landing) or he's about to land.
  // A happy accident's window outranks the buffer's leniency (a launch's follow-up, a juggle, the grace)
  // but never a string's next press or a listed cancel. Returns null (the press behaves as it always
  // has), 'botch', or the accident it makes.
  // A designed cancel (frame data feint: { ms, into: { pressed move: move that comes out } }, SALES REP's
  // Cold Call): a press listed in `into`, made in the strike's first `ms` of startup, replaces it at once.
  function feintOf(u, m) {
    const fd = u.state === 'attack' && u.phase === 'startup' && m && FRAME_DATA[u.move], f = fd && fd.feint, to = f && f.into[m];
    return to && sim.stepCount - u.attackStart <= Math.round(f.ms * 0.12) && canUse(u.char, to) ? to : null;
  }
  function pressVerdict(u, e) {
    if (!sim.botchOn || u.state !== 'attack' || !e.attack || u.faint > 0) return null;
    if (stanceMoves(u).includes(e.attack)) return null;   // a stance's own buttons carry on from it
    if (e.feint || feintOf(u, e.attack)) return null;   // a designed cancel (frame data feint)
    const fd = FRAME_DATA[u.move];
    if (!fd || fd.botch) return null;
    // a wake-up strike: there's no standing body to tangle, so a press thrown into it is just lost (the last
    // BOTCH_GRACE steps of its stand-up still buffer, like any recovery)
    if (fd.wake) return u.phase === 'recovery' && stepsLeft(u) <= BOTCH_GRACE ? null : 'lost';
    if (!u.grounded && fd.air) {
      if (u.hitConfirmed || u.phase === 'recovery' || u.rig.current.done || !FRAME_DATA[e.attack] || !FRAME_DATA[e.attack].air) return null;
      const toFloor = u.vy > 0 ? (floorUnder(u) - u.y) / u.vy * 120 : Infinity;
      return toFloor > BOTCH_GRACE + 4 ? 'botch' : null;
    }
    const tok = pressTok(e);
    if (tok) for (const keys of [u.seq, u.bufferKeys, u.queued && u.queued.keys]) if (keys && keys.length && matchStrings([...keys, tok], u.char.strings).length) return null;
    if (!e.keys && fd.cancels.includes(e.attack) && !(e.attack === u.move && (u.selfChain || 0) >= 1)) return null;
    if (FRAME_DATA[e.attack] && FRAME_DATA[e.attack].throw && u.phase === 'startup' && sim.stepCount - u.attackStart <= 4) return null;
    const acc = accidentFor(u, digitOf(tok), (rel) => stepsSince(u, rel));
    if (acc && canUse(u.char, acc.move)) return acc;
    if (u.hitConfirmed && (u.launchCancelAt || u.otgConfirm)) return null;
    const o = oppOf(u);
    if (o && o.comboBy === u.id && ((o.state === 'knockdown' && inAir(o)) || o.state === 'splat')) return null;
    if (u.phase === 'recovery' && stepsLeft(u) <= BOTCH_GRACE) return null;
    return 'botch';
  }
  const mistimed = (u, e) => pressVerdict(u, e) !== null;
  sim.mistimed = mistimed;
  sim.pressVerdict = pressVerdict;
  // a body whose spin has turned its back to the opponent (a spin-out): a hit from behind is a counter
  const backTurned = (u) => { const s = ((((u.rig.pose && u.rig.pose.spin) || 0) % 360) + 360) % 360; return s > 110 && s < 250; };
  // a travelling clip interrupted: take its root step now (the world pose doesn't move), the way a hit
  // on a travelling strike does
  function takeShift(u) {
    if (typeof u.rig.commitShift !== 'function' || u.rag) return;
    syncRig(u); const x0 = u.rig.x; u.rig.commitShift(); u.x += u.rig.x - x0; u.botchShift = 0;
  }
  const SPINNING = new Set(['spinKick', 'spinHeel', 'neonTornado', 'crescent', 'mopSpin', 'helicopter', 'pivotBackfist']);
  // The forces: what the strike out now was doing (its limb and which way it turns the body, its
  // phase, the hips' speed, the limb's speed, the lean, a glide or a lunge under it) against what the
  // press wants (its limb, its height, forward or not, a throw), all quantized, plus one draw from
  // sim.rng. botch.js picks the family; each one is fed to the rig's own tools: a clip built from
  // those numbers on top of the pose and momentum the body has (play('botch')), the point simulation
  // for a fall, the flail as a real (weak) strike.
  function botch(u, e, opp) {
    const tok = pressTok(e);
    const fdc = FRAME_DATA[u.move], fdn = FRAME_DATA[e.attack] || fdc;
    const j = u.rig.joints, pj = u.prevJoints || j;
    const cj = fdc.joint || (fdc.limb === 'foot' ? 'rFoot' : 'rHand'), nj = fdn.joint || (fdn.limb === 'foot' ? 'rFoot' : 'rHand');
    const hipV = (j.hip.x - pj.hip.x) * 120 * u.facing;
    const limbV = j[cj] && pj[cj] ? dm.hypot(j[cj].x - pj[cj].x, j[cj].y - pj[cj].y) * 120 : 0;
    const pose = u.rig.pose || {}, md = MOVE_DATA_ && MOVE_DATA_[fdc.anim];
    const q = (v, s, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v / s)));
    const f = {
      cur: { foot: isFoot(cj), side: sideOf(cj), phase: u.phase === 'startup' ? 0 : u.phase === 'active' ? 1 : 2,
        spin: SPINNING.has(u.move) || ((((pose.spin || 0) % 360) + 360) % 360) !== 0, travel: !!fdc.travel || !!u.glide || !!(md && md.shift >= 40), ender: !!fdc.ender, low: fdc.height === 'low' },
      nw: { foot: isFoot(nj), side: sideOf(nj), low: fdn.height === 'low' || !!e.down, fwd: (e.dx || 0) * u.facing > 0 || !!fdn.travel, thrown: !!fdn.throw },
      hv: q(hipV, 40, -12, 12), lv: q(limbV, 100, 0, 20), lean: q(pose.torso || 0, 5, -12, 12),
    };
    const low = u.stamina < 30, r = sim.rng(), from = u.move, air = !u.grounded, seq0 = (u.seq || []).join(' ') + ' | ' + tok + ' @' + u.phase + (u.hitConfirmed ? ' hit' : '');
    const pick = air ? { kind: 'air', sev: 1 + f.cur.phase, alt: Math.floor(r * 4) & 3 } : chooseBotch(f, r, { noTrip: low });
    const kind = pick.kind, sev = pick.sev, alt = pick.alt;
    // a botch while low on stamina tips into a faint: it takes the rest of the bar
    const cost = low ? u.stamina : botchCost(kind, sev, f, fdn.cost, fdc.ender);
    if (!air) takeShift(u);
    u.buffer = null; u.bufferKeys = null; u.bufferName = ''; u.queued = null; u.seq = null; u.seqName = '';
    u.glide = null; u.followThrough = false; u.chase = false; u.launchCancelAt = 0; u.otgConfirm = false;
    u.botchSev = sev; u.botchAt = sim.stepCount; u.botchShift = 0;
    callout(BOTCH_CALLOUT[kind], u.id, 'botch');
    note({ type: 'botch', att: u.id, kind, from, press: e.attack, sev, f: [f.hv, f.lv, f.lean, f.cur.phase], at: seq0 });
    onEvent({ type: 'botch', unit: u, kind, from, press: e.attack, x: u.x, y: u.y - 90, dir: u.facing });
    // how far a stumble may carry him: never into the opponent's body or through a wall
    const room = (want) => {
      const b = bandOf(u), wall = u.facing > 0 ? b.x1 - u.x : u.x - b.x0, gap = opp ? (bodyX(opp) - u.x) * u.facing : Infinity;
      return Math.max(0, Math.min(want, wall - 4, gap > 0 ? gap - 76 : want));
    };
    const sc = u.rig.scale || 1, rb = { sev, alt, limb: nj, cur: cj, rot: f.cur.side || 1 };
    if (kind === 'air') {
      // tangled in the air: the body goes to the point simulation with the jump's momentum and a twist,
      // and lands in a heap (the knockdown and getup flow)
      u.botchKind = 'air'; u.state = 'knockdown'; u.phase = null; u.move = null; u.juggle = false; u.landJoints = null; u.otgHit = false; u.rolled = false; u.breakOK = false;
      u.launchedBy = -1;
      if (!startRag(u, u.vx * 0.8, Math.min(u.vy, 120) - 60, { wall: 'stop', spin: (f.cur.side || 1) * (260 + 60 * sev) })) safePlay(u.rig, 'knockdown');
    } else if (kind === 'flail') {
      // both arms at once: a weak, ugly double swing, a real strike that can still land
      u.state = 'idle'; u.move = null; u.phase = null;
      startAttack(u, 'flail', { botch: { sev, alt } });
      u.seq = null;
    } else {
      let d = 0;
      if (kind === 'over') d = room(Math.min(80, 26 + 12 * sev + Math.max(0, f.hv) * 3));
      else if (kind === 'spin') d = room(6 + 6 * sev);
      u.vx = 0; u.botchShift = d; u.botchFwd = f.hv >= 2 || f.lean >= 5 || (f.nw.fwd && !f.nw.foot) ? 1 : -1;
      setState(u, 'botch', null);
      safePlay(u.rig, 'botch', { botch: { ...rb, kind, d: d / sc, fwd: u.botchFwd > 0, anim: fdn.anim || e.attack } });
    }
    u.botchKind = kind;
    spend(u, cost);
  }
  // the botch clip ran out: take its step and stand, or (a trip) pitch over into a knockdown
  function endBotch(u) {
    if (u.botchKind === 'trip') {
      const fw = u.botchFwd > 0, sev = u.botchSev || 1;
      u.state = 'knockdown'; u.juggle = false; u.landJoints = null; u.otgHit = false; u.rolled = false; u.breakOK = false; u.launchedBy = -1;
      syncRig(u);
      if (!startRag(u, u.facing * (fw ? 110 + 30 * sev : -(90 + 30 * sev)), -140, { wall: 'stop', spin: fw ? -(320 + 60 * sev) : 300 + 60 * sev })) { safePlay(u.rig, 'knockdown'); u.vy = -150; u.grounded = false; }
      onEvent({ type: 'thud', x: u.x, y: u.y, dir: u.facing, strength: 0.3 });
      return;
    }
    u.botchShift = 0;   // the stumble's step: the root took it with the clip's end (takeRoot) or its replacement (safePlay)
    u.botchKind = '';
    if (u.downHeld && !(u.faint > 0)) { setState(u, 'crouch', u.backHeld ? ANIM.crouchBlock : ANIM.crouch); u.crouch = true; } else setState(u, 'idle');
    syncRig(u);
  }
  // A happy accident: the mistimed press landed in a technique's window. It comes out as its own move
  // (a fresh strike from wherever the body is, with its own clip and frame data), with a callout.
  function happyAccident(u, acc) {
    takeShift(u);
    u.state = 'idle'; u.move = null; u.phase = null;
    u.buffer = null; u.bufferKeys = null; u.bufferName = ''; u.queued = null; u.glide = null; u.launchCancelAt = 0;
    startAttack(u, acc.move);
    u.seq = null;
    callout('HAPPY ACCIDENT · ' + acc.name, u.id, 'accident');
    note({ type: 'accident', att: u.id, id: acc.id });
    onEvent({ type: 'accident', unit: u, id: acc.id, name: acc.name, x: u.x, y: u.y - 100 });
  }
  // For the CPU (ai.js): would this held input's fresh press botch right now? Nothing is changed.
  sim.pressMistimed = (u, inp) => {
    if (!sim.botchOn || u.state !== 'attack' || u.botchKind) return false;
    const prev = u.last || EMPTY_INPUT, press = (b) => inp[b] && !prev[b];
    const e = { attack: null, keys: null, name: '', dx: inp.dx || 0, down: !!inp.down };
    const t13 = (press('lp') || press('lk')) && inp.lp && inp.lk, t24 = (press('rp') || press('rk')) && inp.rp && inp.rk;
    if ((t13 || t24) && !inStance(u)) e.attack = (u.grounded && commandMove(t13 ? 'throw13' : 'throw24', inp, u, sim.stepCount, false)) || 'throw';
    else for (const b of ['lp', 'rp', 'lk', 'rk']) if (press(b)) { Object.assign(e, resolvePress(u, b, inp)); break; }
    if (!e.attack) for (const m of ATTACKS) if (inp[m] && !prev[m] && !FRAME_DATA[m].botch && (!FRAME_DATA[m].owner || canUse(u.char, m))) { e.attack = m; break; }
    return !!e.attack && mistimed(u, e);
  };
  // For the CPU's showcase flavor: the technique whose window is open on this step, if any
  sim.openAccident = (u) => {
    if (!sim.botchOn || u.state !== 'attack') return null;
    for (const a of ACCIDENTS) if (accidentFor(u, a.tok, (rel) => stepsSince(u, rel)) === a && canUse(u.char, a.move)) return a;
    return null;
  };

  function updateUnit(u, opp, e) {
    // only from his feet: a vault begun in the air was cancelled by the landing and left him upstairs
    if (u.followDown && u.grounded && (MOVE_STATES.has(u.state) || u.state === 'block' || u.state === 'crouch' || u.state === 'landing' || (u.state === 'attack' && u.phase === 'recovery'))) {
      startVault(u, u.followDown); u.followDown = null;
    }
    // standing right over a body on the floor he keeps his facing (its hip drifts as it lies there); he turns once it's clearly behind him
    { const ox = bodyX(opp), turnAt = NOT_SOLID_BODY.has(opp.state) || opp.rag ? 30 : 4; if (FACE_STATES.has(u.state) && u.grounded && Math.abs(ox - u.x) > turnAt) u.facing = ox > u.x ? 1 : -1; }
    switch (u.state) {
      case 'idle': case 'walk': case 'run': {
        if (u.faint > 0 && u.grounded) {
          // fainted: no attack, guard, crouch, jump or run; a slow stagger in the held direction
          tryAttack(u); u.running = false;
          if (e.dx) { u.vx = e.dx * WALK * u.char.stats.walk * STAMINA.faintWalk; u.followThrough = false; }
          else if (u.followThrough) { u.vx *= STUMBLE_FRICTION; if (Math.abs(u.vx) < 60) { u.vx = 0; u.followThrough = false; u.chase = false; } }
          else u.vx = Math.abs(u.vx) > 20 ? u.vx * 0.85 : 0;
          setState(u, 'idle');
          break;
        }
        if (u.rootT > 0) { e.dx = 0; e.jump = false; u.running = false; }   // rooted (frame data root): no walk, run or jump; the guard still works
        if (tryAttack(u)) break;
        if (e.down) { u.vx = 0; u.followThrough = false; setState(u, 'crouch', e.block ? ANIM.crouchBlock : ANIM.crouch); u.crouch = true; break; }
        // holding back walks back; the guard snaps on only when a strike that can reach him is coming
        // (a hit that lands while he holds back is blocked anyway: canGuard in applyHit)
        if (e.block && threat(u, opp)) { u.vx = 0; setState(u, 'block'); break; }
        if (e.jump) {
          const cs = u.char.stats;
          u.vy = -JUMP_VY * cs.jump; u.vx = e.dx * ((e.run || u.running) && u.stamina > 0 ? RUN * cs.run * 0.8 : WALK * cs.walk * 1.15); u.grounded = false;
          u.jumpVx = u.vx; u.jumpAt = sim.stepCount; u.airUsed = 0; u.airWhiffEarly = false; u.airJumpsUsed = 0; u.wallJumps = 0;
          spend(u, STAMINA.jump);
          setState(u, 'jump'); onEvent({ type: 'dust', x: u.x, y: u.y, dir: u.facing }); break;
        }
        if (e.dx) {
          // running drains the bar down to 1 but never faints; then he walks
          const run = (e.run || u.running) && u.stamina > 1 && e.dx === u.facing;
          if (run) { u.lastRunStep = sim.stepCount; u.stamina = Math.max(1, u.stamina - STAMINA.run * DT); u.regenAt = sim.stepCount + Math.round(STAMINA.delay * 120); }
          // walking back goes at the character's back-walk speed (backWalk, 1 = the forward walk)
          u.vx = e.dx * (run ? RUN * u.char.stats.run : WALK * u.char.stats.walk * (e.block ? u.char.stats.backWalk : 1));
          setState(u, run ? 'run' : 'walk');
        } else {
          // a stumble or a follow-through runs out, no snap stop
          if (u.followThrough) { u.vx *= u.chase ? CHASE_FRICTION : STUMBLE_FRICTION; if (Math.abs(u.vx) < 60) { u.vx = 0; u.followThrough = false; u.chase = false; } }
          else u.vx = Math.abs(u.vx) > 20 ? u.vx * 0.85 : 0;
          setState(u, 'idle');
        }
        break;
      }
      case 'block':
        u.vx = 0;
        if (u.faint > 0) { setState(u, 'idle'); break; }
        if (tryAttack(u)) break;
        if (e.down) { setState(u, 'crouch', e.block ? ANIM.crouchBlock : ANIM.crouch); u.crouch = true; break; }
        if (!e.block || !threat(u, opp)) setState(u, 'idle');   // the threat is gone: back to walking back
        break;
      case 'crouch': {
        u.vx = 0; u.crouch = true;
        if (u.faint > 0) { u.crouchEnd = null; setState(u, 'idle'); break; }
        if (tryAttack(u)) break;
        if (!e.down) { u.crouchEnd = sim.stepCount; setState(u, 'idle'); break; }
        // crouch-walk forward (down-back is the crouching guard)
        const creep = e.dx && e.dx === u.facing && !e.block && !(u.rootT > 0);
        if (creep) u.vx = u.facing * CROUCH_WALK * u.char.stats.walk;
        const want = e.block ? ANIM.crouchBlock : creep && ANIM.crouchWalk ? ANIM.crouchWalk : ANIM.crouch;
        if (u.rig.current.move !== want) safePlay(u.rig, want);
        break;
      }
      case 'splat':
        // stuck to the wall, open for one more hit; then it slides off into the fall
        if (!u.rag) { u.vx = 0; u.vy = 0; }
        if (--u.splatT <= 0) {
          u.state = 'knockdown'; u.juggle = false;
          if (!u.rag) { u.vy = 40; u.vx = -u.splatSide * 60; safePlay(u.rig, 'knockdown'); }
        }
        break;
      case 'grabbed':
        break;
      case 'botch':
        // tangled up (botch.js): the clip carries the body, the root stays put until it ends (tick()
        // ends it right after the rig update that finishes it, so its step lands on the same frame)
        u.vx = u.grounded ? u.vx * 0.8 : u.vx;
        if (u.rig.current.move !== 'botch') endBotch(u);
        break;
      case 'vault':
        vaultStep(u);
        break;
      case 'jump': {
        // a little steering in the air (the jump's direction is set at takeoff)
        const cap = Math.max(Math.abs(u.jumpVx || 0), WALK * u.char.stats.walk * 0.6) + 40;
        if (e.dx) u.vx = Math.max(-cap, Math.min(cap, u.vx + e.dx * 520 * DT));
        if (e.jump && !(u.faint > 0) && airJump(u, e)) break;
        if (u.buffer && FRAME_DATA[u.buffer] && FRAME_DATA[u.buffer].air && (u.airUsed || 0) === 0 && !(u.faint > 0)) startAttack(u, u.buffer);
        break;
      }
      case 'landing':
        if (u.landLag) { u.vx *= 0.8; if (--u.landLag <= 0) { u.landLag = 0; setState(u, 'idle'); tryAttack(u); } break; }
        // the rig's jump clip has its own landing squash; let it finish
        u.vx *= 0.8;
        if (u.rig.current.done || (u.rig.current.move !== 'jump' && u.rig.current.move !== u.char.mechanics.airJumpClip)) { setState(u, 'idle'); tryAttack(u); }
        break;
      case 'attack': {
        if (!u.grounded && FRAME_DATA[u.move] && FRAME_DATA[u.move].air) {
          // swinging in the air: it lands on the floor (physics); a first air attack that whiffs while
          // still rising leaves room for one more
          if (u.rig.current.done && !u.hitConfirmed && u.vy < 0 && u.airUsed === 1) u.airWhiffEarly = true;
          if (u.airWhiffEarly && u.rig.current.done && u.buffer && FRAME_DATA[u.buffer] && FRAME_DATA[u.buffer].air && !(u.faint > 0)) { u.airWhiffEarly = false; startAttack(u, u.buffer); }
          break;
        }
        // pressure: while the victim is stumbling, the attacker may walk in during recovery
        const oppHit = opp.state === 'hitstun' || opp.state === 'blockstun' || opp.state === 'knockdown';
        if (u.grounded && u.phase === 'recovery' && oppHit && e.dx === u.facing) u.vx = u.facing * Math.max(WALK * 1.3, u.vx * u.facing);
        else if (u.grounded) u.vx *= u.followThrough ? (u.chase ? CHASE_FRICTION : STUMBLE_FRICTION) : 0.9;   // follow-through rides with the victim; a chase keeps going
        const fd = FRAME_DATA[u.move];
        // a stance: one of its moves pressed comes out at once; with its button let go (after `min` ms) it ends in its exit
        if (fd.stance && u.phase !== 'recovery' && !(u.faint > 0)) {
          const S = fd.stance, hold = S.hold && { 1: 'lp', 2: 'rp', 3: 'lk', 4: 'rk' }[S.hold];
          if (u.buffer && stanceMoves(u).includes(u.buffer)) { startAttack(u, u.buffer); break; }
          if (S.exit && !(hold && u.last && u.last[hold]) && sim.stepCount - u.attackStart >= Math.round((S.min || 0) * 0.12)) { startAttack(u, S.exit); break; }
        }
        // cancel on hit into any strike inside the rig's window (ms from the first key after the blend)
        const md = MOVE_DATA_ && MOVE_DATA_[fd.anim || u.move];
        const ms = md && md.duration ? u.rig.current.t * md.duration : 0;
        const inWindow = md && md.cancel ? ms >= md.cancel[0] - 40 && ms <= md.cancel[1] : fd.cancels.includes(u.buffer);
        if (u.faint > 0) u.buffer = null;   // the strike that emptied the bar: nothing cancels out of it
        if (u.hitConfirmed && u.buffer && (u.phase === 'active' || u.phase === 'recovery') && inWindow && cancelOK(u)) { startAttack(u, u.buffer); break; }
        // a stomp that landed cancels into a punch, so the meaty can meet the rise
        if (u.otgConfirm && (u.buffer === 'cross' || u.buffer === 'jab') && (u.phase === 'active' || u.phase === 'recovery')) { startAttack(u, u.buffer); break; }
        // after a knockdown lands, the launcher's recovery is cut short: six frames of
        // follow-through, then he can move or attack (the body's flight is shorter than the recovery)
        if (u.launchCancelAt && sim.stepCount >= u.launchCancelAt && u.phase !== 'startup' && !(u.faint > 0)) {
          if (u.buffer) { u.launchCancelAt = 0; startAttack(u, u.buffer); break; }
          if (e.dx) { u.launchCancelAt = 0; setState(u, 'idle'); break; }
        }
        if (u.rig.current.done) {
          // moves that step (the cross, the roundhouse) leave the root where the body ended up
          // (the root already took that step when the clip ended: takeRoot)
          if (!u.hitConfirmed) note({ type: 'whiff', move: u.move, att: u.id });
          u.phase = null; u.move = null;
          // still holding down: stay crouched (no stand-up pop between crouch attacks)
          if (u.downHeld && u.grounded) { setState(u, 'crouch', u.backHeld ? ANIM.crouchBlock : ANIM.crouch); u.crouch = true; }
          else setState(u, 'idle');
          tryAttack(u);
        }
        break;
      }
      case 'hitstun':
        // stumble: slide back with light friction; stay in hitstun until the slide is slow
        if (u.grounded) u.vx *= STUMBLE_FRICTION;
        if (--u.stun <= 0 && Math.abs(u.vx) < 360) {
          // the stagger's own travel was taken when its clip ended (takeRoot), or is taken by the next play()
          u.hitstunEnd = sim.stepCount; setState(u, 'idle'); tryAttack(u);
        }   // still sliding: the counter can come out of the stumble
        break;
      case 'blockstun':
        u.vx *= 0.88;
        if (--u.stun <= 0) {
          if (u.crouch && e.down) { u.state = 'crouch'; safePlay(u.rig, e.block ? ANIM.crouchBlock : ANIM.crouch); tryAttack(u); break; }
          u.state = 'block'; u.crouch = false; if (!e.block) setState(u, 'idle'); else if (tryAttack(u)) break;
        }
        break;
      case 'knockdown':
        if (u.rig.current.move === 'thrown' && !u.rig.current.done) break;   // the throw is still carrying him
        // touchdown: one squash beat on the floor, then straight into the getup
        if (u.grounded) {
          toDown(u);
          // the clip lands when the body does: snap it to its landing pose (it lags the physics)
          for (let n = 0; n < 90 && u.rig.current.move === 'knockdown' && u.rig.current.t < 0.6; n++) rigUpd(u, DT);
          drainRig(u);
        }
        break;
      case 'down': {
        // lying there until the player picks: a fresh left or right rolls (at once), up stands in place, a
        // button is a wake-up strike (both read once the squash is over); nothing for DOWN_MAX and he stands
        u.vx *= 0.75;
        if (e.dxPress && !u.rolled) { startRoll(u, e.dxPress); break; }   // a fresh press, not a held direction
        const lain = DOWN_MAX - u.downTimer--;
        if (lain >= SQUASH_STEPS) {
          if (u.buffer && FRAME_DATA[u.buffer] && FRAME_DATA[u.buffer].wake && !(u.faint > 0)) { startWake(u, u.buffer); break; }
          if (e.up) { u.vx = 0; setState(u, 'getup'); u.getupSteps = 0; break; }
        }
        if (u.downTimer <= 0) { u.vx = 0; setState(u, 'getup'); u.getupSteps = 0; }
        break;
      }
      case 'roll':
        u.vx *= 0.97;
        if (--u.rollLeft <= 0) { u.vx = 0; setState(u, 'getup'); u.getupSteps = ROLL_GETUP_STEPS; }
        break;
      case 'getup':
        u.vx = 0;
        if (++u.getupSteps < ROLL_GETUP_STEPS && e.dxPress && !u.rolled) { startRoll(u, e.dxPress); break; }
        if (u.rig.current.done) { u.stoodAt = sim.stepCount; setState(u, 'idle'); tryAttack(u); }
        break;
      case 'ko':
        // the frame it touches the floor it joins the pile (the arena dims it and tweens it to rest)
        if (u.grounded) { u.vx = 0; u.koDone = true; }
        break;
    }
  }

  // ---- the stairwell: floor break, the fall, the follow-down vault -----------------------
  // Wedged: a tumbling body can jam between the stairwell's funnel walls above the slab, or come
  // to rest on a stair tread (the rig only settles on its floor line), and never come down (seen
  // in long attract runs). A fall that stops making headway, one still going after 3s, or any
  // ragdoll still up after 5s is set down flat on its floor.
  function unwedge(u) {
    const f = floorInfo(u.floor || 0), w = f.walls, lowY = f.y, hip = u.rig.joints.hip;
    const fell = u.falling && !u.fellLanded, at = { hx: Math.round(hip.x), hy: Math.round(hip.y), vx: Math.round(u.vx), vy: Math.round(u.vy) };
    const from = { x: hip.x, y: hip.y };
    u.rag = false; u.falling = false; u.fellLanded = true; u.grounded = true; u.vx = 0; u.vy = 0; u.gScale = 1;
    u.splatPending = false; u.wallBounce = false; u.groundBounce = false; u.juggle = false;
    u.x = Math.max(bounds.x0 + 30, Math.min(bounds.x1 - 30, hip.x)); u.y = lowY; u.ragFloor = lowY;
    if (fell) { u.health = Math.max(u.state === 'ko' ? 0 : 1, u.health - FLOOR_DMG); u.flash = FLASH_STEPS; }
    syncRig(u);
    if (typeof u.rig.reset === 'function') u.rig.reset();
    u.rig.walls = [w.left, w.right];
    safePlay(u.rig, 'knockdown'); rigUpd(u, 2); u.rig.events.length = 0;
    // the one instant relocation left in a fight: the jammed body is set down flat on the floor, in the
    // rest pose; main.js marks both spots (a flash and an afterimage) so it never reads as a glitch
    onEvent({ type: 'relocate', unit: u, from, to: { x: u.rig.joints.hip.x, y: u.rig.joints.hip.y } });
    if (u.state === 'ko') u.koDone = true;
    else { toDown(u); u.otgHit = false; u.rolled = false; }
    onEvent({ type: 'thud', x: u.x, y: lowY, dir: u.facing, strength: fell ? 1 : 0.5 });
    note({ type: 'unwedge', def: u.id, hp: u.health, fell, ...at });
  }
  function floorStep(u) {
    if (u.rag && u.falling && !u.fellLanded) {
      // a fall that makes no headway (the hip stays within 40px for 0.9s) is jammed
      const hy = u.rig.joints.hip.y;
      if (!u.fallTrack || Math.abs(hy - u.fallTrack.y) > 40) u.fallTrack = { y: hy, at: sim.stepCount };
      if (sim.stepCount - u.fallTrack.at > 108 || sim.stepCount - (u.fallAt || 0) > 360) { unwedge(u); return; }
    }
    if (u.rag && sim.stepCount - (u.ragAt || 0) > 600) { unwedge(u); return; }
    const sw = stairwellNow();
    if (sw && u.breakOK && !sim.floorBroken && !sim.horde && (u.floor || 0) === 0 && sw.toFloor != null &&
        (u.state === 'knockdown' || u.state === 'ko') && inAir(u)) {
      // over the railing: the body crosses the opening above the rail's top
      const hip = u.rig.joints.hip, railTop = sw.y - (sw.rail ? sw.rail.h : 40), x = u.rag ? hip.x : u.x;
      if (x > sw.x0 + 10 && x < sw.x1 - 10 && hip.y < railTop + 40) breakFloor(u, sw);
    }
    if (u.falling) {
      const lowY = floorsNow()[u.floor].y, hip = u.rig.joints.hip;
      // clattering down the steps: every time the fall turns upward (a tread or the landing kicked it)
      if (!u.treadEvents && u.rag && u.lastFallVy > 150 && u.vy < -20 && hip.y < lowY - 50 && sim.stepCount - (u.tumbleAt || -99) > 8) {
        u.tumbleAt = sim.stepCount; onEvent({ type: 'stairTumble', x: hip.x, y: hip.y, strength: 0.6, unit: u }); note({ type: 'stairTumble', def: u.id });
      }
      u.lastFallVy = u.vy;
      if (u.rag) u.rig.walls = ragWalls(u);
      // jammed in the opening above the slab (the body is longer than the opening is wide): a
      // straight push down without spin, every half second; unwedge() is the last resort at 3s
      const slabY = floorsNow()[0].y;
      if (u.rag && hip.y < slabY + 25 && sim.stepCount - (u.fallAt || 0) > 60 && Math.abs(u.vy) < 120 && sim.stepCount - (u.jamKick || -99) > 60) {
        u.jamKick = sim.stepCount;
        startRag(u, -u.vx, 380 - u.vy, { wall: 'stop', spin: 0 });
        note({ type: 'jamKick', def: u.id });
      }
      // stalled on the steps: a nudge toward the next tread down, so it clatters all the way
      if (u.rag && hip.y < lowY - 55) {
        const slow = Math.abs(u.vx) < 70 && Math.abs(u.vy) < 70;
        u.stallSteps = slow ? (u.stallSteps || 0) + 1 : 0;
        if (u.stallSteps >= 5) {
          u.stallSteps = 0;
          const t = treadBelow(hip.x, hip.y + 30);
          const dx = t ? Math.sign((t.x0 + t.x1) / 2 - hip.x) || 1 : (u.facing || 1);
          startRag(u, dx * 340 - u.vx, -140 - u.vy, { wall: 'stop', spin: 240 });   // a flat hop clears a few treads (contact friction stops a slide)
        }
      }
      if (!u.fellLanded && hip.y > lowY - 45) {
        // the floor below: it hurts
        u.fellLanded = true; u.health = Math.max(u.state === 'ko' ? 0 : 1, u.health - FLOOR_DMG); u.flash = FLASH_STEPS;
        const w = floorInfo(u.floor).walls; u.rig.walls = [w.left, w.right];
        onEvent({ type: 'thud', x: hip.x, y: lowY, dir: u.facing, strength: 1 });
        note({ type: 'floorLand', def: u.id, hp: u.health });
      }
    }
  }
  // which way the stairs go down from x: toward the nearest tread a step or two lower
  function treadBelow(x, y) {
    const T = arena.treads || [];
    let best = null, bd = Infinity;
    for (const t of T) { if (t.y < y + 4 || t.y > y + 60) continue; const cx = (t.x0 + t.x1) / 2, d = Math.abs(cx - x) + (t.y - y) * 0.5; if (d < bd) { bd = d; best = t; } }
    return best;
  }
  function flightDir(sw, x) {
    const t = treadBelow(x, sw.y - 2);
    return t ? Math.sign((t.x0 + t.x1) / 2 - x) || 1 : 0;
  }
  // Never stranded on two floors: nobody can climb back up, so when the two have been on different
  // floors for 1.5s with neither falling nor vaulting, whoever is upstairs follows down. (The
  // follow-down vault after a floor break normally does this; this catches anything that slips by.)
  const REGROUP_STEPS = 180;
  function regroup() {
    if (sim.horde || sim.phase !== 'fight') return;
    const [a, b] = sim.units;
    if (!a || !b || a.hidden || b.hidden) return;
    const busy = (u) => u.falling || u.state === 'vault' || u.followDown || u.rag;
    if ((a.floor || 0) === (b.floor || 0) || busy(a) || busy(b)) { a.apartSteps = 0; return; }
    if (++a.apartSteps < REGROUP_STEPS) return;
    a.apartSteps = 0;
    const sw = stairwellNow();
    if (!sw) return;
    const up = (a.floor || 0) < (b.floor || 0) ? a : b;   // floor 0 is the top
    up.followDown = sw;
    note({ type: 'regroup', unit: up.id });
  }
  function breakFloor(u, sw) {
    const to = sw.toFloor, info = floorInfo(to);
    if (!u.rag) { syncRig(u); startRag(u, u.vx, Math.min(u.vy, -60), { wall: 'stop', spin: 320 }); }   // a keyframed fall becomes a tumble
    // while it falls the stairwell is open to it: the outer walls of both floors; the lower floor's
    // own walls once it lands
    u.floor = to; u.ragFloor = info.y; u.rig.y = info.y; u.falling = true; u.fellLanded = false; u.rig.walls = ragWalls(u);
    // the stair treads, plus the main floor's slab either side of the opening (one-way from above)
    const top = floorInfo(0);
    u.rig.treads = [...(arena.treads || []), { x0: top.walls.left, x1: sw.x0, y: top.y }, { x0: sw.x1, x1: top.walls.right, y: top.y }];
    // down the flight: the first steps under the opening are near floor level, so the body is sent
    // the way the stairs descend
    const dirDown = flightDir(sw, u.rig.joints.hip.x);
    if (dirDown) startRag(u, dirDown * Math.max(260, Math.abs(u.vx)) - u.vx, 0, { wall: 'stop', spin: 260 });
    u.falling = true; u.fellLanded = false; u.breakOK = false; u.stallSteps = 0; u.splatPending = false; u.wallBounce = false; u.juggle = false; u.lastFallVy = 0; u.fallAt = sim.stepCount; u.fallTrack = null;
    sim.floorBroken = true; sim.floor = to; refreshBounds();
    const by = u.comboBy != null ? u.comboBy : u.launchedBy;
    callout('FLOOR BREAK', by, 'trick');
    const hip = u.rig.joints.hip;
    onEvent({ type: 'floorBreak', x: hip.x, y: hip.y, from: 0, to, unit: u });
    note({ type: 'floorBreak', def: u.id, by });
    // the attacker goes down after him (not after a KO: the round is over)
    const att = sim.units[by];
    if (att && att !== u && !att.hidden && u.state !== 'ko') att.followDown = sw;
  }
  function startVault(u, sw) {
    const mid = (sw.x0 + sw.x1) / 2;
    u.state = 'vault'; u.vaultPhase = 'approach'; u.vaultAt = sim.stepCount; u.move = null; u.phase = null; u.crouch = false; u.buffer = null; u.glide = null;
    u.vaultX = HAS_VAULT ? (u.x < mid ? sw.x0 - 24 : sw.x1 + 24) : (u.x < mid ? sw.x0 + 14 : sw.x1 - 14);
    u.facing = Math.sign(mid - u.x) || u.facing;
    safePlay(u.rig, 'run');
  }
  function vaultStep(u) {
    if (u.vaultPhase === 'clip') {
      u.vx = 0;
      if (u.rig.current.move === 'vault' && !u.rig.current.done) return;
      u.floor = u.vaultTo; u.y = floorInfo(u.floor).y; u.grounded = true;
      // where the clip put him (the root took its travel when it ended: takeRoot); if that's past the
      // lower floor's fight band he eases in (no snap)
      u.easeBand = true;
      u.vaultPhase = null; syncRig(u); setState(u, 'idle');
      onEvent({ type: 'land', x: u.x, y: u.y, dir: u.facing, strength: 0.6 });
      return;
    }
    if (u.vaultPhase !== 'approach') return;
    const d = u.vaultX - u.x;
    // the bounds are already the lower floor's, so from the far side of the opening the rail spot
    // can be out of reach (he stood pinned at the wall for the rest of the round): go from here
    const pinned = (d > 0 && u.x >= bounds.x1 - 1) || (d < 0 && u.x <= bounds.x0 + 1) || sim.stepCount - (u.vaultAt || sim.stepCount) > 180;
    if (Math.abs(d) > 8 && !pinned) { u.vx = Math.sign(d) * RUN; u.facing = Math.sign(d); if (u.rig.current.move !== 'run') safePlay(u.rig, 'run'); return; }
    // over the rail and down: the rig's vault clip (hands on the rail, legs over, the drop) carries
    // the body; when it ends the sim takes its travel and the lower floor
    const sw = stairwellNow(), to = sw ? sw.toFloor : 1;
    u.vx = 0;
    if (HAS_VAULT) {
      u.vaultPhase = 'clip'; u.vaultTo = to;
      safePlay(u.rig, 'vault', { drop: floorInfo(to).y - floorInfo(u.floor || 0).y, railH: sw && sw.rail ? sw.rail.h : 44 });
    } else {
      warnOnce('vault', "no 'vault' clip in the rig yet, the follow-down uses 'jump'");
      u.vaultPhase = 'drop'; u.vx = u.facing * 110; u.vy = -VAULT_HOP_VY; u.grounded = false; u.floor = to;
      safePlay(u.rig, 'jump');
    }
    onEvent({ type: 'vault', x: u.x, y: u.y, dir: u.facing, unit: u });
    note({ type: 'vault', att: u.id });
  }
  sim.startVault = startVault;

  // A character's extra jumps (mechanics.airJumps: a double jump) and wall jump (mechanics.wallJump: a
  // fresh jump press next to a wall kicks off it, away from the wall). Each refreshes the air attack.
  function airJump(u, e) {
    const mech = u.char.mechanics, cs = u.char.stats, b = bandOf(u);
    const wallSide = u.x - b.x0 < 34 ? -1 : b.x1 - u.x < 34 ? 1 : 0;
    if (mech.wallJump && wallSide && (u.wallJumps || 0) < 2) {
      u.wallJumps = (u.wallJumps || 0) + 1;
      u.vx = -wallSide * RUN * cs.run * 0.8; u.vy = -JUMP_VY * cs.jump * 0.95; u.facing = -wallSide; u.jumpVx = u.vx;
    } else if ((u.airJumpsUsed || 0) < (mech.airJumps || 0)) {
      u.airJumpsUsed = (u.airJumpsUsed || 0) + 1;
      u.vy = -JUMP_VY * cs.jump * 0.88; if (e.dx) { u.vx = e.dx * WALK * cs.walk * 1.15; u.jumpVx = u.vx; }
    } else return false;
    u.airUsed = 0; u.airWhiffEarly = false;
    spend(u, STAMINA.jump);
    safePlay(u.rig, u.char.mechanics.airJumpClip || 'jump');
    onEvent({ type: 'dust', x: u.x, y: u.y, dir: u.facing });
    note({ type: 'airJump', att: u.id, wall: !!wallSide && !!mech.wallJump });
    return true;
  }
  // something is coming: the opponent's strike is winding up or out, or he is in the air nearby
  function threat(u, o) {
    if (!o) return false;
    const d = Math.abs(o.x - u.x);
    if (sim.stepCount - (u.blockedAt || -99) < 20) return true;   // just blocked: hold it a beat (a string's next hit)
    if (o.state === 'attack' && o.phase !== 'recovery' && FRAME_DATA[o.move]) {
      const fd = FRAME_DATA[o.move];
      // a throw beats guard, and a low goes under a standing one (down-back is the answer): neither is a threat to hold back for
      if (fd.throw || fd.height === 'low') return false;
      // it can land in the next few frames: in its reach (plus a slide or a charge's travel, plus a margin)
      // and live within 220ms
      const travel = fd.travel ? fd.travel.vx * u.char.stats.dash * (fd.travel.ms || 200) / 1000 : 0;
      return d < reachOf(o, o.move) + travel + (o.glide ? 60 : 0) + 40 && msToActive(o) < 220;
    }
    // a jump-in closing on him: its air attack is an overhead, a standing guard stops it
    return o.state === 'jump' && d < 190 && (Math.sign(o.vx) === Math.sign(u.x - o.x) || d < 90);
  }
  // Landing out of an air attack: a jump-in that connected goes straight into the ground string
  // (the buffered press starts on the landing frame); a whiff, or a swing cut off by the floor,
  // costs a short landing lag.
  function airLanding(u) {
    u.vx *= 0.3; u.airUsed = 0; u.airWhiffEarly = false;
    if (u.hitConfirmed) { u.phase = null; u.move = null; setState(u, 'idle'); tryAttack(u); note({ type: 'airLand', att: u.id, hit: true }); return; }
    const late = u.phase === 'recovery' || u.rig.current.done;
    const dive = FRAME_DATA[u.move] && FRAME_DATA[u.move].dive;
    // as long as the rig's airLand takes to lower the hip (160ms, 220 after a dive kick)
    u.phase = null; u.move = null; u.state = 'landing'; u.landLag = dive ? 26 : late ? 20 : 14;
    safePlay(u.rig, ANIM.airLand || 'idle');
    note({ type: 'airLand', att: u.id, hit: false, lag: u.landLag });
    onEvent({ type: 'land', x: u.x, y: u.y, dir: u.facing, strength: 0.4 });
  }
  function startRoll(u, dx) {
    // a roll faces the opponent whichever way it goes (facing against the roll turned a forward roll's back to him)
    const o = oppOf(u), ox = o ? bodyX(o) : u.x - dx;
    u.state = 'roll'; u.rolled = true; u.rollLeft = ROLL_STEPS; u.vx = dx * ROLL_SPEED; u.facing = Math.sign(ox - bodyX(u)) || -dx;
    u.rig.play('knockdown'); rigUpd(u, 0.5);
  }
  // A wake-up strike: it kicks toward the opponent, so a body lying with its head toward him turns over
  // first (the hip stays where it is; the drawing cross-fades the mirror), then the strike starts from the
  // rest pose like any other
  const REST_HX = -128;   // the knockdown rest pose's hip, px behind the root (src/fighter: MOVE_DEFS.knockdown)
  function startWake(u, move) {
    const o = oppOf(u), hip = bodyX(u), want = o ? Math.sign(bodyX(o) - hip) : 0;
    if (want && want !== u.facing) { u.facing = want; u.x = hip - REST_HX * want * (u.rig.scale || 1); syncRig(u); rigUpd(u, 0); }
    u.buffer = null; u.bufferKeys = null; u.bufferName = '';
    startAttack(u, move);
    u.seq = null;
    note({ type: 'wake', att: u.id, move, lain: DOWN_MAX - u.downTimer });
  }
  // back on the floor in the knockdown rest pose, the hip where it was (a wake-up strike stuffed)
  function restDown(u, hip) {
    u.state = 'down'; u.phase = null; u.move = null; u.wakeUp = 0; u.vx = 0; u.downTimer = DOWN_MAX; u.touchStep = sim.stepCount;
    u.rig.play('knockdown'); u.rig.update(1.5); u.rig.events.length = 0;
    u.x = hip - REST_HX * u.facing * (u.rig.scale || 1); syncRig(u); rigUpd(u, 0);
  }
  function wakeFor(e) {
    if (FRAME_DATA[e.attack] && FRAME_DATA[e.attack].wake) return e.attack;   // the CPU names it
    const tok = pressTok(e) || '1';
    e.keys = null; e.name = '';
    return e.down || tok[0] === 'd' || tok === '2' || tok === '4' ? 'wakeSweep' : 'wakeKick';
  }
  function feetPlanted(u) {
    const j = u.rig.joints, y = u.rig.y;
    return j.lFoot.y >= y - 7 && j.rFoot.y >= y - 7;
  }
  function physics(u) {
    // walls of the floor this body is on: after a floor break the attacker is still upstairs (and may
    // stand past the stairwell) until he vaults, so the lower floor's band must not pull him across
    const bounds = bandOf(u);
    const wasAir = !u.grounded;
    // a reeling body doesn't slide on planted feet: the root holds and the rig's reaction carries
    // the body (its shift moves the root when the reaction ends)
    if (u.grounded && (u.state === 'hitstun' || u.state === 'blockstun')) u.vx = 0;
    // a glide ends at a standstill in a strike (a carried-over third of it slid the attacker on under the body he'd launched)
    if (u.glide) { if (sim.stepCount < u.glide.until && u.grounded) { if (!(u.glide.from > sim.stepCount)) u.vx = u.glide.vx; } else { u.glide = null; if (u.grounded) u.vx = u.state === 'attack' ? 0 : u.vx * 0.3; } }
    if (u.rag) {
      const j = u.rig.joints, nx = Math.max(bounds.x0, Math.min(bounds.x1, j.hip.x));
      u.vx = (nx - u.x) / DT; u.x = nx;
      u.vy = u.lastHipY != null ? (j.hip.y - u.lastHipY) / DT : 0; u.lastHipY = j.hip.y;
      u.y = u.ragFloor;
      return;
    }
    if (u.state === 'splat' || u.state === 'grabbed') return;
    if (!u.grounded) { u.vy += GRAVITY * (u.gScale || 1) * DT; u.y += u.vy * DT; }
    // riding after a knockdown (or drifting on in recovery) stops at the near end of the body: past
    // it he stood over its legs, and it got up behind him
    {
      const o = oppOf(u);
      if (o && u.grounded && !NOT_SOLID_BODY.has(u.state) && !u.rag && (NOT_SOLID_BODY.has(o.state) || o.rag) && u.vx) {
        const dir = Math.sign(u.vx), near = dir > 0 ? Math.min(o.x, bodyX(o)) : Math.max(o.x, bodyX(o));
        const room = (near - u.x) * dir - 24;
        if ((near - u.x) * dir > -40 && room < u.vx * dir * DT) { u.vx = Math.max(0, room) / DT * dir; if (room <= 0) { u.vx = 0; u.chase = false; } }
      }
    }
    u.x += u.vx * DT;
    // walls
    // a lying body is long: it stops short of the wall; one flying in for a splat or bounce meets it
    const pad = LYING.has(u.state) ? ((u.splatPending || u.wallBounce) && !u.grounded ? 14 : LIE_PAD) : 0;
    // a body getting up stays where it lies: its root (at the feet) may be past the wall, its hip never is,
    // and it stands up at the hip (takeRoot). Sliding it off the wall slid the rising body along the floor,
    // under a man standing over it, and it stood up on his other side.
    if ((u.state === 'getup' || isWake(u)) && u.grounded) { u.vx = 0; return finishPhysics(u, wasAir); }
    if (u.easeBand) {
      if (u.x > bounds.x1) { u.x = Math.max(bounds.x1, u.x - 260 * DT); return; }
      if (u.x < bounds.x0) { u.x = Math.min(bounds.x0, u.x + 260 * DT); return; }
      u.easeBand = false;
    }
    // a body that came to rest closer to the wall than a lying body's length slides off it, never jumps
    // (a rolling or sliding one too: it stops against the pad instead of being thrown out of it)
    const lyingSlide = LYING.has(u.state) && u.grounded;
    if (lyingSlide && ((u.x < bounds.x0 + pad && u.vx < 0) || (u.x > bounds.x1 - pad && u.vx > 0))) u.vx = 0;
    const slide = lyingSlide ? LIE_SLIDE * DT : Infinity;
    if (u.x < bounds.x0 + pad) { u.x = lyingSlide ? Math.min(bounds.x0 + pad, u.x + slide) : Math.max(bounds.x0, Math.min(bounds.x0 + pad, u.x + slide)); wallHit(u); }
    else if (u.x > bounds.x1 - pad) { u.x = lyingSlide ? Math.max(bounds.x1 - pad, u.x - slide) : Math.min(bounds.x1, Math.max(bounds.x1 - pad, u.x - slide)); wallHit(u); }
    finishPhysics(u, wasAir);
  }
  function finishPhysics(u, wasAir) {
    // floors
    const fy = floorUnder(u);
    if (!u.grounded) {
      if (u.vy >= 0 && u.y >= fy) { u.y = fy; u.vy = 0; u.grounded = true; land(u); }
    } else if (fy > u.y + 1) { u.grounded = false; }
    if (wasAir && u.grounded && u.state === 'attack' && FRAME_DATA[u.move] && FRAME_DATA[u.move].air) airLanding(u);
    if (wasAir && u.grounded && u.state === 'vault' && u.vaultPhase === 'drop') { u.vaultPhase = null; u.vx = 0; setState(u, 'idle'); onEvent({ type: 'land', x: u.x, y: u.y, dir: u.facing, strength: 0.6 }); }
    if (wasAir && u.grounded && u.state === 'jump') { u.state = 'landing'; if (u.rig.current.done) { setState(u, 'idle'); tryAttack(u); } }
  }
  function wallHit(u) {
    const side = u.x < (bounds.x0 + bounds.x1) / 2 ? -1 : 1;
    if (u.state === 'knockdown' && !u.grounded && u.splatPending) {
      // wall splat: stuck to the wall for 0.4s, open for one more hit
      u.splatPending = false; u.wallBounce = false; u.state = 'splat'; u.splatT = SPLAT_STEPS; u.splatSide = side; u.splatHit = false;
      u.vx = 0; u.vy = 0; u.facing = -side; u.y = Math.min(u.y, floorUnder(u) - 30);
      if (typeof u.rig.wallSplat === 'function') { try { u.rig.wallSplat({ side, dir: side }); } catch (e) { warnOnce('wallSplat', 'rig.wallSplat threw: ' + e.message); safePlay(u.rig, 'hitHeavy'); } }
      else safePlay(u.rig, 'hitHeavy');
      callout('WALL SPLAT', u.comboBy, 'trick');
      onEvent({ type: 'wallImpact', x: u.x + side * 10, y: u.y - 70, side, strength: 1, unit: u });
      return;
    }
    if (u.state === 'knockdown' && !u.grounded && u.wallBounce) {
      u.wallBounce = false; u.vx = -u.vx * 0.45; u.vy = -360; u.juggle = true; u.airHits = Math.min(u.airHits, JUGGLE_MAX - 2);
      if (typeof u.rig.launch === 'function') { try { u.rig.launch({ vx: u.vx, vy: u.vy }); } catch (e) { /* keyframed knockdown carries it */ } }
      callout('WALL BOUNCE', u.comboBy, 'trick');
      onEvent({ type: 'wallImpact', x: u.x + side * 10, y: u.y - 70, side, strength: 0.7, unit: u });
      return;
    }
    if ((u.state === 'knockdown' || u.state === 'ko' || u.state === 'hitstun') && Math.abs(u.vx) > 220) {
      onEvent({ type: 'wall', x: u.x, y: u.y - 60, strength: Math.min(1, Math.abs(u.vx) / 500), dir: -Math.sign(u.vx) });
      u.vx = -u.vx * 0.35;
    } else u.vx = 0;
  }
  function land(u) {
    if (u.groundBounce && u.state === 'knockdown') {
      // ground bounce: the spiked body pops back up for one more hit
      u.groundBounce = false; u.grounded = false; u.vy = -420; u.vx *= 0.5; u.juggle = true; u.airHits = Math.max(u.airHits, JUGGLE_MAX - 1); u.gScale = 1.2;
      if (typeof u.rig.groundBounce === 'function') { try { u.rig.groundBounce({ vy: u.vy }); } catch (e) { /* keyframes */ } }
      callout('GROUND BOUNCE', u.comboBy, 'trick');
      onEvent({ type: 'thud', x: u.x, y: u.y, dir: u.facing, strength: 0.9 });
      return;
    }
    u.gScale = 1;
    const heavy = u.state === 'knockdown' || u.state === 'ko';
    onEvent({ type: heavy ? 'thud' : 'land', x: u.x, y: u.y, dir: u.facing, strength: heavy ? 0.8 : 0.3 });
    if (heavy) u.vx *= 0.4;
  }

  function drainRig(u) {
    for (const ev of u.rig.events) {
      if (ev.type === 'active' && u.state === 'attack') {
        u.phase = 'active';
        if (u.activeAt < 0) { u.activeAt = sim.stepCount; const sfd = FRAME_DATA[u.move]; if (sfd && sfd.selfStatus) applyStatus(u, sfd.selfStatus); }   // the happy accidents' windows count from here (botch.js); a self buff lands here
        // a multi-hit (frame data hits: n): each later 'active' key may connect again. hitKey counts the
        // active keys; the first one never re-opens (a strike can already land in the 45ms before it)
        const mfd = FRAME_DATA[u.move];
        if (mfd && mfd.hits > 1) {
          u.hitKey = (u.hitKey || 0) + 1;
          if (u.hitKey > 1 && u.hitConfirmed && (u.hitN || 0) < mfd.hits) u.hitConfirmed = false;
        }
      }
      else if (ev.type === 'recover' && u.state === 'attack') { u.phase = 'recovery'; if (u.recoverAt < 0) u.recoverAt = sim.stepCount; }
      else if (ev.type === 'stand' && isWake(u)) u.wakeUp = 2;   // a wake-up strike's body leaves the floor
      else if (ev.type === 'footstep' && u.grounded) onEvent({ type: 'footstep', x: u.x, y: u.y, dir: u.facing });
      else if (ev.type === 'land' && u.rag) {
        if (u.rig.events.some(e2 => e2.type === 'bounce')) continue;
        u.ragLanded = true; u.landJoints = copyJoints(u.rig.joints, null);
        onEvent({ type: 'thud', x: u.x, y: u.ragFloor, dir: u.facing, strength: u.state === 'ko' ? 0.8 : 0.6 });
      }
      else if (ev.type === 'land' && (u.state === 'knockdown' || u.state === 'ko')) u.landJoints = copyJoints(u.rig.joints, null);   // the sprawled pose, before the clip settles flat
      else if (ev.type === 'tread' && u.falling) {
        // clattering down the steps (the rig reports each tread it hits)
        u.treadEvents = true;
        const hx = u.rig.joints.hip.x, st = Math.min(1, Math.max(0.2, Math.abs(u.vy) / 600));
        onEvent({ type: 'tread', x: hx, y: ev.y, strength: st, unit: u });   // every step it hits (audio: a knock per tread)
        if (sim.stepCount - (u.tumbleAt || -99) > 6) { u.tumbleAt = sim.stepCount; onEvent({ type: 'stairTumble', x: hx, y: ev.y, strength: st, unit: u }); note({ type: 'stairTumble', def: u.id }); }
      }
      else if (ev.type === 'bounce' && u.rag) {
        u.ragLanded = false; u.groundBounce = false; u.juggle = true; u.airHits = Math.max(u.airHits, JUGGLE_MAX - 1);
        callout('GROUND BOUNCE', u.comboBy, 'trick');
        onEvent({ type: 'thud', x: u.x, y: u.ragFloor, dir: u.facing, strength: 0.9 });
      }
      else if (ev.type === 'wall' && u.rag && (u.state === 'knockdown' || u.state === 'ko')) {
        const side = ev.side || (u.x < (bounds.x0 + bounds.x1) / 2 ? -1 : 1);
        if (u.splatPending && u.state === 'knockdown') {
          u.splatPending = false; u.state = 'splat'; u.splatT = SPLAT_STEPS; u.splatSide = side; u.splatHit = false;
          callout('WALL SPLAT', u.comboBy, 'trick');
          onEvent({ type: 'wallImpact', x: u.x + side * 10, y: u.ragFloor - 80, side, strength: 1, unit: u });
        } else if (u.wallBounce) {
          u.wallBounce = false; u.juggle = true; u.airHits = Math.min(u.airHits, JUGGLE_MAX - 2);
          callout('WALL BOUNCE', u.comboBy, 'trick');
          onEvent({ type: 'wallImpact', x: u.x + side * 10, y: u.ragFloor - 80, side, strength: 0.7, unit: u });
        } else onEvent({ type: 'wallImpact', x: u.x + side * 10, y: u.ragFloor - 70, side, strength: 0.3, unit: u });
      }
    }
    u.rig.events.length = 0;
    if (u.rag && !u.rig.airborne) {
      // the body came to rest in the rig's knockdown pose: back on the sim's root
      // the rig put its root where the body lies, facing the way the body lies (head behind the hip);
      // taking both as they are keeps the drawn body still: a clamped root or the old facing re-posed it
      // a body-length away and it slid there across the floor (a body too near the wall slides off it: physics)
      u.rag = false; u.x = u.rig.x; u.facing = u.rig.facing; u.y = u.ragFloor; u.grounded = true; u.vx = 0; u.vy = 0; u.gScale = 1;
      u.splatPending = false; u.wallBounce = false; u.groundBounce = false; u.falling = false;
      if (u.state === 'ko') u.koDone = true;
      else if (u.state === 'knockdown' || u.state === 'splat') { toDown(u); u.otgHit = false; u.rolled = false; }
      syncRig(u);
    }
  }

  // ---- hits --------------------------------------------------------------------------
  // Both directions are tested before either is applied, so two strikes that connect in the
  // same step trade: both land, both react, nobody wins outright.
  function resolveHits() {
    const hero = sim.units[0];
    for (let i = 1; i < sim.units.length; i++) {
      const g = sim.units[i];
      const a = testStrike(hero, g), b = testStrike(g, hero);
      if (a && b && !a.grab && !b.grab) {
        const ma = hero.move, mb = g.move;
        applyHit(hero, g, a.pt, { move: ma, trade: true });
        applyHit(g, hero, b.pt, { move: mb, trade: true });
        hero.tradeLimb = FRAME_DATA[ma].limb; g.tradeLimb = FRAME_DATA[mb].limb;
        hero.tradeUntil = g.tradeUntil = sim.stepCount + Math.max(hero.hitstop, g.hitstop) + 16;
        callout('TRADE', -1, 'trade');
        note({ type: 'trade', a: ma, b: mb });
        continue;
      }
      if (a) a.grab ? grab(hero, g) : applyHit(hero, g, a.pt);
      if (b && g.state === 'attack') b.grab ? grab(g, hero) : applyHit(g, hero, b.pt);
    }
  }
  const isLow = (u) => !!u.crouch && u.grounded;
  // how early a strike goes live: 45ms, or less for a fast move (a 60ms kick must not hit on frame one)
  function earlyMs(u) { const md = MOVE_DATA_ && MOVE_DATA_[FRAME_DATA[u.move].anim]; return md && md.activeAt != null ? Math.min(45, md.activeAt * 0.3) : 45; }
  function msToActive(u) {
    const md = MOVE_DATA_ && MOVE_DATA_[FRAME_DATA[u.move].anim];
    if (!md || md.activeAt == null || !md.duration) return Infinity;
    const total = (md.blend || 0) + md.duration;   // current.t runs over the blend and the keys
    return md.activeAt - (u.rig.current.t * total - (md.blend || 0));
  }
  function testStrike(att, def) {
    if (att.state !== 'attack' || att.hitConfirmed || att.hitstop > 0 || att.hidden) return null;
    // the tip can meet a close body in the last frames before the rig's contact key (a croucher, a
    // body pressed in): strikes are live from 45ms before their active key
    if (att.phase !== 'active' && !(att.phase === 'startup' && msToActive(att) <= earlyMs(att))) return null;
    if (def.hidden || INVULN.has(def.state) || def.state === 'grabbed' || sim.phase !== 'fight') return null;
    if (isWake(def) && def.phase === 'startup') return null;   // a wake-up strike rises through what's coming until it's live
    if (def.falling || att.state === 'vault' || (att.floor || 0) !== (def.floor || 0)) return null;   // down the stairwell: out of reach
    const fd = FRAME_DATA[att.move];
    if (fd.parry || fd.stance || fd.noHit) return null;   // a counter stance (parry hook), a stance or a step out never strikes on its own; its reversal or follow-ups do
    if ((def.state === 'knockdown' || def.state === 'ko') && !(def.state === 'knockdown' && def.juggle && inAir(def) && def.airHits < JUGGLE_MAX)) return null;   // juggles end by gravity and a hard cap
    if (def.state === 'splat' && def.splatHit) return null;   // a splat takes one more hit
    // invulnerable frames (frame data invuln: { at, ms } from the press, THE CEO's Golden Parachute): strikes and throws pass through
    const ivf = def.state === 'attack' && FRAME_DATA[def.move] && FRAME_DATA[def.move].invuln, ivn = ivf ? stepsSince(def, 'start') : null;
    const dodging = !!ivf && ivn != null && ivn >= Math.round(ivf.at * 0.12) && ivn < Math.round((ivf.at + ivf.ms) * 0.12);
    const dodge = () => { if (def.dodgedId !== att.attackId) { def.dodgedId = att.attackId; note({ type: 'dodge', att: att.id, def: def.id, move: att.move }); } return null; };   // logged once, only for what would have landed
    if (fd.throw) {
      // a grab locks on at the press (in range then, and not crouching), and on its active frames pulls him in
      if (!att.grabOK || def.state === 'down' || wakeLying(def) || !def.grounded || def.state === 'splat' || isLow(def)) return null;
      if (dodging) { att.grabOK = false; return dodge(); }   // slipped: the grab doesn't lock on later in its active frames
      return { grab: true };
    }
    const floored = def.state === 'down';
    if (floored && (!OTG_MOVES.has(att.move) || def.otgHit)) return null;   // one ground hit per knockdown, low moves only
    // a character's hop or flying knee: lows pass under it from the press until its recovery
    if (fd.height === 'low' && def.state === 'attack' && def.phase !== 'recovery' && FRAME_DATA[def.move] && FRAME_DATA[def.move].lowInvuln) return null;
    // a high passes over a croucher (logged once per strike for measurement)
    if (fd.height === 'high' && isLow(def)) {
      if (att.duckLogged !== att.attackId) { att.duckLogged = att.attackId; note({ type: 'duck', move: att.move, att: att.id, def: def.id }); }
      return null;
    }
    const hits = buildHitboxes(att.rig, att.move, att.facing);
    const rk = reachKey(att, att.move);
    for (const h of hits) reachSeen[rk] = Math.max(reachSeen[rk] || 0, (h.x - att.x) * att.facing + h.r);
    const pt = testHit(hits, buildHurtboxes(def.rig));
    if (pt && dodging) return dodge();
    // an air strike from an air jump comes down on him from above, where seating can only slide him
    // sideways: it connects once the drawn limb really touches the drawn body
    if (pt && fd.air && (att.airJumpsUsed || att.wallJumps) && segGap(att, def) > 2) return null;
    return pt ? { pt } : null;
  }
  // Throws: the grab holds both for a break window; 1+3 or 2+4 from the victim breaks it.
  function grab(att, def) {
    // a throw counter (frame data throwCounter: { reversal, callout }, THE LAWYER's Objection!): a throw or command
    // grab landing on the stance in its startup or active frames is caught and turned into the stance's own throw
    const cfd = def.state === 'attack' && def.phase !== 'recovery' && !(def.faint > 0) && FRAME_DATA[def.move] && FRAME_DATA[def.move].throwCounter;
    if (cfd && FRAME_DATA[cfd.reversal]) { counterThrow(att, def, cfd); return; }
    att.hitConfirmed = true;
    if (def.state === 'botch') takeShift(def);
    const gfd = FRAME_DATA[att.move] || FRAME_DATA.throw;
    // the grab holds him 70px in front: he is pulled there over the next few frames (GRAB_PULL px a step),
    // never put there; one caught behind the thrower (the thrower turned to a lying body's hip and it
    // stood up past him) turns the thrower round instead of passing the victim through him
    const side = Math.sign(def.x - att.x);
    if (side && side !== att.facing) { att.facing = side; syncRig(att); rigUpd(att, 0); }
    def.grabTo = att.x + att.facing * 70 * (att.rig.scale || 1);
    // near a wall behind him it becomes the wall slam
    if (wallGap(def, att.facing) < 190 && att.move === 'throw') { att.move = 'wallSlam'; att.seqName = 'WALL SLAM'; }
    // a character's command grab (frame data grab: true) can hold for its own time and refuse the break
    def.grabNoBreak = !!gfd.noBreak;
    const pre = def.buffer === 'throw' && def.bufferAge < 8 && !(def.faint > 0) && !def.grabNoBreak;   // pressed just before the grab
    const hold = gfd.hold ? f60(gfd.hold) : BREAK_STEPS;
    def.state = 'grabbed'; def.grabbedBy = att.id; def.grabT = hold; def.phase = null; def.move = null; def.crouch = false;
    def.vx = 0; att.vx = 0; att.glide = null;
    att.hitstop = hold + 2; def.hitstop = 0;
    safePlay(def.rig, 'hitStun' in (MOVE_DATA_ || {}) ? 'hitStun' : 'hitLight');
    note({ type: 'grab', att: att.id, def: def.id, move: att.move });
    onEvent({ type: 'grab', x: (att.x + def.x) / 2, y: def.y - 90, dir: att.facing, move: att.move, attacker: att, defender: def });
    if (pre) breakThrow(def);
  }
  // the throw counter caught him: his grab is dropped, and the stance becomes its reversal, a grab of its own on him
  function counterThrow(att, def, C) {
    const caught = att.move;
    att.state = 'idle'; att.move = null; att.phase = null; att.buffer = null; att.bufferKeys = null; att.seq = null; att.queued = null; att.glide = null; att.vx = 0;
    callout(C.callout || 'COUNTER', def.id, 'counter');
    note({ type: 'throwCounter', att: def.id, def: att.id, move: caught });
    onEvent({ type: 'block', x: (att.x + def.x) / 2, y: def.y - 90, dir: Math.sign(att.x - def.x) || def.facing, strength: 1, move: caught, parry: true, attacker: att, defender: def });
    def.buffer = null; def.bufferKeys = null; def.queued = null;
    startAttack(def, C.reversal); def.grabOK = true;
    grab(def, att);
  }
  // which way a hit sends the defender: away from the attacker. Going by the attacker's facing sent a
  // body hit while the two overlapped, or just after a cross-up, into or past him (sides swapped) and
  // turned it to face away; facing only decides when they're right on top of each other.
  function awayDir(att, def) {
    // a juggle: the attacker steps in under the body, so only a body well past him flips it
    const d = bodyX(def) - att.x, tol = def.rag || !def.grounded ? 40 : 6;
    // a bothSides spin sends him the way its striking limb points (it can land behind)
    const afd = att.state === 'attack' && att.move && FRAME_DATA[att.move], tip = afd && afd.bothSides && afd.joint && att.rig.joints[afd.joint];
    if (tip && Math.abs(tip.x - att.x) > 4) return Math.sign(tip.x - att.x);
    return Math.abs(d) > tol ? Math.sign(d) : att.facing;
  }
  function breakThrow(def) {
    const att = sim.units[def.grabbedBy];
    def.grabTo = null;
    const dir = awayDir(att, def);
    def.state = 'blockstun'; def.stun = f60(14); def.vx = dir * 300; def.hitstop = 0; def.grabbedBy = -1;
    att.state = 'blockstun'; att.stun = f60(14); att.vx = -dir * 300; att.hitstop = 0; att.move = null; att.phase = null;
    safePlay(def.rig, ANIM.throwTech); safePlay(att.rig, ANIM.throwTech);
    callout('BREAK', def.id, 'break');
    onEvent({ type: 'block', x: (att.x + def.x) / 2, y: def.y - 90, dir, strength: 0.8, move: 'throw', attacker: att, defender: def });
    note({ type: 'break', att: att.id, def: def.id });
  }
  function landThrow(def) {
    const att = sim.units[def.grabbedBy];
    def.grabbedBy = -1; def.state = 'idle'; def.grabTo = null;
    // the thrower was hit out of it mid-grab (horde: a second goon): the victim just drops
    if (!att || att.state !== 'attack' || !FRAME_DATA[att.move]) return;
    att.hitstop = 0;
    applyHit(att, def, { x: (att.x + def.x) / 2, y: def.y - 90 }, { move: att.move });
  }
  sim.breakThrow = breakThrow;

  // A combo hit's damage after the decay: past COMBO_SOFTCAP points in one combo the rest counts
  // COMBO_OVERCAP as much. Whole points, at least 1. Damage on a fainted body counts toward
  // waking him (faintDmgCap), so a faint is a punish but not a free kill.
  function comboDamage(def, raw) {
    const room = Math.max(0, COMBO_SOFTCAP - (def.comboDmg || 0));
    const dmg = Math.max(1, Math.round(raw <= room ? raw : room + (raw - room) * COMBO_OVERCAP));
    def.comboDmg = (def.comboDmg || 0) + dmg;
    if (def.faint > 0 && (def.faintDmg += dmg) >= STAMINA.faintDmgCap) endFaint(def);
    return dmg;
  }
  // Character hooks on the defender's side (src/characters/). Armor: the hit lands but he keeps going,
  // taking armor.dmg of its damage (half by default). Parry: a counter stance catches the strike, the
  // striker reels and the stance turns into its reversal move, which hits him the ordinary way.
  function absorb(att, def, pt, fd, dfd, dir, move) {
    def.armorLeft--;
    const share = dfd.armor && dfd.armor.dmg != null ? dfd.armor.dmg : 0.5;
    const dmg = Math.max(1, Math.round(fd.damage * att.char.stats.damage * share));
    def.health = Math.max(0, def.health - dmg); def.flash = FLASH_STEPS;
    att.hitstop = def.hitstop = f60(6); att.vx = -dir * 200; att.glide = null;
    callout('ARMOR', def.id, 'counter');
    note({ type: 'armor', att: att.id, def: def.id, move, dmg });
    onEvent({ type: 'hit', x: pt.x - dir * 10, y: pt.y, dir, strength: 0.5, move, limb: fd.limb, flashR: 24, ko: def.health <= 0, knockdown: false, armor: true, attacker: att, defender: def });
    if (def.health <= 0) koDefender(att, def, fd, dir);
    else { syncRig(def); seatStrike(att, def, dir); }
  }
  function parry(att, def, pt, dfd) {
    const P = dfd.parry, dir = awayDir(def, att), caught = att.move;
    att.state = 'hitstun'; att.stun = f60(P.stun || 40); att.phase = null; att.move = null; att.buffer = null; att.bufferKeys = null; att.seq = null; att.queued = null;
    att.glide = null; att.vx = 0; att.comboBy = -1; att.crouch = false; att.followThrough = false;
    safePlay(att.rig, HAS_HITSTUN ? 'hitStun' : 'hitLight'); syncRig(att); rigUpd(att, 0.008); att.rig.events.length = 0;
    att.hitstop = def.hitstop = f60(8); def.flash = 2;
    callout(P.callout || 'PARRY', def.id, 'counter');
    note({ type: 'parry', att: def.id, def: att.id, move: caught });
    onEvent({ type: 'block', x: pt.x, y: pt.y, dir: -dir, strength: 1, move: caught, parry: true, attacker: att, defender: def });
    if (P.reversal && FRAME_DATA[P.reversal]) {
      def.buffer = null; def.bufferKeys = null; def.queued = null; startAttack(def, P.reversal);
      if (def.glide) { def.glide.until += def.hitstop; if (def.glide.from != null) def.glide.from += def.hitstop; }   // the step-in waits out the parry's freeze
    }
  }
  function applyHit(att, def, pt, { move = att.move, trade = false } = {}) {
    let fd = FRAME_DATA[move];
    // a string's chase step stops at contact: it closed the gap, and carrying on took him under the body
    if (att.glide && !FRAME_DATA[move].travel && att.glide.from == null) { att.glide = null; if (att.grounded) att.vx = 0; }
    // a multi-hit's earlier hits take its `rush` fields (light, no knockdown, no callout); the hit on
    // its last active key is the move itself
    if (fd.hits > 1 && fd.rush && Math.max(1, att.hitKey || 0) < fd.hits) fd = { ...fd, ...fd.rush };
    let dir = awayDir(att, def);
    if (fd.bothSides) { att.home = -dir; def.home = dir; }   // a spin that lands behind him: that's his side now (keepSides)
    // a back throw (frame data backThrow, THE RECEPTIONIST's Transfer): the body goes up and back over the thrower and lands
    // behind him on the point simulation, a side change you watch happen; a wall close behind him leaves no room (a plain throw then)
    const tossBack = !!fd.backThrow && wallGap(att, -dir) > 150;
    if (tossBack) { dir = -dir; att.home = 0; def.home = 0; }   // neither one's old side holds while he's in the air (keepSides)
    att.hitConfirmed = true;
    att.hitN = (att.hitN || 0) + 1;
    if (fd.travel) att.glide = null;   // a slide or a charge stops at the body
    // a counter: hit during his startup, or an uppercut meeting a jump-in (the anti-air)
    const antiAir = !trade && (move === 'uppercut' || move === 'risingUppercut') && !def.grounded && !def.rag &&
      (def.state === 'jump' || (def.state === 'attack' && FRAME_DATA[def.move] && FRAME_DATA[def.move].air));
    // a spin-out (botch.js) with its back turned is hit from behind: that's a counter too
    const counter = antiAir || (!trade && def.state === 'attack' && def.phase === 'startup') || (def.state === 'botch' && def.botchKind === 'spin' && backTurned(def));
    if (def.state === 'botch') takeShift(def);   // a stumble cut short keeps the ground it covered
    if (antiAir) note({ type: 'antiAir', att: att.id, def: def.id });
    if (wakeLying(def)) {
      // caught on the floor in the middle of a wake-up strike: a counter hit, and he's back down where he lay
      const hip = bodyX(def);
      if (def.comboBy !== att.id) { def.combo = 0; def.comboDmg = 0; }
      def.combo = (def.combo || 0) + 1; def.comboBy = att.id; def.lastHitAt = sim.stepCount;
      sim.combo = { count: def.combo, by: att.id, on: def.id };
      def.health = Math.max(0, def.health - comboDamage(def, fd.damage * att.char.stats.damage * comboScale(COMBO_DMG, def.combo) * COUNTER_DMG));
      def.flash = FLASH_STEPS; def.buffer = null; def.seq = null;
      att.hitstop = def.hitstop = f60(fd.hitstop + 3); att.vx = 0; att.glide = null;
      callout('COUNTER', att.id, 'counter');
      note({ type: 'hit', move, height: fd.height, att: att.id, def: def.id, counter: true, wake: true, combo: def.combo });
      onEvent({ type: 'hit', x: pt.x, y: pt.y, dir, strength: 0.6, move, limb: fd.limb, flashR: fd.flashR, ko: def.health <= 0, knockdown: true, counter: true, attacker: att, defender: def });
      if (def.health <= 0) { koDefender(att, def, fd, dir); return; }
      restDown(def, hip);
      def.otgHit = true;   // it took its ground hit: no stomp on top
      return;
    }
    if (def.state === 'down') {
      // on-the-ground hit: a flinch, not a relaunch; the getup timer keeps running after the freeze
      def.otgHit = true; def.health = Math.max(1, def.health - OTG.damage); def.flash = FLASH_STEPS;
      def.bounce = OTG.bounce; att.otgConfirm = true;
      att.hitstop = def.hitstop = f60(OTG.hitstop);
      att.releaseEv = { type: 'release', x: pt.x, y: pt.y, dir, strength: 0.4, ko: false };
      note({ type: 'hit', move, att: att.id, def: def.id, otg: true });
      onEvent({ type: 'hit', x: pt.x, y: pt.y, dir, strength: 0.4, move, limb: fd.limb, flashR: 24, ko: false, knockdown: true, otg: true, attacker: att, defender: def });
      return;
    }
    if ((def.state === 'knockdown' && inAir(def)) || def.state === 'splat') {
      // airborne: a juggle hit. Each one adds gravity, so juggles end after about four.
      if (fd.onJuggle) fd = { ...fd, ...fd.onJuggle };   // frame data onJuggle: the fields a hit on a juggled or splatted body uses (THE CEO's Hostile Takeover ends it big)
      const splat = def.state === 'splat';
      def.combo = (def.combo || 1) + 1; def.comboBy = att.id; def.lastHitAt = sim.stepCount;
      sim.combo = { count: def.combo, by: att.id, on: def.id };
      // the juggle's own scaling, or the combo's if that is lower by now
      const scale = Math.min(Math.max(0.4, 0.6 - 0.05 * def.airHits), comboScale(COMBO_DMG, def.combo));
      const dmg = comboDamage(def, fd.damage * att.char.stats.damage * scale);
      const ko = def.health - dmg <= 0;
      def.health = Math.max(0, def.health - dmg);
      def.airHits++; def.gScale = 1 + JUGGLE_G * def.airHits; def.flash = FLASH_STEPS;
      if (!splat) def.state = 'knockdown';
      def.grounded = false; def.landJoints = null;
      if (splat) {
        // off the wall: a crumple away from it, no second splat (the rig holds the splat its 0.4s,
        // so with the point simulation the push lands when the splat lets go)
        def.splatHit = true; def.splatPending = false; def.juggle = false;
        def.state = 'knockdown';
        if (def.rag) startRag(def, -def.splatSide * 160, -260, { spin: 200 });   // launch() ends the splat and pushes now
        else { def.vx = -def.splatSide * 140; def.vy = -240; }
      } else if (fd.groundBounce) {
        def.groundBounce = true;
        callout(att.seqName || 'SKY SPIKE', att.id, 'ender');
        if (def.rag && typeof def.rig.groundBounce === 'function') { try { def.rig.groundBounce(); } catch (e) { warnOnce('gb', 'rig.groundBounce threw: ' + e.message); } }
        else { def.vy = 760; def.vx = dir * 60; }
      } else {
        // the pop shrinks with every airborne hit (the juggle's gravity scaling)
        let pop = JUGGLE_POP / (1 + JUGGLE_G * (def.airHits - 1)) * def.char.kbY;
        // the spike is slow: the hit before it (Sky Spike's 2) floats the body up to meet it
        if (att.buffer === 'skySpike' || (att.queued && att.queued.attack === 'skySpike')) pop = 420;
        let vx = dir * 40;
        if (fd.splat) def.splatPending = true;
        if (fd.ender && fd.kb.x > 400) vx = dir * fd.kb.x * 0.7 * def.char.kbX;
        if (fd.ender) { callout(att.seqName || fd.callout || move.toUpperCase(), att.id, 'ender'); def.breakOK = !sim.horde; }
        // the rig adds an impulse to the body's current velocity: aim for the pop, not past it
        if (def.rag) startRag(def, vx - def.vx, -pop - def.vy, { wall: wallMode(def), spin: 160 });
        else { def.vy = -pop; def.vx = vx; }
      }
      att.hitstop = def.hitstop = f60(ko ? 8 : 5); att.vx = 0;
      def.launchedBy = att.id; def.launchStep = sim.stepCount;
      att.launchCancelAt = sim.stepCount + att.hitstop + 4;
      if (ko) koDefender(att, def, fd, dir);
      att.releaseEv = { type: 'release', x: pt.x, y: pt.y, dir, strength: 0.6, ko };
      note({ type: 'hit', move, att: att.id, def: def.id, air: def.airHits, splat });
      onEvent({ type: 'hit', x: pt.x, y: pt.y, dir, strength: 0.6, move, limb: fd.limb, flashR: 30, ko, knockdown: true, attacker: att, defender: def });
      return;
    }
    const dfd = def.state === 'attack' && def.move && FRAME_DATA[def.move];
    if (dfd && dfd.parry && def.phase !== 'recovery' && !fd.throw && !fd.air && !(def.faint > 0) && (dfd.parry.heights || ['high', 'mid']).includes(fd.height)) { parry(att, def, pt, dfd); return; }
    if (dfd && dfd.armor && def.armorLeft > 0 && def.phase !== 'recovery' && !fd.throw) { absorb(att, def, pt, fd, dfd, dir, move); return; }
    // guards (Tekken): standing guard (holding back) stops high and mid; a croucher holding back
    // stops low; mids hit a croucher, lows hit a standing guard; throws are unblockable
    const canGuard = !(def.faint > 0) && (def.grounded && def.backHeld && GUARD_STATES.has(def.state) || def.state === 'blockstun');   // fainted: no guard
    const lowGuard = def.state === 'blockstun' ? !!def.crouch : isLow(def);
    const blocking = canGuard && !fd.unblockable && (lowGuard ? fd.height === 'low' : fd.height !== 'low');
    const hp = { x: pt.x - dir * 10, y: pt.y };   // burst sits on the striking limb, not the victim
    if (blocking) {
      // the blocker holds ground; the attacker is bounced off (visible ~40px hop back)
      def.state = 'blockstun'; def.phase = null; def.move = null; def.stun = f60(fd.blockstun); def.blockedAt = sim.stepCount;
      def.vx = dir * 260;                 // ~20px of give
      att.vx = fd.rush && fd !== FRAME_DATA[move] ? 0 : -dir * (fd.blockPush != null ? fd.blockPush : 520);   // a multi-hit's earlier hits don't bounce him off: the rest still meet the guard; blockPush (THE LAWYER's Cross-Examination) bounces him less, so a throw still reaches
      att.hitstop = def.hitstop = f60(3);   // a short freeze so the block reads
      def.facing = -dir; def.flash = 2;
      spend(def, fd.cost * STAMINA.blockCost, { noFaint: true });   // blocking costs a third of the strike, never the last point
      if (lowGuard) safePlay(def.rig, ANIM.crouchBlockHit); else if (ANIM.blockHit) safePlay(def.rig, ANIM.blockHit);
      syncRig(def); rigUpd(def, 0.03); def.rig.events.length = 0;
      seatStrike(att, def, dir);
      note({ type: 'block', move, height: fd.height, low: lowGuard, att: att.id, def: def.id });
      onEvent({ type: 'block', x: hp.x, y: hp.y, dir, strength: fd.damage / 14, move, low: lowGuard, attacker: att, defender: def });
      return;
    }
    // combos: a hit on a body still in hitstun extends the string, and so does every hit on a fainted
    // body (so the decay keeps running through the faint instead of starting over)
    const fadeChain = def.faint > 0 && (def.lastHitAt || -1) >= def.faintAt;
    // (a botch's flail never carries a combo on: mashing doesn't pay)
    const chained = def.comboBy === att.id && !fd.botch && (def.state === 'hitstun' || sim.stepCount - (def.hitstunEnd || -99) <= 6 || fadeChain);
    def.combo = chained ? def.combo + 1 : 1; def.comboBy = att.id; def.lastHitAt = sim.stepCount;
    if (!chained) { def.comboDmg = 0; def.shockUsed = false; }
    sim.combo = { count: def.combo, by: att.id, on: def.id };
    def.health = Math.max(0, def.health - comboDamage(def, fd.damage * att.char.stats.damage * comboScale(COMBO_DMG, def.combo) * (counter ? COUNTER_DMG : 1)));
    if (fd.status) applyStatus(def, fd.status);   // a timed status rides the hit (HR REP's Write-Up)
    def.flash = FLASH_STEPS; def.phase = null; def.move = null;
    def.wasLow = isLow(def);
    if (!tossBack) def.facing = -dir;   // a back throw keeps him facing the thrower as he goes over (no mirror snap)
    def.crouch = false;
    def.buffer = null; def.seq = null;
    const ko = def.health <= 0;
    att.hitstop = def.hitstop = f60(ko ? fd.hitstop * 1.5 : counter ? fd.hitstop + 3 : fd.hitstop);
    if (counter) { callout('COUNTER', att.id, 'counter'); }
    if (fd.ender || fd.callout) callout(att.seqName || fd.callout, att.id, 'ender');
    // trick shots set on the hit: splat / bounce resolve when the body meets the wall
    def.splatPending = !!fd.splat; def.wallBounce = false; def.groundBounce = false; def.airHits = 0; def.gScale = 1;
    // the floor-break rule: an ender, a throw, a launcher or a heavy knockback can carry him over the railing
    // enders and throws use the whole approach to the opening; an ordinary launcher or heavy hit only
    // breaks it when he's already at the rail (within about 60px)
    const swB = stairwellNow(), railGap = swB ? Math.max(0, swB.x0 - def.x, def.x - swB.x1) : Infinity;
    def.breakOK = !sim.horde && (!!fd.ender || !!fd.throw || ((!!fd.juggle || fd.kb.x >= 400) && railGap <= 60));
    if (move === 'spinKick' && wallGap(def, dir) < 230) { def.wallBounce = true; callout('WALL SPIN', att.id, 'ender'); }
    else if (fd.wallBounce && wallGap(def, dir) < 230) def.wallBounce = true;   // a character move's wall bounce
    // knockback by the defender's weight (src/characters/; exactly 1 for TEMP)
    def.vx = fd.knockdown ? dir * fd.kb.x * def.char.kbX : 0;   // standing hits: no slide (see physics)
    if (fd.kb.y) { def.vy = -fd.kb.y * def.char.kbY; def.grounded = false; }
    if (fd.knockdown) { att.vx = dir * (fd.kb.x + 100); att.followThrough = true; att.chase = true; }   // ride the launch: be on the body when it lands
    else { att.vx = 0; att.followThrough = false; }   // the seat sets contact spacing; no slide in
    if (ko && sim.horde && def.id >= 1) {
      // horde: the goon flies off as a ragdoll and the next goon is already running in
      syncRig(def); rigUpd(def, 0.05);
      launchRagdoll(def, dir * Math.max(fd.kb.x, 380), -Math.max(fd.kb.y, 300));
      att.vx = dir * 60; att.followThrough = false; att.chase = false;
      att.launchCancelAt = sim.stepCount + att.hitstop + 8;   // straight on to the next goon
      sim.horde.count++; sim.card = { text: `${sim.horde.count} DOWN`, t: 0.9 };
      onEvent({ type: 'hit', x: hp.x, y: hp.y, dir, strength: 1, move, limb: fd.limb, flashR: fd.flashR, ko: true, knockdown: true, attacker: att, defender: def });
      goonDown(def);
      return;
    }
    if (ko) koDefender(att, def, fd, dir);
    else if (fd.knockdown || !def.grounded) {
      def.state = 'knockdown'; def.landJoints = null; def.otgHit = false; def.rolled = false; safePlay(def.rig, 'knockdown');
      def.juggle = !!fd.juggle;
      def.launchedBy = att.id; def.launchStep = sim.stepCount;
      const sw = stairwellNow(), towardWell = sw && !sim.floorBroken && (def.floor || 0) === 0 && sw.toFloor != null && !sim.horde &&
        ((dir > 0 && def.x < sw.x1 && sw.x0 - def.x < 170) || (dir < 0 && def.x > sw.x0 && def.x - sw.x1 < 170));
      if (fd.throw && towardWell) {
        // thrown toward the stairwell: over the railing it goes
        syncRig(def); startRag(def, dir * 520, -420, { wall: 'stop', spin: 380 });
        att.vx = 0; att.glide = null; att.followThrough = false; att.chase = false;
        att.launchCancelAt = sim.stepCount + att.hitstop + 6; att.buffer = null;
      } else if ((move === 'throw' || fd.thrownClip) && HAS_THROWN && !tossBack) {
        // the rig's thrown reaction carries the body over and ends in the knockdown rest pose
        def.vx = 0; def.vy = 0; def.grounded = true; safePlay(def.rig, 'thrown');
        att.vx = 0; att.glide = null; att.followThrough = false; att.chase = false;
        att.launchCancelAt = sim.stepCount + att.hitstop + 6; att.buffer = null;
      } else
      // juggle launchers and trick shots fly on the rig's point simulation; plain knockdowns keep
      // the keyframed fall (the follow-up glide and the stomp are timed to it)
      if (fd.juggle || def.splatPending || def.wallBounce || tossBack) {
        // the contact frame shows the touch: seat the strike on him first, then hand him to the point simulation
        if (!def.rag && !tossBack) { syncRig(def); seatStrike(att, def, dir); }
        syncRig(def); startRag(def, def.vx, def.vy || -200, { wall: wallMode(def), spin: fd.juggle ? 260 : 360 });
      }
      att.launchCancelAt = sim.stepCount + att.hitstop + 6;
      // the follow-through is a glide to where the body will lie, arriving as it touches down;
      // a juggle launch or a body headed for the wall gets no glide (the attacker follows up)
      if (fd.juggle || def.splatPending || def.wallBounce || tossBack) { att.vx = 0; att.followThrough = false; att.chase = false; att.glide = fd.juggle || tossBack ? null : { vx: dir * Math.min(RUN, fd.kb.x * 0.6), until: sim.stepCount + att.hitstop + 30 }; }
      else {
        const T = 2 * (fd.kb.y * def.char.kbY) / GRAVITY, landX = def.x + def.vx * T;
        const vx = Math.max(-RUN * 2, Math.min(RUN * 2, (landX - att.x) / T));
        att.glide = { vx, until: sim.stepCount + att.hitstop + Math.round(T * 120) };
      }
      if (!fd.juggle) att.buffer = null;   // nothing pressed before the launch fires after it (a juggle keeps the string)
    } else {
      // the reaction is picked by the move: jab snaps the head, cross arches the back, lows fold
      let react = 'hitLight';
      if (fd.react && MOVE_DATA_ && MOVE_DATA_[fd.react]) react = fd.react;   // a character move names its own reaction
      else if ((def.combo >= 2 || move === 'jab' || move === 'cross') && HAS_HITSTUN) react = 'hitStun';
      else if (move === 'lungeCross') react = HAS_HITBACK ? 'hitBack' : 'hitHeavy';
      else if (fd.low && HAS_HITLOW) react = 'hitLow';
      else if (fd.low || move === 'lkick' || move === 'bodyBlow' || move === 'uptown') react = HAS_HITBODY ? 'hitBody' : 'hitLight';
      // hitstun shrinks with the hit's place in the combo, so a loop drops and the defender can act
      const stun = (sim.horde && att.id >= 1 ? fd.hitstun * 0.5 : fd.hitstun) * (counter ? COUNTER_STUN : 1) * comboScale(COMBO_STUN, def.combo);
      const wasAttacking = trade || counter;
      const wasCrouching = !!def.wasLow;   // a croucher reels low: the reaction is layered over the crouch
      def.state = 'hitstun'; def.stun = f60(stun);
      // the procedural layer: hit during his own strike (a trade or a counter), the reaction is
      // added over the strike so it bends instead of snapping to a canned pose; otherwise the
      // keyframed reaction, which the rig blends in from the current pose and velocity
      if ((wasAttacking || wasCrouching) && typeof def.rig.react === 'function') {
        try {
          // a travelling strike under the reaction takes its root shift now, so it can't snap later
          if (typeof def.rig.commitShift === 'function') { syncRig(def); const x0 = def.rig.x; def.rig.commitShift(); def.x += def.rig.x - x0; }
          def.rig.react(react, { weight: counter ? 0.95 : 0.85, dir: 1 });
        }
        catch (e) { warnOnce('react', 'rig.react threw: ' + e.message); safePlay(def.rig, react); }
      } else safePlay(def.rig, react);
      // shock: { frames, clip } (ELECTRICIAN's Live Wire): extra stun on top of the hitstun, shrinking with the
      // combo like the stun and once per combo (so it never loops), with a jitter on the rig's reaction layer
      if (fd.shock && !def.shockUsed) {
        def.shockUsed = true; def.stun += f60(fd.shock.frames * comboScale(COMBO_STUN, def.combo)); def.shockT = def.stun;
        if (fd.shock.clip && typeof def.rig.react === 'function') { try { def.rig.react(fd.shock.clip, { weight: 1, dir: 1 }); } catch (e) { warnOnce('shock', 'rig.react threw: ' + e.message); } }
        onEvent({ type: 'shock', unit: def, x: def.x, y: def.y - 80 });
      }
      if (fd.root) def.rootT = f60(fd.root);   // root: frames he can't walk or jump once the stun ends (ELECTRICIAN's Ground Fault)
    }
    // The impact frame shows the touch: the reaction starts at its first frame, and the strike is
    // seated on the outline; the lean follows from the next frame.
    if (!def.rag) { syncRig(def); rigUpd(def, 0.008); def.rig.events.length = 0; }
    if (!trade && !def.rag) seatStrike(att, def, dir);
    const strength = Math.min(1, fd.damage / 14);
    att.releaseEv = { type: 'release', x: hp.x, y: hp.y, dir, strength, ko };   // fired when the freeze lets go
    note({ type: 'hit', move, height: fd.height, att: att.id, def: def.id, counter, trade, combo: def.combo, crouch: false });
    onEvent({ type: 'hit', x: hp.x, y: hp.y, dir, strength, move, limb: fd.limb, flashR: fd.flashR, ko, knockdown: fd.knockdown, counter, trade, attacker: att, defender: def });
  }
  function koDefender(att, def, fd, dir) {
    // the knockdown clip lands sprawled; the ko clip ends as a flat bar
    def.state = 'ko'; def.koDone = false; def.landJoints = null; safePlay(def.rig, 'knockdown');
    def.splatPending = false; def.wallBounce = false; def.groundBounce = false;
    def.vx = dir * Math.max(fd.kb.x, 380); def.vy = -Math.max(Math.abs(fd.kb.y), 300);
    syncRig(def);
    if (!startRag(def, def.vx * 0.8 - (def.rag ? def.vx * 0 : 0), def.vy * 0.9, { wall: 'stop', spin: 420 })) def.grounded = false;
    att.vx = dir * (fd.kb.x + 100); att.followThrough = true; att.chase = true;
    sim.phase = 'ko'; sim.phaseTimer = KO_HOLD; sim.winner = att.id;
    // a KO by an ender gets the slow-motion finisher beat
    sim.finisher = !!fd.ender || !!fd.splat; sim.koSlow = sim.finisher ? 0.9 : 0.3;
    if (sim.finisher) callout('FINISH', att.id, 'finish');
    sim.banner = 'KO';
  }

  // A body is moved at most SEP_CAP px a step by the pushing apart (720 px/s, about twice a run): a
  // deep overlap (a getup turning solid under a man at the wall, a landing on top of someone, a body
  // coming to rest past the one standing over it) is resolved over a few frames as a visible shove,
  // never in one snap. Each body still only ever goes back toward its own side.
  const SEP_CAP = 6;
  const sepFrom = [];
  function separate() {
    const n = sim.units.length;
    for (let i = 0; i < n; i++) sepFrom[i] = sim.units[i].x;
    // two passes: a push can wake a spring or a layered reaction that leaves a sliver behind
    for (let pass = 0; pass < 2; pass++)
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) separatePair(sim.units[i], sim.units[j]);
    for (let i = 0; i < n; i++) {
      const u = sim.units[i], d = u.x - sepFrom[i];
      if (Math.abs(d) <= SEP_CAP || u.rag) continue;
      u.x = sepFrom[i] + Math.sign(d) * SEP_CAP; syncRig(u); rigUpd(u, 0);
    }
  }
  // Solid bodies: the two fighters' hurtbox shapes (head, spine, legs, arms) may not overlap.
  // The only exception is a striking limb on its way in (until it connects); a lying body is
  // not solid to a standing one (he may stand over it). Push along x, split by who is moving.
  const NOT_SOLID = new Set(['knockdown', 'down', 'ko', 'roll']);
  function bodyShapes(u) {
    const h = buildHurtboxes(u.rig);
    const out = h.capsules.map(([a, b, r]) => [a, b, r]);
    for (const c of h.circles) out.push([c, c, c.r]);
    // from the wind-up until it connects (solid during the wind-up, it shoved the defender out of reach)
    const traded = u.tradeUntil && sim.stepCount < u.tradeUntil;   // a trade: both arms are in each other until the freeze lets go
    if ((u.state === 'attack' && (!u.hitConfirmed || u.hitstop > 0) && (u.phase === 'active' || u.phase === 'startup')) || traded) {
      // indexes: 0 spine, 1-4 legs, 5-8 arms; the striking pair is exempt until contact
      const hand = traded ? u.tradeLimb === 'hand' : FRAME_DATA[u.move].limb === 'hand';
      for (const i of hand ? [5, 6, 7, 8] : [1, 2, 3, 4]) out[i] = null;
    }
    return out.filter(Boolean);
  }
  function penetration(a, b) {
    const A = bodyShapes(a), B = bodyShapes(b);
    let worst = 0;
    for (const [p, q, r] of A) for (const [s2, t, r2] of B) worst = Math.max(worst, r + r2 - segSeg(p, q, s2, t));
    return worst;
  }
  // A lying (or rolling) body isn't solid to a standing one, who may stand over it, but neither one
  // may come out the far side: crossing over a downed opponent swapped the fighters' sides (and
  // which way the one getting up faced) at odd moments. Jumps, launches and vaults still cross.
  const OVER = 14, OVER_AIR = 40;   // how far past a lying (or juggled) body a standing one may stand
  function keepSides(a, b) {
    const lying = (u) => NOT_SOLID.has(u.state) || u.rag || wakeLying(u);
    const onFoot = (u) => u.grounded && !u.rag && !u.falling && u.state !== 'vault' && u.state !== 'jump';
    if (lying(a) === lying(b)) return;
    const stand = lying(a) ? b : a, down = stand === a ? b : a;
    if (!onFoot(stand) || down.falling || oppOf(stand) !== down || !stand.home) return;
    const home = stand.home;   // his side of her, from the last moment they both stood
    const over = down.rag || !down.grounded ? OVER_AIR : OVER;   // under a juggled body he may step farther in
    const bx = bodyX(down);
    // how far he has come out the far side of the body
    const past = home > 0 ? bx - stand.x : stand.x - bx;
    if (past <= over) return;
    const movedStand = Math.abs(bodyX(stand) - (stand.prevBX != null ? stand.prevBX : bodyX(stand)));
    const movedDown = Math.abs(bx - (down.prevBX != null ? down.prevBX : bx));
    if (movedStand >= movedDown || !onFoot(down) || movedDown >= 40) {
      // walking, running or lunging through a body on the floor or in the air: he stops over it
      if (movedStand > 0 || !onFoot(down)) {
        const bb = bandOf(stand); stand.x = Math.max(bb.x0, Math.min(bb.x1, bx - home * over)); syncRig(stand);
      }
    } else {
      // a body rolling or sliding along the floor stops under him instead of coming out the other side
      const bb = bandOf(down); down.x = Math.max(bb.x0, Math.min(bb.x1, down.x + (stand.x + home * over - bx))); syncRig(down);
    }
  }
  // A body on the floor stands back up at its root, which can be at its feet a body-length from its
  // hip: someone standing over its legs got stood up through, and came out on the wrong side. So a
  // standing body may reach only OVER px onto a lying one from its own side, and one the lying body
  // came to rest under is eased off it (KEEP_OFF px a step), not snapped.
  const KEEP_OFF = 5;
  function keepOff(a, b) {
    const lyingDown = (u) => (u.state === 'down' || u.state === 'roll' || (u.state === 'knockdown' && u.grounded) || wakeLying(u)) && !u.rag;
    const onFoot = (u) => u.grounded && !u.rag && !u.falling && u.state !== 'vault' && u.state !== 'jump' && !NOT_SOLID.has(u.state) && !wakeLying(u);
    const down = lyingDown(a) ? a : lyingDown(b) ? b : null, stand = down === a ? b : a;
    if (!down || !onFoot(stand) || !(down.rig && down.rig.joints && down.rig.joints.hip)) return;
    const hip = down.rig.joints.hip.x, lo = Math.min(hip, down.x), hi = Math.max(hip, down.x);
    // his own side: remembered from when both stood (going by where he is now pushed him the rest of the way across)
    const side = (oppOf(stand) === down && stand.home) || Math.sign((stand.prevBX != null ? stand.prevBX : stand.x) - (down.prevBX != null ? down.prevBX : hip)) || Math.sign(stand.x - hip) || 1;
    const edge = side > 0 ? hi - OVER : lo + OVER;
    const inside = side > 0 ? edge - stand.x : stand.x - edge;
    if (inside <= 0) return;
    const bb = bandOf(stand);
    stand.x = Math.max(bb.x0, Math.min(bb.x1, stand.x + side * Math.min(inside, KEEP_OFF)));
    syncRig(stand);
  }
  function separatePair(a, b) {
    if ((a.floor || 0) !== (b.floor || 0) || a.falling || b.falling || a.state === 'vault' || b.state === 'vault') return;
    // an air strike's contact freeze: the jumper hangs over him for the hitstop, then they part
    const airFreeze = (u) => !u.grounded && u.hitstop > 0 && u.state === 'attack' && FRAME_DATA[u.move] && FRAME_DATA[u.move].air;
    if (airFreeze(a) || airFreeze(b)) return;
    if (a.hidden || b.hidden) return;
    if (NOT_SOLID.has(a.state) || NOT_SOLID.has(b.state) || wakeLying(a) || wakeLying(b)) { keepSides(a, b); keepOff(a, b); return; }
    // a body rising from the floor is solid only for the last quarter of its getup (or of a wake-up strike's rise)
    const rising = (u) => (u.state === 'getup' || isWake(u)) && u.rig.current.t < 0.75;
    if (rising(a) || rising(b)) return;
    for (let iter = 0; iter < 8; iter++) {   // two torsos leaning into each other cross in an X: it takes a few pushes
      const depth = penetration(a, b);
      if (depth <= 0.5) return;
      // which way to push: by position, except while one is getting up, when its root can sit on the
      // far side of a fighter standing over its legs; then by the sides they had (no shove across)
      const getting = a.state === 'getup' || b.state === 'getup' || isWake(a) || isWake(b);
      // otherwise each body goes back toward the side it was on when the step began (a pushbox): two roots
      // that passed in one step (a lunge, a glide, a slide into a body) were pushed out the far side, a swap
      // with no motion to show it. A jump that crossed was already over there when the step began.
      const was = Math.sign(b.prevX - a.prevX);
      const s = getting && oppOf(a) === b && a.home ? -a.home : getting && oppOf(b) === a && b.home ? b.home : was || ((b.x - a.x) >= 0 ? 1 : -1);
      // whoever is reeling or being pressed gives way; two equals split it
      const give = (u, o) => (u.state === 'hitstun' || u.state === 'blockstun' ? 3 : 1) * (o.state === 'attack' ? 2 : 1);
      const ga = give(a, b), gb = give(b, a), shareA = ga / (ga + gb);
      let ax = a.x - s * depth * shareA, bx = b.x + s * depth * (1 - shareA);
      // a wall takes nothing: the other body gives the rest
      if (ax < bounds.x0) { bx += bounds.x0 - ax; ax = bounds.x0; } else if (ax > bounds.x1) { bx -= ax - bounds.x1; ax = bounds.x1; }
      if (bx < bounds.x0) { ax += bounds.x0 - bx; bx = bounds.x0; } else if (bx > bounds.x1) { ax -= bx - bounds.x1; bx = bounds.x1; }
      a.x = ax; b.x = bx; syncRig(a); syncRig(b); rigUpd(a, 0); rigUpd(b, 0);
    }
  }
  // Strikes stop at the body: on contact the striking tip is put on the defender's surface by
  // moving the defender back (the attacker, if the defender is on a wall).
  // The drawn silhouette, not the hurtbox (which is padded): the rig draws limbs 12px wide
  // tapering to 9 at the tip, the torso 15, the head at its radius.
  const TIP_HALF = 4.5;
  function drawnShapes(u) {
    const j = u.rig.joints, sh = u.rig.shape, t = sh ? 7.5 * sh.torso : 7.5, a = sh ? 6 * sh.limb : 6, b = sh ? 5 * sh.limb : 5;   // a character's body draws wider or narrower
    return [[j.neck, j.hip, t], [j.hip, j.lKnee, a], [j.lKnee, j.lFoot, b], [j.hip, j.rKnee, a], [j.rKnee, j.rFoot, b],
      [j.lShoulder, j.lElbow, a], [j.lElbow, j.lHand, b], [j.rShoulder, j.rElbow, a], [j.rElbow, j.rHand, b], [j.head, j.head, u.rig.radius || 15]];
  }
  // gap between the striking tip's drawn edge and the defender's drawn silhouette (negative = inside)
  function tipGap(att, def) {
    const tip = buildHitboxes(att.rig, att.move, att.facing)[0];
    if (!tip) return 0;
    // a tip already past his hips went through him: that's inside, however far it is from a line
    const past = (tip.x - def.rig.joints.hip.x) * (FRAME_DATA[att.move].bothSides && (def.rig.joints.hip.x - att.x) * att.facing < 0 ? -att.facing : att.facing);   // bothSides: a spin can land behind him
    if (past > 0) return -(past + 8);
    let gap = Infinity;
    const th = att.rig.shape ? TIP_HALF * att.rig.shape.tip : TIP_HALF;
    for (const [p, q, r] of drawnShapes(def)) gap = Math.min(gap, segDistPt(tip, p, q) - r - th);
    return gap;
  }
  sim.tipGap = tipGap;
  // Strikes stop at the body: on the impact frame the tip touches the silhouette (1px), no
  // overlap and no visible gap. The defender is moved in or out along x to get there (the
  // attacker, if the defender is on a wall); a tip that is far off is left alone.
  // the whole striking segment (elbow to hand, knee to foot) against the drawn body: from above or
  // at an angle it is the shin or forearm that touches first, and the tip may sit past the hips
  const SEG_PARENT = { lHand: 'lElbow', rHand: 'rElbow', lFoot: 'lKnee', rFoot: 'rKnee', lKnee: 'hip', rKnee: 'hip' };
  function segGap(att, def) {
    const j = att.rig.joints, lim = FRAME_DATA[att.move].joint, par = SEG_PARENT[lim];
    if (!lim || !par || !j[lim]) return tipGap(att, def);
    let gap = Infinity;
    const th = att.rig.shape ? TIP_HALF * att.rig.shape.tip : TIP_HALF;
    for (const [p, q, r] of drawnShapes(def)) gap = Math.min(gap, segSeg(j[par], j[lim], p, q) - r - th);
    return gap;
  }
  sim.segGap = segGap;
  function seatStrike(att, def, dir) {
    if (!FRAME_DATA[att.move]) return;   // a trade: the first hit already cleared his move
    const air = FRAME_DATA[att.move] && FRAME_DATA[att.move].air;
    for (let iter = 0; iter < 6; iter++) {
      const gap = air ? segGap(att, def) : tipGap(att, def);
      if (!isFinite(gap) || Math.abs(gap - 1) < 0.75 || gap > 30) return;
      if (gap < -60) return;   // a whiff-through at the edge of the hitbox: leave it
      let d = -(gap - 1);   // + pushes the defender away, - pulls him in
      const room = dir > 0 ? bounds.x1 - def.x : def.x - bounds.x0;
      const moveDef = d > 0 ? Math.min(d, Math.max(0, room)) : d;
      if (air && (att.airJumpsUsed || att.wallJumps) && (def.x + dir * moveDef - att.x) * dir < 24) return;   // never under him and out the far side
      def.x += dir * moveDef; att.x -= dir * (d - moveDef);
      syncRig(def); syncRig(att); rigUpd(def, 0); rigUpd(att, 0);
    }
  }

  // ---- round flow ------------------------------------------------------------------
  function roundFlow() {
    const a = sim.units[0], b = oppOf(a);
    switch (sim.phase) {
      case 'intro':
        sim.phaseTimer -= DT;
        if (sim.phaseTimer < 0.5 && sim.banner !== 'FIGHT') { sim.banner = 'FIGHT'; onEvent({ type: 'fight' }); }
        if (sim.phaseTimer <= 0) { sim.phase = 'fight'; sim.banner = ''; }
        break;
      case 'fight':
        sim.timer = Math.max(0, sim.timer - DT);
        if (sim.timer <= 0) {
          // characters with different health compare what's left of each bar
          const same = !!sim.horde || (a.maxHealth || 100) === (b.maxHealth || 100), ha = same ? a.health : a.health / a.maxHealth, hb = same ? b.health : b.health / b.maxHealth;
          const w = ha === hb ? -1 : (ha > hb ? 0 : 1);
          sim.winner = w; sim.banner = 'TIME'; sim.phase = 'ko'; sim.phaseTimer = KO_HOLD;
        }
        break;
      case 'ko': {
        sim.koSlow = Math.max(0, sim.koSlow - DT);
        const loser = sim.units.find(u => u.state === 'ko');
        if (loser && !loser.koDone) break;
        // the moment it comes to rest it joins the pile (drawn desaturated by the arena), the card holds after
        if (loser && !loser.hidden) { arena.addBody(snapshot(loser)); loser.hidden = true; onEvent({ type: 'body', x: loser.x, y: loser.y, unit: loser }); }
        sim.phaseTimer -= DT;
        if (sim.phaseTimer > 0) break;
        if (sim.winner >= 0) sim.wins[sim.winner]++;
        if (sim.horde || sim.wins[0] >= 2 || sim.wins[1] >= 2 || (sim.winner < 0 && sim.round >= 3)) {
          sim.phase = 'match'; sim.phaseTimer = MATCH_HOLD;
          sim.banner = sim.horde ? `${sim.horde.count} GOONS` + (sim.horde.floorsCleared ? `  ${sim.horde.floorsCleared} FLOORS` : '') : sim.wins[0] === sim.wins[1] ? 'DRAW' : `${sim.units[sim.wins[0] > sim.wins[1] ? 0 : 1].name} WINS`;
          onEvent({ type: 'match', winner: sim.winner });
        } else sim.startRound(sim.round + 1);
        break;
      }
      case 'match':
        sim.phaseTimer -= DT;
        if (sim.phaseTimer <= 0) sim.resetMatch({ seed: (sim.seed * 31 + 7) >>> 0, startHealth: sim.startHealth, introTime: sim.introTime, horde: sim.hordeCfg || null });
        break;
    }
  }

  // ---- the step ------------------------------------------------------------------------
  function tick() {
    sim.stepCount++;
    arena.update && arena.update(DT);
    refreshBounds();
    sim.hitstopActive = Math.max(...sim.units.map(u => u.hitstop));
    for (const u of sim.units) {
      u.prevX = u.x; u.prevBX = bodyX(u);
      // which side of the opponent he is on, remembered from the last moment both stood: separate()
      // doesn't let him walk out the far side of her body while she is down or in the air
      const o = oppOf(u);
      if (o && !o.hidden && u.grounded && o.grounded && !u.rag && !o.rag && !NOT_SOLID.has(u.state) && !NOT_SOLID.has(o.state) && u.state !== 'getup' && o.state !== 'getup' && !isWake(u) && !isWake(o) && Math.abs(u.x - o.x) > 8) u.home = Math.sign(u.x - o.x);
    }
    for (const u of sim.units) {
      const opp = oppOf(u);
      if (u.hidden || !opp) continue;
      // the winner stays live through the KO and WINS cards; the loser is done
      const live = sim.phase === 'fight' || ((sim.phase === 'ko' || sim.phase === 'match') && u.id === sim.winner);
      const inp = (live && u.controller) ? u.controller(u, opp, sim) : EMPTY_INPUT;
      const e = edges(u, inp);
      // botches (botch.js): a tangled body loses its presses until it's back; a mistimed press botches
      // (or, in a technique's window, comes out as a happy accident) instead of waiting in the buffer
      if (u.botchKind && u.state !== 'botch' && !(u.state === 'attack' && FRAME_DATA[u.move] && FRAME_DATA[u.move].botch)) u.botchKind = '';
      if (e.attack && FRAME_DATA[e.attack] && FRAME_DATA[e.attack].stanceOnly && !stanceMoves(u).includes(e.attack)) e.attack = null;   // a stance's moves come only out of it
      // on the floor a button is a wake-up strike (1 or 3 the kick, 2 or 4 or anything with down the sweep);
      // a wake-up strike named anywhere else is nothing
      if (e.attack && u.state === 'down') e.attack = wakeFor(e);
      else if (e.attack && FRAME_DATA[e.attack] && FRAME_DATA[e.attack].wake) e.attack = null;
      const feint = e.attack && live ? feintOf(u, e.attack) : null;   // a designed cancel (frame data feint)
      if (feint) { e.attack = feint; e.keys = null; e.name = ''; e.feint = true; }
      if (e.attack && live && sim.botchOn) {
        if (u.botchKind) e.attack = null;
        else {
          // in a hit's freeze too: the body tangles (or the technique comes out) once it lets go
          const v = pressVerdict(u, e);
          if (v) { if (v === 'botch') botch(u, e, opp); else if (v !== 'lost') happyAccident(u, v); e.attack = null; }
        }
      }
      if (e.attack && live) {
        // a throw pressed a few steps into a jab/cross/kick startup replaces it (1 then 3 a frame late)
        if (e.attack === 'throw' && u.state === 'attack' && u.phase === 'startup' && sim.stepCount - u.attackStart <= 4) { u.state = 'idle'; u.move = null; }
        if (e.feint && u.state === 'attack') { u.state = 'idle'; u.move = null; u.glide = null; u.vx = 0; }   // the feint's follow-up starts now
        // a string press while the previous string press still waits for its window: queue it
        // behind that one instead of replacing it (a fast hand gets the whole string)
        let queued = false;
        if (u.buffer && u.bufferKeys && u.bufferKeys.length > 1 && e.keys && u.state === 'attack') {
          const cand = [...u.bufferKeys, e.keys[e.keys.length - 1]], m = matchStrings(cand, u.char.strings);
          if (m.length) { const s0 = m.find(x => x.keys.length === cand.length) || m[0]; u.queued = { attack: s0.moves[cand.length - 1], keys: cand, name: s0.name, at: sim.stepCount }; queued = true; }
        }
        if (!queued) { u.buffer = e.attack; u.bufferAge = 0; u.bufferKeys = e.keys; u.bufferName = e.name; u.queued = null; }
      }
      if (u.flash > 0) u.flash--;
      if (u.state === 'grabbed') {
        if (u.grabTo != null) { const d = u.grabTo - u.x; u.x += Math.max(-GRAB_PULL, Math.min(GRAB_PULL, d)); if (Math.abs(d) <= GRAB_PULL) u.grabTo = null; syncRig(u); rigUpd(u, 0); }
        if ((e.attack === 'throw' || (e.attack && FRAME_DATA[e.attack].throw)) && !(u.faint > 0) && !u.grabNoBreak) breakThrow(u);
        else if (--u.grabT <= 0) landThrow(u);
        u.buffer = null;
        continue;
      }
      if (u.hitstop > 0) {
        if (--u.hitstop === 0 && u.releaseEv) { onEvent(u.releaseEv); u.releaseEv = null; }
        continue;
      }
      if (u.bounce > 0) u.bounce--;
      if (u.shockT > 0 && (u.state !== 'hitstun' || --u.shockT <= 0)) u.shockT = 0;   // the shock runs with the stun
      if (u.rootT > 0 && u.state !== 'hitstun' && u.state !== 'blockstun') u.rootT--;   // the root runs once the stun is over
      if (u.buffer && !(u.state === 'attack' && u.phase !== 'recovery' && u.bufferKeys && u.bufferKeys.length > 1) && ++u.bufferAge > BUFFER_STEPS) { u.buffer = null; u.bufferKeys = null; }
      u.prevJoints = copyJoints(u.rig.joints, u.prevJoints);
      updateUnit(u, opp, e);
      if (sim.phase === 'fight') regen(u);
      physics(u);
      syncRig(u);
      // a walk or run cycle plays at the rate that keeps planted feet planted at the character's speed
      // (exactly 1 for TEMP); the getup at its own speed
      const rate = u.state === 'getup' ? GETUP_SPEED : u.state === 'walk' ? u.char.stats.walk * (u.backHeld ? u.char.stats.backWalk : 1) / u.char.stride
        : u.state === 'run' ? u.char.stats.run / u.char.stride : u.state === 'crouch' && u.vx ? u.char.stats.walk / u.char.stride
        : u.state === 'attack' && u.phase === 'startup' && sim.stepCount < u.speedEnd ? u.speedMul : 1;   // a timed speed status quickens startups
      rigUpd(u, DT * rate);
      takeRoot(u);
      drainRig(u);
      if (u.state === 'botch' && u.rig.current.done) endBotch(u);   // the rig took the clip's step this update: the root takes it now too
      floorStep(u);
    }
    resolveHits();
    separate();
    regroup();
    stepRagdolls();
    if (sim.card) { sim.card.t -= DT; if (sim.card.t <= 0) sim.card = null; }
    for (let i = sim.callouts.length - 1; i >= 0; i--) { sim.callouts[i].t -= DT; if (sim.callouts[i].t <= 0) sim.callouts.splice(i, 1); }
    if (sim.combo) { const v = sim.units[sim.combo.on]; if (!v || (v.state !== 'hitstun' && v.state !== 'knockdown' && v.state !== 'down' && v.state !== 'splat')) { sim.lastCombo = { ...sim.combo, t: 0.6 }; sim.combo = null; } }
    if (sim.lastCombo) { sim.lastCombo.t -= DT; if (sim.lastCombo.t <= 0) sim.lastCombo = null; }
    for (const u of sim.units) syncRig(u);
    hordeStep();
    roundFlow();
  }

  sim.step = (ms) => {
    sim.accumulator += ms;
    const stepMs = 1000 / 120;
    let n = 0;
    while (sim.accumulator >= stepMs && n < 60) { sim.accumulator -= stepMs; tick(); n++; }
    return n;
  };
  sim.tick = tick;
  sim.eventFilter = null;
  // online rollback: the whole state that feeds the next tick (src/combat/snapshot.js)
  sim.saveState = (into) => saveSim(sim, arena, into);
  sim.loadState = (s) => loadSim(sim, arena, s);
  sim.penetration = penetration;
  sim.separate = separate;
  sim.FRAME_DATA = FRAME_DATA;
  sim.ANIM = ANIM;
  sim.snapshot = snapshot;
  sim.ATTACKS = ATTACKS;
  sim.debugBoxes = (u) => ({
    hits: u.state === 'attack' && u.phase === 'active' ? buildHitboxes(u.rig, u.move, u.facing) : [],
    hurt: buildHurtboxes(u.rig),
  });
  return sim;
}

function copyJoints(src, dst) {
  if (!src) return dst;
  dst = dst || {};
  for (const k in src) { const p = dst[k] || (dst[k] = { x: 0, y: 0 }); p.x = src[k].x; p.y = src[k].y; }
  return dst;
}

function segDistPt(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, l2 = abx * abx + aby * aby;
  let t = l2 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return dm.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t);
}
// closest distance between two segments (exact for non-crossing; crossing gives 0)
function segSeg(a, b, c, d) {
  const cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(segDistPt(a, c, d), segDistPt(b, c, d), segDistPt(c, a, b), segDistPt(d, a, b));
}
