// The crew lobby's HIGH SCORES and STATS, and a run reaching a crew's table, in real pages against the local
// Worker (README, Crew rooms, High scores and Stats):
//
//   npm run build && npm run dev:worker
//   node scripts/crew/lobby.mjs [http://127.0.0.1:8787/] [--shots dir]
//
// It makes a crew through the API and fills it the way pages do (members, matches with their lengths through
// the crew socket, runs posted to its tables), then at 1280x720, 844x390 and 390x844 opens the crew link as a
// member: the ARCADE, HORDE and STATS tabs show the crew's tables and stats, on the screen. Then a run that
// misses this device's table but makes the crew's goes through GAME OVER to the initials (which say so),
// is posted, lands on the crew's table, and the attract loop's tables include the crew's.
// Crew goals (README, Crew rooms, Crew goals): at each size the STANDINGS tab opens on the week's goal (its words,
// the bar, who played by initials and title, Employee of the Month with a star on that row), on screen, square and
// with no glow, and nothing that names a worst or a bottom; then on the desktop a match that meets the goal pays
// ALICE's page +150 sticks and +100 XP once (in localStorage), and says CREW GOAL MET. Needs DEV_HOOKS=1.
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { goalFor, goalText, weekOf, GOAL_PAY, monthName, monthOf } from '../../src/career/crewgoal.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const argv = process.argv.slice(2);
const BASE = (argv.find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/').replace(/\/?$/, '/');
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : '';
const LAYOUT_ONLY = argv.includes('--layout');   // just the landscape layout section (README, Crew rooms, The lobby sideways)
const API = BASE + 'api/', WS = API.replace(/^http/, 'ws');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const until = async (fn, ms = 20000, every = 200) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };
const post = (path, body) => fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// ---- a crew with some history -------------------------------------------------------------------------
function sock(url) {
  const ws = new WebSocket(url), q = [];
  ws.onmessage = (e) => { try { q.push(JSON.parse(e.data)); } catch { /* binary */ } };
  const open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const next = async (pred, ms = 6000) => { const t0 = Date.now(); for (;;) { const i = q.findIndex(pred); if (i >= 0) return q.splice(i, 1)[0]; if (Date.now() - t0 > ms) throw new Error('timeout'); await sleep(30); } };
  return { ws, open, q, next, send: (o) => ws.send(JSON.stringify(o)), close: () => { try { ws.close(); } catch { /* gone */ } } };
}
/** a member in the lobby. Run right after check.mjs, the Worker's JOIN_LIMIT (30 sockets a minute per IP) may say busy:
 *  wait it out and try again */
async function member(slug, pid, name, title = '') {
  for (let k = 0; ; k++) {
    const s = sock(`${WS}crews/${slug}/ws`); await s.open;
    s.send({ t: 'hello', pid, name, ...(title ? { title } : {}) });
    const m = await s.next((x) => x.t === 'welcome' || x.ev === 'error' || x.t === 'error', 8000).catch(() => null);
    if (m && m.t === 'welcome') return s;
    s.close();
    if (k > 20) throw new Error(`no welcome: ${JSON.stringify(m)}`);
    await sleep(4000);
  }
}

