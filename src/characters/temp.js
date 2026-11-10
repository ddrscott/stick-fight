// TEMP: the baseline. The original fighter, unchanged: every shared move and every shared string, no
// unique moves, no stats off 1, no body changes. TEMP vs TEMP plays exactly as the game did before
// characters existed (the regression scenes in the README give the same results). It's also what a
// ladder stage falls back to when its character isn't in the game yet.
import { RIG_KIT } from '../fighter/index.js';
import { stoop, lift } from './perfectKit.js';
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
const perfect = { name: 'TWO-HANDED HEAVE', stamp: 'CONTRACT ENDED', hand: 'lHand', hold: 'collar', fly: { spin: 1, arc: 90 }, keys: [
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
};
