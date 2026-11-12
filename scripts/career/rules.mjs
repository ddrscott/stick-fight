#!/usr/bin/env node
// Career and sticks, the math (README, Progression): `npm run test:career`. No browser, no Worker:
//   - payout: base and win, each technique line and its cap, raw hits paying nothing (the mash case), training and the
//     dummy paying nothing, a match cut short paying the base at most (and nothing under CUT_MIN_SECS or online)
//   - the daily bonuses: the first win and the first online match each pay once per UTC day, and again the next day
//   - the offline cap: arcade and horde stop paying at OFFLINE_CAP a day (the daily bonuses aside); online still pays
//   - the ladder: thresholds rise, the first promotion comes in about 3 matches, C-SUITE takes weeks
//   - the books (src/bookkeeping.js) on a stand-in sim: a mashed jab string with no technique sums to the base only;
//     parries, counter hits, enders and accidents are counted for the side that made them
//   - palettes: every fighter has 3 or 4, flat hex colors, fixed prices; colorFor keeps P2 from clashing with P1's palette
import { payout, applyAward, blankCareer, titleFor, LADDER, PAY, DAILY, OFFLINE_CAP, CUT_MIN_SECS } from '../../src/career/rules.js';
import { PALETTES, PRICES, palettesFor } from '../../src/career/palettes.js';
import { createBook } from '../../src/bookkeeping.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const D1 = '2026-11-12', D2 = '2026-11-13';
const m = (o) => ({ mode: 'arcade', won: false, cut: false, fought: 60, parries: 0, punishes: 0, enders: 0, accidents: 0, perfects: 0, floors: 0, ...o });
const line = (a, id) => a.lines.find((l) => l.id === id);

// ---- payout -------------------------------------------------------------------------------------------------------
{
  const used = { ...blankCareer(), winDay: D1, onlineDay: D1 };   // the daily bonuses already taken today
  const loss = payout(m({}), used, D1);
  ok('a lost arcade stage pays the base, win or lose', loss.xp === PAY.base.xp && loss.sticks === PAY.base.sticks && loss.lines.length === 1, JSON.stringify(loss.lines));
  const win = payout(m({ won: true }), used, D1);
  ok('a won one pays base + win', win.xp === PAY.base.xp + PAY.win.xp && win.sticks === PAY.base.sticks + PAY.win.sticks);
  const tech = payout(m({ won: true, parries: 3, punishes: 2, enders: 1, accidents: 1, perfects: 1 }), used, D1);
  const want = PAY.base.sticks + PAY.win.sticks + 3 * PAY.parries.sticks + 2 * PAY.punishes.sticks + PAY.enders.sticks + PAY.accidents.sticks + PAY.perfects.sticks;
  ok('technique pays: parries ×3, punishes ×2, an ender, an accident, a perfect round', tech.sticks === want && line(tech, 'parries').n === 3 && line(tech, 'parries').sticks === 3 * PAY.parries.sticks, `${tech.sticks} vs ${want}`);
  const capped = payout(m({ parries: 500, punishes: 500, enders: 500, accidents: 500, perfects: 500 }), used, D1);
  ok('each technique line stops at its cap per match', line(capped, 'parries').n === PAY.parries.cap && line(capped, 'punishes').n === PAY.punishes.cap && line(capped, 'perfects').n === PAY.perfects.cap);
  // the mash case: a page that only knows hits and presses has nothing to pay with
  const mash = payout(m({ hits: 999, presses: 5000, combo: 40 }), used, D1);
  ok('the mash case: 999 hits, 5,000 presses and a 40-hit combo pay nothing past the base', mash.sticks === PAY.base.sticks && mash.xp === PAY.base.xp && mash.lines.length === 1);
  for (const mode of ['training', 'dummy', 'attract', '']) {
    const t = payout(m({ mode, won: true, parries: 10 }), blankCareer(), D1);
    ok(`${mode || 'no mode'} pays nothing`, t.xp === 0 && t.sticks === 0 && !t.lines.length);
  }
  const cutShort = payout(m({ cut: true, fought: CUT_MIN_SECS - 1, won: true, parries: 5 }), blankCareer(), D1);
  ok(`cut short under ${CUT_MIN_SECS} s pays nothing`, !cutShort.lines.length);
  const cutLong = payout(m({ cut: true, fought: 200, won: true, parries: 5, perfects: 2 }), blankCareer(), D1);
  ok('cut short after a real fight pays the base only: no win, no technique, no first-win bonus', cutLong.lines.length === 1 && cutLong.lines[0].id === 'base' && !cutLong.firstWin, JSON.stringify(cutLong.lines));
  const onlineCut = payout(m({ mode: 'quick', cut: true, fought: 600 }), blankCareer(), D1);
  ok('an online match cut short (no agreed result) pays nothing', !onlineCut.lines.length);
  const horde = payout(m({ mode: 'horde', won: true, floors: 3 }), used, D1);
  ok('horde pays base + floors cleared, never a win', !line(horde, 'win') && line(horde, 'floors').n === 3 && !horde.firstWin);
}