const crew = await (await post('crews', { name: 'LUNCH CREW' })).json();
const slug = crew.slug;
const P = { alice: 'a'.repeat(32), bob: 'b'.repeat(32) };
const A = await member(slug, P.alice, 'ALICE'), B = await member(slug, P.bob, 'BOB', 'INTERN');
const MATCHES = [[['courier', 'intern'], 0, 75], [['courier', 'intern'], 1, 92], [['lawyer', 'chef'], 0, 140], [['courier', 'barista'], -1, 198], [['courier', 'intern'], 0, 66]];
for (const [chars, winner, secs] of MATCHES) {
  A.send({ t: 'play', on: true }); await sleep(60); B.send({ t: 'play', on: true });
  const m = await A.next((x) => x.t === 'match'); await B.next((x) => x.t === 'match');
  A.send({ t: 'result', match: m.id, n: 1, winner, wins: winner === 0 ? [2, 1] : winner === 1 ? [0, 2] : [1, 1], chars, secs });
  await A.next((x) => x.t === 'state' && x.stats && x.stats.secs > 0);
  A.send({ t: 'lobby' }); B.send({ t: 'lobby' });
}
const extra = [];
const RUNS = [['ABC', 'arcade', 84200, 'courier', 4], ['SCO', 'arcade', 151000, 'manager', 6, true], ['BOB', 'horde', 22400, 'intern', 3], ['NEO', 'arcade', 30100, 'lawyer', 2], ['KIX', 'horde', 9100, 'chef', 1], ['JAB', 'arcade', 12500, 'barista', 1]];
for (const [initials, kind, score, char, reach, clear] of RUNS) {
  const pid = crypto.randomBytes(16).toString('hex');
  extra.push(await member(slug, pid, `PLAYER ${initials}`));
  const r = await (await post(`crews/${slug}/scores`, { pid, run: { kind, initials, score, char, reach, clear: !!clear } })).json();
  if (!r.ok) console.log('  seed run refused', initials, r);
}
for (const s of [A, B, ...extra]) s.close();
check('a crew with matches and runs', true, slug);
// this week's goal, made when ALICE first opened the crew (one member): the five matches above count toward it
const GOAL = { ...goalFor(weekOf(), 1) };
let EW = 3;   // ALICE's crew wins this month (Employee of the Month)
let PROG = Math.min(GOAL.target, { matches: 5, rounds: 3 + 2 + 3 + 2 + 3, wins: 4 }[GOAL.kind]);
/** a seeded match between ALICE and BOB that ALICE wins 2-0 (from sockets beside any page) */
async function seedMatch() {
  const a = await member(slug, P.alice, 'ALICE'), b = await member(slug, P.bob, 'BOB', 'INTERN');
  a.send({ t: 'play', on: true }); await sleep(60); b.send({ t: 'play', on: true });
  const m = await a.next((x) => x.t === 'match'); await b.next((x) => x.t === 'match');
  a.send({ t: 'result', match: m.id, n: 1, winner: 0, wins: [2, 0], chars: ['courier', 'intern'], secs: 50 });
  await sleep(500); a.close(); b.close();
}
const goalBox = (p) => p.evaluate(() => {
  const g = document.querySelector('.fl-crew .fl-standings .fl-goal');
  if (!g) return null;
  const all = [g, ...g.querySelectorAll('*')];
  const fill = g.querySelector('.fl-goalbar > i');
  const starRow = document.querySelector('.fl-crew .fl-standings .fl-star');
  return {
    text: g.innerText.replace(/\s+/g, ' '),
    chips: [...g.querySelectorAll('.fl-goalchip')].map((c) => c.textContent),
    fill: fill ? Math.round((100 * fill.offsetWidth) / fill.parentElement.clientWidth) : -1,   // (layout sizes: the stage is scaled)
    glow: all.filter((e) => getComputedStyle(e).textShadow !== 'none' || /blur|drop-shadow/.test(getComputedStyle(e).filter)).length,
    round: all.filter((e) => parseFloat(getComputedStyle(e).borderTopLeftRadius) > 2).length,
    star: starRow ? starRow.parentElement.innerText.replace(/\s+/g, ' ') : '',
  };
});

// ---- the pages -----------------------------------------------------------------------------------------
const browsers = [];
async function page(url, init, size, touch) {
  const b = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  browsers.push(b);
  const ctx = await b.newContext(touch ? { viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: size });
  await ctx.addInitScript((kv) => { for (const k in kv) if (localStorage.getItem(k) === null) localStorage.setItem(k, kv[k]); }, init);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(url);
  await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
  await p.evaluate(() => { let last = performance.now(), k = 0; window.__pump = setInterval(() => { const now = performance.now(), ms = Math.min(100, now - last); last = now; if (++k % 12 === 0) window.__gauntlet.step(ms); else window.__game.advance(ms); }, 8); });
  return p;
}
const closeAll = async () => { for (const b of browsers.splice(0)) await b.close().catch(() => {}); };
const flow = (p) => p.evaluate(() => window.__flow.state);
const shot = async (p, name) => { if (!SHOTS) return; await p.evaluate(() => window.__gauntlet.step(0)).catch(() => {}); await p.screenshot({ path: `${SHOTS}/${name}.png`, timeout: 90000 }).catch((e) => console.log('   (no shot: ' + e.message.split('\n')[0] + ')')); };
const profileOf = (id, name) => ({ 'stick-fight-player': JSON.stringify({ id, name, email: '', crews: [{ slug, name: 'LUNCH CREW', at: Date.now() }] }) });
const tab = (p, v) => p.evaluate((v) => { const b = document.querySelector(`.fl-crewtab[data-view="${v}"]`); if (b) b.click(); return !!b; }, v);
const tableText = (p) => p.evaluate(() => (document.querySelector('.fl-crew .fl-standings') || {}).innerText || '');
/** everything in the table that has text is inside the window, or inside a box that scrolls */
const onScreen = (p) => p.evaluate(() => {
  const t = document.querySelector('.fl-crew .fl-standings');
  if (!t) return 'no table';
  const box = t.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
  const scrolls = t.scrollHeight > t.clientHeight + 1 && getComputedStyle(t).overflowY === 'auto';
  const bad = [...t.querySelectorAll('span, b, button')].filter((e) => e.offsetParent && e.textContent.trim()).map((e) => [e, e.getBoundingClientRect()])
    .filter(([, r]) => r.width && (r.left < -1 || r.right > vw + 1 || (!scrolls && (r.top < -1 || r.bottom > vh + 1)) || (scrolls && (r.right > box.right + 2 || r.left < box.left - 2))));
  return bad.length ? bad.slice(0, 3).map(([e, r]) => `${e.textContent.trim().slice(0, 16)}@${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`).join(' | ') : '';
});
/** the smallest text in the table, in CSS pixels on the screen */
const minFont = (p) => p.evaluate(() => {
  const t = document.querySelector('.fl-crew .fl-standings');
  let min = 99;
  for (const e of t.querySelectorAll('span, b, button')) if (e.offsetParent && e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) min = Math.min(min, parseFloat(getComputedStyle(e).fontSize) * (e.getBoundingClientRect().height / (e.offsetHeight || 1)));
  return Math.round(min * 10) / 10;
});

