#!/usr/bin/env node
// A run or a match cut short still counts (README, Analytics, Match bookkeeping): `npm run test:books`.
//
//   unit   src/bookkeeping.js on a stand-in sim: cut sends once, a fragment under MIN_FIGHT_SECS sends nothing, end
//          after a cut sends nothing, hide keeps the match in storage and show takes it back, and sendLeftovers sends
//          a gone page's leftover once and leaves a live page's alone
//   flow   headless Chromium on the raw source, the real flow (play/index.html) with analytics forced on and
//          navigator.sendBeacon caught, so what's checked is exactly what would go to api/e:
//     1. horde: a run that clears floor 1 and is quit from the pause menu (MAIN MENU) sends exactly one `match`
//        event, stage >= 1 and secs > 0, no quit flag; the title and a new menu trip after it send nothing more;
//        the horde high score table doesn't change
//     2. horde: a run quit 1 s after FIGHT sends nothing (menu bouncing)
//     3. horde: the tab closing (pagehide) mid-run sends one `match`; a second pagehide (back from the bfcache
//        and closed again) sends nothing more
//     4. horde: a hidden tab keeps the run in localStorage and sends nothing; visible again, it's gone; a second
//        page opened while the first is hidden doesn't send the first one's run (its lock is held)
//     5. arcade: RESTART STAGE after some fighting sends one `match` with quit: 1, the rounds so far and secs > 0; MAIN
//        MENU from the restarted stage sends one more
// Exit code 1 on any failure.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
import { createBook, sendLeftovers, MIN_FIGHT_SECS } from '../../src/bookkeeping.js';

const results = [];
const ok = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });

