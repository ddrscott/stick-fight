#!/usr/bin/env node
// Career and sticks on screen (README, Progression): `npm run test:career:ui`, in real Chromium against wrangler dev
// (npm run build && npm run dev:worker, DEV_LOGIN_CODES=1, the migrations applied locally).
//   node scripts/career/ui.mjs [http://127.0.0.1:8787/] [--shots <dir>]
// At 1280x720 and 390x844 (touch), as a guest one win short of INTERN with 300 sticks:
//   1. an arcade stage won: STAGE CLEAR shows PROMOTED: INTERN, BASE, WIN, FIRST WIN TODAY in plain words, the review
//      bar and the new total; the text has no glow (only the dark outline)
//   2. the sticks counter shows on the menus and not in a fight
//   3. the save nudge shows once on MAIN MENU and not again on the next visit (no nagging)
//   4. character select: a palette too dear says so; one in reach takes two presses and is bought; the fight draws it
// Desktop only, then: SAVE MY PROFILE from the nudge goes through the age question, the email and the dev code, and
// the account has the guest's career (merged once), with PROFILE showing the title and the bar. No page errors.
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
import fs from 'node:fs';

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
/** every text-shadow in the selector's subtree: only the dark outline (rgba(4, 1, 10, ...)), never a colored glow */
const plainOnly = (p, sel) => p.evaluate((sel) => {
  const bad = [];
  for (const n of document.querySelectorAll(`${sel}, ${sel} *`)) {
    const ts = getComputedStyle(n).textShadow;
    if (ts && ts !== 'none' && (ts.match(/rgba?\([^)]*\)/g) || []).some((c) => !/^rgba?\(4, 1, 10/.test(c))) bad.push(`${n.className}: ${ts}`);
  }
  return bad;
}, sel);

