// Delay-based lockstep. Both players run the whole sim; frame f runs only once both players'
// inputs for f are in. Each side samples its own input `delay` frames ahead of the frame it is
// about to run, so the input has that long to cross the network before the other side needs it;
// if it still hasn't arrived, the sim waits (a stall) instead of guessing.
//
// Rollback-ready on purpose: every frame's inputs for both players stay in a history ring
// (HISTORY frames), and the sim only ever moves through simulate(frame). Rollback would add a
// guess for a missing remote input, a saved sim state per frame, and a re-simulate from the
// first wrong guess through simulate() again. What it still needs is a sim + rig state
// save/restore (the rig keeps its state in closures today); see README, "Multiplayer".

import { hashSim, dumpSim, diffDumps } from './hash.js';
import { encodeInput, decodeInput, inputPacket, clockPacket, parsePacket, PKT_INPUT, PKT_PING, PKT_PONG, NO_FRAME, MAX_INPUTS_PER_PACKET } from './codec.js';

const STEP_MS = 1000 / 120;          // the sim's fixed step
const HISTORY = 1024;                // frames of input history kept per player (8.5 s)
const MASK = HISTORY - 1;
export const DELAY_START = 3, DELAY_MIN = 3, DELAY_MAX = 12;
const HASH_EVERY = 30;               // frames between state hash exchanges (4 a second)
const DUMPS_KEPT = 8;
const PING_MS = 500;
const SEND_GAP_MS = 1000 / 60;       // inputs go out at most this often (and every frame stepped)
const LOST_MS = 10000;               // no packet for this long: the other side is gone

function ring() { return { code: new Uint16Array(HISTORY), frame: new Int32Array(HISTORY).fill(-1) }; }

/**
 * @param {{
 *   sim: any, localIndex: number, link: { sendPacket(b: ArrayBuffer): void, sendControl(o: object): void },
 *   sampleLocal: (frame: number) => any, now?: () => number, delay?: number, adaptDelay?: boolean,
 *   onDesync?: (info: { frame: number, local: string, remote: string, diff?: string[] }) => void,
 * }} o
 */
