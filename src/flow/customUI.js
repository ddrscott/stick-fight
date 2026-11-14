// The custom employee on screen (README, Characters, Custom employee): the SUPPLY CLOSET's CUSTOM EMPLOYEE section on
// each fighter's shelf (its two slots), the page a slot opens (every move this fighter can borrow, to buy or slot),
// and character select's line. Text to read, so nothing glows; square corners, a full outline. Prices are fixed and
// on every card before anything is pressed, a buy takes two presses like a palette, and owning a move isn't slotting
// it: the player picks what goes in each slot, or empties it. A borrowed move is always drawn on the borrower's own
// body, in its own colors (the palette it wears), never the lender's look.
//
//   slotShelf(o)        the shelf's section: { el, items, focus }. o: { fighter, focusKey, open(n) }
//   slotPage(o)         the page for one slot: { el, items, focus }. o: { fighter, n, focusKey, repaint(fk, msg), note(msg), done(msg) }
//   loadoutLine(id)     character select's line: MOVES ↓1+3 REBOOT · ↓2+4 MOP SPIN (null with both slots empty)
import { el, button } from './ui.js';
import { createFighter } from '../fighter/index.js';
import { FRAME_DATA } from '../combat/frameData.js';
import { animOf } from '../combat/moveinfo.js';
import { characterOr } from '../characters/index.js';
import { career, equipped, loadout, buyMove, setSlot, ownsMove } from '../career/store.js';
import { SLOTS, MOVES, MOVE_PRICE, movesFor, moveInfo } from '../career/moves.js';

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const ownerName = (id) => characterOr(id).name;

