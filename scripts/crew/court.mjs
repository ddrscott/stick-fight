// Champ of the Court (README, Crew rooms, Champ of the Court), against the local Worker over its sockets, as the
// pages talk to it (no browser):
//
//   npm run build && npm run dev:worker
//   node scripts/crew/court.mjs [http://127.0.0.1:8787/]
//
//   1. the line: opening the crew queues nobody; PLAY is the end of the line; the first two play, the rest wait in
//      order with their places; a member who leaves the line or drops out is out of it and the rest move up; a
//      dropped socket back within SPOT_MS gets its old place
//   2. winner stays on: a match ends with someone waiting, the winner is first in line and the loser at the back by
//      itself (still in line, nothing to press), told its place; the champ plays the first in line; a draw changes
//      nothing; the champ's streak counts each win; a champ who leaves lets the first two in line play each other
//   3. watching from the line: each member in line holds a ticket for the match room, and only them; with it the
//      room lets them in as a spectator and they get the host's match; the bare code, a made-up ticket, a member
//      not in line and a stranger all get no-room; LEAVE LINE takes the ticket back and closes that spectator out;
//      the crew room still refuses a spectator socket; the crew's match is never on api/live
//
// Exit code 1 on any failure.
import crypto from 'node:crypto';
import { NET_VERSION } from '../../src/net/online.js';

const BASE = (process.argv.slice(2).find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/').replace(/\/?$/, '/');
const API = BASE + 'api/';
const WS = API.replace(/^http/, 'ws');
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = () => crypto.randomBytes(16).toString('hex');
const post = (path, body) => fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const getJson = async (path) => { const r = await fetch(API + path); return { status: r.status, body: await r.json().catch(() => null) }; };

/** a socket whose messages queue up; next(pred) waits for one, latest(pred) is the newest so far */
function sock(url) {
  const ws = new WebSocket(url), q = [], waiters = [];
  let closeCode = 0;
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (e) => {
    let m; if (typeof e.data !== 'string') m = { bin: e.data.byteLength }; else if (e.data === 'pong') return; else { try { m = JSON.parse(e.data); } catch { return; } }
    q.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  };
  const closed = new Promise((res) => { ws.onclose = (e) => { closeCode = e.code; res(e.code); }; });
  const open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return {
    ws, open, q, closed,
    get closeCode() { return closeCode; },
    send: (o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o)),
    next(pred, ms = 6000) {
      const had = q.find(pred);
      if (had) { q.splice(q.indexOf(had), 1); return Promise.resolve(had); }
      return new Promise((res, rej) => { const w = { pred, res }; waiters.push(w); setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error('timeout')); } }, ms); });
    },
    latest: (pred) => [...q].reverse().find(pred),
    drain() { q.length = 0; },
    close: () => { try { ws.close(); } catch { /* gone */ } },
  };
}
/** a member in the crew's lobby: hello, welcome */
async function member(slug, id, name) {
  const s = sock(`${WS}crews/${slug}/ws`);
  await s.open;
  s.send({ t: 'hello', pid: id, name });
  const w = await s.next((m) => m.t === 'welcome' || m.t === 'error');
  s.you = w.you; s.pid = id; s.name = name;
  return s;
}
/** wait until this member's newest state satisfies pred */
async function stateUntil(s, pred, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) {
    const st = s.latest((m) => m.t === 'state');
    if (st && pred(st)) return st;
    if (Date.now() > end) return st || null;
    await sleep(60);
  }
}
const lineOf = (st) => ((st && st.line) || []).map((x) => x.id);
/** this member's newest watch message (a ticket, or match '' for none) */
const ticketOf = (s) => s.latest((m) => m.t === 'watch');
/** a spectator socket to a room, with or without a ticket: resolves to 'spectator' (in) or the refusal */
async function tryWatch(code, ticket = '') {
  const s = sock(`${WS}rooms/${code}/watch${ticket ? `?ticket=${ticket}` : ''}`);
  await s.open.catch(() => {});
  const m = await s.next((x) => x.t === 'sys' && (x.ev === 'welcome' || x.ev === 'error'), 6000).catch(() => null);
  s.verdict = !m ? 'timeout' : m.ev === 'welcome' ? m.role : m.reason;
  return s;
}
/** a crew match's two room sockets, as the players' pages open them */
async function players(code) {
  const H = sock(`${WS}rooms/${code}/ws?role=host`), G = sock(`${WS}rooms/${code}/ws?role=guest`);
  await H.open; await G.open;
  await H.next((m) => m.ev === 'welcome'); await G.next((m) => m.ev === 'welcome');
  return { H, G, close() { H.close(); G.close(); } };
}
const setup = (n, names) => ({ t: 'watch', ev: 'start', n, v: NET_VERSION, seed: 1234, chars: ['courier', 'intern'], botch: true, rules: { roundTime: 60, winsNeeded: 2, upgrades: 'off' }, names, pals: ['', ''], tally: { host: 0, guest: 0, draw: 0 }, round: 1, wins: [0, 0] });

