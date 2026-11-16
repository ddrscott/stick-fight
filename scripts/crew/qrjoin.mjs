// A crew QR code scanned on a phone with nothing saved lands in the crew lobby, with nothing in between
// (README, Multiplayer, Crew rooms, "Scanning in"). Real pages against the local Worker:
//
//   npm run build && npm run dev:worker        (the Worker serving dist/ and the API on :8787)
//   node scripts/crew/qrjoin.mjs [http://127.0.0.1:8787/] [--shots dir]
//
// The bug it guards ([tbacz8]): openCrew() only handed out a guest name when the flow was still `off`, so a
// crew link that arrived with the flow already running (the attract screen, a menu, an installed app at its
// title) put a brand-new player on WHAT DO WE CALL YOU? with an amber SIGN IN, which reads like a sign-in
// wall. Its BACK went to the online menu, which had no name either. Each case starts from empty storage:
//   - the link opened cold, at an iPhone held upright, a phone sideways and a desktop, plus Safari's user
//     agent and an installed home-screen app (navigator.standalone), each landing as off>crewLobby
//   - the attract screen running first, then the link: in the same page (start({ crew })) and as a new load
//   - the main menu, the online menu's JOIN A CREW typed by hand, and a reload in the lobby
//   - none of them shows the name, age or sign-in screens; the name is GUEST and three digits, marked auto;
//     the crew sees that member; the lobby offers SET YOUR NAME, and SIGN IN is one tap past it
// Then BACK, the corner chip a phone player taps, from every name, age and sign-in screen a nameless player can
// reach: it always ends on a real screen (the lobby, the online menu or the main menu) and never comes back
// to a screen it already left. Exit code 1 on any failure.
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const BASE = (argv.find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/').replace(/\/?$/, '/');
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : '';
const API = BASE + 'api/', PLAY = BASE + 'play/';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const until = async (fn, ms = 20000, every = 150) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const UPRIGHT = { width: 390, height: 844 }, SIDEWAYS = { width: 844, height: 390 }, DESK = { width: 1280, height: 720 };
const WALLS = new Set(['nameEntry', 'ageCheck', 'signInEmail', 'signInCode']);   // the screens a new player must never be put on
const REAL = new Set(['crewLobby', 'onlineMenu', 'modeSelect', 'attract', 'title']);   // where BACK may end
const NAME = /^GUEST \d{3}$/;

const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
/** a fresh browser context (nothing in storage), opened at `url`. Nothing is pressed. */
async function page(url, { size = UPRIGHT, touch = true, ua = '', standalone = false } = {}) {
  const ctx = await browser.newContext({ viewport: size, ...(touch ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}), ...(ua ? { userAgent: ua } : {}) });
  if (standalone) await ctx.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { value: true }); });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await open(p, url);
  return p;
}
async function open(p, url) {
  await p.goto(url);
  await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
  // software GL starves the frame loop on a busy machine: pump the game's own advance() from a timer
  await p.evaluate(() => {
    let last = performance.now(), k = 0;
    window.__pump = setInterval(() => { const now = performance.now(), ms = Math.min(100, now - last); last = now; if (++k % 12 === 0) window.__gauntlet.step(ms); else window.__game.advance(ms); }, 8);
  });
}
const state = (p) => p.evaluate(() => window.__flow.state);
const hist = (p) => p.evaluate(() => window.__flow.debug.history.slice());
const me = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('stick-fight-player') || 'null'));
const meLine = (p) => p.evaluate(() => (document.querySelector('#flow .fl-crewme') || {}).textContent || '');
const btn = (p, re) => p.evaluate((src) => { const b = [...document.querySelectorAll('#flow button')].find((x) => new RegExp(src).test(x.textContent) && x.getBoundingClientRect().width); if (b) b.click(); return !!b; }, re.source);
const back = (p) => p.evaluate(() => { const c = document.querySelector('.fl-backchip'); if (c) c.click(); return c ? c.textContent : ''; });
const shot = async (p, name) => { if (!SHOTS) return; await p.evaluate(() => window.__gauntlet.step(0)).catch(() => {}); await p.screenshot({ path: `${SHOTS}/${name}.png` }).catch((e) => console.log('   (no shot: ' + e.message.split('\n')[0] + ')')); };

