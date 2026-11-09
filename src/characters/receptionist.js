// RECEPTIONIST: spacing and reach. A standard-sized, slim body that moves well forward and back, with one
// very long tool: the desk phone she never puts down. Two unique moves: Please Hold (f+1, the handset flung
// out on its coiled cord: a long, thin mid lash that only hits with the far end of the cord, so it's
// wide open up close and slow to reel back in) and Transfer (b+1+3, a grab that can't be broken: she heaves him up over her
// head and down on her other side: a real side change on the point simulation, the `backThrow` hook). One
// unique string, HANG UP (3, 1, 1), ending in the handset swung over the top and down on him (an overhead).
// Keeps every shared string.
import { RIG_KIT } from '../fighter/index.js';

const { K, F, LF, RF, HIP } = RIG_KIT;

// f+1: the lead hand winds the handset back by the ear, then whips it out straight; the cord pays out
// (the pose's `ext`: px past the hand, which the hitbox follows) and hangs at full stretch a beat, then
// she reels it back in hand over hand. Up close only the hand is there, and the hand doesn't hit.
const pleaseHold = { blend: 40, limb: 'lHand', keys: [
  K({ ...F(-3, HIP - 2, LF, RF), torso: 0, bend: -2, head: -2, tw: 8, la: [-14, 150], ra: [30, 158] }, 90, 'in'),
  K({ ...F(2, HIP - 2, LF, RF), torso: 8, bend: 1, head: -4, tw: -4, la: [74, 104], ra: [32, 156], ext: 72 }, 50, 'linear'),
  K({ ...F(8, HIP - 2, LF, RF), torso: 15, bend: 3, head: -6, tw: -12, la: [91, 90], ra: [36, 152], ext: 100 }, 40, 'out', 'active'),
  K({ ...F(9, HIP - 2, LF, RF), torso: 16, bend: 3, head: -6, tw: -13, la: [92, 91], ra: [36, 152], ext: 104 }, 70, 'inOut', 'recover'),
  K({ ...F(6, HIP - 2, LF, RF), torso: 11, bend: 2, head: -5, tw: -8, la: [78, 118], ra: [40, 150], ext: 52 }, 100, 'inOut'),
  K({ ...F(3, HIP - 1, LF, RF), torso: 7, bend: 0, head: -4, tw: -2, la: [58, 146], ra: [32, 160], ext: 10 }, 100, 'inOut'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4 }, 0, 'sine'),
] };

// b+1+3: both hands take his collar, a beat of hold (it can't be broken), then she sinks, pulls him in and
// heaves him up and over her head, arching back with the arms following him round behind her, and comes
// back to her guard facing where he was. He flies on the point simulation (backThrow), so the side change is
// a real arc over her.
const transfer = { blend: 40, limb: 'lHand', keys: [
  K({ ...F(-2, HIP - 4, LF, RF), torso: 8, head: -2, la: [52, 118], ra: [44, 118] }, 40, 'in'),
  K({ ...F(8, HIP - 6, LF + 8, RF, 8, 0), torso: 16, bend: 3, head: -6, la: [84, 92], ra: [76, 92] }, 40, 'out', 'active'),
  K({ ...F(6, HIP - 9, LF + 8, RF), torso: 12, bend: 2, head: -4, la: [84, 74], ra: [76, 72] }, 50, 'in'),
  K({ ...F(2, HIP - 12, LF + 8, RF), torso: -2, bend: -4, head: 4, la: [132, 150], ra: [124, 144] }, 70, 'linear'),
  K({ ...F(-2, HIP - 6, LF + 8, RF), torso: -16, bend: -8, head: 12, la: [184, 196], ra: [176, 190] }, 80, 'out', 'recover'),
  K({ ...F(-3, HIP - 4, LF + 8, RF), torso: -12, bend: -6, head: 10, la: [204, 214], ra: [196, 208] }, 90, 'inOut'),
  K({ ...F(0, HIP - 3, LF + 8, RF), torso: 2, bend: 0, head: -2, la: [110, 150], ra: [96, 150] }, 120, 'inOut'),
  K({ ...F(2, HIP - 2, LF + 8, RF + 8, 0, 8), torso: 6, head: -4, la: [54, 148], ra: [30, 160] }, 100, 'inOut'),
  K({ ...F(6, HIP - 1, LF + 8, RF + 8), torso: 6, head: -4 }, 0, 'sine', 'footstep'),
] };

