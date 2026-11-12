// SALES REP: pressure and feints. A slim, forward-leaning build, quick on his feet and a little light.
// Cold Call (f,f+1) is a lunging jab whose startup is a pitch, not a promise: press back+3 in its first
// 100 ms and it turns into The Pitch (a low shin kick), or press a throw and it turns into Close the Deal
// (the `feint` hook: a designed cancel, never a botch). Close the Deal (f+1+3) is a fast handshake grab,
// The Pitch (b+3) works on its own too, and one unique string, ALWAYS BE CLOSING (3, 1, 2), ends in a
// rising phone-hand uppercut that launches. Keeps every shared string.
import { RIG_KIT } from '../fighter/index.js';
import { stoop, lift } from './perfectKit.js';
import { ribbonPath } from '../fighter/cloth.js';

const { K, F, L, LF, RF, HIP } = RIG_KIT;

// f,f+1: the lead hand drops to the hip (the pitch), a push off the rear foot, and the jab goes out long
// with the body sliding in behind it (frame data travel, which starts after the feint window: a feint
// leaves him where he stood). No root shift: the glide carries him.
const coldCall = { blend: 40, limb: 'lHand', keys: [
  K({ ...F(-4, HIP - 4, LF, RF), torso: 4, bend: 0, head: -2, tw: 8, la: [36, 118], ra: [30, 168] }, 50, 'in'),
  K({ ...F(2, HIP - 7, LF + 10, RF + 4, 9, 0), torso: 14, bend: 2, head: -6, tw: 4, la: [52, 108], ra: [30, 166] }, 60, 'linear'),
  K({ ...F(10, HIP - 9, LF + 16, RF + 6, 3, 0), torso: 24, bend: 4, head: -10, tw: -6, la: [76, 96], ra: [32, 164] }, 60, 'linear'),
  K({ ...F(16, HIP - 10, LF + 16, RF + 6), torso: 32, bend: 6, head: -12, tw: -14, la: [94, 92], ra: [34, 162] }, 40, 'out', 'active'),
  K({ ...F(17, HIP - 10.5, LF + 16, RF + 6), torso: 33, bend: 6, head: -12, tw: -15, la: [95, 93], ra: [34, 162] }, 60, 'inOut'),
  K({ ...F(16, HIP - 8, LF + 16, RF + 8), torso: 26, bend: 5, head: -10, tw: -12, la: [94, 76], ra: [34, 162] }, 100, 'in', 'recover'),
  K({ ...F(8, HIP - 3, LF + 8, RF + 6, 0, 6), torso: 12, bend: 1, head: -6, tw: -2, la: [60, 130], ra: [30, 164] }, 100, 'out', 'footstep'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4 }, 0, 'sine'),
] };

// b+3, or back+3 out of Cold Call's startup: dip over the rear leg and snap the lead foot into his shin
const pitch = { blend: 40, limb: 'lFoot', height: 'low', keys: [
  K({ hx: -2, rl: L(-2, 49, RF), ll: [40, -20], torso: 8, bend: 2, head: -2, tw: 4, la: [50, 140], ra: [30, 164] }, 50, 'in'),
  K({ hx: 4, rl: L(4, 47, RF), ll: [64, -4], torso: 14, bend: 3, head: -4, tw: 2, la: [56, 128], ra: [30, 164] }, 40, 'linear'),
  K({ hx: 12, rl: L(12, 46, RF), ll: [60, 82], torso: 18, bend: 3, head: -6, tw: -4, la: [70, 112], ra: [30, 158] }, 40, 'out', 'active'),
  K({ hx: 12, rl: L(12, 46, RF), ll: [61, 83], torso: 19, bend: 3, head: -6, tw: -4, la: [70, 112], ra: [30, 158] }, 60, 'inOut'),
  K({ hx: 8, rl: L(8, 48, RF), ll: [52, 6], torso: 12, bend: 2, head: -4, la: [60, 130], ra: [30, 162] }, 60, 'inOut', 'recover'),
  K({ hx: 3, rl: L(3, 51, RF), ll: [36, -14], torso: 6, head: -2, la: [54, 146], ra: [28, 166] }, 60, 'inOut'),
  K({ ...F(1, HIP, LF, RF), torso: 5, head: -4, la: [52, 152], ra: [28, 166] }, 60, 'out', 'footstep'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 5, head: -3 }, 0, 'sine'),
] };

