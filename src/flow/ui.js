// The flow's screens: a DOM overlay over the stage (#flow, inside #stage, so it scales with the
// canvas), in the HUD's neon arcade look: Bungee and Teko, glowing text, hard corners. Menus draw
// over a dimmed scene; during a fight the overlay is empty except for the small touch pause
// button in the corner, so nothing covers the fighters (owner requirement).
//
// A screen is a root element plus its focusable items. Keys and the pad move the focus by
// geometry (the nearest item in that direction), so lists, button rows and the keypad all navigate
// the same way; the mouse moves it by hovering, and a click or a tap activates the item.

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

  function setFocus(i, sound = false) {
    if (!items.length) { focus = -1; return; }
    i = Math.max(0, Math.min(items.length - 1, i));
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
      it.el.addEventListener('click', (e) => { e.preventDefault(); if (my !== token) return; if (it.focusFirst && focus !== k) { setFocus(k, true); return; } setFocus(k); activate(); });
      it.el.addEventListener('pointerenter', (e) => { if ((e).pointerType === 'mouse' && my === token) setFocus(k); });
    });
    focus = -1;
    setFocus(out.focus || 0);
    return s;
  }
  function clear() {
    token++;
    if (screen) screen.remove();
    screen = null; items = []; focus = -1; backFn = null; focusFn = null;
  }
  function activate() {
    const it = items[focus];
    if (!it) return;
    if (onSound) onSound('on');
    it.el.classList.add('fl-hit'); setTimeout(() => it.el.classList.remove('fl-hit'), 120);
    it.act();
  }
  function back() { if (backFn) { if (onSound) onSound('off'); backFn(); } }
  // the nearest item in a direction, weighting the cross axis so a column stays a column
  function move(dir) {
    if (!items.length) return;
    if (focus < 0) { setFocus(0, true); return; }
    const c = (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const a = c(items[focus].el);
    let best = -1, bd = Infinity;
    items.forEach((it, k) => {
      if (k === focus) return;
      const b = c(it.el), dx = b.x - a.x, dy = b.y - a.y;
      const main = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
      const cross = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      if (main <= 2) return;
      const d = main + cross * 2.2;
      if (d < bd) { bd = d; best = k; }
    });
    if (best >= 0) setFocus(best, true);
  }
  return {
    root, pauseBtn, show, clear, activate, back, move, setFocus,
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
  .fl-veil { pointer-events: auto; background: radial-gradient(ellipse at 50% 45%, rgba(18,5,38,0.80), rgba(5,1,12,0.92)); }
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
  .fl-pink { --c: var(--pink); } .fl-amber { --c: var(--amber); } .fl-violet { --c: var(--violet); }

  /* title: the START button sits where the HUD's prompt would be (main.js positions it per frame) */
  .fl-title { pointer-events: none; }
  .fl-start { position: absolute; transform: translate(-50%, -50%); min-width: 0; padding: 0.5cqw 3cqw 0; --c: var(--amber);
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
  .fl-keypad { display: grid; grid-template-columns: repeat(8, 6.6cqw); gap: 0.7cqw; }
  .fl-key { min-width: 0; min-height: 0; width: 6.6cqw; height: 6.6cqw; padding: 0.4cqw 0 0; font-size: 3.4cqw; }
  .fl-key.fl-wide { font-size: 2.2cqw; }
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
  .fl-selrow { display: flex; gap: 2.2cqw; align-items: stretch; }
  .fl-grid { display: grid; grid-template-columns: repeat(3, 13.2cqw); grid-auto-rows: 20.5cqh; gap: 0.9cqw; align-content: start; }
  .fl-card { min-width: 0; min-height: 0; width: 13.2cqw; height: 20.5cqh; padding: 0 0 0.6cqh; justify-content: flex-end; gap: 0; overflow: hidden; }
  /* index.html makes every canvas in #stage a full-stage layer; these are inline */
  #flow .fl-card canvas, #flow canvas.fl-big { position: static; inset: auto; }
  #flow .fl-card canvas { display: block; width: 100%; height: 78%; }
  #flow canvas.fl-big { display: block; width: 15.5cqw; height: 100%; flex: none; }
  .fl-card b { display: block; font: 600 2.2cqw/1 'Teko', sans-serif; letter-spacing: 0.08em; color: #fff; text-shadow: 0 0 0.6cqw var(--c); white-space: nowrap; }
  .fl-card.fl-focus { background: color-mix(in srgb, var(--c) 20%, rgba(14,4,30,0.72)); color: #fff; box-shadow: 0 0 1.4cqw var(--c), inset 0 0 1.2cqw color-mix(in srgb, var(--c) 40%, transparent); }
  .fl-card.fl-focus b { color: #fff; text-shadow: 0 0 0.6cqw var(--c), 0 0 1.4cqw var(--c); }
  .fl-card.fl-taken { opacity: 0.55; }
  .fl-detail { --c: var(--cyan); width: 47cqw; height: 63.5cqh; display: flex; gap: 1.2cqw; padding: 1.2cqw 1.4cqw; border: 2px solid var(--c); background: rgba(14,4,30,0.7);
    box-shadow: 0 0 1.4cqw color-mix(in srgb, var(--c) 45%, transparent), inset 0 0 2cqw color-mix(in srgb, var(--c) 18%, transparent); }
  .fl-big { display: block; width: 15.5cqw; height: 100%; flex: none; }
  .fl-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.9cqh; }
  .fl-cname { margin: 0; font: 400 3.5cqw/1 'Bungee', 'Arial Black', sans-serif; color: #fff; text-shadow: 0 0 0.5cqw var(--c), 0 0 1.5cqw var(--c); white-space: nowrap; }
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
  .fl-selfoot .fl-btn { min-width: 22cqw; }
  `;
  const s = document.createElement('style');
  s.id = 'flow-style';
  s.textContent = css;
  document.head.appendChild(s);
}
