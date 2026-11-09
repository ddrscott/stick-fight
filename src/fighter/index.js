// Stick figure rig and move set. See gauntlet/BRIEF.md for the contract.
//
// A pose is a set of joint angles in body space: x forward (toward facing), y down,
// origin at the hip's resting spot. Angles are degrees from straight down, positive
// swings the segment forward. Each move is a list of keyframes; a keyframe holds a
// pose, how long to travel to the next keyframe, and the easing for that travel.
// Timing lives in those durations: a wind-up eases in over ~100ms, the hit pose
// arrives in one or two frames with 'snap', holds, then overshoots and settles.
//
// After interpolation the figure is dropped so its lowest point rests on f.y
// (minus the pose's `air`), so crouches, walks and falls get their height from the
// legs and never float or sink.

import * as dm from '../combat/dmath.js';   // bit-identical trig on every engine: online play runs this rig on both machines
import { mixBotch } from './limbBlend.js';   // a botch mixes the two moves per limb
const DEG = Math.PI / 180;

// Segment lengths, ~130px tall standing.
export const RIG = {
  headR: 15, neck: 3, torso: 36, lowerTorso: 17, upperTorso: 19, upperArm: 24, lowerArm: 23, upperLeg: 31, lowerLeg: 30,
  hipH: 58, // resting hip height above the ground before the ground snap
  limbW: 12, limbTip: 9, torsoW: 15, hipW: 11,
};

const EASE = {
  linear: t => t,
  in: t => t * t,
  out: t => 1 - (1 - t) * (1 - t),
  inOut: t => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
  sine: t => 0.5 - 0.5 * dm.cos(Math.PI * t),
  // Wind-up: slow start, accelerating into the strike.
  anticip: t => t * t * t,
  // Strike: arrives in a frame or two, then sits.
  snap: t => 1 - dm.pow(1 - t, 4),
  // Settle with a small overshoot past the target.
  back: t => { const s = 1.4; t -= 1; return 1 + t * t * ((s + 1) * t + s); },
  // Recovery: biggest step first, then roughly halving each frame (58%, 30%, 10%, 2% at 40ms steps over 160ms).
  settle: t => 1 - dm.pow(1 - t, 3),
};

// Pose fields. l* = far side limbs (lead side when facing right), r* = near side.
// Arms: [upper, lower]. Legs: [upper, lower]. tw = shoulder twist in px.
// bend = chest pitch relative to the pelvis segment, so a pose can carry a line of action
// (negative bows the spine back into a C, positive bows it forward).
// Two-bone leg IK. dx forward and dy down from the hip to the foot (body space); returns
// [upper, lower] angles with the knee ahead of the hip-foot line. Lets a key pin a foot by
// position so it stays put while the hip moves, instead of sliding with the angles.
function leg(dx, dy) {
  const U = RIG.upperLeg, L = RIG.lowerLeg, max = U + L - 0.5;
  let d = dm.hypot(dx, dy);
  if (d > max) { dx *= max / d; dy *= max / d; d = max; }
  const phi = dm.atan2(dx, dy);
  const alpha = dm.acos(Math.max(-1, Math.min(1, (U * U + d * d - L * L) / (2 * U * d))));
  const a1 = phi + alpha;
  const kx = dm.sin(a1) * U, ky = dm.cos(a1) * U;
  return [a1 / DEG, dm.atan2(dx - kx, dy - ky) / DEG];
}
// Both legs from the hip offset hx, hip height H above the floor, and each foot's x in figure
// space (so a foot keeps the same x across keys while hx changes). lift/rlift raise a foot.
const F = (hx, H, lfx, rfx, lift = 0, rlift = 0) => ({ hx, ll: leg(lfx - hx, H - lift), rl: leg(rfx - hx, H - rlift) });
// A single pinned leg, for keys whose other leg is in the air and posed by angle.
const L = (hx, H, fx) => leg(fx - hx, H);
// Guard feet: lead at +18, rear at -14, hip 53 up (knees softly bent, so a recovery can
// overshoot tall: the legs reach 58 at most with the feet this far apart).
const LF = 18, RF = -14, HIP = 53, TALL = 58.5;

const STANCE = {
  torso: 6, bend: 0, head: -4, tw: 0, air: 0, spin: 0,
  la: [55, 150], ra: [30, 165],
  ...F(0, HIP, LF, RF),
};
const P = o => ({ ...STANCE, ...o });
const K = (p, d, ease = 'inOut', ev = null) => ({ p: P(p), d, ease, ev });

// Swap near and far limbs. Used to build the second half of walk and run cycles.
const mirror = k => ({ ...k, p: { ...k.p, la: k.p.ra, ra: k.p.la, ll: k.p.rl, rl: k.p.ll } });

// Fighting walk on the leg IK. Half a cycle is one step of WALK_STEP px over
// WALK_HALF ms, in four linear keys. The planted foot moves backward in body space at exactly
// the travel speed (+18 -> -18), so its world x holds while the caller moves f.x at
// MOVE_DATA.walk.speed. The swing foot lifts off the push (toe still down), passes high and
// reaches forward to plant (20px clearance at passing). The hips dip 6px after each contact, rise at the passing
// pose; hands stay up but loose, swinging opposite the legs with the shoulders counter-rotating.
const WALK_STEP = 62, WALK_HALF = 440, WALK_KEYS = 6;
const walkHalf = Array.from({ length: WALK_KEYS }, (_, i) => {
  const u = i / WALK_KEYS;
  const plant = WALK_STEP / 2 - u * WALK_STEP;                  // planted foot, linear = travel speed
  const sm = u * u * (3 - 2 * u);
  const swing = -WALK_STEP / 2 + WALK_STEP * (1 - (1 - u) * (1 - u));   // reaches under the hip early, no flick
  const lift = 2 + 10 * dm.pow(dm.sin(Math.PI * u), 1.6);
  const dip = Math.max(0, dm.sin(Math.PI * Math.min(1, u / 0.3)));           // just after contact
  const rise = Math.max(0, dm.sin(Math.PI * Math.min(1, Math.max(0, (u - 0.2) / 0.6)))); // around passing
  const H = 52 - 4 * dip + 4 * rise;                            // low after contact, high at passing
  const arm = dm.cos(Math.PI * u);                            // +1: near arm forward
  return K({ ...F(0, H, plant, swing, 0, lift), torso: 7, bend: 1, head: -3, tw: arm * 6,
    la: [55 - 34 * arm, 140 - 24 * arm - 8 * dip], ra: [30 + 34 * arm, 150 + 20 * arm - 8 * dip] },
    WALK_HALF / WALK_KEYS, 'linear', i === 0 ? 'footstep' : null);
});
// Run: reach, support (lowest), push-off with the trailing leg locked straight, flight (highest).
// Timing traced from the olive runner, Xiao Xiao f43-f55: two frames in the air, contact held
// two, pass, stride held two, so ~280ms per half stride. Arms swing opposite the legs; the
// rear arm is nearly straight and swung back ~60 deg so the hand sits clear behind the hip
// at each stride extreme (f43, f49) instead of hiding against the torso.
// The planted foot is IK-pinned through contact, support and push-off: it moves backward in
// body space by 33px per 70ms key, which is the 470px/s the figure travels, so its world x holds.
// Linear easing between those keys keeps that speed constant. One forward lean (28) the whole
// cycle; the trailing knee stays bent.
const runHalf = [
  K({ torso: 28, bend: 4, head: -14, ll: leg(26, 50), rl: [-44, -80], la: [-62, -58], ra: [66, 140] }, 70, 'linear', 'footstep'),
  K({ torso: 28, bend: 4, head: -14, ll: leg(-7, 46), rl: [-10, -92], la: [-36, -30], ra: [44, 118] }, 70, 'linear'),
  K({ torso: 28, bend: 4, head: -14, ll: leg(-40, 45), rl: [62, -24], la: [-4, 20], ra: [12, 60] }, 70, 'linear'),
  K({ torso: 28, bend: 4, head: -14, ll: [-40, -88], rl: [48, 20], la: [40, 120], ra: [-40, -34], air: 16 }, 60, 'in'),
];

// Two-step walk of d px (negative steps back): lead foot, then rear foot, each lifted while it
// moves. 'shift' moves the root by d when it ends, so the last key is the guard at the new spot.
function makeAdvance(d) {
  const sg = Math.sign(d) || 1, lead = sg > 0;
  const k1 = lead ? F(d * 0.1, HIP - 1, LF + d / 2, RF, 8, 0) : F(d * 0.1, HIP - 1, LF, RF + d / 2, 0, 8);
  const k2 = lead ? F(d * 0.35, HIP - 2, LF + d, RF) : F(d * 0.35, HIP - 2, LF, RF + d);
  const k3 = lead ? F(d * 0.75, HIP, LF + d, RF + d / 2, 0, 8) : F(d * 0.75, HIP, LF + d / 2, RF + d, 8, 0);
  return { blend: 40, shift: d, keys: [
    K({ ...k1, torso: 6 + 2 * sg, head: -4, la: [56, 148], ra: [30, 162] }, 90, 'inOut'),
    K({ ...k2, torso: 6 + sg, head: -3, la: [54, 150], ra: [32, 160] }, 90, 'out', 'footstep'),
    K({ ...k3, torso: 6, head: -4, la: [56, 148], ra: [30, 164] }, 90, 'inOut'),
    K({ ...F(d, HIP - 1, LF + d, RF + d), torso: 6, head: -4, la: [55, 149], ra: [30, 164] }, 0, 'out', 'footstep'),
  ] };
}

// Retarget a strike's reach by e px. 'pinned' (jab): the hips lean e further over planted feet,
// ramping in before contact and back out after. 'step' (cross): from the lead-foot lift on, the
// hips and lead foot move e; from the rear foot's follow step on, the rear foot does too, and
// the root travels shift + e. Legs are re-solved with the IK so planted feet stay put.
function adapted(def, e, aim = 0) {
  // e: px of extra reach. aim: degrees to rotate the striking limb (positive raises the tip).
  // Modes: 'pinned' (punches: hips lean over planted feet), 'kick' (the kicking leg rides with the
  // hips, the standing leg re-solves), 'air' (both legs ride along), 'step' (cross family: the
  // lead foot and later the rear foot step e further, root travels shift + e).
  const keys = def.keys, ai = keys.findIndex(k => k.ev === 'active');
  const rf = keys.findIndex((k, i) => i > ai && k.ev === 'footstep');
  const mode = def.adapt, kickLeg = def.limb && def.limb[0] === 'l' ? 'll' : 'rl';
  const limbKey = def.limb ? (def.limb.endsWith('Hand') ? (def.limb[0] === 'l' ? 'la' : 'ra') : kickLeg) : null;
  const out = keys.map((k, i) => {
    let w, lead, rear;
    if (mode !== 'step') { const r = i - ai; w = r < -2 ? 0 : r === -2 ? 0.4 : r === -1 ? 0.75 : r <= 2 ? 1 : r === 3 ? 0.6 : r === 4 ? 0.25 : 0; lead = 0; rear = 0; }
    else { w = i < ai - 2 ? 0 : i === ai - 2 ? 0.5 : i === ai - 1 ? 0.8 : 1; lead = i >= ai - 2 ? 1 : 0; rear = rf >= 0 && i >= rf ? 1 : 0; }
    if (!w && !lead && !rear) return k;
    const p = k.p, foot = a2 => ({ x: dm.sin(a2[0] * DEG) * RIG.upperLeg + dm.sin(a2[1] * DEG) * RIG.lowerLeg, y: dm.cos(a2[0] * DEG) * RIG.upperLeg + dm.cos(a2[1] * DEG) * RIG.lowerLeg });
    const lf = foot(p.ll), rr = foot(p.rl), hx = p.hx + e * w;
    const o = { ...p, hx };
    if (mode === 'air') { o.ll = p.ll; o.rl = p.rl; }
    else {
      o.ll = mode === 'kick' && kickLeg === 'll' ? p.ll : leg(p.hx + lf.x + e * lead - hx, lf.y);
      o.rl = mode === 'kick' && kickLeg === 'rl' ? p.rl : leg(p.hx + rr.x + e * rear - hx, rr.y);
    }
    if (aim && limbKey && i >= ai - 2) { const wa = i >= ai ? w : w * 0.8; o[limbKey] = [o[limbKey][0] + aim * wa, o[limbKey][1] + aim * wa]; }
    return { ...k, p: o };
  });
  return { ...def, keys: out, shift: (def.shift || 0) + (mode === 'step' ? e : 0) };
}

// Vault over a railing of height railH and drop d px to the floor below, landing in a crouch.
// Reach for the rail, plant both hands on its top and hop, swing the legs over sideways-forward,
// release and fall (accelerating), absorb the landing deep, settle into the crouch. The body
// travels 56px forward ('shift') and the ground line moves down d ('drop') when it ends; keys
// after takeoff carry air relative to the upper floor (negative = below it).
const vaultCache = {};
function makeVault(d, railH) {
  const k = d + ':' + railH;
  if (vaultCache[k]) return vaultCache[k];
  const up = Math.max(0, railH - 40);   // extra hop for a taller rail
  const fall = t => -d * t * t;         // ballistic: distance grows with t squared
  const CHP = { ...F(56, 38, 58, 42), torso: 18, bend: 6, head: -10, la: [40, 160], ra: [26, 166] };
  vaultCache[k] = { blend: 60, shift: 56, drop: d, keys: [
    K({ ...F(2, HIP - 6, LF, RF), torso: 16, bend: 4, head: -4, la: [70, 96], ra: [60, 92] }, 80, 'in'),
    K({ hx: 12, ll: [76, -40], rl: [66, -52], torso: 32, bend: 10, head: -8, la: [24, 6], ra: [14, -2], air: 12 + up }, 90, 'out'),
    K({ hx: 28, ll: [112, 34], rl: [100, 22], torso: 40, bend: 12, head: -10, la: [10, -6], ra: [2, -12], air: 34 + up }, 90, 'sine'),
    K({ hx: 42, ll: [52, -6], rl: [34, -16], torso: 10, bend: 2, head: 0, la: [110, 150], ra: [96, 140], air: 22 + up }, 80, 'in'),
    K({ hx: 48, ll: [30, -24], rl: [14, -34], torso: 4, bend: 0, head: 4, la: [140, 168], ra: [126, 160], air: fall(0.45) }, 200, 'in'),
    K({ hx: 52, ll: [24, -10], rl: [8, -20], torso: 6, bend: 0, head: 2, la: [120, 150], ra: [110, 140], air: fall(0.85) }, 110, 'in'),
    K({ ...F(56, 30, 58, 42), torso: 26, bend: 10, head: -14, la: [60, 80], ra: [40, 60], air: -d }, 60, 'out', 'land'),
    K({ ...F(56, 35, 58, 42), torso: 20, bend: 7, head: -10, la: [44, 140], ra: [28, 150], air: -d }, 120, 'inOut'),
    K({ ...CHP, air: -d }, 0, 'sine'),
  ] };
  return vaultCache[k];
}

