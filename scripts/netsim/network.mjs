// A fake room server and link for two clients in one process, with a bad network on purpose. It stands in
// for src/net/link.js (same API: on, sendControl, sendPacket, mode, ready, close) through online.js's
// game.createLink / game.createRoom seam.
//
// Game packets ride an unordered, lossy path (the DataChannel): one-way latency with jitter (so they
// reorder), random loss, bursts of loss (a two-state Gilbert model), and dropouts that lose everything.
// Control messages ride the reliable, ordered room socket: never lost, but delayed like the rest, and held
// through a dropout until it ends (TCP keeps retrying). A frozen phone (iOS, backgrounded) loses the packets
// sent to it while it's frozen; its control messages wait.

import { sched, at } from './env.mjs';
import { mulberry32 } from '../../src/combat/rng.js';
import { createWatchRoom } from '../../src/net/watchroom.js';   // the room's spectator side: the very code the Worker runs

/**
 * @typedef {{ base: number, jitter: number, loss: number, drift?: number, driftPeriod?: number,
 *   burst?: { enter: number, exit: number, loss: number }, dropouts?: { at: number, dur: number }[] }} Conditions
 *   base: one-way ms; jitter: ms (half-normal on top); loss: 0..1; drift: ms the base swings by over driftPeriod ms;
 *   burst: per-packet chance to enter / leave the bad state and the loss in it; dropouts: [at ms, dur ms] both ways
 */

