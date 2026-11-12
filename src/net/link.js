// The connection between two players. The room's WebSocket (worker/index.ts, one Durable
// Object per room) carries signaling and the match's control messages; game packets go over a
// WebRTC DataChannel (unordered, no retransmits) when the two browsers can reach each other,
// and through the same WebSocket otherwise (the relay). The ICE servers come from the Worker's
// /api/ice: STUN plus short-lived Cloudflare TURN credentials, so two phones behind carrier NAT can
// still get a DataChannel (through a TURN server). If that fetch fails it's public STUN only, and
// if no path opens within RTC_TIMEOUT_MS the room's WebSocket relay takes over as before.
// ?ice=relay in the page URL allows TURN candidates only (a test switch for the TURN path).
//
//   const link = createLink({ code, role, forceRelay })
//   link.on('status' | 'peer' | 'control' | 'packet' | 'closed' | 'watching', fn)
//   link.sendControl(obj)   reliable JSON through the room
//   link.sendPacket(buf)    the DataChannel when it's open, else the room
//   link.sendRoom(data)     to the room itself, not the other player: the host's spectator feed
//                           (src/net/watchfeed.js); 'watching' comes back with who's watching
//   link.mode               'connecting' | 'p2p' | 'relay'
//   link.candidate          once p2p: the local ICE candidate type in use, 'host' | 'srflx' | 'relay'
//   link.close()

import { rootUrl } from '../root.js';

const ICE_SERVERS = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
export const RTC_TIMEOUT_MS = 5000;
const ICE_FETCH_MS = 2500;

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

/** The API base: under the app's root (src/root.js), so it works at any path, the dev server included. */
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

/**
 * @param {{ code: string, role: 'host' | 'guest', forceRelay?: boolean, rtcTimeoutMs?: number }} o
 */
