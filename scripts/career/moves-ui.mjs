#!/usr/bin/env node
// The custom employee on screen (README, Characters, Custom employee): `npm run test:moves:ui`, real Chromium against
// the built game and the local Worker (npm run build, then npm run dev:worker; the URL for another port).
//   node scripts/career/moves-ui.mjs [http://127.0.0.1:8787/] [--shots <dir>]
//   1. (1280x720 mouse, 390x844 touch) a guest with 700 sticks opens SUPPLY CLOSET, COURIER: CUSTOM EMPLOYEE with two
//      empty slots; slot A opens the page of moves, each with its price up front and drawn on COURIER; the first press
//      on REBOOT only asks, the second buys it and puts it in slot A; slot B takes MOP SPIN the same way; EMPTY empties
//      a slot and an owned move goes back in with one press; a move too dear spends nothing; COURIER's own moves aren't
//      offered
//   2. character select's line says MOVES ↓1+3 REBOOT · ↓2+4 MOP SPIN, and the MOVE LIST has CUSTOM EMPLOYEE with both
//   3. the arcade fight: COURIER's sim unit has both in its slots, ↓ 1+3 on the keys throws Reboot and ↓ 2+4 Mop Spin,
//      drawn on COURIER's own body in COURIER's colors
//   4. online through the local Worker, two pages with different loadouts: each pick screen shows its own line, both
//      sims put each side's slots on each side's fighter, a match of real presses (the slots included) ends on the
//      same final state hash with no desync, and each side's borrowed moves came out on both pages
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
// the borrowed moves that came out on this page, by side (polled from the sim)
const watchLent = (p) => p.evaluate(() => { window.__lent = [[], []]; setInterval(() => { const s = window.__game.sim; s.units.slice(0, 2).forEach((u, i) => { if (u.move && u.borrow && u.borrow.includes(u.move) && !window.__lent[i].includes(u.move)) window.__lent[i].push(u.move); }); }, 20); });

