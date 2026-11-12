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
import { onSquare, square } from '../square.js';   // held upright, a menu takes the whole screen (.fl-up)

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
  let veiled = false;   // the screen up is a menu over a dimmed scene (the title and the watch view aren't)

  // Held upright (html.sq, src/square.js) the 16:9 box is a strip about 390 by 219, a quarter of the phone. So every
  // menu leaves it for the whole screen, under the top buttons, with its own phone-sized layout (.fl-up, the
  // stylesheet's last part). The character select does the same its own way (.fl-tall). Turning the phone
  // switches the screen up between the two at once.
  const upright = () => veiled && square.on && !!screen && !screen.classList.contains('fl-tall');
  function setUp() {
    if (!screen) return;
    const on = upright();
    if (on === screen.classList.contains('fl-up')) return;
    screen.classList.toggle('fl-up', on);
    zoomNow = 1; screen.style.zoom = '';
    fit();
  }
  onSquare(() => setUp());

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
    // a sliver of air at the top and bottom; a full-screen upright menu has its padding for that, and a box in it
    // that scrolls takes up whatever is left, so it always fills the screen exactly
    const edge = screen.classList.contains('fl-up') ? -0.5 : st.height * 0.012;
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
    veiled = veil;
    if (upright()) s.classList.add('fl-up');   // before it's built, so a screen can lay out for it
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
    screen = null; items = []; focus = -1; backFn = null; focusFn = null; moveFn = null; veiled = false;
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
  /* DELETE MY PROFILE: red, a size down, on its own row so nobody hits it on the way to BACK */
  .fl-red { --c: #ff4d5e; } .fl-btn.fl-quiet { font-size: 2.6cqw; min-height: max(40px, 6.5cqh); }

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
  /* palettes (README, Progression): flat swatches, body over pants with the accent as a stripe; the one in use outlined
     in white, a locked one shows its price in sticks. Readable text, no glow. */
  .fl-pals { display: flex; gap: 0.8cqw; margin-top: auto; }
  .fl-btn.fl-pal { min-width: 0; flex: 1; min-height: max(36px, 6.4cqh); padding: 0.3cqw; gap: 0.2cqh; box-shadow: none; --c: rgba(214,190,255,0.55); }
  .fl-pal .fl-sw { display: block; width: 100%; height: 2.6cqh; min-height: 12px;
    background: linear-gradient(var(--sw) 0 55%, var(--sw3) 55% 65%, var(--sw2) 65% 100%); }
  .fl-pal small { margin: 0; font-size: 1.5cqw; letter-spacing: 0.08em; color: #eadcff; }
  .fl-btn.fl-pal.fl-palon { --c: #ffffff; }
  .fl-btn.fl-pal.fl-pallock small { color: #ffc46b; }
  .fl-btn.fl-pal.fl-focus small { color: var(--deep); }
  .fl-select:not(.fl-tall) .fl-btn.fl-pal { min-height: max(34px, 5.6cqh); }
  .fl-select:not(.fl-tall) .fl-info:has(.fl-pals) { gap: 0.5cqh; }
  .fl-select:not(.fl-tall) .fl-info:has(.fl-pals) .fl-moves { margin-top: 0.2cqh; padding-top: 0.6cqh; gap: 0.3cqh; }
  .fl-palnote { min-height: 1.1em; font: 600 1.6cqw/1 'Teko', sans-serif; letter-spacing: 0.08em; color: #eadcff; }
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
  .fl-netpick .fl-selfoot .fl-btn { min-width: 16cqw; }
  /* its sheet is shorter too: a fighter with four moves (TEMP's RISE AND SHINE) ran past it onto the hints, so the
     move notes go here (MOVE LIST has them) */
  .fl-netpick:not(.fl-tall) .fl-moves small { display: none; }   /* four buttons here (LEAVE ROOM, PICK, MOVE LIST, START) */
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
  .fl-hint { opacity: 0.35; }
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
  .fl-profile .fl-row + .fl-row { margin-top: -0.6cqw; }

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
  .fl-standings .fl-me, .fl-standings .fl-me > span { color: #ffc2f3; }   /* your row, name and (YOU) included, is pink */
  .fl-standings .fl-smore { grid-column: 1 / -1; font-size: 1.8cqw; color: rgba(214,190,255,0.7); text-align: center; }
  .fl-sname { display: flex; align-items: baseline; gap: 0.6cqw; min-width: 0; }
  .fl-standings .fl-sname > .fl-snm { min-width: 0; flex: 0 1 auto; }   /* the name takes the ellipsis… */
  .fl-sname > .fl-chip { flex: none; }        /* …so READY / PLAYING always shows whole */
  .fl-standings .fl-sname > .fl-youtag { min-width: 0; flex: 0 10000 auto; }   /* (YOU) clips before the name does, so GUEST 284's digits stay */
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
  #flow .fl-uponly { display: none; }   /* the lobby's upright-only buttons (your name, INVITE); .fl-sideonly is the reverse */
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

  /* The character select held upright (select.js, .fl-tall): the 16:9 box is a strip a quarter of the phone's
     height, where 18 cards were 60 px tall. So this one screen leaves the box: #flow takes the whole viewport
     under the top buttons, and the roster is a carousel with the sheet under it. Units here are the phone's
     (#flow is the container), so 1cqw is about 4 px, not 13. The touch controls stand down while it's up. */
  html.sq #flow:has(> .fl-tall) { position: fixed; inset: 0 0 auto 0; height: 100vh; height: 100dvh; height: var(--sf-seen-h, 100dvh); z-index: 19; }   /* the height you can see (select.js syncVisible) */
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
  /* the same steps by measure (select.js fitTall): whatever the breakpoints left in, if the footer still runs off
     the bottom (the online pick screen's extra lines, a phone's bars), the screen takes the next step */
  #flow .fl-tall.fl-fit1 .fl-moves small { display: none; }
  #flow .fl-tall.fl-fit1 .fl-tagline { font-size: 4cqw; }
  #flow .fl-tall.fl-fit1 .fl-stats { grid-template-columns: auto 1fr auto 1fr; }
  #flow .fl-tall.fl-fit1 .fl-stats span { font-size: 3.4cqw; }
  #flow .fl-tall.fl-fit1 { gap: 0.9cqh; }
  #flow .fl-tall.fl-fit2 .fl-moves, #flow .fl-tall.fl-fit2 .fl-tagline { display: none; }
  #flow .fl-tall.fl-fit3 .fl-selhints { display: none; }

  /* ---- Held upright: every menu (.fl-up, set by show() above) -------------------------------------------------
     The menu leaves the 16:9 strip for the whole screen under the top buttons, like the character select. #flow is
     the container, so 1cqw is about 4 px here (a hundredth of the phone's width) and 1cqh about 8. Body text is
     never under 12 px, a button never under 44 px tall, and long lists (crew members, the LIVE list, the pause
     panel, CONTROLS) scroll by finger inside their own box (data-scroll, README, Controls). These rules all start
     with #flow > .fl-up, so they outrank both the stage layout above and the narrow-stage @container rules. */
  html.sq #flow:has(> .fl-up) { position: fixed; inset: 0; z-index: 19; }
  html.sq:has(#flow > .fl-up) .tc-stickzone, html.sq:has(#flow > .fl-up) .tc-cluster { display: none; }
  html.sq #flow > .fl-up.fl-veil { background: radial-gradient(ellipse at 50% 30%, rgba(26,8,54,0.96), rgba(5,1,12,0.985) 72%); }
  html.sq #flow > .fl-up.fl-veil::before { display: none; }
  #flow > .fl-up { justify-content: center; gap: max(8px, 1.5cqh); padding: calc(var(--tc-strip, 3rem) + 0.5rem) 5cqw max(1rem, env(safe-area-inset-bottom)); }
  html:has(.sf-hs-tip.sf-hs-fits) #flow > .fl-up { padding-bottom: calc(max(0.75rem, env(safe-area-inset-bottom)) + 3rem + 4px + 0.6rem); }
  #flow > .fl-up .fl-h1 { font-size: 12cqw; }
  #flow > .fl-up .fl-h2 { font-size: 7.6cqw; max-width: 100%; }
  #flow > .fl-up .fl-h3 { font-size: 5.4cqw; line-height: 1.15; max-width: 100%; }
  #flow > .fl-up .fl-label { font-size: max(13px, 4cqw); line-height: 1.15; letter-spacing: 0.1em; max-width: 100%; }
  #flow > .fl-up .fl-small { font-size: max(12px, 3.6cqw); line-height: 1.2; letter-spacing: 0.08em; max-width: 100%; }
  #flow > .fl-up .fl-link { font-size: max(12px, 3.6cqw); max-width: 100%; line-height: 1.2; }
  #flow > .fl-up .fl-rule { width: 50cqw; }
  #flow > .fl-up .fl-btn { min-width: 0; min-height: 46px; padding: 0.35em 3cqw 0.1em; font-size: max(15px, 5cqw); letter-spacing: 0.08em; }
  #flow > .fl-up .fl-btn small { font-size: max(12px, 3.4cqw); letter-spacing: 0.08em; margin-top: 0.1em; line-height: 1.05; }
  #flow > .fl-up .fl-btn.fl-mini { min-height: 44px; font-size: max(14px, 4.4cqw); }
  /* a row of buttons spans the screen, two to a line */
  #flow > .fl-up > .fl-row { align-self: stretch; flex-wrap: wrap; gap: 2.4cqw; }
  #flow > .fl-up > .fl-row > .fl-btn { flex: 1 1 40%; min-width: 0 !important; }
  /* the key and pad legend takes its own line at the bottom, not over the buttons */
  #flow > .fl-up > .lg-bar { position: static; transform: none; align-self: center; flex-wrap: wrap; row-gap: 0.6em; column-gap: 1.4em; --lg: max(12px, 3.4cqw); margin-top: 0.4em; }
  /* the legend's and the controls table's small glyphs (the START pill, the round face buttons) keep to the floor */
  #flow > .fl-up .lg-pill { font-size: max(12px, 0.6em); }
  #flow > .fl-up .lg-b { font-size: max(12px, 0.82em); }
  #flow > .fl-up .lg-th { font-size: max(12px, 0.85em); }
  /* the pause menu's and CONTROLS' rows are columns that hold a scrolling box: they don't wrap */
  #flow > .fl-up > .fl-row.fl-pauserow, #flow > .fl-up > .fl-row.fl-ctlrow { flex-wrap: nowrap; justify-content: flex-start; }   /* (centered, an overflow would start above the top, out of reach) */
  /* a box that scrolls under a finger (README, Controls, "What scrolls under a finger") */
  #flow > .fl-up [data-scroll="y"] { overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; pointer-events: auto; scrollbar-width: none; min-height: 0; }
  #flow > .fl-up [data-scroll="y"]::-webkit-scrollbar { display: none; }

  /* mode select: one column of modes, the two rules side by side, BACK across */
  #flow > .fl-up.fl-modes .fl-list { display: grid; grid-template-columns: 1fr 1fr; gap: max(8px, 1.3cqh) 2.4cqw; width: 100%; }
  #flow > .fl-up.fl-modes .fl-list .fl-btn { grid-column: 1 / -1; min-height: max(60px, 8.4cqh); }
  #flow > .fl-up.fl-modes .fl-list .fl-btn.fl-slim { grid-column: auto; min-height: 48px; font-size: max(14px, 4.4cqw); }
  #flow > .fl-up.fl-modes .fl-list .fl-btn:last-child { grid-column: 1 / -1; min-height: 46px; }

  /* the online menu: CREW ROOMS over QUICK MATCH. Your crews across, then CREATE and JOIN side by side; HOST, JOIN, WATCH three across */
  #flow > .fl-up .fl-onlinecols { flex-direction: column; align-items: stretch; align-self: stretch; gap: max(10px, 1.8cqh); }
  #flow > .fl-up .fl-ocol { width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: max(8px, 1.1cqh) 2.4cqw; }
  #flow > .fl-up .fl-ocol:last-child { grid-template-columns: 1fr 1fr 1fr; }
  #flow > .fl-up .fl-ocol > .fl-colhead, #flow > .fl-up .fl-ocol > .fl-crewbtn { grid-column: 1 / -1; }
  #flow > .fl-up .fl-colhead { font-size: max(12px, 3.6cqw); text-align: left; }
  #flow > .fl-up .fl-ocol .fl-btn { min-height: max(54px, 7cqh); padding-left: 1.4cqw; padding-right: 1.4cqw; font-size: max(15px, 4.6cqw); }
  #flow > .fl-up .fl-ocol .fl-btn small { white-space: normal; }
  #flow > .fl-up .fl-orow { align-self: stretch; margin-top: 0; }
  #flow > .fl-up .fl-orow .fl-btn { flex: 1 1 0; min-width: 0; }

  /* the profile: the name big, the buttons two by two */
  #flow > .fl-up .fl-pname { font-size: 11cqw; }
  #flow > .fl-up.fl-profile .fl-small { max-width: 100%; }

  /* typing screens: the field across the screen, a full-width keyboard with keys a thumb can hit, OK under it */
  #flow > .fl-up.fl-text, #flow > .fl-up.fl-join, #flow > .fl-up.fl-initials { gap: max(8px, 1.3cqh); }
  #flow > .fl-up.fl-text .fl-h2 { font-size: 7cqw; }
  #flow > .fl-up .fl-field { align-self: stretch; min-width: 0; max-width: none; min-height: 0; padding: 0.15em 2cqw 0; font-size: 6.4cqw; line-height: 1.55; }
  #flow > .fl-up .fl-field.fl-lower { font-size: max(17px, 5.2cqw); line-height: 1.7; }
  #flow > .fl-up .fl-caret { width: 2px; height: 1em; margin-left: 2px; vertical-align: -0.12em; }
  #flow > .fl-up .fl-temsg { min-height: 2.4em; display: flex; align-items: center; justify-content: center; }
  #flow > .fl-up .fl-kb { --k: calc((100cqw - 10cqw - 9 * 1.2cqw) / 10); align-self: stretch; gap: 1.2cqw; }
  #flow > .fl-up .fl-kbrow { gap: 1.2cqw; width: 100%; }
  #flow > .fl-up .fl-kb .fl-key { flex: 0 1 var(--k); width: auto; min-width: 0; height: max(44px, 5.8cqh); min-height: 0; padding: 0.25em 0 0; font-size: max(16px, 5cqw); }
  #flow > .fl-up .fl-kb .fl-key.fl-wide { flex-basis: calc(var(--k) * 1.5); font-size: max(13px, 3.6cqw); letter-spacing: 0.04em; }
  #flow > .fl-up .fl-slots { gap: 3cqw; }
  #flow > .fl-up .fl-slot b { width: 16cqw; height: 19cqw; font-size: 11cqw; line-height: 20cqw; }
  #flow > .fl-up.fl-join .fl-h3 { font-size: 7cqw; }

  /* the host screen: the code, the QR code as big as the screen allows (never under 140 px, so another phone reads it), the buttons two by two */
  #flow > .fl-up.fl-host { display: flex; gap: max(6px, 1.2cqh); }
  #flow > .fl-up .fl-hostinfo { width: 100%; gap: max(4px, 0.8cqh); }
  #flow > .fl-up.fl-host .fl-hostinfo .fl-h1 { font-size: 14cqw; }
  #flow > .fl-up.fl-host > .fl-qr { --qr: clamp(150px, min(68cqw, calc(100cqh - 500px)), 300px); }
  #flow > .fl-up .fl-qrlabel { font-size: max(12px, 3.6cqw); }
  #flow > .fl-up.fl-host > .fl-row { width: 100%; }
  #flow > .fl-up.fl-host > .fl-spec { align-self: stretch; width: auto; min-height: 44px; padding: 0.3em 2cqw 0.1em; font-size: max(13px, 3.8cqw); line-height: 1.1; white-space: normal; letter-spacing: 0.06em; margin-top: 0; }

  /* the crew lobby, upright (README, Crew rooms, The lobby held upright): it's for whoever just opened the link, so
     it's the crew's name, your name with EDIT, the status and PLAY under your thumb, then everyone in the crew in a
     list that takes the rest and scrolls, and INVITE and MAIN MENU across the bottom. The link, its QR code, COPY
     LINK and SHARE wait behind INVITE (.fl-sharing), which puts them where the list was. The stage layout's boxes
     (body, left, right) step aside (display: contents) so one grid places it all. */
  #flow > .fl-up.fl-crew:not(.fl-crewfail) { display: grid; grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto auto auto minmax(0, 1fr) auto;
    grid-template-areas: "t" "me" "st" "p" "tb" "x";
    align-content: stretch; align-items: stretch; row-gap: max(6px, 1.1cqh); }
  #flow > .fl-up.fl-crew.fl-sharing:not(.fl-crewfail) { grid-template-rows: auto minmax(0, 1fr) auto auto auto minmax(0, 1fr) auto;
    grid-template-areas: "t" "." "q" "l" "c" "." "x"; }
  #flow > .fl-up.fl-crew .fl-crewbody, #flow > .fl-up.fl-crew .fl-crewleft, #flow > .fl-up.fl-crew .fl-crewright, #flow > .fl-up.fl-crew .fl-crewbtns { display: contents; }
  #flow > .fl-up .fl-sideonly, #flow > .fl-up.fl-crew > .fl-label, #flow > .fl-up.fl-crew .fl-recent,
  #flow > .fl-up.fl-crew:not(.fl-sharing) > .fl-link, #flow > .fl-up.fl-crew:not(.fl-sharing) .fl-qr, #flow > .fl-up.fl-crew:not(.fl-sharing) .fl-crewshare,
  #flow > .fl-up.fl-crew.fl-sharing .fl-crewme, #flow > .fl-up.fl-crew.fl-sharing .fl-crewstatus, #flow > .fl-up.fl-crew.fl-sharing .fl-playbtn, #flow > .fl-up.fl-crew.fl-sharing .fl-standings { display: none; }
  #flow > .fl-up.fl-crew > .fl-h2 { grid-area: t; font-size: 7cqw; justify-self: center; text-align: center; }
  /* your name, and EDIT: one slim line, the name on the left */
  #flow > .fl-up.fl-crew .fl-crewme { grid-area: me; display: flex; flex-direction: row; justify-content: space-between; align-items: center; gap: 3cqw;
    --c: var(--violet); min-height: 44px; padding: 0.3em 3cqw 0.1em; font-size: max(14px, 4.2cqw); letter-spacing: 0.06em; }
  #flow > .fl-up.fl-crew .fl-mename { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #flow > .fl-up.fl-crew .fl-meedit { flex: none; font-weight: 600; color: var(--amber); }
  #flow > .fl-up.fl-crew .fl-crewme.fl-focus .fl-meedit { color: var(--deep); }
  #flow > .fl-up.fl-crew > .fl-link { grid-area: l; justify-self: center; text-align: center; font-size: max(12px, 3.6cqw); word-break: break-all; }
  #flow > .fl-up.fl-crew .fl-crewstatus { grid-area: st; min-height: 44px; font-size: max(13px, 4cqw); padding: 0.35em 2cqw 0.15em; }
  #flow > .fl-up.fl-crew .fl-playbtn { grid-area: p; min-height: max(60px, 8cqh); }
  #flow > .fl-up.fl-crew .fl-playbtn .fl-pl { font-size: 8cqw; }
  #flow > .fl-up.fl-crew .fl-playbtn small { font-size: max(12px, 3.6cqw); }
  #flow > .fl-up.fl-crew .fl-crewpair { grid-area: c; align-self: start; gap: 2.4cqw; }
  #flow > .fl-up.fl-crew .fl-crewpair + .fl-crewpair { grid-area: x; }
  #flow > .fl-up.fl-crew .fl-invite { display: flex; flex-direction: row; gap: 2cqw; }
  #flow > .fl-up.fl-crew .fl-invite .fl-icon { width: 1.05em; height: 1.05em; margin-top: -0.2em; flex: none; }
  #flow > .fl-up.fl-crew .fl-crewpair .fl-btn { min-height: 44px; font-size: max(14px, 4.2cqw); letter-spacing: 0.06em; }
  #flow > .fl-up.fl-crew .fl-crewbody > .fl-qr { grid-area: q; --qr: clamp(150px, min(72cqw, calc(100cqh - 340px)), 300px); justify-self: center; }
  #flow > .fl-up.fl-crew.fl-sharing .fl-invite .fl-icon { display: none; }   /* it says DONE now */
  #flow > .fl-up.fl-crew .fl-standings { grid-area: tb; align-content: start; grid-template-columns: 5cqw minmax(0, 1fr) 5cqw 5cqw 5cqw 12cqw 18cqw;
    grid-auto-rows: max-content;   /* the cells clip (ellipsis), so in a box shorter than the list auto rows would shrink to nothing */
    column-gap: 1.6cqw; row-gap: 0.5em; padding: 0 2.4cqw 2cqw; font-size: max(13px, 3.9cqw); }
  #flow > .fl-up.fl-crew .fl-standings .fl-sfav { display: block; }
  #flow > .fl-up.fl-crew .fl-standings .fl-sfav { font-size: max(12px, 3.5cqw); }
  /* the header stays put while the names scroll under it */
  #flow > .fl-up.fl-crew .fl-standings .fl-sth { position: sticky; top: 0; z-index: 1; font: 600 max(12px, 3.4cqw)/1 'Teko', sans-serif; letter-spacing: 0.1em; padding: 2.2cqw 0 0.4em; background: #10061f; align-self: stretch;
    box-shadow: 1.6cqw 0 0 #10061f, -1.6cqw 0 0 #10061f; }   /* (fills the column gaps, so the heads read as one strip) */
  #flow > .fl-up.fl-crew .fl-standings .fl-smore { font-size: max(12px, 3.5cqw); }
  #flow > .fl-up.fl-crew .fl-sname { gap: 1.6cqw; }
  #flow > .fl-up.fl-crew .fl-youtag { display: none; }
  #flow > .fl-up.fl-crew .fl-dot { width: 2.6cqw; height: 2.6cqw; }
  #flow > .fl-up.fl-crew .fl-chip { font-size: 12px; padding: 0.2em 0.35em 0.05em; }
  /* Upright, the standings are who's here and who's ready: rank, the name with its chip, W and L.
     D, VS YOU and FAVORITE (STATS has the history) give their room to the name. */
  #flow > .fl-up.fl-crew .fl-standings.fl-v-standings { grid-template-columns: 6cqw minmax(0, 1fr) 8cqw 8cqw; }
  #flow > .fl-up.fl-crew .fl-standings.fl-v-standings > .fl-sd, #flow > .fl-up.fl-crew .fl-standings.fl-v-standings > .fl-svs,
  #flow > .fl-up.fl-crew .fl-standings.fl-v-standings > .fl-sfav, #flow > .fl-up.fl-crew .fl-standings.fl-v-standings > .fl-sth.fl-sthfav { display: none; }
  /* a short screen: PLAY gives the list a few more px */
  @container (max-height: 660px) {
    #flow > .fl-up.fl-crew .fl-playbtn { min-height: 54px; }
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

  /* the LIVE list: every match, scrolling past what fits */
  #flow > .fl-up .fl-livelist { width: 100%; flex: 0 1 auto; padding: 1cqw; margin: -1cqw; }
  #flow > .fl-up .fl-liverow { min-height: 64px; padding: 0.3em 2.4cqw 0.15em; }
  #flow > .fl-up .fl-lline { gap: 2cqw; font-size: max(15px, 4.6cqw); }
  #flow > .fl-up .fl-lside { flex-direction: column; align-items: flex-end; gap: 0; }
  #flow > .fl-up .fl-lside1 { align-items: flex-start; flex-direction: column; }
  #flow > .fl-up .fl-lname { font-size: max(12px, 3.6cqw); line-height: 1; }
  #flow > .fl-up .fl-lchar { line-height: 1.05; }
  #flow > .fl-up .fl-liverow small { margin-top: 0.3em; }
  #flow > .fl-up .fl-lvs { font-size: max(14px, 4.4cqw); }

  /* the post-match screen */
  #flow > .fl-up.fl-post { gap: max(8px, 1.3cqh); }
  #flow > .fl-up .fl-set { gap: 5cqw; }
  #flow > .fl-up .fl-set .fl-sn { font-size: 18cqw; }
  #flow > .fl-up .fl-set .fl-sl { font-size: max(13px, 4.2cqw); }
  #flow > .fl-up .fl-set .fl-dash { font-size: 10cqw; }
  #flow > .fl-up .fl-cd { font-size: 7cqw; min-height: 0; }
  #flow > .fl-up .fl-cd small { font-size: max(12px, 3.6cqw); }
  #flow > .fl-up .fl-cdrow { min-height: 44px; gap: 4cqw; flex-wrap: nowrap; }
  #flow > .fl-up .fl-cdrow .fl-btn { flex: 0 0 auto; min-width: 26cqw !important; }
  #flow > .fl-up .fl-rivalline { font-size: max(13px, 4.2cqw); min-height: 1.2em; text-align: center; }
  #flow > .fl-up.fl-post > .fl-row:not(.fl-cdrow) .fl-btn { width: auto; }
  #flow > .fl-up.fl-post .fl-btn small { min-height: 0; }

  /* pause: the menu two across, the TECHNIQUES or CONTROLS panel under it in what's left, scrolling */
  #flow > .fl-up.fl-pause { justify-content: flex-start; }
  #flow > .fl-up .fl-pauserow { flex-direction: column; align-items: stretch; align-self: stretch; flex: 0 1 auto; min-height: 0; gap: max(10px, 1.6cqh); }
  #flow > .fl-up.fl-pause .fl-list { display: grid; grid-template-columns: 1fr 1fr; gap: max(8px, 1.1cqh) 2.4cqw; width: 100%; flex: none; }
  #flow > .fl-up.fl-pause .fl-list .fl-btn { min-height: max(52px, 6.4cqh); font-size: max(15px, 4.6cqw); padding-left: 1cqw; padding-right: 1cqw; white-space: normal; }
  #flow > .fl-up.fl-pause .fl-list .fl-btn small { font-size: max(12px, 3.2cqw); }
  #flow > .fl-up.fl-pause .fl-viewbtn { display: flex; }
  #flow > .fl-up.fl-pause .fl-tech { display: flex; width: 100%; flex: 0 1 auto; padding: 3cqw 3.6cqw; gap: 0.7em; }
  #flow > .fl-up .fl-techhead { font-size: max(13px, 4.2cqw); }
  #flow > .fl-up .fl-tech b { font-size: max(15px, 4.6cqw); }
  #flow > .fl-up .fl-tech small { font-size: max(12px, 3.5cqw); line-height: 1.15; }
  #flow > .fl-up .fl-tech.fl-ctlpanel { padding: 3cqw; }

  /* CONTROLS: the two tables and the notes in one column that scrolls */
  #flow > .fl-up.fl-controls { justify-content: flex-start; }
  #flow > .fl-up .fl-ctlrow { flex-direction: column; align-items: stretch; align-self: stretch; flex: 0 1 auto; gap: max(12px, 2cqh); }
  #flow > .fl-up .fl-ctlcol { max-width: none; gap: max(12px, 2cqh); }
  #flow > .fl-up .fl-ctlnote { font-size: max(12px, 3.6cqw); line-height: 1.25; }
  #flow > .fl-up .lg-table { --lg-size: max(15px, 4.2cqw); padding: 3cqw; column-gap: 0.9em; justify-content: start; }
  #flow > .fl-up .lg-table .lg-th.lg-col { font-size: max(12px, 0.7em); }
  /* three columns that share the phone's width: a long key or pad name wraps inside its cell */
  #flow > .fl-up .lg-table { grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr) minmax(0, 1fr); white-space: normal; width: 100%; }
  #flow > .fl-up .lg-table .lg-key { white-space: normal; max-width: 100%; }
  #flow > .fl-up .lg-table .lg-th { white-space: nowrap; }

  /* high scores */
  #flow > .fl-up .fl-table { font-size: max(16px, 5.4cqw); column-gap: 4cqw; row-gap: 0.35em; flex: 0 1 auto; padding: 0 1cqw; }
  #flow > .fl-up .fl-table .fl-note { font-size: max(12px, 3.6cqw); }

  /* the stage card: the two names stacked, the pips across */
  #flow > .fl-up .fl-vs { flex-direction: column; gap: 1cqh; }
  #flow > .fl-up .fl-vs b { font-size: 9cqw; }
  #flow > .fl-up .fl-vs .fl-x { font-size: 5cqw; }
  #flow > .fl-up .fl-pips { gap: 2cqw; flex-wrap: wrap; justify-content: center; }
  #flow > .fl-up .fl-pips i { width: 9cqw; height: 7cqw; font-size: max(12px, 3.8cqw); line-height: 6.6cqw; }
  #flow > .fl-up .fl-pips i.fl-boss { width: 14cqw; }

  /* stage clear, continue, game over */
  #flow > .fl-up .fl-tally { font-size: max(15px, 5cqw); column-gap: 8cqw; }
  #flow > .fl-up .fl-count { font-size: 36cqw; }

  /* the ending's credits roll */
  #flow > .fl-up .fl-roll { width: 100%; height: 56cqh; }
  #flow > .fl-up .fl-roll p { font-size: max(15px, 5cqw); }
  #flow > .fl-up .fl-roll p b { font-size: max(12px, 3.6cqw); }

  /* the watch card (between matches, or one that stopped short) */
  #flow > .fl-up .fl-wcard { max-width: 100%; padding: 4cqw; }

  /* Held upright, the screens that stay in the 16:9 box (the title, the watch view) are sized in phone px: the box
     is about 390 wide, where 1cqw is under 4 px */
  html.sq #flow .fl-title .fl-start { font-size: 16px; min-height: 48px; padding: 0.3em 18px 0; }
  html.sq #flow .fl-titlerow { top: 32px; gap: 8px; }
  html.sq #flow .fl-title .fl-mini { font-size: 14px; min-height: 42px; padding: 0.3em 12px 0; }
  html.sq #flow .fl-wbar { font-size: 13px; gap: 8px; padding: 4px 8px 3px 4px; white-space: normal; max-width: 96%; flex-wrap: wrap; justify-content: center; }
  html.sq #flow .fl-wtag { font-size: 12px; padding: 4px 6px 2px; }
  html.sq #flow .fl-wbar > * { white-space: nowrap; }
  html.sq #flow .fl-wbtns { gap: 8px; right: 8px; bottom: auto; top: calc(1.6cqh - var(--sq-over) * 100cqh); }   /* the view's top corner: the bar has the bottom */
  html.sq #flow .fl-wbtns .fl-btn { min-height: 44px; font-size: 15px; padding: 0.3em 12px 0; }
  html.sq #flow .fl-watch-wait .fl-h2, html.sq #flow .fl-watch-stop .fl-h2, html.sq #flow .fl-watch-result .fl-h2 { font-size: 20px; }
  html.sq #flow .fl-wcard .fl-label, html.sq #flow .fl-wcard .fl-small { font-size: 13px; }
  html.sq #flow .fl-wcard .fl-btn { min-height: 44px; font-size: 15px; }
  .fl-ringstep { height: 44px; }
  `;
  const s = document.createElement('style');
  s.id = 'flow-style';
  s.textContent = css;
  document.head.appendChild(s);
}
