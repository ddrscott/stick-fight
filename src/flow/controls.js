// The one control scheme, in one place: the menu table (what every screen in src/flow/ and the
// online leave confirm in src/net/online.js do with each key and button), the fight table, the
// device the player is on right now, and the footer legend drawn from them. README Controls has
// the same tables; change both together.
//
// MENUS (every screen, the same everywhere)
//   action    keyboard                          gamepad (Xbox / PlayStation)      touch
//   move      arrows, WASD (not while typing)   D-pad, left stick                 -
//   confirm   Enter, Space                      A / ✕                             tap the button
//   back      Esc, Backspace (not while typing) B / ○, Select (Back/View/Share)  the BACK button
//   start     -                                 Start / Options: on the title it starts, in a
//                                               fight it pauses, in the pause menu it resumes,
//                                               anywhere else it's confirm
//   delete    Backspace (typing screens)        X / □ (the two keyboard screens)  DEL
//   move list F1 (pause menu, character select)  Y / △ (same screens)             the MOVE LIST button
//   settings  the menu button (a click), or      SETTINGS in the pause menu;       the menu button, or SETTINGS
//             SETTINGS in the pause menu; Esc   B closes                          in the pause menu; X closes
//             closes (src/audio/ui.js key())
//   nothing   -                                 X and Y elsewhere, bumpers, triggers, sticks
//
// A screen with nothing to back out to (the title, a stage card, stage clear, continue, game over,
// initials, the ending) ignores back: B never confirms and A never backs out. The press that
// changes screens is swallowed until it's let go (menuInput.swallow, input.swallowHeld), so it
// never lands on the next screen or throws a punch.
//
// FIGHT (arcade, horde, training; online uses the same keys, except pause asks to leave)
//   1 left punch U / X (□)    2 right punch I / Y (△)    3 left kick J / A (✕)    4 right kick K / B (○)
//   move A D or arrows / stick or D-pad, jump W / up, crouch S / down, guard hold back or B / L1 L2,
//   throw 1+3 or 2+4 / R1, dash tap toward twice, back dash tap away twice (touch: flick the stick twice),
//   run Shift / R2 or the dash's second tap held, pause P or Esc / Start or Select (online: leave
//   confirm), the quick move strip F1; the full MOVE LIST is in the pause menu (src/flow/movelist.js).

import { PLAIN } from '../plaintext.js';   // readable text never glows: the shared dark outline

/** @typedef {'move'|'confirm'|'back'|'start'|'del'|'type'|'moves'} Action */

// ---- the device in use ------------------------------------------------------------------------------
// <html> carries dev-key, dev-pad or dev-touch (and pad-ps for a PlayStation pad), so legends switch
// the moment the player picks up something else. A mouse counts as the keyboard.
let device = '';
let ps = false;
export function setDevice(d, gamepad) {
  if (typeof document === 'undefined') return;
  const c = document.documentElement.classList;
  if (gamepad && gamepad.id) {
    const isPS = /playstation|dualshock|dualsense|sony|054c/i.test(gamepad.id);
    if (isPS !== ps) { ps = isPS; c.toggle('pad-ps', ps); }
  }
  if (d === device) return;
  device = d;
  c.remove('dev-key', 'dev-pad', 'dev-touch');
  c.add(`dev-${d}`);
}
export const currentDevice = () => device;
export const isPlayStation = () => ps;

let watching = false;
/** start following the device (keys and pointers here; menuInput reports the pad) */
export function watchDevice() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  injectStyle();
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  setDevice(coarse ? 'touch' : 'key');
  // touch.js sends synthetic key events for its buttons: only real keys count
  window.addEventListener('keydown', (e) => { if (e.isTrusted && !/^(Meta|Control|Alt|OS)/.test(e.code)) setDevice('key'); }, { capture: true });
  window.addEventListener('pointerdown', (e) => { setDevice(e.pointerType === 'touch' || e.pointerType === 'pen' ? 'touch' : 'key'); }, { capture: true, passive: true });
}

// ---- glyphs ---------------------------------------------------------------------------------------------
// the face buttons in the standard mapping, by index: Xbox letter and color, PlayStation shape and color
export const FACE = {
  0: { x: 'A', ps: '✕', c: '#3ddc5a', pc: '#5b9dff' },
  1: { x: 'B', ps: '○', c: '#ff4a4a', pc: '#ff4a6a' },
  2: { x: 'X', ps: '□', c: '#3d8dff', pc: '#ff6bd5' },
  3: { x: 'Y', ps: '△', c: '#ffd23d', pc: '#3ddcb0' },
};
export const PILL = { start: { x: 'START', ps: 'OPTIONS' }, select: { x: 'SELECT', ps: 'SHARE' } };
const KEY = { move: 'ARROWS', confirm: 'ENTER', back: 'ESC', del: 'BACKSPACE', type: 'A-Z', moves: 'F1' };
const PAD = { confirm: 0, back: 1, del: 2, moves: 3 };

