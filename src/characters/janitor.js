// JANITOR: long reach. A lanky rig (long arms and legs, thin limbs, a narrow torso) that's a little
// slower on his feet. Thin limbs keep the long reach honest: the hitbox and the hurtbox both scale
// with limb width, so his pokes reach farther without the fat fist that won SECURITY's first build
// every exchange. Two unique moves: Wet Floor (f+3, a long, low sliding sweep along the floor that
// knocks down and is wide open on block) and Mop Spin (b+3, a full turn with the lead leg out flat at
// hip height that sweeps behind him first, then in front, so a cross-up gets caught on the way round).
// One unique string, AISLE 3 (3, 3, 3), ending in a long side kick that splats on the wall. Keeps
// every shared string.
import { RIG_KIT } from '../fighter/index.js';
import { stoop } from './perfectKit.js';

const { K, F, L, LF, RF, HIP, CH } = RIG_KIT;

// f+3: drop low over the rear leg and slide the lead leg out flat along the floor at shin height,
// one hand reaching down for balance; the body glides in behind it (frame data travel). Long
// recovery: he has to pull the leg back in and stand up.
const wetFloor = { blend: 40, limb: 'lFoot', keys: [
  K({ hx: -4, rl: L(-4, CH + 6, RF - 2), ll: [36, -40], torso: 22, bend: 6, head: -8, tw: 4, la: [40, 110], ra: [-10, 70] }, 90, 'in'),
  K({ hx: 2, rl: L(2, CH - 4, RF - 2), ll: [62, -50], torso: 36, bend: 8, head: -12, tw: 6, la: [62, 40], ra: [-30, 30] }, 70, 'linear'),
  K({ hx: 14, rl: L(14, 30, RF), ll: [86, 88], torso: 44, bend: 9, head: -16, tw: 8, la: [76, 30], ra: [-52, -24] }, 40, 'out', 'active'),
  K({ hx: 16, rl: L(16, 29, RF + 1), ll: [87, 89], torso: 45, bend: 9, head: -16, tw: 8, la: [78, 30], ra: [-54, -26] }, 150, 'linear'),
  K({ hx: 12, rl: L(12, 31, RF + 1), ll: [76, 44], torso: 36, bend: 7, head: -12, tw: 4, la: [60, 40], ra: [-30, 20] }, 120, 'inOut', 'recover'),
  K({ ...F(6, CH + 2, LF + 12, RF + 1), torso: 22, bend: 6, head: -8, la: [40, 120], ra: [20, 130] }, 130, 'inOut'),
  K({ ...F(4, HIP - 3, LF + 4, RF + 1, 0, 6), torso: 9, bend: 1, head: -5, la: [52, 146], ra: [28, 160] }, 110, 'out', 'footstep'),
  K({ ...F(1, HIP - 1, LF, RF), torso: 6, head: -4 }, 0, 'sine'),
] };

