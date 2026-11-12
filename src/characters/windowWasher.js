// WINDOW WASHER: aerial. A lighter, rangier body with a higher jump, one extra jump in the air (a double
// jump, mechanics.airJumps) and a wall jump (mechanics.wallJump: a jump press next to a wall kicks off it,
// away from it). Two unique moves, Squeegee Dive (down+3 in the air, from the first jump or the second: a
// diagonal dive kick, an overhead that leaves him plus on hit) and Updraft (back+3, a rising scissor kick
// that hops lows and launches whatever it meets, the anti-air), and one unique string, STREAK FREE
// (1, 3, 4), whose ender is a two-footed dropkick that pins him to the glass near a wall.
import { RIG_KIT } from '../fighter/index.js';
import { stoop, lift } from './perfectKit.js';
import { chainPath } from '../fighter/cloth.js';

const { K, F, L, LF, RF, HIP } = RIG_KIT;

// The double jump and the wall jump: the legs snap down as if off a pane of glass, then a tucked half
// twist (spin) with the arms thrown up, the fall, and the jump's own landing. Its `air` starts about where
// the jump's arc has the hip when the second jump comes (the blend carries it from wherever it is) and
// comes down to the floor over about the time the second jump's physics takes, so the drawn body rides
// the physics instead of floating over it.
const airJump = { blend: 60, blendEase: 'out', keys: [
  K({ hx: 2, torso: 14, bend: 3, head: -6, ll: [16, 6], rl: [-12, -18], la: [-34, -6], ra: [-46, -18], air: 46 }, 60, 'out'),
  K({ hx: 4, torso: 6, head: -2, ll: [84, -36], rl: [70, -56], la: [150, 172], ra: [132, 160], air: 54 }, 110, 'out'),
  K({ hx: 6, torso: 8, head: -4, ll: [76, -44], rl: [60, -60], la: [124, 152], ra: [104, 142], air: 48 }, 130, 'sine'),
  K({ hx: 6, torso: 8, head: -4, ll: [62, -30], rl: [42, -48], la: [112, 142], ra: [92, 132], air: 28 }, 140, 'sine'),
  K({ hx: 6, torso: 14, head: -6, ll: [24, 4], rl: [-10, -16], la: [110, 120], ra: [90, 100], air: 12 }, 90, 'out'),
  K({ hx: 2, torso: 34, head: -8, ll: [52, -44], rl: [-4, -64], la: [60, 40], ra: [50, 30] }, 80, 'out', 'land'),
  K({ hx: 0, torso: 10, head: -3, ll: [26, 8], rl: [-22, -16], la: [60, 140], ra: [36, 158] }, 160, 'back', 'recover'),
  K({}, 0, 'sine'),
] };

// down+3 in the air: gather (lead knee up, both arms up as if over the squeegee pole), then the lead leg
// spears out down and forward on a diagonal with the body leaning back over it. A dive: the jump is cut
// short and the body drops (frame data dive, airRate on the clip).
const squeegeeDive = { blend: 80, blendEase: 'linear', limb: 'lFoot', air: true, airRate: 2.2, keys: [
  K({ hx: 2, ll: [96, -10], rl: [66, -64], torso: 16, bend: 4, head: -4, la: [146, 176], ra: [126, 166] }, 40, 'linear'),
  K({ hx: 10, ll: [56, 50], rl: [86, -34], torso: -6, bend: -3, head: 8, tw: 4, la: [104, 134], ra: [-52, -22] }, 40, 'out', 'active'),
  K({ hx: 13, ll: [57, 51], rl: [88, -32], torso: -8, bend: -3, head: 9, tw: 4, la: [100, 130], ra: [-56, -26] }, 160, 'linear'),
  K({ hx: 14, ll: [58, 52], rl: [88, -30], torso: -8, bend: -3, head: 9, tw: 4, la: [96, 128], ra: [-56, -26] }, 80, 'linear', 'recover'),
  K({ hx: 14, ll: [56, 46], rl: [80, -30], torso: -4, bend: -2, head: 6, la: [90, 130], ra: [-40, -10] }, 0, 'sine'),
] };