const crew = await (await post('crews', { name: 'COURT CREW' })).json();
check('a crew room was made', crew && crew.slug, JSON.stringify(crew));
const slug = crew.slug;
const A = await member(slug, pid(), 'ALICE'), B = await member(slug, pid(), 'BOB'), C = await member(slug, pid(), 'CAROL'), D = await member(slug, pid(), 'DAVE');
let st = await stateUntil(A, (s) => s.members.filter((m) => m.on).length === 4);
check('opening the crew queues nobody: four here, nobody in line, no match on', st && lineOf(st).length === 0 && !st.court && !st.champ, JSON.stringify(st && { line: st.line, court: st.court }));

// ---- 1. the line ----
A.send({ t: 'play', on: true }); await sleep(120); B.send({ t: 'play', on: true });
const ma = await A.next((m) => m.t === 'match'), mb = await B.next((m) => m.t === 'match');
check('PLAY: the first two in line play, the first to press hosts', ma.role === 'host' && mb.role === 'guest' && ma.id === mb.id, `${ma.role}/${mb.role}`);
st = await stateUntil(D, (s) => !!s.court);
check('the court shows the match: ALICE (host) and BOB', st && st.court && st.court.host === A.you && st.court.guest === B.you, JSON.stringify(st && st.court));
check('a second match is never opened: one court', st && lineOf(st).length === 0);
C.send({ t: 'play', on: true }); await sleep(150); D.send({ t: 'play', on: true });
st = await stateUntil(A, (s) => lineOf(s).length === 2);
check('CAROL then DAVE wait in line, in the order they pressed: 1ST, 2ND', st && lineOf(st).join() === [C.you, D.you].join() && st.line[0].spot === 1 && st.line[1].spot === 2, JSON.stringify(st && st.line));
await sleep(200);
check('nobody waiting got a match while the court is busy', !C.q.some((m) => m.t === 'match') && !D.q.some((m) => m.t === 'match'));
C.send({ t: 'play', on: true });   // pressing again while in line keeps the place
await sleep(200);
st = await stateUntil(A, () => true);
check('PLAY again while in line keeps the place', lineOf(st).join() === [C.you, D.you].join(), JSON.stringify(st.line));

