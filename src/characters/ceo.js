// THE CEO: the balanced powerhouse. A little better at everything (health, speed, weight, reach of his uniques) with one
// weakness: the smallest stamina bar in the building, so he can't throw everything he has in one go. Two unique
// moves: Golden Parachute (b+1, a hop back out of trouble that strikes and throws pass straight through for its
// first fifth of a second, the `invuln` hook; it never strikes, and the landing is open) and Hostile Takeover
// (d/f+2, a stepping two-fisted uppercut that launches; on a body already in the air it's the ender instead, a
// swing that sends him across the floor into the wall, the `onJuggle` hook). One unique string, STOCK SPLIT
// (2, 1, 2), ending in a rear fist to the gut that splits up into an uppercut (two hits, the `hits` hook).
// Keeps every shared string.
import { RIG_KIT } from '../fighter/index.js';

const { K, F, LF, RF, HIP } = RIG_KIT;

// b+1: knees dip, a two-footed hop straight back (the body glides back on frame data travel), the hands
// coming up to straighten the tie on the way, then he lands soft and settles back into his guard.
const parachute = { blend: 30, limb: 'lHand', keys: [
  K({ ...F(1, HIP - 6, LF, RF), torso: 10, bend: 2, head: -6, tw: 2, la: [40, 120], ra: [24, 130] }, 40, 'in'),
  K({ ...F(-4, HIP - 2, LF - 4, RF - 6, 6, 4), torso: -2, bend: -2, head: -2, tw: 4, la: [30, 150], ra: [36, 168], air: 8 }, 50, 'out', 'active'),
  K({ ...F(-6, HIP - 1, LF - 6, RF - 8, 8, 6), torso: -4, bend: -2, head: 0, tw: 4, la: [28, 156], ra: [40, 172], air: 10 }, 90, 'sine'),
  K({ ...F(-4, HIP - 7, LF - 4, RF - 6), torso: 8, bend: 2, head: -6, tw: 2, la: [44, 136], ra: [30, 150] }, 70, 'in', 'recover'),
  K({ ...F(-1, HIP - 4, LF, RF), torso: 7, bend: 1, head: -5, la: [52, 146], ra: [28, 162] }, 120, 'out', 'footstep'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4 }, 0, 'sine'),
] };

// d/f+2: sink with both fists clasped low by the rear hip, a long step in, and drive them up together
// through his chin, rising onto the toes. On the ground it launches; into a juggle the same swing carries
// him across the floor (onJuggle).
const takeover = { blend: 40, limb: 'rHand', shift: 22, keys: [
  K({ ...F(-4, HIP - 10, LF, RF), torso: 16, bend: 6, head: 2, tw: -8, la: [-10, 30], ra: [-20, 24] }, 70, 'in'),
  K({ ...F(6, HIP - 10, LF + 22, RF, 8, 0), torso: 14, bend: 4, head: -2, tw: -4, la: [30, 70], ra: [24, 64] }, 50, 'linear'),
  K({ ...F(18, HIP + 1, LF + 22, RF, 0, 4), torso: -2, bend: -3, head: -10, tw: 6, la: [112, 150], ra: [104, 146] }, 40, 'out', 'active'),
  K({ ...F(19, HIP + 3, LF + 22, RF, 0, 8), torso: -6, bend: -4, head: -12, tw: 8, la: [132, 160], ra: [126, 156] }, 90, 'inOut'),
  K({ ...F(18, HIP, LF + 22, RF), torso: 2, bend: -1, head: -6, la: [96, 140], ra: [84, 136] }, 100, 'inOut', 'recover'),
  K({ ...F(18, HIP - 2, LF + 22, RF + 22, 0, 8), torso: 7, head: -4, la: [54, 148], ra: [30, 162] }, 120, 'inOut', 'footstep'),
  K({ ...F(22, HIP - 1, LF + 22, RF + 22), torso: 6, head: -4 }, 0, 'sine'),
] };