// back+3: dip, spring off the rear foot and lay back in the air while the lead leg swings up through the
// space in front of him and over his head (a scissor kick: the strike is live the whole arc), then fold
// back down and land a step on. Lows pass under it from the press until recovery.
const updraft = { blend: 40, limb: 'lFoot', shift: 10, keys: [
  K({ ...F(-3, HIP - 11, LF, RF), torso: 20, bend: 5, head: -8, la: [-24, 30], ra: [-34, 20] }, 60, 'in'),
  K({ hx: 2, ll: [84, 58], rl: [-4, -8], torso: -10, bend: -3, head: 4, la: [110, 150], ra: [94, 140], air: 28 }, 40, 'linear'),
  K({ hx: 6, ll: [142, 154], rl: [26, -40], torso: -42, bend: -8, head: 16, la: [-30, 6], ra: [-50, -20], air: 42 }, 40, 'out', 'active'),
  K({ hx: 8, ll: [170, 178], rl: [36, -36], torso: -52, bend: -10, head: 20, la: [-44, -10], ra: [-62, -32], air: 44 }, 70, 'out'),
  K({ hx: 10, ll: [120, 70], rl: [44, -24], torso: -24, bend: -4, head: 10, la: [20, 60], ra: [0, 50], air: 26 }, 90, 'in', 'recover'),
  K({ ...F(10, HIP - 12, LF + 10, RF + 6), torso: 18, bend: 5, head: -8, la: [40, 110], ra: [24, 110] }, 80, 'out', 'land'),
  K({ ...F(8, HIP - 3, LF + 10, RF + 6, 0, 6), torso: 8, head: -4, la: [54, 148], ra: [28, 160] }, 110, 'inOut', 'footstep'),
  K({ ...F(10, HIP - 1, LF + 10, RF + 10), torso: 6, head: -4 }, 0, 'sine'),
] };

// STREAK FREE's ender: a hop into a two-footed dropkick, both legs dead straight at his chest and the
// body laid back flat behind them, then a hard landing a step on.
const streakFree = { blend: 40, limb: 'rFoot', shift: 20, keys: [
  K({ ...F(-4, HIP - 12, LF, RF), torso: 18, bend: 5, head: -8, la: [-24, 40], ra: [-34, 30] }, 70, 'in'),
  K({ hx: 6, ll: [70, 10], rl: [78, 18], torso: -16, bend: -4, head: 8, la: [100, 140], ra: [90, 130], air: 40 }, 50, 'linear'),
  K({ hx: 18, ll: [97, 93], rl: [93, 89], torso: -60, bend: -10, head: 24, la: [150, 186], ra: [140, 176], air: 52 }, 40, 'out', 'active'),
  K({ hx: 20, ll: [99, 95], rl: [95, 91], torso: -64, bend: -10, head: 26, la: [154, 190], ra: [144, 180], air: 48 }, 80, 'inOut'),
  K({ hx: 18, ll: [66, 26], rl: [58, 16], torso: -18, bend: -2, head: 10, la: [110, 150], ra: [90, 140], air: 22 }, 90, 'in', 'recover'),
  K({ ...F(20, HIP - 13, LF + 20, RF + 16), torso: 18, bend: 6, head: -8, la: [40, 110], ra: [24, 110] }, 90, 'out', 'land'),
  K({ ...F(20, HIP - 3, LF + 20, RF + 20, 0, 6), torso: 8, head: -4, la: [54, 148], ra: [28, 160] }, 110, 'inOut', 'footstep'),
  K({ ...F(20, HIP - 1, LF + 20, RF + 20), torso: 6, head: -4 }, 0, 'sine'),
] };

