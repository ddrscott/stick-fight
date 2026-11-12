// CHEF: the cafeteria cook. Heavy and slow: a big, square rig (thick torso, short arms and legs, so his
// reach is about TEMP's and there's more of him to hit), more health, a heavy body, a slow walk. White
// like TEMP, so the red kitchen pants are what tell them apart. Two unique moves, Cleaver (b+2, an
// armored overhead chop that comes down on crouchers; slow and punishable) and Flambé (b+1, a short
// two-handed upward flick out of the hip that launches, in a big flash), and one unique string,
// EIGHTY-SIX (1, 1, 4), ending in a kitchen-door push kick that sends him into the wall. Drops SKY SPIKE.
import { RIG_KIT } from '../fighter/index.js';
import { stoop } from './perfectKit.js';
import { chainPath, ribbonPath } from '../fighter/cloth.js';

const { K, F, L, leg, LF, RF, HIP } = RIG_KIT;

// b+2: the rear hand goes up behind the head (the cleaver), the weight rocks back and hangs there a beat
// (readable, and armored the whole way), then a step and the arm chops straight down through his
// collarbone. An overhead: it comes down on a croucher, only a standing guard stops it.
const cleaver = { blend: 50, limb: 'rHand', shift: 22, keys: [
  K({ ...F(-3, HIP - 3, LF, RF), torso: 2, bend: -1, head: 0, tw: -8, la: [52, 140], ra: [60, 170] }, 90, 'in'),
  K({ ...F(-8, HIP - 4, LF, RF), torso: -10, bend: -5, head: 6, tw: -16, la: [44, 140], ra: [194, 232] }, 110, 'out'),
  K({ ...F(-9, HIP - 3, LF, RF, 0, 2), torso: -13, bend: -6, head: 8, tw: -18, la: [46, 136], ra: [198, 240] }, 90, 'sine'),
  // the chop: the lead foot lands as the arm comes through
  K({ ...F(10, HIP - 7, LF + 22, RF + 4), torso: 28, bend: 8, head: -10, tw: 14, la: [24, 80], ra: [108, 84] }, 40, 'out', 'active'),
  K({ ...F(13, HIP - 8, LF + 22, RF + 4), torso: 36, bend: 10, head: -14, tw: 18, la: [18, 70], ra: [76, 46] }, 70, 'inOut'),
  K({ ...F(12, HIP - 7, LF + 22, RF + 4), torso: 30, bend: 8, head: -12, tw: 14, la: [26, 90], ra: [60, 34] }, 160, 'inOut', 'recover'),
  K({ ...F(16, HIP - 5, LF + 22, RF + 18, 0, 10), torso: 14, bend: 3, head: -6, tw: 4, la: [48, 140], ra: [36, 150] }, 120, 'inOut', 'footstep'),
  K({ ...F(22, HIP - 1, LF + 22, RF + 22), torso: 6, head: -4, la: [54, 148], ra: [30, 164] }, 0, 'sine'),
] };

// b+1: both hands drop to the hip as if on the pan handle, he sinks, and both arms flick up and out in
// front of him as the knees drive him up onto the toes. Short, and it launches.
const flambe = { blend: 40, limb: 'lHand', shift: 8, keys: [
  K({ ...F(-2, HIP - 6, LF, RF), torso: 14, bend: 4, head: 2, tw: -6, la: [-6, 30], ra: [-16, 24] }, 70, 'in'),
  K({ ...F(0, HIP - 11, LF + 6, RF, 4, 0), torso: 20, bend: 6, head: 2, tw: -8, la: [-18, 40], ra: [-26, 32] }, 60, 'in'),
  K({ ...F(8, HIP - 4, LF + 8, RF), torso: 10, bend: 1, head: -6, tw: 4, la: [60, 96], ra: [48, 90] }, 30, 'linear'),
  K({ ...F(12, HIP + 2, LF + 8, RF, 0, 5), torso: 0, bend: -3, head: -10, tw: 6, la: [116, 140], ra: [104, 132] }, 40, 'out', 'active'),
  K({ ...F(12, HIP + 3, LF + 8, RF, 0, 7), torso: -4, bend: -4, head: -12, tw: 6, la: [132, 160], ra: [120, 152] }, 80, 'inOut'),
  K({ ...F(10, HIP, LF + 8, RF), torso: 2, bend: -1, head: -6, la: [92, 140], ra: [80, 136] }, 120, 'inOut', 'recover'),
  K({ ...F(8, HIP - 3, LF + 8, RF + 8, 0, 8), torso: 7, head: -4, la: [54, 148], ra: [30, 162] }, 110, 'inOut', 'footstep'),
  K({ ...F(8, HIP - 1, LF + 8, RF + 8), torso: 6, head: -4 }, 0, 'sine'),
] };

