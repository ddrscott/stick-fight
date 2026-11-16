// The link riding out a bad network in real browsers, through the local Worker (README, Multiplayer, Reconnecting).
//
//   npm run build && npm run dev:worker        (the Worker serving dist/ and the API on :8787)
//   node scripts/netsim/handoff-browser.mjs [http://127.0.0.1:8787/] [--shots dir]
//
// A host and a guest (each its own Chromium, scripted inputs) play a quick-room match on a DataChannel. Then:
// the host's room socket dies half-open (the room is told nothing) while its browser is offline for 6 s, so it
// can't come back until the network does: the HUD has to say RECONNECTING, the match has to play on over the
// DataChannel, and the socket has to be back within a second of the browser going online (the 'online' nudge,
// not a backoff timer). Then the guest's DataChannel is closed under it without a word: both sides have to
// notice, redial, and be back on p2p with the match still going. scripts/netsim/handoff.mjs does the long
// dropouts, network switches and locked phones; this is the same code on real sockets and a real WebRTC stack.
// Exit code 1 on any failure.
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const BASE = (argv.find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/').replace(/\/?$/, '/');
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const until = async (fn, ms = 20000, every = 100) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };

const browsers = [];
async function player(name, k, size) {
  const b = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  browsers.push(b);
  const ctx = await b.newContext({ viewport: size });
  await ctx.addInitScript(() => { localStorage.setItem('stick-fight-round-time', '60'); localStorage.setItem('stick-fight-best-of', '3'); });
  const p = await ctx.newPage();
  p.ctx = ctx; p.errors = []; p.logs = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => { p.logs.push(m.text()); if (m.type() === 'error' && !/favicon|Failed to load resource|ERR_INTERNET_DISCONNECTED|WebSocket connection/.test(m.text())) p.errors.push(m.text()); });
  await p.goto(BASE + 'play/?scene=attract&tier=1');
  await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
  // pumped from a timer (headless software GL starves the frame loop), drawing every 12th tick on the big page
  await p.evaluate((n) => {
    window.__gauntlet.step(0);
    let last = performance.now(), i = 0;
    window.__pump = setInterval(() => { const now = performance.now(), ms = Math.min(100, now - last); last = now; if (n && ++i % n === 0) window.__gauntlet.step(ms); else window.__game.advance(ms); }, 8);
  }, size.width >= 800 ? 12 : 0);
  await p.evaluate(([nm, k]) => {
    window.__net.setName(nm);
    window.__net.setLocalSource((f) => ({ dx: (f % 240) < 150 ? k : (f % 240) < 190 ? 0 : -k, jump: f % 331 < 2, block: f % 97 > 80, down: false, run: false,
      lp: f % (23 + k) < 3, rp: f % 41 < 3, lk: f % (59 - k) < 3, rk: f % 83 < 3, touch: false }));
  }, [name, k]);
  return p;
}
const hud = (p) => p.evaluate(() => { const r = document.querySelector('.nf-readout'); const l = window.__net.link; const s = window.__net.stats();
  return { text: r ? r.textContent : '', mode: l && l.mode, reconnecting: !!(l && l.reconnecting), frame: s.frame | 0, active: window.__net.active, state: window.__net.state, debug: l && l.debug }; });

try {
  const H = await player('ALICE', 1, { width: 1280, height: 720 });
  const code = await H.evaluate(() => window.__net.host().then((o) => o.code));
  const G = await player('BOB', -1, { width: 640, height: 360 });
  await G.evaluate((c) => window.__net.join(c), code);
  check('the match started on both players', !!(await until(() => H.evaluate(() => window.__net.active))) && !!(await until(() => G.evaluate(() => window.__net.active))));
  check('both on a DataChannel', !!(await until(async () => (await hud(H)).mode === 'p2p' && (await hud(G)).mode === 'p2p')), JSON.stringify([(await hud(H)).mode, (await hud(G)).mode]));
  check('the room answers the link\'s pings (pong)', !!(await until(async () => (await hud(H)).debug.pongSeen, 8000)));
  await sleep(2500);

  // ---- 1. the host's room socket dies half-open while it's offline for 6 s ----
  const f0 = (await hud(H)).frame;
  await H.ctx.setOffline(true);
  await H.evaluate(() => window.__net.link.dropForTest());
  const re = await until(async () => { const h = await hud(H); return /RECONNECTING/.test(h.text) ? h : null; }, 3000);
  check('the HUD says RECONNECTING while the socket is down', !!re, re ? re.text : (await hud(H)).text);
  await sleep(2500);
  if (SHOTS) { await H.evaluate(() => window.__gauntlet.step(0)); await H.screenshot({ path: `${SHOTS}/reconnecting.png` }); }
  const mid = await hud(H);
  check('the match plays on over the DataChannel meanwhile', mid.active && mid.frame > f0 + 120 && mid.reconnecting, `frame ${f0} -> ${mid.frame}, ${mid.text}`);
  await sleep(3500);
  check('still trying after 6 s offline (no lost match)', (await hud(H)).active && (await hud(H)).reconnecting && (await hud(G)).active);
  const t0 = Date.now();
  await H.ctx.setOffline(false);
  const back = await until(async () => { const h = await hud(H); return !h.reconnecting ? h : null; }, 10000, 50);
  const backMs = Date.now() - t0;
  check('the socket is back within a second of going online', !!back && backMs < 1000, `${backMs} ms`);
  check('the HUD drops RECONNECTING once it\'s back', !!(await until(async () => !/RECONNECTING/.test((await hud(H)).text), 3000)), (await hud(H)).text);

  // ---- 2. the guest's DataChannel dies without a word ----
  await sleep(1500);
  const g0 = await hud(G);
  await G.evaluate(() => window.__net.link.killDcForTest());
  const relay = await until(async () => { const h = await hud(H); const g = await hud(G); return h.mode === 'relay' || g.mode === 'relay' ? [h, g] : null; }, 8000, 50);
  check('the dead DataChannel is noticed (the relay carries the match)', !!relay, relay ? relay.map((x) => x.mode).join('/') : '');
  const healed = await until(async () => { const h = await hud(H); const g = await hud(G); return h.mode === 'p2p' && g.mode === 'p2p' ? [h, g] : null; }, 20000, 100);
  check('both redial and are back on p2p', !!healed, healed ? `gen ${healed[0].debug.gen}` : JSON.stringify((await hud(H)).debug));
  await sleep(2500);
  const g1 = await hud(G);
  check('the match went on through it', g1.active && g1.frame > g0.frame + 240 && (await hud(H)).active, `guest frame ${g0.frame} -> ${g1.frame}`);
  await sleep(2000);
  const hashes = await Promise.all([H, G].map((p) => p.evaluate(() => { const ls = window.__net.netcode; return ls ? Object.fromEntries([...ls.hashes].filter(([f]) => f <= ls.confirmed)) : {}; })));
  const common = Object.keys(hashes[0]).filter((f) => f in hashes[1]);
  check('the state hashes agree', common.length > 0 && common.every((f) => hashes[0][f] === hashes[1][f]), `${common.length} frames compared`);
  for (const [n, p] of Object.entries({ H, G })) check(`no page errors on ${n}`, p.errors.length === 0, p.errors.slice(0, 2).join(' | '));
  const lines = [...H.logs, ...G.logs].filter((l) => /\[net\]/.test(l));
  console.log(lines.slice(-12).map((l) => '      ' + l).join('\n'));
} catch (e) {
  check('ran to the end', false, String(e).split('\n')[0]);
} finally {
  for (const b of browsers) await b.close().catch(() => {});
}
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
