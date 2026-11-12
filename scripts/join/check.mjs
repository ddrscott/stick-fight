// Join links ask nothing (README, Arcade flow, Versus online): real browsers through the local Worker.
//
//   npm run build && npm run dev:worker        (the Worker serving dist/ and the API on :8787)
//   node scripts/join/check.mjs [http://127.0.0.1:8787/] [--shots dir]
//
// A host opens a quick room; a visitor with empty storage opens its room/<CODE> link and has to land on the
// pick screen without a key, a tap or a letter typed. Then the same for a crew/<slug> link and the crew lobby,
// at desktop and phone sizes, with the address bar left clean, the lobby's QR code carrying the clean link,
// and no request in the network log failing. The old ?room= and ?crew= links still work, through the
// Worker's 301. Leaving the crew puts the address back to play/, and an unknown crew says so. It also checks that a handed-out name is a real one and marked `auto`, that
// a player who already has a name keeps it, that a dead room link says so with a way out, that a broken code opens the title, and that
// VERSUS ONLINE from the menu still asks a nameless player for a name. Exit code 1 on any failure.
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createCanvas, loadImage } from '@napi-rs/canvas';
const jsQR = createRequire(import.meta.url)('jsqr');

const argv = process.argv.slice(2);
const BASE = (argv.find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/').replace(/\/?$/, '/');
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : '';
const API = BASE + 'api/', PLAY = BASE + 'play/', ROOT = new URL(BASE).pathname;
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
  p.errors = []; p.missing = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  // the network log: any response of 400 or more, or a request that never got one (a socket closed on purpose aside)
  // (the game's own origin only: the analytics script from another host is blocked in headless Chromium either way)
  const ours = (u) => u.startsWith(new URL(BASE).origin + '/');
  p.on('response', (res) => { if (res.status() >= 400 && ours(res.url())) p.missing.push(`${res.status()} ${res.url()}`); });
  p.on('requestfailed', (req) => { const f = req.failure(); if (ours(req.url()) && !/ERR_ABORTED/.test((f && f.errorText) || '')) p.missing.push(`failed ${req.url()} ${f && f.errorText}`); });
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
/** the QR code on the screen, read by jsQR out of the whole screenshot (as scripts/qr/check.mjs does) */
async function qrText(p) {
  await p.evaluate(() => window.__gauntlet.step(0)).catch(() => {});
  const img = await loadImage(await p.screenshot());
  const c = createCanvas(img.width, img.height), g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const got = jsQR(g.getImageData(0, 0, img.width, img.height).data, img.width, img.height);
  return got ? got.data : null;
}
const where = (p) => p.evaluate(() => location.pathname + location.search);
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
    const hostLink = await H.evaluate(() => (document.querySelector('.fl-link') || {}).textContent || '');
    check(`${label}: the host's link is the clean room/<CODE>`, hostLink === `${BASE}room/${code}`, hostLink);
    const G = await page(`${BASE}room/${code}`, {}, size, touch);
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
    check(`${label}: nothing in the room link's network log failed`, !G.missing.length, G.missing.slice(0, 3).join(' | '));
    check(`${label}: in the room, the address is the clean room/<CODE>`, (await where(G)) === `${ROOT}room/${code}`, await where(G));
    await sleep(600); await shot(G, `room-2-pick-${label}`);
    if (label === 'desktop') await shot(H, 'room-3-host-sees');
    await closeAll();
  }

  // ---- a crew room's link, first-time visitor ----
  const crew = await (await fetch(API + 'crews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'JOIN TEST' }) })).json();
  check('a crew room was made', crew && crew.slug, JSON.stringify(crew).slice(0, 120));
  const CLEAN = `${BASE}crew/${crew.slug}`;
  const A = await page(CLEAN, prof('ALREADY', 'b'));
  for (const [label, size, touch] of SIZES) {
    const C = await page(CLEAN, {}, size, touch);
    check(`${label}: a crew link opens on the lobby`, (await flow(C)) === 'crewLobby', await flow(C));
    check(`${label}: the address bar stays crew/<slug>`, (await where(C)) === `${ROOT}crew/${crew.slug}`, await where(C));
    const shown = await C.evaluate(() => (document.querySelector('.fl-crew .fl-link') || {}).textContent || '');
    check(`${label}: the lobby shows the clean link`, shown === CLEAN, shown);
    const p = await me(C);
    check(`${label}: crew visitor was handed a name, marked auto`, p && NAME.test(p.name) && p.auto === true, p && p.name);
    const inList = await until(() => A.evaluate((n) => document.body.innerText.includes(n), p.name), 15000);
    check(`${label}: the crew sees them in the standings`, inList);
    const says = await until(() => C.evaluate((n) => document.body.innerText.includes(`YOU'RE ${n}`), p.name), 5000);
    check(`${label}: the lobby says what they're called`, says);
    const fits = await C.evaluate(() => { const s = [...document.querySelectorAll('.fl-crew .fl-label, .fl-crew .fl-crewme')].find((n) => n.getBoundingClientRect().width), st = document.querySelector('.fl-crew').getBoundingClientRect(), r = s.getBoundingClientRect(); return r.left >= st.left - 1 && r.right <= st.right + 1 && s.scrollWidth <= s.clientWidth + 1; });
    check(`${label}: that line fits the stage`, fits);
    check(`${label}: crew page has no errors`, !C.errors.length, C.errors.join(' | ').slice(0, 200));
    check(`${label}: nothing in the crew link's network log failed (no 404s)`, !C.missing.length, C.missing.slice(0, 3).join(' | '));
    await sleep(500); await shot(C, `crew-${label}`);
    if (label === 'upright') {
      // held upright: who's here and PLAY, your name with a way to change it, the link behind INVITE, one way out
      const up = await C.evaluate(() => {
        const vis = (n) => !!n && n.getBoundingClientRect().width > 0;
        const btns = [...document.querySelectorAll('#flow .fl-crew .fl-btn')].filter(vis).map((b) => b.textContent.trim());
        const list = document.querySelector('#flow .fl-standings').getBoundingClientRect().height;
        return { btns, list, h: innerHeight, qr: vis(document.querySelector('#flow .fl-qrtile')), link: vis(document.querySelector('#flow .fl-crew .fl-link')), me: (document.querySelector('#flow .fl-crewme') || {}).textContent || '' };
      });
      check('upright: no QR code or link until INVITE', !up.qr && !up.link, JSON.stringify(up));
      check('upright: the only way out is MAIN MENU', up.btns.includes('MAIN MENU') && !up.btns.includes('ONLINE MENU'), up.btns.join(', '));
      check('upright: the crew list gets at least half the screen', up.list >= up.h / 2, `${Math.round(up.list)} of ${up.h} px`);
      check('upright: a handed-out name says SET YOUR NAME', /SET YOUR NAME/.test(up.me), up.me);
      // the list is who's here and who's ready: rank, name, W, L, and a READY / PLAYING chip that always shows whole
      const heads = await C.evaluate(() => [...document.querySelectorAll('#flow .fl-standings > .fl-sth')].filter((n) => n.getBoundingClientRect().width).map((n) => n.textContent));
      check('upright: the list heads are just NAME, W and L', heads.join(',') === ',NAME,W,L', heads.join(','));
      const press = (P) => P.evaluate(() => window.__flow.debug.ui.items.find((i) => i.el.classList.contains('fl-playbtn')).act());
      await press(A);
      const chipsFit = (P = C) => P.evaluate(() => {
        const out = [];
        for (const ch of document.querySelectorAll('#flow .fl-standings .fl-chip')) {
          const cell = ch.closest('.fl-sname').getBoundingClientRect(), r = ch.getBoundingClientRect();
          const nm = ch.parentElement.querySelector('.fl-snm'), you = ch.parentElement.querySelector('.fl-youtag');
          out.push({ row: nm.textContent + ch.textContent, whole: nm.scrollWidth <= nm.clientWidth + 1, mine: ch.parentElement.classList.contains('fl-me'), color: getComputedStyle(nm).color, you: !!you && you.getBoundingClientRect().width > 0,
            ok: r.width > 0 && r.right <= cell.right + 0.5 && r.left >= cell.left - 0.5 && ch.scrollWidth <= ch.clientWidth + 1, r: Math.round(r.right), cell: Math.round(cell.right) });
        }
        return out;
      });
      const PINK = 'rgb(255, 194, 243)';
      // the other side: A's own row on a desktop and sideways reads "ALREADY READY", whole and pink, with no (YOU) squeezing the name
      for (const [w, h] of [[1280, 720], [844, 390]]) {
        await A.setViewportSize({ width: w, height: h }); await sleep(300);
        const got = await until(async () => { const c = (await chipsFit(A)).filter((x) => x.mine); return c.length ? c : null; }, 10000);
        check(`${w}x${h}: your own row with READY reads ALREADY READY, name whole and pink, no (YOU)`, got && got.every((c) => c.ok && c.whole && !c.you && c.color === PINK && c.row === 'ALREADYREADY'), JSON.stringify(got));
      }
      await A.setViewportSize({ width: 1280, height: 720 });
      const youTag = await C.evaluate(() => { const n = document.querySelector('#flow .fl-standings .fl-me .fl-snm'); return n && getComputedStyle(n).color; });
      check('upright: your own row\'s name is pink', youTag === PINK, String(youTag));
      for (const [w, h] of [[390, 844], [375, 667]]) {
        await C.setViewportSize({ width: w, height: h });
        const got = await until(async () => { const c = await chipsFit(); return c.length ? c : null; }, 10000);
        check(`upright ${w}x${h}: a READY chip shows whole inside its row`, got && got.every((c) => c.ok), JSON.stringify(got));
        if (w === 390) await shot(C, 'crew-upright-ready');
      }
      // your own row: "GUEST 123" and its READY chip, both whole
      await press(A);   // (A backs out first, or C's PLAY would start a match with them)
      await until(() => C.evaluate(() => !document.querySelector('#flow .fl-standings .fl-chip')), 10000);
      await press(C);
      await C.setViewportSize({ width: 375, height: 667 });
      const own = await until(async () => { const c = await chipsFit(); return c.length ? c : null; }, 10000);
      check('upright 375x667: your own GUEST row and its READY chip both show whole, the name pink', own && own.every((c) => c.ok) && own.some((c) => /^GUEST \d{3}READY$/.test(c.row) && c.whole && c.mine && c.color === PINK), JSON.stringify(own));
      await C.setViewportSize(size);
      await press(C);   // back to just HERE
      await C.evaluate(() => window.__flow.debug.ui.items.find((i) => i.el.classList.contains('fl-invite')).act());
      await sleep(300);
      const inv = await C.evaluate(() => [...document.querySelectorAll('#flow .fl-crew .fl-btn')].filter((n) => n.getBoundingClientRect().width).map((b) => b.textContent.trim()));
      check('upright: INVITE shows COPY LINK and DONE', inv.includes('COPY LINK') && inv.includes('DONE'), inv.join(', '));
      await shot(C, 'crew-upright-invite');
    }
    const qr = await until(() => qrText(C), 20000, 500);
    check(`${label}: the lobby's QR code carries the clean link`, qr === CLEAN, String(qr));
    if (label === 'upright') {
      // SET YOUR NAME: the name screen, then straight back to this crew's lobby under the new name
      await C.evaluate(() => window.__flow.debug.ui.items.find((i) => i.el.classList.contains('fl-crewme')).act());
      check('upright: SET YOUR NAME opens the name screen', (await flow(C)) === 'nameEntry', await flow(C));
      for (let i = 0; i < 12; i++) await C.keyboard.press('Backspace');
      await C.keyboard.type('UPRIGHT'); await C.keyboard.press('Enter');
      const back = await until(() => C.evaluate(() => window.__flow.state === 'crewLobby' && /YOU'RE UPRIGHT/.test((document.querySelector('#flow .fl-crewme') || {}).textContent || '')), 5000);
      check('upright: OK goes back to the lobby, saying the new name', back, await flow(C));
      check('upright: the address bar is crew/<slug> again', (await where(C)) === `${ROOT}crew/${crew.slug}`, await where(C));
      const seen = await until(() => A.evaluate(() => document.body.innerText.includes('UPRIGHT')), 15000);
      check('upright: the crew sees the new name', seen);
    }
    if (label === 'desktop') {
      // picking a real name clears the mark, and the crew sees the new one
      await C.evaluate(() => { const f = window.__flow.debug; f.go('onlineMenu'); f.go('profile'); });
      check('out of the crew to the menus: the address is back to play/', (await where(C)) === `${ROOT}play/`, await where(C));
      await C.evaluate(() => [...document.querySelectorAll('button')].find((b) => /CHANGE NAME/.test(b.textContent)).click());
      const title = await C.evaluate(() => document.querySelector('h1').textContent);
      check('CHANGE NAME on a handed-out name asks WHAT DO WE CALL YOU?', /WHAT DO WE CALL YOU/.test(title), title);
      for (let i = 0; i < 12; i++) await C.keyboard.press('Backspace');
      await C.keyboard.type('ROOKIE'); await C.keyboard.press('Enter');
      const q = await until(async () => { const v = await me(C); return v && v.name === 'ROOKIE' ? v : null; }, 5000);
      check('a picked name replaces it and clears auto', q && q.name === 'ROOKIE' && !q.auto, JSON.stringify(q && { name: q.name, auto: q.auto }));
    }
  }
  // ---- the old ?crew= link, through the Worker's 301, any other query kept ----
  {
    const O = await page(`${PLAY}?crew=${crew.slug}&pick=intern`, {});
    check('old ?crew= link: lands in the lobby', (await flow(O)) === 'crewLobby', await flow(O));
    check('old ?crew= link: the address is the clean link, pick kept', (await where(O)) === `${ROOT}crew/${crew.slug}?pick=intern`, await where(O));
    check('old ?crew= link: no 404s, no page errors', !O.missing.length && !O.errors.length, [...O.missing, ...O.errors].slice(0, 3).join(' | '));
  }
  // ---- an unknown crew at a clean link: the game loads and says so ----
  {
    const U = await page(`${BASE}crew/nobody-zzzzz`, {});
    const says = await until(() => U.evaluate(() => /NO CREW AT THAT LINK/.test(document.body.innerText)), 10000);
    check('unknown crew/<slug>: the game loads and says NO CREW AT THAT LINK', says, await hist(U));
    check('unknown crew/<slug>: no 404s, no page errors', !U.missing.length && !U.errors.length, [...U.missing, ...U.errors].slice(0, 3).join(' | '));
    await shot(U, 'crew-unknown');
  }
  await closeAll();

  // ---- a player who already has a name keeps it and goes straight in ----
  {
    const { H, code } = await host();
    const G = await page(`${PLAY}?room=${code}`, prof('OLD HAND', 'c'));   // the old form, through the 301 to room/<CODE>
    const in1 = await until(async () => (await flow(G)) === 'onlineSelect', 45000);
    check('named player: straight to the pick screen', in1, `${await hist(G)}  ·  ${(await G.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 200)}`);
    const p = await me(G);
    check('named player: the name is untouched', p.name === 'OLD HAND' && !p.auto, p.name);
    check('named player: host sees it', await until(() => H.evaluate(() => document.body.innerText.includes('OLD HAND')), 8000));
    check('old ?room= link: no 404s on the way in', !G.missing.length, G.missing.slice(0, 3).join(' | '));
    await closeAll();
  }

  // ---- a link to a room that's gone ----
  {
    const G = await page(`${BASE}room/ZZZZ`, {});
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