// f+1+3 (or a throw out of Cold Call's startup): the lead hand goes out for the handshake, takes his hand
// (the grab holds on the active key), yanks him in, and the rear shoulder drives him away
const closeDeal = { blend: 40, limb: 'lHand', shift: 26, keys: [
  K({ ...F(-2, HIP - 3, LF, RF), torso: 6, bend: 0, head: -3, tw: 6, la: [60, 100], ra: [30, 160] }, 60, 'in'),
  K({ ...F(6, HIP - 6, LF + 12, RF, 6, 0), torso: 14, bend: 2, head: -5, tw: 2, la: [82, 90], ra: [36, 150] }, 50, 'out'),
  K({ ...F(12, HIP - 7, LF + 16, RF), torso: 20, bend: 3, head: -6, tw: -2, la: [92, 90], ra: [40, 140] }, 40, 'out', 'active'),
  K({ ...F(4, HIP - 8, LF + 16, RF), torso: -6, bend: -3, head: 2, tw: -12, la: [58, 40], ra: [70, 118] }, 60, 'in'),
  K({ ...F(18, HIP - 10, LF + 26, RF + 6), torso: 28, bend: 6, head: -10, tw: 16, la: [40, 100], ra: [96, 88] }, 50, 'out', 'recover'),
  K({ ...F(20, HIP - 6, LF + 26, RF + 6), torso: 16, bend: 3, head: -6, la: [50, 130], ra: [60, 120] }, 130, 'inOut'),
  K({ ...F(22, HIP - 2, LF + 26, RF + 26, 0, 8), torso: 8, head: -4, la: [54, 148], ra: [30, 162] }, 110, 'inOut', 'footstep'),
  K({ ...F(26, HIP - 1, LF + 26, RF + 26), torso: 6, head: -4 }, 0, 'sine'),
] };

// ALWAYS BE CLOSING's ender: sink with the phone hand low, then drive it up through his chin onto the toes
const abc = { blend: 40, limb: 'rHand', shift: 12, keys: [
  K({ ...F(0, HIP - 10, LF, RF), torso: 18, bend: 6, head: 4, tw: -12, la: [40, 140], ra: [-10, 30] }, 60, 'in'),
  K({ ...F(6, HIP - 7, LF + 10, RF, 6, 0), torso: 10, bend: 3, head: -2, tw: -4, la: [36, 146], ra: [30, 100] }, 40, 'linear'),
  K({ ...F(12, HIP + 1, LF + 12, RF, 0, 4), torso: 2, bend: -2, head: -12, tw: 12, la: [30, 150], ra: [100, 170] }, 40, 'out', 'active'),
  K({ ...F(12, HIP + 2, LF + 12, RF, 0, 6), torso: -4, bend: -3, head: -14, tw: 13, la: [30, 150], ra: [116, 178] }, 70, 'inOut'),
  K({ ...F(10, HIP, LF + 12, RF), torso: 2, bend: -1, head: -8, tw: 6, la: [40, 146], ra: [70, 140] }, 90, 'inOut', 'recover'),
  K({ ...F(10, HIP - 2, LF + 12, RF + 12, 0, 8), torso: 7, head: -4, la: [54, 148], ra: [30, 162] }, 100, 'inOut', 'footstep'),
  K({ ...F(12, HIP - 1, LF + 12, RF + 12), torso: 6, head: -4 }, 0, 'sine'),
] };

// a skinny necktie down the shirt front, and a phone in the rear hand (held across the palm, so it never
// sticks out past the fist), its screen lit
function phone(ctx, J, o) {
  const s = o.scale;
  // the phone: across the rear forearm's end, centered just behind the fist
  const e = J.rElbow, h = J.rHand;
  let ax = h.x - e.x, ay = h.y - e.y; const La = Math.hypot(ax, ay) || 1; ax /= La; ay /= La;
  const px = -ay, py = ax, cx = h.x - ax * 3 * s, cy = h.y - ay * 3 * s, hl = 6.5 * s, hw = 3.4 * s;
  const rect = (k) => {
    ctx.beginPath();
    ctx.moveTo(cx + px * hl * k + ax * hw * k, cy + py * hl * k + ay * hw * k); ctx.lineTo(cx - px * hl * k + ax * hw * k, cy - py * hl * k + ay * hw * k);
    ctx.lineTo(cx - px * hl * k - ax * hw * k, cy - py * hl * k - ay * hw * k); ctx.lineTo(cx + px * hl * k - ax * hw * k, cy + py * hl * k - ay * hw * k); ctx.closePath();
  };
  ctx.fillStyle = '#0a0414'; rect(1.25); ctx.fill();
  ctx.fillStyle = '#9ff8ff'; rect(0.82); ctx.fill();
}
// the skinny tie: a cloth chain from the knot at the collar (below), so the blade flips and settles
function tie(ctx, P, o) {
  const s = o.scale, w = 2.2 * s;
  ctx.lineJoin = 'round';
  ribbonPath(ctx, P, o.facing, (t) => w * (1 + 0.2 * t), true);
  ctx.strokeStyle = '#1a0408'; ctx.lineWidth = 2 * s; ctx.stroke();
  ctx.fillStyle = o.accent; ctx.fill();
  ctx.beginPath(); ctx.arc(P[0].x, P[0].y, 2.2 * s, 0, Math.PI * 2); ctx.fill();
}

