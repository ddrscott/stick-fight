// The MOVE LIST: one character's full command list, like a fighting game's pause-menu move list. Opened from the
// pause menu (MOVE LIST, F1 or pad Y) and from the character select (the MOVE LIST button, F1 or Y on the
// highlighted fighter). It's an overlay over whatever screen opened it, so that screen keeps its state: the pause
// stays paused, the select keeps its cursor. Online there's no pause menu, so mid-match it isn't offered; the pick
// screens (the first pick and NEW CHARACTERS) have it, and there it's only on your own screen.
//
// Sections, all read from the game's data (src/combat/moveinfo.js): the character's unique moves (its moveList,
// then any own move the list leaves out), its strings (the shared ones it keeps and its own, with the payoff),
// the shared basic attacks, the system techniques, and the happy accidents this browser has found (the rest ???,
// src/flow/techniques.js). Highlighting a move plays it on the character's rig in the preview pane.
//
// Keys: up and down move the highlight and bring it into view, left and right jump a section, confirm replays the
// preview, back (Esc, Backspace, B, Select), Start, F1 or Y close it. Touch and mouse: tap a row, tap a section
// tab, the ‹ chip in the top-left corner (‹ PAUSE MENU, ‹ FIGHTERS) closes, and the list scrolls: a finger drag (natively, with momentum; the list and the tabs carry
// data-scroll, which is what exempts them from touch.js cancelling every touchmove on the page), the wheel or
// trackpad anywhere over the overlay, or the scrollbar. Scrolling never moves the highlight. Inputs show as the HUD writes them (→ toward, ← away, ↓), with the buttons as numbers on a
// keyboard and as the pad's own face buttons once a pad is in use (controls.js's glyphs).
//
// It sits on <body>, fixed over the whole viewport rather than inside the 16:9 stage, so a phone held upright
// gets the full screen to read it on.

import { moveListOf, animOf } from '../combat/moveinfo.js';
import { ACCIDENTS } from '../combat/botch.js';
import { canUse } from '../characters/index.js';
import { createFighter, MOVE_DATA } from '../fighter/index.js';
import { techniques } from './techniques.js';
import { faceGlyph, legend } from './controls.js';
import { PLAIN } from '../plaintext.js';   // readable text never glows: the shared dark outline

// a button's number to its face button (the FIGHT table: 1 X, 2 Y, 3 A, 4 B)
const PAD_FACE = { 1: 2, 2: 3, 3: 0, 4: 1 };
const STRING_RULE = 'STRINGS NEED EVERY HIT TO CONNECT (HIT OR BLOCKED). IF ONE WHIFFS, THE NEXT PRESS IS A MASH AND YOU BOTCH.';
// the stamina rule (README, Controls: Stamina and Faint), at the top of SYSTEM
const STAMINA_RULE = 'EVERY STRIKE COSTS STAMINA. A HIT GIVES HALF OF IT BACK, A BLOCKED HIT A QUARTER, A WHIFF NOTHING. EMPTY THE BAR WITH A STRIKE THAT HITS AND YOU STAY ON YOUR FEET, NEARLY EMPTY; WHIFF OR GET BLOCKED AND YOU FAINT. FAINTED, YOU CAN\'T MOVE: PRESS LEFT, RIGHT, LEFT ON A STEADY BEAT TO SHAKE IT OFF SOONER (HOLDING OR MASHING ONE WAY DOES NOTHING).';
const STRING_BEAT = 'PRESS ON A STEADY BEAT, ABOUT 0.1 TO 0.5 S APART: RHYTHM, NOT SPEED. MISS A HIT? STOP, RESET, START AGAIN.';