/** the crew's own view of who has opened its link */
async function crewHas(slug, name) {
  return until(async () => {
    const ws = new WebSocket(`${API.replace(/^http/, 'ws')}crews/${slug}/ws`);
    const got = await new Promise((res) => {
      const t = setTimeout(() => res(null), 4000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', pid: 'f'.repeat(32), name: 'WATCHER' }));
      ws.onmessage = (e) => { try { const m = JSON.parse(e.data); if (m.t === 'state') { clearTimeout(t); res(m); } } catch { /* binary */ } };
      ws.onerror = () => res(null);
    });
    try { ws.close(); } catch { /* gone */ }
    return got && got.members && got.members.some((m) => m.name === name);
  }, 15000, 1000);
}

/** a landing: the lobby, a handed-out name, and no name, age or sign-in screen on the way in (since history index `from`) */
async function landed(p, label, from = 0, slug = '') {
  const st = await until(async () => ((await state(p)) === 'crewLobby' ? 'crewLobby' : null), 20000);
  const h = (await hist(p)).slice(from);
  const walls = h.filter((x) => [...WALLS].some((w) => x.includes(`>${w}`)));
  check(`${label}: lands in the crew lobby`, st === 'crewLobby', `${await state(p)} · ${h.join('  ')}`);
  check(`${label}: no name, age or sign-in screen on the way`, walls.length === 0, h.join('  '));
  const prof = await me(p);
  check(`${label}: handed a guest name, marked auto`, prof && NAME.test(prof.name) && prof.auto === true, prof && prof.name);
  const vp = p.viewportSize();
  const line = vp.height > vp.width ? await until(async () => { const t = await meLine(p); return /GUEST \d{3}/.test(t) ? t : null; }, 5000) : undefined;
  if (line !== undefined) check(`${label}: the lobby says YOU'RE <name> with SET YOUR NAME`, line && line.includes(prof.name) && /SET YOUR NAME/.test(line), line || '(none)');
  if (slug && prof) check(`${label}: the crew sees them`, await crewHas(slug, prof.name), prof.name);
  check(`${label}: no page errors`, p.errors.length === 0, p.errors.slice(0, 2).join(' | '));
  return prof;
}

/** press BACK (the corner chip) until a real screen; fail on a screen seen twice in the walk or one that never ends */
async function walkBack(p, label, want) {
  const seen = [await state(p)];
  for (let i = 0; i < 6; i++) {
    const was = await state(p);
    const chip = await back(p);
    if (!chip) { check(`${label}: there's a BACK chip on ${was}`, false); return seen; }
    const now = await until(async () => { const s = await state(p); return s !== was ? s : null; }, 5000);
    if (!now) { check(`${label}: BACK on ${was} goes somewhere`, false, `chip ${chip}`); return seen; }
    if (seen.includes(now)) { check(`${label}: BACK never returns to a screen it left`, false, [...seen, now].join(' > ')); return seen; }
    seen.push(now);
    if (REAL.has(now)) break;
  }
  const end = seen[seen.length - 1];
  check(`${label}: BACK ends on ${want}, never looping`, end === want, seen.join(' > '));
  return seen;
}

// ---- 0. the handed-out name itself (Node, no browser) --------------------------------------------------
{
  const store = {}; let full = false;
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { if (full) throw new Error('QuotaExceededError'); store[k] = String(v); }, removeItem: (k) => { delete store[k]; }, clear: () => { for (const k in store) delete store[k]; } };
  const { guestName, profile } = await import('../../src/net/profile.js');
  const { blockedName } = await import('../../src/namefilter.js');
  // a saved profile with no name (the page's own copy is only read when storage has none, or failed a write)
  const nameless = () => localStorage.setItem('stick-fight-player', JSON.stringify({ id: 'c'.repeat(32), name: '', email: '', crews: [] }));
  const real = Math.random, bad = [];
  for (let i = 100; i < 1000; i++) {
    if (!blockedName(`GUEST ${i}`)) continue;
    bad.push(i);
    let k = 0; Math.random = () => (k++ === 0 ? (i - 100 + 0.5) / 900 : real());   // the first draw is the blocked one
    nameless();
    const n = guestName();
    check(`guestName never hands out GUEST ${i} (the name filter blocks it)`, n !== `GUEST ${i}` && NAME.test(n) && !blockedName(n), n);
  }
  Math.random = real;
  check('the name filter blocks some GUEST names (so the retry matters)', bad.length > 0, bad.join(', '));
  // storage that already holds a nameless profile and then fills up: the name handed out still sticks for the page
  nameless(); profile(); full = true;
  const n = guestName();
  check('storage full: the handed-out name is still the profile\'s', profile().name === n && NAME.test(n), `${n} / ${profile().name}`);
  full = false; delete globalThis.localStorage;
}