// ---- unit ---------------------------------------------------------------------------------------
{
  const mem = () => { const m = new Map(); return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
  const sim = { stepCount: 0, phase: 'intro', wins: [0, 0], units: [{ id: 0, char: { id: 'courier' }, health: 100 }, { id: 1, char: { id: 'temp' }, health: 100 }], horde: { floorsCleared: 0 } };
  const sent = [], store = mem();
  const book = createBook(sim, { send: (ev) => sent.push(ev), store, page: 'aaaa' });
  const fight = (secs) => { book.event({ type: 'fight' }); sim.stepCount += secs * 120; };
  book.begin({ mode: 'horde' }); fight(3); book.cut();
  ok('unit: a horde run cut 3 s after FIGHT sends nothing', sent.length === 0, JSON.stringify(sent));
  sim.stepCount = 0; book.begin({ mode: 'horde' }); sim.stepCount = 20 * 120; book.cut();
  ok('unit: before the first FIGHT nothing counts, however long the intro', sent.length === 0, JSON.stringify(sent));
  sim.stepCount = 0; sim.horde.floorsCleared = 2; book.begin({ mode: 'horde' }); fight(40); book.cut(); book.cut(); book.end();
  const m = sent.flat().filter((e) => e.e === 'match');
  ok('unit: a horde run cut after 40 s sends one match (cut twice, then end, still one)', m.length === 1 && m[0].m.stage === 2 && m[0].m.secs === 40 && !m[0].m.quit, JSON.stringify(m));
  sent.length = 0; sim.stepCount = 0; sim.wins = [1, 0]; book.begin({ mode: 'arcade', stage: 3, level: 0.4 }); fight(30); book.cut();
  const a = sent.flat().find((e) => e.e === 'match');
  ok('unit: an arcade stage cut short sends quit: 1 with the rounds so far', a && a.m.quit === 1 && a.m.wins[0] === 1 && a.m.stage === 3 && a.m.how === 'ko' && a.m.move === '', JSON.stringify(a));
  sent.length = 0; sim.stepCount = 0; sim.wins = [2, 0]; book.begin({ mode: 'arcade', stage: 3 }); fight(30); book.end();
  const e = sent.flat().find((x) => x.e === 'match');
  ok('unit: an arcade stage that ends carries no quit flag', e && !('quit' in e.m), JSON.stringify(e));
  sent.length = 0; sim.stepCount = 0; book.begin({ mode: 'quick', local: 1 }); fight(30); book.cut();
  ok('unit: an online match cut short sends no match event (the room keeps its time)', !sent.flat().some((x) => x.e === 'match'), JSON.stringify(sent));
  sent.length = 0; sim.stepCount = 0; book.begin({ mode: 'horde' }); fight(30); book.hide();
  ok('unit: hide keeps the run in storage and sends nothing', store.m.has('stick-fight-book-aaaa') && sent.length === 0);
  book.show();
  ok('unit: show takes it back', !store.m.has('stick-fight-book-aaaa'));
  book.hide();
  const n1 = await sendLeftovers({ send: (ev) => sent.push(ev), store, held: ['stick-fight-book:aaaa'] });
  ok('unit: a leftover from a page still open (lock held) isn\'t sent', n1 === 0 && sent.length === 0 && store.m.has('stick-fight-book-aaaa'));
  const n2 = await sendLeftovers({ send: (ev) => sent.push(ev), store, held: [] });
  const n3 = await sendLeftovers({ send: (ev) => sent.push(ev), store, held: [] });
  ok('unit: a gone page\'s leftover is sent once', n2 === 1 && n3 === 0 && sent.flat().filter((x) => x.e === 'match').length === 1 && !store.m.has('stick-fight-book-aaaa'), `${n2} ${n3}`);
  store.setItem('stick-fight-book-old', JSON.stringify({ page: 'old', at: Date.now() - 3 * 86400e3, events: [{ e: 'match', m: {} }] }));
  sent.length = 0; await sendLeftovers({ send: (ev) => sent.push(ev), store, held: [] });
  ok('unit: a leftover days old is dropped, not sent', sent.length === 0 && !store.m.has('stick-fight-book-old'));
  ok('unit: MIN_FIGHT_SECS is 5', MIN_FIGHT_SECS === 5);
}

// ---- flow ---------------------------------------------------------------------------------------
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glsl': 'text/plain' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const URL0 = `http://127.0.0.1:${server.address().port}/play/index.html`;
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
// analytics on (localhost's switch, README Analytics, Checking it locally), and every beacon caught instead of sent
await context.addInitScript(() => {
  try { localStorage.setItem('stick-fight-track', '1'); } catch { /* */ }
  window.__beacons = [];
  navigator.sendBeacon = (url, blob) => { blob.text().then((t) => { try { window.__beacons.push(JSON.parse(t)); } catch { /* */ } }); return true; };
});
const errors = [];
async function open() {
  const pg = await context.newPage();
  pg.on('pageerror', e => errors.push(String(e)));
  await pg.goto(URL0, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => window.__flow && window.__game, null, { timeout: 30000 });
  return pg;
}
// in the page: helpers on window
const HELPERS = () => {
  window.__t = {
    wait: (ms) => new Promise(r => setTimeout(r, ms)),
    matches: () => window.__beacons.flatMap((b) => (Array.isArray(b) ? b : [b])).filter((e) => e && e.e === 'match'),
    async horde() {
      const F = window.__flow, sim = window.__game.sim;
      F.debug.go('modeSelect'); F.debug.sel.player = 'temp'; F.debug.startHorde();
      for (let i = 0; i < 200 && sim.phase !== 'fight'; i++) await this.wait(50);
    },
    /** the pause menu's MAIN MENU, pressed the way a player would (its button) */
    async quit(label = 'MAIN MENU') {
      const F = window.__flow;
      F.debug.go('paused'); await this.wait(300);
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === label && x.offsetParent);
      if (!b) return `no ${label} button`;
      b.click(); await this.wait(500);
      return F.state;
    },
  };
};

