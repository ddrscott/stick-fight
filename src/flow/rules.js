// The match rules a player picks: how many rounds (best of 1, 3 or 5) and how long a round runs (30, 60 or
// 99 seconds, or no limit). Kept in localStorage like the botch switch (src/flow/techniques.js); the keys
// start with stick-fight- because the origin is shared. Every access is wrapped: blocked storage keeps the
// defaults. src/main.js puts them on the sim (sim.roundTime, sim.winsNeeded) for the flow's fights; online,
// the host's rules ride the start message (src/net/online.js), and ?scene= test pages always use the defaults.
export const ROUND_TIMES = [30, 60, 99, 0];   // 0 = no limit
export const BEST_OF = [1, 3, 5];
export const DEFAULT_ROUND_TIME = 99, DEFAULT_BEST_OF = 3;
const TIME_KEY = 'stick-fight-round-time', ROUNDS_KEY = 'stick-fight-best-of';

function read(key, list, dflt) {
  try { const v = Number(localStorage.getItem(key)); return localStorage.getItem(key) != null && list.includes(v) ? v : dflt; } catch { return dflt; }
}
function write(key, v) { try { localStorage.setItem(key, String(v)); } catch { /* blocked storage: this page only */ mem[key] = v; } }
const mem = {};

/** seconds a round lasts, 0 for no limit */
export const roundTime = () => (TIME_KEY in mem ? mem[TIME_KEY] : read(TIME_KEY, ROUND_TIMES, DEFAULT_ROUND_TIME));
/** rounds in a match: 1, 3 or 5 */
export const bestOf = () => (ROUNDS_KEY in mem ? mem[ROUNDS_KEY] : read(ROUNDS_KEY, BEST_OF, DEFAULT_BEST_OF));
/** step to the next choice (wrapping) and remember it */
export function cycleRoundTime() { const v = ROUND_TIMES[(ROUND_TIMES.indexOf(roundTime()) + 1) % ROUND_TIMES.length]; write(TIME_KEY, v); return v; }
export function cycleBestOf() { const v = BEST_OF[(BEST_OF.indexOf(bestOf()) + 1) % BEST_OF.length]; write(ROUNDS_KEY, v); return v; }
/** round wins a match needs for a best of n */
export const winsFor = (n) => Math.floor(n / 2) + 1;
export const timeLabel = (s) => (s ? `${s}S` : 'NO LIMIT');