try {
  const made = await (await fetch(API + 'crews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'QR CREW' }) })).json();
  const slug = made.slug, LINK = BASE + 'crew/' + slug;
  check('a crew to scan into', !!slug, slug);

  // ---- 1. the link opened cold ----------------------------------------------------------------------
  for (const [label, opts, name] of [
    ['iPhone upright (Safari)', { size: UPRIGHT, ua: IOS_UA }, 'scan-upright'],
    ['iPhone sideways (Safari)', { size: SIDEWAYS, ua: IOS_UA }, 'scan-sideways'],
    ['home-screen app (standalone)', { size: UPRIGHT, ua: IOS_UA, standalone: true }, 'scan-installed'],
    ['desktop', { size: DESK, touch: false }, 'scan-desktop'],
  ]) {
    const p = await page(LINK, opts);
    const h = await hist(p);
    await landed(p, label, 0, label === 'desktop' ? slug : '');
    check(`${label}: straight from off to the lobby`, h[0] === 'off>crewLobby', h.slice(0, 3).join('  '));
    check(`${label}: the address bar keeps the crew link`, (await p.evaluate(() => location.pathname)).endsWith(`/crew/${slug}`));
    await shot(p, name);
    await p.context().close();
  }

  // ---- 2. something running first ----------------------------------------------------------------------
  {
    // the attract screen, then the link in the same page: the flow restarts the way the sign-in link's hashchange
    // does it (off, then start), with the crew taken from the address
    const p = await page(PLAY, { size: UPRIGHT, ua: IOS_UA });
    await until(async () => ((await state(p)) === 'attract' ? 1 : null), 10000);
    await p.evaluate(() => localStorage.clear());
    check('attract first: the attract screen was up', (await state(p)) === 'attract');
    const n = (await hist(p)).length;
    await p.evaluate((s) => { history.replaceState(null, '', `../crew/${s}`); window.__flow.debug.go('off'); window.__flow.start(); }, slug);
    await landed(p, 'attract first, then the link (same page)', n, slug);
    await shot(p, 'scan-after-attract');
    await p.context().close();
  }
  {
    // the attract screen, then the link as a new load in the same tab (an id-only profile already saved)
    const p = await page(PLAY, { size: UPRIGHT, ua: IOS_UA });
    await until(async () => ((await state(p)) === 'attract' ? 1 : null), 10000);
    await open(p, LINK);
    await landed(p, 'attract first, then the link (new load)');
    await p.context().close();
  }
  {
    // the installed app opens at play/ (its start_url, at the title); the scanned link then loads in it
    const p = await page(PLAY, { size: UPRIGHT, ua: IOS_UA, standalone: true });
    await until(async () => ((await state(p)) === 'attract' ? 1 : null), 10000);
    await open(p, LINK);
    await landed(p, 'home-screen app at its title, then the link');
    await p.context().close();
  }
  {
    // a reload in the lobby comes back to it, under the same name
    const p = await page(LINK, { size: UPRIGHT, ua: IOS_UA });
    const before = await landed(p, 'before a reload');
    await open(p, LINK);
    const after = await landed(p, 'a reload in the lobby');
    check('a reload in the lobby: the same guest name', after && before && after.name === before.name, `${before && before.name} -> ${after && after.name}`);
    await p.context().close();
  }
  {
    // JOIN A CREW with the code typed by hand, from a page that has no name yet
    const p = await page(PLAY, { size: UPRIGHT, ua: IOS_UA });
    // (main: a player could get here with no name, openCrew() then asked for one, the flow refuses
    // crewJoin -> nameEntry, and JOIN did nothing at all. Now the online menu hands a name out on the way.)
    await p.evaluate(() => { const f = window.__flow.debug; f.go('modeSelect'); f.go('onlineMenu'); f.go('crewJoin'); });
    const n = (await hist(p)).length;
    await p.keyboard.type(slug); await p.keyboard.press('Enter');
    await landed(p, 'JOIN A CREW typed by hand, no name yet', n);
    await p.context().close();
  }

  // ---- 3. name and sign-in stay optional, one tap from the lobby, and BACK never loops ------------------
  {
    const p = await page(LINK, { size: UPRIGHT, ua: IOS_UA });
    await landed(p, 'BACK checks: fresh scan');
    const guest = (await me(p)).name;
    // SET YOUR NAME -> the name screen, with SIGN IN for a returning player -> BACK -> the lobby
    check('lobby: SET YOUR NAME opens the name screen', await btn(p, /SET YOUR NAME/) && await until(async () => ((await state(p)) === 'nameEntry' ? 1 : null), 5000));
    const signIn = await p.evaluate(() => [...document.querySelectorAll('#flow button')].some((b) => b.textContent.trim() === 'SIGN IN'));
    check('name screen from the lobby: SIGN IN is there for a guest', signIn);
    await shot(p, 'lobby-set-name');
    await walkBack(p, 'name screen from the lobby', 'crewLobby');
    check('name screen from the lobby: BACK keeps the guest name', (await me(p)).name === guest, (await me(p)).name);
    // SET YOUR NAME -> SIGN IN -> the age question -> BACK -> BACK -> the lobby
    await btn(p, /SET YOUR NAME/); await until(async () => ((await state(p)) === 'nameEntry' ? 1 : null), 5000);
    await btn(p, /^SIGN IN$/);
    check('SIGN IN opens the age question', await until(async () => ((await state(p)) === 'ageCheck' ? 1 : null), 5000));
    await walkBack(p, 'age question from the lobby', 'crewLobby');
    // ... 13 OR OLDER -> the email -> BACK all the way
    await btn(p, /SET YOUR NAME/); await until(async () => ((await state(p)) === 'nameEntry' ? 1 : null), 5000);
    await btn(p, /^SIGN IN$/); await until(async () => ((await state(p)) === 'ageCheck' ? 1 : null), 5000);
    await btn(p, /13 OR OLDER/);
    check('13 OR OLDER opens the email screen', await until(async () => ((await state(p)) === 'signInEmail' ? 1 : null), 5000));
    await walkBack(p, 'email screen from the lobby', 'crewLobby');
    // ... UNDER 13 -> YOU'RE ALL SET -> BACK all the way
    await btn(p, /SET YOUR NAME/); await until(async () => ((await state(p)) === 'nameEntry' ? 1 : null), 5000);
    await btn(p, /^SIGN IN$/); await until(async () => ((await state(p)) === 'ageCheck' ? 1 : null), 5000);
    await btn(p, /UNDER 13/); await sleep(200);
    await walkBack(p, 'under-13 screen from the lobby', 'crewLobby');
    check('every BACK from the lobby: still the same guest, still in the crew', (await me(p)).name === guest && (await state(p)) === 'crewLobby');
    await p.context().close();
  }
  {
    // VERSUS ONLINE with no name: the name screen (nobody is waiting on them), BACK to the main menu, nothing handed out
    const p = await page(PLAY, { size: UPRIGHT, ua: IOS_UA });
    await p.evaluate(() => { localStorage.clear(); window.__flow.debug.go('modeSelect'); });
    await btn(p, /VERSUS ONLINE/);
    check('VERSUS ONLINE, no name: asks for one', await until(async () => ((await state(p)) === 'nameEntry' ? 1 : null), 5000));
    await walkBack(p, 'VERSUS ONLINE name screen', 'modeSelect');
    check('VERSUS ONLINE name screen: BACK hands nothing out', !((await me(p)) || {}).name);
    // ... SIGN IN -> the age question -> BACK -> the name screen -> BACK -> the main menu
    await btn(p, /VERSUS ONLINE/); await until(async () => ((await state(p)) === 'nameEntry' ? 1 : null), 5000);
    await btn(p, /^SIGN IN$/); await until(async () => ((await state(p)) === 'ageCheck' ? 1 : null), 5000);
    await walkBack(p, 'VERSUS ONLINE age question', 'modeSelect');
    // the name screen with nowhere set to go back to (signed out, profile deleted): BACK lands on the online
    // menu with a guest name, and BACK from there is the main menu, not the name screen again
    await p.evaluate(() => { localStorage.clear(); window.__flow.debug.go('nameEntry'); });
    const seen = await walkBack(p, 'name screen after signing out', 'onlineMenu');
    const prof = await me(p);
    check('name screen after signing out: the online menu has a guest name, not ???', prof && NAME.test(prof.name), prof && prof.name);
    const who = await p.evaluate(() => (document.querySelector('#flow .fl-online .fl-label') || {}).textContent || '');
    check('the online menu says PLAYING AS that name', who.includes(prof && prof.name), who);
    if (seen[seen.length - 1] === 'onlineMenu') await walkBack(p, 'the online menu after that', 'modeSelect');
    await p.context().close();
    // and the online menu reached with no name at all (any way in but VERSUS ONLINE) never sends anyone to the name screen
    const q = await page(PLAY, { size: UPRIGHT, ua: IOS_UA });
    await q.evaluate(() => { const f = window.__flow.debug; f.go('modeSelect'); f.go('onlineMenu'); });
    await sleep(300);
    check('the online menu with no name: stays put with a guest name', (await state(q)) === 'onlineMenu' && NAME.test(((await me(q)) || {}).name || ''), JSON.stringify(await me(q)));
    await q.context().close();
  }
} finally {
  await browser.close().catch(() => {});
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
