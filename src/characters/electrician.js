// ELECTRICIAN: facilities, control. TEMP's frame with a slightly thicker torso; average on his feet,
// a touch lighter on damage. Two unique moves: Live Wire (f+1, a lead-hand tester poke that shocks:
// the `shock` hook adds stun on top of the hitstun, once per combo and shrinking with it, while he
// jitters and crackles) and Ground Fault (df+3, a low stamp onto his front foot that roots him: the
// `root` hook, no walking or jumping for half a second once the stun ends; he can still guard). One
// unique string, SHORT CIRCUIT (2, 1, 2), ending in a two-handed palm thrust that closes the circuit.
// Keeps every shared string.
import { RIG_KIT } from '../fighter/index.js';
import { stoop, lift } from './perfectKit.js';
import { chainPath } from '../fighter/cloth.js';

const { K, F, L, LF, RF, HIP, CH } = RIG_KIT;

// f+1: the lead hand comes back to the chest with two fingers out, then snaps straight out at chest
// height behind a half step, the rear hand tucked; a quick recoil.
const liveWire = { blend: 40, limb: 'lHand', shift: 10, keys: [
  K({ ...F(-2, HIP - 2, LF, RF), torso: 3, bend: -1, head: -2, tw: 6, la: [30, 120], ra: [28, 164] }, 50, 'in'),
  K({ ...F(-3, HIP - 4, LF, RF), torso: 1, bend: -2, head: -1, tw: 10, la: [20, 110], ra: [26, 166] }, 40, 'in'),
  K({ ...F(8, HIP - 5, LF + 10, RF, 5, 0), torso: 12, bend: 2, head: -4, tw: -6, la: [74, 92], ra: [30, 160] }, 30, 'linear'),
  K({ ...F(13, HIP - 5, LF + 10, RF), torso: 18, bend: 3, head: -6, tw: -14, la: [90, 88], ra: [34, 158] }, 40, 'out', 'active'),
  K({ ...F(13, HIP - 5, LF + 10, RF), torso: 18, bend: 3, head: -6, tw: -14, la: [91, 89], ra: [34, 158] }, 50, 'inOut'),
  K({ ...F(12, HIP - 4, LF + 10, RF), torso: 15, bend: 2, head: -5, tw: -10, la: [80, 70], ra: [32, 160] }, 90, 'in', 'recover'),
  K({ ...F(9, HIP - 1, LF + 10, RF + 6, 0, 6), torso: 7, head: -4, la: [56, 146], ra: [30, 164] }, 100, 'out', 'footstep'),
  K({ ...F(10, HIP - 1, LF + 10, RF + 10), torso: 6, head: -4 }, 0, 'sine'),
] };

// df+3: down into a half crouch, the lead knee lifts and the foot stamps down onto his front foot, the
// hands out low for balance, then back up.
const groundFault = { blend: 40, limb: 'lFoot', keys: [
  K({ hx: -4, rl: L(-4, HIP - 8, RF), ll: [40, -10], torso: 12, bend: 4, head: -4, tw: 4, la: [30, 100], ra: [20, 110] }, 60, 'in'),
  K({ hx: -2, rl: L(-2, HIP - 12, RF), ll: [86, 10], torso: 16, bend: 5, head: -6, tw: 2, la: [20, 70], ra: [10, 80] }, 50, 'out'),
  K({ hx: 10, rl: L(10, HIP - 16, RF), ll: [68, 42], torso: 24, bend: 6, head: -10, tw: -4, la: [-20, 30], ra: [40, 100] }, 40, 'in', 'active'),
  K({ hx: 11, rl: L(11, HIP - 17, RF), ll: [66, 38], torso: 26, bend: 6, head: -10, tw: -4, la: [-22, 28], ra: [42, 102] }, 70, 'inOut'),
  K({ hx: 9, rl: L(9, HIP - 13, RF), ll: [58, 10], torso: 18, bend: 4, head: -8, tw: -2, la: [10, 80], ra: [30, 120] }, 80, 'inOut', 'recover'),
  K({ ...F(6, HIP - 4, LF + 6, RF), torso: 8, head: -4, la: [50, 146], ra: [28, 162] }, 90, 'out', 'footstep'),
  K({ ...F(6, HIP - 1, LF + 6, RF + 6), torso: 6, head: -3 }, 0, 'sine'),
] };

