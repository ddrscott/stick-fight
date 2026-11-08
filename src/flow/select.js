// The character select screen (the flow's charSelect state): a grid of the registered roster, each
// card a live idle rig in the character's neon, and a sheet for the focused one: a bigger rig that
// shows off a unique move now and then, the name and tagline, stat bars and the unique move list.
// Keys and the pad move the cursor by geometry (ui.js); a tap focuses a card and a second tap (or the
// PICK button, Enter, A) picks it, so a stray touch never starts a fight.

import { el, button } from './ui.js';
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

// a rig drawn into its own canvas, glowing in the character's color
function rigView(canvas, c, zoom) {
  const rig = createFighter({ color: c.color, x: 0, y: 0, facing: 1, body: c.body });
  rig.setBody(c.body, { accent: c.accent });
  rig.speedLines = false;
  const ctx = canvas.getContext('2d');
  return {
    rig,
    draw(dt) {
      rig.update(dt);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // a floor glow under the feet
      const g = ctx.createRadialGradient(canvas.width / 2, canvas.height * 0.93, 2, canvas.width / 2, canvas.height * 0.93, canvas.width * 0.42);
      g.addColorStop(0, c.color + '55'); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.fillRect(0, canvas.height * 0.8, canvas.width, canvas.height * 0.2);
      ctx.translate(canvas.width / 2, canvas.height * 0.93);
      ctx.scale(zoom, zoom);
      ctx.shadowColor = c.color; ctx.shadowBlur = 9;
      rig.draw(ctx);
    },
  };
}

/**
 * @param {any} ui            createUI's object
 * @param {{ title: string, sub: string, roster: any[], initial?: string, touch: boolean, pad: boolean,
 *           onPick: (id: string) => void, onBack: () => void, cls?: string }} o
 */
export function openSelect(ui, o) {
  const views = [];
  let big = null, bigT = 0, bigChar = null, showing = false, showN = 0;
  let detail, nameEl, tagEl, statsEl, movesEl, bigCanvas;
  const roster = o.roster;
  const start = Math.max(0, roster.findIndex((c) => c.id === o.initial));

  function paint(c) {
    if (!c || !detail) return;
    detail.style.setProperty('--c', c.color);
    nameEl.textContent = c.name; nameEl.classList.toggle('fl-long', c.name.length > 11);
    tagEl.textContent = c.tagline;
    statsEl.textContent = '';
    for (const [label, f] of STATS) { const i = el('i'); i.style.setProperty('--v', String(clamp01(f(c)))); statsEl.append(el('span', '', label), i); }
    movesEl.textContent = '';
    for (const m of (c.moveList || []).slice(0, 4)) { const p = el('p'); p.append(el('b', '', m.name), el('em', '', m.input), el('small', '', m.note || '')); movesEl.appendChild(p); }
    big = rigView(bigCanvas, c, 2.05); bigChar = c; bigT = 0; showing = false;
  }

  ui.show(`fl-select ${o.cls || ''}`, (root) => {
    root.append(el('h1', 'fl-h2', o.title), el('div', 'fl-label', o.sub));
    const row = el('div', 'fl-selrow');
    const grid = el('div', 'fl-grid');
    const items = [];
    roster.forEach((c) => {
      const b = button('', () => o.onPick(c.id), 'fl-card');
      b.el.style.setProperty('--c', c.color);
      const cv = document.createElement('canvas'); cv.width = 226; cv.height = 154;   // the card's shape, so the rig isn't stretched
      b.el.append(cv, el('b', c.name.length > 11 ? 'fl-long' : '', c.name));   // WINDOW WASHER doesn't fit at the card's size
      grid.appendChild(b.el);
      views.push(rigView(cv, c, 0.92));
      items.push({ ...b, focusFirst: true, char: c });
    });
    detail = el('div', 'fl-detail');
    bigCanvas = document.createElement('canvas'); bigCanvas.width = 250; bigCanvas.height = 540; bigCanvas.className = 'fl-big';
    const info = el('div', 'fl-info');
    nameEl = el('h1', 'fl-cname'); tagEl = el('div', 'fl-tagline'); statsEl = el('div', 'fl-stats'); movesEl = el('div', 'fl-moves');
    info.append(nameEl, tagEl, statsEl, movesEl);
    detail.append(bigCanvas, info);
    row.append(grid, detail);
    root.appendChild(row);
    const foot = el('div', 'fl-selfoot');
    const pick = button('PICK', () => { const it = ui.items[ui.focus]; const c = it && it.char ? it.char : bigChar; if (c) o.onPick(c.id); }, 'fl-pink');
    const back = button('BACK', o.onBack, 'fl-violet');
    foot.append(back.el, pick.el, el('div', 'fl-small', o.touch ? 'TAP A FIGHTER, TAP AGAIN TO PICK' : o.pad ? 'A PICKS   B BACK' : 'ENTER PICKS   ESC BACK'));
    root.appendChild(foot);
    items.push(back, pick);
    return { items, focus: start, back: o.onBack, onFocus: (k, it) => { if (it && it.char) paint(it.char); } };
  });
  paint(roster[start]);

  return {
    /** per frame: the cards breathe, the big rig throws one of its unique moves every few seconds */
    tick(dt) {
      for (const v of views) v.draw(dt);
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
