// Palettes (README, Progression, What sticks buy): three extra looks for each fighter, bought with sticks at
// fixed prices, picked at character select. Flat solid colors only (body, pants, accent, like a character's own
// color, pants and accent in src/characters/): no gradients, no glow of their own, nothing that changes stats or
// play. MAIN is the fighter's own look and is always owned. Online the other player sees yours (the pick and
// start messages carry it, src/net/online.js); P2's color-clash rule (colorFor in src/characters/registry.js)
// still applies on top, so two fighters never read as one color.
//
// Plain JavaScript and no imports: the Worker checks a purchase against this same list (worker/career.ts).
//
//   PRICES                 what each tier costs, in sticks (the first extra palette is in reach on day one)
//   palettesFor(fighter)   [{ id, name, body, pants, accent, price }], the extras only, cheapest first
//   palette(fighter, id)   one of them, or null
//   itemKey(fighter, id)   how an owned palette is stored: 'courier:nightShift'

/** sticks per palette, by its place in the fighter's list */
export const PRICES = [150, 300, 600];

// [id, name, body, pants, accent]: the names are office jokes; the colors keep away from the fighter's own
/** @type {Record<string, string[][]>} */
const RAW = {
  temp: [['casualFriday', 'CASUAL FRIDAY', '#7dd3ff', '#3d5afe', '#ffe066'], ['nightShift', 'NIGHT SHIFT', '#9b8cff', '#2a2f5a', '#5effc0'], ['corporate', 'CORPORATE', '#c0c6d4', '#30343f', '#ff3b3b']],
  intern: [['coffeeRun', 'COFFEE RUN', '#c8865a', '#5a3a28', '#fff1dc'], ['lanyard', 'LANYARD BLUE', '#5b8cff', '#ffe066', '#ffffff'], ['firstDay', 'FIRST DAY', '#7dffb2', '#2a6b4a', '#ff9de6']],
  helpdesk: [['bsod', 'BLUE SCREEN', '#3d7bff', '#e9f0ff', '#ffffff'], ['ticketClosed', 'TICKET CLOSED', '#5dff8a', '#1f3a2a', '#ffd84f'], ['offline', 'GONE OFFLINE', '#ff8a3d', '#3a2a20', '#2ef2ff']],
  courier: [['express', 'EXPRESS', '#ffe066', '#ff3b3b', '#1a1a1a'], ['rainRoute', 'RAIN ROUTE', '#2ef2ff', '#204060', '#ffffff'], ['overnight', 'OVERNIGHT', '#9b8cff', '#ffb02e', '#ff2bd6']],
  security: [['nightWatch', 'NIGHT WATCH', '#5b8cff', '#1c2440', '#ffe066'], ['hiVis', 'HI-VIS', '#d8ff3a', '#ff8a3d', '#ffffff'], ['lobbyDesk', 'LOBBY DESK', '#ff9de6', '#3a2a40', '#7af0ff']],
  janitor: [['wetFloor', 'WET FLOOR', '#ffd23f', '#3a3a3a', '#ff3b3b'], ['mopBucket', 'MOP BUCKET', '#2ee8ff', '#ff8a3d', '#ffffff'], ['afterHours', 'AFTER HOURS', '#ff5fd2', '#25153a', '#5effc0']],
  manager: [['openDoor', 'OPEN DOOR', '#7dffb2', '#20403a', '#ffffff'], ['synergy', 'SYNERGY', '#9b8cff', '#ffb02e', '#2ef2ff'], ['quarterly', 'QUARTERLY', '#ff8a3d', '#3a2a20', '#ffe066']],
  accountant: [['redInk', 'RED INK', '#ff3b3b', '#2a1a1a', '#ffffff'], ['ledger', 'LEDGER GREEN', '#5dff8a', '#203a28', '#ffe066'], ['taxSeason', 'TAX SEASON', '#ff5fd2', '#3a2040', '#c6ff3d']],
  windowWasher: [['squeegee', 'SQUEEGEE', '#ffe066', '#2a6bff', '#ffffff'], ['highRise', 'HIGH RISE', '#ff3b3b', '#3a3a3a', '#7af0ff'], ['sunset', 'SUNSET', '#ff9de6', '#ff8a3d', '#fff1dc']],
  hrRep: [['policy', 'POLICY UPDATE', '#5b8cff', '#ffe066', '#ffffff'], ['wellnessDay', 'WELLNESS DAY', '#ffd84f', '#5dff8a', '#ff3b3b'], ['exitInterview', 'EXIT INTERVIEW', '#c0c6d4', '#30343f', '#ff9de6']],
  salesRep: [['quotaMet', 'QUOTA MET', '#5dff8a', '#2a6b4a', '#ffe066'], ['coldCall', 'COLD CALL', '#2ef2ff', '#204060', '#ff5fd2'], ['bonusCheck', 'BONUS CHECK', '#ff8a3d', '#3a2a20', '#ffffff']],
  barista: [['matcha', 'MATCHA', '#9dff7a', '#3a5a28', '#fff1dc'], ['coldBrew', 'COLD BREW', '#c8865a', '#2a1a10', '#2ef2ff'], ['pumpkinSpice', 'PUMPKIN SPICE', '#ff8a3d', '#5a2a10', '#ffe066']],
  chef: [['sous', 'SOUS CHEF', '#3a3a3a', '#f0f0f0', '#ffd84f'], ['saffron', 'SAFFRON', '#ffd84f', '#ff3b3b', '#ffffff'], ['blueCheese', 'BLUE CHEESE', '#9aa7ff', '#3d5afe', '#5effc0']],
  wellness: [['sunrise', 'SUNRISE YOGA', '#ffb02e', '#ff5fd2', '#ffffff'], ['zen', 'ZEN GARDEN', '#c0c6d4', '#5dff8a', '#30343f'], ['cardio', 'CARDIO', '#ff3b3b', '#2ef2ff', '#ffe066']],
  electrician: [['liveWire', 'LIVE WIRE', '#ff3b3b', '#1a1a1a', '#ffe066'], ['ground', 'GROUNDED', '#5dff8a', '#3a3a3a', '#ff8a3d'], ['breaker', 'BREAKER BOX', '#c0c6d4', '#ff5fd2', '#2ef2ff']],
  receptionist: [['holdMusic', 'HOLD MUSIC', '#2ef2ff', '#3d5afe', '#ffffff'], ['frontDesk', 'FRONT DESK', '#ffd84f', '#ff3b3b', '#fff1dc'], ['visitorPass', 'VISITOR PASS', '#ff8a3d', '#20403a', '#7dffb2']],
  lawyer: [['pinstripe', 'PINSTRIPE', '#c0c6d4', '#30343f', '#ff3b3b'], ['objection', 'OBJECTION', '#ff3b3b', '#2a1a1a', '#ffe066'], ['billable', 'BILLABLE HOURS', '#5dff8a', '#203a28', '#ffffff']],
  ceo: [['goldenParachute', 'GOLDEN PARACHUTE', '#ffffff', '#ffd84f', '#ff3b3b'], ['boardroom', 'BOARDROOM', '#9b8cff', '#25153a', '#ffd84f'], ['ipo', 'IPO DAY', '#5dff8a', '#3d7bff', '#ffffff']],
};

/** @typedef {{ id: string, name: string, body: string, pants: string, accent: string, price: number }} Palette */
/** fighter id -> its extra palettes, cheapest first @type {Record<string, Palette[]>} */
export const PALETTES = Object.fromEntries(Object.entries(RAW).map(([fighter, list]) => [fighter,
  list.map(([id, name, body, pants, accent], i) => ({ id, name, body, pants, accent, price: PRICES[i] ?? PRICES[PRICES.length - 1] }))]));

/** @param {string} fighter @returns {Palette[]} */
export function palettesFor(fighter) { return PALETTES[fighter] || []; }
/** @param {string} fighter @param {string} id @returns {Palette | null} */
export function palette(fighter, id) { return palettesFor(fighter).find((p) => p.id === id) || null; }
export const itemKey = (/** @type {string} */ fighter, /** @type {string} */ id) => `${fighter}:${id}`;
/** an owned-item key that names a real palette */
/** @param {unknown} key */
export function isItem(key) {
  if (typeof key !== 'string') return false;
  const [f, id] = key.split(':');
  return !!palette(f, id);
}
