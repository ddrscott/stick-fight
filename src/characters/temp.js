// TEMP: the baseline. The original fighter, unchanged: every shared move and every shared string, no
// unique moves, no stats off 1, no body changes. TEMP vs TEMP plays exactly as the game did before
// characters existed (the regression scenes in the README give the same results). It's also what a
// ladder stage falls back to when its character isn't in the game yet.
import { RIG_KIT } from '../fighter/index.js';
import { stoop } from './perfectKit.js';
import { chainPath } from '../fighter/cloth.js';

const { K, F, LF, RF, HIP } = RIG_KIT;

// a lanyard with a visitor badge: the cord from the back of the neck down the front of the shirt, the badge in
// the accent with a dark edge. It's a cloth chain (below), so the cord swings and the badge flips at its end;
// at rest it hangs on the chest. The first day, in one object.
function lanyard(ctx, P, o) {
  const J = o.J, n = J.neck, c = J.chest, s = o.scale;
  let dx = c.x - n.x, dy = c.y - n.y; const L0 = Math.hypot(dx, dy) || 1; dx /= L0; dy /= L0;
  const fx = dy * o.facing, fy = -dx * o.facing;   // toward his front
  const back = { x: n.x - fx * 3 * s, y: n.y - fy * 3 * s };   // round the back of the neck
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [col, w] of [['#1a0f00', 2.6], [o.accent, 1.5]]) { ctx.strokeStyle = col; ctx.lineWidth = w * s; chainPath(ctx, P, back); ctx.stroke(); }
  // the badge hangs from the clip along the cord's last stretch
  const b = P[P.length - 1], a = P[P.length - 2];
  const w = 6.5 * s, h = 8.5 * s;
  ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 2);
  ctx.fillStyle = '#1a0f00'; ctx.fillRect(-w / 2 - 1.1 * s, -1.1 * s, w + 2.2 * s, h + 2.2 * s);
  ctx.fillStyle = o.accent; ctx.fillRect(-w / 2, 0, w, h);
  ctx.fillStyle = '#1a0f00'; ctx.fillRect(-w / 2 + 1.4 * s, 2 * s, w - 2.8 * s, 1.3 * s);   // the name line nobody filled in
  ctx.restore();
}

// The celebration (registry `dance`, played by the match winner under the WINS banner): first day, and
// somehow still standing. A stunned beat, a crouch, two hopping fist pumps, a wipe of the brow.
const dance = { keys: [
  K({ ...F(0, HIP, LF, RF), torso: 2, head: -2, la: [18, 36], ra: [8, 26] }, 260, 'inOut'),
  K({ ...F(0, HIP - 7, LF, RF), torso: 14, bend: 4, head: 8, la: [44, 120], ra: [30, 112] }, 170, 'in'),
  K({ ...F(0, HIP + 3, LF, RF), torso: -3, bend: -2, head: -16, la: [162, 178], ra: [34, 150], air: 12 }, 150, 'out'),
  K({ ...F(0, HIP - 5, LF, RF), torso: 9, bend: 2, head: 2, la: [112, 164], ra: [32, 146] }, 140, 'in'),
  K({ ...F(0, HIP + 3, LF, RF), torso: -3, bend: -2, head: -16, la: [166, 180], ra: [34, 150], air: 12 }, 150, 'out'),
  K({ ...F(0, HIP - 2, LF, RF), torso: 10, bend: 3, head: 10, la: [126, 236], ra: [14, 30] }, 300, 'inOut'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 8, bend: 2, head: 6, la: [118, 250], ra: [12, 28] }, 260, 'sine'),
] };

// The perfect round finisher (registry `perfect`, README Perfect rounds): a clumsy two-handed heave: he gets the body up by the collar, swings it back between his knees, heaves it up and over at the camera and staggers after it, then a stunned fist in the air.
const perfect = { name: 'TWO-HANDED HEAVE', note: 'A clumsy two-handed heave: he gets the body up by the collar, swings it back between his knees, heaves it up and over at the camera and staggers after it, then a stunned fist in the air.', stamp: 'CONTRACT ENDED', hand: 'lHand', hold: 'collar', fly: { spin: 1, arc: 90 }, keys: [
  ...stoop('both'),
  K({ ...F(0, HIP - 6, LF, RF), torso: 4, bend: -2, head: -6, la: [84, 100], ra: [76, 96] }, 200, 'inOut'),
  K({ ...F(-4, HIP - 18, LF, RF), torso: 32, bend: 6, head: -10, la: [-24, -12], ra: [-32, -22] }, 240, 'inOut'),
  K({ ...F(6, HIP + 2, LF + 6, RF), torso: -12, bend: -6, head: -14, la: [150, 166], ra: [140, 160] }, 110, 'out', 'release'),
  K({ ...F(9, HIP, LF + 8, RF), torso: -4, bend: -2, head: -10, la: [172, 190], ra: [160, 182] }, 170, 'out'),
  K({ ...F(14, HIP - 4, LF + 18, RF + 6, 0, 8), torso: 12, bend: 2, head: 4, la: [60, 140], ra: [104, 64] }, 230, 'inOut', 'footstep'),
  K({ ...F(16, HIP - 1, LF + 18, RF + 16), torso: 4, head: -8, la: [152, 178], ra: [18, 30] }, 320, 'inOut', 'footstep'),
  K({ ...F(16, HIP, LF + 18, RF + 16), torso: 2, head: -12, la: [162, 188], ra: [14, 26] }, 0, 'sine'),
] };