// SHORT CIRCUIT's ender: both hands pulled back to the ribs, a long step, and both palms drive out
// together at the chest, the body behind them.
const shortCircuit = { blend: 40, limb: 'rHand', shift: 28, keys: [
  K({ ...F(-4, HIP - 5, LF, RF), torso: -2, bend: -3, head: 4, tw: -8, la: [-14, 96], ra: [-24, 92] }, 70, 'in'),
  K({ ...F(6, HIP - 9, LF + 20, RF, 8, 0), torso: 10, bend: 2, head: -2, tw: -2, la: [30, 92], ra: [22, 90] }, 50, 'linear'),
  K({ ...F(18, HIP - 10, LF + 30, RF), torso: 24, bend: 5, head: -8, tw: 2, la: [86, 84], ra: [84, 82] }, 40, 'out', 'active'),
  K({ ...F(20, HIP - 10, LF + 30, RF + 4), torso: 26, bend: 5, head: -8, tw: 2, la: [88, 86], ra: [86, 84] }, 90, 'inOut'),
  K({ ...F(18, HIP - 6, LF + 30, RF + 8), torso: 14, bend: 2, head: -6, la: [50, 116], ra: [42, 118] }, 110, 'inOut', 'recover'),
  K({ ...F(24, HIP - 2, LF + 30, RF + 28, 0, 8), torso: 7, head: -4, la: [54, 148], ra: [30, 162] }, 110, 'inOut', 'footstep'),
  K({ ...F(28, HIP - 1, LF + 28, RF + 28), torso: 6, head: -4 }, 0, 'sine'),
] };

// the shock's jitter, played on the rig's additive reaction layer (frame data shock.clip): the torso,
// head and arms buzz around wherever the reaction has him, fast and shrinking, and settle at zero
const JIT = [[9, -14, 26, -30], [-8, 12, -22, 24], [7, -10, 30, -18], [-9, 14, -26, 28], [6, -12, 20, -24], [-7, 10, -24, 20]];
const shocked = { blend: 0, keys: [
  ...Array.from({ length: 18 }, (_, i) => {
    const [t, hd, a, b] = JIT[i % JIT.length], k = 1 - i / 22;
    return K({ torso: 6 + t * k, bend: (i % 2 ? 4 : -4) * k, head: -4 + hd * k, tw: (i % 2 ? 5 : -5) * k, la: [55 + a * k, 150 + b * k], ra: [30 - a * k, 165 - b * k] }, 36, 'linear');
  }),
  K({}, 0, 'linear'),
] };

