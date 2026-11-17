// Spectators, end to end (README, Multiplayer, Spectators): real browsers through the local Worker.
//
//   npm run build && npx wrangler dev --port 8787      (the Worker serving dist/ and the API)
//   node scripts/watch/e2e.mjs [http://127.0.0.1:8787/] [--shots dir] [--only quick|menus|line|crew] [--gpu]
//
// A host and a guest (each its own Chromium, scripted inputs, 30-second single-round matches) play in a quick
// room while spectators come and go: one from before the first frame, one mid-match, one who reloads, one who
// arrives for the rematch. It checks every 30th frame's state hash on each spectator against the host's
// confirmed hash, the LIVE list, the players' WATCHING readout, the host's off switch, the host leaving
// mid-match, a crew's line watching its match (Champ of the Court: only members in line, with the crew's ticket),
// a crew room (refuses a bare spectator, never listed) and the join limit. Exit code 1 on any failure.
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const BASE = (argv.find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/').replace(/\/?$/, '/');
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : '';
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : '';   // quick | menus | line | crew: one part of the run
// --gpu: draw on the machine's GPU (Metal on a Mac), as a phone does, instead of SwiftShader. Software GL takes 90 to
// 750 ms a draw on a busy machine; those stalls hold up the host's batches, and every spectator's buffer grows to
// ride them out, so the latency check measures the software renderer rather than the network (README, Spectators)
const GPU = argv.includes('--gpu');
const GL = GPU ? (process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--ignore-gpu-blocklist'])
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const part = (name) => !ONLY || ONLY.split(',').includes(name);
const API = BASE + 'api/', WS = API.replace(/^http/, 'ws');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const SLOW = +(process.env.E2E_SLOW || 1);   // a busy machine: stretch every wait
const until = async (fn, ms0 = 20000, every = 200) => { const ms = ms0 * SLOW; return until0(fn, ms, every); };
const until0 = async (fn, ms = 20000, every = 200) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };

const browsers = [];
async function page(url, init = {}, size = { width: 1280, height: 720 }, touch = false) {
  const b = await chromium.launch({ executablePath, args: [...GL, '--mute-audio'] });
  browsers.push(b);
  const ctx = await b.newContext(touch ? { viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: size });
  await ctx.addInitScript((kv) => {
    for (const k in kv) localStorage.setItem(k, kv[k]);
    // every socket the page opens, so a test can pull one out from under it
    const W = window.WebSocket; window.__sockets = [];
    window.WebSocket = class extends W { constructor(...a) { super(...a); window.__sockets.push(this); } };
  }, init);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) p.errors.push(m.text()); });
  await p.goto(url);
  await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
  await drive(p, size.width >= 800 ? 12 : 0);
  return p;
}
// Headless Chromium draws with software GL, and on a busy machine that starves the frame loop until a match
// crawls. So each page is pumped from a timer instead (the game's own advance(), every 8 ms of real time), and
// draws only now and then (every `draw` ticks; 0: never). The sockets, the netcode, the room and the menus
// are all the real thing.
const drive = (p, draw) => p.evaluate((n) => {
  window.__gauntlet.step(0);
  let last = performance.now(), k = 0;
  clearInterval(window.__pump);
  // what showed when, by the wall clock all the pages share (performance.timeOrigin + now): the host's frames, and
  // each spectator's, so the run can say how long a frame takes from the host's screen to a spectator's
  const L = window.__lat = window.__lat || { host: {}, spec: [] };
  const rec = () => {
    const t = performance.timeOrigin + performance.now(), net = window.__net, w = window.__watch;
    const ls = net && net.active && net.netcode;
    if (ls) { const h = L.host[net.match] = L.host[net.match] || { f: [], t: [] }; if (!h.f.length || ls.frame > h.f[h.f.length - 1]) { h.f.push(ls.frame); h.t.push(t); } }
    if (w && w.active && !w.catching && w.state === 'live') { const v = w.view(); if (v.frame > (L.lastF || 0) || v.n !== L.lastN) { L.lastF = v.frame; L.lastN = v.n; L.spec.push([v.n, v.frame, t]); } }
  };
  // (lost: the time the pump didn't hand the game because a pass took over 100 ms, as main.js caps a frame; drawMs: the drawn passes)
  L.lost = L.lost || 0; L.wall = L.wall || 0; L.drawMs = L.drawMs || 0; L.draws = L.draws || 0;
  window.__pump = setInterval(() => { const now = performance.now(), ms = Math.min(100, now - last); L.lost += now - last - ms; L.wall += now - last; last = now; if (n && ++k % n === 0) { const t0 = performance.now(); window.__gauntlet.step(ms); L.drawMs += performance.now() - t0; L.draws++; } else window.__game.advance(ms); rec(); }, 8);
}, draw);
// the host's frames against a spectator's: ms from the frame showing on the host to the same frame on the spectator
const pct = (a, p) => { if (!a.length) return NaN; const b = Float64Array.from(a).sort(); return Math.round(b[Math.min(b.length - 1, Math.floor(b.length * p / 100))]); };
async function latency(host, spec, fromT = 0) {
  const h = await host.evaluate(() => window.__lat.host), s = await spec.evaluate(() => window.__lat.spec);
  const out = [];
  for (const [n, f, t] of s) {
    const hh = h[n];
    if (!hh || t < fromT || hh.f[hh.f.length - 1] < f) continue;
    let lo = 0, hi = hh.f.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (hh.f[mid] >= f) hi = mid; else lo = mid + 1; }
    out.push(t - hh.t[lo]);
  }
  return out;
}
const latRows = [];
async function reportLatency(label, host, spec, fromT = 0) {
  const a = await latency(host, spec, fromT).catch(() => []);
  // LAT_TRACE=1: the worst latency in each second of the watching, to see where a tail comes from
  if (process.env.LAT_TRACE) { const h = await host.evaluate(() => window.__lat.host), sp = await spec.evaluate(() => window.__lat.spec); const t0 = sp.length ? sp[0][2] : 0; const by = {}; let i = 0; for (const [n, f, t] of sp) { const hh = h[n]; if (!hh || hh.f[hh.f.length - 1] < f) continue; const sec = n + ':' + Math.floor((t - t0) / 1000); (by[sec] = by[sec] || []).push(a[i++]); } console.log('TRACE', label, Object.entries(by).map(([k, v]) => k + '=' + Math.round(Math.max(...v))).join(' ')); }
  const pg = await spec.evaluate(() => { const L = window.__lat; return { lost: L.lost, wall: L.wall, drawMs: L.draws ? L.drawMs / L.draws : 0 }; }).catch(() => ({ lost: 0, wall: 1, drawMs: 0 }));
  latRows.push({ label, a, pg });
  const p50 = pct(a, 50), p95 = pct(a, 95);
  check(`${label}: a frame reaches the spectator's screen under 300 ms after the host's (median) and under 450 ms at the 95th percentile`, a.length > 200 && p50 < 300 && p95 < 450, `${a.length} frames, median ${p50} ms, 95th ${p95} ms`);
}
// (a picture is a nicety: on a busy machine headless Chromium can take its time over one, and the run goes on)
const shot = async (p, name) => { if (SHOTS) await p.evaluate(() => window.__gauntlet && window.__gauntlet.step(0)).catch(() => {}); if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png`, timeout: 90000 }).catch((e) => console.log(`      (no picture ${name}: ${String(e).split('\n')[0]})`)); };
const live = async () => (await (await fetch(API + 'live?' + Date.now())).json()).live;
// the LIVE list is cached for a few seconds: wait for it to say what's expected
const liveUntil = (fn, ms = 12000) => until(async () => { const l = await live(); return fn(l) ? l : null; }, ms, 700);

// a player's page: a ?scene= page (no menus: the room starts the match as soon as both are in), scripted inputs
const RULES = { 'stick-fight-round-time': '30', 'stick-fight-best-of': '1' };
async function player(name, script, size) {
  const p = await page(BASE + 'play/?scene=attract&tier=1', RULES, size);
  await p.evaluate(([nm, k]) => {
    window.__net.setName(nm);
    // walk at each other and throw limbs on a fixed beat (a function of the frame alone, so every run is the same fight)
    window.__net.setLocalSource((f) => ({ dx: (f % 240) < 150 ? k : (f % 240) < 190 ? 0 : -k, jump: f % 331 < 2, block: f % 97 > 80, down: false, run: false,
      lp: f % (23 + k) < 3, rp: f % 41 < 3, lk: f % (59 - k) < 3, rk: f % 83 < 3, touch: false }));
  }, [name, script]);
  return p;
}
const SMALL = { width: 640, height: 360 };   // pages nobody takes a picture of draw small (software GL is the cost here)
const spectator = (code, size) => page(`${BASE}play/?watch=${code}${size ? '&tier=1' : ''}`, {}, size);
const wstats = (p) => p.evaluate(() => ({ ...window.__watch.stats(), view: window.__watch.view(), flow: window.__flow.state, text: (document.querySelector('.fl-watch') || {}).textContent || '' }));
// every 30th frame's hash: the host's confirmed ones, and each spectator's own
const hostHashes = new Map(), specHashes = new Map();
async function collect(host, specs) {
  const h = await host.evaluate(() => { const ls = window.__net.netcode; return ls ? { n: window.__net.match, list: [...ls.hashes].filter(([f]) => f <= ls.confirmed) } : null; }).catch(() => null);
  if (h) for (const [f, v] of h.list) hostHashes.set(`${h.n}:${f}`, v);
  for (const [name, p] of Object.entries(specs)) {
    const s = await p.evaluate(() => ({ n: window.__watch.view().n, list: [...window.__watch.hashes] })).catch(() => null);
    if (!s || !s.n) continue;
    if (!specHashes.has(name)) specHashes.set(name, new Map());
    for (const [f, v] of s.list) specHashes.get(name).set(`${s.n}:${f}`, v);
  }
}
function compare(label) {
  for (const [name, m] of specHashes) {
    let n = 0, bad = 0;
    for (const [k, v] of m) { const h = hostHashes.get(k); if (h == null) continue; n++; if (h !== v) bad++; }
    check(`${label}: ${name}'s state hash matches the host's on every shared confirmed frame`, n > 0 && bad === 0, `${n} frames compared, ${bad} differ`);
  }
}

const sock = (url) => new Promise((resolve) => {
  const ws = new WebSocket(url), got = [];
  const o = { ws, got, closed: null, next: (pred, ms = 6000) => until(async () => got.find(pred), ms, 50) };
  ws.onmessage = (e) => { if (typeof e.data === 'string') { try { got.push(JSON.parse(e.data)); } catch { got.push({ raw: e.data }); } } };
  ws.onclose = (e) => { o.closed = e.code; };
  ws.onopen = () => resolve(o); ws.onerror = () => resolve(o);
});
try {
  // the last part of a run uses up this IP's joins for a minute on purpose: a run right after it waits that out
  for (let i = 0; i < 40; i++) { const s = await sock(`${WS}rooms/ZZZZ/watch`); const m = await s.next((x) => x.t === 'sys', 3000); try { s.ws.close(); } catch { /* closed */ } if (!m || m.reason !== 'busy') break; if (!i) console.log('      (waiting out the join limit from an earlier run)'); await sleep(5000); }
  await sleep(SLOW * 1000);
  if (part('quick')) {
  // ---- 1. a quick room: one spectator before the first frame, one mid-match ----------------------------------
  const H = await player('ALICE', 1);
  const code = (await H.evaluate(() => window.__net.host().then((o) => o.code)));
  check('host opened a quick room', /^[A-Z0-9]{4}$/.test(code), code);
  const S1 = await spectator(code);
  const w0 = await until(async () => { const s = await wstats(S1); return s.state === 'waiting' ? s : null; });
  check('a spectator can come in before the match: NO MATCH ON YET', !!w0 && /NO MATCH ON YET/.test(w0.text), w0 ? w0.text.slice(0, 60) : 'never connected');
  await shot(S1, '1-waiting');
  check('LIVE list is empty before a match starts', (await live()).every((r) => r.code !== code));
  const G = await player('BOB', -1, SMALL);
  await G.evaluate((c) => window.__net.join(c), code);
  check('the match started on both players', !!(await until(() => H.evaluate(() => window.__net.active))) && !!(await until(() => G.evaluate(() => window.__net.active))));
  const specs = { S1 };
  const s1live = await until(async () => { await collect(H, specs); const s = await wstats(S1); return s.state === 'live' && s.frame > 30 ? s : null; }, 30000);
  check('the first spectator is watching from the first frame', !!s1live && s1live.flow === 'watching', s1live ? `frame ${s1live.frame}, ${s1live.text.slice(0, 50)}` : JSON.stringify(await wstats(S1)).slice(0, 200));
  const l1 = await liveUntil((l) => l.some((r) => r.code === code && r.watching === 1), 25000);
  const e1 = l1 && l1.find((r) => r.code === code);
  check('LIVE list has the match: code, fighters, names, round, score, spectators, start', !!e1 && e1.names.join() === 'ALICE,BOB' && e1.chars.length === 2 && e1.round >= 1 && e1.wins.length === 2 && e1.watching === 1 && e1.at > 0, JSON.stringify(e1));
  check('the players see WATCHING 1', !!(await until(() => H.evaluate(() => /WATCHING 1/.test(document.querySelector('.nf-watch').textContent)))) && !!(await until(() => G.evaluate(() => /WATCHING 1/.test(document.querySelector('.nf-watch').textContent)))));
  await sleep(6000); await collect(H, specs);
  const S2 = await spectator(code, SMALL); specs.S2 = S2;
  const s2 = await until(async () => { await collect(H, specs); const s = await wstats(S2); return s.state === 'live' ? s : null; }, 20000);
  check('a second spectator joins mid-match, catches up and goes live', !!s2 && s2.totals.catchFrames > 200, s2 ? `frame ${s2.frame}, caught up ${s2.totals.catchFrames} frames in ${s2.totals.catchMs.toFixed(0)} ms` : JSON.stringify(await wstats(S2)).slice(0, 200));
  check('both spectators show N WATCHING', !!(await until(async () => /2 WATCHING/.test((await wstats(S1)).text) && /2 WATCHING/.test((await wstats(S2)).text))), (await wstats(S1)).text.slice(0, 60));
  check('the players see WATCHING 2', !!(await until(() => H.evaluate(() => /WATCHING 2/.test(document.querySelector('.nf-watch').textContent)))));
  await shot(S1, '2-watching-live'); await shot(H, '2-host-readout');
  // the LIVE list in the game's own menu, and on the homepage
  const M = await page(BASE + 'play/');
  await M.evaluate(() => { const f = window.__flow.debug; f.go('modeSelect'); f.go('onlineMenu'); f.go('watchList'); });
  check('the game\'s WATCH menu lists the match', !!(await until(() => M.evaluate(() => /ALICE/.test(document.querySelector('.fl-live').textContent) && /BOB/.test(document.querySelector('.fl-live').textContent) && /WATCHING/.test(document.querySelector('.fl-live').textContent)), 15000)), await M.evaluate(() => document.querySelector('.fl-live').textContent.slice(0, 120)));
  await shot(M, '3-live-list-menu');
  const HP = await (async () => { const b = browsers[browsers.length - 1]; const c = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 }); return p; })();
  const strip = await until(() => HP.evaluate(() => { const s = document.querySelector('[data-live]'); return s && !s.hidden && s.querySelector('a') ? { text: s.textContent, href: s.querySelector('a').getAttribute('href') } : null; }), 45000);
  check('the homepage shows the LIVE NOW strip with a watch link', !!strip && /ALICE/.test(strip.text) && strip.href === `./play/?watch=${code}`, strip ? strip.href : 'hidden');
  if (strip) { await HP.evaluate(() => document.querySelector('[data-live]').scrollIntoView({ block: 'center' })); await sleep(600); await shot(HP, '4-homepage-live-now'); }
  // one leaves and comes back (a reload of the watch link)
  await S2.reload(); await S2.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 }); await drive(S2, 0);
  specHashes.delete('S2');
  const s2b = await until(async () => { await collect(H, specs); const s = await wstats(S2); return s.state === 'live' ? s : null; }, 20000);
  check('a spectator who leaves and comes back picks the match up again', !!s2b, s2b ? `frame ${s2b.frame}` : '');
  // and one whose socket dies under it reconnects by itself, keeping its place
  const before = await wstats(S1);
  const killed = await S1.evaluate(() => { const l = window.__sockets.filter((w) => /\/watch/.test(w.url) && w.readyState === 1); l.forEach((w) => w.close()); return l.length; });
  const s1b = await until(async () => { await collect(H, specs); const s = await wstats(S1); const open = await S1.evaluate(() => window.__sockets.filter((w) => /\/watch/.test(w.url) && w.readyState === 1).length); return open === 1 && s.state === 'live' && (s.view.n > before.view.n || s.frame > before.frame + 240) ? s : null; }, 40000);
  check('a spectator whose connection drops reconnects and carries on from where it was', killed === 1 && !!s1b && s1b.totals.matches === before.totals.matches + (s1b.view.n - before.view.n), s1b ? `match ${before.view.n} frame ${before.frame} -> match ${s1b.view.n} frame ${s1b.frame}, caught up ${s1b.totals.catchFrames - before.totals.catchFrames} frames undrawn` : JSON.stringify(await wstats(S1)).slice(0, 160));
  // ---- 2. the end of the match, and the rematch ---------------------------------------------------------------
  // (the result card is up for a few seconds before the rematch: its picture is taken the moment it shows)
  const resultShot = S1.waitForFunction(() => window.__watch.view().state === 'result' && /WINS|DRAW/.test((document.querySelector('.fl-watch') || {}).textContent || ''), null, { timeout: 120000, polling: 50 })
    .then(async () => { const text = await S1.evaluate(() => document.querySelector('.fl-watch').textContent); await shot(S1, '5-result'); return text; }, () => '');
  const ended = await until(async () => { await collect(H, specs); return H.evaluate(() => window.__net.state === 'post' || window.__net.match >= 2); }, 60000, 500);
  check('the match ended for the players', !!ended);
  const res = await until(async () => { await collect(H, specs); const s = await wstats(S1); return (s.result && /WINS|DRAW/.test(s.text)) || s.view.n >= 2 ? s : null; }, 25000, 100);
  const resultText = await resultShot;
  check('spectators see the result', !!res && /WINS|DRAW/.test(resultText) && /WAITING FOR A REMATCH/.test(resultText), resultText.slice(0, 70));
  const hostEnd = await H.evaluate(() => { const v = window.__net.view(); return v.last ? { hash: v.last.hash, frame: v.last.frame, wins: v.last.wins } : null; });
  if (res && res.result && hostEnd) check('the spectator\'s final state is the players\' final state', res.result.hash === hostEnd.hash && res.result.frame === hostEnd.frame, `${res.result.frame}/${res.result.hash} vs ${hostEnd.frame}/${hostEnd.hash}`);
  check('the match leaves the LIVE list when it ends, and comes back with the rematch', !!(await liveUntil((l) => l.some((r) => r.code === code && r.n >= 2), 60000)));
  const m2 = await until(async () => { await collect(H, specs); const a = await wstats(S1), b = await wstats(S2); return a.view.n >= 2 && a.state === 'live' && b.view.n >= 2 && b.state === 'live' ? a : null; }, 45000);
  check('spectators move on to the room\'s next match', !!m2, m2 ? `match ${m2.view.n}, frame ${m2.frame}` : [S1, S2].map(async (p) => 0) && JSON.stringify([(await wstats(S1)), (await wstats(S2))].map((x) => [x.state, x.detail, x.view.n, x.frame, x.frames])));
  await sleep(5000); await collect(H, specs);
  compare('quick room');
  await reportLatency('quick room, S1 (in before the first frame, drawn)', H, S1);
  await reportLatency('quick room, S2 (mid-match, a reload, undrawn)', H, S2);
  const own = await Promise.all([S1, S2].map((p) => p.evaluate(() => window.__watch.stats().totals)));
  check('the spectators\' own checks against the host\'s hashes all pass', own.every((t) => t.checks > 0 && t.bad === 0), own.map((t) => `${t.checks} checked, ${t.bad} bad`).join('; '));
  // what the upload costs the host: its own timer around the per-frame work, and what it sent
  const fs0 = await H.evaluate(() => window.__net.feed.stats);
  check('the host\'s upload is cheap: under 0.05 ms a frame on average', fs0.ticks > 500 && fs0.ms / fs0.ticks < 0.05, `${(fs0.ms / fs0.ticks * 1000).toFixed(1)} µs a frame over ${fs0.ticks} frames; ${fs0.batches} messages, ${fs0.bytes} bytes`);
  // ---- 3. the host's off switch --------------------------------------------------------------------------------
  await H.evaluate(() => window.__net.setWatchable(false));
  const off = await until(async () => { const a = await wstats(S1), b = await wstats(S2); return a.state === 'error' && a.detail === 'off' && b.detail === 'off' && /SPECTATORS OFF/.test(a.text) ? a : null; }, 15000);
  check('the host turns spectating off: spectators are sent away and told why', !!off && /SPECTATORS OFF/.test(off.text), off ? off.text.slice(0, 60) : JSON.stringify(await wstats(S1)).slice(0, 160));
  await shot(S1, '6-spectators-off');
  const S3 = await spectator(code);
  const refused = await until(async () => { const s = await wstats(S3); return s.state === 'error' && /SPECTATORS OFF/.test(s.text) ? s : null; }, 30000);
  check('joining a room with spectating turned off is refused', !!refused && refused.detail === 'off', refused ? `${refused.detail}: ${refused.text.slice(0, 50)}` : JSON.stringify(await wstats(S3)).slice(0, 200));
  check('a room with spectating off is not in the LIVE list', !!(await liveUntil((l) => l.every((r) => r.code !== code))));
  check('the players\' match went on with nobody watching', await H.evaluate(() => window.__net.active && window.__net.watchers === 0));
  // back on: the same room can be watched again, from the start of the match in progress
  await H.evaluate(() => window.__net.setWatchable(true));
  await S3.goto(`${BASE}play/?watch=${code}`); await S3.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 }); await drive(S3, 12);
  specs.S3 = S3; delete specs.S1; delete specs.S2;
  const again = await until(async () => { await collect(H, specs); const s = await wstats(S3); return s.state === 'live' ? s : null; }, 25000);
  check('turned back on, the match can be watched again', !!again, again ? `match ${again.view.n} frame ${again.frame}` : JSON.stringify(await wstats(S3)).slice(0, 160));
  // ---- 4. the host disconnects mid-match ------------------------------------------------------------------------
  await sleep(1500); await collect(H, specs);
  await H.close();
  const gEnd = await until(() => G.evaluate(() => !window.__net.active && window.__net.state === 'idle'), 20000);
  const sEnd = await until(async () => { const s = await wstats(S3); return (s.state === 'error' || s.state === 'over') && /LEFT/.test(s.text) ? s : null; }, 20000);
  check('the host disconnects mid-match: the guest\'s match ends', !!gEnd);
  check('the host disconnects mid-match: spectators see it end too', !!sEnd && /LEFT/.test(sEnd.text), sEnd ? `${sEnd.state} ${sEnd.detail}: ${sEnd.text.slice(0, 50)}` : JSON.stringify(await wstats(S3)).slice(0, 160));
  await shot(S3, '7-host-left');
  check('a dead room is not in the LIVE list', !!(await liveUntil((l) => l.every((r) => r.code !== code))));
  compare('after the off switch');
  for (const [n, p] of Object.entries({ S1, S2, S3, G, M })) check(`no page errors on ${n}`, p.errors.length === 0, p.errors.slice(0, 2).join(' | '));
  for (const p of [S1, S2, S3, G, M]) await p.context().browser().close().catch(() => {});
  }
  if (part('menus')) {

  // ---- 4b. through the game's own menus: HOST A GAME with the switch, the pick screen, fighters and names --------
  const prof = (name, c) => ({ ...RULES, 'stick-fight-player': JSON.stringify({ id: c.repeat(32), name, email: '', crews: [] }) });
  const FH = await page(BASE + 'play/', prof('NEO', 'a'));
  await FH.evaluate(() => { const f = window.__flow.debug; f.go('modeSelect'); f.go('onlineMenu'); f.go('onlineHost'); });
  const code2 = await until(() => FH.evaluate(() => (window.__net.state === 'waiting' && window.__net.code) || null));
  const sw = () => FH.evaluate(() => (document.querySelector('.fl-spec') || {}).textContent || '');
  check('the host screen has the spectators switch, on by default', /SPECTATORS: ON/.test(await sw()), await sw());
  await shot(FH, '8-host-screen');
  await FH.evaluate(() => document.querySelector('.fl-spec').click());
  check('the switch turns spectating off (and it sticks for the next room)', /SPECTATORS: OFF/.test(await sw()) && await FH.evaluate(() => localStorage.getItem('stick-fight-watch') === '0' && !window.__net.watchable));
  const early = await sock(`${WS}rooms/${code2}/watch`);
  const earlyNo = await early.next((m) => m.t === 'sys');
  check('with the switch off before the match, a spectator is refused', !!earlyNo && earlyNo.reason === 'off', JSON.stringify(earlyNo));
  await FH.evaluate(() => document.querySelector('.fl-spec').click());
  check('and back on', /SPECTATORS: ON/.test(await sw()));
  const FG = await page(`${BASE}play/?room=${code2}`, prof('TRIN', 'b'), SMALL);
  check('both players are on the pick screen', !!(await until(async () => (await FH.evaluate(() => window.__net.state)) === 'select' && (await FG.evaluate(() => window.__net.state)) === 'select', 30000)));
  const FS = await spectator(code2);
  const pickWait = await until(async () => { const s = await wstats(FS); return s.state === 'waiting' && /NO MATCH ON YET/.test(s.text) ? s : null; });
  check('a spectator who arrives while the players pick waits for the match', !!pickWait, pickWait ? pickWait.text.slice(0, 50) : JSON.stringify(await wstats(FS)).slice(0, 160));
  for (const [p, k] of [[FH, 1], [FG, -1]]) await p.evaluate((kk) => window.__net.setLocalSource((f) => ({ dx: (f % 240) < 150 ? kk : (f % 240) < 190 ? 0 : -kk, jump: f % 331 < 2, block: f % 97 > 80, down: false, run: false, lp: f % (23 + kk) < 3, rp: f % 41 < 3, lk: f % (59 - kk) < 3, rk: f % 83 < 3, touch: false })), k);
  await FH.evaluate(() => window.__net.pick('intern', true)); await FG.evaluate(() => window.__net.pick('windowWasher', true));
  const fspecs = { FS };
  hostHashes.clear(); specHashes.clear();
  const started = await until(() => FH.evaluate(() => window.__net.active), 30000);
  if (!started) console.log('      players:', JSON.stringify(await Promise.all([FH, FG].map((p) => p.evaluate(() => ({ state: window.__net.state, flow: window.__flow.state, v: (() => { const v = window.__net.view(); return { mine: v.mine, rival: v.rival, cd: v.cd }; })() }))))));
  const fl = await until(async () => { await collect(FH, fspecs); const s = await wstats(FS); return s.state === 'live' && s.frame > 400 ? s : null; }, 60000);
  if (!fl) console.log('      spectator:', JSON.stringify(await FS.evaluate(() => ({ flow: window.__flow.state, hist: window.__flow.debug.history.slice(-6), watch: window.__watch.stats() }))).slice(0, 500));
  check('the match from the menus is watched: the picked fighters and the players\' names', !!fl && fl.view.names.join() === 'NEO,TRIN' && fl.view.chars.join() === 'intern,windowWasher' && /NEO VS TRIN/.test(fl.text), fl ? `${fl.view.names} ${fl.view.chars} frame ${fl.frame}` : JSON.stringify(await wstats(FS)).slice(0, 200));
  await shot(FS, '9-watching-from-menus');
  const TS = await page(`${BASE}play/?watch=${code2}`, {}, { width: 844, height: 390 }, true);
  const tl = await until(async () => { await collect(FH, fspecs); const s = await wstats(TS); return s.state === 'live' ? s : null; }, 30000);
  const tpos = await TS.evaluate(() => { const b = document.querySelector('.fl-wbar'), l = document.querySelector('.fl-wbtns'), tc = document.querySelector('.tc-stickzone, .tc-cluster'); const r = (e) => { const x = e.getBoundingClientRect(); return [Math.round(x.left), Math.round(x.top), Math.round(x.right), Math.round(x.bottom)]; }; return { bar: b && r(b), btns: l && r(l), controls: tc ? getComputedStyle(tc).display : 'none', touch: document.documentElement.classList.contains('touch-ui') }; });
  check('on a phone the watch view has no touch controls, and the tag and LEAVE are on screen', !!tl && tpos.touch && tpos.controls === 'none' && tpos.bar && tpos.bar[0] >= 0 && tpos.bar[2] <= 844 && tpos.btns[2] <= 844 && tpos.btns[3] <= 390, JSON.stringify(tpos));
  await shot(TS, '10-watching-phone');
  const ML = await page(BASE + 'play/');
  await ML.evaluate(() => { const f = window.__flow.debug; f.go('modeSelect'); f.go('onlineMenu'); f.go('watchList'); });
  // (the count in the list trails a join by up to 10 s, plus the cache)
  const row = await until(() => ML.evaluate(() => { const r = document.querySelector('.fl-liverow'); return r && /INTERN/.test(r.textContent) && /NEO/.test(r.textContent) && /2 WATCHING/.test(r.textContent) ? r.textContent : null; }), 40000);
  check('the WATCH menu shows the fighters, the names, the round and the spectator count', !!row && /WINDOW WASHER/.test(row) && /TRIN/.test(row) && /ROUND \d/.test(row) && /2 WATCHING/.test(row), row || await ML.evaluate(() => document.querySelector('.fl-live').textContent.slice(0, 100)));
  await shot(ML, '3-live-list-menu');
  // picking the row goes to the watch view
  await ML.evaluate(() => document.querySelector('.fl-liverow').click());
  const viaList = await until(async () => { const s = await wstats(ML); return s.flow === 'watching' && (s.state === 'live' || s.state === 'catching' || s.state === 'buffering') ? s : null; }, 20000);
  check('picking a match in the list opens it', !!viaList && await ML.evaluate((c) => new URLSearchParams(location.search).get('watch') === c, code2), viaList ? viaList.state : '');
  // LEAVE goes back to the list, and the socket closes
  const leaveBtn = await until(() => ML.evaluate(() => !![...document.querySelectorAll('.fl-wbtns .fl-btn')].find((b) => b.textContent === 'LEAVE')), 60000);
  if (!leaveBtn) console.log('      no LEAVE button:', JSON.stringify(await wstats(ML)).slice(0, 300));
  await ML.evaluate(() => { const b = [...document.querySelectorAll('.fl-wbtns .fl-btn')].find((x) => x.textContent === 'LEAVE'); if (b) b.click(); });
  check('LEAVE goes back to the LIVE list and hangs up', !!(await until(async () => (await wstats(ML)).flow === 'watchList' && await ML.evaluate(() => window.__watch.state === 'idle' && !new URLSearchParams(location.search).has('watch') && window.__sockets.filter((w) => /\/watch/.test(w.url) && w.readyState === 1).length === 0))));
  await sleep(4000); await collect(FH, fspecs);
  compare('from the menus');
  // a spectator can't pause or play: its keys never reach the fight, and nothing it sends is passed on
  const hf = await FH.evaluate(() => window.__net.netcode.frame);
  for (const k of ['KeyP', 'KeyR', 'KeyG', 'KeyJ', 'KeyK', 'KeyU', 'ArrowLeft', 'ArrowUp']) await FS.keyboard.press(k);
  await FS.evaluate(() => { const w = window.__sockets.find((x) => /\/watch/.test(x.url) && x.readyState === 1); for (let i = 0; i < 5; i++) w.send(JSON.stringify({ t: 'start', seed: 1 })); w.send(new Uint8Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7]).buffer); });
  await sleep(2500);
  const after = await Promise.all([FH.evaluate(() => ({ f: window.__net.netcode ? window.__net.netcode.frame : -1, state: window.__net.state, desync: !!(window.__net.netcode && window.__net.netcode.desync) })), wstats(FS)]);
  check('a spectator can\'t pause or interfere: its keys and its messages change nothing for the players, and it keeps watching', /^(playing|post|select)$/.test(after[0].state) && !after[0].desync && /^(live|buffering|result)$/.test(after[1].state) && after[1].flow === 'watching', `the players are ${after[0].state} (frame ${hf} -> ${after[0].f}), the spectator is ${after[1].state} in ${after[1].flow}`);
  await FS.evaluate(() => { const w = window.__sockets.find((x) => /\/watch/.test(x.url) && x.readyState === 1); for (let i = 0; i < 30; i++) w.send('x'); });
  check('a spectator that keeps sending is cut off', !!(await until(async () => (await wstats(FS)).detail === 'flood', 15000)), JSON.stringify([(await wstats(FS)).state, (await wstats(FS)).detail]));
  for (const [n, p] of Object.entries({ FH, FG, TS, ML })) check(`no page errors on ${n}`, p.errors.length === 0, p.errors.slice(0, 2).join(' | '));
  for (const p of [FH, FG, FS, TS, ML]) await p.context().browser().close().catch(() => {});
  }
  if (part('line')) {

  // ---- 5a. Champ of the Court: the members in a crew's line watch the court, and nobody else -------------------
  // (README, Crew rooms, Champ of the Court; Spectators). CAROL and DAVE (crew sockets, with player pages hosting the
  // match room) are on the court. ERIN opens the crew link in a real page, presses PLAY and is put in line, which
  // takes her straight to watching the match with the crew's ticket. Her hashes are checked against the host's. A
  // bare code, a made-up ticket, a member who left the line and a member never in it all get nothing, and the match
  // never shows up in api/live. Then CAROL wins: DAVE goes to the back of the line, and ERIN goes from watching
  // straight to the pick screen against the champ.
  const lc = await (await fetch(API + 'crews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'LINE TEST' }) })).json();
  check('line: made a crew room', !!lc.slug, lc.slug);
  const lpid = (c) => c.repeat(32);
  const hello = async (p, name) => { const s = await sock(`${WS}crews/${lc.slug}/ws`); s.ws.send(JSON.stringify({ t: 'hello', pid: lpid(p), name })); await s.next((m) => m.t === 'welcome'); return s; };
  const la = await hello('a', 'CAROL'), lb = await hello('b', 'DAVE');
  la.ws.send(JSON.stringify({ t: 'play', on: true })); await sleep(80); lb.ws.send(JSON.stringify({ t: 'play', on: true }));
  const lma = await la.next((m) => m.t === 'match'), lmb = await lb.next((m) => m.t === 'match');
  check('line: CAROL and DAVE are on the court', !!lma && !!lmb && lma.code === lmb.code, lma ? `${lma.code} ${lma.role}/${lmb && lmb.role}` : '');
  if (lma && lmb) {
    const LH = await player('CAROL', 1, SMALL), LG = await player('DAVE', -1, SMALL);
    const [hostP, guestP] = lma.role === 'host' ? [LH, LG] : [LG, LH];
    const hostSock = lma.role === 'host' ? la : lb;
    await hostP.evaluate((c) => window.__net.host({ code: c, crew: true }), lma.code);
    await guestP.evaluate((c) => window.__net.join(c, { crew: true }), lma.code);
    check('line: the crew match is running', !!(await until(() => hostP.evaluate(() => window.__net.active && window.__net.netcode.frame > 240), 25000)));
    // ERIN opens the crew: she's in the lobby, not in line (opening a crew queues nobody)
    const erin = lpid('e');
    const E = await page(`${BASE}crew/${lc.slug}`, { ...RULES, 'stick-fight-player': JSON.stringify({ id: erin, name: 'ERIN', email: '', crews: [{ slug: lc.slug, name: 'LINE TEST', at: Date.now() }] }) });
    const eflow = () => E.evaluate(() => window.__flow.state);
    check('line: the crew link opens the lobby, and ERIN is not in line', !!(await until(async () => (await eflow()) === 'crewLobby' && await E.evaluate(() => /CAROL/.test(document.body.innerText))), 30000) && !(await E.evaluate(() => window.__flow.debug.history.some((h) => /watching/.test(h)))), await eflow());
    const court0 = await until(() => E.evaluate(() => { const b = document.querySelector('.fl-court'); return b && /ON NOW/.test(b.innerText) && /CAROL/.test(b.innerText) && /DAVE/.test(b.innerText) ? b.innerText.replace(/\s+/g, ' ') : null; }), 15000);
    check('line: the lobby shows who is on the court', !!court0, court0 || '');
    await shot(E, '11-crew-lobby-court');
    // PLAY: the end of the line, which (a match being on) means watching it
    await E.evaluate(() => { const b = [...document.querySelectorAll('.fl-crewbtns .fl-btn')].find((x) => /^PLAY/.test(x.textContent)); b && b.click(); });
    const especs = { E };
    hostHashes.clear(); specHashes.clear();
    const ew = await until(async () => { await collect(hostP, especs); const s = await wstats(E); return s.flow === 'watching' && s.state === 'live' && s.frame > 120 ? s : null; }, 40000);
    if (!ew) console.log('      ERIN:', JSON.stringify(await E.evaluate(() => ({ sockets: window.__sockets.map((w) => [w.url.replace(/^.*\/api\//, ''), w.readyState]), hist: window.__flow.debug.history.slice(-6) }))));
    check('line: PLAY puts ERIN in line, and from the lobby she goes straight to watching the court', !!ew, ew ? `frame ${ew.frame}: ${ew.text.slice(0, 80)}` : JSON.stringify(await wstats(E)).slice(0, 200));
    check('line: the watch view says her place in line and has LEAVE LINE', !!ew && /YOU'RE NEXT IN LINE/.test(ew.text) && /CAROL VS DAVE|DAVE VS CAROL/.test(ew.text) && /LEAVE LINE/.test(ew.text), ew ? ew.text.slice(0, 120) : '');
    check('line: she watched with the crew\'s ticket, not the bare code', await E.evaluate(() => window.__sockets.some((w) => /\/watch\?ticket=[0-9a-f]{32}$/.test(w.url) && w.readyState === 1)));
    await shot(E, '12-watching-from-the-line');
    // nobody else gets in: a bare code, a made-up ticket, a member never in line, a member who left the line
    const bare = await sock(`${WS}rooms/${lma.code}/watch`);
    const bareNo = await bare.next((m) => m.t === 'sys');
    check('line: the bare room code gets no-room', !!bareNo && bareNo.reason === 'no-room', JSON.stringify(bareNo));
    const fake = await sock(`${WS}rooms/${lma.code}/watch?ticket=${'0123456789abcdef'.repeat(2)}`);
    const fakeNo = await fake.next((m) => m.t === 'sys');
    check('line: a non-member with a made-up ticket gets no-room', !!fakeNo && fakeNo.reason === 'no-room', JSON.stringify(fakeNo));
    const lf = await hello('f', 'FRANK');   // in the lobby, never in line
    const ld = await hello('d', 'GINA');
    ld.ws.send(JSON.stringify({ t: 'play', on: true }));
    const dt = await ld.next((m) => m.t === 'watch' && m.ticket, 8000);
    check('line: a member who gets in line is handed a ticket for the court', !!dt && dt.code === lma.code, JSON.stringify(dt));
    await sleep(1500);
    check('line: a member who never pressed PLAY gets no ticket', !lf.got.some((m) => m.t === 'watch' && m.ticket), JSON.stringify(lf.got.filter((m) => m.t === 'watch')));
    if (dt) {
      const dIn = await sock(`${WS}rooms/${lma.code}/watch?ticket=${dt.ticket}`);
      const dw = await dIn.next((m) => m.t === 'sys');
      check('line: with it, she can watch', !!dw && dw.ev === 'welcome' && dw.role === 'spectator', JSON.stringify(dw));
      ld.ws.send(JSON.stringify({ t: 'play', on: false }));   // LEAVE LINE
      // (the room says over: line and closes the socket; wrangler dev's proxy can be slow to pass the close on)
      const over = await until(async () => dIn.closed === 4002 || dIn.got.some((m) => m.t === 'w' && m.ev === 'over' && m.reason === 'line'), 8000);
      check('line: LEAVE LINE takes the ticket back: her spectator socket is told it\'s over and closed', !!over, `closed ${dIn.closed}, ${JSON.stringify(dIn.got.slice(-1))}`);
      const dAgain = await sock(`${WS}rooms/${lma.code}/watch?ticket=${dt.ticket}`);
      const dNo = await dAgain.next((m) => m.t === 'sys');
      check('line: a member no longer in line gets no-room with her old ticket', !!dNo && dNo.reason === 'no-room', JSON.stringify(dNo));
    }
    await sleep(6500);
    check('line: the crew match never shows up in api/live while the line watches', (await live()).every((r) => r.code !== lma.code));
    check('line: the players see the one member in line watching', !!(await until(() => hostP.evaluate(() => window.__net.watchers === 1), 15000)), String(await hostP.evaluate(() => window.__net.watchers)));
    // ERIN's keys and messages change nothing for the players
    for (const k of ['KeyP', 'KeyJ', 'KeyK', 'ArrowLeft', 'ArrowUp']) await E.keyboard.press(k);
    await E.evaluate(() => { const w = window.__sockets.find((x) => /\/watch/.test(x.url) && x.readyState === 1); if (w) { w.send(JSON.stringify({ t: 'start', seed: 1 })); w.send(new Uint8Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 7]).buffer); } });
    await sleep(2000);
    const pl = await hostP.evaluate(() => ({ state: window.__net.state, desync: !!(window.__net.netcode && window.__net.netcode.desync) }));
    check('line: a member watching from the line can\'t reach the players', pl.state === 'playing' && !pl.desync && (await wstats(E)).flow === 'watching', JSON.stringify(pl));
    for (let i = 0; i < 6; i++) { await sleep(700); await collect(hostP, especs); }
    compare('line');
    await reportLatency('line: ERIN watching from the line', hostP, E);
    const et = await E.evaluate(() => window.__watch.stats().totals);
    check('line: ERIN\'s own checks against the host\'s hashes all pass', et.checks > 0 && et.bad === 0, `${et.checks} checked, ${et.bad} bad`);
    // CAROL wins (the host's page reports it): DAVE goes to the back of the line, ERIN is up against the champ
    const carolIdx = lma.role === 'host' ? 0 : 1;
    hostSock.ws.send(JSON.stringify({ t: 'result', match: lma.id, n: 1, winner: carolIdx, wins: carolIdx === 0 ? [2, 0] : [0, 2], chars: ['temp', 'temp'], secs: 40 }));
    const rot = await lb.next((m) => m.t === 'rotate', 8000);
    check('line: the loser hears BACK OF THE LINE: CAROL stays, ERIN is next, DAVE is 1st behind her', !!rot && rot.next === 'ERIN' && rot.spot === 1, JSON.stringify(rot));
    // (the line and the champ name members by the crew's member id: CAROL's and DAVE's are in their match messages)
    const carolId = lmb.rival.id, daveId = lma.rival.id;
    const st = await la.next((m) => m.t === 'state' && m.champ && Array.isArray(m.line) && m.line.some((x) => x.id === daveId), 8000);
    const erinId = st && (st.members.find((x) => x.name === 'ERIN') || {}).id;
    const spotOf = (id) => (st && st.line.find((x) => x.id === id) || { spot: -1 }).spot;
    check('line: DAVE is still in line, behind ERIN, without pressing PLAY; CAROL is champ', !!st && !!erinId && spotOf(daveId) > spotOf(erinId) && spotOf(erinId) >= 0 && st.champ.id === carolId && st.champ.streak === 1, st ? JSON.stringify({ line: st.line, champ: st.champ }) : '');
    // the players' pages come back to the crew (in a real page, after the result screen): the line goes on
    await hostP.evaluate(() => window.__net.leave()); await guestP.evaluate(() => window.__net.leave());
    la.ws.send(JSON.stringify({ t: 'lobby' })); lb.ws.send(JSON.stringify({ t: 'lobby' }));
    const nm = await la.next((m) => m.t === 'match' && m.id !== lma.id, 15000);
    check('line: the next match is the champ against ERIN', !!nm && nm.rival && nm.rival.name === 'ERIN', JSON.stringify(nm));
    if (nm) {
      const champP = LH;   // CAROL's page
      await champP.evaluate(([c, role]) => (role === 'host' ? window.__net.host({ code: c, crew: true, pickFirst: true }) : window.__net.join(c, { crew: true, pickFirst: true })), [nm.code, nm.role]);
      const pick = await until(async () => { const s = await E.evaluate(() => ({ flow: window.__flow.state, net: window.__net.state, hist: window.__flow.debug.history.slice(-6) })); return s.flow === 'onlineSelect' ? s : null; }, 30000);
      const hist = await E.evaluate(() => window.__flow.debug.history.slice(-8));
      const iw = hist.lastIndexOf('watching>crewLinking');
      check('line: ERIN goes from watching straight to the pick screen against the champ (not through the lobby)', !!pick && iw >= 0 && hist[iw + 1] === 'crewLinking>onlineSelect', JSON.stringify(hist));
      await shot(E, '13-up-against-the-champ');
    }
    for (const [n, p] of Object.entries({ E, LH, LG })) check(`line: no page errors on ${n}`, p.errors.length === 0, p.errors.slice(0, 2).join(' | '));
    for (const p of [E, LH, LG]) await p.context().browser().close().catch(() => {});
    for (const s of [la, lb, lf, ld]) { try { s.ws.close(); } catch { /* closed */ } }
  }
  }
  if (part('crew')) {

  // ---- 5. a crew room: closed to spectators but its line, never listed ------------------------------------------
  const crew = await (await fetch(API + 'crews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'WATCH TEST' }) })).json();
  check('made a crew room', !!crew.slug, crew.slug);
  const asSpec = await sock(`${WS}crews/${crew.slug}/ws?role=spectator`);
  const no = await asSpec.next((m) => m.t === 'error');
  check('the crew room refuses a spectator role', !!no && no.reason === 'no-spectators', JSON.stringify(no));
  const noRoute = await fetch(`${API}crews/${crew.slug}/watch`);
  check('crew rooms have no watch endpoint', noRoute.status === 404, String(noRoute.status));
  // two members press PLAY: the crew opens a match room (a quick room it claims as private)
  const pid = (c) => c.repeat(32);
  const a = await sock(`${WS}crews/${crew.slug}/ws`), b = await sock(`${WS}crews/${crew.slug}/ws`);
  a.ws.send(JSON.stringify({ t: 'hello', pid: pid('a'), name: 'CAROL' })); b.ws.send(JSON.stringify({ t: 'hello', pid: pid('b'), name: 'DAVE' }));
  await a.next((m) => m.t === 'welcome'); await b.next((m) => m.t === 'welcome');
  a.ws.send(JSON.stringify({ t: 'play', on: true })); b.ws.send(JSON.stringify({ t: 'play', on: true }));
  const ma = await a.next((m) => m.t === 'match'), mb = await b.next((m) => m.t === 'match');
  check('the crew started a match', !!ma && !!mb && ma.code === mb.code, ma ? `${ma.code} ${ma.role}/${mb && mb.role}` : '');
  if (ma && mb) {
    const CH = await player('CAROL', 1, SMALL), CG = await player('DAVE', -1, SMALL);
    const hostP = ma.role === 'host' ? CH : CG, guestP = ma.role === 'host' ? CG : CH;
    await hostP.evaluate((c) => window.__net.host({ code: c, crew: true }), ma.code);
    await guestP.evaluate((c) => window.__net.join(c, { crew: true }), ma.code);
    check('the crew match is running', !!(await until(() => hostP.evaluate(() => window.__net.active && window.__net.netcode.frame > 240), 25000)));
    const cs = await sock(`${WS}rooms/${ma.code}/watch`);
    const cno = await cs.next((m) => m.t === 'sys');
    check('a crew match\'s room refuses spectators (as if it weren\'t there)', !!cno && cno.ev === 'error' && cno.reason === 'no-room', JSON.stringify(cno));
    const CS = await spectator(ma.code, SMALL);
    const cref = await until(async () => { const s = await wstats(CS); return s.state === 'error' ? s : null; });
    check('a watch link to a crew match shows no match', !!cref && cref.detail === 'no-room', cref ? cref.text.slice(0, 50) : '');
    // a host page that asks anyway (a tampered client) changes nothing: the room is private
    await hostP.evaluate(() => { const l = window.__net.link; l.sendRoom(JSON.stringify({ t: 'watch', ev: 'allow', on: true })); l.sendRoom(JSON.stringify({ t: 'watch', ev: 'start', n: 1, v: 22, seed: 1, chars: ['temp', 'temp'], names: ['X', 'Y'] })); });
    await sleep(6500);
    const lc = await live();
    check('crew matches never show up in api/live', lc.every((r) => r.code !== ma.code), JSON.stringify(lc.map((r) => r.code)));
    check('the crew match shows no WATCHING readout', await hostP.evaluate(() => window.__net.watchers === 0));
    await CH.close(); await CG.close();
  }
  // ---- 6. the join limit covers watch joins ----------------------------------------------------------------------
  let busy = 0, tries = 0;
  for (; tries < 45 && !busy; tries++) { const s = await sock(`${WS}rooms/ZZZZ/watch`); const m = await s.next((x) => x.t === 'sys', 3000); if (m && m.reason === 'busy') busy++; try { s.ws.close(); } catch { /* closed */ } }
  check('watch joins count against the per-IP join limit (30 a minute)', busy > 0, `refused as busy after ${tries} more joins`);
  }
} catch (e) {
  check('the run finished', false, String(e && e.stack || e));
} finally {
  for (const b of browsers) await b.close().catch(() => {});
}
if (latRows.length) {
  console.log('\nhost-to-spectator latency (ms from a frame on the host\'s screen to the same frame on the spectator\'s)');
  for (const r of latRows) console.log(`  ${r.label.padEnd(52)} ${String(r.a.length).padStart(6)} frames  median ${pct(r.a, 50)}  95th ${pct(r.a, 95)}  max ${pct(r.a, 100)}  (the page lost ${(100 * r.pg.lost / Math.max(1, r.pg.wall)).toFixed(1)}% of its time to passes over 100 ms; a drawn pass ${r.pg.drawMs.toFixed(0)} ms)`);
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} of ${results.length} checks passed`);
process.exit(bad.length ? 1 : 0);
