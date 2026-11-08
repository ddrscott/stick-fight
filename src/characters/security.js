// SECURITY: the big grappler: a bigger, stocky rig (thick torso, short arms and legs, so his reach is about
// TEMP's while there's more of him to hit). More health, a heavier body that barely moves when hit, slower walk and
// jump, a bigger rig, more stamina. Two unique moves, Escort (f+1+3, a command grab that can't be broken
// and throws the victim into the wall, or over the stairwell railing) and Shoulder Check (b+2, an
// armored charge that walks through one hit and bounces the victim off a nearby wall), and one unique
// string, LOCKDOWN (1,2,1), ending in an overhead hammer fist. Drops SKY SPIKE (too airborne for him).
import { RIG_KIT } from '../fighter/index.js';

const { K, F, LF, RF, HIP } = RIG_KIT;

// f+1+3: both hands out for the collar, then a two-handed shove that sends him flying. The grab freezes
// on the active key for the hold; the shove plays as the victim leaves.
const escort = { blend: 40, limb: 'lHand', shift: 30, keys: [
  K({ ...F(-4, HIP - 4, LF, RF), torso: 4, bend: 0, head: -2, tw: 4, la: [40, 100], ra: [30, 100] }, 100, 'in'),
  K({ ...F(2, HIP - 6, LF + 6, RF, 6, 0), torso: 12, bend: 2, head: -4, la: [70, 110], ra: [60, 110] }, 70, 'in'),
  K({ ...F(10, HIP - 7, LF + 14, RF), torso: 20, bend: 4, head: -6, la: [92, 96], ra: [86, 92] }, 40, 'out', 'active'),
  K({ ...F(6, HIP - 10, LF + 14, RF), torso: -4, bend: -3, head: 4, la: [74, 100], ra: [66, 96] }, 50, 'in'),
  K({ ...F(24, HIP - 10, LF + 30, RF + 6), torso: 30, bend: 8, head: -10, la: [96, 90], ra: [92, 86] }, 50, 'out', 'recover'),
  K({ ...F(22, HIP - 6, LF + 30, RF + 6), torso: 18, bend: 4, head: -6, la: [70, 120], ra: [60, 120] }, 130, 'inOut'),
  K({ ...F(26, HIP - 2, LF + 30, RF + 30, 0, 8), torso: 8, head: -4, la: [54, 148], ra: [30, 160] }, 120, 'inOut', 'footstep'),
  K({ ...F(30, HIP - 1, LF + 30, RF + 30), torso: 6, head: -4 }, 0, 'sine'),
] };

// b+2: turn the shoulder, step in low and drive it through his chest (the elbow carries the hit), the
// body staying behind it. Armored from the press until recovery.
const shoulderCheck = { blend: 40, limb: 'rElbow', shift: 40, keys: [
  K({ ...F(-6, HIP - 6, LF, RF), torso: 10, bend: 2, head: 0, tw: -16, la: [30, 110], ra: [10, 120] }, 80, 'in'),
  K({ ...F(4, HIP - 10, LF + 20, RF, 8, 0), torso: 30, bend: 6, head: -8, tw: 14, la: [40, 120], ra: [56, 150] }, 70, 'linear'),
  K({ ...F(16, HIP - 12, LF + 34, RF + 4), torso: 40, bend: 6, head: -14, tw: 22, la: [30, 120], ra: [72, 162] }, 40, 'out', 'active'),
  K({ ...F(20, HIP - 12, LF + 40, RF + 10), torso: 42, bend: 6, head: -14, tw: 22, la: [30, 120], ra: [74, 164] }, 130, 'inOut'),
  K({ ...F(22, HIP - 6, LF + 40, RF + 14), torso: 22, bend: 3, head: -8, tw: 6, la: [40, 130], ra: [40, 140] }, 90, 'inOut', 'recover'),
  K({ ...F(34, HIP - 2, LF + 40, RF + 40, 0, 8), torso: 8, head: -4, la: [54, 148], ra: [30, 160] }, 110, 'inOut', 'footstep'),
  K({ ...F(40, HIP - 1, LF + 40, RF + 40), torso: 6, head: -4 }, 0, 'sine'),
] };

// LOCKDOWN's ender: both fists up over the head, then down on him like a gavel. Overhead (a mid that
// hits crouchers), knocks down.
const lockdown = { blend: 40, limb: 'rHand', shift: 10, keys: [
  K({ ...F(-2, HIP - 2, LF, RF), torso: -6, bend: -4, head: 4, la: [150, 175], ra: [160, 185] }, 70, 'in'),
  K({ ...F(-4, HIP + 1, LF, RF), torso: -14, bend: -8, head: 8, la: [172, 190], ra: [178, 196] }, 60, 'in'),
  K({ ...F(12, HIP - 10, LF + 10, RF), torso: 34, bend: 8, head: -12, la: [96, 70], ra: [100, 76] }, 40, 'out', 'active'),
  K({ ...F(14, HIP - 12, LF + 10, RF), torso: 40, bend: 9, head: -14, la: [72, 50], ra: [76, 54] }, 60, 'inOut'),
  K({ ...F(10, HIP - 6, LF + 10, RF), torso: 20, bend: 4, head: -8, la: [40, 100], ra: [40, 110] }, 100, 'inOut', 'recover'),
  K({ ...F(6, HIP - 2, LF + 10, RF + 10, 0, 6), torso: 7, head: -4, la: [54, 148], ra: [30, 160] }, 100, 'out', 'footstep'),
  K({ ...F(10, HIP - 1, LF + 10, RF + 10), torso: 6, head: -4 }, 0, 'sine'),
] };

