// Rollback netcode (GGPO style). Both players run the whole sim. Each side runs its own input
// after a small fixed delay (LOCAL_DELAY frames), guesses the other side's input (the last one it
// has, repeated), and keeps going. When the real input for a frame arrives and differs from the
// guess, it loads the state saved before that frame and runs the sim again from there to the
// present through simulate(), the one place the sim moves. The other side does the same.
//
// - Saving: before simulating a frame on a guess, the sim's whole state is saved
//   (sim.saveState, src/combat/snapshot.js) into a ring of reused snapshots. Frames run on real
//   inputs need no snapshot: nothing can roll back into them.
// - Depth: at most MAX_ROLLBACK frames are ever run on guesses. Past that the sim waits for the
//   other side's inputs (a stall, shown as WAITING FOR RIVAL after a moment).
// - Delay: LOCAL_DELAY frames normally. When the one-way trip is longer than the rollback window
//   covers, the delay grows (one frame a second) so the guesses stay inside it.
// - Time sync: the side that's ahead of the other gives a little time back, so neither runs far
//   ahead and pays for it in rollbacks while the other waits.
// - Effects: a frame's events (sounds, sparks, shake, callouts, scoring) fire the first time the
//   frame is simulated. A re-run fires only events that didn't fire for that frame before (a hit
//   the guess missed); events that already fired are held back, and an effect from a wrong guess
//   is not taken back (a stray spark or sound now and then). See eventGate().
// - Hashes: every HASH_EVERY frames, once a frame is confirmed (both real inputs in), each side
//   sends the hash of the state after it; a mismatch is a DESYNC (both log which fields differ).
// - Resync: on a mismatch the host sends the guest its confirmed state (the state after its newest
//   confirmed frame, as text: src/net/state.js) over the reliable channel, in chunks; the guest loads it
//   and re-runs the sim from there to the present on the inputs it has. Hash checks of frames before the
//   resync point are moot from then on, and the guest's hashes carry how many resyncs it has applied
//   (its epoch), so the host doesn't answer a stale hash from before one with another.
// - The end of a match: the sim halts endHold frames after the frame the result first shows on (matchAt);
//   a correction that moves the result moves the halt with it, either way.
//
// The wire format (src/net/codec.js) is the lockstep's: every input the other side hasn't acked
// goes out in each packet (unordered, no retransmits; a lost packet is covered by the next).

import { hashSim, dumpSim, diffDumps } from './hash.js';
import { encodeState, decodeState } from './state.js';
import { encodeInput, decodeInput, inputPacket, clockPacket, parsePacket, PKT_INPUT, PKT_PING, PKT_PONG, NO_FRAME, MAX_INPUTS_PER_PACKET } from './codec.js';
import { perf as profiler } from '../perf.js';   // the worst re-sim burst, for the ?perf=1 overlay

const STEP_MS = 1000 / 120;          // the sim's fixed step
const HISTORY = 1024;                // frames of input history kept per player (8.5 s)
const MASK = HISTORY - 1;
export const MAX_ROLLBACK = 12;      // frames that may run on a guess (100 ms); past that, stall
export const LOCAL_DELAY = 2, DELAY_MAX = 10;
const SNAPS = MAX_ROLLBACK + 2;      // snapshot ring
const HASH_EVERY = 30;               // frames between state hash exchanges (4 a second)
const DUMPS_KEPT = 8;
const PING_MS = 500;
const SEND_GAP_MS = 1000 / 60;       // inputs go out at most this often (and every frame stepped)
const LOST_MS = 15000;               // no packet for this long: the other side is gone (a 10 s cellular dropout rides out as a stall)
const SYNC_CHUNK = 12000;            // characters of state per control message (the room drops messages over 16 KB)
const SYNC_GAP_MS = 700;             // the host sends a resync at most this often
const ASK_GAP_MS = 1000;             // the guest asks for one at most this often

const perf = () => performance.now();   // for the cost measurements (the netcode's own clock is `now`)
function ring() { return { code: new Uint16Array(HISTORY), frame: new Int32Array(HISTORY).fill(-1) }; }