function el(tag, cls = '', text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** an input in glyphs: arrows and words as text, each button 1-4 as its number (keyboard) and face (pad) */
export function inputGlyphs(s) {
  const out = el('span', 'ml-in');
  let text = '';
  const flush = () => { if (text) { out.appendChild(document.createTextNode(text)); text = ''; } };
  for (const ch of String(s)) {
    if (PAD_FACE[ch] != null) {
      flush();
      const k = el('span', 'ml-k');
      k.append(el('span', 'ml-n', ch), faceGlyph(PAD_FACE[ch]));
      out.appendChild(k);
    } else text += ch;
  }
  flush();
  return out;
}

/**
 * @param {{ char: any, onClose: () => void, click?: (kind?: string) => void, backTo?: string }} o  backTo: where closing goes, by name
 */
export function openMoveList(o) {
  injectStyle();
  const c = o.char;
  const data = moveListOf(c);
  const tech = techniques().filter((x) => { const a = ACCIDENTS.find((y) => y.id === x.id); return a && canUse(c, a.move); });
  const sections = [
    { id: 'unique', tab: c.ownMoves.length ? 'UNIQUE' : 'SIGNATURE', title: c.ownMoves.length ? 'UNIQUE MOVES' : 'SIGNATURE MOVES',
      notes: c.ownMoves.length ? [] : [`${c.name} HAS NO MOVES OF ITS OWN. THESE ARE THE ONES TO LEARN FIRST.`], rows: data.unique },
    { id: 'strings', tab: 'STRINGS', title: 'STRINGS', notes: [STRING_RULE, STRING_BEAT], rule: true, rows: data.strings,
      after: data.dropped.length ? `${c.name} DOESN'T USE ${data.dropped.join(', ')}` : '' },
    { id: 'basics', tab: 'BASICS', title: 'BASIC ATTACKS', notes: [], rows: data.basics },
    { id: 'system', tab: 'SYSTEM', title: 'SYSTEM', notes: [STAMINA_RULE], rows: data.system },
    { id: 'accidents', tab: 'ACCIDENTS', title: 'HAPPY ACCIDENTS',
      notes: [`FOUND ${tech.filter((x) => x.found).length}/${tech.length}. A MISTIMED PRESS IN JUST THE RIGHT SPOT COMES OUT AS A HIDDEN TECHNIQUE. THE HINT SAYS WHERE, NEVER WHEN.`],
      rows: tech.map((x) => ({ name: x.found ? x.name : '???', input: x.found ? x.input : '? › ?', note: x.hint, tags: x.found ? ['found'] : [], hidden: !x.found,
        seq: x.found ? [animOf(ACCIDENTS.find((a) => a.id === x.id).move)].filter((n) => n && MOVE_DATA[n]) : [] })) },
  ];

  // ---- the DOM ----
  const root = el('div', 'ml-root');
  root.id = 'movelist';
  root.style.setProperty('--c', c.color);
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', `${c.name} move list`);
  const head = el('div', 'ml-head');
  const title = el('div', 'ml-title');
  title.append(el('span', 'ml-kicker', 'MOVE LIST'), el('h1', 'ml-name', c.name), el('span', 'ml-tag', c.tagline));
  // back is the corner's ‹ chip naming where closing goes (‹ PAUSE MENU, ‹ FIGHTERS), like every screen's and SETTINGS'
  const backTo = o.backTo || 'BACK';
  const close = el('button', 'ml-close'); close.type = 'button';
  close.innerHTML = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M11.5 2.5 L5 9 L11.5 15.5"/></svg>';
  close.appendChild(el('span', '', backTo));
  close.setAttribute('aria-label', `Close the move list, back to ${backTo.toLowerCase()}`);
  close.addEventListener('click', (e) => { e.preventDefault(); shut(); });
  const tabs = el('div', 'ml-tabs');
  tabs.dataset.scroll = 'x';   // touch.js leaves a drag here to the browser (upright, where the tabs overflow)
  head.append(close, title);
  const body = el('div', 'ml-body');
  const list = el('div', 'ml-list');
  list.dataset.scroll = 'y';   // and here: the list's own native scrolling
  // the wheel anywhere over the overlay (the preview, the header) scrolls the list; over the list it's the browser's
  // `free`: the list was last moved by hand (a finger, the wheel, the scrollbar) rather than by the highlight.
  // While it is, the lit tab follows what's on screen; the highlight stays where it was until a key or a tap.
  let free = false, lit = 0;
  root.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return;
    free = true;
    if (e.target instanceof Node && list.contains(e.target)) return;
    list.scrollTop += e.deltaY * (e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? list.clientHeight : 1);
  }, { passive: true });
  for (const t of ['touchmove', 'pointerdown']) list.addEventListener(t, () => { free = true; }, { passive: true });
  list.addEventListener('scroll', () => {
    if (!free) return;
    // the section under a line a third of the way down the list; at the very bottom, the last one
    const box = list.getBoundingClientRect(), y = box.top + box.height / 3;
    let s = list.scrollTop >= list.scrollHeight - list.clientHeight - 1 ? secEls.length - 1 : 0;
    if (!s) secEls.forEach((sec, i) => { if (sec.getBoundingClientRect().top <= y) s = i; });
    if (s !== lit) light(s);
  }, { passive: true });
  function light(s) {
    lit = s;
    tabEls.forEach((t, i) => t.classList.toggle('ml-on', i === s));
    // upright the tabs run off the side: keep the lit one on screen
    if (tabs.scrollWidth > tabs.clientWidth + 1) tabEls[s].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const pane = el('div', 'ml-pane');
  const cv = document.createElement('canvas'); cv.className = 'ml-cv';
  const cap = el('div', 'ml-cap');
  pane.append(cv, cap);
  body.append(list, pane);
  root.append(head, tabs, body);
  root.appendChild(legend([['move', 'MOVE'], ['confirm', 'REPLAY'], ['back', backTo]])).classList.add('ml-legend');

  const rows = [];   // { el, row, sec }
  const tabEls = [];
  const secEls = [];
  sections.forEach((s, si) => {
    const t = el('button', 'ml-tabbtn', s.tab); t.type = 'button';
    t.addEventListener('click', (e) => { e.preventDefault(); jump(si); });
    tabs.appendChild(t); tabEls.push(t);
    const sec = el('section', `ml-sec ml-${s.id}`);
    sec.appendChild(el('h2', 'ml-h', s.title));
    for (const n of s.notes) sec.appendChild(el('p', s.rule && n === STRING_RULE ? 'ml-rule' : 'ml-note', n));
    for (const r of s.rows) {
      const it = el('div', `ml-row${r.off ? ' ml-off' : ''}${r.hidden ? ' ml-hidden' : ''}`);
      const nm = el('div', 'ml-nm');
      nm.appendChild(el('b', '', r.name));
      for (const tg of r.tags || []) nm.appendChild(el('i', `ml-chip ml-c-${tg.replace(/\W+/g, '')}`, tg));
      it.append(nm, inputGlyphs(r.input));
      if (r.note) it.appendChild(el('small', '', r.note));
      const k = rows.length;
      it.addEventListener('click', () => { select(k, false); replay(); });
      sec.appendChild(it);
      rows.push({ el: it, row: r, sec: si });
    }
    if (s.after) sec.appendChild(el('p', 'ml-note', s.after));
    list.appendChild(sec); secEls.push(sec);
  });
  document.body.appendChild(root);
  document.documentElement.classList.add('ml-open');

  // ---- the preview ----
  const rig = createFighter({ color: c.color, x: 0, y: 0, facing: 1, body: c.body });
  rig.pants = c.pants || null;
  rig.setBody(c.body, { accent: c.accent });
  rig.speedLines = false;
  rig.charDef = c;
  const ctx = cv.getContext('2d');
  let seq = [], si = -1, wait = 0.3, cur = -1, raf = 0, last = 0, open = true;
  const safePlay = (name, opt) => { try { rig.play(name, opt); return true; } catch { return false; } };
  function replay() {
    const r = rows[cur] && rows[cur].row;
    seq = r && r.seq ? r.seq : [];
    if (!seq.length) { si = -1; safePlay('idle'); rig.x = 0; return; }
    rig.x = 0; si = 0; safePlay(seq[0]);
  }
  function select(k, scroll = true) {
    if (!rows.length) return;
    k = Math.max(0, Math.min(rows.length - 1, k));
    const same = k === cur;
    if (cur >= 0) rows[cur].el.classList.remove('ml-cur');
    cur = k;
    const { el: e, row, sec } = rows[k];
    e.classList.add('ml-cur');
    free = false;
    light(sec);
    if (scroll) {
      // a section's first row brings its header (and the strings' rule) into view with it
      const first = rows.findIndex((x) => x.sec === sec) === k;
      (first ? secEls[sec] : e).scrollIntoView({ block: first ? 'start' : 'nearest' });
    }
    // the same row again (its section's tab, or up at the top row): the list may have been scrolled away from
    // it by a finger or the wheel, so it's brought back above, and that's all
    if (same) return;
    cap.textContent = '';
    cap.append(el('b', '', row.name), inputGlyphs(row.input));
    if (!row.seq || !row.seq.length) cap.appendChild(el('small', '', row.hidden ? 'NOT FOUND YET' : row.off ? 'NOT FOR THIS FIGHTER' : 'NO PREVIEW'));
    wait = 0.15; si = -1; seq = row.seq || []; safePlay('idle'); rig.x = 0;
    if (o.click) o.click();
  }
  function jump(s) {
    const k = rows.findIndex((x) => x.sec === s);
    if (k >= 0) select(k);
  }
  function tick(now) {
    if (!open) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
    if (si < 0 && seq.length) { if ((wait -= dt) <= 0) { rig.x = 0; si = 0; safePlay(seq[0]); } }
    else if (si >= 0) {
      // a string's next press goes in at the recover key, like the game's cancel window
      for (const ev of rig.events) if (ev.type === 'recover' && si < seq.length - 1) { si++; safePlay(seq[si], { chain: true }); break; }
    }
    rig.events.length = 0;
    rig.update(dt);
    if (si >= 0 && rig.current.done && si >= seq.length - 1) { si = -1; wait = 0.9; safePlay('idle'); }
    if (si < 0 && Math.abs(rig.x) > 0.5) rig.x *= Math.max(0, 1 - dt * 6);
    // draw at the canvas's CSS size times the device pixel ratio (capped)
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const zoom = Math.min(h / 230, w / 200), x = w * 0.34, y = h * 0.9;
    const g = ctx.createRadialGradient(x + 30 * zoom, y, 2, x + 30 * zoom, y, w * 0.5);
    g.addColorStop(0, c.color + '55'); g.addColorStop(1, 'transparent');
    ctx.fillStyle = g; ctx.fillRect(0, y - h * 0.08, w, h * 0.16);
    ctx.translate(x, y); ctx.scale(zoom, zoom);
    ctx.shadowColor = c.color; ctx.shadowBlur = 9 * dpr;
    rig.draw(ctx);
  }
  raf = requestAnimationFrame(tick);
  select(0, false);
  list.scrollTop = 0;

  function shut(notify = true) {
    if (!open) return;
    open = false;
    cancelAnimationFrame(raf);
    root.remove();
    document.documentElement.classList.remove('ml-open');
    if (o.click) o.click('off');
    if (notify) o.onClose();
  }
  return {
    /** a menu key (menuInput's names); the overlay owns every key while it's up */
    key(k) {
      if (k === 'up') select(cur - 1);
      else if (k === 'down') select(cur + 1);
      // from the lit tab: the highlight's section, or the one scrolled to by hand
      else if (k === 'left' || k === 'prevtab') jump(Math.max(0, lit - 1));   // Q E, LB RB: the tabs, like SETTINGS'
      else if (k === 'right' || k === 'nexttab') jump(Math.min(sections.length - 1, lit + 1));
      else if (k === 'confirm') replay();
      else if (k === 'back' || k === 'escape' || k === 'select' || k === 'start' || k === 'moves' || k === 'pause') shut();
    },
    /** close without telling the opener (it's already moving on) */
    close() { shut(false); },
    get char() { return c; },
  };
}

