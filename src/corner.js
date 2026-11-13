// The corner buttons: pause, settings (a gear: opens the SETTINGS page, src/audio/ui.js) and fullscreen
// (src/fullscreen.js). One set, one look, one order, top right on every screen:
//
//   touch     src/touch.js draws them in its own layer (.tc-top), scaled with the player's controls
//             size: a column in the gutter beside the stage held sideways, a row in the strip above
//             the stage held upright
//   desktop   a row inside the stage (.sf-top, below). At 16:9 there is no gutter, and while the HUD
//             is up the top corner itself is P2's health bar, name and move line, so the row sits
//             right under the HUD strip then (html.fl-hud, or any page without the flow) and in
//             the corner proper on the menus, where it would otherwise sit on a menu's own panel
//
// This module holds what the two share, so they can't drift apart: the pill's size, the icons, and
// the icon's states. Every class starts with "sf-", which is how main.js keeps the attract screen's
// tap-to-start off them.

/** a corner button in rem at scale 1: a pill, its radius half its height */
export const MINI = { w: 3.5, h: 2.25, gap: 0.5 };
/** a flat dark face and an icon lifted toward white: the pill has to read over a lit room, not only in a dark gutter */
export const MINI_FACE = 'rgba(10,3,22,0.88)', MINI_INK = 'color-mix(in srgb, var(--c) 62%, #fff)';
/** the HUD's bars, names and move line: the top of the stage, as a share of its height */
export const HUD_STRIP = 0.14;

const svg = (body) => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">${body}</svg>`;
/** a gear: the way into SETTINGS everywhere (a hamburger reads as "menu", and this opens settings). With SOUND off
 *  (.sf-muted on the button) a small X sits on its lower right and the button turns pink. */
export const MENU_ICON = svg('<g class="sf-gear"><circle cx="8" cy="8" r="5.9" stroke-width="2.3" stroke-dasharray="2.32 2.32" stroke-linecap="butt"/><circle cx="8" cy="8" r="3.9" stroke-width="2"/></g><path class="sf-x" stroke-width="2" d="M10.6 10.6l4 4M14.6 10.6l-4 4"/>');
export const PAUSE_ICON = svg('<path stroke-width="2.6" stroke-linecap="butt" d="M5.2 3v10M10.8 3v10"/>');

const doc = typeof document !== 'undefined' ? document : null;
if (doc && !doc.getElementById('sf-corner-style')) {
  const s = doc.createElement('style');
  s.id = 'sf-corner-style';
  s.textContent = `
  /* the menu icon's muted cue, on the desktop button and the touch layer's */
  .sf-x { display: none; }
  .sf-muted .sf-gear { opacity: 0.55; } .sf-muted .sf-x { display: inline; }
  .sf-muted.sf-muted { --c: #ff2bd6; }
  /* the desktop row: under the HUD strip, so it never covers P2's bar, name or move line; on a menu with no
     HUD (the flow is on and the screen isn't one of its HUD screens) it's in the corner itself */
  html.flow-on:not(.fl-hud) .sf-top { top: 1.4%; }
  .sf-top { position: absolute; top: ${(HUD_STRIP * 100 + 0.8).toFixed(1)}%; right: 0.8%; z-index: 5; display: flex; align-items: center; gap: ${MINI.gap}rem; pointer-events: none; }
  html.touch-ui .sf-top { display: none; }
  /* the touch layer's pill (.tc-mini in src/touch.js) at scale 1, a little dim until the mouse is on it */
  .sf-mini { --c: #a66bff; order: var(--o, 9); appearance: none; margin: 0; padding: 0; width: ${MINI.w}rem; height: ${MINI.h}rem;
    display: flex; align-items: center; justify-content: center; cursor: pointer; pointer-events: auto;
    border: 0.125rem solid var(--c); border-radius: ${MINI.h / 2}rem; color: ${MINI_INK}; background: ${MINI_FACE};
    box-shadow: 0 0 0.625rem var(--c), inset 0 0 0.625rem color-mix(in srgb, var(--c) 45%, transparent);
    -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); opacity: 0.95; transition: opacity 120ms, transform 60ms; }
  .sf-mini:hover, .sf-mini:focus-visible { opacity: 1; outline: none; }
  .sf-mini:active { background: var(--c); color: #12041f; transform: scale(0.94); }
  .sf-mini svg { width: 1.125rem; height: 1.125rem; filter: drop-shadow(0 0 0.25rem var(--c)); }
  .sf-mini:active svg { filter: none; }
  .sf-menu { --c: #2ef2ff; }
  /* pause: only in a fight you can pause (never online, which has LEAVE) */
  .sf-top .sf-pause { display: none; }
  html.fl-fighting:not(.online) .sf-top .sf-pause, html.fl-roundEnd:not(.online) .sf-top .sf-pause { display: flex; }`;
  doc.head.appendChild(s);
}

/** the desktop row, made on first use */
export function cornerRow() {
  let row = doc.getElementById('sf-top');
  if (!row) {
    row = doc.createElement('div');
    row.id = 'sf-top'; row.className = 'sf-top';
    (doc.getElementById('stage') || doc.body).appendChild(row);
  }
  return row;
}

/**
 * A desktop corner button. `order` is its place in the row (1 pause, 2 menu, 3 fullscreen), whichever module
 * makes its button first. A click never leaves the focus on it, so Space or Enter in a fight can't press it again.
 */
export function cornerButton(cls, label, order, icon) {
  const b = doc.createElement('button');
  b.className = `sf-mini ${cls}`; b.type = 'button';
  b.setAttribute('aria-label', label);
  b.style.setProperty('--o', String(order));
  b.innerHTML = icon;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', () => b.blur());
  cornerRow().appendChild(b);
  return b;
}
