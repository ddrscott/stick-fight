#!/usr/bin/env node
// Every control in the SUPPLY CLOSET can be reached on a phone (README, Progression, The Supply Closet: reach check).
//   npm run test:closet:reach [-- http://127.0.0.1:4173/] [--only <viewport label>] [--out <dir>]
// Against the built game (npm run build; npm run preview, or the Worker). A guest with some sticks, no Worker calls.
//
// For each phone viewport (touch, isMobile, the device's DPR) and each closet screen (BARISTA's shelf, the CUSTOM
// EMPLOYEE page of slot A and of slot B), every button on the screen (the ‹ chip, the tabs, each card, the slot and
// upgrade cards) has to be reachable:
//   1. by finger: while it isn't fully inside every box that clips it, a real touch drag (CDP synthesizeScrollGesture,
//      so the touch layer's guarded-box rule in src/touch.js applies) on the box that should scroll it. A drag that
//      moves nothing is a failure: the box doesn't scroll by touch.
//   2. once there, it's on top at its center: elementFromPoint hits it or a child (not the touch controls, the HUD
//      band, the corner bar or another card), and its box is inside the viewport.
//   3. by keyboard or pad: stepping the flow's focus through every item in order, then back, leaves each focused item
//      inside its clipping boxes (the screen scrolls the cursor into view).
// Screenshots of each screen at each viewport, as opened and scrolled to its last control, go to scripts/closet/results/.
// Exits 1 when anything can't be reached.
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : '');
const BASE = (argv.find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:4173/').replace(/\/?$/, '/');
const OUT = arg('--out') || path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
const ONLY = arg('--only');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWPORTS = [
  ['pixel7-side', 915, 412, 2.625], ['pixel7-up', 412, 915, 2.625],
  ['small-side', 640, 360, 3], ['small-up', 360, 640, 3],
  ['fold-side', 1104, 884, 2.625], ['fold-up', 884, 1104, 2.625],
  ['iphone-side', 844, 390, 3], ['iphone-up', 390, 844, 3],
].filter((v) => !ONLY || v[0] === ONLY);
const SCREENS = ['shelf', 'slotA', 'slotB'];

// ---- in-page helpers (strings, so they run as they are) --------------------------------------------------------
// The visible rect of an element: the viewport, cut by every ancestor that clips (overflow not visible), and the
// innermost of those ancestors that still has scrolling to do in the direction needed.
const PAGE = () => {
  window.__reach = {
    controls() {
      const sel = '#flow .fl-screen button, #flow .fl-backchip';
      return [...document.querySelectorAll(sel)].filter((n) => n.offsetParent !== null && getComputedStyle(n).visibility !== 'hidden');
    },
    label(n) {
      const d = n.dataset;
      if (n.classList.contains('fl-backchip')) return 'back chip';
      if (d.fighter) return `tab ${d.fighter}`;
      if (d.item) return `card ${d.item}`;
      if (d.slot) return `slot ${d.slot}`;
      if (d.stat) return `upgrade ${d.stat}`;
      if (d.move !== undefined) return `move ${d.move || 'EMPTY'}`;
      return (n.textContent || n.className).trim().slice(0, 30);
    },
    clip(n) {
      let r = { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
      for (let a = n.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowY === 'visible' && cs.overflowX === 'visible') continue;
        const b = a.getBoundingClientRect();
        const t = b.top + a.clientTop, l = b.left + a.clientLeft;
        r = { top: Math.max(r.top, t), left: Math.max(r.left, l), bottom: Math.min(r.bottom, t + a.clientHeight), right: Math.min(r.right, l + a.clientWidth) };
      }
      return r;
    },
    /** where it stands: fully in its clip, how far off, which box to drag */
    where(i) {
      const n = this.controls()[i];
      if (!n) return null;
      const b = n.getBoundingClientRect(), c = this.clip(n);
      const tall = b.height > c.bottom - c.top - 2;
      const inside = b.left >= c.left - 1 && b.right <= c.right + 1 && (tall ? b.top <= (c.top + c.bottom) / 2 && b.bottom >= (c.top + c.bottom) / 2 : b.top >= c.top - 1 && b.bottom <= c.bottom + 1);
      const dy = b.top < c.top ? b.top - c.top - 8 : b.bottom > c.bottom ? b.bottom - c.bottom + 8 : 0;
      // the innermost scroll box that can move it that way
      let box = null;
      for (let a = n.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (!/(auto|scroll)/.test(cs.overflowY) || a.scrollHeight <= a.clientHeight + 1) continue;
        if (dy > 0 ? a.scrollTop + a.clientHeight < a.scrollHeight - 1 : dy < 0 ? a.scrollTop > 0 : false) { box = a; break; }
      }
      let drag = null;
      if (box) {
        // a point on the box a finger would press: the middle of its visible part, nudged off any card's gap
        const bc = this.clip(box.firstElementChild || box), bb = box.getBoundingClientRect();
        const top = Math.max(bb.top, bc.top, 0), bottom = Math.min(bb.bottom, innerHeight);
        drag = { x: Math.round((Math.max(bb.left, 0) + Math.min(bb.right, innerWidth)) / 2), y: Math.round((top + bottom) / 2), room: Math.max(0, bottom - top), top: box.scrollTop };
        box.dataset.reachBox = '1';
      }
      return { inside, dy: Math.round(dy), drag, rect: { x: b.left, y: b.top, w: b.width, h: b.height }, clip: c };
    },
    boxTop() { const b = document.querySelector('[data-reach-box]'); const t = b ? b.scrollTop : null; if (b) delete b.dataset.reachBox; return t; },
    /** on top at its center, and inside the viewport */
    onTop(i) {
      const n = this.controls()[i];
      const b = n.getBoundingClientRect();
      const x = b.left + b.width / 2, y = b.top + b.height / 2;
      const hit = document.elementFromPoint(x, y);
      const inVp = b.left >= -1 && b.right <= innerWidth + 1 && b.top >= -1 && b.bottom <= innerHeight + 1;
      return { ok: !!hit && (hit === n || n.contains(hit)) && inVp, inVp, hit: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).split(' ').join('.')}` : 'nothing' };
    },
    resetScroll() { for (const a of document.querySelectorAll('#flow *')) if (a.scrollTop) a.scrollTop = 0; },
  };
};

let failures = 0;
const report = [];
const b = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
try {
  for (const [vp, w, h, dpr] of VIEWPORTS) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('stick-fight-career', JSON.stringify({ career: { xp: 150, sticks: 420 }, nudge: { xp: 150, title: 1 } }));
      localStorage.setItem('stick-fight-player', JSON.stringify({ id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join(''), name: 'ALICE', email: '', crews: [] }));
    });
    await ctx.addInitScript(PAGE);
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    const cdp = await ctx.newCDPSession(p);
    await p.goto(BASE + 'play/');
    await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
    await p.evaluate(() => { window.__gauntlet.step(0); let last = performance.now(), k = 0; setInterval(() => { const now = performance.now(), ms = Math.min(100, now - last); last = now; if (++k % 12 === 0) window.__gauntlet.step(ms); else window.__game.advance(ms); }, 8); });

    for (const scr of SCREENS) {
      await p.evaluate(() => { const f = window.__flow; f.debug.closet.fighter = 'barista'; if (f.state !== 'modeSelect') f.debug.go('modeSelect'); f.debug.go('closet'); });
      await p.waitForFunction(() => window.__flow.state === 'closet' && document.querySelector('.cl-tab'), null, { timeout: 10000 });
      if (scr !== 'shelf') {
        const n = scr === 'slotA' ? 1 : 2;
        await p.evaluate((n) => document.querySelector(`.ce-slot[data-slot="${n}"]`).click(), n);
        await p.waitForFunction(() => document.querySelector('.ce-grid'), null, { timeout: 10000 });
      }
      await sleep(700);   // fonts, fit()
      await p.evaluate(() => window.__reach.resetScroll());
      await sleep(100);
      const tag = `${vp}-${scr}`;
      await p.screenshot({ path: path.join(OUT, `${tag}-top.png`) });
      const count = await p.evaluate(() => window.__reach.controls().length);
      const bad = [];

      // 1 + 2: by finger, then on top
      for (let i = 0; i < count; i++) {
        let where = await p.evaluate((i) => window.__reach.where(i), i), why = '';
        for (let tries = 0; !where.inside && tries < 25; tries++) {
          if (!where.drag) { why = `off its box by ${where.dy}px and nothing scrolls to it`; break; }
          const room = Math.max(40, where.drag.room - 40);
          const dist = Math.max(-room, Math.min(room, where.dy));
          await cdp.send('Input.synthesizeScrollGesture', { x: where.drag.x, y: where.drag.y, yDistance: -dist, xDistance: 0, gestureSourceType: 'touch', speed: 1600, preventFling: true, repeatCount: 0 });
          await sleep(80);
          const moved = await p.evaluate((t) => { const now = window.__reach.boxTop(); return now !== t; }, where.drag.top);
          if (!moved) { why = `a drag on its scroll box moved nothing (off by ${where.dy}px)`; break; }
          where = await p.evaluate((i) => window.__reach.where(i), i);
        }
        if (!where.inside && !why) why = `still off by ${where.dy}px after 25 drags`;
        const label = await p.evaluate((i) => window.__reach.label(window.__reach.controls()[i]), i);
        if (!why) {
          const top = await p.evaluate((i) => window.__reach.onTop(i), i);
          if (!top.ok) why = top.inVp ? `under ${top.hit} at its center` : 'outside the viewport';
        }
        if (why) bad.push(`${label}: ${why}`);
      }
      await p.screenshot({ path: path.join(OUT, `${tag}-end.png`) });

      // 3: the cursor, stepped through and back
      await p.evaluate(() => window.__reach.resetScroll());
      const focusBad = await p.evaluate(async () => {
        const ui = window.__flow.debug.ui, R = window.__reach, out = new Set();
        const items = R.controls().filter((n) => !n.classList.contains('fl-backchip'));
        const order = [...items.keys(), ...[...items.keys()].reverse()];
        for (const k of order) {
          ui.setFocus(k);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const n = document.querySelector('#flow .fl-focus');
          if (!n) continue;
          const all = R.controls(), i = all.indexOf(n), wh = R.where(i);
          R.boxTop();
          if (!wh.inside) { out.add(`${R.label(n)}: focused but off screen by ${wh.dy}px`); continue; }
          const top = R.onTop(i);
          if (!top.ok) out.add(`${R.label(n)}: focused but ${top.inVp ? `under ${top.hit}` : 'outside the viewport'}`);
        }
        return [...out];
      });
      bad.push(...focusBad);

      const line = `${bad.length ? 'FAIL' : 'PASS'}  ${tag}  ${count} controls${bad.length ? `, ${bad.length} unreachable` : ''}`;
      console.log(line);
      for (const x of bad) console.log(`        ${x}`);
      report.push({ tag, count, bad });
      failures += bad.length;
    }
    if (errors.length) { console.log(`FAIL  ${vp}: page errors: ${errors.join(' | ')}`); failures++; }
    await ctx.close();
  }
} finally {
  await b.close();
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`\n${failures ? `${failures} unreachable` : 'every control reachable'} across ${report.length} screens; screenshots in ${path.relative(process.cwd(), OUT)}`);
process.exit(failures ? 1 : 0);