// The celebration (registry `dance`, played by the match winner under the WINS banner): Closed the deal: finger guns, left, right, both, with a little shoulder roll and a wink of the head.
const dance = { keys: [
  K({ ...F(-2, HIP - 2, LF, RF), torso: 4, head: -6, tw: 6, la: [96, 96], ra: [30, 140] }, 160, 'snap'),
  K({ ...F(-2, HIP - 2, LF, RF), torso: 4, head: 6, tw: 6, la: [104, 110], ra: [30, 140] }, 160, 'out'),
  K({ ...F(2, HIP - 2, LF, RF), torso: 4, head: -6, tw: -6, la: [50, 140], ra: [96, 96] }, 160, 'snap'),
  K({ ...F(2, HIP - 2, LF, RF), torso: 4, head: 6, tw: -6, la: [50, 140], ra: [104, 110] }, 160, 'out'),
  K({ ...F(0, HIP - 4, LF, RF), torso: 2, head: -8, la: [96, 96], ra: [90, 90] }, 160, 'snap'),
  K({ ...F(0, HIP - 4, LF, RF), torso: 2, head: 4, la: [104, 110], ra: [98, 104] }, 300, 'out'),
] };

// The perfect round finisher (registry `perfect`, README Perfect rounds): the handshake: he takes it by the hand and pumps it three times, then closes the deal with the rising phone-hand uppercut that sends it at the camera; finger guns.
const perfect = { name: 'CLOSE THE DEAL', note: 'The handshake: he takes it by the hand and pumps it three times, then closes the deal with the rising phone-hand uppercut that sends it at the camera; finger guns.', stamp: 'SOLD!', hand: 'rHand', hold: 'collar', fly: { spin: 1, arc: 160 }, keys: [
  ...stoop('rHand'),
  lift('collar', 'rHand', 200),
  K({ face: 0.3, ...F(2, HIP - 2, LF + 4, RF), torso: 6, head: -6, la: [40, 110], ra: [86, 76] }, 100, 'sine'),
  K({ face: 0.3, ...F(2, HIP - 2, LF + 4, RF), torso: 6, head: -6, la: [40, 110], ra: [104, 118] }, 100, 'sine'),
  K({ face: 0.3, ...F(2, HIP - 2, LF + 4, RF), torso: 6, head: -6, la: [40, 110], ra: [86, 76] }, 100, 'sine'),
  K({ face: 0.3, ...F(2, HIP - 2, LF + 4, RF), torso: 6, head: -6, la: [40, 110], ra: [104, 118] }, 100, 'sine'),
  K({ face: 0.55, ...F(-2, HIP - 14, LF + 4, RF - 4), torso: 24, bend: 4, head: -2, la: [50, 100], ra: [10, 20] }, 160, 'in'),
  K({ face: 0.9, ...F(6, HIP + 2, LF + 8, RF - 4, 0, 6), torso: -12, bend: -6, head: -16, la: [30, 100], ra: [166, 178] }, 90, 'out', 'release'),
  K({ face: 0.85, ...F(8, HIP, LF + 8, RF, 0, 0), torso: -4, head: -10, la: [30, 110], ra: [160, 186] }, 200, 'out', 'footstep'),
  K({ face: 0.85, ...F(8, HIP - 1, LF + 8, RF + 4), torso: 4, head: -6, la: [94, 92], ra: [92, 90] }, 220, 'out'),
  K({ face: 0.85, ...F(8, HIP, LF + 8, RF + 4), torso: 4, head: -8, la: [98, 96], ra: [96, 94] }, 0, 'sine'),
] };