export function createLockstep({ sim, localIndex, link, sampleLocal, now = () => performance.now(), delay = DELAY_START, adaptDelay = true, onDesync }) {
  const remoteIndex = 1 - localIndex;
  const hist = [ring(), ring()];              // per player: frame -> input code
  const cur = [decodeInput(0), decodeInput(0)];   // the inputs simulate() hands the controllers
  let frame = 0;                              // the next frame to simulate
  let localTop = -1;                          // newest frame with a local input
  let remoteTop = -1;                         // newest remote frame held with no gaps before it
  let ackedByRemote = -1;                     // newest local frame the other side has confirmed
  let remoteFrame = -1;                       // the other side's own frame, as last reported
  let acc = 0, lastSend = -1e9, lastPing = -1e9, lastPacket = now(), lastAdapt = now();
  let stalledMs = 0, stallFrames = 0, stalls = 0, stalling = false;
  let rtt = 0, jitter = 0, rttSamples = 0;
  const hashes = new Map(), remoteHashes = new Map(), dumps = new Map();
  /** @type {null | { frame: number, local: string, remote: string, diff?: string[] }} */
  let desync = null;
  let hashChecks = 0;

  const has = (p, f) => hist[p].frame[f & MASK] === f;
  const put = (p, f, code) => { hist[p].frame[f & MASK] = f; hist[p].code[f & MASK] = code; };
  const get = (p, f) => hist[p].code[f & MASK];

  // the first `delay` frames have no sampled input: both sides start them empty
  function fillLocal() {
    const want = frame + delay;
    if (localTop >= want) return;
    while (localTop < want) { localTop++; put(localIndex, localTop, localTop < delay ? 0 : encodeInput(sampleLocal(localTop))); }
  }

  /** The one place the sim moves. Rollback would call this again over corrected inputs. */
  function simulate(f) {
    cur[localIndex] = decodeInput(get(localIndex, f));
    cur[remoteIndex] = decodeInput(get(remoteIndex, f));
    sim.tick();
    if ((f + 1) % HASH_EVERY === 0) {
      const h = hashSim(sim);
      hashes.set(f, h);
      dumps.set(f, dumpSim(sim));
      if (dumps.size > DUMPS_KEPT) dumps.delete(dumps.keys().next().value);
      if (hashes.size > 64) hashes.delete(hashes.keys().next().value);
      link.sendControl({ t: 'hash', f, h });
      check(f);
    }
  }
  function check(f) {
    const a = hashes.get(f), b = remoteHashes.get(f);
    if (a == null || b == null) return;
    remoteHashes.delete(f);
    hashChecks++;
    if (a === b || desync) return;
    desync = { frame: f, local: a, remote: b };
    console.warn(`[net] DESYNC at frame ${f}: local ${a}, remote ${b}`);
    const d = dumps.get(f);
    if (d) link.sendControl({ t: 'dump', f, dump: d });
    if (onDesync) onDesync(desync);
  }

  function sendInputs(force) {
    const t = now();
    if (localTop < 0) return;
    // everything the other side hasn't confirmed, oldest first (so a long loss still heals);
    // with nothing new, the newest input again, as a keepalive that carries the ack
    let first = Math.max(ackedByRemote + 1, localTop - (HISTORY - 1));
    const fresh = first <= localTop;
    if (!fresh) first = localTop;
    if (!force && t - lastSend < (fresh ? SEND_GAP_MS : 50)) return;
    const last = Math.min(localTop, first + MAX_INPUTS_PER_PACKET - 1);
    const codes = [];
    for (let f = first; f <= last; f++) codes.push(get(localIndex, f));
    link.sendPacket(inputPacket(first, codes, remoteTop < 0 ? NO_FRAME : remoteTop, frame));
    lastSend = t;
  }

  function adapt(t) {
    if (!adaptDelay || t - lastAdapt < 1000) return;
    lastAdapt = t;
    // my delay is how early my input reaches the other side: one way across, one send gap,
    // and room for jitter; a second with stalls asks for one more frame
    let want = Math.ceil((rtt / 2 + SEND_GAP_MS + 2 * jitter) / STEP_MS);
    if (stallFrames > 6) want = Math.max(want, delay + 1);
    want = Math.max(DELAY_MIN, Math.min(DELAY_MAX, want));
    if (want > delay) delay++;                       // up one frame a second
    else if (want < delay - 1 && stallFrames === 0) delay--;   // down only with headroom and no stalls
    stallFrames = 0;
  }

  const api = {
    /** controllers for the sim: unit i reads the input simulate() set for this frame */
    controller(i) { const fn = () => cur[i]; fn.label = i === localIndex ? 'YOU' : 'RIVAL'; return fn; },   // label: the HUD's name under the bar
    /** run as many frames as `ms` of real time allows and the inputs permit */
    advance(ms) {
      const t = now();
      // the side that's ahead gives a little time back, so neither ends up waiting every frame
      if (remoteFrame >= 0 && rttSamples) {
        const lead = frame - (remoteFrame + (t - lastPacket + rtt / 2) / STEP_MS);
        if (lead > 1.5) ms *= 0.9;
      }
      acc = Math.min(acc + ms, Math.max(STEP_MS * (delay + 4), 120));   // a slow frame (a busy phone) still catches up
      fillLocal();
      let stepped = 0;
      const wasStalling = stalling;
      stalling = false;
      while (acc >= STEP_MS) {
        if (frame >= api.haltAt) { acc = 0; break; }   // tests: stop both sides on the same frame
        if (frame > remoteTop) { stalling = true; break; }
        simulate(frame);
        frame++; acc -= STEP_MS; stepped++;
        fillLocal();
      }
      if (stalling) stallFrames++;   // short of a remote input at least once (the delay may grow)
      stalling = stalling && !stepped;   // waiting with no frame run at all: shown after a moment
      if (stalling) { stalledMs += ms; if (!wasStalling) stalls++; }
      else stalledMs = 0;
      sendInputs(stepped > 0);
      if (t - lastPing > PING_MS) { lastPing = t; link.sendPacket(clockPacket(PKT_PING, t)); }
      adapt(t);
      return stepped;
    },
    /** @param {ArrayBuffer} buf */
    onPacket(buf) {
      const p = parsePacket(buf);
      if (!p) return;
      lastPacket = now();
      if (p.type === PKT_PING) { link.sendPacket(clockPacket(PKT_PONG, /** @type {number} */ (p.t))); return; }
      if (p.type === PKT_PONG) {
        const s = now() - /** @type {number} */ (p.t);
        if (s < 0 || s > 10000) return;
        if (!rttSamples) { rtt = s; jitter = 0; } else { jitter += (Math.abs(s - rtt) - jitter) * 0.2; rtt += (s - rtt) * 0.2; }
        rttSamples++;
        return;
      }
      if (p.type !== PKT_INPUT || !p.codes) return;
      for (let i = 0; i < p.codes.length; i++) {
        const f = /** @type {number} */ (p.first) + i;
        if (f > remoteTop && f <= remoteTop + HISTORY - 1 && !has(remoteIndex, f)) put(remoteIndex, f, p.codes[i]);
      }
      while (has(remoteIndex, remoteTop + 1)) remoteTop++;
      if (p.ack !== NO_FRAME) ackedByRemote = Math.max(ackedByRemote, /** @type {number} */ (p.ack));
      remoteFrame = Math.max(remoteFrame, /** @type {number} */ (p.frame));
    },
    /** control messages that belong to the netcode: state hashes and desync dumps */
    onControl(msg) {
      if (msg.t === 'hash') { remoteHashes.set(msg.f, msg.h); check(msg.f); return true; }
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
      return { frame, delay, rtt, jitter, stalledMs, stalls, stalling, remoteTop, localTop, desync, hashChecks, lastHash: [...hashes.entries()].pop() || null, lostMs: now() - lastPacket };
    },
    get lost() { return now() - lastPacket > LOST_MS; },
    get frame() { return frame; },
    get delay() { return delay; },
    set delay(d) { delay = Math.max(DELAY_MIN, Math.min(DELAY_MAX, d | 0)); },
    get desync() { return desync; },
    hashes,
    haltAt: Infinity,
  };
  return api;
}