// A climbing harness in the accent neon: shoulder straps down the chest to a waist belt, a D-ring at the
// back of the belt with a short safety line and its carabiner hanging off it, and a squeegee holstered on
// the hip. Drawn from the joints, so it rides every pose; the safety line is a cloth chain (below) that swings.
function safetyLine(ctx, P, o) {
  const s = o.scale, b = P[P.length - 1], a = P[P.length - 2];
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = o.accent; ctx.lineWidth = 1.6 * s;
  chainPath(ctx, P); ctx.stroke();
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.beginPath(); ctx.ellipse(b.x + Math.cos(ang) * 3.2 * s, b.y + Math.sin(ang) * 3.2 * s, 3.4 * s, 2 * s, ang, 0, Math.PI * 2); ctx.stroke();
}
function harness(ctx, J, o) {
  const s = o.scale, c = J.chest, n = J.neck, h = J.hip;
  let ux = n.x - h.x, uy = n.y - h.y; const Lt = Math.hypot(ux, uy) || 1; ux /= Lt; uy /= Lt;   // up the spine
  const fx = -uy * o.facing, fy = ux * o.facing;                                                  // forward, across it
  const w = (o.R.torsoW || 15) * s * 0.5;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = o.accent; ctx.fillStyle = o.accent;
  // the straps: from the top of the shoulders, over the front of the chest, to the belt
  const top = { x: n.x - ux * 3 * s, y: n.y - uy * 3 * s };
  const belt = { x: h.x + ux * 6 * s, y: h.y + uy * 6 * s };
  ctx.lineWidth = 2.6 * s;
  ctx.beginPath(); ctx.moveTo(top.x + fx * w * 0.2, top.y + fy * w * 0.2);
  ctx.quadraticCurveTo(c.x + fx * w * 1.15, c.y + fy * w * 1.15, belt.x + fx * w * 0.95, belt.y + fy * w * 0.95); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(top.x - fx * w * 0.3, top.y - fy * w * 0.3);
  ctx.quadraticCurveTo(c.x - fx * w * 1.05, c.y - fy * w * 1.05, belt.x - fx * w * 0.95, belt.y - fy * w * 0.95); ctx.stroke();
  // the belt, across the waist
  ctx.lineWidth = 3.4 * s;
  ctx.beginPath(); ctx.moveTo(belt.x - fx * w * 1.2, belt.y - fy * w * 1.2); ctx.lineTo(belt.x + fx * w * 1.2, belt.y + fy * w * 1.2); ctx.stroke();
  // the D-ring at the back, the safety line hanging from it and the carabiner on its end
  const dx = belt.x - fx * w * 1.3, dy = belt.y - fy * w * 1.3;
  ctx.lineWidth = 1.6 * s;
  ctx.beginPath(); ctx.arc(dx, dy, 2.6 * s, 0, Math.PI * 2); ctx.stroke();
  // the squeegee in its holster on the front hip: a short handle and the blade across its end
  const qx = belt.x + fx * w * 1.25, qy = belt.y + fy * w * 1.25;
  const hx = qx + fx * 2 * s - ux * 11 * s, hy = qy + fy * 2 * s - uy * 11 * s;
  ctx.lineWidth = 2 * s;
  ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.lineWidth = 2.6 * s;
  ctx.beginPath(); ctx.moveTo(hx - fx * 5 * s, hy - fy * 5 * s); ctx.lineTo(hx + fx * 5 * s, hy + fy * 5 * s); ctx.stroke();
}

const sideOfWall = (u, sim) => (u.x - sim.bounds.x0 < sim.bounds.x1 - u.x ? -1 : 1);
const wallGap = (u, sim) => Math.min(u.x - sim.bounds.x0, sim.bounds.x1 - u.x);
// he's meeting the jump: an anti-air on its way up, or ducked under it waiting
const reads = (o) => (o.grounded && o.state === 'attack' && o.phase !== 'recovery') || (o.crouch && o.state !== 'attack');

// The celebration (registry `dance`, played by the match winner under the WINS banner): Wax on: both hands circling flat on an invisible pane, the hips swaying with them, then a wipe of the brow.
const dance = { keys: [
  K({ ...F(-6, HIP - 2, LF, RF), torso: 2, head: -6, la: [70, 110], ra: [140, 170] }, 170, 'sine'),
  K({ ...F(0, HIP - 6, LF, RF), torso: 8, head: -2, la: [120, 160], ra: [90, 100] }, 170, 'sine'),
  K({ ...F(6, HIP - 2, LF, RF), torso: 2, head: -6, la: [140, 170], ra: [70, 110] }, 170, 'sine'),
  K({ ...F(0, HIP + 1, LF, RF), torso: -2, head: -10, la: [90, 100], ra: [120, 160] }, 170, 'sine'),
  K({ ...F(-6, HIP - 2, LF, RF), torso: 2, head: -6, la: [70, 110], ra: [140, 170] }, 170, 'sine'),
  K({ ...F(0, HIP - 6, LF, RF), torso: 8, head: -2, la: [120, 160], ra: [90, 100] }, 170, 'sine'),
  K({ ...F(6, HIP - 2, LF, RF), torso: 2, head: -6, la: [140, 170], ra: [70, 110] }, 170, 'sine'),
  K({ ...F(0, HIP + 1, LF, RF), torso: -2, head: -10, la: [90, 100], ra: [120, 160] }, 170, 'sine'),
] };

