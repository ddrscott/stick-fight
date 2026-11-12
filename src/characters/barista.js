// BARISTA: speed. A small, light, quick build with a short bar's worth of health. Espresso Shot (b+1) is a
// quick shot off the cup that leaves him WIRED for 2.5 seconds: every strike's startup plays 35% faster (the
// `selfStatus` hook), at 20 stamina and a counter-hit window while he drinks. Pour Over (b+2) is a four-hit
// flurry of lead-hand flicks finished by a stepping palm (the multi-hit `rush` hook), and one unique string,
// LATTE ART (1, 2, 1), ends in a whirling backfist. Keeps every shared string.
import { RIG_KIT } from '../fighter/index.js';
import { stoop, lift } from './perfectKit.js';
import { chainPath, ribbonPath, chainAt, chainNormal } from '../fighter/cloth.js';

const { K, F, LF, RF, HIP } = RIG_KIT;

// b+1: the cup comes up, the head tips back for the shot (the buff lands on the active key), the cup comes
// down hard and a shiver runs through him. Never strikes (noHit).
const espresso = { blend: 40, limb: 'lHand', keys: [
  K({ ...F(-2, HIP - 2, LF, RF), torso: 2, bend: -1, head: -4, tw: 4, la: [34, 150], ra: [30, 160] }, 70, 'in'),
  K({ ...F(-3, HIP - 1, LF, RF), torso: -4, bend: -4, head: -18, tw: 6, la: [26, 168], ra: [30, 158] }, 80, 'out'),
  K({ ...F(-3, HIP, LF, RF), torso: -8, bend: -6, head: -28, tw: 6, la: [34, 178], ra: [28, 156] }, 70, 'inOut', 'active'),
  K({ ...F(-3, HIP, LF, RF), torso: -9, bend: -6, head: -30, tw: 6, la: [35, 180], ra: [28, 156] }, 70, 'sine'),
  K({ ...F(1, HIP - 6, LF, RF), torso: 14, bend: 4, head: 4, tw: 0, la: [62, 96], ra: [30, 150] }, 60, 'out', 'recover'),
  K({ ...F(0, HIP + 1, LF, RF, 3, 0), torso: 4, bend: 0, head: -8, tw: 7, la: [52, 140], ra: [32, 162] }, 60, 'inOut'),
  K({ ...F(0, HIP - 2, LF, RF, 0, 3), torso: 7, bend: 1, head: -2, tw: -6, la: [56, 146], ra: [28, 166] }, 60, 'inOut'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4 }, 0, 'sine'),
] };

// b+2: three quick lead-hand flicks (head, head, body), the fist snapping back to the chin between them,
// then a coil and a stepping lead palm. Four active keys, frame data hits: 4.
const pourOver = { blend: 40, limb: 'lHand', shift: 24, keys: [
  K({ ...F(-2, HIP - 3, LF, RF), torso: 8, bend: 1, head: -4, tw: 6, la: [50, 132], ra: [30, 165] }, 40, 'in'),
  K({ ...F(6, HIP - 4, LF, RF), torso: 16, bend: 3, head: -5, tw: -10, la: [92, 94], ra: [32, 162] }, 40, 'out', 'active'),
  K({ ...F(6, HIP - 4, LF, RF), torso: 16, bend: 3, head: -5, tw: -10, la: [91, 92], ra: [32, 162] }, 30, 'inOut'),
  K({ ...F(3, HIP - 4, LF, RF), torso: 10, bend: 1, head: -4, tw: 2, la: [56, 124], ra: [30, 164] }, 40, 'in'),
  K({ ...F(8, HIP - 5, LF + 4, RF), torso: 18, bend: 3, head: -6, tw: -11, la: [97, 100], ra: [32, 162] }, 40, 'out', 'active'),
  K({ ...F(8, HIP - 5, LF + 4, RF), torso: 18, bend: 3, head: -6, tw: -11, la: [96, 98], ra: [32, 162] }, 30, 'inOut'),
  K({ ...F(5, HIP - 5, LF + 8, RF, 4, 0), torso: 12, bend: 2, head: -5, tw: 2, la: [56, 120], ra: [30, 164] }, 40, 'in'),
  K({ ...F(12, HIP - 8, LF + 10, RF), torso: 22, bend: 4, head: -7, tw: -12, la: [86, 84], ra: [32, 160] }, 40, 'out', 'active'),
  K({ ...F(12, HIP - 8, LF + 10, RF), torso: 22, bend: 4, head: -7, tw: -12, la: [85, 82], ra: [32, 160] }, 40, 'inOut'),
  K({ ...F(6, HIP - 6, LF + 10, RF), torso: 4, bend: -1, head: -2, tw: 10, la: [28, 110], ra: [24, 146] }, 60, 'in'),
  K({ ...F(20, HIP - 10, LF + 24, RF + 4), torso: 30, bend: 6, head: -10, tw: -16, la: [94, 90], ra: [36, 158] }, 40, 'out', 'active'),
  K({ ...F(21, HIP - 10.5, LF + 24, RF + 4), torso: 31, bend: 6, head: -10, tw: -16, la: [95, 90], ra: [36, 158] }, 90, 'inOut'),
  K({ ...F(20, HIP - 6, LF + 24, RF + 8), torso: 16, bend: 3, head: -6, tw: -6, la: [60, 120], ra: [32, 162] }, 100, 'inOut', 'recover'),
  K({ ...F(20, HIP - 2, LF + 24, RF + 24, 0, 8), torso: 7, head: -4, la: [54, 148], ra: [28, 166] }, 100, 'inOut', 'footstep'),
  K({ ...F(24, HIP - 1, LF + 24, RF + 24), torso: 6, head: -4 }, 0, 'sine'),
] };