export function createLink({ code, role, forceRelay = false, rtcTimeoutMs = RTC_TIMEOUT_MS }) {
  /** @type {Record<string, Function[]>} */
  const handlers = {};
  const emit = (ev, ...a) => { for (const f of handlers[ev] || []) f(...a); };
  const url = apiUrl(`rooms/${encodeURIComponent(code)}/ws`, true);
  url.searchParams.set('role', role);
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  /** @type {RTCPeerConnection | null} */ let pc = null;
  /** @type {RTCDataChannel | null} */ let dc = null;
  let peerPresent = false, closed = false, rtcTimer = 0, rtcGaveUp = forceRelay;
  /** @type {RTCIceCandidateInit[]} */ let pendingIce = [];
  // fetched now, while the room opens, so it's usually in hand by the time the peer arrives
  const iceReady = forceRelay ? Promise.resolve(ICE_SERVERS) : fetchIceServers();
  const relayOnly = new URLSearchParams(location.search).get('ice') === 'relay';

  const link = {
    role, code,
    /** @type {'connecting' | 'p2p' | 'relay'} */
    mode: 'connecting',
    /** @type {'' | 'host' | 'srflx' | 'prflx' | 'relay'} */
    candidate: '',
    /** set once the transport is settled (p2p open, or the relay chosen) */
    ready: false,
    error: '',
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return link; },
    sendControl(obj) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); },
    /** @param {ArrayBuffer} buf */
    sendPacket(buf) {
      if (dc && dc.readyState === 'open') { try { dc.send(buf); return; } catch { /* fall through to the relay */ } }
      if (ws.readyState === WebSocket.OPEN) ws.send(buf);
    },
    /** to the room itself (a {t:'watch'} message as text, or a batch of confirmed inputs): never passed on
     *  @param {string | ArrayBuffer} data */
    sendRoom(data) { if (ws.readyState === WebSocket.OPEN) ws.send(data); },
    close() {
      if (closed) return;
      closed = true;
      try { link.sendControl({ t: 'bye' }); } catch { /* gone */ }
      teardownRtc();
      try { ws.close(1000, 'bye'); } catch { /* gone */ }
    },
    get peerPresent() { return peerPresent; },
  };

  function setMode(m) {
    const was = link.mode, wasReady = link.ready;
    link.mode = m;
    if (m === 'p2p' || m === 'relay') link.ready = true;
    if (was !== m || wasReady !== link.ready) emit('status', link);
  }
  function teardownRtc() {
    clearTimeout(rtcTimer);
    if (dc) { try { dc.close(); } catch { /* */ } dc = null; }
    if (pc) { try { pc.close(); } catch { /* */ } pc = null; }
    pendingIce = [];
  }
  function giveUpRtc() {
    if (link.mode === 'p2p') return;
    rtcGaveUp = true;
    setMode('relay');
  }
  function wireChannel(ch) {
    dc = ch;
    ch.binaryType = 'arraybuffer';
    ch.onopen = () => { clearTimeout(rtcTimer); setMode('p2p'); noteCandidate(); };
    ch.onclose = () => { if (!closed && link.mode === 'p2p') setMode('relay'); };
    ch.onmessage = (e) => { if (e.data instanceof ArrayBuffer) emit('packet', e.data); };
  }
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
  async function makePc() {
    const iceServers = await iceReady;
    if (closed || rtcGaveUp || !peerPresent) return null;
    const keep = pendingIce;   // candidates that came in while the ICE servers were loading
    teardownRtc();
    pendingIce = keep;
    pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: relayOnly ? 'relay' : 'all' });
    pc.onicecandidate = (e) => { if (e.candidate) link.sendControl({ t: 'ice', c: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'closed') && link.mode !== 'relay') giveUpRtc();
    };
    pc.ondatachannel = (e) => wireChannel(e.channel);
    clearTimeout(rtcTimer);
    rtcTimer = window.setTimeout(giveUpRtc, rtcTimeoutMs);
    return pc;
  }
  async function startRtc() {
    // the host offers; the guest answers whatever offer comes
    if (rtcGaveUp || role !== 'host' || typeof RTCPeerConnection === 'undefined') { if (rtcGaveUp || typeof RTCPeerConnection === 'undefined') giveUpRtc(); return; }
    const p = await makePc();
    if (!p) return;
    wireChannel(p.createDataChannel('game', { ordered: false, maxRetransmits: 0 }));
    try {
      await p.setLocalDescription(await p.createOffer());
      link.sendControl({ t: 'rtc', sdp: p.localDescription });
    } catch (e) { console.warn('[net] offer failed', e); giveUpRtc(); }
  }
  async function onRtc(msg) {
    if (rtcGaveUp || typeof RTCPeerConnection === 'undefined') { link.sendControl({ t: 'relay' }); return; }
    try {
      if (msg.sdp.type === 'offer') {
        const p = await makePc();
        if (!p) return;
        await p.setRemoteDescription(msg.sdp);
        await p.setLocalDescription(await p.createAnswer());
        link.sendControl({ t: 'rtc', sdp: p.localDescription });
      } else if (pc) await pc.setRemoteDescription(msg.sdp);
      for (const c of pendingIce) await pc?.addIceCandidate(c);
      pendingIce = [];
    } catch (e) { console.warn('[net] rtc failed', e); giveUpRtc(); }
  }

  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) { emit('packet', e.data); return; }
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.t === 'sys') {
      if (msg.ev === 'error') { link.error = msg.reason; emit('closed', msg.reason); return; }
      if (msg.ev === 'watching') { emit('watching', msg); return; }   // spectators: how many, and what the room needs
      if (msg.ev === 'career') { emit('career', msg); return; }   // the room's award for this player's online match (worker/career.ts)
      if (msg.ev === 'welcome') emit('open');   // the room is there: the host's spectator switch goes out first
      if (msg.ev === 'welcome' || msg.ev === 'peer') {
        const present = msg.ev === 'welcome' ? !!msg.peer : !!msg.present;
        if (present === peerPresent) return;
        peerPresent = present;
        emit('peer', present);
        if (present) {
          rtcGaveUp = forceRelay; setMode('connecting');
          if (forceRelay) { link.sendControl({ t: 'relay' }); giveUpRtc(); }
          else startRtc();
        } else { teardownRtc(); link.ready = false; link.mode = 'connecting'; }
      }
      return;
    }
    if (msg.t === 'rtc') { onRtc(msg); return; }
    if (msg.t === 'ice') {
      if (!pc || !pc.remoteDescription) pendingIce.push(msg.c);
      else pc.addIceCandidate(msg.c).catch(() => {});
      return;
    }
    if (msg.t === 'relay') { giveUpRtc(); return; }   // the other side can't or won't do WebRTC
    if (msg.t === 'bye') { peerPresent = false; emit('peer', false); return; }
    emit('control', msg);
  };
  ws.onclose = (e) => {
    teardownRtc();
    if (!closed) { closed = true; emit('closed', link.error || (e.code === 1000 ? 'closed' : 'lost')); }
  };
  ws.onerror = () => { if (!link.error) link.error = 'unreachable'; };
  return link;
}
