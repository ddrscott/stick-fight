#!/usr/bin/env node
// Menu screenshots at the three shapes the game runs in: desktop, phone sideways, phone upright.
// For a before/after of anything that touches the menu button, the SETTINGS panel or a menu's layout.
//
//   npx vite --port 8191 &            (or any server showing play/)
//   node scripts/shots/menus.mjs --out /tmp/shots [--url http://127.0.0.1:8191/play/] [--only upright]
//
// Each size gets: title, the panel open on the title, mode select, character select, the dummy pick,
// a training fight, pause, and pause with the panel open. Then it reports anything in a menu that
// runs past the stage (--check adds 375x667, with no pictures), and exits 1 if something does.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, executablePath } from '../../gauntlet/browser.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(opt('--out', 'gauntlet/tmp/shots'));
const URL_ = opt('--url', 'http://127.0.0.1:8191/play/');
const ONLY = opt('--only', '');
const SIZES = [
  { name: 'desktop', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false },
  { name: 'sideways', viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  { name: 'upright', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  { name: 'upright-se', viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, checkOnly: true },
  { name: 'sideways-se', viewport: { width: 667, height: 375 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, checkOnly: true },
].filter((s) => (!ONLY || s.name === ONLY) && (!s.checkOnly || argv.includes('--check')));

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;

// everything a player reads or presses in the menu that's up, against the stage's box (and the screen's)
function clipped() {
  const st = document.getElementById('stage').getBoundingClientRect();
  const out = [];
  const flow = document.querySelector('#flow .fl-screen');
  if (flow) for (const n of flow.querySelectorAll('.fl-h1, .fl-h2, .fl-h3, .fl-label, .fl-btn, .fl-tech, .fl-detail, .fl-small, .lg-bar, .fl-table')) {
    const r = n.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    // inside a scrolling menu an item may be out of view; the scroller itself has to be inside the stage
    const sc = n.closest('.fl-scroll');
    const box = sc && sc !== n ? sc.getBoundingClientRect() : r;
    if (box.top < st.top - 1 || box.bottom > st.bottom + 1 || box.left < st.left - 1 || box.right > st.right + 1)
      out.push(`${n.className.split(' ').slice(0, 2).join('.')} "${(n.textContent || '').trim().slice(0, 18)}" ${Math.round(box.left - st.left)},${Math.round(box.top - st.top)} ${Math.round(box.width)}x${Math.round(box.height)} (stage ${Math.round(st.width)}x${Math.round(st.height)})`);
  }
  const p = document.querySelector('.sf-panel.sf-open');
  if (p) { const r = p.getBoundingClientRect(); if (r.top < -1 || r.left < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(`panel off screen ${Math.round(r.top)}..${Math.round(r.bottom)} of ${innerHeight}`); }
  return out;
}

for (const size of SIZES) {
  const ctx = await browser.newContext({ viewport: size.viewport, deviceScaleFactor: size.deviceScaleFactor, hasTouch: size.hasTouch, isMobile: size.isMobile });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { bad++; console.log(`[${size.name}] page error: ${e.message}`); });
  await page.goto(URL_);
  await page.waitForFunction(() => window.__flow && window.__flow.state === 'attract' && document.fonts.status === 'loaded', null, { timeout: 30000 });
  await sleep(1500);
  let n = 0;
  const shot = async (name, wait = 600) => {
    await sleep(wait);
    const c = await page.evaluate(clipped);
    for (const line of c) { bad++; console.log(`[${size.name}] ${name}: CLIPPED ${line}`); }
    if (!size.checkOnly) await page.screenshot({ path: path.join(OUT, `${size.name}-${++n}-${name}.png`) });
  };
  const panel = () => page.evaluate(() => window.dispatchEvent(new CustomEvent('sf:settings')));
  const go = (s) => page.evaluate((st) => window.__flow.debug.go(st), s);

  await shot('title');
  await panel(); await shot('title-panel', 3000); await panel(); await sleep(400);
  await go('modeSelect'); await shot('mode-select');
  await page.evaluate(() => { const d = window.__flow.debug; d.sel.mode = 'training'; d.sel.step = 'player'; d.go('charSelect'); });
  await shot('character-select', 900);
  await page.evaluate(() => window.__flow.debug.pickChar(window.__flow.debug.sel.player));
  await shot('dummy-pick', 900);
  await page.evaluate(() => window.__flow.debug.pickChar(window.__flow.debug.sel.dummy));
  await page.waitForFunction(() => window.__flow.state === 'fighting');
  await shot('training-fight', 2500);
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__flow.state === 'paused');
  await shot('pause');
  await panel(); await shot('pause-panel', 3000); await panel();
  // the other menus, checked for fit only
  for (const s of ['modeSelect', 'attract', 'highScores', 'attract', 'controls']) { await sleep(250); await go(s); if (s !== 'attract') { await sleep(400); for (const line of await page.evaluate(clipped)) { bad++; console.log(`[${size.name}] ${s}: CLIPPED ${line}`); } } }
  await ctx.close();
  console.log(`[${size.name}] done`);
}
await browser.close();
console.log(bad ? `${bad} problems` : 'nothing clipped, no page errors');
process.exit(bad ? 1 : 0);