export default {
  dance,
  perfect,
  id: 'temp',
  name: 'TEMP',
  tagline: 'FIRST DAY. KNOWS THE BASICS',
  // how it moves (the life layer's signature, src/fighter/life.js: drawn only): first day: a little quick to look around, a nervous glance back, an exhausted slump when he wins
  life: { eye: 1.15, breath: 1.1, sway: 0.6, swayHz: 0.45, habits: ['glance', 'glance', 'shrug'], ko: 'slump' },
  color: '#f0f0f0',
  altColor: '#E85D00',
  accent: '#ffb02e',
  stats: {},
  body: null,
  // drawn over the chest, swung by the life layer (src/fighter/life.js); body stays null, so the rig is the baseline
  cloth: [{ draw: lanyard, axis: ['neck', 'chest'], off: [4.5, 0], dir: [0.06, 1], len: 24, seg: 3, hz: 2.2, damping: 0.2, side: 'front', clear: 4.5 }],
  moves: {},
  commands: [],
  strings: {},
  ai: {},
  moveList: [
    { name: 'NEON TORNADO', input: '1, 2, 3, 4', note: 'launches into a juggle' },
    { name: 'COMET CROSS', input: '→→ 2', note: 'wall splat' },
    { name: 'SKY SPIKE', input: '↓2, 1, 2, 4', note: 'ground bounce' },
  ],
  // STRATEGY, for the fighter page only (README, Site): how to beat each unique move. The game never shows it,
  // and site/vite-plugin.mjs cuts it from the bundle. Every tip is measured: `node gauntlet/counters.mjs temp`
  // prints the numbers behind each one. Measure again when the frame data changes.
  strategy: [
    { string: 'ONE-TWO', tips: [
      "Stand-block all three, then punish the cross with your own cross (2) or →2.",
      "After you block the first jab, low kick (↓3). It goes under the next punch and hits first.",
      "Crouch from the start and the first jab goes over your head. The string stops there, and a low kick (↓3) punishes.",
    ] },
    { string: 'FLASH ROUNDHOUSE', tips: [
      "Stand-block all four. The roundhouse at the end leaves him open for the cross (2) or →2.",
      "The roundhouse is slow to arrive. After you block the cross, a sweep (↓4) goes under it, or tap → to parry it.",
      "After you block the first jab, a low kick (↓3) goes under the second one and hits first.",
      "Crouch from the start and the first jab goes over your head. The string stops there, and a low kick (↓3) punishes.",
    ] },
    { string: 'TRIPLE JAB', tips: [
      "Stand-block all three, then jab (1) or cross (2) back. He's open after the third.",
      "After you block the first jab, low kick (↓3). It goes under the second.",
      "Crouch from the start and the first jab goes over your head. The string stops there.",
    ] },
    { string: 'ONE-TWO KICK', tips: [
      "Stand-block all three, then punish the roundhouse with the cross (2) or →2.",
      "After you block the first jab, jab back (1). His cross is slow to follow and yours lands first.",
      "The roundhouse is slow too. After you block the cross, sweep (↓4) under it, or parry it with →.",
      "Crouch from the start and the first jab goes over your head. The string stops there, and a low kick (↓3) punishes.",
    ] },
    { string: 'UPTOWN', tips: [
      "Stand-block all three, then punish with the cross (2).",
      "After you block the first jab, jab back (1) or low kick (↓3). His cross is slow to follow.",
      "Crouch from the start and the first jab goes over your head. The string stops there, and a low kick (↓3) punishes.",
    ] },
    { string: 'NEON TORNADO', tips: [
      "Stand-block it. Blocked, the launcher at the end never comes out: the string dies after the third hit, and your cross (2) punishes.",
      "After you block the first jab, jab back (1) or low kick (↓3). His cross is slow to follow.",
      "Crouch from the start and the first jab goes over your head. The string stops there, and a low kick (↓3) punishes.",
    ] },
    { string: 'CROSS SNAP', tips: [
      "Stand-block both hits, then punish the snap kick with your own cross (2).",
      "Or crouch from the start. The cross goes over your head, the kick never comes, and a low kick (↓3) punishes.",
    ] },
    { string: 'SPIN HEEL', tips: [
      "Stand-block the opening cross. It pushes you back far enough that the jab behind it falls short, and the spin heel never comes.",
      "Press snap kick (3) as you come out of blocking the cross. It lands before his jab does.",
      "Crouching from the start works too. The cross is a high and goes over your head, and a low kick (↓3) punishes.",
    ] },
    { string: 'CRESCENT', tips: [
      "Stand-block it. The kicks are mids, so crouching eats the whole string.",
      "The crescent kick at the end is slow enough to parry. Tap → as it comes around.",
      "Blocked, he's open for the cross (2) or →2, if you press it right away.",
    ] },
    { string: 'LOW RUSH', tips: [
      "It's all lows, so crouch-block the whole string. A standing block gets hit.",
      "After you block the first low jab, press the cross (2). It lands before the next one.",
      "If you block all three, the cross (2) or →2 still catches him, but only if you press at once.",
    ] },
    { string: 'GROUND RUSH', tips: [
      "Crouch-block it. The two low kicks push you back far enough that the knee after them misses.",
      "Then he's stuck, and anything lands: jab (1), cross (2), whatever you like.",
      "A standing block gets kicked in the shin, and crouching without blocking takes all three hits.",
    ] },
    { string: 'SKY SPIKE', tips: [
      "Stand-block it. It opens with an uppercut, which is a mid, and crouching gets you launched into the rest.",
      "After you block the uppercut, jab (1) or snap kick (3) back. The punches behind it are slow to arrive.",
      "If you block all four he's stuck for a long time. As soon as you can move, punish with the cross (2).",
    ] },
  ],
};