/** @param {Conditions} cond @param {number} seed */
export function createNetwork(cond, seed) {
  const rng = mulberry32(seed ^ 0x5bd1e995);
  const gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += rng(); return (s - 2) / 0.577; };
  const rooms = new Map();
  let codes = 0;
  const stats = { sent: 0, lost: 0, dropped: 0, ctrl: 0, frozenLost: 0, listed: 0, unlisted: 0 };
  const bad = [false, false];          // per direction: in a loss burst
  const lastCtrl = [0, 0];             // per direction: the last control delivery time (ordered)

  const inDropout = (t) => (cond.dropouts || []).find((d) => t >= d.at && t < d.at + d.dur) || null;
  const oneWay = (t) => Math.max(5, cond.base + (cond.drift ? cond.drift * Math.sin(2 * Math.PI * t / (cond.driftPeriod || 20000)) : 0) + Math.abs(gauss()) * cond.jitter);

  function deliverPacket(dir, to, buf) {
    const t = sched.t;
    stats.sent++;
    if (inDropout(t)) { stats.dropped++; return; }
    const b = cond.burst;
    if (b) bad[dir] = bad[dir] ? rng() >= b.exit : rng() < b.enter;
    if (rng() < (bad[dir] && b ? b.loss : cond.loss)) { stats.lost++; return; }
    const arrive = t + oneWay(t);
    if (inDropout(arrive)) { stats.dropped++; return; }
    const copy = buf.slice(0);
    at(arrive, () => {
      if (to.owner && to.owner.frozenUntil > sched.t) { stats.frozenLost++; return; }
      if (to.closed) return;
      sched.cur = to.owner; to.emit('packet', copy);
    }, null, 'net');
  }
  function deliverControl(dir, to, msg) {
    const t = sched.t;
    stats.ctrl++;
    let arrive = t + oneWay(t);
    const d = inDropout(t) || inDropout(arrive);
    if (d) arrive = Math.max(arrive, d.at + d.dur + oneWay(d.at + d.dur));
    arrive = Math.max(arrive, lastCtrl[dir] + 0.01);
    lastCtrl[dir] = arrive;
    const copy = JSON.parse(JSON.stringify(msg));
    at(arrive, () => { if (!to.closed) to.emit('control', copy); }, to.owner, 'net');
  }

  // ---- spectators: each room runs the Worker's own watch code (src/net/watchroom.js). The host's messages to
  // the room and the room's to everyone ride reliable, ordered sockets: delayed, never lost ----
  const live = new Map();   // the LIVE list, as the rooms keep it
  const ordered = () => { let last = 0; return (fn, owner) => { const t = Math.max(sched.t + oneWay(sched.t), last + 0.01); last = t; at(t, fn, owner, 'net'); }; };
  function roomOf(code) {
    let r = rooms.get(code);
    if (r) return r;
    r = { host: null, guest: null, watchers: new Set(), up: ordered(), priv: false, starts: 0, batches: 0 };
    r.desk = createWatchRoom({
      now: () => sched.t,
      players: (text) => { for (const l of [r.host, r.guest]) if (l && !l.closed) l.down(() => { if (!l.closed) l.emit('watching', JSON.parse(text)); }, l.owner); },
      spectators: (except) => [...r.watchers].filter((w) => w !== except && !w.closed),
      kick: (reason) => { for (const w of [...r.watchers]) w.drop(4002, reason); },
      list: (e) => { stats.listed++; live.set(code, { ...e, code }); },
      unlist: () => { if (live.delete(code)) stats.unlisted++; },
    });
    rooms.set(code, r);
    return r;
  }

  return {
    stats, live, rooms, roomOf,
    /** a crew's match room: private (worker/crew.ts claims it that way) */
    claimPrivate(code) { const r = roomOf(code); r.priv = true; r.desk.priv = true; },
    /** a spectator's socket to a room (src/net/watch.js openSocket), as the Worker's /watch answers it */
    watchSocket(code, owner) {
      const r = rooms.get(code);
      const down = ordered();
      const sock = {
        owner, closed: false, onmessage: null, onclose: null,
        send(data) { if (sock.closed) return; const copy = typeof data === 'string' ? data : data.slice(0); down(() => { if (!sock.closed && sock.onmessage) sock.onmessage(copy); }, owner); },   // room -> spectator
        /** the room closes it */
        drop(c, reason) { if (sock.closed) return; down(() => { if (sock.closed) return; sock.closed = true; if (r) r.watchers.delete(sock); if (sock.onclose) sock.onclose(c, reason); }, owner); },
        /** the spectator closes it (or its network dies: silent) */
        close() { if (sock.closed) return; sock.closed = true; if (r) { r.watchers.delete(sock); at(sched.t + oneWay(sched.t), () => r.desk.count(), null, 'net'); } },
      };
      at(sched.t + oneWay(sched.t), () => {
        if (sock.closed) return;
        const alive = r && (r.host || r.guest);
        const reason = !alive ? 'no-room' : r.desk.refusal(r.watchers.size);
        if (reason) { sock.send(JSON.stringify({ t: 'sys', ev: 'error', reason })); sock.drop(4000, reason); return; }
        r.watchers.add(sock);
        r.desk.join(sock);
      }, null, 'net');
      return sock;
    },
    async createRoom() { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let n = codes++, c = ''; for (let i = 0; i < 4; i++) { c += a[n % a.length]; n = Math.floor(n / a.length); } return c; },
    /** @param {{ code: string, role: 'host' | 'guest', owner: any }} o */
    createLink({ code, role, owner }) {
      const handlers = {};
      const link = {
        role, code, owner, mode: 'connecting', candidate: '', ready: false, closed: false,
        on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return link; },
        emit(ev, ...a) { for (const f of handlers[ev] || []) f(...a); },
        sendControl(msg) {
          const p = peer();
          if (p && !link.closed) deliverControl(role === 'host' ? 0 : 1, p, msg);
          // the room sees the host's resync go by (worker/index.ts keeps it for spectators)
          if (role === 'host' && msg && msg.t === 'sync' && !link.closed) { const text = JSON.stringify(msg); room.up(() => { if (room.desk.match) room.desk.onSync(text); }, null); }
        },
        /** to the room itself: the host's spectator feed (src/net/watchfeed.js) */
        sendRoom(data) {
          if (link.closed || role !== 'host') return;
          const copy = typeof data === 'string' ? data : data.slice(0);
          room.up(() => { if (typeof copy === 'string') { if (copy.includes('"ev":"start"')) room.starts++; room.desk.onWatch(copy); } else { room.batches++; room.desk.onBatch(copy); } }, null);
        },
        down: ordered(),
        sendPacket(buf) { const p = peer(); if (p && !link.closed) deliverPacket(role === 'host' ? 0 : 1, p, buf); },
        close() {
          if (link.closed) return;
          link.closed = true;
          const p = peer();
          const r = rooms.get(code); if (r) r[role] = null;
          // a player gone ends the match for anyone watching; an empty room sends its spectators away
          if (r) at(sched.t + oneWay(sched.t), () => r.desk.stop('left', !r.host && !r.guest), null, 'net');
          // the room tells the other side its peer left (over its socket: delayed like a control message)
          if (p && !p.closed) at(sched.t + oneWay(sched.t), () => { if (!p.closed) p.emit('peer', false); }, p.owner, 'net');
        },
      };
      const peer = () => { const r = rooms.get(code); return r ? r[role === 'host' ? 'guest' : 'host'] : null; };
      const r = roomOf(code), room = r;
      r[role] = link;
      at(sched.t + oneWay(sched.t), () => { if (!link.closed) link.emit('open'); }, owner, 'net');
      const other = peer();
      if (other) {
        // both in: the room tells each, then the DataChannel opens a round trip later
        const t0 = sched.t + oneWay(sched.t);
        for (const l of [link, other]) {
          at(t0, () => { if (!l.closed) l.emit('peer', true); }, l.owner, 'net');
          at(t0 + 2 * cond.base + 40, () => { if (l.closed) return; l.mode = 'p2p'; l.ready = true; l.emit('status', l); }, l.owner, 'net');
        }
      }
      return link;
    },
  };
}