// b+3: wind the shoulders, pivot on the rear foot and swing the lead leg out flat at hip height for a
// full turn, the arms flung wide; the leg passes behind him first (the spin's 180) and comes round in
// front. One hit, either side.
const mopSpin = { blend: 40, limb: 'lFoot', keys: [
  K({ ...F(-6, HIP - 5, LF, RF), torso: 8, bend: 2, head: -2, tw: -12, la: [30, 110], ra: [70, 120] }, 60, 'in'),
  K({ hx: -11, rl: L(-11, HIP - 3, RF), ll: [58, 10], torso: 4, bend: 0, head: -4, tw: -6, spin: 70, la: [86, 110], ra: [-60, -40] }, 50, 'linear'),
  K({ hx: -13, rl: L(-13, HIP - 1, RF), ll: [94, 92], torso: -10, bend: -3, head: 4, spin: 150, la: [96, 100], ra: [-90, -80] }, 40, 'linear', 'active'),
  K({ hx: -13, rl: L(-13, HIP - 1, RF), ll: [96, 94], torso: -12, bend: -3, head: 4, spin: 235, la: [98, 102], ra: [-92, -82] }, 70, 'linear'),
  K({ hx: -13, rl: L(-13, HIP - 1, RF), ll: [96, 94], torso: -12, bend: -3, head: 4, spin: 320, la: [98, 102], ra: [-92, -82] }, 60, 'linear'),
  K({ hx: -12, rl: L(-12, HIP - 1, RF), ll: [94, 92], torso: -10, bend: -3, head: 2, spin: 368, la: [96, 100], ra: [-88, -78] }, 50, 'out'),
  K({ hx: -10, rl: L(-10, HIP - 2, RF), ll: [76, 24], torso: -2, bend: 0, head: -2, spin: 372, la: [70, 120], ra: [-40, 20] }, 90, 'inOut', 'recover'),
  K({ ...F(-4, HIP - 3, LF - 2, RF, 6, 0), torso: 6, bend: 1, head: -4, spin: 362, la: [52, 140], ra: [24, 150] }, 90, 'inOut'),
  K({ ...F(-1, HIP - 1, LF, RF), torso: 6, head: -4, spin: 360 }, 0, 'sine', 'footstep'),
] };

// AISLE 3's ender: chamber the lead knee high, tip the torso well back and drive the foot straight
// out at chest height, heel first. Long, and it splats him on a wall.
const aisle3 = { blend: 40, limb: 'lFoot', keys: [
  K({ hx: -6, rl: L(-6, HIP - 3, RF), ll: [70, -50], torso: 2, bend: 0, head: 2, tw: 8, la: [40, 150], ra: [24, 160] }, 60, 'in'),
  K({ hx: -6, rl: L(-6, HIP - 1, RF), ll: [110, -52], torso: -16, bend: -3, head: 8, tw: 6, la: [60, 150], ra: [10, 150] }, 40, 'linear'),
  K({ hx: 12, rl: L(12, HIP + 3, RF), ll: [96, 94], torso: -38, bend: -8, head: 16, tw: -4, la: [92, 150], ra: [-50, -30] }, 50, 'out', 'active'),
  K({ hx: 13, rl: L(13, HIP + 3, RF), ll: [97, 95], torso: -40, bend: -8, head: 16, tw: -4, la: [94, 152], ra: [-52, -32] }, 80, 'inOut'),
  K({ hx: 8, rl: L(8, HIP + 1, RF), ll: [102, 12], torso: -20, bend: -4, head: 10, la: [74, 150], ra: [-20, 40] }, 80, 'inOut', 'recover'),
  K({ hx: 4, rl: L(4, HIP - 1, RF), ll: [60, -28], torso: -4, bend: 0, head: 2, la: [56, 150], ra: [20, 140] }, 80, 'inOut'),
  K({ ...F(2, HIP, LF, RF), torso: 4, head: -4, la: [54, 150], ra: [28, 164] }, 80, 'out', 'footstep'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4 }, 0, 'sine'),
] };

// a floppy bucket hat: a low crown and a brim drooping on both sides
function bucketHat(ctx, J, o) {
  const h = J.head, n = J.neck, r = o.headR, s = o.scale;
  let ux = h.x - n.x, uy = h.y - n.y; const Ln = Math.hypot(ux, uy) || 1; ux /= Ln; uy /= Ln;
  const fx = -uy * o.facing, fy = ux * o.facing;
  const a = Math.atan2(uy, ux);
  ctx.fillStyle = o.accent; ctx.strokeStyle = o.accent; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // crown: the top of the head, a little flattened
  const cx = h.x + ux * r * 0.25, cy = h.y + uy * r * 0.25;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.98, a - 1.45, a + 1.45); ctx.closePath(); ctx.fill();
  // brim: wider than the head, drooping down at both ends
  const bx = h.x + ux * r * 0.32, by = h.y + uy * r * 0.32;
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.moveTo(bx - fx * r * 1.42 - ux * r * 0.3, by - fy * r * 1.42 - uy * r * 0.3);
  ctx.quadraticCurveTo(bx + ux * r * 0.2, by + uy * r * 0.2, bx + fx * r * 1.5 - ux * r * 0.32, by + fy * r * 1.5 - uy * r * 0.32);
  ctx.stroke();
  // a band in the body's neon
  ctx.strokeStyle = o.color; ctx.lineWidth = 1.4 * s;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.98, a - 1.45, a - 1.1); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.98, a + 1.1, a + 1.45); ctx.stroke();
}

