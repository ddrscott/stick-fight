#!/usr/bin/env node
// The connection meter on screen (README, Multiplayer, Reconnecting: The connection meter): `npm run test:meter`, real
// Chromium against the built game and the local Worker (npm run build, then npm run dev:worker).
//   node scripts/netsim/meter-browser.mjs [http://127.0.0.1:8787/] [--shots <dir>]
//
// 1. HOST A GAME (1280x720, mouse) shows the host's own connection to the room: bars and YOUR CONNECTION · N MS.
// 2. A weak guest: a phone held upright (390x844, touch) whose WebSocket waits 110 to 170 ms each way, both on the
//    relay. On the online pick screen both sides show RELAY, a round trip over 300 ms, two bars or fewer and
//    WEAK CONNECTION: EXPECT LAG. In the fight, the corner readout gives way to the meter and the warning after a
//    couple of seconds, and it stays a small strip (it must not cover the fight).
// 3. A good link: the same guest held sideways (844x390) on a DataChannel with no added delay: DIRECT, three or four
//    bars, no warning, and no meter in the fight's readout.
// 4. The crew lobby (upright phone): YOUR CONNECTION · N MS under the crew's PLAY.
// 5. Everywhere: the words never glow (only the plain dark outline), the bars have square corners, no page errors.
// Exit code 1 on any failure.
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const BASE = (argv.find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/').replace(/\/?$/, '/');
const API = BASE + 'api/';
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const until = async (fn, ms = 20000, every = 150) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };
const state = (p) => p.evaluate(() => window.__flow.state);
// pumped from a timer, drawing only every 60th tick (and once more before each screenshot), for the same reason
const pump = (p) => p.evaluate(() => { window.__gauntlet.step(0); let last = performance.now(), k = 0; setInterval(() => { const now = performance.now(), ms = Math.min(100, now - last); last = now; if (++k % 60 === 0) window.__gauntlet.step(ms); else window.__game.advance(ms); }, 8); });
/** a meter on the page: its bars (from the nm-qN class), its words, whether the warning shows, and its box */
const meter = (p, sel) => p.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect(), w = el.querySelector('.nm-w');
  const shown = !el.hidden && r.width > 0 && getComputedStyle(el).display !== 'none';
  return { bars: +((el.className.match(/nm-q(\d)/) || [])[1] || 0), text: (el.querySelector('.nm-t') || {}).textContent || '', warn: !!w && !w.hidden && w.getBoundingClientRect().width > 0,
    shown, box: { x: r.x, y: r.y, w: r.width, h: r.height } };
}, sel);
/** the meter's words glow? (anything but the plain dark outline, rgba(4, 1, 10, ...)), and its bars' corners */
const looks = (p, sel) => p.evaluate((sel) => {
  const bad = [];
  for (const n of document.querySelectorAll(`${sel} .nm-t, ${sel} .nm-w`)) {
    const ts = getComputedStyle(n).textShadow;
    if (ts && ts !== 'none' && (ts.match(/rgba?\([^)]*\)/g) || []).some((c) => !/^rgba?\(4, 1, 10/.test(c))) bad.push(`${n.className}: ${ts}`);
  }
  const round = [...document.querySelectorAll(`${sel} .nm-bars i`)].filter((i) => getComputedStyle(i).borderRadius !== '0px').length;
  return { glow: bad, round };
}, sel);

// the weak phone: its WebSocket holds what it sends and what it hears 110 to 170 ms each way, in order (TCP), so a
// relayed match sees a 300 to 400 ms round trip with jitter. Off unless the page was opened with it.
function slowSockets() {
  const lat = () => 110 + Math.random() * 60;
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    const t = Math.max(this.__up || 0, performance.now() + lat()); this.__up = t;
    setTimeout(() => { try { send.call(this, d); } catch { /* closed */ } }, t - performance.now());
  };
  const desc = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
  Object.defineProperty(WebSocket.prototype, 'onmessage', {
    configurable: true,
    get() { return this.__om || null; },
    set(fn) {
      this.__om = fn;
      if (this.__hooked) return;
      this.__hooked = true;
      desc.set.call(this, (e) => { const t = Math.max(this.__dn || 0, performance.now() + lat()); this.__dn = t; setTimeout(() => { if (this.__om) this.__om(e); }, t - performance.now()); });
    },
  });
}