// ---- 3. watching from the line (while ALICE and BOB play) ----
const P1 = await players(ma.code);
P1.H.send(setup(1, ['ALICE', 'BOB']));
await sleep(300);
const tc = ticketOf(C), td = ticketOf(D);
check('each member in line holds a ticket for the match room', tc && td && tc.code === ma.code && td.code === ma.code && /^[0-9a-f]{32}$/.test(tc.ticket) && tc.ticket !== td.ticket, JSON.stringify({ tc, td }));
check('the two playing hold no ticket (they never asked to watch)', !(ticketOf(A) && ticketOf(A).ticket) && !(ticketOf(B) && ticketOf(B).ticket));
const W1 = await tryWatch(ma.code, tc.ticket);
check('a member in line watches: the room lets CAROL in with her ticket', W1.verdict === 'spectator', W1.verdict);
const got = await W1.next((m) => m.t === 'w' && m.ev === 'start', 4000).catch(() => null);
check('...and she gets the match on the court from the host\'s feed', got && got.n === 1 && got.names.join() === 'ALICE,BOB', JSON.stringify(got));
const bare = await tryWatch(ma.code);
check('the bare room code gets no-room', bare.verdict === 'no-room', bare.verdict);
const fake = await tryWatch(ma.code, pid());
check('a made-up ticket gets no-room', fake.verdict === 'no-room', fake.verdict);
// a member who isn't in line (a fifth, just here) and a stranger who never opened the crew
const E = await member(slug, pid(), 'ERIN');
await sleep(300);
check('a member not in line is handed no ticket', !(ticketOf(E) && ticketOf(E).ticket), JSON.stringify(ticketOf(E)));
const eTry = await tryWatch(ma.code, tc.ticket.split('').reverse().join(''));
check('a member not in line, guessing a ticket, gets no-room', eTry.verdict === 'no-room', eTry.verdict);
const crewSpec = sock(`${WS}crews/${slug}/ws?role=spectator`);
await crewSpec.open.catch(() => {});
const cs = await crewSpec.next((m) => m.t === 'error', 4000).catch(() => null);
check('the crew room still refuses a bare spectator socket', cs && cs.reason === 'no-spectators', JSON.stringify(cs));
const live = await getJson('live');
const liveRaw = JSON.stringify(live.body || {});
check('the crew\'s match is not on api/live (nor its names or code)', live.status === 200 && !liveRaw.includes(ma.code) && !/ALICE|BOB/.test(liveRaw), liveRaw.slice(0, 200));
// a spectator socket never reaches the players
W1.send('{"t":"chat","m":"hi"}'); W1.send(new Uint8Array([1, 2, 3]).buffer);
await sleep(300);
check('what a spectator sends never reaches the players', !P1.H.q.some((m) => m.t === 'chat' || m.bin) && !P1.G.q.some((m) => m.t === 'chat' || m.bin));
// DAVE watches too, then leaves the line: his ticket is taken back and the room closes him out
const W2 = await tryWatch(ma.code, td.ticket);
check('DAVE (2ND in line) watches as well', W2.verdict === 'spectator', W2.verdict);
D.send({ t: 'play', on: false });
const over = await W2.next((m) => m.t === 'w' && m.ev === 'over', 4000).catch(() => null);
const c2 = await Promise.race([W2.closed, sleep(1500).then(() => 0)]);
// (the room closes it with 4002; local workerd leaves the client in CLOSING rather than finishing the handshake)
check('LEAVE LINE: DAVE\'s spectator socket is closed out (over: line, then the room closes it)', over && over.reason === 'line' && (c2 === 4002 || W2.ws.readyState >= 2), `${JSON.stringify(over)} close ${c2} state ${W2.ws.readyState}`);
st = await stateUntil(A, (s) => lineOf(s).length === 1);
check('LEAVE LINE: DAVE is out of the line, CAROL is still 1ST', st && lineOf(st).join() === C.you && st.line[0].spot === 1, JSON.stringify(st && st.line));
const again = await tryWatch(ma.code, td.ticket);
check('his old ticket gets no-room now', again.verdict === 'no-room', again.verdict);
check('DAVE is told he holds no ticket', ticketOf(D) && ticketOf(D).match === '', JSON.stringify(ticketOf(D)));
for (const s of [bare, fake, eTry, again, W2, crewSpec]) s.close();
// DAVE back in line (the end of it); ERIN in line after him
D.send({ t: 'play', on: true }); await sleep(150); E.send({ t: 'play', on: true });
st = await stateUntil(A, (s) => lineOf(s).length === 3);
check('PLAY again puts DAVE at the end: CAROL, DAVE, ERIN', st && lineOf(st).join() === [C.you, D.you, E.you].join(), JSON.stringify(st && st.line));
// a dropped socket back soon gets its old place
E.close(); await sleep(400);
st = await stateUntil(A, (s) => lineOf(s).length === 2);
check('ERIN\'s socket drops: out of the line, the rest stay', st && lineOf(st).join() === [C.you, D.you].join(), JSON.stringify(st && st.line));
const E2 = await member(slug, E.pid, 'ERIN');
E2.send({ t: 'play', on: true });
st = await stateUntil(A, (s) => lineOf(s).length === 3);
check('ERIN back within 20 s: her old place, at the end after DAVE', st && lineOf(st).join() === [C.you, D.you, E2.you].join(), JSON.stringify(st && st.line));

