// A small QR code encoder, for the join links on the host screen and the crew lobby (README,
// Multiplayer, "Scan to join"). Byte mode (the text as UTF-8), error correction M, versions 1 to 10:
// up to 213 bytes, where a quick-room link is about 52 and the longest crew link about 76. Written
// here because the game takes no npm packages at runtime (README, Practices).
//
//   encodeQR(text)        { version, size, get(x, y) } or null when the text is too long
//   qrPath(qr, quiet)     an SVG path of the dark modules, in module units, offset by the quiet zone
//   qrSvg(text)           an <svg>: dark modules on a white tile with the 4-module quiet zone, or null
//
// The spec is ISO/IEC 18004. scripts/qr/check.mjs decodes what this draws with a separate decoder.

// Error correction M, by version: [codewords of error correction per block, [blocks, data codewords each], ...]
const BLOCKS = [
  null,
  [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]],
  [16, [4, 27]], [18, [4, 31]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]],
];
// centers of the alignment patterns, by version
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
export const QR_MAX_VERSION = BLOCKS.length - 1;
export const QR_QUIET = 4;   // modules of light margin on every side: the spec's minimum

// GF(256) over x^8 + x^4 + x^3 + x^2 + 1
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** the Reed-Solomon error correction codewords for one block */
function rsRemainder(data, n) {
  // the generator: (x - 2^0)(x - 2^1)...(x - 2^(n-1)), highest power first, without its leading 1
  const gen = new Uint8Array(n); gen[n - 1] = 1;
  for (let i = 0, root = 1; i < n; i++) {
    for (let j = 0; j < n; j++) { gen[j] = mul(gen[j], root); if (j + 1 < n) gen[j] ^= gen[j + 1]; }
    root = mul(root, 2);
  }
  const rem = new Uint8Array(n);
  for (const b of data) {
    const f = b ^ rem[0];
    rem.copyWithin(0, 1); rem[n - 1] = 0;
    for (let j = 0; j < n; j++) rem[j] ^= mul(gen[j], f);
  }
  return rem;
}

const dataCapacity = (v) => { let n = 0; const b = /** @type {any[]} */ (BLOCKS[v]); for (let i = 1; i < b.length; i++) n += b[i][0] * b[i][1]; return n; };

/** the data and error correction codewords, interleaved as they're laid into the symbol */
function codewords(bytes, version) {
  const cap = dataCapacity(version);
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(4, 4);   // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, cap * 8 - bits.length));   // the terminator
  while (bits.length % 8) bits.push(0);
  const data = new Uint8Array(cap);
  for (let i = 0; i < bits.length; i++) data[i >>> 3] |= bits[i] << (7 - (i & 7));
  for (let i = bits.length >>> 3, pad = 0xec; i < cap; i++, pad ^= 0xec ^ 0x11) data[i] = pad;

  const spec = /** @type {any[]} */ (BLOCKS[version]), ecLen = spec[0];
  const blocks = [], ecs = [];
  let at = 0;
  for (let g = 1; g < spec.length; g++) for (let k = 0; k < spec[g][0]; k++) {
    const d = data.subarray(at, at + spec[g][1]); at += spec[g][1];
    blocks.push(d); ecs.push(rsRemainder(d, ecLen));
  }
  const out = [];
  const longest = blocks[blocks.length - 1].length;
  for (let i = 0; i < longest; i++) for (const d of blocks) if (i < d.length) out.push(d[i]);
  for (let i = 0; i < ecLen; i++) for (const e of ecs) out.push(e[i]);
  return out;
}