/** the fighter (its body, in the palette it wears) caught at the move's first active key; standing with none. Flat, no glow. */
export function drawMove(canvas, c, move = null) {
  const look = equipped(c.id);
  const rig = createFighter({ color: (look && look.body) || c.color, x: 0, y: 0, facing: 1, body: c.body });
  rig.pants = look ? look.pants : c.pants || null;
  rig.setBody(c.body, { accent: (look && look.accent) || c.accent });
  rig.speedLines = false;
  rig.charDef = c;
  for (let k = 0; k < 12; k++) rig.update(1 / 60);
  const clip = move && FRAME_DATA[move] ? animOf(move) : null;
  if (clip) {
    try {
      rig.play(clip);
      rig.events.length = 0;
      // to the active key (or a little way in, for a move that never strikes), then two more frames for the swing
      let n = 0, at = -1;
      while (n++ < 240 && !rig.current.done) { rig.update(1 / 60); if (at < 0 && rig.events.some((e) => e.type === 'active')) at = n; rig.events.length = 0; if (at >= 0 && n >= at + 2) break; if (at < 0 && n >= 40 && FRAME_DATA[move].noHit) break; }
    } catch { /* an unknown clip: standing */ }
  }
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  // a lunge or a slide carries the root: keep the body in the middle of the card
  const hip = rig.joints && rig.joints.hip ? rig.joints.hip.x - rig.x : 0;
  ctx.setTransform(h / 190, 0, 0, h / 190, w / 2 - hip * (h / 190) * 0.6, h * 0.93);
  rig.draw(ctx);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 * The shelf's CUSTOM EMPLOYEE section for one fighter: its two slots, each showing the move in it on this fighter.
 * A press opens that slot's page.
 * @param {{ fighter: any, focusKey: string, open: (n: number) => void }} o
 */
export function slotShelf(o) {
  injectStyle();
  const ch = o.fighter, lo = loadout(ch.id), items = [];
  let focus = -1;
  const wrap = el('div', 'ce-shelf');
  const owned = MOVES.filter((m) => ownsMove(m.id)).length;
  wrap.appendChild(el('div', 'cl-kind', `CUSTOM EMPLOYEE  ${lo.filter(Boolean).length} / ${SLOTS.length} SLOTTED  ·  ${owned} / ${MOVES.length} MOVES OWNED`));
  wrap.appendChild(el('div', 'ce-sub', `TWO MORE MOVES BORROWED FROM OTHER FIGHTERS, ON TOP OF ${ch.name}'S OWN. EVERY MODE, VERSUS TOO: MORE MOVES ISN'T MORE POWER.`));
  const cards = el('div', 'ce-slots');
  SLOTS.forEach((s, i) => {
    const id = lo[i], m = moveInfo(id);
    const card = button('', () => o.open(s.n), `ce-slot${m ? ' ce-full' : ' ce-empty'}`);
    card.el.dataset.slot = String(s.n);
    card.el.dataset.move = id || '';
    const cv = document.createElement('canvas'); cv.width = 150; cv.height = 180;
    drawMove(cv, ch, id || null);
    const txt = el('div', 'ce-text');
    txt.append(el('span', 'ce-key', `SLOT ${s.key}  ·  ${s.input}`), el('b', 'ce-name', m ? m.name : 'EMPTY'),
      el('span', 'ce-how', m ? `FROM ${ownerName(m.fighter)}  ·  CHANGE` : 'THE THROW  ·  PICK A MOVE'));
    card.el.append(cv, txt);
    card.el.setAttribute('aria-label', `Slot ${s.key}, ${s.input}: ${m ? `${m.name}, from ${ownerName(m.fighter)}` : 'empty'}`);
    cards.appendChild(card.el);
    if (o.focusKey === `s:${s.n}`) focus = items.length;
    items.push(card);
  });
  wrap.appendChild(cards);
  return { el: wrap, items, focus };
}

/**
 * The page a slot opens: EMPTY, then every move this fighter can borrow, each drawn on this fighter with whose it is
 * and what it costs or that it's owned. Owned: one press puts it in the slot (from the other slot, it moves over).
 * Not owned: the first press asks, the second buys it and puts it in. Too few sticks says the price and what you have.
 * @param {{ fighter: any, n: number, focusKey: string, repaint: (fk: string, msg: string) => void, note: (msg: string) => void, done: (msg: string) => void }} o
 */
export function slotPage(o) {
  injectStyle();
  const ch = o.fighter, s = SLOTS[o.n - 1], lo = loadout(ch.id), items = [];
  let focus = -1, armed = '';
  const wrap = el('div', 'ce-page');
  const head = el('div', 'ce-phead');
  head.append(el('b', '', `${ch.name}  ·  SLOT ${s.key}  ·  ${s.input}`), el('span', '', `${fmt(career().sticks)} STICKS  ·  ${fmt(MOVE_PRICE)} A MOVE, YOURS FOR EVERY FIGHTER`));
  wrap.appendChild(head);
  const grid = el('div', 'ce-grid');
  grid.dataset.scroll = 'y';
  const add = (card, fk) => { grid.appendChild(card.el); if (o.focusKey === fk) focus = items.length; items.push(card); };

  // EMPTY: the slot goes back to being the throw
  {
    const card = button('', () => { setSlot(ch.id, o.n, ''); o.done(`SLOT ${s.key} IS EMPTY  ·  ${s.input} IS THE THROW`); }, `ce-card ce-none${lo[o.n - 1] ? '' : ' ce-in'}`);
    card.el.dataset.move = '';
    const cv = document.createElement('canvas'); cv.width = 120; cv.height = 150;
    drawMove(cv, ch, null);
    const txt = el('div', 'ce-text');
    txt.append(el('b', 'ce-name', 'EMPTY'), el('span', 'ce-from', 'NOTHING BORROWED'), el('span', 'ce-how', lo[o.n - 1] ? 'THE THROW' : `IN SLOT ${s.key}`));
    card.el.append(cv, txt);
    add(card, 'm:');
  }
  for (const m of movesFor(ch.id)) {
    const have = ownsMove(m.id), inThis = lo[o.n - 1] === m.id, other = lo.indexOf(m.id) >= 0 && !inThis ? SLOTS[lo.indexOf(m.id)] : null;
    const short = !have && career().sticks < MOVE_PRICE;
    const st = inThis ? 'in' : have ? 'owned' : short ? 'short' : 'buy';
    const card = button('', () => press(m, st), `ce-card ce-${st}${inThis ? ' ce-in' : ''}`);
    card.el.dataset.move = m.id;
    card.el.dataset.state = st;
    const cv = document.createElement('canvas'); cv.width = 120; cv.height = 150;
    drawMove(cv, ch, m.id);
    const txt = el('div', 'ce-text');
    const how = inThis ? `IN SLOT ${s.key}` : have ? (other ? `IN SLOT ${other.key}  ·  MOVE IT HERE` : `OWNED  ·  PUT IN SLOT ${s.key}`) : `${fmt(MOVE_PRICE)} STICKS`;
    txt.append(el('b', 'ce-name', m.name), el('span', 'ce-from', `FROM ${ownerName(m.fighter)}`), el('span', 'ce-how', how));
    card.el.append(cv, txt);
    card.el.setAttribute('aria-label', `${m.name}, from ${ownerName(m.fighter)}: ${m.note}. ${how}`);
    add(card, `m:${m.id}`);
  }
  wrap.appendChild(grid);

  async function press(m, st) {
    const fk = `m:${m.id}`;
    if (st === 'in') { o.note(`${m.name} IS IN SLOT ${s.key}  ·  ${m.note.toUpperCase()}`); return; }
    if (st === 'owned') { setSlot(ch.id, o.n, m.id); o.done(`${ch.name} HAS ${m.name} ON ${s.input}`); return; }
    const have = career().sticks;
    if (have < MOVE_PRICE) { armed = ''; o.note(`${m.name} COSTS ${fmt(MOVE_PRICE)} STICKS  ·  YOU HAVE ${fmt(have)}`); return; }
    if (armed !== m.id) { armed = m.id; o.note(`BUY ${m.name} FOR ${fmt(MOVE_PRICE)} STICKS AND PUT IT IN SLOT ${s.key}? PRESS AGAIN`); return; }
    armed = '';
    o.note('BUYING…');
    const r = await buyMove(m.id, { fighter: ch.id, n: o.n });
    if (r.error) { o.repaint(fk, r.error === 'short' ? `NOT ENOUGH STICKS FOR ${m.name}` : r.error === 'busy' ? 'SERVER BUSY: TRY AGAIN SHORTLY' : r.error === 'owned' ? `YOU ALREADY OWN ${m.name}` : "CAN'T REACH THE SERVER: NOTHING WAS SPENT"); return; }
    if (loadout(ch.id)[o.n - 1] !== m.id) setSlot(ch.id, o.n, m.id);
    o.done(`BOUGHT ${m.name}  ·  ${ch.name} HAS IT ON ${s.input}`);
  }
  if (focus < 0) focus = Math.max(0, items.findIndex((it) => it.el.classList.contains('ce-in')));
  return { el: wrap, items, focus };
}

/** character select's line: the moves in this fighter's slots, or null when both are empty */
export function loadoutLine(fighter) {
  injectStyle();
  const lo = loadout(fighter);
  if (!lo.some(Boolean)) return null;
  const box = el('div', 'ce-line');
  box.dataset.moves = lo.join(',');
  box.appendChild(el('b', '', 'MOVES'));
  box.appendChild(el('span', '', SLOTS.map((s, i) => `${s.input.replace(' ', '')} ${lo[i] ? moveInfo(lo[i]).name : '—'}`).join('  ·  ')));
  return box;
}

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('custom-style')) return;
  const css = `
  .ce-shelf { display: flex; flex-direction: column; gap: 0.6cqh; }
  .ce-sub { font: 600 1.5cqw/1.15 'Teko', sans-serif; letter-spacing: 0.08em; color: rgba(234,220,255,0.8); }
  .ce-slots { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2cqw; }
  #flow .ce-slot { min-width: 0; min-height: 0; padding: 0.6cqh 1cqw; display: flex; flex-direction: row; align-items: center; gap: 1.2cqw; text-align: left;
    border-radius: 0; border: 2px solid rgba(214,190,255,0.35); background: rgba(4,1,10,0.7); }
  #flow .ce-slot.ce-full { border-color: #ffb02e; }
  #flow .ce-slot canvas, #flow .ce-card canvas { position: static; inset: auto; width: auto; display: block; flex: none; }
  #flow .ce-slot canvas { height: 15cqh; }
  .ce-text { display: flex; flex-direction: column; gap: 0.4cqh; min-width: 0; }
  #flow .ce-key { font: 600 1.6cqw/1 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.04em; color: #ffc46b; }
  #flow .ce-name { font: 400 1.8cqw/1.1 'Bungee', sans-serif; color: #fff4d6; }
  #flow .ce-empty .ce-name { color: rgba(234,220,255,0.6); }
  #flow .ce-how, #flow .ce-from { font: 600 1.5cqw/1 'Teko', sans-serif; letter-spacing: 0.1em; color: rgba(234,220,255,0.85); }
  .ce-page { display: flex; flex-direction: column; gap: 1cqh; width: 92cqw; }
  .ce-phead { display: flex; justify-content: space-between; align-items: baseline; gap: 1em; flex-wrap: wrap; }
  .ce-phead b { font: 400 2.4cqw/1 'Bungee', sans-serif; color: #fff4d6; }
  .ce-phead span { font: 600 2cqw/1 'Teko', sans-serif; letter-spacing: 0.1em; color: #ffc46b; }
  .ce-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.8cqh 0.8cqw; padding: 1cqh 1cqw; border: 2px solid rgba(255,176,46,0.7); background: rgba(10,4,20,0.85);
    max-height: 62cqh; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; pointer-events: auto; touch-action: pan-y; }
  #flow .ce-card { min-width: 0; min-height: 0; padding: 0.5cqh 0.4cqw 0.4cqh; display: flex; flex-direction: column; align-items: center; gap: 0.3cqh; text-align: center;
    border-radius: 0; border: 2px solid rgba(214,190,255,0.35); background: rgba(4,1,10,0.6); }
  #flow .ce-card canvas { height: 11cqh; }
  #flow .ce-card .ce-text { align-items: center; }
  #flow .ce-card .ce-name { font-size: 1.35cqw; }
  #flow .ce-card .ce-how { color: #ffc46b; }
  #flow .ce-card.ce-in { border-color: #9dffc0; }
  #flow .ce-card.ce-in .ce-how { color: #9dffc0; }
  #flow .ce-card.ce-owned .ce-how { color: rgba(234,220,255,0.85); }
  #flow .ce-card.ce-short .ce-how { color: rgba(255,196,107,0.65); }
  .ce-line { display: flex; align-items: baseline; gap: 0.8cqw; font: 600 1.7cqw/1 'Teko', sans-serif; letter-spacing: 0.1em; color: #ffe0a8; }
  .ce-line b { color: #ffb02e; font-weight: 600; }
  /* px floors (a phone sideways has a stage about 390 px tall) */
  .ce-sub, #flow .ce-how, #flow .ce-from { font-size: max(12px, 1.5cqw); }
  #flow .ce-key { font-size: max(12px, 1.6cqw); } #flow .ce-name { font-size: max(13px, 1.8cqw); } #flow .ce-card .ce-name { font-size: max(12px, 1.35cqw); }
  .ce-phead b { font-size: max(15px, 2.4cqw); } .ce-phead span { font-size: max(13px, 2cqw); } .ce-line { font-size: max(13px, 1.7cqw); }
  /* short sideways phones: fewer, wider cards */
  @media (max-height: 520px) { .ce-grid { grid-template-columns: repeat(5, 1fr); max-height: 56cqh; } #flow .ce-card canvas { height: 13cqh; } }
  /* held upright: two to a row, the figure beside the words */
  #flow > .fl-up .ce-page { width: 100%; }
  #flow > .fl-up .ce-sub { font-size: max(12px, 3.3cqw); }
  #flow > .fl-up .ce-slots { grid-template-columns: 1fr; gap: 8px; }
  #flow > .fl-up .ce-slot { padding: 4px 2cqw; gap: 3cqw; }
  #flow > .fl-up .ce-slot canvas { height: max(64px, 8vh); }
  #flow > .fl-up .ce-key, #flow > .fl-up .ce-how, #flow > .fl-up .ce-from { font-size: max(12px, 3.4cqw); }
  #flow > .fl-up .ce-name { font-size: max(13px, 3.8cqw); }
  #flow > .fl-up .ce-phead b { font-size: max(15px, 4.4cqw); } #flow > .fl-up .ce-phead span { font-size: max(13px, 3.6cqw); }
  #flow > .fl-up .ce-grid { grid-template-columns: 1fr 1fr; gap: 8px; padding: 8px 3cqw; max-height: calc(100vh - 300px); }
  #flow > .fl-up .ce-card { flex-direction: row; justify-content: flex-start; gap: 2cqw; padding: 4px 2cqw; text-align: left; }
  #flow > .fl-up .ce-card canvas { height: max(56px, 7vh); }
  #flow > .fl-up .ce-card .ce-text { align-items: flex-start; }
  #flow > .fl-up .ce-card .ce-name { font-size: max(12px, 3.2cqw); }
  #flow > .fl-up .ce-line { font-size: max(13px, 3.4cqw); flex-wrap: wrap; }
  `;
  const st = document.createElement('style'); st.id = 'custom-style'; st.textContent = css;
  document.head.appendChild(st);
}