// ---- the daily bonuses ----------------------------------------------------------------------------------------------
{
  let c = blankCareer();
  const a1 = payout(m({ won: true }), c, D1);
  ok('the first win of the day pays FIRST WIN TODAY', a1.firstWin && line(a1, 'firstWin').sticks === DAILY.firstWin.sticks);
  c = applyAward(c, a1, D1);
  const a2 = payout(m({ won: true }), c, D1);
  ok('the second win that day doesn\'t', !a2.firstWin && !line(a2, 'firstWin'));
  const lossFirst = payout(m({ won: false }), blankCareer(), D1);
  ok('a loss never claims it', !lossFirst.firstWin);
  const a3 = payout(m({ won: true }), c, D2);
  ok('the next UTC day it pays again (no streak: a missed day costs nothing)', a3.firstWin);
  const o1 = payout(m({ mode: 'quick', won: false }), c, D1);
  ok('the first online match of the day pays FIRST ONLINE MATCH TODAY, win or lose', o1.firstOnline && line(o1, 'firstOnline').sticks === DAILY.firstOnline.sticks);
  c = applyAward(c, o1, D1);
  const o2 = payout(m({ mode: 'crew', won: true }), c, D1);
  ok('a second online match that day doesn\'t (a crew match counts as online)', !o2.firstOnline);
  const off = payout(m({ mode: 'arcade', won: true }), { ...blankCareer(), winDay: D1 }, D1);
  ok('arcade never pays the online bonus', !off.firstOnline);
}

// ---- the offline cap -----------------------------------------------------------------------------------------------
{
  let c = { ...blankCareer(), winDay: D1 }, paid = 0, n = 0;
  const big = m({ won: true, parries: 10, punishes: 10, enders: 8, accidents: 5, perfects: 3 });
  while (n < 500) { const a = payout(big, c, D1); if (!a.sticks) break; paid += a.sticks; c = applyAward(c, a, D1); n++; }
  ok(`arcade stops paying at the daily cap (${OFFLINE_CAP.sticks} sticks)`, paid === OFFLINE_CAP.sticks && c.offSticks === OFFLINE_CAP.sticks, `${paid} over ${n} matches`);
  const after = payout(big, c, D1);
  ok('the next one says DAILY LIMIT and pays 0', after.capped && after.sticks === 0 && line(after, 'cap'));
  const online = payout(m({ mode: 'quick', won: true }), c, D1);
  ok('online still pays at the cap', online.sticks > 0 && !online.capped);
  const tomorrow = payout(big, c, D2);
  ok('the cap resets the next day', tomorrow.sticks > 0 && !tomorrow.capped);
  const bonus = payout(m({ won: true }), { ...c, winDay: '' }, D1);
  ok('the first-win bonus isn\'t eaten by the cap', bonus.firstWin && bonus.sticks === DAILY.firstWin.sticks, String(bonus.sticks));
}

