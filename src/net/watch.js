// Watching a quick online match (README, Multiplayer, Spectators). A spectator opens the room's watch socket
// (GET api/rooms/<code>/watch), gets the match's setup and the inputs both players' machines have confirmed,
// and runs the same deterministic sim on them: no rollback, no guessing, nothing sent back.
//
//   const watch = createWatch({ sim, startMatch, endMatch })
//   watch.open(code)            connect (it reconnects by itself after a drop, and picks the match back up)
//   watch.leave()               hang up
//   watch.advance(ms)           main.js steps the sim through this while watch.active
//   watch.on('status' | 'start' | 'end' | 'over' | 'count' | 'desync', fn)
//   watch.view()                everything the watch screen shows
//
// From the room: {t:'sys', ev:'welcome'|'error'}, {t:'w', ev:'start', ...setup}, {t:'w', ev:'idle'} (no match
// right now), batches of inputs (watchlog.js), the host's resync if it sends one (the same {t:'sync'} parts the
// guest gets), {t:'w', ev:'end', n, f, wins, winner, tally} (the match ended on frame f), {t:'w', ev:'over',
// reason} (a player left, or the host closed the room to spectators) and {t:'w', ev:'count', n}.
//
// Pace. Each batch carries the host's clock at its last frame. The room only hands over frames HOLD_MS old,
// and this side plays BUFFER_MS behind what it has, so the picture is about 2.5 seconds behind the fight and
// smooth through an uneven network. It steps at the sim's own speed (main.js passes the KO slow motion in ms,
// as it does for a player) and leans up to 50% faster or 15% slower to stay on the host's timeline. More than
// CATCHUP frames behind (joining mid-match, or back from a hidden tab) it stops drawing and runs the sim flat
// out, with every effect muted, until it's back.
//
// Checks. Every 30th frame is hashed like the players' and compared with the host's hash from the batch; a
// difference shows as OUT OF SYNC. A build with another NET_VERSION never starts: the screen says the match is
// on a newer or an older version.

import { apiUrl } from './link.js';
import { NET_VERSION, cleanRules } from './online.js';
import { createLog, decodeBatch, cleanSetup, hashHex, HOLD_MS } from './watchlog.js';
import { hashSim } from './hash.js';
import { decodeInput } from './codec.js';
import { decodeState } from './state.js';

const STEP_MS = 1000 / 120;
export const BUFFER_MS = 900;     // behind the newest frames the room has released
const BUFFER_MAX_MS = 2400;       // on a network that keeps running it dry, the buffer grows to this
const STAMP_GAP_MS = 500;         // the host stamps this often (watchfeed.js UPLOAD_MS)
const CATCHUP = 360;              // frames behind the host's timeline before the sim runs undrawn (3 s)
const CATCHUP_BUDGET_MS = 14;     // of each animation frame, while catching up
const HASH_EVERY = 30;
const SILENT_MS = 12000;          // a match on and nothing from the room this long: the socket is dead
const PING_MS = 20000, PONG_MS = 45000;
const RETRIES = 6;
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const mute = () => false;

/** the default socket: the room's watch endpoint */
function openSocket(code) {
  const ws = new WebSocket(apiUrl(`rooms/${encodeURIComponent(code)}/watch`, true));
  ws.binaryType = 'arraybuffer';
  /** @type {any} */
  const s = { send(d) { if (ws.readyState === WebSocket.OPEN) ws.send(d); }, close() { try { ws.close(1000, 'bye'); } catch { /* gone */ } }, onmessage: null, onclose: null };
  ws.onmessage = (e) => { if (s.onmessage) s.onmessage(e.data); };
  ws.onclose = (e) => { if (s.onclose) s.onclose(e.code); };
  return s;
}

/**
 * @param {{ sim: any, startMatch: (o: any) => void, endMatch: (reason: string) => void, openSocket?: (code: string) => any, now?: () => number }} game
 */
