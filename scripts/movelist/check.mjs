#!/usr/bin/env node
// The MOVE LIST scrolls on every input (README, Controls, Move list), in headless Chromium:
//
//   npx vite --port 8193 &
//   node scripts/movelist/check.mjs [--url http://127.0.0.1:8193/play/] [--out /tmp/movelist]
//
// Phone sideways (844x390) and upright (390x844), with real touch gestures (CDP Input.dispatchTouchEvent, which
// the browser scrolls natively or doesn't, the way a finger would): a drag on the list scrolls it and isn't a tap,
// a tap still selects, the tabs scroll sideways where they overflow, the last row of the longest list comes
// clear of the list's edge, and the page under it never moves. Then the things the guard is for: a drag in a
// fight and on a menu still scrolls and pans nothing. Desktop (1280x720): the wheel, the scrollbar, the keys.
// Both openers (the character select and the pause menu), and the SETTINGS panel where it's taller than the
// screen. With --online <the local Worker's play/ address> it also opens a room and drags the list on a guest's
// online pick screen (npm run build && npm run dev:worker first). Exit code 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, executablePath } from '../../gauntlet/browser.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const URL_ = opt('--url', 'http://127.0.0.1:8193/play/');
const OUT = opt('--out', '');
const ONLY = opt('--only', '');   // --only online: just the online pick screen
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ACCIDENTS = ['scissorKick', 'supermanPunch', 'pivotBackfist', 'flashKick', 'helicopter', 'flyingTackle', 'crossKnee', 'springUppercut'];
// classic scrollbars, so the desktop run has a scrollbar to drag (headless draws overlay ones by default)
const browser = await chromium.launch({ headless: true, executablePath, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
let pass = 0, fail = 0;
const ok = (cond, what, detail = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${detail !== '' ? `  (${detail})` : ''}`); };

async function open(w, h, touch, query = '') {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  // every happy accident found, so the last section is as long as it gets
  await ctx.addInitScript((ids) => {
    localStorage.setItem('stick-fight-techniques', JSON.stringify(ids));
    // what a touchmove's default came to, read after every listener has run
    window.__moves = { n: 0, prevented: 0 };
    window.addEventListener('touchmove', (e) => { setTimeout(() => { window.__moves.n++; if (e.defaultPrevented) window.__moves.prevented++; }, 0); }, { passive: true });
  }, ACCIDENTS);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => ok(false, `[${w}x${h}] page error: ${e.message}`));
  await page.goto(URL_ + query);
  await page.waitForFunction(() => window.__flow && window.__flow.state === 'attract' && document.fonts.status === 'loaded', null, { timeout: 30000 });
  await sleep(900);
  const cdp = await ctx.newCDPSession(page);
  /** a one-finger drag; `hold` ms of stillness before lifting kills the fling, so the distance is the finger's */
  page.drag = async (x, y, dx, dy, { steps = 14, hold = 120 } = {}) => {
    // explicit timestamps, 12 ms apart, so the speed the browser reads off the gesture is the same on every run
    let ts = Date.now() / 1000;
    const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts, timestamp: ts });
    await send('touchStart', [{ x, y, id: 1 }]);
    for (let i = 1; i <= steps; i++) { ts += 0.012; await send('touchMove', [{ x: x + dx * i / steps, y: y + dy * i / steps, id: 1 }]); await sleep(12); }
    if (hold) { await sleep(hold); ts += hold / 1000; await send('touchMove', [{ x: x + dx, y: y + dy, id: 1 }]); }
    ts += 0.004;
    await send('touchEnd', []);
    await sleep(350);
  };
  page.toSelect = async () => {
    await page.evaluate(() => window.__flow.debug.go('modeSelect')); await sleep(400);
    await page.evaluate(() => { const d = window.__flow.debug; d.sel.mode = 'training'; d.sel.step = 'player'; d.go('charSelect'); });
    await sleep(700);
  };
  page.toFight = async () => {
    await page.toSelect();
    await page.evaluate(() => window.__flow.debug.pickChar(window.__flow.debug.sel.player)); await sleep(600);
    await page.evaluate(() => window.__flow.debug.pickChar(window.__flow.debug.sel.dummy));
    await page.waitForFunction(() => window.__flow.state === 'fighting');
    await sleep(1500);
  };
  /** press a flow button by its label, the way this device does */
  page.press = async (re) => {
    const p = await page.evaluate((src) => { const b = [...document.querySelectorAll('#flow .fl-btn')].find((x) => new RegExp(src).test(x.textContent) && x.getBoundingClientRect().width); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, re.source);
    if (!p) return false;
    if (touch) await page.touchscreen.tap(p[0], p[1]); else await page.mouse.click(p[0], p[1]);
    await sleep(500);
    return true;
  };
  return { ctx, page };
}
// the move list as it stands
const look = () => {
  const l = document.querySelector('.ml-list');
  if (!l) return null;
  const R = (n) => { const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const rows = [...document.querySelectorAll('.ml-row')], last = rows[rows.length - 1], t = document.querySelector('.ml-tabs');
  const st = document.getElementById('stage').getBoundingClientRect();
  const vv = window.visualViewport;
  return {
    top: l.scrollTop, max: l.scrollHeight - l.clientHeight, list: R(l), pane: R(document.querySelector('.ml-pane')), last: R(last), n: rows.length,
    cur: rows.findIndex((x) => x.classList.contains('ml-cur')), curBox: R(document.querySelector('.ml-cur')),
    tabs: { left: t.scrollLeft, max: t.scrollWidth - t.clientWidth, box: R(t), on: [...t.children].findIndex((x) => x.classList.contains('ml-on')) },
    page: [window.scrollX, window.scrollY, document.scrollingElement.scrollTop, document.body.scrollTop, vv ? vv.offsetTop : 0, vv ? vv.scale : 1].join(','),
    stage: [st.left, st.top, st.width, st.height].map((v) => Math.round(v)).join(','), name: document.querySelector('.ml-name').textContent,
  };
};
const still = () => { const st = document.getElementById('stage').getBoundingClientRect(), vv = window.visualViewport; return [window.scrollX, window.scrollY, document.scrollingElement.scrollTop, document.body.scrollTop, vv ? vv.offsetTop : 0, vv ? vv.scale : 1, ...[st.left, st.top, st.width, st.height].map((v) => Math.round(v))].join(','); };
const inside = (a, b, slack = 1) => a.t >= b.t - slack && a.b <= b.b + slack;
const mid = (b, fx = 0.5, fy = 0.5) => [b.l + b.w * fx, b.t + b.h * fy];

// ---- which fighter has the longest list (with every accident found) ------------------------------------
let LONGEST = '', MOST = 0;
if (!ONLY) {
  const { ctx, page } = await open(1280, 720, false);
  await page.toSelect();
  const cards = await page.evaluate(() => [...document.querySelectorAll('#flow .fl-card')].map((c) => { const r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }));
  for (const [x, y] of cards) {
    await page.mouse.move(x, y); await sleep(60);
    await page.keyboard.press('F1'); await sleep(80);
    const v = await page.evaluate(() => ({ n: document.querySelectorAll('.ml-row').length, id: window.__flow.debug.ui && document.querySelector('.ml-name') ? document.querySelector('.ml-name').textContent : '' }));
    if (v.n > MOST) { MOST = v.n; LONGEST = v.id; }
    await page.keyboard.press('Escape'); await sleep(60);
  }
  ok(MOST > 0, `the longest move list is ${LONGEST}'s, ${MOST} rows over ${cards.length} fighters`);
  await ctx.close();
}
/** the character select with the cursor on the longest list's fighter, by hovering or tapping its card */
async function onLongest(page, touch) {
  await page.toSelect();
  // the cards carry the name; find it by opening each isn't needed, the sheet's name follows the cursor
  const cards = await page.evaluate(() => [...document.querySelectorAll('#flow .fl-card')].map((c) => { const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: c.textContent }; }));
  const want = cards.find((c) => c.text.replace(/\s+/g, ' ').toUpperCase().includes(LONGEST.toUpperCase())) || cards[0];
  // held upright the roster is a carousel (most cards are round the back): step to it with ›, the way a thumb would
  if (await page.evaluate(() => !!document.querySelector('#flow .fl-tall'))) {
    const nx = await page.evaluate(() => { const r = document.querySelector('#flow .fl-next').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    for (let i = 0; i < cards.length; i++) {
      const on = await page.evaluate(() => document.querySelector('#flow .fl-cname').textContent);
      if (on.toUpperCase() === LONGEST.toUpperCase()) break;
      await page.touchscreen.tap(nx[0], nx[1]); await sleep(120);
    }
    await sleep(300);
    return;
  }
  if (touch) await page.touchscreen.tap(want.x, want.y); else await page.mouse.move(want.x, want.y);
  await sleep(300);
}

// ---- phones: touch ------------------------------------------------------------------------------------
for (const [w, h, label] of ONLY ? [] : [[844, 390, 'phone sideways'], [390, 844, 'phone upright']]) {
  const T = `[${label} ${w}x${h}]`;
  const { ctx, page } = await open(w, h, true);
  const shot = (n) => OUT ? page.screenshot({ path: path.join(OUT, `${w}x${h}-${n}.png`) }) : null;

  // a drag on a menu and in a fight: the guard holds
  await page.evaluate(() => window.__flow.debug.go('modeSelect')); await sleep(500);
  let before = await page.evaluate(still);
  await page.evaluate(() => { window.__moves = { n: 0, prevented: 0 }; });
  await page.drag(w * 0.5, h * 0.6, 0, -h * 0.4);
  await page.drag(w * 0.5, h * 0.3, 0, h * 0.4);
  let mv = await page.evaluate(() => window.__moves);
  ok(await page.evaluate(still) === before, `${T} a drag on a menu moves nothing`, before);
  ok(mv.n > 0 && mv.prevented === mv.n, `${T} every touchmove on a menu is still cancelled`, `${mv.prevented} of ${mv.n}`);

  // ---- from the character select ----
  await onLongest(page, true);
  ok(await page.press(/MOVE LIST/), `${T} the character select has a MOVE LIST button`);
  let v = await page.evaluate(look);
  ok(!!v, `${T} MOVE LIST opens from the character select`);
  if (!v) { await ctx.close(); continue; }
  ok(v.name.toUpperCase() === LONGEST.toUpperCase(), `${T} it's the longest list`, `${v.name}, ${v.n} rows`);
  ok(v.max > 100, `${T} the list is longer than its box`, `${Math.round(v.max)} px to scroll`);
  before = v.page + '|' + v.stage;
  const cur0 = v.cur;
  // a drag
  await page.evaluate(() => { window.__moves = { n: 0, prevented: 0 }; });
  await page.drag(...mid(v.list, 0.5, 0.8), 0, -v.list.h * 0.6);
  let a = await page.evaluate(look);
  mv = await page.evaluate(() => window.__moves);
  ok(a.top > v.list.h * 0.4, `${T} a finger drag scrolls the list`, `scrollTop ${Math.round(v.top)} to ${Math.round(a.top)}`);
  ok(a.cur === cur0, `${T} the drag wasn't taken as a tap`, `highlight ${cur0} to ${a.cur}`);
  ok(a.page + '|' + a.stage === before, `${T} the page under it didn't move`);
  // and back down
  await page.drag(...mid(v.list, 0.5, 0.3), 0, v.list.h * 0.3);
  let b = await page.evaluate(look);
  ok(b.top < a.top - 20, `${T} dragging the other way scrolls back`, `${Math.round(a.top)} to ${Math.round(b.top)}`);
  // a flick keeps going after the finger lifts
  await page.drag(...mid(v.list, 0.5, 0.8), 0, -v.list.h * 0.5, { steps: 6, hold: 0 });
  const f1 = (await page.evaluate(look)).top; await sleep(700);
  const f2 = (await page.evaluate(look)).top;
  ok(f2 > b.top + v.list.h * 0.5 + 20 || f2 > f1 + 5, `${T} a flick carries on with momentum`, `finger moved ${Math.round(v.list.h * 0.5)} px, list moved ${Math.round(f2 - b.top)}`);
  // a tap selects (once the flick has come to rest: a tap during the glide catches the list, as on a phone)
  for (let i = 0, last = -1; i < 30; i++) { const t = (await page.evaluate(look)).top; if (Math.abs(t - last) < 0.5) break; last = t; await sleep(100); }
  a = await page.evaluate(look);
  const target = await page.evaluate(() => { const l = document.querySelector('.ml-list').getBoundingClientRect(); const rows = [...document.querySelectorAll('.ml-row')]; const k = rows.findIndex((r) => { const b = r.getBoundingClientRect(); return b.top > l.top + 20 && b.bottom < l.bottom - 20 && !r.classList.contains('ml-cur'); }); const b = rows[k].getBoundingClientRect(); return { k, x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.touchscreen.tap(target.x, target.y); await sleep(300);
  b = await page.evaluate(look);
  ok(b.cur === target.k, `${T} a tap on a row selects it`, `row ${target.k}`);
  ok(Math.abs(b.top - a.top) < 2, `${T} and doesn't move the list`);
  // a drag that starts on the preview pane or the header scrolls nothing
  await page.drag(...mid(b.pane), 0, -60); await page.drag(w * 0.4, 20, 0, 60);
  a = await page.evaluate(look);
  ok(Math.abs(a.top - b.top) < 2 && a.page + '|' + a.stage === before, `${T} a drag off the list scrolls nothing`);
  // to the very bottom: the last row is clear of the list's edge, the pane and the screen
  for (let i = 0; i < 40 && (await page.evaluate(look)).top < v.max - 1; i++) await page.drag(...mid(v.list, 0.5, 0.85), 0, -v.list.h * 0.7, { hold: 60 });
  a = await page.evaluate(look);
  ok(a.top >= a.max - 1, `${T} dragging reaches the bottom`, `${Math.round(a.top)} of ${Math.round(a.max)}`);
  const clearOfPane = a.last.b <= a.pane.t + 1 || a.last.t >= a.pane.b - 1 || a.last.r <= a.pane.l + 1 || a.last.l >= a.pane.r - 1;
  ok(a.last.b <= a.list.b && a.last.b <= h && clearOfPane, `${T} the last row ends above the list's edge, clear of the preview`, `row bottom ${Math.round(a.last.b)}, list bottom ${Math.round(a.list.b)}`);
  ok(a.tabs.on === 4 && a.cur === b.cur, `${T} the lit tab follows the scroll (ACCIDENTS at the bottom), the highlight stays`, `tab ${a.tabs.on}, row ${a.cur}`);
  await shot('list-bottom');
  ok(a.page + '|' + a.stage === before, `${T} the page still hasn't moved`);
  // the tabs
  if (a.tabs.max > 4) {
    await page.drag(...mid(a.tabs.box, 0.8, 0.5), -a.tabs.box.w * 0.6, 0);
    b = await page.evaluate(look);
    ok(b.tabs.left > 20, `${T} the tabs scroll sideways`, `scrollLeft ${Math.round(a.tabs.left)} to ${Math.round(b.tabs.left)} of ${Math.round(a.tabs.max)}`);
    ok(b.tabs.on === a.tabs.on && b.cur === a.cur, `${T} and the drag picked no tab`);
  } else ok(true, `${T} the tabs all fit, nothing to scroll`, `${Math.round(a.tabs.box.w)} px wide`);
  // bring the tabs back to their start, then tap the first
  if (a.tabs.max > 4) for (let i = 0; i < 3; i++) await page.drag(...mid(a.tabs.box, 0.2, 0.5), a.tabs.box.w * 0.7, 0);
  const tab2 = await page.evaluate(() => { const r = document.querySelectorAll('.ml-tabbtn')[0].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.touchscreen.tap(tab2[0], tab2[1]); await sleep(400);
  b = await page.evaluate(look);
  ok(b.tabs.on === 0 && b.cur === 0 && b.top < 5, `${T} tapping the first tab jumps back to the top`, `tab ${b.tabs.on}, row ${b.cur}, scrollTop ${Math.round(b.top)}`);
  // CLOSE
  const cl = await page.evaluate(() => { const r = document.querySelector('.ml-close').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.touchscreen.tap(cl[0], cl[1]); await sleep(400);
  ok(!(await page.evaluate(look)) && await page.evaluate(() => window.__flow.state) === 'charSelect', `${T} CLOSE closes it, back on the character select`);

  // ---- in a fight: the guard ----
  await page.toFight();
  before = await page.evaluate(still);
  await page.evaluate(() => { window.__moves = { n: 0, prevented: 0 }; });
  await page.drag(w * 0.5, h * (h > w ? 0.2 : 0.5), 0, -h * 0.15);
  await page.drag(w * 0.5, h * (h > w ? 0.2 : 0.4), 0, h * 0.3);
  await page.drag(w * 0.25, h * 0.8, 60, -40);   // the stick
  await page.drag(w * 0.5, h * 0.95, 0, -h * 0.5, { steps: 5, hold: 0 });   // a flick up from the bottom edge
  mv = await page.evaluate(() => window.__moves);
  ok(await page.evaluate(still) === before, `${T} touch drags in a fight scroll and pan nothing`, before);
  ok(mv.n > 0 && mv.prevented === mv.n, `${T} every touchmove in a fight is still cancelled`, `${mv.prevented} of ${mv.n}`);
  ok(await page.evaluate(() => window.__flow.state) === 'fighting', `${T} and the fight carries on`);
  await shot('fight-after-drags');

  // ---- from the pause menu ----
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('sf:pause')));
  await page.waitForFunction(() => window.__flow.state === 'paused'); await sleep(500);
  ok(await page.press(/MOVE LIST/), `${T} the pause menu has MOVE LIST`);
  v = await page.evaluate(look);
  ok(!!v, `${T} MOVE LIST opens from the pause menu`);
  if (v) {
    await page.drag(...mid(v.list, 0.5, 0.8), 0, -v.list.h * 0.6);
    a = await page.evaluate(look);
    ok(a.top > v.list.h * 0.4, `${T} and a finger drag scrolls it there too`, `scrollTop ${Math.round(v.top)} to ${Math.round(a.top)}`);
    ok(await page.evaluate(() => window.__flow.state) === 'paused', `${T} the game stays paused under it`);
    await page.touchscreen.tap(cl[0], cl[1]); await sleep(400);
  }

  // ---- SETTINGS: a full-screen page; its middle scrolls by finger, and a volume bar still drags ----
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('sf:settings'))); await sleep(700);
  await page.evaluate(() => document.querySelector('.sf-tab[data-t="controls"]').click()); await sleep(400);
  const sp = () => page.evaluate(() => { const p = document.querySelector('.sf-panel'), r = p.getBoundingClientRect(), m = p.querySelector('.sf-body'), mr = m.getBoundingClientRect(); return { top: m.scrollTop, max: m.scrollHeight - m.clientHeight, page: { l: r.left, t: r.top, r: r.right, b: r.bottom }, box: { l: mr.left, t: mr.top, w: mr.width, h: mr.height, b: mr.bottom }, vw: innerWidth, vh: innerHeight, state: window.__flow.state }; });
  let s = await sp();
  ok(s.page.l <= 0.5 && s.page.t <= 0.5 && s.page.r >= s.vw - 0.5 && s.page.b >= s.vh - 0.5, `${T} SETTINGS covers the whole screen`, `${Math.round(s.page.l)},${Math.round(s.page.t)} to ${Math.round(s.page.r)},${Math.round(s.page.b)}`);
  ok(s.state === 'paused', `${T} the game stays paused under it`);
  if (s.max > 2) {
    await page.drag(s.box.l + s.box.w * 0.5, s.box.t + s.box.h * 0.85, 0, -s.box.h * 0.6);
    const s2 = await sp();
    ok(s2.top > 2, `${T} CONTROLS is taller than the screen, and a drag scrolls it`, `${Math.round(s.max)} px hidden, scrollTop ${Math.round(s2.top)}`);
    await shot('settings-scrolled');
  } else ok(true, `${T} CONTROLS fits, nothing to scroll`);
  // a volume bar is still a slider: a sideways drag on it moves the level and not the page
  await page.evaluate(() => document.querySelector('.sf-tab[data-t="audio"]').click()); await sleep(300);
  const bar = await page.evaluate(() => { const r = document.querySelector('.sf-opt[data-o="sfxVolume"] .sf-bar').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  const lvl = () => page.evaluate(() => document.querySelector('.sf-opt[data-o="sfxVolume"] .sf-num').textContent);
  const lv0 = await lvl(), top0 = (await sp()).top;
  await page.drag(bar.l + bar.w * 0.8, bar.t + bar.h / 2, -bar.w * 0.6, 0);
  ok(await lvl() !== lv0 && Math.abs((await sp()).top - top0) < 2, `${T} a volume bar drags, and doesn't scroll the page`, `${lv0} to ${await lvl()}`);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('sf:settings'))); await sleep(300);
  await ctx.close();
}

// ---- SETTINGS on a screen shorter than the panel (an iPhone sideways with Safari's tab bar up: 844x280) ----
if (!ONLY) {
  const w = 844, h = 280, T = '[short phone 844x280]';
  const { ctx, page } = await open(w, h, true);
  await page.evaluate(() => window.__flow.debug.go('modeSelect')); await sleep(400);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('sf:settings'))); await sleep(700);
  await page.evaluate(() => document.querySelector('.sf-tab[data-t="audio"]').click()); await sleep(300);
  const sp = () => page.evaluate(() => { const m = document.querySelector('.sf-panel .sf-body'), r = m.getBoundingClientRect(), page = [...m.querySelectorAll('.sf-page.sf-show > *')], end = page[page.length - 1].getBoundingClientRect(); return { top: m.scrollTop, max: m.scrollHeight - m.clientHeight, box: { l: r.left, t: r.top, w: r.width, h: r.height, b: r.bottom }, end: end.bottom, still: [scrollX, scrollY, document.scrollingElement.scrollTop].join(',') }; });
  let s = await sp();
  ok(s.max > 20, `${T} AUDIO is taller than what's left of the screen`, `${Math.round(s.max)} px hidden`);
  // down the rows' left side, clear of the volume bars (a drag that starts on one is the bar's)
  for (let i = 0; i < 6; i++) await page.drag(s.box.l + 20, s.box.t + s.box.h * 0.8, 0, -s.box.h * 0.6);
  const s2 = await sp();
  ok(s2.top >= s2.max - 1 && s2.end <= s2.box.b + 12, `${T} a finger drag scrolls it to its last line`, `scrollTop ${Math.round(s2.top)} of ${Math.round(s2.max)}`);
  ok(s2.still === '0,0,0', `${T} and the page under it stays put`);
  if (OUT) await page.screenshot({ path: path.join(OUT, `${w}x${h}-settings-bottom.png`) });
  await ctx.close();
}

// ---- the online pick screen, through the local Worker (npm run build && npm run dev:worker):
//      --online http://127.0.0.1:8787/play/
const ONLINE = opt('--online', '');
if (ONLINE) {
  const T = '[online pick screen, phone sideways 844x390]';
  const prof = (name, c) => JSON.stringify({ id: c.repeat(32), name, email: '', crews: [] });
  const until = async (fn, ms = 40000) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(200); } };
  // the host in a browser of its own: two pages in one headless browser share its frames, and the one behind stalls
  const hb = await chromium.launch({ headless: true, executablePath, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
  const hc = await hb.newContext({ viewport: { width: 1280, height: 720 } });
  await hc.addInitScript((p) => localStorage.setItem('stick-fight-player', p), prof('HOSTY', 'a'));
  const H = await hc.newPage();
  await H.goto(ONLINE);
  await H.waitForFunction(() => window.__flow && window.__flow.state === 'attract', null, { timeout: 60000 });
  await sleep(800);
  await H.evaluate(() => { const f = window.__flow.debug; f.go('modeSelect'); f.go('onlineMenu'); f.go('onlineHost'); });
  const code = await until(() => H.evaluate(() => (window.__net.state === 'waiting' && window.__net.code) || null));
  ok(!!code, `${T} the host has a room`, String(code));
  const gc = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await gc.addInitScript((p) => { localStorage.setItem('stick-fight-player', p); }, prof('GUESTY', 'b'));
  const G = await gc.newPage();
  G.on('pageerror', (e) => ok(false, `${T} page error: ${e.message}`));
  await G.goto(`${ONLINE}?room=${code}`);
  ok(await until(() => G.evaluate(() => window.__flow && window.__flow.state === 'onlineSelect')), `${T} the guest is on the online pick screen`);
  await sleep(1200);
  const p = await G.evaluate(() => { const b = [...document.querySelectorAll('#flow .fl-btn')].find((x) => /MOVE LIST/.test(x.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  ok(!!p, `${T} it has a MOVE LIST button`);
  if (p) {
    await G.touchscreen.tap(p[0], p[1]); await sleep(600);
    const v = await G.evaluate(look);
    ok(!!v, `${T} MOVE LIST opens over it`);
    if (v) {
      const cdp = await gc.newCDPSession(G);
      let ts = Date.now() / 1000;
      const [x, y] = mid(v.list, 0.5, 0.8), dy = -v.list.h * 0.6;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }], timestamp: ts });
      for (let i = 1; i <= 14; i++) { ts += 0.012; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy * i / 14, id: 1 }], timestamp: ts }); await sleep(12); }
      await sleep(120); ts += 0.124;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: ts });
      await sleep(400);
      const a = await G.evaluate(look);
      if (!a) console.log('      closed:', await G.evaluate(() => window.__flow.state + ' | ' + window.__flow.debug.history.slice(-6).join(' > ')));
      ok(a.top > v.list.h * 0.4, `${T} and a finger drag scrolls it`, `scrollTop ${Math.round(v.top)} to ${Math.round(a.top)}`);
      ok(await G.evaluate(() => window.__flow.state) === 'onlineSelect', `${T} the room carries on under it`);
      if (OUT) await G.screenshot({ path: path.join(OUT, 'online-pick-list.png') });
    }
  }
  await gc.close(); await hb.close();
}

