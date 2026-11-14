// The SUPPLY CLOSET (README, Progression, The Supply Closet): every cosmetic each fighter has, off MAIN MENU.
// Owned items show in full; locked ones are a flat dark silhouette with exactly how to get them (150 STICKS,
// BARISTA MASTERY 3). Fixed prices, nothing random. A priced item is bought here with a confirm (the first press
// asks, the second buys) and an owned palette is put on here or at character select, the same pick either way
// (src/career/store.js equip). A count per fighter on its tab and one for the whole closet up top.
//
// Readable text never glows and fighters never glow (README, The look): the rigs are drawn plain, flat colors with
// no shadow, and every label inherits #flow's dark outline. Square corners. Held upright (.fl-up) the tabs and the
// shelf wrap to the phone's width and the cards go two to a row.
//
//   closetBody(o)   the screen's body for ui.show: { el, items, focus }
//     o.roster        the characters ({ id, name, color, pants, accent, body })
//     o.fighter       the fighter whose shelf is open
//     o.focusKey      'f:<id>' (a tab) or 'i:<key>' (an item): where the focus goes after a repaint
//     o.pick(id, focusKey)   open another fighter's shelf
//     o.repaint(focusKey, msg)   rebuild the screen after a buy or an equip, the line under it saying what happened
//     o.extras / o.ranks     the catalog's extra items and each fighter's mastery rank (catalog.js; tests set them)
//     o.openSlot(n)   open the CUSTOM EMPLOYEE page for this fighter's slot n (src/flow/customUI.js slotPage)
import { el, button } from './ui.js';
import { createFighter } from '../fighter/index.js';
import { itemsFor, unlockText, stateOf, completion, KINDS, EXTRAS } from '../career/catalog.js';
import { career, equipped, equip, buy, mastery, kit, setKit } from '../career/store.js';
import { upgradeShelf } from './upgradesUI.js';   // stat upgrades (README, Progression, Stat upgrades): not cosmetics, so not in the counts
import { slotShelf } from './customUI.js';   // the custom employee's move slots (README, Characters, Custom employee): not cosmetics either

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const SILHOUETTE = '#2a2140';   // a locked item: the figure filled flat, no colors to give it away

/** a fighter standing in its idle pose, drawn once into a canvas: flat colors, no glow. silhouette: one dark fill.
 *  clip: a clip to show instead (a victory pose, held at its end; a taunt, caught partway through) */
