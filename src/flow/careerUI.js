// The career on screen (README, Progression): the earnings panel on the result screens, the sticks counter on the
// menus, the save-your-sticks nudge, and the job title next to a name. All of it is text a player reads, so none of
// it glows (README, "The look"): solid colors inside the shared dark outline (#flow's --plain). Square corners.
//
//   earningsPanel()        the latest award (src/career/store.js last()): PROMOTED: MANAGER when it was a promotion,
//                          one line per thing that paid (BASE, PARRIES ×3, FIRST WIN TODAY...), and the performance
//                          review bar. It follows the award as it settles (a signed-in player's comes from the server).
//                          null when nothing was paid.
//   createCounter(root)    the sticks and title chip for the menus: .show(on)
//   nudgeBlock(onSave)     the save prompt for a guest with something to lose: { el, button } or null
//   withTitle(name, title) 'SP · MANAGER'
import { el, button } from './ui.js';
import { career, last, onCareer, nudgeDue, nudgeShown } from '../career/store.js';
import { titleFor, lineText } from '../career/rules.js';

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const signed = (n) => (n < 0 ? `−${fmt(-n)}` : `+${fmt(n)}`);
export const withTitle = (name, title) => (title ? `${name} · ${title}` : name);

/** The review bar: the title, the bar to the next one, what's next */
export function reviewBar(xp, cls = '') {
  injectStyle();
  const t = titleFor(xp);
  const box = el('div', `cr-review ${cls}`);
  const head = el('div', 'cr-rhead');
  head.append(el('b', 'cr-title', t.title), el('span', 'cr-rlabel', t.next ? `PERFORMANCE REVIEW  ${fmt(t.into)} / ${fmt(t.span)} XP` : `TOP OF THE LADDER  ${fmt(xp)} XP`));
  const bar = el('div', 'cr-bar');
  const fill = el('i');
  fill.style.width = `${t.next ? Math.round((100 * t.into) / t.span) : 100}%`;
  bar.appendChild(fill);
  box.append(head, bar);
  if (t.next) box.appendChild(el('div', 'cr-next', `NEXT: ${t.next}`));
  return box;
}

/** The latest award, as a panel for a result screen; null when the match paid nothing. compact: the lines in one
 *  wrapping row (a screen with a lot on it already: CONTINUE?, the online post-match screen). */
export function earningsPanel(compact = false) {
  injectStyle();
  const a = last();
  if (!a || !a.award || !a.award.lines.length || Date.now() - a.at > 10 * 60 * 1000) return null;
  const box = el('div', compact ? 'cr-earn cr-compact' : 'cr-earn');
  const paint = () => {
    const cur = last();
    if (!cur) return;
    box.textContent = '';
    if (cur.promoted) {
      const p = el('div', 'cr-promo');
      p.append(el('span', '', 'PROMOTED'), el('b', '', cur.promoted));
      box.appendChild(p);
    }
    if (compact) {
      const row = el('div', 'cr-row');
      for (const l of cur.award.lines) {
        const daily = l.id === 'firstWin' || l.id === 'firstOnline', cap = l.id === 'cap';
        row.appendChild(el('span', daily ? 'cr-daily' : cap ? 'cr-cap' : '', `${lineText(l)} ${signed(l.sticks)}`));
      }
      box.append(row, el('div', 'cr-sum', `EARNED ${signed(cur.award.sticks)} STICKS  ·  ${signed(cur.award.xp)} XP`));
    } else {
      const grid = el('div', 'cr-lines');
      grid.append(el('span', 'cr-h', 'EARNED'), el('span', 'cr-h cr-num', 'XP'), el('span', 'cr-h cr-num', 'STICKS'));
      for (const l of cur.award.lines) {
        const daily = l.id === 'firstWin' || l.id === 'firstOnline', cap = l.id === 'cap';
        grid.append(el('span', daily ? 'cr-daily' : cap ? 'cr-cap' : '', lineText(l)), el('span', 'cr-num', signed(l.xp)), el('span', 'cr-num cr-st', signed(l.sticks)));
      }
      grid.append(el('span', 'cr-tot', 'TOTAL'), el('span', 'cr-num cr-tot', signed(cur.award.xp)), el('span', 'cr-num cr-st cr-tot', signed(cur.award.sticks)));
      box.appendChild(grid);
    }
    if (cur.award.firstWin) box.appendChild(el('div', 'cr-note', "YOUR FIRST WIN TODAY PAYS EXTRA. IT'S BACK TOMORROW."));
    else if (cur.award.firstOnline) box.appendChild(el('div', 'cr-note', 'YOUR FIRST ONLINE MATCH TODAY PAYS EXTRA.'));
    if (cur.award.capped) box.appendChild(el('div', 'cr-note', 'ARCADE AND HORDE HAVE PAID ALL THEY CAN TODAY. ONLINE STILL PAYS.'));
    const c = career();
    box.appendChild(reviewBar(c.xp));
    box.appendChild(el('div', 'cr-wallet', `${fmt(c.sticks)} STICKS${cur.pending ? '  ·  SAVING…' : ''}`));
  };
  paint();
  // a signed-in player's award settles when the server answers: repaint while the panel is on screen
  const off = onCareer(() => { if (!box.isConnected) { off(); return; } paint(); });
  return box;
}

