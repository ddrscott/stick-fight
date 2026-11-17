// The crew room's lobby connection (worker/crew.ts): one WebSocket to the crew's Durable Object,
// open while the player is in the crew lobby or in a match the crew started. It carries presence,
// PLAY, the standings and the results; the match itself runs in a quick room (online.js) the crew
// opens for the two players.
//
//   const crew = createCrew()
//   crew.connect(slug, { pid, name, title })   open (or switch to) a crew; reconnects by itself if dropped
//                          (title: the player's job title, shown beside their initials on the crew goal)
//   crew.on('state' | 'match' | 'rotate' | 'watch' | 'goalpay' | 'error' | 'status', fn)
//                          goalpay: the crew's weekly goal was met and paid this player (src/career/store.js fromCrewGoal)
//                          watch: { match, code, ticket } while this member is in line and a match is on the court
//                          (the ticket lets src/net/watch.js into that match room), null when not
//   crew.play(on)          PLAY: the end of the line (README, Crew rooms, Champ of the Court); off: LEAVE LINE
//   crew.lobby(title?)     back in the lobby after a match (with the title, which a promotion may have changed)
//   crew.result(r)         the host reports a match: { match, n, winner, wins, chars }
//   crew.rename(name)
//   crew.close()
//   crew.state             the last state ({ crew, members, h2h, recent, court, champ, line }), crew.you (this member's id)
//   crew.watching          the last watch ticket ({ match, code, ticket }) or null
//   crew.spot              this member's place in line: -1 not in it, 0 up now, 1, 2, 3...
//   crew.refused           the server's reason we're not in yet ('busy', 'flood'), '' once welcomed
//   crew.wake(why)         the page woke or the network changed: redial now, or probe a quiet socket (wired to
//                          visibilitychange, pageshow from the bfcache, online and a connection change already)

import { apiUrl } from './link.js';
import { linkUrl } from '../links.js';
import { track } from '../analytics.js';

// Getting into the lobby fast and staying there (README, Crew rooms, Connecting). The room itself answers in
// about 300 ms; what used to cost 15 s and more was waiting: on a socket stuck in CONNECTING (the OS gives up on
// a TCP handshake after a minute or more), on a dead socket nothing ever closed, and on 1/2/4/8 s of backoff.
export const CONNECT_TRY_MS = 3000;   // a socket not welcomed this long after it was opened is dropped and redialed
export const PING_EVERY_MS = 2000;    // the lobby meter's ping, which is also the liveness check
export const PONG_MS = 6000;          // a ping with no pong this long: the socket is dead though nothing closed it
export const PROBE_MS = 1500;         // the page woke or the network came back: a ping with this long to answer
export const QUIET_MS = 4000;         // ...sent only when nothing has come in for this long (a busy socket is fine)
export const RETRY_MS = [0, 250, 500, 1000, 2000, 3000];   // between tries; the last one repeats
export const BUSY_RETRY_MS = [3000, 6000, 10000, 15000];   // after a 'busy' refusal (the join limit): trying fast only spends more of it
const ABANDON = 4100;                  // the close code for a socket the page gave up on (as src/net/link.js)
const FATAL = new Set(['no-crew', 'crew-full', 'bad-hello', 'full', 'deleted', 'removed']);   // deleted: this profile was deleted (worker/crew.ts forget); removed: an admin took the member out
/** refusals worth saying on the status line instead of RECONNECTING (src/flow/index.js) */
export const REFUSALS = new Set(['busy', 'flood']);

/**
 * @param {{ WebSocket?: any, now?: () => number, setTimeout?: Function, clearTimeout?: Function, setInterval?: Function,
 *   clearInterval?: Function, on?: (ev: string, fn: () => void) => () => void, track?: Function, url?: (slug: string) => string }} [io]
 *   the browser's pieces by default; the test swaps them
 */
