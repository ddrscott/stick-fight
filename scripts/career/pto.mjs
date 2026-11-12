#!/usr/bin/env node
// PTO, the math (README, Progression, PTO): `npm run test:pto`. No browser, no Worker:
//   - banking: each whole day away banks PTO.perDay double-XP matches; yesterday or today banks nothing; a new player
//     (never played) banks nothing
//   - the cap: a long absence banks PTO.cap, never more, and a forged bank is cleaned to it
//   - spending: a finished match spends one and pays its match XP again (sticks aren't doubled), down to zero;
//     a cut match, training and a capped-out offline match spend nothing; the daily bonuses and shifts aren't doubled
//   - counting twice adds nothing (settlePto is idempotent), and the menu's words never talk about loss
//   - fighter mastery pays the match's own XP, not the doubled XP
import { payout, applyAward, blankCareer, settlePto, cleanPto, ptoFor, PTO, PAY, DAILY, OFFLINE_CAP } from '../../src/career/rules.js';
import { payWithMastery, applyWithMastery } from '../../src/career/mastery.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const m = (o) => ({ mode: 'arcade', won: false, cut: false, fought: 60, parries: 0, punishes: 0, enders: 0, accidents: 0, perfects: 0, floors: 0, ...o });
const line = (a, id) => a.lines.find((l) => l.id === id);
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const D0 = '2026-11-01';
/** a career whose last paid match was on `day`, with today's daily bonuses taken so they don't muddy the numbers */
const played = (day, bank = 0, today = day) => ({ ...blankCareer(), pto: { day, bank }, winDay: today, onlineDay: today });

// ---- the numbers live in rules.js ---------------------------------------------------------------------------------
ok('PTO numbers are in rules.js: 1 a day, at most 5', PTO.perDay === 1 && PTO.cap === 5, JSON.stringify(PTO));

// ---- banking -------------------------------------------------------------------------------------------------------
{
  ok('a new player banks nothing', ptoFor(blankCareer(), D0).bank === 0 && !ptoFor(blankCareer(), D0).back);
  ok('played today: nothing banked', ptoFor(played(D0), D0).bank === 0);
  ok('played yesterday: nothing banked (no day was missed)', ptoFor(played(D0), addDays(D0, 1)).bank === 0);
  for (const away of [1, 2, 3, 4]) {
    const p = ptoFor(played(D0), addDays(D0, away + 1));
    ok(`${away} whole day${away > 1 ? 's' : ''} away banks ${away * PTO.perDay}`, p.bank === away * PTO.perDay && p.back, JSON.stringify(p));
  }
  const fresh = payout(m({}), blankCareer(), D0);
  ok('a new player\'s first match isn\'t doubled', !line(fresh, 'pto') && fresh.pto.day === D0 && fresh.pto.bank === 0, JSON.stringify(fresh.pto));
  const after = applyAward(blankCareer(), fresh, D0);
  ok('a paid match marks the day played', after.pto.day === D0 && after.pto.bank === 0);
  const cutShort = payout(m({ cut: true, fought: 45 }), played(D0), addDays(D0, 4));
  ok('a cut match still counts as being back: banks the days, spends none', !line(cutShort, 'pto') && cutShort.pto.bank === 3 && cutShort.pto.day === addDays(D0, 4), JSON.stringify(cutShort.pto));
  const tooShort = payout(m({ cut: true, fought: 5 }), played(D0), addDays(D0, 4));
  ok('a match that pays nothing touches nothing', !tooShort.lines.length && !tooShort.pto);
}

// ---- the cap -------------------------------------------------------------------------------------------------------
{
  for (const away of [5, 6, 30, 400]) {
    const p = ptoFor(played(D0), addDays(D0, away + 1));
    ok(`${away} days away banks the cap, ${PTO.cap}`, p.bank === PTO.cap, String(p.bank));
  }
  const topped = ptoFor(played(D0, 4), addDays(D0, 4));
  ok('banked on top of what\'s left, still capped', topped.bank === PTO.cap, String(topped.bank));
  ok('a forged bank is cleaned to the cap', cleanPto({ day: D0, bank: 9999 }).bank === PTO.cap && cleanPto({ day: 'soon', bank: -3 }).day === '' && cleanPto({ bank: -3 }).bank === 0);
  ok('a day in the future banks nothing', ptoFor(played(addDays(D0, 10)), D0).bank === 0);
  const once = settlePto({ day: D0, bank: 0 }, addDays(D0, 4)), twice = settlePto(once, addDays(D0, 4));
  ok('counting the time away twice adds nothing', once.bank === 3 && twice.bank === 3 && twice.day === once.day, `${JSON.stringify(once)} ${JSON.stringify(twice)}`);
  const later = settlePto(once, addDays(D0, 6));
  ok('and the days after still count once each', later.bank === 5, JSON.stringify(later));
}