// ---- the ladder ----------------------------------------------------------------------------------------------------
{
  ok('8 titles, TEMP to C-SUITE', LADDER.length === 8 && LADDER[0].title === 'TEMP' && LADDER[7].title === 'C-SUITE');
  const gaps = LADDER.slice(1).map((r, i) => r.xp - LADDER[i].xp);
  ok('each promotion takes more than the one before', gaps.every((g, i) => i === 0 || g > gaps[i - 1]), gaps.join(' '));
  // a first session: lose, win, lose (with a parry or two), on a fresh profile
  let c = blankCareer();
  for (const r of [m({ parries: 1 }), m({ won: true, punishes: 1 }), m({ parries: 2 })]) c = applyAward(c, payout(r, c, D1), D1);
  ok('the first promotion (INTERN) comes in a first session of about 3 matches', titleFor(c.xp).title === 'INTERN', `${c.xp} XP`);
  // regular play: 10 matches a day, half won, a bit of technique, the daily bonuses
  c = blankCareer();
  let days = 0;
  for (; days < 400 && titleFor(c.xp).title !== 'C-SUITE'; days++) {
    const day = `d${days}`;
    for (let k = 0; k < 10; k++) c = applyAward(c, payout(m({ mode: k < 2 ? 'quick' : 'arcade', won: k % 2 === 0, parries: 1, punishes: 1, enders: 1 }), c, day), day);
  }
  ok('C-SUITE takes weeks of regular play (4 to 16 weeks at 10 matches a day)', days >= 28 && days <= 112, `${days} days`);
  const t = titleFor(LADDER[3].xp + 5);
  ok('titleFor gives the bar: into and span', t.title === 'SENIOR' && t.into === 5 && t.span === LADDER[4].xp - LADDER[3].xp && t.next === 'MANAGER');
  ok('the top has no next', titleFor(1e7).next === null && titleFor(1e7).title === 'C-SUITE');
}

// ---- the books' technique summary (src/bookkeeping.js) --------------------------------------------------------------
{
  const unit = (id) => ({ id, health: 100, maxHealth: 100, char: { id: 'temp' } });
  const sim = { stepCount: 0, phase: 'intro', wins: [0, 0], units: [unit(0), unit(1)], horde: null };
  const closed = [];
  const book = createBook(sim, { send: () => {}, store: null, page: 'cc', onClose: (s) => closed.push(s) });
  book.begin({ mode: 'arcade', level: 0.3, stage: 1, local: 0 });
  book.event({ type: 'fight' });
  for (let k = 0; k < 400; k++) { book.event({ type: 'attack', unit: sim.units[0], move: 'jab' }); book.event({ type: 'hit', attacker: sim.units[0], defender: sim.units[1], move: 'jab' }); }
  sim.stepCount = 90 * 120; sim.wins = [2, 0];
  book.end();
  const s = closed[0];
  ok('a mashed jab string: 400 hits, no technique in the summary', s && s.parries === 0 && s.punishes === 0 && s.enders === 0 && s.accidents === 0 && s.won, JSON.stringify(s));
  const a = payout(s, { ...blankCareer(), winDay: D1 }, D1);
  ok('... so it pays base + win and nothing for the hits', a.sticks === PAY.base.sticks + PAY.win.sticks);
  // technique, both sides
  closed.length = 0; sim.stepCount = 0; sim.wins = [0, 0];
  book.begin({ mode: 'quick', local: 1 });
  book.event({ type: 'fight' });
  book.event({ type: 'block', parry: true, attacker: sim.units[0], defender: sim.units[1] });   // P2 parries
  book.event({ type: 'block', parry: true, attacker: sim.units[0], defender: sim.units[1] });
  book.event({ type: 'block', parry: false, attacker: sim.units[0], defender: sim.units[1] });  // a plain block: nothing
  book.event({ type: 'hit', attacker: sim.units[1], defender: sim.units[0], move: 'cross', counter: true });   // P2's counter hit
  book.event({ type: 'hit', attacker: sim.units[0], defender: sim.units[1], move: 'jab', counter: true });    // P1's
  book.event({ type: 'callout', by: 1, kind: 'ender', text: 'NEON TORNADO' });
  book.event({ type: 'callout', by: 1, kind: 'accident', text: 'HAPPY ACCIDENT' });
  book.event({ type: 'callout', by: -1, kind: 'trade', text: 'TRADE' });
  const d = book.detail();
  ok('detail carries each side\'s technique for the room: [parries, punishes, enders, accidents, perfects]', JSON.stringify(d.tech) === JSON.stringify([[0, 1, 0, 0, 0], [2, 1, 1, 1, 0]]), JSON.stringify(d.tech));
  sim.stepCount = 60 * 120; sim.wins = [0, 2];
  book.end();
  ok('P2\'s summary (local 1): 2 parries, 1 punish, 1 ender, 1 accident, and the win', closed[0] && closed[0].parries === 2 && closed[0].punishes === 1 && closed[0].enders === 1 && closed[0].accidents === 1 && closed[0].won, JSON.stringify(closed[0]));
  closed.length = 0; sim.stepCount = 0;
  book.begin({ mode: 'arcade', local: 0 }); book.event({ type: 'fight' }); sim.stepCount = 3 * 120; book.cut();
  ok('a bounce under 5 s closes nothing', closed.length === 0);
  book.begin({ mode: 'arcade', local: 0 }); book.event({ type: 'fight' }); sim.stepCount = 45 * 120; book.cut();
  ok('a stage cut short after 45 s closes as cut, and pays the base only', closed[0] && closed[0].cut && payout(closed[0], blankCareer(), D1).lines.map((l) => l.id).join() === 'base');
}