const MOVE_DEFS = {
  // Breathing with both feet pinned. The hip never moves sideways; the knees soften by an
  // IK-solved amount (legs [31,8]/[-3,-26] drop the hip 1px, [36,3]/[2,-32] drop it 2.5px with
  // the feet on the same spots), the chest lifts and the shoulders twist on the inhale, and the
  // head bobs 2-3px with the exhale. No sliding sway.
  // Both feet pinned (IK); the hip sways 7px side to side and dips 1px, the hands bob out of
  // phase with each other, the chest lifts on the inhale and the head bobs with the exhale.
  // A boxer's bounce: the hips drop 4-5px from the knees and rise, the weight shifts back and
  // forward with the unweighted heel lifting 3px, and the hands float on a phase one key behind
  // the hips. Feet never change x.
  idle: { loop: true, blend: 140, keys: [
    K({ ...F(-1, HIP - 5, LF, RF), torso: 5, bend: -1, head: -5, tw: 2, la: [54, 150], ra: [34, 162] }, 400, 'sine'),
    K({ ...F(0.5, HIP, LF, RF, 0, 3), torso: 7, bend: 1, head: -3, tw: 0, la: [56, 148], ra: [28, 168] }, 400, 'sine'),
    K({ ...F(1, HIP - 4, LF, RF), torso: 8, bend: 1, head: -4, tw: -2, la: [55, 149], ra: [36, 158] }, 400, 'sine'),
    K({ ...F(0, HIP + 0.5, LF, RF, 3, 0), torso: 6, bend: -1, head: -2, tw: 1, la: [57, 147], ra: [26, 170] }, 400, 'sine'),
  ] },
  // Loose, low guard: hands at the chest instead of the chin, same pinned-feet bounce.
  idleOpen: { loop: true, blend: 140, keys: [
    K({ ...F(-1, HIP - 5, LF, RF), torso: 6, bend: -1, head: -5, tw: 2, la: [28, 62], ra: [16, 54] }, 400, 'sine'),
    K({ ...F(0.5, HIP, LF, RF, 0, 3), torso: 7, bend: 1, head: -3, tw: 0, la: [30, 66], ra: [14, 50] }, 400, 'sine'),
    K({ ...F(1, HIP - 4, LF, RF), torso: 8, bend: 1, head: -4, tw: -2, la: [29, 64], ra: [18, 56] }, 400, 'sine'),
    K({ ...F(0, HIP + 0.5, LF, RF, 3, 0), torso: 6, bend: -1, head: -2, tw: 1, la: [31, 68], ra: [15, 52] }, 400, 'sine'),
  ] },
  walk: { loop: true, blend: 120, speed: WALK_STEP / WALK_HALF * 1000, keys: [...walkHalf, ...walkHalf.map(mirror)] },
  run: { loop: true, blend: 100, speed: 470, keys: [...runHalf, ...runHalf.map(mirror)] },
  jump: { blend: 110, keys: [
    // The push-off is drawn 'in' then 'linear' (it was 'anticip' then 'out'): the crouch released
    // at full speed into a key that started at full speed again, the takeoff's one big head step
    // (19-22px a frame, now 13-15). arcEase keeps the old eases for the arc air attacks ride
    // (play()), so where they strike off the jump is unchanged.
    { ...K({ hx: -4, torso: 30, head: -12, ll: [50, -40], rl: [0, -62], la: [-70, -50], ra: [-70, -50] }, 60, 'in'), arcEase: 'anticip' },
    { ...K({ hx: 4, torso: 12, head: -4, ll: [25, 10], rl: [-20, -30], la: [40, 110], ra: [30, 100], air: 6 }, 40, 'linear'), arcEase: 'out' },
    K({ hx: 6, torso: 4, head: -2, ll: [10, 5], rl: [-15, -20], la: [165, 175], ra: [150, 170], air: 28 }, 110, 'out'),
    K({ hx: 6, torso: 10, head: -4, ll: [70, -50], rl: [55, -60], la: [120, 150], ra: [100, 140], air: 66 }, 140, 'sine'),
    K({ hx: 6, torso: 6, head: -4, ll: [70, -50], rl: [55, -60], la: [120, 150], ra: [100, 140], air: 76 }, 120, 'in'),
    K({ hx: 6, torso: 14, head: -6, ll: [24, 4], rl: [-10, -16], la: [110, 120], ra: [90, 100], air: 34 }, 60, 'linear'),
    K({ hx: 2, torso: 34, head: -8, ll: [52, -44], rl: [-4, -64], la: [60, 40], ra: [50, 30] }, 80, 'out', 'land'),
    K({ hx: 0, torso: 10, head: -3, ll: [26, 8], rl: [-22, -16], la: [60, 140], ra: [36, 158] }, 160, 'back', 'recover'),
    K({}, 0, 'sine'),
  ] },
  // Jab, traced from the black figure's short staff thrust, Xiao Xiao f55-f60: one frame of
  // anticipation (lead shoulder dips, lead hand pulls back a few px, nothing else moves), one
  // travel frame, contact with the lead arm dead straight at shoulder height and the torso
  // ~16 deg forward over feet splayed ~30 deg (f57), held two frames with a nudge of
  // overshoot, then a retract where the arm folds in one frame while the body is still
  // leaning (f59), and an ease-out to guard with a small overshoot past it.
  // The anticipation also softens both knees (the idle's IK-solved 2.5px drop, feet pinned) so the
  // shoulder dips before the hand goes. Rear hand stays home. Recovery is one 'settle' key.
  // Two frames of anticipation (a knee dip, then the lead hand pulls back 10px with the shoulder),
  // feet pinned throughout, then a breakdown frame and a tall overshoot on the way back to guard.
  jab: { blend: 40, limb: 'lHand', adapt: 'pinned', chainFrom: 2, keys: [
    K({ ...F(0, HIP - 1.5, LF, RF), torso: 4, bend: -1, head: -3, tw: 2, la: [50, 148], ra: [30, 165] }, 40, 'in'),
    K({ ...F(-2, HIP - 2, LF, RF), torso: 2, bend: -3, head: -2, tw: 6, la: [40, 140], ra: [30, 165] }, 40, 'in'),
    K({ ...F(3, HIP - 1, LF, RF), torso: 10, bend: 2, head: -3, tw: -4, la: [72, 104], ra: [32, 163] }, 40, 'linear'),
    K({ ...F(8, HIP - 1, LF, RF), torso: 16, bend: 3, head: -4, tw: -12, la: [92, 92], ra: [36, 160] }, 40, 'out', 'active'),
    K({ ...F(9, HIP - 1.5, LF, RF), torso: 17, bend: 4, head: -2, tw: -13, la: [93, 92], ra: [36, 160] }, 40, 'inOut'),
    K({ ...F(9, HIP - 1, LF, RF), torso: 17, bend: 3, head: -3, tw: -12, la: [93, 80], ra: [36, 160] }, 100, 'in', 'recover'),
    K({ ...F(4, HIP + 1.5, LF, RF), torso: 8, bend: 0, head: -9, tw: -4, la: [60, 130], ra: [32, 163] }, 100, 'out'),
    K({ ...F(1, HIP + 2.5, LF, RF), torso: 3, bend: -1, head: -8, tw: 2, la: [57, 148], ra: [28, 168] }, 80, 'out'),
    K({}, 0, 'sine'),
  ] },
  // Cross. The coil keeps winding through four frames (hips sink 1, 3, 6, 8px, shoulders turn
  // further back each frame, rear fist at the jaw), then the lead foot lifts and steps 25px,
  // landing on the impact frame while the fist arcs out. On the recovery the rear foot follows
  // 25px, so the fighter really moves through space: 'shift' moves the root 25px when the move
  // ends, and the last key is the guard (weight on the back foot) relative to the new spot.
  cross: { blend: 40, limb: 'rHand', shift: 25, adapt: 'step', chainFrom: 5, keys: [
    K({ ...F(-1, HIP - 1, LF, RF), torso: 3, bend: 1, head: 2, tw: -6, la: [34, 158], ra: [16, 170] }, 40, 'in'),
    K({ ...F(-3, HIP - 3, LF, RF), torso: 0, bend: 1, head: 5, tw: -10, la: [32, 159], ra: [18, 171] }, 40, 'linear'),
    K({ ...F(-6, HIP - 6, LF, RF), torso: -4, bend: 2, head: 8, tw: -14, la: [30, 160], ra: [20, 172] }, 40, 'linear'),
    K({ ...F(-8, HIP - 8, LF, RF), torso: -7, bend: 3, head: 10, tw: -18, la: [28, 160], ra: [22, 168] }, 40, 'linear'),
    K({ ...F(-2, HIP - 8, 30, RF, 8, 0), torso: -2, bend: 3, head: 8, tw: -14, la: [26, 158], ra: [26, 158] }, 40, 'linear'),
    K({ ...F(10, 44, 43, RF, 3, 0), torso: 18, bend: 4, head: 0, tw: 2, la: [24, 150], ra: [70, 92] }, 40, 'linear'),
    K({ ...F(24, 43, 43, RF), torso: 36, bend: 8, head: -16, tw: 16, la: [16, 150], ra: [96, 95] }, 40, 'out', 'active'),
    K({ ...F(25, 42.5, 43, RF), torso: 37, bend: 9, head: -14, tw: 17, la: [16, 150], ra: [97, 96] }, 80, 'inOut'),
    K({ ...F(25, 42.5, 43, RF), torso: 36, bend: 9, head: -15, tw: 16, la: [18, 150], ra: [96, 68] }, 80, 'inOut', 'recover'),
    K({ ...F(24, 46, 43, RF), torso: 24, bend: 5, head: -15, tw: 10, la: [28, 150], ra: [78, 100] }, 80, 'inOut'),
    K({ ...F(22, 50, 43, 11, 0, 10), torso: 12, bend: 1, head: -14, tw: 4, la: [40, 150], ra: [60, 120] }, 100, 'inOut', 'footstep'),
    K({ ...F(25, HIP + 2, 43, 11), torso: 2, bend: -1, head: -8, tw: -2, la: [56, 148], ra: [26, 170] }, 80, 'out'),
    K({ ...F(20, HIP - 2, 43, 11), torso: -1, bend: 0, head: -5, tw: -4, la: [52, 152], ra: [28, 166] }, 0, 'sine'),
  ] },
  // Roundhouse, traced from the doorway kick, Xiao Xiao f82-f91. Coil onto the lead leg,
  // chamber, diagonal, extension at hip height with the torso tipped back. Then the leg
  // keeps going 20-30 deg past the target and the body rotates with it (f85-f87: the kick is
  // held three frames while sinking, never pulled back along the wind-up). The leg folds
  // with the knee still forward (f88) and the foot plants AHEAD in a lunge (f89, IK-solved
  // so both feet sit on the floor), the shoulders settle and the weight shifts for two more
  // frames (f90), then the kicking foot comes back under the hip and the guard returns.
  // The standing (lead) foot is pinned at x=16 from the coil through the kick; the kicking leg is
  // posed by angle while in the air, then planted by position 44px ahead ('footstep'), the
  // shoulders settle over it for two frames, and it lifts and comes back to the guard spot
  // through a tall overshoot. No foot moves while it is on the floor.
  roundhouse: { blend: 60, limb: 'rFoot', adapt: 'kick', keys: [
    // Anticipation: sink 6px onto the lead leg, torso forward 22, shoulders wound (tw -16), rear
    // heel up. Then the torso leans AWAY as the leg rises (-18, -34, -42, -48 at the overshoot),
    // so the head travels ~30px back while the foot goes out.
    K({ hx: 2, ll: L(2, 43, 16), rl: leg(-16, 41), torso: 20, bend: 4, head: 4, tw: -14, la: [30, 160], ra: [-14, 110] }, 60, 'inOut'),
    K({ hx: 4, ll: L(4, 42, 16), rl: [8, -76], torso: 22, bend: 4, head: 6, tw: -16, la: [26, 158], ra: [-18, 100] }, 80, 'inOut'),
    K({ hx: 6, ll: L(6, 56, 16), rl: [66, -36], torso: -18, bend: -6, head: 10, tw: -4, la: [72, 132], ra: [-55, -40] }, 40, 'out'),
    K({ hx: 8, ll: L(8, 58, 16), rl: [96, 24], torso: -34, bend: -8, head: 14, tw: 6, la: [85, 145], ra: [-70, -55] }, 40, 'linear'),
    K({ hx: 15, ll: L(15, 58, 16), rl: [104, 102], torso: -42, bend: -8, head: 16, tw: 16, la: [95, 155], ra: [-85, -75] }, 40, 'out', 'active'),
    K({ hx: 16, ll: L(16, 58, 16), rl: [126, 120], torso: -48, bend: -10, head: 20, tw: 20, la: [100, 160], ra: [-92, -84] }, 40, 'inOut'),
    K({ hx: 16, ll: L(16, 58, 16), rl: [122, 110], torso: -46, bend: -9, head: 18, tw: 18, la: [96, 156], ra: [-86, -78] }, 40, 'out', 'recover'),
    K({ hx: 16, ll: L(16, 57, 16), rl: [102, 64], torso: -30, bend: -5, head: 14, tw: 14, la: [84, 152], ra: [-64, -14] }, 40, 'inOut'),
    K({ hx: 16, ll: L(16, 56, 16), rl: [70, 10], torso: -10, bend: 0, head: 8, tw: 10, la: [70, 150], ra: [-40, 40] }, 60, 'inOut'),
    K({ ...F(14, 50, 16, 44), torso: 14, bend: 4, head: -2, tw: 4, la: [50, 120], ra: [-20, 60] }, 60, 'out', 'footstep'),
    K({ ...F(16, 48, 16, 44), torso: 18, bend: 6, head: -6, tw: 0, la: [54, 130], ra: [-8, 80] }, 60, 'inOut'),
    K({ ...F(8, 52, 16, 18, 0, 12), torso: 10, bend: 2, head: -4, tw: -2, la: [56, 146], ra: [12, 140] }, 60, 'inOut'),
    K({ ...F(3, HIP + 2, LF, RF, 0, 3), torso: 4, bend: -1, head: -8, tw: -2, la: [58, 148], ra: [26, 170] }, 60, 'out'),
    K({ ...F(1, HIP + 1, LF, RF), torso: 5, bend: 0, head: -6, tw: -1, la: [48, 130], ra: [22, 140] }, 60, 'out'),
    K({ ...F(0, HIP - 1, LF, RF), torso: 6, bend: 1, head: -3, tw: 0, la: [40, 110], ra: [18, 120] }, 0, 'sine'),
  ] },
  // ---- Four-button set (BRIEF #4). Side: 'L' = l* limbs = the lead side in guard (orthodox,
  // left foot forward), 'R' = r* limbs = the rear side. 1 jab (L hand), 2 cross (R hand),
  // 3 lkick (L foot), 4 roundhouse (R foot). Variants: down+3 lowKick, forward+2 lungeCross,
  // back+4 spinKick, down+2 uppercut, down+4 sweep.

  // 3: lead-leg front snap kick to the body. Weight rocks back onto the rear leg (pinned), short
  // chamber, snap, rechamber (never back along the wind-up), plant. Torso leans away from the kick.
  lkick: { blend: 40, limb: 'lFoot', keys: [
    K({ hx: -4, rl: L(-4, 51, RF), ll: [44, -30], torso: 0, bend: 2, head: 4, tw: 4, la: [36, 160], ra: [24, 168] }, 80, 'in'),
    K({ hx: -2, rl: L(-2, 52, RF), ll: [96, -14], torso: -6, bend: 0, head: 8, tw: 2, la: [30, 160], ra: [22, 168] }, 40, 'linear'),
    K({ hx: 13.5, rl: L(13.5, 53.5, RF), ll: [94, 90], torso: -18, bend: -4, head: 12, tw: -4, la: [20, 165], ra: [10, 170] }, 40, 'out', 'active'),
    K({ hx: 13.5, rl: L(13.5, 53.5, RF), ll: [96, 93], torso: -19, bend: -4, head: 12, tw: -4, la: [20, 165], ra: [10, 170] }, 60, 'inOut'),
    K({ hx: 8, rl: L(8, 53, RF), ll: [98, 10], torso: -12, bend: -2, head: 8, la: [26, 162], ra: [16, 168] }, 60, 'inOut', 'recover'),
    K({ hx: 4, rl: L(4, 52, RF), ll: [60, -30], torso: -4, bend: 0, head: 2, la: [32, 160], ra: [22, 166] }, 60, 'inOut'),
    K({ ...F(1, HIP, LF, RF), torso: 4, head: -4, la: [52, 152], ra: [28, 166] }, 60, 'out', 'footstep'),
    K({ ...F(0, HIP - 1, LF, RF), torso: 5, head: -3 }, 0, 'sine'),
  ] },
  // down+3: low lead-leg kick to the shin. Same rock-back, a low chamber, the foot whips out at
  // knee height (~30px off the floor), rechamber low, plant.
  lowKick: { blend: 40, limb: 'lFoot', height: 'low', keys: [
    K({ hx: -3, rl: L(-3, 51, RF), ll: [36, -24], torso: 2, bend: 2, head: 4, tw: 4, la: [36, 160], ra: [24, 168] }, 60, 'in'),
    K({ hx: 2, rl: L(2, 51, RF), ll: [70, -10], torso: -2, head: 8, tw: 2, la: [32, 160], ra: [22, 168] }, 40, 'linear'),
    K({ hx: 12, rl: L(12, 52, RF), ll: [62, 76], torso: -10, bend: -2, head: 12, tw: -4, la: [24, 164], ra: [14, 170] }, 40, 'out', 'active'),
    K({ hx: 12, rl: L(12, 52, RF), ll: [63, 77], torso: -11, bend: -2, head: 12, tw: -4, la: [24, 164], ra: [14, 170] }, 60, 'inOut'),
    K({ hx: 8, rl: L(8, 52, RF), ll: [56, 10], torso: -6, head: 8, la: [28, 162], ra: [18, 168] }, 60, 'inOut', 'recover'),
    K({ hx: 3, rl: L(3, 52, RF), ll: [40, -14], torso: 0, head: 2, la: [34, 160], ra: [22, 166] }, 60, 'inOut'),
    K({ ...F(1, HIP, LF, RF), torso: 4, head: -4, la: [52, 152], ra: [28, 166] }, 60, 'out', 'footstep'),
    K({ ...F(0, HIP - 1, LF, RF), torso: 5, head: -3 }, 0, 'sine'),
  ] },
  // forward+2: the cross with an extra 25px. The rear foot slides up first while the coil winds,
  // then the lead foot steps 50px and lands on the impact frame; the rear foot follows on the
  // recovery. The root travels 50px ('shift').
  lungeCross: { blend: 40, limb: 'rHand', shift: 50, keys: [
    K({ ...F(-1, HIP - 1, LF, RF), torso: 3, bend: 1, head: 2, tw: -6, la: [34, 158], ra: [16, 170] }, 40, 'in'),
    K({ ...F(-4, HIP - 4, LF, RF + 12, 0, 10), torso: -2, bend: 2, head: 6, tw: -12, la: [32, 159], ra: [18, 171] }, 40, 'linear'),
    K({ ...F(-2, HIP - 7, LF, RF + 22), torso: -6, bend: 3, head: 9, tw: -18, la: [30, 160], ra: [22, 168] }, 40, 'linear'),
    K({ ...F(10, HIP - 8, LF + 30, RF + 22, 10, 0), torso: 0, bend: 3, head: 8, tw: -14, la: [26, 158], ra: [26, 158] }, 40, 'linear'),
    K({ ...F(26, 45, LF + 50, RF + 22, 3, 0), torso: 18, bend: 4, head: 0, tw: 2, la: [24, 150], ra: [70, 92] }, 40, 'linear'),
    K({ ...F(42, 43, LF + 50, RF + 22), torso: 36, bend: 8, head: -16, tw: 16, la: [16, 150], ra: [96, 95] }, 40, 'out', 'active'),
    K({ ...F(43, 42.5, LF + 50, RF + 22), torso: 37, bend: 9, head: -14, tw: 17, la: [16, 150], ra: [97, 96] }, 80, 'inOut'),
    K({ ...F(43, 42.5, LF + 50, RF + 22), torso: 36, bend: 9, head: -15, tw: 16, la: [18, 150], ra: [96, 68] }, 80, 'inOut', 'recover'),
    K({ ...F(43, 46, LF + 50, RF + 22), torso: 24, bend: 5, head: -15, tw: 10, la: [28, 150], ra: [78, 100] }, 80, 'inOut'),
    K({ ...F(44, 50, LF + 50, RF + 50, 0, 10), torso: 12, bend: 1, head: -14, tw: 4, la: [40, 150], ra: [60, 120] }, 100, 'inOut', 'footstep'),
    K({ ...F(50, HIP + 2, LF + 50, RF + 50), torso: 2, bend: -1, head: -8, tw: -2, la: [56, 148], ra: [26, 170] }, 80, 'out'),
    K({ ...F(46, HIP - 2, LF + 50, RF + 50), torso: -1, bend: 0, head: -5, tw: -4, la: [52, 152], ra: [28, 166] }, 0, 'sine'),
  ] },
  // down+2: uppercut. The rear fist drops to the hip as the knees sink 10px and the torso folds
  // forward, then everything drives up: hips rise past guard, torso tips back, and the fist
  // travels up the centreline to finish in front of the chin. Launches (combat: short juggle).
  uppercut: { blend: 40, limb: 'rHand', keys: [
    K({ ...F(-2, HIP - 4, LF, RF), torso: 10, bend: 4, head: 6, tw: -10, la: [34, 158], ra: [10, 60] }, 60, 'in'),
    K({ ...F(0, HIP - 10, LF, RF), torso: 16, bend: 6, head: 8, tw: -14, la: [32, 160], ra: [-10, 20] }, 60, 'linear'),
    K({ ...F(6, HIP - 6, LF, RF), torso: 6, bend: 2, head: 4, tw: -4, la: [30, 160], ra: [30, 100] }, 40, 'linear'),
    K({ ...F(12, HIP + 1, LF, RF), torso: 8, bend: 2, head: -10, tw: 10, la: [30, 160], ra: [84, 172] }, 40, 'out', 'active'),
    K({ ...F(12, HIP + 2, LF, RF, 0, 4), torso: 4, bend: 0, head: -12, tw: 12, la: [30, 160], ra: [90, 180] }, 60, 'inOut'),
    K({ ...F(9, HIP + 1, LF, RF), torso: -6, bend: -3, head: -8, tw: 8, la: [32, 158], ra: [60, 150] }, 80, 'inOut', 'recover'),
    K({ ...F(4, HIP, LF, RF), torso: 2, bend: 0, head: -4, tw: 2, la: [36, 156], ra: [40, 160] }, 80, 'inOut'),
    K({ ...F(0, HIP - 1, LF, RF), torso: 5, head: -3, la: [52, 150], ra: [30, 164] }, 0, 'sine'),
  ] },
  // back+4: spinning back kick with the rear leg. The lead foot is the pivot (pinned at 16). The
  // shoulders wind forward, then turn through edge-on to reversed (tw 10 -> 22 -> 0 -> -24) while
  // the arms swing across; the knee chambers tight, and the leg thrusts out straight at mid height
  // with the torso tipped well away and the head looking back over the shoulder. Rechamber, step
  // the foot down, return it behind to the guard spot.
  spinKick: { blend: 40, limb: 'rFoot', keys: [
    K({ ...F(4, HIP - 3, LF, RF), torso: 10, bend: 2, head: 4, tw: 8, la: [44, 156], ra: [24, 160] }, 60, 'in'),
    K({ hx: 14, ll: L(14, 51, 14), rl: [10, -40], torso: 14, bend: 2, head: 6, tw: 4, spin: 80, la: [30, 160], ra: [20, 160] }, 60, 'linear'),
    K({ hx: 14, ll: L(14, 51, 14), rl: [-100, -20], torso: 20, bend: 4, head: -12, spin: 150, la: [50, 120], ra: [40, 110] }, 40, 'linear'),
    K({ hx: 14, ll: L(14, 52, 14), rl: [-112, -16], torso: 26, bend: 4, head: -20, spin: 180, la: [56, 110], ra: [46, 100] }, 40, 'linear'),
    K({ hx: 14, ll: L(14, 57, 14), rl: [-84, -80], torso: 50, bend: 6, head: -24, spin: 180, la: [64, 96], ra: [44, 80] }, 40, 'out', 'active'),
    K({ hx: 14, ll: L(14, 57, 14), rl: [-85, -81], torso: 52, bend: 6, head: -24, spin: 180, la: [66, 94], ra: [46, 78] }, 60, 'inOut'),
    K({ hx: 14, ll: L(14, 55, 14), rl: [-110, -12], torso: 30, bend: 4, head: -14, spin: 200, la: [100, 70], ra: [-80, -110] }, 80, 'inOut', 'recover'),
    K({ hx: 12, ll: L(12, 53, 14), rl: [-40, -70], torso: 12, bend: 2, head: -4, spin: 270, la: [90, 60], ra: [-70, -100] }, 40, 'inOut'),
    K({ ...F(8, 51, 14, RF, 0, 10), torso: 8, bend: 1, head: -4, spin: 340, la: [50, 148], ra: [28, 160] }, 80, 'inOut'),
    K({ ...F(2, HIP, LF, RF), torso: 4, head: -6, spin: 360, la: [54, 150], ra: [28, 166] }, 80, 'out', 'footstep'),
    K({ ...F(0, HIP - 1, LF, RF), torso: 5, head: -3, spin: 360 }, 0, 'sine'),
  ] },
  // Low kick to the lead leg: the knee buckles, the hips drop forward over it, the rear heel lifts,
  // the head dips; hold, then push back up into a loose guard. Feet pinned.
  hitLow: { blend: 30, keys: [
    K({ ...F(3, HIP - 8, LF, RF), torso: 14, bend: 4, head: 10, la: [-10, 30], ra: [-24, 10] }, 40, 'out'),
    K({ ...F(5, HIP - 12, LF, RF, 0, 4), torso: 18, bend: 6, head: 14, la: [-30, 10], ra: [-40, -6] }, 40, 'out'),
    K({ ...F(4, HIP - 11, LF, RF, 0, 3), torso: 16, bend: 5, head: 12, la: [-26, 16], ra: [-36, 0] }, 100, 'sine'),
    K({ ...F(2, HIP - 8, LF, RF), torso: 12, bend: 3, head: 8, la: [-6, 40], ra: [-20, 20] }, 100, 'in', 'recover'),
    K({ ...F(0, HIP - 3, LF, RF), torso: 6, bend: 0, head: 0, la: [32, 70], ra: [16, 56] }, 80, 'out'),
    K({ ...F(0, HIP - 3, LF, RF), torso: 5, head: -3, la: [28, 62], ra: [16, 54] }, 0, 'sine'),
  ] },
  // A string hit that should not move the defender: head snap only, feet still, quick recovery.
  hitStun: { blend: 30, keys: [
    K({ ...F(-1, HIP - 1, LF, RF), torso: -4, bend: -8, head: -40, la: [2, 18], ra: [-10, 6] }, 40, 'out'),
    K({ ...F(-2, HIP - 2, LF, RF), torso: -4, bend: -5, head: -32, la: [-10, 10], ra: [-20, 0] }, 40, 'out'),
    K({ ...F(-7, HIP - 6, LF, RF), torso: -12, bend: -7, head: -30, tw: -4, la: [-20, 0], ra: [-30, -10] }, 90, 'sine'),
    K({ ...F(1, HIP - 2, LF, RF, 0, 3), torso: -2, bend: -3, head: -16, tw: 6, la: [10, 40], ra: [-34, -10] }, 90, 'sine'),
    K({ ...F(-2, HIP - 2, LF, RF), torso: -6, bend: -6, head: -18, la: [0, 20], ra: [-12, 6] }, 60, 'inOut', 'recover'),
    K({ ...F(0, HIP - 3, LF, RF), torso: 5, bend: 0, head: -2, la: [28, 62], ra: [16, 54] }, 80, 'out'),
    K({ ...F(0, HIP - 3, LF, RF), torso: 5, head: -4, la: [28, 62], ra: [16, 54] }, 0, 'sine'),
  ] },
  // Coil up and back over the rear leg, drop, diagonal, sweep along the floor, overshoot,
  // settle, quick retract and rise.
  // Coil with the weight on the lead leg and the sweeping leg stretched back, drop, the
  // foot arcs under the hip and out along the floor, overshoot, settle, pull back, rise.
  sweep: { blend: 40, limb: 'rFoot', height: 'low', keys: [
    K({ hx: 6, torso: -4, bend: -4, head: 0, tw: -8, ll: [40, -30], rl: [-40, -40], la: [40, 150], ra: [-30, 120] }, 80, 'in'),
    K({ hx: 8, torso: -6, bend: -4, head: 4, tw: -10, ll: [44, -34], rl: [-44, -44], la: [38, 148], ra: [-36, 116] }, 40, 'linear'),
    K({ hx: -2, torso: 36, bend: 6, head: -8, tw: -2, ll: [74, -70], rl: [10, -70], la: [-40, -14], ra: [-30, 10] }, 40, 'linear'),
    K({ hx: 4, torso: 44, bend: 8, head: -8, tw: 4, ll: [76, -72], rl: [70, 10], la: [-50, -24], ra: [40, 60] }, 40, 'linear'),
    K({ hx: 12, torso: 52, bend: 10, head: -6, tw: 10, ll: [78, -74], rl: [82, 82], la: [-54, -30], ra: [66, 46] }, 40, 'out', 'active'),
    K({ hx: 16, torso: 56, bend: 12, head: -2, tw: 12, ll: [78, -74], rl: [88, 90], la: [-56, -32], ra: [70, 50] }, 40, 'inOut'),
    K({ hx: 13, torso: 53, bend: 10, head: -5, tw: 10, ll: [78, -74], rl: [84, 84], la: [-54, -30], ra: [67, 47] }, 40, 'in', 'recover'),
    K({ hx: 8, torso: 46, bend: 8, head: -8, tw: 6, ll: [76, -72], rl: [56, -20], la: [-46, -18], ra: [50, 60] }, 40, 'out'),
    K({ hx: 2, torso: 26, bend: 2, head: -8, tw: 2, ll: [60, -50], rl: [20, -50], la: [-20, 60], ra: [40, 90] }, 50, 'out'),
    K({ hx: 0, torso: 14, head: -6, ll: [32, 8], rl: [-22, -30] }, 90, 'back'),
    K({}, 0, 'sine'),
  ] },
  // Jab to the head: a head snap, the legs barely move (hips 2px). The lead arm drops forward and
  // out, the rear arm flings back, so white shows between both arms and the torso. Hold two
  // frames, recover with a head shake.
  hitLight: { blend: 30, shift: -29, keys: [
    // Head snap with the legs still (k0-k1), then a short shuffle back: rear foot lifts and lands
    // 29px back, front foot follows. 'shift' turns that into root travel, so knockback happens
    // through steps, never skating. Lead arm flings up and away, rear arm back.
    K({ ...F(-1, HIP - 1, LF, RF), torso: -4, bend: -8, head: -46, la: [4, 20], ra: [-8, 10] }, 40, 'out'),
    K({ ...F(-4, HIP - 2, LF, RF - 29, 0, 14), torso: -10, bend: -10, head: -36, la: [-170, -160], ra: [-34, 40] }, 40, 'out'),
    K({ ...F(-17, HIP - 2, LF - 14, RF - 29, 14, 0), torso: -11, bend: -11, head: -32, la: [-120, -100], ra: [-42, 30] }, 40, 'out'),
    K({ ...F(-26, HIP - 2, LF - 29, RF - 29), torso: -14, bend: -12, head: -34, la: [24, 96], ra: [-6, 84] }, 80, 'sine'),
    K({ ...F(-27, HIP - 2, LF - 29, RF - 29), torso: -5, bend: -6, head: -20, tw: 5, la: [24, 96], ra: [-6, 84] }, 100, 'in', 'recover'),
    K({ ...F(-30, HIP - 1, LF - 29, RF - 29), torso: 1, bend: -2, head: -8, tw: 3, la: [24, 96], ra: [-6, 84] }, 80, 'out'),
    K({ ...F(-29, HIP - 3, LF - 29, RF - 29), torso: 5, bend: 0, head: 2, tw: -3, la: [28, 62], ra: [16, 54] }, 80, 'inOut'),
    K({ ...F(-29, HIP - 3, LF - 29, RF - 29), torso: 5, bend: 0, head: -4, tw: 0, la: [28, 62], ra: [16, 54] }, 0, 'sine'),
  ] },
  // Straight shot to the head (the cross receiver): the back arches, the head stays 25px+ behind
  // the hips through the hold, and the lead foot steps back BEHIND the rear foot (a crossing
  // stagger). Arms fly forward off the arch, away from the torso. Recovery: a hand comes up to
  // the face, the crossed foot steps back out to the guard spot, the body straightens past
  // upright by a few degrees, then settles.
  hitBack: { blend: 30, shift: -30, keys: [
    // Arch with a crossing stagger: the lead foot lifts and steps back behind the rear foot (22px
    // apart), then the rear foot steps back out past it (24px apart), so the stance stays split.
    // Each foot moves only on keys where it is lifted 16px over 60ms+, so no frame shows a
    // planted foot sliding. Recovery: lead foot steps up, rear foot steps up, settle. Root -30.
    K({ ...F(0, HIP - 1, LF, RF), torso: -6, bend: -10, head: -48, tw: 4, la: [2, 18], ra: [-10, 6] }, 40, 'out'),
    K({ ...F(-8, HIP - 2, -10, RF, 16, 0), torso: -20, bend: -18, head: -36, la: [-50, -20], ra: [-34, -4] }, 60, 'inOut'),
    K({ ...F(-16, HIP - 3, -36, RF), torso: -30, bend: -20, head: -24, la: [-64, -36], ra: [-50, -20] }, 60, 'inOut', 'land'),
    K({ ...F(-26, HIP - 3, -36, -38, 0, 16), torso: -32, bend: -22, head: -20, la: [-60, -30], ra: [-46, -16] }, 60, 'inOut'),
    K({ ...F(-34, HIP - 3, -36, -60), torso: -32, bend: -22, head: -18, la: [24, 96], ra: [-6, 84] }, 80, 'sine'),
    K({ ...F(-34, HIP - 3, -36, -60), torso: -28, bend: -18, head: -16, la: [24, 96], ra: [-6, 84] }, 80, 'inOut', 'recover'),
    K({ ...F(-30, HIP - 2, -22, -60, 14, 0), torso: -14, bend: -8, head: -12, la: [24, 96], ra: [-6, 84] }, 70, 'inOut'),
    K({ ...F(-30, HIP - 2, LF - 30, -60), torso: -4, bend: -3, head: -8, la: [40, 70], ra: [20, 50] }, 70, 'inOut'),
    K({ ...F(-30, HIP - 1, LF - 30, -52, 0, 14), torso: 6, bend: 1, head: -2, la: [28, 62], ra: [16, 54] }, 70, 'inOut'),
    K({ ...F(-31, HIP - 3, LF - 30, RF - 30), torso: 7, bend: 1, head: -4, la: [28, 62], ra: [16, 54] }, 80, 'inOut'),
    K({ ...F(-31, HIP - 3, LF - 30, RF - 30), torso: 5, bend: 0, head: -3, tw: 0, la: [28, 62], ra: [16, 54] }, 0, 'sine'),
  ] },
  // Heavy hit, spun: the shoulders turn (tw 24-26), the near arm is flung across the front of the
  // body and the far arm whips back and up, the head whips aside, and the body rotates off the
  // hit into an S (lower spine back, chest forward). Rear foot steps back, front foot drags.
  // Recovery: hand to the face, a stumble step in, straighten with a forward overshoot, settle.
  hitHeavy: { blend: 30, keys: [
    K({ ...F(0, HIP - 1, LF, RF), torso: -2, bend: -6, head: -50, tw: 14, la: [-10, 30], ra: [-20, 20] }, 40, 'out'),
    K({ ...F(-6, HIP - 3, LF, -36, 0, 10), torso: -14, bend: 8, head: -40, tw: 24, la: [-60, -40], ra: [-60, -20] }, 40, 'out'),
    K({ ...F(-14, HIP - 5, LF, -40), torso: -20, bend: 14, head: -34, tw: 26, la: [-70, -50], ra: [-70, -40] }, 40, 'out', 'land'),
    K({ ...F(-16, HIP - 6, 4, -40, 8, 0), torso: -22, bend: 16, head: -30, tw: 22, la: [-80, -50], ra: [-80, -50] }, 40, 'out'),
    K({ ...F(-18, HIP - 6, 4, -40), torso: -22, bend: 16, head: -28, tw: 20, la: [-70, -40], ra: [-66, -40] }, 80, 'sine'),
    K({ ...F(-17, HIP - 6, 4, -40), torso: -20, bend: 14, head: -26, tw: 16, la: [-40, -16], ra: [-80, -50] }, 100, 'in', 'recover'),
    K({ ...F(-14, HIP - 4, 4, -28, 0, 10), torso: -14, bend: 10, head: -18, tw: 12, la: [-40, 10], ra: [-50, -20] }, 80, 'inOut'),
    K({ ...F(-10, HIP - 3, 4, -16), torso: -6, bend: 6, head: -12, tw: 6, la: [20, 60], ra: [-20, 20] }, 80, 'inOut'),
    K({ ...F(-2, HIP - 1, LF, -16, 8, 0), torso: 8, bend: 0, head: 0, tw: -4, la: [44, 130], ra: [10, 90] }, 80, 'out'),
    K({ ...F(0, HIP, LF, RF, 0, 3), torso: 4, bend: 0, head: -9, tw: 2, la: [52, 144], ra: [30, 158] }, 80, 'inOut'),
    K({ ...F(-1, HIP - 1, LF, RF), torso: 5, bend: 0, head: -3, tw: 1, la: [52, 146], ra: [30, 162] }, 0, 'sine'),
  ] },
  // Body shot: doubled over, with a stagger. Hips go back, the rear foot steps back as the torso
  // folds, arms hang down and forward clear of the body. Recovery over four frames: a hand to the
  // gut, a stumble step in, straighten past upright, settle.
  hitBody: { blend: 30, keys: [
    K({ ...F(-10, HIP - 4, LF, RF), torso: 12, bend: 8, head: 2, la: [2, 14], ra: [-8, 4] }, 40, 'out'),
    K({ ...F(-12, HIP - 6, LF, -34, 0, 10), torso: 40, bend: 18, head: 18, la: [12, 0], ra: [2, -10] }, 40, 'out'),
    K({ ...F(-16, HIP - 6, LF, -40), torso: 50, bend: 22, head: 26, la: [8, -6], ra: [-2, -14] }, 40, 'out', 'land'),
    K({ ...F(-17, HIP - 6, LF, -40), torso: 52, bend: 22, head: 28, la: [6, -8], ra: [-4, -16] }, 80, 'sine'),
    K({ ...F(-16, HIP - 6, LF, -40), torso: 46, bend: 20, head: 22, la: [50, -60], ra: [10, -10] }, 100, 'in', 'recover'),
    K({ ...F(-10, HIP - 4, LF, -20, 0, 10), torso: 32, bend: 12, head: 14, la: [50, -60], ra: [20, 40] }, 80, 'out'),
    K({ ...F(-4, HIP - 2, LF, -20), torso: 16, bend: 6, head: 6, la: [50, -40], ra: [30, 110] }, 80, 'out'),
    K({ ...F(-2, HIP - 1, LF, RF, 0, 8), torso: 0, bend: -2, head: -8, la: [54, 120], ra: [30, 150] }, 80, 'out'),
    K({ ...F(0, HIP, LF, RF), torso: 6, bend: 0, head: -3, la: [54, 146], ra: [30, 162] }, 80, 'inOut'),
    K({ ...F(-1, HIP - 1, LF, RF), torso: 5, bend: 0, head: -3, la: [52, 146], ra: [30, 162] }, 0, 'sine'),
  ] },
  // Two-step walk forward, 24px: lead foot lifts and plants, then the rear foot. 'shift' moves the
  // root when it ends, so the last key is the guard at the new spot. The demo uses it for the
  // defender stepping back in after knockback.
  advance: makeAdvance(24),
  vault: makeVault(340, 44),
  // Knockdown, traced from the brown victim's flight (Xiao Xiao f119-f128) and the olive
  // launch (f84-f91): launched with the torso leaning back and the legs lifting, rising into
  // an arched C (hips forward, head back, legs trailing bent, arms spread), the apex is a
  // single frame, then the body rotates on the way down (head dropping, legs rising) and
  // lands head and shoulders first, squashes into the floor with the legs slapping down late,
  // and settles. The spine is bent through the whole flight, never a plank.
  // One key per 40ms frame through the flight so the height follows a parabola (air 4, 28, 44,
  // 50 apex, 40, 20, 0: +24 +16 +6 -10 -20 -20) with a single apex frame; the legs tuck at the
  // apex and swing over late (f90), arms trail a frame behind the torso.
  // Launched up and out: the head rises ~20px over the first frames while the hips travel back at
  // a near-constant 14px/frame. The body tips back but never past 74 deg before touching, so it
  // lands hips first; then the back slaps down while the knees draw in (breakdown), tucks into the
  // ball with a bounce, the legs flop out, and it rests knotted.
  knockdown: { blend: 40, keys: [
    K({ hx: -10, torso: -8, bend: -6, head: -30, la: [-20, 20], ra: [-30, 10], ll: [30, 10], rl: [10, -10], air: 16 }, 40, 'linear'),
    K({ hx: -24, torso: -18, bend: -10, head: -24, la: [70, 120], ra: [30, 60], ll: [44, 34], rl: [16, -36], air: 38 }, 40, 'linear'),
    K({ hx: -38, torso: -30, bend: -12, head: -18, la: [110, 160], ra: [60, 30], ll: [56, 46], rl: [26, -30], air: 52 }, 40, 'sine'),
    K({ hx: -52, torso: -40, bend: -12, head: -12, la: [80, 40], ra: [120, 170], ll: [78, 66], rl: [48, -6], air: 58 }, 40, 'sine'),
    K({ hx: -66, torso: -46, bend: -10, head: -8, la: [130, 180], ra: [70, 30], ll: [102, 92], rl: [74, 26], air: 55 }, 40, 'linear'),
    K({ hx: -80, torso: -48, bend: -8, head: -6, la: [70, 30], ra: [140, 190], ll: [118, 108], rl: [98, 56], air: 42 }, 40, 'linear'),
    K({ hx: -94, torso: -50, bend: -6, head: -4, la: [140, 190], ra: [80, 40], ll: [126, 116], rl: [112, 80], air: 22 }, 40, 'linear'),
    K({ hx: -106, torso: -50, bend: -4, head: 0, la: [100, 150], ra: [60, 20], ll: [122, 110], rl: [110, 90], air: 0 }, 40, 'out', 'land'),
    K({ hx: -114, torso: -78, bend: -12, head: 10, la: [-150, -112], ra: [80, 116], ll: [168, 124], rl: [158, 108], air: 2 }, 40, 'out'),
    K({ hx: -119, torso: -96, bend: -16, head: 22, la: [-150, -110], ra: [70, 110], ll: [232, 150], rl: [218, 134], air: 12 }, 40, 'in'),
    K({ hx: -124, torso: -94, bend: -10, head: 12, la: [-140, -120], ra: [80, 120], ll: [176, 120], rl: [148, 70], air: 6 }, 40, 'out'),
    K({ hx: -127, torso: -92, bend: -4, head: 16, la: [-128, -112], ra: [86, 112], ll: [112, 90], rl: [144, 54], air: 1 }, 40, 'out'),
    K({ hx: -128, torso: -91, bend: -2, head: 20, la: [-122, -100], ra: [90, 106], ll: [100, 78], rl: [142, 50], air: 0 }, 60, 'out'),
    K({ hx: -128, torso: -92, bend: -2, head: 20, la: [-120, -96], ra: [90, 104], ll: [98, 76], rl: [140, 50] }, 90, 'sine'),
    K({ hx: -128, torso: -88, bend: -12, head: 32, la: [-112, -90], ra: [100, 86], ll: [100, 72], rl: [136, 54], air: 2 }, 90, 'sine'),
    K({ hx: -128, torso: -92, bend: -2, head: 20, la: [-120, -96], ra: [90, 104], ll: [98, 76], rl: [140, 50] }, 0, 'sine'),
  ] },
  // Roll through: legs swing up, tuck forward to sit, hand down, hips rise before the head.
  // Roll through: legs swing up, sit up with the head over the hips so the roll reads,
  // rock forward onto the feet with the hands down, pause at the deep crouch, push up.
  // Breakdowns between flat, tuck, sit and crouch; from the crouch up the feet step (lift, then
  // plant by IK at the next spot) instead of sliding, ending on the guard spots.
  // From the knotted rest pose: head and chest curl up while the legs stay down, the far knee
  // draws up, then the body rocks forward onto both feet (the near knee is already up), crouch,
  // then the feet step to the guard spots (a foot moves only while lifted). hx only increases,
  // so the head travels forward the whole way.
  getup: { blend: 20, shift: -110.0, keys: [
    K({ hx: -128.0, torso: -92, bend: -2, head: 20, la: [-120, -96], ra: [90, 104], ll: [98, 76], rl: [140, 50] }, 90, 'inOut'),
    K({ hx: -128.0, torso: -86, bend: 4, head: 22, la: [-100, -80], ra: [80, 96], ll: [98, 76], rl: [140, 50] }, 80, 'inOut'),
    K({ hx: -127.6, torso: -76, bend: 8, head: 24, la: [-76, -56], ra: [66, 90], ll: [104, 70], rl: [142, 48] }, 80, 'inOut'),
    K({ hx: -126.8, torso: -68, bend: 9, head: 23, la: [-66, -54], ra: [70, 96], ll: [120, 58], rl: [142, 44] }, 80, 'inOut'),
    K({ hx: -126.0, torso: -58, bend: 10, head: 22, la: [-70, -66], ra: [74, 92], ll: [132, 44], rl: [140, 38] }, 80, 'inOut'),
    K({ hx: -123.5, torso: -34, bend: 8, head: 18, la: [-44, -24], ra: [70, 80], ll: [116, -20], rl: [108, -30] }, 100, 'out'),
    K({ hx: -118.7, torso: -12, head: 14, la: [-36, -16], ra: [56, 60], ll: [80, -66], rl: [72, -74] }, 90, 'out'),
    K({ hx: -116.8, torso: 18, bend: 6, head: 14, la: [-56, -44], ra: [30, 44], ll: [72, -64], rl: [20, -80] }, 80, 'inOut'),
    K({ ...F(-116, 29, -108, -152, 6, 0), torso: 24, bend: 4, head: 12, la: [-48, -42], ra: [40, 44] }, 80, 'out'),
    K({ ...F(-115, 31, -108, -152), torso: 24, head: 10, la: [-40, -40], ra: [70, 50] }, 90, 'sine'),
    // Steps: a foot moves only while lifted (the lifted key already holds its new x), then lands.
    K({ ...F(-114, 38, -108, -128, 0, 12), torso: 22, head: 8, la: [40, 72], ra: [52, 64] }, 90, 'inOut'),
    K({ ...F(-113, 42, -108, -128), torso: 20, head: 8, la: [50, 90], ra: [50, 90] }, 80, 'inOut'),
    K({ ...F(-111.5, 45, -92, -128, 12, 0), torso: 20, head: 8, la: [56, 110], ra: [46, 116] }, 90, 'inOut'),
    K({ ...F(-110.5, 48, -92, -128), torso: 14, head: 5, la: [60, 130], ra: [40, 140] }, 80, 'inOut'),
    K({ ...F(-110, HIP - 2, -92, -124, 0, 10), torso: 8, head: 0, la: [60, 146], ra: [38, 160] }, 90, 'inOut', 'recover'),
    K({ ...F(-109.7, HIP, -92, -124), torso: 5, head: -4, la: [58, 150], ra: [32, 164] }, 90, 'out'),
    K({ ...F(-110, HIP - 1, -92, -124), torso: 5, head: -3 }, 0, 'sine'),
  ] },
  block: { blend: 60, keys: [
    K({ hx: -6, torso: 10, head: 6, la: [65, 180], ra: [45, 170], ll: [30, 18], rl: [-28, -24] }, 90, 'out'),
    K({ hx: -4, torso: 8, head: 4, la: [62, 178], ra: [44, 168], ll: [28, 20], rl: [-25, -18] }, 0, 'sine'),
  ] },
  // Knees give, body folds, falls forward with the arms lagging, hits face down, settles.
  ko: { blend: 50, keys: [
    K({ hx: -8, torso: -15, head: -30, la: [10, 20], ra: [-5, 10], ll: [25, 15], rl: [-20, -10] }, 160, 'in'),
    K({ hx: 0, torso: 10, head: 10, la: [20, 30], ra: [10, 25], ll: [50, -55], rl: [20, -75] }, 140, 'in'),
    K({ hx: 15, torso: 60, head: 40, la: [40, 50], ra: [20, 30], ll: [60, -80], rl: [40, -85] }, 110, 'in'),
    K({ hx: 40, torso: 92, head: 20, la: [100, 94], ra: [-40, -60], ll: [-85, -92], rl: [-80, -88] }, 70, 'out', 'land'),
    K({ hx: 42, torso: 88, head: 30, la: [92, 86], ra: [-80, -84], ll: [-90, -90], rl: [-84, -86], air: 3 }, 120, 'out'),
    K({ hx: 40, torso: 90, head: 15, la: [90, 86], ra: [-95, -92], ll: [-90, -90], rl: [-86, -88] }, 0, 'sine'),
  ] },
};

