// The flow's screens: a DOM overlay over the stage (#flow, inside #stage, so it scales with the
// canvas), in the HUD's neon arcade look: Bungee and Teko, glowing text, hard corners. Menus draw
// over a dimmed scene; during a fight the overlay is empty except for the small touch pause
// button in the corner, so nothing covers the fighters (owner requirement).
//
// A screen is a root element plus its focusable items. Keys and the pad move the focus by
// geometry (the nearest item in that direction), so lists, button rows and the keypad all navigate
// the same way; the mouse moves it by hovering, and a click or a tap activates the item.
//
// Every screen that waits on the player has at least two real buttons, opens with the focus on its
// primary action, and gets a footer legend (src/flow/controls.js) of what each control does there,
// in the glyphs of the device in use. An item with disabled() true is drawn dim, and the focus,
// the D-pad and the mouse skip it.

import { legend } from './controls.js';

export function el (tag, cls = '', text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function createUI(onSound) {
  injectStyle();
  const stage = document.getElementById('stage') || document.body;
  const root = el('div'); root.id = 'flow';
  stage.appendChild(root);
  // the touch pause button lives outside the screens: CSS shows it only while fighting on a touch screen
  const pauseBtn = el('button', 'fl-pausebtn'); pauseBtn.type = 'button'; pauseBtn.setAttribute('aria-label', 'Pause');
  pauseBtn.innerHTML = '<i></i><i></i>';
  stage.appendChild(pauseBtn);

  let screen = null;
  let items = [];
  let focus = -1;
  let backFn = null;
  let focusFn = null;
  let token = 0;

  const off = (k) => !!(items[k] && items[k].disabled && items[k].disabled());
  function setFocus(i, sound = false) {
    if (!items.length) { focus = -1; return; }
    i = Math.max(0, Math.min(items.length - 1, i));
    if (off(i)) {   // never on a disabled item: the nearest enabled one in list order
      let best = -1;
      for (let d = 1; d < items.length && best < 0; d++) { if (i - d >= 0 && !off(i - d)) best = i - d; else if (i + d < items.length && !off(i + d)) best = i + d; }
      if (best < 0) return;
      i = best;
    }
    if (i !== focus && sound && onSound) onSound();
    const changed = i !== focus;
    focus = i;
    items.forEach((it, k) => it.el.classList.toggle('fl-focus', k === focus));
    if (changed && focusFn) focusFn(focus, items[focus]);
  }
  function show(cls, build, { veil = true } = {}) {
    clear();
    const my = ++token;
    const s = el('div', `fl-screen ${cls}${veil ? ' fl-veil' : ''}`);
    root.appendChild(s);
    screen = s;
    const out = build(s) || {};
    items = out.items || [];
    backFn = out.back || null;
    focusFn = out.onFocus || null;   // the screen follows the cursor (the character select's detail panel)
    items.forEach((it, k) => {
      // focusFirst: a tap on an item that isn't focused only focuses it; a second tap activates (a
      // character card: look before you pick)
      it.el.addEventListener('click', (e) => { e.preventDefault(); if (my !== token || off(k)) return; if (it.focusFirst && focus !== k) { setFocus(k, true); return; } setFocus(k); activate(); });
      it.el.addEventListener('pointerenter', (e) => { if ((e).pointerType === 'mouse' && my === token && !off(k)) setFocus(k); });
    });
    // the legend: the screen's own, or move / select / back from what it has
    const lg = out.legend !== undefined ? out.legend
      : [...(items.length > 1 ? [['move']] : []), ...(items.length ? [['confirm', 'SELECT']] : []), ...(backFn ? [['back', 'BACK']] : [])];
    if (lg && lg.length) s.appendChild(legend(lg));
    focus = -1;
    refresh();
    setFocus(out.focus || 0);
    return s;
  }
  /** redraw the disabled state (and move the focus off an item that just turned off) */
  function refresh() {
    items.forEach((it, k) => it.el.classList.toggle('fl-dis', off(k)));
    if (focus >= 0 && off(focus)) setFocus(focus);
  }
  function clear() {
    token++;
    if (screen) screen.remove();
    screen = null; items = []; focus = -1; backFn = null; focusFn = null;
  }
  function activate() {
    const it = items[focus];
    if (!it || off(focus)) return;
    if (onSound) onSound('on');
    it.el.classList.add('fl-hit'); setTimeout(() => it.el.classList.remove('fl-hit'), 120);
    it.act();
  }
  function back() { if (backFn) { if (onSound) onSound('off'); backFn(); } }
  // the nearest item in a direction, weighting the cross axis so a column stays a column
  function move(dir) {
    if (!items.length) return;
    if (focus < 0) { setFocus(0, true); return; }
    const c = (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom }; };
    const a = c(items[focus].el);
    // left and right stay in the row when the row has somewhere to go (two columns over a row of
    // buttons: left from the right column goes across, not down to the row under it)
    const sameRow = (b) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.3 * Math.min(a.bottom - a.top, b.bottom - b.top);
    const horiz = dir === 'left' || dir === 'right';
    const rowOnly = horiz && items.some((it, k) => { if (k === focus || off(k)) return false; const b = c(it.el); return sameRow(b) && (dir === 'left' ? b.x < a.x - 2 : b.x > a.x + 2); });
    let best = -1, bd = Infinity;
    items.forEach((it, k) => {
      if (k === focus || off(k)) return;
      const b = c(it.el), dx = b.x - a.x, dy = b.y - a.y;
      if (rowOnly && !sameRow(b)) return;
      const main = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
      const cross = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      if (main <= 2) return;
      const d = main + cross * 2.2;
      if (d < bd) { bd = d; best = k; }
    });
    if (best >= 0) setFocus(best, true);
  }
  return {
    root, pauseBtn, show, clear, activate, back, move, setFocus, refresh,
    get screen() { return screen; },
    get focus() { return focus; },
    get items() { return items; },
  };
}

