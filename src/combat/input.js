// Keyboard + gamepad for P1. snapshot() returns held state; the sim derives press edges
// per fixed step, so a key that goes down between steps is seen on the very next step.
//
// Tekken layout, one button per limb from the fighter's own point of view:
//   U = 1 left punch   I = 2 right punch   J = 3 left kick   K = 4 right kick
//   A/D or arrows move (forward/back are relative to facing); holding back (away from the
//   opponent) is standing guard, against highs and mids     W / up jump
//   S / down: crouch (ducks highs); down-back guards lows; down + a button = crouch attacks,
//   release down + 2 or 4 = rising uppercut / rising knee
//   1+3 or 2+4 together: throw (the same press breaks a throw)     Shift: run
//   B: guard, the same as holding back (the touch BLOCK button sends it)
// Gamepad (USB or Bluetooth, standard mapping): X / Y / A / B = 1 / 2 / 3 / 4, D-pad or left
//   stick moves, L1 / L2 guard, R1 throw (1+3), R2 run, Start pause, Select restart, R3 horde.
//   While a pad is in use <html> gets .pad-ui, which hides the touch buttons; a touch brings
//   them back.
// onPad(fn) hears every pad button press edge (the attract mode starts a game on any button);
// swallowHeld() hides whatever is held right now until it's let go, so the key or button that
// started a game doesn't also throw a punch.

export const KEYMAP = {
  left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['KeyW', 'ArrowUp', 'Space'], down: ['KeyS', 'ArrowDown'],
  lp: ['KeyU'], rp: ['KeyI'], lk: ['KeyJ'], rk: ['KeyK'],
  run: ['ShiftLeft', 'ShiftRight'], guard: ['KeyB'],
};
const CAPTURED = new Set(Object.values(KEYMAP).flat());

export const EMPTY_INPUT = Object.freeze({ dx: 0, jump: false, block: false, down: false, run: false, lp: false, rp: false, lk: false, rk: false });

export function createInput(target = window) {
  const held = new Set();
  const hooks = [], padHooks = [];
  const swallowed = new Set();   // key codes held when swallowHeld() ran, until their keyup
  let padSwallow = new Set();    // pad button indices, likewise
  target.addEventListener('keydown', (e) => {
    if (CAPTURED.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    held.add(e.code);
    for (const h of hooks) h(e.code);
  });
  target.addEventListener('keyup', (e) => { held.delete(e.code); swallowed.delete(e.code); });
  target.addEventListener('blur', () => { held.clear(); swallowed.clear(); });

  // The pad in use: the one pressed most recently, preferring standard-mapped pads (phones
  // and some browsers also list motion sensors or remotes as pads).
  let active = -1;
  function pad() {
    const gps = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : null;
    if (!gps) return null;
    let best = null;
    for (const g of gps) {
      if (!g || !g.connected) continue;
      if (g.index === active) return g;
      if (!best || (g.mapping === 'standard' && best.mapping !== 'standard')) best = g;
    }
    return best;
  }
  const PRESS_AT = 0.5;   // analog triggers count past halfway
  const isDown = (g, i) => { const b = g.buttons[i]; return !!b && (b.pressed || b.value > PRESS_AT); };

  // Menu buttons fire the same hotkeys as the keyboard, on the press edge. Polled from a
  // light rAF loop so they still work while the game is paused (the sim stops asking).
  const HOTKEYS = { 9: 'KeyP', 8: 'KeyR', 11: 'KeyG' };
  const prev = new Map();   // pad index -> buttons held last poll
  function setPadUI(on) {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('pad-ui', on);
  }
  function poll() {
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const g of gps) {
      if (!g || !g.connected) continue;
      const was = prev.get(g.index) || [];
      const now = g.buttons.map((_, i) => isDown(g, i));
      const moved = Math.abs(g.axes[0] || 0) > 0.5 || Math.abs(g.axes[1] || 0) > 0.5;
      if (now.some((d, i) => d && !was[i]) || moved) {
        if (g.mapping === 'standard' || active < 0) active = g.index;
        setPadUI(true);
      }
      if (g.index === active) for (const i in HOTKEYS) if (now[i] && !was[i]) for (const h of hooks) h(HOTKEYS[i]);
      for (let i = 0; i < now.length; i++) if (now[i] && !was[i]) for (const h of padHooks) h(i, g);
      prev.set(g.index, now);
    }
    requestAnimationFrame(poll);
  }
  if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.getGamepads) {
    window.addEventListener('gamepaddisconnected', (e) => {
      prev.delete(e.gamepad.index);
      if (e.gamepad.index === active) { active = -1; setPadUI(false); }
    });
    // a thumb on the glass means the player put the pad down
    window.addEventListener('touchstart', () => setPadUI(false), { passive: true, capture: true });
    requestAnimationFrame(poll);
  }

  function snapshot() {
    const on = (k) => KEYMAP[k].some(c => held.has(c) && !swallowed.has(c));
    const down = on('down');
    const s = { dx: (on('right') ? 1 : 0) - (on('left') ? 1 : 0), jump: on('jump'), block: on('guard'), down, run: on('run'),
      lp: on('lp'), rp: on('rp'), lk: on('lk'), rk: on('rk'),
      // the touch layer's stick provides run; a wobbling thumb must not double-tap into one
      touch: typeof document !== 'undefined' && document.documentElement.classList.contains('touch-ui') && !document.documentElement.classList.contains('pad-ui') };
    const g = pad();
    if (g) {
      for (const i of padSwallow) if (!isDown(g, i)) padSwallow.delete(i);
      const b = (i) => isDown(g, i) && !padSwallow.has(i);
      const ax = g.axes[0] || 0, ay = g.axes[1] || 0;
      // stick: a 0.4 deadzone, so a 45-degree down-back (0.7, 0.7) is both crouch and back
      const gdx = (b(15) ? 1 : 0) - (b(14) ? 1 : 0) || (Math.abs(ax) > 0.4 ? Math.sign(ax) : 0);
      if (gdx) s.dx = gdx;
      s.jump = s.jump || b(12) || ay < -0.6;
      s.down = s.down || b(13) || ay > 0.5;
      s.block = s.block || b(4) || b(6);
      s.run = s.run || b(7);
      // standard mapping: A0 B1 X2 Y3  ->  X/Y/A/B = 1/2/3/4; R1 is a one-button 1+3 throw
      const throwBtn = b(5);
      s.lp = s.lp || b(2) || throwBtn; s.rp = s.rp || b(3); s.lk = s.lk || b(0) || throwBtn; s.rk = s.rk || b(1);
    }
    // a mirrored view (the ?mirror=1 debug view; online never mirrors): right on the screen is left in the world. Flipped
    // here, at capture, so the sim and the lockstep only ever see world directions and both machines
    // record the same input. Keyboard, pad and the touch stick (synthetic keys) all come through here.
    if (api.mirror && s.dx) s.dx = -s.dx;
    return s;
  }

  function swallowHeld() {
    for (const c of held) swallowed.add(c);
    const g = pad();
    padSwallow = new Set(g ? g.buttons.map((_, i) => (isDown(g, i) ? i : -1)).filter(i => i >= 0) : []);
  }

  const api = { snapshot, held, swallowHeld, onKey: (fn) => hooks.push(fn), onPad: (fn) => padHooks.push(fn), mirror: false };
  return api;
}
