// The GRAPHICS setting and the tier this device settled on (README, Performance, Chromebooks). The settings
// panel (src/audio/ui.js) changes the choice; src/main.js reads both at boot and tells the compositor.
//
// FRAME RATE lives here too ({ fps }: '60', 'max' or unset for the device's default).
// Kept in localStorage as stick-fight-gfx: { pick, tier, fps }. pick is 'auto' (the default: the adaptive tier) or a
// fixed tier, '3' to '0', which turns adaptation off. tier is where AUTO last settled on this device, so the
// second visit starts there instead of at the capability check's guess. It stays on this device and isn't
// carried to the account the way the touch size is: a Chromebook and a desktop want different answers.
// Every storage call is wrapped, so a private window keeps the choice for the page.

const KEY = 'stick-fight-gfx';

/** the panel's choices, left to right */
export const GFX_CHOICES = [
  { id: 'auto', name: 'AUTO' },
  { id: '3', name: 'HIGH' },
  { id: '2', name: 'MEDIUM' },
  { id: '1', name: 'LOW' },
  { id: '0', name: 'LOWEST' },
];
/** a tier's name in the panel's words */
export const TIER_NAME = { 3: 'HIGH', 2: 'MEDIUM', 1: 'LOW', 0: 'LOWEST' };

/** FRAME RATE's choices, left to right (README, Performance, The draw cap): at most 60 pictures a second, or one every
 *  refresh the screen offers. Unset, it's 60 on a touch screen (a phone's 120 Hz panel draws twice the pictures for the
 *  same game and heats up) and MAX with a mouse. */
export const FPS_CHOICES = [
  { id: '60', name: '60' },
  { id: 'max', name: 'MAX' },
];

let memory = null;
const subs = new Set();

function clean(raw) {
  const out = { pick: 'auto', tier: -1, fps: '' };
  if (raw && typeof raw === 'object') {
    if (GFX_CHOICES.some((c) => c.id === raw.pick)) out.pick = raw.pick;
    if (FPS_CHOICES.some((c) => c.id === raw.fps)) out.fps = raw.fps;
    const t = Number(raw.tier);
    if (Number.isInteger(t) && t >= 0 && t <= 3) out.tier = t;
  }
  return out;
}
function read() {
  if (memory) return memory;
  let p = null;
  try { const raw = localStorage.getItem(KEY); if (raw) p = JSON.parse(raw); } catch { p = null; }
  return (memory = clean(p));
}
function write(p) {
  memory = p;
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage off: this page only */ }
}

/** 'auto' or '3'..'0' */
export function gfxPick() { return read().pick; }
/** the tier AUTO settled on last time on this device, or -1 */
export function rememberedTier() { return read().tier; }

/** the player picked in the panel */
export function setGfxPick(pick) {
  if (!GFX_CHOICES.some((c) => c.id === pick) || pick === read().pick) return;
  write({ ...read(), pick });
  for (const fn of subs) { try { fn(pick); } catch { /* one listener never stops the rest */ } }
}
/** AUTO settled (src/main.js): start there next visit */
export function rememberTier(t) {
  if (!Number.isInteger(t) || t < 0 || t > 3 || t === read().tier) return;
  write({ ...read(), tier: t });
}
/** FRAME RATE: '60' or 'max', the player's choice or this device's default (60 on touch) */
export function fpsPick() {
  const f = read().fps;
  if (f) return f;
  let coarse = false;
  try { coarse = matchMedia('(pointer: coarse)').matches; } catch { /* no matchMedia: a mouse */ }
  return coarse ? '60' : 'max';
}
const fpsSubs = new Set();
/** the player picked a frame rate in the panel */
export function setFpsPick(fps) {
  if (!FPS_CHOICES.some((c) => c.id === fps) || fps === fpsPick()) return;
  write({ ...read(), fps });
  for (const fn of fpsSubs) { try { fn(fps); } catch { /* one listener never stops the rest */ } }
}
/** fn(fps) when the player changes it */
export function onFpsPick(fn) { fpsSubs.add(fn); return () => fpsSubs.delete(fn); }
/** fn(pick) when the player changes it */
export function onGfxPick(fn) { subs.add(fn); return () => subs.delete(fn); }

// The tier drawing right now, for the panel's note beside AUTO (src/main.js tells it; the panel listens)
let live = -1;
const liveSubs = new Set();
/** the compositor's tier now (src/main.js, on a change) */
export function setLiveTier(t) {
  if (t === live) return;
  live = t;
  for (const fn of liveSubs) { try { fn(t); } catch { /* one listener never stops the rest */ } }
}
export function liveTier() { return live; }
export function onLiveTier(fn) { liveSubs.add(fn); return () => liveSubs.delete(fn); }
