// Touch controls for phones. Self-contained: it turns thumbs into synthetic KeyboardEvents
// dispatched on window, which is where combat/input.js listens, so the game never knows
// the difference. Does nothing on a device without a touch screen.
//
//   left thumb   floating stick: left/right move (away from the opponent walks back and guards a strike that's coming), past RUN_PX adds
//                Shift, up = jump, down = crouch, down-away = crouching guard. A quick double flick the same way
//                (out, back to the middle or off the glass, out again) is a dash, forward or back: see flick() below
//   right thumb  Tekken diamond of round arcade buttons, one per limb: 1 LP (U)  2 RP (I) /
//                3 LK (J)  4 RK (K), plus GUARD (B), which means hold back (it walks back and guards what's coming). Stick + button gives
//                the directional and crouch moves; two buttons together (1+3, 2+4) throw.
//   top corner   one row of pills, the same set and order as the desktop's (src/corner.js): pause (only in a fight
//                you can pause; the flow listens for 'sf:pause'), the menu button (three bars: the SETTINGS panel in
//                src/audio/ui.js, which also sets this layer's size) and fullscreen (src/fullscreen.js). In an
//                online match LEAVE (Escape) sits where pause would, and on a ?scene= page HORDE (G) does.
//
// Every touch is tracked by its identifier, so a held stick and an attack press coexist.
// Keys are reference counted per code.
//
// Sizes are in rem, not viewport units, because a thumb is the same size on every screen. Every
// size is a multiple of --tc-u, which is 1rem times --tc-scale (set on <html>): the player's size
// from the settings panel (src/touchPrefs.js: SMALL to EXTRA LARGE), capped by fit() to what this
// screen can hold without the controls touching each other, the HUD or the safe areas.

import { touchPref, setTouchFit, onTouchPref } from './touchPrefs.js';

import { toggleFullscreen, canFullscreen, FS_ICON } from './fullscreen.js';
import { homescreenHelp, openHomescreenHelp } from './homescreen.js';   // iPhone Safari: the fullscreen pill opens the Add to Home Screen how-to   // shared with the desktop button and F11
import { PLAIN } from './plaintext.js';   // readable text never glows: the shared dark outline
import { MINI, MINI_FACE, MINI_INK, HUD_STRIP, MENU_ICON, PAUSE_ICON } from './corner.js';   // the corner buttons' size and icons, shared with the desktop row

const TARGET = window;                  // must match createInput(window) in main.js
// the stick's travel in px at scale 1 with a 16px rem; it grows and shrinks with the drawn stick,
// so the knob reaching the rim still means RUN at every size
const DEAD_PX = 14, RUN_PX = 52, VERT_PX = 26, KNOB_MAX = 56;
// the double flick (a dash): the second flick starts within FLICK_MS of the first, and the first was let go within FLICK_HOLD
const FLICK_MS = 320, FLICK_HOLD = 220, DASH_CODE = 'TouchDash';   // DASH_CODE: src/combat/input.js reads it as the input's dash bit
// The layout in rem at scale 1. The CSS below and fit() both read these, so they can't drift apart.
const D = {
  btn: 4.5,                 // a main button: 72px, about an adult thumb pad
  gap: 0.625,               // between the buttons
  base: 7.5, knob: 3.5,     // the stick
  hint: 1.375,              // room under the resting stick for MOVE
  guardW: 4.5, guardH: 3,   // GUARD beside the diamond (landscape)
  guardHP: 2.75,            // GUARD above it (portrait; its width is the button's times 1.05)
  miniW: MINI.w, miniH: MINI.h, miniGap: MINI.gap,   // the top-corner buttons
  edge: 0.75,               // the stick's distance from the screen edge
};
const MIN_SCALE = 0.6;      // fit() never goes under this, whatever the screen

// limb glyphs, stroke only so they take the button's neon color
const HAND = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 7V4.5a1 1 0 0 1 2 0V7M5 6V3.5a1 1 0 0 1 2 0V6M7 6V3.5a1 1 0 0 1 2 0V6M9 6.5V4.5a1 1 0 0 1 2 0V9c0 2.5-1.6 4-4 4S3 11.5 3 9V7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
const FOOT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2h3v7l5 1.5V13H3V9.5L5 9z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';

const isTouch = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
if (isTouch) init();