// The celebration (registry `dance`, played by the match winner under the WINS banner): A mop shuffle: side to side with the hands low as if pushing the mop, then a twirl of it overhead.
const dance = { keys: [
  K({ ...F(-6, HIP - 6, LF - 6, RF - 6), torso: 22, bend: 4, head: -6, la: [60, 60], ra: [40, 40] }, 220, 'inOut'),
  K({ ...F(6, HIP - 4, LF + 6, RF + 6, 0, 6), torso: 22, bend: 4, head: -6, la: [80, 70], ra: [60, 54] }, 220, 'inOut'),
  K({ ...F(-6, HIP - 6, LF - 6, RF - 6), torso: 22, bend: 4, head: -6, la: [60, 60], ra: [40, 40] }, 220, 'inOut'),
  K({ ...F(6, HIP - 4, LF + 6, RF + 6, 0, 6), torso: 22, bend: 4, head: -6, la: [80, 70], ra: [60, 54] }, 220, 'inOut'),
  K({ ...F(0, HIP, LF, RF), torso: 0, bend: -3, head: -14, la: [160, 150], ra: [170, 200] }, 200, 'out'),
  K({ ...F(0, HIP, LF, RF), torso: 0, bend: -3, head: -14, la: [200, 220], ra: [130, 120] }, 200, 'sine'),
  K({ ...F(0, HIP, LF, RF), torso: 0, bend: -3, head: -14, la: [160, 150], ra: [170, 200] }, 220, 'sine'),
] };

// The perfect round finisher (registry `perfect`, README Perfect rounds): a mop-handle golf swing: he takes it by the ankle, addresses the ball, a full backswing and a drive at the camera, then holds the follow-through.
const perfect = { name: 'MOP-HANDLE DRIVE', note: 'A mop-handle golf swing: he takes it by the ankle, addresses the ball, a full backswing and a drive at the camera, then holds the follow-through.', stamp: 'FORE!', hand: 'lHand', hold: 'ankle', fly: { spin: -2, arc: 140 }, keys: [
  ...stoop('both'),
  K({ face: 0.35, ...F(-2, HIP - 8, LF + 6, RF - 6), torso: 24, bend: 4, head: 8, la: [10, 4], ra: [6, 0] }, 220, 'inOut'),
  K({ face: 0.1, ...F(-4, HIP - 8, LF + 6, RF - 6), torso: 22, bend: 4, head: 10, tw: -10, la: [-120, -150], ra: [-110, -140] }, 300, 'inOut'),
  K({ face: 0.05, ...F(-4, HIP - 9, LF + 6, RF - 6), torso: 22, bend: 4, head: 10, tw: -12, la: [-140, -170], ra: [-130, -160] }, 80, 'sine'),
  K({ face: 0.5, ...F(0, HIP - 10, LF + 6, RF - 6), torso: 20, bend: 4, head: 10, tw: 4, la: [-8, 0], ra: [-12, -4] }, 90, 'in'),
  K({ face: 0.9, ...F(4, HIP - 4, LF + 6, RF - 6, 0, 4), torso: 0, bend: -4, head: -6, tw: 10, la: [110, 140], ra: [100, 130] }, 70, 'out', 'release'),
  K({ face: 0.85, ...F(6, HIP, LF + 6, RF - 6, 0, 6), torso: -10, bend: -6, head: -18, tw: 12, la: [160, 214], ra: [150, 206] }, 220, 'out'),
  K({ face: 0.85, ...F(6, HIP, LF + 6, RF - 6, 0, 6), torso: -10, bend: -6, head: -20, tw: 12, la: [162, 216], ra: [152, 208] }, 0, 'sine'),
] };

