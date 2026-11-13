// The character select screen (the flow's charSelect state): a grid of the registered roster, each
// card a live idle rig in the character's neon, and a sheet for the focused one: a bigger rig that
// shows off a unique move now and then, the name and tagline, stat bars and the unique move list.
// Enter, Space or A picks the fighter in the middle, and so does the PICK button. B, Esc, Backspace, Select or the
// corner's ‹ chip go back (ui.js). MOVE LIST (the button, F1 or pad Y; the flow reads the key) opens the
// highlighted fighter's full move list (src/flow/movelist.js) over the screen.
//
// One layout everywhere (2026-11-13): a carousel of the cards, the focused one big in the middle with its
// neighbours shrinking off both edges, and the sheet. A swipe or a mouse drag spins it (a flick carries on), the
// wheel, ‹ and › step it, a tap or click on a side card brings it to the middle and one on the middle card picks.
// The roster is a ring: left and right wrap from the last fighter to the first. Held upright (src/square.js) the
// screen leaves the 16:9 box and takes the whole phone, with the sheet under the carousel (.fl-tall). Sideways and
// on a desktop the sheet sits beside it (.fl-wide), with a strip of the roster under the cards to jump straight to
// one. Turn the phone with the screen up and it's rebuilt in the other layout, same cursor. (o.grid: the old grid.)

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

// a rig drawn into its own canvas, glowing in the character's color (glow: the blur, bigger on a bigger canvas).
// look: a palette ({ body, pants, accent }, src/career/palettes.js) to draw it in instead of its own colors
function rigView(canvas, c, zoom, glowPx = GLOW, look = null) {
  const rig = createFighter({ color: (look && look.body) || c.color, x: 0, y: 0, facing: 1, body: c.body });
  rig.pants = look ? look.pants : c.pants || null;
  rig.setBody(c.body, { accent: (look && look.accent) || c.accent });
  rig.speedLines = false;
  rig.charDef = c;   // its cloth (a tie, a lanyard, an apron's hem) hangs at rest
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const layer = () => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; };
  const plain = layer(), pctx = plain.getContext('2d');
  const glow = layer(), gctx = glow.getContext('2d');
  gctx.shadowColor = rig.color; gctx.shadowBlur = glowPx;
  // a floor glow under the feet
  let floor;
  const makeFloor = () => { floor = ctx.createRadialGradient(w / 2, h * 0.93, 2, w / 2, h * 0.93, w * 0.42); floor.addColorStop(0, rig.color + '55'); floor.addColorStop(1, 'transparent'); };
  makeFloor();
  const pose = (x) => { x.setTransform(zoom, 0, 0, zoom, w / 2, h * 0.93); rig.draw(x); x.setTransform(1, 0, 0, 1, 0, 0); };
  const halo = () => { for (let k = 0; k < GLOW_COATS; k++) ctx.drawImage(glow, 0, 0); };
  return {
    rig,
    /** draw it in a palette (null: its own colors); the glow is remade on the next frame */
    recolor(p) {
      const col = (p && p.body) || c.color;
      if (rig.color === col && rig.pants === (p ? p.pants : c.pants || null)) return;
      rig.color = col; rig.pants = p ? p.pants : c.pants || null; rig.accent = (p && p.accent) || c.accent;
      gctx.shadowColor = col; makeFloor(); this.age = Infinity;
    },
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
 *   button, for the fighter under the cursor.
 *   mastery, rank (README, Progression, Fighter mastery): mastery(id) the sheet's line under the tagline (an element),
 *   rank(id) the number for the card's corner.
 *   palettes (README, Progression): the strip of looks under the fighter's sheet. { list(c): the looks, its own
 *   (id '') first; state(c, p): { owned, using }; choose(c, p): a press on one (use it, or buy it on a second press),
 *   resolving to the line to show under the strip }. Flat swatches; the sheet's rig previews the one under the cursor.
 */
