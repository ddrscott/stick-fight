// The character select screen (the flow's charSelect state): a grid of the registered roster, each
// card a live idle rig in the character's neon, and a sheet for the focused one: a bigger rig that
// shows off a unique move now and then, the name and tagline, stat bars and the unique move list.
// Keys and the pad move the cursor by geometry (ui.js); Enter, Space or A on a card picks it, and so
// does the PICK button. A tap focuses a card and a second tap picks it, so a stray touch never starts
// a fight. B, Esc, Backspace, Select or the BACK button go back. MOVE LIST (the button, F1 or pad Y; the flow
// reads the key) opens the highlighted fighter's full move list (src/flow/movelist.js) over the screen.

import { el, button } from './ui.js';
import { techniqueCount } from './techniques.js';
import { createFighter, MOVES } from '../fighter/index.js';

// bars out of 1, from the character's stats (TEMP, all 1s, sits about halfway on each)
const STATS = [
  ['POWER', (c) => (c.stats.damage - 0.7) / 0.6],
  ['SPEED', (c) => ((c.stats.walk + c.stats.run + c.stats.dash) / 3 - 0.6) / 0.8],
  ['HEALTH', (c) => (c.stats.health - 60) / 80],
  ['STAMINA', (c) => (c.stats.stamina * c.stats.regen - 0.6) / 0.8],
  ['WEIGHT', (c) => (c.stats.weight - 0.6) / 0.9],
];
const clamp01 = (v) => Math.max(0.06, Math.min(1, v));

// The glow. A live shadowBlur on the rig's own strokes blurs every limb, joint and prop separately (about
// thirty blurs a rig, nineteen rigs a frame), and Chrome's canvas flush for that held the whole screen to
// 20 fps on a desktop: every press waited for a 50 ms frame. So the glow is its own layer: the rig drawn
// plain into a scratch canvas, and that canvas's shadow alone (the same 9 px blur in the fighter's color,
// one blur for the whole figure) stamped into a glow canvas. A frame is then the floor, the glow layer and
// the rig on top. The sheet's rig and the card under the cursor remake their glow every frame; the other
// cards only breathe, so theirs is remade every GLOW_EVERY seconds, a few cards a frame.
// The cards the cursor isn't on (dimmed, breathing) are also redrawn 30 times a second, not every frame, in four
// groups that take turns, so a frame draws a handful of rigs, not nineteen.
const GLOW = 9, GLOW_EVERY = 0.1, CARD_STEP = 1 / 30;

// a rig drawn into its own canvas, glowing in the character's color
function rigView(canvas, c, zoom) {
  const rig = createFighter({ color: c.color, x: 0, y: 0, facing: 1, body: c.body });
  rig.pants = c.pants || null;
  rig.setBody(c.body, { accent: c.accent });
  rig.speedLines = false;
  rig.charDef = c;   // its cloth (a tie, a lanyard, an apron's hem) hangs at rest
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const layer = () => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; };
  const plain = layer(), pctx = plain.getContext('2d');
  const glow = layer(), gctx = glow.getContext('2d');
  // the shadow without the thing casting it: the figure is stamped a canvas-width off to the left and its shadow offset back
  gctx.shadowColor = c.color; gctx.shadowBlur = GLOW; gctx.shadowOffsetX = w;
  // a floor glow under the feet
  const floor = ctx.createRadialGradient(w / 2, h * 0.93, 2, w / 2, h * 0.93, w * 0.42);
  floor.addColorStop(0, c.color + '55'); floor.addColorStop(1, 'transparent');
  const pose = (x) => { x.setTransform(zoom, 0, 0, zoom, w / 2, h * 0.93); rig.draw(x); x.setTransform(1, 0, 0, 1, 0, 0); };
  return {
    rig,
    age: Infinity,   // seconds since the glow was remade
    wait: 0,         // seconds since it was drawn (the select's tick keeps it)
    /** the first glow counts as this much newer than it is, so cards given different leads take turns from then on */
    lead: 0,
    /** @param {number} dt @param {boolean} [fresh] remake the glow this frame (false: only once it's GLOW_EVERY old) */
    draw(dt, fresh = true) {
      rig.update(dt);
      this.age += dt;
      const remake = fresh || this.age >= GLOW_EVERY;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = floor; ctx.fillRect(0, h * 0.8, w, h * 0.2);
      if (remake) {
        this.age = -this.lead; this.lead = 0;
        pctx.clearRect(0, 0, w, h); pose(pctx);
        gctx.clearRect(0, 0, w, h); gctx.drawImage(plain, -w, 0);
        ctx.drawImage(glow, 0, 0); ctx.drawImage(plain, 0, 0);
      } else { ctx.drawImage(glow, 0, 0); pose(ctx); }
    },
  };
}

