#!/usr/bin/env node
// Stat upgrades on screen (README, Progression, Stat upgrades): `npm run test:upgrades:ui`, real Chromium against the
// built game and the local Worker (npm run build, then npm run dev:worker; SF_WORKER / the URL for another port).
//   node scripts/career/upgrades-ui.mjs [http://127.0.0.1:8787/] [--shots <dir>]
//   1. (1280x720 mouse, 390x844 touch) a guest with 400 sticks opens SUPPLY CLOSET, BARISTA: STAT UPGRADES with four
//      cards, each saying its next tier's price up front; the first press only asks, the second buys (sticks spent,
//      the tier in owned, the card's pips and +4%); a tier too dear spends nothing; character select's line says it
//   2. that guest's arcade fight: BARISTA's sim unit carries the boost (more max health than plain), the CPU doesn't,
//      and the stage's CPU is lifted for the tiers owned (src/flow/ladder.js upgradeLift)
//   3. HIGH SCORES marks a row set with upgrades UP and says what UP means, once, under the table
//   4. online through the local Worker: a room at UPGRADES: EVEN shows it on both pick screens, both sims put every
//      stat's top tier on both fighters (the guest's own purchases don't matter), a 30-second match of real presses
//      ends agreed on both pages with no desync, and the post-match screen says it. Then a room at OFF: nobody is
//      boosted, though the guest owns upgrades
//   5. on screen, no glowing text, no page errors
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
const pump = (p) => p.evaluate(() => { window.__gauntlet.step(0); let last = performance.now(), k = 0; setInterval(() => { const now = performance.now(), ms = Math.min(100, now - last); last = now; if (window.__hold) return; if (++k % 12 === 0) window.__gauntlet.step(ms); else window.__game.advance(ms); }, 8); });
const near = (a, b) => Math.abs(a - b) < 1e-9;

