// Spectators (README, Multiplayer, Spectators): what the room and the pages share. Pure code with no DOM and
// no Workers API, so the room's Durable Object (worker/index.ts), the host's upload (watchfeed.js), the
// spectator (watch.js) and the Node proof (scripts/netsim/watch.mjs) all run the same thing.
//
// A match is peer to peer, so the room never sees its inputs. While someone is watching, the host sends the
// room the inputs both players' machines have confirmed (no rollback can change them), a few times a second:
//
//   BATCH  u8 16 | u8 match | u32 first frame | u16 count | u8 hashes | u32 stamp
//          | count x (u16 host's input, u16 guest's input)        (the 11-bit codes of codec.js)
//          | hashes x (u32 frame, u32 state hash)                  (the host's confirmed hash of every 30th frame)
//          stamp = the host's clock, in ms since the match started, when the batch's last frame was confirmed.
//          A batch may hold no frames: time passed on the host and nothing new was confirmed (a stall, WAITING
//          FOR RIVAL), which a spectator shows as the same pause instead of taking it for a slow network.
//
// The room keeps the match's batches in one log and hands spectators only the frames stamped at least HOLD_MS
// before the newest stamp it has, so a viewer is always behind the fight by that much whatever their page
// does. The hold is in the host's time, not in frames: the sim runs at a quarter speed through a KO, and a
// hold counted in frames would run a viewer dry right before every finish. A spectator who joins late gets the
// log so far (old frames in big batches, the last few seconds stamp by stamp) and runs the sim through it.
// The stamps also pace the playback: watch.js plays frame f about when the host did, plus its delay.

import { blockedName } from '../namefilter.js';
export const PKT_WATCH = 16;
export const HEADER = 13;
/** how far behind the newest stamp the room keeps spectators (ms of the host's clock): the delay a viewer can't get around */
export const HOLD_MS = 1500;
/** frames per batch at most: 14 KB, under the room's 16 KB message cap */
export const MAX_BATCH = 3400;
/** a match longer than this stops being logged (20 minutes; 576 KB) */
export const MAX_FRAMES = 144000;
export const MAX_SPECTATORS = 50;
const MAX_HASHES = 120;
const RECENT_MS = 4000;   // stamps this close to the newest stay one to a batch (they pace the playback); older ones merge

/**
 * @param {number} match the match number in the room session
 * @param {number} first the first frame in `codes`
 * @param {Uint16Array} codes two per frame: the host's input, then the guest's
 * @param {number} count frames
 * @param {number} stamp the host's clock (ms since the match started) at the batch's last frame
 * @param {number[]} [hashes] pairs: frame, hash (as an unsigned 32-bit number)
 * @param {number} [offset] where in `codes` the first frame's pair starts
 */
export function encodeBatch(match, first, codes, count, stamp, hashes = [], offset = 0) {
  const nh = Math.min(MAX_HASHES, hashes.length >> 1);
  const buf = new ArrayBuffer(HEADER + 4 * count + 8 * nh), dv = new DataView(buf);
  dv.setUint8(0, PKT_WATCH); dv.setUint8(1, match & 255); dv.setUint32(2, first >>> 0); dv.setUint16(6, count); dv.setUint8(8, nh); dv.setUint32(9, stamp >>> 0);
  let p = HEADER;
  for (let i = 0; i < 2 * count; i++, p += 2) dv.setUint16(p, codes[offset + i]);
  for (let i = 0; i < 2 * nh; i++, p += 4) dv.setUint32(p, hashes[i] >>> 0);
  return buf;
}

/** @param {ArrayBuffer} buf @returns {null | { match: number, first: number, count: number, t: number, codes: Uint16Array, hashes: number[] }} */
export function decodeBatch(buf) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < HEADER) return null;
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== PKT_WATCH) return null;
  const count = dv.getUint16(6), nh = dv.getUint8(8);
  if (count > MAX_BATCH || buf.byteLength !== HEADER + 4 * count + 8 * nh) return null;
  const codes = new Uint16Array(2 * count), hashes = [];
  let p = HEADER;
  for (let i = 0; i < 2 * count; i++, p += 2) codes[i] = dv.getUint16(p);
  for (let i = 0; i < 2 * nh; i++, p += 4) hashes.push(dv.getUint32(p));
  return { match: dv.getUint8(1), first: dv.getUint32(2), count, t: dv.getUint32(9), codes, hashes };
}

