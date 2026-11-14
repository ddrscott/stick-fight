// What a player presses, in the game's own notation, read from the same tables the sim plays: the shared
// button table, the character files (src/characters/) and the string table (strings.js). DOM-free, so the
// game's MOVE LIST (src/flow/movelist.js) and the site's fighter pages (site/data.mjs, in Node) share it and
// can't drift apart. Nothing per character is written here.
//
// Glyphs are the HUD's: → toward the opponent, ← away, ↓ down, then the button number (1 2 3 4).

import { FRAME_DATA, COMBO_DMG, COMBO_SOFTCAP, COMBO_OVERCAP, comboScale } from './frameData.js';
import { STRINGS } from './strings.js';
import { MOVE_DATA } from '../fighter/index.js';
import { SLOTS, moveInfo } from '../career/moves.js';

// The shared button table, as resolveButton() in src/combat/sim.js reads a press, plus the stomp (resolvePress)
// and the wake-up strikes (wakeFor) (keep them together).
export const SHARED_INPUTS = [
  { button: '1', motion: '', move: 'jab', name: 'JAB' },
  { button: '2', motion: '', move: 'cross', name: 'CROSS' },
  { button: '3', motion: '', move: 'lkick', name: 'SNAP KICK' },
  { button: '4', motion: '', move: 'roundhouse', name: 'ROUNDHOUSE' },
  { button: '1', motion: 'f', move: 'bodyBlow', name: 'BODY BLOW' },
  { button: '2', motion: 'f', move: 'lungeCross', name: 'LUNGE CROSS' },
  { button: '1', motion: 'ff', move: 'bulletJab', name: 'BULLET JAB', note: 'out of a dash or a run; the fast way in, bounced out and punished if blocked' },
  { button: '2', motion: 'ff', move: 'cometCross', name: 'COMET CROSS', note: 'out of a dash or a run' },
  { button: '3', motion: 'ff', move: 'skidKick', name: 'SKID KICK', note: 'out of a dash or a run; blocked low it has no blockstun at all' },
  { button: '4', motion: 'ff', move: 'runningBoot', name: 'RUNNING BOOT', note: 'out of a dash or a run; slow out and very slow back' },
  { button: '4', motion: 'f', move: 'overhead', name: 'OVERHEAD KICK' },
  { button: '4', motion: 'b', move: 'spinKick', name: 'SPIN KICK', note: 'near a wall: Wall Spin' },
  { button: '1', motion: 'd', move: 'lowJab', name: 'LOW JAB' },
  { button: '2', motion: 'd', move: 'uppercut', name: 'UPPERCUT' },
  { button: '3', motion: 'd', move: 'lowKick', name: 'LOW KICK' },
  { button: '4', motion: 'd', move: 'sweep', name: 'SWEEP' },
  { button: '1', motion: 'rise', move: 'risingJab', name: 'RISING JAB', note: 'the quick one out of a crouch, and a mid' },
  { button: '2', motion: 'rise', move: 'risingUppercut', name: 'RISING UPPERCUT' },
  { button: '3', motion: 'rise', move: 'risingKick', name: 'RISING KICK', note: 'the second hit of ↓1, release ↓, 3' },
  { button: '4', motion: 'rise', move: 'risingKnee', name: 'RISING KNEE' },
  { button: '1+3', motion: '', move: 'throw', name: 'THROW', note: 'or 2+4; near a wall: Wall Slam. With ↓ held they\'re the move slots (CUSTOM EMPLOYEE): an empty slot is still the throw' },
  { button: '1', motion: 'air', move: 'jumpJab', name: 'JUMP JAB' },
  { button: '2', motion: 'air', move: 'jumpCross', name: 'JUMP CROSS' },
  { button: '3', motion: 'air', move: 'flyingKick', name: 'FLYING KICK' },
  { button: '4', motion: 'air', move: 'airRoundhouse', name: 'AIR ROUNDHOUSE' },
  { button: '4', motion: 'airDown', move: 'diveKick', name: 'DIVE KICK' },
  // not in resolveButton: the stomp is resolvePress (stompOK), the wake-up strikes wakeFor. `fix` blanks what the
  // standing measurement gets wrong: nobody blocks a stomp, and a wake-up strike springs from the floor (on block
  // is getup-test's measurement, in the note)
  { button: '4', motion: 'over', move: 'stomp', name: 'STOMP', note: 'the other fighter on the floor in front of you; ↓3 there is the low kick', fix: { onBlock: null } },
  { button: '1', motion: 'floor', move: 'wakeKick', name: 'WAKE KICK', note: 'or 3, while knocked down; can\'t be hit until it swings; 17 to 24 frames minus on block', fix: { onBlock: null, reach: null } },
  { button: '2', motion: 'floor', move: 'wakeSweep', name: 'WAKE SWEEP', note: 'or 4, or ↓ and any button, while knocked down; can\'t be hit until it swings; 17 to 24 frames minus on block', fix: { onBlock: null, reach: null } },
];