// 1. horde: clear floor 1, quit from the pause menu
{
  const pg = await open(); await pg.evaluate(HELPERS);
  const r = await pg.evaluate(async () => {
    const T = window.__t, g = window.__game, sim = g.sim;
    const scores0 = localStorage.getItem('stick-fight-scores');
    await T.horde();
    g.installHordeKo({});
    // the scripted hero's first five KOs clear floor 1; quit before its sixth phase (a goon KOs the hero)
    for (let i = 0; i < 1200 && !(g.hordeKoTest.results.length >= 5); i++) await T.wait(50);
    const floors = sim.horde ? sim.horde.floorsCleared : -1, secs = sim.stepCount / 120;
    const state = await T.quit();
    await T.wait(800);
    const after = T.matches().length;
    window.__flow.debug.go('attract'); await T.wait(500); window.__flow.debug.go('modeSelect'); await T.wait(500);
    return { floors, secs, state, after, m: T.matches(), scoresSame: localStorage.getItem('stick-fight-scores') === scores0, flow: window.__flow.state };
  });
  ok('horde quit: the run cleared a floor and the pause menu MAIN MENU left it', r.floors >= 1 && r.state === 'modeSelect', `floors ${r.floors}, ${r.secs.toFixed(1)} s, flow ${r.state}`);
  const m = r.m[0] && r.m[0].m;
  ok('horde quit: exactly one match event, stage >= 1, secs > 0', r.m.length === 1 && m.mode === 'horde' && m.stage >= 1 && m.secs > 0 && !m.quit, JSON.stringify(r.m));
  ok('horde quit: the menus after it send nothing more', r.after === 1 && r.m.length === 1, `${r.after} then ${r.m.length}`);
  ok('horde quit: the run never reaches a high score table', r.scoresSame);
  await pg.close();
}
// 2. a run quit right after FIGHT
{
  const pg = await open(); await pg.evaluate(HELPERS);
  const r = await pg.evaluate(async () => { const T = window.__t; await T.horde(); await T.wait(1000); const s = await T.quit(); await T.wait(800); return { s, m: T.matches() }; });
  ok('horde bounce: a run quit 1 s in sends nothing', r.m.length === 0 && r.s === 'modeSelect', `${r.s} ${JSON.stringify(r.m)}`);
  await pg.close();
}
// 3. the tab closing
{
  const pg = await open(); await pg.evaluate(HELPERS);
  const r = await pg.evaluate(async () => {
    const T = window.__t; await T.horde(); await T.wait(7000);
    dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); await T.wait(500);
    const first = T.matches().length;
    dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })); await T.wait(500);
    return { first, m: T.matches() };
  });
  ok('tab close: pagehide mid-run sends the run once', r.first === 1 && r.m.length === 1 && r.m[0].m.secs > 0, JSON.stringify(r.m));
  await pg.close();
}
// 4. a hidden tab, and a second page while it's hidden
{
  const pg = await open(); await pg.evaluate(HELPERS);
  const r = await pg.evaluate(async () => {
    const T = window.__t; await T.horde(); await T.wait(7000);
    const setHidden = (h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); };
    const kept = () => Object.keys(localStorage).filter((k) => k.startsWith('stick-fight-book-'));
    setHidden(true); await T.wait(200);
    const hiddenKeys = kept(), hiddenSent = T.matches().length;
    setHidden(false); await T.wait(200);
    const backKeys = kept();
    setHidden(true); await T.wait(200);
    return { hiddenKeys, hiddenSent, backKeys, again: kept() };
  });
  ok('hidden tab: the run is kept in localStorage and nothing is sent', r.hiddenKeys.length === 1 && r.hiddenSent === 0, JSON.stringify(r));
  ok('hidden tab: visible again, the kept copy is gone', r.backKeys.length === 0);
  const pg2 = await open();
  await pg2.waitForTimeout(1500);
  const r2 = await pg2.evaluate(() => ({ m: window.__beacons.flatMap((b) => (Array.isArray(b) ? b : [b])).filter((e) => e && e.e === 'match'), keys: Object.keys(localStorage).filter((k) => k.startsWith('stick-fight-book-')) }));
  ok('hidden tab: a second page doesn\'t send the hidden page\'s run (its lock is held)', r2.m.length === 0 && r2.keys.length === 1, JSON.stringify(r2));
  await pg2.close(); await pg.close();
}
// 5. arcade: RESTART STAGE mid-stage
{
  const pg = await open(); await pg.evaluate(HELPERS);
  const r = await pg.evaluate(async () => {
    const T = window.__t, F = window.__flow, sim = window.__game.sim;
    F.debug.go('modeSelect'); F.debug.sel.player = 'temp'; F.debug.startArcade();
    for (let i = 0; i < 200 && !(F.state === 'fighting' && sim.phase === 'fight'); i++) await T.wait(50);
    await T.wait(7000);
    const secs = sim.stepCount / 120;
    const s = await T.quit('RESTART STAGE');
    for (let i = 0; i < 200 && !(F.state === 'fighting' && sim.phase === 'fight'); i++) await T.wait(50);
    await T.wait(500);
    const restarted = T.matches().length;
    await T.wait(6500);
    const s2 = await T.quit('MAIN MENU'); await T.wait(800);
    return { secs, s, s2, restarted, m: T.matches(), flow: F.state, hist: F.debug.history.slice(-8) };
  });
  const m = r.m && r.m[0] && r.m[0].m;
  ok('arcade quit: RESTART STAGE mid-stage sends one match with quit: 1 and secs > 0', r.restarted === 1 && m && m.mode === 'arcade' && m.quit === 1 && m.secs > 0 && Array.isArray(m.wins), JSON.stringify(r).slice(0, 400));
  const m2 = r.m && r.m[1] && r.m[1].m;
  ok('arcade quit: then MAIN MENU on the restarted stage sends its own one, quit: 1', r.m && r.m.length === 2 && m2.quit === 1 && m2.secs > 0 && r.s2 === 'modeSelect', JSON.stringify(r.m && r.m[1]));
  await pg.close();
}
await browser.close(); server.close();
ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

let fail = 0;
for (const r of results) { if (!r.pass) fail++; console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? `  (${r.detail})` : ''}`); }
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