function span(cls, text) { const s = document.createElement('span'); s.className = cls; if (text != null) s.textContent = text; return s; }
/** a round face button glyph (0 A, 1 B, 2 X, 3 Y), Xbox and PlayStation faces both drawn, CSS picks */
export function faceGlyph(i) {
  const f = FACE[i];
  const g = span('lg-b');
  g.style.setProperty('--gc', f.c); g.style.setProperty('--pc', f.pc);
  g.append(span('lg-x', f.x), span('lg-ps', f.ps));
  return g;
}
/** a pill glyph for Start or Select */
export function pillGlyph(which) {
  const g = span('lg-pill');
  g.append(span('lg-x', PILL[which].x), span('lg-ps', PILL[which].ps));
  return g;
}
/** a keycap */
export function keyGlyph(text) { return span('lg-key', text); }
function dpadGlyph() {
  const g = span('lg-dpad');
  g.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 0h4v4h4v4H8v4H4V8H0V4h4z" fill="currentColor"/></svg>';
  return g;
}
/** the pad's name for Start, for text hints */
export const startName = () => (ps ? 'OPTIONS' : 'START');

/**
 * The footer legend: what each control does on this screen, with the glyphs for the device in use.
 * Hidden on touch (the buttons are tapped). An action with no glyph on a device is left out there.
 * @param {Array<[Action, string?]>} entries
 */
export function legend(entries) {
  const bar = span('lg-bar');
  for (const [action, label] of entries) {
    const it = span('lg-i');
    const k = KEY[action], p = action === 'move' ? 'dpad' : action === 'start' ? 'start' : PAD[action];
    if (k) it.appendChild(span('lg-k')).appendChild(keyGlyph(k)); else it.classList.add('lg-nokey');
    if (p != null) {
      const w = it.appendChild(span('lg-p'));
      w.appendChild(p === 'dpad' ? dpadGlyph() : p === 'start' ? pillGlyph('start') : faceGlyph(p));
    } else it.classList.add('lg-nopad');
    it.appendChild(span('lg-t', label || (action === 'move' ? 'MOVE' : action.toUpperCase())));
    bar.appendChild(it);
  }
  return bar;
}

// ---- the fight table (the CONTROLS screen and the pause menu's panel) ----------------------------------
// [what, keyboard, pad: a face index, a pill name, or text]
export const FIGHT = [
  ['1  LEFT PUNCH', 'U', 2],
  ['2  RIGHT PUNCH', 'I', 3],
  ['3  LEFT KICK', 'J', 0],
  ['4  RIGHT KICK', 'K', 1],
  ['MOVE', 'A D / ARROWS', 'STICK / D-PAD'],
  ['JUMP / CROUCH', 'W / S', 'UP / DOWN'],
  ['GUARD', 'HOLD BACK, B', 'HOLD BACK, L1 L2'],
  ['THROW', '1+3 OR 2+4', 'R1'],
  ['DASH', 'TAP → →', 'TAP → →'],
  ['BACK DASH', 'TAP ← ←', 'TAP ← ←'],
  ['RUN', 'SHIFT, OR HOLD THE DASH', 'R2, OR HOLD THE DASH'],
  ['PAUSE', 'P / ESC', 'start'],
];
export const MENUS = [
  ['MOVE', 'ARROWS / WASD', 'D-PAD / STICK'],
  ['SELECT', 'ENTER / SPACE', 0],
  ['BACK', 'ESC / BACKSPACE', 1],
];
/** a two-column table, keyboard and gamepad, the gamepad column in glyphs */
export function controlsTable(rows, title) {
  const t = span('lg-table');
  if (title) t.appendChild(span('lg-th', title));
  t.append(span('lg-th lg-col', 'KEYBOARD'), span('lg-th lg-col', 'GAMEPAD'));
  if (!title) t.prepend(span('lg-th', ''));
  for (const [what, key, pad] of rows) {
    t.appendChild(span('lg-what', what));
    t.appendChild(span('lg-kc')).appendChild(keyGlyph(key));
    const pc = t.appendChild(span('lg-pc'));
    pc.appendChild(typeof pad === 'number' ? faceGlyph(pad) : pad === 'start' || pad === 'select' ? pillGlyph(pad) : span('lg-padtext', pad));
  }
  return t;
}