// ---- the lobby sideways: two calm columns (README, Crew rooms, The lobby sideways) ---------------------------
// A crew like Scott's YORKSHIRE, with 7 members and with 15, opened by members at 1280x720, 920x500, 844x390 and
// 667x375. On each: no text overlaps another or runs past its box or the stage (bounding boxes), every name in the
// visible standings shows whole at no less than the upright list's size for the stage, YOU'RE <name> and your own
// row are on the screen without scrolling (your row pinned under the list when it's below the fold), nothing
// readable glows, every corner is square, and the link, recent results, VS YOU and FAVORITE are off this screen.
// Upright is screenshotted beside them as the reference. Then four members side by side at 920x500.
const LAYOUT_NAMES = ['SNAKEHIT4034', 'SMP', 'JOKE MCCOY', 'SCOTT', 'DAD', 'GUEST 885', 'GUEST 611',
  'BARISTA BOB', 'KAREN IN HR', 'THE INTERN', 'MEGAPUNCHER', 'LIL SUE', 'NIGHT SHIFT', 'GUEST 207', 'WALLY'];
/** a crew with n members and some history: wins spread so the order is fixed, the viewer's pids kept */
async function layoutCrew(name, n) {
  const c = await (await post('crews', { name })).json();
  const pids = LAYOUT_NAMES.slice(0, n).map(() => crypto.randomBytes(16).toString('hex'));
  const socks = [];
  for (let i = 0; i < n; i++) socks.push(await member(c.slug, pids[i], LAYOUT_NAMES[i], ['MANAGER', 'TEMP', 'INTERN', 'SENIOR'][i % 4]));
  // (winner, loser) by index: SNAKEHIT wins most, then the rest in order; the last few never win
  const games = [];
  for (let w = 0; w < Math.min(n, 6); w++) for (let k = 0; k < 6 - w; k++) games.push([w, (w + 1 + k) % n]);
  for (const [w, l] of games) {
    if (w === l) continue;
    socks[w].send({ t: 'play', on: true }); await sleep(40); socks[l].send({ t: 'play', on: true });
    const m = await socks[w].next((x) => x.t === 'match'); await socks[l].next((x) => x.t === 'match');
    const hostIsW = m.role === 'host';
    const host = hostIsW ? socks[w] : socks[l];
    host.send({ t: 'result', match: m.id, n: 1, winner: hostIsW ? 0 : 1, wins: hostIsW ? [2, 1] : [1, 2], chars: ['courier', 'intern'], secs: 60 });
    await sleep(150);
    for (const x of [socks[w], socks[l]]) { x.send({ t: 'lobby' }); x.send({ t: 'play', on: false }); }
    await sleep(120);
    for (const x of socks) x.q.length = 0;
  }
  for (const s of socks) s.close();
  return { slug: c.slug, pids };
}
/** what's on the lobby screen, measured: see the comment above */
const audit = (p) => p.evaluate(() => {
  const scr = document.querySelector('#flow > .fl-crew');
  const stage = document.getElementById('flow').getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight;
  const R = (r) => `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`;
  const own = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const shown = (e) => {
    if (!e || !e.isConnected) return false;
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    // on top at its middle (a row scrolled under the sticky heads or the pinned row of your own isn't shown)
    const x = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    const top = document.elementFromPoint(x, y);
    return !!top && (top === e || e.contains(top) || top.contains(e));
  };
  const leaves = [...scr.querySelectorAll('*')].filter((e) => own(e) && shown(e));
  // a leaf the scrolling list cuts at its edge isn't shown either (that's the list scrolling, not a clip)
  const list = scr.querySelector('.fl-standings'), lr = list && list.getBoundingClientRect();
  const inList = (e) => list && list.contains(e);
  // your own row pinned at the list's foot is its bottom edge: a row scrolling under it is cut there, like under the tabs
  const pin = scr.querySelector('.fl-v-standings > .fl-sname.fl-me'), pr = pin && pin.getBoundingClientRect();
  const pinned = !!pr && Math.abs(pr.bottom - lr.bottom) < 2;
  const vis = leaves.filter((e) => {
    if (!inList(e)) return true;
    const r = e.getBoundingClientRect();
    if (pinned && !e.closest('.fl-me') && r.bottom > pr.top + 1) return false;
    return r.top >= lr.top - 1 && r.bottom <= lr.bottom + 1;
  });
  const overlaps = [];
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const a = vis[i], b = vis[j];
    if (a.contains(b) || b.contains(a)) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ox > 1.5 && oy > 1.5) overlaps.push(`${a.textContent.trim().slice(0, 14)}@${R(ra)} x ${b.textContent.trim().slice(0, 14)}@${R(rb)}`);
  }
  const clips = [];
  for (const e of vis) {
    const r = e.getBoundingClientRect();
    if (r.left < stage.left - 1 || r.right > stage.right + 1 || r.top < stage.top - 1 || r.bottom > stage.bottom + 1 || r.left < -1 || r.right > vw + 1 || r.bottom > vh + 1) { clips.push(`off the stage: ${e.textContent.trim().slice(0, 20)}@${R(r)}`); continue; }
    if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible') clips.push(`cut: ${e.textContent.trim().slice(0, 20)} (${e.scrollWidth} > ${e.clientWidth})`);
    // inside its box (a button's words inside the button)
    const box = e.parentElement && e.parentElement.closest('.fl-btn, .fl-crewstatus, .fl-goalfold');
    if (box) { const b = box.getBoundingClientRect(); if (r.left < b.left - 1 || r.right > b.right + 1) clips.push(`past its box: ${e.textContent.trim().slice(0, 20)}`); }
  }
  // the standings names, as drawn (font size times any zoom)
  const px = (e) => parseFloat(getComputedStyle(e).fontSize) * (e.getBoundingClientRect().height / (e.offsetHeight || 1));
  const names = [...scr.querySelectorAll('.fl-v-standings .fl-snm')].filter((e) => vis.includes(e)).map((e) => ({ name: e.textContent, px: Math.round(px(e) * 10) / 10, whole: e.scrollWidth <= e.clientWidth + 1 }));
  const meBar = scr.querySelector('.fl-crewme'), meRow = scr.querySelector('.fl-v-standings .fl-sname.fl-me .fl-snm');
  const youTag = scr.querySelector('.fl-v-standings .fl-sname.fl-me .fl-youtag');
  // glow: a colored blur behind text (the plain outline is dark); corners: any radius over 2px
  const glow = [], round = [];
  for (const e of [scr, ...scr.querySelectorAll('*')]) {
    if (!e.getBoundingClientRect().width) continue;
    const cs = getComputedStyle(e);
    if (own(e) && cs.textShadow !== 'none') {
      for (const m of cs.textShadow.matchAll(/rgba?\(([^)]*)\)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/g)) {
        const [r, g, b, a = 1] = m[1].split(',').map(Number);
        if (+m[4] > 0 && r + g + b > 150 && a > 0.1) { glow.push(e.textContent.trim().slice(0, 16)); break; }
      }
    }
    if (parseFloat(cs.borderTopLeftRadius) > 2 || parseFloat(cs.borderBottomRightRadius) > 2) round.push(e.className);
  }
  const anyShown = (sel) => [...scr.querySelectorAll(sel)].some(shown);
  return {
    stage: { w: Math.round(stage.width), h: Math.round(stage.height) },
    overlaps, clips, names, glow, round,
    meBar: meBar && shown(meBar) ? meBar.textContent : '', meBarIn: !!meBar && meBar.getBoundingClientRect().bottom <= Math.min(vh, stage.bottom) + 1,
    meRow: meRow && vis.includes(meRow) ? meRow.textContent : '', meWhole: !!meRow && meRow.scrollWidth <= meRow.clientWidth + 1,
    youTag: !!youTag && vis.includes(youTag) && youTag.scrollWidth <= youTag.clientWidth + 1,
    link: anyShown('.fl-link'), recent: anyShown('.fl-recent > div'), qr: anyShown('.fl-qrtile'), vs: anyShown('.fl-svs'), fav: anyShown('.fl-v-standings .fl-sfav'),
    scrollTop: list ? list.scrollTop : -1, scrolls: !!list && list.scrollHeight > list.clientHeight + 1,
  };
});
/** press a lobby item by its class, as the keys would (false when the screen has none) */
const pressItem = (p, cls) => p.evaluate((c) => { const i = window.__flow.debug.ui.items.find((x) => x.el.classList.contains(c)); if (i) i.act(); return !!i; }, cls);
async function layoutSuite() {
  const crews = { 7: await layoutCrew('YORKSHIRE', 7), 15: await layoutCrew('YORKSHIRE', 15) };
  check('layout: YORKSHIRE with 7 members and with 15', true, `${crews[7].slug}, ${crews[15].slug}`);
  const prof = (k, i, auto = false, email = '') => ({ 'stick-fight-player': JSON.stringify({ id: crews[k].pids[i], name: LAYOUT_NAMES[i], auto, email, crews: [{ slug: crews[k].slug, name: 'YORKSHIRE', at: Date.now() }] }) });
  // the upright list's names, for scale: their px over the phone's short side
  const SIZES_L = [['1280x720', { width: 1280, height: 720 }, false], ['920x500', { width: 920, height: 500 }, false], ['844x390', { width: 844, height: 390 }, true], ['667x375', { width: 667, height: 375 }, true]];
  let upRatio = 0;
  for (const k of [7, 15]) {
    // JOKE MCCOY (3rd) on the 7, and on the 15 GUEST 611 (15th, 0 and 6: below the fold at every size)
    const who = k === 7 ? 2 : 6;
    {
      const p = await page(`${BASE}crew/${crews[k].slug}`, prof(k, who), { width: 390, height: 844 }, true);
      await until(async () => (await flow(p)) === 'crewLobby' && /SNAKEHIT/.test(await tableText(p)));
      await sleep(800);
      const a = await audit(p);
      const r = Math.min(...a.names.map((n) => n.px)) / Math.min(390, 844);
      if (k === 7) upRatio = r;
      check(`layout ${k}: upright (the reference) still has YOU'RE ${LAYOUT_NAMES[who]} and its list`, a.meBar.includes(`YOU'RE ${LAYOUT_NAMES[who]}`) && a.names.length >= 5, `${a.names.length} names, ${Math.round(r * 1000) / 10}% of the short side`);
      await shot(p, `layout-${k}-upright`);
      await closeAll();
    }
    for (const [label, size, touch] of SIZES_L) {
      const p = await page(`${BASE}crew/${crews[k].slug}`, prof(k, who), size, touch);
      await until(async () => (await flow(p)) === 'crewLobby' && /SNAKEHIT/.test(await tableText(p)));
      await sleep(800);
      const a = await audit(p);
      const tag = `layout ${k} ${label}`;
      check(`${tag}: no text overlaps other text`, !a.overlaps.length, a.overlaps.slice(0, 3).join(' | '));
      check(`${tag}: no text is cut or runs off the stage`, !a.clips.length, a.clips.slice(0, 3).join(' | '));
      const min = Math.min(...a.names.map((n) => n.px)), ratio = min / Math.min(a.stage.w, a.stage.h);
      check(`${tag}: every name in the visible standings shows whole`, a.names.length >= 4 && a.names.every((n) => n.whole), `${a.names.length} names: ${a.names.filter((n) => !n.whole).map((n) => n.name).join(', ')}`);
      check(`${tag}: names at least the upright list's size for the stage (${(upRatio * 100).toFixed(1)}%)`, ratio >= upRatio - 0.0005, `${min} px, ${(ratio * 100).toFixed(1)}% of ${Math.min(a.stage.w, a.stage.h)}`);
      check(`${tag}: YOU'RE ${LAYOUT_NAMES[who]} with EDIT is on the screen`, a.meBar.includes(`YOU'RE ${LAYOUT_NAMES[who]}`) && /EDIT/.test(a.meBar) && a.meBarIn, a.meBar);
      check(`${tag}: your own row is on the screen without scrolling, name whole, marked (YOU)`, a.meRow === LAYOUT_NAMES[who] && a.meWhole && a.youTag && a.scrollTop === 0, JSON.stringify({ row: a.meRow, whole: a.meWhole, you: a.youTag, top: a.scrollTop }));
      check(`${tag}: nothing readable glows, every corner square`, !a.glow.length && !a.round.length, `${a.glow.slice(0, 3).join(', ')} | ${a.round.slice(0, 3).join(', ')}`);
      check(`${tag}: off this screen: the link, the QR code, recent results, VS YOU, FAVORITE`, !a.link && !a.qr && !a.recent && !a.vs && !a.fav, JSON.stringify({ link: a.link, qr: a.qr, recent: a.recent, vs: a.vs, fav: a.fav }));
      if (k === 15) check(`${tag}: the 15 scroll inside the panel`, a.scrolls);
      await shot(p, `layout-${k}-${label}`);
      if (k === 7 && label === '920x500') {
        // INVITE: the QR code, the link, COPY LINK; DONE (or Esc) puts the crew back, your name stays
        await pressItem(p, 'fl-invite');
        await sleep(400);
        const inv = await audit(p);
        check(`${tag}: INVITE shows the QR code and the link, and keeps YOU'RE`, inv.qr && inv.link && inv.meBar.includes("YOU'RE") && !inv.overlaps.length && !inv.clips.length, JSON.stringify({ qr: inv.qr, link: inv.link, o: inv.overlaps.slice(0, 2), c: inv.clips.slice(0, 2) }));
        await shot(p, `layout-${k}-${label}-invite`);
        await p.keyboard.press('Escape'); await sleep(300);
        check(`${tag}: Esc closes INVITE first, still in the lobby`, (await flow(p)) === 'crewLobby' && !(await audit(p)).qr, await flow(p));
        // the goal folds to one line and opens; the keys reach it, the tabs, PLAY, INVITE, EDIT, and scroll the list
        const reach = await p.evaluate(() => window.__flow.debug.ui.items.map((i) => i.el.className.match(/fl-(crewtab|playbtn|invite|crewme|goalfold)/)?.[1]).filter(Boolean));
        check(`${tag}: keys and pad reach the tabs, PLAY, INVITE, EDIT and the goal`, ['crewtab', 'playbtn', 'invite', 'crewme', 'goalfold'].every((x) => reach.includes(x)), reach.join(','));
        await pressItem(p, 'fl-goalfold');
        await sleep(300);
        const open = await goalBox(p);
        check(`${tag}: the goal opens to its chips and Employee of the Month`, open && open.chips.length > 0 && /EMPLOYEE OF THE MONTH/.test(open.text), open && open.text.slice(0, 120));
        await shot(p, `layout-${k}-${label}-goal-open`);
        await pressItem(p, 'fl-goalfold');
        await sleep(300);
        await closeAll();
        // the four members side by side, Scott's test: two named, one signed in, one handed a GUEST name
        const four = [[2, false, 'joke@example.com'], [3, false, ''], [4, false, ''], [5, true, '']];
        const ps = [];
        for (const [i, auto, email] of four) ps.push(await page(`${BASE}crew/${crews[7].slug}`, prof(7, i, auto, email), { width: 920, height: 500 }, false));
        for (const q of ps) await until(async () => (await flow(q)) === 'crewLobby' && /SNAKEHIT/.test(await tableText(q)));
        // two of them get in line, so the chips show too
        await pressItem(ps[1], 'fl-playbtn');
        await sleep(1500);
        const bars = [];
        for (const q of ps) { const a = await audit(q); bars.push(a.meBar); check(`four sessions: ${LAYOUT_NAMES[four[bars.length - 1][0]]}'s screen: nothing overlaps or is cut`, !a.overlaps.length && !a.clips.length, [...a.overlaps, ...a.clips].slice(0, 3).join(' | ')); }
        check('four sessions: each says who it is', four.every(([i], k) => bars[k].includes(`YOU'RE ${LAYOUT_NAMES[i]}`)), bars.join(' | '));
        if (SHOTS) {
          const imgs = [];
          for (const q of ps) { await q.evaluate(() => window.__gauntlet.step(0)).catch(() => {}); imgs.push(await loadImage(await q.screenshot())); }
          const W = 920, H = 500, gap = 8, c = createCanvas(W * 2 + gap, H * 2 + gap), g = c.getContext('2d');
          g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
          imgs.forEach((im, k) => g.drawImage(im, (k % 2) * (W + gap), Math.floor(k / 2) * (H + gap), W, H));
          fs.writeFileSync(`${SHOTS}/layout-four-sessions.png`, c.toBuffer('image/png'));
        }
        for (const q of ps) check(`four sessions: no page errors`, !q.errors.length, q.errors.join(' | ').slice(0, 200));
        await pressItem(ps[1], 'fl-playbtn');
      }
      check(`${tag}: no page errors`, !p.errors.length, p.errors.join(' | ').slice(0, 200));
      await closeAll();
    }
  }
}

