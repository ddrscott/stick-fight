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
//   shiftsBlock()          today's three shifts with their ticks, for the main menu (src/career/shifts.js), under
//                          the PTO line when some is banked
//   shiftCards(opts)       the SHIFTS screen's body: one card per shift (what it teaches, a coaching line, the ticks,
//                          what it pays) with HOW TO PLAY and SWAP buttons; returns { el, items }
//   shiftTicks(moved, compact)  the result screen's progress row (earningsPanel adds it)
//   masteryBlock(m, compact)    fighter mastery on the result screen (earningsPanel adds it): BARISTA MASTERY 2, the
//                          XP it paid (NEW HIRE apart), the bar to the next rank, and what a new rank unlocked
//   ptoText(bank, back)    the menu's PTO line: WELCOME BACK: YOUR NEXT 3 MATCHES PAY DOUBLE XP ('' with none banked)
//   ptoBlock()             that line as a block for the main menu (src/career/rules.js PTO); repaints with the career
//   profileCard(p, act)    MAIN MENU's PROFILE button: the name, the job title, the review bar and the XP to the next
//                          title, and SAVE MY PROFILE for a guest; { el, act }
//   masteryChip(fighter)   character select's line: MASTERY 2 with five pips, NEW HIRE BONUS while it pays
import { el, button } from './ui.js';
import { career, last, onCareer, nudgeDue, nudgeShown, todayShifts, swapToday, mastery, pto } from '../career/store.js';
import { MAX_RANK, NEW_HIRE } from '../career/mastery.js';
import { characterOr } from '../characters/index.js';
import { SHIFT_PAY } from '../career/shifts.js';
import { rootUrl } from '../root.js';
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

/** MAIN MENU's PROFILE button (README, Progression, On screen): who you are and how far up the ladder, big enough to
 *  read across the room. p: the profile (src/net/profile.js). A guest's says SAVE MY PROFILE, the reason to sign up. */
export function profileCard(p, act) {
  injectStyle();
  const c = career(), t = titleFor(c.xp);
  const b = button('', act, 'fl-pcard');
  const top = el('span', 'pc-top');
  top.append(el('b', 'pc-name', p.name || 'NO NAME YET'), el('span', 'pc-title', t.title));
  const bar = el('span', 'pc-bar'), fill = el('i');
  fill.style.width = `${t.next ? Math.round((100 * t.into) / t.span) : 100}%`;
  bar.appendChild(fill);
  const xp = el('span', 'pc-xp', t.next ? `${fmt(t.into)} / ${fmt(t.span)} XP TO ${t.next}` : `TOP OF THE LADDER  ${fmt(c.xp)} XP`);
  const tag = el('span', p.email ? 'pc-tag' : 'pc-tag pc-save', p.email ? 'PROFILE ›' : 'SAVE MY PROFILE ›');
  b.el.append(top, bar, xp, tag);
  b.el.setAttribute('aria-label', `PROFILE: ${p.name || 'NO NAME YET'}, ${t.title}`);
  return b;
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
        const daily = l.id === 'firstWin' || l.id === 'firstOnline' || l.id === 'shift' || l.id === 'pto', cap = l.id === 'cap';
        row.appendChild(el('span', daily ? 'cr-daily' : cap ? 'cr-cap' : '', `${lineText(l)} ${signed(l.sticks)}`));
      }
      box.append(row, el('div', 'cr-sum', `EARNED ${signed(cur.award.sticks)} STICKS  ·  ${signed(cur.award.xp)} XP`));
    } else {
      const grid = el('div', 'cr-lines');
      grid.append(el('span', 'cr-h', 'EARNED'), el('span', 'cr-h cr-num', 'XP'), el('span', 'cr-h cr-num', 'STICKS'));
      for (const l of cur.award.lines) {
        const daily = l.id === 'firstWin' || l.id === 'firstOnline' || l.id === 'shift' || l.id === 'pto', cap = l.id === 'cap';
        grid.append(el('span', daily ? 'cr-daily' : cap ? 'cr-cap' : '', lineText(l)), el('span', 'cr-num', signed(l.xp)), el('span', 'cr-num cr-st', signed(l.sticks)));
      }
      grid.append(el('span', 'cr-tot', 'TOTAL'), el('span', 'cr-num cr-tot', signed(cur.award.xp)), el('span', 'cr-num cr-st cr-tot', signed(cur.award.sticks)));
      box.appendChild(grid);
    }
    if (cur.award.firstWin) box.appendChild(el('div', 'cr-note', "YOUR FIRST WIN TODAY PAYS EXTRA. IT'S BACK TOMORROW."));
    else if (cur.award.firstOnline) box.appendChild(el('div', 'cr-note', 'YOUR FIRST ONLINE MATCH TODAY PAYS EXTRA.'));
    if (cur.award.lines.some((l) => l.id === 'pto')) box.appendChild(el('div', 'cr-note', ptoPaid(cur.award.ptoLeft)));
    if (cur.award.capped) box.appendChild(el('div', 'cr-note', 'ARCADE AND HORDE HAVE PAID ALL THEY CAN TODAY. ONLINE STILL PAYS.'));
    box.appendChild(shiftTicks(cur.award.moved, compact));   // the day's shifts, the ones this match moved lit
    if (cur.award.mastery) box.appendChild(masteryBlock(cur.award.mastery, compact));   // the fighter played (README, Fighter mastery)
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

