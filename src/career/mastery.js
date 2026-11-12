// Fighter mastery (README, Progression, Fighter mastery): XP per fighter, earned by playing them, that unlocks that
// fighter's cosmetics. The page and the Worker run this same file, so a guest's own count matches the account's.
//
// Mastery XP is the match's own career XP (src/career/rules.js payout: the base, the win, the floors and the
// technique, after the offline cap), so it pays on technique exactly like the career does and never for raw hits,
// combos or presses. The daily bonuses and shift pay aren't in it: those are about the day, not the fighter. On top
// of that the first NEW_HIRE.matches finished matches with a fighter pay a small NEW HIRE bonus, to get people trying
// the cast. Training and the dummy pay nothing, so they move no mastery either.
//
// Five ranks (RANKS). Each unlocks something for that fighter (UNLOCKS): two of the sold palettes come early (they
// still cost sticks before that), a taunt, a victory pose, and the mastery-only palette (src/career/palettes.js
// MASTERY_PALETTES), which can't be bought. An unlock goes into career.owned the moment the rank is reached, so every
// place that checks what's owned (character select, the closet, the Worker's equip) just works, and the first time a
// pose or a taunt unlocks it's switched on.
//
// The pose and the taunt are clips in the character's own file (registry `victory` and `taunt`); their names are
// here, in plain data, so the Worker can check an owned key without loading a rig. Poses and palettes are flat solid
// color, never a glow. A taunt is never an input: it plays only between rounds, from the round's winner, while the
// next round's ROUND n card is up and nobody can move (src/combat/sim.js startRound), so nothing a mash or a held
// direction does can set one off, and it can't defend anything.
//
//   RANKS, MAX_RANK, NEW_HIRE, UNLOCKS, MASTERY_MERGE_MAX
//   rankFor(xp)                    { rank, floor, next, into, span }: the rank and the bar to the next
//   masteryOf(career, fighter)     { xp, n }: n is finished matches played with them (for NEW HIRE)
//   unlocksFor(fighter)            [{ rank, kind, id, name, key, price? }]: what each rank unlocks, in rank order
//   earlyRank(fighter, paletteId)  the rank that unlocks a sold palette early, or 0
//   masteryItems(fighter)          the catalog's extra items (catalog.js EXTRAS): the pose, the taunt, the mastery palette
//   isOwnable(key)                 a key career.owned may hold: a palette, or a known fighter's pose or taunt
//   payWithMastery(m, career, day) shifts.js payMatch, plus award.mastery: what this match paid the fighter played
//   applyWithMastery(career, award, day)   rules.js applyAward, plus the mastery XP and anything a new rank unlocked
//   grantAll(career)               every unlock the career's ranks have earned, in owned (a merge, a forged state)
//   cleanMastery(raw)              only known fighters, whole numbers
//   mergeMastery(a, b)             the larger of each fighter's XP and matches, a guest's capped at MASTERY_MERGE_MAX
//   kitOn(career, fighter)         { pose, taunt }: whether this fighter plays its pose and taunt
//   kitKey(fighter, kind)          how a pose or taunt being on is stored in career.equip: 'barista:pose'
//
// Plain JavaScript; imports only the other career files, so the Worker (worker/career.ts) uses it as it is.
import { applyAward, utcDay } from './rules.js';
import { payMatch } from './shifts.js';
import { palettesFor, masteryPalette, itemKey, isItem, MASTERY_PALETTE_RANK } from './palettes.js';

/** XP to reach each rank, rank 0 first. A first evening with a new fighter (the NEW HIRE bonus helps) reaches
 *  rank 1; rank 5 is about 80 matches with one fighter (measured: npm run test:mastery). */
export const RANKS = [0, 100, 300, 650, 1200, 2000];
export const MAX_RANK = RANKS.length - 1;
/** the first few finished matches with a fighter pay this much mastery XP on top */
export const NEW_HIRE = { matches: 3, xp: 25, label: 'NEW HIRE' };
/** a guest's mastery merged into an account at sign-in is taken at most this far per fighter (short of rank 5), and
 *  at most `total` across the cast, so a hand-edited localStorage can't unlock everything */