// ---- 2. winner stays on ----
A.drain(); B.drain(); C.drain(); D.drain(); E2.drain();
A.send({ t: 'result', match: ma.id, n: 1, winner: 0, wins: [2, 1], chars: ['courier', 'intern'], secs: 60 });
const ra = await A.next((m) => m.t === 'rotate'), rb = await B.next((m) => m.t === 'rotate');
check('ALICE wins with three waiting: both are told, ALICE stays, CAROL is next', ra.stay === A.you && rb.stay === A.you && ra.next === 'CAROL', JSON.stringify(ra));
check('BOB is told his place: the back of the line, 3RD once CAROL steps up', rb.spot === 3, String(rb.spot));
st = await stateUntil(C, (s) => !s.court && lineOf(s).length === 5);
check('the line: ALICE at the front, then CAROL, DAVE, ERIN, and BOB at the back, by himself', st && lineOf(st).join() === [A.you, C.you, D.you, E2.you, B.you].join(), JSON.stringify(st && st.line));
check('ALICE is the champ, 1 straight', st && st.champ && st.champ.id === A.you && st.champ.streak === 1, JSON.stringify(st && st.champ));
check('while their pages are on the result screen nobody is paired yet', !A.q.some((m) => m.t === 'match') && !C.q.some((m) => m.t === 'match'));
A.send({ t: 'lobby' }); B.send({ t: 'lobby' });   // their pages come back (crewEnter)
const m2a = await A.next((m) => m.t === 'match'), m2c = await C.next((m) => m.t === 'match');
check('the champ plays the first in line: ALICE hosts CAROL', m2a.id === m2c.id && m2a.role === 'host' && m2c.role === 'guest' && m2a.rival.name === 'CAROL', `${m2a.role}/${m2c.role}`);
st = await stateUntil(B, (s) => !!s.court && s.court.match === m2a.id);
check('BOB stayed in line by himself, at the back: DAVE 1ST, ERIN 2ND, BOB 3RD', st && lineOf(st).join() === [D.you, E2.you, B.you].join() && st.line[2].spot === 3, JSON.stringify(st && st.line));
check('the champ is marked on the court: ALICE, 1 straight', st && st.champ && st.champ.id === A.you && st.champ.streak === 1);
await sleep(300);
const tb = ticketOf(B);
check('BOB, back in line, watches the new match: a ticket for its room', tb && tb.code === m2a.code && /^[0-9a-f]{32}$/.test(tb.ticket), JSON.stringify(tb));
const W1end = await Promise.race([W1.closed.then(() => 'closed'), sleep(300).then(() => 'open')]);
check('CAROL, up now, holds no ticket any more', ticketOf(C) && ticketOf(C).match === '', `${JSON.stringify(ticketOf(C))} ${W1end}`);
W1.close(); P1.close();
// a draw changes nothing
A.drain(); C.drain();
A.send({ t: 'result', match: m2a.id, n: 1, winner: -1, wins: [1, 1], chars: ['courier', 'chef'], secs: 60 });
await sleep(600);
st = await stateUntil(D, () => true);
check('a draw changes nothing: no rotation, the same two on the court, the line as it was', !A.q.some((m) => m.t === 'rotate') && st.court && st.court.match === m2a.id && lineOf(st).join() === [D.you, E2.you, B.you].join(), JSON.stringify({ court: st.court, line: st.line }));
check('a draw leaves the streak alone (1)', st.champ && st.champ.id === A.you && st.champ.streak === 1, JSON.stringify(st.champ));
// the champ wins again: 2 straight, CAROL to the back
A.send({ t: 'result', match: m2a.id, n: 2, winner: 0, wins: [2, 0], chars: ['courier', 'chef'], secs: 60 });
const rc = await C.next((m) => m.t === 'rotate');
check('ALICE wins again: CAROL to the back, 3RD once DAVE steps up', rc.stay === A.you && rc.spot === 3, String(rc.spot));
st = await stateUntil(D, (s) => s.champ && s.champ.streak === 2);
check('the streak: ALICE, 2 straight', st && st.champ && st.champ.id === A.you && st.champ.streak === 2, JSON.stringify(st && st.champ));
check('the line: ALICE, DAVE, ERIN, BOB, CAROL', st && lineOf(st).join() === [A.you, D.you, E2.you, B.you, C.you].join(), JSON.stringify(st && st.line));
// the champ leaves while at the front: the first two in line play each other
D.drain(); E2.drain();
A.close();
C.send({ t: 'lobby' });
const m3d = await D.next((m) => m.t === 'match', 8000).catch(() => null), m3e = await E2.next((m) => m.t === 'match', 8000).catch(() => null);
check('the champ leaves: the first two in line (DAVE, ERIN) play each other', m3d && m3e && m3d.id === m3e.id && m3d.role === 'host', `${m3d && m3d.role}/${m3e && m3e.role}`);
st = await stateUntil(B, (s) => !!s.court && m3d && s.court.match === m3d.id);
check('the crown goes with her: no champ until someone wins', st && !st.champ, JSON.stringify(st && st.champ));
check('the rest move up: BOB 1ST, CAROL 2ND', st && lineOf(st).join() === [B.you, C.you].join() && st.line[0].spot === 1, JSON.stringify(st && st.line));
// someone in line drops out: the rest move up
B.close();
st = await stateUntil(C, (s) => lineOf(s).length === 1);
check('BOB drops out of the line: CAROL moves up to 1ST', st && lineOf(st).join() === C.you && st.line[0].spot === 1, JSON.stringify(st && st.line));
// the rival of a match goes back to the crew mid-match: the court frees, the next two play
D.drain(); E2.drain(); C.drain();
const F = await member(slug, pid(), 'FRAN');
F.send({ t: 'play', on: true });
await stateUntil(C, (s) => lineOf(s).length === 2);
E2.send({ t: 'lobby' });   // ERIN went back to the crew (the room told DAVE ERIN WENT BACK TO THE CREW)
D.send({ t: 'lobby' });
const m4c = await C.next((m) => m.t === 'match', 6000).catch(() => null), m4f = await F.next((m) => m.t === 'match', 6000).catch(() => null);
check('a match left mid-way frees the court: CAROL and FRAN play', m4c && m4f && m4c.id === m4f.id, `${m4c && m4c.role}/${m4f && m4f.role}`);

for (const s of [A, B, C, D, E, E2, F]) s.close();
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} checks passed`);
process.exit(pass === results.length ? 0 : 1);
