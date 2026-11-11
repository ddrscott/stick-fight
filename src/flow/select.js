// The character select screen (the flow's charSelect state): a grid of the registered roster, each
// card a live idle rig in the character's neon, and a sheet for the focused one: a bigger rig that
// shows off a unique move now and then, the name and tagline, stat bars and the unique move list.
// Keys and the pad move the cursor by geometry (ui.js); Enter, Space or A on a card picks it, and so
// does the PICK button. A tap focuses a card and a second tap picks it, so a stray touch never starts
// a fight. B, Esc, Backspace, Select or the BACK button go back. MOVE LIST (the button, F1 or pad Y; the flow
// reads the key) opens the highlighted fighter's full move list (src/flow/movelist.js) over the screen.
//
// The roster is a ring: left and right wrap from the last fighter to the first and back, in both layouts.
// Sideways and on a desktop it's the grid (it scrolls once the roster outgrows three rows). Held upright
// (src/square.js) the screen leaves the 16:9 box and takes the whole phone: a carousel of the cards, the
// focused one big in the middle with its neighbours shrinking off both edges, the sheet under it. A swipe
// spins it (a flick carries on), ‹ and › step it, a tap on a side card brings it to the middle and a tap on
// the middle one picks. Turn the phone with the screen up and it's rebuilt in the other layout, same cursor.

import { el, button } from './ui.js';
import { techniqueCount } from './techniques.js';
import { createFighter, MOVES } from '../fighter/index.js';
import { square, onSquare } from '../square.js';   // held upright: the carousel layout

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
// plain into a scratch canvas, and that canvas stamped with its shadow (the same 9 px blur in the fighter's
// color, one blur for the whole figure) into a glow canvas. A frame is then the floor, the glow layer and
// the rig on top. The sheet's rig and the card under the cursor remake their glow every frame; the other
// cards only breathe, so theirs is remade every GLOW_EVERY seconds, a few cards a frame.
// The cards the cursor isn't on (dimmed, breathing) are also redrawn 30 times a second, not every frame, in four
// groups that take turns, so a frame draws a handful of rigs, not nineteen.
// One shadow of the whole figure is thinner than thirty overlapping ones were, so the glow layer goes down
// GLOW_COATS times (plain blits, no more blurring) to bring the halo back to the weight it had.
const GLOW = 9, GLOW_COATS = 2, GLOW_EVERY = 0.1, CARD_STEP = 1 / 30;

// a rig drawn into its own canvas, glowing in the character's color (glow: the blur, bigger on a bigger canvas)
function rigView(canvas, c, zoom, glowPx = GLOW) {
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
  gctx.shadowColor = c.color; gctx.shadowBlur = glowPx;
  // a floor glow under the feet
  const floor = ctx.createRadialGradient(w / 2, h * 0.93, 2, w / 2, h * 0.93, w * 0.42);
  floor.addColorStop(0, c.color + '55'); floor.addColorStop(1, 'transparent');
  const pose = (x) => { x.setTransform(zoom, 0, 0, zoom, w / 2, h * 0.93); rig.draw(x); x.setTransform(1, 0, 0, 1, 0, 0); };
  const halo = () => { for (let k = 0; k < GLOW_COATS; k++) ctx.drawImage(glow, 0, 0); };
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
        gctx.clearRect(0, 0, w, h); gctx.drawImage(plain, 0, 0);
        halo(); ctx.drawImage(plain, 0, 0);
      } else { halo(); pose(ctx); }
    },
  };
}