// Fighter mastery (README, Progression, Fighter mastery; the names are src/career/mastery.js KIT). The victory pose
// (registry `victory`, in place of the dance once it's unlocked and on): Leaning on the mop: a slouch onto an invisible mop handle, hands stacked, ankles crossed.
const victory = { keys: [
  K({ ...F(2, HIP - 2, LF + 2, RF), torso: 8, bend: 2, head: 4, la: [40, 80], ra: [40, 80] }, 220, 'inOut'),
  K({ ...F(4, HIP - 4, LF + 10, RF - 2), torso: 16, bend: 4, head: -4, la: [58, 96], ra: [52, 112] }, 260, 'out'),
  K({ ...F(4, HIP - 4, LF + 10, RF - 2), torso: 16, bend: 4, head: -6, la: [58, 96], ra: [52, 112] }, 460, 'sine'),
] };
// The taunt (registry `taunt`): the last round's winner plays it under the next ROUND card, never in a fight, and it's
// over by FIGHT (TAUNT_MAX_MS). Sweep it up: two wide sweeps along the floor at their feet.
const taunt = { keys: [
  K({ ...F(2, HIP - 6, LF + 4, RF), torso: 24, bend: 6, head: 10, la: [70, 40], ra: [60, 30] }, 220, 'out'),
  K({ ...F(2, HIP - 6, LF + 4, RF), torso: 24, bend: 6, head: 10, la: [20, -20], ra: [10, -30] }, 200, 'inOut'),
  K({ ...F(2, HIP - 6, LF + 4, RF), torso: 24, bend: 6, head: 10, la: [70, 40], ra: [60, 30] }, 200, 'inOut'),
  K({ ...F(2, HIP - 6, LF + 4, RF), torso: 24, bend: 6, head: 10, la: [20, -20], ra: [10, -30] }, 200, 'inOut'),
  K({ ...F(0, HIP, LF, RF), torso: 2, head: 0, la: [12, 24], ra: [8, 20] }, 240, 'inOut'),
] };

