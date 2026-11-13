// Menu input: keyboard and gamepad turned into a handful of menu keys. Directions repeat while
// held (stick, D-pad, arrows or WASD); confirm, back, start and del fire once per press. The pad
// is polled on its own requestAnimationFrame loop, so menus work while the game is paused or the
// sim isn't stepping. Touch and mouse go straight to the buttons (src/flow/ui.js). The full table,
// and what each key means on which screen, is in src/flow/controls.js.
//
//   keyboard: arrows / WASD move, Enter or Space confirm, Escape (escape), Backspace (back), P (pause),
//             F1 (moves: the MOVE LIST, src/flow/movelist.js), Q / PageUp and E / PageDown (prevtab, nexttab:
//             the tab to the left or right on a page with tabs, SETTINGS and the MOVE LIST)
//   pad:      D-pad or left stick move, A confirm, B or Select back (Select is 'select', which the
//             flow reads as back in menus and pause in a fight), Start (start), X (del: the
//             keyboard screens' DEL), Y (moves: the MOVE LIST where a screen offers it), LB and RB (prevtab,
//             nexttab: a page's tabs, from anywhere on it, like any console game's L1/R1). The triggers do nothing.
//
// onText gets the keydown first on screens that take typing (initials, a room code); if it
// returns true the key stops there (capture phase), so it neither moves the fighter (input.js)
// nor toggles the music (M, N in src/audio/).
//
// swallow() (the flow calls it on every screen change) ignores whatever is held right now, keys
// and pad buttons and directions, until it's let go, so the press that changed screens can't
// also act on the next one.

import { setDevice, watchDevice } from './controls.js';

const KEYS = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Enter: 'confirm', NumpadEnter: 'confirm', Space: 'confirm', Escape: 'escape', Backspace: 'back', KeyP: 'pause', F1: 'moves',
  KeyQ: 'prevtab', PageUp: 'prevtab', KeyE: 'nexttab', PageDown: 'nexttab',
};
const PAD = { 0: 'confirm', 1: 'back', 2: 'del', 3: 'moves', 4: 'prevtab', 5: 'nexttab', 8: 'select', 9: 'start' };
const DIRS = new Set(['up', 'down', 'left', 'right']);
// a held pad direction: the press itself moves at once, the repeat starts after REPEAT_FIRST (longer than any
// tap, so one tap is one step) and then steps every REPEAT_EVERY. (A held key repeats at the OS's own rate.)
const REPEAT_FIRST = 250, REPEAT_EVERY = 80;

export function createMenuInput({ onKey, onActivity, onText }) {
  watchDevice();
  const keysHeld = new Set(), keysSwallowed = new Set();
  window.addEventListener('keydown', (e) => {
    onActivity();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    keysHeld.add(e.code);
    // a swallowed key's repeats are ignored; a fresh press (no repeat flag) means its keyup went
    // somewhere else (the online panel stops them), so it counts again
    if (keysSwallowed.has(e.code)) { if (e.repeat) { if (KEYS[e.code]) e.preventDefault(); return; } keysSwallowed.delete(e.code); }
    if (onText && onText(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    const k = KEYS[e.code];
    if (!k) return;
    if (k === 'moves' || e.code.startsWith('Page')) e.preventDefault();   // F1 is the browser's help otherwise
    if (e.repeat && !DIRS.has(k)) return;
    onKey(k, 'key');
  }, { capture: true });
  window.addEventListener('keyup', (e) => { keysHeld.delete(e.code); keysSwallowed.delete(e.code); }, { capture: true });
  window.addEventListener('blur', () => { keysHeld.clear(); keysSwallowed.clear(); });
  for (const t of ['pointerdown', 'touchstart', 'wheel']) window.addEventListener(t, () => onActivity(), { capture: true, passive: true });

  // ---- gamepad ----
  const prev = new Map();          // pad index -> buttons down last poll
  const padSwallowed = new Map();  // pad index -> button indices to ignore until let go
  const held = {};   // pad index + direction -> next repeat time (Infinity: swallowed until let go)
  let lastDirs = new Map();        // pad index -> directions down last poll
  function poll(now) {
    requestAnimationFrame(poll);
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const g of gps) {
      if (!g || !g.connected) continue;
      const b = g.buttons.map(x => !!x && (x.pressed || x.value > 0.5));
      const was = prev.get(g.index) || [];
      prev.set(g.index, b);
      const sw = padSwallowed.get(g.index);
      if (sw) for (const i of [...sw]) if (!b[i]) sw.delete(i);
      const edge = (i) => b[i] && !was[i] && !(sw && sw.has(i));
      const ax = g.axes[0] || 0, ay = g.axes[1] || 0;
      if (b.some((d, i) => d && !was[i]) || Math.abs(ax) > 0.5 || Math.abs(ay) > 0.5) { onActivity(); setDevice('pad', g); }
      else if (b.some((d, i) => d !== !!was[i])) onActivity();
      for (const i in PAD) if (edge(+i)) onKey(PAD[i], 'pad');
      const dirs = {
        up: b[12] || ay < -0.6, down: b[13] || ay > 0.6, left: b[14] || ax < -0.6, right: b[15] || ax > 0.6,
      };
      lastDirs.set(g.index, dirs);
      for (const d in dirs) {
        const key = g.index + d;
        if (!dirs[d]) { delete held[key]; continue; }
        if (held[key] === undefined) { held[key] = now + REPEAT_FIRST; onKey(d, 'pad'); }
        else if (now >= held[key]) { held[key] = now + REPEAT_EVERY; onKey(d, 'pad'); }
      }
    }
  }
  if (typeof navigator !== "undefined" && "getGamepads" in navigator) requestAnimationFrame(poll);

  function swallow() {
    for (const c of keysHeld) keysSwallowed.add(c);
    for (const [i, b] of prev) padSwallowed.set(i, new Set(b.map((d, k) => (d ? k : -1)).filter(k => k >= 0)));
    for (const [i, dirs] of lastDirs) for (const d in dirs) if (dirs[d]) held[i + d] = Infinity;
  }
  return { swallow };
}
