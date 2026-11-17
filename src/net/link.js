// The connection between two players. The room's WebSocket (worker/index.ts, one Durable
// Object per room) carries signaling and the match's control messages; game packets go over a
// WebRTC DataChannel (unordered, no retransmits) when the two browsers can reach each other,
// and through the same WebSocket otherwise (the relay). The ICE servers come from the Worker's
// /api/ice: STUN plus short-lived Cloudflare TURN credentials, so two phones behind carrier NAT can
// still get a DataChannel (through a TURN server). If that fetch fails it's public STUN only, and
// if no path opens within RTC_TIMEOUT_MS the room's WebSocket relay takes over as before.
// ?ice=relay in the page URL allows TURN candidates only (a test switch for the TURN path).
//
// ---- Staying up on a phone (README, Multiplayer, Reconnecting) ---------------------------------------------
// The timeout budget is in src/net/budget.js, written up at the top of that file: the link repairs fast and
// gives up slow, and only LOST_MS (30 s) with nothing heard from the other side on any path ends a match.
//
// The room socket. Once the room has welcomed this page, a socket that dies without the room closing it
// (close code 1006 and the like: the network lost it) is reopened with the same seat token, and the room hands
// the seat back (worker/index.ts), even if it has already noticed the old socket close (it then told the other
// page 'away', not 'left'). A dead socket isn't always closed: a phone that changes networks keeps a half-open
// one that never errors. So the page pings it every PING_MS (the room answers 'pong' itself, without waking)
// and calls it dead after PONG_MS of silence, or after PROBE_MS when the network just changed. Each reopen try
// gets CONNECT_TRY_MS (a try that hangs on a dead network would otherwise eat the whole window). The socket
// keeps trying for as long as the DataChannel is alive, and for LOST_MS once both are quiet. Control messages
// wait in an outbox meanwhile (signaling doesn't: it'd be stale), and both sides get 'rejoined' so the session
// can resend what the dead socket may have swallowed. Only when that fails does 'closed' fire.
//
// The DataChannel. Each side sends a 1-byte beat down it every BEAT_MS (old builds' parsePacket ignores it).
// Nothing on it for DC_STALE_MS: packets go over the room socket too, so the match doesn't hitch while the
// channel is in doubt. Nothing for DC_DEAD_MS, or the peer connection 'disconnected' for DISCONNECT_MS, or
// 'failed', or the channel closed: it's dead, and the link redials, which is an ICE restart done the sturdy
// way: a fresh RTCPeerConnection, so its candidates come from the network the phone is on now. Only the host
// offers (no glare); a guest that sees the channel die asks for one ({t:'redial'}). Offers carry a generation
// (g) so a late answer or candidate for an older dial is dropped. While it redials the match runs on the
// relay, and moves back to the DataChannel the moment the new one opens. A match that fell back to the relay
// at the start keeps dialing in the background the same way. Redials back off up to REDIAL_MAX_GAP_MS.
//
// Network changes. 'online', a navigator.connection change (wifi to cellular), the page becoming visible
// again, or a timer that finds it was frozen (a locked iPhone) all nudge the link: a socket that's down
// retries now, one that's up gets a probe, and the DataChannel gets PROBE_MS to show it's still alive.
//
//   const link = createLink({ code, role, forceRelay })
//   link.on('status' | 'peer' | 'control' | 'packet' | 'closed' | 'watching' | 'rejoined', fn)
//                           'rejoined' ({ who: 'self' | 'rival' | 'p2p', ms }): a dropped room socket came back
//                           (ours or the rival's), or 'p2p': the DataChannel came back after a redial
//   link.sendControl(obj)   reliable JSON through the room
//   link.sendPacket(buf)    the DataChannel when it's open, else the room (both while the channel is in doubt)
//   link.sendRoom(data)     to the room itself, not the other player: the host's spectator feed
//                           (src/net/watchfeed.js); 'watching' comes back with who's watching
//   link.mode               'connecting' | 'p2p' | 'relay'
//   link.candidate          once p2p: the local ICE candidate type in use, 'host' | 'srflx' | 'relay'
//   link.reconnecting       the room socket dropped and is being reopened
//   link.recovering         anything is being repaired: the socket, a redial, or the rival's socket is away
//   link.close()
//
// io (tests): the browser pieces the link touches, so scripts/netsim/handoff.mjs can run this very file over a
// fake network: { WebSocket, RTCPeerConnection, fetchIce, on(ev, fn) -> off, setTimeout, clearTimeout,
// setInterval, clearInterval, now }. on() takes 'online' | 'offline' | 'change' | 'visible'.

import { rootUrl } from '../root.js';
import { RTC_TIMEOUT_MS, DIRECT_TRY_MS, TURN_TRY_MS, ICE_REFETCH_MS, REDIAL_TRY_MS, REDIAL_MAX_GAP_MS, DISCONNECT_MS, BEAT_MS, DC_STALE_MS, DC_DEAD_MS, PING_MS, PONG_MS, PROBE_MS, CONNECT_TRY_MS, LOST_MS } from './budget.js';

