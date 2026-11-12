// THE MANAGER: heavy power and the arcade boss. A big, square rig (scale 1.08, a broad torso, ordinary
// arms, so his reach is a touch past TEMP's from the size alone), more health, a heavy body, more damage
// per hit, slower on his feet. Two unique moves, Downsizing (b+3, a slow lead-leg axe kick from overhead
// that hits crouchers, guarded standing) and Performance Review (the ender of 1, 2, 2: a four-hit rush of
// rear hooks finished by an overhand, the first character move on the multi-hit hook), and one more
// unique string, TOP-DOWN (3, 2, 3), which ends in the axe kick. Drops TRIPLE JAB (he doesn't jab three
// times when he could hit you once).
import { RIG_KIT } from '../fighter/index.js';
import { stoop } from './perfectKit.js';
import { ribbonPath } from '../fighter/cloth.js';

const { K, F, L, LF, RF, HIP } = RIG_KIT;

// 1, 2, 2 ender: three rear hooks (body, head, body) and a stepping overhand. Every hit is the rear hand,
// so the one hitbox joint (rHand) is honest; between hooks the fist comes back to the chin so nothing
// passes through him. Four 'active' keys, frame data hits: 4.
const performanceReview = { blend: 40, limb: 'rHand', shift: 22, keys: [
  K({ ...F(-3, HIP - 4, LF, RF), torso: 6, bend: 2, head: 0, tw: -14, la: [50, 150], ra: [22, 150] }, 70, 'in'),
  // hook 1: to the body, the hips dropping into it
  K({ ...F(6, HIP - 9, LF + 6, RF), torso: 24, bend: 6, head: -8, tw: 14, la: [44, 150], ra: [74, 104] }, 40, 'out', 'active'),
  K({ ...F(6, HIP - 9, LF + 6, RF), torso: 24, bend: 6, head: -8, tw: 13, la: [44, 150], ra: [75, 106] }, 30, 'inOut'),
  K({ ...F(2, HIP - 6, LF + 6, RF), torso: 10, bend: 2, head: -4, tw: -12, la: [48, 150], ra: [30, 158] }, 60, 'in'),
  // hook 2: to the head, up on the toes
  K({ ...F(9, HIP - 3, LF + 6, RF), torso: 22, bend: 4, head: -10, tw: 16, la: [44, 150], ra: [92, 112] }, 40, 'out', 'active'),
  K({ ...F(9, HIP - 3, LF + 6, RF), torso: 22, bend: 4, head: -10, tw: 15, la: [44, 150], ra: [93, 114] }, 30, 'inOut'),
  K({ ...F(6, HIP - 7, LF + 12, RF, 0, 0), torso: 12, bend: 2, head: -4, tw: -12, la: [48, 150], ra: [28, 156] }, 60, 'in'),
  // hook 3: back to the body, a half step in
  K({ ...F(14, HIP - 10, LF + 14, RF + 4), torso: 26, bend: 7, head: -10, tw: 14, la: [44, 150], ra: [74, 102] }, 40, 'out', 'active'),
  K({ ...F(14, HIP - 10, LF + 14, RF + 4), torso: 26, bend: 7, head: -10, tw: 13, la: [44, 150], ra: [75, 104] }, 40, 'inOut'),
  // the wind-up: the fist goes back past the ear, the torso coils away
  K({ ...F(8, HIP - 6, LF + 14, RF + 4), torso: -6, bend: -4, head: 6, tw: -20, la: [60, 140], ra: [-30, 120] }, 70, 'inOut'),
  K({ ...F(6, HIP - 7, LF + 14, RF + 4), torso: -10, bend: -6, head: 8, tw: -22, la: [64, 136], ra: [-44, 130] }, 50, 'in'),
  // the overhand: lead foot steps, the fist comes over the top and through
  K({ ...F(22, HIP - 12, LF + 30, RF + 4), torso: 36, bend: 8, head: -14, tw: 18, la: [30, 140], ra: [104, 84] }, 40, 'out', 'active'),
  K({ ...F(24, HIP - 13, LF + 30, RF + 4), torso: 40, bend: 9, head: -14, tw: 20, la: [28, 140], ra: [96, 70] }, 90, 'inOut'),
  K({ ...F(22, HIP - 10, LF + 30, RF + 4), torso: 28, bend: 6, head: -12, tw: 12, la: [34, 146], ra: [70, 110] }, 110, 'inOut', 'recover'),
  K({ ...F(20, HIP - 4, LF + 30, RF + 22, 0, 10), torso: 12, bend: 2, head: -8, tw: 4, la: [48, 150], ra: [40, 150] }, 120, 'inOut', 'footstep'),
  K({ ...F(24, HIP + 1, LF + 30, RF + 22), torso: 4, head: -6, la: [54, 150], ra: [28, 166] }, 80, 'out'),
  K({ ...F(22, HIP - 1, LF + 22, RF + 22), torso: 6, head: -4 }, 0, 'sine'),
] };

