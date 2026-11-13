#!/usr/bin/env node
// The character select's ring (README, Arcade flow, Character select), in headless Chromium.
//
//   npx vite --port 8191 &
//   node scripts/select/check.mjs [--url http://127.0.0.1:8191/play/] [--shots <dir>]
//
// Held upright (390x844, 412x915, 375x667, and 395x700 and 412x640 with the browser bars showing), with real touch gestures (CDP Input.dispatchTouchEvent):
//   the screen takes the whole phone and everything on it is inside the viewport; the cards and the sheet are
//   a readable size; a slow drag of one card's width moves one card and picks nothing; a flick carries on past
//   the finger; a tap on a side card brings it to the middle and picks nothing; › and ‹ step one and wrap all
//   the way round; ← on the first fighter goes to the last and → on the last to the first; ↓ goes to the look in
//   use, then PICK, and ↑ comes back the same way; a tap on the middle card picks it; turning the phone rebuilds the screen with the same
//   fighter under the cursor, both ways.
// Sideways (844x390) and desktop (1280x720): the same carousel (.fl-wide) with the sheet beside it, ← on the first
//   fighter going to the last and → on the last to the first, ↓ to the look in use and on to PICK, ↑ back to the
//   middle card, the roster strip under it jumping to a fighter, and (desktop) the wheel stepping it.
// With --online <the local Worker's play/ address> (npm run build && npm run dev:worker first), a host on a
//   desktop and a guest on an upright phone in a real room: the rival's tag on the guest's carousel, a swipe
//   onto it, the host seeing the guest's cursor, and a tap on the middle card locking it in.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, executablePath } from '../../gauntlet/browser.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const URL_ = opt('--url', 'http://127.0.0.1:8191/play/');
const SHOTS = opt('--shots', '');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); };

const browser = await chromium.launch({ headless: true, executablePath, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });

async function open(w, h, touch) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  await ctx.addInitScript(() => { try { localStorage.removeItem('stick-fight-last-pick'); } catch { /* */ } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => ok(false, `[${w}x${h}] page error: ${e.message}`));
  await page.goto(URL_);
  await page.waitForFunction(() => window.__flow && window.__flow.state === 'attract' && document.fonts.status === 'loaded', null, { timeout: 30000 });
  await sleep(1200);
  const cdp = touch ? await ctx.newCDPSession(page) : null;
  page.drag = async (x, y, dx, { steps = 14, hold = 120, gap = 12 } = {}) => {
    let ts = Date.now() / 1000;
    const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts, timestamp: ts });
    await send('touchStart', [{ x, y, id: 1 }]);
    for (let i = 1; i <= steps; i++) { ts += gap / 1000; await send('touchMove', [{ x: x + dx * i / steps, y, id: 1 }]); await sleep(gap); }
    if (hold) { await sleep(hold); ts += hold / 1000; await send('touchMove', [{ x: x + dx, y, id: 1 }]); }
    ts += 0.004;
    await send('touchEnd', []);
    await sleep(700);
  };
  page.toSelect = async () => {
    await page.evaluate(() => window.__flow.debug.go('modeSelect')); await sleep(400);
    await page.evaluate(() => { const d = window.__flow.debug; d.sel.mode = 'training'; d.sel.step = 'player'; d.go('charSelect'); });
    await sleep(800);
  };
  page.who = () => page.evaluate(() => (document.querySelector('#flow .fl-cname') || {}).textContent || '');
  page.state = () => page.evaluate(() => `${window.__flow.state}/${window.__flow.debug.sel.step}`);
  page.roster = () => page.evaluate(() => [...document.querySelectorAll('#flow .fl-card b')].map((b) => b.textContent));
  page.key = async (k) => { await page.keyboard.press(k); await sleep(250); };
  page.focused = () => page.evaluate(() => { const f = document.querySelector('#flow .fl-focus'); return f ? (f.classList.contains('fl-card') ? 'card' : f.textContent) : ''; });
  page.shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${w}x${h}-${name}.png`) }); };
  return { ctx, page };
}

const box = (page, sel) => page.evaluate((s) => { const n = document.querySelector(s); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }, sel);

for (const [w, h] of [[390, 844], [412, 915], [375, 667], [395, 700], [412, 640]]) {
  const tag = `[${w}x${h}]`;
  const { ctx, page } = await open(w, h, true);
  await page.toSelect();
  const tall = await page.evaluate(() => !!document.querySelector('#flow .fl-screen.fl-tall'));
  ok(tall, `${tag} upright: the select is the carousel`);
  // everything a player reads or presses is inside the viewport (the side cards hang off on purpose: they're in the ring)
  const out = await page.evaluate(() => {
    const bad = [];
    for (const n of document.querySelectorAll('#flow .fl-tall .fl-h2, #flow .fl-tall .fl-label, #flow .fl-tall .fl-btn:not(.fl-card), #flow .fl-tall .fl-detail, #flow .fl-tall .fl-small, #flow .fl-ring, #flow .fl-ringstep, #flow .fl-card.fl-focus')) {
      const r = n.getBoundingClientRect();
      if (r.top < -1 || r.left < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) bad.push(`${n.className} ${Math.round(r.top)}..${Math.round(r.bottom)}`);
    }
    return bad;
  });
  ok(!out.length, `${tag} nothing to read or press is off screen ${out.join(', ')}`);
  // no label runs out of its button or off the line it's on (LEAVE ROOM is the longest, on the online screen)
  const spill = await page.evaluate(() => [...document.querySelectorAll('#flow .fl-tall .fl-selfoot .fl-btn, #flow .fl-tall .fl-small')].filter((b) => b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().height > 30 && b.classList.contains('fl-small')).map((b) => b.textContent));
  ok(!spill.length, `${tag} every footer label fits on its line ${spill.join(', ')}`);
  const mid = await box(page, '#flow .fl-card.fl-focus');
  const nameH = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#flow .fl-cname')).fontSize));
  const moveH = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#flow .fl-moves b')).fontSize));
  const zoom = await page.evaluate(() => parseFloat(document.querySelector('#flow .fl-screen').style.zoom || '1'));
  console.log(`     middle card ${Math.round(mid.w)}x${Math.round(mid.h)} px, fighter name ${Math.round(nameH * zoom)} px, move names ${Math.round(moveH * zoom)} px, zoom ${zoom}`);
  ok(mid.h * zoom >= 150, `${tag} the middle card is at least 150 px tall (${Math.round(mid.h * zoom)})`);
  ok(moveH * zoom >= 15, `${tag} move names are at least 15 px (${Math.round(moveH * zoom)})`);
  await page.shot('open');

  const names = await page.roster();
  const n = names.length;
  const at = async () => names.indexOf(await page.who());
  // the carousel is one size for every fighter (the sheet under it doesn't grow or shrink), and no name is cut off
  const sizes = new Set(), cut = [];
  for (let i = 0; i < n; i++) {
    await page.evaluate((k) => window.__flow.debug.ui.setFocus(k), i); await sleep(40);
    const r = await page.evaluate(() => { const q = (s) => document.querySelector(s); const nm = q('#flow .fl-cname');
      return { h: Math.round(q('#flow .fl-ring').getBoundingClientRect().height), cut: nm.scrollWidth > nm.clientWidth + 1 ? nm.textContent : '',
        rows: [...document.querySelectorAll('#flow .fl-moves b, #flow .fl-moves em')].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent) }; });
    sizes.add(r.h); if (r.cut) cut.push(r.cut); cut.push(...r.rows);
  }
  ok(sizes.size === 1, `${tag} the carousel is ${[...sizes].join(' / ')} px tall for all ${n} fighters`);
  ok(!cut.length, `${tag} no fighter's name, move or input is cut off ${cut.join(', ')}`);
  await page.evaluate(() => window.__flow.debug.ui.setFocus(0)); await sleep(400);
  ok(await at() === 0, `${tag} opens on the first fighter (${await page.who()})`);
  const ring = await box(page, '#flow .fl-ring');
  const step = mid.w * 0.84;   // RING.step in select.js: the distance between the middle card and the next

  // a slow drag one card's width to the left: the next fighter, and nothing picked
  await page.drag(ring.x + 40, ring.y, -step, { hold: 160 });
  ok(await at() === 1, `${tag} a drag of one card moves one card (on ${await page.who()})`);
  ok(await page.state() === 'charSelect/player', `${tag} a drag picks nothing`);
  // back the other way
  await page.drag(ring.x - 40, ring.y, step, { hold: 160 });
  ok(await at() === 0, `${tag} and back (on ${await page.who()})`);
  // a flick: a short fast swipe carries on further than the finger went
  await page.drag(ring.x + 60, ring.y, -step * 0.9, { steps: 5, hold: 0, gap: 8 });
  const flung = await at();
  ok(flung >= 2, `${tag} a flick of under one card carries on (to ${flung}: ${await page.who()})`);
  await page.shot('after-flick');
  // the wrap: dragging right from the first fighter goes round to the last
  await page.evaluate(() => window.__flow.debug.ui.setFocus(0));
  await sleep(500);
  await page.drag(ring.x - 40, ring.y, step, { hold: 160 });
  ok(await at() === n - 1, `${tag} a drag right from the first fighter goes round to the last (${await page.who()})`);

  // a tap on the card to the right of the middle brings it there, and picks nothing
  await page.evaluate(() => window.__flow.debug.ui.setFocus(0)); await sleep(500);
  await page.touchscreen.tap(Math.min(w - 8, mid.x + step), mid.y); await sleep(500);
  ok(await at() === 1, `${tag} a tap on the side card brings it to the middle (${await page.who()})`);
  ok(await page.state() === 'charSelect/player', `${tag} that tap picks nothing`);

  // › and ‹: one step each, and all the way round
  const next = await box(page, '#flow .fl-next'), prev = await box(page, '#flow .fl-prev');
  ok(next.w >= 44 && next.h >= 36, `${tag} › is a thumb-sized target (${Math.round(next.w)}x${Math.round(next.h)})`);
  for (let i = 0; i < n; i++) { await page.touchscreen.tap(next.x, next.y); await sleep(60); }
  await sleep(500);
  ok(await at() === 1, `${tag} › ${n} times goes all the way round (${await page.who()})`);
  await page.touchscreen.tap(prev.x, prev.y); await sleep(200); await page.touchscreen.tap(prev.x, prev.y); await sleep(500);
  ok(await at() === n - 1, `${tag} ‹ from the first fighter goes to the last (${await page.who()})`);

  // keys: the same ring, and the footer under it
  await page.evaluate(() => window.__flow.debug.ui.setFocus(0)); await sleep(400);
  await page.key('ArrowLeft');
  ok(await at() === n - 1, `${tag} ← on the first fighter goes to the last (${await page.who()})`);
  await page.key('ArrowRight');
  ok(await at() === 0, `${tag} → on the last goes to the first (${await page.who()})`);
  await page.key('ArrowDown');
  ok(/IN USE/.test(await page.focused()), `${tag} ↓ goes to the look in use (${await page.focused()})`);
  await page.key('ArrowDown');
  ok(await page.focused() === 'PICK', `${tag} ↓ again goes to PICK (${await page.focused()})`);
  await page.key('ArrowUp');
  ok(/IN USE/.test(await page.focused()), `${tag} ↑ stops at the looks`);
  await page.key('ArrowUp');
  ok(await page.focused() === 'card' && await at() === 0, `${tag} ↑ comes back to the middle card`);

  // the unique moves: the middle card throws one within a few seconds
  await page.evaluate(() => window.__flow.debug.ui.setFocus(1)); await sleep(3200);
  await page.shot('showcase');

  // a phone turned with the screen up: the same fighter, in the sideways carousel, and back
  await page.evaluate(() => window.__flow.debug.ui.setFocus(5)); await sleep(500);
  const before = await page.who();
  await page.setViewportSize({ width: h, height: w }); await sleep(900);
  const side = await page.evaluate(() => ({ tall: !!document.querySelector('#flow .fl-tall'), wide: !!document.querySelector('#flow .fl-wide .fl-ring') }));
  ok(!side.tall && side.wide && await page.who() === before, `${tag} turned sideways: the carousel beside the sheet, still on ${before} (${await page.who()})`);
  await page.setViewportSize({ width: w, height: h }); await sleep(900);
  ok(await page.evaluate(() => !!document.querySelector('#flow .fl-tall')) && await page.who() === before, `${tag} turned back: the carousel, still on ${before}`);

  // a tap on the middle card picks it (training: on to the dummy)
  const m2 = await box(page, '#flow .fl-card.fl-focus');
  await page.touchscreen.tap(m2.x, m2.y); await sleep(600);
  ok(await page.state() === 'charSelect/dummy', `${tag} a tap on the middle card picks it (${await page.state()})`);
  await page.shot('dummy');
  await ctx.close();
}