// a hard hat with a brim and a ridge, and a tool belt slung round the hips with a pouch (the tester hanging
// off the belt is a cloth chain, below)
// the voltage tester on its lead, hanging off the back of the belt
function tester(ctx, P, o) {
  const s = o.scale;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 2.4 * s; chainPath(ctx, P); ctx.stroke();
  const b = P[P.length - 1];
  ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(b.x, b.y, 1.9 * s, 0, Math.PI * 2); ctx.fill();
}
function hardHatAndBelt(ctx, J, o) {
  const h = J.head, n = J.neck, hip = J.hip, s = o.scale, r = o.headR;
  let ux = h.x - n.x, uy = h.y - n.y; const L0 = Math.hypot(ux, uy) || 1; ux /= L0; uy /= L0;
  const fx = -uy * o.facing, fy = ux * o.facing;
  const a = Math.atan2(uy, ux);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // the belt: a band across the hips with a pouch on the near hip and a tester hanging from it
  let tx = n.x - hip.x, ty = n.y - hip.y; const LT = Math.hypot(tx, ty) || 1; tx /= LT; ty /= LT;
  const ax = ty * o.facing, ay = -tx * o.facing;
  const bc = { x: hip.x + tx * 4 * s, y: hip.y + ty * 4 * s };
  ctx.strokeStyle = '#1a1206'; ctx.lineWidth = 5.5 * s;
  ctx.beginPath(); ctx.moveTo(bc.x - ax * 11 * s, bc.y - ay * 11 * s); ctx.lineTo(bc.x + ax * 11 * s, bc.y + ay * 11 * s); ctx.stroke();
  ctx.strokeStyle = o.accent; ctx.lineWidth = 2.2 * s;
  ctx.beginPath(); ctx.moveTo(bc.x - ax * 10 * s, bc.y - ay * 10 * s); ctx.lineTo(bc.x + ax * 10 * s, bc.y + ay * 10 * s); ctx.stroke();
  const pc = { x: bc.x - ax * 6 * s - tx * 7 * s, y: bc.y - ay * 6 * s - ty * 7 * s };
  ctx.fillStyle = '#1a1206'; ctx.strokeStyle = o.accent; ctx.lineWidth = 1.4 * s;
  ctx.beginPath(); ctx.rect(pc.x - 4.5 * s, pc.y - 5 * s, 9 * s, 10 * s); ctx.fill(); ctx.stroke();
  // the hat: a dome over the crown, a ridge down the middle, a brim out the front and a lip behind
  ctx.fillStyle = o.accent; ctx.strokeStyle = '#1a1206'; ctx.lineWidth = 1.6 * s;
  ctx.beginPath(); ctx.arc(h.x + ux * r * 0.1, h.y + uy * r * 0.1, r * 1.08, a - 1.45, a + 1.45); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 1.3 * s;
  ctx.beginPath(); ctx.moveTo(h.x + ux * r * 0.35, h.y + uy * r * 0.35); ctx.lineTo(h.x + ux * r * 1.16, h.y + uy * r * 1.16); ctx.stroke();
  const bx = h.x + ux * r * 0.32, by = h.y + uy * r * 0.32;
  ctx.strokeStyle = o.accent; ctx.lineWidth = 3.2 * s;
  ctx.beginPath(); ctx.moveTo(bx - fx * r * 1.15, by - fy * r * 1.15); ctx.lineTo(bx + fx * r * 1.55, by + fy * r * 1.55); ctx.stroke();
}

// The celebration (registry `dance`, played by the match winner under the WINS banner): The electric boogaloo: a wave of current runs out one arm, through the shoulders and out the other, popping.
const dance = { keys: [
  K({ ...F(0, HIP - 2, LF, RF), torso: 2, head: -4, la: [90, 90], ra: [-90, -90] }, 140, 'snap'),
  K({ ...F(0, HIP - 2, LF, RF), torso: 2, head: -4, la: [90, 130], ra: [-90, -90] }, 120, 'snap'),
  K({ ...F(0, HIP - 2, LF, RF), torso: 4, head: -10, tw: 6, la: [70, 150], ra: [-90, -90] }, 120, 'snap'),
  K({ ...F(0, HIP - 4, LF, RF), torso: 0, head: 6, tw: -6, la: [90, 90], ra: [-70, -150] }, 120, 'snap'),
  K({ ...F(0, HIP - 2, LF, RF), torso: 2, head: -4, la: [90, 90], ra: [-90, -130] }, 120, 'snap'),
  K({ ...F(0, HIP - 2, LF, RF), torso: 2, head: -4, la: [90, 90], ra: [-90, -90] }, 160, 'snap'),
  K({ ...F(0, HIP - 6, LF, RF), torso: 10, bend: 4, head: 10, la: [40, 120], ra: [30, 120] }, 140, 'snap'),
  K({ ...F(0, HIP - 6, LF, RF), torso: 12, bend: 4, head: 12, la: [42, 124], ra: [32, 122] }, 160, 'linear'),
] };

