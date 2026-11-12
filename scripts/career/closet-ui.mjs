#!/usr/bin/env node
// The Supply Closet on screen (README, Progression, The Supply Closet): `npm run test:closet:ui`, in real Chromium
// against the built game (npm run build, then npm run dev:worker; a guest needs no Worker calls).
//   node scripts/career/closet-ui.mjs [http://127.0.0.1:8787/] [--shots <dir>]
// At 1280x720 (mouse) and 390x844 (touch, taps), as a guest with 320 sticks:
//   1. MAIN MENU has SUPPLY CLOSET; the screen shows COLLECTED 0 / n, a tab per fighter with its count, sticks to spend
//   2. BARISTA's shelf: MAIN in full, the 150 and 300 palettes BUY, the 600 one SHORT; locked cards read LOCKED and the
//      price, and their figure is a one-color silhouette (every drawn pixel the same dark fill)
//   3. buying: the first press only asks, the second spends the sticks, the card turns IN USE in full, the counts go up;
//      a press on one you can't afford says the price and spends nothing
//   4. equipping: MAIN puts the own look back, the palette puts it on again; character select shows it IN USE
//   5. mastery (fighter mastery's real items, with the test's ranks): the pose reads BARISTA MASTERY 4 while locked, a
//      press says how to get it, unlocked at rank 4 and counted
//   6. it's on screen, no text glows, no page errors
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
import fs from 'node:fs';
import { palettesFor } from '../../src/career/palettes.js';

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
const saved = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('stick-fight-career')).career);
const plainOnly = (p, sel) => p.evaluate((sel) => {
  const bad = [];
  for (const n of document.querySelectorAll(`${sel}, ${sel} *`)) {
    const ts = getComputedStyle(n).textShadow;
    if (ts && ts !== 'none' && (ts.match(/rgba?\([^)]*\)/g) || []).some((c) => !/^rgba?\(4, 1, 10/.test(c))) bad.push(`${n.className}: ${ts}`);
  }
  return bad;
}, sel);
const inView = async (p, sel) => { const bb = await p.locator(sel).first().boundingBox(), vp = p.viewportSize(); return bb && bb.y >= -1 && bb.x >= -1 && bb.y + bb.height <= vp.height + 1 && bb.x + bb.width <= vp.width + 1 ? bb : null; };
/** the colors drawn on a card's canvas: how many pixels drawn, how many distinct fully opaque colors (an edge's
 *  partial alpha rounds its color on the way back out of getImageData), and whether they're all the silhouette */
const inks = (p, key) => p.evaluate((key) => {
  const cv = document.querySelector(`.cl-card[data-item="${key}"] canvas`);
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, seen = new Set();
  let drawn = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) drawn++;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
  return { drawn, colors: seen.size, sil: [...seen].every((c) => c === '42,33,64') };
}, key);

const F = 'barista', PALS = palettesFor(F).slice().sort((a, b) => a.price - b.price);
const [P1, P2, P3] = PALS, K = (p) => `${F}:${p.id}`;

