#!/usr/bin/env node
// Character select: press to paint, and the screen's idle frame (README, Performance).
// Serves a build (dist/, or --dist <dir> for another one), opens the select screen in headless Chromium
// and measures, per CPU throttle:
//
//   idle    the frame interval and the main-thread work in a frame with nobody touching anything
//           (the game's own profiler, window.__perf; 'sim' is where the flow's select tick lands)
//   press   for each input, from the input's own timestamp to
//             queued  how long the browser held the event before any page code ran
//             draw    the big sheet's canvas redrawn with the new fighter (the frame is built)
//             frames  how many animation frames that took (1 = the very next frame)
//             paint   Chrome's Event Timing for that event: input to the next paint (8 ms steps). Headless
//                     Chromium presents late on any screen, so a control row gives its floor: the same key
//                     on the mode select, a plain menu
//             pop     the focused card's lift-and-scale at its final size (CSS transitions included)
//           keyboard (arrow keys), mouse (hover), touch (a first tap on a card; a second tap would pick)
//           and a gamepad (a fake pad on navigator.getGamepads, its D-pad flipped at a known time)
//
//   node scripts/perf/select.mjs [--dist dir] [--throttle 1,4] [--device desktop|pixel7] [--n 30]
//                                [--online] [--shot file.png] [--json out.json]
//
//   --online   the online pick screen's layout (the same module with the status line and the rival's mark())
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, executablePath } from '../../gauntlet/browser.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes(k);
const THROTTLES = opt('--throttle', '1,4').split(',').map(Number);
const DEVICE = opt('--device', 'desktop');
const N = +opt('--n', 30);
const DEVICES = {
  pixel7: { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2, isMobile: false, hasTouch: true },
};

