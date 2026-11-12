#!/usr/bin/env node
// Daily shifts on screen (README, Progression, Daily shifts): `npm run test:shifts:ui`, in real Chromium against the
// built game (npm run build, then wrangler dev or npm run dev:worker; a guest needs no Worker calls, but the page
// is served from there).
//   node scripts/career/shifts-ui.mjs [http://127.0.0.1:8787/] [--shots <dir>]
// At 1280x720 and 390x844 (touch), as a guest, on a day picked so one shift is "WIN A ROUND WITH <fighter>" (the
// page's clock is moved there: only Date.now, which is all utcDay reads):
//   1. MAIN MENU shows TODAY'S SHIFTS, the day's three titles from src/career/shifts.js, on screen, no glow
//   2. the SHIFTS screen: a card each with TEACHES: and a coaching line, HOW TO PLAY opening the guide page in a new
//      tab, SWAP asking first and swapping on the second press (the slot gets the day's replacement, no more SWAPs)
//   3. an arcade stage won with that fighter: STAGE CLEAR has SHIFT DONE: WIN A ROUND WITH ... in the earnings and the
//      shift ticks with it DONE; the main menu then shows it DONE too. No page errors.
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
import fs from 'node:fs';
import { shiftsFor, SHIFT_PAY } from '../../src/career/shifts.js';

const argv = process.argv.slice(2);
const BASE = (argv.find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/').replace(/\/?$/, '/');
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const until = async (fn, ms = 15000, every = 100) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };
const flowText = (p) => p.evaluate(() => document.querySelector('#flow').innerText.replace(/\s+/g, ' '));
const state = (p) => p.evaluate(() => window.__flow.state);
const plainOnly = (p, sel) => p.evaluate((sel) => {
  const bad = [];
  for (const n of document.querySelectorAll(`${sel}, ${sel} *`)) {
    const ts = getComputedStyle(n).textShadow;
    if (ts && ts !== 'none' && (ts.match(/rgba?\([^)]*\)/g) || []).some((c) => !/^rgba?\(4, 1, 10/.test(c))) bad.push(`${n.className}: ${ts}`);
  }
  return bad;
}, sel);
const onScreen = async (p, sel) => { const bb = await p.locator(sel).first().boundingBox(), vp = p.viewportSize(); return bb && bb.y >= 0 && bb.x >= 0 && bb.y + bb.height <= vp.height + 1 && bb.x + bb.width <= vp.width + 1 ? bb : null; };

// a day from today on whose shifts include a fighter one, with no swap
const DAY_MS = 86400000, now = Date.now();
let offset = 0;
for (let k = 0; k < 60; k++) { const d = new Date(now + k * DAY_MS).toISOString().slice(0, 10); if (shiftsFor(d).some((s) => s.kind === 'fighter')) { offset = k * DAY_MS; break; } }
const DAY = new Date(now + offset).toISOString().slice(0, 10), LIST = shiftsFor(DAY);
const FI = LIST.findIndex((s) => s.kind === 'fighter'), FS = LIST[FI];
console.log(`      the page's day: ${DAY}: ${LIST.map((s) => s.title).join(' / ')}`);