export function createWatch(game) {
  /** @type {Record<string, Function[]>} */
  const handlers = {};
  const emit = (ev, ...a) => { for (const f of handlers[ev] || []) { try { f(...a); } catch (e) { console.error(e); } } };
  const now = game.now || (() => performance.now());
  const sim = game.sim;
  /** @type {any} */ let sock = null;
  let code = '', state = 'idle', detail = '', count = 0, session = 0, retries = 0, retryTimer = 0, beat = 0;
  let heardAt = 0, pongAt = 0, pingAt = 0;
  /** @type {any} */ let m = null;        // the match being watched
  /** @type {any} */ let result = null;   // the last match's result, while the room is between matches
  const cur = [decodeInput(0), decodeInput(0)];
  const totals = { checks: 0, bad: 0, matches: 0, catchMs: 0, catchFrames: 0, starved: 0, resyncs: 0 };

  function setState(s, d = '') { if (s === state && d === detail) return; state = s; detail = d; emit('status', s, d); }

  // ---- the socket -------------------------------------------------------------------------------
  function connect() {
    const mine = ++session;
    clearTimeout(retryTimer);
    let refused = '';
    const s = (game.openSocket || openSocket)(code);
    sock = s;
    heardAt = pongAt = now();
    s.onmessage = (data) => {
      if (mine !== session) return;
      heardAt = now();
      if (typeof data !== 'string') { onBatch(data); return; }
      if (data === 'pong') { pongAt = heardAt; return; }
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (msg.t === 'sys') {
        if (msg.ev === 'error') { refused = String(msg.reason || 'lost'); return; }
        if (msg.ev === 'welcome') { retries = 0; setCount(msg.watching | 0); if (!m) setState('waiting'); }
        return;
      }
      if (msg.t === 'sync') { onSync(msg); return; }
      if (msg.t !== 'w') return;
      if (msg.ev === 'start') onStart(msg);
      else if (msg.ev === 'idle') { if (m && !m.done) drop('ended'); else if (!m) setState('waiting'); }
      else if (msg.ev === 'count') setCount(msg.n | 0);
      else if (msg.ev === 'end') { if (m && (msg.n | 0) === m.setup.n) m.end = { f: msg.f | 0, wins: [msg.wins && msg.wins[0] | 0, msg.wins && msg.wins[1] | 0], winner: msg.winner | 0, tally: msg.tally || null }; }
      else if (msg.ev === 'over') drop(String(msg.reason || 'left'));
    };
    s.onclose = (c) => {
      if (mine !== session) return;
      sock = null;
      // refused, or the room emptied: that's the end of it. Anything else is the network: try again
      if (refused) { fail(refused); return; }
      if (c === 4002) { fail('closed'); return; }
      if (c === 4008) { fail('flood'); return; }
      retry();
    };
  }
  function retry() {
    if (retries >= RETRIES) { fail('lost'); return; }
    const wait = Math.min(8000, 500 * 2 ** retries++);
    if (!m || m.done) setState('connecting', 'again');
    retryTimer = /** @type {any} */ (setTimeout(() => { if (code && !sock) connect(); }, wait));
  }
  /** it's over for good (the room refused, closed, or can't be reached): the match ends for this viewer */
  function fail(reason) {
    const was = !!m;
    hangUp();
    m = null; result = null;
    setState('error', reason);
    if (was) game.endMatch(reason);
    emit('over', reason);
  }
  function hangUp() {
    session++;
    clearTimeout(retryTimer); clearInterval(beat); beat = 0;
    if (sock) { const s = sock; sock = null; try { s.close(); } catch { /* gone */ } }
  }
  function setCount(n) { if (n !== count) { count = n; emit('count', n); } }
  // between matches nothing flows, so a "ping" now and then tells a dead socket from a quiet room (the room
  // answers without waking); in a match the batches are the heartbeat
  function heartbeat() {
    const t = now();
    if (!sock) return;
    if (m && !m.done && !m.end) { if (t - heardAt > SILENT_MS) { hangUp(); retry(); beat = /** @type {any} */ (setInterval(heartbeat, 1000)); } return; }
    if (t - pingAt > PING_MS) { pingAt = t; sock.send('ping'); }
    if (t - Math.max(pongAt, heardAt) > PONG_MS) { hangUp(); retry(); beat = /** @type {any} */ (setInterval(heartbeat, 1000)); }
  }

  // ---- a match ------------------------------------------------------------------------------------
  function onStart(msg) {
    const setup = cleanSetup(msg);
    if (!setup) return;
    if (setup.v !== NET_VERSION) {   // another build's sim: it would drift from the players' within seconds
      hangUp(); m = null;
      setState('error', setup.v > NET_VERSION ? 'newer' : 'older');
      emit('over', detail);
      return;
    }
    // the same match again (a reconnect): keep playing from where this side is; the log takes only what's new
    if (m && !m.done && m.setup.n === setup.n && m.setup.seed === setup.seed) { m.setup.names = setup.names; return; }
    m = {
      setup, log: createLog(setup.n & 255), frame: 0, acc: 0, off: Infinity, end: null, done: false, catching: false, buffer: BUFFER_MS, dryAt: 0, starved: false,
      hashes: new Map(), checks: 0, bad: 0, badAt: [], badSince: 0, floor: 0, syncs: [], parts: new Map(), startedAt: now(),
    };
    result = null; totals.matches++;
    cur[0] = cur[1] = decodeInput(0);
    game.startMatch({ seed: setup.seed, chars: setup.chars, botch: setup.botch, rules: cleanRules(setup.rules), lockstep: ctl, names: setup.names, watch: true });
    setState('buffering');
    emit('start', view());
  }
  function onBatch(buf) {
    const b = decodeBatch(buf);
    if (!b || !m || m.done || b.match !== (m.setup.n & 255)) return;
    if (!m.log.add(b)) { hangUp(); retry(); return; }   // a hole (never: the socket is ordered): ask for it all again
    // the host's clock against this one: the quickest delivery seen is the room's hold plus the trip
    m.off = Math.min(m.off, now() - b.t);
  }
  /** the host's resync, in parts: its state for the start of a frame, loaded when the playback gets there */
  function onSync(msg) {
    if (!m || m.done || (msg.m | 0) !== (m.setup.n & 255)) return;
    const k = String(msg.id), of = msg.of | 0, i = msg.i | 0;
    if (of < 1 || of > 64 || i < 0 || i >= of || typeof msg.d !== 'string') return;
    let p = m.parts.get(k);
    if (!p) { p = { f: msg.f | 0, of, parts: new Array(of), got: 0 }; m.parts.set(k, p); }
    if (p.parts[i] == null) { p.parts[i] = msg.d; p.got++; }
    if (p.got !== p.of) return;
    m.parts.delete(k);
    if (m.syncs.some((s) => s.f === p.f)) return;
    m.syncs.push({ f: p.f, text: p.parts.join('') });
    m.syncs.sort((a, b) => a.f - b.f);
    m.floor = Math.max(m.floor, p.f);   // the host's hashes before it are of a state the host has since replaced
    // ...so a difference already counted back there was the host's sim being off, not this one: it's put right at p.f
    const gone = m.badAt.filter((f) => f < p.f).length;
    if (gone) { m.badAt = m.badAt.filter((f) => f >= p.f); m.bad -= gone; totals.bad -= gone; if (!m.bad) m.badSince = 0; }
    if (p.f < m.frame) {   // already past it (never: the room holds frames back longer than a resync takes): reload and run back up
      const was = m.frame;
      m.frame = p.f;
      while (m.frame < was) step(true);
    }
  }
  function step(quiet) {
    const f = m.frame;
    while (m.syncs.length && m.syncs[0].f <= f) {
      const s = m.syncs.shift();
      if (s.f !== f) continue;
      try { sim.loadState(decodeState(sim, s.text)); m.resyncs = (m.resyncs || 0) + 1; totals.resyncs++; } catch (e) { console.warn('[watch] resync: bad state', e); }
    }
    cur[0] = decodeInput(m.log.code(f, 0)); cur[1] = decodeInput(m.log.code(f, 1));
    if (quiet) sim.eventFilter = mute;
    try { sim.tick(); } finally { if (quiet) sim.eventFilter = null; }
    m.frame = f + 1;
    if ((f + 1) % HASH_EVERY === 0) {
      const h = hashSim(sim), theirs = m.log.hashAt(f);
      m.hashes.set(f, h);
      if (m.hashes.size > 512) m.hashes.delete(m.hashes.keys().next().value);
      if (theirs >= 0 && f >= m.floor) {
        m.checks++; totals.checks++;
        if (hashHex(theirs) !== h) {
          m.bad++; totals.bad++; m.badAt.push(f);
          if (m.bad === 1) m.badSince = now();
          if (m.bad === 1) { console.warn(`[watch] OUT OF SYNC at frame ${f}: here ${h}, the host ${hashHex(theirs)}`); emit('desync', { frame: f, local: h, remote: hashHex(theirs) }); }
        }
      }
    }
  }
  /** the match ended on its last frame: the sim holds on the WINS card, the room may start another */
  function finish() {
    m.done = true;
    const s = m.setup, e = m.end;
    result = { n: s.n, winner: e.winner, wins: e.wins, names: s.names, chars: s.chars, tally: e.tally, hash: hashSim(sim), frame: m.frame, checks: m.checks, bad: m.bad };
    setState('result');
    emit('end', result);
  }
  /** the match stopped short (a player left, the link died, the host closed the room to spectators) */
  function drop(reason) {
    const was = !!m && !m.done;
    if (reason === 'off') { fail('off'); return; }
    if (was) { m = null; result = null; game.endMatch(reason); setState('over', reason); emit('over', reason); }
    else if (m && m.done) setState('result', reason);   // the players left after the result: the screen says so
    else setState('waiting');
  }

  const ctl = {
    /** the sim's controller for unit i: the input the log holds for the frame being stepped */
    controller(i) { const fn = () => cur[i]; fn.label = (m && m.setup.names[i]) || `P${i + 1}`; return fn; },
  };

  function view() {
    const s = m && m.setup;
    const lim = m ? (m.end ? Math.min(m.end.f, m.log.frames) : m.log.frames) : 0;
    const want = m && Number.isFinite(m.off) ? Math.min(lim, m.log.framesAt(now() - m.off - m.buffer)) : 0;
    return {
      state, detail, code, count,
      n: s ? s.n : 0, names: s ? s.names : ['', ''], chars: s ? s.chars : ['', ''], tally: s ? s.tally : null,
      frame: m ? m.frame : 0, frames: m ? m.log.frames : 0,
      /** how far through a catch-up it is, 0..1 */
      progress: m && m.catching && want > 0 ? Math.min(1, m.frame / want) : 1,
      // (like the players' DESYNC: only a difference no resync from the host has put right within 3 seconds)
      outOfSync: !!(m && m.bad && now() - m.badSince > 3000), result,
    };
  }

  const watch = {
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return () => { const l = handlers[ev], i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; },
    /** watch the room with this code */
    open(c) {
      watch.leave();
      c = String(c || '').trim().toUpperCase();
      if (!CODE_RE.test(c)) { setState('error', 'bad-code'); return false; }
      code = c; retries = 0; count = 0; result = null;
      setState('connecting');
      connect();
      beat = /** @type {any} */ (setInterval(heartbeat, 1000));
      return true;
    },
    leave() {
      const was = !!m;
      hangUp();
      m = null; result = null; code = ''; count = 0;
      if (state !== 'idle') setState('idle');
      if (was) game.endMatch('left');
    },
    /** main.js steps the sim here while a match is being watched (ms already scaled for the KO slow motion) */
    advance(ms) {
      if (!m || m.done) return 0;
      const lim = m.end ? Math.min(m.end.f, m.log.frames) : m.log.frames;
      if (m.end && m.frame >= m.end.f) { finish(); return 0; }
      // where the host was, the hold and the buffer ago
      const t = now();
      const want = Number.isFinite(m.off) ? Math.min(lim, m.log.framesAt(t - m.off - m.buffer)) : 0;
      const behind = want - m.frame;
      if (m.catching || behind > CATCHUP) {
        m.catching = true;
        setState('catching');
        const t0 = performance.now(), from = m.frame;
        while (m.frame < want && performance.now() - t0 < CATCHUP_BUDGET_MS) step(true);
        totals.catchMs += performance.now() - t0; totals.catchFrames += m.frame - from;
        if (m.frame >= want) { m.catching = false; m.acc = 0; }
        return m.frame - from;
      }
      if (m.frame >= lim) {
        // out of frames. If the newest stamp is as fresh as the room's hold allows, the players themselves are
        // waiting (the host stamps a stall too); if it's stale, this side's network is behind, and a bigger
        // buffer rides the next one out
        m.acc = 0;
        if (!m.dryAt) m.dryAt = t;
        if (!m.starved && m.frame > 0 && !m.end && t - m.off - m.log.newest > STAMP_GAP_MS + 300) { m.starved = true; totals.starved++; m.buffer = Math.min(BUFFER_MAX_MS, m.buffer + 250); }
        if (t - m.dryAt > 500 && t - m.startedAt > 600) setState('buffering');
        return 0;
      }
      m.dryAt = 0; m.starved = false;
      if (behind < -12 || (m.frame === 0 && want < 1)) { m.acc = 0; return 0; }   // ahead of the host's timeline (or not begun): hold
      setState('live');
      const k = Math.max(0.85, Math.min(1.5, 1 + behind / 240));
      m.acc = Math.min(m.acc + ms * k, 120);
      let stepped = 0;
      while (m.acc >= STEP_MS && m.frame < lim) { step(false); m.acc -= STEP_MS; stepped++; }
      if (m.end && m.frame >= m.end.f) finish();
      return stepped;
    },
    controller: ctl.controller,
    view,
    /** a match is on this page's sim (playing, or held on its last frame): main.js leaves the sim to advance() */
    get active() { return !!m; },
    /** running the sim undrawn to catch up: main.js skips the draw */
    get catching() { return !!(m && m.catching); },
    get state() { return state; },
    get detail() { return detail; },
    get code() { return code; },
    get count() { return count; },
    /** the ?watch=CODE on the page's URL, or '' */
    codeFromUrl() { const c = (new URLSearchParams(location.search).get('watch') || '').toUpperCase(); return CODE_RE.test(c) ? c : ''; },
    /** tests: this side's hash of a frame, and the tallies */
    hashAt(f) { return m ? m.hashes.get(f) || null : null; },
    get hashes() { return m ? m.hashes : new Map(); },
    stats() { return { state, detail, code, count, frame: m ? m.frame : 0, frames: m ? m.log.frames : 0, checks: m ? m.checks : 0, bad: m ? m.bad : 0, resyncs: m ? m.resyncs || 0 : 0, off: m ? m.off : 0, buffer: m ? m.buffer : BUFFER_MS, hold: HOLD_MS, totals: { ...totals }, result }; },
  };
  return watch;
}

/** the LIVE list (GET api/live): the quick matches on right now, the most watched first; null if it can't be had */
export async function fetchLive() {
  try {
    const res = await fetch(apiUrl('live'), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const body = await res.json();
    return (Array.isArray(body.live) ? body.live : []).filter((r) => r && CODE_RE.test(r.code) && Array.isArray(r.chars) && Array.isArray(r.names) && Array.isArray(r.wins));
  } catch { return null; }
}

/** a link that opens the game on this room's match */
export function watchUrl(code) {
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('watch', code);
  return u.toString();
}
