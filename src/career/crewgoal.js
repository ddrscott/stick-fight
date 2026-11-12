// Crew goals and Employee of the Month (README, Crew rooms, Crew goals; Progression). Plain JavaScript with no
// imports past rules.js, so the crew's Durable Object (worker/crew.ts) and the page run the same math.
//
//   weekOf(t)                 'YYYY-MM-DD', the Monday (UTC) the week of t started on
//   weekEnds(week)            ms when that week ends (the next Monday, 00:00 UTC)
//   goalFor(week, active)     { kind, target, text }: this week's goal for a crew with `active` recent members
//   crewCounts(r)             what a crew match adds to the crew's progress, per goal kind
//   memberCounts(r, side)     what it adds to one member's own contribution (side 0 host, 1 guest)
//   soloCounts(m)             what a signed-in member's arcade stage or horde run adds (the same shape)
//   initialsOf(name)          'SP' from 'SCOTT PIERCE', 'SC' from 'SCOTT': how the goal and Employee of the Month name people
//   monthOf(t) / monthName(m) '2026-11' / 'NOVEMBER'
//   goalText(kind, n)         'WIN 40 ROUNDS'
//
// Everything is cooperative: the goal counts what the crew did together, it pays everyone who played that week,
// and Employee of the Month only ever names the top of the month. Nothing names the bottom.
import { TITLES } from './rules.js';

/** What hitting the goal pays each member who played that week, on top of what their matches paid. */
export const GOAL_PAY = { xp: 100, sticks: 150, label: 'CREW GOAL' };
/** The three kinds of goal, one a week in turn. per: the target per active member, between min and max. */
export const GOAL_KINDS = {
  matches: { per: 3, min: 8, max: 60 },
  rounds: { per: 6, min: 15, max: 120 },
  wins: { per: 2, min: 5, max: 40 },
};
export const GOAL_ORDER = ['matches', 'rounds', 'wins'];
/** a member is active (counts toward the goal's size) when they opened the crew in the last 28 days */
export const ACTIVE_DAYS = 28;
/** a signed-in member's solo matches (arcade, horde) count toward their crews' goals, at most this many a day each */
export const SOLO_PER_DAY = 5;
/** a goal met and not yet paid to someone (they weren't in the lobby) waits this many weeks for them */
export const OWED_WEEKS = 4;

const DAY_MS = 86400000, WEEK_MS = 7 * DAY_MS;
const n0 = (/** @type {unknown} */ v, cap = 1e6) => Math.max(0, Math.min(cap, Math.floor(Number(v) || 0)));

/** the Monday (UTC) the week of t started on, as 'YYYY-MM-DD' */
export function weekOf(t = Date.now()) {
  const d = new Date(Math.floor(t / DAY_MS) * DAY_MS);
  const back = (d.getUTCDay() + 6) % 7;   // Monday 0 ... Sunday 6
  return new Date(d.getTime() - back * DAY_MS).toISOString().slice(0, 10);
}
/** when the week starting `week` ends: the next Monday at 00:00 UTC */
export const weekEnds = (/** @type {string} */ week) => Date.parse(`${week}T00:00:00Z`) + WEEK_MS;

/** the goal's words: PLAY 30 MATCHES, WIN 40 ROUNDS, WIN 12 MATCHES */
export function goalText(/** @type {string} */ kind, /** @type {number} */ n) {
  if (kind === 'rounds') return `WIN ${n} ROUNDS`;
  if (kind === 'wins') return `WIN ${n} MATCHES`;
  return `PLAY ${n} MATCHES`;
}

/** This week's goal: the kind goes in turn week by week (the same for every crew), sized to the crew's active
 *  members (at least 2, so a crew of one still has a goal worth sharing the link for). */
export function goalFor(/** @type {string} */ week, /** @type {number} */ active) {
  const i = Math.floor(Date.parse(`${week}T00:00:00Z`) / WEEK_MS);
  const kind = GOAL_ORDER[((i % 3) + 3) % 3];
  const k = /** @type {any} */ (GOAL_KINDS)[kind];
  const target = Math.max(k.min, Math.min(k.max, k.per * Math.max(2, n0(active, 50))));
  return { kind, target, text: goalText(kind, target) };
}

/** what a crew match adds to the crew's progress: one match, every round either won, one win unless it was a draw.
 *  r: { winner (0 host, 1 guest, -1 draw), hw, gw } */
export function crewCounts(/** @type {{ winner: number, hw: number, gw: number }} */ r) {
  return { matches: 1, rounds: n0(r.hw, 9) + n0(r.gw, 9), wins: r.winner === 0 || r.winner === 1 ? 1 : 0 };
}
/** what a crew match adds to one member's contribution */
export function memberCounts(/** @type {{ winner: number, hw: number, gw: number }} */ r, /** @type {0 | 1} */ side) {
  return { matches: 1, rounds: n0(side === 0 ? r.hw : r.gw, 9), wins: r.winner === side ? 1 : 0 };
}
/** what a signed-in member's solo match adds, to their contribution and the crew's progress alike: an arcade stage
 *  counts its rounds won and the win, a horde run its floors cleared as rounds (a run has no win). m is the cleaned
 *  match the career paid (worker/career.ts cleanMatch). */
export function soloCounts(/** @type {any} */ m) {
  if (!m || m.cut) return { matches: 0, rounds: 0, wins: 0 };
  if (m.mode === 'horde') return { matches: 1, rounds: n0(m.floors, 9), wins: 0 };
  return { matches: 1, rounds: n0(m.rounds, 9), wins: m.won ? 1 : 0 };
}

/** 'SP' from 'SCOTT PIERCE', 'SC' from 'SCOTT', 'G7' from 'GUEST 736': the first letter of up to three words, or a
 *  one-word name's first two. The goal and Employee of the Month name people by these (and their title), no more. */
export function initialsOf(/** @type {string} */ name) {
  const words = String(name || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '??';
  if (words.length === 1) return words[0].slice(0, 2);
  return words.slice(0, 3).map((w) => w[0]).join('');
}
/** a title from the ladder, or '' */
export const cleanTitle = (/** @type {unknown} */ t) => (typeof t === 'string' && TITLES.includes(t) ? t : '');

/** '2026-11', the UTC month of t */
export const monthOf = (t = Date.now()) => new Date(t).toISOString().slice(0, 7);
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
/** 'NOVEMBER' for '2026-11' */
export const monthName = (/** @type {string} */ m) => MONTHS[Number(String(m).slice(5, 7)) - 1] || '';
/** the month before '2026-11': '2026-10' */
export function prevMonth(/** @type {string} */ m) {
  const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
}