/** the sticks and title chip for the menus (the flow shows it on menu screens, never in a fight) */
export function createCounter(root) {
  injectStyle();
  const chip = el('div', 'cr-chip');
  chip.setAttribute('aria-live', 'polite');
  const paint = () => { const c = career(); chip.textContent = ''; chip.append(el('b', '', `${fmt(c.sticks)} STICKS`), el('span', '', c.title)); };
  paint();
  onCareer(paint);
  root.appendChild(chip);
  return { el: chip, show(on) { chip.classList.toggle('cr-on', !!on); if (on) paint(); } };
}

/** A guest with something to lose: the prompt, and a SAVE MY PROFILE button for the screen's items. null when not due. */
export function nudgeBlock(onSave) {
  if (!nudgeDue()) return null;
  injectStyle();
  const c = career();
  const box = el('div', 'cr-nudge');
  box.append(el('div', '', `YOU'VE GOT ${fmt(c.sticks)} STICKS AND YOU'RE ${/^[AEIOU]/.test(c.title) ? 'AN' : 'A'} ${c.title}.`),
    el('div', 'cr-nsub', "SAVE MY PROFILE SO YOU DON'T LOSE THEM. IT'S ONE EMAIL, NO PASSWORD."));
  nudgeShown();
  return { el: box, button: button('SAVE MY PROFILE', onSave, 'fl-amber fl-slim') };
}

/** the earned-sticks summary for a screen that has no room for the whole panel */
export function walletLine() {
  const c = career();
  return el('div', 'fl-small cr-walletline', `${fmt(c.sticks)} STICKS  ·  ${c.title}`);
}