function injectStyle() {
  if (document.getElementById('movelist-style')) return;
  const css = `
  .ml-root { --c: #2ef2ff; --pink: #ff2bd6; --cyan: #2ef2ff; --amber: #ffb02e; --violet: #a66bff; --lime: #c8ff3a; --ink: #fff4fd; --deep: #0a0414;
    position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column; gap: clamp(6px, 1.4vh, 14px);
    padding: max(10px, env(safe-area-inset-top)) max(14px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-left));
    box-sizing: border-box; background: radial-gradient(ellipse at 50% 40%, rgba(18,5,38,0.985), rgba(5,1,12,0.995));
    font-family: 'Teko', 'Arial Narrow', system-ui, sans-serif; color: var(--ink); -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent;
    --fs: clamp(15px, min(2.2vw, 3.2vh), 26px); font-size: var(--fs);
    /* all of this is read, so none of it glows (README, "The look"): a solid color in a tight dark outline */
    --plain: ${PLAIN}; text-shadow: var(--plain); }
  .ml-root * { box-sizing: border-box; }
  .ml-head { flex: none; display: flex; align-items: center; gap: 1.2em; flex-wrap: wrap; }
  .ml-title { display: flex; align-items: baseline; gap: 0.7em; min-width: 0; flex: 1 1 0; flex-wrap: wrap; }
  .ml-kicker { font: 400 max(12px, 0.8em)/1 'Bungee', 'Arial Black', sans-serif; color: var(--amber); letter-spacing: 0.06em; }
  .ml-name { margin: 0; font: 400 1.9em/1 'Bungee', 'Arial Black', sans-serif; color: color-mix(in srgb, var(--c) 45%, #fff); white-space: nowrap; }
  .ml-tag { font-size: max(12px, 0.9em); letter-spacing: 0.12em; color: rgba(230,214,255,0.75); }
  .ml-tabs { flex: none; display: flex; gap: 0.4em; flex-wrap: wrap; touch-action: pan-x; overscroll-behavior: contain; }
  .ml-tabbtn, .ml-close { appearance: none; margin: 0; cursor: pointer; border-radius: 0; background: rgba(14,4,30,0.62); font: 600 1em/1 'Teko', sans-serif; letter-spacing: 0.1em;
    padding: 0.35em 0.7em 0.15em; min-height: 40px; }
  .ml-tabbtn { border: 2px solid rgba(166,107,255,0.55); color: rgba(230,214,255,0.8); }
  .ml-tabbtn.ml-on { border-color: var(--c); color: var(--deep); text-shadow: none; background: var(--c); box-shadow: 0 0 0.6em var(--c); }
  /* the ‹ chip, top-left: the same as every screen's back (src/flow/ui.js .fl-backchip) and SETTINGS' */
  .ml-close { flex: none; align-self: flex-start; display: flex; align-items: center; gap: 0.45em; padding: 0 0.9em 0 0.55em; height: clamp(40px, 6.4vmin, 50px);
    border: 2px solid var(--violet); background: rgba(10,4,20,0.82); color: color-mix(in srgb, var(--violet) 45%, #fff); font-size: clamp(16px, calc(1.2vmin + 9px), 22px); }
  .ml-close span { padding-top: 0.14em; white-space: nowrap; }
  .ml-close svg { width: 0.85em; height: 0.85em; flex: none; fill: none; stroke: currentColor; stroke-width: 3.2; stroke-linecap: square; }
  .ml-close:hover, .ml-close:active { background: var(--violet); color: var(--deep); text-shadow: none; }
  .ml-close:focus, .ml-tabbtn:focus { outline: none; }
  .ml-body { flex: 1 1 auto; min-height: 0; display: flex; gap: 1em; }
  .ml-list { flex: 1 1 auto; min-width: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding: 0 0.5em 3em 0;
    scrollbar-width: thin; scrollbar-color: var(--violet) transparent; touch-action: pan-y; }
  .ml-pane { flex: 0 0 30%; max-width: 360px; display: flex; flex-direction: column; border: 2px solid var(--c); background: rgba(14,4,30,0.7);
    box-shadow: 0 0 0.8em color-mix(in srgb, var(--c) 40%, transparent), inset 0 0 1.2em color-mix(in srgb, var(--c) 15%, transparent); }
  .ml-cv { display: block; width: 100%; flex: 1 1 auto; min-height: 0; }
  .ml-cap { padding: 0.5em 0.8em 0.6em; border-top: 2px solid color-mix(in srgb, var(--c) 50%, transparent); display: flex; flex-direction: column; gap: 0.25em; min-height: 4.2em; }
  .ml-cap b { font: 400 1em/1.05 'Bungee', 'Arial Black', sans-serif; color: #fff; }
  .ml-cap small { font-size: max(12px, 0.75em); letter-spacing: 0.1em; color: rgba(214,190,255,0.7); }
  .ml-sec { margin-bottom: 1.2em; scroll-margin-top: 0.2em; }
  .ml-h { margin: 0 0 0.35em; font: 400 1.1em/1 'Bungee', 'Arial Black', sans-serif; color: var(--amber); letter-spacing: 0.04em; }
  .ml-note { margin: 0 0 0.45em; font-size: max(12px, 0.85em); letter-spacing: 0.08em; line-height: 1.1; color: rgba(214,190,255,0.8); }
  .ml-rule { margin: 0 0 0.45em; padding: 0.45em 0.7em 0.3em; border: 2px solid var(--pink); background: rgba(255,43,214,0.12); box-shadow: 0 0 0.6em rgba(255,43,214,0.35);
    font-size: 1em; letter-spacing: 0.08em; line-height: 1.1; color: #fff; }
  .ml-row { display: grid; grid-template-columns: 1fr auto; column-gap: 1em; row-gap: 0.1em; align-items: baseline; padding: 0.35em 0.6em 0.25em;
    border: 2px solid transparent; border-bottom-color: rgba(166,107,255,0.18); cursor: pointer; }
  .ml-row.ml-cur { border-color: var(--c); background: color-mix(in srgb, var(--c) 14%, rgba(14,4,30,0.7)); box-shadow: 0 0 0.6em color-mix(in srgb, var(--c) 40%, transparent); }
  .ml-nm { display: flex; align-items: baseline; gap: 0.5em; flex-wrap: wrap; min-width: 0; }
  .ml-nm b { font-weight: 600; font-size: 1.1em; letter-spacing: 0.08em; color: #fff; }
  .ml-row.ml-cur .ml-nm b { color: color-mix(in srgb, var(--c) 35%, #fff); }
  .ml-row small { grid-column: 1 / -1; font-size: max(12px, 0.8em); letter-spacing: 0.07em; line-height: 1.1; color: rgba(214,190,255,0.72); text-transform: uppercase; }
  .ml-row.ml-off .ml-nm b, .ml-row.ml-off .ml-in { text-decoration: line-through; opacity: 0.5; }
  .ml-row.ml-hidden .ml-nm b { color: rgba(230,214,255,0.5); }
  .ml-chip { font: normal 400 max(12px, 0.55em)/1 'Bungee', sans-serif; padding: 0.35em 0.45em 0.2em; letter-spacing: 0.04em; text-transform: uppercase; color: rgba(230,214,255,0.85); border: 1px solid rgba(166,107,255,0.6); }
  .ml-c-unique { color: var(--deep); text-shadow: none; background: var(--c); border-color: var(--c); }
  .ml-c-found { color: var(--deep); text-shadow: none; background: var(--lime); border-color: var(--lime); }
  .ml-c-launch, .ml-c-wallsplat, .ml-c-wallbounce, .ml-c-groundbounce { color: var(--pink); border-color: var(--pink); }
  .ml-c-knockdown { color: var(--amber); border-color: var(--amber); }
  .ml-c-low { color: var(--cyan); border-color: var(--cyan); }
  .ml-c-overhead { color: var(--lime); border-color: var(--lime); }
  .ml-in { font-weight: 600; font-size: 1.1em; letter-spacing: 0.06em; color: var(--amber); text-align: right; white-space: pre; display: inline-flex; align-items: center; gap: 0.08em; justify-content: flex-end; }
  .ml-cap .ml-in { justify-content: flex-start; }
  .ml-k { display: inline-flex; align-items: center; }
  .ml-k .lg-b { display: none; font-size: 0.8em; margin: 0 0.08em; }
  html.dev-pad .ml-k .lg-b { display: inline-flex; } html.dev-pad .ml-k .ml-n { display: none; }
  .ml-legend { position: static; transform: none; align-self: center; --lg: calc(var(--fs) * 0.8); }
  /* phones held upright: the preview on top, the list under it, full width */
  @media (orientation: portrait) {
    .ml-root { --fs: clamp(15px, 4.2vw, 22px); }
    .ml-body { flex-direction: column-reverse; }
    .ml-pane { flex: 0 0 auto; height: 24vh; max-width: none; flex-direction: row; }
    .ml-cv { width: 46%; height: 100%; flex: 0 0 46%; }
    .ml-cap { border-top: 0; border-left: 2px solid color-mix(in srgb, var(--c) 50%, transparent); justify-content: center; flex: 1; min-width: 0; }
    .ml-head { gap: 0.5em; flex-wrap: nowrap; align-items: flex-start; }
    .ml-name { font-size: 1.5em; }
    .ml-tag { font-size: 0.8em; }
    .ml-chip { font-size: max(12px, 0.55em); }   /* a phone's 0.55em is about 9 px: the 12 px floor (Menus, held upright) */
    .ml-tabs { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
    .ml-tabbtn { flex: 1 0 auto; padding: 0.35em 0.5em 0.15em; }
    .ml-close { min-width: 0; }
    .ml-legend { display: none; }
  }
  /* short landscape phones: tighter header */
  @media (orientation: landscape) and (max-height: 500px) {
    .ml-root { --fs: clamp(13px, 3.6vh, 18px); }
    .ml-tag { display: none; }
    .ml-tabbtn, .ml-close { min-height: 36px; }
  }
  `;
  const s = document.createElement('style');
  s.id = 'movelist-style';
  s.textContent = css;
  document.head.appendChild(s);
}
