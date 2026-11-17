// How fast the crew lobby gets in, and how fast it gets back (README, Crew rooms, Connecting).
//
//   npm run build && npx wrangler dev --port 8799 --persist-to /tmp/crewconnect/state --inspector-port 9799
//   node scripts/crew/connect.mjs [http://127.0.0.1:8799/] [--gpu] [--only fresh,hung,stall,dead,hidden,busy] [--loose] [--json out.json]
//
// A TCP proxy sits between headless Chromium and the local Worker, so the test can break the path the way a
// phone's network breaks it:
//   fresh   10 cold page loads of a crew link: page load to the lobby's welcome, median under 2 s, worst under 3 s
//   hung    a cold load whose first crew dial is accepted and never upgraded: welcome under 5 s
//   stall   the path goes down (live connections go silent, new ones are accepted and never answered: a server that
//           takes the TCP connection and never upgrades) for 12 s, then comes back: back in under 5 s from then
//   dead    the lobby's socket goes silent (no close, no pongs) while new connections still work: redialed and
//           welcomed within 8 s
//   hidden  the tab is hidden and frozen for 60 s while its socket dies, then shown again: in the lobby within 2 s
//   busy    the Worker's join limit refuses the crew socket ('busy'): the status line says SERVER BUSY, not
//           RECONNECTING, and the meter says RECONNECTING, not CHECKING
// The welcome is timed in the page, from a WebSocket wrapper (so the same test measures any build: --loose prints
// the numbers without failing, for a before run). Exit code 1 on any failure.
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const UP = new URL((argv.find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8799/').replace(/\/?$/, '/'));
const GPU = argv.includes('--gpu'), LOOSE = argv.includes('--loose');
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : ['fresh', 'hung', 'stall', 'dead', 'hidden', 'busy'];
const JSON_OUT = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : '';
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [], numbers = {};
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

// ---- the proxy ----
// mode for new connections: 'pass' | 'stall'; `busy` refuses that many crew socket upgrades the way the Worker does
const proxy = { mode: 'pass', busy: 0, stallCrew: 0, conns: new Set(), crewDials: 0 };
/** silence every live connection (no close, no bytes either way): a NAT mapping or a wifi path that died */
const blackhole = (filter = () => true) => { let n = 0; for (const c of proxy.conns) if (filter(c) && !c.dead) { c.dead = true; n++; } return n; };
function refuseBusy(client, head) {
  const key = (head.match(/sec-websocket-key:\s*(\S+)/i) || [])[1] || '';
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  client.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const text = Buffer.from(JSON.stringify({ t: 'sys', ev: 'error', reason: 'busy' }));   // worker/env.ts refusedSocket
  client.write(Buffer.concat([Buffer.from([0x81, text.length]), text]));
  const reason = Buffer.from('busy'), close = Buffer.alloc(2); close.writeUInt16BE(4029);
  client.write(Buffer.concat([Buffer.from([0x88, 2 + reason.length]), close, reason]));
  setTimeout(() => client.end(), 50);
}
const server = net.createServer((client) => {
  const c = { client, up: null, dead: false, crew: false, held: [] };
  proxy.conns.add(c);
  const stalled = proxy.mode === 'stall';
  if (stalled) c.dead = true;   // accepted, never answered
  let first = true;
  client.on('data', (buf) => {
    if (c.dead || c.refused) return;
    if (first) {
      first = false;
      const head = buf.toString('latin1', 0, Math.min(buf.length, 4096));
      c.crew = /^GET [^ ]*\/api\/crews\/[^ /]+\/ws/.test(head) && /upgrade:\s*websocket/i.test(head);
      if (c.crew) proxy.crewDials++;
      if (c.crew && proxy.stallCrew > 0) { proxy.stallCrew--; c.dead = true; return; }   // accepted, never upgraded
      if (c.crew && proxy.busy > 0) { proxy.busy--; c.refused = true; refuseBusy(client, head); return; }
      c.up = net.connect(Number(UP.port), UP.hostname);
      c.up.on('data', (d) => { if (!c.dead) client.write(d); });
      c.up.on('close', () => { if (!c.dead) client.destroy(); proxy.conns.delete(c); });
      c.up.on('error', () => {});
    }
    if (c.up) c.up.write(buf);
  });
  client.on('close', () => { proxy.conns.delete(c); if (c.up && !c.dead) c.up.destroy(); });
  client.on('error', () => {});
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
console.log(`proxy ${BASE} -> ${UP.href}`);

// ---- pages ----
const GL = GPU ? (process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--ignore-gpu-blocklist'])
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath, args: [...GL, '--mute-audio'] });
const contexts = [];
/** the crew socket's life, timed in the page: every open, welcome and close with performance.now() (ms since navigation) */
function wsSpy() {
  const Real = window.WebSocket;
  window.__crew = [];
  window.__ticks = 0; setInterval(() => window.__ticks++, 100);
  window.__vis = 'visible';
  Object.defineProperty(document, 'visibilityState', { get: () => window.__vis, configurable: true });
  Object.defineProperty(document, 'hidden', { get: () => window.__vis !== 'visible', configurable: true });
  window.WebSocket = class extends Real {
    constructor(url, p) {
      super(url, p);
      if (!/\/api\/crews\//.test(String(url))) return;
      const log = (ev, x = '') => window.__crew.push({ ev, t: performance.now(), x });
      log('dial');
      this.addEventListener('open', () => log('open'));
      this.addEventListener('message', (e) => { if (typeof e.data === 'string' && e.data.includes('"welcome"')) log('welcome'); });
      this.addEventListener('close', (e) => log('close', `${e.code} ${e.reason}`));
    }
  };
}
async function open(url) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  contexts.push(ctx);
  await ctx.addInitScript(wsSpy);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.logs = [];
  p.on('console', (m) => p.logs.push(m.text().slice(0, 160)));
  await p.goto(url);
  return p;
}
const crewLog = (p) => p.evaluate(() => window.__crew).catch(() => []);
const pageNow = (p) => p.evaluate(() => performance.now());
/** the first welcome after page time t0 (ms), waiting up to `ms` of real time; the time it landed, or null */
async function welcomeAfter(p, t0, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const w = (await crewLog(p)).find((e) => e.ev === 'welcome' && e.t > t0);
    if (w) return w.t;
    if (Date.now() > end) return null;
    await sleep(100);
  }
}
const statusText = (p) => p.evaluate(() => (document.querySelector('.fl-crewstatus') || {}).textContent || '').catch(() => '');
const meterText = (p) => p.evaluate(() => (document.querySelector('.fl-crewmeter .nm-t') || {}).textContent || '').catch(() => '');
const fmt = (ms) => ms == null ? 'never' : `${Math.round(ms)} ms`;
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {}); };
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