// LATTE ART's ender: a quick whirl on the lead foot and the lead hand's backfist comes round at head height
const latteArt = { blend: 40, limb: 'lHand', shift: 14, keys: [
  K({ ...F(2, HIP - 4, LF, RF), torso: 10, bend: 2, head: 4, tw: 6, spin: 60, la: [70, 150], ra: [30, 150] }, 50, 'in'),
  K({ ...F(8, HIP - 6, LF + 8, RF + 10, 0, 8), torso: 16, bend: 3, head: -8, spin: 190, la: [100, 190], ra: [24, 140] }, 50, 'linear'),
  K({ ...F(14, HIP - 5, LF + 14, RF + 14), torso: 16, bend: 3, head: -6, tw: -14, spin: 345, la: [94, 98], ra: [22, 140] }, 40, 'out', 'active'),
  K({ ...F(14, HIP - 5, LF + 14, RF + 14), torso: 18, bend: 4, head: -6, tw: -15, spin: 360, la: [95, 92], ra: [22, 140] }, 70, 'inOut'),
  K({ ...F(14, HIP - 5, LF + 14, RF + 14), torso: 14, bend: 3, head: -4, tw: -8, spin: 360, la: [70, 60], ra: [24, 140] }, 90, 'in', 'recover'),
  K({ ...F(14, HIP - 4, LF + 14, RF + 14), torso: 10, bend: 2, head: -3, spin: 360, la: [44, 100], ra: [26, 146] }, 140, 'sine'),
  K({ ...F(14, HIP - 1, LF + 14, RF + 14), torso: 6, head: -4, spin: 360, la: [54, 148], ra: [28, 162] }, 110, 'out', 'footstep'),
  K({ ...F(14, HIP - 1, LF + 14, RF + 14), torso: 6, head: -3, spin: 360 }, 0, 'sine'),
] };

