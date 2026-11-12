#!/usr/bin/env node
// Fighter mastery on screen (README, Progression, Fighter mastery): `npm run test:mastery:ui`, in real Chromium against
// the built game (npm run build, then npm run dev:worker; a guest needs no Worker calls).
//   node scripts/career/mastery-ui.mjs [http://127.0.0.1:8787/] [--shots <dir>]
// At 1280x720 (mouse) and 390x844 (touch, taps), as a guest whose BARISTA is one win short of mastery 2:
//   1. character select: BARISTA's card reads M1, the sheet MASTERY 1 with its pips; a fighter never played says
//      NEW HIRE BONUS; the fifth swatch is the mastery palette, locked (M5)
//   2. win an arcade stage with BARISTA: STAGE CLEAR stamps BARISTA MASTERY 2, says UNLOCKED TAUNT: <name>, shows the
//      XP the match paid the fighter; on screen, no glow
//   3. the next stage: BARISTA's look carries the taunt, and after a round BARISTA (the round's winner) taunts under
//      the ROUND card, standing easy again by FIGHT
//   4. the SUPPLY CLOSET's BARISTA shelf: the taunt owned and IN USE (its card in the clip), the pose a silhouette
//      reading BARISTA MASTERY 4; a press puts the taunt away (the look loses +t) and another puts it back
//   5. the fighter page lists what mastery unlocks, rank by rank
//   6. no page errors
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
import fs from 'node:fs';
import { KIT, RANKS } from '../../src/career/mastery.js';
import { masteryPalette } from '../../src/career/palettes.js';

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
const onScreen = async (p, sel) => { const bb = await p.locator(sel).first().boundingBox(), vp = p.viewportSize(); return bb && bb.y >= -1 && bb.x >= -1 && bb.y + bb.height <= vp.height + 1 && bb.x + bb.width <= vp.width + 1 ? bb : null; };
const inks = (p, key) => p.evaluate((key) => {
  const cv = document.querySelector(`.cl-card[data-item="${key}"] canvas`);
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, seen = new Set();
  let drawn = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) drawn++;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
  return { drawn, colors: seen.size, sil: [...seen].every((c) => c === '42,33,64') };
}, key);

const F = 'barista', [POSE, TAUNT] = KIT[F];
const SEED_XP = RANKS[2] - 15;   // one won stage (BASE + WIN) past mastery 2

