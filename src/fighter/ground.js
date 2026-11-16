// Bodies stay on top of the floor (README, "Floors": Bodies never sink into the floor).
// Two pieces, shared by the sim (src/combat/sim.js, the rig in ./index.js) and the drawing (src/main.js, ./life.js):
//   jointRadii(R, scale)   each joint's drawn radius: the head's circle, a limb's half width at that joint (the
//                          taper from limbW at the shoulder or hip to limbTip at the hand or foot), the torso's
//   fitToGround(J, rad, ground, opt)   a pose put back on top of the surface under it. ground(x) is the surface's
//                          y under x (or null where there is none). Nothing moves when nothing is under the floor.
//                          Otherwise the pose is corrected the way a body would be, from the hips out: the hips
//                          are lifted onto the floor (the whole body with them), a spine segment, an upper arm or
//                          a thigh whose far end would go under turns up about its near joint until it clears (the
//                          limb bends or slides along the floor, its bones keep their length and everything beyond
//                          it turns with it), a planted foot is set on the surface under it and its leg re-solved
//                          from the hip with the bones' lengths kept (legTo; a foot never slides), and whatever
//                          still can't clear lifts the body as a whole.
//   twoBone / legTo / kneeSide   the two-bone leg solve (the rig's clips and the stair fit share it)
// The trig is the bit-identical kind (src/combat/dmath.js): the sim runs this on both machines online.
import * as dm from '../combat/dmath.js';

const DEG = Math.PI / 180;

/**
 * Two-bone IK, the one solve the rig's clips (leg() in ./index.js) and the stair fit (legTo below) share: from a root
 * to a target dx forward and dy down, with segment lengths U and L, the knee ahead of (on the +x side of) the
 * root-target line. A target past `max` is pulled in along the line to it. Returns the near segment's angle a1 (radians
 * from straight down, + forward), the knee (kx, ky) and the target actually reached (dx, dy). dmath trig: bit-identical.
 */
export function twoBone(dx, dy, U, L, max = U + L - 0.5) {
  let d = dm.hypot(dx, dy);
  if (d > max) { dx *= max / d; dy *= max / d; d = max; }
  const phi = dm.atan2(dx, dy);
  const alpha = dm.acos(Math.max(-1, Math.min(1, (U * U + d * d - L * L) / (2 * U * d))));
  const a1 = phi + alpha;
  return { a1, kx: dm.sin(a1) * U, ky: dm.cos(a1) * U, dx, dy };
}

/**
 * A leg re-solved in world space: hip H to target T with thigh U and shin L kept, the knee on side sgn (+1 toward +x,
 * -1 toward -x). Returns { knee, foot }; the foot is T, or when T is out of reach straight above it, as low as the leg
 * goes (a foot short of its tread hangs over it rather than drifting onto the next one), or along the line if even that fails.
 */
export function legTo(H, T, U, L, sgn) {
  let dx = (T.x - H.x) * sgn, dy = T.y - H.y;
  if (dm.hypot(dx, dy) < 1e-6) return { knee: { x: H.x + U * sgn, y: H.y }, foot: { x: H.x, y: H.y } };
  const m = U + L;
  if (dm.hypot(dx, dy) > m && dy > 0 && Math.abs(dx) < m) dy = Math.sqrt(m * m - dx * dx);
  const b = twoBone(dx, dy, U, L, m);
  return { knee: { x: H.x + b.kx * sgn, y: H.y + b.ky }, foot: { x: H.x + b.dx * sgn, y: H.y + b.dy } };
}

/** which side of the hip-foot line a knee is on, as legTo's sgn (0 when the leg is straight to within 0.5 px) */
export function kneeSide(H, K, F) {
  const fx = F.x - H.x, fy = F.y - H.y, l = dm.hypot(fx, fy);
  if (l < 1e-6) return 0;
  const cr = (fx * (K.y - H.y) - fy * (K.x - H.x)) / l;   // the knee's signed distance off the line
  return cr < -0.5 ? 1 : cr > 0.5 ? -1 : 0;
}

/** @param {any} R the body's segment widths (RIG plus a character's overrides) @param {number} s its scale */
export function jointRadii(R, s) {
  const limb = R.limbW / 2 * s, mid = (R.limbW + R.limbTip) / 4 * s, tip = R.limbTip / 2 * s;
  return {
    head: R.headR * s, neck: R.torsoW / 2 * s, chest: (R.hipW + R.torsoW) / 4 * s, hip: Math.max(R.hipW, R.limbW) / 2 * s,
    lShoulder: limb, rShoulder: limb, lElbow: mid, rElbow: mid, lKnee: mid, rKnee: mid, lHand: tip, rHand: tip, lFoot: tip, rFoot: tip,
  };
}

const ARM_L = ['lShoulder', 'lElbow', 'lHand'], ARM_R = ['rShoulder', 'rElbow', 'rHand'];
const UPPER = ['chest', 'neck', 'head', ...ARM_L, ...ARM_R];
// [pivot, child, the joints that turn with the child]
const SPINE = [['hip', 'chest', UPPER], ['chest', 'neck', ['neck', 'head', ...ARM_L, ...ARM_R]], ['neck', 'head', ['head']]];
const ARMS = [['lShoulder', 'lElbow', ['lElbow', 'lHand']], ['lElbow', 'lHand', ['lHand']], ['rShoulder', 'rElbow', ['rElbow', 'rHand']], ['rElbow', 'rHand', ['rHand']]];
const THIGHS = [['hip', 'lKnee', ['lKnee', 'lFoot']], ['hip', 'rKnee', ['rKnee', 'rFoot']]];
const SHINS = [['lKnee', 'lFoot', ['lFoot']], ['rKnee', 'rFoot', ['rFoot']]];
const EPS = 0.01;