export function openSelect(ui, o) {
  const roster = o.roster, n = roster.length;
  let cur = Math.max(0, roster.findIndex((c) => c.id === o.initial));   // the roster index under the cursor
  let views = [], big = null, bigT = 0, bigChar = null, showing = false, showN = 0;
  let detail, nameEl, tagEl, statsEl, movesEl, bigCanvas, countEl, ring, grid, screenEl;
  let cards = new Map();   // id -> the card's element (mark() tags the rival's)
  let bigs = new Map();    // id -> its big rigView (the sheet's rig, sideways)
  let statBars = [], moveRows = [];
  let palBtns = [], palNote = null, palFor = null;   // the palette strip (o.palettes): its buttons, the line under it, whose it shows
  let mastEl = null;   // fighter mastery's line under the tagline (o.mastery)
  let tall = false;
  const carousel = !o.grid;   // every select is the carousel; the grid stays for o.grid
  let dots = [];   // the roster strip under a wide carousel: one per fighter
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
    if (mastEl) mastEl.replaceChildren(o.mastery(c.id));
    STATS.forEach(([, f], i) => statBars[i].style.setProperty('--v', String(clamp01(f(c)))));
    const list = (c.moveList || []).slice(0, moveRows.length);
    moveRows.forEach((r, i) => {
      const m = list[i];
      if (carousel) r.p.style.visibility = m ? '' : 'hidden';   // an empty row keeps its room, so the carousel never changes size
      r.p.style.display = m || carousel ? '' : 'none';
      if (m) { r.name.textContent = m.name; r.input.textContent = m.input; r.note.textContent = m.note || ''; }
    });
    if (countEl) countEl.textContent = `${roster.indexOf(c) + 1} / ${n}`;
    dots.forEach((d, i) => d.classList.toggle('fl-on', roster[i] === c));
    if (big && showing) { big.rig.x = 0; big.rig.play('idle'); }   // the one it left stops mid-move
    if (carousel) {
      big = views[roster.indexOf(c)];
      big.rig.x = 0; big.rig.play('idle');
    } else {
      big = bigs.get(c.id);
      if (!big) { const look = inUse(c); bigs.set(c.id, big = rigView(bigCanvas, c, 1.9, GLOW, look && look.id ? look : null)); }
      else { big.rig.x = 0; big.rig.play('idle'); }   // back from another card: standing, not mid-move
    }
    bigChar = c; bigT = 0; showing = false;
    paintPals(c);
    if (!carousel) big.draw(0);
  }

  // ---- palettes (o.palettes): the swatches for the fighter under the cursor -----------------------------------
  const looks = (c) => (o.palettes && c ? o.palettes.list(c) : []);
  const inUse = (c) => looks(c).find((p) => o.palettes.state(c, p).using) || null;
  /** a card and the sheet's rig in the look this fighter fights in */
  function showLook(c, p) {
    const look = p && p.id ? p : null;
    const v = views[roster.indexOf(c)];
    if (v) v.recolor(look);
    const b = carousel ? v : bigs.get(c.id);
    if (b && b !== v) b.recolor(look);
  }
  function paintPals(c, note = '') {
    if (!o.palettes || !palBtns.length) return;
    palFor = c;
    const list = looks(c);
    palBtns.forEach((b, k) => {
      const p = list[k];
      b.el.style.display = p ? '' : 'none';
      if (!p) return;
      const st = o.palettes.state(c, p);
      b.el.style.setProperty('--sw', p.body); b.el.style.setProperty('--sw2', p.pants || p.body); b.el.style.setProperty('--sw3', p.accent || p.body);
      b.el.classList.toggle('fl-palon', st.using);
      b.el.classList.toggle('fl-pallock', !st.owned);
      const tag = b.el.querySelector('small');
      if (tag) tag.textContent = st.using ? 'IN USE' : st.owned ? 'OWNED' : p.price ? `${p.price}` : `M${p.mastery || ''}`;
    });
    if (palNote) palNote.textContent = note || palLine(c, inUse(c));
    showLook(c, inUse(c));
  }
  function palLine(c, p) {
    if (!p) return '';
    const st = o.palettes.state(c, p);
    return `${p.id ? p.name : 'MAIN'}${st.using ? '  ·  IN USE' : st.owned ? '  ·  OWNED' : `  ·  ${o.palettes.how ? o.palettes.how(c, p) : `${p.price} STICKS`}`}`;
  }
  async function choosePal(k) {
    const c = palFor || bigChar;
    const p = looks(c)[k];
    if (!c || !p) return;
    const note = await o.palettes.choose(c, p);
    if (palFor === c) paintPals(c, note || '');
    const v = views[roster.indexOf(c)];
    if (v) v.card.style.setProperty('--c', (inUse(c) && inUse(c).id ? inUse(c).body : c.color));
  }

  // the carousel's cards where pos puts them (every frame it moves; nothing while it sits still)
  let placedAt = NaN;
  function place(force = false) {
    if (!ring || (!force && pos === placedAt)) return;
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
    ring = null; grid = null; countEl = null; drag = null; placedAt = NaN; dots = [];
    pos = target = cur;
    // sideways the carousel's row takes what's left of the height (flex), so the screen is always exactly full: ui.js's
    // fit() would read that as too tall, zoom it down, find it full again, and end up scrolling it with the legend
    // hidden (round 3 of [t55b8f]). It sizes itself, like the upright one.
    const layout = tall ? 'fl-carousel fl-tall fl-nofit' : carousel ? 'fl-carousel fl-wide fl-nofit' : '';
    screenEl = ui.show(`fl-select ${layout} ${o.cls || ''}`, (root) => {
      root.append(el('h1', 'fl-h2', o.title), el('div', 'fl-label', o.sub));
      if (o.status) root.appendChild(o.status);
      const row = el('div', 'fl-selrow');
      const items = [];
      // tall cards (a bigger canvas: the middle one is most of the screen's width) or the grid's
      const cw = carousel ? 220 : 160, chh = carousel ? 290 : 200, cz = carousel ? 1.5 : 1.08;
      const deck = el('div', carousel ? 'fl-ring' : 'fl-grid');
      if (carousel) ring = deck; else grid = deck;
      // past 18 fighters the grid holds three rows and scrolls under a finger, the wheel and the cursor (data-scroll: src/touch.js lets it)
      if (!carousel && n > 18) { deck.classList.add('fl-gridscroll'); deck.dataset.scroll = 'y'; }
      roster.forEach((c) => {
        const b = button('', () => o.onPick(c.id), 'fl-card');
        b.el.style.setProperty('--c', c.color);
        const cv = document.createElement('canvas'); cv.width = cw; cv.height = chh;   // the card's shape, so the rig isn't stretched
        b.el.append(cv, el('b', c.name.length > 9 ? 'fl-long' : '', c.name));   // a long name (WINDOW WASHER) goes smaller and may take two lines
        // fighter mastery's rank on the card (o.mastery): M2 in the corner, nothing before the first rank
        if (o.mastery && o.rank) { const r = o.rank(c.id); if (r > 0) { const m = el('small', 'fl-mrank', `M${r}`); m.setAttribute('aria-label', `mastery ${r}`); b.el.appendChild(m); } }
        deck.appendChild(b.el);
        cards.set(c.id, b.el);
        const look = o.palettes ? (o.palettes.list(c).find((p) => o.palettes.state(c, p).using) || null) : null;
        const v = rigView(cv, c, cz, carousel ? 12 : GLOW, look && look.id ? look : null); v.lead = GLOW_EVERY * views.length / n;
        if (look && look.id) b.el.style.setProperty('--c', look.body);
        v.card = b.el; v.hidden = false;
        views.push(v);
        items.push({ ...b, focusFirst: true, manual: carousel, char: c });
      });
      detail = el('div', 'fl-detail');
      const info = el('div', 'fl-info');
      nameEl = el('h1', 'fl-cname'); tagEl = el('div', 'fl-tagline'); statsEl = el('div', 'fl-stats'); movesEl = el('div', 'fl-moves');
      for (const [label] of STATS) { const i = el('i'); statBars.push(i); statsEl.append(el('span', '', label), i); }
      // sideways the sheet has a fixed height: with the palette strip under it, the move list shows three rows
      for (let k = 0; k < (o.palettes && !carousel ? 3 : 4); k++) {
        const r = { p: el('p'), name: el('b'), input: el('em'), note: el('small') };
        r.p.append(r.name, r.input, r.note); r.p.style.display = 'none';
        moveRows.push(r); movesEl.appendChild(r.p);
      }
      mastEl = o.mastery ? el('div', 'fl-mastery') : null;
      info.append(nameEl, tagEl, ...(mastEl ? [mastEl] : []), statsEl, movesEl);
      palBtns = []; palNote = null;
      if (o.palettes) {
        const strip = el('div', 'fl-pals');
        for (let k = 0; k < (o.palettes.slots || 4); k++) {
          const b = button('', () => choosePal(k), 'fl-pal');
          b.el.append(el('i', 'fl-sw'), el('small', ''));
          b.el.setAttribute('aria-label', 'palette');
          strip.appendChild(b.el);
          palBtns.push({ ...b, palIdx: k });
        }
        palNote = el('div', 'fl-palnote');
        info.append(strip, palNote);
      }
      if (carousel) {
        // ‹ and › on the carousel's edges, over the cards hanging off them: plain buttons, not stops for the D-pad
        // (left and right already spin it). The count (3 / 18) sits in the sheet's corner.
        const step = (d, cls) => { const s = el('button', `fl-ringstep ${cls}`); s.type = 'button';
          s.innerHTML = `<svg viewBox="0 0 18 18"><path d="${d < 0 ? 'M12 2 L5 9 L12 16' : 'M6 2 L13 9 L6 16'}"/></svg>`;
          s.setAttribute('aria-label', d < 0 ? 'previous fighter' : 'next fighter');
          s.addEventListener('click', (e) => { e.preventDefault(); focusIdx(cur + d); }); return s; };
        deck.append(step(-1, 'fl-prev'), step(1, 'fl-next'));
        countEl = el('span', 'fl-ringcount');
        detail.append(info, countEl);
        if (tall) root.append(deck, detail);
        else {
          // wide: the carousel and, under it, the whole roster as a strip of marks in each fighter's color, to jump
          // straight to one with a click or a tap (the D-pad has left and right). The sheet beside them.
          const col = el('div', 'fl-ringcol'), strip = el('div', 'fl-ringdots');
          roster.forEach((c, i) => {
            const d = el('button', 'fl-dot'); d.type = 'button';
            d.style.setProperty('--c', c.color); d.setAttribute('aria-label', c.name.toLowerCase());
            d.addEventListener('mousedown', (e) => e.preventDefault());
            d.addEventListener('click', (e) => { e.preventDefault(); focusIdx(i); });
            strip.appendChild(d); dots.push(d);
          });
          col.append(deck, strip);
          row.append(col, detail);
          root.appendChild(row);
        }
        wireRing(deck);
      } else {
        bigCanvas = document.createElement('canvas'); bigCanvas.width = 210; bigCanvas.height = 540; bigCanvas.className = 'fl-big';
        detail.append(bigCanvas, info);
        row.append(deck, detail);
        root.appendChild(row);
      }
      const foot = el('div', 'fl-selfoot');
      const pick = button(o.pickLabel || 'PICK', () => { const it = ui.items[ui.focus]; const c = it && it.char ? it.char : bigChar; if (c) o.onPick(c.id); }, 'fl-pink');
      // back is the corner's ‹ chip (o.backTo names it); online it's a named button (LEAVE ROOM, BACK TO CREW) instead
      const back = o.backLabel ? button(o.backLabel, o.onBack, 'fl-violet') : null;
      const tc = techniqueCount();   // the happy accidents found on this browser (src/flow/techniques.js)
      // the keys and buttons are in the footer legend (ui.js); touch gets the one thing it can't guess
      const extra = [...(o.extra || [])];
      const moves = o.onMoves ? button('MOVE LIST', () => { if (bigChar) o.onMoves(bigChar); }, 'fl-amber') : null;
      if (moves) extra.unshift(moves);
      foot.append(...(back ? [back.el] : []), pick.el, ...extra.map((x) => x.el));
      const hints = [el('div', 'fl-small fl-touchonly', carousel ? 'SWIPE  ·  TAP THE MIDDLE TO PICK' : 'TAP A FIGHTER, TAP AGAIN TO PICK'),
        el('div', 'fl-small fl-found', `TECHNIQUES FOUND ${tc.found}/${tc.total}`)];
      if (tall) { root.appendChild(foot); const h = el('div', 'fl-selhints'); h.append(...hints); root.appendChild(h); }
      else { foot.append(...hints); root.appendChild(foot); }
      items.push(...(back ? [back] : []), pick, ...extra, ...palBtns);
      return { items, focus: cur, back: o.onBackKey || o.onBack, backTo: back ? '' : (o.backTo || 'MAIN MENU'), move: arrows,
        onFocus: (k, it) => {
          // a swatch under the cursor: the sheet's rig tries it on, and the line says what it is
          if (it && it.palIdx != null && bigChar) { const p = looks(bigChar)[it.palIdx]; if (p) { showLook(bigChar, p); if (palNote) palNote.textContent = palLine(bigChar, p); } return; }
          if (!it || !it.char) return;
          cur = roster.indexOf(it.char);
          aimAt(cur);
          paint(it.char);
          if (grid) it.el.scrollIntoView({ block: 'nearest' });   // a roster past three rows: the grid scrolls to the cursor
          if (o.onHover) o.onHover(it.char.id);
        },
        legend: o.legend || [['move'], ['confirm', 'PICK'], ...(o.onMoves ? [['moves', 'MOVE LIST']] : []), ['back', o.backTo || 'MAIN MENU']] };
    });
    paint(roster[cur]);
    place(true);
    if (marked) { const [id, label, cls] = marked.split('|'); marked = ''; api.mark(id, label, cls); }
    if (tall) { fitTall(); requestAnimationFrame(fitTall); watchFit(); }
  }

  // Upright, the screen has to fit the height you can see, and how much it holds above the carousel varies: the
  // online pick screen has a second subtitle line and a status line, a long rival name wraps, and a phone's
  // browser bars take what they take. So rather than guess with breakpoints, it measures: with everything in, then
  // a step at a time (fl-fit1: the move notes go and the bars pair up; fl-fit2: the moves and tagline go, MOVE LIST
  // has them; fl-fit3: the hint line goes) until the footer is on screen and the carousel is at least RING_MIN tall. The
  // carousel shrinks first on its own (flex, down to its 120 px floor); the steps are for when that isn't enough. Until 2026-11-12 these were
  // @container height breakpoints tuned for the offline select, and the online one ran its footer off the bottom.
  const FIT_STEPS = ['fl-fit1', 'fl-fit2', 'fl-fit3'];
  // too tall for the screen, or the carousel squeezed under RING_MIN (a card you can't read at a glance)
  const RING_MIN = 150;
  function overflows() { return screenEl.scrollHeight > screenEl.clientHeight + 1 || (!!ring && ring.clientHeight < RING_MIN); }
  function fitTall() {
    if (!tall || !screenEl || !screenEl.isConnected) return;
    syncVisible();
    screenEl.classList.remove(...FIT_STEPS);
    for (const c of FIT_STEPS) { if (!overflows()) break; screenEl.classList.add(c); }
  }
  /** the height you can actually see, for #flow's fixed layer upright (ui.js): a phone browser whose toolbar
   *  sits over the page reports a layout height taller than what shows; the visual viewport doesn't */
  function syncVisible() {
    const vv = window.visualViewport, root = document.documentElement;
    if (vv && vv.height > 0 && vv.scale <= 1.01) root.style.setProperty('--sf-seen-h', `${Math.round(vv.height)}px`);
    else root.style.removeProperty('--sf-seen-h');
  }
  let fitObs = null, fitRaf = 0;
  function watchFit() {
    if (fitObs) fitObs.disconnect();
    if (typeof ResizeObserver === 'undefined' || !screenEl) return;
    // the layer's size (the phone turning, the bars sliding) and the lines above the carousel (a status that
    // grows a line); the fit steps change neither, so this never feeds itself
    fitObs = new ResizeObserver(() => { cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(() => { if (ui.screen !== screenEl) { fitObs.disconnect(); return; } fitTall(); }); });
    if (screenEl.parentElement) fitObs.observe(screenEl.parentElement);
    for (const k of screenEl.querySelectorAll(':scope > .fl-h2, :scope > .fl-label, :scope > .fl-selstatus')) fitObs.observe(k);
  }
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { if (tall && ui.screen === screenEl) fitTall(); });

  // Left and right go round the ring: on a card they step through the roster in order and wrap from the last
  // fighter to the first. Down from the carousel goes to the looks (the one in use), or PICK without them; up from
  // the looks or the footer comes back to the card in the middle (the cards off to the sides are out of reach of
  // geometry), the footer stopping at the looks first. Anything else: geometry.
  const palIn = () => { const it = ui.items.findIndex((x) => x.palIdx != null && x.el.classList.contains('fl-palon') && x.el.style.display !== 'none'); return it; };
  function arrows(dir, k, it) {
    if (carousel && it && it.char && dir === 'down') {
      const pl = palIn(), p = ui.items.findIndex((x) => x.el.classList.contains('fl-pink'));
      if (pl >= 0) ui.setFocus(pl, true); else if (p >= 0) ui.setFocus(p, true);
      return true;
    }
    if (carousel && it && !it.char && dir === 'up') {
      if (it.palIdx == null) { const pl = palIn(); if (pl >= 0) { ui.setFocus(pl, true); return true; } }
      focusIdx(cur); return true;
    }
    if (carousel && it && it.palIdx != null && dir === 'down') { const p = ui.items.findIndex((x) => x.el.classList.contains('fl-pink')); if (p >= 0) ui.setFocus(p, true); return true; }
    if (it && it.char) {
      const i = roster.indexOf(it.char);
      if (dir === 'left' || dir === 'right') {
        if (carousel || !grid) { focusIdx(i + (dir === 'left' ? -1 : 1)); return true; }
        // the grid: a step within the row is geometry's; off either end of a row it goes on to the next fighter, round the ring
        const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length || 1;
        const edge = dir === 'left' ? i % cols === 0 : (i % cols === cols - 1 || i === n - 1);
        if (edge) { focusIdx(i + (dir === 'left' ? -1 : 1)); return true; }
        return false;
      }
      if (carousel && dir === 'up') return true;
      return false;
    }
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
    // the mouse wheel (or a trackpad's swipe) steps it one card a notch
    let wheelAt = 0;
    deck.addEventListener('wheel', (e) => {
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(d) < 4 || e.timeStamp - wheelAt < 140) return;
      wheelAt = e.timeStamp; focusIdx(cur + (d > 0 ? 1 : -1));
    }, { passive: false });
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
      if (ring && !drag && pos !== target) {
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
      if (!carousel) big.draw(dt);
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
