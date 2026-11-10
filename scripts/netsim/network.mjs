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
  const stats = { sent: 0, lost: 0, dropped: 0, ctrl: 0, frozenLost: 0 };
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

  return {
    stats,
    async createRoom() { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let n = codes++, c = ''; for (let i = 0; i < 4; i++) { c += a[n % a.length]; n = Math.floor(n / a.length); } return c; },
    /** @param {{ code: string, role: 'host' | 'guest', owner: any }} o */
    createLink({ code, role, owner }) {
      const handlers = {};
      const link = {
        role, code, owner, mode: 'connecting', candidate: '', ready: false, closed: false,
        on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return link; },
        emit(ev, ...a) { for (const f of handlers[ev] || []) f(...a); },
        sendControl(msg) { const p = peer(); if (p && !link.closed) deliverControl(role === 'host' ? 0 : 1, p, msg); },
        sendPacket(buf) { const p = peer(); if (p && !link.closed) deliverPacket(role === 'host' ? 0 : 1, p, buf); },
        close() {
          if (link.closed) return;
          link.closed = true;
          const p = peer();
          const r = rooms.get(code); if (r) r[role] = null;
          // the room tells the other side its peer left (over its socket: delayed like a control message)
          if (p && !p.closed) at(sched.t + oneWay(sched.t), () => { if (!p.closed) p.emit('peer', false); }, p.owner, 'net');
        },
      };
      const peer = () => { const r = rooms.get(code); return r ? r[role === 'host' ? 'guest' : 'host'] : null; };
      const r = rooms.get(code) || { host: null, guest: null };
      r[role] = link; rooms.set(code, r);
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