// The techniques with no button of their own (README Controls and Fundamentals; the CONTROLS screen says the
// same). The MOVE LIST's System section, plus a row per mechanic a character has (double jump, wall jump).
export const SYSTEM = [
  { name: 'WALK', input: '← →', note: 'away from the other fighter steps back' },
  { name: 'GUARD', input: '← hold', note: 'snaps up when a strike is coming; stops highs and mids, not lows or throws' },
  { name: 'LOW GUARD', input: '↙ hold', note: 'stops lows; mids and air attacks hit it' },
  { name: 'CROUCH', input: '↓', note: 'ducks highs and throws; mids still hit' },
  { name: 'PARRY', input: '→ tap', note: 'just before a strike lands (↘ for a low): it reels and you punish. A hold or a mash never parries' },
  { name: 'JUMP', input: '↑', note: '↖ or ↗ to jump back or forward; air attacks hit a croucher' },
  { name: 'DASH', input: '→→', note: 'tap, tap: a quick burst forward, then a short recovery with no guard; any button in it is that button\'s dash attack. Costs 6 stamina' },
  { name: 'BACK DASH', input: '←←', note: 'tap, tap: a hop back out of a jab\'s reach. No guard and no attack until it\'s over, so a long strike catches it. Costs 8 stamina' },
  { name: 'RUN', input: '→→ hold', note: 'hold the dash\'s second tap, or Shift / R2; running costs stamina' },
  { name: 'THROW BREAK', input: '1+3', note: 'or 2+4, the moment you\'re grabbed' },
  { name: 'GET UP', input: '↑ on the floor', note: 'leave it and you stand by yourself after a second' },
  { name: 'ROLL', input: '← or → on the floor', note: 'away stays on your side; toward him standing near rolls under him to his other side' },
  { name: 'GROUND HIT', input: 'a low on a body on the floor', note: 'one per knockdown, about half damage, if it visibly touches; after that it only grazes' },
  { name: 'AIR RECOVERY', input: 'any button, juggled', note: 'a beat after the last hit lands you on your feet; too early locks it out, so mashing never works' },
];