// ---- fighter mastery (README, Progression, Fighter mastery) -------------------------------------------------
const KIND_WORD = { palette: 'PALETTE', pose: 'VICTORY POSE', taunt: 'TAUNT' };
/** n pips, the first `on` filled */
function pips(on, n = MAX_RANK) {
  const t = el('span', 'ms-pips');
  for (let i = 0; i < n; i++) t.appendChild(el('i', i < on ? 'ms-on' : ''));
  return t;
}
/** The result screen's mastery: what the match paid the fighter played, the bar, and any unlock as its own beat */
export function masteryBlock(m, compact = false) {
  injectStyle();
  const name = characterOr(m.fighter).name, now = mastery(m.fighter);
  const box = el('div', compact ? 'ms-res ms-rescompact' : 'ms-res');
  box.dataset.fighter = m.fighter;
  if (m.after > m.before) {
    const up = el('div', 'ms-up');
    up.append(el('span', '', `${name} MASTERY`), el('b', '', String(m.after)));
    box.appendChild(up);
    for (const u of m.unlocked || []) box.appendChild(el('div', 'ms-unlock', `UNLOCKED ${KIND_WORD[u.kind] || ''}: ${u.name}`));
  }
  const head = el('div', 'ms-head');
  head.append(el('b', '', `${name} MASTERY ${now.rank}`), pips(now.rank),
    el('span', 'ms-xp', `+${fmt(m.total)} XP${m.hire ? `  ·  ${NEW_HIRE.label} +${m.hire}` : ''}`));
  box.appendChild(head);
  if (!compact) {
    const bar = el('div', 'cr-bar ms-bar'), fill = el('i');
    fill.style.width = `${now.next ? Math.round((100 * now.into) / now.span) : 100}%`;
    bar.appendChild(fill);
    box.append(bar, el('div', 'ms-next', now.next ? `${fmt(now.into)} / ${fmt(now.span)} TO MASTERY ${now.rank + 1}` : 'MASTERED: EVERYTHING UNLOCKED'));
  }
  return box;
}
/** character select's line for a fighter: the rank in pips, NEW HIRE BONUS while the first matches still pay it */
export function masteryChip(fighter) {
  injectStyle();
  const m = mastery(fighter);
  const box = el('div', 'ms-chip');
  box.dataset.rank = String(m.rank);
  box.append(el('b', '', `MASTERY ${m.rank}`), pips(m.rank));
  if (m.newHire) box.appendChild(el('span', 'ms-hire', `${NEW_HIRE.label} BONUS`));
  return box;
}