const b = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
try {
  for (const [label, size, touch] of [['desktop', { width: 1280, height: 720 }, false], ['upright', { width: 390, height: 844 }, true]]) {
    const ctx = await b.newContext(touch ? { viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: size });
    await ctx.addInitScript((offset) => {
      const real = Date.now.bind(Date);
      Date.now = () => real() + offset;   // utcDay() reads Date.now: the page lives on the test's day
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('stick-fight-career', JSON.stringify({ career: { xp: 150, sticks: 120, nudge: { xp: 150, title: 1 } }, nudge: { xp: 150, title: 1 } }));
      localStorage.setItem('stick-fight-player', JSON.stringify({ id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join(''), name: 'ALICE', email: '', crews: [] }));
    }, offset);
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(BASE + 'play/');
    await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
    await p.evaluate(() => { window.__gauntlet.step(0); let last = performance.now(), k = 0; setInterval(() => { const now = performance.now(), ms = Math.min(100, now - last); last = now; if (window.__hold) return; if (++k % 12 === 0) window.__gauntlet.step(ms); else window.__game.advance(ms); }, 8); });

    // 1. MAIN MENU
    await p.evaluate(() => window.__flow.debug.go('modeSelect')); await sleep(700);
    let txt = await flowText(p);
    check(`${label}: MAIN MENU shows TODAY'S SHIFTS with the day's three`, /TODAY'S SHIFTS/.test(txt) && LIST.every((s) => txt.includes(s.title)), txt.slice(0, 300));
    check(`${label}: ...each paying ${SHIFT_PAY.sticks} sticks`, (txt.match(new RegExp(`\\+${SHIFT_PAY.sticks}\\b`, 'g')) || []).length >= 3);
    check(`${label}: the panel is on screen`, !!(await onScreen(p, '.sh-menu')));
    check(`${label}: its text never glows`, (await plainOnly(p, '.sh-menu')).length === 0, (await plainOnly(p, '.sh-menu')).slice(0, 2).join(' | '));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-1-menu.png` });

    // 2. the SHIFTS screen
    await p.locator('#flow .fl-btn', { hasText: 'SHIFTS' }).first().click({ force: true });
    await until(async () => (await state(p)) === 'shifts'); await sleep(500);
    txt = await flowText(p);
    check(`${label}: SHIFTS has a card per shift`, (await p.locator('.sh-card').count()) === 3);
    check(`${label}: each teaching shift names what it teaches and coaches in plain words`, LIST.every((s) => !s.mechanic || (txt.includes(`TEACHES: ${s.mechanic}`) && txt.includes(s.coach))), txt.slice(0, 400));
    check(`${label}: the cards are on screen and plain`, !!(await onScreen(p, '.sh-cards')) && (await plainOnly(p, '.sh-cards')).length === 0);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-2-shifts.png` });
    const gi = LIST.findIndex((s) => s.guide);
    const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), p.locator('.sh-card').nth(gi).locator('.fl-btn', { hasText: 'HOW TO PLAY' }).click({ force: true })]);
    const want = new URL(LIST[gi].guide, BASE).href;
    check(`${label}: HOW TO PLAY opens the guide page for "${LIST[gi].title}" in a new tab`, popup && popup.url() === want, popup ? popup.url() : 'no tab');
    if (popup) {
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      const hash = new URL(want).hash;
      if (hash) check(`${label}: ...and the page has that section (${hash})`, (await popup.locator(hash).count()) === 1);
      await popup.close();
    }
    // swap the slot that isn't the fighter one
    const slot = [0, 1, 2].find((i) => i !== FI);
    const swapBtn = () => p.locator('.sh-card').nth(slot).locator('.fl-btn', { hasText: 'SWAP' });
    await swapBtn().click({ force: true }); await sleep(250);
    txt = await flowText(p);
    check(`${label}: SWAP asks first`, /SWAP IT\? PRESS AGAIN/.test(txt) && /ONE SWAP A DAY/.test(txt) && txt.includes(LIST[slot].title));
    await p.locator('.sh-card').nth(slot).locator('.fl-btn', { hasText: 'PRESS AGAIN' }).click({ force: true }); await sleep(500);
    txt = await flowText(p);
    const swapped = shiftsFor(DAY, slot)[slot];
    check(`${label}: the second press swaps "${LIST[slot].title}" for "${swapped.title}"`, txt.includes(swapped.title) && !txt.includes(LIST[slot].title), txt.slice(0, 300));
    check(`${label}: ...and that was today's one swap`, (await p.locator('.sh-card .fl-btn', { hasText: 'SWAP' }).count()) === 0 && /USED TODAY'S SWAP/.test(txt));
    const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('stick-fight-career')).career.shifts);
    check(`${label}: a guest keeps it in localStorage`, stored && stored.day === DAY && stored.swap === slot, JSON.stringify(stored));

    // 3. win an arcade stage with the shift's fighter
    await p.evaluate(() => { window.__flow.debug.go('modeSelect'); }); await sleep(300);
    await p.locator('#flow .fl-btn', { hasText: 'ARCADE' }).first().click({ force: true });
    await until(async () => (await state(p)) === 'charSelect'); await sleep(500);
    await p.evaluate((f) => { window.__flow.debug.sel.player = f; window.__flow.debug.pickChar(f); }, FS.f);
    await until(async () => (await state(p)) === 'stageIntro');
    await p.evaluate(() => window.__flow.debug.go('fighting'));
    for (let k = 0; k < 6 && (await state(p)) !== 'stageClear'; k++) {
      await until(async () => (await p.evaluate(() => window.__game.sim.phase)) === 'fight' || (await state(p)) === 'stageClear', 12000);
      await sleep(2500);
      await p.evaluate(() => window.__flow.debug.debugKO(0));
      await until(async () => (await p.evaluate(() => window.__game.sim.phase)) !== 'fight', 4000);
    }
    const clear = await until(async () => (await state(p)) === 'stageClear', 15000, 50);
    if (!clear) console.log('      not at STAGE CLEAR:', await state(p), await p.evaluate(() => [window.__game.sim.phase, window.__game.sim.wins, window.__flow.debug.mode]));
    await p.evaluate(() => { window.__hold = true; window.__gauntlet.step(0); });
    await sleep(500);
    txt = await flowText(p);
    check(`${label}: STAGE CLEAR pays SHIFT DONE: ${FS.title}`, txt.includes(`SHIFT DONE: ${FS.title} +${SHIFT_PAY.xp} +${SHIFT_PAY.sticks}`), txt.slice(0, 500));
    check(`${label}: the shift ticks are on the result screen, that one DONE`, /TODAY'S SHIFTS/.test(txt) && txt.includes(`${FS.title} DONE`) && (await p.locator('.sh-resrow.sh-moved.sh-done').count()) === 1);
    check(`${label}: the earnings panel (with the ticks) is on screen and plain`, !!(await onScreen(p, '.cr-earn')) && (await plainOnly(p, '.cr-earn')).length === 0, JSON.stringify(await p.locator('.cr-earn').boundingBox()));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-3-clear.png` });
    await p.evaluate(() => { window.__hold = false; window.__flow.debug.go('modeSelect'); }); await sleep(600);
    txt = await flowText(p);
    check(`${label}: MAIN MENU shows it DONE`, (await p.locator('.sh-row.sh-done').count()) === 1 && txt.includes(FS.title));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-4-menu-done.png` });
    check(`${label}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
} finally { await b.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