function init() {
  const KEY_NAMES = { Escape: 'Escape', KeyB: 'b', KeyA: 'a', KeyD: 'd', KeyW: 'w', KeyS: 's', KeyJ: 'j', KeyK: 'k', KeyL: 'l', KeyI: 'i', KeyU: 'u', KeyG: 'g', Semicolon: ';', ShiftLeft: 'Shift' };
  const held = new Map();               // code -> count of sources holding it
  const send = (type, code) => TARGET.dispatchEvent(new KeyboardEvent(type, { code, key: KEY_NAMES[code] || code, bubbles: true, cancelable: true }));
  const press = (code) => { const n = held.get(code) || 0; held.set(code, n + 1); if (!n) send('keydown', code); };
  const release = (code) => { const n = held.get(code) || 0; if (!n) return; if (n > 1) held.set(code, n - 1); else { held.delete(code); send('keyup', code); } };
  const tap = (code) => { send('keydown', code); send('keyup', code); };

  const de = document.documentElement;
  de.classList.add('touch-ui');
  injectStyle();   // the Bungee and Teko faces come from index.html
  // the safe-area insets in px, which script can only read off an element
  const probe = el('div', 'tc-probe');
  document.body.appendChild(probe);

  const root = el('div', 'tc-root');
  root.innerHTML = `
    <div class="tc-stickzone" data-role="stick">
      <div class="tc-base"><div class="tc-knob"></div><span class="tc-hint">MOVE</span></div>
    </div>
    <div class="tc-cluster">
      <div class="tc-small">
        <button class="tc-btn tc-sm tc-guard" data-code="KeyB" aria-label="Guard (hold back)">GUARD</button>
      </div>
      <div class="tc-grid">
        <button class="tc-btn tc-l1" data-code="KeyU" aria-label="1 left punch">${HAND}<i>1</i></button>
        <button class="tc-btn tc-l2" data-code="KeyI" aria-label="2 right punch">${HAND}<i>2</i></button>
        <button class="tc-btn tc-l3" data-code="KeyJ" aria-label="3 left kick">${FOOT}<i>3</i></button>
        <button class="tc-btn tc-l4" data-code="KeyK" aria-label="4 right kick">${FOOT}<i>4</i></button>
      </div>
    </div>
    <div class="tc-top">
      <button class="tc-btn tc-mini" data-tap="KeyG" aria-label="Toggle horde mode">HORDE</button>
      <button class="tc-btn tc-mini tc-leave" data-tap="Escape" aria-label="Leave the online match">LEAVE</button>
      <button class="tc-btn tc-mini tc-pause" data-role="pause" aria-label="Pause">${PAUSE_ICON}</button>
      <button class="tc-btn tc-mini tc-sound" data-role="settings" aria-label="Settings">${MENU_ICON}</button>
      <button class="tc-btn tc-mini" data-role="fullscreen" aria-label="Fullscreen">${FS_ICON}</button>
    </div>
    <div class="tc-rotate" role="note">
      <span>Turn your phone sideways for the full arena</span>
      <button class="tc-x" data-role="dismiss" aria-label="Dismiss">X</button>
    </div>`;
  const base = root.querySelector('.tc-base'), knob = root.querySelector('.tc-knob');
  const zone = root.querySelector('.tc-stickzone');
  const fsBtn = root.querySelector('[data-role="fullscreen"]');
  // No Fullscreen API on iPhone Safari: there the pill stays and opens the Add to Home Screen how-to (src/homescreen.js).
  // An installed app is already full screen, so it has no pill (src/fullscreen.js).
  if (homescreenHelp && !canFullscreen) fsBtn.setAttribute('aria-label', 'Play full screen: add to your home screen');
  else if (!canFullscreen) fsBtn.remove();
  try { if (sessionStorage.getItem('tc-rotate-dismissed')) root.classList.add('tc-no-rotate'); } catch {}
  let K = 1;                            // px per design px: the scale in use times rem / 16
  fit();                                // the saved size, before the layer is in the page, so it never draws at another
  document.body.appendChild(root);
  onTouchPref((source) => { if (source !== 'fit') fit(); });
  window.addEventListener('resize', fit);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);   // iOS Safari's bars sliding in and out
  window.addEventListener('orientationchange', () => { fit(); setTimeout(fit, 350); });   // iOS reports the new size late

  // ---- fitting the size to the screen ---------------------------------------------------------
  // The largest scale at which nothing touches: across, the stick and the buttons clear each other
  // and the side insets; down, the top-corner buttons, a gap and the buttons fit between the top
  // and bottom insets. The player's size is used as it is when it fits. When it doesn't (EXTRA
  // LARGE on an iPhone SE held upright, where the stick and two buttons are wider than the screen)
  // it's clamped to what does, and the panel says so.
  function fit() {
    const rem = parseFloat(getComputedStyle(de).fontSize) || 16;
    const want = touchPref().scale;
    const vw = de.clientWidth, vh = de.clientHeight;
    const ps = getComputedStyle(probe);
    const env = (side) => parseFloat(ps.getPropertyValue('padding-' + side)) || 0;
    const sl = Math.max(0.75 * rem, env('left')), sr = Math.max(0.75 * rem, env('right'));
    const st = Math.max(0.5 * rem, env('top')), sb = Math.max(0.625 * rem, env('bottom'));
    // HORDE, LEAVE and pause never show together, so the most at once is two fewer than there are
    const n = Math.max(1, root.querySelectorAll('.tc-mini').length - 2);
    const minisDown = n * D.miniH + (n - 1) * D.miniGap, minisAcross = n * D.miniW + (n - 1) * D.miniGap;
    const grid = 2 * D.btn + D.gap;
    let u, mode = '', topY = 0;         // u: the most px one scaled rem can be
    if (vh >= vw) {
      // portrait: the stage sits under a strip holding the top buttons, the controls under the stage
      const across = (vw - sl - sr) / (D.base + D.edge + 0.25 + grid);
      const strip = (vw - sl - sr) / minisAcross;
      const down = (vh - st - 0.5 * rem - vw * 9 / 16 - 0.5 * rem - sb) / (D.miniH + D.guardHP + D.gap + grid);
      u = Math.min(across, strip, down);
    } else {
      const stageW = Math.min(vw, vh * 16 / 9), stageH = stageW * 9 / 16;
      const gutter = (vw - stageW) / 2, stageTop = (vh - stageH) / 2;
      const across = (vw - sl - sr) / (D.base + D.edge + 1 + D.guardW + D.gap + grid);
      const right = Math.max(0.5 * rem, env('right'));
      // the top buttons, three ways: a column in the gutter beside the stage when the gutter is
      // wide enough for it; otherwise under the HUD strip, as a column, or as a row when a column
      // and the buttons under it are taller than the screen
      const under = stageTop + stageH * HUD_STRIP;
      const ways = [
        { mode: '', top: 0, u: Math.min(across, (vh - st - sb) / (minisDown + 0.5 + grid), (gutter - right - 0.25 * rem) / D.miniW) },
        { mode: 'hud', top: under, u: Math.min(across, (vh - under - sb) / (minisDown + 0.5 + grid)) },
        { mode: 'hud row', top: under, u: Math.min(across, (vh - under - sb) / (D.miniH + 0.5 + grid), (vw - sl - right) / minisAcross) },
      ];
      const pick = ways.find((w) => w.u >= want * rem) || ways.reduce((a, b) => (b.u > a.u + 0.01 ? b : a));
      u = pick.u; mode = pick.mode; topY = pick.top;
    }
    const scale = Math.max(MIN_SCALE, Math.floor(Math.min(want, u / rem) * 1000) / 1000);
    K = scale * rem / 16;
    de.style.setProperty('--tc-scale', String(scale));
    root.classList.toggle('tc-top-hud', mode !== '');
    root.classList.toggle('tc-top-row', mode === 'hud row');
    if (mode) root.style.setProperty('--tc-top-y', `${Math.round(topY)}px`); else root.style.removeProperty('--tc-top-y');
    setTouchFit(scale, want);
  }

  // ---- touch tracking -------------------------------------------------------------------------
  const touches = new Map();            // identifier -> { kind: 'stick'|'btn', ... }
  let stick = null;                     // { id, ox, oy, keys: Set }

  function stickKeys(dx, dy) {
    const k = new Set();
    if (dx > DEAD_PX * K) k.add('KeyD'); else if (dx < -DEAD_PX * K) k.add('KeyA');
    if (Math.abs(dx) > RUN_PX * K) k.add('ShiftLeft');
    if (dy < -VERT_PX * K && dy < -Math.abs(dx) * 0.6) k.add('KeyW');
    else if (dy > VERT_PX * K && dy > Math.abs(dx) * 0.6) k.add('KeyS');
    return k;
  }
  // The double flick. The sim ignores a touch stick's own double taps (a thumb resting on the edge of the dead zone
  // wobbles across it), so the dash is decided here, from a flick that is clearly one: the stick leaves the dead
  // zone left or right, comes back (or the thumb lifts) within FLICK_HOLD, and leaves the same way again within
  // FLICK_MS of the first. The second flick holds DASH_CODE for as long as it's out; the sim reads that with the
  // direction as the double tap (sim.js edges), with the same rules a keyboard's has. Walking and running are
  // untouched: one push is a walk, the rim is the run, and a flick held on after a forward dash runs.
  let flickDir = 0, flickAt = -1e9, flickHeld = 1e9, flickOn = 0, dashing = false;
  function flick(next) {
    const dir = next.has('KeyD') ? 1 : next.has('KeyA') ? -1 : 0, now = performance.now();
    if (dir === flickOn) return;
    if (flickOn) { flickHeld = now - flickAt; if (dashing) { dashing = false; release(DASH_CODE); } }
    if (dir) {
      if (dir === flickDir && now - flickAt <= FLICK_MS && flickHeld <= FLICK_HOLD) { dashing = true; press(DASH_CODE); flickAt = -1e9; }   // a third flick starts over
      else flickAt = now;
      flickDir = dir;
    }
    flickOn = dir;
  }
  function setStickKeys(next) {
    flick(next);   // before the direction keys go down: the dash bit and the direction land on the same step
    for (const c of stick.keys) if (!next.has(c)) release(c);
    for (const c of next) if (!stick.keys.has(c)) press(c);
    stick.keys = next;
  }
  function moveStick(t) {
    let dx = t.clientX - stick.ox, dy = t.clientY - stick.oy;
    setStickKeys(stickKeys(dx, dy));
    const d = Math.hypot(dx, dy), max = KNOB_MAX * K;
    if (d > max) { dx *= max / d; dy *= max / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    base.classList.toggle('tc-run', stick.keys.has('ShiftLeft'));
  }
  function endStick() {
    setStickKeys(new Set());
    stick = null;
    base.classList.remove('tc-on', 'tc-run');
    base.style.left = base.style.top = '';
    knob.style.transform = '';
  }

  function onStart(e) {
    for (const t of e.changedTouches) {
      const target = t.target instanceof Element ? t.target : null;
      if (!target) continue;
      const btn = target.closest('[data-code],[data-tap],[data-role]');
      if (btn && btn.dataset.code) {
        touches.set(t.identifier, { kind: 'btn', code: btn.dataset.code, el: btn });
        btn.classList.add('tc-on');
        press(btn.dataset.code);
      } else if (btn && btn.dataset.tap) {
        tap(btn.dataset.tap); flash(btn);
      } else if (btn && btn.dataset.role === 'pause') {
        window.dispatchEvent(new CustomEvent('sf:pause')); flash(btn);      // src/flow/index.js pauses the fight
      } else if (btn && btn.dataset.role === 'settings') {
        window.dispatchEvent(new CustomEvent('sf:settings')); flash(btn);   // src/audio/ui.js opens the SETTINGS panel
      } else if (btn && btn.dataset.role === 'fullscreen') {
        if (canFullscreen) toggleFullscreen(); else openHomescreenHelp();
        flash(btn);
      } else if (btn && btn.dataset.role === 'dismiss') {
        root.classList.add('tc-no-rotate');
        try { sessionStorage.setItem('tc-rotate-dismissed', '1'); } catch {}
      } else if (btn && btn.dataset.role === 'stick' && !stick) {
        // the stick floats: its centre jumps to wherever the thumb lands in the zone
        const r = zone.getBoundingClientRect();
        stick = { id: t.identifier, ox: t.clientX, oy: t.clientY, keys: new Set() };
        touches.set(t.identifier, { kind: 'stick' });
        base.style.left = `${t.clientX - r.left}px`;
        base.style.top = `${t.clientY - r.top}px`;
        base.classList.add('tc-on');
      }
    }
    if (e.cancelable) e.preventDefault();   // no synthetic mouse events, no double-tap zoom
  }
  function onMove(e) {
    for (const t of e.changedTouches) {
      const rec = touches.get(t.identifier);
      if (rec && rec.kind === 'stick' && stick && stick.id === t.identifier) moveStick(t);
    }
    if (e.cancelable) e.preventDefault();
  }
  function onEnd(e) {
    for (const t of e.changedTouches) {
      const rec = touches.get(t.identifier);
      if (!rec) continue;
      touches.delete(t.identifier);
      if (rec.kind === 'stick') endStick();
      else { rec.el.classList.remove('tc-on'); release(rec.code); }
    }
    if (e.cancelable) e.preventDefault();
  }
  function releaseAll() {
    if (stick) endStick();
    for (const rec of touches.values()) if (rec.kind === 'btn') rec.el.classList.remove('tc-on');
    touches.clear();
    for (const code of [...held.keys()]) { held.delete(code); send('keyup', code); }
  }

  const opts = { passive: false };
  root.addEventListener('touchstart', onStart, opts);
  root.addEventListener('touchmove', onMove, opts);
  root.addEventListener('touchend', onEnd, opts);
  root.addEventListener('touchcancel', onEnd, opts);
  // the rest of the page: no scroll, no pinch, no rubber band
  document.addEventListener('touchmove', (e) => { if (e.cancelable) e.preventDefault(); }, opts);
  document.addEventListener('gesturestart', (e) => e.preventDefault(), opts);   // iOS pinch
  document.addEventListener('dblclick', (e) => e.preventDefault(), opts);
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
  window.addEventListener('pagehide', releaseAll);
  window.addEventListener('blur', releaseAll);
  window.addEventListener('orientationchange', releaseAll);

  function flash(b) { b.classList.add('tc-on'); setTimeout(() => b.classList.remove('tc-on'), 140); }

  function el(tag, cls) { const n = document.createElement(tag); n.className = cls; return n; }
}