// an apron over the front of the torso down to the thighs (a dark panel with a cream edge and a neck
// strap), and a paper cup: tucked in the apron pocket, or in the lead hand when that hand is up at the
// mouth with the forearm upright (the espresso shot). The bib down to the waist tie stays on the body; the
// skirt under it is a cloth chain (below) that flexes at the hem, and the tie's tail swings behind.
const cupAtMouth = (J, o) => {
  const h = J.lHand, e = J.lElbow, hd = J.head;
  return (e.y - h.y) / (Math.hypot(h.x - e.x, h.y - e.y) || 1) > 0.95 && Math.hypot(h.x - hd.x, h.y - hd.y) < o.headR * 1.9;
};
function cup(ctx, x, y, tilt, s, o) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(tilt);
  ctx.beginPath(); ctx.moveTo(-3.6 * s, -5 * s); ctx.lineTo(3.6 * s, -5 * s); ctx.lineTo(2.6 * s, 5 * s); ctx.lineTo(-2.6 * s, 5 * s); ctx.closePath();
  ctx.fillStyle = o.accent; ctx.fill(); ctx.strokeStyle = '#2a1408'; ctx.lineWidth = 1 * s; ctx.stroke();
  ctx.fillStyle = '#2a1408'; ctx.fillRect(-3.4 * s, -1.2 * s, 6.8 * s, 2.4 * s);
  ctx.restore();
}
function apronAndCup(ctx, J, o) {
  const s = o.scale, n = J.neck, c = J.chest, hp = J.hip;
  let dx = hp.x - c.x, dy = hp.y - c.y; const Lt = Math.hypot(dx, dy) || 1; dx /= Lt; dy /= Lt;
  const fx = dy * o.facing, fy = -dx * o.facing;
  // side view: the panel runs down the front of the torso, from the centerline out past the chest's front edge
  const P = (t, side) => { const off = side > 0 ? (7.5 + 3 * Math.max(0, t)) * s : -1 * s; return { x: c.x + dx * Lt * t + fx * off, y: c.y + dy * Lt * t + fy * off }; };
  const pts = [P(-0.05, -1), P(-0.05, 1), P(0.9, 1), P(0.9, -1)];
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
  ctx.fillStyle = '#2a1408'; ctx.fill();
  ctx.strokeStyle = o.accent; ctx.lineWidth = 1.4 * s; ctx.stroke();
  // the neck strap
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(n.x, n.y); ctx.lineTo(pts[1].x, pts[1].y); ctx.stroke();
  // the cup at the mouth (in the pocket it's drawn with the skirt)
  if (cupAtMouth(J, o)) cup(ctx, J.lHand.x, J.lHand.y - 3 * s, -0.5 * o.facing, s, o);
}
// the apron's skirt from the waist tie to the hem (a cloth chain down its middle), the tie across its top
// edge, and the cup in the pocket
function skirt(ctx, P, o) {
  const s = o.scale;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ribbonPath(ctx, P, o.facing, (t) => (5.6 + 1 * t) * s);
  ctx.fillStyle = '#2a1408'; ctx.fill();
  ctx.strokeStyle = o.accent; ctx.lineWidth = 1.4 * s; ctx.stroke();
  if (!cupAtMouth(o.J, o)) {
    const q = chainAt(P, 0.54), nm = chainNormal(P, Math.min(P.length - 1, q.i + 1), o.facing);
    cup(ctx, q.x + nm.x * 6.1 * s, q.y + nm.y * 6.1 * s, 0, s, o);
  }
}
// the waist tie's tail, out behind
function tieTail(ctx, P, o) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = o.accent; ctx.lineWidth = 1.4 * o.scale;
  chainPath(ctx, P); ctx.stroke();
}

// The celebration (registry `dance`, played by the match winner under the WINS banner): Shaking the order: both hands pump a shaker at the shoulder, bouncing on the toes, then serve it out.
const dance = { keys: [
  K({ ...F(0, HIP - 4, LF, RF), torso: 4, head: -4, la: [120, 210], ra: [110, 200] }, 100, 'sine'),
  K({ ...F(0, HIP + 1, LF, RF), torso: 2, head: -8, la: [150, 230], ra: [140, 220], air: 4 }, 100, 'sine'),
  K({ ...F(0, HIP - 4, LF, RF), torso: 4, head: -4, la: [120, 210], ra: [110, 200] }, 100, 'sine'),
  K({ ...F(0, HIP + 1, LF, RF), torso: 2, head: -8, la: [150, 230], ra: [140, 220], air: 4 }, 100, 'sine'),
  K({ ...F(0, HIP - 4, LF, RF), torso: 4, head: -4, la: [120, 210], ra: [110, 200] }, 100, 'sine'),
  K({ ...F(0, HIP + 1, LF, RF), torso: 2, head: -8, la: [150, 230], ra: [140, 220], air: 4 }, 100, 'sine'),
  K({ ...F(4, HIP - 2, LF + 6, RF), torso: 14, bend: 3, head: 4, la: [86, 92], ra: [30, 60] }, 200, 'out'),
  K({ ...F(4, HIP - 2, LF + 6, RF), torso: 16, bend: 4, head: 8, la: [88, 94], ra: [30, 60] }, 300, 'sine'),
] };