const b = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
try {
  for (const [label, size, touch] of [['desktop', { width: 1280, height: 720 }, false], ['upright', { width: 390, height: 844 }, true]]) {
    const ctx = await b.newContext(touch ? { viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: size });
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('stick-fight-last-pick', 'courier');
      localStorage.setItem('stick-fight-career', JSON.stringify({ career: { xp: 150, sticks: 700 }, nudge: { xp: 150, title: 1 } }));
      localStorage.setItem('stick-fight-player', JSON.stringify({ id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join(''), name: 'ALICE', email: '', crews: [] }));
    });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(BASE + 'play/');
    await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
    await pump(p);
    const press = async (sel) => { const l = p.locator(sel).first(); await l.scrollIntoViewIfNeeded().catch(() => {}); if (touch) await l.tap({ force: true }); else await l.click({ force: true }); await sleep(300); };
    const slotCard = (n) => `.ce-slot[data-slot="${n}"]`, moveCard = (id) => `.ce-card[data-move="${id}"]`;

    // 1. the closet's CUSTOM EMPLOYEE
    await p.evaluate(() => window.__flow.debug.go('modeSelect')); await sleep(500);
    await press('#flow .fl-btn:has-text("SUPPLY CLOSET")');
    await until(async () => (await state(p)) === 'closet');
    await press('.cl-tab[data-fighter="courier"]');
    let txt = await flowText(p);
    check(`${label}: COURIER's shelf has CUSTOM EMPLOYEE 0 / 2 with two empty slots on ↓ 1+3 and ↓ 2+4`, txt.includes('CUSTOM EMPLOYEE 0 / 2 SLOTTED') && (await p.locator('.ce-slot.ce-empty').count()) === 2 && /SLOT A · ↓ 1\+3/.test(txt) && /SLOT B · ↓ 2\+4/.test(txt));
    await press(slotCard(1));
    txt = await flowText(p);
    const cards = await p.locator('.ce-card').count();
    check(`${label}: slot A opens the page: EMPTY and every move COURIER can borrow (23)`, txt.includes('CUSTOM EMPLOYEE') && cards === 24, `${cards} cards`);
    check(`${label}: COURIER's own moves aren't offered`, (await p.locator(moveCard('expressSlide')).count()) === 0 && (await p.locator(moveCard('dropOffKnee')).count()) === 0);
    check(`${label}: each move shows its price and whose it is up front`, (await p.locator(`${moveCard('reboot')} .ce-how`).textContent()) === '300 STICKS' && (await p.locator(`${moveCard('reboot')} .ce-from`).textContent()) === 'FROM HELPDESK');
    // drawn on COURIER: the card's figure is in COURIER's own colors (its magenta), not HELPDESK's
    const tint = await p.evaluate((sel) => { const cv = document.querySelector(sel + ' canvas'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let mag = 0, cyanish = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 200) continue; if (d[i] > 200 && d[i + 2] > 150 && d[i + 1] < 120) mag++; } return mag; }, moveCard('reboot'));
    check(`${label}: the borrowed move is drawn on COURIER's body in COURIER's colors`, tint > 50, `${tint} magenta px`);
    await press(moveCard('reboot'));
    txt = await flowText(p);
    check(`${label}: the first press only asks`, txt.includes('BUY REBOOT FOR 300 STICKS AND PUT IT IN SLOT A? PRESS AGAIN') && (await saved(p)).sticks === 700);
    await press(moveCard('reboot')); await sleep(300);
    let c = await saved(p);
    check(`${label}: the second buys it (400 left) and puts it in slot A`, c.sticks === 400 && c.owned.includes('move:reboot') && c.equip['courier:slot1'] === 'reboot', JSON.stringify(c.equip));
    txt = await flowText(p);
    check(`${label}: back on the shelf, slot A says REBOOT, FROM HELPDESK`, (await state(p)) === 'closet' && (await p.locator(`${slotCard(1)}.ce-full .ce-name`).textContent()) === 'REBOOT' && txt.includes('CUSTOM EMPLOYEE 1 / 2 SLOTTED'));
    await press(slotCard(2)); await press(moveCard('mopSpin')); await press(moveCard('mopSpin')); await sleep(300);
    c = await saved(p);
    check(`${label}: slot B takes MOP SPIN the same way (100 left)`, c.sticks === 100 && c.equip['courier:slot2'] === 'mopSpin');
    await press(slotCard(2)); await press(moveCard('updraft')); await press(moveCard('updraft'));
    txt = await flowText(p);
    check(`${label}: a move too dear says the price and spends nothing, pressed twice`, txt.includes('UPDRAFT COSTS 300 STICKS') && (await saved(p)).sticks === 100);
    await press(moveCard(''));
    c = await saved(p);
    check(`${label}: EMPTY empties the slot (↓ 2+4 is the throw again)`, !c.equip['courier:slot2'] && (await p.locator(`${slotCard(2)}.ce-empty`).count()) === 1);
    await press(slotCard(2));
    check(`${label}: an owned move reads OWNED · PUT IN SLOT B`, (await p.locator(`${moveCard('mopSpin')} .ce-how`).textContent()).replace(/\s+/g, ' ') === 'OWNED · PUT IN SLOT B');
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-1-page.png` });
    check(`${label}: the page's cards are on screen and none of it glows`, !!(await inView(p, moveCard(''))) && (await plainOnly(p, '.ce-page')).length === 0, (await plainOnly(p, '.ce-page')).slice(0, 2).join(' | '));
    await press(moveCard('mopSpin'));
    c = await saved(p);
    check(`${label}: and goes back in with one press, nothing spent`, c.equip['courier:slot2'] === 'mopSpin' && c.sticks === 100);
    check(`${label}: the shelf's slots are on screen and none of it glows`, !!(await inView(p, slotCard(2))) && (await plainOnly(p, '.ce-shelf')).length === 0);
    if (SHOTS) { await p.locator(slotCard(1)).scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SHOTS}/${label}-2-shelf.png` }); }

    // 2. character select's line, and the move list
    await p.evaluate(() => { window.__flow.debug.sel.mode = 'arcade'; window.__flow.debug.sel.step = 'player'; window.__flow.debug.go('modeSelect'); window.__flow.debug.go('charSelect'); });
    await until(async () => (await state(p)) === 'charSelect');
    const line = await until(() => p.evaluate(() => { const e = document.querySelector('.ce-line'); return e && e.innerText.replace(/\s+/g, ' '); }), 5000);
    check(`${label}: character select says MOVES ↓1+3 REBOOT · ↓2+4 MOP SPIN`, /MOVES ↓1\+3 REBOOT · ↓2\+4 MOP SPIN/.test(line || ''), line);
    const fits = await p.evaluate(() => { const l = document.querySelector('.ce-line').getBoundingClientRect(), d = document.querySelector('.fl-detail').getBoundingClientRect(); return l.bottom <= d.bottom + 1 && l.top >= d.top - 1 && l.right <= d.right + 1; });
    check(`${label}: the line fits in the sheet`, fits);
    check(`${label}: it doesn't glow`, (await plainOnly(p, '.ce-line')).length === 0);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-3-select.png` });
    await press('#flow .fl-btn:has-text("MOVE LIST")');
    const ml = await until(() => p.evaluate(() => { const r = document.getElementById('movelist'); return r && r.innerText.replace(/\s+/g, ' '); }), 5000);
    check(`${label}: the MOVE LIST has CUSTOM EMPLOYEE: REBOOT on ↓1+3, MOP SPIN on ↓2+4, borrowed`, /CUSTOM EMPLOYEE/.test(ml || '') && /REBOOT.*BORROWED/i.test(ml || '') && /MOP SPIN/.test(ml || '') && /from HELPDESK/i.test(ml || ''), (ml || '').slice(0, 120));
    if (SHOTS) { await p.evaluate(() => { const s = document.querySelector('.ml-slots'); s && s.scrollIntoView(); }); await sleep(200); await p.screenshot({ path: `${SHOTS}/${label}-4-movelist.png` }); }
    await p.keyboard.press('Escape'); await sleep(300);

    // 3. the arcade fight: ↓ 1+3 and ↓ 2+4
    await p.evaluate(() => { window.__flow.debug.sel.player = 'courier'; window.__flow.debug.startArcade(); });
    await until(async () => (await state(p)) === 'stageIntro');
    const u = await p.evaluate(() => { const s = window.__game.sim; return { borrow: s.units[0].borrow, cpu: s.units[1].borrow, color: s.units[0].color, own: s.units[0].char.color, body: s.units[0].rig.body === s.units[0].char.body }; });
    check(`${label}: the fight: COURIER has REBOOT and MOP SPIN in its slots, the CPU none`, u.borrow.join() === 'reboot,mopSpin' && u.cpu.every((m) => !m), JSON.stringify(u));
    await p.evaluate(() => window.__flow.debug.go('fighting'));
    await until(() => p.evaluate(() => window.__game.sim.phase === 'fight'), 10000);
    if (!touch) {
      const out = async (keys) => {
        await p.evaluate(() => { const s = window.__game.sim; s.units[0].stamina = s.units[0].staminaMax; s.units[1].x = s.units[0].x + 100 * s.units[0].facing; window.__seen = []; window.__seenT = setInterval(() => { const m = window.__game.sim.units[0].move; if (m && !window.__seen.includes(m)) window.__seen.push(m); }, 10); });
        await p.keyboard.down('KeyS'); await p.keyboard.down(keys[0]); await p.keyboard.down(keys[1]); await sleep(120);
        await p.keyboard.up(keys[0]); await p.keyboard.up(keys[1]); await p.keyboard.up('KeyS');
        await sleep(700);
        return p.evaluate(() => { clearInterval(window.__seenT); return window.__seen; });
      };
      const a = await out(['KeyU', 'KeyJ']);
      check(`${label}: ↓ 1+3 (S + U + J) throws REBOOT`, a.includes('reboot'), a.join(','));
      if (SHOTS) { await p.evaluate(() => { const s = window.__game.sim; s.units[1].x = s.units[0].x + 100 * s.units[0].facing; }); await p.keyboard.down('KeyS'); await p.keyboard.down('KeyI'); await p.keyboard.down('KeyK'); await sleep(260); await p.screenshot({ path: `${SHOTS}/${label}-5-fight.png` }); await p.keyboard.up('KeyI'); await p.keyboard.up('KeyK'); await p.keyboard.up('KeyS'); await sleep(900); }
      const bb = await out(['KeyI', 'KeyK']);
      check(`${label}: ↓ 2+4 (S + I + K) throws MOP SPIN`, bb.includes('mopSpin'), bb.join(','));
    } else {
      // touch: the stick's down and two buttons, through the sim's own input like the touch layer's snapshot
      const seen = await p.evaluate(async () => {
        const s = window.__game.sim, u = s.units[0], ctl = u.controller, seen = [];
        let n = 0; s.setController(0, 'human', () => { n++; return n >= 2 && n < 6 ? { dx: 0, jump: false, block: false, down: true, run: false, lp: true, rp: false, lk: true, rk: false, touch: true, dash: false } : { dx: 0, jump: false, block: false, down: false, run: false, lp: false, rp: false, lk: false, rk: false, touch: true, dash: false }; });
        s.units[1].x = u.x + 100 * u.facing;
        await new Promise((r) => { const t = setInterval(() => { if (u.move && !seen.includes(u.move)) seen.push(u.move); if (n > 120) { clearInterval(t); r(); } }, 5); });
        s.setController(0, 'human', ctl);
        return seen;
      });
      check(`${label}: ↓ 1+3 from the touch input throws REBOOT`, seen.includes('reboot'), seen.join(','));
    }
    check(`${label}: drawn on COURIER's own body in COURIER's colors (the unit's rig and color, never HELPDESK's)`, u.body && u.color === u.own);
    check(`${label}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // 4. online through the local Worker, two different loadouts
  const pg = async (url, career, name, idc, pick) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript((kv) => { for (const k in kv) if (kv[k] != null && localStorage.getItem(k) === null) localStorage.setItem(k, kv[k]); },
      { 'stick-fight-career': JSON.stringify({ career }), 'stick-fight-player': JSON.stringify({ id: idc.repeat(32), name, email: '', crews: [] }),
        'stick-fight-round-time': '30', 'stick-fight-best-of': '1', 'stick-fight-last-pick': pick });
    const p = await ctx.newPage();
    p.errors = []; p.on('pageerror', (e) => p.errors.push(String(e)));
    await p.goto(url);
    await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
    await pump(p);
    p.ctx = ctx;
    return p;
  };
  const hostC = { xp: 0, sticks: 0, owned: ['move:reboot', 'move:mopSpin'], equip: { 'courier:slot1': 'reboot', 'courier:slot2': 'mopSpin' } };
  const guestC = { xp: 0, sticks: 0, owned: ['move:updraft', 'move:electrician_groundFault'], equip: { 'chef:slot1': 'updraft', 'chef:slot2': 'electrician_groundFault' } };
  const H = await pg(BASE + 'play/', hostC, 'HOSTY', 'a', 'courier');
  await H.evaluate(() => { const f = window.__flow.debug; f.go('modeSelect'); f.go('onlineMenu'); f.go('onlineHost'); });
  const code = await until(() => H.evaluate(() => (window.__net.state === 'waiting' && window.__net.code) || null), 30000);
  const G = await pg(`${BASE}room/${code}`, guestC, 'GUESTY', 'b', 'chef');
  const both = await until(async () => (await state(H)) === 'onlineSelect' && (await state(G)) === 'onlineSelect', 30000);
  check('online: host and guest on the pick screen', !!both);
  await H.evaluate(() => window.__flow.debug.getNet().pick('courier', false));
  await G.evaluate(() => window.__flow.debug.getNet().pick('chef', false));
  const lines = await until(async () => { const h = await H.evaluate(() => [...document.querySelectorAll('.ce-line')].map((e) => e.innerText.replace(/\s+/g, ' ')).join('|')); return h ? h : null; }, 6000);
  check('online: the pick screen shows this side\'s loadout line', /REBOOT/.test(lines || ''), lines);
  if (SHOTS) await H.screenshot({ path: `${SHOTS}/online-1-pick-host.png` });
  await H.evaluate(() => window.__flow.debug.getNet().pick('courier', true));
  await G.evaluate(() => window.__flow.debug.getNet().pick('chef', true));
  await sleep(500);
  await H.evaluate(() => window.__flow.debug.getNet().startNow());
  const fighting = await until(async () => (await state(H)) === 'onlineFighting' && (await state(G)) === 'onlineFighting', 20000);
  check('online: the match starts', !!fighting);
  await sleep(400);
  const slots = (p) => p.evaluate(() => window.__game.sim.units.slice(0, 2).map((u) => `${u.char.id}:${u.loadout}`));
  const hs0 = await slots(H), gs0 = await slots(G);
  check('online: both sims put each side\'s slots on its own fighter (COURIER reboot,mopSpin; CHEF updraft,groundFault)', JSON.stringify(hs0) === JSON.stringify(gs0) && hs0[0] === 'courier:reboot,mopSpin' && hs0[1] === 'chef:updraft,electrician_groundFault', JSON.stringify([hs0, gs0]));
  await watchLent(H); await watchLent(G);
  // real presses on both sides: walk in, swing, and now and then ↓ 1+3 or ↓ 2+4
  await H.keyboard.down('ArrowRight'); await G.keyboard.down('ArrowLeft');
  const t0 = Date.now(); let k = 0;
  while (Date.now() - t0 < 45000 && !((await state(H)) === 'onlinePost' && (await state(G)) === 'onlinePost')) {
    k++;
    if (k % 3 === 0) {
      const pair = k % 6 === 0 ? ['KeyU', 'KeyJ'] : ['KeyI', 'KeyK'], gp = k % 6 === 0 ? ['KeyI', 'KeyK'] : ['KeyU', 'KeyJ'];
      for (const [pp, keys] of [[H, pair], [G, gp]]) { await pp.keyboard.down('KeyS'); await pp.keyboard.down(keys[0]); await pp.keyboard.down(keys[1]); }
      await sleep(90);
      for (const [pp, keys] of [[H, pair], [G, gp]]) { await pp.keyboard.up(keys[0]); await pp.keyboard.up(keys[1]); await pp.keyboard.up('KeyS'); }
    } else {
      await H.keyboard.press(['KeyU', 'KeyI', 'KeyJ', 'KeyK'][k % 4]); await G.keyboard.press(['KeyI', 'KeyU', 'KeyK', 'KeyJ'][k % 4]);
    }
    await sleep(380);
  }
  await H.keyboard.up('ArrowRight'); await G.keyboard.up('ArrowLeft');
  const done = await until(async () => (await state(H)) === 'onlinePost' && (await state(G)) === 'onlinePost', 30000);
  const hst = await H.evaluate(() => window.__net.stats()), gst = await G.evaluate(() => window.__net.stats());
  const hv = await H.evaluate(() => window.__net.view()), gv = await G.evaluate(() => window.__net.view());
  check('online: the match ends agreed on both pages (the same final state hash), no desync', !!done && hv.last && gv.last && hv.last.hash === gv.last.hash && !(hst && hst.desync) && !(gst && gst.desync),
    JSON.stringify({ h: hv.last && hv.last.hash, g: gv.last && gv.last.hash, hd: hst && hst.desync, gd: gst && gst.desync }));
  const hl = await H.evaluate(() => window.__lent), gl = await G.evaluate(() => window.__lent);
  check('online: each side\'s borrowed moves came out, and both pages saw the same ones', hl[0].length > 0 && hl[1].length > 0 && JSON.stringify(hl.map((x) => [...x].sort())) === JSON.stringify(gl.map((x) => [...x].sort())), JSON.stringify({ host: hl, guest: gl }));
  console.log(`      rounds ${JSON.stringify(hv.last && hv.last.wins)}, resyncs ${hst && hst.resyncs}/${gst && gst.resyncs}`);
  if (SHOTS) await G.screenshot({ path: `${SHOTS}/online-2-post-guest.png` });
  check('online: no page errors', !H.errors.length && !G.errors.length, [...H.errors, ...G.errors].join(' | '));
  await H.ctx.close(); await G.ctx.close();
} finally { await b.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
