// The collection (README, Progression, The Supply Closet): every cosmetic a fighter has, how each one is unlocked,
// and how much of it this player has. The SUPPLY CLOSET screen (src/flow/closet.js) draws it; the counts are here so
// a test can check them without a page.
//
// An item is unlocked one of two ways, both fixed and shown up front, never random:
//   price     sticks, bought with a confirm (store.js buy; the Worker checks the price, worker/career.ts)
//   mastery   that fighter's mastery rank (fighter mastery, [t6vhcb], when it lands); an item with both is bought
//             with sticks or unlocked early by the rank, whichever comes first
// The fighter's own look (MAIN) is always owned and isn't counted: it's in the list so the screen can equip it.
//
// Today the closet holds the palettes (src/career/palettes.js). Victory poses, taunts, name plates and crew banners
// get a KINDS entry already; whoever adds them puts their items in EXTRAS (or builds them from their own file, the
// way palettes are) and they show up on the screen, in the counts and in the tests with no other change. A priced
// item that isn't a palette also needs the Worker's buy to know it (worker/career.ts, POST career/buy).
//
// Plain JavaScript; imports only palettes.js, so the Worker can use it too.
//
//   KINDS                          the shelves, in order: { kind, label }
//   EXTRAS                         items beyond the palettes: { fighter, kind, id, name, price?, mastery? }
//   itemsFor(fighter, extras)      every item for a fighter, MAIN first, then by KINDS order, cheapest first
//   unlockText(item, fighterName)  '150 STICKS', 'BARISTA MASTERY 3', '300 STICKS OR BARISTA MASTERY 2'
//   stateOf(item, career, rank)    'main' | 'owned' | 'buy' | 'short' | 'rank'
//   completion(career, fighters, { ranks, extras })   { have, total, per: { [fighter]: { have, total } } }
import { palettesFor, itemKey } from './palettes.js';

/** @typedef {{ kind: string, label: string }} Kind */
/** @type {Kind[]} */
export const KINDS = [
  { kind: 'palette', label: 'PALETTES' },
  { kind: 'pose', label: 'VICTORY POSES' },
  { kind: 'taunt', label: 'TAUNTS' },
  { kind: 'plate', label: 'NAME PLATES' },
  { kind: 'banner', label: 'CREW BANNERS' },
];

/**
 * @typedef {{ fighter: string, kind: string, id: string, name: string, key: string, price?: number, mastery?: number,
 *             main?: boolean, look?: { body: string, pants: string, accent: string } }} Item
 */
/** items beyond the palettes (fighter mastery adds its poses, taunts and mastery-only palettes here) @type {Omit<Item, 'key'>[]} */
export const EXTRAS = [];

const ORDER = Object.fromEntries(KINDS.map((k, i) => [k.kind, i]));

/** every item for a fighter: MAIN, then the shelves in KINDS order, each cheapest (then lowest rank) first
 *  @param {string} fighter @param {Omit<Item, 'key'>[]} [extras] @returns {Item[]} */
export function itemsFor(fighter, extras = EXTRAS) {
  /** @type {Item[]} */
  const out = [{ fighter, kind: 'palette', id: '', name: 'MAIN', key: '', main: true }];
  for (const p of palettesFor(fighter)) out.push({ fighter, kind: 'palette', id: p.id, name: p.name, key: itemKey(fighter, p.id), price: p.price, look: { body: p.body, pants: p.pants, accent: p.accent } });
  const more = extras.filter((x) => x.fighter === fighter && x.kind in ORDER)
    .map((x) => ({ ...x, key: x.kind === 'palette' ? itemKey(fighter, x.id) : `${fighter}:${x.kind}:${x.id}` }));
  const rest = [...out.slice(1), ...more].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]
    || (a.price ?? Infinity) - (b.price ?? Infinity) || (a.mastery ?? 0) - (b.mastery ?? 0));
  return [out[0], ...rest];
}

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
/** how to get it, in the words the screen shows @param {Item} item @param {string} fighterName */
export function unlockText(item, fighterName) {
  const parts = [];
  if (item.price) parts.push(`${fmt(item.price)} STICKS`);
  if (item.mastery) parts.push(`${fighterName} MASTERY ${item.mastery}`);
  return parts.join(' OR ');
}

/** owned outright, or unlocked by the fighter's rank @param {Item} item @param {any} career @param {number} rank */
export function isOwned(item, career, rank = 0) {
  if (item.main) return true;
  if (career && Array.isArray(career.owned) && career.owned.includes(item.key)) return true;
  return !!item.mastery && rank >= item.mastery;
}

/**
 * Where this player stands with an item:
 *   main    the fighter's own look (always theirs)
 *   owned   bought, or unlocked by mastery
 *   buy     priced, and they have the sticks
 *   short   priced, and they don't have the sticks yet
 *   rank    unlocked by mastery only, and the rank isn't there yet
 * @param {Item} item @param {any} career @param {number} [rank]
 */
export function stateOf(item, career, rank = 0) {
  if (item.main) return 'main';
  if (isOwned(item, career, rank)) return 'owned';
  if (item.price) return (Number(career && career.sticks) || 0) >= item.price ? 'buy' : 'short';
  return 'rank';
}

/**
 * How much of the closet this player has: per fighter and overall. MAIN isn't counted.
 * @param {any} career @param {string[]} fighters
 * @param {{ ranks?: Record<string, number>, extras?: Omit<Item, 'key'>[] }} [opts]
 */
export function completion(career, fighters, opts = {}) {
  const ranks = opts.ranks || {}, extras = opts.extras || EXTRAS;
  /** @type {Record<string, { have: number, total: number }>} */
  const per = {};
  let have = 0, total = 0;
  for (const f of fighters) {
    const list = itemsFor(f, extras).filter((it) => !it.main);
    const h = list.filter((it) => isOwned(it, career, ranks[f] || 0)).length;
    per[f] = { have: h, total: list.length };
    have += h; total += list.length;
  }
  return { have, total, per };
}