// ---- v2 move set ------------------------------------------------------------------------
const CH = 38;   // crouch hip height
const crouchP = { ...F(0, CH, LF + 2, RF - 2), torso: 18, bend: 6, head: -10, tw: 0, la: [40, 160], ra: [26, 166] };
const deepKeys = d => d.keys.map(k => ({ ...k, p: JSON.parse(JSON.stringify(k.p)) }));
Object.assign(MOVE_DEFS, {
  // Crouch idle: hips at 38, chest over the knees, guard tucked, breathing.
  crouch: { loop: true, blend: 120, keys: [
    K({ ...crouchP }, 500, 'sine'),
    K({ ...crouchP, ...F(1, CH - 1.5, LF + 2, RF - 2), torso: 20, bend: 7, head: -8, la: [42, 158], ra: [28, 164] }, 500, 'sine'),
  ] },
  crouchDown: { blend: 30, keys: [
    K({ ...F(0, HIP - 6, LF + 1, RF - 1), torso: 12, bend: 3, head: -7 }, 60, 'inOut'),
    K({ ...crouchP, ...F(0, CH - 2, LF + 2, RF - 2) }, 60, 'out'),
    K({ ...crouchP }, 0, 'sine'),
  ] },
  crouchUp: { blend: 30, keys: [
    K({ ...crouchP, ...F(0, CH + 4, LF + 2, RF - 2), torso: 14 }, 60, 'inOut'),
    K({ ...F(0, HIP + 1.5, LF, RF), torso: 5, head: -5 }, 60, 'out'),
    K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4 }, 0, 'sine'),
  ] },
  // Crouch walk: short shuffling steps on the IK, feet locked while down.
  crouchWalk: { loop: true, blend: 100, speed: 70, keys: [0, 1, 2, 3].map(i => {
    const u = i / 4, plant = 14 - 28 * u, swing = -14 + 28 * (1 - (1 - u) * (1 - u)), lift = 1 + 6 * dm.sin(Math.PI * u);
    return K({ ...crouchP, ...F(0, CH - dm.sin(Math.PI * u) * 1.5, plant, swing, 0, lift) }, 100, 'linear', i === 0 ? 'footstep' : null);
  }).flatMap((k, i, a) => i === a.length - 1 ? [k, ...a.map(mirror)] : [k]) },
  crouchBlock: { blend: 50, keys: [
    K({ ...crouchP, ...F(-3, CH - 1, LF + 2, RF - 2), torso: 22, bend: 8, head: -2, la: [70, 176], ra: [56, 170] }, 80, 'out'),
    K({ ...crouchP, ...F(-3, CH - 1, LF + 2, RF - 2), torso: 21, bend: 8, head: -2, la: [68, 174], ra: [54, 168] }, 0, 'sine'),
  ] },
  // d+1: low jab from the crouch, the lead fist driving down at shin/knee height.
  lowJab: { blend: 40, limb: 'lHand', height: 'low', keys: [
    K({ ...crouchP, ...F(-2, CH - 1, LF + 2, RF - 2), torso: 16, la: [34, 150] }, 40, 'in'),
    K({ ...crouchP, ...F(3, CH - 1, LF + 2, RF - 2), torso: 24, bend: 8, tw: -6, la: [44, 80] }, 40, 'linear'),
    K({ ...crouchP, ...F(7, CH - 2, LF + 2, RF - 2), torso: 30, bend: 9, tw: -12, head: -14, la: [52, 54] }, 40, 'out', 'active'),
    K({ ...crouchP, ...F(7, CH - 2, LF + 2, RF - 2), torso: 30, bend: 9, tw: -12, head: -14, la: [53, 55] }, 40, 'inOut'),
    K({ ...crouchP, ...F(4, CH - 1, LF + 2, RF - 2), torso: 24, bend: 7, la: [50, 110] }, 80, 'inOut', 'recover'),
    K({ ...crouchP }, 80, 'out'),
    K({ ...crouchP }, 0, 'sine'),
  ] },
  // f+1: lead hook to the body: dip, the fist travels low and forward under the guard.
  bodyBlow: { blend: 40, limb: 'lHand', height: 'mid', keys: [
    K({ ...F(-2, HIP - 4, LF, RF), torso: 6, bend: 2, head: -2, tw: 6, la: [38, 150], ra: [30, 166] }, 40, 'in'),
    K({ ...F(3, HIP - 8, LF, RF), torso: 18, bend: 5, head: -6, tw: -4, la: [56, 100], ra: [30, 166] }, 40, 'linear'),
    K({ ...F(7, HIP - 10, LF, RF), torso: 26, bend: 7, head: -10, tw: -12, la: [74, 66], ra: [32, 164] }, 40, 'out', 'active'),
    K({ ...F(7, HIP - 10, LF, RF), torso: 26, bend: 7, head: -10, tw: -12, la: [75, 67], ra: [32, 164] }, 60, 'inOut'),
    K({ ...F(5, HIP - 7, LF, RF), torso: 18, bend: 4, head: -6, tw: -6, la: [60, 120], ra: [30, 166] }, 80, 'inOut', 'recover'),
    K({ ...F(1, HIP - 2, LF, RF), torso: 7, head: -4, la: [54, 148], ra: [28, 166] }, 80, 'out'),
    K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4 }, 0, 'sine'),
  ] },
  // rise+4: rising knee from the crouch, the rear knee driving up into the chest. Launcher.
  risingKnee: { blend: 40, limb: 'rKnee', height: 'mid', effect: 'launch', keys: [
    K({ ...crouchP, ...F(-2, CH, LF + 2, RF - 2), torso: 14 }, 40, 'in'),
    K({ hx: 6, ll: L(6, 50, LF), rl: [70, 150], torso: 4, bend: 2, head: -6, la: [20, 30], ra: [0, 10] }, 40, 'linear'),
    K({ hx: 14, ll: L(14, 57, LF), rl: [112, 172], torso: -12, bend: -4, head: -8, la: [6, -30], ra: [-12, -44], air: 4 }, 40, 'out', 'active'),
    K({ hx: 14, ll: L(14, 57, LF), rl: [114, 174], torso: -14, bend: -4, head: -8, la: [4, -32], ra: [-14, -46], air: 5 }, 60, 'inOut'),
    K({ hx: 8, ll: L(8, 54, LF), rl: [70, 20], torso: 0, head: -6, la: [30, 90], ra: [14, 100] }, 80, 'inOut', 'recover'),
    K({ ...F(2, HIP - 2, LF, RF, 0, 8), torso: 5, head: -4, la: [54, 148], ra: [28, 166] }, 80, 'out', 'footstep'),
    K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4 }, 0, 'sine'),
  ] },
  // f+4 / f+3+4: jumping axe kick. Sink, spring up with the rear leg swinging high, chop it down
  // through the opponent's chest while dropping, land on it ahead, step back. Beats a croucher.
  overhead: { blend: 40, limb: 'rFoot', height: 'mid', keys: [
    K({ ...F(-2, HIP - 9, LF, RF), torso: 16, bend: 4, head: 2, la: [20, 120], ra: [0, 100] }, 80, 'in'),
    K({ hx: 2, ll: [30, -60], rl: [130, 90], torso: -6, bend: -2, head: 8, la: [120, 150], ra: [100, 140], air: 22 }, 60, 'out'),
    K({ hx: 4, ll: [34, -70], rl: [168, 160], torso: -14, bend: -4, head: 12, la: [150, 170], ra: [130, 160], air: 36 }, 60, 'sine'),
    K({ hx: 9, ll: [30, -60], rl: [112, 108], torso: 10, bend: 5, head: 0, la: [70, 50], ra: [50, 34], air: 22 }, 40, 'in'),
    K({ hx: 10, ll: [26, -40], rl: [100, 96], torso: 20, bend: 8, head: -6, la: [50, 30], ra: [30, 20], air: 14 }, 40, 'out', 'active'),
    K({ hx: 11, ll: [24, -30], rl: [96, 93], torso: 22, bend: 8, head: -6, la: [48, 30], ra: [28, 20], air: 8 }, 40, 'in'),
    K({ ...F(12, HIP - 8, LF, 44), torso: 16, bend: 5, head: -4, la: [40, 100], ra: [24, 110] }, 80, 'out', 'land'),
    K({ ...F(10, HIP - 6, LF, 44), torso: 12, bend: 3, head: -4, la: [46, 130], ra: [26, 140] }, 60, 'inOut', 'recover'),
    K({ ...F(4, HIP - 3, LF, RF, 0, 10), torso: 7, head: -4, la: [52, 146], ra: [28, 160] }, 80, 'inOut'),
    K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4 }, 0, 'sine', 'footstep'),
  ] },
  // Neon Tornado (1,2,3,4 ender): a full 360 jump spin, the leg whipping out on the far side of the
  // turn. Launches.
  neonTornado: { blend: 40, limb: 'rFoot', height: 'mid', effect: 'launch', keys: [
    K({ ...F(-2, HIP - 7, LF, RF), torso: 12, bend: 3, head: 4, tw: 12, la: [60, 150], ra: [20, 150] }, 60, 'in'),
    K({ hx: 4, ll: L(4, 50, 14), rl: [20, -70], torso: 10, head: 4, spin: 90, la: [60, 120], ra: [40, 110] }, 50, 'linear'),
    K({ hx: 6, ll: [40, -50], rl: [70, -30], torso: 6, head: 0, spin: 180, la: [90, 120], ra: [70, 110], air: 18 }, 50, 'linear'),
    K({ hx: 8, ll: [36, -50], rl: [100, 60], torso: -10, head: 8, spin: 280, la: [110, 140], ra: [-60, -30], air: 28 }, 40, 'linear'),
    K({ hx: 10, ll: [30, -50], rl: [104, 100], torso: -26, bend: -4, head: 14, spin: 360, la: [-90, -60], ra: [-60, -20], air: 26 }, 40, 'out', 'active'),
    K({ hx: 10, ll: [28, -46], rl: [106, 102], torso: -28, bend: -4, head: 14, spin: 362, la: [-92, -62], ra: [-62, -22], air: 20 }, 50, 'inOut'),
    K({ hx: 10, ll: [26, -30], rl: [80, 30], torso: -10, head: 8, spin: 362, la: [-40, 20], ra: [-20, 40], air: 8 }, 60, 'in', 'recover'),
    K({ ...F(8, HIP - 8, LF, 36), torso: 12, bend: 4, head: -4, spin: 360, la: [40, 120], ra: [24, 120] }, 70, 'out', 'land'),
    K({ ...F(4, HIP - 3, LF, RF, 0, 10), torso: 8, head: -4, spin: 360, la: [52, 146], ra: [28, 160] }, 80, 'inOut'),
    K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4, spin: 360 }, 0, 'sine', 'footstep'),
  ] },
  // Throw (Wall Slam): both hands shoot out and grab, a beat of hold, then the body turns and heaves
  // the opponent past it. Unblockable; breaks on 1+3 / 2+4 (throwTech).
  wallSlam: { blend: 40, limb: 'lHand', height: 'throw', effect: 'splat', keys: [
    K({ ...F(-2, HIP - 4, LF, RF), torso: 8, head: -2, la: [50, 120], ra: [40, 120] }, 40, 'in'),
    K({ ...F(8, HIP - 6, LF + 8, RF, 8, 0), torso: 16, bend: 3, head: -6, la: [84, 92], ra: [76, 92] }, 50, 'out', 'active'),
    K({ ...F(10, HIP - 7, LF + 8, RF), torso: 18, bend: 4, head: -6, la: [86, 70], ra: [78, 70] }, 120, 'inOut'),
    K({ ...F(4, HIP - 9, LF + 8, RF), torso: -8, bend: -4, head: 6, tw: 20, la: [140, 120], ra: [120, 110] }, 80, 'in'),
    K({ ...F(10, HIP - 6, LF + 8, RF), torso: 24, bend: 6, head: -8, tw: -10, la: [50, 30], ra: [30, 20] }, 60, 'out', 'recover'),
    K({ ...F(6, HIP - 3, LF + 8, RF, 0, 8), torso: 10, head: -4, la: [50, 140], ra: [28, 156] }, 100, 'inOut'),
    K({ ...F(8, HIP - 1, LF + 8, RF + 8), torso: 6, head: -4 }, 0, 'sine', 'footstep'),
  ] },
  // Mid-stage throw: both hands grab, a beat of hold, then the thrower sinks, turns and heaves the
  // opponent up and over in front of him, arms following through high, and recovers.
  throw: { blend: 40, limb: 'lHand', height: 'throw', effect: 'knockdown', keys: [
    K({ ...F(-2, HIP - 4, LF, RF), torso: 8, head: -2, la: [50, 120], ra: [40, 120] }, 40, 'in'),
    K({ ...F(8, HIP - 6, LF + 8, RF, 8, 0), torso: 16, bend: 3, head: -6, la: [84, 92], ra: [76, 92] }, 40, 'out', 'active'),
    K({ ...F(9, HIP - 8, LF + 8, RF), torso: 18, bend: 4, head: -6, la: [86, 72], ra: [78, 72] }, 120, 'inOut'),
    K({ ...F(6, HIP - 12, LF + 8, RF), torso: 4, bend: -2, head: 0, la: [110, 120], ra: [100, 110] }, 80, 'in'),
    K({ ...F(10, HIP - 4, LF + 8, RF), torso: -10, bend: -6, head: 8, la: [170, 190], ra: [160, 180] }, 80, 'out', 'recover'),
    K({ ...F(8, HIP - 3, LF + 8, RF), torso: 4, bend: 0, head: -2, la: [90, 150], ra: [70, 150] }, 100, 'inOut'),
    K({ ...F(4, HIP - 2, LF + 8, RF + 8, 0, 8), torso: 6, head: -4, la: [54, 148], ra: [30, 160] }, 100, 'inOut'),
    K({ ...F(8, HIP - 1, LF + 8, RF + 8), torso: 6, head: -4 }, 0, 'sine', 'footstep'),
  ] },
  // Thrown: yanked forward by the grab, lifted, flipped over onto the back and slammed down, landing
  // in the knockdown rest pose so a getup follows exactly as after a knockdown.
  thrown: { blend: 30, keys: [
    K({ ...F(4, HIP - 2, LF, RF), torso: 14, bend: 6, head: 10, la: [60, 100], ra: [40, 90] }, 40, 'out'),
    K({ ...F(6, HIP - 4, LF, RF), torso: 18, bend: 8, head: 12, la: [70, 110], ra: [50, 100] }, 120, 'inOut'),
    K({ hx: -10, torso: -30, bend: -10, head: -20, la: [140, 180], ra: [120, 160], ll: [60, 20], rl: [40, 0], air: 30 }, 80, 'out'),
    K({ hx: -50, torso: -80, bend: -16, head: -10, la: [200, 240], ra: [180, 220], ll: [120, 80], rl: [100, 60], air: 46 }, 80, 'sine'),
    K({ hx: -90, torso: -100, bend: -12, head: 0, la: [220, 250], ra: [210, 240], ll: [140, 110], rl: [126, 90], air: 20 }, 60, 'in'),
    K({ hx: -118, torso: -94, bend: -10, head: 14, la: [-150, -112], ra: [80, 116], ll: [168, 124], rl: [158, 108], air: 0 }, 60, 'out', 'land'),
    K({ hx: -124, torso: -94, bend: -10, head: 12, la: [-140, -120], ra: [80, 120], ll: [176, 120], rl: [148, 70], air: 6 }, 60, 'out'),
    K({ hx: -128, torso: -91, bend: -2, head: 20, la: [-122, -100], ra: [90, 106], ll: [100, 78], rl: [142, 50], air: 0 }, 80, 'out'),
    K({ hx: -128, torso: -92, bend: -2, head: 20, la: [-120, -96], ra: [90, 104], ll: [98, 76], rl: [140, 50] }, 0, 'sine'),
  ] },
  // Throw break: both hands shove out, the body rocks back and steps out of range.
  throwTech: { blend: 30, shift: -14, keys: [
    K({ ...F(0, HIP - 3, LF, RF), torso: 4, head: -2, la: [70, 120], ra: [60, 120] }, 40, 'out'),
    K({ ...F(4, HIP - 4, LF, RF), torso: 10, head: -4, la: [88, 90], ra: [80, 90] }, 50, 'out'),
    K({ ...F(-6, HIP - 3, LF, RF - 14, 0, 10), torso: -6, head: -10, la: [60, 130], ra: [40, 130] }, 80, 'inOut'),
    K({ ...F(-12, HIP - 2, LF - 14, RF - 14, 10, 0), torso: 0, head: -6, la: [54, 146], ra: [30, 160] }, 80, 'inOut'),
    K({ ...F(-14, HIP - 1, LF - 14, RF - 14), torso: 6, head: -4 }, 0, 'sine', 'footstep'),
  ] },
  // Gassed: slumped, hands dropped, big slow breaths, hips low.
  gassed: { loop: true, blend: 200, keys: [
    K({ ...F(-1, HIP - 7, LF, RF), torso: 16, bend: 10, head: 14, tw: 2, la: [18, 40], ra: [8, 30] }, 550, 'sine'),
    K({ ...F(1, HIP - 4, LF, RF, 0, 2), torso: 10, bend: 4, head: 4, tw: -2, la: [22, 52], ra: [12, 40] }, 550, 'sine'),
  ] },
  // Faint (out of stamina): out on his feet. The guard is gone, the hips sway side to side and dip
  // on each swing, the torso folds forward and the head lolls. It loops until he comes to.
  dizzy: { loop: true, blend: 140, keys: [
    K({ ...F(-7, HIP - 10, LF, RF, 0, 3), torso: 24, bend: 14, head: 24, tw: 5, la: [8, 26], ra: [2, 20] }, 360, 'sine'),
    K({ ...F(0, HIP - 6, LF, RF), torso: 15, bend: 7, head: 8, tw: 0, la: [16, 42], ra: [8, 32] }, 360, 'sine'),
    K({ ...F(7, HIP - 11, LF, RF, 3, 0), torso: 22, bend: 14, head: 20, tw: -5, la: [12, 32], ra: [0, 18] }, 360, 'sine'),
    K({ ...F(0, HIP - 6, LF, RF), torso: 13, bend: 6, head: 4, tw: 0, la: [18, 44], ra: [10, 34] }, 360, 'sine'),
  ] },
  // A hit taken on the standing guard: the arms absorb it, the body rocks back a step's worth and
  // returns. And the same from the crouching guard.
  blockHit: { blend: 20, keys: [
    K({ ...F(-6, HIP - 5, LF, RF), torso: 2, bend: -4, head: -2, la: [66, 182], ra: [48, 174] }, 40, 'out'),
    K({ ...F(-5, HIP - 4, LF, RF), torso: 4, bend: -2, head: 0, la: [65, 180], ra: [46, 172] }, 80, 'inOut', 'recover'),
    K({ hx: -4, torso: 8, head: 4, la: [62, 178], ra: [44, 168], ll: [28, 20], rl: [-25, -18] }, 0, 'sine'),
  ] },
  crouchBlockHit: { blend: 20, keys: [
    K({ ...crouchP, ...F(-7, CH - 2, LF + 2, RF - 2), torso: 16, bend: 4, head: -6, la: [72, 178], ra: [58, 172] }, 40, 'out'),
    K({ ...crouchP, ...F(-4, CH - 1, LF + 2, RF - 2), torso: 20, bend: 7, head: -3, la: [70, 176], ra: [56, 170] }, 80, 'inOut', 'recover'),
    K({ ...crouchP, ...F(-3, CH - 1, LF + 2, RF - 2), torso: 21, bend: 8, head: -2, la: [68, 174], ra: [54, 168] }, 0, 'sine'),
  ] },
});
// ---- air attacks (v3b): they ride the jump's arc. The body keeps the jump's hip height over time
// (the move's own keys animate limbs and torso only), so striking mid-jump never breaks the arc.
// Their blends are long and linear (blendEase) with a short key before contact, the same time to
// contact as before: the sim shows an attack's first frame 50ms in, and an 'out' blend had all
// but finished by then, so the homing lunge arrived in one frame. update() goes further: the head
// travels evenly from the press to the moment the strike can hit (see its air-attack block).
const TUCK = { ll: [64, -54], rl: [50, -64] };
Object.assign(MOVE_DEFS, {
  jumpJab: { blend: 60, blendEase: 'linear', limb: 'lHand', air: true, keys: [
    K({ hx: 2, ...TUCK, torso: 8, bend: 2, head: -2, tw: 4, la: [60, 120], ra: [40, 130] }, 20, 'linear'),
    K({ hx: 6, ...TUCK, torso: 16, bend: 4, head: -6, tw: -10, la: [92, 92], ra: [40, 140] }, 40, 'out', 'active'),
    K({ hx: 6, ...TUCK, torso: 17, bend: 4, head: -6, tw: -11, la: [93, 92], ra: [40, 140] }, 40, 'inOut'),
    K({ hx: 4, ...TUCK, torso: 12, bend: 2, head: -4, tw: -4, la: [70, 120], ra: [50, 130] }, 100, 'inOut', 'recover'),
    K({ hx: 2, ...TUCK, torso: 8, head: -4, la: [80, 130], ra: [60, 120] }, 0, 'sine'),
  ] },
  jumpCross: { blend: 60, blendEase: 'linear', limb: 'rHand', air: true, keys: [
    K({ hx: 0, ...TUCK, torso: -4, bend: 2, head: 4, tw: -14, la: [40, 150], ra: [20, 170] }, 40, 'linear'),
    K({ hx: 6, ...TUCK, torso: 14, bend: 4, head: -4, tw: 2, la: [30, 150], ra: [70, 92] }, 40, 'linear'),
    K({ hx: 10, ...TUCK, torso: 28, bend: 6, head: -12, tw: 16, la: [20, 150], ra: [96, 95] }, 40, 'out', 'active'),
    K({ hx: 10, ...TUCK, torso: 29, bend: 6, head: -12, tw: 17, la: [20, 150], ra: [97, 96] }, 40, 'inOut'),
    K({ hx: 6, ...TUCK, torso: 16, bend: 3, head: -6, tw: 6, la: [40, 140], ra: [60, 120] }, 120, 'inOut', 'recover'),
    K({ hx: 2, ...TUCK, torso: 8, head: -4, la: [80, 130], ra: [60, 120] }, 0, 'sine'),
  ] },
  // 3: flying side kick: the lead leg shoots out dead straight, the rear knee tucks under, the torso
  // leans back away from it, arms flung back for balance. Long reach.
  flyingKick: { blend: 70, blendEase: 'linear', limb: 'lFoot', air: true, keys: [
    K({ hx: 0, ll: [110, -20], rl: [60, -70], torso: 4, bend: 2, head: 4, la: [60, 140], ra: [30, 150] }, 30, 'linear'),
    K({ hx: 8, ll: [94, 90], rl: [40, -96], torso: -22, bend: -6, head: 16, la: [-40, 0], ra: [-60, -20] }, 40, 'out', 'active'),
    K({ hx: 9, ll: [95, 92], rl: [40, -98], torso: -24, bend: -6, head: 16, la: [-42, -2], ra: [-62, -22] }, 80, 'inOut'),
    K({ hx: 6, ll: [100, 10], rl: [50, -80], torso: -8, bend: -2, head: 8, la: [20, 80], ra: [10, 70] }, 100, 'inOut', 'recover'),
    K({ hx: 2, ...TUCK, torso: 6, head: -2, la: [80, 130], ra: [60, 120] }, 0, 'sine'),
  ] },
  // 4: air roundhouse: the rear leg whips round at chest height, the body tipping back with it.
  airRoundhouse: { blend: 60, blendEase: 'linear', limb: 'rFoot', air: true, keys: [
    K({ hx: 0, ll: [60, -60], rl: [40, -80], torso: 12, bend: 4, head: 4, tw: -12, la: [60, 140], ra: [20, 130] }, 40, 'linear'),
    K({ hx: 4, ll: [50, -70], rl: [90, 30], torso: -12, bend: -4, head: 12, tw: 4, la: [90, 140], ra: [-60, -40] }, 40, 'linear'),
    K({ hx: 8, ll: [44, -76], rl: [102, 100], torso: -30, bend: -8, head: 18, tw: 16, la: [100, 156], ra: [-86, -76] }, 40, 'out', 'active'),
    K({ hx: 8, ll: [44, -76], rl: [104, 100], torso: -32, bend: -8, head: 18, tw: 18, la: [100, 158], ra: [-88, -78] }, 60, 'inOut'),
    K({ hx: 6, ll: [50, -66], rl: [90, 10], torso: -12, bend: -2, head: 8, tw: 6, la: [60, 140], ra: [-30, 20] }, 120, 'inOut', 'recover'),
    K({ hx: 2, ...TUCK, torso: 6, head: -2, la: [80, 130], ra: [60, 120] }, 0, 'sine'),
  ] },
  // down+4 in the air: the body tips forward and stomps down-forward with a straight rear leg,
  // dropping out of the jump fast (airRate speeds the rest of the arc).
  diveKick: { blend: 90, blendEase: 'linear', limb: 'rFoot', air: true, airRate: 2.4, keys: [
    K({ hx: 4, ll: [70, -46], rl: [64, -12], torso: 24, bend: 6, head: -4, la: [10, 80], ra: [-10, 70] }, 30, 'linear'),
    K({ hx: 10, ll: [70, -60], rl: [38, 34], torso: 30, bend: 8, head: -8, la: [-30, 0], ra: [-50, -10] }, 40, 'out', 'active'),
    K({ hx: 14, ll: [72, -62], rl: [38, 34], torso: 32, bend: 8, head: -8, la: [-32, -2], ra: [-52, -12] }, 160, 'linear'),
    K({ hx: 16, ll: [72, -62], rl: [40, 36], torso: 32, bend: 8, head: -8, la: [-32, -2], ra: [-52, -12] }, 80, 'linear', 'recover'),
    K({ hx: 16, ll: [72, -62], rl: [40, 36], torso: 30, bend: 8, head: -8, la: [-30, 0], ra: [-50, -10] }, 0, 'sine'),
  ] },
  // Landing lag after an air attack: a deep absorb, then guard.
  airLand: { blend: 100, blendEase: 'sine', keys: [
    K({ ...F(0, HIP - 14, LF, RF), torso: 22, bend: 6, head: -10, la: [40, 100], ra: [24, 100] }, 60, 'out', 'land'),
    K({ ...F(0, HIP - 10, LF, RF), torso: 16, bend: 4, head: -8, la: [44, 120], ra: [26, 130] }, 80, 'inOut'),
    K({ ...F(0, HIP - 3, LF, RF), torso: 7, head: -4, la: [54, 148], ra: [28, 164] }, 80, 'out', 'recover'),
    K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4 }, 0, 'sine'),
  ] },
});
// ---- wake-up strikes: from the knockdown rest pose (lying on the back, feet toward the facing), the body
// springs forward along the floor behind a kick (the hip scoots up to 40px: a lying body's feet are well
// short of anyone standing at its feet), then rocks forward onto its feet through the getup's own stand-up
// keys, moved along by the scoot and played a little faster. `stand` marks the first stand-up key (the sim
// treats the body as lying until then), and `shift` puts the root where the body stands, like the getup.
const REST = { hx: -128, torso: -92, bend: -2, head: 20, la: [-120, -96], ra: [90, 104], ll: [98, 76], rl: [140, 50] };
function standUp(fromHx, rate) {
  const g = MOVE_DEFS.getup.keys, from = g.findIndex(k => k.p.torso === 18), d = fromHx - g[from].p.hx;
  return g.slice(from).map((k, i) => ({ ...k, d: Math.round(k.d * rate), ev: i === 0 ? 'stand' : k.ev === 'recover' ? null : k.ev, p: { ...k.p, hx: k.p.hx + d } }));
}
function wakeClip(lead, keys, standHx) {
  const up = standUp(standHx, 0.62);
  const last = up[up.length - 1].p.hx;
  return { blend: 20, limb: lead, adapt: 'none', shift: last, keys: [...keys.map(k => ({ ...k, p: P({ ...REST, ...k.p0 }) })), ...up] };
}
const WK = (p0, d, ease, ev = null) => ({ p0, d, ease, ev });
Object.assign(MOVE_DEFS, {
  // 1 or 3 from the floor: the knees curl to the chest, then the body springs forward and up onto the
  // shoulders behind the rear leg, a straight kick rising through the shins and knees of anyone standing
  // over the feet. Mid. Contact about 10 frames after the press.
  wakeKick: wakeClip('rFoot', [
    WK({ hx: -131, torso: -104, bend: -6, head: 26, ll: [146, 70], rl: [168, 80], la: [-150, -120], ra: [-130, -100] }, 120, 'in'),
    WK({ hx: -100, torso: -78, bend: 4, head: 20, ll: [112, 70], rl: [136, 118], la: [-110, -80], ra: [-100, -70] }, 60, 'linear'),
    WK({ hx: -72, torso: -58, bend: 8, head: 16, ll: [96, 64], rl: [114, 112], la: [-80, -60], ra: [-70, -40] }, 40, 'out', 'active'),
    WK({ hx: -70, torso: -56, bend: 8, head: 16, ll: [96, 64], rl: [115, 113], la: [-80, -60], ra: [-70, -40] }, 70, 'inOut'),
    WK({ hx: -72, torso: -40, bend: 10, head: 18, ll: [104, 30], rl: [96, 20], la: [-60, -40], ra: [-50, -30] }, 90, 'out', 'recover'),
    WK({ hx: -72, torso: -12, head: 14, la: [-36, -16], ra: [56, 60], ll: [80, -66], rl: [72, -74] }, 70, 'out'),
  ], -72),
  // 2 or 4 (or down and any button) from the floor: he rolls onto his hip, propped on an elbow, and the
  // lead leg scythes out flat along the floor at ankle height. Low. Slower than the kick, and longer.
  wakeSweep: wakeClip('lFoot', [
    WK({ hx: -126, torso: -76, bend: 6, head: 22, ll: [136, 40], rl: [120, 30], la: [-96, -70], ra: [-150, -150] }, 150, 'in'),
    WK({ hx: -104, torso: -62, bend: 8, head: 18, ll: [104, 70], rl: [100, 20], la: [-80, -60], ra: [-130, -130] }, 60, 'linear'),
    WK({ hx: -80, torso: -54, bend: 10, head: 16, ll: [93, 92], rl: [86, 0], la: [-70, -50], ra: [-120, -120] }, 40, 'out', 'active'),
    WK({ hx: -78, torso: -52, bend: 10, head: 16, ll: [93, 92], rl: [86, 0], la: [-70, -50], ra: [-120, -120] }, 80, 'inOut'),
    WK({ hx: -80, torso: -34, bend: 8, head: 16, ll: [116, -10], rl: [100, -20], la: [-50, -30], ra: [-40, -20] }, 90, 'out', 'recover'),
    WK({ hx: -80, torso: -12, head: 14, la: [-36, -16], ra: [56, 60], ll: [80, -66], rl: [72, -74] }, 70, 'out'),
  ], -80),
});
// Air recovery: out of a juggle the body snaps into a tuck (knees to the chest, arms wrapped), rolls upright
// and opens into the jump's falling pose, feet under it, and holds there until the sim lands it (airLand).
MOVE_DEFS.airTech = { blend: 50, blendEase: 'out', keys: [
  K({ hx: -2, torso: 46, bend: 12, head: 14, ll: [120, -10], rl: [110, -20], la: [110, 30], ra: [90, 20], air: 4 }, 70, 'out'),
  K({ hx: 2, torso: 18, bend: 4, head: -2, ll: [70, -40], rl: [56, -56], la: [130, 160], ra: [110, 150], air: 4 }, 80, 'out'),
  K({ hx: 4, torso: 10, head: -4, ll: [24, 4], rl: [-10, -16], la: [110, 120], ra: [90, 100], air: 0 }, 90, 'out'),
  K({ hx: 4, torso: 8, head: -4, ll: [22, 2], rl: [-10, -14], la: [100, 120], ra: [84, 100], air: 0 }, 0, 'sine'),
] };
// Stomp (down and a kick over a body on the floor): the rear knee comes up to the chest, then the heel
// drives down onto the body as he steps through, the weight following it down; it sticks there a beat (the
// sim pins the body under it) and the leg has to come back out before he's guarding again. A long recovery
// on purpose: a body that rises through it with a wake-up strike gets a free hit.
Object.assign(MOVE_DEFS, {
  stomp: { blend: 40, limb: 'rFoot', adapt: 'none', keys: [
    K({ ll: L(2, HIP, LF), hx: 2, rl: [70, -10], torso: 2, head: -4, la: [40, 140], ra: [10, 90] }, 70, 'in'),
    K({ hx: 6, ll: L(6, HIP + 3, LF), rl: [112, 20], torso: -8, bend: -4, head: 4, la: [70, 170], ra: [-20, 60] }, 70, 'out'),
    K({ hx: 18, ll: L(18, HIP - 2, LF), rl: [92, 40], torso: 6, bend: 2, head: -2, la: [60, 130], ra: [10, 50] }, 40, 'linear'),
    K({ ...F(30, 44, LF, 72), torso: 22, bend: 6, head: -10, la: [20, 70], ra: [-40, -10] }, 40, 'out', 'active'),
    K({ ...F(31, 43, LF, 72), torso: 24, bend: 7, head: -10, la: [18, 66], ra: [-42, -12] }, 60, 'inOut'),
    K({ ...F(30, 44, LF, 72), torso: 22, bend: 6, head: -8, la: [24, 80], ra: [-36, 0] }, 100, 'in', 'recover'),
    K({ ...F(16, 50, LF, 44, 0, 14), torso: 12, bend: 3, head: -6, la: [40, 120], ra: [0, 60] }, 90, 'out'),
    K({ ...F(4, HIP - 1, LF, RF, 0, 8), torso: 7, head: -4, la: [52, 144], ra: [28, 160] }, 90, 'inOut', 'footstep'),
    K({}, 0, 'sine'),
  ] },
});
// Lows stay crouched: the low kick is thrown from the crouch (rear foot planted, lead leg whipping
// along the floor) and both it and the sweep end back in the crouch pose, so d+1, d+1, d+3 chains.
MOVE_DEFS.lowKick = { blend: 40, limb: 'lFoot', keys: [
  K({ ...crouchP, hx: -3, rl: L(-3, CH, RF - 2), ll: [40, -40], torso: 20 }, 60, 'in'),
  K({ ...crouchP, hx: 2, rl: L(2, CH, RF - 2), ll: [70, -10], torso: 14, head: -4 }, 40, 'linear'),
  K({ ...crouchP, hx: 10, rl: L(10, CH, RF - 2), ll: [76, 84], torso: 8, bend: 2, head: -2, la: [30, 160], ra: [16, 166] }, 40, 'out', 'active'),
  K({ ...crouchP, hx: 10, rl: L(10, CH, RF - 2), ll: [77, 85], torso: 8, bend: 2, head: -2, la: [30, 160], ra: [16, 166] }, 60, 'inOut'),
  K({ ...crouchP, hx: 6, rl: L(6, CH, RF - 2), ll: [70, 0], torso: 14, la: [34, 160] }, 60, 'inOut', 'recover'),
  K({ ...crouchP, ...F(2, CH, LF + 2, RF - 2, 6, 0) }, 60, 'inOut'),
  K({ ...crouchP }, 0, 'sine', 'footstep'),
] };
{ const sw = MOVE_DEFS.sweep.keys; sw[sw.length - 2] = K({ ...crouchP, ...F(2, CH + 2, LF + 2, RF - 2, 0, 6), torso: 20 }, 90, 'out'); sw[sw.length - 1] = K({ ...crouchP }, 0, 'sine'); }

