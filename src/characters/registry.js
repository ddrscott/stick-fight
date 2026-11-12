// The character registry. A character file (src/characters/<id>.js) default-exports a definition;
// index.js registers each one. Registering merges the character's own moves into the shared tables
// (the rig's MOVE_DEFS, the sim's FRAME_DATA), builds its string table, and fills in defaults, so the
// rig, the sim, the AI, the HUD and the select screen read everything from the definition. See the
// README's Characters section for the file format and every hook.

import { addMoves, RIG } from '../fighter/index.js';
import { addFrameData, FRAME_DATA } from '../combat/frameData.js';
import { buildStrings } from '../combat/strings.js';

// the select screen's order (registered ones only); TEMP, the baseline, comes first
export const ROSTER_ORDER = ['temp', 'intern', 'helpdesk', 'courier', 'security', 'janitor', 'manager', 'accountant', 'windowWasher', 'hrRep', 'salesRep', 'barista', 'chef', 'wellness', 'electrician', 'receptionist', 'lawyer', 'ceo'];
export const TEMP_ID = 'temp';
const STAT_DEFAULTS = { health: 100, walk: 1, backWalk: 1, run: 1, jump: 1, dash: 1, weight: 1, stamina: 1, regen: 1, damage: 1 };
const MOTIONS = new Set(['', 'f', 'b', 'd', 'df', 'db', 'ff', 'run', 'rise', 'air', 'airDown']);
const BUTTONS = new Set(['1', '2', '3', '4', '1+3', '2+4']);
const REG = new Map();

/** @param {any} def */
export function registerCharacter(def) {
  if (!def || !def.id) throw new Error('a character needs an id');
  if (REG.has(def.id)) return REG.get(def.id);
  const id = def.id;
  const c = { ...def };
  c.name = c.name || id.toUpperCase();
  c.tagline = c.tagline || '';
  c.color = c.color || '#f0f0f0';
  c.altColor = c.altColor || c.accent || '#E85D00';
  c.accent = c.accent || c.color;
  c.stats = { ...STAT_DEFAULTS, ...(def.stats || {}) };
  // knockback taken: a heavy body flies less far (x by 1/weight, y by 1/sqrt(weight)); exactly 1 at weight 1
  c.kbX = 1 / c.stats.weight; c.kbY = 1 / Math.sqrt(c.stats.weight);
  c.body = def.body || null;
  c.mechanics = { airJumps: 0, wallJump: false, ...(def.mechanics || {}) };
  c.ai = { style: null, range: null, specials: [], ...(def.ai || {}) };
  // own moves: { name: { rig, frame } }. A frame-only entry (no rig) plays another clip through frame.anims.
  const rigs = {}, frames = {};
  for (const [n, m] of Object.entries(def.moves || {})) {
    if (FRAME_DATA[n] && FRAME_DATA[n].owner !== id) throw new Error(`${id}: move '${n}' is already taken`);
    if (m.rig) {
      const h = m.frame && m.frame.height;
      rigs[n] = { ...m.rig, height: m.rig.height || (h === 'overhead' ? 'mid' : h) || 'mid', overhead: m.rig.overhead || h === 'overhead' };
    }
    if (m.frame) frames[n] = m.frame;
  }
  // the celebration dance (a looping clip the match winner plays under the WINS banner, sim.js 'match'):
  // a clip only, no frame data, so nothing can press it
  if (def.dance) { c.dance = `${id}_dance`; rigs[c.dance] = { blend: 180, ...def.dance, loop: true }; }
  // the perfect round finisher (sim.js startPerfect, src/fx/perfect.js): a clip the winner plays over the beaten
  // body. Its 'grab' key picks the body up in `hand`, its 'release' key throws it at the camera; the last key is
  // the pose he holds while it squeaks down the glass. hold: how the body hangs from the hand ('collar', 'ankle',
  // or 'carry', laid across it); fly: the flight's spin (turns), flip (pancake turns), arc (px up) and wobble;
  // (spin and flip are whole turns, so it lands upright); slide: { dx, rate, chute, squeegee, blink } how it goes down the glass; stamp: the word stamped on the glass
  if (def.perfect) {
    const pf = def.perfect;
    c.perfect = { clip: `${id}_perfect`, name: pf.name || 'PERFECT', note: pf.note || '', stamp: pf.stamp || '', hand: pf.hand || 'lHand', hold: pf.hold || 'collar',
      fly: { spin: 1, flip: 0, arc: 60, wobble: 0, ...(pf.fly || {}) }, slide: { dx: 0, rate: 1, ...(pf.slide || {}) } };
    // the turn toward the camera (drawn only, src/fighter/index.js turnNow): the keys' `face`, the step at the lens
    // around the release (`step: { grow, sink }`, or false for none) and `turn: { face, depth }` (a multiplier on
    // every key's face, and the perspective distance in px: smaller foreshortens harder)
    rigs[c.perfect.clip] = { blend: 120, keys: pf.keys, step: pf.step === false ? null : { grow: 0.06, sink: 8, ...(pf.step || {}) }, turn: pf.turn || null };
    const evs = pf.keys.map((k) => k.ev);
    if (!evs.includes('grab') || !evs.includes('release')) console.warn(`[characters] ${id}: perfect needs a 'grab' key and a 'release' key`);
  }
  addMoves(rigs);
  addFrameData(frames, id);
  c.ownMoves = Object.keys(frames);
  // command inputs: { button: '1'..'4' | '1+3' | '2+4', motion: '' | f | b | d | df | db | ff | run | rise | air | airDown, move }
  c.commands = (def.commands || []).map((k) => {
    const cmd = { motion: '', ...k, button: String(k.button) };
    if (!BUTTONS.has(cmd.button)) console.warn(`[characters] ${id}: command button '${cmd.button}' isn't one of 1 2 3 4 1+3 2+4`);
    if (!MOTIONS.has(cmd.motion)) console.warn(`[characters] ${id}: command motion '${cmd.motion}' isn't known`);
    if (!FRAME_DATA[cmd.move]) console.warn(`[characters] ${id}: command move '${cmd.move}' has no frame data`);
    return cmd;
  });
  // the most specific motion first: a dash before a plain forward, down-forward before down
  const rank = { ff: 0, run: 0, rise: 1, df: 1, db: 1, airDown: 1, f: 2, b: 2, d: 2, air: 2, '': 3 };
  c.commands.sort((a, b) => rank[a.motion] - rank[b.motion]);
  const st = buildStrings(def.strings || {});
  c.strings = st.list;
  for (const p of st.problems) console.warn(`[characters] ${id}: ${p}`);
  for (const s of c.strings) for (const m of s.moves) if (!FRAME_DATA[m]) console.warn(`[characters] ${id}: string ${s.name} names '${m}', which has no frame data`);
  // the select screen's list: the unique moves, then the unique strings (the definition may give its own)
  c.moveList = def.moveList || [];
  // how much farther one stride carries this body than the baseline's, so a walk or run cycle plays at
  // the rate that keeps planted feet planted at the character's own speed
  const b = c.body || {};
  c.stride = (b.scale || 1) * ((b.upperLeg || RIG.upperLeg) + (b.lowerLeg || RIG.lowerLeg)) / (RIG.upperLeg + RIG.lowerLeg);
  REG.set(id, c);
  return c;
}

