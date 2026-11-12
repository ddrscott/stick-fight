#!/usr/bin/env node
// PTO on screen (README, Progression, PTO): `npm run test:pto:ui`, in real Chromium against the built game
// (npm run build, then wrangler dev or npm run dev:worker; a guest needs no Worker calls, but the page is served there).
//   node scripts/career/pto-ui.mjs [http://127.0.0.1:8787/] [--shots <dir>]
// At 1280x720 and 390x844 (touch), as a guest whose last match was 4 days ago (3 whole days away):
//   1. MAIN MENU says WELCOME BACK: YOUR NEXT 3 MATCHES PAY DOUBLE XP, on screen, no glow, nothing about a streak or loss
//   2. an arcade stage won: STAGE CLEAR has a PTO ×2 line paying the match XP again, and says 2 more do too
//   3. MAIN MENU then says PTO: YOUR NEXT 2 MATCHES PAY DOUBLE XP; localStorage keeps today and 2
//   4. a player who played yesterday sees no PTO line at all. No page errors.
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
import fs from 'node:fs';
import { utcDay } from '../../src/career/rules.js';

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
const LOSS = /STREAK|LOST|LOSE YOUR|MISSED|RESET|EXPIRED|BROKE/;
const TODAY = utcDay(), AGO = (n) => utcDay(Date.now() - n * 86400000);

const b = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
const open = async (size, touch, pto) => {
  const ctx = await b.newContext(touch ? { viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: size });
  await ctx.addInitScript(({ pto }) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    // today's first win already taken, so the numbers are the match's own
    localStorage.setItem('stick-fight-career', JSON.stringify({ career: { xp: 150, sticks: 120, winDay: new Date().toISOString().slice(0, 10), pto }, nudge: { xp: 150, title: 1 } }));
    localStorage.setItem('stick-fight-player', JSON.stringify({ id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join(''), name: 'ALICE', email: '', crews: [] }));
  }, { pto });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + 'play/');
  await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
  await p.evaluate(() => { window.__gauntlet.step(0); let last = performance.now(), k = 0; setInterval(() => { const now = performance.now(), ms = Math.min(100, now - last); last = now; if (window.__hold) return; if (++k % 12 === 0) window.__gauntlet.step(ms); else window.__game.advance(ms); }, 8); });
  return { ctx, p, errors };
};

try {
  for (const [label, size, touch] of [['desktop', { width: 1280, height: 720 }, false], ['upright', { width: 390, height: 844 }, true]]) {
    const { ctx, p, errors } = await open(size, touch, { day: AGO(4), bank: 0 });

    // 1. MAIN MENU
    await p.evaluate(() => window.__flow.debug.go('modeSelect')); await sleep(700);
    let txt = await flowText(p);
    check(`${label}: MAIN MENU says WELCOME BACK: YOUR NEXT 3 MATCHES PAY DOUBLE XP`, txt.includes('WELCOME BACK: YOUR NEXT 3 MATCHES PAY DOUBLE XP'), txt.slice(0, 300));
    check(`${label}: ...on screen, with the shifts and the SHIFTS button`, !!(await onScreen(p, '.pto-menu.pto-on')) && !!(await onScreen(p, '.sh-menu')) && !!(await onScreen(p, '.sh-menu .fl-btn')));
    check(`${label}: ...plain text, no glow`, (await plainOnly(p, '.pto-menu')).length === 0, (await plainOnly(p, '.pto-menu')).join(' | '));
    check(`${label}: nothing on the menu about a streak or a loss`, !LOSS.test(txt));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-1-menu.png` });

    // 2. win an arcade stage
    await p.locator('#flow .fl-btn', { hasText: 'ARCADE' }).first().click({ force: true });
    await until(async () => (await state(p)) === 'charSelect'); await sleep(500);
    await p.evaluate(() => { window.__flow.debug.sel.player = 'barista'; window.__flow.debug.pickChar('barista'); });
    await until(async () => (await state(p)) === 'stageIntro');
    await p.evaluate(() => window.__flow.debug.go('fighting'));
    for (let k = 0; k < 6 && (await state(p)) !== 'stageClear'; k++) {
      await until(async () => (await p.evaluate(() => window.__game.sim.phase)) === 'fight' || (await state(p)) === 'stageClear', 12000);
      await sleep(2500);
      await p.evaluate(() => window.__flow.debug.debugKO(0));
      await until(async () => (await p.evaluate(() => window.__game.sim.phase)) !== 'fight', 4000);
    }
    await until(async () => (await state(p)) === 'stageClear', 15000, 50);
    await p.evaluate(() => { window.__hold = true; window.__gauntlet.step(0); });
    await sleep(500);
    txt = await flowText(p);
    const award = await p.evaluate(() => { const c = JSON.parse(localStorage.getItem('stick-fight-career')).career; return c; });
    const mx = await p.evaluate(() => [...document.querySelectorAll('.cr-lines > span')].map((s) => s.textContent));
    const pi = mx.indexOf('PTO ×2');
    check(`${label}: STAGE CLEAR has a PTO ×2 line`, pi >= 0, mx.join(' | '));
    check(`${label}: ...paying the match XP again (BASE + WIN = +20) and no sticks`, pi >= 0 && mx[pi + 1] === '+20' && mx[pi + 2] === '+0', mx.slice(pi, pi + 3).join(' '));
    check(`${label}: ...and says so: 2 more do too`, txt.includes('PTO: THIS MATCH PAID DOUBLE XP FOR COMING BACK. 2 MORE DO TOO.'), txt.slice(0, 600));
    check(`${label}: the earnings panel is on screen and plain`, !!(await onScreen(p, '.cr-earn')) && (await plainOnly(p, '.cr-earn')).length === 0);
    check(`${label}: nothing on the result screen about a streak or a loss`, !LOSS.test(txt));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-2-clear.png` });

    // 3. back to MAIN MENU
    await p.evaluate(() => { window.__hold = false; window.__flow.debug.go('modeSelect'); }); await sleep(600);
    txt = await flowText(p);
    check(`${label}: MAIN MENU now says PTO: YOUR NEXT 2 MATCHES PAY DOUBLE XP`, txt.includes('PTO: YOUR NEXT 2 MATCHES PAY DOUBLE XP') && !txt.includes('WELCOME BACK'), txt.slice(0, 300));
    check(`${label}: a guest keeps it in localStorage: today, 2 left`, award.pto && award.pto.day === TODAY && award.pto.bank === 2, JSON.stringify(award.pto));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-3-menu-after.png` });
    check(`${label}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();

    // 4. played yesterday: no PTO line
    const y = await open(size, touch, { day: AGO(1), bank: 0 });
    await y.p.evaluate(() => window.__flow.debug.go('modeSelect')); await sleep(700);
    txt = await flowText(y.p);
    check(`${label}: played yesterday, no PTO line and nothing about missing out`, (await y.p.locator('.pto-menu.pto-on').count()) === 0 && !/PTO|WELCOME BACK/.test(txt) && !LOSS.test(txt));
    await y.ctx.close();
  }
} finally { await b.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