export function createCrew(io = {}) {
  const g = /** @type {any} */ (globalThis);
  const WS = io.WebSocket || g.WebSocket;
  const now = io.now || (() => performance.now());
  const later = io.setTimeout || ((f, ms) => g.setTimeout(f, ms)), cancel = io.clearTimeout || ((k) => g.clearTimeout(k));
  const every = io.setInterval || ((f, ms) => g.setInterval(f, ms)), stopEvery = io.clearInterval || ((k) => g.clearInterval(k));
  const tell = io.track || track;
  const urlOf = io.url || ((s) => apiUrl(`crews/${encodeURIComponent(s)}/ws`, true).href);
  /** @type {Record<string, Function[]>} */
  const handlers = {};
  const emit = (ev, ...a) => { for (const f of handlers[ev] || []) { try { f(...a); } catch (e) { console.error(e); } } };
  /** @type {any} */ let ws = null;
  let slug = '', hello = null, want = false, tries = 0, timer = 0, tryTimer = 0, status = 'closed';
  /** @type {any} */ let state = null;
  let you = '', ready = false;
  /** @type {null | { match: string, code: string, ticket: string }} */ let watching = null;
  // why we're reconnecting, when the server said (busy, flood): the status line shows it instead of RECONNECTING
  let refused = '';
  // telemetry (README, Analytics, crew_link): when this stretch of trying began, how many tries it took, why it dropped
  let downAt = 0, attempts = 0, dropCode = 0, dropWhy = '', welcomedOnce = false, upAt = 0;
  let heard = 0, dialAt = 0;   // the last time anything came in on the socket; when this socket was dialed

  function setStatus(s) { if (s !== status) { status = s; emit('status', s); } }
  function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
  // the lobby's connection meter (src/net/meter.js): a ping every PING_EVERY_MS, which the crew room answers 'pong'
  // itself without waking (worker/crew.ts); the round trip and its jitter. A ping unanswered for PONG_MS ends the socket.
  let pingOut = 0, pingDue = 0, qRtt = 0, qJit = 0, qN = 0, pinger = 0;
  function ping(deadline = PONG_MS) {
    if (!ws || ws.readyState !== 1 || status !== 'open') return;
    const t = now();
    if (pingOut) { pingDue = Math.min(pingDue, t + deadline); return; }
    pingOut = t; pingDue = t + deadline;
    try { ws.send('ping'); } catch { /* the watchdog sees it */ }
  }
  /** the 2 s tick: the next ping, and the watchdog on the last one */
  function tick() {
    if (!ws || status !== 'open') return;
    if (pingOut && now() > pingDue) { dead('silent'); return; }
    ping();
  }
  /** give up on this socket (it hung in the handshake, or went silent) and dial again at once */
  function dead(why) {
    const s = ws;
    if (!s) return;
    console.warn(`[crew] socket ${why}; redialing`);
    drop(s, ABANDON, why);
    try { s.close(ABANDON, why); } catch { /* */ }
  }
  /** this socket is done: forget it and dial again (or stop, when nothing wants the crew any more) */
  function drop(s, code, why) {
    if (ws !== s) return;
    ws = null; cancel(tryTimer); stopEvery(pinger); pingOut = 0; qN = 0;
    s.onopen = s.onmessage = s.onclose = s.onerror = null;
    if (status === 'open') {   // a socket the room had welcomed: one drop, then the reconnect's tries
      downAt = now(); attempts = 0; dropCode = code; dropWhy = why;
      tell('crew_link', ['drop', String(code), why || '-', String((typeof document !== 'undefined' && document.visibilityState) || '-')], Math.round(now() - upAt));
    }
    if (!want) { setStatus('closed'); return; }
    setStatus('reconnecting');
    const wait = refused === 'busy' ? BUSY_RETRY_MS[Math.min(tries, BUSY_RETRY_MS.length - 1)] : RETRY_MS[Math.min(tries, RETRY_MS.length - 1)];
    tries++;
    cancel(timer);
    timer = later(open, wait);
  }
  function open() {
    cancel(timer); cancel(tryTimer);
    if (!want) return;
    const sock = new WS(urlOf(slug));
    ws = sock; attempts++; dialAt = now();
    if (status !== 'reconnecting') setStatus(welcomedOnce ? 'reconnecting' : 'connecting');
    // a handshake (or a hello) that hangs: drop it and dial again rather than wait on the OS
    tryTimer = later(() => { if (ws === sock && status !== 'open') dead(sock.readyState === 1 ? 'no-welcome' : 'handshake'); }, CONNECT_TRY_MS);
    sock.onopen = () => { if (ws !== sock) return; heard = now(); send({ t: 'hello', ...hello }); };
    sock.onmessage = (e) => {
      if (ws !== sock || typeof e.data !== 'string') return;
      heard = now();
      if (e.data === 'pong') {
        if (pingOut) { const ms = now() - pingOut; pingOut = 0; if (!qN) { qRtt = ms; qJit = 0; } else { qJit += (Math.abs(ms - qRtt) - qJit) * 0.25; qRtt += (ms - qRtt) * 0.25; } qN++; }
        return;
      }
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'sys' && m.ev === 'error') m = { t: 'error', reason: m.reason };   // the Worker's refusal (busy)
      if (m.t === 'welcome') {
        cancel(tryTimer);
        const first = !welcomedOnce, ms = Math.round(now() - downAt);
        you = String(m.you || ''); tries = 0; refused = ''; welcomedOnce = true; upAt = now(); setStatus('open');
        tell('crew_link', [first ? 'connect' : 'reconnect', first ? '-' : String(dropCode), first ? '-' : dropWhy || '-', String(attempts)], ms, [attempts]);
        attempts = 0; downAt = 0;
        pingOut = 0; ping(); stopEvery(pinger); pinger = every(tick, PING_EVERY_MS);
        if (ready) send({ t: 'play', on: true });   // a reconnect keeps a pending PLAY (the room keeps the place a while)
      } else if (m.t === 'state') {
        state = m;
        // the room's word on the line wins: a rotation put this member back in it, or they're out of it
        if (you && Array.isArray(m.line)) ready = m.line.some((x) => x && x.id === you);
        emit('state', m);
      } else if (m.t === 'match') { ready = false; watching = null; emit('match', m); }
      else if (m.t === 'rotate') emit('rotate', m);
      else if (m.t === 'watch') {
        watching = m.match && typeof m.code === 'string' && typeof m.ticket === 'string' ? { match: String(m.match), code: m.code, ticket: m.ticket } : null;
        emit('watch', watching);
      }
      else if (m.t === 'goalpay') emit('goalpay', m);
      else if (m.t === 'error') {
        const why = String(m.reason || 'error');
        if (FATAL.has(why)) want = false;
        if (REFUSALS.has(why)) refused = why;
        if (status !== 'open') dropWhy = why;
        emit('error', why);
        emit('status', status);   // the status line reads crew.refused
      }
    };
    sock.onclose = (e) => {
      if (ws !== sock) return;
      if (status !== 'open' && !dropWhy) dropWhy = e && e.reason ? String(e.reason).slice(0, 24) : '';
      drop(sock, (e && e.code) || 1006, (e && e.reason) || '');
    };
  }
  /** the page came back (visible, bfcache) or the network did: don't wait out a timer to find a dead socket */
  function wake(why) {
    if (!want) return;
    if (!ws || ws.readyState !== 1 || status !== 'open') {
      if (refused === 'busy') return;   // the busy backoff stands
      // waiting to retry, or a dial that's hanging: dial now
      // (a dial under a second old is left to finish: a page load's own events land while it's in flight)
      if (ws && now() - dialAt < 1000) return;
      tries = 0;
      if (ws) dead(`wake:${why}`); else { cancel(timer); open(); }
      return;
    }
    if (now() - heard > QUIET_MS) ping(PROBE_MS);   // open but quiet: it has PROBE_MS to answer
  }
  const offs = [];
  const on = io.on || ((ev, fn) => {
    if (typeof window === 'undefined') return () => {};
    if (ev === 'visible') {
      const h = () => { if (document.visibilityState === 'visible') fn(); };
      const back = (/** @type {any} */ e) => { if (e.persisted) fn(); };   // back from the bfcache (not the page's first load)
      document.addEventListener('visibilitychange', h); window.addEventListener('pageshow', back);
      return () => { document.removeEventListener('visibilitychange', h); window.removeEventListener('pageshow', back); };
    }
    window.addEventListener(ev, fn); return () => window.removeEventListener(ev, fn);
  });
  for (const ev of ['visible', 'online']) offs.push(on(ev, () => wake(ev)));
  // a network change (wifi to cellular) on Chrome and Android
  try { const c = /** @type {any} */ (globalThis.navigator)?.connection; if (c && c.addEventListener && !io.on) c.addEventListener('change', () => wake('change')); } catch { /* */ }

  const crew = {
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return () => { const l = handlers[ev]; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; },
    connect(s, who) {
      hello = { pid: who.pid, name: who.name, title: who.title || '' };
      if (s === slug && want && ws) { send({ t: 'name', name: who.name }); return; }
      crew.close();
      slug = s; want = true; tries = 0; state = null; you = ''; refused = ''; welcomedOnce = false; downAt = now(); attempts = 0; dropWhy = '';
      open();
    },
    play(on) { ready = !!on; if (!on) watching = null; send({ t: 'play', on: !!on }); },
    /** back in the lobby (or on to watch) after a match: the room keeps a rotation's place in line */
    lobby(title) { if (hello && title) hello.title = title; send({ t: 'lobby', title: title || '' }); },
    result(r) { send({ t: 'result', ...r }); },
    rename(name) { if (hello) hello.name = name; send({ t: 'name', name }); },
    close() {
      want = false; cancel(timer); cancel(tryTimer); stopEvery(pinger); pingOut = 0; qN = 0; ready = false; watching = null; refused = '';
      if (ws) { const w = ws; ws = null; w.onopen = w.onmessage = w.onclose = w.onerror = null; try { w.close(1000, 'bye'); } catch { /* gone */ } }
      slug = ''; state = null; you = ''; setStatus('closed');
    },
    get slug() { return slug; },
    /** this page's connection to the crew room, for the lobby's meter: { rtt, jitter, samples } (0 samples: no reading) */
    get quality() { return { rtt: qRtt, jitter: qJit, loss: 0, samples: status === 'open' ? qN : 0, down: status === 'reconnecting' ? 'reconnecting' : status === 'connecting' ? 'connecting' : '' }; },
    /** the server's reason we're not in (busy, flood) while reconnecting, else '' */
    get refused() { return status === 'open' ? '' : refused; },
    /** the page woke or the network changed (also wired to visibilitychange, pageshow and online) */
    wake,
    get state() { return state; },
    get you() { return you; },
    get ready() { return ready; },
    get watching() { return watching; },
    get spot() { const l = state && Array.isArray(state.line) ? state.line.find((x) => x && x.id === you) : null; return l ? l.spot | 0 : -1; },
    get status() { return status; },
    get active() { return want; },
  };
  return crew;
}

/** a new crew room: { slug, name } or { error } ('bad-name', 'busy', 'unreachable') */
export async function createCrewRoom(name) {
  try {
    const res = await fetch(apiUrl('crews'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !body.slug) return { error: (body && body.error) || (res.status === 429 ? 'busy' : 'unreachable') };
    return { slug: String(body.slug), name: String(body.name || name) };
  } catch { return { error: 'unreachable' }; }
}

/** a crew slug from what was typed or pasted (the slug, a crew/<slug> link, or an old one with ?crew=), or '' */
export function cleanSlug(raw) {
  let s = String(raw || '').trim();
  const m = s.match(/\/crew\/([^/?&#\s]+)/) || s.match(/[?&]crew=([^&#\s]+)/);
  if (m) { try { s = decodeURIComponent(m[1]); } catch { s = m[1]; } }
  s = s.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length >= 3 && s.length <= 40 ? s : '';
}

/** the crew's permanent link: <root>crew/<slug> (src/links.js) */
export function crewLink(slug) {
  return linkUrl('crew', slug).href;
}
