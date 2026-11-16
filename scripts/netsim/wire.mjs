// The real link (src/net/link.js) over a fake network, for scripts/netsim/handoff.mjs. Where network.mjs stands
// in for the whole link, this stands in for what the link talks to: the browser's WebSocket and RTCPeerConnection,
// the room's Durable Object (worker/index.ts Room: seats, welcome, peer notices, 'away', the ping auto-answer, the
// relay), and two phones' networks, each with its own latency, jitter and loss, that can go down (a dropout, a
// locked phone), lose UDP alone (the DataChannel's path dies while the socket survives), or switch networks
// (wifi to cellular: every connection made on the old one is dead, and the page hears a 'change').
//
// What a dead TCP connection does is the scenario's call: 'survive' (a short dropout: TCP retransmits, the
// socket lives and its data arrives late) or 'die' (the socket goes half-open: the page hears nothing, maybe a
// 1006 a minute later, and the room notices the close after a few seconds and tells the other page). Both
// match what phones do; the link has to ride out either.

import { sched, at } from './env.mjs';
import { mulberry32 } from '../../src/combat/rng.js';

/**
 * @typedef {{ base: number, jitter: number, loss: number, jitterSwing?: number }} Leg
 *   base: one-way ms from this phone to the room (and half of a phone-to-phone path); jitter: ms (half-normal);
 *   jitterSwing: the jitter drifts between jitter and jitter + swing over 20 s; loss: 0..1 for UDP through it
 */