// ---- PTO (README, Progression, PTO) ----------------------------------------------------------------------------
// Always framed as something you have, never as something you lost: no streak, no count of days missed.
const matches = (n) => (n === 1 ? 'YOUR NEXT MATCH PAYS' : `YOUR NEXT ${n} MATCHES PAY`);
/** the menu's line: '' when nothing is banked */
export function ptoText(bank, back) {
  if (!(bank > 0)) return '';
  return `${back ? 'WELCOME BACK' : 'PTO'}: ${matches(bank)} DOUBLE XP`;
}
/** the result screen's sentence under a match PTO doubled */
function ptoPaid(left) {
  const n = Math.max(0, Math.floor(Number(left) || 0));
  return n > 0 ? `PTO: THIS MATCH PAID DOUBLE XP FOR COMING BACK. ${n === 1 ? 'ONE MORE DOES' : `${n} MORE DO`} TOO.` : 'PTO: THIS MATCH PAID DOUBLE XP FOR COMING BACK.';
}
/** The main menu's PTO line, or an empty block that fills in if some is banked later (a sign-in, a new day). */
export function ptoBlock() {
  injectStyle();
  const box = el('div', 'pto-menu');
  const paint = () => {
    const p = pto(), t = ptoText(p.bank, p.back);
    box.textContent = '';
    box.classList.toggle('pto-on', !!t);
    if (!t) return;
    box.append(el('b', 'pto-x', '×2'), el('span', 'pto-text', t));
  };
  paint();
  const off = onCareer(() => { if (!box.isConnected) { off(); return; } paint(); });
  return box;
}

// ---- daily shifts (README, Progression, Daily shifts) -------------------------------------------------------
/** n boxes, the first p filled (a target past 5 reads as numbers instead) */
function ticks(p, n) {
  const t = el('span', 'sh-ticks');
  if (n > 5) { t.textContent = `${p}/${n}`; return t; }
  for (let i = 0; i < n; i++) t.appendChild(el('i', i < p ? 'sh-on' : ''));
  return t;
}
const payText = () => `+${SHIFT_PAY.sticks} STICKS  +${SHIFT_PAY.xp} XP`;

/** The result screen's row: each shift's ticks, the ones this match moved lit, DONE on a finished one. */
export function shiftTicks(moved, compact = false) {
  injectStyle();
  const { list } = todayShifts();
  const box = el('div', compact ? 'sh-res sh-rescompact' : 'sh-res');
  box.appendChild(el('span', 'sh-reshead', "TODAY'S SHIFTS"));
  list.forEach((sh, i) => {
    const r = el('span', `sh-resrow${moved && moved[i] ? ' sh-moved' : ''}${sh.done ? ' sh-done' : ''}`);
    r.append(ticks(sh.prog, sh.n), el('span', '', sh.done ? `${sh.title}  DONE` : sh.title));
    box.appendChild(r);
  });
  return box;
}

/** The main menu's panel: today's three, their ticks and what each pays. Repaints when progress changes. */
export function shiftsBlock() {
  injectStyle();
  const box = el('div', 'sh-menu'), away = ptoBlock();   // PTO first: WELCOME BACK: YOUR NEXT 3 MATCHES PAY DOUBLE XP
  const paint = () => {
    const btns = [...box.children].filter((c) => c.classList.contains('fl-btn'));   // the menu's SHIFTS button stays
    box.textContent = '';
    box.appendChild(away);
    const { list } = todayShifts();
    box.appendChild(el('div', 'sh-head', "TODAY'S SHIFTS"));
    for (const sh of list) {
      const r = el('div', `sh-row${sh.done ? ' sh-done' : ''}`);
      r.append(ticks(sh.prog, sh.n), el('span', 'sh-title', sh.title), el('span', 'sh-pay', sh.done ? 'DONE' : `+${SHIFT_PAY.sticks}`));
      box.appendChild(r);
    }
    box.appendChild(el('div', 'sh-foot', 'NEW ONES EVERY DAY AT MIDNIGHT UTC. THE SAME FOR EVERYONE.'));
    box.append(...btns);
  };
  paint();
  const off = onCareer(() => { if (!box.isConnected) { off(); return; } paint(); });
  return box;
}

/**
 * The SHIFTS screen's body: a card per shift, each with HOW TO PLAY (the guide page that covers it, in a new tab)
 * and SWAP (one a day, on a shift that isn't done; the first press asks, the second swaps). repaint(): called after
 * a swap so the flow can rebuild the screen. @param {{ repaint: () => void, note: (msg: string) => void }} opts
 */