// Variants built from existing moves.
MOVE_DEFS.risingUppercut = { ...MOVE_DEFS.uppercut, keys: [K({ ...crouchP, ...F(-2, CH - 2, LF + 2, RF - 2), torso: 18, ra: [-10, 20] }, 60, 'in'), ...deepKeys(MOVE_DEFS.uppercut).slice(1)] };
MOVE_DEFS.spinHeel = { ...MOVE_DEFS.spinKick, keys: deepKeys(MOVE_DEFS.spinKick).map(k => k.ev === 'active' ? { ...k, p: { ...k.p, rl: [-108, -104], torso: 56 } } : k) };
{ const sh = MOVE_DEFS.spinHeel.keys, ai = sh.findIndex(k => k.ev === 'active'); sh[ai + 1] = { ...sh[ai + 1], p: { ...sh[ai + 1].p, rl: [-109, -105], torso: 57 } }; }
MOVE_DEFS.crescent = { ...MOVE_DEFS.roundhouse, adapt: 'kick', keys: deepKeys(MOVE_DEFS.roundhouse).map((k, i, a) => {
  const ai = a.findIndex(kk => kk.ev === 'active');
  if (i === ai - 2) return { ...k, p: { ...k.p, rl: [130, 150], torso: -20 } };      // leg rises outside, high
  if (i === ai - 1) return { ...k, p: { ...k.p, rl: [124, 128], torso: -30 } };
  if (i === ai + 1) return { ...k, p: { ...k.p, rl: [80, 70], torso: -36 } };        // sweeps down across
  return k;
}) };
MOVE_DEFS.cometCross = { ...adapted({ ...MOVE_DEFS.lungeCross, adapt: 'step' }, 30), blend: 40 };