// STOCK SPLIT's ender: a short step and the rear fist digs into the gut, then the same fist splits off
// upward through the chin. Two hits (the first light), the second knocks down.
const stockSplit = { blend: 40, limb: 'rHand', shift: 14, keys: [
  K({ ...F(-2, HIP - 4, LF, RF), torso: 6, bend: 1, head: 0, tw: -12, la: [56, 150], ra: [10, 120] }, 60, 'in'),
  K({ ...F(8, HIP - 9, LF + 14, RF, 6, 0), torso: 22, bend: 4, head: -8, tw: 10, la: [50, 150], ra: [64, 76] }, 40, 'out', 'active'),
  K({ ...F(8, HIP - 10, LF + 14, RF), torso: 20, bend: 4, head: -8, tw: 6, la: [52, 150], ra: [40, 60] }, 50, 'inOut'),
  K({ ...F(10, HIP - 12, LF + 14, RF), torso: 18, bend: 6, head: -4, tw: 2, la: [54, 150], ra: [16, 40] }, 50, 'in'),
  K({ ...F(22, HIP + 1, LF + 14, RF, 0, 4), torso: 6, bend: -2, head: -14, tw: 16, la: [40, 140], ra: [100, 132] }, 40, 'out', 'active'),
  K({ ...F(22, HIP + 2, LF + 14, RF, 0, 6), torso: 4, bend: -3, head: -14, tw: 16, la: [40, 140], ra: [108, 142] }, 80, 'inOut'),
  K({ ...F(13, HIP - 1, LF + 14, RF), torso: 4, bend: 0, head: -6, la: [50, 146], ra: [80, 140] }, 100, 'inOut', 'recover'),
  K({ ...F(12, HIP - 2, LF + 14, RF + 14, 0, 8), torso: 7, head: -4, la: [54, 148], ra: [30, 162] }, 100, 'inOut', 'footstep'),
  K({ ...F(14, HIP - 1, LF + 14, RF + 14), torso: 6, head: -4 }, 0, 'sine'),
] };

