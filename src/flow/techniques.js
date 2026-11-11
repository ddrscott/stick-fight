// The happy-accident techniques a player has found (src/combat/botch.js) and the botch switch, kept in
// localStorage. The keys start with stick-fight- from when the origin was shared with the rest of
// askscottpierce.com, kept so nothing resets. Every access is wrapped: a private window or blocked
// storage just finds nothing and keeps the default (botches on).
import { ACCIDENTS } from '../combat/botch.js';

const FOUND_KEY = 'stick-fight-techniques', SWITCH_KEY = 'stick-fight-botch';

/** ids of the techniques found on this browser, in the order they were found */
export function discovered() {
  try {
    const v = JSON.parse(localStorage.getItem(FOUND_KEY) || '[]');
    return Array.isArray(v) ? v.filter((id) => ACCIDENTS.some((a) => a.id === id)) : [];
  } catch { return []; }
}
/** remember a technique; true the first time */
export function discover(id) {
  const list = discovered();
  if (list.includes(id) || !ACCIDENTS.some((a) => a.id === id)) return false;
  list.push(id);
  try { localStorage.setItem(FOUND_KEY, JSON.stringify(list)); } catch { /* storage off: found for this page only */ }
  return true;
}
/** the list for the pause menu and the move list: found ones by name, the rest as ???, every one with its hint */
export function techniques() {
  const d = discovered();
  return ACCIDENTS.map((a) => ({ id: a.id, found: d.includes(a.id), name: d.includes(a.id) ? a.name : '???', hint: a.hint, input: inputOf(a) }));
}
// the two buttons involved (never the timing; that's the discovery)
const inputOf = (a) => `${a.from[0] === 'lungeCross' ? 'f+2' : a.from[0] === 'lowKick' ? 'd+3' : a.from[0] === 'uppercut' ? 'd+2' : a.from[0] === 'sweep' ? 'd+4' : { lkick: '3', roundhouse: '4', cross: '2' }[a.from[0]] || '?'} › ${a.tok === 'T' ? 'THROW' : a.tok}`;
export const techniqueCount = () => ({ found: discovered().length, total: ACCIDENTS.length });

// ?botch=0 (or 1) on the URL wins over the stored setting for this page, so two tabs can compare
let override = null;
try { const p = new URLSearchParams(location.search).get('botch'); override = p === '0' ? false : p === '1' ? true : null; } catch { /* no location */ }
/** are botches on? default yes */
export function botchEnabled() {
  if (override != null) return override;
  try { return localStorage.getItem(SWITCH_KEY) !== '0'; } catch { return true; }
}
export function setBotchEnabled(on) {
  override = null;
  try { localStorage.setItem(SWITCH_KEY, on ? '1' : '0'); } catch { override = !!on; }
}