export { RTC_TIMEOUT_MS };
export const RECONNECT_MS = LOST_MS;   // the room socket's window once the DataChannel is quiet too
const ICE_SERVERS = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const OUTBOX_MAX = 256;              // control messages held while it's down
const ICE_FETCH_MS = 2500;
const TICK_MS = 250;                 // the link's own watchdog
const FROZEN_MS = 3000;              // a watchdog tick this late: the page was frozen (a locked phone)
const CHECK_MS = 3000;
const TALKING_MS = 1500;             // the rival's packets this recent: a 'left' notice from the room is doubted
const LEFT_GRACE_MS = 5000;          // ...until their packets have stopped this long (a goodbye ends it at once)               // link.check(): the netcode's suspicion probes the socket at most this often
const ABANDON = 4100;                // the close code for a socket the page gave up on (the room reads it as the network)
const BEAT = 0xf0;                   // the old DataChannel beat's one byte (codec.js packet types are 1..3)
const PROBE = 0xf1, ECHO = 0xf2;     // the link's probe (9 bytes: the type, then the sender's clock) and its echo
const PROBES_KEPT = 40;              // the window the link's loss is measured over (20 s of probes)
const PROBE_LATE_MS = 2000;          // a probe with no echo this long is counted lost

/** The ICE servers to use: the Worker's (with TURN when it has a key), else public STUN. */
export async function fetchIceServers() {
  try {
    const res = await fetch(apiUrl('ice'), { signal: AbortSignal.timeout(ICE_FETCH_MS) });
    if (!res.ok) throw new Error(`ice ${res.status}`);
    const body = await res.json();
    if (Array.isArray(body.iceServers) && body.iceServers.length) return body.iceServers;
  } catch (e) { console.warn('[net] ice servers: STUN only', e); }
  return ICE_SERVERS;
}

/** API base: under the app's root (src/root.js), so it works at any path, the dev server included. */
export function apiUrl(path, ws = false) {
  const u = rootUrl('api/' + path);
  if (ws) u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.search = '';
  return u;
}

/** Ask the server for a new room. Resolves to its code; a failure carries .reason ('busy' on a 429). */
export async function createRoom() {
  const res = await fetch(apiUrl('rooms'), { method: 'POST' });
  if (!res.ok) {
    const err = /** @type {Error & { reason?: string }} */ (new Error(`room server said ${res.status}`));
    err.reason = res.status === 429 ? 'busy' : 'unreachable';
    throw err;
  }
  const body = await res.json();
  return String(body.code);
}

/** The real browser's pieces (see io above). */
function browserIo() {
  const g = /** @type {any} */ (globalThis);
  return {
    WebSocket: g.WebSocket, RTCPeerConnection: g.RTCPeerConnection, fetchIce: fetchIceServers,
    setTimeout: (f, ms) => g.setTimeout(f, ms), clearTimeout: (k) => g.clearTimeout(k),
    setInterval: (f, ms) => g.setInterval(f, ms), clearInterval: (k) => g.clearInterval(k),
    now: () => performance.now(),
    search: () => (g.location ? g.location.search : ''),
    /** @param {'online' | 'offline' | 'change' | 'visible'} ev @param {() => void} fn */
    on(ev, fn) {
      if (ev === 'online' || ev === 'offline') { g.addEventListener?.(ev, fn); return () => g.removeEventListener?.(ev, fn); }
      if (ev === 'visible') {
        const h = () => { if (g.document && g.document.visibilityState === 'visible') fn(); };
        g.document?.addEventListener?.('visibilitychange', h); g.addEventListener?.('pageshow', h);
        return () => { g.document?.removeEventListener?.('visibilitychange', h); g.removeEventListener?.('pageshow', h); };
      }
      const c = g.navigator && g.navigator.connection;   // Chrome and Android: wifi <-> cellular, a new network
      if (c && c.addEventListener) { c.addEventListener('change', fn); return () => c.removeEventListener('change', fn); }
      return () => {};
    },
  };
}

/**
 * @param {{ code: string, role: 'host' | 'guest', forceRelay?: boolean, rtcTimeoutMs?: number, io?: any }} o
 */
