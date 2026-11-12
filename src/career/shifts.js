// Daily shifts (README, Progression, Daily shifts): three small goals a day that each teach one thing and pay
// sticks and XP when done. The same three for everyone that UTC day, picked from the date alone, so a crew can talk
// about them. A player may swap one a day (the swap is picked from the date too, so two players who swap the same
// slot get the same replacement). Unfinished shifts just expire at midnight UTC: no penalty, no streak.
//
// Mashing completes nothing. A shift only ever counts technique and results the books already read off the sim's
// own events (parries, punishes, enders, perfect rounds, rounds and stages won, floors cleared, a match played
// online), never hits, combos or presses. STATS below is the whole list of what a shift may read, and the test
// (scripts/career/shifts.mjs) fails if a shift reads anything else. Technique counts in ONE match, not summed over
// the day: a masher does land the odd counter hit or ender by luck (measured in the real sim, 108 mashed matches:
// at most 1 parry, 3 punishes and 3 enders in a match, and never a round won), so a day's sum could be ground out
// by volume, but the bar for one match sits above anything mashing reached.
//
//   SHIFT_PAY                       what a finished shift pays
//   shiftsFor(day, swap)            the day's three shifts: [{ id, kind, n, title, mechanic, guide, coach }]
//   cleanShifts(raw, day)           a stored state made safe and current: { day, swap, prog: [3], done: [3] }
//   advanceShifts(state, m, day)    a closed match's progress: { state, moved: [3], finished: [shift] }
//   swapShift(state, slot, day)     { state } | { error: 'used' | 'done' | 'bad' }
//   mergeShifts(acct, guest, day)   a guest's progress into an account's at sign-in, the same way as the rest
//   payMatch(m, career, day)        rules.js payout plus any shift the match finished, as one award
//
// Plain JavaScript; it imports only rules.js, so the Worker (worker/career.ts) uses it as it is.
import { payout, PAID_MODES, ONLINE_MODES, utcDay } from './rules.js';

export const SHIFT_COUNT = 3;
/** a finished shift: about a first win of the day spread over three goals */
export const SHIFT_PAY = { xp: 30, sticks: 50 };

/** Every fighter a shift may name, with the name on screen. All of them are on the select screen from the start. */
export const SHIFT_FIGHTERS = {
  temp: 'THE TEMP', intern: 'THE INTERN', helpdesk: 'HELPDESK', courier: 'THE COURIER', security: 'SECURITY', janitor: 'THE JANITOR',
  manager: 'THE MANAGER', accountant: 'THE ACCOUNTANT', windowWasher: 'THE WINDOW WASHER', hrRep: 'THE HR REP', salesRep: 'THE SALES REP',
  barista: 'THE BARISTA', chef: 'THE CHEF', wellness: 'THE WELLNESS COACH', electrician: 'THE ELECTRICIAN', receptionist: 'THE RECEPTIONIST',
  lawyer: 'THE LAWYER', ceo: 'THE CEO',
};

/** What a shift may read from a match summary (src/bookkeeping.js summary). Hits, combo and presses aren't here. */
export const STATS = ['parries', 'punishes', 'enders', 'perfects', 'rounds', 'stage', 'floors', 'online'];

/**
 * The kinds of shift. stat: the one thing it counts; add: summed across the day's matches (only results: rounds
 * won with a fighter, online matches played), max: the best single match. ns: the targets it can ask for. mode: the one mode it needs (at most one such shift a day, so nobody has
 * to play three modes). guide: a page under the site root. The words are for a 12-year-old: plain, no jargon.
 * @type {{ kind: string, stat: string, how: 'add' | 'max', ns: number[], mode?: string, weight: number,
 *   title: (n: number, f?: string) => string, mechanic: string, guide: (f?: string) => string, coach: string }[]}
 */