// EIGHTY-SIX's ender: the rear knee comes up to the chest and the foot drives straight out through his
// middle like a boot through the kitchen door, the body leaning back behind it. Splats near a wall.
const eightySix = { blend: 40, limb: 'rFoot', shift: 26, keys: [
  K({ hx: 4, ll: L(4, HIP - 4, LF), rl: leg(-14, 49), torso: 10, bend: 2, head: 0, tw: -8, la: [60, 150], ra: [30, 140] }, 60, 'in'),
  K({ hx: 4, ll: L(4, HIP - 2, LF), rl: [104, -20], torso: -2, bend: -2, head: 4, tw: -4, la: [70, 150], ra: [20, 130] }, 70, 'out'),
  K({ hx: 12, ll: L(12, HIP + 1, LF), rl: [92, 88], torso: -22, bend: -6, head: 12, tw: 8, la: [80, 150], ra: [-10, 80] }, 40, 'out', 'active'),
  K({ hx: 13, ll: L(13, HIP + 1, LF), rl: [93, 90], torso: -24, bend: -6, head: 12, tw: 8, la: [80, 150], ra: [-12, 78] }, 80, 'inOut'),
  K({ hx: 12, ll: L(12, HIP, LF), rl: [96, 10], torso: -12, bend: -3, head: 8, tw: 4, la: [66, 150], ra: [10, 110] }, 90, 'inOut', 'recover'),
  K({ ...F(16, HIP - 6, LF, 42), torso: 10, bend: 2, head: -4, la: [54, 140], ra: [30, 150] }, 90, 'out', 'footstep'),
  K({ ...F(22, HIP - 2, LF + 26, 42, 8, 0), torso: 7, head: -4, la: [54, 148], ra: [30, 162] }, 100, 'inOut', 'footstep'),
  K({ ...F(26, HIP - 1, LF + 26, RF + 26), torso: 6, head: -4 }, 0, 'sine'),
] };

// the apron's skirt from the waist to the hem (a cloth chain down its middle: it flexes and ripples at the
// hem while the bib stays on the body), then the tie across the waist over it
function skirt(ctx, P, o) {
  const s = o.scale, J = o.J, n = J.neck, hip = J.hip;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ribbonPath(ctx, P, o.facing, (t) => (6.7 + 2.3 * t) * s);
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#1a0a10'; ctx.lineWidth = 2 * s; ctx.fill(); ctx.stroke();
  let tx = n.x - hip.x, ty = n.y - hip.y; const LT = Math.hypot(tx, ty) || 1; tx /= LT; ty /= LT;
  const ax = -ty * o.facing, ay = tx * o.facing;
  const wx = hip.x + tx * 8 * s, wy = hip.y + ty * 8 * s;
  ctx.strokeStyle = o.accent; ctx.lineWidth = 2.2 * s;
  ctx.beginPath(); ctx.moveTo(wx - ax * 8 * s, wy - ay * 8 * s); ctx.lineTo(wx + ax * 7 * s, wy + ay * 7 * s); ctx.stroke();
}
// the bow's tail, out behind the waist
function bowTail(ctx, P, o) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = o.accent; ctx.lineWidth = 2.2 * o.scale;
  chainPath(ctx, P); ctx.stroke();
}
// a chef's toque (a tall pleated hat with a band) and an apron tied over the shirt, in strokes, with a dark
// edge so the white hat reads on the white body; the red band and strings in the accent
function toqueAndApron(ctx, J, o) {
  const h = J.head, n = J.neck, hip = J.hip, s = o.scale, r = o.headR;
  let ux = h.x - n.x, uy = h.y - n.y; const L0 = Math.hypot(ux, uy) || 1; ux /= L0; uy /= L0;
  const fx = -uy * o.facing, fy = ux * o.facing;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // the apron's bib: from the chest down to the waist tie on his front (the skirt under it is cloth, below)
  let tx = n.x - hip.x, ty = n.y - hip.y; const LT = Math.hypot(tx, ty) || 1; tx /= LT; ty /= LT;
  const ax = -ty * o.facing, ay = tx * o.facing;   // toward his front
  const top = { x: hip.x + tx * LT * 0.78 + ax * 5 * s, y: hip.y + ty * LT * 0.78 + ay * 5 * s };
  const wst = { x: hip.x + tx * 8 * s + ax * 6.7 * s, y: hip.y + ty * 8 * s + ay * 6.7 * s };
  const w0 = 5 * s, w1 = 6.7 * s;
  ctx.beginPath();
  ctx.moveTo(top.x - ty * w0, top.y + tx * w0); ctx.lineTo(top.x + ty * w0, top.y - tx * w0);
  ctx.lineTo(wst.x + ty * w1, wst.y - tx * w1); ctx.lineTo(wst.x - ty * w1, wst.y + tx * w1); ctx.closePath();
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#1a0a10'; ctx.lineWidth = 2 * s; ctx.fill(); ctx.stroke();
  // the toque: a band round the crown, then a tall puffed top leaning back a little
  const bx = h.x + ux * r * 0.55, by = h.y + uy * r * 0.55;
  const crown = { x: h.x + ux * r * 2.05 - fx * r * 0.18, y: h.y + uy * r * 2.05 - fy * r * 0.18 };
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#1a0a10'; ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(bx - fx * r * 0.9, by - fy * r * 0.9);
  ctx.lineTo(bx + fx * r * 0.9, by + fy * r * 0.9);
  ctx.quadraticCurveTo(crown.x + fx * r * 1.25, crown.y + fy * r * 1.25, crown.x, crown.y);
  ctx.quadraticCurveTo(crown.x - fx * r * 1.3, crown.y - fy * r * 1.3, bx - fx * r * 0.9, by - fy * r * 0.9);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // pleats
  ctx.lineWidth = 1.1 * s;
  for (const k of [-0.35, 0.25]) { ctx.beginPath(); ctx.moveTo(bx + fx * r * k, by + fy * r * k); ctx.lineTo(crown.x + fx * r * k * 1.2, crown.y + fy * r * k * 1.2); ctx.stroke(); }
  ctx.strokeStyle = o.accent; ctx.lineWidth = 3 * s;
  ctx.beginPath(); ctx.moveTo(bx - fx * r * 0.92, by - fy * r * 0.92); ctx.lineTo(bx + fx * r * 0.92, by + fy * r * 0.92); ctx.stroke();
}