const SIZES = [['desktop', { width: 1280, height: 720 }, false], ['phone', { width: 844, height: 390 }, true], ['upright', { width: 390, height: 844 }, true]];
try {
  await layoutSuite();
  if (!LAYOUT_ONLY) for (const [label, size, touch] of SIZES) {
    const p = await page(`${BASE}crew/${slug}`, profileOf(P.alice, 'ALICE'), size, touch);
    check(`${label}: the crew link opens the lobby`, await until(async () => (await flow(p)) === 'crewLobby'), await flow(p));
    check(`${label}: the lobby has its four tabs`, await until(() => p.evaluate(() => document.querySelectorAll('.fl-crewtab').length === 4)));
    await until(async () => /ALICE/.test(await tableText(p)));
    // the week's goal over the standings
    const gb = await until(() => goalBox(p));
    const words = goalText(GOAL.kind, GOAL.target);
    check(`${label}: the goal is over the standings: ${words}, ${PROG} / ${GOAL.target}`, gb && gb.text.includes('CREW GOAL') && gb.text.includes(words) && gb.text.includes(`${PROG} / ${GOAL.target}`), gb && gb.text.slice(0, 120));
    check(`${label}: the bar is ${Math.round((100 * PROG) / GOAL.target)}% full`, gb && Math.abs(gb.fill - (100 * PROG) / GOAL.target) <= 3, gb && String(gb.fill));
    check(`${label}: who played this week, by initials and title only (AL · TEMP from this page, BO · INTERN)`, gb && gb.chips.includes('AL · TEMP') && gb.chips.includes('BO · INTERN') && !gb.text.includes('ALICE') && !gb.text.includes('BOB'), gb && gb.chips.join(','));
    check(`${label}: what it pays, said up front`, gb && gb.text.includes(`+${GOAL_PAY.xp} XP +${GOAL_PAY.sticks} STICKS`), gb && gb.text.slice(-140));
    check(`${label}: Employee of the Month: AL with ${EW} crew wins in ${monthName(monthOf())}`, gb && gb.text.includes('EMPLOYEE OF THE MONTH') && gb.text.includes('AL · TEMP') && gb.text.includes(`${EW} CREW WINS IN ${monthName(monthOf())}`), gb && gb.text.slice(-90));
    check(`${label}: and ALICE's row in the standings has the star`, gb && /★\s*ALICE/.test(gb.star), gb && gb.star);
    check(`${label}: the goal box is plain: no glow, square corners`, gb && gb.glow === 0 && gb.round === 0, gb && `${gb.glow} glowing, ${gb.round} rounded`);
    check(`${label}: nothing names a worst, a bottom or a last place`, !/WORST|BOTTOM|LAST PLACE|LOSER|SLACK/.test(await tableText(p)));
    check(`${label}: the standings with the goal are on the screen`, !(await onScreen(p)), await onScreen(p));
    await sleep(500); await shot(p, `lobby-standings-${label}`);
    await tab(p, 'arcade');
    const ar = await until(async () => { const t = await tableText(p); return /SCO/.test(t) && /ABC/.test(t) ? t : null; });
    check(`${label}: ARCADE shows the crew's table, best first, with the fighter and stage`, ar && ar.indexOf('SCO') < ar.indexOf('ABC') && /151,000/.test(ar) && /THE MANAGER/.test(ar), (ar || '').replace(/\s+/g, ' ').slice(0, 140));
    check(`${label}: ARCADE is on the screen`, !(await onScreen(p)), await onScreen(p));
    await sleep(300); await shot(p, `lobby-arcade-${label}`);
    await tab(p, 'horde');
    const hz = await until(async () => { const t = await tableText(p); return /BOB/.test(t) && /KIX/.test(t) ? t : null; });
    check(`${label}: HORDE shows the crew's horde table`, !!hz, (hz || '').replace(/\s+/g, ' ').slice(0, 100));
    await tab(p, 'stats');
    const st = await until(async () => { const t = await tableText(p); return /PLAYED/.test(t) ? t : null; });
    const flat = (st || '').replace(/\s+/g, ' ');
    // (after the desktop's goal-meeting match, one more: 621 s, COURIER 3 of 4 against INTERN)
    const X = EW > 3 ? { t: '10M', n: 6, c: 5, mu: 'COURIER 75% INTERN 4' } : { t: '9M', n: 5, c: 4, mu: 'COURIER 67% INTERN 3' };
    check(`${label}: STATS: time played (${X.t}) and matches`, flat.includes(`${X.t} PLAYED`) && flat.includes(`${X.n} MATCHES`), flat.slice(0, 80));
    check(`${label}: STATS: most picked, each player's time and favorite, the crew's matchups`, /MOST PICKED/.test(flat) && flat.includes(`COURIER ${X.c}`) && flat.includes(`ALICE ${X.t} COURIER`) && /MATCHUPS/.test(flat) && flat.includes(X.mu), flat.slice(0, 260));
    check(`${label}: STATS is on the screen`, !(await onScreen(p)), await onScreen(p));
    const f = await minFont(p);
    check(`${label}: the stats' smallest text is ${f} px`, f >= (label === 'desktop' ? 12 : 6), String(f));
    await sleep(300); await shot(p, `lobby-stats-${label}`);
    if (label === 'desktop') {
      await tab(p, 'standings');
      // meet the goal: a target one past where it stands, then ALICE (this page's member) wins one more
      await post(`crews/${slug}/dev-goal`, { target: PROG + 1, kind: GOAL.kind });
      const before = await p.evaluate(() => JSON.parse(localStorage.getItem('stick-fight-career') || '{}'));
      await seedMatch();
      const met = await until(async () => { const g = await goalBox(p); return g && g.text.includes('CREW GOAL MET') ? g : null; }, 10000);
      check('desktop: met: the box says CREW GOAL MET and the bar is full', met && met.fill >= 99, met && met.text.slice(0, 100));
      const status = await until(() => p.evaluate(() => { const t = document.querySelector('.fl-crewstatus').innerText; return /CREW GOAL MET/.test(t) ? t : null; }), 6000);
      check('desktop: the status line says what it paid', status && status.includes(`+${GOAL_PAY.xp} XP`) && status.includes(`+${GOAL_PAY.sticks} STICKS`), status);
      await shot(p, 'lobby-goal-met-desktop');
      const after = await p.evaluate(() => JSON.parse(localStorage.getItem('stick-fight-career') || '{}'));
      const s0 = (before.career && before.career.sticks) || 0, x0 = (before.career && before.career.xp) || 0;
      check('desktop: the guest page added +150 sticks and +100 XP to its own career, keyed to the crew and week', after.career && after.career.sticks - s0 === GOAL_PAY.sticks && after.career.xp - x0 === GOAL_PAY.xp && (after.crewPaid || []).includes(`${slug}:${weekOf()}`), JSON.stringify([s0, after.career && after.career.sticks, after.crewPaid]));
      await p.reload(); await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
      await p.evaluate(() => { let last = performance.now(), k = 0; window.__pump = setInterval(() => { const now = performance.now(), ms = Math.min(100, now - last); last = now; if (++k % 12 === 0) window.__gauntlet.step(ms); else window.__game.advance(ms); }, 8); });
      await until(async () => (await flow(p)) === 'crewLobby'); await sleep(1500);
      const again = await p.evaluate(() => JSON.parse(localStorage.getItem('stick-fight-career') || '{}'));
      GOAL.target = PROG + 1; PROG += 1; EW += 1;   // the sizes after this see it met
      check('desktop: reloading the lobby pays nothing more', again.career && again.career.sticks === after.career.sticks, `${after.career && after.career.sticks} -> ${again.career && again.career.sticks}`);
    }
    check(`${label}: no page errors`, !p.errors.length, p.errors.join(' | ').slice(0, 200));
    await closeAll();
  }

  // ---- a run that only makes the crew's table ----
  if (LAYOUT_ONLY) throw Object.assign(new Error('layout only'), { quiet: true });
  const carol = crypto.randomBytes(16).toString('hex');
  const local = JSON.stringify({ arcade: [], horde: [1, 2, 3, 4, 5].map((i) => ({ name: 'TOP', score: 900000 - i, note: '9 FLOORS' })) });
  const p = await page(`${BASE}crew/${slug}`, { ...profileOf(carol, 'CAROL'), 'stick-fight-scores': local }, { width: 1280, height: 720 }, false);
  check('run: CAROL opens the crew link (a member now)', await until(async () => (await flow(p)) === 'crewLobby'));
  await p.evaluate(() => { const d = window.__flow.debug; d.go('modeSelect'); d.sel.player = 'chef'; d.startHorde(); });
  await until(async () => (await flow(p)) === 'fighting');
  await p.evaluate(() => { const d = window.__flow.debug; d.go('result'); d.run.score = 15500; d.run.floors = 2; d.decide(); });
  check('run: GAME OVER', await until(async () => (await flow(p)) === 'gameOver'));
  await sleep(1500);
  await p.evaluate(() => window.__flow.debug.afterGame());
  check('run: a score that misses this device\'s table but makes the crew\'s goes to the initials', await until(async () => (await flow(p)) === 'enterInitials', 5000), await flow(p));
  const label = await p.evaluate(() => document.querySelector('.fl-initials').innerText.replace(/\s+/g, ' '));
  check('run: the initials screen says where: LUNCH CREW, 2ND PLACE, and that it goes to the crew', /LUNCH CREW · 2ND PLACE/.test(label) && /ALSO GOES TO LUNCH CREW/.test(label), label.slice(0, 120));
  await shot(p, 'run-initials');
  await p.keyboard.type('ZED');
  await p.evaluate(() => [...document.querySelectorAll('.fl-key')].find((k) => k.textContent === 'ENTER').click());
  check('run: on to the crew\'s table', await until(async () => (await flow(p)) === 'highScores'));
  const landed = await until(() => p.evaluate(() => { const s = document.querySelector('.fl-scores'); const n = s && s.querySelector('.fl-new'); return n && /ZED/.test(s.innerText) ? s.innerText.replace(/\s+/g, ' ') : null; }), 10000);
  check('run: LUNCH CREW · HORDE with ZED highlighted in 2nd', landed && /LUNCH CREW · HORDE/.test(landed) && /2 ZED( · TEMP)? 15,500 CHEF 2 FLOORS/.test(landed), (landed || '').slice(0, 160));
  await sleep(300); await shot(p, 'run-crew-table');
  const board = await (await fetch(`${API}crews/${slug}/scores`)).json();
  check('run: the crew\'s horde table has it, from the server', board.horde.some((r) => r.initials === 'ZED' && r.score === 15500 && r.char === 'chef' && r.reach === 2));
  check('run: this device\'s horde table didn\'t change', await p.evaluate(() => window.__flow.debug.scores.table('horde').every((r) => r.name === 'TOP')));
  const seq = await p.evaluate(() => window.__flow.debug.attractTables());
  check('attract: the tables turn through this device\'s and then the crew\'s (LUNCH CREW · ARCADE, · HORDE)', seq.length === 4 && seq[2].crew && seq[2].mode === 'arcade' && seq[3].mode === 'horde', JSON.stringify(seq));
  check('run: no page errors', !p.errors.length, p.errors.join(' | ').slice(0, 200));
  await closeAll();
} catch (e) {
  if (!e.quiet) throw e;
} finally {
  await closeAll();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} of ${results.length} passed`);
process.exit(failed ? 1 : 0);