let styled = false;
function injectStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const css = `
  .lg-bar { --lg: var(--lg-size, 1.75cqw); position: absolute; left: 50%; bottom: 2.2cqh; transform: translateX(-50%); display: flex; gap: 2.4em; align-items: center; justify-content: center;
    white-space: nowrap; pointer-events: none; font: 600 var(--lg)/1 'Teko', 'Arial Narrow', sans-serif; letter-spacing: 0.12em; color: rgba(230,214,255,0.86);
    text-shadow: ${PLAIN}; }   /* read, so no glow: a dark outline holds it over the room */
  .lg-i { display: inline-flex; align-items: center; gap: 0.5em; }
  .lg-t { padding-top: 0.15em; }
  .lg-p { display: none; }
  html.dev-pad .lg-p { display: inline-flex; } html.dev-pad .lg-k { display: none; }
  html.dev-pad .lg-nopad, html:not(.dev-pad) .lg-nokey { display: none; }
  html.dev-touch .lg-bar { display: none; }
  /* keycap: hard corners, a neon outline */
  .lg-key { display: inline-block; white-space: nowrap; min-width: 1.6em; padding: 0.3em 0.45em 0.12em; border: 2px solid rgba(46,242,255,0.75); color: #d8fdff; text-align: center;
    box-shadow: 0 0 0.5em rgba(46,242,255,0.4); background: rgba(14,4,30,0.6); font: inherit; letter-spacing: 0.08em; line-height: 1; }
  /* face button: round, the standard colors; Xbox letters unless the pad is a PlayStation */
  .lg-b { display: inline-flex; align-items: center; justify-content: center; width: 1.55em; height: 1.55em; border-radius: 50%;
    border: 2px solid var(--gc); color: var(--gc); background: rgba(14,4,30,0.7); box-shadow: 0 0 0.45em var(--gc); font: 400 0.82em/1 'Bungee', 'Arial Black', sans-serif; }
  .lg-b .lg-x { padding-top: 0.08em; }
  .lg-ps { display: none; }
  html.pad-ps .lg-b { border-color: var(--pc); color: var(--pc); box-shadow: 0 0 0.45em var(--pc); }   /* --gc is inline, so the PlayStation colors go on directly */
  html.pad-ps .lg-x { display: none; } html.pad-ps .lg-ps { display: inline; }
  html.pad-ps .lg-b .lg-ps { font: 700 1.15em/1 system-ui, sans-serif; }
  .lg-pill { --gc: #e9dcff; --pc: #e9dcff; display: inline-flex; align-items: center; height: 1.4em; padding: 0.1em 0.6em 0; border-radius: 0.7em; border: 2px solid var(--gc); color: var(--gc);
    font: 400 0.6em/1 'Bungee', 'Arial Black', sans-serif; letter-spacing: 0.06em; box-shadow: 0 0 0.4em rgba(233,220,255,0.5); }
  .lg-dpad { display: inline-flex; width: 1.3em; height: 1.3em; color: #d8fdff; filter: drop-shadow(0 0 0.25em #2ef2ff); }
  .lg-dpad svg { width: 100%; height: 100%; }
  /* the controls table */
  .lg-table { --lg: var(--lg-size, 1.6cqw); display: grid; grid-template-columns: auto auto auto; column-gap: 1.6em; row-gap: 0.3em; white-space: nowrap; align-items: center;
    font: 600 var(--lg)/1 'Teko', 'Arial Narrow', sans-serif; letter-spacing: 0.1em; color: rgba(230,214,255,0.9); text-shadow: ${PLAIN}; }
  .lg-th { font: 400 0.85em/1 'Bungee', 'Arial Black', sans-serif; color: #c8ff3a; letter-spacing: 0.04em; padding-bottom: 0.2em; }
  .lg-th.lg-col { color: rgba(214,190,255,0.8); font-size: 0.7em; }
  .lg-what { color: #fff; }
  .lg-kc .lg-key { font-size: 0.9em; }
  .lg-pc { display: flex; align-items: center; min-height: 1.75em; }
  .lg-padtext { color: #d8fdff; }
  `;
  const s = document.createElement('style');
  s.id = 'controls-style';
  s.textContent = css;
  document.head.appendChild(s);
}