function injectStyle() {
  if (document.getElementById('career-style')) return;
  const css = `
  .cr-earn { display: flex; flex-direction: column; align-items: stretch; gap: 0.8cqh; min-width: 40cqw; padding: 1cqh 1.6cqw;
    border: 2px solid rgba(255,176,46,0.7); background: rgba(10,4,20,0.82); }
  .cr-promo { display: flex; align-items: baseline; justify-content: center; gap: 1.4cqw; animation: cr-stamp 520ms cubic-bezier(.2,1.6,.4,1) both; }
  .cr-promo span { font: 600 2.4cqw/1 'Teko', sans-serif; letter-spacing: 0.16em; color: #ffe0a8; }
  .cr-promo b { font: 400 3.6cqw/1 'Bungee', sans-serif; color: #fff4d6; }
  @keyframes cr-stamp { 0% { transform: scale(2.2); opacity: 0; } 60% { opacity: 1; } 100% { transform: scale(1); } }
  .cr-lines { display: grid; grid-template-columns: 1fr auto auto; column-gap: 2.4cqw; row-gap: 0.1cqh; font: 600 2.2cqw/1.1 'Teko', sans-serif; letter-spacing: 0.08em; color: #eadcff; }
  .cr-lines .cr-h { font-size: 1.6cqw; color: rgba(214,190,255,0.7); letter-spacing: 0.14em; }
  .cr-lines .cr-num { text-align: right; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 1.9cqw; font-variant-numeric: tabular-nums; }
  .cr-lines .cr-st { color: #ffc46b; }
  .cr-lines .cr-daily { color: #9dffc0; }
  .cr-lines .cr-cap { color: rgba(214,190,255,0.7); }
  .cr-lines .cr-tot { border-top: 2px solid rgba(255,176,46,0.45); padding-top: 0.3cqh; color: #fff; }
  .cr-lines .cr-st.cr-tot { color: #ffc46b; }
  .cr-earn.cr-compact { padding: 0.6cqh 1.4cqw; gap: 0.5cqh; max-width: 70cqw; }
  .cr-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.3cqh 1.6cqw; font: 600 2cqw/1.1 'Teko', sans-serif; letter-spacing: 0.08em; color: #eadcff; }
  .cr-row .cr-daily { color: #9dffc0; } .cr-row .cr-cap { color: rgba(214,190,255,0.7); }
  .cr-sum { font: 600 2.2cqw/1 'Teko', sans-serif; letter-spacing: 0.1em; color: #ffc46b; text-align: center; }
  .cr-note { font: 500 1.7cqw/1.1 'Teko', sans-serif; letter-spacing: 0.1em; color: #9dffc0; text-align: center; }
  .cr-review { display: flex; flex-direction: column; gap: 0.4cqh; }
  .cr-rhead { display: flex; justify-content: space-between; align-items: baseline; gap: 2cqw; }
  .cr-title { font: 400 2.2cqw/1 'Bungee', sans-serif; color: #fff4d6; }
  .cr-rlabel, .cr-next { font: 500 1.6cqw/1 'Teko', sans-serif; letter-spacing: 0.12em; color: rgba(230,214,255,0.8); }
  .cr-next { text-align: right; }
  .cr-bar { height: max(6px, 1.1cqh); border: 2px solid rgba(255,176,46,0.6); background: rgba(255,176,46,0.08); }
  .cr-bar i { display: block; height: 100%; background: #ffb02e; transition: width 600ms ease-out; }
  .cr-wallet { font: 600 2cqw/1 'Teko', sans-serif; letter-spacing: 0.12em; color: #ffc46b; text-align: center; }
  .cr-nudge { max-width: 60cqw; padding: 0.8cqh 1.6cqw; border: 2px solid #ffb02e; background: rgba(10,4,20,0.82);
    font: 600 2.2cqw/1.15 'Teko', sans-serif; letter-spacing: 0.08em; color: #fff4d6; text-align: center; }
  .cr-nudge .cr-nsub { font-size: 1.8cqw; font-weight: 500; color: rgba(230,214,255,0.86); }
  .cr-walletline { color: #ffc46b; }
  .fl-pcareer { width: 46cqw; display: flex; flex-direction: column; gap: 0.6cqh; }
  /* the menus' counter: top right, under the corner buttons' row, plain text */
  .cr-chip { position: absolute; z-index: 4; left: 1.2cqw; top: 1.2cqh; display: none; align-items: baseline; gap: 1cqw; padding: 0.3cqh 1cqw 0;
    border: 2px solid rgba(255,176,46,0.7); background: rgba(10,4,20,0.78); pointer-events: none;
    font: 600 2cqw/1.2 'Teko', 'Arial Narrow', sans-serif; letter-spacing: 0.1em; color: #ffc46b; text-shadow: var(--plain); }
  .cr-chip span { color: #eadcff; font-size: 1.7cqw; }
  .cr-chip.cr-on { display: flex; }
  /* held upright the stage is short: everything a size up so it stays readable */
  @container (max-aspect-ratio: 1/1) { .cr-lines { font-size: 3.4cqw; } .cr-lines .cr-num { font-size: 3cqw; } .cr-chip { font-size: 3.4cqw; } .cr-chip span { font-size: 3cqw; } }
  `;
  const st = document.createElement('style'); st.id = 'career-style'; st.textContent = css;
  document.head.appendChild(st);
}
export function ensureStyle() { if (typeof document !== 'undefined') injectStyle(); }