const b = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
try {
  for (const [label, size, touch] of [['desktop', { width: 1280, height: 720 }, false], ['upright', { width: 390, height: 844 }, true]]) {
    const ctx = await b.newContext(touch ? { viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: size });
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('stick-fight-last-pick', 'barista');
      localStorage.setItem('stick-fight-career', JSON.stringify({ career: { xp: 150, sticks: 400 }, nudge: { xp: 150, title: 1 } }));
      localStorage.setItem('stick-fight-player', JSON.stringify({ id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join(''), name: 'ALICE', email: '', crews: [] }));
      localStorage.setItem('stick-fight-scores', JSON.stringify({ arcade: [{ name: 'UPS', score: 70000, note: 'STAGE 6', up: true }, { name: 'SCO', score: 60000, note: 'STAGE 6' }], horde: [] }));
    });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(BASE + 'play/');
    await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
    await pump(p);
    const press = async (sel) => { const l = p.locator(sel).first(); await l.scrollIntoViewIfNeeded().catch(() => {}); if (touch) await l.tap({ force: true }); else await l.click({ force: true }); await sleep(250); };
    const card = (stat) => `.up-card[data-stat="${stat}"]`;

    // 1. the closet's STAT UPGRADES
    await p.evaluate(() => window.__flow.debug.go('modeSelect')); await sleep(500);
    await press('#flow .fl-btn:has-text("SUPPLY CLOSET")');
    await until(async () => (await state(p)) === 'closet');
    await press('.cl-tab[data-fighter="barista"]');
    const cards = await p.locator('.up-card').count();
    let txt = await flowText(p);
    check(`${label}: BARISTA's shelf has STAT UPGRADES 0 / 12 with four cards`, cards === 4 && txt.includes('STAT UPGRADES 0 / 12'), `${cards} cards`);
    const how = await p.locator(`${card('health')} .up-how`).textContent();
    check(`${label}: each card shows its next tier's price up front`, how === 'TIER 1: +4% FOR 100 STICKS' && (await p.locator(`${card('speed')} .up-how`).textContent()) === 'TIER 1: +3% FOR 100 STICKS', how);
    check(`${label}: it says where they apply, and that versus only uses them at EVEN`, /ARCADE, HORDE AND TRAINING\. NEVER AGAINST A PERSON UNLESS THE HOST PICKS UPGRADES: EVEN/.test(txt));
    await press(card('health'));
    txt = await flowText(p);
    check(`${label}: the first press only asks`, txt.includes('BUY HEALTH TIER 1 (+4%) FOR 100 STICKS? PRESS AGAIN') && (await saved(p)).sticks === 400);
    await press(card('health')); await sleep(200);
    let c = await saved(p);
    check(`${label}: the second buys it: 300 sticks, barista:up:health:1 owned`, c.sticks === 300 && c.owned.includes('barista:up:health:1'), JSON.stringify(c.owned));
    check(`${label}: the card shows tier 1 (a pip, +4%) and the next price`, (await p.locator(`${card('health')}`).getAttribute('data-tier')) === '1' && (await p.locator(`${card('health')} .up-pips i.up-on`).count()) === 1
      && (await p.locator(`${card('health')} .up-now`).textContent()).startsWith('+4%') && (await p.locator(`${card('health')} .up-how`).textContent()) === 'TIER 2: +8% FOR 250 STICKS');
    await press(card('health')); await press(card('health')); await sleep(200);
    c = await saved(p);
    check(`${label}: tier 2 for 250: 50 left`, c.sticks === 50 && c.owned.includes('barista:up:health:2'));
    await press(card('power')); await press(card('power'));
    txt = await flowText(p);
    check(`${label}: a tier too dear says the price and spends nothing, pressed twice`, txt.includes('POWER TIER 1 COSTS 100 STICKS') && (await saved(p)).sticks === 50);
    check(`${label}: the upgrades are on screen`, !!(await inView(p, card('speed'))));
    check(`${label}: no upgrade text glows`, (await plainOnly(p, '.up-shelf')).length === 0, (await plainOnly(p, '.up-shelf')).slice(0, 2).join(' | '));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-1-closet.png` });

    // character select's line
    await p.evaluate(() => { window.__flow.debug.sel.mode = 'arcade'; window.__flow.debug.sel.step = 'player'; window.__flow.debug.go('modeSelect'); window.__flow.debug.go('charSelect'); });
    await until(async () => (await state(p)) === 'charSelect');
    const line = await until(() => p.evaluate(() => { const e = document.querySelector('.up-line'); return e && e.innerText.replace(/\s+/g, ' '); }), 5000);
    check(`${label}: character select's sheet says UPGRADES HEALTH 2`, /UPGRADES HEALTH 2/.test(line || ''), line);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-2-select.png` });

    // 2. the arcade fight
    await p.evaluate(() => { window.__flow.debug.sel.player = 'barista'; window.__flow.debug.startArcade(); });
    await until(async () => (await state(p)) === 'stageIntro');
    const u = await p.evaluate(() => { const s = window.__game.sim; return { hp: s.units[0].upHp, max: s.units[0].maxHealth, base: Math.round(s.startHealth * s.units[0].char.stats.health / 100), cpu: s.units[1].upHp, d: s.units[1].controller.getDifficulty() }; });
    check(`${label}: the fight: BARISTA has +8% max health (${u.base} -> ${Math.round(u.base * 1.08)}), the CPU nothing`, near(u.hp, 1.08) && u.max === Math.round(u.base * 1.08) && u.cpu === 1, JSON.stringify(u));
    check(`${label}: stage 1's CPU is lifted for 2 tiers of 12 (0.2 -> 0.22)`, Math.abs(u.d - 0.22) < 1e-9, String(u.d));
    await p.evaluate(() => window.__flow.debug.go('fighting')); await sleep(1500);
    if (SHOTS) { await p.evaluate(() => window.__gauntlet.step(0)); await p.screenshot({ path: `${SHOTS}/${label}-3-fight.png` }); }

    // 3. HIGH SCORES: the UP tag and what it means
    await p.evaluate(() => { const f = window.__flow.debug; f.go('paused'); f.go('modeSelect'); });
    await sleep(400);
    await press('#flow .fl-btn:has-text("HIGH SCORES")');
    await until(async () => (await state(p)) === 'highScores');
    txt = await flowText(p);
    const tags = await p.locator('.fl-table .up-tag').count();
    const tagged = await p.evaluate(() => [...document.querySelectorAll('.fl-table .up-tag')].map((t) => t.parentElement.textContent));
    check(`${label}: HIGH SCORES marks the upgraded run UP, the other not`, tags === 1 && tagged[0] === 'UPSUP', `${tags} tags: ${tagged}`);
    check(`${label}: and says what UP means, once`, (txt.match(/UP: A SCORE SET WITH STAT UPGRADES FROM THE SUPPLY CLOSET/g) || []).length === 1);
    check(`${label}: the tag doesn't glow`, (await plainOnly(p, '.up-tag')).length === 0);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-4-scores.png` });
    check(`${label}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // 4. online through the local Worker
  const pg = async (url, career, name, idc, rule) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript((kv) => { for (const k in kv) if (kv[k] != null && localStorage.getItem(k) === null) localStorage.setItem(k, kv[k]); },
      { 'stick-fight-career': JSON.stringify({ career }), 'stick-fight-player': JSON.stringify({ id: idc.repeat(32), name, email: '', crews: [] }),
        'stick-fight-upgrades-rule': rule, 'stick-fight-round-time': '30', 'stick-fight-best-of': '1' });
    const p = await ctx.newPage();
    p.errors = []; p.on('pageerror', (e) => p.errors.push(String(e)));
    await p.goto(url);
    await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
    await pump(p);
    p.ctx = ctx;
    return p;
  };
  const guestOwns = ['courier:up:health:1', 'courier:up:power:1', 'courier:up:power:2'];
  for (const rule of ['even', 'off']) {
    const H = await pg(BASE + 'play/', { xp: 0, sticks: 0 }, 'HOSTY', rule === 'even' ? 'c' : 'e', rule);
    await H.evaluate(() => { const f = window.__flow.debug; f.go('modeSelect'); f.go('onlineMenu'); f.go('onlineHost'); });
    const code = await until(() => H.evaluate(() => (window.__net.state === 'waiting' && window.__net.code) || null), 30000);
    const hostTxt = await flowText(H);
    if (rule === 'even') {
      check('online: HOST A GAME shows the room rule: UPGRADES: EVEN · BOTH FIGHTERS FULLY UPGRADED', hostTxt.includes('UPGRADES: EVEN · BOTH FIGHTERS FULLY UPGRADED'));
      if (SHOTS) await H.screenshot({ path: `${SHOTS}/online-1-host.png` });
    }
    const G = await pg(`${BASE}room/${code}`, { xp: 0, sticks: 0, owned: guestOwns }, 'GUESTY', rule === 'even' ? 'd' : 'f', null);
    const both = await until(async () => (await state(H)) === 'onlineSelect' && (await state(G)) === 'onlineSelect', 30000);
    check(`online ${rule}: host and guest on the pick screen`, !!both);
    await G.evaluate(() => window.__flow.debug.getNet().pick('courier', true));
    await H.evaluate(() => window.__flow.debug.getNet().pick('chef', true));
    const want = rule === 'even' ? 'UPGRADES: EVEN · BOTH FIGHTERS FULLY UPGRADED' : 'UPGRADES: OFF · FIGHTERS AS THEY ARE';
    const seen = await until(async () => (await flowText(G)).includes(want) && (await flowText(H)).includes(want), 8000);
    check(`online ${rule}: both pick screens say ${want}`, !!seen, (await G.evaluate(() => (document.querySelector('.fl-selstatus .fl-uprule-line') || {}).textContent)));
    if (SHOTS && rule === 'even') await G.screenshot({ path: `${SHOTS}/online-2-pick-guest.png` });
    await sleep(500);
    await H.evaluate(() => window.__flow.debug.getNet().startNow());
    const fighting = await until(async () => (await state(H)) === 'onlineFighting' && (await state(G)) === 'onlineFighting', 20000);
    check(`online ${rule}: the match starts`, !!fighting);
    await sleep(600);
    const ups = (p) => p.evaluate(() => window.__game.sim.units.slice(0, 2).map((u) => [u.upHp, u.upDmg, u.upRegen, u.upWalk, u.maxHealth]));
    const hu = await ups(H), gu = await ups(G);
    if (rule === 'even') check('online even: both sims put every top tier on both fighters (+12% +12% +15% +10%)', JSON.stringify(hu) === JSON.stringify(gu) && hu.every(([a, d, r, w]) => near(a, 1.12) && near(d, 1.12) && near(r, 1.15) && near(w, 1.1)), JSON.stringify(hu));
    else check('online off: nobody is boosted, though the guest owns upgrades', JSON.stringify(hu) === JSON.stringify(gu) && hu.every(([a, d, r, w]) => a === 1 && d === 1 && r === 1 && w === 1), JSON.stringify(hu));
    // real presses on both sides: walk in and swing, so hits, stamina and footwork all run through the boosted numbers
    await H.keyboard.down('ArrowRight'); await G.keyboard.down('ArrowLeft');
    const t0 = Date.now(); let k = 0;
    while (Date.now() - t0 < 40000 && !((await state(H)) === 'onlinePost' && (await state(G)) === 'onlinePost')) {
      const key = ['KeyU', 'KeyI', 'KeyJ', 'KeyK'][k++ % 4];
      await H.keyboard.press(key); await G.keyboard.press(['KeyI', 'KeyU', 'KeyK', 'KeyJ'][k % 4]);
      await sleep(350);
    }
    await H.keyboard.up('ArrowRight'); await G.keyboard.up('ArrowLeft');
    const done = await until(async () => (await state(H)) === 'onlinePost' && (await state(G)) === 'onlinePost', 30000);
    const hs = await H.evaluate(() => window.__net.stats()), gs = await G.evaluate(() => window.__net.stats());
    const hv = await H.evaluate(() => window.__net.view()), gv = await G.evaluate(() => window.__net.view());
    check(`online ${rule}: the match ends agreed on both pages (the same final state hash), no desync`, !!done && hv.last && gv.last && hv.last.hash === gv.last.hash && !(hs && hs.desync) && !(gs && gs.desync),
      JSON.stringify({ h: hv.last && hv.last.hash, g: gv.last && gv.last.hash, hd: hs && hs.desync, gd: gs && gs.desync }));
    const hit = hv.last ? hv.last.wins : null;
    if (rule === 'even') {
      const post = await flowText(G);
      check('online even: the post-match screen says THIS MATCH: UPGRADES: EVEN', post.includes('THIS MATCH: UPGRADES: EVEN · BOTH FIGHTERS FULLY UPGRADED'), post.slice(0, 200));
      if (SHOTS) await G.screenshot({ path: `${SHOTS}/online-3-post-guest.png` });
    }
    console.log(`      ${rule}: rounds ${JSON.stringify(hit)}, resyncs ${hs && hs.resyncs}/${gs && gs.resyncs}`);
    check(`online ${rule}: no page errors`, !H.errors.length && !G.errors.length, [...H.errors, ...G.errors].join(' | '));
    await H.ctx.close(); await G.ctx.close();
  }
} finally { await b.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