// ---- botches (src/combat/botch.js) ------------------------------------------------------------
// A press thrown in the middle of another strike tangles the body up. The sim works out the forces
// (which limb was swinging, how fast the hips were going, which way the body was turning, which limb
// the new press wanted and where) and asks for one of these clips with play('botch', { botch }) or,
// for the flail, play('flail', { botch }). Each is built on the spot from those numbers and from the
// pose the body is in, and play() blends into it from that pose carried forward by its momentum, so no
// two look quite alike. The sim keeps the root still and takes the travel (`shift`) when it ends, like
// the cross's step. Everything is in body space: x forward, angles from straight down, forward positive.
//   b.kind   'over' (overbalance: lurches forward, catches himself with two steps), 'spin' (the turn
//            carries him round until his back is to the opponent, then back), 'trip' (the feet cross and
//            he pitches over: the sim hands the body to the point simulation when this ends), 'whiff' (the
//            new limb shoots out half-formed and hangs there)
//   b.sev    1..3, how hard; b.d px of travel; b.limb the new press's limb, b.cur the one that was out;
//   b.alt    0..3, a little variety; b.rot +1/-1 which way the body was turning; b.fwd (trip) falling forward
//   b.anim   (whiff) the new move's clip, whose contact pose the limb only half reaches
const lerpN = (a, b2, t) => a + (b2 - a) * t;
function makeBotch(b, cur) {
  const sev = Math.max(1, Math.min(3, b.sev || 1)), alt = b.alt || 0, d = b.d || 0;
  const hand = !b.limb || /Hand/.test(b.limb), lead = !b.limb || b.limb[0] === 'l';
  const wob = (alt % 2 ? 1 : -1) * (4 + 3 * alt);   // which way the arms windmill, and how wide
  if (b.kind === 'over') {
    // the new limb thrown off-balance: an arm half out and low, the other flung back; a kick's foot
    // reaching forward while both arms go up for balance
    const thrown = [58 + wob * 0.5, 74], back = [-48 - wob, -18];
    const arms = hand ? (lead ? { la: thrown, ra: back } : { la: back, ra: thrown }) : { la: [130 + wob, 160], ra: [-40, -10] };
    const lean = 32 + 6 * sev + Math.max(0, Math.min(10, (cur.torso || 0) * 0.3));
    return { blend: 50, blendEase: 'out', shift: d, keys: [
      K({ ...F(d * 0.15, HIP - 6, LF, RF, 0, 6), ...(hand ? {} : lead ? { ll: [62, 30] } : { rl: [58, 26] }), torso: lean, bend: 8, head: -20, tw: lead ? -10 : 10, ...arms }, 70, 'out'),
      K({ ...F(d * 0.3, HIP - 9, LF, RF + d * 0.5, 0, 12), torso: lean - 2, bend: 7, head: -18, tw: 4, la: [96 + wob, 132], ra: [-58, -30] }, 70, 'linear'),
      K({ ...F(d * 0.45, HIP - 12, LF, RF + d), torso: lean - 6, bend: 6, head: -14, la: [150 + wob, 170], ra: [-30, 10] }, 70, 'out', 'footstep'),
      K({ ...F(d * 0.65, HIP - 10, LF + d * 0.5, RF + d, 12, 0), torso: lean - 12, bend: 4, head: -10, la: [60, 100], ra: [100 - wob, 140] }, 80, 'linear'),
      K({ ...F(d * 0.85, HIP - 9, LF + d, RF + d), torso: lean - 18, bend: 3, head: -8, la: [20, 70], ra: [150 - wob, 160] }, 70, 'out', 'footstep'),
      K({ ...F(d, HIP - 6, LF + d, RF + d), torso: 16, bend: 2, head: -6, tw: -4, la: [76 + wob, 120], ra: [96, 130] }, 140 + 40 * sev, 'sine'),
      K({ ...F(d, HIP - 1, LF + d, RF + d), torso: 6, bend: 0, head: -4, la: [55, 150], ra: [30, 164] }, 120, 'out'),
      K({ ...F(d, HIP - 1, LF + d, RF + d), torso: 6, head: -3 }, 0, 'sine'),
    ] };
  }
  if (b.kind === 'spin') {
    // pivot on the lead foot; the turn the strike started keeps going past the opponent until the back
    // is to him (spin 180 mirrors the figure about the hip), a stooped beat, then round the rest of the way
    const s = 1;   // the spin field reads the same either way round (solve() uses its cosine)
    const hold = 120 + 60 * sev;
    return { blend: 40, shift: d, keys: [
      K({ hx: 4, ll: L(4, 52, LF), rl: [16, -36], torso: 12, bend: 2, head: 4, tw: (b.rot || 1) * 14, spin: 40 * s, la: [70 + wob, 110], ra: [-30, 20] }, 60, 'in'),
      K({ hx: 6, ll: L(6, 51, LF), rl: [-34, -60], torso: 18, bend: 3, head: -6, spin: 125 * s, la: [104 + wob, 124], ra: [-64, -34] }, 80, 'out'),
      K({ ...F(d * 0.6, HIP - 8, LF, RF + d), torso: 20, bend: 4, head: 8, spin: 205 * s, la: [40, 60], ra: [-20, 10] }, 70, 'out', 'footstep'),
      K({ ...F(d, HIP - 7, LF + d, RF + d), torso: 24, bend: 6, head: 16, spin: 180 * s, la: [14 + wob * 0.5, 24], ra: [-6, 6] }, hold, 'sine'),
      K({ ...F(d, HIP - 3, LF + d, RF + d, 0, 6), torso: 12, bend: 2, head: 0, spin: 300 * s, la: [46, 120], ra: [24, 130] }, 110, 'inOut'),
      K({ ...F(d, HIP - 1, LF + d, RF + d), torso: 6, head: -4, spin: 360 * s, la: [55, 150], ra: [30, 164] }, 90, 'out'),
      K({ ...F(d, HIP - 1, LF + d, RF + d), torso: 6, head: -3, spin: 360 * s }, 0, 'sine'),
    ] };
  }
  if (b.kind === 'trip') {
    // the feet cross (the swinging foot hooks behind or in front of the standing one) and the hips drop
    // over them; arms thrown up. The sim launches the body from the last key
    const f = b.fwd ? 1 : -1;
    return { blend: 40, keys: [
      K({ ...F(4 * f, HIP - 6, LF - 2, LF + 6 * f, 0, 10), torso: 26 * f + 6, bend: 6 * f, head: -18 * f, la: [150 + wob, 170], ra: [-50, -20] }, 60, 'out'),
      K({ ...F(10 * f, HIP - 15, LF + 12 * f, LF + 2, 16, 0), torso: 44 * f + 4, bend: 10 * f, head: -24 * f, la: [172, 192], ra: [96 - wob, 140] }, 70, 'in'),
      K({ ...F(10 * f, HIP - 15, LF + 12 * f, LF + 2, 16, 0), torso: 44 * f + 4, bend: 10 * f, head: -24 * f, la: [172, 192], ra: [96 - wob, 140] }, 0, 'sine'),
    ] };
  }
  // whiff: the new limb gets about 60% of the way to its contact pose with the far segment lagging (an
  // elbow or knee still bent), the body follows it past where it should stop, and it hangs there
  const nd = MOVE_DEFS[b.anim] || MOVE_DEFS.jab, ai = Math.max(0, nd.keys.findIndex(k => k.ev === 'active')), ap = nd.keys[ai].p;
  const lk = !b.limb ? 'la' : b.limb === 'lHand' ? 'la' : b.limb === 'rHand' ? 'ra' : b.limb[0] === 'l' ? 'll' : 'rl';
  const c0 = { ...STANCE, ...cur };
  const half = { ...P({}), torso: lerpN(c0.torso, ap.torso, 0.6), bend: lerpN(c0.bend, ap.bend, 0.6), head: lerpN(c0.head, ap.head, 0.6), tw: lerpN(c0.tw, ap.tw, 0.6),
    hx: lerpN(c0.hx, ap.hx, 0.6), la: [lerpN(c0.la[0], ap.la[0], 0.5), lerpN(c0.la[1], ap.la[1], 0.5)], ra: [lerpN(c0.ra[0], ap.ra[0], 0.5), lerpN(c0.ra[1], ap.ra[1], 0.5)],
    ll: [lerpN(c0.ll[0], ap.ll[0], 0.6), lerpN(c0.ll[1], ap.ll[1], 0.6)], rl: [lerpN(c0.rl[0], ap.rl[0], 0.6), lerpN(c0.rl[1], ap.rl[1], 0.6)] };
  const reach = [ap[lk][0] * 0.8 + c0[lk][0] * 0.2, ap[lk][0] * 0.8 + c0[lk][0] * 0.2 - 38 - 4 * alt];
  half[lk] = reach;
  const kick = lk === 'll' || lk === 'rl', dir = kick ? -1 : 1;   // a kick throws the body back over the standing leg, a punch forward
  const over = { ...half, hx: half.hx + 6, torso: half.torso + 12 * dir, bend: half.bend + 4 * dir, [lk]: [reach[0] + 10, reach[1] - 14] };
  const sag = { ...P(F(4, HIP - 8, LF + 4, RF)), torso: 14 + (kick ? -6 : 10), bend: 4, head: 8, tw: half.tw * 0.5, la: half.la, ra: half.ra };
  if (!kick) sag[lk] = [reach[0] - 34, reach[1] - 50];
  return { blend: 30, blendEase: 'out', keys: [
    { p: half, d: 70, ease: 'out', ev: null },
    { p: over, d: 90, ease: 'linear', ev: null },
    { p: sag, d: 150 + 60 * sev, ease: 'sine', ev: kick ? 'footstep' : null },
    K({ ...F(2, HIP - 4, LF + 2, RF), torso: 10, bend: 2, head: 2, la: [44, 120], ra: [24, 130] }, 140, 'inOut'),
    K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -3 }, 0, 'sine'),
  ] };
}
// The flail: both arms thrown up and back as the balance goes, then a wild overhand with the rear arm
// that drags the body over, and a backhand on the way back up (two weak hits, frame data `flail`), then
// he hangs there hunched and blowing. The timing is fixed (the sim's frame data and the CPU's reach are
// measured off it); b.alt only changes how wide the arms go and which way the body leans into it.
function makeFlail(b) {
  const a = (b && b.alt) || 0, w = (a % 2 ? 1 : -1) * (5 + 3 * a), lean = (b && b.sev ? b.sev : 1) * 3;
  return { blend: 30, limb: 'rHand', keys: [
    K({ ...F(-4, HIP - 4, LF, RF), torso: -8 - lean, bend: -4, head: 8, tw: -10, la: [130 + w, 160], ra: [150 - w, 176] }, 60, 'in'),
    K({ ...F(6, HIP - 7, LF, RF, 0, 4), torso: 22 + lean, bend: 6, head: -10, tw: 12, la: [-40 + w, -10], ra: [86, 112] }, 50, 'out', 'active'),
    K({ ...F(8, HIP - 9, LF, RF, 0, 6), torso: 30 + lean, bend: 8, head: -6, tw: 10, la: [40, 84 + w], ra: [30 + w, 58] }, 70, 'linear'),
    K({ ...F(4, HIP - 6, LF, RF), torso: 14, bend: 2, head: -8, tw: -12, la: [140 - w, 168], ra: [96, 72] }, 50, 'out', 'active'),
    K({ ...F(3, HIP - 9, LF, RF), torso: 28 + lean, bend: 8, head: 12, tw: -2, la: [8, 16], ra: [12 + w * 0.5, 10] }, 80, 'inOut', 'recover'),
    K({ ...F(2, HIP - 8, LF, RF, 0, 5), torso: 22, bend: 6, head: 10, la: [4, 12], ra: [8, 6] }, 200, 'sine'),
    K({ ...F(0, HIP - 2, LF, RF), torso: 8, head: -2, la: [46, 130], ra: [26, 140] }, 120, 'out'),
    K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -3 }, 0, 'sine'),
  ] };
}
MOVE_DEFS.botch = makeBotch({ kind: 'over', d: 30 }, STANCE);   // a default, so the sim knows the clip (play() builds the real one)
MOVE_DEFS.flail = makeFlail({});
// Heights and pay-offs (v2 spec). effect: what a clean hit does to the defender.
const META = {
  jab: ['high'], cross: ['high'], lkick: ['mid'], roundhouse: ['high', 'knockdown'], lowJab: ['low'], uppercut: ['mid', 'launch'],
  lowKick: ['low'], sweep: ['low', 'knockdown'], lungeCross: ['mid'], spinKick: ['high', 'splat'], bodyBlow: ['mid'], risingKnee: ['mid', 'launch'],
  overhead: ['mid'], risingUppercut: ['mid', 'launch'], crescent: ['mid', 'knockdown'], neonTornado: ['mid', 'launch'], spinHeel: ['high', 'splat'],
  cometCross: ['mid', 'splat'], wallSlam: ['throw', 'splat'], throw: ['throw', 'knockdown'],
  jumpJab: ['mid'], jumpCross: ['mid'], flyingKick: ['mid'], airRoundhouse: ['mid', 'knockdown'], diveKick: ['mid'],
  wakeKick: ['mid', 'knockdown'], wakeSweep: ['low', 'knockdown'], stomp: ['low'],
};
for (const n in META) { MOVE_DEFS[n].height = META[n][0]; MOVE_DEFS[n].effect = META[n][1] || null; }
// Every strike can retarget its reach (play(name, { reach }) / { target }): punches lean, kicks
// ride the hips, the jumping kicks shift in the air, the cross family steps.
for (const n in MOVE_DEFS) {
  const m = MOVE_DEFS[n];
  if (!m.limb || m.adapt) continue;
  m.adapt = m.air ? 'air' : m.limb.endsWith('Hand') ? 'pinned' : (n === 'overhead' || n === 'neonTornado') ? 'air' : 'kick';
}
MOVE_DEFS.lungeCross.adapt = 'step';