/**
 * @param {Record<string, {x:number,y:number}>} J joints (world)
 * @param {Record<string, number>} rad drawn radius per joint
 * @param {(x:number, y:number) => (number|null)} ground the surface under x for a joint centred at y
 * @param {{ planted?: boolean, side?: number, lean?: number }} [opt] planted: the feet are standing (set them on
 *   the surface, never turn them); side: which way a segment pointing straight down turns (the facing);
 *   lean: degrees past level a segment may turn up before the rest of the body lifts instead (default 35)
 * @returns {Record<string, {x:number,y:number}>} J itself when nothing was under the floor, else a corrected copy
 */
export function fitToGround(J, rad, ground, opt = {}) {
  const pen = (P, k) => { const p = P[k]; if (!p) return -Infinity; const g = ground(p.x, p.y); return g == null ? -Infinity : p.y + (rad[k] || 0) - g; };
  let any = false;
  for (const k in J) if (pen(J, k) > EPS) { any = true; break; }
  if (!any) return J;
  const P = {};
  for (const k in J) P[k] = { x: J[k].x, y: J[k].y };
  const shift = (ks, dx, dy) => { for (const k of ks) if (P[k]) { P[k].x += dx; P[k].y += dy; } };
  const all = Object.keys(P);
  // the hips on the floor, the body with them
  const h = pen(P, 'hip');
  if (h > EPS) shift(all, 0, -h);
  // turn a segment up about its near joint until its far end clears
  const lean = (opt.lean != null ? opt.lean : 35) * DEG;
  const turn = (a, b, ks) => {
    if (!P[a] || !P[b] || pen(P, b) <= EPS) return;
    const vx = P[b].x - P[a].x, vy = P[b].y - P[a].y, L = dm.hypot(vx, vy);
    if (L < 1e-6) { shift(ks, 0, -pen(P, b)); return; }
    const side = vx > 1e-9 ? 1 : vx < -1e-9 ? -1 : (opt.side || 1);
    const a0 = dm.atan2(vy, vx * side);           // below level is positive, measured on the segment's own side
    const lo = -lean;                              // as far up as it may turn
    if (a0 <= lo) return;
    const ok = (ang) => {
      const x = P[a].x + dm.cos(ang) * L * side, y = P[a].y + dm.sin(ang) * L, g = ground(x, y);
      return g == null || y + (rad[b] || 0) - g <= EPS;
    };
    // the first angle up from where it is that clears (scanned, then refined so the answer moves smoothly)
    let bad = a0, good = null;
    for (let ang = a0 - 4 * DEG; ; ang -= 4 * DEG) {
      if (ang <= lo) { good = ok(lo) ? lo : null; break; }
      if (ok(ang)) { good = ang; break; }
      bad = ang;
    }
    const to = good == null ? lo : (() => { let g = good, bb = bad; for (let i = 0; i < 8; i++) { const m = (g + bb) / 2; if (ok(m)) g = m; else bb = m; } return g; })();
    const d = (to - a0) * side, c = dm.cos(d), s = dm.sin(d), ox = P[a].x, oy = P[a].y;
    for (const k of ks) { const p = P[k]; if (!p) continue; const dx = p.x - ox, dy = p.y - oy; p.x = ox + dx * c - dy * s; p.y = oy + dx * s + dy * c; }
  };
  for (const [a, b, ks] of SPINE) turn(a, b, ks);
  for (const arm of [ARM_L, ARM_R]) { const s0 = pen(P, arm[0]); if (s0 > EPS) shift(arm, 0, -s0); }
  for (const [a, b, ks] of ARMS) turn(a, b, ks);
  for (const [a, b, ks] of THIGHS) turn(a, b, ks);
  if (opt.planted) {
    // a planted foot goes straight up onto the surface under it and the leg is re-solved from the hip to it (legTo):
    // the thigh and shin keep their lengths and the knee stays on the side it was (forward, for a straight leg)
    for (const [kn, ft] of [['lKnee', 'lFoot'], ['rKnee', 'rFoot']]) {
      const d = pen(P, ft);
      if (!(d > EPS) || !P[kn] || !P.hip) continue;
      const H = P.hip, K = P[kn], F = P[ft], U = dm.hypot(K.x - H.x, K.y - H.y), L = dm.hypot(F.x - K.x, F.y - K.y);
      const r = legTo(H, { x: F.x, y: F.y - d }, U, L, kneeSide(H, K, F) || opt.side || 1);
      P[kn] = r.knee; P[ft] = r.foot;
    }
  } else for (const [a, b, ks] of SHINS) turn(a, b, ks);
  // whatever still can't clear lifts the body as a whole
  // (a few times: lifted, a joint can come level with a higher step it was under, which then counts as its floor)
  for (let pass = 0; pass < 4; pass++) {
    let rest = 0;
    for (const k of all) rest = Math.max(rest, pen(P, k));
    if (rest <= EPS) break;
    shift(all, 0, -rest);
  }
  return P;
}
