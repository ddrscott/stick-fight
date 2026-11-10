// Fullscreen: one toggle for the touch layer's button (src/touch.js), the desktop corner button and F11.
//
//   F11             toggles the Fullscreen API on <html> instead of the browser's own F11 full screen, from every
//                   screen. The key never reaches the game: no menu, attract screen or fighter sees it.
//   corner button   desktop only, the last of the corner buttons in the stage's top right, after the menu
//                   button (src/corner.js). A touch screen keeps the touch layer's own (html.touch-ui hides the row).
//   Esc             leaves fullscreen the browser's way; the icon follows through fullscreenchange.
//
// Nothing is offered where it can't work: no Fullscreen API (iPhone Safari), an installed app (already full
// screen), or a frame that isn't allowed fullscreen (document.fullscreenEnabled is false there; the homepage's
// frame allows it). <html> gets .fs-ok when it can work and .fs-on while fullscreen is on; the HUD's key hints
// (src/combat/hud.js) read .fs-ok.
import { install } from './install.js';
import { cornerButton } from './corner.js';

const doc = typeof document !== 'undefined' ? document : null;
const de = doc ? doc.documentElement : null;
const request = de ? (de.requestFullscreen || /** @type {any} */ (de).webkitRequestFullscreen) : null;
const exit = doc ? (doc.exitFullscreen || /** @type {any} */ (doc).webkitExitFullscreen) : null;
const allowed = () => { const d = /** @type {any} */ (doc); return (d.fullscreenEnabled ?? d.webkitFullscreenEnabled ?? true) !== false; };

/** true where the toggle can do something */
export const canFullscreen = !!(request && exit) && !install.standalone && allowed();
export const isFullscreen = () => !!doc && !!(doc.fullscreenElement || /** @type {any} */ (doc).webkitFullscreenElement);

/** the four corner brackets, and the same turned inward while fullscreen is on (html.fs-on swaps them) */
export const FS_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path class="fs-enter" d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/><path class="fs-exit" d="M2 6h4V2M10 2v4h4M14 10h-4v4M6 14v-4H2"/></svg>';

/** into fullscreen, or back out. Needs a user gesture (a key, a click, a touch). */
export function toggleFullscreen() {
  if (!canFullscreen) return;
  try {
    let p;
    if (isFullscreen()) p = exit.call(doc);
    else {
      p = request.call(de, { navigationUI: 'hide' });
      // a phone turns to landscape where it can; a desktop has no lock and the refusal is swallowed
      const so = /** @type {any} */ (screen.orientation);
      Promise.resolve(p).then(() => so && so.lock && so.lock('landscape')).catch(() => {});
    }
    Promise.resolve(p).catch(() => {});
  } catch { /* refused: nothing to do */ }
}

if (doc && typeof window !== 'undefined') {
  // F11 belongs to this module on every screen. Capture on window, and main.js imports this first, so no
  // other key handler (the input, the menus, the attract screen's "any key") ever sees it.
  const f11 = (/** @type {KeyboardEvent} */ e) => {
    if (e.code !== 'F11' || !e.isTrusted) return;
    e.stopImmediatePropagation();
    if (!canFullscreen) return;   // the browser's own F11 is all there is
    e.preventDefault();
    if (e.type === 'keydown' && !e.repeat) toggleFullscreen();
  };
  window.addEventListener('keydown', f11, { capture: true });
  window.addEventListener('keyup', f11, { capture: true });

  if (canFullscreen) {
    de.classList.add('fs-ok');
    const sync = () => {
      const on = isFullscreen();
      de.classList.toggle('fs-on', on);
      for (const b of doc.querySelectorAll('.sf-fs, [data-role="fullscreen"]')) {
        b.setAttribute('aria-label', on ? 'Exit fullscreen (F11)' : 'Fullscreen (F11)');
        if (b.classList.contains('sf-fs')) b.setAttribute('title', on ? 'EXIT FULLSCREEN  F11' : 'FULLSCREEN  F11');
      }
    };
    doc.addEventListener('fullscreenchange', sync);
    doc.addEventListener('webkitfullscreenchange', sync);

    const style = doc.createElement('style');
    style.id = 'sf-fs-style';
    // the button's look and place are the corner row's (src/corner.js); only the icon's two states are here
    style.textContent = `
  .fs-exit, html.fs-on .fs-enter { display: none; }
  html.fs-on .fs-exit { display: inline; }`;
    doc.head.appendChild(style);

    // "sf-" keeps the attract screen's tap-to-start off it (main.js), like the menu button
    const btn = cornerButton('sf-fs', 'Fullscreen (F11)', 3, FS_ICON);
    btn.tabIndex = -1;   // never focused, so Space or Enter in a fight can't press it
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleFullscreen(); });
    sync();
  }
}
