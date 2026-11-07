// Menu input: keyboard and gamepad turned into a handful of menu keys. Directions repeat while
// held (stick, D-pad, arrows or WASD); confirm, back and start fire once per press. The pad is
// polled on its own requestAnimationFrame loop, so menus work while the game is paused or the
// sim isn't stepping. Touch and mouse go straight to the buttons (src/flow/ui.ts).
//
//   keyboard: arrows / WASD move, Enter or Space confirm, Escape (escape), Backspace (back), P (pause)
//   pad:      D-pad or left stick move, A confirm, B back, Start (start)
//
// onText gets the keydown first on screens that take typing (initials, a room code); if it
// returns true the key stops there (capture phase), so it neither moves the fighter (input.js)
// nor toggles the music (M, N in src/audio/).

const KEYS = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Enter: 'confirm', NumpadEnter: 'confirm', Space: 'confirm', Escape: 'escape', Backspace: 'back', KeyP: 'pause',
};
const DIRS = new Set(['up', 'down', 'left', 'right']);
const REPEAT_FIRST = 380, REPEAT_EVERY = 110;

export function createMenuInput({ onKey, onActivity, onText }) {
  window.addEventListener('keydown', (e) => {
    onActivity();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (onText && onText(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    const k = KEYS[e.code];
    if (!k) return;
    if (e.repeat && !DIRS.has(k)) return;
    onKey(k, 'key');
  }, { capture: true });
  for (const t of ['pointerdown', 'touchstart', 'wheel']) window.addEventListener(t, () => onActivity(), { capture: true, passive: true });

  // ---- gamepad ----
  const prev = new Map ();
  const held = {};   // direction -> next repeat time
  function poll(now) {
    requestAnimationFrame(poll);
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const g of gps) {
      if (!g || !g.connected) continue;
      const b = g.buttons.map(x => !!x && (x.pressed || x.value > 0.5));
      const was = prev.get(g.index) || [];
      prev.set(g.index, b);
      const edge = (i) => b[i] && !was[i];
      const ax = g.axes[0] || 0, ay = g.axes[1] || 0;
      if (b.some((d, i) => d !== !!was[i]) || Math.abs(ax) > 0.5 || Math.abs(ay) > 0.5) onActivity();
      if (edge(0)) onKey('confirm', 'pad');
      if (edge(1)) onKey('back', 'pad');
      if (edge(9)) onKey('start', 'pad');
      const dirs = {
        up: b[12] || ay < -0.6, down: b[13] || ay > 0.6, left: b[14] || ax < -0.6, right: b[15] || ax > 0.6,
      };
      for (const d in dirs) {
        const key = g.index + d;
        if (!dirs[d]) { delete held[key]; continue; }
        if (held[key] === undefined) { held[key] = now + REPEAT_FIRST; onKey(d, 'pad'); }
        else if (now >= held[key]) { held[key] = now + REPEAT_EVERY; onKey(d, 'pad'); }
      }
    }
  }
  if (typeof navigator !== "undefined" && "getGamepads" in navigator) requestAnimationFrame(poll);
}
