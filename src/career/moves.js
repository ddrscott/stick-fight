// The custom employee (README, Characters, Custom employee): sticks buy other fighters' moves, and each fighter has two
// move slots that hold borrowed moves on top of its own (nothing is replaced). Slot A is ↓ 1+3 and slot B is ↓ 2+4 for
// every fighter: no character has a command there, and the shared table only had the plain throw there, which a
// crouching opponent ducks anyway, so a slot adds a move and takes none away. An empty slot is still the throw.
//
// Only moves that really move between bodies are for sale: a move is a keyframe clip on the shared rig plus frame data,
// but some lean on a prop, a cloth or a hook only their owner has. Each character file marks every own move with
// `transfer`: true, or a string saying why not (src/characters/). MOVES is the list of the true ones, kept in step by
// `npm run test:moves`.
//
// Owning a move is the player's, once (`move:reboot` in career.owned), and any fighter but its owner can slot it.
// Owning isn't slotting: each fighter's two slots are in career.equip as 'courier:slot1' / 'courier:slot2' -> move id,
// and the player picks what goes in each, or empties it.
//
// Plain JavaScript and no imports: the Worker checks a buy and a slot against this same list (worker/career.ts).
//
//   MOVE_PRICE               sticks per move, every move the same
//   SLOTS                    [{ n, key, input, button }]: slot A (↓ 1+3) and slot B (↓ 2+4)
//   MOVES                    [{ id, fighter, name, note }]: every move for sale, in roster order
//   moveInfo(id)             one of them, or null
//   movesFor(fighter)        the moves this fighter can slot (everyone else's)
//   moveKey(id)              how an owned move is stored: 'move:reboot'
//   isMoveKey(key)           a key for a move in the catalog
//   slotKey(fighter, n)      where a slot is stored in career.equip: 'courier:slot1' (n is 1 or 2)
//   canSlot(owned, f, id)    'ok' | 'unknown' (not for sale) | 'own' (the fighter's own move) | 'not-owned'
//   loadoutOf(career, f)     [slot A, slot B]: move ids or '' (only owned moves this fighter can slot, no move twice)
//   cleanLoadout(f, list)    the same rule for a list from anywhere (a look online): two entries, '' for empty
//   loadoutText(list)        '~a.b' for the look string ('' when both are empty); parseLoadout reads it back

export const MOVE_PRICE = 300;
export const SLOTS = [
  { n: 1, key: 'A', input: '↓ 1+3', button: '1+3' },
  { n: 2, key: 'B', input: '↓ 2+4', button: '2+4' },
];