export default {
  dance,
  victory,
  taunt,
  perfect,
  id: 'janitor',
  name: 'JANITOR',
  tagline: 'WORKS THE LOWER FLOOR. MOPS WITH JUMP-INS',
  // how it moves (the life layer's signature, src/fighter/life.js: drawn only): unhurried: an easy sway, a neck roll, a shrug
  life: { spring: 0.95, eye: 0.9, breath: 0.9, sway: 1, swayHz: 0.4, habits: ['neckRoll', 'shrug'] },
  color: '#b46bff',
  altColor: '#5effc0',
  accent: '#ffd23f',
  stats: { health: 100, walk: 0.9, backWalk: 0.95, run: 0.92, jump: 1.04, dash: 0.95, weight: 0.98, stamina: 1, regen: 1, damage: 0.95 },
  // long and thin: the reach comes from the limbs, the width doesn't
  body: { scale: 1.02, headR: 14, upperArm: 26, lowerArm: 25, upperLeg: 33.5, lowerLeg: 32.5, upperTorso: 20, limbW: 10, limbTip: 7.6, torsoW: 13, hipW: 10, lean: 3, accessory: bucketHat },
  moves: {
    wetFloor: { rig: wetFloor, frame: { transfer: true, limb: 'foot', damage: 10, kb: { x: 300, y: 210 }, hitstun: 0, blockstun: 8, hitstop: 7, knockdown: true, height: 'low',
      travel: { vx: 320, at: 120, ms: 150 }, cost: 22, reach: 150, flashR: 28, callout: 'WET FLOOR' } },
    mopSpin: { rig: mopSpin, frame: { transfer: true, limb: 'foot', damage: 12, kb: { x: 400, y: 270 }, hitstun: 0, blockstun: 14, hitstop: 8, knockdown: true, height: 'mid',
      bothSides: true, cost: 24, reach: 105, flashR: 30, callout: 'MOP SPIN' } },
    aisle3: { rig: aisle3, frame: { transfer: 'not a press of its own: it comes out of a string, a stance, a feint or a catch', limb: 'foot', damage: 15, kb: { x: 700, y: 180 }, hitstun: 0, blockstun: 16, hitstop: 9, knockdown: true, splat: true, ender: true,
      height: 'mid', reach: 115, flashR: 34, callout: 'AISLE 3' } },
  },
  commands: [
    { button: '3', motion: 'f', move: 'wetFloor' },
    { button: '3', motion: 'b', move: 'mopSpin' },
  ],
  strings: { add: [{ name: 'AISLE 3', keys: ['3', '3', '3'], moves: ['lkick', 'lkick', 'aisle3'] }] },
  ai: {
    style: 'aerial',
    specials: [
      // he jumped over or onto me: spin (it covers behind)
      { move: 'mopSpin', min: 0, max: 120, lead: 0, chance: 0.6, cooldown: 80,
        when: (me, o) => !o.grounded && !o.rag && (o.state === 'jump' || o.state === 'attack') && o.vy > -200 },
      // a strike or a grab starting up close: the spin comes round under it
      { move: 'mopSpin', min: 0, max: 100, lead: 0, when: 'attacking', chance: 0.25, cooldown: 120 },
      { move: 'wetFloor', min: 70, max: 175, when: 'whiff', chance: 0.55, cooldown: 90 },
      { move: 'wetFloor', min: 100, max: 175, when: 'guarding', chance: 0.4, cooldown: 150 },
      { move: 'wetFloor', min: 120, max: 175, lead: 30, when: (me, o) => o.grounded && !o.crouch && o.state !== 'attack', chance: 0.18, cooldown: 160 },
      { move: 'mopSpin', min: 50, max: 105, lead: 20, when: 'standing', chance: 0.12, cooldown: 180 },
    ],
  },
  moveList: [
    { name: 'WET FLOOR', input: '→ 3', note: 'long low slide sweep, knocks down' },
    { name: 'MOP SPIN', input: '← 3', note: 'full turn, hits behind him too' },
    { name: 'AISLE 3', input: '3, 3, 3', note: 'string, long side kick, wall splat' },
  ],
  // STRATEGY, for the fighter page only (README, Site): how to beat each unique move. The game never shows it,
  // and site/vite-plugin.mjs cuts it from the bundle. Every tip is measured: `node gauntlet/counters.mjs janitor`
  // prints the numbers behind each one. Measure again when the frame data changes.
  strategy: [
    { move: 'wetFloor', tips: [
      "Crouch-block it. It's a low that slides in from far away, and a standing block up close or a jump gets swept.",
      "Blocked, he's on the floor for over half a second. The cross (2) or →2 punishes with time to spare.",
      "↘ parries it.",
      "You can beat it to the punch: a body blow (→1) thrown as he starts lands first. A roundhouse or a sweep only trades.",
    ] },
    { move: 'mopSpin', tips: [
      "It's slow. Jab (1) the moment he starts to turn and you hit him first. A throw (1+3) works too.",
      "Or hold ← and walk back. It only reaches about one step, so it whiffs, and the cross (2) punishes.",
      "Don't crouch. It's a mid, and it knocks you down whether you're crouch-blocking or not.",
      "Jumping doesn't avoid it either.",
    ] },
    { string: 'AISLE 3', tips: [
      "Stand-block it. All three kicks are mids, so crouching eats the whole string, blocking or not.",
      "Up close there's no gap between the kicks, and after the last one he's out of reach. Block it and let it go.",
      "From the very tip of his kick, hold ← and the string falls short.",
    ] },
  ],
};
