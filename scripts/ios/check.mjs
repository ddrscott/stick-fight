#!/usr/bin/env node
// The iPhone Safari helper (src/homescreen.js) and the stage's fit, in headless Chromium dressed as an iPhone:
// Safari's user agent, no Fullscreen API, and windows the size Safari leaves once its bars are up.
//
//   npx vite --port 8191 &
//   node scripts/ios/check.mjs [--url http://127.0.0.1:8191/play/] [--out /tmp/ios]
//
// What it can't show: Chromium's vh and dvh are the same number, so the under-the-fold bug itself (vh taller
// than what you see) only happens on a real iPhone. The check here is that the stage's rule is the dvh one.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, executablePath } from '../../gauntlet/browser.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const URL_ = opt('--url', 'http://127.0.0.1:8191/play/');
const OUT = opt('--out', '');
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const SIZES = [
  { name: 'sideways-tabs', w: 844, h: 280 },   // the task's screenshot: an iPhone 14 sideways with the tab bar on
  { name: 'sideways', w: 844, h: 330 },
  { name: 'sideways-se', w: 667, h: 325, noTip: true },   // the gutter is too narrow for the callout
  { name: 'upright', w: 390, h: 664 },
  { name: 'upright-se', w: 375, h: 553 },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, executablePath, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log(`FAIL ${what}`); } };