// mirrored shades and an earpiece on a coiled wire: dark lenses with a bright rim, the coil in the accent
function shadesAndEarpiece(ctx, J, o) {
  const h = J.head, n = J.neck, r = o.headR, s = o.scale;
  let ux = h.x - n.x, uy = h.y - n.y; const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
  const fx = -uy * o.facing, fy = ux * o.facing;
  ctx.lineCap = 'round';
  const ex = h.x + fx * r * 0.45 + ux * r * 0.12, ey = h.y + fy * r * 0.45 + uy * r * 0.12;
  ctx.strokeStyle = '#0a0414'; ctx.lineWidth = 5 * s;
  ctx.beginPath(); ctx.moveTo(ex - fx * r * 0.2, ey - fy * r * 0.2); ctx.lineTo(ex + fx * r * 0.62, ey + fy * r * 0.62); ctx.stroke();
  ctx.strokeStyle = o.accent; ctx.lineWidth = 1.4 * s;
  ctx.beginPath(); ctx.moveTo(ex - fx * r * 0.15 - ux * 2 * s, ey - fy * r * 0.15 - uy * 2 * s); ctx.lineTo(ex + fx * r * 0.58 - ux * 2 * s, ey + fy * r * 0.58 - uy * 2 * s); ctx.stroke();
  // the earpiece behind the eye, its wire coiling down the neck to the collar
  const qx = h.x - fx * r * 0.35, qy = h.y - fy * r * 0.35;
  ctx.fillStyle = o.accent; ctx.beginPath(); ctx.arc(qx, qy, 2.4 * s, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 1.5 * s; ctx.beginPath(); ctx.moveTo(qx, qy);
  for (let i = 1; i <= 6; i++) {
    const t = i / 6, wig = (i % 2 ? 1 : -1) * 2.2 * s;
    ctx.lineTo(qx + (n.x - fx * r * 0.5 - qx) * t + fx * wig, qy + (n.y + 6 * s - qy) * t + fy * wig);
  }
  ctx.stroke();
}

export default {
  id: 'security',
  name: 'SECURITY',
  tagline: 'WILL ESCORT YOU OUT. THROUGH THE RAILING',
  color: '#5dff8a',
  altColor: '#ffd84f',
  accent: '#e9fff0',
  stats: { health: 100, walk: 0.84, backWalk: 0.9, run: 0.88, jump: 0.92, dash: 0.9, weight: 1.2, stamina: 1.05, regen: 0.85, damage: 0.86 },
  body: { scale: 1.12, headR: 14, upperArm: 21.5, lowerArm: 20.5, upperLeg: 28.5, lowerLeg: 27.5, lowerTorso: 18, upperTorso: 20, limbW: 11.5, limbTip: 8.6, torsoW: 19, hipW: 13, lean: 4, stance: 3, accessory: shadesAndEarpiece },
  moves: {
    escort: { rig: escort, frame: { limb: 'hand', damage: 10, kb: { x: 780, y: 200 }, hitstun: 0, blockstun: 0, hitstop: 7, knockdown: true, height: 'throw',
      throw: true, grab: true, noBreak: true, unblockable: true, range: 92, hold: 16, splat: true, cost: 30, reach: 70, flashR: 32, callout: 'ESCORT' } },   // range 116, cost 24 and 12 damage dominated once stamina came back faster
    shoulderCheck: { rig: shoulderCheck, frame: { limb: 'hand', damage: 12, kb: { x: 460, y: 230 }, hitstun: 0, blockstun: 12, hitstop: 8, knockdown: true, height: 'mid',
      armor: { hits: 1, dmg: 0.5 }, wallBounce: true, cost: 26, reach: 80, flashR: 36, callout: 'SHOULDER CHECK' } },
    lockdown: { rig: lockdown, frame: { limb: 'hand', damage: 16, kb: { x: 260, y: 300 }, hitstun: 0, blockstun: 16, hitstop: 10, knockdown: true, ender: true, height: 'overhead',
      reach: 85, flashR: 40, callout: 'LOCKDOWN' } },
  },
  commands: [
    { button: '1+3', motion: 'f', move: 'escort' },
    { button: '2+4', motion: 'f', move: 'escort' },
    { button: '2', motion: 'b', move: 'shoulderCheck' },
  ],
  strings: { drop: ['SKY SPIKE'], add: [{ name: 'LOCKDOWN', keys: ['1', '2', '1'], moves: ['jab', 'cross', 'lockdown'] }] },
  ai: {
    style: 'grappler',
    range: 'close',
    specials: [
      { move: 'shoulderCheck', min: 60, max: 170, when: 'attacking', chance: 0.65, cooldown: 90 },
      { move: 'escort', min: 0, max: 116, when: 'guarding', chance: 0.7, cooldown: 80 },
      { move: 'escort', min: 0, max: 112, when: (me, o) => o.grounded && !o.crouch && o.state !== 'attack' && o.state !== 'jump', chance: 0.32, cooldown: 120 },
      { move: 'shoulderCheck', min: 80, max: 160, when: 'standing', chance: 0.2, cooldown: 150 },
    ],
  },
  moveList: [
    { name: 'ESCORT', input: '→ 1+3', note: 'command grab, can’t be broken' },
    { name: 'SHOULDER CHECK', input: '← 2', note: 'armored charge, wall bounce' },
    { name: 'LOCKDOWN', input: '1, 2, 1', note: 'string, overhead hammer' },
  ],
};