// ---- palettes ------------------------------------------------------------------------------------------------------
{
  const roster = ['temp', 'intern', 'helpdesk', 'courier', 'security', 'janitor', 'manager', 'accountant', 'windowWasher', 'hrRep', 'salesRep', 'barista', 'chef', 'wellness', 'electrician', 'receptionist', 'lawyer', 'ceo'];
  ok('every fighter has 3 or 4 palettes', roster.every((f) => palettesFor(f).length >= 3 && palettesFor(f).length <= 4) && Object.keys(PALETTES).length === roster.length);
  const hex = /^#[0-9a-f]{6}$/i;
  ok('flat colors only: body, pants and accent are plain hex', Object.values(PALETTES).flat().every((p) => hex.test(p.body) && hex.test(p.pants) && hex.test(p.accent)));
  ok('fixed prices, cheapest first, the first in reach on day one (≤ 200 sticks)', Object.values(PALETTES).every((l) => l.every((p, i) => p.price === PRICES[i])) && PRICES[0] <= 200);
  ok('ids are unique per fighter', Object.values(PALETTES).every((l) => new Set(l.map((p) => p.id)).size === l.length));
}

// ---- the P2 color-clash rule with palettes (colorFor reads the registry, which needs the browser's canvas: the
// clash test is the registry's own function, loaded without the rest) -------------------------------------------------
{
  const { colorFor } = await import('../../src/characters/registry.js').catch(() => ({ colorFor: null }));
  if (!colorFor) ok('colorFor loads in node', false);
  else {
    const courier = { id: 'courier', color: '#ff2bd6', altColor: '#ff8a3d' }, intern = { id: 'intern', color: '#ffb02e', altColor: '#3fd0ff' };
    ok('no palettes: unchanged (INTERN v INTERN: P2 takes the alt)', colorFor(intern, 1, intern) === intern.altColor);
    ok('P2\'s palette stands when it doesn\'t clash', colorFor(courier, 1, intern, { mine: '#2ef2ff', theirs: '#ffb02e' }) === '#2ef2ff');
    ok('P2\'s palette gives way when it clashes with P1\'s (yellow on yellow)', colorFor(courier, 1, intern, { mine: '#ffe066', theirs: '#ffd84f' }) !== '#ffe066');
    ok('P1 in a palette that matches P2\'s own color: P2 moves off it', colorFor(courier, 1, intern, { theirs: '#ff2bd6' }) !== '#ff2bd6');
    ok('a mirror where P1 wears a palette: P2 keeps its own color', colorFor(courier, 1, courier, { theirs: '#ffe066' }) === courier.color);
    ok('P1 takes its palette as it is', colorFor(courier, 0, intern, { mine: '#ffe066' }) === '#ffe066');
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
