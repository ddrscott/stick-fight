// The size of the touch controls: what the player picked, where it's kept, and what the screen
// really fits. src/touch.js draws from it, the settings panel (src/audio/ui.js) changes it, and
// src/net/profile.js carries it to the account, so signing in on a new phone brings it along.
//
// Kept in localStorage as stick-fight-touch: { scale, at }. `at` is when the player last changed it
// (ms); a device that has never set a size has no entry (at 0). Every storage call is wrapped, so a
// private window just keeps the choice for the page.
//
//   touchPref()            { scale, at }
//   setTouchScale(scale)   the player's change: saved with the time, listeners told 'player'
//   mergeTouchPref(remote) the account's { scale, at } against this device's (see below)
//   touchFit               { scale, want, clamped }: what touch.js could lay out on this screen
//   onTouchPref(fn)        fn(source) on every change: 'player', 'account' or 'fit'

const KEY = 'stick-fight-touch';

/** the steps the panel offers; the scale multiplies every rem size in the touch layer */
export const TOUCH_STEPS = [
  { name: 'SMALL', scale: 0.85 },
  { name: 'NORMAL', scale: 1 },
  { name: 'LARGE', scale: 1.13 },
  { name: 'LARGER', scale: 1.26 },
  { name: 'EXTRA LARGE', scale: 1.4 },
];
export const TOUCH_DEFAULT = 1;
// the range the server accepts too (worker/auth.ts cleanPrefs), wider than the steps so they can be retuned
const MIN = 0.5, MAX = 2;

let memory = null;   // the latest value on this page (and the only copy when storage is off)
const subs = new Set();

function clean(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const scale = Number(raw.scale), at = Math.floor(Number(raw.at) || 0);
  if (!(scale >= MIN && scale <= MAX)) return null;
  return { scale: Math.round(scale * 1000) / 1000, at: Math.max(0, at) };
}
function read() {
  if (memory) return memory;
  let p = null;
  try { const raw = localStorage.getItem(KEY); if (raw) p = clean(JSON.parse(raw)); } catch { p = null; }
  return p || { scale: TOUCH_DEFAULT, at: 0 };
}
function write(p) {
  memory = p;
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage off: this page only */ }
}
function emit(source) { for (const fn of subs) { try { fn(source); } catch { /* one listener never stops the rest */ } } }

/** this device's size: { scale, at }, at 0 when the player has never set one here */
export function touchPref() { const p = read(); return { scale: p.scale, at: p.at }; }

/** the step nearest a scale (an index into TOUCH_STEPS) */
export function touchStep(scale = read().scale) {
  let best = 0;
  TOUCH_STEPS.forEach((s, i) => { if (Math.abs(s.scale - scale) < Math.abs(TOUCH_STEPS[best].scale - scale)) best = i; });
  return best;
}

/** the player changed the size (RESET is a change too) */
export function setTouchScale(scale) {
  const p = clean({ scale, at: Date.now() });
  if (!p) return;
  write(p);
  emit('player');
}

/**
 * The account's size against this device's. The account wins when this device has never set one;
 * after that the most recent change wins. Returns 'adopted' (this device took the account's),
 * 'push' (this device's is newer, or the account has none: send it up) or 'same'.
 */
export function mergeTouchPref(remote) {
  const r = clean(remote), l = read();
  if (!r) return l.at ? 'push' : 'same';
  if (!l.at || r.at > l.at) {
    const changed = r.scale !== l.scale;
    write(r);
    if (changed) emit('account');
    return 'adopted';
  }
  return l.at > r.at ? 'push' : 'same';
}

/** what the touch layer laid out: the scale in use, the one asked for, and whether the screen capped it */
export const touchFit = { scale: TOUCH_DEFAULT, want: TOUCH_DEFAULT, clamped: false };
export function setTouchFit(scale, want) {
  const clamped = scale < want - 0.004;
  if (touchFit.scale === scale && touchFit.want === want && touchFit.clamped === clamped) return;
  touchFit.scale = scale; touchFit.want = want; touchFit.clamped = clamped;
  emit('fit');
}

export function onTouchPref(fn) { subs.add(fn); return () => subs.delete(fn); }