for (const [w, h, touch] of [[844, 390, true], [1280, 720, false]]) {
  const tag = `[${w}x${h}]`;
  const { ctx, page } = await open(w, h, touch);
  await page.toSelect();
  ok(await page.evaluate(() => !document.querySelector('#flow .fl-tall') && !!document.querySelector('#flow .fl-wide .fl-ring') && !document.querySelector('#flow .fl-grid')), `${tag} sideways: the carousel, sheet beside it`);
  const names = await page.roster();
  const n = names.length;
  const at = async () => names.indexOf(await page.who());
  await page.key('ArrowLeft');
  ok(await at() === n - 1, `${tag} ← on the first fighter goes to the last (${await page.who()})`);
  await page.key('ArrowRight');
  ok(await at() === 0, `${tag} → on the last goes to the first (${await page.who()})`);
  await page.key('ArrowRight');
  ok(await at() === 1, `${tag} → is the next fighter (${await page.who()})`);
  await page.key('ArrowDown');
  ok(/IN USE/.test(await page.evaluate(() => window.__flow.debug.ui.items[window.__flow.debug.ui.focus].el.textContent)), `${tag} ↓ goes to the look in use`);
  await page.key('ArrowDown');
  ok(await page.focused() === 'PICK', `${tag} ↓ again goes to PICK (${await page.focused()})`);
  await page.key('ArrowUp'); await page.key('ArrowUp');
  ok(await page.focused() === 'card' && await at() === 1, `${tag} ↑ comes back to the middle card`);
  // the strip under the carousel: a press on a mark jumps straight to that fighter
  await page.evaluate(() => document.querySelectorAll('#flow .fl-dot')[7].click()); await sleep(400);
  ok(await at() === 7, `${tag} the roster strip jumps to a fighter (${await page.who()})`);
  // everything on screen, nothing under 12 px
  const fit = await page.evaluate(() => {
    let min = 99, out = 0;
    for (const n of document.querySelectorAll('#flow .fl-select *')) {
      if (!n.offsetParent || ![...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
      if (n.closest('.fl-ring') || getComputedStyle(n).visibility === 'hidden') continue;   // the cards off the ring's edges are clipped by it
      const r = n.getBoundingClientRect(); if (!r.width) continue;
      min = Math.min(min, parseFloat(getComputedStyle(n).fontSize) * (n.currentCSSZoom || 1));
      if (r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out++;
    }
    return { min, out };
  });
  ok(fit.min >= 12 && fit.out === 0, `${tag} nothing off screen and no text under 12 px (smallest ${fit.min.toFixed(1)} px, ${fit.out} off)`);
  if (!touch) {
    const r = await box(page, '#flow .fl-ring');
    await page.mouse.move(r.x, r.y); await page.mouse.wheel(0, 120); await sleep(400);
    ok(await at() === 8, `${tag} the wheel steps it (${await page.who()})`);
  }
  await page.shot('wide');
  await ctx.close();
}

// ---- the online pick screen held upright, through the local Worker (npm run build && npm run dev:worker):
//      --online http://127.0.0.1:8787/play/   a host on a desktop, a guest on an upright phone
const ONLINE = opt('--online', '');
if (ONLINE) {
  const T = '[online pick screen, guest upright 390x844]';
  const prof = (name, c) => JSON.stringify({ id: c.repeat(32), name, email: '', crews: [] });
  const until = async (fn, ms = 40000) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(200); } };
  // the host in a browser of its own: two pages in one headless browser share its frames, and the one behind stalls
  const hb = await chromium.launch({ headless: true, executablePath, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
  const hc = await hb.newContext({ viewport: { width: 1280, height: 720 } });
  await hc.addInitScript((p) => { localStorage.setItem('stick-fight-player', p); localStorage.removeItem('stick-fight-last-pick'); }, prof('HOSTY', 'a'));
  const H = await hc.newPage();
  await H.goto(ONLINE);
  await H.waitForFunction(() => window.__flow && window.__flow.state === 'attract', null, { timeout: 60000 });
  await sleep(800);
  await H.evaluate(() => { const f = window.__flow.debug; f.go('modeSelect'); f.go('onlineMenu'); f.go('onlineHost'); });
  const code = await until(() => H.evaluate(() => (window.__net.state === 'waiting' && window.__net.code) || null));
  ok(!!code, `${T} the host has a room (${code})`);
  const gc = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await gc.addInitScript((p) => { localStorage.setItem('stick-fight-player', p); localStorage.removeItem('stick-fight-last-pick'); }, prof('GUESTY', 'b'));
  const G = await gc.newPage();
  G.on('pageerror', (e) => ok(false, `${T} page error: ${e.message}`));
  await G.goto(`${ONLINE}?room=${code}`);
  ok(await until(() => G.evaluate(() => window.__flow && window.__flow.state === 'onlineSelect')), `${T} the guest is on the online pick screen`);
  await until(() => H.evaluate(() => window.__flow.state === 'onlineSelect'));
  await sleep(1500);
  ok(await G.evaluate(() => !!document.querySelector('#flow .fl-tall.fl-netpick')), `${T} it's the carousel`);
  // the host moves to the next fighter: the guest sees the RIVAL tag on that card, which is the one beside the middle
  await H.keyboard.press('ArrowRight');
  const rival = await until(() => G.evaluate(() => { const c = document.querySelector('#flow .fl-card.fl-rival'); return c ? c.querySelector('b').textContent : null; }), 15000);
  ok(rival === 'INTERN', `${T} the rival's card is tagged (${rival})`);
  const tagIn = await G.evaluate(() => { const t = document.querySelector('#flow .fl-card.fl-rival .fl-tag'); if (!t) return false; const r = t.getBoundingClientRect(); return r.width > 20 && r.left >= 0 && r.right <= innerWidth; });
  ok(tagIn, `${T} the RIVAL tag is on screen and readable`);
  // the guest swipes to it: both cursors on one card, YOU over RIVAL
  const ring = await box(G, '#flow .fl-ring'), m = await box(G, '#flow .fl-card.fl-focus');
  const cdp = await gc.newCDPSession(G);
  let ts = Date.now() / 1000;
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts, timestamp: ts });
  await send('touchStart', [{ x: ring.x + 40, y: ring.y, id: 1 }]);
  for (let i = 1; i <= 14; i++) { ts += 0.012; await send('touchMove', [{ x: ring.x + 40 - m.w * 0.84 * i / 14, y: ring.y, id: 1 }]); await sleep(12); }
  await sleep(160); ts += 0.16; await send('touchMove', [{ x: ring.x + 40 - m.w * 0.84, y: ring.y, id: 1 }]); ts += 0.004; await send('touchEnd', []);
  await sleep(900);
  ok(await G.evaluate(() => { const c = document.querySelector('#flow .fl-card.fl-focus'); return !!c && c.classList.contains('fl-rival'); }), `${T} swiped onto the rival's card: both cursors on it`);
  const hostSees = await until(() => H.evaluate(() => /INTERN/.test((document.querySelector('#flow .fl-selstatus') || {}).textContent || '') || null), 8000);
  ok(!!hostSees, `${T} the host sees the guest's cursor move (${await H.evaluate(() => (document.querySelector('#flow .fl-selstatus') || {}).textContent)})`);
  // a tap on the middle card locks it in
  const m2 = await box(G, '#flow .fl-card.fl-focus');
  await G.touchscreen.tap(m2.x, m2.y); await sleep(900);
  const st = await G.evaluate(() => (document.querySelector('#flow .fl-selstatus') || {}).textContent || '');
  ok(/READY/.test(st), `${T} a tap on the middle card picks it (${st})`);
  const spill = await G.evaluate(() => [...document.querySelectorAll('#flow .fl-tall .fl-selfoot .fl-btn')].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent));
  ok(!spill.length, `${T} LEAVE ROOM and the rest fit their buttons ${spill.join(', ')}`);
  if (SHOTS) await G.screenshot({ path: path.join(SHOTS, 'online-guest-upright.png') });
  await gc.close(); await hb.close();
}

await browser.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
