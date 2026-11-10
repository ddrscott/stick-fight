// Touch controls for phones. Self-contained: it turns thumbs into synthetic KeyboardEvents
// dispatched on window, which is where combat/input.js listens, so the game never knows
// the difference. Does nothing on a device without a touch screen.
//
//   left thumb   floating stick: left/right move (away from the opponent walks back and guards a strike that's coming), past RUN_PX adds
//                Shift, up = jump, down = crouch, down-away = crouching guard
//   right thumb  Tekken diamond of round arcade buttons, one per limb: 1 LP (U)  2 RP (I) /
//                3 LK (J)  4 RK (K), plus GUARD (B), which means hold back (it walks back and guards what's coming). Stick + button gives
//                the directional and crouch moves; two buttons together (1+3, 2+4) throw.
//   top corner   HORDE (G), SOUND (the src/audio/ui.js settings panel) and fullscreen (src/fullscreen.js); in an online
//                match HORDE gives way to LEAVE (Escape)
//
// Every touch is tracked by its identifier, so a held stick and an attack press coexist.
// Keys are reference counted per code.

import { toggleFullscreen, canFullscreen, FS_ICON } from './fullscreen.js';   // shared with the desktop button and F11

const TARGET = window;                  // must match createInput(window) in main.js
const DEAD_PX = 14, RUN_PX = 52, VERT_PX = 26, KNOB_MAX = 56;

// limb glyphs, stroke only so they take the button's neon color
const HAND = '<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path d="M3 7V4.5a1 1 0 0 1 2 0V7M5 6V3.5a1 1 0 0 1 2 0V6M7 6V3.5a1 1 0 0 1 2 0V6M9 6.5V4.5a1 1 0 0 1 2 0V9c0 2.5-1.6 4-4 4S3 11.5 3 9V7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
const FOOT = '<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path d="M5 2h3v7l5 1.5V13H3V9.5L5 9z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';

const isTouch = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
if (isTouch) init();

