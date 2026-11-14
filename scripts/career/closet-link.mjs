#!/usr/bin/env node
// The sticks counter opens the SUPPLY CLOSET (README, Progression, The Supply Closet): `npm run test:closet:link`, in
// real Chromium against the built game (npm run build, then npm run dev:worker: the crew lobby needs the Worker).
//   node scripts/career/closet-link.mjs [http://127.0.0.1:8787/] [--shots <dir>]
// At 1280x720 (mouse, keys and a stand-in gamepad), 844x390, 667x375 and 390x844 (touch, taps), as a guest:
//   1. on MAIN MENU the counter is a link: a › after it, the bar's height, square, no glow, clear of the ‹ chip and the
//      corner buttons; the legend says C / X CLOSET (desktop)
//   2. from MAIN MENU, SHIFTS, the character select, PROFILE, ONLINE, HIGH SCORES and the crew lobby a press on it opens
//      the closet, whose ‹ chip names that screen, and the chip goes back there
//   3. in the closet the counter is plain text (no ›, a press does nothing)
//   4. desktop: C opens it and Esc comes back; the pad's X opens it and B comes back
//   5. no page errors
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const BASE = (argv.find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/').replace(/\/?$/, '/');
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const until = async (fn, ms = 8000, every = 100) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };

// a crew room for the lobby leg (a guest with a name can open it)
const made = await fetch(BASE + 'api/crews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'CLOSET LINK CREW' }) }).then((r) => r.json()).catch(() => null);
const slug = made && made.slug;
if (!slug) console.log('NOTE  no crew room from the Worker: the crew lobby leg is skipped');

const SIZES = [['desktop', { width: 1280, height: 720 }, false], ['844x390', { width: 844, height: 390 }, true], ['667x375', { width: 667, height: 375 }, true], ['390x844', { width: 390, height: 844 }, true]];
const b = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
try {
  for (const [label, size, touch] of SIZES) {
    const ctx = await b.newContext(touch ? { viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: size });
    await ctx.addInitScript(() => {
      // a stand-in gamepad the test presses (menuInput polls navigator.getGamepads)
      const btn = () => ({ pressed: false, value: 0, touched: false });
      window.__pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, btn), timestamp: 0 };
      navigator.getGamepads = () => (window.__padOn ? [window.__pad] : []);
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('stick-fight-career', JSON.stringify({ career: { xp: 150, sticks: 270 }, nudge: { xp: 150, title: 1 } }));
      localStorage.setItem('stick-fight-player', JSON.stringify({ id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join(''), name: 'ALICE', email: '', crews: [] }));
    });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(BASE + 'play/');
    await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
    await p.evaluate(() => { window.__gauntlet.step(0); let last = performance.now(), k = 0; setInterval(() => { const now = performance.now(), ms = Math.min(100, now - last); last = now; if (++k % 12 === 0) window.__gauntlet.step(ms); else window.__game.advance(ms); }, 8); });
    const state = () => p.evaluate(() => window.__flow.state);
    const at = (s) => until(async () => (await state()) === s);
    const press = async (sel) => { const l = p.locator(sel).first(); if (touch) await l.tap({ force: true }); else await l.click({ force: true }); await sleep(250); };
    const chipText = () => p.evaluate(() => (document.querySelector('#flow .fl-backchip') || {}).textContent || '');
    const d = (fn, arg) => p.evaluate(fn, arg);

    // 1. MAIN MENU: the counter looks pressable and stays out of the way
    await d(() => window.__flow.debug.go('modeSelect')); await at('modeSelect'); await sleep(500);
    const look = await d(() => {
      const c = document.querySelector('#flow .fl-bar .cr-chip'), bk = document.querySelector('#flow .fl-backchip');
      const r = c.getBoundingClientRect(), br = bk.getBoundingClientRect(), cs = getComputedStyle(c);
      const shadows = [c, ...c.querySelectorAll('*')].map((n) => getComputedStyle(n).textShadow).filter((t) => t && t !== 'none');
      const glow = shadows.some((t) => (t.match(/rgba?\([^)]*\)/g) || []).some((x) => !/^rgba?\(4, 1, 10/.test(x)));
      const corners = [...document.querySelectorAll('.sf-top > button, .tc-top > *')].map((n) => n.getBoundingClientRect()).filter((x) => x.width);
      const hit = (a, z) => a.left < z.right && a.right > z.left && a.top < z.bottom && a.bottom > z.top;
      const shown = cs.display !== 'none';
      return { shown, link: c.classList.contains('cr-link'), go: !!c.querySelector('.cr-go'), h: Math.round(r.height), bh: Math.round(br.height), radius: cs.borderRadius, glow,
        overBack: shown && hit(r, br), overCorner: shown && corners.some((z) => hit(r, z)), right: Math.round(r.right), tight: document.querySelector('#flow .fl-bar').className,
        legend: ((document.querySelector('#flow .lg-bar') || {}).innerText || '').replace(/\s+/g, ' ') };
    });
    if (!look.shown) check(`${label}: MAIN MENU counter stepped aside (.fl-tight)`, /fl-tight/.test(look.tight), look.tight);
    else {
      check(`${label}: MAIN MENU counter is a link with a ›`, look.link && look.go);
      check(`${label}: counter is the ‹ chip's height, square, no glow`, look.h === look.bh && look.radius === '0px' && !look.glow, `${look.h} vs ${look.bh}, ${look.radius}`);
      check(`${label}: counter clear of the ‹ chip and the corner buttons`, !look.overBack && !look.overCorner);
    }
    if (!touch) check(`${label}: legend names C CLOSET`, /C\s*CLOSET/.test(look.legend), look.legend);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-modeSelect.png` });

    // 2. from each screen with the counter, into the closet and back by its chip
    const legs = [
      ['modeSelect', 'MAIN MENU', () => window.__flow.debug.go('modeSelect')],
      ['shifts', 'SHIFTS', () => window.__flow.debug.go('shifts')],
      ['charSelect', 'FIGHTERS', () => { const f = window.__flow.debug; f.go('modeSelect'); f.sel.mode = 'arcade'; f.sel.step = 'player'; f.go('charSelect'); }],
      ['profile', 'PROFILE', () => { const f = window.__flow.debug; f.go('modeSelect'); f.go('profile'); }],
      ['onlineMenu', 'ONLINE', () => { const f = window.__flow.debug; f.go('modeSelect'); f.go('onlineMenu'); }],
      ['highScores', 'HIGH SCORES', () => { const f = window.__flow.debug; f.go('modeSelect'); f.go('highScores'); }],
    ];
    if (slug) legs.push(['crewLobby', 'CREW', null]);   // opened by its link (?crew=), below
    for (const [from, name, open] of legs) {
      if (from === 'crewLobby') {
        await p.goto(BASE + `play/?crew=${slug}`);
        await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
        await p.evaluate(() => { window.__gauntlet.step(0); let last = performance.now(), k = 0; setInterval(() => { const now = performance.now(), ms = Math.min(100, now - last); last = now; if (++k % 12 === 0) window.__gauntlet.step(ms); else window.__game.advance(ms); }, 8); });
      } else { await d(() => window.__flow.debug.go('modeSelect')); await at('modeSelect'); await d(open); }
      if (!(await at(from))) { check(`${label}: reach ${from}`, false, await state()); continue; }
      await sleep(500);
      if (SHOTS && from !== 'modeSelect') await p.screenshot({ path: `${SHOTS}/${label}-${from}.png` });
      const vis = await d(() => { const c = document.querySelector('#flow .fl-bar .cr-chip'); return c && getComputedStyle(c).display !== 'none' && c.classList.contains('cr-link'); });
      if (!vis) {   // crowded out on this size (.fl-tight): C and the pad still open it, and the legend says so
        check(`${label}: ${from} counter crowded out by a long chip (C / X still open it)`, await d(() => /fl-tight/.test(document.querySelector('#flow .fl-bar').className)));
        await d(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', key: 'c' })));
        await d(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyC', key: 'c' })));
      } else await press('#flow .fl-bar .cr-chip');
      const got = await at('closet');
      check(`${label}: counter on ${from} opens the closet`, !!got, await state());
      if (!got) continue;
      await sleep(250);
      const chip = await chipText();
      check(`${label}: closet's ‹ chip and legend name ${name}`, chip.includes(name) && (touch || (await d(() => document.querySelector('#flow .lg-bar').textContent)).includes(name)), chip);
      if (from === 'charSelect' && SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-closet-from-charSelect.png` });
      await press('#flow .fl-backchip');
      check(`${label}: the chip goes back to ${from}`, !!(await at(from)), await state());
    }

    // 3. in the closet the counter is plain text
    await d(() => { const f = window.__flow.debug; f.go('modeSelect'); }); await at('modeSelect');
    await p.locator('#flow .fl-bar .cr-chip').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await press('#flow .fl-bar .cr-chip'); await at('closet'); await sleep(250);
    const plain = await d(() => { const c = document.querySelector('#flow .fl-bar .cr-chip'); return !c.classList.contains('cr-link') && !c.querySelector('.cr-go') && getComputedStyle(c).pointerEvents === 'none'; });
    check(`${label}: in the closet the counter is plain text`, plain);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-closet.png` });

    // 4. keys and the pad (desktop)
    if (!touch) {
      await d(() => window.__flow.debug.go('modeSelect')); await at('modeSelect'); await sleep(300);
      await p.keyboard.press('KeyC');
      check(`${label}: C opens the closet`, !!(await at('closet')));
      await sleep(250); await p.keyboard.press('Escape');
      check(`${label}: Esc goes back to MAIN MENU`, !!(await at('modeSelect')));
      await sleep(300);
      const tap = async (i) => { await d((i) => { window.__padOn = true; window.__pad.buttons[i].pressed = true; window.__pad.buttons[i].value = 1; }, i); await sleep(150); await d((i) => { window.__pad.buttons[i].pressed = false; window.__pad.buttons[i].value = 0; }, i); await sleep(250); };
      await tap(2);
      check(`${label}: the pad's X opens the closet`, !!(await at('closet')));
      const padLegend = await d(() => document.documentElement.classList.contains('dev-pad'));
      await tap(1);
      check(`${label}: the pad's B goes back to MAIN MENU`, !!(await at('modeSelect')));
      await sleep(300);
      const lg = await d(() => { const it = [...document.querySelectorAll('#flow .lg-i')].find((n) => /CLOSET/.test(n.textContent)); const g = it && it.querySelector('.lg-p .lg-x'); return g && getComputedStyle(it.querySelector('.lg-p')).display !== 'none' ? g.textContent : ''; });
      check(`${label}: with a pad the legend shows X CLOSET`, padLegend && lg === 'X', lg);
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-modeSelect-pad.png` });
    }
    check(`${label}: no page errors`, !errors.length, errors.join(' | '));
    await ctx.close();
  }
} finally { await b.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
