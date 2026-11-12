// npm run test:delete:ui: DELETE MY PROFILE on screen (README, Privacy and terms, Deleting a profile), in a real
// browser against wrangler dev (npm run build && npm run dev:worker, DEV_LOGIN_CODES=1).
//   node scripts/delete/ui.mjs [http://127.0.0.1:8787/] [--shots <dir>]
// At 1280x720 and 390x844 (touch): a signed-in PROFILE shows DELETE MY PROFILE; one press only arms it (the
// account is still there); the second deletes it, the device gets a fresh id and no email, the name screen
// asks for a name, then PROFILE says PROFILE DELETED, and GET me is null.
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const BASE = (argv.find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/').replace(/\/?$/, '/');
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const until = async (fn, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(100); } };
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

const b = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
try {
  for (const [label, size, touch] of [['desktop', { width: 1280, height: 720 }, false], ['upright', { width: 390, height: 844 }, true]]) {
    const ctx = await b.newContext(touch ? { viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: size });
    const id = rid(), email = `ui-delete-${label}-${Date.now()}@example.com`;
    // sign in through the context, so the cookie is the page's
    const s = await (await ctx.request.post(BASE + 'api/auth/start', { data: { email } })).json();
    const v = await (await ctx.request.post(BASE + 'api/auth/verify', { data: { email, code: s.devCode, pid: id, name: 'ALICE' } })).json();
    check(`${label}: signed in`, v.email === email, JSON.stringify(v));
    await ctx.addInitScript((p) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('stick-fight-player', p); } },
      JSON.stringify({ id, name: 'ALICE', email, crews: [] }));
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(BASE + 'play/');
    await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
    await p.evaluate(() => { let last = performance.now(); setInterval(() => { const now = performance.now(); window.__game.advance(Math.min(100, now - last)); last = now; }, 8); });
    await p.evaluate(() => { for (const s of ['modeSelect', 'onlineMenu', 'profile']) window.__flow.debug.go(s); });
    await sleep(500);
    const del = p.locator('#flow .fl-btn', { hasText: /^DELETE/ }).first();
    check(`${label}: PROFILE, signed in, has DELETE MY PROFILE`, (await del.count()) === 1 && /DELETE MY PROFILE/.test(await del.innerText()));
    const box = await del.boundingBox(), vp = p.viewportSize();
    check(`${label}: the button is on screen`, box && box.y >= 0 && box.y + box.height <= vp.height && box.x >= 0 && box.x + box.width <= vp.width, JSON.stringify(box));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-1-profile.png` });
    await del.click({ force: true }); await sleep(300);
    const armed = await p.evaluate(() => document.querySelector('#flow').innerText.replace(/\s+/g, ' '));
    check(`${label}: the first press only arms it (PRESS AGAIN, says what goes)`, /DELETE FOR GOOD\? PRESS AGAIN/.test(armed) && /HIGH SCORE INITIALS STAY/.test(armed), armed.slice(0, 200));
    check(`${label}: and the account is still there`, (await (await ctx.request.get(BASE + 'api/me')).json())?.email === email);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-2-armed.png` });
    await del.click({ force: true });
    const named = await until(async () => (await p.evaluate(() => window.__flow.state)) === 'nameEntry');
    check(`${label}: the second press deletes it and asks for a name, as SIGN OUT does`, !!named);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-3-name.png` });
    await p.keyboard.type('BOB'); await p.keyboard.press('Enter');
    const after = await until(async () => { const t = await p.evaluate(() => document.querySelector('#flow').innerText.replace(/\s+/g, ' ')); return /PROFILE DELETED/.test(t) ? t : null; });
    check(`${label}: then PROFILE says PROFILE DELETED: THIS DEVICE STARTS FRESH, kept on this device only, no DELETE button`, !!after && /KEPT ON THIS DEVICE ONLY/.test(after) && !/DELETE MY PROFILE/.test(after), after?.slice(0, 200));
    const local = await p.evaluate(() => JSON.parse(localStorage.getItem('stick-fight-player') || '{}'));
    check(`${label}: the device has a fresh id and no email`, local.id && local.id !== id && !local.email && local.name === 'BOB', JSON.stringify(local));
    check(`${label}: GET me is null`, (await (await ctx.request.get(BASE + 'api/me')).json()) === null);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}-4-deleted.png` });
    check(`${label}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
} finally { await b.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