const b = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
const pages = [];
async function page(url, { size, touch = false, name, id, slow = false, relay = false }) {
  const ctx = await b.newContext(touch ? { viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: size });
  await ctx.addInitScript((kv) => { for (const k in kv) if (localStorage.getItem(k) === null) localStorage.setItem(k, kv[k]); },
    { 'stick-fight-player': JSON.stringify({ id: id.repeat(32), name, email: '', crews: [] }), 'stick-fight-round-time': '60', 'stick-fight-best-of': '1',
      ...(relay ? { 'stick-fight-net': JSON.stringify({ relay: true }) } : {}) });
  if (slow) await ctx.addInitScript(slowSockets);
  // the game's own frame loop, software-rendered, holds the main thread 150 to 300 ms at a time here (a phone draws a
  // frame in ~16): every message would wait behind it and the meter would read the test machine, not the network.
  // So frames come twice a second; the pump below runs the game and the screens in between
  await ctx.addInitScript(() => { window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 500); });
  const p = await ctx.newPage();
  p.errors = []; p.on('pageerror', (e) => p.errors.push(String(e)));
  p.label = name;
  await p.goto(url);
  await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
  await pump(p);
  pages.push(p);
  return p;
}
async function hostRoom(H) {
  await H.evaluate(() => { const f = window.__flow.debug; f.go('modeSelect'); f.go('onlineMenu'); f.go('onlineHost'); });
  return until(() => H.evaluate(() => (window.__net.state === 'waiting' && window.__net.code) || null), 30000);
}
const shot = async (p, n) => { if (SHOTS) { await p.evaluate(() => window.__gauntlet.step(0)); await p.screenshot({ path: `${SHOTS}/${n}.png` }); } };
const glowFree = async (label, p, sel) => { const l = await looks(p, sel); check(`${label}: the words don't glow, the bars are square`, !l.glow.length && !l.round, [...l.glow, l.round ? `${l.round} round bars` : ''].join(' ')); };