/** @param {{ seed: number, legs: [Leg, Leg], room?: { away?: boolean, seats?: boolean } }} o */
export function createWire({ seed, legs, room: roomFlags = { away: true, seats: true } }) {
  const rng = mulberry32(seed ^ 0x2c1b3c6d);
  const gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += rng(); return (s - 2) / 0.577; };
  const stats = { udpSent: 0, udpLost: 0, tcpSent: 0, wsOpened: 0, wsHalfOpen: 0, pcs: 0, pcConnected: 0, roomAway: 0, roomLeft: 0 };
  /** the two phones: host 0, guest 1 */
  const sides = legs.map((leg, i) => ({
    i, leg, owner: /** @type {any} */ (null), up: true, downUntil: 0, iface: 0, udp: 0, tcp: 'die', udpBlocked: false,
    /** @type {Record<string, Function[]>} */ listeners: {},
    /** @type {Set<any>} */ sockets: new Set(),
  }));
  const frozen = (side) => !!side.owner && side.owner.frozenUntil > sched.t;
  const jit = (leg) => leg.jitter + (leg.jitterSwing ? leg.jitterSwing * (0.5 + 0.5 * Math.sin(2 * Math.PI * sched.t / 20000)) : 0);
  const legMs = (side) => Math.max(2, side.leg.base + Math.abs(gauss()) * jit(side.leg));
  const lossOf = (side) => side.leg.loss || 0;

  // ---- the room (worker/index.ts Room, the parts the players' sockets see) ----
  const rooms = new Map();
  let codes = 0;
  function roomOf(code) {
    let r = rooms.get(code);
    if (!r) rooms.set(code, (r = { code, sock: { host: null, guest: null }, seat: { host: '', guest: '' }, away: { host: 0, guest: 0 } }));
    return r;
  }
  const other = (role) => (role === 'host' ? 'guest' : 'host');
  function roomAccept(sock) {
    const r = roomOf(sock.code), role = sock.role, mine = r.sock[role], peer = r.sock[other(role)];
    const back = !!sock.seat && ((mine && mine.seat === sock.seat) || (roomFlags.seats && r.seat[role] === sock.seat));
    const held = roomFlags.away && r.away[role] && sched.t - r.away[role] < 60000 && !!peer;
    const reason = !back && (held || (mine && (role === 'guest' || peer))) ? 'full' : '';
    if (reason) { sock.down(JSON.stringify({ t: 'sys', ev: 'error', reason })); sock.serverClose(4000); return; }
    if (mine) { mine.replaced = true; mine.serverClose(4001); }
    r.sock[role] = sock; r.seat[role] = sock.seat; r.away[role] = 0;
    const otherAway = roomFlags.away && !peer && r.away[other(role)] && sched.t - r.away[other(role)] < 60000;
    sock.down(JSON.stringify({ t: 'sys', ev: 'welcome', role, peer: !!peer, ...(otherAway ? { away: true } : {}) }));
    if (peer) peer.down(JSON.stringify({ t: 'sys', ev: 'peer', present: true, ...(back ? { back: true } : {}) }));
  }
  function roomMessage(sock, data) {
    const r = roomOf(sock.code);
    if (sock.replaced || r.sock[sock.role] !== sock) return;
    if (data === 'ping') { sock.down('pong'); return; }   // the auto-response (setWebSocketAutoResponse)
    if (typeof data === 'string' && data.startsWith('{"t":"sys"')) return;   // results and the live count: the room's own
    const peer = r.sock[other(sock.role)];
    if (peer) peer.down(data);
  }
  /** the room hears a player's socket close: code 1000 / 1001 is leaving, 1006 is the network */
  function roomClosed(sock, code) {
    const r = roomOf(sock.code);
    if (sock.replaced || r.sock[sock.role] !== sock) return;
    r.sock[sock.role] = null;
    const peer = r.sock[other(sock.role)];
    if (roomFlags.away && code === 1006 && peer) {
      r.away[sock.role] = sched.t; stats.roomAway++;
      peer.down(JSON.stringify({ t: 'sys', ev: 'peer', present: false, away: true }));
      return;
    }
    r.away[sock.role] = 0; stats.roomLeft++;
    if (peer) peer.down(JSON.stringify({ t: 'sys', ev: 'peer', present: false }));
  }

  // ---- the page's WebSocket ----
  function makeWS(side) {
    return class FakeWebSocket {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      constructor(url) {
        const u = new URL(url);
        this.code = decodeURIComponent(u.pathname.split('/').at(-2) || '');
        this.role = u.searchParams.get('role') === 'host' ? 'host' : 'guest';
        this.seat = u.searchParams.get('seat') || '';
        this.readyState = 0; this.binaryType = 'blob';
        this.onmessage = null; this.onclose = null; this.onerror = null; this.onopen = null;
        this.side = side; this.owner = side.owner; this.iface = side.iface;
        this.broken = false; this.replaced = false; this.roomOpen = false;
        this.lastUp = 0; this.lastDown = 0;
        stats.wsOpened++;
        side.sockets.add(this);
        const t = sched.t;
        if (!this.alive()) {
          // no network: half the time the browser fails it fast (offline), else it hangs until the link gives up on it
          if (rng() < 0.5) at(t + 100 + rng() * 400, () => this.pageClose(1006), this.owner, 'net');
          else this.broken = true;
          return;
        }
        const rtt = 2 * legMs(side) + 2 * legMs(side);   // TCP and TLS, then the upgrade
        at(t + rtt, () => {
          if (this.readyState !== 0) return;
          if (!this.alive()) { this.broken = true; return; }
          this.readyState = 1; this.roomOpen = true;
          if (this.onopen) this.onopen({});
          roomAccept(this);
        }, this.owner, 'net');
      }
      /** the path works now: the phone's network is up, it's still the network this socket was made on */
      alive() { return !this.broken && this.side.up && this.side.iface === this.iface && !frozen(this.side); }
      /** when data sent now gets through: a time, or -1 for never */
      when(last) {
        const s = this.side;
        if (this.broken || s.iface !== this.iface) return -1;
        let from = sched.t;
        if (!s.up || frozen(s)) { if (s.tcp !== 'survive') return -1; from = Math.max(s.downUntil, s.owner ? s.owner.frozenUntil : 0); }
        let t = from + legMs(s);
        if (rng() < lossOf(s)) t += 2 * s.leg.base + 200;   // a lost segment: TCP resends it
        return Math.max(t, last + 0.01);
      }
      send(data) {
        if (this.readyState !== 1) return;
        stats.tcpSent++;
        const t = this.when(this.lastUp);
        if (t < 0) return;
        this.lastUp = t;
        const copy = typeof data === 'string' ? data : data.slice(0);
        at(t, () => { if (!this.broken && this.roomOpen) roomMessage(this, copy); }, null, 'net');
      }
      /** the room sends to this page */
      down(data) {
        const t = this.when(this.lastDown);
        if (t < 0) return;
        this.lastDown = t;
        const copy = typeof data === 'string' ? data : data.slice(0);
        at(t, () => { if (this.readyState === 1 && !this.broken && this.onmessage) this.onmessage({ data: copy }); }, this.owner, 'net');
      }
      /** the room closes it (4000 refused, 4001 replaced) */
      serverClose(code) {
        this.roomOpen = false;
        const t = this.when(this.lastDown);
        if (t < 0) return;
        at(t, () => this.pageClose(code), this.owner, 'net');
      }
      /** the page hears it close */
      pageClose(code) {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.side.sockets.delete(this);
        if (this.onclose) this.onclose({ code });
      }
      close(code = 1000) {
        if (this.readyState === 3) return;
        const wasOpen = this.readyState === 1;
        this.readyState = 3;
        this.side.sockets.delete(this);
        if (!wasOpen || !this.roomOpen) return;
        this.roomOpen = false;
        const t = this.when(this.lastUp);
        if (t >= 0) at(t, () => roomClosed(this, code), null, 'net');
        else at(sched.t + 3000 + rng() * 12000, () => roomClosed(this, 1006), null, 'net');   // the room notices the dead socket later
      }
      /** the network under it died ('die'): half-open. The room notices after a few seconds; the page maybe much later */
      breakOff() {
        if (this.broken || this.readyState === 3) return;
        this.broken = true; stats.wsHalfOpen++;
        if (this.roomOpen) { this.roomOpen = false; at(sched.t + 2000 + rng() * 10000, () => roomClosed(this, 1006), null, 'net'); }
        if (rng() < 0.4) at(sched.t + 500 + rng() * 2500, () => this.pageClose(1006), this.owner, 'net');   // the OS kills it with its network
        else at(sched.t + 60000, () => this.pageClose(1006), this.owner, 'net');
      }
    };
  }

  // ---- the page's RTCPeerConnection and DataChannel ----
  const pcs = new Map();
  let pcIds = 0;
  function makePC(side) {
    class FakeDataChannel {
      constructor(pc, label) { this.pc = pc; this.label = label; this.readyState = 'connecting'; this.binaryType = 'blob'; this.onopen = null; this.onclose = null; this.onmessage = null; this.peer = null; }
      send(buf) {
        if (this.readyState !== 'open') throw new Error('InvalidStateError: the channel is not open');
        stats.udpSent++;
        const a = this.pc, peer = this.peer;
        if (!peer || !pathOk(a) || !pathOk(peer.pc)) { stats.udpLost++; return; }
        if (rng() < lossOf(a.side) + lossOf(peer.pc.side)) { stats.udpLost++; return; }
        const copy = buf.slice(0), t = sched.t + legMs(a.side) + legMs(peer.pc.side);
        at(t, () => {
          if (peer.readyState !== 'open' || !pathOk(a) || !pathOk(peer.pc) || frozen(peer.pc.side)) { stats.udpLost++; return; }
          sched.cur = peer.pc.side.owner;
          if (peer.onmessage) peer.onmessage({ data: copy });
        }, null, 'net');
      }
      close() {
        if (this.readyState === 'closed') return;
        this.readyState = 'closed';
        const peer = this.peer;
        // the other end hears it if the path works (SCTP); else its connection's consent check finds out
        if (peer && peer.readyState !== 'closed' && pathOk(this.pc) && pathOk(peer.pc)) at(sched.t + legMs(this.pc.side) + legMs(peer.pc.side), () => peer.remoteClosed(), peer.pc.side.owner, 'net');
      }
      remoteClosed() { if (this.readyState === 'closed') return; this.readyState = 'closed'; if (this.onclose) this.onclose({}); }
    }
    class FakeRTCPeerConnection {
      constructor() {
        this.id = ++pcIds; pcs.set(this.id, this); stats.pcs++;
        this.side = side; this.connectionState = 'new'; this.iceConnectionState = 'new';
        this.localDescription = null; this.remoteDescription = null; this.remoteId = 0; this.cands = 0;
        this.channels = []; this.closed = false; this.bind = null; this.checking = false; this.badSince = 0;
        this.onicecandidate = null; this.onconnectionstatechange = null; this.oniceconnectionstatechange = null; this.ondatachannel = null;
      }
      createDataChannel(label) { const ch = new FakeDataChannel(this, label); this.channels.push(ch); return ch; }
      async createOffer() { return { type: 'offer', sdp: `pc${this.id}` }; }
      async createAnswer() { return { type: 'answer', sdp: `pc${this.id}` }; }
      async setLocalDescription(d) {
        this.localDescription = d;
        this.bind = { iface: side.iface, udp: side.udp };   // candidates come from the network the phone is on now
        const owner = side.owner;
        for (const [k, ms] of [[0, 20 + rng() * 80], [1, 150 + rng() * 300]]) {
          at(sched.t + ms, () => {
            if (this.closed || !this.onicecandidate) return;
            const c = { candidate: `candidate:${this.id}:${k}`, sdpMid: '0' };
            this.onicecandidate({ candidate: { ...c, toJSON: () => c } });
          }, owner, 'net');
        }
        this.tryConnect();
      }
      async setRemoteDescription(d) { this.remoteDescription = d; this.remoteId = +String(d.sdp).slice(2); this.tryConnect(); }
      async addIceCandidate() { this.cands++; this.tryConnect(); }
      setState(s) {
        if (this.connectionState === s || this.closed) return;
        this.connectionState = s; this.iceConnectionState = s === 'connected' ? 'connected' : s;
        if (this.onconnectionstatechange) this.onconnectionstatechange({});
      }
      /** ICE checks: once both ends have each other's description and a candidate, they connect if both paths work */
      tryConnect() {
        if (this.checking || this.closed || !this.localDescription || !this.remoteDescription || !this.cands) return;
        this.checking = true;
        const start = sched.t, owner = side.owner;
        this.setState('connecting');
        const check = () => {
          if (this.closed || this.connectionState === 'connected') return;
          const r = pcs.get(this.remoteId);
          if (r && !r.closed && r.remoteId === this.id && r.localDescription && pathOk(this) && pathOk(r)) {
            const t = sched.t + 2 * (legMs(side) + legMs(r.side)) + 30;   // a round of checks, then DTLS and SCTP
            at(t, () => { if (pathOk(this) && pathOk(r)) connectPair(this, r); else at(sched.t + 300, check, owner, 'net'); }, owner, 'net');
            return;
          }
          if (sched.t - start > 10000) { this.setState('failed'); return; }
          at(sched.t + 250, check, owner, 'net');
        };
        check();
      }
      close() {
        if (this.closed) return;
        for (const ch of this.channels) ch.close();
        this.closed = true; this.connectionState = 'closed'; this.iceConnectionState = 'closed';
      }
      async getStats() {
        const m = new Map([['t', { type: 'transport', selectedCandidatePairId: 'p' }], ['p', { type: 'candidate-pair', localCandidateId: 'l', nominated: true, state: 'succeeded' }], ['l', { type: 'local-candidate', candidateType: 'srflx' }]]);
        return /** @type {any} */ (m);
      }
    }
    return FakeRTCPeerConnection;
  }
  function pathOk(pc) {
    const s = pc.side;
    return !pc.closed && !!pc.bind && s.up && !s.udpBlocked && !frozen(s) && s.iface === pc.bind.iface && s.udp === pc.bind.udp;
  }
  /** both ends connected: the offerer's channels open on both, and each end watches the path (consent checks) */
  function connectPair(a, b) {
    if (a.connectionState === 'connected' || a.closed || b.closed) return;
    stats.pcConnected++;
    for (const x of [a, b]) at(sched.t, () => x.setState('connected'), x.side.owner, 'net');
    const offerer = a.channels.length ? a : b, answerer = offerer === a ? b : a;
    for (const ch of offerer.channels) {
      const mirror = new (Object.getPrototypeOf(ch).constructor)(answerer, ch.label);
      answerer.channels.push(mirror);
      ch.peer = mirror; mirror.peer = ch;
      at(sched.t, () => { if (ch.readyState !== 'connecting' || offerer.closed) return; ch.readyState = 'open'; if (ch.onopen) ch.onopen({}); }, offerer.side.owner, 'net');
      at(sched.t + 1, () => {
        if (answerer.closed) return;
        mirror.readyState = 'open';
        if (answerer.ondatachannel) answerer.ondatachannel({ channel: mirror });
        if (mirror.onopen) mirror.onopen({});
      }, answerer.side.owner, 'net');
    }
    for (const [x, y] of [[a, b], [b, a]]) consent(x, y);
  }
  /** a connected end: 'disconnected' after 5 s without a working path, 'failed' (channels closed) after 25 s */
  function consent(x, y) {
    const owner = x.side.owner;
    const tick = () => {
      if (x.closed) return;
      const ok = pathOk(x) && !y.closed && pathOk(y);
      if (ok) { x.badSince = 0; if (x.connectionState === 'disconnected') x.setState('connected'); }
      else {
        if (!x.badSince) x.badSince = sched.t;
        if (sched.t - x.badSince > 25000) { x.setState('failed'); for (const ch of x.channels) ch.remoteClosed(); return; }
        if (sched.t - x.badSince > 5000) x.setState('disconnected');
      }
      at(sched.t + 500, tick, owner, 'net');
    };
    at(sched.t + 500, tick, owner, 'net');
  }

  // ---- what a scenario does to a phone ----
  const wire = {
    stats, sides, rooms,
    async createRoom() { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let n = codes++, c = ''; for (let i = 0; i < 4; i++) { c += a[n % a.length]; n = Math.floor(n / a.length); } return c; },
    /** client.mjs's seam: the real link over this phone's network. linkFactory is src/net/link.js createLink */
    createLinkWith(linkFactory) {
      return (o) => {
        const side = sides[o.role === 'host' ? 0 : 1];
        side.owner = o.owner;
        return linkFactory({ code: o.code, role: o.role, forceRelay: o.forceRelay, io: ioFor(side) });
      };
    },
    /** the phone's network goes away for dur ms (tcp: 'survive' or 'die') */
    dropout(i, dur, tcp = 'die') {
      const s = sides[i];
      s.up = false; s.downUntil = sched.t + dur; s.tcp = tcp;
      if (tcp === 'die') for (const ws of [...s.sockets]) ws.breakOff();
      at(sched.t + dur, () => { s.up = true; fire(s, 'online'); }, null, 'net');
    },
    /** no UDP at all through this phone's network while on (a strict firewall): no DataChannel can open */
    blockUdp(i, on) { sides[i].udpBlocked = !!on; },
    /** UDP alone stops working on the paths made so far (the DataChannel dies; the socket and new paths are fine) */
    killUdp(i) { sides[i].udp++; },
    /** a new network (wifi to cellular): everything made on the old one is dead; the page hears 'change' a bit later */
    switchNetwork(i) {
      const s = sides[i];
      s.iface++; s.udp++;
      for (const ws of [...s.sockets]) ws.breakOff();
      at(sched.t + 200 + rng() * 600, () => fire(s, 'change'), null, 'net');
    },
    /** a locked iPhone: no timers, no frames, no network; 'visible' when it wakes */
    freeze(i, dur, tcp = 'die') {
      const s = sides[i];
      if (s.owner) s.owner.frozenUntil = sched.t + dur;
      wire.dropout(i, dur, tcp);
      at(sched.t + dur + 5, () => fire(s, 'visible'), null, 'net');
    },
    /** an Android phone in the background: timers run, no frames */
    hide(i, dur) { const s = sides[i]; if (s.owner) s.owner.hiddenUntil = sched.t + dur; at(sched.t + dur + 5, () => fire(s, 'visible'), null, 'net'); },
  };
  function fire(side, ev) {
    for (const fn of side.listeners[ev] || []) at(sched.t, () => fn(), side.owner, 'net');
  }
  function ioFor(side) {
    const owner = side.owner;
    const timer = (fn, ms) => at(sched.t + Math.max(0, +ms || 0), fn, owner);
    const io = {
      WebSocket: makeWS(side), RTCPeerConnection: makePC(side),
      fetchIce: async () => [{ urls: ['stun:stun.test:3478'] }],
      setTimeout: timer,
      clearTimeout: (ev) => { if (ev && typeof ev === 'object') ev.dead = true; },
      setInterval: (fn, ms) => {
        const h = { ev: /** @type {any} */ (null), dead: false };
        const tick = () => { if (h.dead) return; h.ev = at(sched.t + ms, tick, owner); fn(); };
        h.ev = at(sched.t + ms, tick, owner);
        return h;
      },
      clearInterval: (h) => { if (h && typeof h === 'object') { h.dead = true; if (h.ev) h.ev.dead = true; } },
      now: () => sched.t,
      url: () => 'ws://room.test/api/',
      search: () => '',
      on: (ev, fn) => { (side.listeners[ev] = side.listeners[ev] || []).push(fn); return () => { side.listeners[ev] = (side.listeners[ev] || []).filter((f) => f !== fn); }; },
    };
    // an older link.js reads the globals instead (the before numbers): scripts/netsim/handoff.mjs --legacy shims
    // these over them inside createLink
    io.legacy = { WebSocket: io.WebSocket, RTCPeerConnection: io.RTCPeerConnection, window: { setTimeout: timer, clearTimeout: io.clearTimeout }, setTimeout: timer, clearTimeout: io.clearTimeout };
    return io;
  }
  return wire;
}