export const KINDS = [
  { kind: 'parry', stat: 'parries', how: 'max', ns: [2, 3], weight: 3,
    title: (n) => `LAND ${n} PARRIES IN ONE MATCH`, mechanic: 'THE PARRY', guide: () => 'how-to-play/strategy/#parry',
    coach: 'TAP TOWARD THEM JUST BEFORE THEIR HIT LANDS (DOWN-FORWARD FOR A LOW ONE). TOO EARLY AND IT MISSES, SO WATCH FOR THE SWING.' },
  { kind: 'punish', stat: 'punishes', how: 'max', ns: [4, 5], weight: 3,
    title: (n) => `PUNISH ${n} MOVES IN ONE MATCH`, mechanic: 'PUNISHING', guide: () => 'how-to-play/strategy/#punish',
    coach: 'HIT THEM WHILE THEIR MOVE IS STILL STARTING. LET THEM COMMIT FIRST, THEN SWING. A HIT IN THE BACK COUNTS TOO.' },
  { kind: 'ender', stat: 'enders', how: 'max', ns: [4], weight: 3,
    title: (n) => `LAND ${n} STRING ENDERS IN ONE MATCH`, mechanic: 'STRINGS', guide: () => 'how-to-play/strategy/#strings',
    coach: 'PRESS IN RHYTHM AS EACH HIT FINISHES, ALL THE WAY TO THE LAST ONE. FASTER ISN\'T BETTER. THE MOVE LIST HAS EVERY STRING.' },
  { kind: 'perfect', stat: 'perfects', how: 'add', ns: [1], weight: 1,
    title: () => 'WIN A ROUND AT FULL HEALTH', mechanic: 'WHAT BEATS WHAT', guide: () => 'how-to-play/strategy/#rps-h',
    coach: 'GUARD, WAIT FOR THEIR MISTAKE, AND MAKE THEM PAY FOR IT. THE CHART SAYS WHAT STOPS WHAT.' },
  { kind: 'fighter', stat: 'rounds', how: 'add', ns: [1], weight: 2,
    title: (_n, f) => `WIN A ROUND WITH ${SHIFT_FIGHTERS[/** @type {keyof typeof SHIFT_FIGHTERS} */ (f)] || 'THE TEMP'}`, mechanic: 'A NEW FIGHTER', guide: (f) => `fighters/${f}/`,
    coach: 'PICK THEM AT CHARACTER SELECT. THEIR PAGE SHOWS WHAT THEIR OWN MOVES DO AND HOW EACH ONE GETS BEATEN.' },
  { kind: 'arcade', stat: 'stage', how: 'max', ns: [3, 4], mode: 'arcade', weight: 2,
    title: (n) => `CLEAR STAGE ${n} IN ARCADE`, mechanic: 'READING THE CPU', guide: () => 'how-to-play/strategy/#ladder-h',
    coach: 'EACH COWORKER FIGHTS THEIR OWN WAY. THE GUIDE SAYS HOW TO BEAT EACH ONE. A CONTINUE IS FINE.' },
  { kind: 'horde', stat: 'floors', how: 'max', ns: [3, 5], mode: 'horde', weight: 2,
    title: (n) => `CLEAR ${n} FLOORS IN ONE HORDE RUN`, mechanic: 'SPENDING STAMINA', guide: () => 'how-to-play/strategy/#stamina',
    coach: 'DON\'T SWING AT EVERYONE. LET THEM COME TO YOU, AND KEEP SOME STAMINA FOR THE NEXT ONE.' },
  { kind: 'online', stat: 'online', how: 'add', ns: [1], mode: 'online', weight: 1,
    title: () => 'PLAY AN ONLINE MATCH', mechanic: '', guide: () => '',
    coach: 'WIN OR LOSE. A CREW MATCH COUNTS. SEND A FRIEND YOUR ROOM LINK.' },
];
const BY_KIND = Object.fromEntries(KINDS.map((k) => [k.kind, k]));