/**
 * @param {any} ui            createUI's object
 * @param {{ title: string, sub: string, roster: any[], initial?: string, touch: boolean, pad: boolean,
 *           onPick: (id: string) => void, onBack: () => void, cls?: string,
 *           backLabel?: string, pickLabel?: string, status?: HTMLElement, extra?: any[],
 *           onHover?: (id: string) => void, onBackKey?: () => void, legend?: any[], onMoves?: (c: any) => void }} o
 *   the online pick screen's extras: BACK's label (LEAVE ROOM), a status line under the subtitle,
 *   more footer buttons (the host's START), the card under the cursor as it moves (onHover), and a
 *   back key that does something other than the BACK button (un-ready, not leave). onMoves adds the MOVE LIST
 *   button, for the fighter under the cursor
 */
export function openSelect(ui, o) {
  const views = [];
  let big = null, bigT = 0, bigChar = null, showing = false, showN = 0;
  let detail, nameEl, tagEl, statsEl, movesEl, bigCanvas;
  const roster = o.roster;
  const start = Math.max(0, roster.findIndex((c) => c.id === o.initial));
  const cards = new Map();   // id -> the card's element (mark() tags the rival's)

  // The sheet follows the cursor, so it's built to be cheap to change: the stat rows and move rows are made
  // once and rewritten in place, each fighter's big rig is built the first time the cursor lands on them and
  // kept, and the sheet's canvas is redrawn right here, in the same frame as the card's highlight, not a
  // frame later on the next tick.
  const bigs = new Map();   // id -> its big rigView
  const statBars = [], moveRows = [];
  function paint(c) {
    if (!c || !detail || c === bigChar) return;
    detail.style.setProperty('--c', c.color);
    nameEl.textContent = c.name; nameEl.classList.toggle('fl-long', c.name.length > 11);
    tagEl.textContent = c.tagline;
    STATS.forEach(([, f], i) => statBars[i].style.setProperty('--v', String(clamp01(f(c)))));
    const list = (c.moveList || []).slice(0, moveRows.length);
    moveRows.forEach((r, i) => {
      const m = list[i];
      r.p.style.display = m ? '' : 'none';
      if (m) { r.name.textContent = m.name; r.input.textContent = m.input; r.note.textContent = m.note || ''; }
    });
    big = bigs.get(c.id);
    if (!big) bigs.set(c.id, big = rigView(bigCanvas, c, 1.9));
    else { big.rig.x = 0; big.rig.play('idle'); }   // back from another card: standing, not mid-move
    bigChar = c; bigT = 0; showing = false;
    big.draw(0);
  }

  ui.show(`fl-select ${o.cls || ''}`, (root) => {
    root.append(el('h1', 'fl-h2', o.title), el('div', 'fl-label', o.sub));
    if (o.status) root.appendChild(o.status);
    const row = el('div', 'fl-selrow');
    const grid = el('div', 'fl-grid');
    const items = [];
    roster.forEach((c) => {
      const b = button('', () => o.onPick(c.id), 'fl-card');
      b.el.style.setProperty('--c', c.color);
      const cv = document.createElement('canvas'); cv.width = 160; cv.height = 200;   // the card's shape (6 columns of tall cards, 18 fit), so the rig isn't stretched
      b.el.append(cv, el('b', c.name.length > 9 ? 'fl-long' : '', c.name));   // a long name (WINDOW WASHER) goes smaller and may take two lines
      grid.appendChild(b.el);
      cards.set(c.id, b.el);
      const v = rigView(cv, c, 1.08); v.lead = GLOW_EVERY * views.length / roster.length;
      views.push(v);
      items.push({ ...b, focusFirst: true, char: c });
    });
    detail = el('div', 'fl-detail');
    bigCanvas = document.createElement('canvas'); bigCanvas.width = 210; bigCanvas.height = 540; bigCanvas.className = 'fl-big';
    const info = el('div', 'fl-info');
    nameEl = el('h1', 'fl-cname'); tagEl = el('div', 'fl-tagline'); statsEl = el('div', 'fl-stats'); movesEl = el('div', 'fl-moves');
    for (const [label] of STATS) { const i = el('i'); statBars.push(i); statsEl.append(el('span', '', label), i); }
    for (let k = 0; k < 4; k++) {
      const r = { p: el('p'), name: el('b'), input: el('em'), note: el('small') };
      r.p.append(r.name, r.input, r.note); r.p.style.display = 'none';
      moveRows.push(r); movesEl.appendChild(r.p);
    }
    info.append(nameEl, tagEl, statsEl, movesEl);
    detail.append(bigCanvas, info);
    row.append(grid, detail);
    root.appendChild(row);
    const foot = el('div', 'fl-selfoot');
    const pick = button(o.pickLabel || 'PICK', () => { const it = ui.items[ui.focus]; const c = it && it.char ? it.char : bigChar; if (c) o.onPick(c.id); }, 'fl-pink');
    const back = button(o.backLabel || 'BACK', o.onBack, 'fl-violet');
    const tc = techniqueCount();   // the happy accidents found on this browser (src/flow/techniques.js)
    // the keys and buttons are in the footer legend (ui.js); touch gets the one thing it can't guess
    const extra = [...(o.extra || [])];
    const moves = o.onMoves ? button('MOVE LIST', () => { if (bigChar) o.onMoves(bigChar); }, 'fl-amber') : null;
    if (moves) extra.unshift(moves);
    foot.append(back.el, pick.el, ...extra.map((x) => x.el), el('div', 'fl-small fl-touchonly', 'TAP A FIGHTER, TAP AGAIN TO PICK'),
      el('div', 'fl-small fl-found', `TECHNIQUES FOUND ${tc.found}/${tc.total}`));
    root.appendChild(foot);
    items.push(back, pick, ...extra);
    return { items, focus: start, back: o.onBackKey || o.onBack, onFocus: (k, it) => { if (it && it.char) { paint(it.char); if (o.onHover) o.onHover(it.char.id); } }, legend: o.legend || [['move'], ['confirm', 'PICK'], ...(o.onMoves ? [['moves', 'MOVE LIST']] : []), ['back', 'BACK']] };
  });
  paint(roster[start]);

  let marked = '';
  return {
    /** the fighter under the cursor (the sheet's) */
    get current() { return bigChar; },
    /** tag a card (the rival's, online): label '' clears it */
    mark(id, label, cls = '') {
      const key = `${id}|${label}|${cls}`;
      if (key === marked) return;
      marked = key;
      for (const c of cards.values()) { c.classList.remove('fl-rival', 'fl-rivalready'); const t = c.querySelector('.fl-tag'); if (t) t.remove(); }
      const c = id && label ? cards.get(id) : null;
      if (c) { c.classList.add('fl-rival'); if (cls) c.classList.add(cls); c.appendChild(el('i', 'fl-tag', label)); }
    },
    /** per frame: the cards breathe, the big rig throws one of its unique moves every few seconds */
    tick(dt) {
      for (let i = 0; i < views.length; i++) {
        const v = views[i];
        if (roster[i] === bigChar) { v.draw(v.wait + dt, true); v.wait = 0; continue; }
        v.wait += dt;
        if (v.age === Infinity) { v.draw(dt, true); v.wait = (i % 4) * CARD_STEP / 4; }   // the first frame draws them all
        else if (v.wait >= CARD_STEP - 0.002) { v.draw(v.wait, false); v.wait = 0; }
      }
      if (!big) return;
      bigT += dt;
      // its own clips (a frame-only move like SAME DAY plays another move's clip, so it's skipped)
      const own = bigChar && bigChar.ownMoves ? bigChar.ownMoves.filter((m) => MOVES.includes(m)) : [];
      if (!showing && bigT > 2.2 && own.length) {
        try { big.rig.play(own[showN++ % own.length]); showing = true; } catch { showing = false; bigT = 0; }
      } else if (showing && big.rig.current.done) { big.rig.x = 0; big.rig.play('idle'); showing = false; bigT = 0; }
      big.draw(dt);
    },
  };
}