try {
  // ---- 1 and 2: the weak guest, on the relay ----
  const H = await page(BASE + 'play/', { size: { width: 1280, height: 720 }, name: 'HOSTY', id: 'a', relay: true });
  const code = await hostRoom(H);
  check('host: a room opened', !!code, code || '');
  const hm = await until(async () => { const m = await meter(H, '.fl-hostinfo .fl-meter'); return m && m.bars > 0 ? m : null; }, 10000);
  check('host screen: bars and YOUR CONNECTION · N MS', !!hm && /^YOUR CONNECTION · \d+ MS$/.test(hm.text), hm ? `${hm.bars} bars, ${hm.text}` : 'no reading');
  check('host screen: a local Worker is a good connection (3 or 4 bars, no warning)', !!hm && hm.bars >= 3 && !hm.warn);
  await glowFree('host screen', H, '.fl-hostinfo .fl-meter');
  await shot(H, '1-host');

  const G = await page(`${BASE}room/${code}`, { size: { width: 390, height: 844 }, touch: true, name: 'SLOWPOKE', id: 'b', slow: true, relay: true });
  check('weak guest and host reach the pick screen', !!(await until(async () => (await state(H)) === 'onlineSelect' && (await state(G)) === 'onlineSelect', 40000)));
  for (const [who, p] of [['host', H], ['weak guest (upright)', G]]) {
    const m = await until(async () => { const x = await meter(p, '.fl-pickmeter'); return x && x.bars > 0 && x.bars <= 2 && x.warn ? x : null; }, 20000);
    const last = m || (await meter(p, '.fl-pickmeter'));
    check(`${who} pick screen: RELAY, a slow round trip, 2 bars or fewer, WEAK CONNECTION: EXPECT LAG`, !!m && /^RELAY · \d+ MS$/.test(m.text) && +m.text.match(/(\d+) MS/)[1] >= 250,
      last ? `${last.bars} bars, ${last.text}, warning ${last.warn}` : 'no meter');
    const vp = p.viewportSize();
    check(`${who} pick screen: the meter is on screen`, !!last && last.box.y >= 0 && last.box.y + last.box.h <= vp.height && last.box.x >= 0 && last.box.x + last.box.w <= vp.width + 1, last ? JSON.stringify(last.box) : '');
    await glowFree(`${who} pick screen`, p, '.fl-pickmeter');
  }
  await shot(G, '2-pick-weak-upright');
  await shot(H, '2-pick-weak-host');
  await G.evaluate(() => window.__flow.debug.getNet().pick('courier', true));
  await H.evaluate(() => window.__flow.debug.getNet().pick('chef', true));
  check('the weak match starts', !!(await until(async () => (await H.evaluate(() => window.__net.active)) && (await G.evaluate(() => window.__net.active)), 30000)));
  for (const [who, p] of [['host', H], ['weak guest', G]]) {
    const m = await until(async () => { const x = await meter(p, '.nf-readout .nf-meter'); return x && x.shown && x.warn ? x : null; }, 15000);
    const vp = p.viewportSize();
    check(`${who} fight: the readout shows the meter and WEAK CONNECTION: EXPECT LAG`, !!m, m ? `${m.bars} bars, ${m.text}` : JSON.stringify(await meter(p, '.nf-readout .nf-meter')));
    // a strip in the readout's corner: short, and nowhere near the middle of the fight
    const ro = await p.evaluate(() => { const r = document.querySelector('.nf-readout').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const midY = vp.height / 2, coversMiddle = ro.y < midY + vp.height * 0.15 && ro.y + ro.h > midY - vp.height * 0.15 && ro.x < vp.width * 0.6 && ro.x + ro.w > vp.width * 0.4;
    check(`${who} fight: the readout stays a small strip off the middle of the fight`, ro.h <= vp.height * 0.08 && !coversMiddle, JSON.stringify(ro));
    await glowFree(`${who} fight`, p, '.nf-readout .nf-meter');
  }
  await sleep(600);
  await shot(G, '3-fight-weak-upright');
  await shot(H, '3-fight-weak-host');
  for (const p of [H, G]) await p.evaluate(() => window.__net.leave());
  await G.context().close();

  // ---- 3: a good link, phone held sideways ----
  await sleep(500);
  const H2 = await page(BASE + 'play/', { size: { width: 1280, height: 720 }, name: 'HOSTY', id: 'c' });
  const code2 = await hostRoom(H2);
  const S = await page(`${BASE}room/${code2}`, { size: { width: 844, height: 390 }, touch: true, name: 'SIDEWAYS', id: 'd' });
  check('good link: both reach the pick screen', !!(await until(async () => (await state(H2)) === 'onlineSelect' && (await state(S)) === 'onlineSelect', 40000)));
  const gm = await until(async () => { const x = await meter(S, '.fl-pickmeter'); return x && x.bars >= 3 && /^DIRECT/.test(x.text) ? x : null; }, 20000);
  const gl = gm || (await meter(S, '.fl-pickmeter'));
  check('sideways pick screen: DIRECT, 3 or 4 bars, no warning', !!gm && !gm.warn, gl ? `${gl.bars} bars, ${gl.text}, warning ${gl.warn}` : 'no meter');
  const vp = S.viewportSize();
  check('sideways pick screen: the meter is on screen', !!gl && gl.box.y >= 0 && gl.box.y + gl.box.h <= vp.height && gl.box.x + gl.box.w <= vp.width + 1, gl ? JSON.stringify(gl.box) : '');
  await shot(S, '4-pick-good-sideways');
  await S.evaluate(() => window.__flow.debug.getNet().pick('courier', true));
  await H2.evaluate(() => window.__flow.debug.getNet().pick('chef', true));
  check('the good match starts', !!(await until(async () => (await S.evaluate(() => window.__net.active)), 30000)));
  await sleep(4000);
  const fm = await meter(S, '.nf-readout .nf-meter');
  check('good link fight: no meter in the readout, the usual P2P line', !!fm && !fm.shown && /P2P/.test(await S.evaluate(() => document.querySelector('.nf-readout').textContent)));
  for (const p of [H2, S]) await p.evaluate(() => window.__net.leave());

  // ---- 4: the crew lobby ----
  const made = await (await fetch(API + 'crews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'METER CREW' }) })).json();
  check('a crew was made', !!made.slug, JSON.stringify(made).slice(0, 80));
  const C = await page(`${BASE}crew/${made.slug}`, { size: { width: 390, height: 844 }, touch: true, name: 'CREWIE', id: 'e' });
  check('crew lobby reached', !!(await until(async () => (await state(C)) === 'crewLobby', 20000)));
  const cm = await until(async () => { const x = await meter(C, '.fl-crewmeter'); return x && x.bars > 0 ? x : null; }, 15000);
  check('crew lobby: bars and YOUR CONNECTION · N MS', !!cm && /^YOUR CONNECTION · \d+ MS$/.test(cm.text), cm ? `${cm.bars} bars, ${cm.text}` : JSON.stringify(await meter(C, '.fl-crewmeter')));
  await glowFree('crew lobby', C, '.fl-crewmeter');
  await shot(C, '5-crew-lobby');

  for (const p of pages) check(`${p.label}: no page errors`, p.errors.length === 0, p.errors.slice(0, 2).join(' | '));
} catch (e) {
  check('ran to the end', false, String(e).split('\n')[0]);
} finally {
  await b.close().catch(() => {});
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