export const MOVES = Object.keys(MOVE_DEFS);
const halfMs = m => m.keys.reduce((s, k) => s + k.d, 0) / 2;
// Extra per-move data the combat module may want: loop, speed (px/s for walk/run),
// limb (the joint that carries the hitbox), duration (ms, excluding blend-in).
function moveDataOf(n) {
  const m = MOVE_DEFS[n];
  const d = { loop: !!m.loop, speed: m.speed || 0, shift: m.shift || 0, limb: m.limb || null, blend: m.blend || 0, duration: m.keys.reduce((s, k) => s + k.d, 0) };
  if (m.limb) {
    // side: 'L' = l* limbs (lead in guard), 'R' = r* limbs (rear). height: where the tip lands.
    d.side = m.limb[0] === 'l' ? 'L' : 'R';
    d.height = m.height || 'mid';
    d.effect = m.effect || null;   // 'launch' | 'knockdown' | 'splat' | null
    d.air = !!m.air;               // plays on top of the jump arc
    d.overhead = !!m.air || n === 'overhead' || !!m.overhead;   // hits crouchers, must be guarded standing
    // Cancel window, ms from the first key (after the blend): from the 'recover' key until the
    // last 80ms, another strike may start and blends out of the recovery pose directly.
    const ri = m.keys.findIndex(k => k.ev === 'recover');
    const t0 = m.keys.slice(0, ri).reduce((s2, k) => s2 + k.d, 0);
    d.cancel = [t0, Math.max(t0 + 80, d.duration - 80)];
    // ms of keys skipped when the move is started with { chain: true } (it then blends in over 40ms).
    const ai = m.keys.findIndex(k => k.ev === 'active'), from = Math.max(0, m.chainFrom != null ? m.chainFrom : ai - 2);
    d.chainSkip = m.keys.slice(0, from).reduce((s2, k) => s2 + k.d, 0);
    d.activeAt = m.keys.slice(0, ai).reduce((s2, k) => s2 + k.d, 0);   // ms from the first key to contact
  }
  // Cyclic moves: stride is the ground covered per step (px), cadence is steps per second, so
  // speed = stride * cadence exactly and a planted foot never skates at that speed.
  if (m.loop && m.speed) { d.stride = m.speed * halfMs(m) / 1000; d.cadence = 1000 / halfMs(m); }
  return d;
}
export const MOVE_DATA = Object.fromEntries(MOVES.map(n => [n, moveDataOf(n)]));

