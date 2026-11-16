#!/usr/bin/env node
// FULLSCREEN ON THE FIRST PRESS (src/fullscreen.js, src/touch.js): every way in turns fullscreen on with one press
// from a cold page load, with nothing touched or clicked before it, and one more press turns it off.
//
//   touch     the touch layer's pill. Chrome only lets a touchend (not a touchstart) start fullscreen, so a pill
//             that fired on touchstart was refused on a fresh page and worked from the second tap on.
//   desktop   the corner button (a click).
//   settings  SETTINGS > DISPLAY > FULLSCREEN, opened from the touch gear and from the desktop corner button.
//   iphone    no Fullscreen API: the pill opens the Add to Home Screen how-to on the first tap.
//
// Each case gets its own browser context, so each starts with no user activation. Everything before and around the
// press goes through raw CDP: Playwright's own evaluate, waitFor and tap/click run their page scripts with
// userGesture: true, which hands the page an activation and hides the bug. Here Runtime.evaluate runs without one,
// and the presses are Input.dispatchTouchEvent and Input.dispatchMouseEvent: trusted, the way a thumb or a mouse
// sends them.
//
//   npx vite --port 8191 &
//   node scripts/touch/fullscreen.mjs [--url http://127.0.0.1:8191/play/] [--shot /tmp/fullscreen.png]
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

async function open({ touch, ios = false, name }) {
  const ctx = await browser.newContext({
    viewport: touch ? { width: 915, height: 412 } : { width: 1280, height: 720 }, deviceScaleFactor: touch ? 2 : 1,
    hasTouch: touch, isMobile: touch, userAgent: touch ? (ios ? IOS : ANDROID) : undefined,
  });
  await ctx.addInitScript((ios) => {
    if (ios) {   // iPhone Safari: no Fullscreen API at all
      delete Element.prototype.requestFullscreen; delete Element.prototype.webkitRequestFullscreen;
      delete Document.prototype.exitFullscreen; delete Document.prototype.webkitExitFullscreen;
    }
    // what reached the page: synthetic mouse events, the [fs] warnings, the pill's flash
    window.__seen = { mouse: 0, warn: [], flash: 0 };
    for (const t of ['mousedown', 'mouseup', 'click']) window.addEventListener(t, (e) => { if (e.target instanceof Element && e.target.closest('.tc-top')) window.__seen.mouse++; }, true);
    const w = console.warn; console.warn = (...a) => { if (String(a[0]).startsWith('[fs]')) window.__seen.warn.push(a.join(' ')); w.apply(console, a); };
    new MutationObserver((ms) => { for (const m of ms) if (m.target instanceof Element && m.target.matches('[data-role="fullscreen"].tc-on')) window.__seen.flash++; })
      .observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }, ios);
  const pw = await ctx.newPage();
  pw.on('pageerror', (e) => ok(false, `[${name}] page error: ${e.message}`));
  const cdp = await ctx.newCDPSession(pw);
  /** evaluate with no user gesture */
  const js = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: false });
    if (r.exceptionDetails) throw new Error(`${expr}: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  };
  const until = async (expr, ms = 5000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await js(expr)) return true; return false; };
  const center = async (sel) => {
    if (!(await until(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); return !!b && b.getClientRects().length > 0; })()`))) throw new Error(`${name}: ${sel} never showed`);
    await sleep(150);   // let a panel finish sliding in
    return js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  };
  const page = {
    js, until,
    async tap(sel) {
      const { x, y } = await center(sel);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await sleep(40);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(60);
    },
    async click(sel) {
      const { x, y } = await center(sel);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await sleep(30);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await sleep(60);
    },
    screenshot: (o) => pw.screenshot(o),
    evaluate: (...a) => pw.evaluate(...a),   // Playwright's own: only once the cold-load part is over
    waitForFunction: (...a) => pw.waitForFunction(...a),
  };
  await pw.goto(URL_);
  if (!(await until('!!window.__flow && window.__flow.state === "attract"', 30000))) throw new Error(`${name}: no attract screen`);
  await sleep(300);
  ok(await js('!navigator.userActivation || !navigator.userActivation.hasBeenActive'), `${name}: cold page, no user activation yet`);
  return { ctx, page };
}
const fsOn = (page) => page.js('!!document.fullscreenElement');
const waitFs = async (page, want) => { for (let i = 0; i < 20; i++) { if ((await fsOn(page)) === want) return true; await sleep(50); } return false; };
const seen = (page) => page.js('window.__seen');

