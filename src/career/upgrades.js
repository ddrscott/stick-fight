// Stat upgrades (README, Progression, Stat upgrades): sticks buy a fighter a little more of four stats, in three
// tiers each, at fixed prices shown up front. Nothing random, never for money, and modest on purpose: a fighter
// with every tier is about a tenth stronger, never unbeatable.
//
// Where they apply: arcade, horde and training, automatically (the flow hands the scene the player's boost,
// src/flow/index.js). Never against a human, unless the host's room rule says EVEN, and then both fighters play
// every stat at its top tier whatever either player owns (FULL), so it stays fair (src/net/online.js cleanRules).
//
// A tier is an owned key like a palette ('barista:up:health:2', in career.owned), bought in order: tier 2 needs
// tier 1. The page's buy and the Worker's (worker/career.ts POST career/buy with `upgrade`) check the same rules.
//
// Plain JavaScript, no imports, so the Worker and the sim's tests use it as it is.
//
//   STATS                       [{ id, name, what, pct: [tier 1, 2, 3] }]: the percent each tier adds
//   PRICES                      sticks for tier 1, 2, 3 (every stat the same)
//   MAX_TIER                    3
//   upKey(fighter, stat, tier)  'barista:up:health:2'
//   isUpgradeKey(key)           a well-formed key for a known stat and tier (the fighter is checked by the caller)
//   levelsOf(owned, fighter)    { health, power, stamina, speed }: the tier owned of each, 0 to 3, in order
//   nextTier(owned, f, stat)    { tier, price } for the next one, or null when it's maxed
//   canBuy(owned, f, stat, tier)   'ok' | 'owned' | 'order' | 'unknown'
//   boostFor(levels)            { hp, dmg, regen, walk }: the multipliers the sim reads (src/combat/sim.js setCharacter)
//   FULL                        every stat at its top tier (the EVEN room rule)
//   upgraded(levels)            any tier at all (an arcade or horde score set with it is marked UP)
//   tiersOwned(levels)          how many of the 12 tiers

/** @typedef {'health' | 'power' | 'stamina' | 'speed'} StatId */
/** @type {{ id: StatId, name: string, what: string, pct: number[] }[]} */
export const STATS = [
  { id: 'health', name: 'HEALTH', what: 'MORE HEALTH', pct: [4, 8, 12] },
  { id: 'power', name: 'POWER', what: 'EVERY HIT DOES MORE', pct: [4, 8, 12] },
  { id: 'stamina', name: 'STAMINA', what: 'STAMINA COMES BACK FASTER', pct: [5, 10, 15] },
  { id: 'speed', name: 'FOOTWORK', what: 'WALK AND RUN FASTER', pct: [3, 6, 10] },
];
export const STAT_IDS = STATS.map((s) => s.id);
/** sticks per tier, the same for every stat: a fighter's whole set is 4 x 850 = 3,400 */
export const PRICES = [100, 250, 500];
export const MAX_TIER = PRICES.length;

export const upKey = (/** @type {string} */ fighter, /** @type {string} */ stat, /** @type {number} */ tier) => `${fighter}:up:${stat}:${tier}`;

/** a key shaped like an upgrade tier: 'fighter:up:<stat>:<1..3>' @param {unknown} key */
export function isUpgradeKey(key) {
  if (typeof key !== 'string') return false;
  const p = key.split(':');
  return p.length === 4 && p[1] === 'up' && STAT_IDS.includes(/** @type {StatId} */ (p[2])) && /^[1-9]$/.test(p[3]) && Number(p[3]) <= MAX_TIER;
}

/** the tier owned of one stat: tiers count only in order (2 without 1 is 0) @param {unknown} owned @param {string} fighter @param {string} stat */
export function levelOf(owned, fighter, stat) {
  const o = Array.isArray(owned) ? owned : [];
  let t = 0;
  while (t < MAX_TIER && o.includes(upKey(fighter, stat, t + 1))) t++;
  return t;
}
/** @param {unknown} owned @param {string} fighter @returns {Record<StatId, number>} */
export function levelsOf(owned, fighter) {
  return /** @type {Record<StatId, number>} */ (Object.fromEntries(STAT_IDS.map((s) => [s, levelOf(owned, fighter, s)])));
}

/** the next tier of a stat and its price, or null when it's at the top @param {unknown} owned @param {string} fighter @param {string} stat */
export function nextTier(owned, fighter, stat) {
  if (!STAT_IDS.includes(/** @type {StatId} */ (stat))) return null;
  const t = levelOf(owned, fighter, stat);
  return t >= MAX_TIER ? null : { tier: t + 1, price: PRICES[t] };
}

/** whether this tier can be bought now (sticks aside): 'ok', 'owned', 'order' (the tier before isn't owned), 'unknown'
 *  @param {unknown} owned @param {string} fighter @param {string} stat @param {number} tier */
export function canBuy(owned, fighter, stat, tier) {
  if (!STAT_IDS.includes(/** @type {StatId} */ (stat)) || !Number.isInteger(tier) || tier < 1 || tier > MAX_TIER) return 'unknown';
  const t = levelOf(owned, fighter, stat);
  if (tier <= t) return 'owned';
  return tier === t + 1 ? 'ok' : 'order';
}

/** the percent a stat adds at a tier @param {string} stat @param {number} tier */
export function pctOf(stat, tier) {
  const s = STATS.find((x) => x.id === stat);
  return s && tier > 0 ? s.pct[Math.min(tier, MAX_TIER) - 1] : 0;
}

/** every stat at its top tier: the EVEN room rule */
export const FULL = /** @type {Record<StatId, number>} */ (Object.fromEntries(STAT_IDS.map((s) => [s, MAX_TIER])));

/**
 * The multipliers the sim reads (src/combat/sim.js setCharacter `boost`): hp on max health, dmg on every hit's damage,
 * regen on stamina regen, walk on walking and running speed. null when there's nothing, so an unupgraded fighter is
 * exactly the fighter it always was.
 * @param {Partial<Record<StatId, number>> | null | undefined} levels
 */
export function boostFor(levels) {
  if (!levels || !upgraded(levels)) return null;
  const k = (/** @type {StatId} */ s) => 1 + pctOf(s, Math.max(0, Math.min(MAX_TIER, Math.floor(Number(levels[s]) || 0)))) / 100;
  return { hp: k('health'), dmg: k('power'), regen: k('stamina'), walk: k('speed') };
}

/** any tier at all @param {Partial<Record<StatId, number>> | null | undefined} levels */
export function upgraded(levels) { return !!levels && STAT_IDS.some((s) => (Number(levels[s]) || 0) > 0); }
/** how many tiers of the 12 @param {Partial<Record<StatId, number>> | null | undefined} levels */
export function tiersOwned(levels) { return levels ? STAT_IDS.reduce((n, s) => n + Math.max(0, Math.min(MAX_TIER, Number(levels[s]) || 0)), 0) : 0; }
