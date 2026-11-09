// The fighter sheets, derived from the game's own data (README, "Site"). Runs in Node at build time
// (site/generate.mjs): it imports the character registry, which registers every character into the
// shared tables exactly as the game does, then reads each one's stats, body, moves, commands, strings
// and move list, the frame data (src/combat/frameData.js) and the rig's clip timing (MOVE_DATA in
// src/fighter/index.js). Nothing per character is written by hand here; a new character file shows up
// on the site with no change to this folder.
//
// Timing, in 60fps frames (the language of frame data), from the rig's clips the way the sim reads them:
//   startup   press to contact: blend + the active key's time, less the 50 ms pre-roll the sim skips
//             (PREROLL in src/combat/sim.js). Matches the README's measured numbers (a jab is 13 sim
//             steps, Mandatory Training 27, Cold Call 19, Close the Deal 12, Downsizing about 20 frames).
//   active    the active key to the recover key
//   recovery  the recover key to the end of the clip (the fighter is free when the clip ends)
//   on block  blockstun minus the frames from contact to the end of the clip, with contact taken at the
//             sim's early-live point (45 ms or 30% of the startup before the key). About right, not
//             measured: ACCOUNTANT's Fine Print comes out +3 here and measured +2.5 in accountant-test.
//
// Hidden techniques (the happy accidents, src/combat/botch.js) are never listed: the shared basics come
// from SHARED_INPUTS below and a character's own moves from its file, and the techniques are neither.

import { roster, TEMP_ID, getCharacter } from '../src/characters/index.js';
import { FRAME_DATA, COMBO_DMG, COMBO_SOFTCAP, COMBO_OVERCAP, comboScale } from '../src/combat/frameData.js';
import { STRINGS } from '../src/combat/strings.js';
import { MOVE_DATA, RIG, RIG_KIT, createFighter } from '../src/fighter/index.js';
import { buildHitboxes } from '../src/combat/hitboxes.js';

const PREROLL_MS = 50;   // src/combat/sim.js PREROLL
const fr = (ms) => Math.round(ms * 0.06);

// The shared button table, as resolveButton() in src/combat/sim.js reads a press (keep the two together).
export const SHARED_INPUTS = [
  { button: '1', motion: '', move: 'jab', name: 'JAB' },
  { button: '2', motion: '', move: 'cross', name: 'CROSS' },
  { button: '3', motion: '', move: 'lkick', name: 'SNAP KICK' },
  { button: '4', motion: '', move: 'roundhouse', name: 'ROUNDHOUSE' },
  { button: '1', motion: 'f', move: 'bodyBlow', name: 'BODY BLOW' },
  { button: '2', motion: 'f', move: 'lungeCross', name: 'LUNGE CROSS' },
  { button: '2', motion: 'ff', move: 'cometCross', name: 'COMET CROSS', note: 'out of a run' },
  { button: '4', motion: 'f', move: 'overhead', name: 'OVERHEAD KICK' },
  { button: '4', motion: 'b', move: 'spinKick', name: 'SPIN KICK', note: 'near a wall: Wall Spin' },
  { button: '1', motion: 'd', move: 'lowJab', name: 'LOW JAB' },
  { button: '2', motion: 'd', move: 'uppercut', name: 'UPPERCUT' },
  { button: '3', motion: 'd', move: 'lowKick', name: 'LOW KICK' },
  { button: '4', motion: 'd', move: 'sweep', name: 'SWEEP' },
  { button: '2', motion: 'rise', move: 'risingUppercut', name: 'RISING UPPERCUT' },
  { button: '4', motion: 'rise', move: 'risingKnee', name: 'RISING KNEE' },
  { button: '1+3', motion: '', move: 'throw', name: 'THROW', note: 'or 2+4; near a wall: Wall Slam' },
  { button: '1', motion: 'air', move: 'jumpJab', name: 'JUMP JAB' },
  { button: '2', motion: 'air', move: 'jumpCross', name: 'JUMP CROSS' },
  { button: '3', motion: 'air', move: 'flyingKick', name: 'FLYING KICK' },
  { button: '4', motion: 'air', move: 'airRoundhouse', name: 'AIR ROUNDHOUSE' },
  { button: '4', motion: 'airDown', move: 'diveKick', name: 'DIVE KICK' },
];