/** a 32-bit hash of a string (FNV-1a) */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** a seeded random number generator (mulberry32), so a date always gives the same picks */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** @typedef {{ id: string, kind: string, n: number, f?: string, title: string, mechanic: string, guide: string, coach: string, how: string, stat: string, mode?: string }} Shift */
/** @param {string} kind @param {number} n @param {string} [f] @returns {Shift} */
function make(kind, n, f) {
  const k = BY_KIND[kind];
  return { id: f ? `${kind}:${f}` : `${kind}:${n}`, kind, n, ...(f ? { f } : {}), title: k.title(n, f), mechanic: k.mechanic, guide: k.guide(f), coach: k.coach, how: k.how, stat: k.stat, ...(k.mode ? { mode: k.mode } : {}) };
}

/** The day's candidates in order: every kind once, weighted toward the technique ones, each with its target. */
function candidates(day) {
  const r = rng(hash(`shifts:${day}`));
  const pool = KINDS.map((k) => ({ k, key: -Math.log(1 - r()) / k.weight }));   // weighted order without repeats
  pool.sort((a, b) => a.key - b.key);
  const fighters = Object.keys(SHIFT_FIGHTERS);
  return pool.map(({ k }) => {
    const n = k.ns[Math.floor(r() * k.ns.length)];
    return k.kind === 'fighter' ? make('fighter', n, fighters[Math.floor(r() * fighters.length)]) : make(k.kind, n);
  });
}
/** can s join the others without a second shift that needs its own mode? */
const fits = (s, others) => !s.mode || !others.some((o) => o && o.mode);

const memo = new Map();
/**
 * The day's three shifts. swap: the slot this player swapped today (-1 none): it gets the first candidate that isn't
 * already showing and fits with the other two, so everyone who swaps the same slot gets the same one.
 * @param {string} day @param {number} [swap] @returns {Shift[]}
 */
export function shiftsFor(day, swap = -1) {
  const key = `${day}|${swap}`;
  if (memo.has(key)) return memo.get(key);
  const cand = candidates(day), out = [];
  let i = 0;
  for (; i < cand.length && out.length < SHIFT_COUNT; i++) if (fits(cand[i], out)) out.push(cand[i]);
  if (swap >= 0 && swap < SHIFT_COUNT) {
    const others = out.filter((_, j) => j !== swap);
    const next = cand.find((c) => !out.includes(c) && fits(c, others));
    if (next) out[swap] = next;
  }
  if (memo.size > 64) memo.clear();
  memo.set(key, out);
  return out;
}

/** @typedef {{ day: string, swap: number, prog: number[], done: boolean[] }} ShiftState */
/** @returns {ShiftState} */
export const blankShifts = (day = '') => ({ day, swap: -1, prog: [0, 0, 0], done: [false, false, false] });

/** a stored state (localStorage, a request body, a D1 column) made safe, and fresh when it's from another day
 *  @param {unknown} raw @param {string} [day] @returns {ShiftState} */
export function cleanShifts(raw, day = utcDay()) {
  const s = raw && typeof raw === 'object' ? /** @type {any} */ (raw) : null;
  if (!s || s.day !== day) return blankShifts(day);
  const swap = Number.isInteger(s.swap) && s.swap >= 0 && s.swap < SHIFT_COUNT ? s.swap : -1;
  const list = shiftsFor(day, swap);
  const prog = [0, 1, 2].map((i) => Math.max(0, Math.min(list[i].n, Math.floor(Number(Array.isArray(s.prog) ? s.prog[i] : 0) || 0))));
  const done = [0, 1, 2].map((i) => (Array.isArray(s.done) && s.done[i] === true) || prog[i] >= list[i].n);
  return { day, swap, prog, done };
}

/** How far one match moves a shift. m: the summary (src/bookkeeping.js summary, cleaned on the Worker). Only STATS
 *  are read; a match cut short, training and the dummy move nothing. @param {Shift} s @param {any} m */
export function matchCounts(s, m) {
  if (!m || m.cut || !PAID_MODES.includes(m.mode)) return 0;
  const num = (v) => Math.max(0, Math.min(99, Math.floor(Number(v) || 0)));
  switch (s.stat) {
    case 'parries': case 'punishes': case 'enders': case 'perfects': return num(m[s.stat]);
    case 'rounds': return m.fighter === s.f ? num(m.rounds) : 0;
    case 'stage': return m.mode === 'arcade' && m.won ? num(m.stage) : 0;
    case 'floors': return m.mode === 'horde' ? num(m.floors) : 0;
    case 'online': return ONLINE_MODES.includes(m.mode) ? 1 : 0;
    default: return 0;
  }
}