// the identity of an event, for telling a re-run's events from the ones that already fired:
// its type and who it's about (units by id), not its exact position, which a correction can move
const uid = (u) => (u && typeof u === 'object' ? u.id : '');
function eventSig(ev) {
  const near = ev.attacker || ev.defender || ev.unit || ev.by != null ? '' : `${ev.dir || 0}:${Math.round((ev.x || 0) / 64)}`;
  return `${ev.type}|${uid(ev.attacker)}|${uid(ev.defender)}|${uid(ev.unit)}|${ev.move || ''}|${ev.text || ''}|${ev.by != null ? ev.by : ''}|${near}`;
}

/**
 * @param {{
 *   sim: any, localIndex: number, link: { sendPacket(b: ArrayBuffer): void, sendControl(o: object): void },
 *   sampleLocal: (frame: number) => any, now?: () => number, delay?: number, adaptDelay?: boolean,
 *   maxRollback?: number, match?: number, endHold?: number,
 *   onDesync?: (info: { frame: number, local: string, remote: string, diff?: string[] }) => void,
 *   onResync?: (info: { frame: number, role: 'sent' | 'applied', bytes: number }) => void,
 * }} o
 */
export function createRollback({ sim, localIndex, link, sampleLocal, now = () => performance.now(), delay = LOCAL_DELAY, adaptDelay = true, maxRollback = MAX_ROLLBACK, match = 0, endHold = Infinity, onDesync, onResync }) {
  const remoteIndex = 1 - localIndex;
  const maxRb = Math.max(1, Math.min(MAX_ROLLBACK, maxRollback | 0));
  const hist = [ring(), ring()];              // per player: frame -> input code (real inputs only)
  const used = ring();                        // frame -> the remote code the last simulation of it used
  const cur = [decodeInput(0), decodeInput(0)];   // the inputs simulate() hands the controllers
  /** @type {{ frame: number, state: any }[]} */
  const snaps = Array.from({ length: SNAPS }, () => ({ frame: -1, state: null }));
  /** @type {{ frame: number, fired: Map<string, number> | null }[]} */
  const fired = Array.from({ length: 64 }, () => ({ frame: -1, fired: null }));
  let frame = 0;                              // the next frame to simulate
  let maxSimulated = -1;                      // newest frame ever simulated (its events have fired)
  let localTop = -1;                          // newest frame with a local input
  let remoteTop = -1;                         // newest remote frame held with no gaps before it
  let remoteNewest = -1;                      // newest remote frame held at all
  let rollbackFrom = Infinity;                // oldest frame whose guess turned out wrong
  let ackedByRemote = -1;                     // newest local frame the other side has confirmed
  let remoteFrame = -1, remoteFrameAt = 0;    // the other side's own frame, as last reported, and when
  let acc = 0, lastSend = -1e9, lastPing = -1e9, lastPacket = now(), lastAdapt = now();
  let stalledMs = 0, stallFrames = 0, stalls = 0, stalling = false;
  let rtt = 0, jitter = 0, rttSamples = 0;
  let nextHash = HASH_EVERY - 1;              // the next hash frame to send once confirmed
  const hashes = new Map(), remoteHashes = new Map(), dumps = new Map();
  /** @type {null | { frame: number, local: string, remote: string, diff?: string[], at?: number }} */
  let desync = null;
  let hashChecks = 0;
  // resync: frames before resyncFloor no longer count in hash checks (the state they hashed was replaced);
  // epoch counts the resyncs this side has applied (guest) or sent (host)
  const host = localIndex === 0;
  let resyncFloor = 0, epoch = 0, lastSyncAt = -1e9, lastAskAt = -1e9, syncWanted = false, resyncs = 0, lastResyncAt = -1e9;
  let dumped = -1;   // the resync floor the last desync dump went out for (one dump per episode)
  /** @type {Map<string, { f: number, of: number, parts: string[], got: number, at: number, e: number }>} */
  const incoming = new Map();
  let broken = '';   // the link can't recover this match (inputs fell out of the history): online.js ends it
  // the frame on which the sim first showed the match result (phase 'match'), or -1: online.js ends
  // the match a fixed number of frames after it, once that frame is confirmed on both sides
  let matchAt = -1;
  const tag = match & 255;   // this match's number on every input packet and hash (stale ones are dropped)
  // measurements
  const rb = { count: 0, frames: 0, maxDepth: 0, ms: 0, maxMs: 0, lastDepth: 0, saves: 0, saveMs: 0, predictedFrames: 0, eventsHeld: 0, eventsLate: 0, advMs: 0, advMax: 0, advN: 0 };

  const has = (p, f) => hist[p].frame[f & MASK] === f;
  const put = (p, f, code) => { hist[p].frame[f & MASK] = f; hist[p].code[f & MASK] = code; };
  const get = (p, f) => hist[p].code[f & MASK];

  // the guess for a remote frame we don't have: the newest real input before it
  function predict(f) {
    for (let g = Math.min(f - 1, remoteNewest); g >= 0 && g > f - HISTORY; g--) if (has(remoteIndex, g)) return get(remoteIndex, g);
    return 0;
  }

  // the first `delay` frames have no sampled input: both sides start them empty
  function fillLocal() {
    const want = frame + delay;
    while (localTop < want) { localTop++; put(localIndex, localTop, localTop < LOCAL_DELAY ? 0 : encodeInput(sampleLocal(localTop))); }
  }

  // Event policy: the first simulation of a frame fires all its events and remembers them; a re-run
  // fires only events beyond what already fired for that frame (counted, so two footsteps stay two).
  let gate = /** @type {{ replay: boolean, map: Map<string, number>, seen: Map<string, number> }} */ ({ replay: false, map: new Map(), seen: new Map() });
  function eventGate(ev) {
    const sig = eventSig(ev), n = (gate.seen.get(sig) || 0) + 1;
    gate.seen.set(sig, n);
    if (n <= (gate.map.get(sig) || 0)) { rb.eventsHeld++; return false; }
    gate.map.set(sig, n);
    if (gate.replay) rb.eventsLate++;
    return true;
  }

  // the frame the sim halts on: endHold frames after the result first showed (tests may halt sooner)
  const endAt = () => Math.min(api.haltAt, matchAt >= 0 ? matchAt + endHold : Infinity);
  /** re-run frames from..to-1 (the state loaded is the one before `from`), stopping at the halt; the new frame */
  function resim(from, to) {
    let f = from;
    while (f < to) { simulate(f); f++; if (f >= endAt()) break; }
    return Math.max(f, from);
  }

  /** The one place the sim moves. A rollback calls it again for every frame it re-runs. */
  function simulate(f) {
    const known = has(remoteIndex, f);
    const code = known ? get(remoteIndex, f) : predict(f);
    used.frame[f & MASK] = f; used.code[f & MASK] = code;
    if (!known) {
      // this frame runs on a guess: keep the state before it, so a correction can come back here
      const t0 = perf(), s = snaps[f % SNAPS];
      s.state = sim.saveState(s.state); s.frame = f;
      rb.saves++; rb.saveMs += perf() - t0; rb.predictedFrames++;
    }
    cur[localIndex] = decodeInput(get(localIndex, f));
    cur[remoteIndex] = decodeInput(code);
    const slot = fired[f & 63];
    if (f > maxSimulated || slot.frame !== f || !slot.fired) { slot.frame = f; slot.fired = new Map(); gate.replay = false; }
    else gate.replay = true;
    gate.map = slot.fired; gate.seen.clear();
    if (matchAt >= f) matchAt = -1;   // re-running the frame it was found on (or before): find it again
    sim.eventFilter = eventGate;
    try { sim.tick(); } finally { sim.eventFilter = null; }
    if (matchAt < 0 && sim.phase === 'match') matchAt = f;
    if (f > maxSimulated) maxSimulated = f;
    if ((f + 1) % HASH_EVERY === 0) {
      hashes.set(f, hashSim(sim));
      dumps.set(f, dumpSim(sim));
      if (dumps.size > DUMPS_KEPT * 3) dumps.delete(dumps.keys().next().value);
      if (hashes.size > 64) hashes.delete(hashes.keys().next().value);
    }
  }

  function rollback() {
    const from = rollbackFrom;
    rollbackFrom = Infinity;
    if (!(from < frame)) return;
    const s = snaps[from % SNAPS];
    if (s.frame !== from || !s.state) { console.warn(`[net] no snapshot for frame ${from} (at ${frame})`); return; }
    const t0 = perf();
    sim.loadState(s.state);
    const depth = frame - from;
    frame = resim(from, frame);   // (a correction that ends the match sooner stops there)
    const ms = perf() - t0;
    rb.count++; rb.frames += depth; rb.lastDepth = depth; rb.maxDepth = Math.max(rb.maxDepth, depth);
    rb.ms += ms; rb.maxMs = Math.max(rb.maxMs, ms);
    profiler.rollback(ms, depth);
  }

  // the newest confirmed frame: simulated, with the real input on both sides, and no correction
  // still waiting to re-run it
  const confirmedTop = () => Math.min(remoteTop, frame - 1, rollbackFrom - 1);
  // hashes go out only for confirmed frames
  function confirmHashes() {
    const top = confirmedTop();
    while (nextHash <= top) {
      const h = hashes.get(nextHash);
      if (h != null) { link.sendControl({ t: 'hash', f: nextHash, h, m: tag, e: epoch }); check(nextHash); }
      nextHash += HASH_EVERY;
    }
  }
  function check(f) {
    const a = hashes.get(f), b = remoteHashes.get(f);
    if (a == null || b == null || f > confirmedTop()) return;
    remoteHashes.delete(f);
    if (f < resyncFloor) return;   // a state a resync has since replaced
    hashChecks++;
    if (a === b) { if (desync && f >= resyncFloor) desync = null; return; }
    mismatch(f, a, b);
  }
  /** two different states for a confirmed frame: log it once per episode, and get the guest the host's state */
  function mismatch(f, a, b) {
    const t = now();
    if (!desync) {
      desync = { frame: f, local: a, remote: b, at: t };
      console.warn(`[net] DESYNC at frame ${f}: local ${a}, remote ${b}` + (resyncs ? ` (after ${resyncs} resyncs)` : ''));
      if (onDesync) onDesync(desync);
    }
    if (dumped !== resyncFloor) { const d = dumps.get(f); if (d) { dumped = resyncFloor; link.sendControl({ t: 'dump', f, dump: d, m: tag }); } }
    if (host) wantSync(); else ask(f);
  }
  function ask(f) {
    const t = now();
    if (t - lastAskAt < ASK_GAP_MS) return;
    lastAskAt = t;
    link.sendControl({ t: 'resync?', f, m: tag, e: epoch });
  }
  // the host: send the confirmed state as soon as there is one (see sendSync), at most every SYNC_GAP_MS
  function wantSync() { syncWanted = true; trySync(); }
  function trySync() {
    if (!syncWanted || !host || now() - lastSyncAt < SYNC_GAP_MS) return;
    // the state after the newest confirmed frame c: the live sim when nothing after c has run, else the
    // snapshot saved before frame c+1 (c+1 ran on a guess, so there is one; a correction re-saves it)
    const c = confirmedTop();
    let state = null;
    if (c === frame - 1) state = sim.saveState();
    else { const sn = snaps[(c + 1) % SNAPS]; if (sn.frame === c + 1 && sn.state) state = sn.state; }
    if (!state || c < 0) return;   // nothing confirmed yet: the next advance tries again
    const text = encodeState(sim, state), F = c + 1, id = `${tag}.${epoch + 1}`;
    const of = Math.ceil(text.length / SYNC_CHUNK);
    epoch++; resyncFloor = F; syncWanted = false; lastSyncAt = now();
    for (let i = 0; i < of; i++) link.sendControl({ t: 'sync', m: tag, id, e: epoch, f: F, i, of, at: matchAt >= 0 && matchAt < F ? matchAt : -1, d: text.slice(i * SYNC_CHUNK, (i + 1) * SYNC_CHUNK) });
    for (const k of [...remoteHashes.keys()]) if (k < F) remoteHashes.delete(k);
    resyncs++; lastResyncAt = now();
    console.warn(`[net] RESYNC: sent the state after frame ${c} (${(text.length / 1024).toFixed(1)} KB in ${of} parts)`);
    if (onResync) onResync({ frame: F, role: 'sent', bytes: text.length });
  }
  // the guest: the host's state for the start of frame F; load it and run back up to the present
  function applySync(F, text, at, e) {
    if (e <= epoch || F < resyncFloor) return;   // an older one than what's already loaded
    let state;
    try { state = decodeState(sim, text); } catch (err) { console.warn('[net] resync: bad state', err); return; }
    const t0 = perf(), was = frame;
    sim.loadState(state);
    epoch = e; resyncFloor = F; rollbackFrom = Infinity;
    matchAt = at >= 0 && at < F ? at : -1;
    // forget what this side hashed before F, and don't compare it again
    for (const m of [hashes, remoteHashes, dumps]) for (const k of [...m.keys()]) if (k < F) m.delete(k);
    let h = F; while ((h + 1) % HASH_EVERY) h++;
    nextHash = Math.max(nextHash, h);
    // back up to where this side was (or the halt), on the inputs it has; a side that was behind jumps ahead
    frame = resim(F, Math.min(was, endAt()));
    if (frame > maxSimulated + 1) maxSimulated = frame - 1;
    fillLocal();
    desync = null; resyncs++; lastResyncAt = now();
    console.warn(`[net] RESYNC: loaded the host's state for frame ${F} and ran ${Math.max(0, frame - F)} frames to the present (${(perf() - t0).toFixed(1)} ms)`);
    if (onResync) onResync({ frame: F, role: 'applied', bytes: text.length });
  }

  function sendInputs(force) {
    const t = now();
    if (localTop < 0) return;
    // everything the other side hasn't confirmed, oldest first (so a long loss still heals);
    // with nothing new, the newest input again, as a keepalive that carries the ack. Inputs the other side
    // still needs that have left the history can't be sent: the match can't go on (never in practice: each
    // side stalls MAX_ROLLBACK frames past the other's inputs, far inside the history)
    if (ackedByRemote + 1 < localTop - (HISTORY - 1) - MAX_INPUTS_PER_PACKET && !broken) { broken = 'history'; console.warn('[net] the other side fell out of the input history'); }
    let first = Math.max(ackedByRemote + 1, localTop - (HISTORY - 1));
    const fresh = first <= localTop;
    if (!fresh) first = localTop;
    if (!force && t - lastSend < (fresh ? SEND_GAP_MS : 50)) return;
    const last = Math.min(localTop, first + MAX_INPUTS_PER_PACKET - 1);
    const codes = [];
    for (let f = first; f <= last; f++) codes.push(get(localIndex, f));
    link.sendPacket(inputPacket(first, codes, remoteTop < 0 ? NO_FRAME : remoteTop, frame, tag));
    lastSend = t;
  }

  function adapt(t) {
    if (!adaptDelay || t - lastAdapt < 1000) return;
    lastAdapt = t;
    // the guesses cover maxRb frames of the trip; the delay covers the rest (one way across plus
    // the jitter), and a second with stalls while not ahead asks for one more frame
    let want = Math.ceil((rtt / 2 + jitter) / STEP_MS) - maxRb + 1;
    if (stallFrames > 6) want = Math.max(want, delay + 1);
    want = Math.max(LOCAL_DELAY, Math.min(DELAY_MAX, want));
    if (want > delay) delay++;                       // up one frame a second
    else if (want < delay - 1 && stallFrames === 0) delay--;   // down only with headroom and no stalls
    stallFrames = 0;
  }

  // how far ahead of the other side this side's sim is, in frames (+: ahead)
  function lead(t) {
    if (remoteFrame < 0 || !rttSamples) return 0;
    return frame - (remoteFrame + (t - remoteFrameAt + rtt / 2) / STEP_MS);
  }

  const api = {
    /** controllers for the sim: unit i reads the input simulate() set for this frame */
    controller(i) { const fn = () => cur[i]; fn.label = i === localIndex ? 'YOU' : 'RIVAL'; return fn; },   // label: the HUD's name under the bar
    /** run as many frames as `ms` of real time allows, rolling back first if a guess was wrong */
    advance(ms) {
      const t = now(), t0 = perf();
      // the side that's ahead gives a little time back, so neither ends up far ahead
      const ld = lead(t);
      if (ld > 6) ms *= 0.7; else if (ld > 1) ms *= 0.9;
      acc = Math.min(acc + ms, Math.max(STEP_MS * (maxRb + delay + 2), 120));   // a slow frame (a busy phone) still catches up
      if (rollbackFrom < frame) rollback();
      fillLocal();
      let stepped = 0;
      const wasStalling = stalling;
      stalling = false;
      while (acc >= STEP_MS) {
        if (frame >= endAt()) { acc = 0; break; }   // the match is over (or a test stops both sides on the same frame)
        if (frame - remoteTop > maxRb) { stalling = true; break; }   // guessing any further would pass the rollback window
        simulate(frame);
        frame++; acc -= STEP_MS; stepped++;
        fillLocal();
      }
      // short of remote inputs: the time waited is given up, not banked (a banked burst would put
      // this side right back ahead and stalling again); if this side isn't ahead, the delay may grow,
      // though not over a dropout (nothing arriving at all isn't a long trip)
      if (stalling) { acc = Math.min(acc, STEP_MS); if (ld < 1 && t - lastPacket < 300) stallFrames++; }
      stalling = stalling && !stepped;   // waiting with no frame run at all: shown after a moment
      if (stalling) { stalledMs += ms; if (!wasStalling) stalls++; }
      else stalledMs = 0;
      sendInputs(stepped > 0);
      confirmHashes();
      trySync();
      for (const [k, v] of incoming) if (t - v.at > 30000) incoming.delete(k);   // a resync that never completed
      if (t - lastPing > PING_MS) { lastPing = t; link.sendPacket(clockPacket(PKT_PING, t)); }
      adapt(t);
      const took = perf() - t0;
      rb.advMs += took; rb.advN++; rb.advMax = Math.max(rb.advMax, took);
      return stepped;
    },
    /** @param {ArrayBuffer} buf */
    onPacket(buf) {
      const p = parsePacket(buf);
      if (!p) return;
      const t = now();
      lastPacket = t;
      if (p.type === PKT_PING) { link.sendPacket(clockPacket(PKT_PONG, /** @type {number} */ (p.t))); return; }
      if (p.type === PKT_PONG) {
        const s = t - /** @type {number} */ (p.t);
        if (s < 0 || s > 10000) return;
        if (!rttSamples) { rtt = s; jitter = 0; } else { jitter += (Math.abs(s - rtt) - jitter) * 0.2; rtt += (s - rtt) * 0.2; }
        rttSamples++;
        return;
      }
      if (p.type !== PKT_INPUT || !p.codes || p.match !== tag) return;   // a late packet from another match
      for (let i = 0; i < p.codes.length; i++) {
        const f = /** @type {number} */ (p.first) + i, code = p.codes[i];
        if (f <= remoteTop || f > remoteTop + HISTORY - 1 || has(remoteIndex, f)) continue;
        put(remoteIndex, f, code);
        if (f > remoteNewest) remoteNewest = f;
        // already simulated on a guess that was wrong: roll back to it on the next advance
        if (f < frame && used.frame[f & MASK] === f && used.code[f & MASK] !== code && f < rollbackFrom) rollbackFrom = f;
      }
      // a frame simulated on a guess for a later frame we now have out of order is caught above;
      // a frame whose guess came from an input that has since been replaced can't happen (real
      // inputs never change once held)
      while (has(remoteIndex, remoteTop + 1)) remoteTop++;
      if (p.ack !== NO_FRAME) ackedByRemote = Math.max(ackedByRemote, /** @type {number} */ (p.ack));
      if (/** @type {number} */ (p.frame) > remoteFrame) { remoteFrame = /** @type {number} */ (p.frame); remoteFrameAt = t; }
    },
    /** control messages that belong to the netcode: state hashes, desync dumps and resyncs */
    onControl(msg) {
      const mine = msg.t === 'hash' || msg.t === 'dump' || msg.t === 'sync' || msg.t === 'resync?';
      if (mine && (msg.m | 0) !== tag) return true;   // from another match: not ours to check
      if (msg.t === 'hash') {
        if (host && (msg.e | 0) < epoch) return true;   // hashed before the guest loaded the last resync
        remoteHashes.set(msg.f, msg.h); check(msg.f); if (remoteHashes.size > 256) remoteHashes.delete(remoteHashes.keys().next().value); return true;
      }
      if (msg.t === 'resync?') { if (host && (msg.e | 0) >= epoch) wantSync(); return true; }
      if (msg.t === 'sync') {
        if (host) return true;
        const k = String(msg.id), of = msg.of | 0, i = msg.i | 0;
        if (of < 1 || of > 64 || i < 0 || i >= of || typeof msg.d !== 'string') return true;
        let p = incoming.get(k);
        if (!p) { p = { f: msg.f | 0, of, parts: new Array(of), got: 0, at: now(), e: msg.e | 0 }; incoming.set(k, p); }
        if (p.parts[i] == null) { p.parts[i] = msg.d; p.got++; }
        if (p.got === p.of) { incoming.delete(k); applySync(p.f, p.parts.join(''), typeof msg.at === 'number' ? msg.at : -1, p.e); }
        return true;
      }
      if (msg.t === 'dump') {
        const mine = dumps.get(msg.f);
        const diff = mine ? diffDumps(mine, msg.dump, 40) : ['(no local dump for that frame)'];
        console.warn(`[net] DESYNC at frame ${msg.f}, fields that differ (local vs remote):\n  ` + diff.join('\n  '));
        if (desync) desync.diff = diff;
        else { desync = { frame: msg.f, local: hashes.get(msg.f) || '?', remote: '?', diff }; if (onDesync) onDesync(desync); }
        return true;
      }
      return false;
    },
    stats() {
      const t = now();
      return {
        frame, delay, rtt, jitter, stalledMs, stalls, stalling, remoteTop, localTop, desync, hashChecks, resyncs, epoch, sinceResync: t - lastResyncAt, halted: frame >= endAt(),
        confirmed: confirmedTop(), predicted: Math.max(0, frame - 1 - remoteTop), lead: lead(t),
        lastHash: [...hashes.entries()].filter(([f]) => f <= confirmedTop()).pop() || null,
        lostMs: t - lastPacket, maxRollback: maxRb,
        rollbacks: rb.count, rollbackFrames: rb.frames, avgDepth: rb.count ? rb.frames / rb.count : 0, maxDepth: rb.maxDepth, lastDepth: rb.lastDepth,
        rollbackMs: rb.ms, rollbackMaxMs: rb.maxMs, saves: rb.saves, saveMs: rb.saveMs, predictedFrames: rb.predictedFrames,
        eventsHeld: rb.eventsHeld, eventsLate: rb.eventsLate, advanceAvgMs: rb.advN ? rb.advMs / rb.advN : 0, advanceMaxMs: rb.advMax,
      };
    },
    /** after the match is over: keep sending our inputs and acks (no simulating), so the other side
     *  can confirm its last frames too even if our final packets were lost */
    keepalive() { sendInputs(false); },
    /** the frame the match result first showed on, or -1 */
    get matchAt() { return matchAt; },
    /** the frame the sim halts on at the end of the match (Infinity while it's on) */
    get endAt() { return endAt(); },
    /** a match that can't go on ('' while it can): online.js ends it as a lost connection */
    get broken() { return broken; },
    /** how long this side has been waiting on the other's inputs without running a frame */
    get stalledMs() { return stalledMs; },
    get epoch() { return epoch; },
    get resyncs() { return resyncs; },
    /** the end of the match didn't agree: the host sends its state, the guest asks for it */
    resync() { if (host) wantSync(); else ask(frame - 1); },
    get confirmed() { return confirmedTop(); },
    get ackedByRemote() { return ackedByRemote; },
    get match() { return tag; },
    /** the hash of a confirmed frame, if this side has it (tests) */
    confirmedHash(f) { return f <= confirmedTop() ? hashes.get(f) || null : null; },
    get lost() { return now() - lastPacket > LOST_MS; },
    get frame() { return frame; },
    get delay() { return delay; },
    set delay(d) { delay = Math.max(LOCAL_DELAY, Math.min(DELAY_MAX, d | 0)); },
    get desync() { return desync; },
    hashes,
    haltAt: Infinity,
  };
  return api;
}