// ---- notation: the game's glyphs (the HUD's move hints and the move lists) ---------------------------
export function inputFor(button, motion) {
  if (motion === 'air') return `${button} in air`;
  if (motion === 'airDown') return `↓${button} in air`;
  if (motion === 'rise') return `release ↓, ${button}`;
  if (motion === 'd') return `↓${button}`;
  const g = { f: '→', b: '←', df: '↘', db: '↙', ff: '→→', run: '→→' }[motion];
  return g ? `${g} ${button}` : button;
}
export const tokenGlyph = (t) => (t[0] === 'd' ? '↓' + t.slice(1) : t);
const keysGlyph = (keys) => keys.map(tokenGlyph).join(', ');
const norm = (s) => String(s || '').replace(/\(.*?\)/g, '').replace(/\s+/g, '').toLowerCase();
const humanize = (m) => m.replace(/^[a-z]+_/, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2').toUpperCase();

// the clip a move plays: its own, else the first of its `anims` the rig has (createCombat does the same)
export function animOf(move) {
  const fd = FRAME_DATA[move];
  if (!fd) return null;
  return [move, ...(fd.anims || []), ...(fd.anim ? [fd.anim] : [])].find((n) => MOVE_DATA[n]) || null;
}

function timing(move) {
  const anim = animOf(move), d = anim && MOVE_DATA[anim];
  if (!d || d.activeAt == null || !d.cancel) return null;
  const blend = d.blend || 0, early = Math.min(45, d.activeAt * 0.3);
  // a multi-hit clip (frame data hits) meets the guard last on its last active key
  const keys = (RIG_KIT.base(anim) || {}).keys || [];
  let at = 0, lastActive = d.activeAt;
  for (const k of keys) { if (k.ev === 'active') lastActive = at; at += k.d; }
  if (!(FRAME_DATA[move].hits > 1)) lastActive = d.activeAt;
  return {
    anim,
    startup: Math.max(1, fr(blend + d.activeAt - PREROLL_MS)),
    active: Math.max(1, fr(d.cancel[0] - d.activeAt)),
    recovery: fr(d.duration - d.cancel[0]),
    total: fr(blend + d.duration - PREROLL_MS),
    afterContact: (d.duration - (lastActive - (lastActive === d.activeAt ? early : 0))) * 0.06,
  };
}

// ---- reach: the sim's own measure (calibrate() in sim.js), on this character's body -------------------
const reachCache = new Map();
function rigFor(c) {
  const rig = createFighter({ color: '#fff', x: 0, y: 0, facing: 1, body: c.body });
  rig.setBody(c.body, { accent: c.accent });
  return rig;
}
function reachOf(c, move) {
  const key = c.id + ':' + move;
  if (reachCache.has(key)) return reachCache.get(key);
  const anim = animOf(move), md = anim && MOVE_DATA[anim];
  let best = null;
  if (md && md.limb && !FRAME_DATA[move].noHit) {
    const rig = rigFor(c);
    FRAME_DATA[move].joint = md.limb;   // as createCombat sets it
    rig.play(anim);
    let active = false, n = 0;
    while (!rig.current.done && n++ < 1200) {
      rig.update(1 / 120);
      for (const ev of rig.events) { if (ev.type === 'active') active = true; if (ev.type === 'recover') active = false; }
      rig.events.length = 0;
      if (active) for (const h of buildHitboxes(rig, move, 1)) best = Math.max(best || 0, h.x - rig.x + h.r);
    }
    if (best != null) best = Math.round(best);
  }
  reachCache.set(key, best);
  return best;
}

// ---- one move's frame data -------------------------------------------------------------------------------
function heightOf(fd) {
  if (fd.throw) return 'throw';
  if (fd.overhead || fd.air) return 'overhead';
  return fd.height || 'mid';
}
// a move that never strikes on its own: a stance, a counter stance, a step out
const quiet = (fd) => !!(fd.noHit || fd.stance || fd.parry || fd.throwCounter);
function damageOf(fd) {
  if (quiet(fd)) return { total: 0, text: '—' };
  if (fd.hits > 1 && fd.rush) {
    const r = fd.rush.damage != null ? fd.rush.damage : fd.damage;
    return { total: r * (fd.hits - 1) + fd.damage, text: `${Array(fd.hits - 1).fill(r).join('+')}+${fd.damage}` };
  }
  return { total: fd.damage, text: String(fd.damage) };
}
function propsOf(fd, c) {
  const p = [];
  if (fd.ender) p.push('ender');
  if (fd.throw) p.push(fd.grab ? 'command grab' : 'throw');
  if (fd.noBreak) p.push("can't be broken");
  if (fd.unblockable && !fd.throw) p.push('unblockable');
  if (fd.juggle) p.push('launch'); else if (fd.knockdown && !fd.noHit) p.push('knockdown');
  if (fd.splat) p.push('wall splat');
  if (fd.wallBounce) p.push('wall bounce');
  if (fd.groundBounce) p.push('ground bounce');
  if (fd.armor) p.push(`armor: ${fd.armor.hits || 1} hit at ${Math.round((fd.armor.dmg != null ? fd.armor.dmg : 0.5) * 100)}% damage`);
  if (fd.parry) p.push(`parries ${(fd.parry.heights || ['high', 'mid']).join(' and ')}`);
  if (fd.throwCounter) p.push('catches throws');
  if (fd.invuln) p.push(`invulnerable ${fd.invuln.ms} ms`);
  if (fd.lowInvuln) p.push('hops lows');
  if (fd.tc) p.push('ducks highs');
  if (fd.bothSides) p.push('hits both sides');
  if (fd.hits > 1) p.push(`${fd.hits} hits`);
  if (fd.status) p.push(`${fd.status.tag}: ${statusText(fd.status)}`);
  if (fd.selfStatus) p.push(`self ${fd.selfStatus.tag}: ${statusText(fd.selfStatus)}`);
  if (fd.shock) p.push(`shock: +${fd.shock.frames}f stun`);
  if (fd.root) p.push(`root: ${fd.root}f, no walking`);
  if (fd.stance) p.push('stance');
  if (fd.stanceOnly) p.push('from the stance');
  if (fd.feint) p.push(`feints in ${fd.feint.ms} ms`);
  if (fd.backThrow) p.push('sides swap');
  if (fd.onJuggle) p.push('juggle ender');
  if (fd.blockPush < 0) p.push('steps in on block');
  if (fd.travel && fd.travel.vx > 0) p.push(`glides ${Math.round(fd.travel.vx * fd.travel.ms / 1000 * c.stats.dash)} px`);
  if (fd.travel && fd.travel.vx < 0) p.push(`hops back ${Math.round(-fd.travel.vx * fd.travel.ms / 1000 * c.stats.dash)} px`);
  if (fd.noHit && !fd.stance && !fd.parry && !fd.throwCounter && !fd.selfStatus && !fd.invuln) p.push('no hit');
  return p;
}
function statusText(s) {
  const parts = [];
  if (s.regen != null && s.regen !== 1) parts.push(`${Math.round(s.regen * 100)}% stamina regen`);
  if (s.speed != null && s.speed !== 1) parts.push(`startups ${s.speed}x as fast`);
  return `${parts.join(', ')} for ${(s.ms / 1000).toFixed(1).replace(/\.0$/, '')}s`;
}

// reversals (a parry's or throw counter's answer) start already in range, so reach means nothing there
const isReversal = (move) => Object.values(FRAME_DATA).some((f) => (f.parry && f.parry.reversal === move) || (f.throwCounter && f.throwCounter.reversal === move));

export function frameRow(move, c) {
  const fd = FRAME_DATA[move];
  const t = timing(move);
  const q = quiet(fd);
  const blockable = !q && !fd.throw && !fd.unblockable;
  return {
    move,
    anim: t ? t.anim : null,
    damage: damageOf(fd),
    height: q ? '—' : heightOf(fd),
    startup: t && !q ? t.startup : null,
    active: t && !q ? t.active : null,
    recovery: t ? t.recovery : null,
    total: t ? t.total : null,
    onBlock: t && blockable ? Math.round(fd.blockstun - t.afterContact) : null,
    hitstun: !q && !fd.knockdown && !fd.throw ? fd.hitstun : null,
    blockstun: blockable ? fd.blockstun : null,
    cost: fd.cost,
    reach: q || isReversal(move) ? null : fd.throw ? (fd.range || FRAME_DATA.throw.range) : reachOf(c, move),
    reachKind: fd.throw ? 'grab range' : 'reach',
    props: propsOf(fd, c),
  };
}

// ---- combo damage, as the sim scales it (README, Combo decay) --------------------------------------------
function comboDamage(moves, c) {
  let total = 0, n = 0;
  for (const m of moves) {
    const fd = FRAME_DATA[m];
    if (!fd || fd.noHit) continue;
    const hits = fd.hits > 1 && fd.rush ? [...Array(fd.hits - 1).fill(fd.rush.damage != null ? fd.rush.damage : fd.damage), fd.damage] : [fd.damage];
    for (const d of hits) {
      n++;
      let v = d * comboScale(COMBO_DMG, n) * c.stats.damage;
      if (total >= COMBO_SOFTCAP) v *= COMBO_OVERCAP;
      total += v;
    }
  }
  return Math.round(total);
}
function payoffOf(fd) {
  if (!fd) return '';
  const p = [];
  if (fd.juggle) p.push('launch'); else if (fd.knockdown) p.push('knockdown');
  if (fd.splat) p.push('wall splat');
  if (fd.groundBounce) p.push('ground bounce');
  if (fd.wallBounce) p.push('wall bounce');
  if (fd.status) p.push(fd.status.tag);
  if (fd.overhead) p.push('overhead');
  if (fd.height === 'low') p.push('low');
  if (fd.hits > 1) p.push(`${fd.hits} hits`);
  return p.join(', ') || (fd.ender ? 'mid finish' : '');
}

// ---- the character's sheet ---------------------------------------------------------------------------
const T = () => getCharacter(TEMP_ID);
const STAT_ROWS = [
  ['health', 'HEALTH', (s) => s.health, (v) => String(v), 80, 120],
  ['walk', 'WALK', (s) => s.walk, (v) => v.toFixed(2) + 'x', 0.7, 1.3],
  ['backWalk', 'BACK WALK', (s) => s.walk * s.backWalk, (v) => v.toFixed(2) + 'x', 0.7, 1.3],
  ['run', 'RUN', (s) => s.run, (v) => v.toFixed(2) + 'x', 0.7, 1.3],
  ['jump', 'JUMP', (s) => s.jump, (v) => v.toFixed(2) + 'x', 0.7, 1.3],
  ['dash', 'DASH', (s) => s.dash, (v) => v.toFixed(2) + 'x', 0.7, 1.3],
  ['weight', 'WEIGHT', (s) => s.weight, (v) => v.toFixed(2) + 'x', 0.7, 1.3],
  ['stamina', 'STAMINA BAR', (s) => s.stamina, (v) => v.toFixed(2) + 'x', 0.7, 1.3],
  ['regen', 'STAMINA REGEN', (s) => s.regen, (v) => v.toFixed(2) + 'x', 0.7, 1.3],
  ['damage', 'DAMAGE', (s) => s.damage, (v) => v.toFixed(2) + 'x', 0.7, 1.3],
];
const STAT_HELP = {
  health: 'out of 100', walk: 'walking speed', backWalk: 'stepping back', run: 'running speed', jump: 'jump height',
  dash: 'every glide and lunge', weight: 'heavier flies less far', stamina: 'size of the attack budget',
  regen: 'how fast stamina refills', damage: 'every hit he lands',
};

function statsOf(c) {
  const ts = T().stats;
  return STAT_ROWS.map(([key, label, get, fmt, lo, hi]) => {
    const v = get(c.stats), base = get(ts);
    const pos = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    const basePos = Math.max(0, Math.min(1, (base - lo) / (hi - lo)));
    const diff = key === 'health' ? v - base : Math.round((v / base - 1) * 100);
    return { key, label, value: fmt(v), raw: v, pos, basePos, diff, diffText: diff === 0 ? 'same as TEMP' : key === 'health' ? `${diff > 0 ? '+' : ''}${diff} vs TEMP` : `${diff > 0 ? '+' : ''}${diff}% vs TEMP`, help: STAT_HELP[key] };
  });
}

function bodyOf(c) {
  const b = { ...RIG, ...(c.body || {}) }, s = (c.body && c.body.scale) || 1;
  const arm = (x) => x.upperArm + x.lowerArm, leg = (x) => x.upperLeg + x.lowerLeg;
  const tall = (x) => x.upperLeg + x.lowerLeg + x.lowerTorso + x.upperTorso + (x.neck || 0) + 2 * x.headR;
  const rel = (v, base) => v / base;
  const reach = (m) => ({ move: m, px: reachOf(c, m), base: reachOf(T(), m) });
  return {
    scale: s,
    rows: [
      { label: 'SIZE', value: `${s.toFixed(2)}x`, note: 'the whole rig' },
      { label: 'HEIGHT', value: `${(s * rel(tall(b), tall(RIG))).toFixed(2)}x`, note: 'head to feet' },
      { label: 'ARMS', value: `${(s * rel(arm(b), arm(RIG))).toFixed(2)}x`, note: 'shoulder to fist' },
      { label: 'LEGS', value: `${(s * rel(leg(b), leg(RIG))).toFixed(2)}x`, note: 'hip to foot' },
      { label: 'LIMBS', value: `${(s * b.limbW / RIG.limbW).toFixed(2)}x`, note: 'thickness (hitbox and hurtbox)' },
      { label: 'LEAN', value: `${b.lean || 0}°`, note: (b.lean || 0) < 0 ? 'leans back' : (b.lean || 0) > 0 ? 'leans in' : 'upright' },
    ],
    reach: [['jab', 'JAB'], ['cross', 'CROSS'], ['lkick', 'SNAP KICK'], ['roundhouse', 'ROUNDHOUSE']].map(([m, label]) => ({ label, ...reach(m) })),
  };
}

function mechanicsOf(c, names) {
  const out = [];
  const mv = (m) => names.get(m) || nameOf(c, m);
  if (c.mechanics.airJumps) out.push({ label: 'DOUBLE JUMP', text: `${c.mechanics.airJumps === 1 ? 'One more jump' : `${c.mechanics.airJumps} more jumps`} in the air, in any direction, and each one gives back the air attack.` });
  if (c.mechanics.wallJump) out.push({ label: 'WALL JUMP', text: 'A jump near a wall kicks off it, away from the wall and over anyone standing there. Twice a jump.' });
  for (const m of c.ownMoves) {
    const fd = FRAME_DATA[m];
    if (fd.armor) out.push({ label: 'ARMOR', text: `${mv(m)} absorbs ${fd.armor.hits || 1} hit from the press until recovery and takes ${Math.round((fd.armor.dmg != null ? fd.armor.dmg : 0.5) * 100)}% of its damage. Throws still beat it.` });
    if (fd.parry) out.push({ label: 'PARRY', text: `${mv(m)} is a counter stance: a ${(fd.parry.heights || ['high', 'mid']).join(' or ')} strike that lands in it is caught, the striker reels for ${fd.parry.stun || 40} frames, and it turns into ${mv(fd.parry.reversal)}. Lows and throws beat it.` });
    if (fd.throwCounter) out.push({ label: 'THROW COUNTER', text: `${mv(m)} catches a throw or a command grab and answers with ${mv(fd.throwCounter.reversal)}. Any strike beats it.` });
    if (fd.invuln) out.push({ label: 'INVULNERABLE', text: `For ${fd.invuln.ms} ms of ${mv(m)}, strikes and throws pass through.` });
    if (fd.stance) out.push({ label: 'STANCE', text: `${mv(m)} is a stance. Out of it: ${Object.entries(fd.stance.moves).map(([b, x]) => `${b} ${mv(x)}`).join(', ')}.` });
    if (fd.status) out.push({ label: fd.status.tag, text: `A clean hit with ${mv(m)} leaves the other fighter ${fd.status.tag}: ${statusText(fd.status)}.` });
    if (fd.selfStatus) out.push({ label: fd.selfStatus.tag, text: `${mv(m)} is a self buff, ${fd.selfStatus.tag}: ${statusText(fd.selfStatus)}.` });
    if (fd.shock) out.push({ label: 'SHOCK', text: `${mv(m)} adds ${fd.shock.frames} frames of stun on a standing hit, once per combo.` });
    if (fd.root) out.push({ label: 'ROOT', text: `${mv(m)} roots the other fighter for ${fd.root} frames after the stun: no walking, running or jumping, though guarding still works.` });
    if (fd.feint) out.push({ label: 'FEINT', text: `In the first ${fd.feint.ms} ms of ${mv(m)}, a follow-up press turns it into another move at once, with no botch.` });
    if (fd.backThrow) out.push({ label: 'SIDE SWAP', text: `${mv(m)} throws the other fighter overhead and down on the far side.` });
    if (fd.grab && fd.noBreak && !fd.backThrow) out.push({ label: 'COMMAND GRAB', text: `${mv(m)} can't be broken or blocked. It whiffs on a croucher like any throw.` });
    if (fd.bothSides) out.push({ label: 'BOTH SIDES', text: `${mv(m)} hits in front and behind.` });
    if (fd.onJuggle) out.push({ label: 'JUGGLE ENDER', text: `${mv(m)} is a different move on a body in the air: ${fd.onJuggle.damage} damage${fd.onJuggle.splat ? ' and a wall splat' : ''}.` });
  }
  if (c.ai && c.ai.style) out.push({ label: 'CPU STYLE', text: { turtle: 'Turtle: guards a lot, waits at range and punishes whiffs.', rushdown: 'Rushdown: runs in, swings more, never backs off.', grappler: 'Grappler: throws up close and hunts the wall.', aerial: 'Aerial: jumps in from further out, much more often.' }[c.ai.style] || c.ai.style });
  return out;
}

// moveList entry for a move: by name (its callout or a string it ends) or by the input that presses it
function listEntry(c, names, inputs) {
  const ns = names.filter(Boolean).map(norm), is = inputs.filter(Boolean).map(norm);
  return (c.moveList || []).find((e) => ns.includes(norm(e.name))) || (c.moveList || []).find((e) => is.includes(norm(e.input))) || null;
}
function nameOf(c, m) {
  const fd = FRAME_DATA[m];
  const ender = c.strings.find((s) => s.moves[s.moves.length - 1] === m && s.moves.some((x) => FRAME_DATA[x] && FRAME_DATA[x].owner === c.id));
  return (fd && fd.callout) || (ender && ender.name) || humanize(m);
}

// every way to press one of the character's own moves
function inputsOf(c, m) {
  const out = [];
  // seq: the clips the page's animation plays for this way in (a string's presses up to it, a stance first)
  const clip = animOf(m);
  for (const k of c.commands) if (k.move === m) out.push({ input: inputFor(k.button, k.motion), how: '', seq: [clip] });
  for (const s of c.strings) {
    const i = s.moves.indexOf(m);
    if (i < 0 || (i === 0 && out.length)) continue;
    const seq = s.moves.slice(0, i + 1).map(animOf);
    if (i === s.moves.length - 1) out.push({ input: keysGlyph(s.keys), how: `ends ${s.name}`, seq });
    else out.push({ input: keysGlyph(s.keys.slice(0, i + 1)), how: `${ordinal(i + 1)} hit of ${s.name}`, seq });
  }
  for (const p of c.ownMoves) {
    const fd = FRAME_DATA[p];
    const parentIn = () => inputsOf(c, p).map((x) => x.input)[0] || '';
    const seq = [animOf(p), clip];
    if (fd.stance) for (const [b, x] of Object.entries(fd.stance.moves)) if (x === m) out.push({ input: `${parentIn()}, ${b}`, how: `out of ${nameOf(c, p)}`, seq });
    if (fd.parry && fd.parry.reversal === m) out.push({ input: parentIn(), how: `when ${nameOf(c, p)} catches a strike`, seq });
    if (fd.throwCounter && fd.throwCounter.reversal === m) out.push({ input: parentIn(), how: `when ${nameOf(c, p)} catches a grab`, seq });
  }
  return dedupe(out);
}
const ordinal = (n) => ['first', 'second', 'third', 'fourth', 'fifth'][n - 1] || `#${n}`;
const dedupe = (a) => a.filter((x, i) => a.findIndex((y) => y.input === x.input && y.how === x.how) === i);

function describe(row) {
  const bits = [];
  if (row.height !== '—') bits.push(row.height);
  for (const p of row.props) if (!/^glides|^hops back/.test(p)) bits.push(p);
  return bits.join(', ');
}

function uniqueMovesOf(c) {
  // feint versions (a move a feint turns into that plays another own move's clip) fold into that move
  const feintOf = new Map();
  for (const m of c.ownMoves) {
    const fd = FRAME_DATA[m];
    if (fd.feint) for (const [, to] of Object.entries(fd.feint.into)) if (to !== m) feintOf.set(to, m);
  }
  const cards = [];
  for (const m of c.ownMoves) {
    if (feintOf.has(m) && FRAME_DATA[m].anims && c.ownMoves.includes(FRAME_DATA[m].anims[0])) continue;
    const inputs = inputsOf(c, m);
    const name = nameOf(c, m);
    // a move list entry matches by name, or by the plain input that presses it (not a stance's or a parry's)
    const entry = listEntry(c, [FRAME_DATA[m].callout, name === humanize(m) ? null : name], inputs.filter((x) => !x.how || /^ends /.test(x.how)).map((x) => x.input));
    const row = frameRow(m, c);
    // the feint versions that end up as this move
    const feints = [];
    for (const [to, from] of feintOf) {
      if (FRAME_DATA[to].anims && FRAME_DATA[to].anims[0] === m) {
        const via = Object.entries(FRAME_DATA[from].feint.into).filter(([, t]) => t === to).map(([k]) => k);
        const presses = [...new Set(via.map((k) => { const cmd = c.commands.find((x) => x.move === k); return cmd ? inputFor(cmd.button, cmd.motion) : k === 'throw' ? '1+3' : null; }).filter(Boolean))];
        feints.push({ input: `${inputsOf(c, from)[0] ? inputsOf(c, from)[0].input : ''}, then ${presses.join(' or ')}`, how: `cancels ${nameOf(c, from)} in its first ${FRAME_DATA[from].feint.ms} ms`, row: frameRow(to, c) });
      }
    }
    cards.push({
      move: m, name: entry ? entry.name : name,
      inputs: inputs.length ? inputs : [{ input: entry ? entry.input : '—', how: '' }],
      note: entry ? entry.note : describe(row),
      listed: !!entry,
      row, feints,
      clip: row.anim,
      seq: ((inputs[0] && inputs[0].seq) || [row.anim]).filter((x) => x && MOVE_DATA[x]),
    });
  }
  // an unlisted move named like a listed one (INTERN's paperCut opener next to the PAPER CUT finisher)
  for (const card of cards) {
    if (card.listed || !cards.some((o) => o !== card && o.name === card.name)) continue;
    card.name += c.strings.some((st) => st.moves[0] === card.move) ? ' OPENER' : ` ${cards.filter((o) => o.name.startsWith(card.name)).indexOf(card) + 1}`;
  }
  return cards;
}

function stringsOf(c) {
  const own = (s) => s.moves.some((m) => FRAME_DATA[m] && FRAME_DATA[m].owner === c.id);
  const list = c.strings.map((s) => {
    const ender = FRAME_DATA[s.moves[s.moves.length - 1]];
    return {
      name: s.name, input: keysGlyph(s.keys), own: own(s),
      moves: s.moves.map((m) => (FRAME_DATA[m] && FRAME_DATA[m].owner ? nameOf(c, m) : (SHARED_INPUTS.find((x) => x.move === m) || {}).name || humanize(m))),
      payoff: payoffOf(ender),
      ender: !!(ender && ender.ender),
      damage: comboDamage(s.moves, c),
      cost: s.moves.reduce((t, m) => t + ((FRAME_DATA[m] && FRAME_DATA[m].cost) || 0), 0),
    };
  });
  list.sort((a, b) => (b.own - a.own));
  const dropped = STRINGS.filter((s) => !c.strings.some((x) => x.name === s.name)).map((s) => s.name);
  return { list, dropped };
}

function basicsOf(c) {
  return SHARED_INPUTS.map((x) => {
    const over = c.commands.find((k) => k.button === x.button && k.motion === x.motion);
    return { ...x, input: inputFor(x.button, x.motion), row: frameRow(x.move, c), replacedBy: over ? nameOf(c, over.move) : null };
  });
}

/** Everything the site shows about one character. */
export function sheetOf(c) {
  const moves = uniqueMovesOf(c);
  const names = new Map(moves.map((m) => [m.move, m.name]));
  return {
    id: c.id, name: c.name, tagline: c.tagline,
    color: c.color, altColor: c.altColor, accent: c.accent, pants: c.pants || null, altPants: c.altPants || null,
    stats: statsOf(c),
    body: bodyOf(c),
    mechanics: mechanicsOf(c, names),
    moveList: c.moveList || [],
    moves,
    strings: stringsOf(c),
    basics: basicsOf(c),
    damageMul: c.stats.damage,
  };
}

export function allSheets() { return roster().map(sheetOf); }