const made = await fetch(`${UP.href}api/crews`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'CONNECT TEST' }) }).then((r) => r.json());
if (!made.slug) { console.log('could not make a crew:', made); process.exit(1); }
const LINK = `${BASE}crew/${made.slug}`;
console.log(`crew ${made.slug}`);

/** a page in the lobby, welcomed */
async function inLobby() {
  const p = await open(LINK);
  const t = await welcomeAfter(p, 0, 30000);
  if (t == null) throw new Error('never welcomed');
  await sleep(2500);   // a ping or two answered
  return p;
}

try {
  if (ONLY.includes('fresh')) {
    // a warm-up load first (wrangler compiles and the crew's object wakes on the first one), not counted
    const w = await open(LINK); await welcomeAfter(w, 0, 30000); await w.context().close();
    const times = [];
    for (let i = 0; i < 10; i++) {
      const p = await open(LINK);
      const t = await welcomeAfter(p, 0, 30000);
      times.push(t == null ? 30000 : t);
      console.log(`   load ${i + 1}: ${fmt(t)}  (${(await crewLog(p)).filter((e) => e.ev === 'dial').length} dial)`);
      await p.context().close();
    }
    const med = pct(times, 0.5), worst = Math.max(...times);
    numbers.fresh = { median: Math.round(med), worst: Math.round(worst), all: times.map(Math.round) };
    check('fresh load: welcome under 2 s at the median', med < 2000, fmt(med));
    check('fresh load: welcome under 3 s, worst of 10', worst < 3000, fmt(worst));
  }

  if (ONLY.includes('hung')) {
    // a cold load whose first crew dial is taken and never upgraded (a phone just woke, a flaky hop): measured
    proxy.stallCrew = 1;
    const p = await open(LINK);
    const t = await welcomeAfter(p, 0, 60000);
    numbers.hung = { ms: t == null ? null : Math.round(t) };
    check('a cold load whose first dial hangs: welcome under 5 s', t != null && t < 5000, fmt(t));
    await p.context().close();
  }

  if (ONLY.includes('stall')) {
    const p = await inLobby();
    proxy.mode = 'stall'; blackhole();
    await sleep(12000);
    const during = await statusText(p), meter = await meterText(p);
    const back = await pageNow(p);
    proxy.mode = 'pass';
    const t = await welcomeAfter(p, back, 60000);
    const ms = t == null ? null : t - back;
    numbers.stall = { ms: ms == null ? null : Math.round(ms), dials: (await crewLog(p)).filter((e) => e.ev === 'dial').length };
    console.log(`   while down: "${during}" · meter "${meter}"`);
    check('stalled handshake: back in the lobby under 5 s once the path is back', ms != null && ms < 5000, fmt(ms));
    check('while the path is down the meter says RECONNECTING, not CHECKING', /RECONNECTING/.test(meter) && !/CHECKING/.test(meter), meter);
    await p.context().close();
  }

  if (ONLY.includes('dead')) {
    const p = await inLobby();
    const t0 = await pageNow(p);
    blackhole((c) => c.crew);
    const t = await welcomeAfter(p, t0, 60000);
    const ms = t == null ? null : t - t0;
    numbers.dead = { ms: ms == null ? null : Math.round(ms) };
    check('silently dead socket: noticed and redialed within 8 s', ms != null && ms < 8000, fmt(ms));
    await p.context().close();
  }

  if (ONLY.includes('hidden')) {
    const p = await inLobby();
    const cdp = await p.context().newCDPSession(p);
    await p.evaluate(() => { window.__vis = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
    // frozen, as a phone freezes a tab it hid: no JS runs at all (CDP's own freeze doesn't take on a visible headless page)
    const before = await p.evaluate(() => window.__ticks);
    await cdp.send('Debugger.enable'); await cdp.send('Debugger.pause');
    blackhole((c) => c.crew);   // the phone slept: its socket's path died with nothing said
    await sleep(Number(process.env.HIDDEN_MS || 60000));
    await cdp.send('Debugger.resume'); await cdp.send('Debugger.disable');
    const ticked = (await p.evaluate(() => window.__ticks)) - before;
    check('the tab really was frozen (its timers stood still)', ticked < 20, `${ticked} ticks of 100 ms`);
    const t0 = await p.evaluate(() => { window.__vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); return performance.now(); });
    const t = await welcomeAfter(p, t0, 30000);
    const ms = t == null ? null : t - t0;
    numbers.hidden = { ms: ms == null ? null : Math.round(ms) };
    if (ms == null) console.log('   log:', JSON.stringify((await crewLog(p)).slice(-8)), (await p.evaluate(() => window.__flow && window.__flow.state).catch((e) => e.message)), p.logs.slice(-10).join(' | '));
    check('back to visible after 60 s hidden: in the lobby within 2 s', ms != null && ms < 2000, fmt(ms));
    await p.context().close();
  }

  if (ONLY.includes('hidden')) {
    // the same with a socket that lived through it (a desktop tab): no redial, no RECONNECTING blip
    const p = await inLobby();
    const cdp = await p.context().newCDPSession(p);
    await p.evaluate(() => { window.__vis = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
    await cdp.send('Debugger.enable'); await cdp.send('Debugger.pause');
    await sleep(10000);
    await cdp.send('Debugger.resume'); await cdp.send('Debugger.disable');
    const t0 = await p.evaluate(() => { window.__vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); return performance.now(); });
    await sleep(3000);
    const dials = (await crewLog(p)).filter((e) => e.ev === 'dial' && e.t > t0).length;
    check('a socket that lived through 10 s hidden is kept (no redial)', dials === 0, `${dials} dials`);
    await p.context().close();
  }

  if (ONLY.includes('busy')) {
    proxy.busy = 3;
    const p = await open(LINK);
    let line = '', meter = '';
    for (let i = 0; i < 40 && !/SERVER BUSY|RECONNECTING/.test(line); i++) { await sleep(250); line = await statusText(p); }
    await sleep(500);
    line = await statusText(p); meter = await meterText(p);
    await shot(p, 'busy');
    numbers.busy = { line, meter };
    check("a 'busy' refusal says SERVER BUSY on the status line", /SERVER BUSY/.test(line) && !/RECONNECTING/.test(line), line);
    check("...and the meter says RECONNECTING, not CHECKING", /RECONNECTING/.test(meter) && !/CHECKING/.test(meter), meter);
    // it gets in once the limit lets it (3 refusals: 2 + 4 + 8 s of the busy backoff, then the welcome)
    const t = await welcomeAfter(p, 0, 40000);
    check('...and gets in once the server lets it', t != null, fmt(t));
    await p.context().close();
  }
} catch (e) {
  check('the test ran', false, e.message);
}

for (const c of contexts) await c.close().catch(() => {});
await browser.close();
server.close();
for (const c of proxy.conns) { c.client.destroy(); c.up && c.up.destroy(); }
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(numbers, null, 2));
console.log(JSON.stringify(numbers));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed && !LOOSE ? 1 : 0);