/** a menu button */
export function button(label, act, cls = '') {
  const b = el('button', `fl-btn ${cls}`, label); b.type = 'button';
  return { el: b, act };
}

function injectStyle() {
  if (document.getElementById('flow-style')) return;
  const css = `
  #flow { position: absolute; inset: 0; z-index: 3; pointer-events: none; container-type: size;
    --pink: #ff2bd6; --cyan: #2ef2ff; --amber: #ffb02e; --violet: #a66bff; --ink: #fff4fd; --deep: #0a0414;
    font-family: 'Teko', 'Arial Narrow', system-ui, sans-serif; color: var(--ink);
    -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
  #flow * { box-sizing: border-box; }
  .fl-screen { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.6cqh; }
  .fl-veil { padding-bottom: 6.5cqh; pointer-events: auto; background: radial-gradient(ellipse at 50% 45%, rgba(18,5,38,0.80), rgba(5,1,12,0.92)); }
  .fl-h1, .fl-h2, .fl-h3 { margin: 0; font-family: 'Bungee', 'Arial Black', Impact, sans-serif; font-weight: 400; line-height: 1; text-align: center; letter-spacing: 0.02em; }
  .fl-h1 { --c: var(--pink); font-size: 7.4cqw; color: #ffd6f6; text-shadow: 0 0 0.5cqw var(--c), 0 0 1.6cqw var(--c), 0 0 3cqw var(--c); }
  .fl-h2 { --c: var(--cyan); font-size: 4.2cqw; color: #d8fdff; text-shadow: 0 0 0.4cqw var(--c), 0 0 1.4cqw var(--c); }
  .fl-h3 { --c: var(--amber); font-size: 2.6cqw; color: #fff0cf; text-shadow: 0 0 0.4cqw var(--c), 0 0 1.2cqw var(--c); }
  .fl-label { font-size: 2.5cqw; font-weight: 600; letter-spacing: 0.14em; line-height: 1; color: rgba(230,214,255,0.86); text-align: center; }
  .fl-small { font-size: 1.9cqw; font-weight: 500; letter-spacing: 0.12em; color: rgba(214,190,255,0.7); text-align: center; line-height: 1.1; }
  .fl-rule { width: 34cqw; height: 0; border-top: 2px solid var(--amber); box-shadow: 0 0 1cqw var(--amber); opacity: 0.8; }
  .fl-list { display: flex; flex-direction: column; align-items: stretch; gap: 1.4cqh; }
  .fl-row { display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 2cqw; }
  .fl-btn { --c: var(--cyan); pointer-events: auto; appearance: none; margin: 0; cursor: pointer;
    min-width: 30cqw; min-height: max(44px, 8cqh); padding: 0.4cqw 2.4cqw 0;
    background: rgba(14,4,30,0.62); border: 2px solid var(--c); border-radius: 0; color: var(--c);
    font: 600 3.3cqw/1 'Teko', 'Arial Narrow', sans-serif; letter-spacing: 0.1em;
    text-shadow: 0 0 0.6cqw var(--c); box-shadow: 0 0 0.8cqw color-mix(in srgb, var(--c) 45%, transparent), inset 0 0 0.8cqw color-mix(in srgb, var(--c) 25%, transparent);
    display: flex; flex-direction: column; align-items: center; justify-content: center; transition: background 80ms, color 80ms, transform 60ms; }
  .fl-btn small { display: block; font-size: 1.7cqw; letter-spacing: 0.12em; font-weight: 500; opacity: 0.8; margin-top: -0.2cqw; }
  .fl-btn.fl-focus { background: var(--c); color: var(--deep); text-shadow: none; box-shadow: 0 0 1.6cqw var(--c), 0 0 3.2cqw color-mix(in srgb, var(--c) 45%, transparent); }
  .fl-btn.fl-focus small { opacity: 0.85; }
  .fl-btn.fl-hit { transform: scale(0.96); }
  .fl-btn:focus { outline: none; }
  .fl-btn.fl-dis { opacity: 0.38; cursor: default; }
  .fl-pink { --c: var(--pink); } .fl-amber { --c: var(--amber); } .fl-violet { --c: var(--violet); }

  /* title: the START button sits where the HUD's prompt would be (main.js positions the group per
     frame), HIGH SCORES and CONTROLS in a row under it */
  .fl-title { pointer-events: none; }
  .fl-titlegroup { position: absolute; width: 0; height: 0; }
  .fl-titlerow { position: absolute; left: 0; top: 5.4cqh; transform: translateX(-50%); gap: 1.2cqw; }
  html.touch-ui:not(.pad-ui) .fl-titlerow { top: 7.4cqh; }
  .fl-mini { min-width: 0; min-height: max(36px, 6cqh); padding: 0.4cqw 1.6cqw 0; font-size: 2.1cqw; white-space: nowrap; }
  .fl-slim { min-height: max(40px, 6.4cqh); font-size: 2.6cqw; }
  .fl-touchonly { display: none; } html.dev-touch .fl-touchonly { display: block; }
  .fl-newhi { color: #fff; text-shadow: 0 0 0.6cqw var(--pink), 0 0 1.4cqw var(--pink); }
  /* the controls screen: the fight table beside the menu table */
  .fl-ctlrow { align-items: flex-start; gap: 3cqw; }
  .fl-ctlcol { display: flex; flex-direction: column; gap: 2.4cqh; max-width: 34cqw; }
  .fl-ctlnote { text-align: left; font-size: 1.6cqw; line-height: 1.15; }
  .fl-controls .lg-table { padding: 1.2cqw 1.6cqw; border: 2px solid rgba(166,107,255,0.6); background: rgba(14,4,30,0.62); }
  .fl-title .lg-bar { bottom: 1.2cqh; }
  .fl-start { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); min-width: 0; white-space: nowrap; padding: 0.5cqw 3cqw 0; --c: var(--amber);
    font-family: 'Bungee', 'Arial Black', sans-serif; font-weight: 400; font-size: 2.5cqw; letter-spacing: 0.06em; }
  .fl-start span { animation: fl-blink 1.1s steps(1) infinite; }
  html.touch-ui:not(.pad-ui) .fl-start { font-size: 3.2cqw; min-height: max(52px, 11cqh); padding: 0.6cqw 4.2cqw 0; }
  .fl-start .fl-touch, html.touch-ui:not(.pad-ui) .fl-start .fl-keys { display: none; }
  html.touch-ui:not(.pad-ui) .fl-start .fl-touch { display: inline; }
  @keyframes fl-blink { 0%, 64% { opacity: 1; } 65%, 100% { opacity: 0.35; } }

  /* high scores */
  .fl-table { display: grid; grid-template-columns: auto auto auto auto; column-gap: 3.2cqw; row-gap: 0.6cqh; align-items: baseline; font-size: 3.2cqw; font-weight: 600; letter-spacing: 0.1em; line-height: 1.05; }
  .fl-table span { color: #e9dcff; text-shadow: 0 0 0.6cqw rgba(166,107,255,0.8); }
  .fl-table .fl-rank { color: var(--amber); text-shadow: 0 0 0.6cqw var(--amber); }
  .fl-table .fl-score { text-align: right; font-variant-numeric: tabular-nums; }
  .fl-table .fl-note { font-size: 2.2cqw; color: rgba(214,190,255,0.7); text-shadow: none; }
  .fl-table .fl-new { color: #fff; text-shadow: 0 0 0.6cqw var(--pink), 0 0 1.4cqw var(--pink); animation: fl-blink 0.9s steps(1) infinite; }

  /* stage card */
  .fl-stage { gap: 1.2cqh; }
  .fl-vs { display: flex; align-items: center; gap: 3cqw; }
  .fl-vs b { font-family: 'Bungee', sans-serif; font-weight: 400; font-size: 4.6cqw; line-height: 1; }
  .fl-vs .fl-you { color: #f4f4ff; text-shadow: 0 0 1cqw rgba(255,255,255,0.6); }
  .fl-vs .fl-x { font-size: 2.6cqw; color: var(--amber); text-shadow: 0 0 1cqw var(--amber); }
  .fl-pips { display: flex; gap: 0.9cqw; margin-top: 1cqh; }
  .fl-pips i { display: block; width: 4.2cqw; height: 2.6cqw; border: 2px solid rgba(166,107,255,0.7); font: normal 600 1.6cqw/2.4cqw 'Teko', sans-serif; text-align: center; color: rgba(214,190,255,0.8); }
  .fl-pips i.fl-done { background: var(--amber); border-color: var(--amber); color: var(--deep); box-shadow: 0 0 0.8cqw var(--amber); }
  .fl-pips i.fl-now { border-color: var(--c, var(--pink)); color: #fff; box-shadow: 0 0 1cqw var(--c, var(--pink)); animation: fl-blink 0.8s steps(1) infinite; }
  .fl-pips i.fl-boss { width: 6.4cqw; }

  /* tallies */
  .fl-tally { display: grid; grid-template-columns: auto auto; column-gap: 4cqw; row-gap: 0.4cqh; font-size: 2.8cqw; font-weight: 600; letter-spacing: 0.1em; }
  .fl-tally span:nth-child(odd) { color: rgba(230,214,255,0.85); }
  .fl-tally span:nth-child(even) { text-align: right; color: var(--amber); text-shadow: 0 0 0.6cqw var(--amber); font-variant-numeric: tabular-nums; }
  .fl-count { font-family: 'Bungee', sans-serif; font-size: 13cqw; line-height: 0.9; color: #fff0cf; text-shadow: 0 0 1cqw var(--amber), 0 0 3cqw var(--amber); }

  /* letter slots: initials and room codes */
  .fl-slots { display: flex; gap: 1.6cqw; }
  .fl-slot { display: flex; flex-direction: column; align-items: center; gap: 0.6cqh; }
  .fl-slot b { display: block; width: 7.4cqw; height: 9cqw; border: 2px solid rgba(46,242,255,0.6); font: 400 6cqw/9.4cqw 'Bungee', sans-serif; text-align: center; color: #d8fdff; text-shadow: 0 0 1cqw var(--cyan); background: rgba(14,4,30,0.6); }
  .fl-slot.fl-cur b { border-color: var(--pink); color: #fff; box-shadow: 0 0 1.4cqw var(--pink); text-shadow: 0 0 1cqw var(--pink); }
  .fl-arrow { min-width: 7.4cqw; min-height: max(40px, 6cqh); padding: 0; font-size: 2.6cqw; }
  .fl-code b { width: 6.4cqw; height: 7.6cqw; font-size: 5cqw; line-height: 8cqw; }
  /* install how-to (iPhone/iPad Safari) */
  .fl-steps { display: flex; flex-direction: column; gap: 1.4cqh; }
  .fl-step { margin: 0; display: flex; align-items: center; gap: 1.6cqw; font-size: 2.8cqw; font-weight: 600; letter-spacing: 0.1em; color: #e8dcff; }
  .fl-step i { font-style: normal; font-family: 'Bungee', sans-serif; font-size: 2.6cqw; width: 4.4cqw; height: 4.4cqw; display: flex; align-items: center; justify-content: center; border: 2px solid var(--amber); color: var(--amber); box-shadow: 0 0 1cqw var(--amber); }
  .fl-step b { color: var(--cyan); font-weight: 600; }
  /* the on-screen keyboard: number row on top, then QWERTY rows, each row centered like a real one */
  .fl-kb { display: flex; flex-direction: column; align-items: center; gap: 0.6cqw; }
  .fl-kbrow { display: flex; gap: 0.6cqw; justify-content: center; }
  .fl-key { min-width: 0; min-height: 0; width: 5.6cqw; height: 5.6cqw; padding: 0.4cqw 0 0; font-size: 3cqw; }
  .fl-key.fl-wide { width: 9.6cqw; font-size: 2.2cqw; }
  .fl-key.fl-off { opacity: 0.2; pointer-events: none; display: flex; align-items: center; justify-content: center; }
  .fl-link { font-size: 2.1cqw; letter-spacing: 0.06em; color: var(--cyan); text-shadow: 0 0 0.5cqw var(--cyan); word-break: break-all; max-width: 80cqw; text-align: center; }
  .fl-dots::after { content: ''; animation: fl-dots 1.2s steps(4) infinite; }
  @keyframes fl-dots { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } }

  /* ending credits */
  .fl-roll { position: relative; width: 70cqw; height: 46cqh; overflow: hidden; -webkit-mask-image: linear-gradient(transparent, #000 18%, #000 82%, transparent); mask-image: linear-gradient(transparent, #000 18%, #000 82%, transparent); }
  .fl-roll div { position: absolute; left: 0; right: 0; top: 100%; display: flex; flex-direction: column; align-items: center; gap: 1.4cqh; animation: fl-roll 14s linear forwards; }
  .fl-roll p { margin: 0; text-align: center; font-size: 2.5cqw; font-weight: 600; letter-spacing: 0.12em; line-height: 1.05; color: #eadcff; }
  .fl-roll p b { display: block; font-family: 'Bungee', sans-serif; font-weight: 400; font-size: 1.7cqw; color: var(--amber); text-shadow: 0 0 0.6cqw var(--amber); letter-spacing: 0.06em; }
  @keyframes fl-roll { from { transform: translateY(0); } to { transform: translateY(calc(-100% - 46cqh)); } }

  /* the touch pause button: only while fighting on a touch screen, in the top-left corner */
  .fl-pausebtn { display: none; position: absolute; left: 0.6%; top: 11.5%; z-index: 4; width: 40px; height: 40px; padding: 0;
    appearance: none; background: rgba(14,4,30,0.5); border: 2px solid #a66bff; border-radius: 0; box-shadow: 0 0 8px rgba(166,107,255,0.7);
    align-items: center; justify-content: center; gap: 6px; pointer-events: auto; touch-action: none; }
  .fl-pausebtn i { display: block; width: 5px; height: 16px; background: #d9c6ff; box-shadow: 0 0 6px #a66bff; }
  html.touch-ui:not(.pad-ui).fl-play .fl-pausebtn { display: flex; }
  html.online .fl-pausebtn { display: none !important; } /* online: no pause; online.js has LEAVE */

  /* character select (select.js): a grid of live rigs on the left, the focused one's sheet on the right */
  .fl-select { justify-content: flex-start; padding-top: 3.2cqh; gap: 1.4cqh; }
  .fl-selrow { display: flex; gap: 1.6cqw; align-items: stretch; }
  /* six columns of tall cards: three rows hold all 18 fighters beside the sheet */
  .fl-grid { display: grid; grid-template-columns: repeat(6, 7.2cqw); grid-auto-rows: 20.5cqh; gap: 0.9cqh 0.55cqw; align-content: start; }
  .fl-card { min-width: 0; min-height: 0; width: 7.2cqw; height: 20.5cqh; padding: 0 0 0.7cqh; justify-content: flex-end; gap: 0; overflow: hidden; }
  /* index.html makes every canvas in #stage a full-stage layer; these are inline */
  #flow .fl-card canvas, #flow canvas.fl-big { position: static; inset: auto; }
  #flow .fl-card canvas { display: block; width: 100%; flex: 1 1 0; min-height: 0; object-fit: contain; object-position: center bottom; }
  #flow canvas.fl-big { display: block; width: 12.6cqw; height: 100%; flex: none; }
  .fl-card b { display: block; font: 600 1.55cqw/1 'Teko', sans-serif; letter-spacing: 0.05em; color: #fff; text-shadow: 0 0 0.6cqw var(--c); white-space: nowrap; }
  .fl-card b.fl-long { font-size: 1.32cqw; line-height: 0.88; letter-spacing: 0.02em; white-space: normal; text-align: center; padding: 0 0.2cqw; }
  .fl-cname.fl-long { font-size: 2.45cqw; }
  /* the cursor has to win at a glance: the other cards sit back (a faint border in their color, no
     glow, the rig a little dim), the focused one lifts, glows and fills in its color */
  .fl-card { border-color: color-mix(in srgb, var(--c) 30%, transparent); background: rgba(10,3,22,0.55); box-shadow: none; transition: transform 90ms ease-out, background 80ms, border-color 80ms; }
  #flow .fl-card canvas { opacity: 0.72; transition: opacity 90ms; }
  .fl-card b { color: rgba(255,244,253,0.8); text-shadow: 0 0 0.5cqw color-mix(in srgb, var(--c) 60%, transparent); }
  .fl-card.fl-focus { z-index: 1; transform: translateY(-0.7cqh) scale(1.06); border-color: var(--c); background: color-mix(in srgb, var(--c) 26%, rgba(14,4,30,0.72)); color: #fff;
    box-shadow: 0 0 0 1px color-mix(in srgb, #fff 55%, var(--c)), 0 0 1.6cqw var(--c), 0 0 3.4cqw color-mix(in srgb, var(--c) 55%, transparent), inset 0 0 1.4cqw color-mix(in srgb, var(--c) 50%, transparent); }
  #flow .fl-card.fl-focus canvas { opacity: 1; }
  .fl-card.fl-focus b { color: #fff; text-shadow: 0 0 0.6cqw var(--c), 0 0 1.4cqw var(--c); }
  .fl-card.fl-focus.fl-hit { transform: translateY(-0.7cqh) scale(1.01); }
  .fl-card.fl-taken { opacity: 0.55; }
  .fl-detail { --c: var(--cyan); width: 42cqw; height: 63.5cqh; display: flex; gap: 1.2cqw; padding: 1.2cqw 1.4cqw; border: 2px solid var(--c); background: rgba(14,4,30,0.7);
    box-shadow: 0 0 1.4cqw color-mix(in srgb, var(--c) 45%, transparent), inset 0 0 2cqw color-mix(in srgb, var(--c) 18%, transparent); }
  .fl-big { display: block; width: 12.6cqw; height: 100%; flex: none; }
  .fl-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.9cqh; }
  .fl-cname { margin: 0; font: 400 3.1cqw/1 'Bungee', 'Arial Black', sans-serif; color: #fff; text-shadow: 0 0 0.5cqw var(--c), 0 0 1.5cqw var(--c); white-space: nowrap; }
  .fl-tagline { font-size: 1.8cqw; font-weight: 500; letter-spacing: 0.1em; line-height: 1.05; color: rgba(230,214,255,0.85); }
  .fl-stats { display: grid; grid-template-columns: auto 1fr; column-gap: 1cqw; row-gap: 0.55cqh; align-items: center; margin-top: 0.4cqh; }
  .fl-stats span { font-size: 1.7cqw; font-weight: 600; letter-spacing: 0.12em; line-height: 1; color: rgba(214,190,255,0.85); }
  .fl-stats i { display: block; height: 1.25cqh; min-height: 6px; background: rgba(255,255,255,0.08);
    -webkit-mask-image: repeating-linear-gradient(90deg, #000 0 calc(10% - 3px), transparent calc(10% - 3px) 10%); mask-image: repeating-linear-gradient(90deg, #000 0 calc(10% - 3px), transparent calc(10% - 3px) 10%); }
  .fl-stats i::before { content: ''; display: block; height: 100%; width: calc(var(--v) * 100%); background: var(--c); box-shadow: 0 0 0.8cqw var(--c); }
  .fl-moves { display: flex; flex-direction: column; gap: 0.5cqh; margin-top: 0.6cqh; border-top: 2px solid color-mix(in srgb, var(--c) 55%, transparent); padding-top: 0.9cqh; }
  .fl-moves p { margin: 0; display: grid; grid-template-columns: 1fr auto; column-gap: 1cqw; row-gap: 0.1cqh; line-height: 1; }
  .fl-moves b { font: 600 2cqw/1 'Teko', sans-serif; letter-spacing: 0.08em; color: #fff; text-shadow: 0 0 0.5cqw var(--c); }
  .fl-moves em { font: normal 600 2cqw/1 'Teko', sans-serif; color: var(--amber); text-shadow: 0 0 0.5cqw var(--amber); text-align: right; letter-spacing: 0.06em; }
  .fl-moves small { grid-column: 1 / -1; font-size: 1.55cqw; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(214,190,255,0.75); }
  .fl-selfoot { display: flex; align-items: center; gap: 2cqw; }
  .fl-found { color: #c8ff3a; text-shadow: 0 0 0.5cqw rgba(200,255,58,0.6); }

  /* pause: the menu beside the book of happy accidents (src/flow/techniques.js) */
  .fl-pauserow { align-items: flex-start; gap: 3cqw; }
  .fl-pause .fl-list .fl-btn { min-height: max(40px, 7.2cqh); }
  .fl-tech.fl-ctlpanel { --lg-size: 1.6cqw; padding: 1.2cqw 1.8cqw; }
  .fl-tech { --c: #c8ff3a; width: 44cqw; display: flex; flex-direction: column; gap: 0.7cqh; padding: 1cqw 1.4cqw; border: 2px solid color-mix(in srgb, var(--c) 60%, transparent); background: rgba(14,4,30,0.62); }
  .fl-techhead { font: 400 1.8cqw/1 'Bungee', sans-serif; color: var(--c); text-shadow: 0 0 0.6cqw var(--c); letter-spacing: 0.04em; margin-bottom: 0.4cqh; }
  .fl-tech p { margin: 0; display: flex; flex-direction: column; line-height: 1; }
  .fl-tech b { font: 600 2cqw/1 'Teko', sans-serif; letter-spacing: 0.1em; color: rgba(230,214,255,0.55); }
  .fl-tech p.fl-got b { color: #fff; text-shadow: 0 0 0.5cqw var(--c); }
  .fl-tech small { font-size: 1.4cqw; letter-spacing: 0.08em; color: rgba(214,190,255,0.7); }
  .fl-selfoot .fl-btn { min-width: 22cqw; }

  /* online, between matches: the post-match screen and the pick screen's rival status */
  .fl-card { position: relative; }
  .fl-card .fl-tag { position: absolute; top: 0.5cqh; right: 0.4cqw; font: normal 400 1.2cqw/1 'Bungee', sans-serif; padding: 0.35cqw 0.5cqw 0.2cqw; color: var(--deep); background: var(--amber); box-shadow: 0 0 0.8cqw var(--amber); letter-spacing: 0.04em; }
  /* the rival's cursor: an amber dashed frame inside the border (lime when ready), so it reads on a
     dim card and still shows when both cursors are on the same card; yours is tagged YOU */
  .fl-card.fl-rival { outline: 2px dashed var(--amber); outline-offset: -0.55cqw; }
  .fl-card.fl-rivalready { outline-color: #c8ff3a; }
  .fl-netpick .fl-card.fl-focus .fl-tag { top: 3.4cqh; }   /* both cursors on one card: YOU over RIVAL */
  .fl-netpick .fl-card.fl-focus::before { content: 'YOU'; position: absolute; top: 0.5cqh; left: 0.4cqw; font: normal 400 1.2cqw/1 'Bungee', sans-serif; padding: 0.35cqw 0.5cqw 0.2cqw; color: var(--deep); background: var(--pink); box-shadow: 0 0 0.8cqw var(--pink); letter-spacing: 0.04em; }
  .fl-card.fl-rivalready .fl-tag { background: #c8ff3a; box-shadow: 0 0 0.8cqw #c8ff3a; }
  /* the online pick screen has a status line more than the plain select: the cards and sheet give up the room */
  .fl-netpick { gap: 1.1cqh; padding-top: 2.4cqh; }
  .fl-netpick .fl-grid { grid-auto-rows: 18.4cqh; }
  .fl-netpick .fl-card { height: 18.4cqh; }
  .fl-netpick .fl-detail { height: 57.2cqh; }
  .fl-netpick .fl-selfoot .fl-btn { min-width: 16cqw; }   /* four buttons here (LEAVE ROOM, PICK, MOVE LIST, START) */
  .fl-post .fl-btn { white-space: nowrap; }
  .fl-selstatus { display: flex; gap: 3cqw; font-size: 2.3cqw; font-weight: 600; letter-spacing: 0.12em; line-height: 1; min-height: 2.4cqw; }
  .fl-selstatus b { font-weight: 600; color: var(--amber); text-shadow: 0 0 0.5cqw var(--amber); }
  .fl-selstatus b.fl-ok { color: #c8ff3a; text-shadow: 0 0 0.5cqw rgba(200,255,58,0.7); }
  .fl-post { gap: 1.3cqh; }
  .fl-set { display: flex; align-items: baseline; gap: 2.4cqw; font-family: 'Bungee', 'Arial Black', sans-serif; line-height: 1; }
  .fl-set .fl-sn { font-size: 8cqw; color: #fff; text-shadow: 0 0 0.6cqw var(--c), 0 0 1.8cqw var(--c); }
  .fl-set .fl-sl { font-size: 2.2cqw; color: var(--c); text-shadow: 0 0 0.6cqw var(--c); letter-spacing: 0.06em; }
  .fl-set .fl-dash { font-size: 5cqw; color: rgba(230,214,255,0.6); }
  .fl-set .fl-me { --c: var(--pink); } .fl-set .fl-them { --c: var(--cyan); }
  .fl-cd { font-family: 'Bungee', sans-serif; font-size: 3.2cqw; color: #fff0cf; text-shadow: 0 0 0.6cqw var(--amber), 0 0 1.6cqw var(--amber); min-height: 3.4cqw; }
  .fl-cd small { display: block; text-align: center; font: 600 1.8cqw/1.2 'Teko', sans-serif; letter-spacing: 0.12em; color: rgba(230,214,255,0.8); text-shadow: none; }
  .fl-post > .fl-row:not(.fl-cdrow) .fl-btn { width: 32cqw; min-width: 0; }   /* a true 2x2 grid, so left and right never drift to the other row */
  .fl-cdrow { min-height: max(36px, 6cqh); gap: 2.4cqw; }
  .fl-cdrow .fl-btn.fl-dis { visibility: hidden; }
  .fl-rivalline { font-size: 2.4cqw; font-weight: 600; letter-spacing: 0.14em; color: rgba(230,214,255,0.9); min-height: 2.5cqw; }
  .fl-rivalline b { font-weight: 600; color: var(--amber); text-shadow: 0 0 0.5cqw var(--amber); }
  .fl-post .fl-btn small { min-height: 1.7cqw; }
  .fl-post .fl-btn.fl-want small { color: var(--amber); opacity: 1; animation: fl-blink 0.9s steps(1) infinite; }
  .fl-post .fl-btn.fl-focus.fl-want small { color: var(--deep); }

  /* typing screens (a name, a crew name or link, an email, a code): the field over the on-screen keyboard */
  .fl-text { gap: 1.2cqh; }
  .fl-text .fl-h2 { font-size: 3.6cqw; }
  .fl-field { min-width: 44cqw; max-width: 86cqw; min-height: 6.2cqw; padding: 0.5cqw 1.6cqw 0; border: 2px solid var(--pink); background: rgba(14,4,30,0.7);
    box-shadow: 0 0 1.2cqw color-mix(in srgb, var(--pink) 50%, transparent); font: 400 4cqw/5.6cqw 'Bungee', 'Arial Black', sans-serif; color: #fff;
    text-shadow: 0 0 0.8cqw var(--pink); text-align: center; white-space: pre; overflow: hidden; letter-spacing: 0.04em; }
  .fl-field.fl-lower { font: 600 3.8cqw/5.8cqw 'Teko', 'Arial Narrow', sans-serif; letter-spacing: 0.04em; }
  .fl-caret { display: inline-block; width: 0.5cqw; height: 4cqw; margin-left: 0.3cqw; vertical-align: -0.5cqw; background: var(--amber); box-shadow: 0 0 0.8cqw var(--amber); animation: fl-blink 1s steps(1) infinite; }
  .fl-temsg { min-height: 2.2cqw; max-width: 80cqw; }
  .fl-warn { color: #ffc2f3 !important; text-shadow: 0 0 0.6cqw var(--pink); }
  .fl-text .fl-key { width: 5cqw; height: 5cqw; font-size: 2.7cqw; }
  .fl-text .fl-key.fl-wide { width: 9cqw; font-size: 2cqw; }
  .fl-text .fl-kb { gap: 0.5cqw; }
  .fl-text .fl-kbrow { gap: 0.5cqw; }

  /* the online menu: crew rooms beside quick match, the profile row under them */
  .fl-online { gap: 1.2cqh; }
  .fl-onlinecols { align-items: flex-start; gap: 3cqw; }
  .fl-ocol { width: 30cqw; gap: 1.1cqh; }
  .fl-ocol .fl-btn { min-width: 0; width: 100%; }
  .fl-colhead { font: 400 1.7cqw/1 'Bungee', sans-serif; letter-spacing: 0.08em; color: var(--amber); text-shadow: 0 0 0.6cqw var(--amber); text-align: center; margin-bottom: 0.2cqh; }
  .fl-orow { gap: 1.4cqw; margin-top: 0.6cqh; }
  .fl-orow .fl-btn { min-width: 14cqw; }

  /* the profile */
  .fl-pname { font-size: 6cqw; }
  .fl-pemail { text-transform: none; letter-spacing: 0.08em; }
  .fl-profile .fl-small { max-width: 70cqw; }

  /* the crew lobby: standings on the left, PLAY and the link on the right */
  .fl-crew { gap: 1cqh; }
  .fl-crew .fl-h2 { font-size: 3.6cqw; }
  .fl-crew .fl-link { font-size: 1.8cqw; }
  .fl-crewbody { align-items: flex-start; gap: 2.4cqw; margin-top: 0.6cqh; }
  .fl-crewleft { width: 58cqw; display: flex; flex-direction: column; gap: 1.4cqh; }
  .fl-crewright { width: 26cqw; }
  .fl-standings { display: grid; grid-template-columns: 2.2cqw 1fr 3.4cqw 3.4cqw 3.4cqw 6cqw 11cqw; column-gap: 0.8cqw; row-gap: 0.5cqh; align-items: baseline;
    padding: 1cqw 1.2cqw; border: 2px solid rgba(46,242,255,0.5); background: rgba(14,4,30,0.66); font-size: 2.3cqw; font-weight: 600; letter-spacing: 0.08em; line-height: 1.05; }
  .fl-standings span { color: #e9dcff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fl-standings .fl-sth { font: 400 1.2cqw/1 'Bungee', sans-serif; color: rgba(214,190,255,0.7); letter-spacing: 0.06em; }
  .fl-standings .fl-srank { color: var(--amber); text-shadow: 0 0 0.5cqw var(--amber); }
  .fl-standings .fl-snum { text-align: right; font-variant-numeric: tabular-nums; }
  .fl-standings .fl-svs { color: var(--cyan); }
  .fl-standings .fl-sfav { color: #fff; text-shadow: 0 0 0.6cqw var(--fc, var(--violet)); font-size: 2cqw; }
  .fl-standings .fl-me { color: #fff; text-shadow: 0 0 0.6cqw var(--pink); }
  .fl-standings .fl-smore { grid-column: 1 / -1; font-size: 1.8cqw; color: rgba(214,190,255,0.7); text-align: center; }
  .fl-sname { display: flex; align-items: baseline; gap: 0.6cqw; }
  .fl-dot { display: inline-block; flex: none; width: 1cqw; height: 1cqw; border: 2px solid rgba(214,190,255,0.35); transform: translateY(-0.1cqw); }
  .fl-dot.fl-on-here { background: var(--cyan); border-color: var(--cyan); box-shadow: 0 0 0.6cqw var(--cyan); }
  .fl-dot.fl-on-ready { background: var(--amber); border-color: var(--amber); box-shadow: 0 0 0.6cqw var(--amber); }
  .fl-dot.fl-on-match { background: var(--pink); border-color: var(--pink); box-shadow: 0 0 0.6cqw var(--pink); }
  .fl-chip { font: normal 400 1cqw/1 'Bungee', sans-serif; padding: 0.3cqw 0.4cqw 0.15cqw; color: var(--deep); letter-spacing: 0.04em; }
  .fl-chip.fl-on-ready { background: var(--amber); } .fl-chip.fl-on-match { background: var(--pink); }
  .fl-recent { display: flex; flex-direction: column; gap: 0.4cqh; font-size: 1.8cqw; font-weight: 500; letter-spacing: 0.1em; color: rgba(214,190,255,0.75); min-height: 6cqh; }
  .fl-crewbtns { gap: 1.2cqh; align-items: stretch; }
  .fl-crewstatus { min-height: 5.4cqw; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0.6cqw 0.8cqw 0.3cqw; border: 2px solid rgba(255,176,46,0.5);
    font-size: 2cqw; font-weight: 600; letter-spacing: 0.1em; line-height: 1.1; color: #fff0cf; text-shadow: 0 0 0.5cqw var(--amber); }
  .fl-playbtn { min-width: 0; width: 100%; min-height: max(56px, 13cqh); }
  .fl-playbtn .fl-pl { font: 400 4.4cqw/1 'Bungee', 'Arial Black', sans-serif; letter-spacing: 0.04em; }
  .fl-crewpair { gap: 1cqw; }
  .fl-crewpair .fl-btn { flex: 1; min-width: 0; }
  .fl-crewfail .fl-h3 { max-width: 70cqw; }
  `;
  const s = document.createElement('style');
  s.id = 'flow-style';
  s.textContent = css;
  document.head.appendChild(s);
}
