// The connection between two players. The room's WebSocket (worker/index.ts, one Durable
// Object per room) carries signaling and the match's control messages; game packets go over a
// WebRTC DataChannel (unordered, no retransmits) when the two browsers can reach each other,
// and through the same WebSocket otherwise (the relay). Public STUN only, no TURN: two phones
// behind carrier NAT usually can't open a direct path, so the relay is the expected fallback.
//
//   const link = createLink({ code, role, forceRelay })
//   link.on('status' | 'peer' | 'control' | 'packet' | 'closed', fn)
//   link.sendControl(obj)   reliable JSON through the room
//   link.sendPacket(buf)    the DataChannel when it's open, else the room
//   link.mode               'connecting' | 'p2p' | 'relay'
//   link.close()

const ICE_SERVERS = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
export const RTC_TIMEOUT_MS = 5000;

/** The API base: relative to the page, so it works at /stick-fight/ and on the dev server. */
export function apiUrl(path, ws = false) {
  const u = new URL('api/' + path, location.href);
  if (ws) u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.search = '';
  return u;
}

/** Ask the server for a new room. Resolves to its code. */
export async function createRoom() {
  const res = await fetch(apiUrl('rooms'), { method: 'POST' });
  if (!res.ok) throw new Error(`room server said ${res.status}`);
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

  const link = {
    role, code,
    /** @type {'connecting' | 'p2p' | 'relay'} */
    mode: 'connecting',
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
    ch.onopen = () => { clearTimeout(rtcTimer); setMode('p2p'); };
    ch.onclose = () => { if (!closed && link.mode === 'p2p') setMode('relay'); };
    ch.onmessage = (e) => { if (e.data instanceof ArrayBuffer) emit('packet', e.data); };
  }
  function makePc() {
    teardownRtc();
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
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
    const p = makePc();
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
        const p = makePc();
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