// The perfect round finisher (registry `perfect`, README Perfect rounds): a latte pour: the body across both hands like a pitcher, raised high and tipped, then a wiggling pour-flick at the camera; then the shaker shake.
const perfect = { name: 'LATTE POUR', note: 'A latte pour: the body across both hands like a pitcher, raised high and tipped, then a wiggling pour-flick at the camera; then the shaker shake.', stamp: 'EXTRA SHOT', hand: 'lHand', hold: 'carry', fly: { spin: 0, arc: 200, wobble: 1.2 }, keys: [
  ...stoop('both'),
  lift('chest', 'lHand', 200, 0.3),
  K({ face: 0.4, ...F(-2, HIP + 2, LF, RF - 2), torso: -12, bend: -6, head: -16, la: [150, 166], ra: [142, 160] }, 240, 'inOut'),
  K({ face: 0.55, ...F(-2, HIP + 2, LF, RF - 2), torso: -10, bend: -6, head: -14, la: [150, 140], ra: [142, 134] }, 120, 'sine'),
  K({ face: 0.9, ...F(4, HIP - 2, LF + 6, RF - 2), torso: 8, bend: 2, head: -8, la: [112, 88], ra: [104, 84] }, 90, 'out', 'release'),
  K({ face: 0.9, ...F(4, HIP - 2, LF + 6, RF - 2), torso: 8, bend: 2, head: -8, la: [116, 100], ra: [108, 96] }, 80, 'sine'),
  K({ face: 0.9, ...F(4, HIP - 2, LF + 6, RF - 2), torso: 8, bend: 2, head: -8, la: [108, 80], ra: [100, 78] }, 80, 'sine'),
  K({ face: 0.6, ...F(2, HIP - 1, LF + 6, RF), torso: 2, head: -6, la: [120, 210], ra: [110, 200] }, 200, 'inOut'),
  K({ face: 0.6, ...F(2, HIP - 2, LF + 6, RF), torso: 2, head: -6, la: [132, 222], ra: [122, 212] }, 120, 'sine'),
  K({ face: 0.55, ...F(2, HIP - 1, LF + 6, RF), torso: 2, head: -6, la: [116, 206], ra: [106, 196] }, 120, 'sine'),
  K({ face: 0.55, ...F(2, HIP, LF + 6, RF), torso: 2, head: -8, la: [130, 220], ra: [120, 210] }, 0, 'sine'),
] };

// Fighter mastery (README, Progression, Fighter mastery; the names are src/career/mastery.js KIT). The victory pose
// (registry `victory`, in place of the dance once it's unlocked and on): Order up: one hand presents the cup high, the other on the hip.
const victory = { keys: [
  K({ ...F(0, HIP - 3, LF, RF), torso: 6, head: 4, la: [50, 110], ra: [20, 30] }, 180, 'in'),
  K({ ...F(0, HIP, LF + 4, RF), torso: -4, bend: -3, head: -12, la: [150, 170], ra: [30, -70] }, 240, 'out'),
  K({ ...F(0, HIP, LF + 4, RF), torso: -4, bend: -3, head: -14, la: [150, 170], ra: [30, -70] }, 460, 'sine'),
] };
// The taunt (registry `taunt`): the last round's winner plays it under the next ROUND card, never in a fight, and it's
// over by FIGHT (TAUNT_MAX_MS). Name on the cup: holds up a cup, scribbles on it, squints at the name.
const taunt = { keys: [
  K({ ...F(0, HIP - 1, LF, RF), torso: 4, head: 10, la: [60, 120], ra: [12, 24] }, 180, 'out'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 4, head: 12, la: [60, 120], ra: [50, 108] }, 140, 'out'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 4, head: 12, la: [60, 120], ra: [54, 100] }, 110, 'snap'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 4, head: 12, la: [60, 120], ra: [50, 112] }, 110, 'snap'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 0, head: -4, la: [80, 150], ra: [12, 24] }, 240, 'out'),
  K({ ...F(0, HIP, LF, RF), torso: 2, head: 0, la: [12, 24], ra: [8, 20] }, 220, 'inOut'),
] };