/** is this binary message a batch (the room looks before it passes a packet on) */
export function isBatch(buf) { return buf.byteLength >= HEADER && new Uint8Array(buf, 0, 1)[0] === PKT_WATCH; }

/** a growing list of unsigned 16 or 32 bit numbers (the log is 4 bytes a frame, 30 KB a minute) */
function grower(Type, n = 4096) {
  let a = new Type(n), len = 0;
  return {
    push(v) { if (len === a.length) { const b = new Type(a.length * 2); b.set(a); a = b; } a[len++] = v; },
    get length() { return len; },
    get data() { return a; },
  };
}

/**
 * One match's confirmed inputs, in order from frame 0, with the host's hashes and stamps. The host keeps one
 * (everything confirmed, so it can send the room the whole match when the first spectator turns up), the room
 * keeps one (what it has, and how much of it spectators have been sent), and a spectator keeps one (what it
 * plays from).
 */
export function createLog(match = 0) {
  const codes = grower(Uint16Array), hashes = grower(Uint32Array, 256);
  const marks = grower(Uint32Array, 512);   // pairs: frames held at the stamp, the stamp
  let newest = 0, ri = 0, gi = 0, relStamp = 0, lastT = 0;
  const frames = () => codes.length >> 1;
  const marked = () => (marks.length ? marks.data[marks.length - 2] : 0);
  // a stamp with no new frames is kept too (the host stood still); a long pause stretches one flat stretch
  function stamp(t) {
    newest = Math.max(newest, t >>> 0);
    const n = marks.length, f = frames(), M = marks.data;
    if (n >= 4 && M[n - 2] === f && M[n - 4] === f) { M[n - 1] = newest; return; }
    if (n >= 2 && M[n - 2] === f && M[n - 1] === newest) return;
    marks.push(f); marks.push(newest);
  }
  const empty = (at, t) => encodeBatch(log.match, at, codes.data, 0, t);
  const log = {
    match,
    /** frames held */
    get frames() { return frames(); },
    /** the frames spectators have been sent (the room's side) */
    released: 0,
    /** frames that have a stamp (the host's side: only those go to the room) */
    get marked() { return marked(); },
    /** the newest stamp held */
    get newest() { return newest; },
    /** add one frame (the host's side), and now and then the time: the frames so far were confirmed by t */
    push(a, b) { codes.push(a); codes.push(b); },
    hash(frame, h) { hashes.push(frame >>> 0); hashes.push(h >>> 0); },
    mark(t) { stamp(t); },
    /** take a batch in (the room and the spectator): only the frames that follow what's held. False on a gap */
    add(b) {
      const have = frames();
      if (b.first > have) return false;
      if (have >= MAX_FRAMES) return true;
      for (let f = Math.max(have, b.first); f < b.first + b.count && f < MAX_FRAMES; f++) { const i = 2 * (f - b.first); codes.push(b.codes[i]); codes.push(b.codes[i + 1]); }
      const last = hashes.length ? hashes.data[hashes.length - 2] : -1;
      for (let i = 0; i < b.hashes.length; i += 2) if (b.hashes[i] > last && b.hashes[i] < frames()) { hashes.push(b.hashes[i]); hashes.push(b.hashes[i + 1]); }
      stamp(b.t);
      return true;
    },
    /** frames from..to-1 as batches: one per stamp for the last few seconds, older stamps merged, MAX_BATCH frames at most */
    batches(from, to) {
      const out = [], M = marks.data, nm = marks.length;
      to = Math.min(to, marked());
      let hi = 0, mi = 0, f = from;
      while (hi < hashes.length && hashes.data[hi] < from) hi += 2;
      while (mi < nm && M[mi] <= from) mi += 2;
      const emit = (first, n, t) => {
        const hs = [];
        while (hi < hashes.length && hashes.data[hi] < first + n) { hs.push(hashes.data[hi], hashes.data[hi + 1]); hi += 2; }
        out.push(encodeBatch(log.match, first, codes.data, n, t, hs, 2 * first));
        lastT = t;
      };
      while (f < to) {
        let e = f, t = newest;
        while (mi < nm && M[mi] <= f) mi += 2;   // (stamps with no frames of their own)
        while (mi < nm && M[mi] <= to) {
          const recent = M[mi + 1] + RECENT_MS >= newest;
          if (e > f && (recent || M[mi] - f > MAX_BATCH)) break;
          e = M[mi]; t = M[mi + 1]; mi += 2;
          if (recent) break;
        }
        if (e === f) { e = to; if (mi < nm) t = M[mi + 1]; }   // `to` falls inside a stamp's frames
        for (let s = f; s < e; s += MAX_BATCH) emit(s, Math.min(MAX_BATCH, e - s), t);
        f = e;
      }
      return out;
    },
    /** the room: the batches that have just become old enough to show (everything once `all`: the match ended) */
    release(all = false) {
      let to = log.released, st = relStamp;
      if (all) { to = marked(); st = newest; }
      else for (const M = marks.data; ri < marks.length && M[ri + 1] + HOLD_MS <= newest; ri += 2) { to = M[ri]; st = M[ri + 1]; }
      if (to <= log.released && st <= relStamp) return [];
      lastT = relStamp;
      const out = to > log.released ? log.batches(log.released, to) : [];
      if (st > lastT) out.push(empty(to, st));   // time passed with nothing new: say so
      log.released = to; relStamp = st;
      return out;
    },
    /** the room: everything already released, for a spectator who has just joined */
    backlog() { lastT = 0; const out = log.batches(0, log.released); if (relStamp > lastT) out.push(empty(log.released, relStamp)); return out; },
    /** the host: what the room hasn't had yet (the frames from `from` on, or just the time if there are none) */
    since(from) { lastT = 0; const out = log.batches(from, frames()); if (!out.length || newest > lastT) out.push(empty(marked(), newest)); return out; },
    /** the inputs of frame f: the host's code, or with who = 1 the guest's */
    code(f, who) { return codes.data[2 * f + who]; },
    /** how many frames the host had confirmed at its time t (between stamps: a straight line) */
    framesAt(t) {
      const M = marks.data, nm = marks.length;
      if (!nm || t <= 0) return 0;
      if (gi >= nm || (gi > 0 && M[gi - 1] > t)) gi = 0;
      while (gi < nm && M[gi + 1] <= t) gi += 2;
      if (gi >= nm) return M[nm - 2];
      const f0 = gi ? M[gi - 2] : 0, t0 = gi ? M[gi - 1] : 0, f1 = M[gi], t1 = M[gi + 1];
      return t1 > t0 ? f0 + (f1 - f0) * (t - t0) / (t1 - t0) : f1;
    },
    /** the host's hash of frame f (a number), or -1 */
    hashAt(f) { for (let i = hashes.length - 2; i >= 0 && hashes.data[i] >= f; i -= 2) if (hashes.data[i] === f) return hashes.data[i + 1]; return -1; },
  };
  return log;
}

