// Stat upgrades on screen (README, Progression, Stat upgrades): the SUPPLY CLOSET's STAT UPGRADES shelf, character
// select's line, the UP tag on score tables and the line that explains it. Text to read, so nothing glows; square
// corners, a full outline. Prices are fixed and shown on every card before anything is pressed, and a buy takes two
// presses like a palette. No timers, no "limited", no nagging: a maxed stat just says MAXED.
//
//   upgradeShelf(o)        the closet's shelf section: { el, items }. o: { fighter: { id, name }, focusKey, repaint(fk, msg), note(msg) }
//   upgradesLine(fighter)  character select's line: UPGRADES  HEALTH 2 · POWER 1 (or NONE YET · SUPPLY CLOSET)
//   upTag()                the UP chip beside a score set with upgrades
//   UP_KEY                 the one line that says what UP means, under any table that shows one
import { el, button } from './ui.js';
import { career, upgrades, buyUpgrade } from '../career/store.js';
import { STATS, MAX_TIER, nextTier, pctOf, tiersOwned } from '../career/upgrades.js';

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
export const UP_KEY = 'UP: A SCORE SET WITH STAT UPGRADES FROM THE SUPPLY CLOSET';

/** the UP chip for a score row */
export function upTag() {
  injectStyle();
  const t = el('i', 'up-tag', 'UP');
  t.title = 'Set with stat upgrades';
  return t;
}

/** three square pips, the owned tiers filled */
function pips(n) {
  const p = el('span', 'up-pips');
  for (let i = 0; i < MAX_TIER; i++) p.appendChild(el('i', i < n ? 'up-on' : ''));
  return p;
}

/** character select's line for a fighter: what's upgraded, or where to get it */
export function upgradesLine(fighter) {
  injectStyle();
  const lv = upgrades(fighter), n = tiersOwned(lv);
  const box = el('div', 'up-line');
  box.dataset.tiers = String(n);
  box.appendChild(el('b', '', 'UPGRADES'));
  const on = STATS.filter((s) => lv[s.id] > 0);
  box.appendChild(el('span', '', on.length ? on.map((s) => `${s.name} ${lv[s.id]}`).join('  ·  ') : 'NONE YET  ·  SUPPLY CLOSET'));
  return box;
}

/**
 * The closet's STAT UPGRADES section for one fighter: a card per stat with its pips, what it adds now, and the next
 * tier's price. First press asks, second buys. Arcade, horde and training use them; versus never does unless the
 * host picks UPGRADES: EVEN, which gives both fighters everything.
 * @param {{ fighter: { id: string, name: string }, focusKey: string, repaint: (fk: string, msg: string) => void, note: (msg: string) => void }} o
 */