export const MASTERY_MERGE_MAX = { fighter: 1500, total: 9000 };

/**
 * What each rank unlocks, for every fighter. kind 'palette' with tier: that sold palette (PRICES order) unlocks
 * early, without the sticks; 'mastery': the mastery-only palette; 'taunt' and 'pose': the fighter's own.
 * @type {{ rank: number, kind: 'palette' | 'mastery' | 'taunt' | 'pose', tier?: number }[]}
 */
export const UNLOCKS = [
  { rank: 1, kind: 'palette', tier: 0 },
  { rank: 2, kind: 'taunt' },
  { rank: 3, kind: 'palette', tier: 1 },
  { rank: 4, kind: 'pose' },
  { rank: MASTERY_PALETTE_RANK, kind: 'palette', tier: 2 },
  { rank: MASTERY_PALETTE_RANK, kind: 'mastery' },
];

/** fighter -> [victory pose name, taunt name]. The clips are the character file's `victory` and `taunt`. */
export const KIT = {
  temp: ['PERMANENT POSITION', 'CLOCK WATCHER'],
  intern: ['GOLD STAR', 'COFFEE ORDER?'],
  helpdesk: ['TICKET RESOLVED', 'TURN IT OFF AND ON'],
  courier: ['SIGNED, SEALED', 'RUNNING LATE'],
  security: ['ARMS CROSSED', 'NOT ON THE LIST'],
  janitor: ['LEANING ON THE MOP', 'SWEEP IT UP'],
  manager: ['HANDS ON HIPS', 'MY OFFICE. NOW.'],
  accountant: ['BALANCED', 'RUN THE NUMBERS'],
  windowWasher: ['TOP FLOOR VIEW', 'STREAKY'],
  hrRep: ['OPEN DOOR POLICY', "LET'S CIRCLE BACK"],
  salesRep: ['THE CLOSER', 'CALL ME'],
  barista: ['ORDER UP', 'NAME ON THE CUP'],
  chef: ['PLATED', 'TASTE TEST'],
  wellness: ['MOUNTAIN POSE', 'DEEP BREATH'],
  electrician: ['GROUNDED', 'SHAKE IT OFF'],
  receptionist: ['PLEASE HOLD', 'NEXT!'],
  lawyer: ['CASE CLOSED', 'OBJECTION!'],
  ceo: ['BOARDROOM', 'DOWNSIZED'],
};
export const MASTERY_FIGHTERS = Object.keys(KIT);
const isFighter = (/** @type {unknown} */ f) => typeof f === 'string' && Object.hasOwn(KIT, f);

/** @param {unknown} v */
const n0 = (v, cap = 1e9) => Math.max(0, Math.min(cap, Math.floor(Number(v) || 0)));

/** the rank for this much mastery XP, and the bar to the next @param {number} xp */
export function rankFor(xp) {
  const x = n0(xp);
  let rank = 0;
  while (rank < MAX_RANK && x >= RANKS[rank + 1]) rank++;
  const floor = RANKS[rank], next = rank < MAX_RANK ? RANKS[rank + 1] : 0;
  return { rank, floor, next, into: x - floor, span: next ? next - floor : 0 };
}

/** @typedef {Record<string, { xp: number, n: number }>} Mastery */
/** @param {any} career @param {string} fighter @returns {{ xp: number, n: number }} */
export function masteryOf(career, fighter) {
  const m = career && career.mastery && typeof career.mastery === 'object' ? career.mastery[fighter] : null;
  return { xp: n0(m && m.xp), n: n0(m && m.n) };
}
export const rankOf = (/** @type {any} */ career, /** @type {string} */ fighter) => rankFor(masteryOf(career, fighter).xp).rank;

export const kitKey = (/** @type {string} */ fighter, /** @type {'pose' | 'taunt'} */ kind) => `${fighter}:${kind}`;
/** the owned key for a fighter's pose or taunt (one each, so the id is the kind) */
const kitItemKey = (/** @type {string} */ fighter, /** @type {'pose' | 'taunt'} */ kind) => `${fighter}:${kind}:${kind === 'pose' ? 'victory' : 'taunt'}`;