// the suit: dark lapels in a V from the collar down the chest, a tie in the accent, and a gold watch on
// the lead wrist (a dark band with a bright face)
function suitAndWatch(ctx, J, o) {
  const s = o.scale, n = J.neck, c = J.chest, hp = J.hip;
  let tx = c.x - n.x, ty = c.y - n.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;   // down the chest
  const px = -ty * o.facing, py = tx * o.facing;   // toward his front
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const top = { x: n.x + tx * 3 * s, y: n.y + ty * 3 * s }, v = { x: c.x + (hp.x - c.x) * 0.25 + px * 2 * s, y: c.y + (hp.y - c.y) * 0.25 + py * 2 * s };
  ctx.strokeStyle = '#0a0414'; ctx.lineWidth = 2.4 * s;
  ctx.beginPath(); ctx.moveTo(top.x + px * 6 * s, top.y + py * 6 * s); ctx.lineTo(v.x, v.y); ctx.lineTo(top.x - px * 5 * s, top.y - py * 5 * s); ctx.stroke();
  // the tie: a knot at the collar and the blade down to the V
  ctx.strokeStyle = o.accent; ctx.lineWidth = 2.6 * s;
  ctx.beginPath(); ctx.moveTo(top.x + px * 1.5 * s, top.y + py * 1.5 * s); ctx.lineTo(v.x - tx * 3 * s, v.y - ty * 3 * s); ctx.stroke();
  ctx.fillStyle = o.accent; ctx.beginPath(); ctx.arc(top.x + px * 1.5 * s, top.y + py * 1.5 * s, 2.2 * s, 0, Math.PI * 2); ctx.fill();
  // the watch, a little up the forearm from the lead hand
  const hd = J.lHand, el = J.lElbow, wx = hd.x + (el.x - hd.x) * 0.18, wy = hd.y + (el.y - hd.y) * 0.18;
  ctx.fillStyle = '#0a0414'; ctx.beginPath(); ctx.arc(wx, wy, 3.6 * s, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff3b0'; ctx.lineWidth = 1.5 * s; ctx.beginPath(); ctx.arc(wx, wy, 3.2 * s, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.arc(wx, wy, 1.1 * s, 0, Math.PI * 2); ctx.fill();
}

export default {
  id: 'ceo',
  name: 'THE CEO',
  tagline: 'THE BOARD HAS DECIDED YOU’RE A COST',
  color: '#ffd84f',
  altColor: '#ff8a3d',
  accent: '#2ee8ff',
  pants: '#2ee8ff',
  altPants: '#3d7bff',
  // a touch better at everything; the bar is small (0.8 of TEMP's), so a full string can faint him
  stats: { health: 102, walk: 1.03, backWalk: 1, run: 1.03, jump: 1.02, dash: 1.03, weight: 1.04, stamina: 0.8, regen: 1, damage: 1 },
  // a little bigger and broader, the arms a hair short so the size isn't all reach
  body: { scale: 1.03, headR: 15, upperArm: 23.4, lowerArm: 22.4, upperLeg: 31, lowerLeg: 30, torsoW: 16.5, hipW: 12, limbW: 12, limbTip: 9, lean: 0, stance: 1, accessory: suitAndWatch },
  moves: {
    // no strike; strikes and throws pass through for its first 200 ms (invuln), then the landing is open
    ceo_parachute: { rig: parachute, frame: { limb: 'hand', damage: 0, kb: { x: 0, y: 0 }, hitstun: 0, blockstun: 0, hitstop: 0, height: 'mid', cost: 14, reach: 20, flashR: 0,
      noHit: true, invuln: { at: 0, ms: 200 }, travel: { vx: -560, at: 40, ms: 150 } } },
    ceo_takeover: { rig: takeover, frame: { limb: 'hand', damage: 12, kb: { x: 150, y: 540 }, hitstun: 0, blockstun: 12, hitstop: 8, knockdown: true, juggle: true, height: 'mid',
      travel: { vx: 220, at: 60, ms: 100 }, cost: 26, reach: 75, flashR: 36,
      onJuggle: { damage: 14, kb: { x: 820, y: 240 }, ender: true, splat: true, callout: 'HOSTILE TAKEOVER' } } },
    ceo_stockSplit: { rig: stockSplit, frame: { limb: 'hand', damage: 11, kb: { x: 480, y: 300 }, hitstun: 0, blockstun: 16, hitstop: 9, knockdown: true, ender: true, height: 'mid',
      hits: 2, rush: { damage: 5, kb: { x: 0, y: 0 }, hitstun: 30, blockstun: 10, hitstop: 5, knockdown: false, ender: false, callout: null },
      travel: { vx: 200, at: 40, ms: 90 }, cost: 28, reach: 80, flashR: 38, callout: 'STOCK SPLIT' } },
  },
  commands: [
    { button: '1', motion: 'b', move: 'ceo_parachute' },
    { button: '2', motion: 'df', move: 'ceo_takeover' },
  ],
  strings: { add: [{ name: 'STOCK SPLIT', keys: ['2', '1', '2'], moves: ['cross', 'jab', 'ceo_stockSplit'] }] },
  ai: {
    specials: [
      // a strike or a grab coming that will reach: hop out of it (the invuln covers the start)
      { move: 'ceo_parachute', min: 0, max: 130, lead: 0, chance: 0.025, cooldown: 110, reflex: true,
        when: (me, o, sim, d) => o.state === 'attack' && o.phase === 'startup' && o.grounded && d < sim.reachOf(o, o.move) + 20 },
      // the launcher on a whiff and up close, then the ender in the air (the juggle reflex jabs; this finishes)
      { move: 'ceo_takeover', min: 0, max: 90, when: 'whiff', chance: 0.55, cooldown: 90 },
      { move: 'ceo_takeover', min: 0, max: 85, lead: 20, when: (me, o) => o.grounded && !o.crouch && o.state !== 'attack' && o.state !== 'jump', chance: 0.12, cooldown: 160 },
      { move: 'ceo_takeover', min: 0, max: 150, lead: 0, chance: 0.75, cooldown: 30,
        when: (me, o) => o.state === 'knockdown' && o.juggle && o.comboBy === me.id && (o.airHits || 0) >= 1 && (o.airHits || 0) < 4 && !o.grounded },
    ],
  },
  moveList: [
    { name: 'GOLDEN PARACHUTE', input: '← 1', note: 'invulnerable hop back' },
    { name: 'HOSTILE TAKEOVER', input: '↘ 2', note: 'launcher; in a juggle, the ender to the wall' },
    { name: 'STOCK SPLIT', input: '2, 1, 2', note: 'string, gut punch splits into an uppercut' },
  ],
};
