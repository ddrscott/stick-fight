// WELLNESS COACH: flexibility and a stance. A slim rig on long legs with thin limbs (the legs give the
// reach, the thin limbs keep the hitbox and hurtbox small), a lighter body, quick stamina. Her unique
// move is Tree Pose (b+1), a stance (the `stance` hook): she stands on the rear leg with the lead foot
// tucked to the knee and the hands together, held while 1 is held (or a short beat on a tap), and from
// it 4 is Crane Kick (the tucked leg snaps up to his chin with her body laid back under it: mid,
// launches, highs pass under her), 3 is Root Sweep (a low sweep along the floor, knockdown) and 2 is
// Exhale (step out of it). One unique string, SUN SALUTATION (1, 3, 4), ending in a backbend over a
// vertical split kick that comes down on top of him (an overhead). Keeps every shared string.
import { RIG_KIT } from '../fighter/index.js';

const { K, F, L, LF, RF, HIP, deepKeys, base } = RIG_KIT;

// the tree: the weight goes onto the rear leg, the lead knee comes up and turns out with the foot resting
// on the standing knee, the hands meet at the sternum; she breathes in it, wobbles a hair, and puts the foot
// down at the end. The stance never strikes; its buttons do (frame data stance).
const TREE = { hx: -6, rl: [1, -1], ll: [64, -58], torso: 1, bend: -2, head: -4, tw: 2, la: [172, 182], ra: [168, 178] };
const treePose = { blend: 60, keys: [
  K({ hx: -4, rl: [6, -6], ll: [40, -16], torso: 3, bend: 0, head: -2, tw: 2, la: [100, 160], ra: [90, 160] }, 50, 'in'),
  K({ ...TREE }, 50, 'out', 'active'),
  K({ ...TREE, rl: [0, -2], torso: 0, bend: -3, head: -5, la: [174, 184], ra: [170, 180] }, 520, 'sine'),
  K({ ...TREE, rl: [2, 0], torso: 2, bend: -1, head: -3, la: [171, 181], ra: [167, 177] }, 520, 'sine'),
  K({ ...TREE }, 120, 'inOut', 'recover'),
  K({ ...F(-2, HIP - 3, LF, RF + 6, 6, 0), torso: 4, head: -3, la: [48, 146], ra: [30, 158] }, 110, 'out', 'footstep'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 5, head: -3 }, 0, 'sine'),
] };

// 4 in the tree: the tucked leg unfolds straight up and out to his chin while she lays back under it,
// arms out wide for balance. Low-profile (tc: highs go over her), launches.
const craneKick = { blend: 30, limb: 'lFoot', shift: 8, keys: [
  K({ hx: -8, rl: [2, -2], ll: [102, -24], torso: -8, bend: -4, head: 2, tw: 4, la: [150, 172], ra: [154, 176] }, 40, 'out'),
  K({ hx: -5, rl: [6, 0], ll: [128, 126], torso: -24, bend: -8, head: 14, tw: 8, la: [124, 150], ra: [-58, -40] }, 40, 'out', 'active'),
  K({ hx: -5, rl: [6, 0], ll: [134, 132], torso: -27, bend: -9, head: 16, tw: 8, la: [128, 154], ra: [-62, -44] }, 70, 'inOut'),
  K({ hx: -4, rl: [4, -2], ll: [104, 30], torso: -12, bend: -4, head: 8, tw: 4, la: [84, 132], ra: [-20, 20] }, 90, 'inOut', 'recover'),
  K({ hx: 2, rl: L(2, HIP - 2, RF + 6), ll: [50, -10], torso: 2, bend: 0, head: -2, la: [50, 130], ra: [24, 140] }, 90, 'inOut'),
  K({ ...F(6, HIP - 2, LF + 8, RF + 6), torso: 5, head: -3, la: [54, 148], ra: [28, 164] }, 90, 'out', 'footstep'),
  K({ ...F(8, HIP - 1, LF + 8, RF + 8), torso: 6, head: -3 }, 0, 'sine'),
] };