export function createLink({ code, role, forceRelay = false, rtcTimeoutMs = RTC_TIMEOUT_MS, io = null }) {
  const sys = { ...browserIo(), ...(io || {}) };
  const WS = sys.WebSocket, PC = sys.RTCPeerConnection, now = sys.now;
  const OPEN = 1;   // WebSocket.OPEN
  /** @type {Record<string, Function[]>} */
  const handlers = {};
  const emit = (ev, ...a) => { for (const f of handlers[ev] || []) f(...a); };
  const url = io && io.url ? new URL(`rooms/${encodeURIComponent(code)}/ws`, io.url()) : apiUrl(`rooms/${encodeURIComponent(code)}/ws`, true);
  url.searchParams.set('role', role);
  // this page's seat in the room: a reconnect with the same token takes the seat back (worker/index.ts)
  url.searchParams.set('seat', Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0')).join(''));
  /** @type {any} */ let ws;
  let welcomed = false, wsWelcomed = false, downSince = 0, dropCode = 0, tries = 0, retryTimer = 0, tryTimer = 0;
  let lastPeerRx = 0, leftAt = 0;   // the rival's last packet (either path); when the room said they left while still talking
  let lastWsRx = 0, lastPingAt = 0, pongSeen = false, probeAt = 0, lastPongAt = 0, lastCheck = -1e9;
  // this page's own trip to the room (ping to pong): the host screen's meter while it waits for a friend
  let pingOut = 0, sRtt = 0, sJit = 0, sN = 0;
  const ping = (t) => { lastPingAt = t; if (!pingOut) pingOut = t; try { ws.send('ping'); } catch { /* */ } };
  /** @type {string[]} */ let outbox = [];
  /** @type {any} */ let pc = null;
  /** @type {any} */ let dc = null;
  let peerPresent = false, peerAway = false, closed = false;
  // the DataChannel: the generation of the current dial (the host counts them; the guest takes the offer's),
  // when it started, whether one is wanted and when the next may go, how many in a row failed
  let gen = 0, dialing = false, dialStart = 0, firstDial = true, wantDial = false, nextDialAt = 0, dialFails = 0;
  let lastDcRx = 0, lastBeatAt = 0, beatSeen = false, discSince = 0, dcProbeAt = 0, deadSince = 0, everOpen = false;
  // which kind of dial: 'all' (every candidate: direct when the NATs allow it) or 'turn' (TURN candidates only); the
  // kind the next dial uses, the kind of the dial in progress, and the last kind that opened
  /** @type {'all' | 'turn'} */ let nextKind = 'all', curKind = 'all', goodKind = /** @type {'' | 'all' | 'turn'} */ ('');
  let guestWait = 0;   // the guest: how long to wait on the host's latest offer before the relay
  let allFails = 0;    // direct dials that failed in a row
  // the link's own measure of the packet path, from the probes: round trip, its jitter, and what share went unanswered
  let pRtt = 0, pJit = 0, pN = 0, pathKey = '';
  /** @type {{ t: number, ok: boolean }[]} */ let probes = [];
  let pktSent = 0, pktBoth = 0;   // packets sent, and how many went over both paths
  let rtcRefused = forceRelay;   // the other side can't or won't do WebRTC ({t:'relay'}), or ?relay=1
  let lastTick = now();
  /** @type {RTCIceCandidateInit[]} */ let pendingIce = [];
  // fetched now, while the room opens, so it's usually in hand by the time the peer arrives. A fetch that timed out
  // on a weak signal leaves public STUN only, which can never reach TURN: asked again before a later dial
  let iceList = ICE_SERVERS, iceAt = now(), iceFetching = /** @type {Promise<any> | null} */ (null);
  const hasTurn = (list) => (list || []).some((sv) => [].concat(sv.urls || []).some((u) => /^turns?:/.test(String(u))));
  function fetchIce() {
    iceAt = now();
    iceFetching = Promise.resolve(sys.fetchIce()).then((l) => { if (Array.isArray(l) && l.length && (hasTurn(l) || !hasTurn(iceList))) iceList = l; iceFetching = null; return iceList; }, () => { iceFetching = null; return iceList; });
    return iceFetching;
  }
  const iceReady = forceRelay ? Promise.resolve(ICE_SERVERS) : fetchIce();
  /** the ICE servers for a dial: the first fetch, or a fresh one if that had no TURN and a while has passed */
  async function iceFor() {
    await iceReady;
    if (iceFetching) return iceFetching;
    if (!forceRelay && !hasTurn(iceList) && now() - iceAt > ICE_REFETCH_MS) return fetchIce();
    return iceList;
  }
  /** TURN over UDP only (the point of a TURN dial is to get off TCP), or every TURN URL if it has none */
  function turnOnly(list) {
    const udp = list.map((sv) => ({ ...sv, urls: [].concat(sv.urls || []).filter((u) => /^turn:/.test(String(u)) && !/transport=tcp/.test(String(u))) })).filter((sv) => sv.urls.length);
    return udp.length ? udp : list.filter((sv) => hasTurn([sv]));
  }
  const relayOnly = new URLSearchParams(sys.search ? sys.search() : '').get('ice') === 'relay';
  const noRtc = () => rtcRefused || typeof PC === 'undefined' || !PC;
  const wsUp = () => !!ws && ws.readyState === OPEN && wsWelcomed && !downSince;
  const dcOpen = () => !!dc && dc.readyState === 'open';

  const link = {
    role, code,
    /** @type {'connecting' | 'p2p' | 'relay'} */
    mode: 'connecting',
    /** @type {'' | 'host' | 'srflx' | 'prflx' | 'relay'} */
    candidate: '',
    /** set once the transport is settled (p2p open, or the relay chosen) */
    ready: false,
    error: '',
    reconnecting: false,
    /** something is being repaired: our socket, the rival's (away), or a DataChannel that died mid-session */
    get recovering() { return link.reconnecting || peerAway || (everOpen && !dcOpen() && !noRtc() && peerPresent); },
    /** which way the packets go: 'direct' (a DataChannel peer to peer), 'turn' (a DataChannel through a TURN server),
     *  'relay' (the room's WebSocket, TCP), or '' before either */
    get path() { return link.mode === 'p2p' ? (link.candidate === 'relay' ? 'turn' : 'direct') : link.mode === 'relay' ? 'relay' : ''; },
    /** the link's own measure of the packet path (the probes): round trip and jitter in ms, the share of probes lost
     *  (0..1), samples taken, and the share of packets that went over both paths */
    get quality() { return { rtt: pRtt, jitter: pJit, loss: lossNow(), samples: pN, path: link.path, both: pktSent ? pktBoth / pktSent : 0 }; },
    /** this page's own trip to the room (its pings): { rtt, jitter, samples } */
    get server() { return { rtt: sRtt, jitter: sJit, loss: 0, samples: wsUp() ? sN : 0 }; },
    get peerAway() { return peerAway; },
    /** the netcode's hint that what we send isn't getting through (the rival's acks stopped moving): on the relay,
     *  ping the room socket and give it PROBE_MS to answer, instead of waiting out PONG_MS. A socket whose sends
     *  vanish while it still hears the room is found in ~2 s (the 2026-11-16 20:11 drop). At most every CHECK_MS */
    check() {
      const t = now();
      if (closed || !welcomed || downSince || link.mode !== 'relay' || probeAt || t - lastCheck < CHECK_MS) return;
      if (!(ws && ws.readyState === OPEN && pongSeen)) return;
      lastCheck = t; probeAt = t; pingOut = 0; ping(t);
    },
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return link; },
    sendControl(obj) { sendCtl(obj, false); },
    /** @param {ArrayBuffer} buf @param {boolean} [both] the netcode thinks the path is shaky: the room socket too */
    sendPacket(buf, both = false) {
      let sent = false;
      if (dcOpen()) { try { dc.send(buf); sent = true; } catch { /* fall through to the relay */ } }
      // the room too when the channel is in doubt: it has never delivered anything (opened, but silent), or nothing
      // has come over it lately, or the netcode asks (late acks, loss, jitter: src/net/rollback.js shaky())
      const doubt = sent && (both || !beatSeen || now() - lastDcRx > DC_STALE_MS);
      pktSent++;
      if ((!sent || doubt) && ws && ws.readyState === OPEN && !downSince) { try { ws.send(buf); if (sent) pktBoth++; } catch { /* closing */ } }
    },
    /** to the room itself (a {t:'watch'} message as text, or a batch of confirmed inputs): never passed on
     *  @param {string | ArrayBuffer} data */
    sendRoom(data) { if (ws && ws.readyState === OPEN && !downSince) ws.send(data); },
    close() {
      if (closed) return;
      closed = true;
      stopTimers();
      try { if (ws && ws.readyState === OPEN) ws.send(JSON.stringify({ t: 'bye' })); } catch { /* gone */ }
      teardownRtc();
      try { ws.close(1000, 'bye'); } catch { /* gone */ }
    },
    get peerPresent() { return peerPresent; },
    /** tests: lose the room socket the way a network does. The page sees a 1006; the room is told nothing
     *  (the socket is left open and ignored, as a half-dead connection would be) */
    dropForTest() { if (!closed && ws) { const s = ws; abandon(s); ws = { readyState: 3, send() {}, close() {} }; onClose({ code: 1006 }); sys.setTimeout(() => { try { s.close(); } catch { /* */ } }, 60000); } },
    /** tests: the DataChannel's path dies with no word to this page (the peer connection is closed under it, as a
     *  network switch leaves it); the watchdog has to notice and redial */
    killDcForTest() { if (pc) { const p = pc; p.onconnectionstatechange = p.oniceconnectionstatechange = null; if (dc) dc.onclose = null; try { p.close(); } catch { /* */ } } },
    /** tests: what the watchdog knows */
    get debug() { return { gen, dialing, wantDial, dialFails, lastDcRx, beatSeen, downSince, pongSeen, peerAway, mode: link.mode, kind: curKind, ice: hasTurn(iceList) ? 'turn' : 'stun' }; },
  };

  /** volatile: signaling, which is useless late, so it's never held for a reconnect */
  function sendCtl(obj, volatile) {
    if (ws && ws.readyState === OPEN && !downSince) { try { ws.send(JSON.stringify(obj)); } catch { /* closing */ } }
    else if (downSince && !volatile && outbox.length < OUTBOX_MAX) outbox.push(JSON.stringify(obj));
  }

  function setMode(m) {
    const was = link.mode, wasReady = link.ready;
    link.mode = m;
    if (m === 'p2p' || m === 'relay') link.ready = true;
    if (was !== m || wasReady !== link.ready) emit('status', link);
  }
  function teardownRtc() {
    dialing = false;
    if (dc) { const d = dc; dc = null; try { d.close(); } catch { /* */ } }
    if (pc) { const p = pc; pc = null; try { p.close(); } catch { /* */ } }
    pendingIce = []; discSince = 0; beatSeen = false;
  }
  /** the relay carries the packets (for now, unless WebRTC is off the table: then for good) */
  function toRelay() { if (link.mode !== 'relay') setMode('relay'); }

  /** the rival is gone after all (the grace after a doubted 'left' ran out): as the room's 'left' would have done */
  function peerGone() {
    peerPresent = false; peerAway = false;
    emit('peer', false);
    teardownRtc(); wantDial = false; link.ready = false; link.mode = 'connecting';
  }

  // ---- the probes: the link's own round trip, jitter and loss on the packet path ------------------------------
  function clockBuf(type, t) { const b = new ArrayBuffer(9), dv = new DataView(b); dv.setUint8(0, type); dv.setFloat64(1, t); return b; }
  function lossNow() {
    const t = now();
    let n = 0, lost = 0;
    for (const p of probes) { if (t - p.t < PROBE_LATE_MS) continue; n++; if (!p.ok) lost++; }
    return n >= 4 ? lost / n : 0;
  }
  /** a probe or echo arrived (on `via`, 'dc' or 'ws'); true if it was one (not a game packet) */
  function onProbe(data, via) {
    if (data.byteLength !== 9) return false;
    const dv = new DataView(data), type = dv.getUint8(0);
    if (type === PROBE) {
      const echo = clockBuf(ECHO, dv.getFloat64(1));
      try { if (via === 'dc' && dcOpen()) dc.send(echo); else if (ws && ws.readyState === OPEN && !downSince) ws.send(echo); } catch { /* */ }
      return true;
    }
    if (type !== ECHO) return false;
    const sent = dv.getFloat64(1), t = now(), ms = t - sent;
    if (!(ms >= 0 && ms < 10000)) return true;
    const p = probes.find((q) => q.t === sent);
    if (p) p.ok = true;
    if (!pN) { pRtt = ms; pJit = 0; } else { pJit += (Math.abs(ms - pRtt) - pJit) * 0.2; pRtt += (ms - pRtt) * 0.2; }
    pN++;
    return true;
  }
  function sendProbe(t) {
    // a new path starts a new measure
    const key = `${link.path}:${gen}`;
    if (key !== pathKey) { pathKey = key; probes = []; pN = 0; }
    const b = clockBuf(PROBE, t);
    let sent = false;
    if (dcOpen()) { try { dc.send(b); sent = true; } catch { /* */ } }
    else if (link.mode === 'relay' && wsUp() && peerPresent) { try { ws.send(b); sent = true; } catch { /* */ } }
    if (!sent) return;
    probes.push({ t, ok: false });
    if (probes.length > PROBES_KEPT) probes.shift();
  }

  // ---- the DataChannel ----------------------------------------------------------------------------------
  function wireChannel(ch) {
    dc = ch;
    ch.binaryType = 'arraybuffer';
    ch.onopen = () => {
      if (ch !== dc) return;
      const back = everOpen && deadSince ? Math.round(now() - deadSince) : 0;
      dialing = false; wantDial = false; dialFails = 0; allFails = 0; firstDial = false; everOpen = true; deadSince = 0; goodKind = curKind;
      lastDcRx = now(); beatSeen = false;
      setMode('p2p'); noteCandidate();
      if (back) { console.info(`[net] DataChannel back after ${back} ms`); emit('rejoined', { who: 'p2p', ms: back }); }
      emit('status', link);
    };
    ch.onclose = () => { if (ch === dc && !closed) dcDead('closed'); };
    ch.onmessage = (e) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      // anything on it proves it delivers (beatSeen: the channel has carried something since it opened)
      if (ch === dc) { lastDcRx = now(); beatSeen = true; }
      if (e.data.byteLength === 1 && new Uint8Array(e.data)[0] === BEAT) return;
      if (onProbe(e.data, 'dc')) return;
      lastPeerRx = now();
      emit('packet', e.data);
    };
  }
  /** the DataChannel is gone (or as good as): packets go over the room, and a redial is wanted */
  function dcDead(why) {
    if (closed) return;
    if (dc || pc) console.warn(`[net] DataChannel lost (${why}); redialing`);
    const wasOpen = dcOpen() || link.mode === 'p2p';
    teardownRtc();
    nextKind = goodKind || 'all';   // redial the way that last worked first
    if (wasOpen && !deadSince) deadSince = now();
    if (link.mode !== 'connecting' || !noRtc()) toRelay();
    if (noRtc() || !peerPresent) return;
    if (!wantDial) nextDialAt = now() + (dialFails ? backoff() : 0);
    wantDial = true;
    emit('status', link);
  }
  const backoff = () => Math.min(REDIAL_MAX_GAP_MS, 1000 * 2 ** Math.max(0, dialFails - 1));
  /** Which kind of path the DataChannel took: a TURN relay, a NAT mapping, or the local network. */
  async function noteCandidate() {
    try {
      const stats = await pc?.getStats();
      if (!stats) return;
      /** @type {any} */ let pair = null;
      stats.forEach((s) => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId); });
      if (!pair) stats.forEach((s) => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; });
      const local = pair && stats.get(pair.localCandidateId);
      if (local) { link.candidate = local.candidateType; emit('status', link); }
    } catch { /* stats are a nicety */ }
  }
  /** A fresh RTCPeerConnection once the ICE servers are in, or null if the link moved on meanwhile. */
  async function makePc(g, kind = 'all') {
    const list = await iceFor();
    if (closed || noRtc() || !peerPresent) return null;
    // a TURN dial with no TURN servers to hand is an ordinary one
    if (kind === 'turn' && !hasTurn(list)) kind = 'all';
    const iceServers = kind === 'turn' ? turnOnly(list) : list;
    const keep = pendingIce.filter((c) => c.g === undefined || c.g === g);   // candidates for this dial that came in while the ICE servers were loading
    teardownRtc();
    pendingIce = keep;
    gen = g;
    const p = new PC({ iceServers, iceTransportPolicy: relayOnly || kind === 'turn' ? 'relay' : 'all' });
    pc = p; curKind = kind;
    dialing = true; dialStart = now();
    p.onicecandidate = (e) => { if (e.candidate && p === pc) sendCtl({ t: 'ice', c: e.candidate.toJSON(), g }, true); };
    const onState = () => {
      if (p !== pc) return;
      const s = p.connectionState || p.iceConnectionState;
      if (s === 'failed') dcDead('failed');
      else if (s === 'disconnected') { if (!discSince) discSince = now(); }
      else if (s === 'connected' || s === 'completed') discSince = 0;
    };
    p.onconnectionstatechange = onState;
    p.oniceconnectionstatechange = onState;
    p.ondatachannel = (e) => { if (p === pc) wireChannel(e.channel); };
    return p;
  }
  /** the host dials: a new peer connection and channel, its offer through the room */
  async function dial() {
    if (role !== 'host' || noRtc()) return;
    wantDial = false;
    const p = await makePc(gen + 1, nextKind);
    if (!p) return;
    wireChannel(p.createDataChannel('game', { ordered: false, maxRetransmits: 0 }));
    try {
      await p.setLocalDescription(await p.createOffer());
      // k: the kind of dial, so the guest allows the same candidates; turn: a TURN dial follows if this one fails
      if (p === pc) sendCtl({ t: 'rtc', sdp: p.localDescription, g: gen, k: curKind, turn: hasTurn(iceList) && !relayOnly }, true);
    } catch (e) { console.warn('[net] offer failed', e); if (p === pc) dialFailed(); }
  }
  /** a dial that didn't open: try again later (the relay carries the match meanwhile) */
  function dialFailed() {
    const failed = curKind;
    dialFails++;
    teardownRtc();
    // a dial with every candidate allowed didn't open: TURN-only next (Cloudflare's TURN over UDP), and on the first
    // dial that goes now, before the relay (TCP) takes the match. After that the kind that last opened leads
    // (mid-session, two direct redials in a row: one failing inside a dropout says nothing about the NAT)
    if (failed === 'all') allFails++;
    const turnNext = failed === 'all' && hasTurn(iceList) && !relayOnly && (firstDial || allFails >= 2);
    nextKind = turnNext ? 'turn' : goodKind || 'all';
    if (firstDial && turnNext && role === 'host' && !noRtc() && peerPresent) { dial(); return; }
    const wasFirst = firstDial;
    firstDial = false;
    if (wasFirst || link.mode !== 'p2p') toRelay();
    if (noRtc() || !peerPresent) return;
    wantDial = true; nextDialAt = now() + backoff();
  }
  /** a dial is wanted now: the host starts one, a guest asks the host for one (and waits for its offer) */
  function redial() {
    if (closed || noRtc() || !peerPresent || !wsUp()) return;
    if (role === 'host') { dial(); return; }
    // the guest: ask, and give the host's offer REDIAL_TRY_MS to show up before asking again
    wantDial = false;
    dialing = true; dialStart = now();
    sendCtl({ t: 'redial', g: gen }, true);
  }
  async function onRtc(msg) {
    if (noRtc()) { sendCtl({ t: 'relay' }, false); return; }
    const g = typeof msg.g === 'number' ? msg.g : gen + 1;   // an old host's offers carry no generation: each is new
    try {
      if (msg.sdp.type === 'offer') {
        const p = await makePc(g, msg.k === 'turn' ? 'turn' : 'all');
        if (!p) return;
        // how long to give this dial before the relay: a direct dial the host will follow with a TURN one gets both
        guestWait = msg.k === 'turn' ? TURN_TRY_MS + 1000 : msg.turn ? DIRECT_TRY_MS + TURN_TRY_MS + 1000 : rtcTimeoutMs;
        await p.setRemoteDescription(msg.sdp);
        await p.setLocalDescription(await p.createAnswer());
        if (p === pc) sendCtl({ t: 'rtc', sdp: p.localDescription, g }, true);
      } else {
        if (typeof msg.g === 'number' && msg.g !== gen) return;   // the answer to a dial we've given up on
        if (pc) await pc.setRemoteDescription(msg.sdp);
      }
      const p = pc;
      for (const c of pendingIce) if (c.g === undefined || c.g === gen) await p?.addIceCandidate(c.c);
      if (p === pc) pendingIce = [];
    } catch (e) {
      // a newer dial took over while this one was being set up (its peer connection closed under it): not a failure
      // of the current dial, which a dialFailed() here would tear down
      if (g !== gen) return;
      console.warn('[net] rtc failed', e); dialFailed();
    }
  }
  function onIce(msg) {
    const g = typeof msg.g === 'number' ? msg.g : undefined;
    if (g !== undefined && pc && g !== gen && g < gen) return;   // for a dial that's gone
    if (!pc || !pc.remoteDescription || (g !== undefined && g !== gen)) { if (pendingIce.length < 64) pendingIce.push({ c: msg.c, g }); }
    else pc.addIceCandidate(msg.c).catch(() => {});
  }

  // ---- the room socket ------------------------------------------------------------------------------------
  function connect() {
    const s = new WS(url.toString());
    s.binaryType = 'arraybuffer';
    ws = s; wsWelcomed = false;
    s.onmessage = (e) => { if (s === ws) onMessage(e); };
    s.onclose = (e) => { if (s === ws) onClose(e); };
    // before the first welcome a failed socket means the room can't be reached; after it, reconnecting handles it
    s.onerror = () => { if (s === ws && !welcomed && !link.error) link.error = 'unreachable'; };
    sys.clearTimeout(tryTimer);
    // a reopen try that hangs (a dead network often never errors) is dropped, and the next one goes
    if (welcomed) tryTimer = sys.setTimeout(() => { if (s === ws && !wsWelcomed && !closed) { abandon(s); reconnect(dropCode || 1006); } }, CONNECT_TRY_MS);
  }
  /** let a socket go without hearing from it again (it may never close on its own) */
  function abandon(s) {
    if (!s) return;
    s.onmessage = s.onclose = s.onerror = null;
    // ABANDON (4100): if this close does reach the room, it reads as the network, not a goodbye (worker/index.ts),
    // so the rival hears 'away' at most. A bare close() leaves the code to the browser and the runtime
    try { s.close(ABANDON, 'stale'); } catch { /* */ }
  }
  /** the room socket is dead though nothing said so (no pong): drop it and reopen */
  function wsDead(why) {
    if (closed || downSince || !ws) return;
    console.warn(`[net] room socket silent (${why}); reopening`);
    const s = ws;
    abandon(s);
    ws = { readyState: 3, send() {}, close() {} };
    onClose({ code: 1006 });
  }
  function stopTimers() {
    sys.clearTimeout(retryTimer); sys.clearTimeout(tryTimer); sys.clearInterval(tickTimer);
    for (const off of offs) { try { off(); } catch { /* */ } }
    offs.length = 0;
  }
  /** the end of the link: the socket is gone for good */
  function finalClose(reason, code) {
    if (closed) return;
    closed = true;
    stopTimers();
    link.reconnecting = false; downSince = 0; outbox = [];
    teardownRtc();
    emit('closed', reason, code);
  }
  /** the last time anything came from the other side, on any path */
  const lastSign = () => Math.max(downSince, dcOpen() ? lastDcRx : 0);
  /** the room socket dropped (or a try to reopen it failed): try again soon, while there's any sign of life */
  function reconnect(code) {
    if (!downSince) {
      downSince = now(); dropCode = code; tries = 0;
      link.reconnecting = true;
      console.warn(`[net] room socket dropped (${code}); reconnecting`);
      emit('status', link);
    }
    if (now() - lastSign() > RECONNECT_MS) { finalClose('lost', dropCode); return; }
    sys.clearTimeout(retryTimer);
    retryTimer = sys.setTimeout(() => { if (!closed) connect(); }, Math.min(2000, 150 * 2 ** tries++));
  }
  function onClose(e) {
    if (closed) return;
    sys.clearTimeout(tryTimer);
    // the room's own refusals and closes (4000 refused, 4001 replaced, 4008 flood) are final; so is a link
    // the room never welcomed. Anything else after a welcome is the network: reopen it
    if (welcomed && !link.error && !(e.code >= 4000 && e.code < 5000)) { reconnect(e.code); return; }
    finalClose(link.error || (e.code === 1000 ? 'closed' : 'lost'), downSince ? dropCode : e.code);
  }

  /** the network changed (or the page woke up): don't wait for a timeout to find out what died */
  function nudge(why) {
    if (closed || !welcomed) return;
    const t = now();
    if (downSince) { tries = 0; sys.clearTimeout(retryTimer); sys.clearTimeout(tryTimer); if (ws && ws.readyState !== OPEN) abandon(ws); connect(); }
    else if (ws && ws.readyState === OPEN) { probeAt = t; pingOut = 0; ping(t); }
    if (dcOpen()) dcProbeAt = t;
    else if (wantDial) nextDialAt = t;
    console.info(`[net] network nudge (${why})`);
  }

  function tick() {
    if (closed) return;
    const t = now();
    if (t - lastTick > FROZEN_MS) { lastTick = t; nudge('woke'); }
    lastTick = t;
    // the room socket: keep it talking, and notice when it stops
    if (wsUp()) {
      // (every PING_MS; every second while nobody else is here, for the host screen's meter)
      if (t - lastPingAt >= (peerPresent ? PING_MS : 1000)) ping(t);
      // only a pong proves the socket works both ways: one whose sends vanish still receives what the room sends
      if (pongSeen && t - lastPongAt > PONG_MS) { wsDead('silent'); return; }
      if (probeAt && t - probeAt > PROBE_MS) { const at = probeAt; probeAt = 0; if (pongSeen && lastPongAt < at) { wsDead('probe'); return; } }
    }
    // the probe: every BEAT_MS down whichever path carries the packets (the DataChannel, or the relay)
    if (peerPresent && t - lastBeatAt >= BEAT_MS) { lastBeatAt = t; sendProbe(t); }
    // the room said the rival left while their packets were still coming: a real leave once they've stopped
    if (leftAt && peerPresent && t - leftAt > LEFT_GRACE_MS) {
      leftAt = 0;
      if (t - lastPeerRx > LEFT_GRACE_MS) peerGone();
      else { peerAway = false; emit('status', link); }   // still talking all along: the room had it wrong
    }
    if (!peerPresent || noRtc()) return;
    // the DataChannel: the other side probes it every BEAT_MS, so silence means trouble, whether or not it ever
    // delivered (a channel that opened but carries nothing is as dead as one that stopped)
    if (dcOpen()) {
      if (t - lastDcRx > DC_DEAD_MS) { dcDead(beatSeen ? 'silent' : 'never delivered'); return; }
      if (dcProbeAt && t - dcProbeAt > PROBE_MS) { const at = dcProbeAt; dcProbeAt = 0; if (lastDcRx < at) { dcDead('probe'); return; } }
    }
    if (pc && discSince && t - discSince > DISCONNECT_MS) { dcDead('disconnected'); return; }
    // a channel or connection that ended without an event reaching us (it happens on a network switch)
    if ((dc && (dc.readyState === 'closed' || dc.readyState === 'closing')) || (pc && !dialing && (pc.connectionState === 'closed' || pc.connectionState === 'failed'))) { dcDead('ended'); return; }
    // a dial that's taking too long
    const firstWait = role === 'host' ? (hasTurn(iceList) && !relayOnly ? (curKind === 'turn' ? TURN_TRY_MS : DIRECT_TRY_MS) : rtcTimeoutMs) : guestWait || rtcTimeoutMs;
    if (dialing && !dcOpen() && t - dialStart > (firstDial ? firstWait : REDIAL_TRY_MS)) {
      if (role === 'host') dialFailed();
      else { dialing = false; dialFails++; if (firstDial) { firstDial = false; toRelay(); } wantDial = true; nextDialAt = t + backoff(); }
    }
    if (wantDial && !dialing && t >= nextDialAt && wsUp()) redial();
  }
  const tickTimer = sys.setInterval(tick, TICK_MS);
  /** @type {(() => void)[]} */ const offs = [];
  for (const ev of /** @type {const} */ (['online', 'change', 'visible'])) offs.push(sys.on(ev, () => nudge(ev)));

  function onMessage(e) {
    lastWsRx = now();
    if (e.data instanceof ArrayBuffer) { lastPeerRx = lastWsRx; if (!onProbe(e.data, 'ws')) emit('packet', e.data); return; }
    if (e.data === 'pong') {
      pongSeen = true; lastPongAt = lastWsRx;
      if (pingOut) { const ms = lastWsRx - pingOut; pingOut = 0; if (ms >= 0 && ms < 10000) { if (!sN) { sRtt = ms; sJit = 0; } else { sJit += (Math.abs(ms - sRtt) - sJit) * 0.25; sRtt += (ms - sRtt) * 0.25; } sN++; } }
      return;
    }
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.t === 'sys') {
      if (msg.ev === 'error') { link.error = msg.reason; finalClose(msg.reason); return; }
      if (msg.ev === 'watching') { emit('watching', msg); return; }   // spectators: how many, and what the room needs
      if (msg.ev === 'career') { emit('career', msg); return; }   // the room's award for this player's online match (worker/career.ts)
      const rewelcome = msg.ev === 'welcome' && !!downSince;
      if (msg.ev === 'welcome') {
        welcomed = true; wsWelcomed = true;
        sys.clearTimeout(tryTimer);
        pingOut = 0; lastPongAt = now(); ping(lastPongAt);   // and see whether this room answers pings
        if (downSince) {   // back: what waited goes out, and the session hears it
          const ms = Math.round(now() - downSince);
          downSince = 0; link.reconnecting = false; tries = 0;
          const held = outbox; outbox = [];
          for (const m of held) ws.send(m);
          console.info(`[net] room socket back after ${ms} ms`);
          emit('status', link);
          if (peerPresent && (msg.peer || msg.away)) emit('rejoined', { who: 'self', ms });
          // a DataChannel that died meanwhile redials now that there's signaling again
          if (wantDial) nextDialAt = Math.min(nextDialAt, now());
        }
        emit('open');   // the room is there: the host's spectator switch goes out first
      }
      if (msg.ev === 'peer' && msg.back && msg.present && peerPresent) {   // the other player's socket came back
        const was = peerAway; peerAway = false; leftAt = 0;
        if (was) emit('status', link);
        emit('rejoined', { who: 'rival', ms: 0 });
        if (!dcOpen() && !noRtc() && !dialing) { wantDial = true; nextDialAt = now(); }
        return;
      }
      // the other player's socket died without a goodbye: the room holds the seat. Their DataChannel may well
      // still be up; the session's own clocks decide if they never come back
      if (msg.ev === 'peer' && !msg.present && msg.away && peerPresent) { peerAway = true; emit('status', link); return; }
      // back on a new socket and the room has no socket for the rival: they may be reconnecting too (the room
      // restarted, or noticed both drops). Only a goodbye or the room's 'left' notice says they're gone; the
      // session's clocks end the match if they never come back
      if (rewelcome && peerPresent && !msg.peer && !msg.away) { peerAway = true; emit('status', link); return; }
      // the room says the rival left, but their packets were here a moment ago (2026-11-16 15:01: a crew match on the
      // relay got 'left' 1 s after a 653 ms socket blip, with a packet 331 ms before): hold it as away. A real leave
      // says goodbye first ('bye', below) and ends at once; a closed tab's packets stop, and LEFT_GRACE_MS later it's over
      if (msg.ev === 'peer' && !msg.present && !msg.away && peerPresent && now() - lastPeerRx < TALKING_MS) {
        console.warn('[net] the room says the rival left, but their packets are still coming: holding on');
        leftAt = now(); peerAway = true; emit('status', link); return;
      }
      if (msg.ev === 'welcome' || msg.ev === 'peer') {
        const present = msg.ev === 'welcome' ? !!(msg.peer || (msg.away && peerPresent)) : !!msg.present;
        if (msg.ev === 'welcome' && msg.away && peerPresent && !msg.peer) { peerAway = true; emit('status', link); }
        if (present && peerPresent && peerAway && msg.ev === 'peer') { peerAway = false; leftAt = 0; emit('status', link); }   // there after all
        if (present === peerPresent) return;
        peerPresent = present; peerAway = false; leftAt = 0;
        emit('peer', present);
        if (present) {
          rtcRefused = forceRelay; firstDial = true; dialFails = 0; everOpen = false; deadSince = 0; nextKind = 'all'; goodKind = ''; setMode('connecting');
          if (forceRelay || noRtc()) { sendCtl({ t: 'relay' }, false); toRelay(); }
          else if (role === 'host') dial();
          else { dialing = true; dialStart = now(); guestWait = 0; }   // the guest waits for the host's offer (RTC_TIMEOUT_MS)
        } else { teardownRtc(); wantDial = false; link.ready = false; link.mode = 'connecting'; }
      }
      return;
    }
    if (msg.t === 'rtc') { onRtc(msg); return; }
    if (msg.t === 'ice') { onIce(msg); return; }
    if (msg.t === 'redial') {   // the guest lost the DataChannel: a new dial, unless one just started
      // (a guest asking about an older dial than ours hasn't seen our offer yet: it's on its way)
      if (role !== 'host' || noRtc() || !peerPresent) return;
      if (dialing && typeof msg.g === 'number' && msg.g < gen) return;
      if (dialing && now() - dialStart < 1000) return;
      teardownRtc(); if (link.mode === 'p2p') toRelay(); dial();
      return;
    }
    if (msg.t === 'relay') { rtcRefused = true; teardownRtc(); wantDial = false; toRelay(); return; }   // the other side can't or won't do WebRTC
    if (msg.t === 'bye') { leftAt = 0; peerPresent = false; peerAway = false; emit('peer', false); return; }
    emit('control', msg);
  }
  connect();
  return link;
}