const b = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
try {
  for (const [label, size, touch] of [['desktop', { width: 1280, height: 720 }, false], ['upright', { width: 390, height: 844 }, true]]) {
    const ctx = await b.newContext(touch ? { viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: size });
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('stick-fight-last-pick', 'temp');
      // today's shifts already done, so no shift pays on top of what this test counts (scripts/career/shifts-ui.mjs covers them)
      localStorage.setItem('stick-fight-career', JSON.stringify({ career: { xp: 95, sticks: 300, shifts: { day: new Date().toISOString().slice(0, 10), swap: -1, prog: [9, 9, 9], done: [true, true, true] } } }));
      localStorage.setItem('stick-fight-player', JSON.stringify({ id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join(''), name: 'ALICE', email: '', crews: [] }));
    });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(BASE + 'play/');
    await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
    // the game's frames, pumped from a timer (software GL starves the frame loop); __hold stops time while the test reads a screen
    // (__gauntlet.step drives the page: its own frame loop stops, so only the pump moves time; every 12th step draws)
    await p.evaluate(() => { window.__gauntlet.step(0); let last = performance.now(), k = 0; setInterval(() => { const now = performance.now(), ms = Math.min(100, now - last); last = now; if (window.__hold) return; if (++k % 12 === 0) window.__gauntlet.step(ms); else window.__game.advance(ms); }, 8); });

    // 3 (first, so it's the nudge's first showing): MAIN MENU, the counter and the nudge
    await p.evaluate(() => window.__flow.debug.go('modeSelect')); await sleep(600);
    let txt = await flowText(p);
    check(`${label}: MAIN MENU shows the counter: 300 STICKS, TEMP`, /300 STICKS TEMP/.test(txt), txt.slice(0, 120));
    check(`${label}: and the save nudge (300 sticks is past 200)`, /YOU'VE GOT 300 STICKS AND YOU'RE A TEMP/.test(txt) && /SAVE MY PROFILE/.test(txt));
    await p.evaluate(() => { window.__flow.debug.go('attract'); window.__flow.debug.go('modeSelect'); }); await sleep(500);
    check(`${label}: the next visit doesn't show it again`, !/YOU'VE GOT/.test(await flowText(p)));
    if (label === 'upright') {   // a player who answered UNDER 13 can't save a profile: never asked, however much they have
      await p.evaluate(() => { localStorage.setItem('stick-fight-age', 'under13'); const c = JSON.parse(localStorage.getItem('stick-fight-career')); c.career.xp = 2000; localStorage.setItem('stick-fight-career', JSON.stringify(c)); window.__flow.debug.go('attract'); window.__flow.debug.go('modeSelect'); });
      await sleep(400);
      check(`${label}: an UNDER 13 player is never nudged`, !/YOU'VE GOT/.test(await flowText(p)));
      await p.evaluate(() => { localStorage.removeItem('stick-fight-age'); const c = JSON.parse(localStorage.getItem('stick-fight-career')); c.career.xp = 95; c.nudge = { xp: 95, title: 0 }; localStorage.setItem('stick-fight-career', JSON.stringify(c)); });
    }

    // 4: character select, TEMP's palettes
    await p.locator('#flow .fl-btn', { hasText: 'ARCADE' }).first().click({ force: true });
    await until(async () => (await state(p)) === 'charSelect');
    await sleep(800);
    // the mouse is where ARCADE was, which may be over a card: put the cursor on TEMP's (a hover focuses, a click picks)
    if (!touch) { await p.locator('#flow .fl-card', { hasText: /^TEMP$/ }).hover({ force: true }); await sleep(200); }
    const pal = p.locator('#flow .fl-pal');
    check(`${label}: character select has the palette strip (MAIN + 3 + the mastery palette)`, (await pal.count()) === 5);
    await pal.nth(3).click({ force: true }); await sleep(300);
    check(`${label}: a palette too dear says what it costs and what you have`, /CORPORATE COSTS 600 STICKS · YOU HAVE 300/.test(await p.locator('#flow .fl-palnote').innerText()));
    await pal.nth(1).click({ force: true }); await sleep(300);
    check(`${label}: one in reach asks first`, /BUY CASUAL FRIDAY FOR 150 STICKS\? PRESS AGAIN/.test(await p.locator('#flow .fl-palnote').innerText()));
    const c1 = await p.evaluate(() => JSON.parse(localStorage.getItem('stick-fight-career')).career);
    check(`${label}: ... and spends nothing yet`, c1.sticks === 300 && !c1.owned.length);
    await pal.nth(1).click({ force: true }); await sleep(400);
    const c2 = await p.evaluate(() => JSON.parse(localStorage.getItem('stick-fight-career')).career);
    check(`${label}: the second press buys it: 150 spent, owned, in use`, c2.sticks === 150 && c2.owned.includes('temp:casualFriday') && c2.equip.temp === 'casualFriday', JSON.stringify(c2));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-1-select.png` });
    await p.evaluate(() => { window.__flow.debug.sel.player = 'temp'; window.__flow.debug.pickChar('temp'); });
    await until(async () => (await state(p)) === 'stageIntro');
    await p.evaluate(() => window.__flow.debug.go('fighting'));
    await sleep(300);
    check(`${label}: the fight draws the palette (P1 in CASUAL FRIDAY's body color)`, (await p.evaluate(() => window.__game.sim.units[0].color)) === '#7dd3ff');
    check(`${label}: the counter is off in a fight`, await p.evaluate(() => getComputedStyle(document.querySelector('.cr-chip')).display === 'none'));

    // 1: win the stage: two KOs
    for (let k = 0; k < 6 && (await state(p)) !== 'stageClear'; k++) {
      await until(async () => (await p.evaluate(() => window.__game.sim.phase)) === 'fight' || (await state(p)) === 'stageClear', 12000);
      await sleep(2500);
      await p.evaluate(() => window.__flow.debug.debugKO(0));
      await until(async () => (await p.evaluate(() => window.__game.sim.phase)) !== 'fight', 4000);
    }
    const clear = await until(async () => (await state(p)) === 'stageClear', 15000, 50);
    await p.evaluate(() => { window.__hold = true; window.__gauntlet.step(0); });   // STAGE CLEAR moves on by itself after 5 s: hold the game's time while it's read
    await sleep(600);   // (the PROMOTED stamp is a CSS animation, which runs on)
    const panel = await p.locator('.cr-earn').boundingBox(), vp = p.viewportSize();
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-2-clear.png` });
    txt = await flowText(p);
    check(`${label}: STAGE CLEAR shows PROMOTED: INTERN`, !!clear && /PROMOTED INTERN/.test(txt), txt.slice(0, 200));
    check(`${label}: the earnings: BASE, WIN, FIRST WIN TODAY, TOTAL, in plain words`, /BASE \+10 \+10/.test(txt) && /WIN \+10 \+10/.test(txt) && /FIRST WIN TODAY \+50 \+100/.test(txt) && /TOTAL/.test(txt), txt.slice(0, 400));
    check(`${label}: it says the first win today pays extra`, /YOUR FIRST WIN TODAY PAYS EXTRA/.test(txt));
    check(`${label}: the review bar and the new total`, /INTERN PERFORMANCE REVIEW/.test(txt) && /NEXT: ASSOCIATE/.test(txt) && /270 STICKS/.test(txt));
    const glow = await plainOnly(p, '.cr-earn');
    check(`${label}: readable text never glows (the panel)`, glow.length === 0, glow.slice(0, 2).join(' | '));
    check(`${label}: the panel is on screen`, panel && panel.y >= 0 && panel.y + panel.height <= vp.height, JSON.stringify(panel));
    check(`${label}: the counter text never glows either`, (await plainOnly(p, '.cr-chip')).length === 0);
    await p.evaluate(() => { window.__hold = false; });

    if (label === 'desktop') {
      // the nudge again after the promotion, on the high scores after a game; SAVE MY PROFILE goes through the usual flow
      await p.evaluate(() => { const f = window.__flow; f.debug.go('modeSelect'); });
      await sleep(500);
      txt = await flowText(p);
      check('desktop: after the promotion the nudge comes back once', /YOU'VE GOT 270 STICKS AND YOU'RE AN INTERN/.test(txt), txt.slice(0, 160));
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-3-nudge.png` });
      const guest = await p.evaluate(() => JSON.parse(localStorage.getItem('stick-fight-career')).career);
      await p.locator('#flow .fl-btn', { hasText: 'SAVE MY PROFILE' }).click({ force: true });
      await until(async () => (await state(p)) === 'ageCheck');
      await p.locator('#flow .fl-btn', { hasText: '13 OR OLDER' }).click({ force: true });
      await until(async () => (await state(p)) === 'signInEmail');
      const email = `career-ui-${Date.now()}@example.com`;
      await p.keyboard.type(email); await p.keyboard.press('Enter');
      const codeTxt = await until(async () => { const t = await flowText(p); const m = /YOUR CODE IS (\d{6})/.exec(t); return m && m[1]; });
      check('desktop: the email screen sends a code (dev)', !!codeTxt);
      await p.keyboard.type(codeTxt || '000000'); await p.keyboard.press('Enter');
      await until(async () => (await state(p)) === 'profile');
      const acct = await until(async () => { const r = await (await ctx.request.get(BASE + 'api/career')).json(); return r.career && r.career.xp > 0 ? r.career : null; });
      check('desktop: the account has the guest\'s career (merged once)', acct && acct.xp === guest.xp && acct.sticks === guest.sticks && guest.sticks === 270 && acct.owned.includes('temp:casualFriday') && acct.title === 'INTERN', JSON.stringify(acct));
      await sleep(600);
      txt = await flowText(p);
      check('desktop: PROFILE shows the title, the bar and the sticks', /INTERN PERFORMANCE REVIEW/.test(txt) && /270 STICKS/.test(txt), txt.slice(0, 300));
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-4-profile.png` });
      const mirror = await p.evaluate(() => JSON.parse(localStorage.getItem('stick-fight-career')));
      check('desktop: this device now mirrors the account', mirror.email === email && mirror.career.xp === guest.xp);
      await p.reload();
      await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
      await sleep(1500);
      const again = await (await ctx.request.get(BASE + 'api/career')).json();
      check('desktop: a reload doesn\'t merge again (nothing doubled)', again.career.xp === guest.xp && again.career.sticks === guest.sticks, JSON.stringify(again.career));
    }
    check(`${label}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // online: each side fights in its own palette and the other page draws it; the host's title shows on the guest's pick screen
  {
    const pg = async (url, career, name, idc) => {
      const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
      await ctx.addInitScript((kv) => { for (const k in kv) if (localStorage.getItem(k) === null) localStorage.setItem(k, kv[k]); },
        { 'stick-fight-career': JSON.stringify({ career }), 'stick-fight-player': JSON.stringify({ id: idc.repeat(32), name, email: '', crews: [] }) });
      const p = await ctx.newPage();
      p.errors = []; p.on('pageerror', (e) => p.errors.push(String(e)));
      await p.goto(url);
      await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
      await p.evaluate(() => { let last = performance.now(), k = 0; setInterval(() => { const now = performance.now(), ms = Math.min(100, now - last); last = now; if (++k % 12 === 0) window.__gauntlet.step(ms); else window.__game.advance(ms); }, 8); });
      return p;
    };
    // the host has TEMP's taunt (fighter mastery 2) on: its look rides the start message as casualFriday+t
    const H = await pg(BASE + 'play/', { xp: 150, sticks: 0, owned: ['temp:casualFriday', 'temp:taunt:taunt'], equip: { temp: 'casualFriday', 'temp:taunt': 'taunt' }, mastery: { temp: { xp: 300, n: 9 } } }, 'HOSTY', 'a');
    await H.evaluate(() => { const f = window.__flow.debug; f.go('modeSelect'); f.go('onlineMenu'); f.go('onlineHost'); });
    const code = await until(() => H.evaluate(() => (window.__net.state === 'waiting' && window.__net.code) || null), 30000);
    const G = await pg(`${BASE}room/${code}`, { xp: 0, sticks: 0, owned: ['courier:express'], equip: { courier: 'express' } }, 'GUESTY', 'b');
    const both = await until(async () => (await state(H)) === 'onlineSelect' && (await state(G)) === 'onlineSelect', 30000);
    check('online: host and guest on the pick screen', !!both);
    await G.evaluate(() => window.__flow.debug.getNet().pick('courier', true));
    await H.evaluate(() => window.__flow.debug.getNet().pick('temp', true));
    const sees = await until(async () => /HOSTY · INTERN/.test(await flowText(G)), 8000);
    check('online: the guest\'s pick screen shows the host as HOSTY · INTERN', !!sees);
    await sleep(500);
    await H.evaluate(() => window.__flow.debug.getNet().startNow());
    const fighting = await until(async () => (await state(H)) === 'onlineFighting' && (await state(G)) === 'onlineFighting', 20000);
    check('online: the match starts', !!fighting);
    await sleep(800);
    const hc = await H.evaluate(() => window.__game.sim.units.slice(0, 2).map((u) => u.color));
    const gc = await G.evaluate(() => window.__game.sim.units.slice(0, 2).map((u) => u.color));
    check('online: the host\'s page draws both palettes (CASUAL FRIDAY, EXPRESS)', hc[0] === '#7dd3ff' && hc[1] === '#ffe066', hc.join(' '));
    check('online: the guest\'s page draws the same', gc[0] === '#7dd3ff' && gc[1] === '#ffe066', gc.join(' '));
    const kits = await G.evaluate(() => window.__game.sim.units.map((u) => u.taunt));
    check('online: the guest\'s sim has the host\'s taunt (fighter mastery) and none for itself', kits[0] === 'temp_taunt' && kits[1] === null, JSON.stringify(kits));
    if (SHOTS) { await G.evaluate(() => window.__gauntlet.step(0)); await G.screenshot({ path: `${SHOTS}/online-guest.png` }); }
    check('online: no page errors', !H.errors.length && !G.errors.length, [...H.errors, ...G.errors].join(' | '));
  }
} finally { await b.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