function init() {
  const KEY_NAMES = { Escape: 'Escape', KeyB: 'b', KeyA: 'a', KeyD: 'd', KeyW: 'w', KeyS: 's', KeyJ: 'j', KeyK: 'k', KeyL: 'l', KeyI: 'i', KeyU: 'u', KeyG: 'g', Semicolon: ';', ShiftLeft: 'Shift' };
  const held = new Map();               // code -> count of sources holding it
  const send = (type, code) => TARGET.dispatchEvent(new KeyboardEvent(type, { code, key: KEY_NAMES[code] || code, bubbles: true, cancelable: true }));
  const press = (code) => { const n = held.get(code) || 0; held.set(code, n + 1); if (!n) send('keydown', code); };
  const release = (code) => { const n = held.get(code) || 0; if (!n) return; if (n > 1) held.set(code, n - 1); else { held.delete(code); send('keyup', code); } };
  const tap = (code) => { send('keydown', code); send('keyup', code); };

  document.documentElement.classList.add('touch-ui');
  injectStyle();   // the Bungee and Teko faces come from index.html

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
      <button class="tc-btn tc-mini tc-sound" data-role="sound" aria-label="Sound settings">SND</button>
      <button class="tc-btn tc-mini" data-role="fullscreen" aria-label="Fullscreen">${FS_ICON}</button>
    </div>
    <div class="tc-rotate" role="note">
      <span>Turn your phone sideways for the full arena</span>
      <button class="tc-x" data-role="dismiss" aria-label="Dismiss">X</button>
    </div>`;
  document.body.appendChild(root);

  const base = root.querySelector('.tc-base'), knob = root.querySelector('.tc-knob');
  const zone = root.querySelector('.tc-stickzone');
  const fsBtn = root.querySelector('[data-role="fullscreen"]');
  if (!canFullscreen) fsBtn.remove();   // iPhone Safari has no Fullscreen API; an installed app is already full screen (src/fullscreen.js)
  try { if (sessionStorage.getItem('tc-rotate-dismissed')) root.classList.add('tc-no-rotate'); } catch {}

  // ---- touch tracking -------------------------------------------------------------------------
  const touches = new Map();            // identifier -> { kind: 'stick'|'btn', ... }
  let stick = null;                     // { id, ox, oy, keys: Set }

  function stickKeys(dx, dy) {
    const k = new Set();
    if (dx > DEAD_PX) k.add('KeyD'); else if (dx < -DEAD_PX) k.add('KeyA');
    if (Math.abs(dx) > RUN_PX) k.add('ShiftLeft');
    if (dy < -VERT_PX && dy < -Math.abs(dx) * 0.6) k.add('KeyW');
    else if (dy > VERT_PX && dy > Math.abs(dx) * 0.6) k.add('KeyS');
    return k;
  }
  function setStickKeys(next) {
    for (const c of stick.keys) if (!next.has(c)) release(c);
    for (const c of next) if (!stick.keys.has(c)) press(c);
    stick.keys = next;
  }
  function moveStick(t) {
    let dx = t.clientX - stick.ox, dy = t.clientY - stick.oy;
    setStickKeys(stickKeys(dx, dy));
    const d = Math.hypot(dx, dy);
    if (d > KNOB_MAX) { dx *= KNOB_MAX / d; dy *= KNOB_MAX / d; }
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
      } else if (btn && btn.dataset.role === 'sound') {
        window.dispatchEvent(new CustomEvent('sf:sound-panel')); flash(btn);   // src/audio/ui.js opens its panel
      } else if (btn && btn.dataset.role === 'fullscreen') {
        toggleFullscreen(); flash(btn);
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
  const css = `
  html.touch-ui, html.touch-ui body {
    touch-action: none; -webkit-user-select: none; user-select: none;
    -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; overscroll-behavior: none;
  }
  html.touch-ui #stage { touch-action: none; }
  html.pad-ui .tc-stickzone, html.pad-ui .tc-cluster { display: none; }
  /* LEAVE only in an online match (src/net/online.js sets html.online). The selector outranks the
     .tc-btn and .tc-mini rules below, which set display: flex and would otherwise show it everywhere. */
  .tc-leave { --c: var(--pink); } html:not(.online) .tc-root .tc-leave { display: none; }
  .tc-root {
    --btn: clamp(58px, 18vmin, 74px); --gap: 10px;
    --pink: #ff2bd6; --cyan: #2ef2ff; --amber: #ffb02e; --violet: #a66bff;
    --face: rgba(14,4,30,0.5); --ink: #fff4fd;
    --sl: max(12px, env(safe-area-inset-left)); --sr: max(12px, env(safe-area-inset-right));
    --st: max(8px, env(safe-area-inset-top)); --sb: max(10px, env(safe-area-inset-bottom));
    position: fixed; inset: 0; z-index: 20; pointer-events: none;
    font-family: 'Bungee', 'Arial Black', Impact, system-ui, sans-serif;
  }
  .tc-root * { box-sizing: border-box; }
  .tc-btn, .tc-stickzone, .tc-rotate { pointer-events: auto; touch-action: none; }
  /* arcade buttons: round, a glowing ring in the limb's neon, the glyph and number lit in it */
  .tc-btn {
    --c: var(--violet);
    appearance: none; margin: 0; padding: 0; border: 2.5px solid var(--c); border-radius: 50%;
    background: radial-gradient(circle at 50% 38%, rgba(255,255,255,0.10), var(--face) 62%);
    color: var(--c); font: inherit;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0;
    box-shadow: 0 0 10px var(--c), inset 0 0 10px color-mix(in srgb, var(--c) 45%, transparent);
    text-shadow: 0 0 6px var(--c); transition: transform 60ms, box-shadow 60ms;
    -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
  }
  .tc-btn svg { filter: drop-shadow(0 0 4px var(--c)); }
  .tc-btn i { font-style: normal; font-size: 15px; line-height: 1; margin-top: 1px; }
  .tc-l1 { --c: var(--cyan); } .tc-l2 { --c: var(--pink); } .tc-l3 { --c: var(--amber); } .tc-l4 { --c: var(--violet); }
  .tc-btn.tc-on {
    background: var(--c); color: #12041f; text-shadow: none; transform: scale(0.94);
    box-shadow: 0 0 22px var(--c), 0 0 44px color-mix(in srgb, var(--c) 50%, transparent);
  }
  .tc-btn.tc-on svg { filter: none; }

  /* left thumb */
  .tc-stickzone { position: absolute; left: 0; bottom: 0; width: 42vw; height: min(62vh, 300px); }
  .tc-base {
    position: absolute; left: calc(var(--sl) + 70px); top: calc(100% - var(--sb) - 70px);
    width: 116px; height: 116px; margin: -58px 0 0 -58px;
    border: 2px solid rgba(46,242,255,0.45); border-radius: 50%; background: rgba(14,4,30,0.32);
    box-shadow: 0 0 12px rgba(46,242,255,0.35), inset 0 0 14px rgba(46,242,255,0.18);
  }
  .tc-base.tc-on { border-color: var(--cyan); box-shadow: 0 0 18px var(--cyan), inset 0 0 18px rgba(46,242,255,0.3); }
  .tc-base.tc-run { border-color: var(--pink); box-shadow: 0 0 18px var(--pink), inset 0 0 18px rgba(255,43,214,0.3); }
  .tc-knob {
    position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px;
    border: 2.5px solid var(--cyan); border-radius: 50%;
    background: radial-gradient(circle at 50% 35%, rgba(255,255,255,0.35), rgba(46,242,255,0.25) 60%, rgba(14,4,30,0.4));
    box-shadow: 0 0 12px var(--cyan);
  }
  .tc-base.tc-run .tc-knob { border-color: var(--pink); box-shadow: 0 0 14px var(--pink); }
  .tc-hint { position: absolute; left: 0; right: 0; top: 100%; margin-top: 6px; text-align: center;
    font-size: 11px; letter-spacing: 0.08em; color: var(--cyan); text-shadow: 0 0 6px var(--cyan); opacity: 0.75; }
  .tc-base.tc-on .tc-hint { visibility: hidden; }

  /* right thumb */
  .tc-cluster { position: absolute; right: var(--sr); bottom: var(--sb); display: flex; flex-direction: column; align-items: flex-end; gap: var(--gap); }
  .tc-grid { display: grid; grid-template-columns: repeat(2, var(--btn)); grid-auto-rows: var(--btn); gap: var(--gap); }
  .tc-small { display: flex; gap: var(--gap); }
  .tc-sm { width: calc(var(--btn) * 1.05); height: 38px; border-radius: 19px; font-size: 12px; letter-spacing: 0.04em; }
  .tc-guard { --c: var(--cyan); }
  .tc-sound { --c: var(--cyan); }

  /* top corner */
  .tc-top { position: absolute; top: var(--st); right: var(--sr); display: flex; gap: 8px; }
  .tc-mini { height: 32px; min-width: 44px; padding: 0 10px; border-radius: 16px; font-size: 11px; letter-spacing: 0.04em; flex-direction: row; border-width: 2px; }

  /* portrait */
  .tc-rotate { display: none; }
  @media (orientation: portrait) {
    html.touch-ui body { align-items: flex-start; padding-top: calc(env(safe-area-inset-top) + 48px); box-sizing: border-box; }
    .tc-root { --btn: clamp(64px, 19vw, 78px); }
    .tc-stickzone { width: 50vw; height: 46vh; }
    .tc-base { left: calc(var(--sl) + 78px); top: calc(100% - var(--sb) - 96px); }
    .tc-rotate {
      display: flex; align-items: center; gap: 10px; position: absolute;
      left: var(--sl); right: var(--sr); top: calc(env(safe-area-inset-top) + 48px + 56.25vw + 14px);
      padding: 10px 14px; border: 2px solid var(--violet); border-radius: 22px; background: rgba(14,4,30,0.72);
      color: var(--ink); font-family: 'Teko', 'Arial Narrow', system-ui, sans-serif; font-size: 20px; line-height: 1.1;
      box-shadow: 0 0 12px rgba(166,107,255,0.5);
    }
    .tc-rotate span { flex: 1; }
    .tc-no-rotate .tc-rotate { display: none; }
    .tc-x { appearance: none; border: 2px solid var(--pink); border-radius: 50%; background: transparent;
      color: var(--pink); font: inherit; font-size: 18px; width: 34px; height: 34px; box-shadow: 0 0 8px var(--pink); }
  }
  @media (orientation: landscape) {
    /* the HUD strip owns the canvas's top corners, so these stack in the pillarbox gutter */
    .tc-root { --btn: clamp(52px, 16vmin, 72px); }
    .tc-top { flex-direction: column; right: max(8px, env(safe-area-inset-right)); }
    .tc-mini { min-width: 0; width: 54px; padding: 0; font-size: 10px; justify-content: center; }
    .tc-cluster { flex-direction: row; align-items: flex-end; }
    .tc-small { flex-direction: column; }
    .tc-sm { width: 64px; height: 44px; border-radius: 22px; }
  }`;
  const s = document.createElement('style');
  s.id = 'touch-controls-style';
  s.textContent = css;
  document.head.appendChild(s);
}