async function open(size, { ua = UA, standalone = false, seen = false, query = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: ua });
  await ctx.addInitScript(([ios, sa, sn]) => {
    if (ios) for (const k of ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen']) { try { delete Element.prototype[k]; delete HTMLElement.prototype[k]; } catch {} }
    if (sa) Object.defineProperty(navigator, 'standalone', { value: true });
    if (sn) localStorage.setItem('sf-homescreen-seen', '1');
  }, [ua === UA, standalone, seen]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => ok(false, `[${size.name}] page error: ${e.message}`));
  await page.goto(URL_ + query);
  await page.waitForFunction(() => window.__flow && window.__flow.state === 'attract' && document.fonts.status === 'loaded', null, { timeout: 30000 });
  await sleep(1200);
  return { ctx, page };
}
// what's on screen, and whether the callout touches anything a player presses
const look = () => {
  const vis = (n) => { if (!n) return null; const r = n.getBoundingClientRect(); return r.width && r.height && getComputedStyle(n).display !== 'none' ? r : null; };
  const tip = vis(document.querySelector('.sf-hs-tip')), st = document.getElementById('stage').getBoundingClientRect();
  const hits = [];
  if (tip) for (const n of document.querySelectorAll('#flow .fl-btn, #flow .fl-card, .tc-mini, #credits')) {
    const r = vis(n); if (r && r.left < tip.right && r.right > tip.left && r.top < tip.bottom && r.bottom > tip.top) hits.push(n.className);
  }
  const pill = vis(document.querySelector('.tc-top [data-role="fullscreen"]'));
  const box = vis(document.querySelector('.sf-hs-box'));
  return {
    state: window.__flow.state, tip: tip && { l: tip.left, t: tip.top, r: tip.right, b: tip.bottom }, hits, pill: !!pill,
    tipOverStage: !!tip && tip.left < st.right && tip.right > st.left && tip.top < st.bottom && tip.bottom > st.top,
    stage: { l: st.left, t: st.top, r: st.right, b: st.bottom }, vw: innerWidth, vh: innerHeight,
    box: box && { l: box.left, t: box.top, r: box.right, b: box.bottom, scroll: document.querySelector('.sf-hs-box').scrollHeight > document.querySelector('.sf-hs-box').clientHeight + 1 },
    warn: !!document.querySelector('.sf-hs-warn'),
    dvh: [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => /supports/.test(r.cssText) && /#stage/.test(r.cssText) && /100dvh/.test(r.cssText)); } catch { return false; } }),
  };
};

for (const size of SIZES) {
  const T = `[${size.name} ${size.w}x${size.h}]`;
  const { ctx, page } = await open(size);
  const go = (s) => page.evaluate((st) => window.__flow.debug.go(st), s);
  const shot = (n) => OUT ? page.screenshot({ path: path.join(OUT, `${size.name}-${n}.png`) }) : null;
  let v = await page.evaluate(look);
  ok(v.dvh, `${T} the stage is sized by dvh`);
  ok(v.stage.t >= -0.5 && v.stage.b <= v.vh + 0.5 && v.stage.l >= -0.5 && v.stage.r <= v.vw + 0.5, `${T} the whole stage is on screen`);
  ok(v.pill, `${T} the full-screen pill is there`);
  for (const s of ['attract', 'modeSelect', 'highScores', 'onlineMenu']) {
    if (s !== 'attract') { await go(s); await sleep(500); }
    v = await page.evaluate(look);
    ok(!!v.tip === !size.noTip, `${T} ${s}: the callout ${size.noTip ? 'stays away (no room)' : 'shows'}`);
    ok(!v.hits.length, `${T} ${s}: the callout touches nothing (${v.hits.join(', ')})`);
    ok(!v.tipOverStage, `${T} ${s}: the callout is off the stage`);
    if (v.tip) ok(v.tip.l >= 0 && v.tip.t >= 0 && v.tip.r <= v.vw && v.tip.b <= v.vh, `${T} ${s}: the callout is on screen`);
    if (s === 'attract') await shot('1-title'); if (s === 'modeSelect') await shot('2-menu');
    if (s !== 'onlineMenu') { await go(s === 'attract' ? 'modeSelect' : 'attract'); await sleep(200); if (s !== 'attract') { /* back at the title for the next hop */ } else { await go('attract'); await sleep(200); } }
  }
  // a fight: no callout
  await go('modeSelect'); await sleep(200);
  await page.evaluate(() => { const d = window.__flow.debug; d.sel.mode = 'training'; d.sel.step = 'player'; d.go('charSelect'); });
  await sleep(700);
  v = await page.evaluate(look);
  ok(!v.hits.length && !v.tipOverStage, `${T} fighter select: the callout touches nothing (${v.hits.join(', ')})`);
  await shot('3-pick');
  await page.evaluate(() => window.__flow.debug.pickChar(window.__flow.debug.sel.player)); await sleep(700);
  await page.evaluate(() => window.__flow.debug.pickChar(window.__flow.debug.sel.dummy));
  await page.waitForFunction(() => window.__flow.state === 'fighting');
  await sleep(1500);
  v = await page.evaluate(look);
  ok(!v.tip, `${T} a fight: no callout`);
  ok(v.pill, `${T} a fight: the pill is still there`);
  await shot('4-fight');
  // the pill opens the how-to; the fight doesn't see the tap
  await page.tap('.tc-top [data-role="fullscreen"]'); await sleep(300);
  v = await page.evaluate(look);
  ok(!!v.box, `${T} the pill opens the how-to`);
  ok(v.box && v.box.t >= 0 && v.box.b <= v.vh && v.box.l >= 0 && v.box.r <= v.vw && !v.box.scroll, `${T} the how-to fits the screen without scrolling`);
  ok(!v.warn, `${T} no room warning outside a room`);
  await shot('5-howto');
  await page.tap('.sf-hs-close'); await sleep(300);
  v = await page.evaluate(look);
  ok(!v.box && v.state === 'fighting', `${T} GOT IT closes it and the fight is still on`);
  ok(await page.evaluate(() => localStorage.getItem('sf-homescreen-seen') === '1'), `${T} opening it once retires the callout`);
  await ctx.close();
  console.log(`${T} done`);
}

// the callout: tap opens the how-to; X retires it; a room link gets the warning
{
  const size = SIZES[3];
  let { ctx, page } = await open(size);
  await page.evaluate(() => window.__flow.debug.go('modeSelect')); await sleep(400);
  await page.tap('.sf-hs-go'); await sleep(300);
  let v = await page.evaluate(look);
  ok(!!v.box && v.state === 'modeSelect', 'tapping the callout opens the how-to and the menu stays put');
  await page.tap('.sf-hs-close'); await sleep(200);
  v = await page.evaluate(look);
  ok(!v.box && !v.tip, 'after the how-to the callout is gone');
  await ctx.close();
  ({ ctx, page } = await open(size));
  await page.tap('.sf-hs-x'); await sleep(200);
  v = await page.evaluate(look);
  ok(!v.tip && !v.box && v.state === 'attract', 'X retires the callout without starting the game');
  await page.reload(); await page.waitForFunction(() => window.__flow && window.__flow.state === 'attract'); await sleep(600);
  v = await page.evaluate(look);
  ok(!v.tip && v.pill, 'it stays gone after a reload, and the pill stays');
  // the title's INSTALL opens the same how-to
  await page.evaluate(() => [...document.querySelectorAll('#flow .fl-btn')].find((b) => b.textContent.trim() === 'INSTALL').click()); await sleep(300);
  v = await page.evaluate(look);
  ok(!!v.box && v.state === 'attract', "the title's INSTALL opens the how-to");
  await ctx.close();
}
// who doesn't get it: the home-screen app, an Android phone
{
  let { ctx, page } = await open(SIZES[1], { standalone: true });
  let v = await page.evaluate(look);
  ok(!v.tip && !v.pill, 'installed (standalone): no callout, no pill');
  await ctx.close();
  ({ ctx, page } = await open(SIZES[1], { ua: ANDROID }));
  v = await page.evaluate(look);
  ok(!v.tip, 'Android: no callout');
  ok(v.pill, 'Android: the pill is the real fullscreen toggle');
  await page.tap('.tc-top [data-role="fullscreen"]'); await sleep(300);
  v = await page.evaluate(look);
  ok(!v.box, "Android: the pill doesn't open the how-to");
  await ctx.close();
}
await browser.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
