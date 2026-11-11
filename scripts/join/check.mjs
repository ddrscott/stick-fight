// Join links ask nothing (README, Arcade flow, Versus online): real browsers through the local Worker.
//
//   npm run build && npm run dev:worker        (the Worker serving dist/ and the API on :8787)
//   node scripts/join/check.mjs [http://127.0.0.1:8787/stick-fight/] [--shots dir]
//
// A host opens a quick room; a visitor with empty storage opens its ?room= link and has to land on the
// pick screen without a key, a tap or a letter typed. Then the same for a ?crew= link and the crew lobby,
// at desktop and phone sizes. It also checks that a handed-out name is a real one and marked `auto`, that
// a player who already has a name keeps it, that a dead room link says so with a way out, that a broken code opens the title, and that
// VERSUS ONLINE from the menu still asks a nameless player for a name. Exit code 1 on any failure.
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const BASE = (argv.find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/stick-fight/').replace(/\/?$/, '/');
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : '';
const API = BASE + 'api/', PLAY = BASE + 'play/';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const until = async (fn, ms = 30000, every = 200) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };

const browsers = [];
/** a page in its own browser. `init`: localStorage to start with ({} is a first-time visitor). Nothing is pressed. */
async function page(url, init = {}, size = { width: 1280, height: 720 }, touch = false) {
  const b = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  browsers.push(b);
  const ctx = await b.newContext(touch ? { viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: size });
  await ctx.addInitScript((kv) => { for (const k in kv) if (localStorage.getItem(k) === null) localStorage.setItem(k, kv[k]); }, init);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(url);
  await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
  // software GL starves the frame loop on a busy machine: pump the game's own advance() from a timer
  await p.evaluate(() => {
    let last = performance.now(), k = 0;
    window.__pump = setInterval(() => { const now = performance.now(), ms = Math.min(100, now - last); last = now; if (++k % 12 === 0) window.__gauntlet.step(ms); else window.__game.advance(ms); }, 8);
  });
  return p;
}
const closeAll = async () => { for (const b of browsers.splice(0)) await b.close().catch(() => {}); };
const flow = (p) => p.evaluate(() => window.__flow.state);
const hist = (p) => p.evaluate(() => window.__flow.debug.history.slice(-8).join('  ')).catch(() => '?');
const me = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('stick-fight-player') || 'null'));
const text = (p) => p.evaluate(() => (document.querySelector('.fl-screen, [class*="fl-"]') || document.body).closest('body').innerText.replace(/\s+/g, ' '));
const shot = async (p, name) => { if (!SHOTS) return; await p.evaluate(() => window.__gauntlet.step(0)).catch(() => {}); await p.screenshot({ path: `${SHOTS}/${name}.png`, timeout: 90000 }).catch((e) => console.log('   (no shot: ' + e.message.split('\n')[0] + ')')); };
const prof = (name, c) => ({ 'stick-fight-player': JSON.stringify({ id: c.repeat(32), name, email: '', crews: [] }) });
const NAME = /^GUEST \d{3}$/;
const SIZES = [['desktop', { width: 1280, height: 720 }, false], ['phone', { width: 844, height: 390 }, true], ['upright', { width: 390, height: 844 }, true]];

async function host() {
  const H = await page(PLAY, prof('HOSTY', 'a'));
  await H.evaluate(() => { const f = window.__flow.debug; f.go('modeSelect'); f.go('onlineMenu'); f.go('onlineHost'); });
  const code = await until(() => H.evaluate(() => (window.__net.state === 'waiting' && window.__net.code) || null));
  return { H, code: String(code || '') };
}

