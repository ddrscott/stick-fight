// Wire format for online play. Inputs pack into 11 bits; packets are small binary frames that
// go over the WebRTC DataChannel (or through the room's WebSocket when relayed). Control
// messages (start, hashes, bye) are JSON over the WebSocket, which is reliable and ordered.
//
// INPUT  u8 1 | u32 first frame | u8 count | u32 ack | u32 sender's frame | count x u16 input
//        ack = the newest frame of ours the sender has without gaps (0xffffffff: none yet), so
//        each packet repeats every input the other side hasn't confirmed: unordered, no
//        retransmits, and a lost packet is covered by the next one.
// PING   u8 2 | f64 sender's clock          PONG   u8 3 | f64 the clock from the ping

/** @typedef {{ dx: number, jump: boolean, block: boolean, down: boolean, run: boolean, lp: boolean, rp: boolean, lk: boolean, rk: boolean, touch: boolean }} NetInput */

export const PKT_INPUT = 1, PKT_PING = 2, PKT_PONG = 3;
export const NO_FRAME = 0xffffffff;
export const MAX_INPUTS_PER_PACKET = 64;
const BITS = ['jump', 'block', 'down', 'run', 'lp', 'rp', 'lk', 'rk', 'touch'];

/** @param {any} s an input.snapshot() (or any object with the same fields) */
export function encodeInput(s) {
  let v = s.dx > 0 ? 1 : s.dx < 0 ? 2 : 0;
  for (let i = 0; i < BITS.length; i++) if (s[BITS[i]]) v |= 1 << (i + 2);
  return v;
}
/** @type {Map<number, Readonly<NetInput>>} */
const decoded = new Map();
/** The input for a code. One frozen object per code, so the sim reads plain fields as usual. */
export function decodeInput(v) {
  let o = decoded.get(v);
  if (!o) {
    /** @type {any} */
    const s = { dx: (v & 3) === 1 ? 1 : (v & 3) === 2 ? -1 : 0 };
    for (let i = 0; i < BITS.length; i++) s[BITS[i]] = !!(v & (1 << (i + 2)));
    o = Object.freeze(s);
    decoded.set(v, o);
  }
  return o;
}

/**
 * @param {number} first first frame number in `codes`
 * @param {number[]} codes encoded inputs for frames first, first+1, ...
 * @param {number} ack newest remote frame held without gaps, or NO_FRAME
 * @param {number} frame the sender's current sim frame
 */
export function inputPacket(first, codes, ack, frame) {
  const n = Math.min(codes.length, MAX_INPUTS_PER_PACKET);
  const buf = new ArrayBuffer(14 + 2 * n), dv = new DataView(buf);
  dv.setUint8(0, PKT_INPUT); dv.setUint32(1, first); dv.setUint8(5, n); dv.setUint32(6, ack >>> 0); dv.setUint32(10, frame >>> 0);
  for (let i = 0; i < n; i++) dv.setUint16(14 + 2 * i, codes[i]);
  return buf;
}
/** @param {number} type PKT_PING or PKT_PONG @param {number} t */
export function clockPacket(type, t) {
  const buf = new ArrayBuffer(9), dv = new DataView(buf);
  dv.setUint8(0, type); dv.setFloat64(1, t);
  return buf;
}
/** @param {ArrayBuffer} buf */
export function parsePacket(buf) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < 1) return null;
  const dv = new DataView(buf), type = dv.getUint8(0);
  if (type === PKT_INPUT && buf.byteLength >= 14) {
    const n = dv.getUint8(5);
    if (buf.byteLength < 14 + 2 * n) return null;
    const codes = [];
    for (let i = 0; i < n; i++) codes.push(dv.getUint16(14 + 2 * i));
    return { type, first: dv.getUint32(1), codes, ack: dv.getUint32(6), frame: dv.getUint32(10) };
  }
  if ((type === PKT_PING || type === PKT_PONG) && buf.byteLength >= 9) return { type, t: dv.getFloat64(1) };
  return null;
}