// The carousel's shape, in card widths from the middle: where a card at offset o (fractional while it
// slides) sits, how big it is and how much it shows. ±1 sit just inside the screen, ±2 hang off its edges.
const RING = { step: 0.84, far: 0.56, show: 2.6 };
function ringPlace(o) {
  const a = Math.abs(o), sg = Math.sign(o);
  const x = sg * (a <= 1 ? a * RING.step : RING.step + (a - 1) * RING.far);
  const k = 1 - 0.3 * Math.min(a, 1) - 0.18 * Math.max(0, Math.min(a - 1, 1));
  const op = a <= 2 ? 1 - 0.22 * a : Math.max(0, (RING.show - a) / (RING.show - 2)) * 0.56;
  return { x, k, op };
}
/** o folded into [-n/2, n/2): the short way round the ring */
const wrapOff = (o, n) => { o = ((o % n) + n) % n; return o >= n / 2 ? o - n : o; };

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
  const roster = o.roster, n = roster.length;
  let cur = Math.max(0, roster.findIndex((c) => c.id === o.initial));   // the roster index under the cursor
  let views = [], big = null, bigT = 0, bigChar = null, showing = false, showN = 0;
  let detail, nameEl, tagEl, statsEl, movesEl, bigCanvas, countEl, ring, grid, screenEl;
  let cards = new Map();   // id -> the card's element (mark() tags the rival's)
  let bigs = new Map();    // id -> its big rigView (the sheet's rig, sideways)
  let statBars = [], moveRows = [];
  let tall = false;
  // the carousel: pos is the ring's position in cards (fractional while it slides; not wrapped), target where it's going
  let pos = cur, target = cur, drag = null;

  // The sheet follows the cursor, so it's built to be cheap to change: the stat rows and move rows are made
  // once and rewritten in place, each fighter's big rig is built the first time the cursor lands on them and
  // kept, and the sheet's canvas is redrawn right here, in the same frame as the card's highlight, not a
  // frame later on the next tick. Upright there's no separate big rig: the card in the middle is the big one,
  // and it throws the unique moves.
  function paint(c) {
    if (!c || !detail || c === bigChar) return;
    detail.style.setProperty('--c', c.color);
    nameEl.textContent = c.name; nameEl.classList.toggle('fl-long', c.name.length > 11);
    tagEl.textContent = c.tagline;
    STATS.forEach(([, f], i) => statBars[i].style.setProperty('--v', String(clamp01(f(c)))));
    const list = (c.moveList || []).slice(0, moveRows.length);
    moveRows.forEach((r, i) => {
      const m = list[i];
      if (tall) r.p.style.visibility = m ? '' : 'hidden';   // upright an empty row keeps its room, so the carousel above never changes size
      r.p.style.display = m || tall ? '' : 'none';
      if (m) { r.name.textContent = m.name; r.input.textContent = m.input; r.note.textContent = m.note || ''; }
    });
    if (countEl) countEl.textContent = `${roster.indexOf(c) + 1} / ${n}`;
    if (big && showing) { big.rig.x = 0; big.rig.play('idle'); }   // the one it left stops mid-move
    if (tall) {
      big = views[roster.indexOf(c)];
      big.rig.x = 0; big.rig.play('idle');
    } else {
      big = bigs.get(c.id);
      if (!big) bigs.set(c.id, big = rigView(bigCanvas, c, 1.9));
      else { big.rig.x = 0; big.rig.play('idle'); }   // back from another card: standing, not mid-move
    }
    bigChar = c; bigT = 0; showing = false;
    if (!tall) big.draw(0);
  }

  // the carousel's cards where pos puts them (every frame it moves; nothing while it sits still)
  let placedAt = NaN;
  function place(force = false) {
    if (!tall || !ring || (!force && pos === placedAt)) return;
    placedAt = pos;
    const w = ring.clientHeight * 0.7;   // a card's width: CSS makes it 0.7 of the ring's height
    views.forEach((v, i) => {
      const off = wrapOff(i - pos, n), p = ringPlace(off), cardEl = v.card;
      const hidden = Math.abs(off) >= RING.show;
      v.hidden = hidden;
      cardEl.style.visibility = hidden ? 'hidden' : '';
      if (hidden) return;
      cardEl.style.transform = `translateX(${(p.x * w).toFixed(1)}px) scale(${p.k.toFixed(3)})`;
      cardEl.style.opacity = p.op.toFixed(3);
      cardEl.style.zIndex = String(100 - Math.round(Math.abs(off) * 10));
    });
  }
  // the cursor moved (a key, a tap, the swipe crossing a card): the ring goes there the short way round
  function aimAt(i) { if (!drag) target = pos + wrapOff(i - pos, n); }
  function focusIdx(i, sound = true) {
    i = ((i % n) + n) % n;
    const k = ui.items.findIndex((it) => it.char === roster[i]);
    if (k >= 0) ui.setFocus(k, sound);
  }

  function build() {
    tall = !!square.on;
    views = []; cards = new Map(); statBars = []; moveRows = []; bigChar = null; big = null; showing = false;
    ring = null; grid = null; countEl = null; drag = null; placedAt = NaN;
    pos = target = cur;
    screenEl = ui.show(`fl-select ${tall ? 'fl-tall fl-nofit' : ''} ${o.cls || ''}`, (root) => {
      root.append(el('h1', 'fl-h2', o.title), el('div', 'fl-label', o.sub));
      if (o.status) root.appendChild(o.status);
      const row = el('div', 'fl-selrow');
      const items = [];
      // tall cards (a bigger canvas: the middle one is most of the screen's width) or the grid's
      const cw = tall ? 220 : 160, chh = tall ? 290 : 200, cz = tall ? 1.5 : 1.08;
      const deck = el('div', tall ? 'fl-ring' : 'fl-grid');
      if (tall) ring = deck; else grid = deck;
      // past 18 fighters the grid holds three rows and scrolls under a finger, the wheel and the cursor (data-scroll: src/touch.js lets it)
      if (!tall && n > 18) { deck.classList.add('fl-gridscroll'); deck.dataset.scroll = 'y'; }
      roster.forEach((c) => {
        const b = button('', () => o.onPick(c.id), 'fl-card');
        b.el.style.setProperty('--c', c.color);
        const cv = document.createElement('canvas'); cv.width = cw; cv.height = chh;   // the card's shape, so the rig isn't stretched
        b.el.append(cv, el('b', c.name.length > 9 ? 'fl-long' : '', c.name));   // a long name (WINDOW WASHER) goes smaller and may take two lines
        deck.appendChild(b.el);
        cards.set(c.id, b.el);
        const v = rigView(cv, c, cz, tall ? 12 : GLOW); v.lead = GLOW_EVERY * views.length / n;
        v.card = b.el; v.hidden = false;
        views.push(v);
        items.push({ ...b, focusFirst: true, manual: tall, char: c });
      });
      detail = el('div', 'fl-detail');
      const info = el('div', 'fl-info');
      nameEl = el('h1', 'fl-cname'); tagEl = el('div', 'fl-tagline'); statsEl = el('div', 'fl-stats'); movesEl = el('div', 'fl-moves');
      for (const [label] of STATS) { const i = el('i'); statBars.push(i); statsEl.append(el('span', '', label), i); }
      for (let k = 0; k < 4; k++) {
        const r = { p: el('p'), name: el('b'), input: el('em'), note: el('small') };
        r.p.append(r.name, r.input, r.note); r.p.style.display = 'none';
        moveRows.push(r); movesEl.appendChild(r.p);
      }
      info.append(nameEl, tagEl, statsEl, movesEl);
      if (tall) {
        // ‹ and › on the carousel's edges, over the cards hanging off them: plain buttons, not stops for the D-pad
        // (left and right already spin it). The count (3 / 18) sits in the sheet's corner.
        const step = (d, cls) => { const s = el('button', `fl-ringstep ${cls}`); s.type = 'button';
          s.innerHTML = `<svg viewBox="0 0 18 18"><path d="${d < 0 ? 'M12 2 L5 9 L12 16' : 'M6 2 L13 9 L6 16'}"/></svg>`;
          s.setAttribute('aria-label', d < 0 ? 'previous fighter' : 'next fighter');
          s.addEventListener('click', (e) => { e.preventDefault(); focusIdx(cur + d); }); return s; };
        deck.append(step(-1, 'fl-prev'), step(1, 'fl-next'));
        countEl = el('span', 'fl-ringcount');
        detail.append(info, countEl);
        root.append(deck, detail);
        wireRing(deck);
      } else {
        bigCanvas = document.createElement('canvas'); bigCanvas.width = 210; bigCanvas.height = 540; bigCanvas.className = 'fl-big';
        detail.append(bigCanvas, info);
        row.append(deck, detail);
        root.appendChild(row);
      }
      const foot = el('div', 'fl-selfoot');
      const pick = button(o.pickLabel || 'PICK', () => { const it = ui.items[ui.focus]; const c = it && it.char ? it.char : bigChar; if (c) o.onPick(c.id); }, 'fl-pink');
      const back = button(o.backLabel || 'BACK', o.onBack, 'fl-violet');
      const tc = techniqueCount();   // the happy accidents found on this browser (src/flow/techniques.js)
      // the keys and buttons are in the footer legend (ui.js); touch gets the one thing it can't guess
      const extra = [...(o.extra || [])];
      const moves = o.onMoves ? button('MOVE LIST', () => { if (bigChar) o.onMoves(bigChar); }, 'fl-amber') : null;
      if (moves) extra.unshift(moves);
      foot.append(back.el, pick.el, ...extra.map((x) => x.el));
      const hints = [el('div', 'fl-small fl-touchonly', tall ? 'SWIPE  ·  TAP THE MIDDLE TO PICK' : 'TAP A FIGHTER, TAP AGAIN TO PICK'),
        el('div', 'fl-small fl-found', `TECHNIQUES FOUND ${tc.found}/${tc.total}`)];
      if (tall) { root.appendChild(foot); const h = el('div', 'fl-selhints'); h.append(...hints); root.appendChild(h); }
      else { foot.append(...hints); root.appendChild(foot); }
      items.push(back, pick, ...extra);
      return { items, focus: cur, back: o.onBackKey || o.onBack, move: arrows,
        onFocus: (k, it) => {
          if (!it || !it.char) return;
          cur = roster.indexOf(it.char);
          aimAt(cur);
          paint(it.char);
          if (grid) it.el.scrollIntoView({ block: 'nearest' });   // a roster past three rows: the grid scrolls to the cursor
          if (o.onHover) o.onHover(it.char.id);
        },
        legend: o.legend || [['move'], ['confirm', 'PICK'], ...(o.onMoves ? [['moves', 'MOVE LIST']] : []), ['back', 'BACK']] };
    });
    paint(roster[cur]);
    place(true);
    if (marked) { const [id, label, cls] = marked.split('|'); marked = ''; api.mark(id, label, cls); }
  }

  // Left and right go round the ring: on a card they step through the roster in order and wrap from the last
  // fighter to the first. Upright, down from the carousel goes to PICK and up from the footer comes back to
  // the card in the middle (the cards off to the sides are out of reach of geometry). Anything else: geometry.
  function arrows(dir, k, it) {
    if (it && it.char) {
      const i = roster.indexOf(it.char);
      if (dir === 'left' || dir === 'right') {
        if (tall || !grid) { focusIdx(i + (dir === 'left' ? -1 : 1)); return true; }
        // the grid: a step within the row is geometry's; off either end of a row it goes on to the next fighter, round the ring
        const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length || 1;
        const edge = dir === 'left' ? i % cols === 0 : (i % cols === cols - 1 || i === n - 1);
        if (edge) { focusIdx(i + (dir === 'left' ? -1 : 1)); return true; }
        return false;
      }
      if (tall && dir === 'down') { const p = ui.items.findIndex((x) => x.el.classList.contains('fl-pink')); if (p >= 0) ui.setFocus(p, true); return true; }
      if (tall && dir === 'up') return true;
      return false;
    }
    if (tall && dir === 'up') { focusIdx(cur); return true; }
    return false;
  }

  // The carousel under a finger (or a mouse): a drag spins it and the card that crosses the middle takes the
  // focus as it goes; let go and it settles on a card, a flick carrying on a few. A press that doesn't move is
  // a tap: on the middle card it picks, on a side card it brings that one to the middle. pointerdown never
  // focuses here (the grid's does), or every swipe would start by jumping to the card under the thumb.
  function wireRing(deck) {
    const stepPx = () => deck.clientHeight * 0.7 * RING.step;
    deck.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || /** @type {any} */ (e.target).closest('.fl-ringstep')) return;   // ‹ and › are buttons, not the start of a swipe
      drag = { id: e.pointerId, x0: e.clientX, pos0: pos, moved: false, lx: e.clientX, lt: e.timeStamp, v: 0, card: /** @type {any} */ (e.target).closest('.fl-card') };
      try { deck.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
    });
    deck.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x0;
      if (!drag.moved && Math.abs(dx) < 8) return;
      drag.moved = true;
      const dt = Math.max(1, e.timeStamp - drag.lt);
      drag.v = 0.6 * drag.v + 0.4 * ((e.clientX - drag.lx) / dt); drag.lx = e.clientX; drag.lt = e.timeStamp;
      pos = target = drag.pos0 - dx / stepPx();
      const near = ((Math.round(pos) % n) + n) % n;
      if (near !== cur) focusIdx(near, true);
      place();
    });
    const end = (e, cancel) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      if (!d.moved) {
        if (cancel || !d.card) return;
        const i = views.findIndex((v) => v.card === d.card);
        if (i < 0) return;
        if (i === cur) ui.activate(); else focusIdx(i);   // a tap: the middle one picks, a side one comes to the middle
        return;
      }
      // a flick carries on: the ring coasts about 0.18 s at the finger's speed, then settles on the nearest card
      const fling = cancel || e.timeStamp - d.lt > 80 ? 0 : -d.v * 180 / stepPx();
      target = Math.round(pos + Math.max(-4, Math.min(4, fling)));
      focusIdx(target, true);
      target = pos + wrapOff(cur - pos, n);
    };
    deck.addEventListener('pointerup', (e) => end(e, false));
    deck.addEventListener('pointercancel', (e) => end(e, true));
  }

  let marked = '';
  const api = {
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
    /** per frame: the cards breathe, the big rig throws one of its unique moves every few seconds, the carousel slides */
    tick(dt) {
      if (tall && !drag && pos !== target) {
        const d = target - pos;
        pos = Math.abs(d) < 0.002 ? target : pos + d * Math.min(1, dt * 16);
        if (Math.abs(target) > 4 * n) { const w = Math.floor(target / n) * n; target -= w; pos -= w; }   // keep the numbers small
      }
      place();
      for (let i = 0; i < views.length; i++) {
        const v = views[i];
        if (roster[i] === bigChar) { v.draw(Math.min(0.1, v.wait + dt), true); v.wait = 0; continue; }
        v.wait += dt;
        if (v.hidden) continue;   // round the back of the carousel: drawn again when it comes into view
        if (v.age === Infinity) { v.draw(dt, true); v.wait = (i % 4) * CARD_STEP / 4; }   // the first frame draws them all
        else if (v.wait >= CARD_STEP - 0.002) { v.draw(Math.min(0.1, v.wait), false); v.wait = 0; }
      }
      if (!big) return;
      bigT += dt;
      // its own clips (a frame-only move like SAME DAY plays another move's clip, so it's skipped)
      const own = bigChar && bigChar.ownMoves ? bigChar.ownMoves.filter((m) => MOVES.includes(m)) : [];
      if (!showing && bigT > 2.2 && own.length && !drag) {
        try { big.rig.play(own[showN++ % own.length]); showing = true; } catch { showing = false; bigT = 0; }
      } else if (showing && big.rig.current.done) { big.rig.x = 0; big.rig.play('idle'); showing = false; bigT = 0; }
      if (!tall) big.draw(dt);
    },
  };

  build();
  // the phone turned with the screen up: the same screen in the other layout, the cursor where it was
  let unsub = null, gone = false;
  unsub = onSquare((s) => {
    if (gone) return;
    if (ui.screen !== screenEl) { gone = true; if (unsub) unsub(); return; }   // this screen has gone
    if (!!s.on !== tall) { build(); if (o.onHover && bigChar) o.onHover(bigChar.id); }
  });
  return api;
}