export function upgradeShelf(o) {
  injectStyle();
  const ch = o.fighter, lv = upgrades(ch.id), owned = career().owned;
  const wrap = el('div', 'up-shelf'), items = [];
  let focus = -1;
  wrap.appendChild(el('div', 'cl-kind', `STAT UPGRADES  ${tiersOwned(lv)} / ${STATS.length * MAX_TIER}`));
  wrap.appendChild(el('div', 'up-sub', 'ARCADE, HORDE AND TRAINING. NEVER AGAINST A PERSON UNLESS THE HOST PICKS UPGRADES: EVEN, WHICH GIVES BOTH FIGHTERS EVERYTHING.'));
  const cards = el('div', 'up-cards');
  let armed = '';
  for (const s of STATS) {
    const t = lv[s.id], nx = nextTier(owned, ch.id, s.id);
    const short = !!nx && career().sticks < nx.price;
    const card = button('', () => press(s), `up-card${nx ? (short ? ' up-short' : ' up-buy') : ' up-max'}`);
    card.el.dataset.stat = s.id;
    card.el.dataset.tier = String(t);
    const head = el('div', 'up-head');
    head.append(el('b', 'up-name', s.name), pips(t));
    const now = el('span', 'up-now', t ? `+${pctOf(s.id, t)}%  ·  ${s.what}` : s.what);
    const how = el('span', 'up-how', nx ? `TIER ${nx.tier}: +${pctOf(s.id, nx.tier)}% FOR ${fmt(nx.price)} STICKS` : 'MAXED');
    card.el.append(head, now, how);
    card.el.setAttribute('aria-label', `${s.name}, tier ${t} of ${MAX_TIER}${nx ? `, next tier ${fmt(nx.price)} sticks` : ', maxed'}`);
    cards.appendChild(card.el);
    if (o.focusKey === `u:${s.id}`) focus = items.length;
    items.push(card);
  }
  wrap.appendChild(cards);

  async function press(s) {
    const fk = `u:${s.id}`;
    const nx = nextTier(career().owned, ch.id, s.id);
    if (!nx) { armed = ''; o.note(`${ch.name}'S ${s.name} IS MAXED`); return; }
    const have = career().sticks;
    if (have < nx.price) { armed = ''; o.note(`${s.name} TIER ${nx.tier} COSTS ${fmt(nx.price)} STICKS  ·  YOU HAVE ${fmt(have)}`); return; }
    const key = `${ch.id}:${s.id}:${nx.tier}`;
    if (armed !== key) { armed = key; o.note(`BUY ${s.name} TIER ${nx.tier} (+${pctOf(s.id, nx.tier)}%) FOR ${fmt(nx.price)} STICKS? PRESS AGAIN`); return; }
    armed = '';
    o.note('BUYING…');
    const r = await buyUpgrade(ch.id, s.id);
    if (r.error) { o.repaint(fk, r.error === 'short' ? `NOT ENOUGH STICKS FOR ${s.name}` : r.error === 'busy' ? 'SERVER BUSY: TRY AGAIN SHORTLY' : r.error === 'maxed' || r.error === 'owned' ? `${s.name} IS ALREADY THAT HIGH` : "CAN'T REACH THE SERVER: NOTHING WAS SPENT"); return; }
    o.repaint(fk, `BOUGHT ${s.name} TIER ${r.tier}  ·  ${ch.name} HAS +${pctOf(s.id, r.tier || 0)}% IN ARCADE, HORDE AND TRAINING`);
  }
  return { el: wrap, items, focus };
}

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('upgrades-style')) return;
  const css = `
  #flow .up-tag { display: inline-block; margin-left: 0.5em; padding: 0.05em 0.35em 0; font: 600 0.62em/1.1 'JetBrains Mono', ui-monospace, monospace; font-style: normal;
    letter-spacing: 0.08em; color: #9dffc0; border: 1.5px solid #9dffc0; border-radius: 0; vertical-align: 0.12em; text-shadow: none; }
  .up-key { color: rgba(234,220,255,0.85); }
  .up-line { display: flex; align-items: baseline; gap: 0.8cqw; font: 600 1.7cqw/1 'Teko', sans-serif; letter-spacing: 0.12em; color: #ffe0a8; margin-top: 0.4cqh; }
  .up-line b { color: #9dffc0; font-weight: 600; }
  .up-shelf { display: flex; flex-direction: column; gap: 0.6cqh; }
  .up-sub { font: 600 1.5cqw/1.15 'Teko', sans-serif; letter-spacing: 0.08em; color: rgba(234,220,255,0.8); }
  .up-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.2cqw; }
  #flow .up-card { min-width: 0; min-height: 0; padding: 0.8cqh 0.8cqw; display: flex; flex-direction: column; align-items: flex-start; gap: 0.5cqh; text-align: left;
    border-radius: 0; border: 2px solid rgba(214,190,255,0.35); background: rgba(4,1,10,0.7); }
  #flow .up-card .up-head { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 0.6cqw; }
  #flow .up-card .up-name { font: 400 1.6cqw/1.1 'Bungee', sans-serif; color: #fff4d6; }
  .up-pips { display: inline-flex; gap: 0.3cqw; }
  .up-pips i { display: block; width: 0.9cqw; height: 0.9cqw; min-width: 8px; min-height: 8px; border: 1.5px solid #9dffc0; }
  .up-pips i.up-on { background: #9dffc0; }
  #flow .up-card .up-now { font: 600 1.5cqw/1.1 'Teko', sans-serif; letter-spacing: 0.08em; color: rgba(234,220,255,0.85); }
  #flow .up-card .up-how { font: 600 1.6cqw/1 'Teko', sans-serif; letter-spacing: 0.1em; color: #ffc46b; }
  #flow .up-card.up-short .up-how { color: rgba(255,196,107,0.65); }
  #flow .up-card.up-max { border-color: #9dffc0; }
  #flow .up-card.up-max .up-how { color: #9dffc0; }
  /* px floors (a phone sideways has a stage about 390 px tall) */
  .up-line { font-size: max(13px, 1.7cqw); } .up-sub { font-size: max(12px, 1.5cqw); }
  #flow .up-card .up-name { font-size: max(12px, 1.6cqw); } #flow .up-card .up-now, #flow .up-card .up-how { font-size: max(12px, 1.5cqw); }
  #flow > .fl-up .up-cards { grid-template-columns: 1fr 1fr; gap: 8px; }
  #flow > .fl-up .up-card { padding: 6px 2cqw; }
  #flow > .fl-up .up-card .up-name { font-size: max(12px, 3.2cqw); }
  #flow > .fl-up .up-card .up-now, #flow > .fl-up .up-card .up-how, #flow > .fl-up .up-sub { font-size: max(12px, 3.3cqw); }
  #flow > .fl-up .up-line { font-size: max(13px, 3.4cqw); flex-wrap: wrap; }
  `;
  const st = document.createElement('style'); st.id = 'upgrades-style'; st.textContent = css;
  document.head.appendChild(st);
}