// 3 in the tree: the tucked foot plants ahead, she drops onto it and the rear leg sweeps round flat
// along the floor, a hand down beside her.
const rootSweep = { blend: 50, limb: 'rFoot', height: 'low', keys: [
  K({ hx: 4, ll: L(4, 50, LF + 6), rl: [-24, -40], torso: 4, bend: -2, head: 0, tw: -8, la: [60, 150], ra: [-20, 120] }, 70, 'in'),
  ...deepKeys(base('sweep')).slice(2),
] };

// 2 in the tree (and the tree's own way out when 1 is let go): the foot comes down, the hands part and
// float down with a breath, back to the guard. Never strikes.
const exhale = { blend: 50, keys: [
  K({ hx: -4, rl: L(-4, HIP - 1, RF + 6), ll: [40, -20], torso: 2, bend: -2, head: -6, tw: 2, la: [60, 110], ra: [50, 120] }, 70, 'out'),
  K({ ...F(-1, HIP - 4, LF, RF + 3), torso: 4, bend: 0, head: -2, la: [30, 60], ra: [24, 56] }, 70, 'inOut', 'recover'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 5, head: -3, la: [52, 146], ra: [30, 164] }, 80, 'out', 'footstep'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 5, head: -3 }, 0, 'sine'),
] };

// SUN SALUTATION's ender: she lays back into a backbend, the hands reaching for the floor behind her, the
// rear leg sweeps up over the top in a split and the heel comes down on him. An overhead, low-profile.
const sunSalutation = { blend: 40, limb: 'rFoot', shift: 18, keys: [
  K({ hx: 4, ll: L(4, HIP - 3, LF + 4), rl: [-30, -46], torso: 6, bend: 0, head: -2, tw: -6, la: [40, 120], ra: [30, 110] }, 60, 'in'),
  K({ hx: 0, ll: L(0, HIP - 6, LF + 4), rl: [60, 20], torso: -22, bend: -10, head: 16, tw: -2, la: [-30, -10], ra: [-40, -20] }, 70, 'out'),
  K({ hx: -4, ll: L(-4, HIP - 9, LF + 4), rl: [156, 164], torso: -40, bend: -12, head: 22, tw: 2, la: [-70, -60], ra: [-80, -70] }, 70, 'out'),
  K({ hx: 4, ll: L(4, HIP - 7, LF + 4), rl: [122, 112], torso: -24, bend: -8, head: 16, tw: 4, la: [-60, -40], ra: [-70, -50] }, 40, 'in', 'active'),
  K({ hx: 8, ll: L(8, HIP - 8, LF + 4), rl: [96, 82], torso: -10, bend: -4, head: 8, tw: 4, la: [-30, 10], ra: [-40, 0] }, 60, 'out'),
  K({ ...F(12, HIP - 9, LF + 4, 40), torso: 8, bend: 2, head: -2, la: [10, 80], ra: [0, 70] }, 80, 'out', 'footstep'),
  K({ ...F(14, HIP - 6, LF + 4, 40), torso: 10, bend: 2, head: -4, la: [40, 120], ra: [24, 130] }, 120, 'inOut', 'recover'),
  K({ ...F(16, HIP - 2, LF + 18, 40, 8, 0), torso: 6, head: -4, la: [54, 148], ra: [28, 162] }, 100, 'inOut', 'footstep'),
  K({ ...F(18, HIP - 1, LF + 18, RF + 18), torso: 6, head: -3 }, 0, 'sine'),
] };