// ---- Android Chrome: the touch layer's pill ------------------------------------------------------------------
{
  const { ctx, page } = await open({ touch: true, name: 'touch' });
  await page.tap('[data-role="fullscreen"]');
  ok(await waitFs(page, true), 'touch: one tap on the pill turns fullscreen on');
  const s = await seen(page);
  ok(s.flash >= 1, `touch: the pill flashes on the tap (${s.flash})`);
  ok(s.mouse === 0, `touch: no synthetic mouse events reach the page (${s.mouse})`);
  ok(s.warn.length === 0, `touch: nothing refused (${s.warn.join('; ') || 'no [fs] warnings'})`);
  if (SHOT) { await sleep(200); await page.screenshot({ path: SHOT }); }
  await page.tap('[data-role="fullscreen"]');
  ok(await waitFs(page, false), 'touch: one more tap turns it off');
  await page.tap('[data-role="fullscreen"]');
  ok(await waitFs(page, true), 'touch: and a third turns it back on');
  // a fight's buttons still act on touchstart
  await page.evaluate(() => { const F = window.__flow.debug; F.go('modeSelect'); F.sel.player = 'temp'; F.sel.dummy = 'temp'; F.startTraining(); });
  await page.waitForFunction(() => window.__flow.state === 'fighting', null, { timeout: 10000 });
  const downOnStart = await page.evaluate(() => {
    const b = document.querySelector('.tc-l1'), r = b.getBoundingClientRect();
    let down = false; const on = () => { down = true; };
    window.addEventListener('keydown', on, true);
    const t = new Touch({ identifier: 77, target: b, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
    b.dispatchEvent(new TouchEvent('touchstart', { changedTouches: [t], touches: [t], bubbles: true, cancelable: true }));
    const was = down;
    b.dispatchEvent(new TouchEvent('touchend', { changedTouches: [t], touches: [], bubbles: true, cancelable: true }));
    window.removeEventListener('keydown', on, true);
    return was;
  });
  ok(downOnStart, 'touch: a fight button still presses on touchstart');
  await ctx.close();
}

// ---- Android Chrome: SETTINGS > DISPLAY > FULLSCREEN from the touch gear --------------------------------------
{
  const { ctx, page } = await open({ touch: true, name: 'touch settings' });
  await page.tap('.tc-top [data-role="settings"]');
  await page.tap('.sf-tab[data-t="display"]');
  await page.tap('.sf-opt[data-o="fullscreen"] .sf-olabel');
  ok(await waitFs(page, true), 'touch settings: one tap on FULLSCREEN turns it on');
  await page.tap('.sf-opt[data-o="fullscreen"] .sf-olabel');
  ok(await waitFs(page, false), 'touch settings: one more tap turns it off');
  await ctx.close();
}

// ---- desktop Chrome: the corner button ------------------------------------------------------------------------
{
  const { ctx, page } = await open({ touch: false, name: 'desktop' });
  await page.click('.sf-fs');
  ok(await waitFs(page, true), 'desktop: one click on the corner button turns fullscreen on');
  await page.click('.sf-fs');
  ok(await waitFs(page, false), 'desktop: one more click turns it off');
  ok((await seen(page)).warn.length === 0, 'desktop: nothing refused');
  await ctx.close();
}

// ---- desktop Chrome: SETTINGS > DISPLAY > FULLSCREEN ----------------------------------------------------------
{
  const { ctx, page } = await open({ touch: false, name: 'desktop settings' });
  await page.click('.sf-menu');
  await page.click('.sf-tab[data-t="display"]');
  await page.click('.sf-opt[data-o="fullscreen"] .sf-olabel');
  ok(await waitFs(page, true), 'desktop settings: one click on FULLSCREEN turns it on');
  await page.click('.sf-opt[data-o="fullscreen"] .sf-olabel');
  ok(await waitFs(page, false), 'desktop settings: one more click turns it off');
  await ctx.close();
}

// ---- a refusal is logged, not swallowed: a script's click() carries no activation, so the request is refused --
{
  const { ctx, page } = await open({ touch: false, name: 'refused' });
  await page.js("document.querySelector('.sf-fs').click()");
  await sleep(200);
  const s = await seen(page);
  ok(!(await fsOn(page)) && s.warn.some((w) => w.startsWith('[fs] request refused')), `refused: logged as ${JSON.stringify(s.warn[0] || '(nothing)')}`);
  await ctx.close();
}

// ---- iPhone Safari: no Fullscreen API, the pill opens the how-to on the first tap -----------------------------
{
  const { ctx, page } = await open({ touch: true, ios: true, name: 'iphone' });
  ok(await page.js("!document.documentElement.classList.contains('fs-ok')"), 'iphone: no fullscreen offered');
  await page.tap('[data-role="fullscreen"]');
  const shown = await page.until(`[...document.querySelectorAll('body *')].some((n) => n instanceof HTMLElement && n.children.length === 0 && /ADD TO HOME SCREEN/i.test(n.textContent || '') && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden')`, 2000);
  ok(shown, 'iphone: one tap on the pill opens the Add to Home Screen how-to');
  ok((await seen(page)).mouse === 0, 'iphone: no synthetic mouse events');
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
