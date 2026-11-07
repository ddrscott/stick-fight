// Deterministic math for the sim and the rig. Math.sin, cos, atan2, acos, hypot and pow are
// "implementation-approximated" in JavaScript, and the engines really do differ in the last bit
// (measured: Chrome, Firefox and Safari each disagree with the others within a few steps of a
// bout). Online play runs the same sim on both machines, so everything that feeds the fight
// uses these instead. They are built only from + - * / and Math.sqrt, which IEEE 754 makes
// exact-to-the-bit on every engine (JavaScript never fuses a multiply-add). The polynomials are
// fdlibm's (Sun Microsystems, freely redistributable), so the results stay within an ulp or so
// of the real thing and nothing on screen changes.

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);   // little-endian on every platform the game runs on: [lo, hi]

// ---- sin / cos -------------------------------------------------------------------------------
const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
  S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
  C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
function ksin(x, y) {
  const z = x * x, v = z * x, r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}
function kcos(x, y) {
  const z = x * x, w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z, ww = 1 - hz;
  return ww + (((1 - ww) - hz) + (z * r - x * y));
}
// x reduced to [-pi/4, pi/4] as y0 + y1, and the quadrant (Cody-Waite with a three-part pi/2)
const INVPIO2 = 6.36619772367581382433e-01, PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11,
  PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21, PIO2_3 = 2.02226624871116645580e-21, PIO2_3T = 8.47842766036889956997e-32;
let red0 = 0, red1 = 0;
function reduce(x) {
  if (x > -0.7853981633974483 && x < 0.7853981633974483) { red0 = x; red1 = 0; return 0; }
  const n = Math.round(x * INVPIO2);
  let r = x - n * PIO2_1, w = n * PIO2_1T;
  let t = r; w = n * PIO2_2; r = t - w; w = n * PIO2_2T - ((t - r) - w);
  t = r; w = n * PIO2_3; r = t - w; w = n * PIO2_3T - ((t - r) - w);
  red0 = r - w; red1 = (r - red0) - w;
  return n & 3;
}
export function sin(x) {
  if (!isFinite(x)) return NaN;
  switch (reduce(x)) {
    case 0: return ksin(red0, red1);
    case 1: return kcos(red0, red1);
    case 2: return -ksin(red0, red1);
    default: return -kcos(red0, red1);
  }
}
export function cos(x) {
  if (!isFinite(x)) return NaN;
  switch (reduce(x)) {
    case 0: return kcos(red0, red1);
    case 1: return -ksin(red0, red1);
    case 2: return -kcos(red0, red1);
    default: return ksin(red0, red1);
  }
}

// ---- atan / atan2 / acos -----------------------------------------------------------------------
const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];
export function atan(x0) {
  if (x0 !== x0) return NaN;
  const neg = x0 < 0;
  let x = neg ? -x0 : x0, id = -1;
  if (x >= 7.37869762948382064640e+19) return neg ? -ATANHI[3] - ATANLO[3] : ATANHI[3] + ATANLO[3];
  if (x < 0.4375) { if (x < 3.725290298461914e-9) return x0; }
  else if (x < 1.1875) {
    if (x < 0.6875) { id = 0; x = (2 * x - 1) / (2 + x); } else { id = 1; x = (x - 1) / (x + 1); }
  } else if (x < 2.4375) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); }
  else { id = 3; x = -1 / x; }
  const z = x * x, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) { const r = x - x * (s1 + s2); return neg ? -r : r; }
  const r = ATANHI[id] - ((x * (s1 + s2) - ATANLO[id]) - x);
  return neg ? -r : r;
}
const PI = 3.1415926535897931160e+00, PI_LO = 1.2246467991473531772e-16, PIO2_HI = 1.57079632679489655800e+00, PIO2_LO = 6.12323399573676603587e-17;
export function atan2(y, x) {
  if (x !== x || y !== y) return NaN;
  if (!isFinite(x) || !isFinite(y)) return Math.atan2(y, x);   // exact special values; never reached by the sim
  if (y === 0) return x > 0 || (x === 0 && 1 / x > 0) ? y : (1 / y > 0 ? PI : -PI);
  if (x === 0) return y > 0 ? PIO2_HI : -PIO2_HI;
  const a = atan(Math.abs(y / x));
  if (x > 0) return y > 0 ? a : -a;
  return y > 0 ? PI - (a - PI_LO) : (a - PI_LO) - PI;
}
const pS0 = 1.66666666666666657415e-01, pS1 = -3.25565818622400915405e-01, pS2 = 2.01212532134862925881e-01,
  pS3 = -4.00555345006794114027e-02, pS4 = 7.91534994289814532176e-04, pS5 = 3.47933107596021167570e-05;
const qS1 = -2.40339491173441421878e+00, qS2 = 2.02094576023350569471e+00, qS3 = -6.88283971605453293030e-01, qS4 = 7.70381505559019352791e-02;
const RR = (z) => (z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))))) / (1 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4))));
export function acos(x) {
  if (x !== x || x > 1 || x < -1) return NaN;
  if (x === 1) return 0;
  if (x === -1) return PI;
  if (x > -0.5 && x < 0.5) return PIO2_HI - (x - (PIO2_LO - x * RR(x * x)));
  if (x < 0) {
    const z = (1 + x) * 0.5, s = Math.sqrt(z), w = RR(z) * s - PIO2_LO;
    return PI - 2 * (s + w);
  }
  const z = (1 - x) * 0.5, s = Math.sqrt(z);
  f64[0] = s; u32[0] = 0; const df = f64[0];
  const c = (z - df * df) / (s + df), w = RR(z) * s + c;
  return 2 * (df + w);
}

// ---- hypot / pow -----------------------------------------------------------------------------
/** sqrt(x*x + y*y): fine for the sim's magnitudes (no overflow guard needed under 1e150). */
export function hypot(x, y) { return Math.sqrt(x * x + y * y); }
/** x ** y by repeated squaring (integer part) and repeated square roots (fraction, 40 bits).
 *  For the rig's eases and gait (x in [0, 1], small y); exact for integer y. */
export function pow(x, y) {
  if (y === 0) return 1;
  if (x !== x || y !== y) return NaN;
  let n = Math.floor(y), f = y - n;
  if (f !== 0 && x < 0) return NaN;
  let r = 1, b = x, k = n < 0 ? -n : n;
  while (k > 0) { if (k & 1) r *= b; b *= b; k = Math.floor(k / 2); }
  if (n < 0) r = 1 / r;
  if (f > 0) { let s = x; for (let i = 0; i < 40 && f > 0; i++) { s = Math.sqrt(s); f *= 2; if (f >= 1) { r *= s; f -= 1; } } }
  return r;
}