export default {
  dance,
  victory,
  taunt,
  perfect,
  id: 'barista',
  name: 'BARISTA',
  tagline: 'ORDER UP. THE ORDER IS PAIN',
  // how it moves (the life layer's signature, src/fighter/life.js: drawn only): over-caffeinated: loose springs, a fast breath, a quick bounce, shaking out, fidgeting; laughs at your botch
  life: { spring: 1.3, damp: 0.8, eye: 1.3, breath: 1.5, sway: 0.5, swayHz: 0.8, bounce: 1.8, bounceHz: 2.6, habits: ['shakeOut', 'fidget'], laugh: true },
  color: '#ffb02e',
  altColor: '#5dd6ff',
  accent: '#fff1dc',
  pants: '#b46bff',
  altPants: '#c8ff3a',
  // quick everything, a light body that flies a little farther, less health
  stats: { health: 95, walk: 1.15, backWalk: 0.95, run: 1.15, jump: 1.04, dash: 1.15, weight: 0.92, stamina: 1, regen: 1.2, damage: 1.02 },
  body: { scale: 1, headR: 14.5, torsoW: 14, hipW: 10.5, limbW: 11.4, limbTip: 8.6, lean: 3, accessory: apronAndCup },
  cloth: [
    { draw: skirt, axis: ['chest', 'hip'], at: 0.9, off: [4.6, 0], dir: [0.088, 1], len: 11.1, seg: 2, hz: 2.6, damping: 0.4, side: 'front', clear: 3, limit: 1.1 },
    { draw: tieTail, layer: 'back', axis: ['chest', 'hip'], at: 0.9, off: [-1, 0], dir: [-0.6, 1], hang: 0.4, len: 8, seg: 2, hz: 2.2, damping: 0.25, limit: 2 },
  ],
  moves: {
    ba_espresso: { rig: espresso, frame: { limb: 'hand', damage: 0, kb: { x: 0, y: 0 }, hitstun: 0, blockstun: 0, hitstop: 0, height: 'mid', noHit: true,
      selfStatus: { speed: 1.35, ms: 2500, tag: 'WIRED' }, cost: 20, reach: 40, flashR: 0 } },
    ba_pourOver: { rig: pourOver, frame: { limb: 'hand', damage: 8, kb: { x: 440, y: 240 }, hitstun: 0, blockstun: 12, hitstop: 8, knockdown: true, height: 'mid',
      hits: 4, rush: { damage: 3, kb: { x: 0, y: 0 }, hitstun: 26, blockstun: 8, hitstop: 4, knockdown: false, ender: false, callout: null, flashR: 22 },
      travel: { vx: 220, at: 40, ms: 110 }, cost: 24, reach: 85, flashR: 36, callout: 'POUR OVER' } },
    ba_latteArt: { rig: latteArt, frame: { limb: 'hand', damage: 13, kb: { x: 560, y: 240 }, hitstun: 0, blockstun: 14, hitstop: 9, knockdown: true, ender: true, height: 'high',
      travel: { vx: 240, at: 40, ms: 120 }, reach: 85, flashR: 38, callout: 'LATTE ART' } },
  },
  commands: [
    { button: '1', motion: 'b', move: 'ba_espresso' },
    { button: '2', motion: 'b', move: 'ba_pourOver' },
  ],
  strings: { add: [{ name: 'LATTE ART', keys: ['1', '2', '1'], moves: ['jab', 'cross', 'ba_latteArt'] }] },
  ai: {
    style: 'rushdown',
    range: 'close',
    specials: [
      // the shot when there's room to drink it (out of reach, not wired yet), then he comes in fast
      { move: 'ba_espresso', min: 180, max: 400, lead: 0, chance: 0.35, cooldown: 420, when: (me, o, sim) => !(sim.stepCount < me.speedEnd) && o.state !== 'attack' && me.stamina > 60 },
      { move: 'ba_espresso', min: 0, max: 400, lead: 0, chance: 0.6, cooldown: 300, when: (me, o, sim) => !(sim.stepCount < me.speedEnd) && (o.state === 'down' || o.state === 'getup' || o.state === 'knockdown') && me.stamina > 40 },
      { move: 'ba_pourOver', min: 30, max: 95, when: 'whiff', chance: 0.6, cooldown: 80 },
      { move: 'ba_pourOver', min: 40, max: 95, when: (me, o) => o.grounded && !o.crouch && o.state !== 'attack', chance: 0.3, cooldown: 130 },
    ],
  },
  moveList: [
    { name: 'ESPRESSO SHOT', input: '← 1', note: 'WIRED 2.5s: faster startups' },
    { name: 'POUR OVER', input: '← 2', note: 'four-hit flurry, knocks down' },
    { name: 'LATTE ART', input: '1, 2, 1', note: 'string, whirling backfist' },
  ],
  // STRATEGY, for the fighter page only (README, Site): how to beat each unique move. The game never shows it,
  // and site/vite-plugin.mjs cuts it from the bundle. Every tip is measured: `node gauntlet/counters.mjs barista`
  // prints the numbers behind each one. Measure again when the frame data changes.
  strategy: [
    { move: 'ba_espresso', tips: [
      "He can't block or move while he drinks. If you're close, hit him: the cross (2) lands if you press it as he lifts the cup, and →2 reaches from a step farther out.",
      "Right next to him, a throw (1+3) works for the whole drink.",
      "The drink never hits you, so blocking it does nothing. It only makes his strikes come out faster for a couple of seconds.",
    ] },
    { move: 'ba_pourOver', tips: [
      "Stand-block all four hits. It's a mid, so crouching loses.",
      "It comes out almost instantly. Up close, don't try to out-press it: everything you throw trades or loses.",
      "It's safe once it's blocked. He ends up out of reach, so don't swing after it.",
    ] },
    { string: 'LATTE ART', tips: [
      "Stand-block all three, then punish the backfist with the cross (2) or →2.",
      "After you block his first jab, jab back (1) or low kick (↓3). His cross is slow to follow and you hit first.",
      "Crouch from the start and the first jab goes over your head. The string stops there, and a low kick (↓3) punishes.",
    ] },
  ],
};