const b = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
try {
  for (const [label, size, touch] of [['desktop', { width: 1280, height: 720 }, false], ['upright', { width: 390, height: 844 }, true]]) {
    const ctx = await b.newContext(touch ? { viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: size });
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('stick-fight-career', JSON.stringify({ career: { xp: 150, sticks: 320 }, nudge: { xp: 150, title: 1 } }));
      localStorage.setItem('stick-fight-player', JSON.stringify({ id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join(''), name: 'ALICE', email: '', crews: [] }));
    });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(BASE + 'play/');
    await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
    await p.evaluate(() => { window.__gauntlet.step(0); let last = performance.now(), k = 0; setInterval(() => { const now = performance.now(), ms = Math.min(100, now - last); last = now; if (++k % 12 === 0) window.__gauntlet.step(ms); else window.__game.advance(ms); }, 8); });
    const press = async (sel) => { const l = p.locator(sel).first(); if (touch) await l.tap({ force: true }); else await l.click({ force: true }); await sleep(250); };
    const card = (key) => `.cl-card[data-item="${key}"]`;
    const st = (key) => p.locator(card(key)).getAttribute('data-state');

    // 1. MAIN MENU → SUPPLY CLOSET
    await p.evaluate(() => window.__flow.debug.go('modeSelect')); await sleep(600);
    check(`${label}: MAIN MENU has SUPPLY CLOSET`, (await p.locator('#flow .fl-btn', { hasText: 'SUPPLY CLOSET' }).count()) === 1);
    await press('#flow .fl-btn:has-text("SUPPLY CLOSET")');
    await until(async () => (await state(p)) === 'closet'); await sleep(300);
    const roster = await p.evaluate(() => [...document.querySelectorAll('.cl-tab')].map((t) => t.dataset.fighter));
    let txt = await flowText(p);
    const total = await p.evaluate(() => Number((document.querySelector('.cl-total').textContent.match(/\/ (\d+)/) || [])[1]));
    check(`${label}: COLLECTED 0 / n up top, n counting every fighter's items`, /COLLECTED 0 \/ \d+/.test(txt) && total >= roster.length * 3, `${total} for ${roster.length}`);
    check(`${label}: 320 STICKS TO SPEND`, txt.includes('320 STICKS TO SPEND'));
    check(`${label}: a tab per fighter, each with its count`, roster.length >= 9 && roster.includes(F) && (await p.locator('.cl-tab .cl-tcount').allTextContents()).every((t) => /^0\/\d+$/.test(t)));

    // 2. BARISTA's shelf
    await press(`.cl-tab[data-fighter="${F}"]`);
    check(`${label}: the tab opens that fighter's shelf`, (await p.locator('.cl-tab.cl-on').getAttribute('data-fighter')) === F && (await p.locator('.cl-stitle b').textContent()) === 'BARISTA');
    check(`${label}: MAIN in full, ${P1.price} and ${P2.price} BUY, ${P3.price} SHORT`, (await st(`${F}:main`)) === 'main' && (await st(K(P1))) === 'buy' && (await st(K(P2))) === 'buy' && (await st(K(P3))) === 'short');
    const lockTxt = await p.locator(card(K(P1))).innerText();
    check(`${label}: a locked card says LOCKED and exactly how to get it`, /LOCKED/.test(lockTxt) && lockTxt.includes(`${P1.price} STICKS`) && !lockTxt.includes(P1.name), lockTxt.replace(/\s+/g, ' '));
    const sil = await inks(p, K(P3)), full = await inks(p, `${F}:main`);
    check(`${label}: a locked figure is a one-color silhouette`, sil.drawn > 200 && sil.sil, JSON.stringify(sil));
    check(`${label}: an owned figure is drawn in its colors`, full.drawn > 200 && !full.sil && full.colors > 3, JSON.stringify(full));
    check(`${label}: the screen is on screen, the shelf too`, !!(await inView(p, '.cl-shelf')) && !!(await inView(p, '.cl-head')), JSON.stringify(await p.locator('.cl-shelf').boundingBox()));
    check(`${label}: no closet text glows`, (await plainOnly(p, '.cl-body')).length === 0, (await plainOnly(p, '.cl-body')).slice(0, 2).join(' | '));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-1-shelf.png` });

    // 3. buying
    await press(card(K(P1)));
    txt = await flowText(p);
    check(`${label}: the first press only asks`, txt.includes(`BUY ${P1.name} FOR ${P1.price} STICKS? PRESS AGAIN`) && (await saved(p)).sticks === 320 && (await st(K(P1))) === 'buy');
    await press(card(K(P1))); await sleep(200);
    let c = await saved(p);
    check(`${label}: the second press buys it: ${320 - P1.price} sticks left, owned, put on`, c.sticks === 320 - P1.price && c.owned.includes(K(P1)) && c.equip[F] === P1.id, JSON.stringify(c));
    txt = await flowText(p);
    check(`${label}: the card shows in full, IN USE`, (await st(K(P1))) === 'owned' && (await p.locator(`${card(K(P1))}.cl-using`).count()) === 1 && (await p.locator(card(K(P1))).innerText()).includes(P1.name) && !(await inks(p, K(P1))).sil);
    check(`${label}: the counts go up: COLLECTED 1, the tab 1/n, the wallet`, txt.includes(`COLLECTED 1 / ${total}`) && /^1\/\d+$/.test(await p.locator(`.cl-tab[data-fighter="${F}"] .cl-tcount`).textContent()) && txt.includes(`${320 - P1.price} STICKS TO SPEND`));
    check(`${label}: ${P2.price} is SHORT now`, (await st(K(P2))) === 'short');
    await press(card(K(P3)));
    txt = await flowText(p);
    check(`${label}: pressing one you can't afford says the price and spends nothing`, txt.includes(`${P3.name} COSTS ${P3.price} STICKS`) && (await saved(p)).sticks === 320 - P1.price);
    await press(card(K(P3)));
    check(`${label}: ...even pressed twice`, (await saved(p)).sticks === 320 - P1.price && !(await saved(p)).owned.includes(K(P3)));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-2-bought.png` });

    // 4. equipping
    await press(card(`${F}:main`));
    c = await saved(p);
    check(`${label}: MAIN puts the own look back`, !c.equip[F] && (await p.locator(`${card(`${F}:main`)}.cl-using`).count()) === 1);
    await press(card(K(P1)));
    c = await saved(p);
    check(`${label}: one press on an owned palette puts it on`, c.equip[F] === P1.id && (await p.locator(`${card(K(P1))}.cl-using`).count()) === 1 && (await saved(p)).sticks === 320 - P1.price);

    // 5. fighter mastery's items (src/career/mastery.js): the pose locked at rank 0, unlocked at rank 4 (a test's ranks)
    const mk = `${F}:pose:victory`;
    check(`${label}: the victory pose is locked: rank`, (await st(mk)) === 'rank' && (await p.locator(card(mk)).innerText()).includes('BARISTA MASTERY 4') && (await inks(p, mk)).sil);
    check(`${label}: ...on the VICTORY POSES shelf, in the total`, (await flowText(p)).includes('VICTORY POSES 0 / 1') && (await flowText(p)).includes(`COLLECTED 1 / ${total}`));
    await press(card(mk));
    check(`${label}: pressing it says how to get it`, (await flowText(p)).includes('UNLOCKS AT BARISTA MASTERY 4'));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-3-mastery.png` });
    await p.evaluate(() => { window.__flow.debug.closet.ranks = { barista: 4 }; });
    await press(`.cl-tab[data-fighter="${F}"]`);
    // rank 4: the 150 palette (bought already), the taunt, the 300 palette and the pose
    check(`${label}: at rank 4 it's unlocked and counted (with the taunt and the 300 palette)`, (await st(mk)) === 'owned' && (await flowText(p)).includes(`COLLECTED 4 / ${total}`) && (await flowText(p)).includes('MASTERY 4'));
    await p.evaluate(() => { window.__flow.debug.closet.extras = null; window.__flow.debug.closet.ranks = null; });

    // 4b. character select sees the closet's pick
    await press('#flow .fl-btn:has-text("BACK")');
    check(`${label}: BACK goes to MAIN MENU`, (await until(async () => (await state(p)) === 'modeSelect', 3000)) === true);
    await p.evaluate((f) => { window.__flow.debug.sel.player = f; }, F);
    await press('#flow .fl-btn:has-text("ARCADE")');
    await until(async () => (await state(p)) === 'charSelect'); await sleep(600);
    // the mouse left over ARCADE hovers whatever card is under it now: put the cursor back on BARISTA
    await p.evaluate((f) => { const ui = window.__flow.debug.ui, k = ui.items.findIndex((it) => it.char && it.char.id === f); if (k >= 0) ui.setFocus(k); }, F); await sleep(300);
    const sw = await p.evaluate(() => { const b = document.querySelector('.fl-palon'); return b ? { tag: b.querySelector('small') && b.querySelector('small').textContent, sw: b.style.getPropertyValue('--sw') } : null; });
    check(`${label}: character select has ${P1.name} IN USE for BARISTA`, sw && sw.tag === 'IN USE' && sw.sw === P1.body, JSON.stringify(sw));

    check(`${label}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
} finally { await b.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