/** which modules a mask pattern flips */
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** the spec's score for how hard a symbol is to read (lower is better): runs, blocks, finder look-alikes, balance */
function penalty(m, size) {
  let p = 0;
  const at = (x, y) => m[y * size + x];
  for (let pass = 0; pass < 2; pass++) {   // rows, then columns
    for (let a = 0; a < size; a++) {
      let run = 1, hist = 0;
      for (let b = 0; b < size; b++) {
        const v = pass ? at(a, b) : at(b, a);
        if (b > 0) { const prev = pass ? at(a, b - 1) : at(b - 1, a); if (v === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
        // 1:1:3:1:1 dark-light-dark-light-dark with four light modules on a side: a finder look-alike
        hist = ((hist << 1) | v) & 0x7ff;
        if (b >= 10 && (hist === 0x05d || hist === 0x5d0)) p += 40;
      }
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = at(x, y);
    dark += v;
    if (x + 1 < size && y + 1 < size && v === at(x + 1, y) && v === at(x, y + 1) && v === at(x + 1, y + 1)) p += 3;
  }
  p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  return p;
}

/**
 * A QR code for the text: byte mode, error correction M, the smallest version that holds it.
 * @param {string} text
 * @returns {{ version: number, size: number, mask: number, get: (x: number, y: number) => boolean } | null}
 *   null when the text is longer than version 10 holds (213 bytes)
 */
export function encodeQR(text) {
  const bytes = new TextEncoder().encode(String(text));
  let version = 0;
  for (let v = 1; v <= QR_MAX_VERSION && !version; v++) if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCapacity(v) * 8) version = v;
  if (!version) return null;
  const size = version * 4 + 17;
  const m = new Uint8Array(size * size), fn = new Uint8Array(size * size);   // the modules, and which are function patterns
  const set = (x, y, dark) => { m[y * size + x] = dark ? 1 : 0; fn[y * size + x] = 1; };

  // timing patterns, then the three finders with their separators, then the alignment patterns
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  }
  const al = /** @type {number[]} */ (ALIGN[version]);
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;   // a finder is there
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // the format bits (error correction level and mask) go in twice, around the finders
  const format = (mask) => {
    const d = (0 << 3) | mask;   // level M is 00
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((d << 10) | rem) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);   // always dark
  };
  format(0);   // reserves the modules; the real bits follow the mask choice
  if (version >= 7) {   // the version, twice, beside the top-right and bottom-left finders
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), b = Math.floor(i / 3), dark = ((bits >>> i) & 1) === 1;
      set(a, b, dark); set(b, a, dark);
    }
  }
  // the codewords zigzag up and down in two-module columns from the bottom right, skipping the timing column
  const cw = codewords(bytes, version);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (fn[y * size + x]) continue;
      if (i < cw.length * 8) m[y * size + x] = (cw[i >>> 3] >>> (7 - (i & 7))) & 1;
      i++;
    }
  }
  // try all eight masks and keep the one that scores best
  const flip = (k) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y * size + x] && MASKS[k](x, y)) m[y * size + x] ^= 1; };
  let best = 0, bestP = Infinity;
  for (let k = 0; k < 8; k++) {
    flip(k); format(k);
    const p = penalty(m, size);
    if (p < bestP) { bestP = p; best = k; }
    flip(k);
  }
  flip(best); format(best);
  return { version, size, mask: best, get: (x, y) => x >= 0 && y >= 0 && x < size && y < size && m[y * size + x] === 1 };
}

/**
 * The dark modules as one SVG path, a unit per module, shifted in by the quiet zone. Runs along a row are one rectangle.
 * @param {{ size: number, get: (x: number, y: number) => boolean }} qr
 */
export function qrPath(qr, quiet = QR_QUIET) {
  let d = '';
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) {
    if (!qr.get(x, y)) continue;
    let w = 1;
    while (qr.get(x + w, y)) w++;
    d += `M${x + quiet} ${y + quiet}h${w}v1h${-w}z`;
    x += w;
  }
  return d;
}

/**
 * The code as an <svg> to put in the page: black modules on a white tile that includes the quiet
 * zone. Dark on light, flat, no glow: inverted and neon codes fail on a lot of phone cameras.
 * @param {string} text
 * @returns {SVGSVGElement | null} null when the text doesn't fit
 */
export function qrSvg(text) {
  const qr = encodeQR(text);
  if (!qr) return null;
  const NS = 'http://www.w3.org/2000/svg', n = qr.size + 2 * QR_QUIET;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${n} ${n}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code of the join link');
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', String(n)); bg.setAttribute('height', String(n)); bg.setAttribute('fill', '#fff');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', qrPath(qr)); path.setAttribute('fill', '#000');
  svg.append(bg, path);
  return svg;
}