// The perfect round finisher (registry `perfect`, README Perfect rounds): up by the collar, a wax-on circle, then a two-armed squeegee push at the glass; on the glass his squeegee follows the body across and down; then the wax-on circles again.
const perfect = { name: 'SQUEEGEE PUSH', note: 'Up by the collar, a wax-on circle, then a two-armed squeegee push at the glass; on the glass his squeegee follows the body across and down; then the wax-on circles again.', stamp: 'STREAK FREE', hand: 'lHand', hold: 'collar', fly: { spin: 0, arc: 40 }, slide: { dx: 300, squeegee: true }, keys: [
  ...stoop('lHand'),
  lift('collar', 'lHand', 200),
  K({ face: 0.35, ...F(0, HIP - 4, LF + 4, RF), torso: 4, head: -6, la: [100, 110], ra: [120, 170] }, 130, 'sine'),
  K({ face: 0.4, ...F(0, HIP - 4, LF + 4, RF), torso: 4, head: -6, la: [104, 112], ra: [80, 130] }, 130, 'sine'),
  K({ face: 0.6, ...F(-4, HIP - 8, LF + 2, RF - 2), torso: 6, head: -4, la: [70, 60], ra: [66, 56] }, 140, 'in'),
  K({ face: 0.95, ...F(10, HIP - 4, LF + 16, RF - 2), torso: 18, bend: 2, head: -8, la: [92, 92], ra: [90, 90] }, 80, 'out', 'release'),
  K({ face: 0.9, ...F(12, HIP - 3, LF + 16, RF + 4, 0, 4), torso: 12, head: -6, la: [96, 96], ra: [94, 94] }, 180, 'out', 'footstep'),
  K({ face: 0.6, ...F(10, HIP - 1, LF + 16, RF + 6), torso: 4, head: -6, la: [40, 110], ra: [110, 160] }, 200, 'sine'),
  K({ face: 0.6, ...F(10, HIP - 1, LF + 16, RF + 6), torso: 4, head: -6, la: [40, 110], ra: [80, 120] }, 200, 'sine'),
  K({ face: 0.6, ...F(10, HIP, LF + 16, RF + 6), torso: 4, head: -8, la: [40, 110], ra: [112, 164] }, 0, 'sine'),
] };

// Fighter mastery (README, Progression, Fighter mastery; the names are src/career/mastery.js KIT). The victory pose
// (registry `victory`, in place of the dance once it's unlocked and on): Top floor view: one hand shading the eyes, gazing out over the city, the other on the hip.
const victory = { keys: [
  K({ ...F(0, HIP - 2, LF, RF), torso: 4, head: 2, la: [60, 150], ra: [20, 30] }, 200, 'inOut'),
  K({ ...F(2, HIP, LF + 6, RF - 2), torso: -4, bend: -3, head: -10, la: [128, 232], ra: [30, -70] }, 260, 'out'),
  K({ ...F(2, HIP, LF + 6, RF - 2), torso: -4, bend: -3, head: -12, la: [128, 232], ra: [30, -70] }, 460, 'sine'),
] };
// The taunt (registry `taunt`): the last round's winner plays it under the next ROUND card, never in a fight, and it's
// over by FIGHT (TAUNT_MAX_MS). Streaky: spots a smudge in the air, wipes it in two big arcs.
const taunt = { keys: [
  K({ ...F(0, HIP - 1, LF, RF), torso: 4, head: -6, la: [100, 110], ra: [12, 24] }, 200, 'out'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 4, head: -6, la: [130, 140], ra: [12, 24] }, 180, 'inOut'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 4, head: -6, la: [80, 90], ra: [12, 24] }, 180, 'inOut'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 4, head: -6, la: [130, 140], ra: [12, 24] }, 180, 'inOut'),
  K({ ...F(0, HIP, LF, RF), torso: 2, head: 0, la: [12, 24], ra: [8, 20] }, 240, 'inOut'),
] };