export function shiftCards(opts) {
  injectStyle();
  const { list, swapUsed } = todayShifts();
  const wrap = el('div', 'sh-cards'), items = [];
  let armed = -1;
  for (const sh of list) {
    const card = el('div', `sh-card${sh.done ? ' sh-done' : ''}`);
    const top = el('div', 'sh-ctop');
    top.append(el('b', 'sh-ctitle', sh.title), ticks(sh.prog, sh.n));
    card.appendChild(top);
    if (sh.mechanic) card.appendChild(el('div', 'sh-mech', `TEACHES: ${sh.mechanic}`));
    card.appendChild(el('div', 'sh-coach', sh.coach));
    card.appendChild(el('div', 'sh-cpay', sh.done ? 'DONE. PAID ' + payText() : `PAYS ${payText()}`));
    const row = el('div', 'sh-cbtns');
    if (sh.guide) {
      const g = button('HOW TO PLAY', () => { try { window.open(rootUrl(sh.guide).href, '_blank', 'noopener'); } catch { /* blocked */ } }, 'fl-slim');
      row.appendChild(g.el); items.push(g);
    }
    if (!sh.done && !swapUsed) {
      const sw = button('SWAP', () => {
        if (armed !== sh.slot) { armed = sh.slot; sw.el.textContent = 'SWAP IT? PRESS AGAIN'; opts.note('YOU GET ONE SWAP A DAY. ITS PROGRESS STARTS OVER.'); return; }
        swapToday(sh.slot).then((r) => {
          if (r.error) opts.note(r.error === 'used' ? 'ALREADY SWAPPED ONE TODAY' : r.error === 'done' ? "THAT ONE'S DONE" : "CAN'T REACH THE SERVER: TRY AGAIN");
          opts.repaint();
        });
      }, 'fl-violet fl-slim');
      row.appendChild(sw.el); items.push(sw);
    }
    if (row.childNodes.length) card.appendChild(row);
    wrap.appendChild(card);
  }
  return { el: wrap, items, swapUsed };
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
  .ms-res { display: flex; flex-direction: column; gap: 0.4cqh; border-top: 2px solid rgba(255,255,255,0.12); padding-top: 0.6cqh; }
  .ms-head { display: flex; align-items: center; gap: 1cqw; font: 600 1.9cqw/1 'Teko', sans-serif; letter-spacing: 0.1em; color: #e8e0ff; }
  .ms-head .ms-xp { margin-left: auto; color: #9dffc0; }
  .ms-next { font: 500 1.5cqw/1 'Teko', sans-serif; letter-spacing: 0.1em; color: #b8a8e0; }
  .ms-up { display: flex; align-items: baseline; justify-content: center; gap: 1.2cqw; animation: cr-stamp 520ms cubic-bezier(.2,1.6,.4,1) both; }
  .ms-up span { font: 600 2.2cqw/1 'Teko', sans-serif; letter-spacing: 0.14em; color: #ffe0a8; }
  .ms-up b { font: 400 3.2cqw/1 'Bungee', sans-serif; color: #fff4d6; }
  .ms-unlock { font: 600 1.8cqw/1.1 'Teko', sans-serif; letter-spacing: 0.1em; color: #ffd84f; text-align: center; }
  .ms-pips { display: inline-flex; gap: 3px; }
  .ms-pips i { display: block; width: max(7px, 0.9cqw); height: max(7px, 0.9cqw); border: 2px solid #ffb02e; }
  .ms-pips i.ms-on { background: #ffb02e; }
  .ms-chip { display: flex; align-items: center; gap: 0.8cqw; font: 600 1.7cqw/1 'Teko', sans-serif; letter-spacing: 0.12em; color: #ffe0a8; }
  .ms-chip .ms-hire { color: #0b0616; background: #9dffc0; padding: 0.15em 0.4em; }
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
  /* PTO: plain text, square corners, the mint the bonuses use, a full outline */
  .pto-menu { display: none; align-items: center; gap: 1cqw; padding: 0.6cqh 1cqw; border: 2px solid #9dffc0; background: rgba(10,4,20,0.82); }
  .pto-menu.pto-on { display: flex; }
  .pto-x { font: 400 2cqw/1 'Bungee', sans-serif; color: #0b0616; background: #9dffc0; padding: 0.2em 0.35em 0.1em; }
  .pto-text { font: 600 2cqw/1.05 'Teko', sans-serif; letter-spacing: 0.08em; color: #9dffc0; }
  /* daily shifts: plain text, square corners, the career's amber */
  .sh-ticks { display: inline-flex; gap: 0.35cqw; align-items: center; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 1.6cqw; color: #ffc46b; }
  .sh-ticks i { display: block; width: max(7px, 1cqw); height: max(7px, 1cqw); border: 2px solid rgba(255,176,46,0.75); }
  .sh-ticks i.sh-on { background: #ffb02e; }
  .sh-modeswrap { display: flex; align-items: center; gap: 3cqw; }
  .pc-col { display: flex; flex-direction: column; gap: 1.4cqh; }
  /* MAIN MENU's profile card: square, the career's amber, nothing glows */
  #flow .fl-btn.fl-pcard { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 0.5cqh 1.2cqw; width: 40cqw; min-width: 0;
    padding: 1cqh 1.4cqw; text-align: left; border: 2px solid rgba(255,176,46,0.85); background: rgba(10,4,20,0.86); color: #fff4fd; box-shadow: none; }
  #flow .fl-btn.fl-pcard.fl-focus, #flow .fl-btn.fl-pcard:focus-visible { background: rgba(255,176,46,0.16); border-color: #ffb02e; outline: 2px solid #ffb02e; outline-offset: 2px; }
  .pc-top { display: flex; align-items: baseline; gap: 1.2cqw; min-width: 0; }
  .pc-name { font: 400 2.6cqw/1 'Bungee', sans-serif; color: #fff4fd; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pc-title { font: 600 2.4cqw/1 'Teko', sans-serif; letter-spacing: 0.12em; color: #ffc46b; white-space: nowrap; }
  .pc-bar { grid-column: 1 / -1; display: block; height: max(6px, 0.9cqh); background: rgba(255,176,46,0.18); border: 1px solid rgba(255,176,46,0.6); }
  .pc-bar i { display: block; height: 100%; background: #ffb02e; }
  .pc-xp { font: 600 1.6cqw/1 'Teko', sans-serif; letter-spacing: 0.1em; color: #eadcff; }
  .pc-tag { font: 600 1.6cqw/1 'Teko', sans-serif; letter-spacing: 0.12em; color: #ffc46b; white-space: nowrap; }
  .pc-tag.pc-save { color: #0b0616; background: #ffb02e; padding: 0.3em 0.5em 0.15em; text-shadow: none; }
  .sh-menu .fl-btn { min-width: 0; margin-top: 0.4cqh; }
  .sh-menu { display: flex; flex-direction: column; gap: 0.7cqh; width: 40cqw; padding: 1cqh 1.4cqw; border: 2px solid rgba(255,176,46,0.7); background: rgba(10,4,20,0.82); }
  .sh-head, .sh-reshead { font: 600 1.8cqw/1 'Teko', sans-serif; letter-spacing: 0.16em; color: rgba(255,224,168,0.9); }
  .sh-row { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 1cqw; font: 600 2cqw/1.05 'Teko', sans-serif; letter-spacing: 0.08em; color: #eadcff; }
  .sh-row .sh-pay { color: #ffc46b; font-size: 1.8cqw; }
  .sh-done .sh-title, .sh-done .sh-ctitle { color: #9dffc0; }
  .sh-row.sh-done .sh-pay { color: #9dffc0; }
  .sh-foot { font: 500 1.4cqw/1.1 'Teko', sans-serif; letter-spacing: 0.1em; color: rgba(214,190,255,0.7); }
  .sh-res { display: flex; flex-direction: column; gap: 0.3cqh; border-top: 2px solid rgba(255,176,46,0.35); padding-top: 0.5cqh; }
  .sh-resrow { display: flex; align-items: center; gap: 1cqw; font: 600 1.8cqw/1.05 'Teko', sans-serif; letter-spacing: 0.08em; color: rgba(234,220,255,0.7); }
  .sh-resrow.sh-moved { color: #fff4d6; }
  .sh-resrow.sh-done { color: #9dffc0; }
  .sh-rescompact { flex-direction: row; flex-wrap: wrap; justify-content: center; gap: 0.3cqh 1.6cqw; }
  .sh-cards { display: flex; gap: 1.4cqw; align-items: stretch; width: 92cqw; }
  .sh-card { flex: 1 1 0; display: flex; flex-direction: column; gap: 0.8cqh; padding: 1.2cqh 1.2cqw; border: 2px solid rgba(255,176,46,0.7); background: rgba(10,4,20,0.85); }
  .sh-card.sh-done { border-color: rgba(157,255,192,0.7); }
  .sh-ctop { display: flex; flex-direction: column; gap: 0.6cqh; }
  .sh-ctitle { font: 400 1.9cqw/1.1 'Bungee', sans-serif; color: #fff4d6; }
  .sh-mech { font: 600 1.8cqw/1 'Teko', sans-serif; letter-spacing: 0.14em; color: #ffc46b; }
  .sh-coach { flex: 1; font: 500 1.8cqw/1.15 'Teko', sans-serif; letter-spacing: 0.06em; color: #eadcff; }
  .sh-cpay { font: 600 1.7cqw/1 'Teko', sans-serif; letter-spacing: 0.1em; color: #ffc46b; }
  .sh-done .sh-cpay { color: #9dffc0; }
  .sh-cbtns { display: flex; flex-direction: column; gap: 0.8cqh; }
  .sh-cbtns .fl-btn { min-width: 0; font-size: 2.2cqw; }
  /* the menus' counter: top right, under the corner buttons' row, plain text */
  .cr-chip { position: absolute; z-index: 4; left: 1.2cqw; top: 1.2cqh; display: none; align-items: baseline; gap: 1cqw; padding: 0.3cqh 1cqw 0;
    border: 2px solid rgba(255,176,46,0.7); background: rgba(10,4,20,0.78); pointer-events: none;
    font: 600 2cqw/1.2 'Teko', 'Arial Narrow', sans-serif; letter-spacing: 0.1em; color: #ffc46b; text-shadow: var(--plain); }
  .cr-chip span { color: #eadcff; font-size: 1.7cqw; }
  .cr-chip.cr-on { display: flex; }
  /* held upright the stage is short: everything a size up so it stays readable */
  @container (max-aspect-ratio: 1/1) {
    .cr-earn { min-width: 76cqw; } .cr-nudge { max-width: 86cqw; font-size: 3.6cqw; } .cr-nudge .cr-nsub { font-size: 3cqw; }
    .cr-lines { font-size: 3.4cqw; } .cr-lines .cr-num { font-size: 3cqw; } .cr-lines .cr-h { font-size: 2.6cqw; }
    .cr-promo span { font-size: 3.4cqw; } .cr-promo b { font-size: 5cqw; }
    .cr-row { font-size: 3.2cqw; } .cr-sum, .cr-wallet { font-size: 3.4cqw; } .cr-note { font-size: 2.9cqw; }
    .ms-head, .ms-unlock { font-size: 3.2cqw; } .ms-next { font-size: 2.8cqw; } .ms-up span { font-size: 3.4cqw; } .ms-up b { font-size: 4.6cqw; }
    .ms-chip { font-size: 3.2cqw; }
    .cr-title { font-size: 3.6cqw; } .cr-rlabel, .cr-next { font-size: 2.8cqw; }
    .cr-chip { font-size: 3.4cqw; } .cr-chip span { font-size: 3cqw; }
    .fl-pcareer { width: 80cqw; }
    .sh-modeswrap { flex-direction: column; gap: 1.6cqh; } #flow .fl-btn.fl-pcard { width: 86cqw; }
    .pc-name { font-size: 4.4cqw; } .pc-title { font-size: 4cqw; } .pc-xp, .pc-tag { font-size: 3cqw; } .sh-menu { width: 86cqw; } .sh-head, .sh-reshead { font-size: 2.8cqw; } .sh-row, .sh-resrow { font-size: 3.2cqw; } .sh-row .sh-pay { font-size: 3cqw; }
    .pto-x, .pto-text { font-size: 3.2cqw; }
    .sh-foot { font-size: 2.4cqw; } .sh-ticks { font-size: 2.8cqw; } .sh-ticks i { width: max(8px, 1.8cqw); height: max(8px, 1.8cqw); }
    .sh-cards { flex-direction: column; width: 90cqw; } .sh-ctitle { font-size: 3.4cqw; } .sh-mech, .sh-cpay { font-size: 3cqw; } .sh-coach { font-size: 3cqw; }
    .sh-cbtns { flex-direction: row; } .sh-cbtns .fl-btn { flex: 1; font-size: 3.4cqw; }
  }
  `;
  const st = document.createElement('style'); st.id = 'career-style'; st.textContent = css;
  document.head.appendChild(st);
}
export function ensureStyle() { if (typeof document !== 'undefined') injectStyle(); }