const b = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
try {
  for (const [label, size, touch] of [['desktop', { width: 1280, height: 720 }, false], ['upright', { width: 390, height: 844 }, true]]) {
    const ctx = await b.newContext(touch ? { viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: size });
    await ctx.addInitScript(([f, xp]) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('stick-fight-career', JSON.stringify({ career: { xp: 150, sticks: 0, mastery: { [f]: { xp, n: 6 } }, owned: [`${f}:matcha`], winDay: new Date().toISOString().slice(0, 10) }, nudge: { xp: 150, title: 1 } }));
      localStorage.setItem('stick-fight-player', JSON.stringify({ id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join(''), name: 'ALICE', email: '', crews: [] }));
    }, [F, SEED_XP]);
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(BASE + 'play/');
    await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
    await p.evaluate(() => { window.__gauntlet.step(0); let last = performance.now(), k = 0; setInterval(() => { if (window.__hold) { last = performance.now(); return; } const now = performance.now(), ms = Math.min(100, now - last); last = now; if (++k % 12 === 0) window.__gauntlet.step(ms); else window.__game.advance(ms); }, 8); });
    const press = async (sel) => { const l = p.locator(sel).first(); if (touch) await l.tap({ force: true }); else await l.click({ force: true }); await sleep(250); };
    const focusChar = (f) => p.evaluate((f) => { const ui = window.__flow.debug.ui, k = ui.items.findIndex((it) => it.char && it.char.id === f); if (k >= 0) ui.setFocus(k); }, f);

    // 1. character select
    await p.evaluate(() => window.__flow.debug.go('modeSelect')); await sleep(500);
    await press('#flow .fl-btn:has-text("ARCADE")');
    await until(async () => (await state(p)) === 'charSelect'); await sleep(600);
    await focusChar(F); await sleep(300);
    check(`${label}: BARISTA's card reads M1`, (await p.locator(`#flow .fl-card:has(.fl-mrank)`).count()) === 1 && (await p.locator('#flow .fl-mrank').first().textContent()) === 'M1');
    let txt = await flowText(p);
    check(`${label}: the sheet says MASTERY 1 with five pips, one lit`, /MASTERY 1/.test(await p.locator('.fl-mastery').innerText()) && (await p.locator('.fl-mastery .ms-pips i').count()) === 5 && (await p.locator('.fl-mastery .ms-pips i.ms-on').count()) === 1);
    check(`${label}: no NEW HIRE on a fighter played 6 times`, !/NEW HIRE/.test(await p.locator('.fl-mastery').innerText()));
    const mp = masteryPalette(F);
    const fifth = await p.evaluate(() => { const b = document.querySelectorAll('.fl-pals .fl-pal')[4]; return b && b.style.display !== 'none' ? { tag: b.querySelector('small').textContent, locked: b.classList.contains('fl-pallock'), sw: b.style.getPropertyValue('--sw') } : null; });
    check(`${label}: the fifth swatch is the mastery palette, locked: M5`, fifth && fifth.tag === 'M5' && fifth.locked && fifth.sw === mp.body, JSON.stringify(fifth));
    await press('.fl-pals .fl-pal >> nth=4');
    check(`${label}: pressing it says how to get it (never for sale)`, (await p.locator('.fl-palnote').innerText()).includes(`UNLOCKS AT BARISTA MASTERY 5`) && (await saved(p)).sticks === 0);
    await focusChar('chef'); await sleep(300);
    check(`${label}: a fighter never played says NEW HIRE BONUS and MASTERY 0`, /MASTERY 0/.test(await p.locator('.fl-mastery').innerText()) && /NEW HIRE BONUS/.test(await p.locator('.fl-mastery').innerText()));
    const fits = await p.evaluate(() => { const n = document.querySelector('.fl-palnote').getBoundingClientRect(), d = document.querySelector('.fl-detail').getBoundingClientRect(), m = document.querySelector('.fl-mastery').getBoundingClientRect(); return n.bottom <= d.bottom + 1 && m.bottom <= d.bottom + 1 && m.top >= d.top - 1; });
    check(`${label}: the mastery line and the palette strip fit in the sheet`, fits);
    check(`${label}: the mastery line doesn't glow`, (await plainOnly(p, '.fl-mastery')).length === 0 && (await plainOnly(p, '.fl-mrank')).length === 0);
    if (SHOTS) { await focusChar(F); await sleep(300); await p.screenshot({ path: `${SHOTS}/${label}-1-select.png` }); }

    // 2. win a stage with BARISTA
    await p.evaluate((f) => { window.__flow.debug.sel.player = f; window.__flow.debug.pickChar(f); }, F);
    await until(async () => (await state(p)) === 'stageIntro');
    await p.evaluate(() => window.__flow.debug.go('fighting'));
    check(`${label}: at mastery 1 BARISTA starts with no taunt`, (await p.evaluate(() => window.__game.sim.units[0].taunt)) === null);
    for (let k = 0; k < 6 && (await state(p)) !== 'stageClear'; k++) {
      await until(async () => (await p.evaluate(() => window.__game.sim.phase)) === 'fight' || (await state(p)) === 'stageClear', 12000);
      await sleep(1500);
      await p.evaluate(() => window.__flow.debug.debugKO(0));
      await until(async () => (await p.evaluate(() => window.__game.sim.phase)) !== 'fight', 4000);
    }
    const clear = await until(async () => (await state(p)) === 'stageClear', 15000, 50);
    await p.evaluate(() => { window.__hold = true; window.__gauntlet.step(0); });
    await sleep(700);
    txt = await flowText(p);
    check(`${label}: STAGE CLEAR stamps BARISTA MASTERY 2`, !!clear && (await p.locator('.ms-up').count()) === 1 && /BARISTA MASTERY 2/.test((await p.locator('.ms-up').innerText()).replace(/\s+/g, ' ')), txt.slice(0, 300));
    check(`${label}: ...and says what it unlocked: UNLOCKED TAUNT: ${TAUNT}`, txt.includes(`UNLOCKED TAUNT: ${TAUNT}`));
    const c = await saved(p);
    const paid = c.mastery[F].xp - SEED_XP;
    check(`${label}: the XP it paid BARISTA, in plain words`, paid >= 20 && txt.includes(`+${paid} XP`) && (await p.locator('.ms-head').innerText()).includes('BARISTA MASTERY 2'), `${paid}`);
    check(`${label}: saved: the taunt owned and on, BARISTA's matches counted`, c.owned.includes(`${F}:taunt:taunt`) && c.equip[`${F}:taunt`] === 'taunt' && c.mastery[F].n === 7, JSON.stringify(c.mastery));
    check(`${label}: the panel with mastery is on screen and plain`, !!(await onScreen(p, '.cr-earn')) && (await plainOnly(p, '.cr-earn')).length === 0, JSON.stringify(await p.locator('.cr-earn').boundingBox()));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-2-clear.png` });
    await p.evaluate(() => { window.__hold = false; });

    // 3. the next stage: the taunt between rounds
    await press('#flow .fl-btn:has-text("NEXT STAGE")');
    await until(async () => (await state(p)) === 'stageIntro');
    await p.evaluate(() => window.__flow.debug.go('fighting'));
    await sleep(300);
    check(`${label}: the next fight starts BARISTA with the taunt`, (await p.evaluate(() => window.__game.sim.units[0].taunt)) === `${F}_taunt`);
    await until(async () => (await p.evaluate(() => window.__game.sim.phase)) === 'fight', 12000);
    check(`${label}: no taunt in round 1's intro or fight`, (await p.evaluate(() => window.__game.sim.units[0].state)) !== 'taunt');
    await sleep(800);
    await p.evaluate(() => window.__flow.debug.debugKO(0));
    const taunting = await until(async () => (await p.evaluate(() => { const s = window.__game.sim; return s.phase === 'intro' && s.round === 2 && s.units[0].state === 'taunt' ? { banner: s.banner, move: s.units[0].rig.current.move } : null; })), 8000, 16);
    check(`${label}: round 1 won, BARISTA taunts under the ROUND 2 card`, taunting && /ROUND 2/.test(taunting.banner) && taunting.move === `${F}_taunt`, JSON.stringify(taunting));
    if (SHOTS && taunting) { await p.evaluate(() => { window.__hold = true; window.__gauntlet.step(0); }); await sleep(120); await p.screenshot({ path: `${SHOTS}/${label}-3-taunt.png` }); await p.evaluate(() => { window.__hold = false; }); }
    const atFight = await until(async () => (await p.evaluate(() => { const s = window.__game.sim; return s.phase === 'fight' ? { st: s.units[0].state } : null; })), 6000, 16);
    check(`${label}: ...and stands easy by FIGHT`, atFight && atFight.st !== 'taunt', JSON.stringify(atFight));

    // 4. the closet (out of the fight the way a player goes: pause, then the main menu)
    await p.evaluate(() => { const f = window.__flow.debug; f.go('paused'); f.go('modeSelect'); }); await sleep(500);
    await press('#flow .fl-btn:has-text("SUPPLY CLOSET")');
    await until(async () => (await state(p)) === 'closet'); await sleep(300);
    await press(`.cl-tab[data-fighter="${F}"]`);
    const card = (k) => `.cl-card[data-item="${k}"]`;
    const tk = `${F}:taunt:taunt`, pk = `${F}:pose:victory`;
    txt = await flowText(p);
    check(`${label}: the shelf has VICTORY POSES and TAUNTS, and says MASTERY 2`, /VICTORY POSES 0 \/ 1/.test(txt) && /TAUNTS 1 \/ 1/.test(txt) && /MASTERY 2/.test(await p.locator('.cl-stitle').innerText()));
    check(`${label}: the taunt is owned and IN USE, drawn in full`, (await p.locator(card(tk)).getAttribute('data-state')) === 'owned' && (await p.locator(`${card(tk)}.cl-using`).count()) === 1 && (await p.locator(card(tk)).innerText()).includes(TAUNT) && !(await inks(p, tk)).sil);
    check(`${label}: the pose is a silhouette: LOCKED, BARISTA MASTERY 4`, (await p.locator(card(pk)).getAttribute('data-state')) === 'rank' && (await p.locator(card(pk)).innerText()).includes('BARISTA MASTERY 4') && !(await p.locator(card(pk)).innerText()).includes(POSE) && (await inks(p, pk)).sil);
    check(`${label}: the sold palettes read their early rank too (300 STICKS OR BARISTA MASTERY 3)`, /300 STICKS OR BARISTA MASTERY 3/.test(txt));
    check(`${label}: no closet text glows`, (await plainOnly(p, '.cl-body')).length === 0);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-4-closet.png` });
    await press(card(tk));
    let look = await p.evaluate((f) => JSON.parse(localStorage.getItem('stick-fight-career')).career.equip[`${f}:taunt`] || '', F);
    check(`${label}: a press puts the taunt away (NO TAUNT)`, (await flowText(p)).includes('NO TAUNT') && !look && (await p.locator(`${card(tk)}.cl-using`).count()) === 0);
    await press(card(tk));
    look = await p.evaluate((f) => JSON.parse(localStorage.getItem('stick-fight-career')).career.equip[`${f}:taunt`] || '', F);
    check(`${label}: another press puts it back`, look === 'taunt' && (await p.locator(`${card(tk)}.cl-using`).count()) === 1);

    // 5. the fighter page
    if (label === 'desktop') {
      const fp = await ctx.newPage();
      await fp.goto(BASE + `fighters/${F}/`);
      const sec = await fp.locator('#mastery').innerText().catch(() => '');
      check('the fighter page has a MASTERY section listing every rank\'s unlock', /MASTERY/.test(sec) && sec.includes(TAUNT) && sec.includes(POSE) && sec.includes(mp.name) && /NEW HIRE|new hire/i.test(sec) && (await fp.locator('#mastery tbody tr').count()) === 6, sec.slice(0, 200));
      if (SHOTS) { await fp.locator('#mastery').scrollIntoViewIfNeeded(); await sleep(1500); await fp.screenshot({ path: `${SHOTS}/page-mastery.png` }); }
      await fp.close();
    }

    check(`${label}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
} finally { await b.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