// The perfect round finisher (registry `perfect`, README Perfect rounds): up by the collar while the tester hand gives it a few jolts (the body jitters), then a flick at the camera; the boogaloo wave after.
const perfect = { name: 'LIVE CIRCUIT FLICK', note: 'Up by the collar while the tester hand gives it a few jolts (the body jitters), then a flick at the camera; the boogaloo wave after.', stamp: 'GROUNDED', hand: 'lHand', hold: 'collar', fly: { spin: 1, arc: 60, wobble: 1.5 }, keys: [
  ...stoop('lHand'),
  lift('collar', 'lHand', 200),
  K({ face: 0.2, ...F(2, HIP - 3, LF + 4, RF), torso: 4, head: -6, la: [110, 118], ra: [80, 86] }, 50, 'linear'),
  K({ face: 0.3, ...F(2, HIP - 2, LF + 4, RF), torso: 4, head: -6, la: [98, 106], ra: [84, 90] }, 50, 'linear'),
  K({ face: 0.2, ...F(2, HIP - 3, LF + 4, RF), torso: 4, head: -6, la: [112, 120], ra: [80, 86] }, 50, 'linear'),
  K({ face: 0.3, ...F(2, HIP - 2, LF + 4, RF), torso: 4, head: -6, la: [98, 106], ra: [84, 90] }, 50, 'linear'),
  K({ face: 0.25, ...F(2, HIP - 3, LF + 4, RF), torso: 4, head: -6, la: [110, 118], ra: [80, 86] }, 50, 'linear'),
  K({ face: 0.55, ...F(-4, HIP - 8, LF, RF - 4), torso: 10, head: -4, la: [40, 60], ra: [30, 110] }, 160, 'in'),
  K({ face: 0.9, ...F(6, HIP, LF + 8, RF - 4), torso: -8, bend: -4, head: -12, la: [134, 144], ra: [30, 120] }, 80, 'out', 'release'),
  K({ face: 0.85, ...F(8, HIP - 1, LF + 8, RF), torso: 0, head: -8, la: [120, 160], ra: [40, 120] }, 200, 'out', 'footstep'),
  K({ face: 0.6, ...F(8, HIP - 1, LF + 8, RF), torso: 2, head: -6, la: [90, 160], ra: [60, 30] }, 200, 'sine'),
  K({ face: 0.6, ...F(8, HIP - 1, LF + 8, RF), torso: 2, head: -6, la: [60, 30], ra: [90, 160] }, 200, 'sine'),
  K({ face: 0.6, ...F(8, HIP, LF + 8, RF), torso: 2, head: -8, la: [90, 164], ra: [60, 30] }, 0, 'sine'),
] };