// b+3: the lead leg rises high in front of his face, hangs there a beat (you can see it coming), and the
// heel chops down through the chest; he lands on it ahead and steps through. An overhead: it comes down on
// a croucher's head, so only a standing guard stops it. Slow and very unsafe on block.
const downsizing = { blend: 50, limb: 'lFoot', shift: 30, keys: [
  K({ hx: -6, rl: L(-6, HIP - 3, RF), ll: [44, -16], torso: 2, bend: 0, head: 4, tw: 4, la: [40, 120], ra: [30, 130] }, 90, 'in'),
  K({ hx: -7, rl: L(-7, HIP, RF), ll: [112, 104], torso: -12, bend: -5, head: 10, tw: 2, la: [10, 60], ra: [40, 110] }, 90, 'out'),
  K({ hx: -6, rl: L(-6, HIP + 1, RF), ll: [144, 148], torso: -24, bend: -8, head: 16, tw: 0, la: [-24, 20], ra: [30, 96] }, 110, 'sine'),
  K({ hx: -5, rl: L(-5, HIP + 1, RF), ll: [150, 154], torso: -27, bend: -9, head: 17, tw: 0, la: [-28, 14], ra: [26, 92] }, 60, 'in'),
  // the chop: heel at head height, the body folding over it, the arms flung back
  K({ hx: 8, rl: L(8, HIP - 2, RF), ll: [112, 104], torso: 12, bend: 5, head: -4, tw: -4, la: [-40, -10], ra: [-10, 40] }, 40, 'out', 'active'),
  K({ hx: 12, rl: L(12, HIP - 6, RF), ll: [76, 66], torso: 24, bend: 8, head: -10, tw: -6, la: [-36, 0], ra: [-6, 50] }, 50, 'in'),
  K({ ...F(16, HIP - 12, LF + 30, RF), torso: 28, bend: 8, head: -10, la: [10, 80], ra: [10, 80] }, 70, 'out', 'land'),
  K({ ...F(16, HIP - 10, LF + 30, RF), torso: 22, bend: 6, head: -8, la: [40, 120], ra: [24, 120] }, 140, 'inOut', 'recover'),
  K({ ...F(20, HIP - 4, LF + 30, RF + 30, 0, 10), torso: 10, head: -6, la: [52, 146], ra: [28, 160] }, 120, 'inOut', 'footstep'),
  K({ ...F(30, HIP - 1, LF + 30, RF + 30), torso: 6, head: -4 }, 0, 'sine'),
] };