// ---- notation ----------------------------------------------------------------------------------------------
export function inputFor(button, motion) {
  if (motion === 'air') return `${button} in air`;
  if (motion === 'airDown') return `↓${button} in air`;
  if (motion === 'rise') return `release ↓, ${button}`;
  if (motion === 'over') return `↓${button} over them`;
  if (motion === 'floor') return `${button} on the floor`;
  if (motion === 'd') return `↓${button}`;
  const g = { f: '→', b: '←', df: '↘', db: '↙', ff: '→→', run: '→→' }[motion];
  return g ? `${g} ${button}` : button;
}
// 'd3' is ↓3; 'r3' is 3 pressed while rising (↓ let go just before it)
export const tokenGlyph = (t) => (t[0] === 'd' ? '↓' + t.slice(1) : t[0] === 'r' ? 'release ↓ ' + t.slice(1) : t);
export const keysGlyph = (keys) => keys.map(tokenGlyph).join(', ');
/** a move list's written input in the HUD's arrows (f+ → b+ ← d+ ↓, an arrow hugs its button) */
export const glyphs = (s) => String(s).replace(/\bf\+/g, '→').replace(/\bb\+/g, '←').replace(/\bd\+/g, '↓').replace(/([←→↓↑↖↗↘↙]) (?=\d)/g, '$1');
export const norm = (s) => String(s || '').replace(/\(.*?\)/g, '').replace(/\s+/g, '').toLowerCase();
export const humanize = (m) => m.replace(/^[a-z]+_/, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2').toUpperCase();

// the clip a move plays: its own, else the first of its `anims` the rig has (createCombat does the same)
export function animOf(move) {
  const fd = FRAME_DATA[move];
  if (!fd) return null;
  return [move, ...(fd.anims || []), ...(fd.anim ? [fd.anim] : [])].find((n) => MOVE_DATA[n]) || null;
}

export function heightOf(fd) {
  if (fd.throw) return 'throw';
  if (fd.overhead || fd.air) return 'overhead';
  return fd.height || 'mid';
}
// a move that never strikes on its own: a stance, a counter stance, a step out
export const quiet = (fd) => !!(fd.noHit || fd.stance || fd.parry || fd.throwCounter);

/** what a string's ender (or any move) leaves you with: launch, knockdown, wall splat... */
export function payoffOf(fd) {
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

// combo damage, as the sim scales it (README, Combo decay)
export function comboDamage(moves, c) {
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

// ---- a character's own moves --------------------------------------------------------------------------------
// moveList entry for a move: by name (its callout or a string it ends) or by the input that presses it
export function listEntry(c, names, inputs) {
  const ns = names.filter(Boolean).map(norm), is = inputs.filter(Boolean).map(norm);
  return (c.moveList || []).find((e) => ns.includes(norm(e.name))) || (c.moveList || []).find((e) => is.includes(norm(e.input))) || null;
}
export function nameOf(c, m) {
  const fd = FRAME_DATA[m];
  const ender = c.strings.find((s) => s.moves[s.moves.length - 1] === m && s.moves.some((x) => FRAME_DATA[x] && FRAME_DATA[x].owner === c.id));
  return (fd && fd.callout) || (ender && ender.name) || humanize(m);
}
const ordinal = (n) => ['first', 'second', 'third', 'fourth', 'fifth'][n - 1] || `#${n}`;
const dedupe = (a) => a.filter((x, i) => a.findIndex((y) => y.input === x.input && y.how === x.how) === i);

/** every way to press one of the character's own moves; seq is the clips a preview plays for that way in */
export function inputsOf(c, m) {
  const out = [];
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

// ---- the in-game MOVE LIST ----------------------------------------------------------------------------------
const hasClip = (n) => !!(n && MOVE_DATA[n]);
const clean = (seq) => seq.filter(hasClip);

// the clips a written move list entry plays: a string by name or input, an own move by name, a command or a
// shared button by its input
function clipsFor(c, name, input) {
  const n = norm(name), i = norm(glyphs(input));
  const s = c.strings.find((x) => norm(x.name) === n) || c.strings.find((x) => norm(keysGlyph(x.keys)) === i);
  if (s) return clean(s.moves.map(animOf));
  const own = c.ownMoves.find((m) => norm(FRAME_DATA[m].callout) === n || norm(nameOf(c, m)) === n);
  if (own) { const w = inputsOf(c, own)[0]; return clean(w ? w.seq : [animOf(own)]); }
  const k = c.commands.find((x) => norm(inputFor(x.button, x.motion)) === i);
  if (k) return clean([animOf(k.move)]);
  const b = SHARED_INPUTS.find((x) => norm(x.name) === n) || SHARED_INPUTS.find((x) => norm(inputFor(x.button, x.motion)) === i);
  return b ? clean([animOf(b.move)]) : [];
}

/**
 * The custom employee's two slots (README, Characters, Custom employee) as move list rows: the borrowed move's name
 * on ↓ 1+3 / ↓ 2+4 with whose it was, or EMPTY. The preview plays it on this character's own rig and colors.
 * owner(id) names a fighter (the registry's, passed in so this stays free of it).
 */
export function slotRows(c, loadout = [], owner = (id) => String(id).toUpperCase()) {
  return SLOTS.map((s, i) => {
    const id = loadout[i], m = moveInfo(id), fd = m && FRAME_DATA[id];
    if (!m || !fd || m.fighter === c.id) return { name: `SLOT ${s.key}: EMPTY`, input: s.input, note: `nothing slotted: ${s.input} is the throw. Buy and slot a move in the SUPPLY CLOSET`, tags: ['empty'], seq: [], slot: s.n, empty: true };
    return { name: m.name, input: s.input, note: `slot ${s.key}, borrowed from ${owner(m.fighter)}: ${m.note}`, tags: ['borrowed', ...(quiet(fd) ? [] : [heightOf(fd)])], seq: clean([animOf(id)]), slot: s.n, move: id };
  });
}

/**
 * One character's command list, grouped like a fighting game's: its own moves (the file's moveList first, then
 * any own move the list doesn't name), every string it keeps, the shared buttons, and the system techniques.
 * Rows: { name, input, note, tags: string[], seq: clips for a preview, off?: replaced by a command }.
 * loadout: the custom employee's two slots ([] for none), as `slots` rows.
 */
export function moveListOf(c, loadout = [], owner = undefined) {
  const unique = (c.moveList || []).map((e) => ({ name: e.name, input: glyphs(e.input), note: e.note || '', tags: [], seq: clipsFor(c, e.name, e.input) }));
  // an own move the written list doesn't cover, pressed some way other than a string (the strings have their own section)
  for (const m of c.ownMoves) {
    const fd = FRAME_DATA[m];
    if (fd.botch) continue;
    const ways = inputsOf(c, m).filter((w) => !/ hit of |^ends /.test(w.how));
    if (!ways.length) continue;
    if (listEntry(c, [fd.callout, nameOf(c, m)], ways.map((w) => w.input))) continue;
    const w = ways[0];
    const tags = quiet(fd) ? [] : [heightOf(fd)];
    const pay = payoffOf(fd);
    unique.push({ name: nameOf(c, m), input: glyphs(w.input), note: [w.how, pay].filter(Boolean).join(', '), tags, seq: clean(w.seq) });
  }

  const own = (s) => s.moves.some((m) => FRAME_DATA[m] && FRAME_DATA[m].owner === c.id);
  const strings = c.strings.map((s) => {
    const ender = FRAME_DATA[s.moves[s.moves.length - 1]];
    return {
      name: s.name, input: keysGlyph(s.keys),
      note: `${s.moves.length} hits, about ${comboDamage(s.moves, c)} damage`,
      tags: [...(own(s) ? ['unique'] : []), ...(payoffOf(ender) ? payoffOf(ender).split(', ') : [])],
      seq: clean(s.moves.map(animOf)),
    };
  }).sort((a, b) => (b.tags[0] === 'unique') - (a.tags[0] === 'unique'));

  const basics = SHARED_INPUTS.map((x) => {
    const fd = FRAME_DATA[x.move];
    const over = c.commands.find((k) => k.button === x.button && k.motion === x.motion);
    const pay = fd ? payoffOf(fd).split(', ').filter((p) => p && p !== 'overhead' && p !== 'low') : [];
    return {
      name: x.name, input: glyphs(inputFor(x.button, x.motion)), note: over ? `${nameOf(c, over.move)} takes this input` : (x.note || ''),
      tags: fd ? [heightOf(fd), ...pay] : [], seq: over ? [] : clean([animOf(x.move)]), off: !!over,
    };
  });

  const system = SYSTEM.map((x) => ({ ...x, tags: [], seq: [] }));
  if (c.mechanics.airJumps) system.push({ name: 'DOUBLE JUMP', input: '↑ in air', note: `${c.mechanics.airJumps === 1 ? 'one more jump' : `${c.mechanics.airJumps} more jumps`} in the air, and each gives back the air attack`, tags: [], seq: [] });
  if (c.mechanics.wallJump) system.push({ name: 'WALL JUMP', input: '↑ near a wall', note: 'kicks off the wall, away and over anyone standing there; twice a jump', tags: [], seq: [] });

  // shared strings this character doesn't keep
  const dropped = STRINGS.filter((s) => !c.strings.some((x) => x.name === s.name)).map((s) => s.name);
  return { unique, slots: slotRows(c, loadout, owner), strings, basics, system, dropped };
}
