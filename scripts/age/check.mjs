// npm run test:age: the age question before the email field, the privacy and house rules links, and the
// name filter in the game's own screens (README, Privacy and terms). Real browsers through the local Worker.
//
//   npm run build && npm run dev:worker        (the Worker serving dist/ and the API on :8787; .dev.vars with DEV_LOGIN_CODES=1)
//   node scripts/age/check.mjs [http://127.0.0.1:8787/stick-fight/] [--shots dir]
//
// UNDER 13 must never reach the email field: not from PROFILE's SAVE MY PROFILE, not from the name screen's
// SIGN IN, not after BACK and trying again, not after a reload, and never a request to auth/start. 13 OR
// OLDER goes on to the email, the code and a saved profile as before. Exit code 1 on any failure.
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const BASE = (argv.find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/stick-fight/').replace(/\/?$/, '/');
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : '';
const PLAY = BASE + 'play/';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const until = async (fn, ms = 20000, every = 100) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };

const browsers = [];
async function page(init = {}, size = { width: 1280, height: 720 }, touch = false) {
  const b = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  browsers.push(b);
  const ctx = await b.newContext(touch ? { viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: size });
  await ctx.addInitScript((kv) => { for (const k in kv) if (localStorage.getItem(k) === null) localStorage.setItem(k, kv[k]); }, init);
  const p = await ctx.newPage();
  p.errors = []; p.auth = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('request', (r) => { if (/\/api\/auth\//.test(r.url())) p.auth.push(r.url()); });
  await p.goto(PLAY);
  await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
  await p.evaluate(() => { let last = performance.now(); window.__pump = setInterval(() => { const now = performance.now(); window.__game.advance(Math.min(100, now - last)); last = now; }, 8); });
  return p;
}
const state = (p) => p.evaluate(() => window.__flow.state);
const hist = (p) => p.evaluate(() => window.__flow.debug.history.join(' '));
const go = (p, ...to) => p.evaluate((to) => { for (const s of to) window.__flow.debug.go(s); }, to);
const btn = (p, label) => p.locator('#flow .fl-btn', { hasText: new RegExp(`^${label}`) }).first();
const click = async (p, label) => { await btn(p, label).click({ timeout: 8000, force: true }); await sleep(250); };
const text = (p) => p.evaluate(() => document.querySelector('#flow').innerText.replace(/\s+/g, ' '));
const emailField = (p) => p.evaluate(() => !!document.querySelector('#flow .fl-email .fl-field'));
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {}); };
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const prof = (name) => ({ 'stick-fight-player': JSON.stringify({ id: rid(), name, email: '', crews: [] }) });
/** the links on screen to the privacy and house rules pages, and whether each answers 200 */
async function legal(p, where) {
  const hrefs = await p.evaluate(() => [...document.querySelectorAll('#flow .fl-legal a')].map((a) => a.href));
  const okP = hrefs.some((h) => /\/privacy\/$/.test(h)), okT = hrefs.some((h) => /\/terms\/$/.test(h));
  const codes = await Promise.all(hrefs.map((h) => fetch(h).then((r) => r.status).catch(() => 0)));
  check(`${where}: PRIVACY and HOUSE RULES links, both 200`, okP && okT && codes.every((c) => c === 200), `${hrefs.join(' ')} ${codes.join(',')}`);
}

try {
  // ---- UNDER 13, from PROFILE
  for (const [label, size, touch] of [['desktop', { width: 1280, height: 720 }, false], ['upright', { width: 390, height: 844 }, true]]) {
    const p = await page(prof('KIDDO'), size, touch);
    await go(p, 'modeSelect', 'onlineMenu', 'profile');
    await legal(p, `${label} PROFILE`);
    await click(p, 'SAVE MY PROFILE');
    check(`${label}: SAVE MY PROFILE opens the age question, not the email`, (await state(p)) === 'ageCheck' && !(await emailField(p)), await state(p));
    const t = await text(p);
    check(`${label}: it asks HOW OLD ARE YOU? with UNDER 13 and 13 OR OLDER`, /HOW OLD ARE YOU/.test(t) && /UNDER 13/.test(t) && /13 OR OLDER/.test(t), t.slice(0, 120));
    const look = await p.evaluate(() => {
      const [a, b] = ['UNDER 13', '13 OR OLDER'].map((l) => [...document.querySelectorAll('#flow .fl-btn')].find((x) => x.textContent === l));
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return { same: a.className.replace(/\bfl-focus\b/, '').trim() === b.className.replace(/\bfl-focus\b/, '').trim(), w: Math.round(ra.width) === Math.round(rb.width), h: Math.round(ra.height) === Math.round(rb.height),
        color: getComputedStyle(a).color === getComputedStyle(b).color && getComputedStyle(a).borderColor === getComputedStyle(b).borderColor,
        focus: (document.querySelector('#flow .fl-focus') || {}).textContent || '' };
    });
    check(`${label}: the two answers look the same (class, size, color) and the focus starts on BACK`, look.same && look.w && look.h && look.color && look.focus === 'BACK', JSON.stringify(look));
    await legal(p, `${label} age question`);
    await shot(p, `${label}-age-question`);
    await click(p, 'UNDER 13');
    const t2 = await text(p);
    check(`${label}: UNDER 13 says NO EMAIL NEEDED, the profile stays on this device, and everything else works`, /NO EMAIL NEEDED/.test(t2) && /STAY ON THIS DEVICE/.test(t2) && /CREWS/.test(t2) && !(await emailField(p)), t2.slice(0, 200));
    check(`${label}: the answer is remembered on this device`, (await p.evaluate(() => localStorage.getItem('stick-fight-age'))) === 'under13');
    await legal(p, `${label} under-13 screen (FOR PARENTS)`);
    await shot(p, `${label}-age-under13`);
    await click(p, 'OK');
    check(`${label}: OK goes back to PROFILE`, (await state(p)) === 'profile');
    await click(p, 'SAVE MY PROFILE');
    check(`${label}: trying again lands on NO EMAIL NEEDED, with no question to answer differently`, (await state(p)) === 'ageCheck' && /NO EMAIL NEEDED/.test(await text(p)) && !/HOW OLD/.test(await text(p)));
    // the state machine itself refuses the email from anywhere but the age question
    await go(p, 'profile');
    const refused = await p.evaluate(() => { try { window.__flow.debug.go('signInEmail'); } catch { /* refused */ } return window.__flow.state; });
    check(`${label}: PROFILE can't go straight to the email (TRANSITIONS)`, refused !== 'signInEmail', refused);
    await p.reload(); await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
    await p.evaluate(() => { let last = performance.now(); window.__pump = setInterval(() => { const now = performance.now(); window.__game.advance(Math.min(100, now - last)); last = now; }, 8); });
    await go(p, 'modeSelect', 'onlineMenu', 'profile');
    await click(p, 'SAVE MY PROFILE');
    check(`${label}: after a reload it's still NO EMAIL NEEDED`, /NO EMAIL NEEDED/.test(await text(p)));
    check(`${label}: the email field never showed, and nothing was sent to auth/`, !/signInEmail/.test(await hist(p)) && p.auth.filter((u) => !/\/me$/.test(u)).length === 0, `${p.auth.join(' ')}`);
    check(`${label}: no page errors`, p.errors.length === 0, p.errors.join(' | '));
  }

  // ---- UNDER 13, from the name screen's SIGN IN (a returning player on a new device)
  {
    const p = await page({});
    await go(p, 'modeSelect');
    await click(p, 'VERSUS ONLINE');
    check('a nameless player going online gets the name screen', (await state(p)) === 'nameEntry', await state(p));
    check('the name screen says USE A NICKNAME, NOT YOUR REAL NAME', /USE A NICKNAME, NOT YOUR REAL NAME/.test(await text(p)));
    // the name filter on the name screen
    await p.keyboard.type('FUCK');
    await click(p, 'OK');
    check('a blocked name is turned away with PICK ANOTHER NAME, and nothing is saved', (await state(p)) === 'nameEntry' && /PICK ANOTHER NAME/.test(await text(p)) && !(await p.evaluate(() => JSON.parse(localStorage.getItem('stick-fight-player') || '{}').name)));
    await shot(p, 'name-filter');
    for (let i = 0; i < 4; i++) await p.keyboard.press('Backspace');
    await click(p, 'SIGN IN');
    check('SIGN IN opens the age question', (await state(p)) === 'ageCheck' && !(await emailField(p)));
    await click(p, 'UNDER 13');
    check('UNDER 13 from there: NO EMAIL NEEDED', /NO EMAIL NEEDED/.test(await text(p)) && !(await emailField(p)));
    await click(p, 'OK');
    check('OK goes back to the name screen', (await state(p)) === 'nameEntry', await state(p));
    await p.keyboard.type('SCUNTHORPE');
    await click(p, 'OK');
    check('SCUNTHORPE is a fine name (no false positive)', (await state(p)) === 'onlineMenu' && (await p.evaluate(() => JSON.parse(localStorage.getItem('stick-fight-player')).name)) === 'SCUNTHORPE', await state(p));
    // crew create and join: the nudge, the links and the filter
    await click(p, 'CREATE CREW ROOM');
    check('crew create says USE A NICKNAME, NOT ANYONE\'S REAL NAME', /USE A NICKNAME, NOT ANYONE'S REAL NAME/.test(await text(p)));
    await legal(p, 'crew create');
    await p.keyboard.type('SEX SQUAD');
    await click(p, 'CREATE');
    check('a blocked crew name is turned away before it reaches the server', (await state(p)) === 'crewCreate' && /PICK ANOTHER NAME/.test(await text(p)));
    await shot(p, 'crew-create-filter');
    await click(p, 'BACK');
    await click(p, 'JOIN A CREW');
    await legal(p, 'crew join');
    check('no page errors', p.errors.length === 0, p.errors.join(' | '));
  }

  // ---- 13 OR OLDER works as before
  {
    const p = await page(prof('GROWNUP'));
    await go(p, 'modeSelect', 'onlineMenu', 'profile');
    await click(p, 'SAVE MY PROFILE');
    await click(p, '13 OR OLDER');
    check('13 OR OLDER goes on to the email field', (await state(p)) === 'signInEmail' && (await emailField(p)), await state(p));
    check('it isn\'t remembered (the question comes back next time)', (await p.evaluate(() => localStorage.getItem('stick-fight-age'))) === null);
    await legal(p, 'the email screen');
    await shot(p, 'email');
    const email = `age-${Date.now()}@example.com`;
    await p.keyboard.type(email);
    await click(p, 'SEND CODE');
    const onCode = await until(async () => (await state(p)) === 'signInCode');
    check('SEND CODE gets to the code screen', !!onCode);
    await legal(p, 'the code screen');
    const code = (/DEV MODE: YOUR CODE IS (\d{6})/.exec(await text(p)) || [])[1];
    check('the dev code is on screen (DEV_LOGIN_CODES=1)', !!code);
    if (code) {
      await p.keyboard.type(code);
      await click(p, 'VERIFY');
      const saved = await until(async () => (await state(p)) === 'profile' && /PROFILE SAVED/.test(await text(p)));
      check('VERIFY saves the profile, as before the age question', !!saved, await text(p).then((t) => t.slice(0, 120)));
      check('PROFILE shows the email it\'s saved to', (await text(p)).includes(`SAVED TO ${email.toUpperCase()}`) || (await text(p)).toLowerCase().includes(email));
    }
    check('no page errors', p.errors.length === 0, p.errors.join(' | '));
  }

  // ---- the title screen and SETTINGS carry the links too
  {
    const p = await page(prof('LOOKER'));
    await until(() => p.evaluate(() => window.__flow.state === 'attract'));
    const title = await p.evaluate(() => [...document.querySelectorAll('#credits a')].map((a) => [a.textContent, a.href, getComputedStyle(document.querySelector('#credits')).display]));
    check('the title screen shows SOURCE & CREDITS · PRIVACY · HOUSE RULES', title.length === 3 && /privacy\/$/.test(title[1][1]) && /terms\/$/.test(title[2][1]) && title[0][2] !== 'none', JSON.stringify(title));
    await shot(p, 'title');
    await go(p, 'modeSelect');
    const gone = await p.evaluate(() => getComputedStyle(document.querySelector('#credits')).display);
    check('and they leave with the title (out of the fight)', gone === 'none', gone);
    const settings = await p.evaluate(() => [...document.querySelectorAll('.sf-panel .sf-legal a')].map((a) => a.href));
    const codes = await Promise.all(settings.map((h) => fetch(h).then((r) => r.status)));
    check('SETTINGS has PRIVACY and HOUSE RULES, both 200', settings.length === 2 && codes.every((c) => c === 200), `${settings.join(' ')} ${codes}`);
  }

  // ---- initials off the cabinet list
  {
    const p = await page(prof('ARCADER'));
    await go(p, 'modeSelect');
    await click(p, 'ARCADE');
    const fighting = await until(async () => { const st = await state(p); if (st === 'charSelect') await p.keyboard.press('Enter'); return st === 'fighting'; }, 30000, 700);
    if (!fighting) check('arcade starts (for the initials check)', false, await hist(p));
    else {
      // lose the stage, say NO to the continue, and sign the score
      await p.evaluate(() => { window.__flow.debug.run.score = 123456; });
      await until(async () => { await p.evaluate(() => window.__flow.debug.debugKO(1)); return /continue|gameOver/.test(await state(p)); }, 30000, 300);
      if ((await state(p)) === 'continue') { await sleep(600); await click(p, 'NO'); }
      await until(async () => (await state(p)) === 'gameOver');
      await p.evaluate(() => { window.__flow.debug.run.score = 123456; });
      await sleep(1000);
      await click(p, 'CONTINUE');
      const ini = await until(async () => (await state(p)) === 'enterInitials');
      check('a high score gets to the initials', !!ini, await hist(p));
      if (ini) {
        await p.keyboard.type('A55');
        await click(p, 'ENTER');
        check('initials A55 (ASS) are turned away: PICK OTHER INITIALS, still on the screen', (await state(p)) === 'enterInitials' && /PICK OTHER INITIALS/.test(await text(p)));
        await shot(p, 'initials-filter');
        await p.keyboard.type('ACE');
        await click(p, 'ENTER');
        const table = await p.evaluate(() => JSON.parse(localStorage.getItem('stick-fight-scores') || '{}'));
        const names = JSON.stringify(table);
        check('ACE goes on the table, and A55 never did', (await state(p)) === 'highScores' && names.includes('"ACE"') && !names.includes('A55'), names.slice(0, 160));
      }
    }
    check('no page errors', p.errors.length === 0, p.errors.join(' | '));
  }
} finally {
  for (const b of browsers) await b.close().catch(() => {});
}
console.log(`\nage question, links and name filter: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