/** @type {{ id: string, fighter: string, name: string, note: string }[]} */
export const MOVES = [
  { id: 'coffeeRun', fighter: 'intern', name: 'COFFEE RUN', note: 'dash-in elbow, unsafe if blocked' },
  { id: 'paperCut', fighter: 'intern', name: 'PAPER CUT', note: 'quick low jab' },
  { id: 'reboot', fighter: 'helpdesk', name: 'REBOOT', note: 'palm push, carries him to the wall' },
  { id: 'expressSlide', fighter: 'courier', name: 'EXPRESS SLIDE', note: 'low slide under highs, knocks down' },
  { id: 'dropOffKnee', fighter: 'courier', name: 'DROP-OFF KNEE', note: 'flying knee over lows, launches' },
  { id: 'escort', fighter: 'security', name: 'ESCORT', note: 'command grab, can’t be broken' },
  { id: 'shoulderCheck', fighter: 'security', name: 'SHOULDER CHECK', note: 'armored charge, wall bounce' },
  { id: 'wetFloor', fighter: 'janitor', name: 'WET FLOOR', note: 'long low slide sweep, knocks down' },
  { id: 'mopSpin', fighter: 'janitor', name: 'MOP SPIN', note: 'full turn, hits behind him too' },
  { id: 'downsizing', fighter: 'manager', name: 'DOWNSIZING', note: 'axe kick overhead, hits crouchers' },
  { id: 'finePrint', fighter: 'accountant', name: 'FINE PRINT', note: 'fast low poke, plus on block' },
  { id: 'updraft', fighter: 'windowWasher', name: 'UPDRAFT', note: 'rising scissor kick, anti-air, launches' },
  { id: 'hr_writeUp', fighter: 'hrRep', name: 'WRITE-UP', note: 'quick swat, halves his regen 3s' },
  { id: 'hr_training', fighter: 'hrRep', name: 'MANDATORY TRAINING', note: 'slow long shove, sends him back' },
  { id: 'sr_pitch', fighter: 'salesRep', name: 'THE PITCH', note: 'low shin kick' },
  { id: 'sr_closeDeal', fighter: 'salesRep', name: 'CLOSE THE DEAL', note: 'fast handshake grab' },
  { id: 'ba_pourOver', fighter: 'barista', name: 'POUR OVER', note: 'four-hit flurry, knocks down' },
  { id: 'chef_cleaver', fighter: 'chef', name: 'CLEAVER', note: 'armored overhead chop, hits crouchers' },
  { id: 'chef_flambe', fighter: 'chef', name: 'FLAMBÉ', note: 'short upward flick, launches' },
  { id: 'electrician_liveWire', fighter: 'electrician', name: 'LIVE WIRE', note: 'poke that shocks: extra stun' },
  { id: 'electrician_groundFault', fighter: 'electrician', name: 'GROUND FAULT', note: 'low stamp, roots him in place' },
  { id: 'receptionist_transfer', fighter: 'receptionist', name: 'TRANSFER', note: 'grab over the head, can’t be broken: sides swap' },
  { id: 'lawyer_crossExam', fighter: 'lawyer', name: 'CROSS-EXAMINATION', note: 'quick mid, plus on block' },
  { id: 'ceo_parachute', fighter: 'ceo', name: 'GOLDEN PARACHUTE', note: 'invulnerable hop back' },
  { id: 'ceo_takeover', fighter: 'ceo', name: 'HOSTILE TAKEOVER', note: 'launcher; in a juggle, the ender to the wall' },
];
const BY_ID = new Map(MOVES.map((m) => [m.id, m]));

/** @param {unknown} id */
export const moveInfo = (id) => (typeof id === 'string' && BY_ID.get(id)) || null;
/** @param {string} fighter */
export const movesFor = (fighter) => MOVES.filter((m) => m.fighter !== fighter);
/** @param {string} id */
export const moveKey = (id) => `move:${id}`;
/** @param {unknown} key */
export function isMoveKey(key) { return typeof key === 'string' && key.startsWith('move:') && BY_ID.has(key.slice(5)); }
/** @param {string} fighter @param {number} n */
export const slotKey = (fighter, n) => `${fighter}:slot${n}`;

/** @param {unknown} owned @param {string} fighter @param {string} id */
export function canSlot(owned, fighter, id) {
  const m = moveInfo(id);
  if (!m) return 'unknown';
  if (m.fighter === fighter) return 'own';
  return Array.isArray(owned) && owned.includes(moveKey(id)) ? 'ok' : 'not-owned';
}

/** two entries, '' for an empty slot: only moves for sale, never the fighter's own, no move twice
 *  @param {string} fighter @param {unknown} list @returns {string[]} */
export function cleanLoadout(fighter, list) {
  const a = Array.isArray(list) ? list : [];
  return [0, 1].map((k) => { const id = a[k], m = moveInfo(id); return m && m.fighter !== fighter && a.indexOf(id) === k ? String(id) : ''; });
}

/** the moves in this fighter's slots: owned ones only @param {{ owned?: unknown, equip?: unknown } | null | undefined} career @param {string} fighter */
export function loadoutOf(career, fighter) {
  const owned = career && Array.isArray(career.owned) ? career.owned : [];
  const eq = career && career.equip && typeof career.equip === 'object' ? /** @type {Record<string, unknown>} */ (career.equip) : {};
  const list = SLOTS.map((s) => { const id = eq[slotKey(fighter, s.n)]; return typeof id === 'string' && canSlot(owned, fighter, id) === 'ok' ? id : ''; });
  return cleanLoadout(fighter, list);
}

/** '~reboot.mopSpin', '~.mopSpin' (slot A empty), '' (both empty) @param {string[]} list */
export const loadoutText = (list) => (list && list.some(Boolean) ? `~${list.map((x) => x || '').join('.')}` : '');
/** the slots from a look's '~a.b' part @param {string} fighter @param {unknown} text */
export function parseLoadout(fighter, text) {
  const s = typeof text === 'string' ? text : '';
  return cleanLoadout(fighter, s ? s.split('.').slice(0, 2) : []);
}