const LIMBS = ['la', 'ra', 'll', 'rl'];
const SCALARS = ['hx', 'torso', 'bend', 'head', 'tw', 'air', 'spin'];
const lerp = (a, b, t) => a + (b - a) * t;
function lerpPose(a, b, t) {
  const o = {};
  for (const k of SCALARS) o[k] = lerp(a[k], b[k], t);
  for (const k of LIMBS) o[k] = [lerp(a[k][0], b[k][0], t), lerp(a[k][1], b[k][1], t)];
  if (a.ext || b.ext) o.ext = lerp(a.ext || 0, b.ext || 0, t);   // ext: px a held object reaches past the striking hand (hitboxes.js; a pose without it has none)
  return o;
}
const clonePose = p => lerpPose(p, p, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function poseVel(a, b, dt) {
  const o = {};
  for (const k of SCALARS) o[k] = (b[k] - a[k]) / dt;
  for (const k of LIMBS) o[k] = [(b[k][0] - a[k][0]) / dt, (b[k][1] - a[k][1]) / dt];
  return o;
}
// Pose of a key list at t ms from its first key.
function samplePose(keys, t) {
  for (let i = 0; i < keys.length - 1; i++) {
    if (t < keys[i].d) return lerpPose(keys[i].p, keys[i + 1].p, EASE[keys[i].ease](t / keys[i].d));
    t -= keys[i].d;
  }
  return keys[keys.length - 1].p;
}
// The jump as an air attack's arc: a key's arcEase (if any) in place of its drawn ease.
const arcKeys = ks => (ks.some(k => k.arcEase) ? ks.map(k => (k.arcEase ? { ...k, ease: k.arcEase } : k)) : ks);
const JUMP_ARC = arcKeys(MOVE_DEFS.jump.keys);
// The head's offset from the hip in a pose (pose units, x forward, y up), the way solve() builds it.
// R: the fighter's segment lengths (a character's body, src/characters/), lean: its extra torso pitch.
function headRel(p, R = RIG, lean = 0) {
  const t0 = lean ? p.torso + lean : p.torso;
  const a1 = t0 * DEG, a2 = (t0 + p.bend) * DEG, a3 = (t0 + p.bend + p.head) * DEG, hl = R.neck + R.headR;
  return { x: dm.sin(a1) * R.lowerTorso + dm.sin(a2) * R.upperTorso + dm.sin(a3) * hl,
    y: dm.cos(a1) * R.lowerTorso + dm.cos(a2) * R.upperTorso + dm.cos(a3) * hl };
}

// body (a character's proportions, src/characters/): { scale, headR, upperArm, lowerArm, upperLeg, lowerLeg,
// lowerTorso, upperTorso, limbW, limbTip, torsoW, hipW, lean (deg of extra forward pitch), stance (deg the
// legs spread apart) } plus accessory: (ctx, joints, info) => void, drawn over the head in the body's light.
// Missing fields keep the baseline rig's, so TEMP (no body) draws and moves exactly as before.
export function createFighter({ color = '#111', x = 0, y = 640, facing = 1, scale = 1, body = null } = {}) {
  let R = RIG, lean = 0, stance = 0, accessory = null;
  const f = {
    color, x, y, facing, scale,
    radius: RIG.headR * scale,
    joints: {},
    events: [],
    current: { move: 'idle', t: 0, frame: 0, done: false },
    pose: clonePose(STANCE),
    speedLines: true,
    airborne: false,       // true while the point simulation drives the body
    walls: null,           // [leftX, rightX] world walls for the point simulation (combat sets it)
    treads: null,          // [{x0, x1, y}] one-way surfaces from above (stair treads, floor slabs) for falling bodies
    slopes: null,          // [{x0, x1, y0, y1}] solid ground lines over the floor plane (a flight of stairs): nothing goes below them
    floorY: null,          // ground plane for the point simulation when it differs from f.y (a lower floor)
    play, update, draw, react, launch, wallSplat, groundBounce, reset,
  };
  f._solve = p => solve(p);
  // A character's body: proportions, scale, lean, stance and accessory (null: the baseline rig). The sim
  // sizes hitboxes and the drawn silhouette from f.scale and f.shape (1 at the baseline).
  function setBody(b, opt = {}) {
    const bb = b || {};
    R = { ...RIG };
    for (const k in RIG) if (typeof bb[k] === 'number') R[k] = bb[k];
    lean = bb.lean || 0; stance = bb.stance || 0; accessory = typeof bb.accessory === 'function' ? bb.accessory : null;
    f.scale = typeof bb.scale === 'number' ? bb.scale : (opt.scale || 1);
    f.radius = R.headR * f.scale;
    f.body = b || null; f.accent = opt.accent || null;
    // drawn widths relative to the baseline, for the sim's contact and hit radii
    f.shape = { limb: f.scale * R.limbW / RIG.limbW, tip: f.scale * R.limbTip / RIG.limbTip, torso: f.scale * R.torsoW / RIG.torsoW };
    // how much ground one walk or run cycle covers relative to the baseline (scale and leg length)
    f.stride = f.scale * (R.upperLeg + R.lowerLeg) / (RIG.upperLeg + RIG.lowerLeg);
    f.joints = {};
    if (move) { f.joints = solve(f.pose); }
  }
  f.setBody = setBody;

  let move = null;       // MOVE_DEFS entry
  let keys = [];         // keyframes incl. the blend-in from the previous pose
  let ki = 0, kt = 0;    // index into keys, ms elapsed inside that segment
  let shifted = false;   // a 'shift' move has already moved the root
  let dropped = false;   // a 'drop' move has already moved the ground line
  let prevJoints = null;
  let strikeTimer = 0;   // ms left to draw speed lines on the strike limb
  let strikeDir = null;  // unit vector of the strike, locked when 'active' fires
  // ---- procedural layer state
  let vel = null, lastBase = null;   // pose channel velocities (per second), for velocity-matched blends
  let reactL = null;                 // additive hit-reaction layer
  const springs = {};                // secondary motion on head, hands and feet
  let rag = null;                    // point simulation while airborne / splatted / bouncing
  let fadeFrom = null, fadeT = 0;    // world-space crossfade from the simulation back to keyframes
  let limbHot = false;               // the strike limb is between start and 'recover': no spring lag on it
  let airTrack = null;               // the jump arc an air attack rides: { keys, t, landAt }
  let landEase = null;               // lowering the hip onto the floor at the end of an air attack
  let lastHipLock = null;

  // Apply a travelling move's root shift now (world pose unchanged). play() does this when it
  // cancels such a move; callers can do it first to measure distances from the new root.
  function commitShift() {
    if (!(move && move.shift && !shifted && !f.current.done)) return;
    shifted = true;
    f.x += move.shift * f.facing * f.scale;
    f.pose = { ...f.pose, hx: f.pose.hx - move.shift };
    keys = keys.map(k => ({ ...k, p: { ...k.p, hx: k.p.hx - move.shift } }));
  }
  f.commitShift = commitShift;
  const advCache = {};
  function play(name, opt) {
    let m = MOVE_DEFS[name];
    // a botch (src/combat/botch.js) is built from the forces the sim measured and the pose the body is in now
    if (name === 'botch' && opt && opt.botch) {
      m = makeBotch(opt.botch, f.pose);
      // two moves, one body (src/fighter/limbBlend.js): mix the new press's limb into the body's motion
      const b = opt.botch;
      if ((b.kind === 'whiff' || b.kind === 'over' || b.kind === 'spin') && move && keys.length) {
        const el = keys.slice(0, ki).reduce((s2, kk) => s2 + kk.d, 0) + kt;
        m = mixBotch(b, { len: m.blend + m.keys.reduce((s2, kk) => s2 + kk.d, 0), now: f.pose, sample: samplePose, nd: MOVE_DEFS[b.anim] || MOVE_DEFS.jab, tmpl: b.kind === 'whiff' ? null : m, cur: { keys, el } });
      }
    }
    if (name === 'flail' && opt && opt.botch) m = makeFlail(opt.botch);
    if (name === 'vault') m = makeVault(opt && opt.drop != null ? opt.drop : 340, opt && opt.railH != null ? opt.railH : 44);
    if (name === 'advance' && opt && opt.distance) { const d = Math.round(opt.distance); m = advCache[d] || (advCache[d] = makeAdvance(d)); }
    // reach: retarget a jab/cross so its tip lands d px in front of the root (the hips travel,
    // feet stay pinned; the cross's step grows or shrinks). chain: start from the key two before
    // contact (or the move's chainFrom), blending out of whatever the body is doing now.
    if (m && opt && opt.reach != null && opt.target == null && m.adapt && MOVE_DATA[name] && MOVE_DATA[name].reach) m = adapted(m, opt.reach - MOVE_DATA[name].reach);
    // An air attack rides the jump: continue the arc the body is on (the jump or a previous air
    // attack's), or hop a fresh jump if played from the ground.
    let track = null;
    if (m && m.air) {
      if (move && move.air && airTrack) track = { ...airTrack };
      else if (move === MOVE_DEFS.jump && !f.current.done) {
        const el = keys.slice(0, ki).reduce((s2, kk) => s2 + kk.d, 0) + kt;
        track = { keys: arcKeys(keys), t: el, landAt: keys.slice(0, keys.findIndex(kk => kk.ev === 'land')).reduce((s2, kk) => s2 + kk.d, 0) };
      } else {
        const jk = JUMP_ARC, la = jk.findIndex(kk => kk.ev === 'land');
        track = { keys: jk, t: jk[0].d + jk[1].d, landAt: jk.slice(0, la).reduce((s2, kk) => s2 + kk.d, 0) };
      }
    }
    // where the hip is now, px above the root; a dive (airRate > 1) drops out of the jump from
    // there and never climbs the rest of the arc
    const hipNow = m && m.air ? (f.y - solve(f.pose).hip.y) / f.scale : 0;
    const hipAt = t => { const J = solve({ ...samplePose(track.keys, t), hipLock: null }), h = (f.y - J.hip.y) / f.scale; return (m.airRate || 1) > 1 ? Math.min(h, hipNow) : h; };
    // target {x, y} (world): aim the tip at a point, e.g. an airborne body's point-sim position.
    // Two passes: retarget, measure the real tip on the contact pose, correct.
    if (m && opt && opt.target && m.adapt && m.limb) {
      const base = m, ai = base.keys.findIndex(k => k.ev === 'active'), L = m.limb.endsWith('Hand') ? 47 : 61;
      let e = 0, aim = 0, mm = base;
      for (let it = 0; it < 10; it++) {
        const pAt = track ? { ...mm.keys[ai].p, hipLock: hipAt(track.t + (m.blend + m.keys.slice(0, ai).reduce((s2, kk) => s2 + kk.d, 0)) * (m.airRate || 1)) } : mm.keys[ai].p;
        const J = solve(pAt), tip = J[m.limb], mid = J[{ lHand: 'lElbow', rHand: 'rElbow', lFoot: 'lKnee', rFoot: 'rKnee', lKnee: 'hip', rKnee: 'hip' }[m.limb]];
        // contact is the first part of the striking segment to reach the body: the frontmost edge of
        // its capsule at the target's height (a diagonal shin can arrive before the foot tip)
        let front = -Infinity;
        for (let i = 0; i <= 10; i++) {
          const u = i / 10, x = lerp(mid.x, tip.x, u), y = lerp(mid.y, tip.y, u), r = lerp(R.limbW, R.limbTip, u) / 2 * f.scale;
          if (Math.abs(y - opt.target.y) <= r + 8 * f.scale || i === 10) front = Math.max(front, (x - f.x) * f.facing + r);
        }
        e += ((opt.target.x - f.x) * f.facing - front) / f.scale;
        aim += clamp((tip.y - opt.target.y) / f.scale / L * 57.3, -50, 50);
        aim = clamp(aim, -100, 100); e = clamp(e, -50, 70);
        mm = adapted(base, e, aim);
      }
      m = mm;
    }
    // shownAt: ms of the move the caller skips before its first shown frame (the sim's pre-roll);
    // liveMs: how long before the contact key the strike can already hit (update() uses both to
    // show an air attack's startup in the time the player sees); headFrom: where the head is now
    // (the blend's first key is carried forward by momentum, so it isn't). Kept on the move def,
    // which getState() already carries.
    if (m && m.air) {
      const r = headRel(f.pose, R, lean);
      m = { ...m, shownAt: (opt && opt.shownAt) || 0, liveMs: (opt && opt.liveMs) || 0, headFrom: { x: f.pose.hx + r.x, y: r.y } };
    }
    if (m && opt && opt.chain) {
      const ai = m.keys.findIndex(k => k.ev === 'active'), from = Math.max(0, (m.chainFrom != null ? m.chainFrom : ai - 2));
      m = { ...m, blend: 40, keys: m.keys.slice(from) };
    }
    if (!m) throw new Error(`unknown move: ${name}`);
    if (m.loop && move === m && !f.current.done) return;
    // Cancelling out of a travelling move before it ends: take its root shift now (world pose
    // unchanged), so the next move starts from the new spot instead of snapping back.
    commitShift();
    if (f.pose.spin) f.pose = { ...f.pose, spin: ((f.pose.spin % 360) + 360) % 360 };
    // Leaving an air attack for anything on the ground (the sim's landing, a hit-confirmed idle):
    // lower the hip from the arc instead of dropping it in one frame. An air move starts its own.
    if (m.air) landEase = null;
    else if (move && move.air && lastHipLock != null && f.pose.hipLock != null) landEase = { from: lastHipLock, t: 0, dur: (move.airRate || 1) > 1 ? 220 : 160 };
    // a strike thrown while the hip is still coming down (a jump-in's landing jab) finishes the
    // descent by its contact key, so it lands where it would have from a standing start
    if (landEase && m.limb && !m.air) {
      const ai = m.keys.findIndex(k => k.ev === 'active');
      const toActive = m.blend + m.keys.slice(0, Math.max(0, ai)).reduce((s2, kk) => s2 + kk.d, 0);
      const u = Math.min(1, landEase.t / landEase.dur);
      landEase = { from: landEase.from * (1 - u), t: 0, dur: Math.max(1, Math.min(landEase.dur - landEase.t, toActive)) };
    }
    move = m; airTrack = track;
    // Blend from wherever the body is now into the first keyframe.
    // A loop closes back onto its first keyframe, so append a copy as the terminal key.
    // Blend from the current pose carried forward by its velocity (momentum), not from guard.
    const start = clonePose(f.pose);
    if (vel) for (const c of ['torso', 'bend', 'head', 'tw']) start[c] += clamp(vel[c] * 0.05, -18, 18);
    if (vel) for (const c of ['la', 'ra']) start[c] = [start[c][0] + clamp(vel[c][0] * 0.05, -20, 20), start[c][1] + clamp(vel[c][1] * 0.05, -20, 20)];
    if (m.air) start.hipLock = lastHipLock = hipNow;   // the hip height the air move eases onto the arc from (update)
    keys = [{ p: start, d: m.blend, ease: m.blendEase || 'out', ev: null }, ...m.keys];
    limbHot = !!m.limb;
    if (m.loop) keys.push({ ...m.keys[0], d: 0, ev: null });
    ki = 0; kt = 0; shifted = false; dropped = false;
    strikeTimer = 0;
    f.current = { move: name, t: 0, frame: 0, done: false };
  }

  function fire(k) {
    if (k.ev) f.events.push({ type: k.ev, move: f.current.move });
    if (k.ev === 'recover') limbHot = false;
    if (k.ev === 'active') { strikeTimer = 110; strikeDir = null; }
  }

  function update(dt) {
    if (rag) { stepRag(dt); return; }
    if (!move) play('idle');
    let ms = dt * 1000;
    strikeTimer = Math.max(0, strikeTimer - ms);
    const last = keys.length - 1;
    while (ms > 0) {
      const k = keys[ki];
      if (ki >= last) {
        if (move.loop) {           // wrap to the move's first real keyframe
          ki = 1; kt = 0; fire(keys[1]); continue;
        }
        f.current.done = true; break;
      }
      const remain = k.d - kt;
      if (ms < remain) { kt += ms; ms = 0; }
      else { ms -= remain; ki++; kt = 0; if (ki < last || !move.loop) fire(keys[ki]); }
    }
    // A move that lands exactly on its last key this step is finished now, not next step, so the
    // caller can start the next move without a duplicate frame in between.
    if (!move.loop && ki >= last) f.current.done = true;
    // A move with 'shift' travels: when it ends, move the root forward and the last key back by
    // the same amount, so the world pose is unchanged and the next blend starts from guard.
    if (f.current.done && move.shift && !shifted) {
      shifted = true;
      f.x += move.shift * f.facing * f.scale;
      keys[last] = { ...keys[last], p: { ...keys[last].p, hx: keys[last].p.hx - move.shift } };
    }
    // A move with 'drop' (vault) ends on a lower floor: move the ground line down and lift the last
    // key by the same amount, so the world pose is unchanged and the next move stands on the new floor.
    if (f.current.done && move.drop && !dropped) {
      dropped = true;
      f.y += move.drop * f.scale;
      keys[last] = { ...keys[last], p: { ...keys[last].p, air: keys[last].p.air + move.drop } };
    }
    const k = keys[ki], n = keys[Math.min(ki + 1, last)];
    const u = k.d > 0 ? EASE[k.ease](Math.min(1, kt / k.d)) : 1;
    let base = lerpPose(k.p, n.p, u);
    // An air attack's startup, in the time the player sees. The sim shows it from shownAt ms in
    // (its pre-roll) and the strike can hit from liveMs before the contact key (live). The keys
    // put most of the homing lunge (up to 70px) and the torso's swing inside the pre-roll, which
    // showed as one frame. Instead the head travels in a straight line, evenly over the frames
    // from the press to live (vis: 0..1), from where it was to where the keys have it at live;
    // the hips carry the difference (they lead, the upper body swings over them). The ease onto
    // the arc (update's hipLock) uses the same clock. From live on nothing changes, so the strike
    // is where it was whenever it can hit, and at contact.
    let el = kt, ramp = 0, live = 0, vis = 1, liftY = 0;
    if (move.air) {
      const ai = keys.findIndex(kk => kk.ev === 'active');
      for (let i = 0; i < ki; i++) el += keys[i].d;
      for (let i = 0; i < ai; i++) ramp += keys[i].d;
      live = ramp - (move.liveMs || 0);
      const shown = move.shownAt || 0;
      if (el < live && live > shown) {
        vis = clamp((el - shown) / (live - shown), 0, 1);
        const a = move.headFrom, pL = samplePose(keys, live), rL = headRel(pL, R, lean), rt = headRel(base, R, lean);
        base = { ...base, hx: a.x + (pL.hx + rL.x - a.x) * vis - rt.x };
        liftY = a.y + (rL.y - a.y) * vis - rt.y;
      }
    }
    if (lastBase && dt > 0) vel = poseVel(lastBase, base, dt);
    lastBase = base;
    f.pose = reactL ? applyReact(base, dt) : base;
    if (landEase) {
      landEase.t += dt * 1000;
      const u = Math.min(1, landEase.t / landEase.dur);
      if (u >= 1) landEase = null;
      // from the arc's height down to where the pose stands on its own, never below it (a pose
      // that stands taller, a jump's air, wins)
      else { const nat = (f.y - solve(f.pose).hip.y) / f.scale; f.pose = { ...f.pose, hipLock: nat + Math.max(0, landEase.from - nat) * (1 - u) }; }
    }
    if (move.air && airTrack) {
      airTrack.t += dt * 1000 * (move.airRate || 1);
      if (airTrack.t >= airTrack.landAt) { const h0 = lastHipLock != null ? lastHipLock : HIP, fast = (move.airRate || 1) > 1; airTrack = null; play('airLand'); landEase = { from: h0, t: 0, dur: fast ? 220 : 160 }; update(0); return; }   // airLand fires 'land'
      const arcAt = t => (f.y - solve({ ...samplePose(airTrack.keys, t), hipLock: null }).hip.y) / f.scale;
      // before live, the arc's height where it will be at live: the ease onto it is a straight line
      // (not the dive's, whose hip speed limit below makes its path depend on every frame before)
      const dive = (move.airRate || 1) > 1;
      let h = arcAt(vis < 1 && !dive ? Math.min(airTrack.landAt, airTrack.t + (live - el)) : airTrack.t);
      // Ease onto the arc: from the hip height the move started at (its blend key holds it) to the
      // arc's, linearly over the startup (on the shown clock, vis), so the first frame doesn't jump
      // there; liftY keeps the head's height on its straight line. A dive never climbs: it drops
      // out of the jump from where it was.
      const h0 = keys[0].p.hipLock;
      if (h0 != null) {
        if (dive) h = Math.min(h, h0);
        if (ramp > 0 && el < ramp) h = h0 + (h - h0) * (vis < 1 ? vis * live / ramp : el / ramp);
        // the dive races the rest of the arc (airRate): its hip comes down at most 600px/s
        // relative to the root, which is falling too; airLand's ease takes it from there
        if (dive && lastHipLock != null) h = Math.max(h, lastHipLock - 600 * dt);
      }
      // a dive remembers its hip without liftY, so its speed limit sees the same hip as before
      f.pose = { ...f.pose, hipLock: h + liftY }; lastHipLock = dive ? h : h + liftY;
    }
    const total = keys.reduce((s, kk) => s + kk.d, 0);
    const elapsed = keys.slice(0, ki).reduce((s, kk) => s + kk.d, 0) + kt;
    f.current.t = total ? Math.min(1, elapsed / total) : 1;
    f.current.frame = Math.max(0, ki - 1);
    prevJoints = f.joints;
    f.joints = secondary(solve(f.pose), dt);
    if (fadeFrom) {
      fadeT = Math.max(0, fadeT - dt * 1000);
      const w = fadeT / 250;
      for (const j in f.joints) f.joints[j] = { x: lerp(f.joints[j].x, fadeFrom[j].x, w), y: lerp(f.joints[j].y, fadeFrom[j].y, w) };
      if (!fadeT) fadeFrom = null;
    }
    if (strikeTimer > 0 && !strikeDir && move.limb && prevJoints[move.limb]) {
      const a = prevJoints[move.limb], b = f.joints[move.limb];
      const vx = b.x - a.x, vy = b.y - a.y, v = dm.hypot(vx, vy);
      strikeDir = v > 2 ? { x: vx / v, y: vy / v } : { x: f.facing, y: 0 };
    }
  }

  // ---- additive reactions -------------------------------------------------------------
  // f.react(name, { weight, dir, full }): the reaction's offset from its own end pose is added on
  // top of whatever move is playing (torso, spine, head, shoulders, arms; legs stay with the base
  // move so the feet hold). weight scales it (0..1), dir -1 mirrors it for a hit from behind,
  // full: true plays the reaction outright instead (big hits).
  function react(name, opt = {}) {
    const def = MOVE_DEFS[name];
    if (!def) throw new Error(`unknown move: ${name}`);
    if (opt.full) { reactL = null; play(name); return; }
    const dur = def.keys.reduce((s2, k) => s2 + k.d, 0);
    reactL = { keys: def.keys, ref: def.keys[def.keys.length - 1].p, t: 0, dur, w: opt.weight == null ? 0.75 : opt.weight, dir: opt.dir || 1 };
  }
  function applyReact(base, dt) {
    const r = reactL; r.t += dt * 1000;
    if (r.t >= r.dur) { reactL = null; return base; }
    const rp = samplePose(r.keys, r.t);
    const env = Math.min(1, r.t / 40) * (r.t > r.dur * 0.55 ? Math.max(0, 1 - (r.t - r.dur * 0.55) / (r.dur * 0.45)) : 1);
    const w = r.w * env, o = clonePose(base);
    for (const c of ['torso', 'bend', 'head']) o[c] += (rp[c] - r.ref[c]) * w * r.dir;
    o.tw += (rp.tw - r.ref.tw) * w;
    for (const c of ['la', 'ra']) o[c] = [o[c][0] + (rp[c][0] - r.ref[c][0]) * w, o[c][1] + (rp[c][1] - r.ref[c][1]) * w];
    return o;
  }

  // ---- spring secondary motion ---------------------------------------------------------
  // Head, hands and feet follow their keyframed targets through critically damped springs, so
  // stops overshoot a little and starts lag a little. The lag is capped so poses still read, the
  // striking limb is exempt while it is live (contact stays exact) and a foot on the floor is
  // pinned.
  const SPRING = { head: [26, 4], lHand: [30, 4], rHand: [30, 4], lFoot: [34, 3], rFoot: [34, 3] };
  function secondary(j, dt) {
    if (!(dt > 0)) { for (const k in SPRING) springs[k] = { x: j[k].x, y: j[k].y, vx: 0, vy: 0 }; return j; }
    for (const k in SPRING) {
      const t = j[k], [w, cap] = SPRING[k];
      let s2 = springs[k] || (springs[k] = { x: t.x, y: t.y, vx: 0, vy: 0 });
      const pinned = (limbHot && move && move.limb === k) || ((k === 'lFoot' || k === 'rFoot') && t.y > f.y - R.limbW);
      if (pinned) { springs[k] = { x: t.x, y: t.y, vx: 0, vy: 0 }; continue; }
      const n = Math.max(1, Math.ceil(dt / 0.01)), h = dt / n;
      for (let i = 0; i < n; i++) {
        s2.vx += (w * w * (t.x - s2.x) - 2 * w * s2.vx) * h; s2.vy += (w * w * (t.y - s2.y) - 2 * w * s2.vy) * h;
        s2.x += s2.vx * h; s2.y += s2.vy * h;
      }
      const ox = clamp(s2.x - t.x, -cap, cap), oy = clamp(s2.y - t.y, -cap, cap);
      s2.x = t.x + ox; s2.y = t.y + oy;
      // never push a sprung joint through the floor (but a body below f.y, mid-drop, is left alone)
      j[k] = { x: t.x + ox, y: Math.min(t.y + oy, Math.max(t.y, f.y - (k === 'head' ? R.headR : R.limbW / 2))) };
    }
    return j;
  }

  // ---- point simulation (launch, juggle, wall splat, wall/ground bounce) --------------------
  // Each joint becomes a verlet point; bones are distance constraints (plus a few braces so the
  // body keeps its shape), with gravity, floor and walls. Events: 'land' (first floor contact),
  // 'wall' (hit a wall), 'bounce' (ground bounce). When the body comes to rest it crossfades into
  // the keyframed knockdown rest pose (current.move 'knockdown', done) so a getup can follow.
  const BONES = [['hip', 'chest'], ['chest', 'neck'], ['neck', 'head'], ['neck', 'lShoulder'], ['neck', 'rShoulder'], ['lShoulder', 'lElbow'],
    ['lElbow', 'lHand'], ['rShoulder', 'rElbow'], ['rElbow', 'rHand'], ['hip', 'lKnee'], ['lKnee', 'lFoot'], ['hip', 'rKnee'], ['rKnee', 'rFoot'],
    ['hip', 'neck'], ['chest', 'head'], ['lShoulder', 'rShoulder'], ['chest', 'lShoulder'], ['chest', 'rShoulder'], ['hip', 'head']];
  const GRAV = 1900;
  function launch({ vx = 260, vy = -620, spin = 360, wall = 'splat' } = {}) {
    // vx > 0 sends the body backward (away from where it faces); spin > 0 tips the head back.
    const J = f.joints, wv = -f.facing * vx * f.scale, om = -f.facing * spin * DEG, hip = J.hip;
    if (!rag) {
      rag = { pts: {}, len: [], t: 0, rest: 0, splat: 0, bounceNext: false, landed: false, wall };
      for (const k in J) rag.pts[k] = { x: J[k].x, y: J[k].y, px: J[k].x, py: J[k].y, r: k === 'head' ? R.headR * f.scale : R.limbW / 2 * f.scale };
      rag.len = BONES.map(([a, b]) => dm.hypot(J[a].x - J[b].x, J[a].y - J[b].y));
      f.airborne = true; reactL = null; landEase = null;
      f.current = { move: 'airborne', t: 0, frame: 0, done: false };
    }
    rag.wall = wall; rag.rest = 0; rag.landed = false;
    if (rag.splat > 0) { rag.splat = 0; for (const k in rag.pts) { rag.pts[k].px = rag.pts[k].x; rag.pts[k].py = rag.pts[k].y; } }   // a hit knocks it off the wall
    const h = 1 / 120;
    for (const k in rag.pts) {
      const q = rag.pts[k], rx = q.x - hip.x, ry = q.y - hip.y;
      q.px -= (wv - om * ry) * h; q.py -= (vy * f.scale + om * rx) * h;
    }
  }
  // Wall splat: whatever the incoming pose, the body is laid flat against the wall, back to it,
  // arms thrown up and out, legs hanging, and slides down it for 0.4s before falling.
  // Round reset: drop the point simulation, any crossfade, reaction and spring state, and stand in
  // idle at the current x, y.
  // full: also forget the jump arc, the strike direction and the fall surfaces (a fresh match, online)
  function reset(opt = {}) {
    rag = null; f.airborne = false; fadeFrom = null; fadeT = 0; reactL = null; vel = null; lastBase = null;
    for (const k in springs) delete springs[k];
    f.pose = clonePose(STANCE); move = null; limbHot = false; strikeTimer = 0;
    if (opt.full) { airTrack = null; landEase = null; lastHipLock = null; strikeDir = null; prevJoints = null; keys = []; ki = 0; kt = 0; shifted = false; dropped = false; f.walls = null; f.treads = null; f.slopes = null; f.floorY = null; }
    play('idle'); update(0); f.events.length = 0;
  }
  function wallSplat(side) {
    if (!rag) launch({ vx: 0, vy: 0, spin: 0 });
    const P = rag.pts, sc = f.scale;
    if (!side) side = f.walls ? (Math.abs(P.hip.x - f.walls[1]) < Math.abs(P.hip.x - f.walls[0]) ? 1 : -1) : -f.facing;
    const wx = f.walls ? f.walls[side > 0 ? 1 : 0] : P.hip.x + side * 20;
    const s2 = side, v = (x, y) => ({ x, y }), add = (a2, ang, len) => v(a2.x + dm.sin(ang * DEG) * len * sc * -s2, a2.y + dm.cos(ang * DEG) * len * sc);
    // Angles here are from straight down, positive pointing away from the wall.
    const gnd = f.floorY != null ? f.floorY : f.y;
    const hipY = Math.min(P.hip.y, gnd - 92 * sc);   // high enough to slide down the wall
    const hip = v(0, hipY), chest = add(hip, 176, 17), neck = add(chest, 178, 19), head = add(neck, 168, 18);
    const sh = v(lerp(neck.x, chest.x, 0.2), lerp(neck.y, chest.y, 0.2));
    const pose = { hip, chest, neck, head, lShoulder: sh, rShoulder: sh,
      lElbow: add(sh, 165, 24), rElbow: add(sh, 130, 24), lKnee: add(hip, 22, 31), rKnee: add(hip, 12, 31) };
    pose.lHand = add(pose.lElbow, 172, 23); pose.rHand = add(pose.rElbow, 112, 23);
    pose.lFoot = add(pose.lKnee, 4, 30); pose.rFoot = add(pose.rKnee, -4, 30);
    // Slide the whole shape so its wall-side edge touches the wall and nothing is below the floor.
    let edge = -Infinity, low = -Infinity;
    for (const k in pose) { const r = P[k].r; edge = Math.max(edge, pose[k].x * s2 + r); low = Math.max(low, pose[k].y + r); }
    const dx = wx - s2 * edge, dy = Math.min(0, gnd - low);
    for (const k in pose) { const q = P[k]; q.x = q.px = pose[k].x + dx; q.y = q.py = pose[k].y + dy; }
    rag.len = BONES.map(([a2, b2]) => dm.hypot(P[a2].x - P[b2].x, P[a2].y - P[b2].y));
    rag.splat = 0.4; rag.wallDone = true; rag.wallSide = s2;
    f.events.push({ type: 'wall', move: 'airborne', side: s2 });
  }
  function groundBounce() {
    if (!rag) launch({ vx: 60, vy: 0, spin: 0 });
    rag.bounceNext = true;
    for (const k in rag.pts) rag.pts[k].py -= 900 * f.scale / 120;   // drive it down hard
  }
  function stepRag(dt) {
    const h = 1 / 120, P = rag.pts, n = Math.max(1, Math.round(dt / h));
    let wallHit = 0;
    for (let s2 = 0; s2 < n; s2++) {
      rag.t += h;
      if (rag.splat > 0) {
        rag.splat -= h;
        let low = -Infinity; for (const k in P) low = Math.max(low, P[k].y + P[k].r);
        const dy = Math.min(80 * f.scale * h, (f.floorY != null ? f.floorY : f.y) - low);
        for (const k in P) { P[k].y += dy; P[k].px = P[k].x; P[k].py = P[k].y; }
        if (rag.splat <= 0) for (const k in P) P[k].px = P[k].x + (rag.wallSide || 0) * 60 * f.scale * h;   // peel away from the wall
        continue;
      }
      for (const k in P) {
        const q = P[k], vx = (q.x - q.px) * 0.998, vy = (q.y - q.py) * 0.998;
        q.px = q.x; q.py = q.y; q.x += vx; q.y += vy + GRAV * f.scale * h * h;
      }
      for (let it = 0; it < 8; it++) {
        BONES.forEach(([a, b], i) => {
          const A2 = P[a], B2 = P[b], dx = B2.x - A2.x, dy = B2.y - A2.y, d = dm.hypot(dx, dy) || 1, k2 = (d - rag.len[i]) / d * 0.5;
          A2.x += dx * k2; A2.y += dy * k2; B2.x -= dx * k2; B2.y -= dy * k2;
        });
        const ground = f.floorY != null ? f.floorY : f.y;
        for (const k in P) {
          const q = P[k], fl = groundAt(q.x, ground) - q.r;
          if (f.treads) for (let ti = 0; ti < f.treads.length; ti++) {
            const t = f.treads[ti];
            if (q.x < t.x0 || q.x > t.x1 || q.py + q.r > t.y + 0.5 || q.y + q.r <= t.y) continue;
            const vy = q.y - q.py;
            q.y = t.y - q.r; q.py = q.y + vy * 0.25; q.px = q.x - (q.x - q.px) * 0.97;   // a bounce with light friction (applied per solver pass)
            rag.treadT = rag.treadT || {};
            if (vy > 1.2 * f.scale && rag.t - (rag.treadT[ti] || -1) > 0.12) { rag.treadT[ti] = rag.t; f.events.push({ type: 'tread', move: 'airborne', y: t.y }); }
          }
          if (q.y > fl) {
            const vy = q.y - q.py;
            q.y = fl; q.px = q.x - (q.x - q.px) * 0.55;
            if (rag.bounceNext && (k === 'hip' || k === 'chest')) { rag.bounceNext = false; for (const k3 in P) P[k3].py = P[k3].y + 640 * f.scale * h; f.events.push({ type: 'bounce', move: 'airborne' }); }
            else q.py = q.y + vy * 0.2;
            if (!rag.landed && rag.t > 0.08 && (k === 'hip' || k === 'chest' || k === 'head')) { rag.landed = true; f.events.push({ type: 'land', move: 'airborne' }); }
          }
          if (f.walls) {
            const lo = f.walls[0] + q.r, hi = f.walls[1] - q.r;
            if (q.x < lo || q.x > hi) {
              const vx = q.x - q.px; q.x = q.x < lo ? lo : hi;
              if (Math.abs(vx) > 2 * f.scale) wallHit = q.x <= lo + 0.01 ? -1 : 1;
              q.px = rag.wall === 'bounce' ? q.x + vx * 0.7 : q.x;
            }
          }
        }
      }
    }
    if (wallHit && !rag.wallDone) {
      rag.wallDone = true;
      if (rag.wall === 'splat') wallSplat(wallHit); else f.events.push({ type: 'wall', move: 'airborne', side: wallHit });
    }
    const J = {}; let speed = 0, onFloor = 0;
    const ground = f.floorY != null ? f.floorY : f.y;
    let surf = -Infinity;
    for (const k in P) { J[k] = { x: P[k].x, y: P[k].y }; speed = Math.max(speed, dm.hypot(P[k].x - P[k].px, P[k].y - P[k].py) / h); surf = Math.max(surf, P[k].y + P[k].r); }
    for (const k in P) if (P[k].y + P[k].r >= surf - 1.5 || (f.slopes && P[k].y + P[k].r >= groundAt(P[k].x, ground) - 1.5)) onFloor++;   // on a flight, touching the steps under it
    rag.surf = surf;
    prevJoints = f.joints; f.joints = J;
    f.x = J.hip.x;
    rag.rest = speed < 40 && onFloor >= 3 ? rag.rest + dt : 0;
    // Stalled on a step above the floor it is falling to: roll it on down the stair.
    const under = f.treads && f.treads.find(t => J.hip.x >= t.x0 - 8 && J.hip.x <= t.x1 + 8 && Math.abs(t.y - surf) < 4);
    // (also when it jitters wedged across steps for a while without ever coming to rest)
    rag.stall = speed < 160 ? (rag.stall || 0) + dt : 0;
    if (f.treads && surf < ground - 3 && !(under && under.x1 - under.x0 > 40) && (rag.rest > 0.15 || rag.stall > 0.6)) {   // a step, not a slab of floor
      rag.stall = 0;
      const below = f.treads.filter(t => t.y > surf + 2).sort((a2, b2) => a2.y - b2.y)[0];
      const dir = below ? Math.sign((below.x0 + below.x1) / 2 - J.hip.x) || 1 : f.facing;
      for (const k in P) { P[k].px -= dir * 260 * f.scale / 120; P[k].py += 90 * f.scale / 120; }
      rag.rest = 0;
    }
    if (rag.rest > 0.3) endRag();
  }
  // the ground under x for the point simulation: the floor plane, or a slope over it (a flight of stairs)
  function groundAt(x, ground) {
    if (!f.slopes) return ground;
    let g = ground;
    for (let i = 0; i < f.slopes.length; i++) {
      const s2 = f.slopes[i];
      if (x < s2.x0 || x > s2.x1) continue;
      const y = s2.x1 > s2.x0 ? s2.y0 + (s2.y1 - s2.y0) * (x - s2.x0) / (s2.x1 - s2.x0) : Math.min(s2.y0, s2.y1);
      if (y < g) g = y;
    }
    return g;
  }
  function endRag() {
    const snap = f.joints;
    // Face so the head lies behind the hip, like the keyframed rest pose; root under the hip.
    if (snap.head.x !== snap.hip.x) f.facing = snap.head.x < snap.hip.x ? 1 : -1;
    const surf = rag.surf;
    rag = null; f.airborne = false;
    if (isFinite(surf)) f.y = Math.round(surf);   // the floor (or step) it came to rest on becomes its ground
    f.floorY = null;
    const kd = MOVE_DEFS.knockdown, restP = kd.keys[kd.keys.length - 1].p;
    f.x = snap.hip.x - restP.hx * f.facing * f.scale;
    move = kd; keys = [{ p: clonePose(restP), d: 0, ease: 'sine', ev: null }, { p: clonePose(restP), d: 0, ease: 'sine', ev: null }];
    ki = 1; kt = 0; f.current = { move: 'knockdown', t: 1, frame: kd.keys.length - 1, done: true };
    f.pose = clonePose(restP); lastBase = null; vel = null;
    fadeFrom = snap; fadeT = 250;
    f.joints = solve(f.pose);
  }

  // Forward kinematics in body space, then mirror, scale, ground snap, world offset.
  function solve(p) {
    const s = f.scale;
    const seg = (from, ang, len) => ({ x: from.x + dm.sin(ang * DEG) * len, y: from.y + dm.cos(ang * DEG) * len });
    const hip = { x: p.hx, y: -R.hipH };
    const t0 = lean ? p.torso + lean : p.torso;   // a character's lean (0 at the baseline: no add, the bits stay the same)
    const chest = { x: hip.x + dm.sin(t0 * DEG) * R.lowerTorso, y: hip.y - dm.cos(t0 * DEG) * R.lowerTorso };
    const ua = (t0 + p.bend) * DEG;
    const neck = { x: chest.x + dm.sin(ua) * R.upperTorso, y: chest.y - dm.cos(ua) * R.upperTorso };
    const ha = (t0 + p.bend + p.head) * DEG;
    const head = { x: neck.x + dm.sin(ha) * (R.neck + R.headR), y: neck.y - dm.cos(ha) * (R.neck + R.headR) };
    // Shoulders sit just below the neck on the chest segment; twist pushes them apart.
    const sh = { x: lerp(neck.x, chest.x, 0.2), y: lerp(neck.y, chest.y, 0.2) };
    const lShoulder = { x: sh.x - p.tw * 0.5, y: sh.y };
    const rShoulder = { x: sh.x + p.tw * 0.5, y: sh.y };
    const lElbow = seg(lShoulder, p.la[0], R.upperArm), lHand = seg(lElbow, p.la[1], R.lowerArm);
    const rElbow = seg(rShoulder, p.ra[0], R.upperArm), rHand = seg(rElbow, p.ra[1], R.lowerArm);
    // stance: the legs spread by that many degrees each (0 at the baseline)
    const lKnee = seg(hip, stance ? p.ll[0] + stance : p.ll[0], R.upperLeg), lFoot = seg(lKnee, stance ? p.ll[1] + stance * 0.5 : p.ll[1], R.lowerLeg);
    const rKnee = seg(hip, stance ? p.rl[0] - stance : p.rl[0], R.upperLeg), rFoot = seg(rKnee, stance ? p.rl[1] - stance * 0.5 : p.rl[1], R.lowerLeg);
    const j = { head, neck, chest, hip, lShoulder, rShoulder, lElbow, rElbow, lHand, rHand, lKnee, rKnee, lFoot, rFoot };
    if (p.spin) {
      const c = dm.cos(p.spin * DEG), dz = Math.abs(dm.sin(p.spin * DEG)) * 12;
      for (const k in j) if (k !== 'hip') {
        const off = /^r(Shoulder|Elbow|Hand|Knee|Foot)/.test(k) ? dz : /^l(Shoulder|Elbow|Hand|Knee|Foot)/.test(k) ? -dz : 0;
        j[k] = { x: hip.x + (j[k].x - hip.x) * c + off, y: j[k].y };
      }
    }
    // Lowest solid point rests on the ground line.
    let low = -Infinity;
    for (const k in j) {
      const extra = k === 'head' ? R.headR : R.limbW * 0.5;
      if (j[k].y + extra > low) low = j[k].y + extra;
    }
    // Airborne attacks hold the hip at the jump's height instead of standing on their lowest point.
    const dy = p.hipLock != null ? Math.min(-p.hipLock + R.hipH, -low) : -low - p.air;
    for (const k in j) j[k] = { x: f.x + j[k].x * f.facing * s, y: f.y + (j[k].y + dy) * s };
    return j;
  }

  function draw(ctx) {
    const j = f.joints;
    if (!j.head) f.joints = solve(f.pose);
    const J = f.joints, s = f.scale;
    ctx.save();
    ctx.fillStyle = f.color;
    ctx.strokeStyle = f.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const w = R.limbW * s, tip = R.limbTip * s;
    // Far limbs, torso, head, near limbs.
    limb(ctx, J.lShoulder, J.lElbow, J.lHand, w, tip);
    // legs in the character's pants color when it has one (src/characters/: `pants`), so fighters
    // with close body colors still read apart; the hips get a band of it over the torso's base
    const pants = f.pants || null;
    if (pants) { ctx.fillStyle = pants; }
    limb(ctx, J.hip, J.lKnee, J.lFoot, w, tip);
    if (pants) { ctx.fillStyle = f.color; }
    const midW = (R.hipW + R.torsoW) / 2 * s;
    taper(ctx, J.hip, J.chest, R.hipW * s, midW);
    taper(ctx, J.chest, J.neck, midW, R.torsoW * s);
    if (pants) {
      ctx.fillStyle = pants;
      const wx = J.hip.x + (J.chest.x - J.hip.x) * 0.22, wy = J.hip.y + (J.chest.y - J.hip.y) * 0.22;
      taper(ctx, J.hip, { x: wx, y: wy }, R.hipW * s, R.hipW * s * 1.02);
      ctx.fillStyle = f.color;
    }
    ctx.beginPath();
    ctx.arc(J.head.x, J.head.y, R.headR * s, 0, Math.PI * 2);
    ctx.fill();
    // a character's accessory (a cap, a hard hat, a headset): a few strokes on the head, lit like the body
    if (accessory) { ctx.save(); try { accessory(ctx, J, { scale: s, facing: f.facing, color: f.color, accent: f.accent || f.color, R, headR: R.headR * s, pose: f.pose }); } catch (e) { /* a bad accessory never breaks the frame */ } ctx.restore(); }
    // a character's prop (src/characters/: `prop`, a lanyard, a tie): drawn over the chest, its free end shifted by
    // f.sway, which only the life layer sets (src/fighter/life.js, draw-only; null hangs it at rest)
    const prop = f.charDef && f.charDef.prop;
    if (prop && prop.draw) { ctx.save(); try { prop.draw(ctx, J, { scale: s, facing: f.facing, color: f.color, accent: f.accent || f.color, R, headR: R.headR * s, pose: f.pose, sway: f.sway || { x: 0, y: 0 }, at: prop.at || 0.15, len: (prop.len || 22) * s }); } catch (e) { /* a bad prop never breaks the frame */ } ctx.restore(); }
    if (pants) ctx.fillStyle = pants;
    limb(ctx, J.hip, J.rKnee, J.rFoot, w, tip);
    if (pants) ctx.fillStyle = f.color;
    limb(ctx, J.rShoulder, J.rElbow, J.rHand, w, tip);
    if (f.speedLines && strikeTimer > 0 && strikeDir && move && move.limb) {
      speedLines(ctx, strikeDir, J[move.limb], strikeTimer / 110);
    }
    ctx.restore();
  }

  function limb(ctx, a, b, c, w, tip) {
    taper(ctx, a, b, w, (w + tip) / 2);
    taper(ctx, b, c, (w + tip) / 2, tip);
  }

  // A tapered stroke with round ends: w0 at a, w1 at b.
  function taper(ctx, a, b, w0, w1) {
    const dx = b.x - a.x, dy = b.y - a.y, len = dm.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len, ang = dm.atan2(dy, dx);
    ctx.beginPath();
    ctx.arc(a.x, a.y, w0 / 2, ang + Math.PI / 2, ang - Math.PI / 2);
    ctx.lineTo(b.x + nx * w1 / 2 * -1, b.y + ny * w1 / 2 * -1);
    ctx.arc(b.x, b.y, w1 / 2, ang - Math.PI / 2, ang + Math.PI / 2);
    ctx.closePath();
    ctx.fill();
  }

  // Thin trailing lines behind a fast limb end, the way the reference marks a strike.
  function speedLines(ctx, dir, now, life) {
    const ux = dir.x, uy = dir.y, nx = -uy, ny = ux;
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.4 * life;
    ctx.lineWidth = 2 * f.scale;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#8a8a8a';
    const L = 40 * f.scale;
    for (let i = -1; i <= 1; i++) {
      const off = i * 8 * f.scale, len = (L - Math.abs(i) * 10) * (0.6 + 0.4 * life);
      const sx = now.x - ux * 18 * f.scale + nx * off, sy = now.y - uy * 18 * f.scale + ny * off;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - ux * len, sy - uy * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- save / restore (online rollback) ---------------------------------------------------
  // getState(into?) captures everything that decides the rig's next update: the move and its key
  // list, the clock inside it, the pose and its velocity, the reaction layer, the springs, the
  // point simulation, the crossfade, the jump arc and the fall surfaces. setState(s) puts it back.
  // Objects the rig mutates in place (springs, rag points, the clocks in reactL / airTrack /
  // landEase, current, the joints map) are copied both ways, so a state can be restored any
  // number of times; poses, key objects and move defs are never mutated, so they're shared.
  // `into` is reused (its nested objects too), so a ring of saved states makes no garbage.
  const copyMap = (src, dst) => { if (!src) return null; dst = dst || {}; for (const k in src) dst[k] = src[k]; return dst; };
  const copySpring = (s, d) => { d = d || {}; d.x = s.x; d.y = s.y; d.vx = s.vx; d.vy = s.vy; return d; };
  function copyRag(r, d) {
    if (!r) return null;
    d = d || { pts: {} };
    const dp = d.pts || (d.pts = {});
    for (const k in r.pts) { const q = r.pts[k], o = dp[k] || (dp[k] = {}); o.x = q.x; o.y = q.y; o.px = q.px; o.py = q.py; o.r = q.r; }
    for (const k in dp) if (!(k in r.pts)) delete dp[k];
    d.len = r.len; d.t = r.t; d.rest = r.rest; d.splat = r.splat; d.bounceNext = r.bounceNext; d.landed = r.landed; d.wall = r.wall;
    d.wallDone = r.wallDone; d.wallSide = r.wallSide; d.surf = r.surf; d.stall = r.stall;
    d.treadT = r.treadT ? { ...r.treadT } : undefined;   // only while tumbling down the stairs
    return d;
  }
  function getState(into) {
    const s = into || {};
    s.x = f.x; s.y = f.y; s.facing = f.facing; s.airborne = f.airborne; s.walls = f.walls; s.treads = f.treads; s.slopes = f.slopes; s.floorY = f.floorY;
    s.pose = f.pose;
    s.joints = copyMap(f.joints, s.joints);
    s.events = f.events.length ? f.events.slice() : null;
    const c = s.current || (s.current = {});
    c.move = f.current.move; c.t = f.current.t; c.frame = f.current.frame; c.done = f.current.done;
    s.move = move; s.ki = ki; s.kt = kt; s.shifted = shifted; s.dropped = dropped;
    s.keys = s.keys || []; s.keys.length = keys.length; for (let i = 0; i < keys.length; i++) s.keys[i] = keys[i];
    s.prevJoints = prevJoints; s.strikeTimer = strikeTimer; s.strikeDir = strikeDir;
    s.vel = vel; s.lastBase = lastBase;
    s.reactL = reactL ? Object.assign(s.reactL || {}, reactL) : null;
    s.springs = s.springs || {};
    for (const k in s.springs) if (!springs[k]) delete s.springs[k];
    for (const k in springs) s.springs[k] = copySpring(springs[k], s.springs[k]);
    s.rag = copyRag(rag, s.rag && s.rag !== rag ? s.rag : null);
    s.fadeFrom = fadeFrom; s.fadeT = fadeT; s.limbHot = limbHot;
    s.airTrack = airTrack ? Object.assign(s.airTrack || {}, airTrack) : null;
    s.landEase = landEase ? Object.assign(s.landEase || {}, landEase) : null;
    s.lastHipLock = lastHipLock;
    return s;
  }
  function setState(s) {
    f.x = s.x; f.y = s.y; f.facing = s.facing; f.airborne = s.airborne; f.walls = s.walls; f.treads = s.treads; f.slopes = s.slopes || null; f.floorY = s.floorY;
    f.pose = s.pose;
    f.joints = copyMap(s.joints, {});
    f.events.length = 0; if (s.events) for (const e of s.events) f.events.push(e);
    f.current = { move: s.current.move, t: s.current.t, frame: s.current.frame, done: s.current.done };
    move = s.move; ki = s.ki; kt = s.kt; shifted = s.shifted; dropped = s.dropped;
    keys = s.keys.slice();
    prevJoints = s.prevJoints; strikeTimer = s.strikeTimer; strikeDir = s.strikeDir;
    vel = s.vel; lastBase = s.lastBase;
    reactL = s.reactL ? { ...s.reactL } : null;
    for (const k in springs) if (!s.springs[k]) delete springs[k];
    for (const k in s.springs) springs[k] = copySpring(s.springs[k], null);
    rag = copyRag(s.rag, null);
    fadeFrom = s.fadeFrom; fadeT = s.fadeT; limbHot = s.limbHot;
    airTrack = s.airTrack ? { ...s.airTrack } : null;
    landEase = s.landEase ? { ...s.landEase } : null;
    lastHipLock = s.lastHipLock;
  }
  f.getState = getState;
  f.setState = setState;

  setBody(body, { scale });
  play('idle');
  update(0);
  return f;
}

// Strike reach: how far in front of the root (f.x) the limb tip is on the 'active' frame, at
// scale 1. Combat spaces fighters so this lands on the defender's surface.
let probe = null;
function probeReach(n) {
  probe = probe || createFighter({ x: 0, y: 0, facing: 1 });
  const m = MOVE_DEFS[n], k = m.limb && m.keys.find(kk => kk.ev === 'active');
  if (k) {
    const tip = probe._solve(m.air ? { ...k.p, hipLock: HIP } : k.p)[m.limb];
    MOVE_DATA[n].reach = Math.round((tip.x + RIG.limbTip / 2) * 10) / 10;
    MOVE_DATA[n].reachY = Math.round(-tip.y);   // px above the floor
  }
}
for (const n of MOVES) probeReach(n);

// ---- characters (src/characters/) -------------------------------------------------------------
// addMoves({ name: def }) merges a character's own clips into the move set: def is a MOVE_DEFS entry
// (blend, limb, keys of K(pose, ms, ease, ev), optional shift, air, chainFrom, height, effect). Names
// are global, so a character prefixes nothing but must not reuse a shared name. Every rig can play
// every clip; the sim lets only the owner press it.
export function addMoves(defs) {
  for (const [n, m] of Object.entries(defs)) {
    if (!m || !Array.isArray(m.keys) || !m.keys.length) throw new Error(`move '${n}': no keys`);
    if (m.limb && !m.adapt) m.adapt = m.air ? 'air' : m.limb.endsWith('Hand') ? 'pinned' : 'kick';
    MOVE_DEFS[n] = m;
    if (!MOVES.includes(n)) MOVES.push(n);
    MOVE_DATA[n] = moveDataOf(n);
    probeReach(n);
  }
}

// The keyframe kit for character files: build poses the way this file does.
//   K(pose, ms, ease, ev)   a keyframe; pose fields over STANCE; ev 'active' | 'recover' | 'footstep' | 'land'
//   F(hx, H, lfx, rfx, lift, rlift)   both legs by IK: hip offset hx, hip height H, feet x (body space)
//   L(hx, H, fx)            one pinned leg by IK; leg(dx, dy) the raw two-bone solve
//   crouchP / CH            the crouch pose and its hip height; LF, RF, HIP the guard's feet and hip
//   base(name)              a shared clip (read only), deepKeys(def) a copy of its keys to tweak
export const RIG_KIT = { K, F, L, leg, P, mirror, STANCE, LF, RF, HIP, TALL, CH, crouchP, TUCK, deepKeys, adapted, base: n => MOVE_DEFS[n], EASES: Object.keys(EASE) };