// a necktie: the knot at the collar, the blade down the front of the shirt, in the accent neon with a dark
// edge so it reads on the red body. It's a cloth chain (below): the blade flips and settles from the knot
function tie(ctx, P, o) {
  const s = o.scale, w = 3.2 * s;
  ctx.lineJoin = 'round';
  ribbonPath(ctx, P, o.facing, (t) => w * (0.8 + 0.5 * t), true);
  ctx.strokeStyle = '#1a0408'; ctx.lineWidth = 2.4 * s; ctx.stroke();
  ctx.fillStyle = o.accent; ctx.fill();
  // the knot
  ctx.fillStyle = o.accent; ctx.strokeStyle = '#1a0408'; ctx.lineWidth = 1.4 * s;
  ctx.beginPath(); ctx.arc(P[0].x, P[0].y, 2.6 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}

// the earlier hooks of Performance Review (frame data `rush`, the multi-hit hook): light hits that keep him
// standing in hitstun; the last hit is the move itself, the knockdown and the callout
const PR_RUSH = { damage: 4, kb: { x: 0, y: 0 }, hitstun: 30, blockstun: 10, hitstop: 5, knockdown: false, ender: false, callout: null, flashR: 28 };

// The celebration (registry `dance`, played by the match winner under the WINS banner): Management: straighten the tie, a slow golf clap, then the finger point that says you're done here.
const dance = { keys: [
  K({ ...F(0, HIP, LF, RF), torso: -2, bend: -2, head: 6, la: [40, 160], ra: [30, 170] }, 260, 'inOut'),
  K({ ...F(0, HIP, LF, RF), torso: -2, bend: -2, head: 8, la: [36, 172], ra: [30, 170] }, 200, 'inOut'),
  K({ ...F(0, HIP, LF, RF), torso: 0, bend: -2, head: -4, la: [50, 110], ra: [40, 130] }, 220, 'inOut'),
  K({ ...F(0, HIP, LF, RF), torso: 0, bend: -2, head: -4, la: [54, 124], ra: [44, 122] }, 220, 'in'),
  K({ ...F(0, HIP, LF, RF), torso: 0, bend: -2, head: -4, la: [50, 110], ra: [40, 130] }, 220, 'inOut'),
  K({ ...F(0, HIP, LF, RF), torso: 0, bend: -2, head: -4, la: [54, 124], ra: [44, 122] }, 220, 'in'),
  K({ ...F(2, HIP, LF + 4, RF), torso: -4, bend: -4, head: -8, tw: -8, la: [92, 92], ra: [-20, 30] }, 200, 'snap'),
  K({ ...F(2, HIP, LF + 4, RF), torso: -4, bend: -4, head: -8, tw: -8, la: [94, 94], ra: [-20, 30] }, 520, 'sine'),
] };

// The perfect round finisher (registry `perfect`, README Perfect rounds): a performance-review fling: he holds it up at eye level, shakes his head, winds the shoulders round and flings it sidearm at the camera, then straightens his tie and points.
const perfect = { name: 'PERFORMANCE REVIEW FLING', note: 'A performance-review fling: he holds it up at eye level, shakes his head, winds the shoulders round and flings it sidearm at the camera, then straightens his tie and points.', stamp: 'NEEDS IMPROVEMENT', hand: 'lHand', hold: 'collar', fly: { spin: 1, arc: 50 }, keys: [
  ...stoop('lHand'),
  K({ face: 0.4, ...F(2, HIP - 1, LF + 4, RF), torso: 0, bend: -4, head: -8, la: [130, 140], ra: [40, 110] }, 240, 'inOut'),
  K({ face: 0.4, ...F(2, HIP - 1, LF + 4, RF), torso: 0, bend: -4, head: 10, la: [130, 138], ra: [44, 112] }, 140, 'sine'),
  K({ face: 0.4, ...F(2, HIP - 1, LF + 4, RF), torso: 0, bend: -4, head: -14, la: [128, 136], ra: [44, 112] }, 140, 'sine'),
  K({ face: 0.15, ...F(-6, HIP - 8, LF + 2, RF - 4), torso: 10, bend: 2, head: -4, tw: -18, la: [-50, -20], ra: [60, 120] }, 220, 'inOut'),
  K({ face: 0.9, ...F(10, HIP - 4, LF + 16, RF - 4), torso: 18, bend: 4, head: -8, tw: 16, la: [100, 92], ra: [-20, 20] }, 80, 'out', 'release'),
  K({ face: 0.85, ...F(12, HIP - 3, LF + 16, RF), torso: 14, bend: 2, head: -6, tw: 10, la: [70, 50], ra: [-10, 40] }, 200, 'out', 'footstep'),
  K({ face: 0.6, ...F(10, HIP - 1, LF + 16, RF + 6), torso: 2, head: -6, la: [116, 206], ra: [104, 196] }, 260, 'inOut'),
  K({ face: 0.75, ...F(10, HIP, LF + 16, RF + 6), torso: 2, head: -8, la: [40, 110], ra: [94, 92] }, 220, 'inOut'),
  K({ face: 0.75, ...F(10, HIP, LF + 16, RF + 6), torso: 2, head: -10, la: [38, 112], ra: [96, 94] }, 0, 'sine'),
] };

// Fighter mastery (README, Progression, Fighter mastery; the names are src/career/mastery.js KIT). The victory pose
// (registry `victory`, in place of the dance once it's unlocked and on): Hands on hips: chest out, both fists on the hips, surveying the floor.
const victory = { keys: [
  K({ ...F(0, HIP - 2, LF, RF), torso: 4, head: 4, la: [20, 30], ra: [20, 30] }, 200, 'in'),
  K({ ...F(0, HIP, LF + 4, RF - 4), torso: -4, bend: -4, head: -8, la: [30, -70], ra: [-30, 70] }, 260, 'out'),
  K({ ...F(0, HIP, LF + 4, RF - 4), torso: -4, bend: -4, head: -10, la: [30, -70], ra: [-30, 70] }, 460, 'sine'),
] };
// The taunt (registry `taunt`): the last round's winner plays it under the next ROUND card, never in a fight, and it's
// over by FIGHT (TAUNT_MAX_MS). My office. Now.: points at them, then crooks a finger to beckon.
const taunt = { keys: [
  K({ ...F(0, HIP - 1, LF, RF), torso: 4, head: -4, la: [92, 92], ra: [12, 24] }, 200, 'snap'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 4, head: -4, la: [92, 92], ra: [12, 24] }, 160, 'sine'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 2, head: -4, la: [70, 150], ra: [12, 24] }, 160, 'inOut'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 2, head: -4, la: [74, 110], ra: [12, 24] }, 140, 'inOut'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 2, head: -4, la: [70, 150], ra: [12, 24] }, 140, 'inOut'),
  K({ ...F(0, HIP, LF, RF), torso: 2, head: 0, la: [12, 24], ra: [8, 20] }, 240, 'inOut'),
] };