// The celebration (registry `dance`, played by the match winner under the WINS banner): Chef's kiss: fingers to the lips and flung open, then a big stir of the pot with both hands.
const dance = { keys: [
  K({ ...F(0, HIP, LF, RF), torso: 2, bend: -1, head: -6, la: [120, 240], ra: [20, 40] }, 220, 'inOut'),
  K({ ...F(0, HIP, LF, RF), torso: -2, bend: -3, head: -14, la: [130, 150], ra: [20, 40] }, 160, 'snap'),
  K({ ...F(0, HIP, LF, RF), torso: -2, bend: -3, head: -14, la: [132, 154], ra: [20, 40] }, 240, 'sine'),
  K({ ...F(-2, HIP - 4, LF, RF), torso: 18, bend: 4, head: 6, la: [70, 50], ra: [60, 40] }, 200, 'sine'),
  K({ ...F(2, HIP - 4, LF, RF), torso: 20, bend: 4, head: 6, la: [50, 70], ra: [70, 80] }, 200, 'sine'),
  K({ ...F(-2, HIP - 4, LF, RF), torso: 18, bend: 4, head: 6, la: [70, 50], ra: [60, 40] }, 200, 'sine'),
  K({ ...F(2, HIP - 4, LF, RF), torso: 20, bend: 4, head: 6, la: [50, 70], ra: [70, 80] }, 200, 'sine'),
] };

