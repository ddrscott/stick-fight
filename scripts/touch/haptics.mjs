#!/usr/bin/env node
// HAPTICS (src/touch.js buzz(), src/touchPrefs.js, SETTINGS > CONTROLS): a press of 1-4 in a fight calls
// navigator.vibrate when it's on, and doesn't when it's off, in a menu, paused or with the page hidden. The choice
// survives a reload. Where the browser has no vibrate (iPhone Safari) the row says UNAVAILABLE, and with a mouse
// it isn't there at all. navigator.vibrate is stubbed, so it runs headless and records every call.
//
//   npx vite --port 8191 &
//   node scripts/touch/haptics.mjs [--url http://127.0.0.1:8191/play/] [--shot /tmp/haptics.png]
import { chromium, executablePath } from '../../gauntlet/browser.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const URL_ = opt('--url', 'http://127.0.0.1:8191/play/');
const SHOT = opt('--shot', '');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, executablePath, args: ['--mute-audio'] });
let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`ok   ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };

async function context({ ua = ANDROID, touch = true, vibrate = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch, userAgent: touch ? ua : undefined });
  await ctx.addInitScript((vib) => {
    window.__vib = [];
    if (vib) Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, value(ms) { window.__vib.push(ms); return true; } });
    else delete Navigator.prototype.vibrate;
  }, vibrate);
  return ctx;
}
async function open(ctx, name) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => ok(false, `[${name}] page error: ${e.message}`));
  await page.goto(URL_);
  await page.waitForFunction(() => window.__flow && window.__flow.state === 'attract', null, { timeout: 30000 });
  return page;
}
async function fight(page) {
  await page.evaluate(() => { const F = window.__flow.debug; F.go('modeSelect'); F.sel.player = 'temp'; F.sel.dummy = 'temp'; F.startTraining(); });
  await page.waitForFunction(() => window.__flow.state === 'fighting', null, { timeout: 10000 });
  await sleep(300);
}
// a real touchstart and touchend on a control, the way a thumb sends them (works even where the layer is hidden)
const press = (page, sel) => page.evaluate((s) => {
  const b = document.querySelector(s), r = b.getBoundingClientRect();
  const t = new Touch({ identifier: Math.floor(Math.random() * 1e6), target: b, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
  b.dispatchEvent(new TouchEvent('touchstart', { changedTouches: [t], touches: [t], bubbles: true, cancelable: true }));
  b.dispatchEvent(new TouchEvent('touchend', { changedTouches: [t], touches: [], bubbles: true, cancelable: true }));
  return window.__vib.slice();
}, sel);
const clear = (page) => page.evaluate(() => { window.__vib.length = 0; });
const row = (page) => page.evaluate(() => {
  const r = document.querySelector('.sf-opt[data-o="haptics"]');
  return { shown: !!r && r.offsetParent !== null, value: r?.querySelector('.sf-val b')?.textContent, sub: r?.querySelector('small')?.textContent };
});
async function openControls(page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('sf:settings')));
  await page.waitForSelector('.sf-tab[data-t="controls"]', { state: 'visible' });
  await page.click('.sf-tab[data-t="controls"]');
  await sleep(200);
}
const closeSettings = (page) => page.keyboard.press('Escape');

// ---- Android: on by default, ticks in a fight, and nowhere else ----------------------------------------------
{
  const ctx = await context();
  let page = await open(ctx, 'android');
  ok((await press(page, '.tc-l1')).length === 0, 'android: no tick on the title screen');
  await fight(page);
  for (const [n, s] of [[1, '.tc-l1'], [2, '.tc-l2'], [3, '.tc-l3'], [4, '.tc-l4']]) {
    await clear(page);
    const v = await press(page, s);
    ok(v.length === 1 && v[0] >= 10 && v[0] <= 15, `android: button ${n} ticks once, short (${JSON.stringify(v)})`);
  }
  await clear(page);
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  ok((await press(page, '.tc-l1')).length === 0, 'android: no tick with the page hidden');
  await page.evaluate(() => { delete document.hidden; });
  await clear(page);
  ok((await press(page, '.tc-l1')).length === 1, 'android: ticks again once the page shows');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('sf:pause')));
  await page.waitForFunction(() => window.__flow.state === 'paused', null, { timeout: 5000 });
  await clear(page);
  ok((await press(page, '.tc-l1')).length === 0, 'android: no tick while paused');

  // the setting: ON by default, a press turns it OFF and it's saved
  await openControls(page);
  let r = await row(page);
  ok(r.shown && r.value === 'ON', `android: HAPTICS shows, ON by default (${r.value})`);
  if (SHOT) {
    await page.evaluate(() => document.querySelector('.sf-opt[data-o="haptics"]').scrollIntoView({ block: 'center' }));
    await sleep(150);
    await page.screenshot({ path: SHOT });
  }
  await clear(page);
  await page.click('.sf-opt[data-o="haptics"] .sf-arr[data-d="1"]');
  r = await row(page);
  ok(r.value === 'OFF', `android: a press turns it OFF (${r.value})`);
  ok(await page.evaluate(() => localStorage.getItem('stick-fight-haptics')) === '0', 'android: OFF is saved');

  // reload: still OFF, and a press in a fight is silent
  await page.close();
  page = await open(ctx, 'android-reload');
  await openControls(page);
  r = await row(page);
  ok(r.value === 'OFF', `android: still OFF after a reload (${r.value})`);
  await closeSettings(page);
  await fight(page);
  await clear(page);
  ok((await press(page, '.tc-l1')).length === 0 && (await press(page, '.tc-l3')).length === 0, 'android: OFF, buttons 1 and 3 don\'t tick');

  // back ON: the turn-on tick is the only one, then presses tick again
  await openControls(page);
  await clear(page);
  await page.click('.sf-opt[data-o="haptics"] .sf-arr[data-d="1"]');
  ok((await row(page)).value === 'ON', 'android: back ON');
  ok((await page.evaluate(() => window.__vib.length)) === 1, 'android: turning it on ticks once as a preview');
  await closeSettings(page);
  await page.waitForFunction(() => window.__flow.state === 'paused' || window.__flow.state === 'fighting', null, { timeout: 5000 });
  if (await page.evaluate(() => window.__flow.state === 'paused')) await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__flow.state === 'fighting', null, { timeout: 5000 });
  await clear(page);
  ok((await press(page, '.tc-l2')).length === 1, 'android: ON again, button 2 ticks');
  await ctx.close();
}

// ---- iPhone Safari: no navigator.vibrate, so the row says UNAVAILABLE and nothing throws ---------------------
{
  const ctx = await context({ ua: IOS, vibrate: false });
  const page = await open(ctx, 'ios');
  await openControls(page);
  const r = await row(page);
  ok(r.shown && r.value === 'UNAVAILABLE', `ios: HAPTICS shows as UNAVAILABLE (${r.value}; ${r.sub})`);
  await page.click('.sf-opt[data-o="haptics"] .sf-arr[data-d="1"]');
  ok((await row(page)).value === 'UNAVAILABLE', 'ios: a press doesn\'t change it');
  await closeSettings(page);
  await fight(page);
  await press(page, '.tc-l1');
  ok(true, 'ios: a press in a fight runs (no vibrate to call)');
  await ctx.close();
}

// ---- desktop: no touch layer, no row ---------------------------------------------------------------------------
{
  const ctx = await context({ touch: false });
  const page = await open(ctx, 'desktop');
  await openControls(page);
  ok(!(await row(page)).shown, 'desktop: no HAPTICS row with a mouse');
  ok(!(await page.$('.tc-root')), 'desktop: no touch layer');
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