/** a hash as rollback.js writes it (8 hex digits) to the number in a batch, and back */
export const hashNum = (h) => parseInt(h, 16) >>> 0;
export const hashHex = (n) => (n >>> 0).toString(16).padStart(8, '0');

/** what the room and the spectator keep of a start message (anything else is dropped) */
export function cleanSetup(m) {
  if (!m || typeof m !== 'object') return null;
  const n = m.n | 0, v = m.v | 0;
  if (!(n >= 1 && n < 100000) || !(v >= 1)) return null;
  const id = (s) => (typeof s === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(s) ? s : 'temp');
  // a name off the filter's list (src/namefilter.js) is shown to spectators and on the LIVE list as PLAYER
  const name = (s) => { const n = typeof s === 'string' ? s.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12) : ''; return n && blockedName(n) ? 'PLAYER' : n; };
  const num = (x, lo, hi, d) => (Number.isFinite(+x) && +x >= lo && +x <= hi ? Math.floor(+x) : d);
  const chars = Array.isArray(m.chars) ? m.chars : [], names = Array.isArray(m.names) ? m.names : [], wins = Array.isArray(m.wins) ? m.wins : [];
  const r = m.rules && typeof m.rules === 'object' ? m.rules : {}, t = m.tally && typeof m.tally === 'object' ? m.tally : {};
  return {
    n, v, seed: m.seed >>> 0, chars: [id(chars[0]), id(chars[1])], botch: m.botch !== false,
    rules: { roundTime: num(r.roundTime, 0, 999, 60), winsNeeded: num(r.winsNeeded, 1, 9, 2) },
    names: [name(names[0]), name(names[1])],
    tally: { host: num(t.host, 0, 9999, 0), guest: num(t.guest, 0, 9999, 0), draw: num(t.draw, 0, 9999, 0) },
    round: num(m.round, 1, 99, 1), wins: [num(wins[0], 0, 9, 0), num(wins[1], 0, 9, 0)],
  };
}