export function getCharacter(id) { return REG.get(id) || null; }
/** the character, or TEMP when it isn't registered (yet) */
export function characterOr(id) { return REG.get(id) || REG.get(TEMP_ID); }
export function temp() { return REG.get(TEMP_ID); }
/** registered characters in select-screen order */
export function roster() {
  const out = ROSTER_ORDER.map((id) => REG.get(id)).filter(Boolean);
  for (const c of REG.values()) if (!out.includes(c)) out.push(c);
  return out;
}
/** may this character press this move? shared moves: everyone; own moves: the owner only */
export function canUse(c, move) {
  const fd = FRAME_DATA[move];
  return !!fd && (!fd.owner || (!!c && fd.owner === c.id));
}
/** a fighter's neon: TEMP keeps the old white (P1) and orange (P2); a mirror match gives P2 the alt color */
export function colorFor(c, slot, other) {
  const own = (x, s) => (!x || x.id === TEMP_ID ? (s === 0 ? '#f0f0f0' : '#E85D00') : x.color);
  if (slot === 0 || !other) return own(c, slot);
  // P2 changes color when P1 looks the same: the same fighter, or two colors close in hue (INTERN's
  // amber next to ACCOUNTANT's yellow read as one color), then its alt, then a contrasting fallback
  const theirs = own(other, 0);
  let mine = own(c, 1);
  if ((c && other.id === c.id && c.id !== TEMP_ID) || clash(mine, theirs)) mine = c && c.id !== TEMP_ID ? c.altColor : '#2ef2ff';
  if (clash(mine, theirs)) mine = clash('#2ef2ff', theirs) ? '#ff2bd6' : '#2ef2ff';
  return mine;
}
// two colors a player can't tell apart at a glance: both near-white, or close in hue and both vivid
function hsl(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: sat, l };
}
function clash(a, b) {
  if (!a || !b) return false;
  const x = hsl(a), y = hsl(b);
  if (x.s < 0.25 && y.s < 0.25) return true;
  if (x.s < 0.25 || y.s < 0.25) return false;
  const dh = Math.min(Math.abs(x.h - y.h), 360 - Math.abs(x.h - y.h));
  return dh < 32;
}

// Pants: a character may set `pants` (and `altPants` for a mirror match) so its legs draw in a second
// color. P2 takes altPants when both players picked the same fighter, or when both pants would read
// as one color; null means legs in the body color.
export function pantsFor(c, slot, other, otherPants = null) {
  if (!c || c.id === TEMP_ID) return null;
  let p = c.pants || null;
  if (slot === 1 && other && ((other.id === c.id) || (p && otherPants && clash(p, otherPants)))) p = c.altPants || p;
  return p;
}