const root = opt('--dist') ? path.resolve(opt('--dist')) : path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../dist');
if (!fs.existsSync(path.join(root, 'stick-fight/play/index.html'))) { console.error('no build: run npm run build first'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/stick-fight/play/`;

const browser = await chromium.launch({ headless: true, executablePath, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-blink-features=AutomationControlled'] });

// ---- in the page ---------------------------------------------------------------------------------------
// a fake pad, off until the harness presses it
function fakePad() {
  const pad = { id: 'select.mjs pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__pad = { on: false, set(i, down) { pad.buttons[i] = { pressed: down, touched: down, value: down ? 1 : 0 }; pad.timestamp = performance.now(); } };
  navigator.getGamepads = () => (window.__pad.on ? [pad] : []);
}
// the probe: what was pressed when, and the frame that showed it
function probe() {
  const big = document.querySelector('canvas.fl-big'), ctx = big.getContext('2d');
  const name = () => document.querySelector('.fl-cname').textContent;
  /** @type {any} */
  const P = window.__probe = { pending: null, done: [], frame: 0, events: [], bigName: name(), shown: name(), bigAt: 0, bigFrame: 0, armed: null, starts: [] };
  // the sheet's rig clears its canvas at the top of every draw: that's "the big one was redrawn", stamped with who it shows
  const clear = ctx.clearRect.bind(ctx);
  ctx.clearRect = (...a) => { P.bigName = name(); P.bigAt = performance.now(); P.bigFrame = P.frame; return clear(...a); };
  const FINAL = 1.06;
  const scaleOf = (el) => { const m = getComputedStyle(el).transform.match(/matrix\(([^,]+)/); return m ? +m[1] : 1; };
  P.press = (kind, t0) => { P.pending = { kind, t0, f0: P.frame, from: P.shown }; };
  for (const t of ['keydown', 'pointerdown', 'pointerover']) window.addEventListener(t, (e) => {
    if (P.armed !== t) return;
    P.armed = null; P.press(t, e.timeStamp);
    P.pending.queued = performance.now() - e.timeStamp;   // how long the browser held the event before any page code ran
  }, { capture: true });
  const tick = (now) => {
    P.frame++; P.starts.push(now); if (P.starts.length > 120) P.starts.shift();
    const p = P.pending;
    if (p) {
      const cur = name();
      // drawn: the name changed and the big canvas has been redrawn since, showing it
      // the frame it's in: animation frames begun between the press and the draw (drawn inside the event itself: the next one)
      if (!p.draw && cur !== p.from && P.bigName === cur && P.bigAt >= p.t0) { p.draw = P.bigAt - p.t0; p.frames = Math.max(1, P.starts.filter((t) => t > p.t0 && t <= P.bigAt).length); }
      const f = document.querySelector('.fl-card.fl-focus');
      if (!p.pop && cur !== p.from && f && Math.abs(scaleOf(f) - FINAL) < 0.002) p.pop = performance.now() - p.t0;
      if (p.draw && p.pop) { P.done.push(p); P.pending = null; }
      else if (now - p.t0 > 1500) { p.timeout = true; P.done.push(p); P.pending = null; }
    }
    if (!P.pending) P.shown = name();   // the game's own listener hears a key before this probe does, so 'from' is the last frame's name
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (['keydown', 'pointerdown', 'pointerover'].includes(e.name)) P.events.push({ name: e.name, start: e.startTime, dur: e.duration }); }).observe({ type: 'event', durationThreshold: 16, buffered: false }); } catch { /* no Event Timing */ }
}

const pct = (v, q) => { const s = v.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const r1 = (v) => (v == null ? null : +v.toFixed(1));
const results = [];

for (const throttle of THROTTLES) {
  const ctx = await browser.newContext(DEVICES[DEVICE]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(fakePad);
  const cdp = await ctx.newCDPSession(page);
  await page.goto(base + '?pick=temp');
  await page.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 60000 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  // the control: Event Timing for an arrow key on the mode select, a plain menu of six buttons. Whatever it
  // reads there is this browser's floor for 'paint' (headless Chromium presents late), not the select screen's.
  await page.evaluate(() => {
    window.__game.flow.debug.go('modeSelect');
    window.__ctl = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'keydown') window.__ctl.push(e.duration); }).observe({ type: 'event', durationThreshold: 16 });
  });
  await page.waitForTimeout(1500);
  for (let i = 0; i < N; i++) { await page.keyboard.down(i % 2 ? 'ArrowUp' : 'ArrowDown'); await page.waitForTimeout(40); await page.keyboard.up(i % 2 ? 'ArrowUp' : 'ArrowDown'); await page.waitForTimeout(140 + Math.random() * 90); }
  await page.waitForTimeout(300);
  const ctl = await page.evaluate(() => { const c = window.__ctl; window.__ctl = { push() {} }; return c; });
  const control = { throttle, device: DEVICE, input: 'control: mode select, keyboard', n: ctl.length, paint50: r1(pct(ctl, 0.5)), paint95: r1(pct(ctl, 0.95)) };
  results.push(control); console.log(JSON.stringify(control));
  await page.evaluate((online) => {
    const d = window.__game.flow.debug;
    d.sel.mode = 'arcade'; d.sel.step = 'player';
    d.go('charSelect');
    if (online) document.querySelector('.fl-select').classList.add('fl-netpick');
  }, flag('--online'));
  await page.waitForSelector('canvas.fl-big', { state: 'attached', timeout: 10000 });
  await page.waitForTimeout(2500);

  // ---- idle ----
  await page.evaluate(() => window.__perf.reset());
  await page.waitForTimeout(5000);
  const s = await page.evaluate(() => window.__perf.summary());
  const idle = { fps: r1(s.fps), iv50: r1(s.iv.p50), iv95: r1(s.iv.p95), work50: r1(s.work.p50), work95: r1(s.work.p95), workMax: r1(s.work.max), select50: r1(s.sim.p50), select95: r1(s.sim.p95), longPerMin: Math.round(s.longPerMin) };
  if (opt('--shot') && throttle === THROTTLES[0]) await page.screenshot({ path: opt('--shot') });

  // ---- presses ----
  await page.evaluate(probe);
  const wait = async () => { await page.waitForFunction(() => !window.__probe.pending, null, { timeout: 5000, polling: 20 }); await page.waitForTimeout(140 + Math.random() * 90); };
  const take = async (kind) => {
    const d = await page.evaluate(() => { const P = window.__probe; const out = { done: P.done, events: P.events }; P.done = []; P.events = []; return out; });
    const ok = d.done.filter((p) => !p.timeout);
    const ev = d.events.map((e) => e.dur);
    const row = { throttle, device: DEVICE, input: kind, n: ok.length, missed: d.done.length - ok.length,
      queued50: r1(pct(ok.map((p) => p.queued), 0.5)),
      draw50: r1(pct(ok.map((p) => p.draw), 0.5)), draw95: r1(pct(ok.map((p) => p.draw), 0.95)), drawMax: r1(pct(ok.map((p) => p.draw), 1)),
      frames50: pct(ok.map((p) => p.frames), 0.5), framesMax: pct(ok.map((p) => p.frames), 1),
      paint50: r1(pct(ev, 0.5)), paint95: r1(pct(ev, 0.95)), paintMax: r1(pct(ev, 1)),
      pop50: r1(pct(ok.map((p) => p.pop), 0.5)), pop95: r1(pct(ok.map((p) => p.pop), 0.95)) };
    results.push(row); console.log(JSON.stringify(row));
  };
  const arm = (t) => page.evaluate((t) => { window.__probe.armed = t; }, t);

  // keyboard: a walk around the grid (6 columns by 3 rows), never off its edge so every press moves the cursor
  const walk = ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowLeft', 'ArrowUp', 'ArrowLeft', 'ArrowUp'];
  for (let i = 0; i < N; i++) { await arm('keydown'); await page.keyboard.down(walk[i % walk.length]); await page.waitForTimeout(40); await page.keyboard.up(walk[i % walk.length]); await wait(); }
  await take('keyboard');

  // the cards' centers, for the pointer
  const centers = await page.evaluate(() => [...document.querySelectorAll('.fl-card')].map((c) => { const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
  const order = Array.from({ length: N }, (_, i) => centers[(i * 7 + 3) % centers.length]);

  // gamepad: the D-pad, flipped between frames at a time the page notes
  await page.evaluate(() => { window.__pad.on = true; });
  await page.waitForTimeout(300);
  const padWalk = [15, 15, 13, 15, 13, 14, 14, 12, 14, 12];
  for (let i = 0; i < N; i++) {
    const b = padWalk[i % padWalk.length];
    await page.evaluate((b) => new Promise((r) => setTimeout(() => { window.__probe.press('pad', performance.now()); window.__pad.set(b, true); setTimeout(() => { window.__pad.set(b, false); r(); }, 90); }, Math.random() * 16)), b);
    await wait();
  }
  await page.evaluate(() => { window.__pad.on = false; });
  await take('gamepad');

  // touch: a first tap on a card that isn't focused (held 90 ms, a quick tap)
  for (let i = 0; i < N; i++) {
    const c = order[i];
    await arm('pointerdown');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
    await page.waitForTimeout(90);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait();
  }
  await take('touch');
  const state = await page.evaluate(() => window.__game.flow.state);
  if (state !== 'charSelect') console.error(`touch: a first tap picked a fighter (state ${state})`);

  // mouse: hover from card to card
  await page.mouse.move(5, 5);
  for (let i = 0; i < N; i++) { const c = order[(i + 1) % N]; await arm('pointerover'); await page.mouse.move(c.x, c.y); await wait(); }
  await take('mouse');

  results.push({ throttle, device: DEVICE, idle, errors });
  console.log(JSON.stringify({ throttle, device: DEVICE, idle, errors: errors.length }));
  await ctx.close();
}

if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(results, null, 1));
await browser.close();
server.close();