// The perfect round finisher (registry `perfect`, README Perfect rounds): a pancake flip: the body on the spatula hand, a dip and a flip up at the camera (it turns over on the way); then the chef's kiss.
const perfect = { name: 'PANCAKE FLIP', note: 'A pancake flip: the body on the spatula hand, a dip and a flip up at the camera (it turns over on the way); then the chef\'s kiss.', stamp: 'ORDER UP', hand: 'rHand', hold: 'carry', fly: { spin: 0, flip: 2, arc: 160 }, keys: [
  ...stoop('rHand'),
  K({ face: 0.3, ...F(2, HIP - 3, LF + 4, RF), torso: 6, bend: -2, head: -8, la: [40, 110], ra: [60, 92] }, 220, 'inOut'),
  K({ face: 0.6, ...F(0, HIP - 10, LF + 4, RF), torso: 14, bend: 2, head: -6, la: [40, 110], ra: [36, 70] }, 160, 'in'),
  K({ face: 0.95, ...F(4, HIP + 2, LF + 4, RF), torso: -10, bend: -4, head: -16, la: [50, 120], ra: [140, 170] }, 90, 'out', 'release'),
  K({ face: 0.95, ...F(4, HIP + 1, LF + 4, RF), torso: -6, head: -14, la: [50, 120], ra: [150, 186] }, 200, 'out'),
  K({ face: 0.8, ...F(4, HIP - 1, LF + 4, RF), torso: 4, head: -6, la: [108, 200], ra: [40, 120] }, 220, 'inOut'),
  K({ face: 0.7, ...F(4, HIP, LF + 4, RF), torso: 2, head: -10, la: [124, 124], ra: [40, 120] }, 200, 'out'),
  K({ face: 0.7, ...F(4, HIP, LF + 4, RF), torso: 2, head: -12, la: [128, 128], ra: [40, 120] }, 0, 'sine'),
] };

// Fighter mastery (README, Progression, Fighter mastery; the names are src/career/mastery.js KIT). The victory pose
// (registry `victory`, in place of the dance once it's unlocked and on): Plated: a low bow with one arm sweeping out to present the dish.
const victory = { keys: [
  K({ ...F(0, HIP - 2, LF, RF), torso: 4, head: 4, la: [40, 100], ra: [12, 24] }, 200, 'in'),
  K({ ...F(0, HIP - 3, LF + 6, RF - 2), torso: 28, bend: 6, head: 18, la: [70, 60], ra: [-20, 40] }, 280, 'out'),
  K({ ...F(0, HIP - 3, LF + 6, RF - 2), torso: 30, bend: 6, head: 20, la: [70, 60], ra: [-20, 40] }, 440, 'sine'),
] };
// The taunt (registry `taunt`): the last round's winner plays it under the next ROUND card, never in a fight, and it's
// over by FIGHT (TAUNT_MAX_MS). Taste test: a spoon to the lips, a frown, a slow head shake.
const taunt = { keys: [
  K({ ...F(0, HIP - 1, LF, RF), torso: 4, head: 6, la: [40, 168], ra: [12, 24] }, 220, 'out'),
  K({ ...F(0, HIP - 1, LF, RF), torso: -2, head: -6, la: [40, 168], ra: [12, 24] }, 180, 'inOut'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 0, head: 4, tw: 8, la: [30, 120], ra: [12, 24] }, 160, 'sine'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 0, head: 4, tw: -8, la: [30, 120], ra: [12, 24] }, 160, 'sine'),
  K({ ...F(0, HIP, LF, RF), torso: 2, head: 0, la: [12, 24], ra: [8, 20] }, 240, 'inOut'),
] };