export default {
  dance,
  perfect,
  id: 'salesRep',
  name: 'SALES REP',
  tagline: 'HAVE YOU GOT A MINUTE? GREAT',
  // how it moves (the life layer's signature, src/fighter/life.js: drawn only): always on: a bounce, a quick eye, a shrug, shaking the hands out; laughs at your botch
  life: { spring: 1.2, damp: 0.9, eye: 1.25, breath: 1.15, sway: 1, swayHz: 0.6, bounce: 0.6, bounceHz: 1.6, habits: ['shrug', 'shakeOut'], laugh: true },
  color: '#ffe066',
  altColor: '#9b8cff',
  accent: '#ff3b3b',
  pants: '#ff3b3b',
  altPants: '#2ee8ff',
  // light and quick: runs you down, a touch less health
  stats: { health: 100, walk: 1.08, backWalk: 0.92, run: 1.1, jump: 1.02, dash: 1.1, weight: 0.98, stamina: 1, regen: 1.15, damage: 1.05 },
  body: { scale: 1, headR: 14.5, torsoW: 14, hipW: 10.5, limbW: 11.4, limbTip: 8.7, lean: 4, accessory: phone },
  cloth: [{ draw: tie, axis: ['neck', 'chest'], off: [3.8, 3.5], dir: [0.094, 1], len: 21.3, seg: 3, hz: 2.1, damping: 0.22, side: 'front', clear: 3.8 }],
  moves: {
    // the feint: back+3 (sr_pitch) or a throw in the first 100 ms of startup replaces the jab (frame data feint)
    sr_coldCall: { rig: coldCall, frame: { limb: 'hand', damage: 9, kb: { x: 0, y: 0 }, hitstun: 28, blockstun: 10, hitstop: 6, knockdown: false, height: 'mid',
      travel: { vx: 320, at: 130, ms: 120 }, feint: { ms: 90, into: { sr_pitch: 'sr_pitchFeint', sr_pitchFeint: 'sr_pitchFeint', throw: 'sr_closeFeint', sr_closeDeal: 'sr_closeFeint', sr_closeFeint: 'sr_closeFeint' } },
      cost: 18, reach: 110, flashR: 32, callout: 'COLD CALL' } },
    sr_pitch: { rig: pitch, frame: { limb: 'foot', damage: 7, kb: { x: 0, y: 0 }, hitstun: 24, blockstun: 6, hitstop: 5, knockdown: false, height: 'low',
      cost: 14, reach: 85, flashR: 26, callout: 'THE PITCH' } },
    // the feint's versions: the lunge already started, so the low slides in behind it and the handshake reaches
    // farther (the grab pulls him in to the hold, 720 px/s)
    sr_pitchFeint: { frame: { limb: 'foot', damage: 7, kb: { x: 0, y: 0 }, hitstun: 24, blockstun: 6, hitstop: 5, knockdown: false, height: 'low',
      travel: { vx: 400, at: 20, ms: 130 }, cost: 12, reach: 120, flashR: 26, anims: ['sr_pitch'], callout: 'THE PITCH' } },
    sr_closeFeint: { frame: { limb: 'hand', damage: 11, kb: { x: 520, y: 260 }, hitstun: 0, blockstun: 0, hitstop: 7, knockdown: true, height: 'throw',
      throw: true, grab: true, unblockable: true, range: 150, hold: 12, cost: 20, reach: 70, flashR: 30, anims: ['sr_closeDeal'], callout: 'CLOSE THE DEAL' } },
    sr_closeDeal: { rig: closeDeal, frame: { limb: 'hand', damage: 11, kb: { x: 520, y: 260 }, hitstun: 0, blockstun: 0, hitstop: 7, knockdown: true, height: 'throw',
      throw: true, grab: true, unblockable: true, range: 92, hold: 12, cost: 24, reach: 70, flashR: 30, callout: 'CLOSE THE DEAL' } },
    sr_abc: { rig: abc, frame: { limb: 'hand', damage: 13, kb: { x: 130, y: 470 }, hitstun: 0, blockstun: 16, hitstop: 9, knockdown: true, juggle: true, ender: true,
      height: 'mid', reach: 70, flashR: 36, callout: 'ALWAYS BE CLOSING' } },
  },
  commands: [
    { button: '1', motion: 'ff', move: 'sr_coldCall' },
    { button: '3', motion: 'b', move: 'sr_pitch' },
    { button: '1+3', motion: 'f', move: 'sr_closeDeal' },
    { button: '2+4', motion: 'f', move: 'sr_closeDeal' },
  ],
  strings: { add: [{ name: 'ALWAYS BE CLOSING', keys: ['3', '1', '2'], moves: ['lkick', 'jab', 'sr_abc'] }] },
  ai: {
    style: 'rushdown',
    range: 'close',
    specials: [
      // the pitch: run in with Cold Call and, against a guard, turn it into the low or the handshake
      { name: 'srFeint', cost: 36, min: 90, max: 180, lead: 60, chance: 0.6, cooldown: 120, when: (me, o) => o.grounded && (o.backHeld || o.state === 'block' || o.crouch),
        plan: (me, o, sim, dist, toward, k) => [
          k.move(toward, 6, true),
          { ...k.attack('sr_coldCall'), dx: toward },
          k.move(0, (m) => m.state !== 'attack' || m.move !== 'sr_coldCall' || sim.stepCount - m.attackStart >= 5),
          { ...k.attack(o.crouch ? 'sr_pitchFeint' : (o.backHeld || o.state === 'block') && sim.rng() < 0.5 ? 'sr_closeFeint' : 'sr_pitchFeint'), onlyIf: (m) => m.state === 'attack' && m.move === 'sr_coldCall' && m.phase === 'startup' },
        ] },
      { move: 'sr_coldCall', min: 90, max: 180, lead: 60, run: true, when: 'whiff', chance: 0.6, cooldown: 90 },
      { move: 'sr_coldCall', min: 110, max: 170, lead: 60, run: true, when: (me, o) => o.grounded && !o.crouch && o.state !== 'attack' && o.state !== 'block', chance: 0.2, cooldown: 180 },
      { move: 'sr_closeDeal', min: 0, max: 90, when: 'guarding', chance: 0.5, cooldown: 110 },
      { move: 'sr_pitch', min: 40, max: 90, when: (me, o) => o.grounded && !o.crouch && o.backHeld, chance: 0.3, cooldown: 130 },
    ],
  },
  moveList: [
    { name: 'COLD CALL', input: '→→ 1', note: 'lunge jab, feints into ←3 or a throw' },
    { name: 'THE PITCH', input: '← 3', note: 'low shin kick' },
    { name: 'CLOSE THE DEAL', input: '→ 1+3', note: 'fast handshake grab' },
    { name: 'ALWAYS BE CLOSING', input: '3, 1, 2', note: 'string, phone uppercut launches' },
  ],
  // STRATEGY, for the fighter page only (README, Site): how to beat each unique move. The game never shows it,
  // and site/vite-plugin.mjs cuts it from the bundle. Every tip is measured: `node gauntlet/counters.mjs salesRep`
  // prints the numbers behind each one. Measure again when the frame data changes.
  strategy: [
    { move: 'sr_coldCall', tips: [
      "The dash is a three-way guess: the lunge jab (a mid), THE PITCH (a low) or CLOSE THE DEAL (a grab). So don't guess. Hit the run: from close or mid range, a jab (1) or a snap kick (3) thrown as he dashes in beats all three.",
      "If you have to block, crouch-block. It stops the low, and the grab goes over your head. Only the jab itself gets through, for a small hit and no knockdown.",
      "When the grab misses over your crouch he's wide open. Punish with the uppercut (↓2).",
      "A plain Cold Call blocked standing is hard to punish. →2 reaches him, but only if you blocked it up close.",
    ] },
    { move: 'sr_pitch', tips: [
      "Crouch-block it. It's a quick low, and nothing you press beats it once it has started.",
      "Blocked, only →2 (the lunge cross) reaches him.",
      "↘ parries it, if you guess it.",
    ] },
    { move: 'sr_closeDeal', tips: [
      "It's a grab, so blocking in place does nothing. Crouch (↓) and it goes over your head, hold ← and step back out of it, or break it with 1+3 as he grabs.",
      "When it misses, anything punishes. The cross (2) has plenty of time.",
      "A low jab (↓1) or a low kick (↓3) beats it clean, even pressed a moment after he reaches. Highs and mids only trade.",
    ] },
    { string: 'ALWAYS BE CLOSING', tips: [
      "Stand-block it. It opens with a mid kick, so crouching loses right away.",
      "The uppercut at the end is slow. After you block the jab, press snap kick (3) or the cross (2) and you hit him first.",
      "If you block all three, he's open: jab (1), snap kick (3) or the cross (2).",
    ] },
  ],
};
