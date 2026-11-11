// The flow's screens: a DOM overlay over the stage (#flow, inside #stage, so it scales with the
// canvas), in the HUD's neon arcade look: Bungee and Teko, glowing text, hard corners. Menus draw
// over a dimmed scene; during a fight the overlay is empty, so nothing covers the fighters (owner
// requirement). The pause button is one of the corner buttons (src/corner.js), not part of a screen.
//
// A screen always fits the stage. Sizes are container units with a few px floors (a button is never
// under 44px), so on a small stage a tall menu would run past the top and bottom: fit() measures
// what the screen holds and zooms the whole screen down until it's inside. A phone held upright has
// a stage about 390 by 219, where zoom alone would leave nothing readable, so the long menus also
// lay out wider there (the @container rules at the end of the stylesheet).
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
import { PLAIN } from '../plaintext.js';   // readable text never glows: the shared dark outline
import { cornerButton, PAUSE_ICON } from '../corner.js';

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
  // the desktop pause button: first in the corner row, shown by CSS only in a fight you can pause
  // (a touch screen has its own in the touch layer, which sends 'sf:pause')
  const pauseBtn = cornerButton('sf-pause', 'Pause', 1, PAUSE_ICON);
  pauseBtn.tabIndex = -1;   // never focused, so Space or Enter in a fight can't press it

  let screen = null;
  let items = [];
  let focus = -1;
  let backFn = null;
  let focusFn = null;
  let moveFn = null;
  let token = 0;

  // an item is off when its screen says so, or when this layout doesn't show it (the upright pause menu drops one)
  const off = (k) => !!(items[k] && ((items[k].disabled && items[k].disabled()) || items[k].el.offsetParent === null));

  // ---- fitting a screen to the stage ------------------------------------------------------------
  // What the screen holds (its in-flow children; the legend and anything else positioned is left out)
  // against the stage less the legend's room. zoom scales px and container units alike, so one pass is exact.
  let zoomNow = 1;
  function fit() {
    if (!screen) return;
    if (screen.classList.contains('fl-nofit')) { if (zoomNow !== 1) { zoomNow = 1; screen.style.zoom = ''; } return; }   // it fits itself (the upright select: its carousel takes what's left)
    const st = root.getBoundingClientRect();
    if (!st.width || !st.height) return;
    let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
    for (const n of screen.children) {
      const cs = getComputedStyle(n);
      if (cs.position === 'absolute' || cs.position === 'fixed' || cs.display === 'none') continue;
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom); left = Math.min(left, r.left); right = Math.max(right, r.right);
    }
    if (bottom <= top) return;
    const cs = getComputedStyle(screen);
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);   // measured zoomed, like the rest
    const edge = st.height * 0.012;   // a sliver of air at the top and bottom
    const h = (bottom - top + pad) / zoomNow, w = (right - left) / zoomNow;
    const k = Math.max(0.3, Math.min(1, (st.height - 2 * edge) / h, st.width / w));
    const next = k > 0.995 ? 1 : Math.floor(k * 200) / 200;
    if (Math.abs(next - zoomNow) < 0.004) return;
    zoomNow = next;
    screen.style.zoom = next === 1 ? '' : String(next);
  }
  // a screen's content changes under it (the pause menu's right panel, a lobby filling up, a font arriving)
  const watch = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => fit()) : null;
  if (watch) watch.observe(root);
  window.addEventListener('resize', fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit).catch(() => {});
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
    moveFn = out.move || null;       // the screen's own arrows first (the character select's wrap-around), else geometry
    let tapped = -1;   // the focusFirst item this touch just focused: its click is the end of that tap, not a second one
    items.forEach((it, k) => {
      if (it.manual) return;   // the screen handles this item's pointer itself (the upright select's carousel: a swipe isn't a tap)
      // focusFirst: a tap on an item that isn't focused only focuses it; a second tap activates (a
      // character card: look before you pick). The focus lands when the finger does (pointerdown), not
      // when it lifts (click, a tap's length later).
      if (it.focusFirst) it.el.addEventListener('pointerdown', (e) => {
        if (my !== token || off(k) || e.pointerType === 'mouse') return;   // the mouse focuses by hovering
        if (focus !== k) { tapped = k; setFocus(k, true); } else tapped = -1;
      });
      it.el.addEventListener('click', (e) => {
        e.preventDefault();
        if (my !== token || off(k)) return;
        const first = tapped === k; tapped = -1;
        if (it.focusFirst && (first || focus !== k)) { setFocus(k, !first); return; }
        setFocus(k); activate();
      });
      it.el.addEventListener('pointerenter', (e) => { if ((e).pointerType === 'mouse' && my === token && !off(k)) setFocus(k); });
    });
    // the legend: the screen's own, or move / select / back from what it has
    const lg = out.legend !== undefined ? out.legend
      : [...(items.length > 1 ? [['move']] : []), ...(items.length ? [['confirm', 'SELECT']] : []), ...(backFn ? [['back', 'BACK']] : [])];
    if (lg && lg.length) s.appendChild(legend(lg));
    focus = -1;
    zoomNow = 1;
    if (watch) for (const n of s.children) watch.observe(n);
    fit();
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
    if (screen) { if (watch) for (const n of screen.children) watch.unobserve(n); screen.remove(); }
    screen = null; items = []; focus = -1; backFn = null; focusFn = null; moveFn = null;
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
    if (moveFn && moveFn(dir, focus, items[focus])) return;
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
    root, pauseBtn, show, clear, activate, back, move, setFocus, refresh, fit,
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
    /* Text a player reads never glows (README, "The look"): a solid color inside a tight dark outline, the DOM
       twin of plainText() in src/combat/hud.js. It's set here and inherited, so a new label is plain by default.
       Neon glow is for decorative text only: the big sign headings (.fl-h1, .fl-h2) and the arcade numerals
       (.fl-count, .fl-sn). A heading that carries something to read (a room code, a name) takes .fl-read. */
    --plain: ${PLAIN};
    text-shadow: var(--plain);
    -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
  #flow * { box-sizing: border-box; }
  .fl-screen { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.6cqh; }
  .fl-veil { padding-bottom: 6.5cqh; pointer-events: auto; background: radial-gradient(ellipse at 50% 45%, rgba(18,5,38,0.80), rgba(5,1,12,0.92)); }
  .fl-h1, .fl-h2, .fl-h3 { margin: 0; font-family: 'Bungee', 'Arial Black', Impact, sans-serif; font-weight: 400; line-height: 1; text-align: center; letter-spacing: 0.02em; }
  .fl-h1 { --c: var(--pink); font-size: 7.4cqw; color: #ffd6f6; text-shadow: 0 0 0.5cqw var(--c), 0 0 1.6cqw var(--c), 0 0 3cqw var(--c); }
  .fl-h2 { --c: var(--cyan); font-size: 4.2cqw; color: #d8fdff; text-shadow: 0 0 0.4cqw var(--c), 0 0 1.4cqw var(--c); }
  .fl-h3 { font-size: 2.6cqw; color: #ffd98f; }
  #flow .fl-read { text-shadow: var(--plain); }
  .fl-label { font-size: 2.5cqw; font-weight: 600; letter-spacing: 0.14em; line-height: 1; color: rgba(230,214,255,0.86); text-align: center; }
  .fl-small { font-size: 1.9cqw; font-weight: 500; letter-spacing: 0.12em; color: rgba(214,190,255,0.7); text-align: center; line-height: 1.1; }
  .fl-rule { width: 34cqw; height: 0; border-top: 2px solid var(--amber); box-shadow: 0 0 1cqw var(--amber); opacity: 0.8; }
  .fl-list { display: flex; flex-direction: column; align-items: stretch; gap: 1.4cqh; }
  .fl-row { display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 2cqw; }
  .fl-btn { --c: var(--cyan); pointer-events: auto; appearance: none; margin: 0; cursor: pointer;
    min-width: 30cqw; min-height: max(44px, 8cqh); padding: 0.4cqw 2.4cqw 0;
    background: rgba(14,4,30,0.62); border: 2px solid var(--c); border-radius: 0; color: color-mix(in srgb, var(--c) 70%, #fff);
    font: 600 3.3cqw/1 'Teko', 'Arial Narrow', sans-serif; letter-spacing: 0.1em;
    text-shadow: var(--plain);   /* a <button> doesn't inherit text-shadow from #flow (the browser's own sheet resets it), so say it here */
    box-shadow: 0 0 0.8cqw color-mix(in srgb, var(--c) 45%, transparent), inset 0 0 0.8cqw color-mix(in srgb, var(--c) 25%, transparent);
    display: flex; flex-direction: column; align-items: center; justify-content: center; transition: background 80ms, color 80ms, transform 60ms; }
  .fl-btn small { display: block; font-size: 1.7cqw; letter-spacing: 0.12em; font-weight: 500; opacity: 0.8; margin-top: -0.2cqw; }
  /* the cursor lands at once: an item taking the focus doesn't fade in (only the press squeeze eases), the one losing it fades out */
  .fl-btn.fl-focus { transition: transform 60ms; background: var(--c); color: var(--deep); text-shadow: none; box-shadow: 0 0 1.6cqw var(--c), 0 0 3.2cqw color-mix(in srgb, var(--c) 45%, transparent); }
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
  .fl-newhi { color: #ffc2f3; }
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
  .fl-table span { color: #e9dcff; }
  .fl-table .fl-rank { color: var(--amber); }
  .fl-table .fl-score { text-align: right; font-variant-numeric: tabular-nums; }
  .fl-table .fl-note { font-size: 2.2cqw; color: rgba(214,190,255,0.7); }
  .fl-table .fl-new { color: #ffc2f3; animation: fl-blink 0.9s steps(1) infinite; }
  /* a crew's table (src/net/crewScores.js): ten rows, with the fighter in its neon */
  .fl-table.fl-table5 { grid-template-columns: auto auto auto auto auto; font-size: 2.4cqw; row-gap: 0.2cqh; column-gap: 2.4cqw; }
  .fl-table5 .fl-note { font-size: 1.8cqw; }
  .fl-table .fl-fighter { font-size: 1.9cqw; color: color-mix(in srgb, var(--fc, var(--violet)) 55%, #fff); }
  .fl-table .fl-empty { grid-column: 1 / -1; text-align: center; }
  .fl-crewpost { color: var(--amber); letter-spacing: 0.08em; }

  /* stage card */
  .fl-stage { gap: 1.2cqh; }
  .fl-vs { display: flex; align-items: center; gap: 3cqw; }
  .fl-vs b { font-family: 'Bungee', sans-serif; font-weight: 400; font-size: 4.6cqw; line-height: 1; }
  .fl-vs .fl-you { color: #f4f4ff; }
  .fl-vs .fl-x { font-size: 2.6cqw; color: var(--amber); }
  .fl-pips { display: flex; gap: 0.9cqw; margin-top: 1cqh; }
  .fl-pips i { display: block; width: 4.2cqw; height: 2.6cqw; border: 2px solid rgba(166,107,255,0.7); font: normal 600 1.6cqw/2.4cqw 'Teko', sans-serif; text-align: center; color: rgba(214,190,255,0.8); }
  .fl-pips i.fl-done { background: var(--amber); border-color: var(--amber); color: var(--deep); text-shadow: none; box-shadow: 0 0 0.8cqw var(--amber); }
  .fl-pips i.fl-now { border-color: var(--c, var(--pink)); color: #fff; box-shadow: 0 0 1cqw var(--c, var(--pink)); animation: fl-blink 0.8s steps(1) infinite; }
  .fl-pips i.fl-boss { width: 6.4cqw; }

  /* tallies */
  .fl-tally { display: grid; grid-template-columns: auto auto; column-gap: 4cqw; row-gap: 0.4cqh; font-size: 2.8cqw; font-weight: 600; letter-spacing: 0.1em; }
  .fl-tally span:nth-child(odd) { color: rgba(230,214,255,0.85); }
  .fl-tally span:nth-child(even) { text-align: right; color: var(--amber); font-variant-numeric: tabular-nums; }
  .fl-count { font-family: 'Bungee', sans-serif; font-size: 13cqw; line-height: 0.9; color: #fff0cf; text-shadow: 0 0 1cqw var(--amber), 0 0 3cqw var(--amber); }

  /* letter slots: initials and room codes */
  .fl-slots { display: flex; gap: 1.6cqw; }
  .fl-slot { display: flex; flex-direction: column; align-items: center; gap: 0.6cqh; }
  .fl-slot b { display: block; width: 7.4cqw; height: 9cqw; border: 2px solid rgba(46,242,255,0.6); font: 400 6cqw/9.4cqw 'Bungee', sans-serif; text-align: center; color: #d8fdff; background: rgba(14,4,30,0.6); }
  .fl-slot.fl-cur b { border-color: var(--pink); color: #fff; box-shadow: 0 0 1.4cqw var(--pink); }
  .fl-arrow { min-width: 7.4cqw; min-height: max(40px, 6cqh); padding: 0; font-size: 2.6cqw; }
  .fl-code b { width: 6.4cqw; height: 7.6cqw; font-size: 5cqw; line-height: 8cqw; }
  /* the on-screen keyboard: number row on top, then QWERTY rows, each row centered like a real one */
  .fl-kb { display: flex; flex-direction: column; align-items: center; gap: 0.6cqw; }
  .fl-kbrow { display: flex; gap: 0.6cqw; justify-content: center; }
  .fl-key { min-width: 0; min-height: 0; width: 5.6cqw; height: 5.6cqw; padding: 0.4cqw 0 0; font-size: 3cqw; }
  .fl-key.fl-wide { width: 9.6cqw; font-size: 2.2cqw; }
  .fl-key.fl-off { opacity: 0.2; pointer-events: none; display: flex; align-items: center; justify-content: center; }
  .fl-link { font-size: 2.1cqw; letter-spacing: 0.06em; color: #9df8ff; word-break: break-all; max-width: 80cqw; text-align: center; }
  .fl-dots::after { content: ''; animation: fl-dots 1.2s steps(4) infinite; }
  /* The join link as a QR code (src/qr.js), on the host screen and the crew lobby. Black on a white tile with the
     quiet zone inside it, and nothing over it: a neon or inverted code, or one with a glow, fails on a lot of
     phone cameras. The frame is a thin line outside the white. Before there's a link the tile is empty, the same size. */
  .fl-qr { --qr: 34cqh; display: flex; flex-direction: column; align-items: center; gap: 1cqh; flex: none; }
  .fl-qrtile { width: var(--qr); height: var(--qr); border: 2px solid var(--cyan); background: #fff; line-height: 0; }
  .fl-qrtile svg { display: block; width: 100%; height: 100%; }
  .fl-qrlabel { font-size: 2.1cqw; font-weight: 600; letter-spacing: 0.16em; line-height: 1; color: #d8fdff; white-space: nowrap; }
  .fl-qrwait .fl-qrtile { background: rgba(14,4,30,0.62); border-color: rgba(46,242,255,0.35); }
  .fl-qrwait .fl-qrlabel { opacity: 0.4; }
  /* the host screen: the title across, the code and link beside the QR code, the buttons under both */
  .fl-host { display: grid; grid-template-columns: auto auto; grid-template-areas: "t t" "i q" "b b" "s s";
    justify-content: center; align-content: center; justify-items: center; align-items: center; column-gap: 4cqw; row-gap: 1.8cqh; }
  .fl-host > .fl-h2 { grid-area: t; }
  .fl-host > .fl-qr { grid-area: q; }
  .fl-host > .fl-row { grid-area: b; }
  .fl-host > .fl-spec { grid-area: s; }
  .fl-hostinfo { grid-area: i; width: 46cqw; display: flex; flex-direction: column; align-items: center; gap: 1.8cqh; }
  .fl-hostinfo .fl-link { max-width: 100%; line-height: 1.2; min-height: 1.2em; }   /* a line's room before the link arrives */
  @keyframes fl-dots { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } }

  /* ending credits */
  .fl-roll { position: relative; width: 70cqw; height: 46cqh; overflow: hidden; -webkit-mask-image: linear-gradient(transparent, #000 18%, #000 82%, transparent); mask-image: linear-gradient(transparent, #000 18%, #000 82%, transparent); }
  .fl-roll div { position: absolute; left: 0; right: 0; top: 100%; display: flex; flex-direction: column; align-items: center; gap: 1.4cqh; animation: fl-roll 14s linear forwards; }
  .fl-roll p { margin: 0; text-align: center; font-size: 2.5cqw; font-weight: 600; letter-spacing: 0.12em; line-height: 1.05; color: #eadcff; }
  .fl-roll p b { display: block; font-family: 'Bungee', sans-serif; font-weight: 400; font-size: 1.7cqw; color: var(--amber); letter-spacing: 0.06em; }
  @keyframes fl-roll { from { transform: translateY(0); } to { transform: translateY(calc(-100% - 46cqh)); } }

  /* character select (select.js): a grid of live rigs on the left, the focused one's sheet on the right */
  .fl-select { justify-content: flex-start; padding-top: 3.2cqh; gap: 1.4cqh; }
  .fl-selrow { display: flex; gap: 1.6cqw; align-items: stretch; }
  /* six columns of tall cards: three rows hold all 18 fighters beside the sheet */
  .fl-grid { display: grid; grid-template-columns: repeat(6, 7.2cqw); grid-auto-rows: 20.5cqh; gap: 0.9cqh 0.55cqw; align-content: start; }
  .fl-grid.fl-gridscroll { --rowh: 20.5cqh; max-height: calc(3 * var(--rowh) + 2 * 0.9cqh + 2.4cqh); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; padding: 1.2cqh 0.6cqw; margin: -1.2cqh -0.6cqw; pointer-events: auto; }
  .fl-netpick .fl-grid.fl-gridscroll { --rowh: 18.4cqh; }
  .fl-card { min-width: 0; min-height: 0; width: 7.2cqw; height: 20.5cqh; padding: 0 0 0.7cqh; justify-content: flex-end; gap: 0; overflow: hidden; }
  /* index.html makes every canvas in #stage a full-stage layer; these are inline */
  #flow .fl-card canvas, #flow canvas.fl-big { position: static; inset: auto; }
  #flow .fl-card canvas { display: block; width: 100%; flex: 1 1 0; min-height: 0; object-fit: contain; object-position: center bottom; }
  #flow canvas.fl-big { display: block; width: 12.6cqw; height: 100%; flex: none; }
  .fl-card b { display: block; font: 600 1.55cqw/1 'Teko', sans-serif; letter-spacing: 0.05em; color: #fff; white-space: nowrap; }
  .fl-card b.fl-long { font-size: 1.32cqw; line-height: 0.88; letter-spacing: 0.02em; white-space: normal; text-align: center; padding: 0 0.2cqw; }
  .fl-cname.fl-long { font-size: 2.45cqw; }
  /* the cursor has to win at a glance: the other cards sit back (a faint border in their color, no
     glow, the rig a little dim), the focused one lifts, glows and fills in its color */
  .fl-card { border-color: color-mix(in srgb, var(--c) 30%, transparent); background: rgba(10,3,22,0.55); box-shadow: none; transition: transform 90ms ease-out, background 80ms, border-color 80ms; }
  #flow .fl-card canvas { opacity: 0.72; transition: opacity 90ms; }
  .fl-card b { color: rgba(255,244,253,0.8); }
  .fl-card.fl-focus { z-index: 1; transition: none; transform: translateY(-0.7cqh) scale(1.06); border-color: var(--c); background: color-mix(in srgb, var(--c) 26%, rgba(14,4,30,0.72)); color: #fff;
    box-shadow: 0 0 0 1px color-mix(in srgb, #fff 55%, var(--c)), 0 0 1.6cqw var(--c), 0 0 3.4cqw color-mix(in srgb, var(--c) 55%, transparent), inset 0 0 1.4cqw color-mix(in srgb, var(--c) 50%, transparent); }
  #flow .fl-card.fl-focus canvas { opacity: 1; transition: none; }
  .fl-card.fl-focus b { color: #fff; }
  .fl-card.fl-focus.fl-hit { transition: transform 60ms; transform: translateY(-0.7cqh) scale(1.01); }
  .fl-card.fl-taken { opacity: 0.55; }
  .fl-detail { --c: var(--cyan); width: 42cqw; height: 63.5cqh; display: flex; gap: 1.2cqw; padding: 1.2cqw 1.4cqw; border: 2px solid var(--c); background: rgba(14,4,30,0.7);
    box-shadow: 0 0 1.4cqw color-mix(in srgb, var(--c) 45%, transparent), inset 0 0 2cqw color-mix(in srgb, var(--c) 18%, transparent); }
  .fl-big { display: block; width: 12.6cqw; height: 100%; flex: none; }
  .fl-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.9cqh; }
  .fl-cname { margin: 0; font: 400 3.1cqw/1 'Bungee', 'Arial Black', sans-serif; color: color-mix(in srgb, var(--c) 45%, #fff); white-space: nowrap; }
  .fl-tagline { font-size: 1.8cqw; font-weight: 500; letter-spacing: 0.1em; line-height: 1.05; color: rgba(230,214,255,0.85); }
  .fl-stats { display: grid; grid-template-columns: auto 1fr; column-gap: 1cqw; row-gap: 0.55cqh; align-items: center; margin-top: 0.4cqh; }
  .fl-stats span { font-size: 1.7cqw; font-weight: 600; letter-spacing: 0.12em; line-height: 1; color: rgba(214,190,255,0.85); }
  .fl-stats i { display: block; height: 1.25cqh; min-height: 6px; background: rgba(255,255,255,0.08);
    -webkit-mask-image: repeating-linear-gradient(90deg, #000 0 calc(10% - 3px), transparent calc(10% - 3px) 10%); mask-image: repeating-linear-gradient(90deg, #000 0 calc(10% - 3px), transparent calc(10% - 3px) 10%); }
  .fl-stats i::before { content: ''; display: block; height: 100%; width: calc(var(--v) * 100%); background: var(--c); box-shadow: 0 0 0.8cqw var(--c); }
  .fl-moves { display: flex; flex-direction: column; gap: 0.5cqh; margin-top: 0.6cqh; border-top: 2px solid color-mix(in srgb, var(--c) 55%, transparent); padding-top: 0.9cqh; }
  .fl-moves p { margin: 0; display: grid; grid-template-columns: 1fr auto; column-gap: 1cqw; row-gap: 0.1cqh; line-height: 1; }
  .fl-moves b { font: 600 2cqw/1 'Teko', sans-serif; letter-spacing: 0.08em; color: #fff; }
  .fl-moves em { font: normal 600 2cqw/1 'Teko', sans-serif; color: var(--amber); text-align: right; letter-spacing: 0.06em; }
  .fl-moves small { grid-column: 1 / -1; font-size: 1.55cqw; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(214,190,255,0.75); }
  .fl-selfoot { display: flex; align-items: center; gap: 2cqw; }
  .fl-found { color: #c8ff3a; }

  /* pause: the menu beside the book of happy accidents (src/flow/techniques.js) */
  .fl-pauserow { align-items: flex-start; gap: 3cqw; }
  .fl-pause .fl-list .fl-btn { min-height: max(40px, 7.2cqh); }
  .fl-tech.fl-ctlpanel { --lg-size: 1.6cqw; padding: 1.2cqw 1.8cqw; }
  .fl-tech { --c: #c8ff3a; width: 44cqw; display: flex; flex-direction: column; gap: 0.7cqh; padding: 1cqw 1.4cqw; border: 2px solid color-mix(in srgb, var(--c) 60%, transparent); background: rgba(14,4,30,0.62); }
  .fl-techhead { font: 400 1.8cqw/1 'Bungee', sans-serif; color: var(--c); letter-spacing: 0.04em; margin-bottom: 0.4cqh; }
  .fl-tech p { margin: 0; display: flex; flex-direction: column; line-height: 1; }
  .fl-tech b { font: 600 2cqw/1 'Teko', sans-serif; letter-spacing: 0.1em; color: rgba(230,214,255,0.55); }
  .fl-tech p.fl-got b { color: #fff; }
  .fl-tech small { font-size: 1.4cqw; letter-spacing: 0.08em; color: rgba(214,190,255,0.7); }
  .fl-selfoot .fl-btn { min-width: 22cqw; }

  /* online, between matches: the post-match screen and the pick screen's rival status */
  .fl-card { position: relative; }
  .fl-card .fl-tag { position: absolute; top: 0.5cqh; right: 0.4cqw; font: normal 400 1.2cqw/1 'Bungee', sans-serif; padding: 0.35cqw 0.5cqw 0.2cqw; color: var(--deep); text-shadow: none; background: var(--amber); box-shadow: 0 0 0.8cqw var(--amber); letter-spacing: 0.04em; }
  /* the rival's cursor: an amber dashed frame inside the border (lime when ready), so it reads on a
     dim card and still shows when both cursors are on the same card; yours is tagged YOU */
  .fl-card.fl-rival { outline: 2px dashed var(--amber); outline-offset: -0.55cqw; }
  .fl-card.fl-rivalready { outline-color: #c8ff3a; }
  .fl-netpick .fl-card.fl-focus .fl-tag { top: 3.4cqh; }   /* both cursors on one card: YOU over RIVAL */
  .fl-netpick .fl-card.fl-focus::before { content: 'YOU'; position: absolute; top: 0.5cqh; left: 0.4cqw; font: normal 400 1.2cqw/1 'Bungee', sans-serif; padding: 0.35cqw 0.5cqw 0.2cqw; color: var(--deep); text-shadow: none; background: var(--pink); box-shadow: 0 0 0.8cqw var(--pink); letter-spacing: 0.04em; }
  .fl-card.fl-rivalready .fl-tag { background: #c8ff3a; box-shadow: 0 0 0.8cqw #c8ff3a; }
  /* the online pick screen has a status line more than the plain select: the cards and sheet give up the room */
  .fl-netpick { gap: 1.1cqh; padding-top: 2.4cqh; }
  .fl-netpick .fl-grid { grid-auto-rows: 18.4cqh; }
  .fl-netpick .fl-card { height: 18.4cqh; }
  .fl-netpick .fl-detail { height: 57.2cqh; }
  .fl-netpick .fl-selfoot .fl-btn { min-width: 16cqw; }   /* four buttons here (LEAVE ROOM, PICK, MOVE LIST, START) */
  .fl-post .fl-btn { white-space: nowrap; }
  .fl-selstatus { display: flex; gap: 3cqw; font-size: 2.3cqw; font-weight: 600; letter-spacing: 0.12em; line-height: 1; min-height: 2.4cqw; }
  .fl-selstatus b { font-weight: 600; color: var(--amber); }
  .fl-selstatus b.fl-ok { color: #c8ff3a; }
  .fl-post { gap: 1.3cqh; }
  .fl-set { display: flex; align-items: baseline; gap: 2.4cqw; font-family: 'Bungee', 'Arial Black', sans-serif; line-height: 1; }
  .fl-set .fl-sn { font-size: 8cqw; color: #fff; text-shadow: 0 0 0.6cqw var(--c), 0 0 1.8cqw var(--c); }
  .fl-set .fl-sl { font-size: 2.2cqw; color: color-mix(in srgb, var(--c) 70%, #fff); letter-spacing: 0.06em; }
  .fl-set .fl-dash { font-size: 5cqw; color: rgba(230,214,255,0.6); }
  .fl-set .fl-me { --c: var(--pink); } .fl-set .fl-them { --c: var(--cyan); }
  .fl-cd { font-family: 'Bungee', sans-serif; font-size: 3.2cqw; color: #ffd98f; min-height: 3.4cqw; }
  .fl-cd small { display: block; text-align: center; font: 600 1.8cqw/1.2 'Teko', sans-serif; letter-spacing: 0.12em; color: rgba(230,214,255,0.8); }
  .fl-post > .fl-row:not(.fl-cdrow) .fl-btn { width: 32cqw; min-width: 0; }   /* a true 2x2 grid, so left and right never drift to the other row */
  .fl-cdrow { min-height: max(36px, 6cqh); gap: 2.4cqw; }
  .fl-cdrow .fl-btn.fl-dis { visibility: hidden; }
  .fl-rivalline { font-size: 2.4cqw; font-weight: 600; letter-spacing: 0.14em; color: rgba(230,214,255,0.9); min-height: 2.5cqw; }
  .fl-rivalline b { font-weight: 600; color: var(--amber); }
  .fl-post .fl-btn small { min-height: 1.7cqw; }
  .fl-post .fl-btn.fl-want small { color: var(--amber); opacity: 1; animation: fl-blink 0.9s steps(1) infinite; }
  .fl-post .fl-btn.fl-focus.fl-want small { color: var(--deep); }

  /* typing screens (a name, a crew name or link, an email, a code): the field over the on-screen keyboard */
  .fl-text { gap: 1.2cqh; }
  .fl-text .fl-h2 { font-size: 3.6cqw; }
  .fl-field { min-width: 44cqw; max-width: 86cqw; min-height: 6.2cqw; padding: 0.5cqw 1.6cqw 0; border: 2px solid var(--pink); background: rgba(14,4,30,0.7);
    box-shadow: 0 0 1.2cqw color-mix(in srgb, var(--pink) 50%, transparent); font: 400 4cqw/5.6cqw 'Bungee', 'Arial Black', sans-serif; color: #fff;
    text-align: center; white-space: pre; overflow: hidden; letter-spacing: 0.04em; }
  .fl-field.fl-lower { font: 600 3.8cqw/5.8cqw 'Teko', 'Arial Narrow', sans-serif; letter-spacing: 0.04em; }
  .fl-caret { display: inline-block; width: 0.5cqw; height: 4cqw; margin-left: 0.3cqw; vertical-align: -0.5cqw; background: var(--amber); box-shadow: 0 0 0.8cqw var(--amber); animation: fl-blink 1s steps(1) infinite; }
  .fl-temsg { min-height: 2.2cqw; max-width: 80cqw; }
  .fl-warn { color: #ffc2f3 !important; }
  .fl-text .fl-key { width: 5cqw; height: 5cqw; font-size: 2.7cqw; }
  .fl-text .fl-key.fl-wide { width: 9cqw; font-size: 2cqw; }
  .fl-text .fl-kb { gap: 0.5cqw; }
  .fl-text .fl-kbrow { gap: 0.5cqw; }

  /* the online menu: crew rooms beside quick match, the profile row under them */
  .fl-online { gap: 1.2cqh; }
  .fl-onlinecols { align-items: flex-start; gap: 3cqw; }
  .fl-ocol { width: 30cqw; gap: 1.1cqh; }
  .fl-ocol .fl-btn { min-width: 0; width: 100%; }
  .fl-colhead { font: 400 1.7cqw/1 'Bungee', sans-serif; letter-spacing: 0.08em; color: var(--amber); text-align: center; margin-bottom: 0.2cqh; }
  .fl-orow { gap: 1.4cqw; margin-top: 0.6cqh; }
  .fl-orow .fl-btn { min-width: 14cqw; }

  /* spectators: the LIVE list and the watch view (readable text never glows) */
  .fl-spec { min-width: 0; margin-top: -0.4cqh; }
  .fl-livelist { width: 66cqw; gap: 1cqh; }
  .fl-liverow { min-width: 0; width: 100%; padding: 0.5cqw 1.4cqw 0.2cqw; text-shadow: none; }
  .fl-lline { display: grid; grid-template-columns: 1fr auto 1fr; align-items: baseline; gap: 1.6cqw; width: 100%; }
  .fl-lside { display: flex; align-items: baseline; gap: 0.9cqw; min-width: 0; white-space: nowrap; }
  .fl-lside0 { justify-content: flex-end; } .fl-lside1 { flex-direction: row-reverse; justify-content: flex-end; }
  .fl-lchar { font-weight: 600; color: var(--fc, var(--ink)); }
  .fl-lname { font-style: normal; font-size: 2.1cqw; font-weight: 500; color: rgba(230,214,255,0.86); letter-spacing: 0.08em; }
  .fl-lvs { font: normal 400 2.2cqw/1 'Bungee', sans-serif; color: var(--ink); }
  /* the focused row keeps its dark ground, so the fighters stay in their own colors: a white edge marks it */
  .fl-liverow.fl-focus { background: rgba(46,242,255,0.16); color: var(--ink); border-color: #fff; text-shadow: none; box-shadow: 0 0 1.4cqw var(--c); }
  .fl-liverow small { color: #ffe0a8; opacity: 1; }
  .fl-watch { pointer-events: none; justify-content: flex-end; }
  .fl-wtag { text-shadow: none; font: normal 400 1.5cqw/1 'Bungee', sans-serif; letter-spacing: 0.06em; color: var(--deep); background: var(--amber); padding: 0.45cqw 0.7cqw 0.25cqw; }
  .fl-wbar { position: absolute; left: 50%; bottom: 2.2cqh; transform: translateX(-50%); display: flex; align-items: center; gap: 1.2cqw; white-space: nowrap;
    padding: 0.5cqw 1.1cqw 0.4cqw 0.6cqw; background: rgba(10,4,20,0.78); border: 2px solid rgba(255,176,46,0.7);
    font-size: 2.2cqw; font-weight: 600; letter-spacing: 0.1em; line-height: 1; }
  .fl-wnames { color: var(--ink); } .fl-wcount { color: #ffe0a8; } .fl-wnote { color: rgba(214,190,255,0.85); } .fl-wnote:empty { display: none; }
  .fl-wnote.fl-warn { color: #ffc2f3; }
  .fl-wbtns { position: absolute; right: 1.6cqw; bottom: 2cqh; gap: 0.8cqw; }
  .fl-wbtns .fl-btn:not(.fl-focus) { background: rgba(10,4,20,0.78); }
  .fl-watch-wait, .fl-watch-stop, .fl-watch-result { justify-content: center; }
  .fl-wcard { pointer-events: auto; display: flex; flex-direction: column; align-items: center; gap: 1.6cqh; max-width: 84cqw;
    padding: 3cqh 3cqw 3.4cqh; background: rgba(10,4,20,0.86); border: 2px solid var(--cyan); }
  .fl-watch-result .fl-wcard { margin-top: 34cqh; padding: 1.8cqh 2.4cqw 2.2cqh; gap: 1.1cqh; border-color: var(--amber); }
  .fl-watch-result .fl-h2 { font-size: 3.2cqw; }

  /* the profile */
  .fl-pname { font-size: 6cqw; }
  .fl-pemail { text-transform: none; letter-spacing: 0.08em; }
  .fl-profile .fl-small { max-width: 70cqw; }

  /* the privacy and house rules links (index.js legalLinks), and the age question before an email */
  .fl-legal { pointer-events: auto; }
  .fl-legal a { color: #4df3ff; text-decoration: none; border-bottom: 1px solid rgba(77,243,255,0.4); padding: 0.4cqw 0.2cqw; }
  .fl-legal a:hover, .fl-legal a:focus-visible { color: #fff; border-bottom-color: #fff; }
  .fl-age-note { max-width: 66cqw; line-height: 1.3; }
  .fl-age-ok { max-width: 70cqw; line-height: 1.15; }
  .fl-inimsg { min-height: 2.2cqw; }

  /* the crew lobby: standings on the left, PLAY and the link on the right */
  .fl-crew { gap: 1cqh; }
  .fl-crew .fl-h2 { font-size: 3.6cqw; }
  .fl-crew .fl-link { font-size: 1.8cqw; }
  .fl-crewbody { align-items: flex-start; gap: 1.6cqw; margin-top: 0.6cqh; }
  .fl-crewleft { width: 52cqw; display: flex; flex-direction: column; gap: 1.4cqh; }
  .fl-crewright { width: 24cqw; }
  .fl-crewbody > .fl-qr { --qr: 18cqw; }   /* the crew link's QR code, a third column */
  .fl-standings { display: grid; grid-template-columns: 2.2cqw 1fr 3cqw 3cqw 3cqw 5cqw 11cqw; column-gap: 0.8cqw; row-gap: 0.5cqh; align-items: baseline;
    padding: 1cqw 1.2cqw; border: 2px solid rgba(46,242,255,0.5); background: rgba(14,4,30,0.66); font-size: 2.3cqw; font-weight: 600; letter-spacing: 0.08em; line-height: 1.05; }
  .fl-standings span { color: #e9dcff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fl-standings .fl-sth { font: 400 1.2cqw/1 'Bungee', sans-serif; color: rgba(214,190,255,0.7); letter-spacing: 0.06em; }
  .fl-standings .fl-srank { color: var(--amber); }
  .fl-standings .fl-snum { text-align: right; font-variant-numeric: tabular-nums; }
  .fl-standings .fl-svs { color: var(--cyan); }
  .fl-standings .fl-sfav { color: color-mix(in srgb, var(--fc, var(--violet)) 55%, #fff); font-size: 2cqw; }
  .fl-standings .fl-me { color: #ffc2f3; }
  .fl-standings .fl-smore { grid-column: 1 / -1; font-size: 1.8cqw; color: rgba(214,190,255,0.7); text-align: center; }
  .fl-sname { display: flex; align-items: baseline; gap: 0.6cqw; }
  .fl-dot { display: inline-block; flex: none; width: 1cqw; height: 1cqw; border: 2px solid rgba(214,190,255,0.35); transform: translateY(-0.1cqw); }
  .fl-dot.fl-on-here { background: var(--cyan); border-color: var(--cyan); box-shadow: 0 0 0.6cqw var(--cyan); }
  .fl-dot.fl-on-ready { background: var(--amber); border-color: var(--amber); box-shadow: 0 0 0.6cqw var(--amber); }
  .fl-dot.fl-on-match { background: var(--pink); border-color: var(--pink); box-shadow: 0 0 0.6cqw var(--pink); }
  .fl-chip { font: normal 400 1cqw/1 'Bungee', sans-serif; padding: 0.3cqw 0.4cqw 0.15cqw; color: var(--deep); text-shadow: none; letter-spacing: 0.04em; }
  .fl-chip.fl-on-ready { background: var(--amber); } .fl-chip.fl-on-match { background: var(--pink); }
  .fl-recent { display: flex; flex-direction: column; gap: 0.4cqh; font-size: 1.8cqw; font-weight: 500; letter-spacing: 0.1em; color: rgba(214,190,255,0.75); min-height: 6cqh; }
  .fl-crewbtns { gap: 1.2cqh; align-items: stretch; }
  .fl-crewstatus { min-height: 5.4cqw; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0.6cqw 0.8cqw 0.3cqw; border: 2px solid rgba(255,176,46,0.5);
    font-size: 2cqw; font-weight: 600; letter-spacing: 0.1em; line-height: 1.1; color: #ffd98f; }
  .fl-playbtn { min-width: 0; width: 100%; min-height: max(56px, 13cqh); }
  .fl-playbtn .fl-pl { font: 400 4.4cqw/1 'Bungee', 'Arial Black', sans-serif; letter-spacing: 0.04em; }
  .fl-crewpair { gap: 1cqw; }
  .fl-crewpair .fl-btn { flex: 1; min-width: 0; padding-left: 0; padding-right: 0; font-size: 1.9cqw; letter-spacing: 0.08em; }
  .fl-crewfail .fl-h3 { max-width: 70cqw; }
  /* the lobby's views (paintLobby): the tabs over the table, then the standings, a crew high score table, or the stats */
  .fl-crewtabs { grid-column: 1 / -1; display: flex; gap: 0.6cqw; margin-bottom: 0.5cqh; }
  .fl-crewtab { flex: 1; min-width: 0; min-height: 0; padding: 0.5cqw 0 0.2cqw; font-size: 1.4cqw; letter-spacing: 0.06em; }
  .fl-crewtab.fl-on { color: var(--deep); background: var(--amber); border-color: var(--amber); text-shadow: none; }
  .fl-standings.fl-v-arcade, .fl-standings.fl-v-horde { grid-template-columns: 2.2cqw minmax(0, 0.6fr) max-content minmax(0, 1fr) max-content max-content; row-gap: 0.35cqh; }
  .fl-standings .fl-sinit { letter-spacing: 0.18em; }
  .fl-standings .fl-snote, .fl-standings .fl-sdate { text-align: right; font-size: 1.9cqw; color: rgba(214,190,255,0.8); font-variant-numeric: tabular-nums; }
  .fl-standings.fl-v-stats { grid-template-columns: 1fr 1fr; column-gap: 1.6cqw; row-gap: 0.8cqh; align-items: start; }
  .fl-stsum { grid-column: 1 / -1; font-size: 2.3cqw; letter-spacing: 0.08em; color: rgba(214,190,255,0.85); }
  .fl-stsum b { color: var(--amber); font-weight: 600; font-variant-numeric: tabular-nums; }
  .fl-stsec { display: flex; flex-direction: column; gap: 0.4cqh; min-width: 0; }
  .fl-stsec.fl-stwide { grid-column: 1 / -1; }   /* MOST PICKED across, then PLAYERS and MATCHUPS side by side */
  .fl-standings .fl-sttitle { display: block; }
  .fl-stpicks { display: flex; flex-wrap: wrap; gap: 0.3cqh 1.6cqw; }
  .fl-stgrid { display: grid; column-gap: 0.8cqw; row-gap: 0.3cqh; align-items: baseline; font-size: 2cqw; }
  .fl-stmem { grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); }
  .fl-stmu { grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto; }
  .fl-stgrid .fl-sfav { font-size: 1.8cqw; }

  /* A narrow stage: a phone held upright, where the stage is about 390 by 219. A column of seven or nine
     44px buttons can't fit that, so the long menus go wide instead of tall, and the small print grows
     enough to read. fit() (above) zooms out whatever is still too tall. */
  @container (max-width: 520px) {
    .fl-screen { gap: 1.2cqh; }
    .fl-veil { padding-bottom: 0; }   /* the legend is for keys and a pad; here it sits over the bottom edge when one is in use */
    .fl-btn { min-height: max(38px, 8cqh); font-size: 3.6cqw; }
    .fl-btn small { font-size: 2.3cqw; }
    .fl-label { font-size: 2.8cqw; }
    /* mode select: the four modes two by two, the two rules side by side, BACK across */
    .fl-modes .fl-list { display: grid; grid-template-columns: 1fr 1fr; gap: 1.6cqh 1.6cqw; width: 94cqw; }
    .fl-modes .fl-list .fl-btn { min-width: 0; }
    .fl-modes .fl-list .fl-btn:last-child { grid-column: 1 / -1; min-height: 32px; }
    /* pause: the menu three across. The right panel (techniques, controls) and the button that swaps it need
       the room a sideways stage has, so upright they stay hidden. */
    .fl-pause .fl-tech, .fl-pause .fl-viewbtn { display: none; }
    .fl-pause .fl-list { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1.6cqh 1.4cqw; width: 96cqw; }
    .fl-pause .fl-list .fl-btn { min-width: 0; padding-left: 0.6cqw; padding-right: 0.6cqw; font-size: 3.3cqw; white-space: nowrap; }
    .fl-pause .fl-list .fl-btn small { font-size: 2cqw; }
    /* the fighter select's footer buttons give up their 44px floor to stay on the stage */
    .fl-selfoot .fl-btn { min-height: 12cqh; }
    .fl-select { padding-top: 1.6cqh; gap: 1cqh; }
    /* the host screen: the QR code takes the right of the stage at the biggest size that fits, everything else stacks beside it */
    .fl-host { grid-template-areas: "t q" "i q" "b q" "s q"; column-gap: 2.4cqw; row-gap: 1.2cqh; }
    .fl-host > .fl-qr { --qr: 66cqh; }
    .fl-hostinfo { width: 56cqw; gap: 1.2cqh; }
    .fl-host > .fl-row { width: 56cqw; flex-wrap: wrap; gap: 1.2cqh 1.4cqw; }
    .fl-host > .fl-row .fl-btn { min-width: 0 !important; flex: 1 1 40%; }
    .fl-host > .fl-spec { width: 56cqw; min-height: 30px; padding: 0.4cqw 0.6cqw 0; font-size: 2.5cqw; line-height: 1; letter-spacing: 0.06em; white-space: normal; text-align: center; }
    .fl-qrlabel { font-size: 2.8cqw; }
    /* the crew lobby: the FAVORITE column gives its room to the QR code, and the small buttons keep their words inside */
    .fl-crewleft { width: 43cqw; }
    .fl-crewbody > .fl-qr { --qr: 27cqw; }
    .fl-standings.fl-v-standings { grid-template-columns: 2.2cqw 1fr 3cqw 3cqw 3cqw 5cqw; }
    .fl-v-standings .fl-sfav, .fl-v-standings .fl-sthfav { display: none; }
    .fl-standings.fl-v-arcade, .fl-standings.fl-v-horde { grid-template-columns: 3cqw minmax(0, 1fr) max-content minmax(0, 1fr) max-content; }
    .fl-standings .fl-sdate { display: none; }
    .fl-standings.fl-v-stats { grid-template-columns: 1fr; }
    .fl-crew .fl-crewtabs .fl-btn.fl-crewtab { font-size: 1.7cqw; letter-spacing: 0.02em; min-height: 0; }
    .fl-crew .fl-btn.fl-mini { font-size: 2.3cqw; min-height: 30px; }
    .fl-crew .fl-playbtn { min-height: 44px; }
    .fl-crew .fl-playbtn small { font-size: 2cqw; }
    .fl-crew .fl-playbtn .fl-pl { font-size: 3.6cqw; }
    .fl-crew .fl-crewpair .fl-btn { font-size: 1.9cqw; letter-spacing: 0.02em; }
  }

  /* The crew lobby's views held upright. [twgdsx] lays the lobby out as one grid when the phone is upright
     (.fl-up, its own block); these only size what this card added inside the table (the tabs, the high score
     tables, the stats), and do nothing until that layout is on. */
  /* the tabs stay at the top of the scrolling list, and the column heads stick under them */
  #flow > .fl-up.fl-crew .fl-crewtabs { position: sticky; top: 0; z-index: 2; gap: 1.6cqw; margin: 0 -2.4cqw; padding: 2.2cqw 2.4cqw 0.4em; background: #10061f; }
  #flow > .fl-up.fl-crew .fl-crewtabs .fl-btn.fl-crewtab { min-height: 44px; font-size: max(13px, 3.8cqw); letter-spacing: 0.04em; }
  #flow > .fl-up.fl-crew .fl-standings .fl-sth { top: calc(44px + 2.2cqw + 0.4em); }
  #flow > .fl-up.fl-crew .fl-standings .fl-sthfav { display: block; }
  #flow > .fl-up.fl-crew .fl-standings.fl-v-arcade, #flow > .fl-up.fl-crew .fl-standings.fl-v-horde { grid-template-columns: 5cqw minmax(0, 0.7fr) max-content minmax(0, 1fr) max-content; }
  #flow > .fl-up.fl-crew .fl-standings .fl-sdate, #flow > .fl-up.fl-crew .fl-standings.fl-standings .fl-sth.fl-sdate { display: none; }   /* (outranks the layout's FAVORITE-column rule, which counts children) */
  #flow > .fl-up.fl-crew .fl-standings .fl-sttitle { position: static; padding-top: 0; background: none; }
  #flow > .fl-up.fl-crew .fl-standings .fl-snote { font-size: max(12px, 3.5cqw); }
  #flow > .fl-up.fl-crew .fl-standings.fl-v-stats { grid-template-columns: 1fr; row-gap: 1.2em; }
  #flow > .fl-up.fl-crew .fl-stsum { font-size: max(14px, 4.4cqw); }
  #flow > .fl-up.fl-crew .fl-stgrid { font-size: max(13px, 3.9cqw); column-gap: 2.4cqw; }
  #flow > .fl-up.fl-crew .fl-stgrid .fl-sfav, #flow > .fl-up.fl-crew .fl-stpicks .fl-sfav { font-size: max(12px, 3.6cqw); }

  /* The character select held upright (select.js, .fl-tall): the 16:9 box is a strip a quarter of the phone's
     height, where 18 cards were 60 px tall. So this one screen leaves the box: #flow takes the whole viewport
     under the top buttons, and the roster is a carousel with the sheet under it. Units here are the phone's
     (#flow is the container), so 1cqw is about 4 px, not 13. The touch controls stand down while it's up. */
  html.sq #flow:has(> .fl-tall) { position: fixed; inset: 0; z-index: 19; }
  html.sq:has(#flow > .fl-tall) .tc-stickzone, html.sq:has(#flow > .fl-tall) .tc-cluster { display: none; }
  #flow .fl-tall { justify-content: flex-start; gap: 1.1cqh; padding: calc(var(--tc-strip, 3rem) + 0.25rem) 4cqw max(0.75rem, env(safe-area-inset-bottom)); }
  html.sq #flow .fl-tall.fl-veil { background: radial-gradient(ellipse at 50% 28%, rgba(26,8,54,0.97), rgba(5,1,12,0.985) 70%); }   /* outranks the square's see-through veil (src/touch.js) */
  html.sq #flow .fl-tall.fl-veil::before { display: none; }
  /* iPhone Safari's PLAY FULL SCREEN callout (src/homescreen.js) is pinned to the bottom of the screen: the footer sits above it */
  html:has(.sf-hs-tip.sf-hs-fits) #flow .fl-tall { padding-bottom: calc(max(0.75rem, env(safe-area-inset-bottom)) + 3rem + 4px + 0.6rem); }
  #flow .fl-tall .fl-h2 { font-size: 7.2cqw; }
  #flow .fl-tall .fl-label { font-size: 3.5cqw; line-height: 1.1; }
  #flow .fl-tall .fl-selstatus { flex-direction: column; align-items: center; gap: 0.5cqh; font-size: 3.8cqw; min-height: 0; }
  #flow .fl-ring { position: relative; align-self: stretch; margin: 0 -4cqw; flex: 1 1 0; min-height: 120px; max-height: 400px; overflow: hidden; touch-action: none; pointer-events: auto; }
  #flow .fl-tall .fl-card { position: absolute; left: 50%; top: 0; height: 100%; width: auto; aspect-ratio: 0.7; translate: -50% 0; padding: 0 0 1.2cqh;
    transition: background 80ms, border-color 80ms; transform-origin: 50% 50%; will-change: transform;
    background: #0c0419; }   /* solid: the cards behind the middle one don't show through it */
  #flow .fl-tall .fl-card.fl-focus { background: color-mix(in srgb, var(--c) 24%, #0e041e); }
  #flow .fl-tall .fl-card b { font-size: 6cqw; letter-spacing: 0.06em; }
  #flow .fl-tall .fl-card b.fl-long { font-size: 4.8cqw; line-height: 0.9; padding: 0 1cqw; }
  #flow .fl-tall .fl-card.fl-focus { box-shadow: 0 0 0 1px color-mix(in srgb, #fff 55%, var(--c)), 0 0 4cqw var(--c), inset 0 0 4cqw color-mix(in srgb, var(--c) 50%, transparent); }
  #flow .fl-tall .fl-card .fl-tag, #flow .fl-tall.fl-netpick .fl-card.fl-focus::before { font-size: 3.4cqw; padding: 1cqw 1.4cqw 0.6cqw; top: 1cqh; }
  #flow .fl-tall .fl-card .fl-tag { right: 1.4cqw; }
  #flow .fl-tall.fl-netpick .fl-card.fl-focus::before { left: 1.4cqw; }
  #flow .fl-tall.fl-netpick .fl-card.fl-focus .fl-tag { top: 5.4cqh; }
  #flow .fl-tall.fl-netpick .fl-card.fl-rival { outline-offset: -1.6cqw; }
  .fl-ringstep { position: absolute; top: 50%; z-index: 200; translate: 0 -50%; pointer-events: auto; appearance: none; margin: 0; cursor: pointer; width: 48px; height: 36px; padding: 0; border: 2px solid var(--cyan); border-radius: 0;
    background: rgba(14,4,30,0.62); color: #d8fdff; text-shadow: none; display: flex; align-items: center; justify-content: center; }
  .fl-ringstep svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: square; }
  .fl-ringstep:active { background: var(--cyan); color: var(--deep); }
  .fl-ringstep:focus { outline: none; }
  /* the key and pad legend takes its own line at the bottom here, under the hints, not over them */
  #flow .fl-tall .lg-bar { position: static; transform: none; align-self: center; flex-wrap: wrap; row-gap: 0.6em; column-gap: 1.6em; --lg: 3.2cqw; margin-top: auto; }
  .fl-ringstep.fl-prev { left: 2cqw; } .fl-ringstep.fl-next { right: 2cqw; }
  #flow .fl-tall .fl-detail { position: relative; }
  .fl-ringcount { position: absolute; top: 2.6cqw; right: 4cqw; font: 600 4.4cqw/1 'Teko', sans-serif; letter-spacing: 0.14em; color: rgba(230,214,255,0.7); }
  #flow .fl-tall .fl-detail { width: 100%; height: auto; flex: none; display: block; padding: 2.6cqw 4cqw 3cqw; box-shadow: 0 0 3cqw color-mix(in srgb, var(--c) 40%, transparent), inset 0 0 4cqw color-mix(in srgb, var(--c) 14%, transparent); }
  #flow .fl-tall .fl-info { gap: 0.7cqh; }
  #flow .fl-tall .fl-cname { font-size: 7.6cqw; }
  #flow .fl-tall .fl-cname.fl-long { font-size: 6cqw; }
  #flow .fl-tall .fl-cname { height: 7.6cqw; line-height: 7.6cqw; }   /* a long name is smaller type in the same line, so the sheet stays one height */
  #flow .fl-tall .fl-tagline { font-size: 4.4cqw; min-height: 2.1em; }   /* two lines' room whether it takes one or two: the sheet is one height for every fighter */
  #flow .fl-tall .fl-moves b, #flow .fl-tall .fl-moves em, #flow .fl-tall .fl-moves small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  #flow .fl-tall .fl-moves b, #flow .fl-tall .fl-moves em { height: 1.05em; line-height: 1.05; }   /* every line one height, arrows and empty notes too */
  #flow .fl-tall .fl-moves small { display: block; height: 1.15em; line-height: 1.15; }
  #flow .fl-tall .fl-cname { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 14cqw; }
  #flow .fl-tall .fl-stats { column-gap: 3cqw; row-gap: 0.5cqh; }
  #flow .fl-tall .fl-stats span { font-size: 3.9cqw; }
  #flow .fl-tall .fl-stats i { height: 1cqh; min-height: 8px; }
  #flow .fl-tall .fl-stats i::before { box-shadow: 0 0 2cqw var(--c); }
  #flow .fl-tall .fl-moves { gap: 0.6cqh; padding-top: 0.9cqh; }
  #flow .fl-tall .fl-moves p { column-gap: 3cqw; }
  #flow .fl-tall .fl-moves b, #flow .fl-tall .fl-moves em { font-size: 4.8cqw; }
  #flow .fl-tall .fl-moves small { font-size: 3.5cqw; }
  #flow .fl-tall .fl-selfoot { align-self: stretch; gap: 2.4cqw; flex-wrap: wrap; }
  #flow .fl-tall .fl-selfoot .fl-btn { flex: 1 1 26%; min-width: 0; min-height: 46px; font-size: 5cqw; letter-spacing: 0.05em; padding: 0.6cqw 1cqw 0; white-space: nowrap; }
  .fl-selhints { align-self: stretch; display: flex; justify-content: space-between; align-items: baseline; gap: 3cqw; }
  #flow .fl-tall .fl-small { font-size: 3.3cqw; letter-spacing: 0.08em; text-align: left; white-space: nowrap; }
  #flow .fl-tall .fl-found { text-align: right; white-space: nowrap; }
  /* a short phone (an iPhone SE): the move notes go, so the carousel keeps its size */
  @container (max-height: 720px) {
    #flow .fl-tall .fl-moves small { display: none; }
    #flow .fl-tall .fl-tagline { font-size: 4cqw; }
    #flow .fl-tall .fl-stats { grid-template-columns: auto 1fr auto 1fr; }   /* the five bars two to a row */
    #flow .fl-tall .fl-stats span { font-size: 3.4cqw; }
    #flow .fl-tall { gap: 0.9cqh; }
  }
  /* shorter still (an SE with Safari's bars showing): the sheet keeps the name and the bars; the moves are a tap away in MOVE LIST */
  @container (max-height: 600px) {
    #flow .fl-tall .fl-moves, #flow .fl-tall .fl-tagline { display: none; }
  }
  `;
  const s = document.createElement('style');
  s.id = 'flow-style';
  s.textContent = css;
  document.head.appendChild(s);
}