/**
 * What each rank unlocks for a fighter, in rank order. key: what goes into career.owned.
 * @param {string} fighter @returns {{ rank: number, kind: string, id: string, name: string, key: string, price?: number }[]}
 */
export function unlocksFor(fighter) {
  if (!isFighter(fighter)) return [];
  const sold = palettesFor(fighter), mp = masteryPalette(fighter), [pose, taunt] = KIT[/** @type {keyof typeof KIT} */ (fighter)];
  const out = [];
  for (const u of UNLOCKS) {
    if (u.kind === 'palette') { const p = sold[u.tier ?? 0]; if (p) out.push({ rank: u.rank, kind: 'palette', id: p.id, name: p.name, key: itemKey(fighter, p.id), price: p.price }); }
    else if (u.kind === 'mastery') { if (mp) out.push({ rank: u.rank, kind: 'palette', id: mp.id, name: mp.name, key: itemKey(fighter, mp.id) }); }
    else if (u.kind === 'pose') out.push({ rank: u.rank, kind: 'pose', id: 'victory', name: pose, key: kitItemKey(fighter, 'pose') });
    else out.push({ rank: u.rank, kind: 'taunt', id: 'taunt', name: taunt, key: kitItemKey(fighter, 'taunt') });
  }
  return out;
}
/** the rank that unlocks a sold palette early (0: none) @param {string} fighter @param {string} id */
export function earlyRank(fighter, id) {
  const u = unlocksFor(fighter).find((x) => x.kind === 'palette' && x.id === id && x.price);
  return u ? u.rank : 0;
}
/** the catalog's extra items for a fighter (src/career/catalog.js): the mastery palette, the pose, the taunt */
export function masteryItems(fighter) {
  const mp = masteryPalette(fighter);
  return unlocksFor(fighter).filter((u) => !u.price).map((u) => ({
    fighter, kind: u.kind, id: u.id, name: u.name, mastery: u.rank,
    ...(u.kind === 'palette' && mp ? { look: { body: mp.body, pants: mp.pants, accent: mp.accent } } : {}),
  }));
}

/** a key career.owned may hold: a palette, or a known fighter's pose or taunt @param {unknown} key */
export function isOwnable(key) {
  if (isItem(key)) return true;
  if (typeof key !== 'string') return false;
  const [f, kind, id] = key.split(':');
  return isFighter(f) && ((kind === 'pose' && id === 'victory') || (kind === 'taunt' && id === 'taunt'));
}

/** only known fighters, whole numbers @param {unknown} raw @returns {Mastery} */
export function cleanMastery(raw) {
  /** @type {Mastery} */
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [f, v] of Object.entries(/** @type {Record<string, any>} */ (raw))) {
    if (!isFighter(f) || !v || typeof v !== 'object') continue;
    const xp = n0(v.xp, 1e7), n = n0(v.n, 1e6);
    if (xp || n) out[f] = { xp, n };
  }
  return out;
}

/**
 * The larger of each fighter's XP and matches (never the sum, so signing in twice adds nothing). b is the guest's:
 * each fighter's taken at most to MASTERY_MERGE_MAX.fighter, and the guest's XP across the cast to .total.
 * @param {unknown} a @param {unknown} b @returns {Mastery}
 */
export function mergeMastery(a, b) {
  const out = cleanMastery(a), g = cleanMastery(b);
  let room = MASTERY_MERGE_MAX.total;
  for (const f of MASTERY_FIGHTERS) {
    if (!g[f]) continue;
    const xp = Math.min(g[f].xp, MASTERY_MERGE_MAX.fighter, room);
    room -= xp;
    const cur = out[f] || { xp: 0, n: 0 };
    out[f] = { xp: Math.max(cur.xp, xp), n: Math.max(cur.n, g[f].n) };
  }
  return out;
}