// HANG UP's ender: the handset swung on a short length of cord, up over her head and straight down on him
// like slamming the receiver. An overhead (a crouching guard doesn't hold it), knocks down.
const hangUp = { blend: 40, limb: 'lHand', shift: 8, keys: [
  K({ ...F(-2, HIP - 1, LF, RF), torso: -4, bend: -3, head: 2, tw: 6, la: [120, 170], ra: [36, 150], ext: 16 }, 60, 'in'),
  K({ ...F(-4, HIP + 1, LF, RF), torso: -12, bend: -6, head: 8, tw: 8, la: [178, 196], ra: [40, 148], ext: 34 }, 60, 'in'),
  K({ ...F(8, HIP - 6, LF + 8, RF), torso: 24, bend: 6, head: -10, tw: -10, la: [126, 74], ra: [24, 120], ext: 42 }, 40, 'out', 'active'),
  K({ ...F(10, HIP - 8, LF + 8, RF), torso: 30, bend: 7, head: -12, tw: -12, la: [108, 52], ra: [20, 110], ext: 40 }, 60, 'inOut'),
  K({ ...F(8, HIP - 5, LF + 8, RF), torso: 18, bend: 4, head: -8, tw: -6, la: [64, 80], ra: [26, 130], ext: 22 }, 100, 'inOut', 'recover'),
  K({ ...F(6, HIP - 2, LF + 8, RF + 8, 0, 6), torso: 8, head: -4, la: [54, 140], ra: [30, 160], ext: 6 }, 110, 'out', 'footstep'),
  K({ ...F(8, HIP - 1, LF + 8, RF + 8), torso: 6, head: -4 }, 0, 'sine'),
] };