export default {
  dance,
  victory,
  taunt,
  perfect,
  id: 'manager',
  name: 'THE MANAGER',
  tagline: 'YOUR PERFORMANCE REVIEW IS NOW',
  // how it moves (the life layer's signature, src/fighter/life.js: drawn only): composed: firm springs, an unhurried eye, a look at his watch; straightens his tie when he wins
  life: { spring: 0.85, damp: 1.15, eye: 0.85, breath: 0.9, sway: 0.6, swayHz: 0.35, habits: ['watch'], laugh: true, ko: 'tie' },
  color: '#ff3b3b',
  altColor: '#ffd84f',
  accent: '#ffd84f',
  stats: { health: 104, walk: 0.88, backWalk: 0.88, run: 0.9, jump: 0.9, dash: 0.92, weight: 1.15, stamina: 1, regen: 0.95, damage: 1.04 },
  body: { scale: 1.06, headR: 14.5, upperArm: 23, lowerArm: 21.5, upperLeg: 29.5, lowerLeg: 29, lowerTorso: 17.5, upperTorso: 19.5, limbW: 11.5, limbTip: 9, torsoW: 17.5, hipW: 12.5, lean: 3, stance: 2 },
  // drawn over the chest; its tip swings on the life layer's spring (src/fighter/life.js)
  cloth: [{ draw: tie, axis: ['neck', 'chest'], off: [3.6, 4], dir: [0.12, 1], len: 20.5, seg: 3, hz: 1.8, damping: 0.25, side: 'front', clear: 3.6 }],
  moves: {
    performanceReview: { rig: performanceReview, frame: { limb: 'hand', damage: 10, kb: { x: 520, y: 300 }, hitstun: 0, blockstun: 14, hitstop: 10, knockdown: true, ender: true, height: 'mid',
      hits: 4, rush: PR_RUSH, travel: { vx: 300, at: 40, ms: 150 }, cost: 26, reach: 80, flashR: 42, callout: 'PERFORMANCE REVIEW' } },
    downsizing: { rig: downsizing, frame: { limb: 'foot', damage: 16, kb: { x: 220, y: 260 }, hitstun: 0, blockstun: 12, hitstop: 10, knockdown: true, height: 'overhead',
      travel: { vx: 200, at: 330, ms: 130 }, cost: 26, reach: 90, flashR: 40, callout: 'DOWNSIZING' } },
    // TOP-DOWN's ender: the axe kick off a kick and a cross
    topDown: { frame: { limb: 'foot', damage: 15, kb: { x: 260, y: 300 }, hitstun: 0, blockstun: 12, hitstop: 10, knockdown: true, ender: true, height: 'overhead',
      travel: { vx: 200, at: 330, ms: 130 }, reach: 90, flashR: 40, anims: ['downsizing'], callout: 'TOP-DOWN' } },
  },
  commands: [
    { button: '3', motion: 'b', move: 'downsizing' },
  ],
  strings: {
    drop: ['TRIPLE JAB', 'ONE-TWO KICK'],
    add: [
      { name: 'PERFORMANCE REVIEW', keys: ['1', '2', '2'], moves: ['jab', 'cross', 'performanceReview'] },
      { name: 'TOP-DOWN', keys: ['3', '2', '3'], moves: ['lkick', 'cross', 'topDown'] },
    ],
  },
  ai: {
    style: null,
    range: 'mid',
    specials: [
      // the axe kick on a croucher (a crouching guard is exactly what it beats), and on a body getting up
      { move: 'downsizing', min: 40, max: 120, when: 'crouching', chance: 0.75, cooldown: 70 },
      { move: 'downsizing', min: 40, max: 115, when: (me, o) => o.state === 'getup', chance: 0.5, cooldown: 120 },
      // open with the jab up close: the follow-up reflex carries 1, 2 on, and his 1, 2 goes into the review
      { move: 'jab', min: 0, max: 82, when: (me, o) => o.grounded && !o.crouch && o.state !== 'attack' && me.stamina > 68, chance: 0.6, cooldown: 60 },
      // now and then on a standing guard too, as the other half of the guess
      { move: 'downsizing', min: 50, max: 110, when: (me, o) => o.grounded && !o.crouch && o.state !== 'attack' && !o.backHeld, chance: 0.12, cooldown: 200 },
    ],
  },
  moveList: [
    { name: 'PERFORMANCE REVIEW', input: '1, 2, 2', note: 'string, four-hit rush ender' },
    { name: 'DOWNSIZING', input: '← 3', note: 'axe kick overhead, hits crouchers' },
    { name: 'TOP-DOWN', input: '3, 2, 3', note: 'string, ends in the axe kick' },
  ],
  // STRATEGY, for the fighter page only (README, Site): how to beat each unique move. The game never shows it,
  // and site/vite-plugin.mjs cuts it from the bundle. Every tip is measured: `node gauntlet/counters.mjs manager`
  // prints the numbers behind each one. Measure again when the frame data changes.
  strategy: [
    { move: 'downsizing', tips: [
      "It's an overhead, so stand-block it. Crouching gets you hit, blocking or not.",
      "It's slow. When you see the leg go up, a cross (2) or →2 thrown right away knocks him out of it.",
      "Blocked, he's stuck. Punish with the cross (2).",
      "→ parries it.",
    ] },
    { string: 'PERFORMANCE REVIEW', tips: [
      "Stand-block all of it. The rush at the end is four hits, so keep holding ← until the last one lands.",
      "It shoves you a long way back. Only →2, the lunge cross, reaches him afterwards.",
      "Stop it before the rush: after you block his first jab, jab back (1) or low kick (↓3). His cross is slow and you hit first.",
      "Crouch from the start and the first jab goes over your head. The string stops there, and a low kick (↓3) punishes.",
    ] },
    { string: 'TOP-DOWN', tips: [
      "Stand-block it. It's a mid, a high and an overhead, and crouching gets you hit by all three.",
      "The axe kick at the end is slow. After you block his cross, a roundhouse (4) knocks him out of it.",
      "If you block the axe kick too, he's open. Punish with the cross (2) or →2.",
    ] },
  ],
};