function injectStyle() {
  const u = (n) => `calc(var(--tc-u) * ${n})`;   // n rem at scale 1, scaled by the player's size
  const css = `
  html.touch-ui, html.touch-ui body {
    touch-action: none; -webkit-user-select: none; user-select: none;
    -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; overscroll-behavior: none;
  }
  /* One scaled unit for the whole layer. --tc-scale is set by fit(); the root font size is the
     browser's own, never the viewport's. The insets stay unscaled: an edge is an edge. */
  html.touch-ui {
    --tc-u: calc(1rem * var(--tc-scale, 1));
    --sl: max(0.75rem, env(safe-area-inset-left)); --sr: max(0.75rem, env(safe-area-inset-right));
    --st: max(0.5rem, env(safe-area-inset-top)); --sb: max(0.625rem, env(safe-area-inset-bottom));
    /* portrait: the strip above the stage that holds the top-corner buttons */
    --tc-strip: calc(var(--st) + ${u(D.miniH)} + 0.5rem);
  }
  html.touch-ui #stage { touch-action: none; }
  html.pad-ui .tc-stickzone, html.pad-ui .tc-cluster { display: none; }
  .tc-probe { position: fixed; left: 0; top: 0; width: 0; height: 0; visibility: hidden; pointer-events: none;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
  /* LEAVE only in an online match (src/net/online.js sets html.online). The selector outranks the
     .tc-btn and .tc-mini rules below, which set display: flex and would otherwise show it everywhere. */
  .tc-leave { --c: var(--pink); } html:not(.online) .tc-root .tc-leave { display: none; }
  /* pause only in a fight you can pause: the flow's fighting and roundEnd, never online */
  html:not(.fl-fighting):not(.fl-roundEnd) .tc-root .tc-pause, html.online .tc-root .tc-pause { display: none; }
  .tc-root {
    --btn: ${u(D.btn)}; --gap: ${u(D.gap)};
    --pink: #ff2bd6; --cyan: #2ef2ff; --amber: #ffb02e; --violet: #a66bff;
    --face: rgba(14,4,30,0.5); --ink: #fff4fd;
    position: fixed; inset: 0; z-index: 20; pointer-events: none;
    font-family: 'Bungee', 'Arial Black', Impact, system-ui, sans-serif;
  }
  .tc-root * { box-sizing: border-box; }
  .tc-btn, .tc-stickzone, .tc-rotate { pointer-events: auto; touch-action: none; }
  /* arcade buttons: round, a glowing ring in the limb's neon, the glyph and number lit in it */
  .tc-btn {
    --c: var(--violet);
    appearance: none; margin: 0; padding: 0; border: ${u(0.16)} solid var(--c); border-radius: 50%;
    background: radial-gradient(circle at 50% 38%, rgba(255,255,255,0.10), var(--face) 62%);
    color: var(--c); font: inherit;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0;
    box-shadow: 0 0 ${u(0.625)} var(--c), inset 0 0 ${u(0.625)} color-mix(in srgb, var(--c) 45%, transparent);
    text-shadow: ${PLAIN}; transition: transform 60ms, box-shadow 60ms;   /* word labels (GUARD, HORDE, LEAVE) are read: no glow */
    -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
  }
  .tc-btn svg { width: ${u(1.5)}; height: ${u(1.5)}; filter: drop-shadow(0 0 ${u(0.25)} var(--c)); }
  .tc-btn i { font-style: normal; font-size: ${u(1.125)}; line-height: 1; margin-top: ${u(0.0625)}; text-shadow: 0 0 ${u(0.375)} var(--c); }   /* the 1-4 is the button's glyph, lit like its icon */
  .tc-btn.tc-on i { text-shadow: none; }
  .tc-l1 { --c: var(--cyan); } .tc-l2 { --c: var(--pink); } .tc-l3 { --c: var(--amber); } .tc-l4 { --c: var(--violet); }
  .tc-btn.tc-on {
    background: var(--c); color: #12041f; text-shadow: none; transform: scale(0.94);
    box-shadow: 0 0 ${u(1.375)} var(--c), 0 0 ${u(2.75)} color-mix(in srgb, var(--c) 50%, transparent);
  }
  .tc-btn.tc-on svg { filter: none; }

  /* left thumb. The zone is where a press starts the stick, so it may follow the viewport, but
     it's never smaller than the resting stick with its margins. */
  .tc-stickzone { position: absolute; left: 0; bottom: 0;
    width: max(42vw, calc(var(--sl) + ${u(D.base + 2 * D.edge)}));
    height: max(min(62vh, 18.75rem), calc(var(--sb) + ${u(D.hint + D.base + D.edge)})); }
  .tc-base {
    position: absolute; left: calc(var(--sl) + ${u(D.edge + D.base / 2)}); top: calc(100% - var(--sb) - ${u(D.hint + D.base / 2)});
    width: ${u(D.base)}; height: ${u(D.base)}; margin: ${u(-D.base / 2)} 0 0 ${u(-D.base / 2)};
    border: ${u(0.125)} solid rgba(46,242,255,0.45); border-radius: 50%; background: rgba(14,4,30,0.32);
    box-shadow: 0 0 ${u(0.75)} rgba(46,242,255,0.35), inset 0 0 ${u(0.875)} rgba(46,242,255,0.18);
  }
  .tc-base.tc-on { border-color: var(--cyan); box-shadow: 0 0 ${u(1.125)} var(--cyan), inset 0 0 ${u(1.125)} rgba(46,242,255,0.3); }
  .tc-base.tc-run { border-color: var(--pink); box-shadow: 0 0 ${u(1.125)} var(--pink), inset 0 0 ${u(1.125)} rgba(255,43,214,0.3); }
  .tc-knob {
    position: absolute; left: 50%; top: 50%; width: ${u(D.knob)}; height: ${u(D.knob)}; margin: ${u(-D.knob / 2)} 0 0 ${u(-D.knob / 2)};
    border: ${u(0.16)} solid var(--cyan); border-radius: 50%;
    background: radial-gradient(circle at 50% 35%, rgba(255,255,255,0.35), rgba(46,242,255,0.25) 60%, rgba(14,4,30,0.4));
    box-shadow: 0 0 ${u(0.75)} var(--cyan);
  }
  .tc-base.tc-run .tc-knob { border-color: var(--pink); box-shadow: 0 0 ${u(0.875)} var(--pink); }
  .tc-hint { position: absolute; left: 0; right: 0; top: 100%; margin-top: ${u(0.375)}; text-align: center;
    font-size: ${u(0.75)}; line-height: 1; letter-spacing: 0.08em; color: #9df8ff; text-shadow: ${PLAIN}; opacity: 0.85; }
  .tc-base.tc-on .tc-hint { visibility: hidden; }

  /* right thumb */
  .tc-cluster { position: absolute; right: var(--sr); bottom: var(--sb); display: flex; flex-direction: column; align-items: flex-end; gap: var(--gap); }
  .tc-grid { display: grid; grid-template-columns: repeat(2, var(--btn)); grid-auto-rows: var(--btn); gap: var(--gap); }
  .tc-small { display: flex; gap: var(--gap); }
  .tc-sm { width: calc(var(--btn) * 1.05); height: ${u(D.guardHP)}; border-radius: ${u(D.guardHP / 2)}; font-size: ${u(0.8125)}; letter-spacing: 0.04em; }
  .tc-guard { --c: var(--cyan); }
  .tc-sound { --c: var(--cyan); }

  /* top corner */
  .tc-top { position: absolute; top: var(--st); right: var(--sr); display: flex; gap: ${u(D.miniGap)}; }
  .tc-mini { height: ${u(D.miniH)}; min-width: ${u(D.miniW)}; padding: 0 ${u(0.625)}; border-radius: ${u(D.miniH / 2)};
    font-size: ${u(0.6875)}; letter-spacing: 0.04em; flex-direction: row; border-width: ${u(0.125)}; }
  .tc-mini:not(.tc-on) { background: ${MINI_FACE}; color: ${MINI_INK}; }   /* the corner pill's face, the desktop row's too (src/corner.js) */
  .tc-mini svg { width: ${u(1.125)}; height: ${u(1.125)}; }

  /* portrait */
  .tc-rotate { display: none; }
  @media (orientation: portrait) {
    html.touch-ui body { align-items: flex-start; padding-top: var(--tc-strip); box-sizing: border-box; }
    .tc-stickzone { width: max(50vw, calc(var(--sl) + ${u(D.base + 2 * D.edge)})); height: max(46vh, calc(var(--sb) + ${u(D.hint + D.base + D.edge)})); }
    .tc-rotate {
      display: flex; align-items: center; gap: 0.625rem; position: absolute;
      left: var(--sl); right: var(--sr); top: calc(var(--tc-strip) + 56.25vw + 0.875rem);
      padding: 0.625rem 0.875rem; border: 0.125rem solid var(--violet); border-radius: 1.375rem; background: rgba(14,4,30,0.72);
      color: var(--ink); font-family: 'Teko', 'Arial Narrow', system-ui, sans-serif; font-size: 1.25rem; line-height: 1.1;
      box-shadow: 0 0 0.75rem rgba(166,107,255,0.5);
    }
    .tc-rotate span { flex: 1; }
    .tc-no-rotate .tc-rotate { display: none; }
    .tc-x { appearance: none; border: 0.125rem solid var(--pink); border-radius: 50%; background: transparent;
      color: var(--pink); font: inherit; font-size: 1.125rem; width: 2.125rem; height: 2.125rem; box-shadow: 0 0 0.5rem var(--pink); }
  }
  @media (orientation: landscape) {
    /* The HUD strip owns the canvas's top corners, so these stack in the pillarbox gutter when
       it's wide enough. When it isn't (an iPhone SE has none, and a notch eats it) fit() moves
       them under the HUD strip (.tc-top-hud), in a row if a column won't fit (.tc-top-row). */
    .tc-top { flex-direction: column; right: max(0.5rem, env(safe-area-inset-right)); }
    .tc-top-hud .tc-top { top: var(--tc-top-y, var(--st)); }
    .tc-top-row .tc-top { flex-direction: row; }
    .tc-mini { min-width: 0; width: ${u(D.miniW)}; padding: 0; font-size: ${u(0.625)}; justify-content: center; }
    .tc-cluster { flex-direction: row; align-items: flex-end; }
    .tc-small { flex-direction: column; }
    .tc-sm { width: ${u(D.guardW)}; height: ${u(D.guardH)}; border-radius: ${u(D.guardH / 2)}; }
  }
  /* the settings panel is open (src/audio/ui.js): the controls show behind it at their new size,
     and outside a fight they're only a picture */
  html.tc-preview:not(.fl-play) .tc-stickzone, html.tc-preview:not(.fl-play) .tc-cluster .tc-btn { pointer-events: none; }`;
  const s = document.createElement('style');
  s.id = 'touch-controls-style';
  s.textContent = css;
  document.head.appendChild(s);
}