export default {
  dance,
  perfect,
  id: 'electrician',
  name: 'ELECTRICIAN',
  tagline: 'DID YOU TRY TURNING YOURSELF OFF AND ON',
  // how it moves (the life layer's signature, src/fighter/life.js: drawn only): a little wired: quick springs, shaking the hands out, a glance
  life: { spring: 1.1, damp: 0.95, eye: 1.1, breath: 1.05, sway: 0.7, swayHz: 0.5, habits: ['shakeOut', 'glance'] },
  color: '#5b8cff',
  pants: '#ffe066',
  altColor: '#ff8a3d',
  altPants: '#2ef2ff',
  accent: '#ffe066',
  // average on his feet and in the bar, a slightly heavier frame, a touch lighter on damage: the shock is the payoff
  stats: { health: 98, walk: 0.96, backWalk: 1, run: 0.95, jump: 0.98, dash: 1, weight: 1.04, stamina: 1, regen: 1.05, damage: 0.95 },
  body: { scale: 1.02, headR: 15, upperArm: 23.5, lowerArm: 22.5, upperLeg: 30.5, lowerLeg: 29.5, torsoW: 16.5, hipW: 12, lean: 2, accessory: hardHatAndBelt },
  cloth: [{ draw: tester, axis: ['neck', 'hip'], at: 1, off: [-4, -4], dir: [-0.077, 1], hang: 0.5, len: 13, seg: 2, hz: 2.4, damping: 0.3, gravity: 400, limit: 1.8 }],
  moves: {
    electrician_liveWire: { rig: liveWire, frame: { limb: 'hand', damage: 7, kb: { x: 200, y: 0 }, hitstun: 22, blockstun: 8, hitstop: 8, height: 'mid', react: 'hitStun',
      shock: { frames: 26, clip: 'electrician_shocked' }, cost: 20, reach: 85, flashR: 34, flashColor: [1, 0.95, 0.45], callout: 'LIVE WIRE' } },
    electrician_groundFault: { rig: groundFault, frame: { limb: 'foot', damage: 6, kb: { x: 0, y: 0 }, hitstun: 20, blockstun: 8, hitstop: 6, height: 'low', tc: true,
      root: 30, cost: 18, reach: 80, flashR: 26, flashColor: [1, 0.95, 0.45], callout: 'GROUND FAULT' } },
    electrician_shortCircuit: { rig: shortCircuit, frame: { limb: 'hand', damage: 12, kb: { x: 560, y: 260 }, hitstun: 0, blockstun: 14, hitstop: 10, knockdown: true, ender: true, height: 'mid',
      travel: { vx: 220, at: 60, ms: 100 }, reach: 95, flashR: 56, flashColor: [1, 0.95, 0.45], callout: 'SHORT CIRCUIT' } },
    // the shock's jitter, a reaction-layer clip (no frame data: never pressed)
    electrician_shocked: { rig: shocked },
  },
  commands: [
    { button: '1', motion: 'f', move: 'electrician_liveWire' },
    { button: '3', motion: 'df', move: 'electrician_groundFault' },
  ],
  strings: { add: [{ name: 'SHORT CIRCUIT', keys: ['2', '1', '2'], moves: ['cross', 'jab', 'electrician_shortCircuit'] }] },
  ai: {
    style: null,
    range: 'mid',
    specials: [
      // the poke at a standing body; once he's buzzing, walk in and open a string on him
      { name: 'liveWire', cost: 40, min: 50, max: 105, lead: 30, chance: 0.4, cooldown: 110,
        when: (me, o) => o.grounded && !o.crouch && o.state !== 'attack' && o.state !== 'jump',
        plan: (me, o, sim, dist, toward, k) => [
          k.attack('electrician_liveWire'),
          k.move(0, (m) => m.state !== 'attack' || m.hitConfirmed || m.phase === 'recovery'),
          { ...k.move(toward, (m, op) => Math.abs(op.x - m.x) < 78 || op.shockT <= 0), onlyIf: (m, op) => op.shockT > 0 },
          { ...k.press('1'), onlyIf: (m, op) => op.state === 'hitstun' },
        ] },
      { move: 'electrician_liveWire', min: 40, max: 100, when: 'whiff', chance: 0.5, cooldown: 90 },
      // the stamp under a standing guard, and as he walks in; then the root keeps him there
      { move: 'electrician_groundFault', min: 40, max: 100, when: 'guarding', chance: 0.45, cooldown: 120 },
      { move: 'electrician_groundFault', min: 50, max: 100, when: (me, o) => o.state === 'walk' && o.grounded, chance: 0.25, cooldown: 150 },
    ],
  },
  moveList: [
    { name: 'LIVE WIRE', input: '→ 1', note: 'poke that shocks: extra stun' },
    { name: 'GROUND FAULT', input: '↘ 3', note: 'low stamp, roots him in place' },
    { name: 'SHORT CIRCUIT', input: '2, 1, 2', note: 'string, two-palm thrust' },
  ],
  // STRATEGY, for the fighter page only (README, Site): how to beat each unique move. The game never shows it,
  // and site/vite-plugin.mjs cuts it from the bundle. Every tip is measured: `node gauntlet/counters.mjs electrician`
  // prints the numbers behind each one. Measure again when the frame data changes.
  strategy: [
    { move: 'electrician_liveWire', tips: [
      "It's a mid, so stand-block it. Crouching gets you shocked.",
      "Blocked, →2 (the lunge cross) punishes. He's pushed back too far for most other buttons.",
      "It's too quick to out-press once you see it. Block it, or parry it with →.",
    ] },
    { move: 'electrician_groundFault', tips: [
      "Crouch-block it. It's a low, and a standing block gets stamped.",
      "Blocked, →2 punishes.",
      "It only reaches about one step. Hold ← from just outside that and it misses.",
      "↘ parries it.",
    ] },
    { string: 'SHORT CIRCUIT', tips: [
      "Stand-block the opening cross. It pushes you back far enough that the jab behind it falls short, and the string dies there.",
      "Press snap kick (3) as you come out of blocking the cross. It lands before his jab does.",
      "Crouching from the start works too. The cross is a high and goes over your head.",
    ] },
  ],
};
