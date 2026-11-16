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
import { RTC_TIMEOUT_MS, REDIAL_TRY_MS, REDIAL_MAX_GAP_MS, DISCONNECT_MS, BEAT_MS, DC_STALE_MS, DC_DEAD_MS, PING_MS, PONG_MS, PROBE_MS, CONNECT_TRY_MS, LOST_MS } from './budget.js';

export { RTC_TIMEOUT_MS };
export const RECONNECT_MS = LOST_MS;   // the room socket's window once the DataChannel is quiet too
const ICE_SERVERS = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const OUTBOX_MAX = 256;              // control messages held while it's down
const ICE_FETCH_MS = 2500;
const TICK_MS = 250;                 // the link's own watchdog
const FROZEN_MS = 3000;              // a watchdog tick this late: the page was frozen (a locked phone)
const BEAT = 0xf0;                   // the DataChannel beat's one byte (codec.js packet types are 1..3)

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
  let lastWsRx = 0, lastPingAt = 0, pongSeen = false, probeAt = 0;
  /** @type {string[]} */ let outbox = [];
  /** @type {any} */ let pc = null;
  /** @type {any} */ let dc = null;
  let peerPresent = false, peerAway = false, closed = false;
  // the DataChannel: the generation of the current dial (the host counts them; the guest takes the offer's),
  // when it started, whether one is wanted and when the next may go, how many in a row failed
  let gen = 0, dialing = false, dialStart = 0, firstDial = true, wantDial = false, nextDialAt = 0, dialFails = 0;
  let lastDcRx = 0, lastBeatAt = 0, beatSeen = false, discSince = 0, dcProbeAt = 0, deadSince = 0, everOpen = false;
  let rtcRefused = forceRelay;   // the other side can't or won't do WebRTC ({t:'relay'}), or ?relay=1
  let lastTick = now();
  /** @type {RTCIceCandidateInit[]} */ let pendingIce = [];
  // fetched now, while the room opens, so it's usually in hand by the time the peer arrives
  const iceReady = forceRelay ? Promise.resolve(ICE_SERVERS) : sys.fetchIce();
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
    get peerAway() { return peerAway; },
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return link; },
    sendControl(obj) { sendCtl(obj, false); },
    /** @param {ArrayBuffer} buf */
    sendPacket(buf) {
      let sent = false;
      if (dcOpen()) { try { dc.send(buf); sent = true; } catch { /* fall through to the relay */ } }
      // the channel in doubt (nothing on it lately while the beats say it should be busy): the room too
      if ((!sent || (beatSeen && now() - lastDcRx > DC_STALE_MS)) && ws && ws.readyState === OPEN && !downSince) { try { ws.send(buf); } catch { /* closing */ } }
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
    get debug() { return { gen, dialing, wantDial, dialFails, lastDcRx, beatSeen, downSince, pongSeen, peerAway, mode: link.mode }; },
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

  // ---- the DataChannel ----------------------------------------------------------------------------------
  function wireChannel(ch) {
    dc = ch;
    ch.binaryType = 'arraybuffer';
    ch.onopen = () => {
      if (ch !== dc) return;
      const back = everOpen && deadSince ? Math.round(now() - deadSince) : 0;
      dialing = false; wantDial = false; dialFails = 0; firstDial = false; everOpen = true; deadSince = 0;
      lastDcRx = now(); beatSeen = false;
      setMode('p2p'); noteCandidate();
      if (back) { console.info(`[net] DataChannel back after ${back} ms`); emit('rejoined', { who: 'p2p', ms: back }); }
      emit('status', link);
    };
    ch.onclose = () => { if (ch === dc && !closed) dcDead('closed'); };
    ch.onmessage = (e) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      if (ch === dc) lastDcRx = now();
      if (e.data.byteLength === 1 && new Uint8Array(e.data)[0] === BEAT) { if (ch === dc) beatSeen = true; return; }
      emit('packet', e.data);
    };
  }
  /** the DataChannel is gone (or as good as): packets go over the room, and a redial is wanted */
  function dcDead(why) {
    if (closed) return;
    if (dc || pc) console.warn(`[net] DataChannel lost (${why}); redialing`);
    const wasOpen = dcOpen() || link.mode === 'p2p';
    teardownRtc();
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
  async function makePc(g) {
    const iceServers = await iceReady;
    if (closed || noRtc() || !peerPresent) return null;
    const keep = pendingIce.filter((c) => c.g === undefined || c.g === g);   // candidates for this dial that came in while the ICE servers were loading
    teardownRtc();
    pendingIce = keep;
    gen = g;
    const p = new PC({ iceServers, iceTransportPolicy: relayOnly ? 'relay' : 'all' });
    pc = p;
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
    const p = await makePc(gen + 1);
    if (!p) return;
    wireChannel(p.createDataChannel('game', { ordered: false, maxRetransmits: 0 }));
    try {
      await p.setLocalDescription(await p.createOffer());
      if (p === pc) sendCtl({ t: 'rtc', sdp: p.localDescription, g: gen }, true);
    } catch (e) { console.warn('[net] offer failed', e); if (p === pc) dialFailed(); }
  }
  /** a dial that didn't open: try again later (the relay carries the match meanwhile) */
  function dialFailed() {
    const wasFirst = firstDial;
    firstDial = false;
    dialFails++;
    teardownRtc();
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
        const p = await makePc(g);
        if (!p) return;
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
    } catch (e) { console.warn('[net] rtc failed', e); dialFailed(); }
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
    try { s.close(); } catch { /* */ }
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
    else if (ws && ws.readyState === OPEN) { probeAt = t; try { ws.send('ping'); } catch { /* */ } lastPingAt = t; }
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
      if (t - lastPingAt >= PING_MS) { lastPingAt = t; try { ws.send('ping'); } catch { /* */ } }
      if (pongSeen && t - lastWsRx > PONG_MS) { wsDead('silent'); return; }
      if (probeAt && t - probeAt > PROBE_MS) { const at = probeAt; probeAt = 0; if (pongSeen && lastWsRx < at) { wsDead('probe'); return; } }
    }
    if (!peerPresent || noRtc()) return;
    // the DataChannel
    if (dcOpen()) {
      if (t - lastBeatAt >= BEAT_MS) { lastBeatAt = t; try { dc.send(new Uint8Array([BEAT]).buffer); } catch { /* */ } }
      if (beatSeen && t - lastDcRx > DC_DEAD_MS) { dcDead('silent'); return; }
      if (dcProbeAt && t - dcProbeAt > PROBE_MS) { const at = dcProbeAt; dcProbeAt = 0; if (beatSeen && lastDcRx < at) { dcDead('probe'); return; } }
    }
    if (pc && discSince && t - discSince > DISCONNECT_MS) { dcDead('disconnected'); return; }
    // a channel or connection that ended without an event reaching us (it happens on a network switch)
    if ((dc && (dc.readyState === 'closed' || dc.readyState === 'closing')) || (pc && !dialing && (pc.connectionState === 'closed' || pc.connectionState === 'failed'))) { dcDead('ended'); return; }
    // a dial that's taking too long
    if (dialing && !dcOpen() && t - dialStart > (firstDial ? rtcTimeoutMs : REDIAL_TRY_MS)) {
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
    if (e.data instanceof ArrayBuffer) { emit('packet', e.data); return; }
    if (e.data === 'pong') { pongSeen = true; return; }
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.t === 'sys') {
      if (msg.ev === 'error') { link.error = msg.reason; finalClose(msg.reason); return; }
      if (msg.ev === 'watching') { emit('watching', msg); return; }   // spectators: how many, and what the room needs
      if (msg.ev === 'career') { emit('career', msg); return; }   // the room's award for this player's online match (worker/career.ts)
      if (msg.ev === 'welcome') {
        welcomed = true; wsWelcomed = true;
        sys.clearTimeout(tryTimer);
        lastPingAt = now(); try { ws.send('ping'); } catch { /* */ }   // and see whether this room answers pings
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
        const was = peerAway; peerAway = false;
        if (was) emit('status', link);
        emit('rejoined', { who: 'rival', ms: 0 });
        if (!dcOpen() && !noRtc() && !dialing) { wantDial = true; nextDialAt = now(); }
        return;
      }
      // the other player's socket died without a goodbye: the room holds the seat. Their DataChannel may well
      // still be up; the session's own clocks decide if they never come back
      if (msg.ev === 'peer' && !msg.present && msg.away && peerPresent) { peerAway = true; emit('status', link); return; }
      if (msg.ev === 'welcome' || msg.ev === 'peer') {
        const present = msg.ev === 'welcome' ? !!(msg.peer || (msg.away && peerPresent)) : !!msg.present;
        if (msg.ev === 'welcome' && msg.away && peerPresent && !msg.peer) { peerAway = true; emit('status', link); }
        if (present === peerPresent) return;
        peerPresent = present; peerAway = false;
        emit('peer', present);
        if (present) {
          rtcRefused = forceRelay; firstDial = true; dialFails = 0; everOpen = false; deadSince = 0; setMode('connecting');
          if (forceRelay || noRtc()) { sendCtl({ t: 'relay' }, false); toRelay(); }
          else if (role === 'host') dial();
          else { dialing = true; dialStart = now(); }   // the guest waits for the host's offer (RTC_TIMEOUT_MS)
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
    if (msg.t === 'bye') { peerPresent = false; peerAway = false; emit('peer', false); return; }
    emit('control', msg);
  }
  connect();
  return link;
}