export default {
  dance,
  victory,
  taunt,
  perfect,
  id: 'chef',
  name: 'CHEF',
  tagline: 'THE SPECIAL TODAY IS YOU',
  // how it moves (the life layer's signature, src/fighter/life.js: drawn only): on his feet all night: a heavy sway, shaking out, a neck roll
  life: { sway: 0.8, swayHz: 0.4, habits: ['shakeOut', 'neckRoll'] },
  color: '#f0f0f0',
  pants: '#ff3b3b',
  altColor: '#7fd6ff',
  altPants: '#ffd84f',
  accent: '#ff3b3b',
  // heavy and slow: more health and a heavier body, a slow walk and jump, a bit less regen
  stats: { health: 100, walk: 0.82, backWalk: 0.88, run: 0.86, jump: 0.9, dash: 0.9, weight: 1.12, stamina: 1, regen: 0.88, damage: 0.9 },
  body: { scale: 1.08, headR: 15, upperArm: 22.5, lowerArm: 21, upperLeg: 29, lowerLeg: 28.5, lowerTorso: 18, upperTorso: 20, limbW: 11, limbTip: 8.4, torsoW: 19, hipW: 13.5, lean: 3, stance: 3, accessory: toqueAndApron },
  cloth: [
    { draw: skirt, axis: ['neck', 'hip'], at: 1, off: [6.7, -8], dir: [0.077, 1], len: 30, seg: 3, hz: 2.2, damping: 0.45, side: 'front', clear: 4, limit: 1.1 },
    { draw: bowTail, layer: 'back', axis: ['neck', 'hip'], at: 1, off: [-8, -8], dir: [-0.58, 0.81], len: 8.6, seg: 2, hz: 2.2, damping: 0.25, limit: 2 },
  ],
  moves: {
    chef_cleaver: { rig: cleaver, frame: { limb: 'hand', damage: 13, kb: { x: 240, y: 260 }, hitstun: 0, blockstun: 10, hitstop: 10, knockdown: true, height: 'overhead',
      armor: { hits: 1, dmg: 0.5 }, travel: { vx: 160, at: 300, ms: 90 }, cost: 26, reach: 85, flashR: 42, callout: 'CLEAVER' } },
    chef_flambe: { rig: flambe, frame: { limb: 'hand', damage: 11, kb: { x: 110, y: 480 }, hitstun: 0, blockstun: 12, hitstop: 9, knockdown: true, juggle: true, height: 'mid',
      travel: { vx: 260, at: 40, ms: 120 }, cost: 24, reach: 80, flashR: 92, flashColor: [1, 0.5, 0.12], callout: 'FLAMBÉ' } },
    chef_eightySix: { rig: eightySix, frame: { limb: 'foot', damage: 15, kb: { x: 760, y: 180 }, hitstun: 0, blockstun: 16, hitstop: 10, knockdown: true, splat: true, ender: true, height: 'mid',
      reach: 90, flashR: 38, callout: 'EIGHTY-SIXED' } },
  },
  commands: [
    { button: '2', motion: 'b', move: 'chef_cleaver' },
    { button: '1', motion: 'b', move: 'chef_flambe' },
  ],
  strings: { drop: ['SKY SPIKE'], add: [{ name: 'EIGHTY-SIX', keys: ['1', '1', '4'], moves: ['jab', 'jab', 'chef_eightySix'] }] },
  ai: {
    style: null,
    range: 'close',
    specials: [
      // the chop on a croucher (a crouching guard is what it beats), and through a strike he sees starting (armor)
      { move: 'chef_cleaver', min: 40, max: 125, when: 'crouching', chance: 0.6, cooldown: 90 },
      { move: 'chef_cleaver', min: 50, max: 125, when: 'attacking', chance: 0.35, cooldown: 120 },
      { move: 'chef_cleaver', min: 40, max: 120, when: (me, o) => o.state === 'getup', chance: 0.4, cooldown: 140 },
      // the flick up close on a standing body, and as a punish on a whiff
      { move: 'chef_flambe', min: 0, max: 88, when: 'whiff', chance: 0.7, cooldown: 80 },
      { move: 'chef_flambe', min: 0, max: 84, when: (me, o) => o.grounded && !o.crouch && o.state !== 'attack', chance: 0.3, cooldown: 130 },
      // open with the jab when there's bar for 1, 1, 4
      { move: 'jab', min: 0, max: 82, when: (me, o) => o.grounded && !o.crouch && o.state !== 'attack' && me.stamina > 72, chance: 0.35, cooldown: 90 },
    ],
  },
  moveList: [
    { name: 'CLEAVER', input: '← 2', note: 'armored overhead chop, hits crouchers' },
    { name: 'FLAMBÉ', input: '← 1', note: 'short upward flick, launches' },
    { name: 'EIGHTY-SIX', input: '1, 1, 4', note: 'string, push kick to the wall' },
  ],
  // STRATEGY, for the fighter page only (README, Site): how to beat each unique move. The game never shows it,
  // and site/vite-plugin.mjs cuts it from the bundle. Every tip is measured: `node gauntlet/counters.mjs chef`
  // prints the numbers behind each one. Measure again when the frame data changes.
  strategy: [
    { move: 'chef_cleaver', tips: [
      "Don't hit into it. It has armor: your strike lands, the cleaver comes down anyway, and you're the one on the floor.",
      "Stand-block it. It's an overhead, so crouching loses. Then punish with the cross (2) or →2.",
      "Within arm's reach, a throw (1+3) goes through the armor. From farther out it only trades.",
      "→ parries it.",
    ] },
    { move: 'chef_flambe', tips: [
      "Stand-block it. It's a mid that launches, and crouching puts you in the air.",
      "Blocked, he's open: jab (1), snap kick (3) or →2.",
      "A low jab (↓1) thrown the moment he starts gets there first.",
      "→ parries it.",
    ] },
    { string: 'EIGHTY-SIX', tips: [
      "Stand-block all three, then punish. The push kick leaves him open for the cross (2) or →2.",
      "After you block the first jab, a low kick (↓3) goes under the second one and hits first.",
      "Crouch from the start and the first jab goes over your head. The string stops there, and a low kick (↓3) punishes.",
    ] },
  ],
};