// ---- desktop: wheel, scrollbar, keys ---------------------------------------------------------------------
if (!ONLY) {
  const w = 1280, h = 720, T = '[desktop 1280x720]';
  const { ctx, page } = await open(w, h, false);
  const shot = (n) => OUT ? page.screenshot({ path: path.join(OUT, `${w}x${h}-${n}.png`) }) : null;
  for (const from of ['character select', 'pause menu']) {
    if (from === 'character select') { await onLongest(page, false); await page.keyboard.press('F1'); }
    else { await page.keyboard.press('Escape'); await sleep(300); await page.toFight(); await page.keyboard.press('KeyP'); await page.waitForFunction(() => window.__flow.state === 'paused'); await sleep(400); await page.keyboard.press('F1'); }
    await sleep(500);
    let v = await page.evaluate(look);
    ok(!!v, `${T} F1 opens the MOVE LIST from the ${from}`);
    if (!v) continue;
    // back is the top-left ‹ chip naming where closing goes, and the legend says the same (round 2 of [t55b8f])
    const chip = await page.evaluate(() => { const c = document.querySelector('.ml-close'), r = c.getBoundingClientRect(); return { text: c.textContent.trim(), l: r.left, t: r.top, leg: document.querySelector('.ml-legend').textContent }; });
    const where = from === 'pause menu' ? 'PAUSE MENU' : 'FIGHTERS';
    ok(chip.text === where && chip.l < 60 && chip.t < 60 && chip.leg.includes(where), `${T} ${from}: the top-left chip says ‹ ${where}, and so does the legend`, `"${chip.text}" at ${Math.round(chip.l)},${Math.round(chip.t)}; legend "${chip.leg}"`);
    await page.keyboard.press('KeyE'); await sleep(250);
    const tabbed = await page.evaluate(() => [...document.querySelectorAll('.ml-tabbtn')].findIndex((b) => b.classList.contains('ml-on')));
    ok(tabbed === 1, `${T} ${from}: E (RB on a pad) jumps to the next section`, `tab ${tabbed}`);
    await page.keyboard.press('KeyQ'); await sleep(250); v = await page.evaluate(look);
    await page.mouse.move(...mid(v.list));
    await page.mouse.wheel(0, 300); await sleep(300);
    let a = await page.evaluate(look);
    ok(a.top >= 250, `${T} ${from}: the wheel scrolls the list`, `scrollTop ${Math.round(v.top)} to ${Math.round(a.top)}`);
    await page.mouse.move(...mid(v.pane));
    await page.mouse.wheel(0, 200); await sleep(300);
    let b = await page.evaluate(look);
    ok(b.top >= a.top + 150, `${T} ${from}: the wheel over the preview scrolls it too`, `${Math.round(a.top)} to ${Math.round(b.top)}`);
    ok(b.cur === v.cur, `${T} ${from}: the wheel leaves the highlight alone`);
    if (from === 'pause menu') { await page.keyboard.press('Escape'); await sleep(300); ok(await page.evaluate(() => window.__flow.state) === 'paused', `${T} Escape closes it, back on the pause menu`); continue; }
    // the wheel to the very bottom
    await page.mouse.move(...mid(v.list));
    for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 400);
    await sleep(400);
    a = await page.evaluate(look);
    ok(a.top >= a.max - 1 && a.last.b <= a.list.b, `${T} the wheel reaches the bottom, the last row above the list's edge`, `row bottom ${Math.round(a.last.b)}, list bottom ${Math.round(a.list.b)}`);
    await shot('list-bottom');
    // the scrollbar: grab the thumb at the list's right edge and pull it up
    const thumb = await page.evaluate(() => { const l = document.querySelector('.ml-list'), r = l.getBoundingClientRect(); const bar = l.offsetWidth - l.clientWidth; const th = Math.max(20, r.height * l.clientHeight / l.scrollHeight); return { bar, x: r.right - Math.max(4, bar / 2), y: r.bottom - th / 2 - 2 }; });
    // an overlay scrollbar (macOS) has no width of its own; its thumb is still there under the pointer at the edge
    await page.mouse.move(thumb.x - 1, thumb.y - 4); await sleep(150); await page.mouse.move(thumb.x, thumb.y); await sleep(150);
    await page.mouse.down(); await page.mouse.move(thumb.x, thumb.y - 150, { steps: 8 }); await page.mouse.up(); await sleep(300);
    b = await page.evaluate(look);
    if (thumb.bar > 0 || b.top < a.top - 200) ok(b.top < a.top - 200 && b.cur === a.cur, `${T} dragging the scrollbar scrolls the list`, `${Math.round(a.top)} to ${Math.round(b.top)}, bar ${thumb.bar} px wide`);
    else console.log(`      ${T} headless Chromium draws no scrollbar here (0 px wide) and took no drag, so the scrollbar isn't checked`);
    // keys: down to the last row, every row along the way whole inside the list
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await sleep(200);
    a = await page.evaluate(look);
    ok(a.cur === 0 && a.top < 5, `${T} left jumps sections back to the first, at the top`, `row ${a.cur}, scrollTop ${Math.round(a.top)}`);
    let hidden = 0;
    for (let i = 1; i < a.n; i++) { await page.keyboard.press('ArrowDown'); const c = await page.evaluate(look); if (c.cur !== i || !inside(c.curBox, c.list)) hidden++; }
    a = await page.evaluate(look);
    ok(a.cur === a.n - 1 && hidden === 0, `${T} down walks all ${a.n} rows, each one whole inside the list`, `${hidden} cut off`);
    ok(inside(a.last, a.list) && a.last.r <= a.pane.l, `${T} the last row is whole, beside the preview and not under it`, `row ${Math.round(a.last.t)} to ${Math.round(a.last.b)}, list ${Math.round(a.list.t)} to ${Math.round(a.list.b)}`);
    await shot('list-last-row-keys');
    hidden = 0;
    for (let i = a.n - 2; i >= 0; i--) { await page.keyboard.press('ArrowUp'); const c = await page.evaluate(look); if (c.cur !== i || !inside(c.curBox, c.list)) hidden++; }
    ok(hidden === 0, `${T} and up walks them all back`, `${hidden} cut off`);
    for (let s = 1; s <= 4; s++) { await page.keyboard.press('ArrowRight'); const c = await page.evaluate(() => { const l = document.querySelector('.ml-list').getBoundingClientRect(), on = [...document.querySelectorAll('.ml-tabbtn')].findIndex((x) => x.classList.contains('ml-on')); const hd = document.querySelectorAll('.ml-sec')[on].querySelector('.ml-h').getBoundingClientRect(), cur = document.querySelector('.ml-cur').getBoundingClientRect(); return { on, head: hd.top >= l.top - 1 && hd.bottom <= l.bottom + 1, cur: cur.top >= l.top - 1 && cur.bottom <= l.bottom + 1 }; }); ok(c.on === s && c.head && c.cur, `${T} right jumps to section ${s + 1}, its heading and first row in view`, JSON.stringify(c)); }
    await page.keyboard.press('Escape'); await sleep(300);
    ok(!(await page.evaluate(look)), `${T} Escape closes it`);
  }
  await ctx.close();
}

// the keys on a phone-sized list too (a pad or a keyboard on a tablet): every row whole
for (const [w, h] of ONLY ? [] : [[844, 390], [390, 844]]) {
  const T = `[keys at ${w}x${h}]`;
  const { ctx, page } = await open(w, h, true);
  await onLongest(page, true);
  await page.keyboard.press('F1'); await sleep(500);
  let a = await page.evaluate(look), hidden = 0;
  if (!a) { ok(false, `${T} F1 opens the list`); await ctx.close(); continue; }
  for (let i = 1; i < a.n; i++) { await page.keyboard.press('ArrowDown'); const c = await page.evaluate(look); if (c.cur !== i || !inside(c.curBox, c.list)) hidden++; }
  a = await page.evaluate(look);
  const clear = a.last.b <= a.pane.t + 1 || a.last.t >= a.pane.b - 1 || a.last.r <= a.pane.l + 1;
  ok(a.cur === a.n - 1 && hidden === 0 && inside(a.last, a.list) && clear, `${T} down walks all ${a.n} rows, each whole inside the list and clear of the preview`, `${hidden} cut off`);
  if (OUT) await page.screenshot({ path: path.join(OUT, `${w}x${h}-list-last-row-keys.png`) });
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