// ---- spending ------------------------------------------------------------------------------------------------------
{
  const today = addDays(D0, 4);   // 3 days away: 3 banked
  let c = played(D0, 0, today);
  const p = ptoFor(c, today);
  ok('back after 3 days: 3 banked and it\'s a welcome back', p.bank === 3 && p.back);
  const tech = { won: true, parries: 2, enders: 1 };
  const plain = payout(m(tech), { ...c, pto: { day: today, bank: 0 } }, today);
  const xps = [];
  for (let i = 0; i < 4; i++) {
    const a = payout(m(tech), c, today);
    xps.push(a.xp);
    if (i < 3) ok(`match ${i + 1} back pays double XP (PTO ×2 line), ${2 - i} left`, line(a, 'pto') && line(a, 'pto').xp === plain.match.xp && line(a, 'pto').label === 'PTO ×2' && a.xp === plain.xp * 2 && a.ptoLeft === 2 - i, `${a.xp} vs ${plain.xp}`);
    else ok('match 4 is back to normal pay, nothing taken away', !line(a, 'pto') && a.xp === plain.xp && a.sticks === plain.sticks);
    if (i < 3) ok(`  match ${i + 1}: sticks aren't doubled`, a.sticks === plain.sticks);
    c = applyAward(c, a, today);
    ok(`  after match ${i + 1}: ${Math.max(0, 2 - i)} banked, the menu says so`, ptoFor(c, today).bank === Math.max(0, 2 - i) && !ptoFor(c, today).back);
  }

  // the daily bonuses and shift pay aren't doubled: only the match's own XP is
  const fresh = { ...blankCareer(), pto: { day: D0, bank: 0 } };   // first win today not taken
  const a = payout(m({ won: true }), fresh, today);
  ok('a first win of the day: the match XP doubles, the bonus doesn\'t', line(a, 'pto').xp === PAY.base.xp + PAY.win.xp && a.xp === 2 * (PAY.base.xp + PAY.win.xp) + DAILY.firstWin.xp, String(a.xp));

  // training pays nothing, so it spends nothing
  const tr = payout(m({ mode: 'training' }), played(D0), today);
  ok('training spends nothing', !tr.lines.length && !tr.pto);

  // the offline cap reached: no match XP, nothing to double, nothing spent
  const full = { ...played(D0, 0, today), offDay: today, offXp: OFFLINE_CAP.xp, offSticks: OFFLINE_CAP.sticks };
  const capped = payout(m({ won: true }), full, today);
  ok('offline cap reached: nothing doubled, the bank kept', capped.capped && !line(capped, 'pto') && capped.pto.bank === 3, JSON.stringify(capped.pto));
  // the doubled XP doesn't count toward the offline cap
  const c2 = applyAward(played(D0, 0, today), payout(m({ won: true }), played(D0, 0, today), today), today);
  ok('the PTO XP is outside the offline cap', c2.offXp === PAY.base.xp + PAY.win.xp, String(c2.offXp));

  // online pays it too (the room runs the same payout)
  const on = payout(m({ mode: 'quick', won: true }), played(D0, 0, today), today);
  ok('an online match spends it too', !!line(on, 'pto'));

  // mastery: the fighter gets the match's own XP, not the doubled XP
  const am = payWithMastery(m({ won: true, fighter: 'barista' }), played(D0, 0, today), today);
  ok('fighter mastery pays the match XP, not the PTO double', am.mastery && am.mastery.xp === PAY.base.xp + PAY.win.xp && !!line(am, 'pto'), JSON.stringify(am.mastery));
  const cm = applyWithMastery(played(D0, 0, today), am, today);
  ok('applyWithMastery stores the spent bank', cm.pto.bank === 2 && cm.pto.day === today);
}

// ---- the words never frame it as loss ---------------------------------------------------------------------------
{
  const { ptoText } = await import('../../src/flow/careerUI.js').catch(() => ({ ptoText: null }));
  if (ptoText) {
    ok('menu, back: WELCOME BACK: YOUR NEXT 3 MATCHES PAY DOUBLE XP', ptoText(3, true) === 'WELCOME BACK: YOUR NEXT 3 MATCHES PAY DOUBLE XP', ptoText(3, true));
    ok('menu, one left: YOUR NEXT MATCH PAYS', ptoText(1, false) === 'PTO: YOUR NEXT MATCH PAYS DOUBLE XP', ptoText(1, false));
    ok('menu, none: nothing at all', ptoText(0, true) === '');
    const all = [1, 2, 3, 4, 5].flatMap((n) => [ptoText(n, true), ptoText(n, false)]).join(' ');
    ok('no streak, no loss, no missed days in the words', !/STREAK|LOST|LOSE|MISSED|RESET|EXPIRE|GONE|BROKE/.test(all));
  } else ok('careerUI loads in node for its words', false, 'import failed');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