export default {
  dance,
  victory,
  taunt,
  perfect,
  id: 'windowWasher',
  name: 'WINDOW WASHER',
  tagline: 'DOES FLOOR 37 FROM OUTSIDE',
  // how it moves (the life layer's signature, src/fighter/life.js: drawn only): used to the wind: loose springs, a breezy sway, a glance down
  life: { spring: 1.15, damp: 0.85, eye: 1.1, sway: 1.2, swayHz: 0.5, habits: ['glance', 'shakeOut'] },
  color: '#5b8cff',
  altColor: '#ff7a4d',
  accent: '#d8ff3a',
  // lighter (flies farther when hit) and springier: a higher jump, a touch quicker on his feet
  stats: { health: 94, walk: 1.05, backWalk: 0.95, run: 1.06, jump: 1.15, dash: 1.05, weight: 0.88, stamina: 1, regen: 1.05, damage: 0.97 },
  // rangy legs on a light frame, thin limbs; the arms stay TEMP's length so the punches don't out-poke anyone
  body: { scale: 1, headR: 14.5, upperLeg: 32.5, lowerLeg: 31.5, limbW: 11.2, limbTip: 8.5, torsoW: 13.5, hipW: 10, lean: 2, accessory: harness },
  cloth: [{ draw: safetyLine, axis: ['neck', 'hip'], at: 1, off: [-8.8, -3.4], dir: [-0.56, 0.83], hang: 0.5, len: 12.5, seg: 3, hz: 2, damping: 0.25, gravity: 400 }],
  mechanics: { airJumps: 1, wallJump: true, airJumpClip: 'wwAirJump' },
  moves: {
    wwAirJump: { rig: airJump },
    squeegeeDive: { rig: squeegeeDive, frame: { limb: 'foot', damage: 12, kb: { x: 0, y: 0 }, hitstun: 40, blockstun: 12, hitstop: 7, knockdown: false, height: 'overhead',
      air: true, dive: true, cost: 16, reach: 100, flashR: 32, callout: 'SQUEEGEE DIVE' } },
    updraft: { rig: updraft, frame: { limb: 'foot', damage: 12, kb: { x: 110, y: 470 }, hitstun: 0, blockstun: 12, hitstop: 8, knockdown: true, juggle: true, height: 'mid',
      lowInvuln: true, cost: 24, reach: 60, flashR: 32, callout: 'UPDRAFT' } },
    streakFree: { rig: streakFree, frame: { limb: 'foot', damage: 15, kb: { x: 640, y: 220 }, hitstun: 0, blockstun: 16, hitstop: 9, knockdown: true, splat: true, ender: true, height: 'mid',
      reach: 90, flashR: 38, callout: 'STREAK FREE' } },
  },
  commands: [
    { button: '3', motion: 'airDown', move: 'squeegeeDive' },
    { button: '3', motion: 'b', move: 'updraft' },
  ],
  strings: { add: [{ name: 'STREAK FREE', keys: ['1', '3', '4'], moves: ['jab', 'lkick', 'streakFree'] }] },
  ai: {
    style: 'aerial',
    specials: [
      // the anti-air: a jump-in coming at him meets the scissor kick
      { move: 'updraft', min: 30, max: 150, lead: 0, chance: 0.55, cooldown: 80,
        when: (me, o) => !o.grounded && !o.rag && (o.state === 'jump' || o.state === 'attack') && Math.sign(o.vx || 0) === Math.sign(me.x - o.x) },
      // a crouching strike coming (a low, the sweep): hop it with the scissor kick
      { move: 'updraft', min: 20, max: 110, lead: 0, chance: 0.5, cooldown: 90, when: (me, o) => o.state === 'attack' && o.phase === 'startup' && !!o.crouch },
      // cornered: jump into the wall, kick off it over him and come down behind him
      { name: 'wallEscape', cost: 18, min: 0, max: 150, lead: 0, chance: 0.6, cooldown: 200,
        when: (me, o, sim) => wallGap(me, sim) < 60 && Math.sign(o.x - me.x) === -sideOfWall(me, sim) && me.grounded,
        plan: (me, o, sim, dist, toward, k) => [
          { ...k.move(-toward, 3), jump: true },
          k.move(-toward, (m) => wallGap(m, sim) < 24 || m.vy > 150 || m.grounded),
          { ...k.move(toward, 3), jump: true },
          k.move(toward, (m) => k.landed(m)),
        ] },
      // the jump-in, watching him on the way: if he goes for the anti-air (or ducks under it) the second
      // jump carries him over the top and down behind him; otherwise the dive comes down on him from the front
      { name: 'jumpIn', cost: 26, min: 110, max: 300, lead: 0, chance: 0.55, cooldown: 120,
        when: (me, o) => o.grounded && me.grounded && !o.rag,
        plan: (me, o, sim, dist, toward, k) => [
          { ...k.move(toward, 3), jump: true },
          k.move(toward, (m, op) => k.landed(m) || reads(op) || (m.vy > -60 && Math.abs(op.x - m.x) < 125)),
          { ...k.move(toward, 3), jump: true, onlyIf: (m, op) => !m.grounded && reads(op) },
          k.move(toward, (m, op) => k.landed(m) || (m.vy > 40 && Math.abs(op.x - m.x) < 125 && Math.sign(op.x - m.x) === toward)),
          { ...k.press('d3'), onlyIf: (m, op) => !m.grounded && Math.sign(op.x - m.x) === toward && !reads(op) },
          k.move(0, (m) => k.landed(m)),
          k.press('1'),
        ] },
      // from closer in: straight up and over him on the second jump, a cross-up, and a jab on landing
      { name: 'crossUp', cost: 30, min: 70, max: 150, lead: 0, chance: 0.3, cooldown: 200,
        when: (me, o) => o.grounded && me.grounded && o.state !== 'attack',
        plan: (me, o, sim, dist, toward, k) => [
          { ...k.move(toward, 3), jump: true },
          k.move(toward, (m) => m.vy > -160 || m.grounded),
          { ...k.move(toward, 3), jump: true },
          k.move(toward, (m) => k.landed(m)),
          k.press('1'),
        ] },
    ],
  },
  moveList: [
    { name: 'SQUEEGEE DIVE', input: '↓3 in air', note: 'diagonal dive kick, overhead' },
    { name: 'UPDRAFT', input: '← 3', note: 'rising scissor kick, anti-air, launches' },
    { name: 'STREAK FREE', input: '1, 3, 4', note: 'string, dropkick, wall splat' },
    { name: 'AIR JUMP', input: '↑ in air', note: 'one more jump, or kick off a wall' },
  ],
  // STRATEGY, for the fighter page only (README, Site): how to beat each unique move. The game never shows it,
  // and site/vite-plugin.mjs cuts it from the bundle. Every tip is measured: `node gauntlet/counters.mjs windowWasher`
  // prints the numbers behind each one. Measure again when the frame data changes.
  strategy: [
    { move: 'squeegeeDive', tips: [
      "It's an overhead. Stand-block it. Crouching gets you kicked, blocking or not.",
      "→ parries it. Tap as he comes down on you.",
      "It's safe once it's blocked, so don't swing after it.",
    ] },
    { move: 'updraft', tips: [
      "Stand-block it. It's a mid and it's fast. Up close, any strike you press into it trades or loses, lows included.",
      "Blocked, he's stuck in the air for a long time. Punish with the cross (2).",
      "→ parries it.",
    ] },
    { string: 'STREAK FREE', tips: [
      "Stand-block all three. There's no gap to hit him in, so don't press until the dropkick is blocked.",
      "Then he's flat on the floor. As soon as you can move, the cross (2) or →2 punishes.",
      "Or crouch from the start. The first jab goes over your head, the string stops there, and a low kick (↓3) punishes.",
    ] },
  ],
};