export function drawStanding(canvas, c, look = null, silhouette = false, clip = null, at = 2) {
  const rig = createFighter({ color: (look && look.body) || c.color, x: 0, y: 0, facing: 1, body: c.body });
  rig.pants = look ? look.pants : c.pants || null;
  rig.setBody(c.body, { accent: (look && look.accent) || c.accent });
  rig.speedLines = false;
  rig.charDef = c;
  for (let k = 0; k < 12; k++) rig.update(1 / 60);
  if (clip) { rig.play(clip); for (let t = 0; t < at; t += 1 / 60) rig.update(1 / 60); }
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.setTransform(h / 170, 0, 0, h / 170, w / 2, h * 0.94);
  rig.draw(ctx);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (silhouette) {
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = SILHOUETTE; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
}

/** @param {any} o */
export function closetBody(o) {
  injectStyle();
  // each fighter's mastery rank (src/career/mastery.js), unless a test hands its own
  const extras = o.extras || EXTRAS, ranks = o.ranks || Object.fromEntries(o.roster.map((r) => [r.id, mastery(r.id).rank]));
  const c = career();
  const ids = o.roster.map((r) => r.id);
  const done = completion(c, ids, { ranks, extras });
  const ch = o.roster.find((r) => r.id === o.fighter) || o.roster[0];
  const wrap = el('div', 'cl-body'), items = [];
  let focus = -1;

  // up top: the whole closet's count and the sticks to spend
  const head = el('div', 'cl-head');
  head.append(el('span', 'cl-total', `COLLECTED ${done.have} / ${done.total}`), el('span', 'cl-wallet', `${fmt(c.sticks)} STICKS TO SPEND`));
  wrap.appendChild(head);

  // the tabs: a fighter each, with what's collected of theirs
  const tabs = el('div', 'cl-tabs');
  tabs.dataset.scroll = 'y';
  for (const r of o.roster) {
    const per = done.per[r.id];
    const full = per.total > 0 && per.have === per.total;
    const b = button('', () => o.pick(r.id, `f:${r.id}`), `cl-tab${r.id === ch.id ? ' cl-on' : ''}${full ? ' cl-full' : ''}`);
    b.el.dataset.fighter = r.id;
    b.el.style.setProperty('--c', r.color);
    b.el.append(el('span', 'cl-tname', r.name), el('span', 'cl-tcount', `${per.have}/${per.total}`));
    tabs.appendChild(b.el);
    if (o.focusKey === `f:${r.id}`) focus = items.length;
    items.push(b);
  }
  wrap.appendChild(tabs);

  // the open fighter's shelf, one row per kind that has anything
  const list = itemsFor(ch.id, extras), rank = ranks[ch.id] || 0;
  const wearing = equipped(ch.id), on = kit(ch.id);
  const shelf = el('div', 'cl-shelf');
  shelf.dataset.scroll = 'y';   // sideways and on a desktop the shelf scrolls in its own box, so the tabs and the head stay put
  const per = done.per[ch.id];
  const title = el('div', 'cl-stitle');
  title.append(el('b', '', ch.name), el('span', '', `${per.have} OF ${per.total} COLLECTED${rank ? `  ·  MASTERY ${rank}` : ''}`));
  shelf.appendChild(title);
  let armed = '';
  for (const k of KINDS) {
    const row = list.filter((it) => it.kind === k.kind);
    if (!row.length) continue;
    const have = row.filter((it) => !it.main && stateOf(it, c, rank) === 'owned').length, of = row.filter((it) => !it.main).length;
    shelf.appendChild(el('div', 'cl-kind', `${k.label}  ${have} / ${of}`));
    const cards = el('div', 'cl-cards');
    for (const it of row) {
      const st = stateOf(it, c, rank);
      const locked = st === 'buy' || st === 'short' || st === 'rank';
      const using = it.kind === 'palette' ? (it.main ? !wearing : !!wearing && wearing.id === it.id)
        : (it.kind === 'pose' && st === 'owned' && on.pose) || (it.kind === 'taunt' && st === 'owned' && on.taunt);
      const card = button('', () => press(it, st), `cl-card cl-${st}${using ? ' cl-using' : ''}`);
      card.el.dataset.item = it.key || `${ch.id}:main`;
      card.el.dataset.state = st;
      const cv = document.createElement('canvas'); cv.width = 120; cv.height = 180;
      // a pose card shows the pose held, a taunt card a moment of it (the character's own clips, registry victory / taunt)
      const clip = it.kind === 'pose' ? ch.victory : it.kind === 'taunt' ? ch.taunt : null;
      drawStanding(cv, ch, it.look || null, locked, clip, it.kind === 'taunt' ? 0.45 : 2);
      const tag = using ? 'IN USE' : st === 'main' ? 'ITS OWN LOOK' : st === 'owned' ? (it.kind === 'palette' || it.kind === 'pose' || it.kind === 'taunt' ? 'OWNED · PUT ON' : 'OWNED') : unlockText(it, ch.name);
      const txt = el('div', 'cl-text');
      txt.append(el('b', 'cl-name', locked ? 'LOCKED' : it.name), el('span', 'cl-how', tag));
      card.el.append(cv, txt);
      if (locked) card.el.setAttribute('aria-label', `${it.name}, locked: ${unlockText(it, ch.name)}`);
      cards.appendChild(card.el);
      if (o.focusKey === `i:${card.el.dataset.item}`) focus = items.length;
      items.push(card);
    }
    shelf.appendChild(cards);
  }
  // the custom employee's two move slots, after the looks (a press opens the slot's page of moves to buy and slot)
  const ce = slotShelf({ fighter: ch, focusKey: o.focusKey, open: (n) => o.openSlot && o.openSlot(n) });
  if (ce.focus >= 0) focus = items.length + ce.focus;
  items.push(...ce.items);
  shelf.appendChild(ce.el);
  // stat upgrades: after the looks, their own section with its own count (the COLLECTED numbers are cosmetics only)
  const ups = upgradeShelf({ fighter: ch, focusKey: o.focusKey, repaint: o.repaint, note: o.note });
  if (ups.focus >= 0) focus = items.length + ups.focus;
  items.push(...ups.items);
  shelf.appendChild(ups.el);
  wrap.appendChild(shelf);

  /** a press on an item card: put it on, buy it (press twice), or say how to get it */
  async function press(it, st) {
    const fk = `i:${it.key || `${ch.id}:main`}`;
    if (st === 'main' || st === 'owned') {
      if (it.kind === 'pose' || it.kind === 'taunt') {
        // fighter mastery's pose and taunt: a press switches it on or off (off: the dance, or no taunt)
        const now = !(it.kind === 'pose' ? on.pose : on.taunt);
        setKit(ch.id, it.kind, now);
        o.repaint(fk, now ? `${ch.name} WILL ${it.kind === 'pose' ? 'STRIKE' : 'DO'} ${it.name}` : `${it.name} PUT AWAY  ·  ${it.kind === 'pose' ? 'THE USUAL DANCE' : 'NO TAUNT'}`);
        return;
      }
      if (it.kind !== 'palette') { o.note(`${it.name}  ·  IN YOUR CLOSET`); return; }
      equip(ch.id, it.id);
      o.repaint(fk, `${ch.name} IS WEARING ${it.name}`);
      return;
    }
    if (st === 'rank') { o.note(`${it.name} UNLOCKS AT ${unlockText(it, ch.name)}. PLAY ${ch.name} TO GET THERE.`); return; }
    const have = career().sticks;
    if (st === 'short' || have < (it.price || 0)) { armed = ''; o.note(`${it.name} COSTS ${fmt(it.price)} STICKS  ·  YOU HAVE ${fmt(have)}`); return; }
    if (armed !== it.key) { armed = it.key; o.note(`BUY ${it.name} FOR ${fmt(it.price)} STICKS? PRESS AGAIN`); return; }
    armed = '';
    o.note('BUYING…');
    const r = await buy(ch.id, it.id);
    if (r.error) { o.repaint(fk, r.error === 'short' ? `NOT ENOUGH STICKS FOR ${it.name}` : r.error === 'busy' ? 'SERVER BUSY: TRY AGAIN SHORTLY' : "CAN'T REACH THE SERVER: NOTHING WAS SPENT"); return; }
    o.repaint(fk, `BOUGHT ${it.name}  ·  ${ch.name} IS WEARING IT`);
  }

  if (focus < 0) focus = items.findIndex((it) => it.el.classList.contains('cl-on'));
  return { el: wrap, items, focus: Math.max(0, focus) };
}

function injectStyle() {
  if (document.getElementById('closet-style')) return;
  const css = `
  .cl-body { display: flex; flex-direction: column; gap: 1cqh; width: 92cqw; }
  .cl-head { display: flex; justify-content: space-between; align-items: baseline; font: 600 2.2cqw/1 'Teko', sans-serif; letter-spacing: 0.12em; }
  .cl-total { color: #fff4d6; } .cl-wallet { color: #ffc46b; }
  .cl-tabs { display: grid; grid-template-columns: repeat(9, 1fr); gap: 0.6cqh 0.6cqw; }
  #flow .cl-tab { min-width: 0; min-height: 44px; padding: 0.4cqh 0.4cqw 0.1cqh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.2cqh;
    border-radius: 0; border: 2px solid rgba(214,190,255,0.35); background: rgba(10,4,20,0.85); color: #eadcff; font: 600 1.5cqw/1 'Teko', sans-serif; letter-spacing: 0.06em; }
  #flow .cl-tab .cl-tname { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; color: var(--c); }
  #flow .cl-tab .cl-tcount { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 1.3cqw; color: rgba(234,220,255,0.8); }
  #flow .cl-tab.cl-full .cl-tcount { color: #9dffc0; }
  #flow .cl-tab.cl-on { border-color: #ffb02e; background: rgba(255,176,46,0.16); }
  #flow .fl-screen:not(.fl-up) .cl-shelf { max-height: 60cqh; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; pointer-events: auto; touch-action: pan-y; }
  .cl-shelf { display: flex; flex-direction: column; gap: 0.6cqh; padding: 1cqh 1.4cqw; border: 2px solid rgba(255,176,46,0.7); background: rgba(10,4,20,0.85); }
  .cl-stitle { display: flex; align-items: baseline; gap: 1.6cqw; }
  .cl-stitle b { font: 400 2.4cqw/1 'Bungee', sans-serif; color: #fff4d6; }
  .cl-stitle span, .cl-kind { font: 600 1.8cqw/1 'Teko', sans-serif; letter-spacing: 0.14em; color: rgba(255,224,168,0.9); }
  .cl-cards { display: flex; gap: 1.2cqw; }
  #flow .cl-card { flex: 1 1 0; min-width: 0; min-height: 0; padding: 0.6cqh 0.6cqw 0.4cqh; display: flex; flex-direction: column; align-items: center; gap: 0.3cqh;
    border-radius: 0; border: 2px solid rgba(214,190,255,0.35); background: rgba(4,1,10,0.6); }
  #flow .cl-card canvas { position: static; inset: auto; width: auto; height: 17cqh; display: block; flex: none; }   /* not #stage canvas's full-bleed layer */
  #flow .cl-card .cl-text { display: flex; flex-direction: column; align-items: center; gap: 0.3cqh; text-align: center; }
  #flow .cl-card .cl-name { font: 400 1.6cqw/1.1 'Bungee', sans-serif; color: #fff4d6; }
  #flow .cl-card .cl-how { font: 600 1.6cqw/1 'Teko', sans-serif; letter-spacing: 0.1em; color: #ffc46b; }
  #flow .cl-card.cl-owned .cl-how, #flow .cl-card.cl-main .cl-how { color: rgba(234,220,255,0.8); }
  #flow .cl-card.cl-using { border-color: #9dffc0; }
  #flow .cl-card.cl-using .cl-how { color: #9dffc0; }
  #flow .cl-card.cl-buy, #flow .cl-card.cl-short, #flow .cl-card.cl-rank { background: rgba(4,1,10,0.8); }
  #flow .cl-card.cl-buy .cl-name, #flow .cl-card.cl-short .cl-name, #flow .cl-card.cl-rank .cl-name { color: rgba(234,220,255,0.6); }
  #flow .cl-card.cl-short .cl-how { color: rgba(255,196,107,0.65); }
  #flow .cl-card.cl-rank .cl-how { color: #c9b8ff; }
  .cl-note { min-height: 1.2em; color: #fff4d6; }
  /* held upright: the tabs wrap three to a row and scroll, the cards go two to a row */
  #flow > .fl-up .cl-body { width: 100%; gap: max(6px, 1cqh); }
  /* px floors: a phone held sideways has a stage about 390 px tall (1cqw about 7 px) */
  .cl-head { font-size: max(13px, 2.2cqw); } #flow .cl-tab { font-size: max(12px, 1.5cqw); } #flow .cl-tab .cl-tcount { font-size: max(12px, 1.3cqw); }
  .cl-stitle b { font-size: max(15px, 2.4cqw); } .cl-stitle span, .cl-kind { font-size: max(12px, 1.8cqw); }
  #flow .cl-card .cl-name { font-size: max(12px, 1.6cqw); } #flow .cl-card .cl-how { font-size: max(12px, 1.6cqw); }
  #flow > .fl-up .cl-head { font-size: max(13px, 4cqw); flex-wrap: wrap; gap: 0.4em 1em; }
  #flow > .fl-up .cl-tabs { grid-template-columns: repeat(3, 1fr); max-height: 25vh; overflow-y: auto; gap: 6px; }
  #flow > .fl-up .cl-tab { font-size: max(13px, 3.8cqw); min-height: 44px; }
  #flow > .fl-up .cl-tab .cl-tcount { font-size: max(12px, 3.2cqw); }
  #flow > .fl-up .cl-shelf { padding: 8px 3cqw; gap: 6px; max-height: calc(100vh - 380px); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; pointer-events: auto; touch-action: pan-y; }   /* scrolls in its own box under the tabs (the stat upgrades sit at its foot) */
  #flow > .fl-up .cl-stitle { flex-wrap: wrap; gap: 0.3em 1em; }
  #flow > .fl-up .cl-stitle b { font-size: max(15px, 5cqw); }
  #flow > .fl-up .cl-stitle span, #flow > .fl-up .cl-kind { font-size: max(12px, 3.6cqw); }
  #flow > .fl-up .cl-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  #flow > .fl-up .cl-card { flex-direction: row; justify-content: flex-start; gap: 2cqw; padding: 4px 2cqw; min-height: 64px; }
  #flow > .fl-up .cl-card canvas { height: max(56px, 7vh); }
  #flow > .fl-up .cl-card .cl-text { align-items: flex-start; text-align: left; min-width: 0; }
  #flow > .fl-up .cl-card .cl-name { font-size: max(12px, 3.2cqw); }
  #flow > .fl-up .cl-card .cl-how { font-size: max(12px, 3.4cqw); }
  `;
  const st = document.createElement('style'); st.id = 'closet-style'; st.textContent = css;
  document.head.appendChild(st);
}