try {
  // ---- a quick room's link, first-time visitor, at each size ----
  for (const [label, size, touch] of SIZES) {
    const { H, code } = await host();
    check(`${label}: the host has a room`, code.length === 4, code);
    const G = await page(`${PLAY}?room=${code}`, {}, size, touch);
    const first = await flow(G);
    check(`${label}: a room link opens on JOINING, not a name or JOIN screen`, first === 'onlineConnecting' || first === 'onlineSelect', first);
    if (label === 'desktop') await shot(G, 'room-1-joining');
    const ok = await until(async () => (await flow(G)) === 'onlineSelect');
    check(`${label}: the visitor is on the pick screen with nothing pressed`, ok, await hist(G));
    check(`${label}: the host is on the pick screen too`, await until(async () => (await flow(H)) === 'onlineSelect', 10000));
    const p = await me(G);
    check(`${label}: the visitor was handed a name, marked auto`, p && NAME.test(p.name) && p.auto === true, JSON.stringify(p && { name: p.name, auto: p.auto }));
    const seen = await until(() => H.evaluate((n) => document.body.innerText.includes(n), p.name), 8000);
    check(`${label}: the host sees that name`, seen);
    check(`${label}: the flow never showed the name screen`, !/nameEntry|onlineJoin/.test(await hist(G)), await hist(G));
    check(`${label}: no page errors`, !G.errors.length && !H.errors.length, [...G.errors, ...H.errors].join(' | ').slice(0, 200));
    await sleep(600); await shot(G, `room-2-pick-${label}`);
    if (label === 'desktop') await shot(H, 'room-3-host-sees');
    await closeAll();
  }

  // ---- a crew room's link, first-time visitor ----
  const crew = await (await fetch(API + 'crews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'JOIN TEST' }) })).json();
  check('a crew room was made', crew && crew.slug, JSON.stringify(crew).slice(0, 120));
  const A = await page(`${PLAY}?crew=${crew.slug}`, prof('ALREADY', 'b'));
  for (const [label, size, touch] of SIZES) {
    const C = await page(`${PLAY}?crew=${crew.slug}`, {}, size, touch);
    check(`${label}: a crew link opens on the lobby`, (await flow(C)) === 'crewLobby', await flow(C));
    const p = await me(C);
    check(`${label}: crew visitor was handed a name, marked auto`, p && NAME.test(p.name) && p.auto === true, p && p.name);
    const inList = await until(() => A.evaluate((n) => document.body.innerText.includes(n), p.name), 15000);
    check(`${label}: the crew sees them in the standings`, inList);
    const says = await until(() => C.evaluate((n) => document.body.innerText.includes(`YOU'RE ${n}`), p.name), 5000);
    check(`${label}: the lobby says what they're called`, says);
    const fits = await C.evaluate(() => { const s = document.querySelector('.fl-crew .fl-label'), st = document.querySelector('.fl-crew').getBoundingClientRect(), r = s.getBoundingClientRect(); return r.left >= st.left - 1 && r.right <= st.right + 1 && s.scrollWidth <= s.clientWidth + 1; });
    check(`${label}: that line fits the stage`, fits);
    check(`${label}: crew page has no errors`, !C.errors.length, C.errors.join(' | ').slice(0, 200));
    await sleep(500); await shot(C, `crew-${label}`);
    if (label === 'desktop') {
      // picking a real name clears the mark, and the crew sees the new one
      await C.evaluate(() => { const f = window.__flow.debug; f.go('onlineMenu'); f.go('profile'); });
      await C.evaluate(() => [...document.querySelectorAll('button')].find((b) => /CHANGE NAME/.test(b.textContent)).click());
      const title = await C.evaluate(() => document.querySelector('h1').textContent);
      check('CHANGE NAME on a handed-out name asks WHAT DO WE CALL YOU?', /WHAT DO WE CALL YOU/.test(title), title);
      for (let i = 0; i < 12; i++) await C.keyboard.press('Backspace');
      await C.keyboard.type('ROOKIE'); await C.keyboard.press('Enter');
      const q = await until(async () => { const v = await me(C); return v && v.name === 'ROOKIE' ? v : null; }, 5000);
      check('a picked name replaces it and clears auto', q && q.name === 'ROOKIE' && !q.auto, JSON.stringify(q && { name: q.name, auto: q.auto }));
    }
  }
  await closeAll();

  // ---- a player who already has a name keeps it and goes straight in ----
  {
    const { H, code } = await host();
    const G = await page(`${PLAY}?room=${code}`, prof('OLD HAND', 'c'));
    const in1 = await until(async () => (await flow(G)) === 'onlineSelect', 45000);
    check('named player: straight to the pick screen', in1, `${await hist(G)}  ·  ${(await G.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 200)}`);
    const p = await me(G);
    check('named player: the name is untouched', p.name === 'OLD HAND' && !p.auto, p.name);
    check('named player: host sees it', await until(() => H.evaluate(() => document.body.innerText.includes('OLD HAND')), 8000));
    await closeAll();
  }

  // ---- a link to a room that's gone ----
  {
    const G = await page(`${PLAY}?room=ZZZZ`, {});
    const ended = await until(async () => (await flow(G)) === 'onlineEnd', 40000);
    const t = await G.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    check('dead room link: it says so, with TRY AGAIN and the menus', ended && /TRY AGAIN/.test(t) && /MAIN MENU/.test(t), t.slice(0, 160));
    await shot(G, 'room-dead');
  }
  // ---- a link whose code isn't one: the title, as before, and no name handed out ----
  {
    const G = await page(`${PLAY}?room=AB`, {});
    const p = await me(G);
    check('a broken code opens the title', (await flow(G)) === 'attract' && !(p && p.name), await flow(G));
  }
  // ---- VERSUS ONLINE from the menu still asks a nameless player ----
  {
    const G = await page(PLAY, {});
    await G.evaluate(() => { window.__flow.debug.go('modeSelect'); });
    await G.evaluate(() => [...document.querySelectorAll('button')].find((b) => /ONLINE/.test(b.textContent)).click());
    check('VERSUS ONLINE with no name still asks for one', (await flow(G)) === 'nameEntry', await flow(G));
    const p = await me(G);
    check('and nothing was handed out', !p || !p.name, p && p.name);
  }
} catch (e) { check('the run finished', false, String(e && e.stack || e).slice(0, 600)); }
finally { for (const b of browsers) await b.close().catch(() => {}); }
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} of ${results.length} checks passed`);
process.exit(bad.length ? 1 : 0);