// a slim office headset (a thin band over the crown, a small ear pad, a short boom to the cheek) and the
// desk phone's handset in the lead hand on its coiled cord, which runs down to the base clipped at her hip.
// In Please Hold the handset flies out to the end of the cord (the pose's ext), the coils pulled nearly straight.
function headsetAndPhone(ctx, J, o) {
  const h = J.head, n = J.neck, r = o.headR, s = o.scale;
  let ux = h.x - n.x, uy = h.y - n.y; const Ln = Math.hypot(ux, uy) || 1; ux /= Ln; uy /= Ln;
  const fx = -uy * o.facing, fy = ux * o.facing;
  const a = Math.atan2(uy, ux);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = o.accent; ctx.lineWidth = 1.8 * s;
  ctx.beginPath(); ctx.arc(h.x, h.y, r * 1.1, a - 1.1, a + 1.0); ctx.stroke();
  const ex = h.x - fx * r * 0.08, ey = h.y - fy * r * 0.08;
  ctx.fillStyle = o.accent; ctx.beginPath(); ctx.arc(ex, ey, r * 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 1.4 * s; ctx.beginPath(); ctx.moveTo(ex, ey);
  ctx.lineTo(h.x + fx * r * 0.7 - ux * r * 0.45, h.y + fy * r * 0.7 - uy * r * 0.45); ctx.stroke();
  // the handset: at the hand, or out along the forearm at the end of the cord
  const hand = J.lHand, el = J.lElbow;
  let dx = hand.x - el.x, dy = hand.y - el.y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
  const ext = (o.pose && o.pose.ext) || 0, out = ext > 4 ? ext * s : 0;
  const px = hand.x + dx * (out + 4 * s), py = hand.y + dy * (out + 4 * s);
  // the cord: from the base at the hip to the hand, then (flung) from the hand out to the handset
  const coil = (x0, y0, x1, y1, turns, amp) => {
    const cx = x1 - x0, cy = y1 - y0, cl = Math.hypot(cx, cy) || 1, nx = -cy / cl, ny = cx / cl;
    ctx.beginPath(); ctx.moveTo(x0, y0);
    for (let i = 1; i <= turns * 2; i++) { const t = i / (turns * 2), w = (i % 2 ? 1 : -1) * amp * Math.sin(Math.PI * t); ctx.lineTo(x0 + cx * t + nx * w, y0 + cy * t + ny * w); }
    ctx.lineTo(x1, y1); ctx.stroke();
  };
  ctx.strokeStyle = o.accent; ctx.lineWidth = 1.2 * s;
  const bx = J.hip.x - fx * 0 + (J.hip.x - J.chest.x) * 0.1, by = J.hip.y + 2 * s;
  coil(bx, by, hand.x, hand.y, 5, 2.2 * s);
  if (out) { ctx.lineWidth = 1.3 * s; coil(hand.x, hand.y, px, py, 6, Math.max(0.6, 3.2 - ext / 40) * s); }
  // the handset itself: a short bar across the cord with an earpiece and a mouthpiece
  const qx = -dy, qy = dx, hl = 7 * s;
  ctx.strokeStyle = '#0a0414'; ctx.lineWidth = 5.4 * s;
  ctx.beginPath(); ctx.moveTo(px - qx * hl, py - qy * hl); ctx.lineTo(px + qx * hl, py + qy * hl); ctx.stroke();
  ctx.strokeStyle = o.accent; ctx.lineWidth = 3.4 * s;
  ctx.beginPath(); ctx.moveTo(px - qx * hl, py - qy * hl); ctx.lineTo(px + qx * hl, py + qy * hl); ctx.stroke();
  ctx.fillStyle = o.accent;
  ctx.beginPath(); ctx.arc(px - qx * hl + dx * 1.5 * s, py - qy * hl + dy * 1.5 * s, 2.6 * s, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(px + qx * hl + dx * 1.5 * s, py + qy * hl + dy * 1.5 * s, 2.6 * s, 0, Math.PI * 2); ctx.fill();
}

// The celebration (registry `dance`, played by the match winner under the WINS banner): A phone at the ear with the free hand on the hip, the hips swinging side to side: please hold, forever.
const dance = { keys: [
  K({ ...F(-9, HIP - 4, LF, RF), torso: -6, bend: -4, head: -12, la: [150, 250], ra: [30, -70] }, 280, 'sine'),
  K({ ...F(9, HIP - 1, LF, RF, 0, 4), torso: 10, bend: 2, head: 2, la: [150, 250], ra: [30, -70] }, 280, 'sine'),
  K({ ...F(-9, HIP - 4, LF, RF), torso: -6, bend: -4, head: -12, la: [150, 250], ra: [30, -70] }, 280, 'sine'),
  K({ ...F(9, HIP - 1, LF, RF, 4, 0), torso: 10, bend: 2, head: 2, la: [150, 250], ra: [30, -70] }, 280, 'sine'),
] };

export default {
  dance,
  id: 'receptionist',
  name: 'RECEPTIONIST',
  tagline: 'PLEASE HOLD. YOUR BEATING IS IMPORTANT TO US',
  // how it moves (the life layer's signature, src/fighter/life.js: drawn only): attentive: a quick eye, glances at the door, straightens up
  life: { eye: 1.2, damp: 1.1, sway: 0.5, swayHz: 0.45, habits: ['glance', 'straighten'] },
  color: '#b46bff',
  altColor: '#ff5fd2',
  accent: '#ffe3f7',
  pants: '#5dff8a',
  altPants: '#fff27a',
  // light on her feet both ways (the spacing game) and a little lighter, with a touch more damage and regen to pay for the open cord
  stats: { health: 102, walk: 1.04, backWalk: 1.08, run: 1.0, jump: 1, dash: 1, weight: 0.96, stamina: 1, regen: 1.1, damage: 1.06 },
  // TEMP's arms and legs on a slim frame: her reach is the cord, not the limbs
  body: { scale: 0.98, headR: 14.5, limbW: 11, limbTip: 8.4, torsoW: 14, hipW: 11, lean: 1, accessory: headsetAndPhone },
  moves: {
    receptionist_pleaseHold: { rig: pleaseHold, frame: { limb: 'hand', damage: 10, kb: { x: 300, y: 0 }, hitstun: 30, blockstun: 9, hitstop: 6, knockdown: false, height: 'mid',
      cost: 20, reach: 180, flashR: 24, callout: 'PLEASE HOLD' } },
    receptionist_transfer: { rig: transfer, frame: { limb: 'hand', damage: 10, kb: { x: 300, y: 570 }, hitstun: 0, blockstun: 0, hitstop: 6, knockdown: true, height: 'throw',
      throw: true, grab: true, unblockable: true, noBreak: true, hold: 14, backThrow: true, range: 96, cost: 26, reach: 60, flashR: 30, callout: 'TRANSFER' } },
    receptionist_hangUp: { rig: hangUp, frame: { limb: 'hand', damage: 14, kb: { x: 240, y: 300 }, hitstun: 0, blockstun: 14, hitstop: 9, knockdown: true, ender: true, height: 'overhead',
      reach: 110, flashR: 34, callout: 'HANG UP' } },
  },
  commands: [
    { button: '1', motion: 'f', move: 'receptionist_pleaseHold' },
    { button: '1+3', motion: 'b', move: 'receptionist_transfer' },
    { button: '2+4', motion: 'b', move: 'receptionist_transfer' },
  ],
  strings: { add: [{ name: 'HANG UP', keys: ['3', '1', '1'], moves: ['lkick', 'jab', 'receptionist_hangUp'] }] },
  ai: {
    specials: [
      // the long lash: at the far end of its reach, on a whiff, on someone walking in
      { move: 'receptionist_pleaseHold', min: 120, max: 182, lead: 20, when: 'whiff', chance: 0.75, cooldown: 70 },
      { move: 'receptionist_pleaseHold', min: 130, max: 182, lead: 10, when: (me, o) => o.grounded && !o.crouch && (o.state === 'walk' || o.state === 'run' || o.state === 'idle'), chance: 0.3, cooldown: 80 },
      // up close: transfer him to the other side (a wall behind him becomes a wall behind her... for him)
      { move: 'receptionist_transfer', min: 0, max: 92, when: 'guarding', chance: 0.3, cooldown: 110 },
      { move: 'receptionist_transfer', min: 0, max: 92, when: (me, o, sim) => o.grounded && !o.crouch && o.state !== 'attack' && o.state !== 'jump' &&
        (me.facing > 0 ? me.x - sim.bounds.x0 : sim.bounds.x1 - me.x) < 260 && (me.facing > 0 ? me.x - sim.bounds.x0 : sim.bounds.x1 - me.x) > 160, chance: 0.35, cooldown: 120 },
      { move: 'receptionist_transfer', min: 0, max: 90, when: (me, o) => o.grounded && !o.crouch && o.state !== 'attack' && o.state !== 'jump', chance: 0.04, cooldown: 180 },
    ],
  },
  moveList: [
    { name: 'PLEASE HOLD', input: '→ 1', note: 'phone-cord lash, long reach, open up close' },
    { name: 'TRANSFER', input: '← 1+3', note: 'grab over her head, can’t be broken: sides swap' },
    { name: 'HANG UP', input: '3, 1, 1', note: 'string, the handset slams down (overhead)' },
  ],
};