// a headband with its tails flying off the back, and a rolled yoga mat slung across the back on a strap
function headbandAndMat(ctx, J, o) {
  const h = J.head, n = J.neck, hip = J.hip, s = o.scale, r = o.headR;
  let ux = h.x - n.x, uy = h.y - n.y; const L0 = Math.hypot(ux, uy) || 1; ux /= L0; uy /= L0;
  const fx = -uy * o.facing, fy = ux * o.facing;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // the mat: a fat roll behind the shoulders, angled down the back, with the strap across the chest
  let tx = n.x - hip.x, ty = n.y - hip.y; const LT = Math.hypot(tx, ty) || 1; tx /= LT; ty /= LT;
  const bx = ty * o.facing, by = -tx * o.facing;   // toward her back
  const m0 = { x: n.x + bx * 9 * s + tx * 4 * s, y: n.y + by * 9 * s + ty * 4 * s }, m1 = { x: hip.x + bx * 13 * s + tx * 6 * s, y: hip.y + by * 13 * s + ty * 6 * s };
  ctx.strokeStyle = '#0a0414'; ctx.lineWidth = 9.5 * s; ctx.beginPath(); ctx.moveTo(m0.x, m0.y); ctx.lineTo(m1.x, m1.y); ctx.stroke();
  ctx.strokeStyle = o.accent; ctx.lineWidth = 7 * s; ctx.beginPath(); ctx.moveTo(m0.x, m0.y); ctx.lineTo(m1.x, m1.y); ctx.stroke();
  ctx.strokeStyle = '#0a0414'; ctx.lineWidth = 1.2 * s;
  for (const p of [m0, m1]) { ctx.beginPath(); ctx.arc(p.x, p.y, 2.2 * s, 0, Math.PI * 2); ctx.stroke(); }
  ctx.strokeStyle = o.accent; ctx.lineWidth = 1.6 * s;
  ctx.beginPath(); ctx.moveTo(m0.x, m0.y); ctx.lineTo(hip.x - bx * 6 * s + tx * 10 * s, hip.y - by * 6 * s + ty * 10 * s); ctx.stroke();
  // the headband round the forehead, the knot behind, two tails
  const a = Math.atan2(uy, ux);
  ctx.strokeStyle = o.accent; ctx.lineWidth = 3.4 * s;
  ctx.beginPath(); ctx.arc(h.x, h.y, r * 0.98, a - 1.15, a + 1.15); ctx.stroke();
  const kx = h.x - fx * r * 0.95 + ux * r * 0.35, ky = h.y - fy * r * 0.95 + uy * r * 0.35;
  ctx.lineWidth = 2.2 * s;
  ctx.beginPath(); ctx.moveTo(kx, ky); ctx.quadraticCurveTo(kx - fx * r * 0.6, ky - fy * r * 0.6 + 2 * s, kx - fx * r * 1.1 - ux * r * 0.3, ky - fy * r * 1.1 - uy * r * 0.3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(kx, ky); ctx.quadraticCurveTo(kx - fx * r * 0.5, ky - fy * r * 0.5 - 4 * s, kx - fx * r * 0.9 - ux * r * 0.7, ky - fy * r * 0.9 - uy * r * 0.7); ctx.stroke();
}

// the tree's buttons: 4 the crane kick, 3 the sweep, 2 a step out; let go of 1 and she steps out too
const TREE_STANCE = { moves: { 2: 'wellness_exhale', 3: 'wellness_rootSweep', 4: 'wellness_craneKick' }, hold: '1', min: 380, exit: 'wellness_exhale' };

export default {
  id: 'wellness',
  name: 'WELLNESS COACH',
  tagline: 'BREATHE IN. NOW BREATHE THROUGH THE FLOOR',
  // how it moves (the life layer's signature, src/fighter/life.js: drawn only): calm: soft springs, a slow eye, a slow deep breath you can see, long breaths in and out
  life: { spring: 0.8, damp: 1.2, eye: 0.8, breath: 0.55, breathAmp: 2.2, sway: 0.9, swayHz: 0.2, habits: ['deepBreath'] },
  color: '#5dff8a',
  pants: '#ff2bd6',
  altColor: '#b78bff',
  altPants: '#2ef2ff',
  accent: '#2ef2ff',
  // a lighter body and quick stamina, everything else about average
  stats: { health: 104, walk: 1.02, backWalk: 1.05, run: 1.02, jump: 1.08, dash: 1, weight: 0.98, stamina: 1, regen: 1.2, damage: 1.03 },
  body: { scale: 0.98, headR: 14.5, upperArm: 24, lowerArm: 23, upperLeg: 33.5, lowerLeg: 32.5, lowerTorso: 17, upperTorso: 19, limbW: 10.8, limbTip: 8.5, torsoW: 13, hipW: 10.5, lean: -1, accessory: headbandAndMat },
  moves: {
    wellness_treePose: { rig: treePose, frame: { limb: 'foot', damage: 0, kb: { x: 0, y: 0 }, hitstun: 0, blockstun: 0, hitstop: 0, height: 'mid', cost: 10, reach: 60, flashR: 0,
      stance: TREE_STANCE } },
    wellness_craneKick: { rig: craneKick, frame: { limb: 'foot', damage: 12, kb: { x: 120, y: 470 }, hitstun: 0, blockstun: 14, hitstop: 9, knockdown: true, juggle: true, height: 'mid', tc: true,
      stanceOnly: true, cost: 20, reach: 75, flashR: 34, callout: 'CRANE KICK' } },
    wellness_rootSweep: { rig: rootSweep, frame: { limb: 'foot', damage: 10, kb: { x: 250, y: 200 }, hitstun: 0, blockstun: 8, hitstop: 7, knockdown: true, height: 'low', tc: true,
      travel: { vx: 220, at: 50, ms: 110 }, stanceOnly: true, cost: 18, reach: 85, flashR: 28, callout: 'ROOT SWEEP' } },
    wellness_exhale: { rig: exhale, frame: { limb: 'hand', damage: 0, kb: { x: 0, y: 0 }, hitstun: 0, blockstun: 0, hitstop: 0, height: 'mid', noHit: true, stanceOnly: true, cost: 0, reach: 40, flashR: 0 } },
    wellness_sunSalutation: { rig: sunSalutation, frame: { limb: 'foot', damage: 15, kb: { x: 300, y: 300 }, hitstun: 0, blockstun: 14, hitstop: 10, knockdown: true, ender: true, height: 'overhead', tc: true,
      reach: 85, flashR: 38, callout: 'SUN SALUTATION' } },
  },
  commands: [
    { button: '1', motion: 'b', move: 'wellness_treePose' },
  ],
  strings: { add: [{ name: 'SUN SALUTATION', keys: ['1', '3', '4'], moves: ['jab', 'lkick', 'wellness_sunSalutation'] }] },
  ai: {
    style: null,
    range: 'mid',
    specials: [
      // into the tree at the edge of her reach, then read him: a crouch eats the crane kick (a mid), a
      // standing guard the sweep (a low)
      { name: 'treeRead', cost: 30, min: 60, max: 120, lead: 30, chance: 0.4, cooldown: 140,
        when: (me, o) => o.grounded && o.state !== 'jump' && !o.rag && (o.state === 'idle' || o.state === 'walk' || o.state === 'block' || o.state === 'crouch'),
        plan: (me, o, sim, dist, toward, k) => [
          k.attack('wellness_treePose'),
          k.move(0, (m) => m.state !== 'attack' || m.move !== 'wellness_treePose' || m.phase === 'active'),
          { ...k.move(0, 2), onlyIf: (m) => m.move === 'wellness_treePose',
            pressFn: (m, op) => (op.crouch ? '4' : op.backHeld || op.state === 'block' ? '3' : k.chance(0.5) ? '4' : '3') },
        ] },
      // a whiff in range: the tree and the crane kick off it
      { name: 'treePunish', cost: 30, min: 40, max: 110, lead: 0, chance: 0.5, cooldown: 120, when: 'whiff',
        plan: (me, o, sim, dist, toward, k) => [
          k.attack('wellness_treePose'),
          k.move(0, (m) => m.state !== 'attack' || m.move !== 'wellness_treePose' || m.phase === 'active'),
          { ...k.press('4'), onlyIf: (m) => m.move === 'wellness_treePose' },
        ] },
      // open with the jab for 1, 3, 4 when there's bar for it
      { move: 'jab', min: 0, max: 84, when: (me, o) => o.grounded && !o.crouch && o.state !== 'attack' && me.stamina > 74, chance: 0.3, cooldown: 100 },
    ],
  },
  moveList: [
    { name: 'TREE POSE', input: '← 1 (hold)', note: 'stance: 4 crane kick, 3 sweep, 2 out' },
    { name: 'CRANE KICK', input: '← 1, 4', note: 'laid-back high kick, launches' },
    { name: 'ROOT SWEEP', input: '← 1, 3', note: 'low sweep, knocks down' },
    { name: 'SUN SALUTATION', input: '1, 3, 4', note: 'string, overhead split kick' },
  ],
};