/** A closed match's progress on today's shifts. finished: the shifts it finished (each pays SHIFT_PAY once).
 *  @param {unknown} state @param {any} m @param {string} [day] */
export function advanceShifts(state, m, day = utcDay()) {
  const s = cleanShifts(state, day), list = shiftsFor(day, s.swap);
  const next = { ...s, prog: [...s.prog], done: [...s.done] }, moved = [false, false, false], finished = [];
  list.forEach((sh, i) => {
    if (next.done[i]) return;
    const c = matchCounts(sh, m);
    if (!c) return;
    const p = Math.min(sh.n, sh.how === 'max' ? Math.max(next.prog[i], c) : next.prog[i] + c);
    if (p === next.prog[i]) return;
    next.prog[i] = p; moved[i] = true;
    if (p >= sh.n) { next.done[i] = true; finished.push(sh); }
  });
  return { state: next, moved, finished };
}

/** One swap a day, of a shift that isn't done yet. Its progress starts over (it's a different goal).
 *  @param {unknown} state @param {number} slot @param {string} [day] */
export function swapShift(state, slot, day = utcDay()) {
  const s = cleanShifts(state, day);
  if (!Number.isInteger(slot) || slot < 0 || slot >= SHIFT_COUNT) return { error: 'bad' };
  if (s.swap >= 0) return { error: 'used' };
  if (s.done[slot]) return { error: 'done' };
  const next = { ...s, swap: slot, prog: [...s.prog], done: [...s.done] };
  next.prog[slot] = 0; next.done[slot] = false;
  return { state: next };
}

/** A guest's shifts into an account's at sign-in, like the rest of progression: the larger of each, never added.
 *  A swap the account already made stands; otherwise the guest's does. A shift showing on both sides keeps the
 *  larger progress, and done on either side is done (its pay is already in the larger sticks).
 *  @param {unknown} acct @param {unknown} guest @param {string} [day] @returns {ShiftState} */
export function mergeShifts(acct, guest, day = utcDay()) {
  const a = cleanShifts(acct, day), g = cleanShifts(guest, day);
  const swap = a.swap >= 0 ? a.swap : g.swap;
  const out = cleanShifts({ day, swap, prog: [0, 0, 0], done: [false, false, false] }, day);
  const list = shiftsFor(day, swap), la = shiftsFor(day, a.swap), lg = shiftsFor(day, g.swap);
  list.forEach((sh, i) => {
    for (const [st, l] of /** @type {[ShiftState, Shift[]][]} */ ([[a, la], [g, lg]])) {
      const j = l.findIndex((x) => x.id === sh.id);
      if (j < 0) continue;
      out.prog[i] = Math.max(out.prog[i], st.prog[j]);
      out.done[i] = out.done[i] || st.done[j];
    }
  });
  return out;
}

/** What a match pays (rules.js payout) plus the shifts it finished, as one award. award.shifts is the new state
 *  (rules.js applyAward stores it), award.moved which slots moved.
 *  @param {any} m @param {any} career @param {string} [day] */
export function payMatch(m, career, day = utcDay()) {
  const award = /** @type {import('./rules.js').Award} */ (payout(m, career, day));
  if (!award.lines.length) return award;
  const r = advanceShifts(career && career.shifts, m, day);
  for (const sh of r.finished) {
    award.lines.push({ id: 'shift', label: `SHIFT DONE: ${sh.title}`, n: 1, xp: SHIFT_PAY.xp, sticks: SHIFT_PAY.sticks });
    award.xp += SHIFT_PAY.xp; award.sticks += SHIFT_PAY.sticks;
  }
  award.shifts = r.state; award.moved = r.moved;
  return award;
}