/**
 * What a match paid the fighter played: null when it paid nothing, or the fighter isn't known.
 * @param {any} m the match (rules.js payout's m, with `fighter`) @param {import('./rules.js').Award} award @param {any} career
 */
export function masteryFor(m, award, career) {
  if (!m || !award || !award.lines.length || !isFighter(m.fighter)) return null;
  const f = m.fighter, cur = masteryOf(career, f);
  const xp = n0(award.match && award.match.xp);
  const hire = !m.cut && cur.n < NEW_HIRE.matches ? NEW_HIRE.xp : 0;
  const total = xp + hire;
  const before = rankFor(cur.xp).rank, after = rankFor(cur.xp + total).rank;
  const unlocked = unlocksFor(f).filter((u) => u.rank > before && u.rank <= after).map((u) => ({ kind: u.kind, id: u.id, name: u.name }));
  return { fighter: f, xp, hire, total, n: cur.n + (m.cut ? 0 : 1), was: cur.xp, now: cur.xp + total, before, after, unlocked };
}

/** payMatch (rules.js payout plus the daily shifts), plus what it paid the fighter played as award.mastery
 *  @param {any} m @param {any} career @param {string} [day] */
export function payWithMastery(m, career, day = utcDay()) {
  const award = /** @type {import('./rules.js').Award & { mastery?: ReturnType<typeof masteryFor> }} */ (payMatch(m, career, day));
  const mm = masteryFor(m, award, career);
  if (mm) award.mastery = mm;
  return award;
}

/** every unlock a fighter's rank has earned, added to owned; a pose or taunt that's new to owned is switched on
 *  @param {any} c a career (changed in place) @param {string} fighter @param {number} rank */
function grant(c, fighter, rank) {
  for (const u of unlocksFor(fighter)) {
    if (u.rank > rank || c.owned.includes(u.key)) continue;
    c.owned = [...c.owned, u.key];
    if (u.kind === 'pose' || u.kind === 'taunt') c.equip = { ...c.equip, [kitKey(fighter, /** @type {'pose' | 'taunt'} */ (u.kind))]: u.id };
  }
}

/** applyAward, plus the mastery XP and whatever a new rank unlocked (a new object)
 *  @param {any} career @param {any} award @param {string} [day] */
export function applyWithMastery(career, award, day = utcDay()) {
  const c = /** @type {any} */ (applyAward(career, award, day));
  c.mastery = cleanMastery(c.mastery);
  c.owned = Array.isArray(c.owned) ? c.owned : [];
  c.equip = c.equip && typeof c.equip === 'object' ? c.equip : {};
  const mm = award && award.mastery;
  if (mm && isFighter(mm.fighter)) {
    const cur = masteryOf(c, mm.fighter);
    c.mastery = { ...c.mastery, [mm.fighter]: { xp: cur.xp + n0(mm.total, 1e4), n: Math.max(cur.n, n0(mm.n)) } };
    grant(c, mm.fighter, rankOf(c, mm.fighter));
  }
  return c;
}

/** every unlock the career's ranks have earned, in owned (a new object) @param {any} career */
export function grantAll(career) {
  const c = { ...career, owned: Array.isArray(career && career.owned) ? career.owned : [], equip: { ...((career && career.equip) || {}) }, mastery: cleanMastery(career && career.mastery) };
  for (const f of Object.keys(c.mastery)) grant(c, f, rankOf(c, f));
  return c;
}

/** whether this fighter plays its pose and taunt: owned and switched on @param {any} career @param {string} fighter */
export function kitOn(career, fighter) {
  const owned = (career && Array.isArray(career.owned) ? career.owned : []), eq = (career && career.equip) || {};
  return {
    pose: owned.includes(kitItemKey(fighter, 'pose')) && eq[kitKey(fighter, 'pose')] === 'victory',
    taunt: owned.includes(kitItemKey(fighter, 'taunt')) && eq[kitKey(fighter, 'taunt')] === 'taunt',
  };
}
/** the owned key for a fighter's pose or taunt */
export { kitItemKey };
