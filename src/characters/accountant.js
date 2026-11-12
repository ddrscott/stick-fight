// ACCOUNTANT: technical mixups. An ordinary build, a little slimmer (thin limbs hit and get hit a bit
// narrower), average everything; what he has is frame advantage. Fine Print (d+3) is a fast low toe poke
// that leaves him ahead even when it's blocked, and it opens his two strings: press 3 again for a second
// low (and then 2 for the WRITE-OFF ender), or 4 for Balance Sheet, an overhead out of the crouch. The
// second hit comes out just after a blocked Fine Print lets go, so the guard has to pick a height: stay
// down for the low, stand for the overhead. On hit it all combos. Drops GROUND RUSH (its d+3 opener is
// Fine Print here); LOW RUSH still ends in the shared low kick.
import { RIG_KIT } from '../fighter/index.js';
import { stoop, lift } from './perfectKit.js';

const { K, F, L, LF, RF, CH, HIP, crouchP } = RIG_KIT;

// d+3: from the crouch the lead foot flicks out along the floor at the shin, toe first, and snaps straight
// back. Very little to recover, so a blocked one still leaves him ahead (blockstun 14 against ~10 frames).
const finePrint = { blend: 30, limb: 'lFoot', keys: [
  K({ ...crouchP, hx: -2, rl: L(-2, CH, RF - 2), ll: [46, -36], torso: 20, head: -8, la: [40, 156], ra: [26, 164] }, 60, 'in'),
  K({ ...crouchP, hx: 3, rl: L(3, CH, RF - 2), ll: [70, 10], torso: 14, head: -6, la: [36, 158], ra: [24, 164] }, 40, 'linear'),
  K({ ...crouchP, hx: 9, rl: L(9, CH - 1, RF - 2), ll: [80, 88], torso: 10, bend: 3, head: -4, la: [32, 160], ra: [18, 166] }, 30, 'out', 'active'),
  K({ ...crouchP, hx: 9, rl: L(9, CH - 1, RF - 2), ll: [81, 89], torso: 10, bend: 3, head: -4, la: [32, 160], ra: [18, 166] }, 40, 'inOut'),
  K({ ...crouchP, hx: 5, rl: L(5, CH, RF - 2), ll: [64, -6], torso: 16, head: -6, la: [36, 158] }, 50, 'inOut', 'recover'),
  K({ ...crouchP, ...F(2, CH, LF + 2, RF - 2, 5, 0) }, 50, 'inOut'),
  K({ ...crouchP }, 0, 'sine', 'footstep'),
] };

// d+3, 3: the second low. A crouching shuffle-step in (the rear foot drags up behind), then the lead foot
// sweeps out lower and longer than the first. Comes out on the same beat as Balance Sheet's first frames.
const subClause = { blend: 40, limb: 'lFoot', shift: 16, keys: [
  K({ ...crouchP, ...F(2, CH - 1, LF + 2, RF - 2, 6, 0), torso: 20, head: -8 }, 90, 'in'),
  K({ ...crouchP, ...F(8, CH - 1, LF + 14, RF - 2), torso: 18, head: -8 }, 140, 'inOut'),
  K({ ...crouchP, hx: 10, rl: L(10, CH, RF + 6), ll: [50, -34], torso: 20, head: -8, la: [40, 156], ra: [24, 164] }, 70, 'linear'),
  K({ ...crouchP, hx: 18, rl: L(18, CH - 2, RF + 6), ll: [82, 90], torso: 8, bend: 2, head: -2, la: [28, 162], ra: [14, 168] }, 40, 'out', 'active'),
  K({ ...crouchP, hx: 18, rl: L(18, CH - 2, RF + 6), ll: [83, 91], torso: 8, bend: 2, head: -2, la: [28, 162], ra: [14, 168] }, 50, 'inOut'),
  K({ ...crouchP, hx: 14, rl: L(14, CH, RF + 6), ll: [66, -4], torso: 14, head: -6 }, 70, 'inOut', 'recover'),
  K({ ...crouchP, ...F(16, CH, LF + 16, RF + 14, 6, 0) }, 80, 'inOut', 'footstep'),
  K({ ...crouchP, ...F(16, CH, LF + 18, RF + 14) }, 0, 'sine'),
] };

// d+3, 4: Balance Sheet. Up out of the crouch onto the toes, both fists over the head like a rubber stamp,
// and down on top of him. An overhead: it lands on a croucher, and a standing guard holds it.
const balanceSheet = { blend: 40, limb: 'rHand', shift: 20, keys: [
  K({ ...crouchP, ...F(2, CH - 1, LF + 2, RF - 2, 6, 0), torso: 20, head: -8, la: [30, 150], ra: [10, 120] }, 70, 'in'),
  K({ ...F(6, HIP - 6, LF + 12, RF - 2), torso: -4, bend: -3, head: 4, la: [130, 166], ra: [146, 176] }, 120, 'out'),
  K({ hx: 10, ll: L(10, HIP + 3, LF + 12), rl: [16, -44], torso: -12, bend: -6, head: 10, la: [166, 190], ra: [178, 200], air: 6 }, 80, 'sine'),
  K({ ...F(18, HIP - 10, LF + 20, RF + 4), torso: 30, bend: 8, head: -10, la: [96, 70], ra: [104, 80] }, 40, 'out', 'active'),
  K({ ...F(20, HIP - 13, LF + 20, RF + 4), torso: 38, bend: 9, head: -12, la: [74, 46], ra: [80, 52] }, 60, 'inOut'),
  K({ ...F(18, HIP - 8, LF + 20, RF + 4), torso: 20, bend: 4, head: -8, la: [44, 110], ra: [40, 120] }, 100, 'inOut', 'recover'),
  K({ ...F(18, HIP - 3, LF + 20, RF + 20, 0, 8), torso: 8, head: -5, la: [54, 148], ra: [28, 162] }, 100, 'out', 'footstep'),
  K({ ...F(20, HIP - 1, LF + 20, RF + 20), torso: 6, head: -4 }, 0, 'sine'),
] };

// d+3, 3, 2: WRITE-OFF. Out of the second low he drives up off the floor behind a rear palm to the chin,
// the whole body extending through it, and sends him away. Knockdown.
const writeOff = { blend: 40, limb: 'rHand', shift: 18, keys: [
  K({ ...crouchP, ...F(-2, CH - 3, LF + 2, RF - 2), torso: 24, bend: 7, head: -6, tw: -10, la: [40, 156], ra: [-6, 40] }, 70, 'in'),
  K({ ...F(6, CH + 8, LF + 10, RF - 2), torso: 16, bend: 4, head: -6, tw: -4, la: [36, 150], ra: [40, 100] }, 50, 'linear'),
  K({ ...F(16, HIP - 4, LF + 18, RF - 2), torso: 6, bend: -2, head: -14, tw: 16, la: [24, 140], ra: [100, 118] }, 40, 'out', 'active'),
  K({ ...F(17, HIP - 3, LF + 18, RF - 2), torso: 4, bend: -3, head: -14, tw: 17, la: [22, 140], ra: [104, 124] }, 80, 'inOut'),
  K({ ...F(16, HIP - 4, LF + 18, RF - 2), torso: 8, bend: 0, head: -10, tw: 8, la: [34, 146], ra: [70, 130] }, 100, 'inOut', 'recover'),
  K({ ...F(16, HIP - 2, LF + 18, RF + 16, 0, 9), torso: 7, head: -6, la: [52, 148], ra: [30, 162] }, 100, 'out', 'footstep'),
  K({ ...F(18, HIP - 1, LF + 18, RF + 18), torso: 6, head: -4 }, 0, 'sine'),
] };

// reading glasses: two round lenses on the front of the face and the bridge between them, the arm back to
// the ear, in the accent with a dark rim
function glasses(ctx, J, o) {
  const h = J.head, n = J.neck, r = o.headR, s = o.scale;
  let ux = h.x - n.x, uy = h.y - n.y; const L0 = Math.hypot(ux, uy) || 1; ux /= L0; uy /= L0;
  const fx = -uy * o.facing, fy = ux * o.facing;   // forward, across the face
  const lr = r * 0.3;
  // lens centers: the near one at the front edge of the face, the far one just behind it (profile view)
  const ax = h.x + fx * r * 0.72 + ux * r * 0.12, ay = h.y + fy * r * 0.72 + uy * r * 0.12;
  const bx = h.x + fx * r * 0.18 + ux * r * 0.14, by = h.y + fy * r * 0.18 + uy * r * 0.14;
  ctx.lineCap = 'round';
  for (const [w, c] of [[3.6 * s, '#120d02'], [1.6 * s, o.accent]]) {
    ctx.strokeStyle = c; ctx.lineWidth = w;
    ctx.beginPath(); ctx.arc(ax, ay, lr, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(bx, by, lr * 0.9, 0, Math.PI * 2); ctx.stroke();
    // the bridge, and the arm back over the ear
    ctx.beginPath(); ctx.moveTo(ax - fx * lr, ay - fy * lr); ctx.lineTo(bx + fx * lr * 0.9, by + fy * lr * 0.9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx - fx * lr * 0.9, by - fy * lr * 0.9); ctx.lineTo(h.x - fx * r * 0.55 + ux * r * 0.05, h.y - fy * r * 0.55 + uy * r * 0.05); ctx.stroke();
  }
}

// The celebration (registry `dance`, played by the match winner under the WINS banner): Balanced books: a tidy tap of one finger on the other palm, counting it up, then a small precise fist pump.
const dance = { keys: [
  K({ ...F(0, HIP, LF, RF), torso: 4, bend: 2, head: 14, la: [40, 120], ra: [50, 110] }, 220, 'inOut'),
  K({ ...F(0, HIP, LF, RF), torso: 4, bend: 2, head: 14, la: [44, 104], ra: [50, 110] }, 150, 'in'),
  K({ ...F(0, HIP, LF, RF), torso: 4, bend: 2, head: 14, la: [40, 120], ra: [50, 110] }, 150, 'out'),
  K({ ...F(0, HIP, LF, RF), torso: 4, bend: 2, head: 14, la: [44, 104], ra: [50, 110] }, 150, 'in'),
  K({ ...F(0, HIP, LF, RF), torso: 4, bend: 2, head: 14, la: [40, 120], ra: [50, 110] }, 220, 'out'),
  K({ ...F(0, HIP - 3, LF, RF), torso: 2, bend: 0, head: -4, la: [60, 170], ra: [20, 40] }, 160, 'out'),
  K({ ...F(0, HIP - 5, LF, RF), torso: 8, bend: 2, head: 4, la: [30, 150], ra: [20, 40] }, 160, 'snap'),
  K({ ...F(0, HIP - 2, LF, RF), torso: 4, bend: 1, head: 6, la: [30, 150], ra: [20, 40] }, 300, 'sine'),
] };

// The perfect round finisher (registry `perfect`, README Perfect rounds): a precise underhand toss: he lifts it, takes a measured half step back, sights the lens down a pencil, and lobs it underhand with bent knees; then the tidy fist pump.
const perfect = { name: 'PRECISE UNDERHAND', note: 'A precise underhand toss: he lifts it, takes a measured half step back, sights the lens down a pencil, and lobs it underhand with bent knees; then the tidy fist pump.', stamp: 'AUDITED', hand: 'lHand', hold: 'collar', fly: { spin: 0, arc: 110 }, keys: [
  ...stoop('lHand'),
  lift('collar', 'lHand', 200),
  K({ face: 0.2, ...F(-6, HIP - 2, LF - 4, RF - 8, 0, 4), torso: 0, bend: -2, head: -8, la: [96, 104], ra: [100, 160] }, 200, 'inOut', 'footstep'),
  K({ face: 0.55, ...F(-6, HIP - 2, LF - 4, RF - 8), torso: 0, bend: -2, head: -6, la: [96, 104], ra: [104, 164] }, 160, 'sine'),
  K({ face: 0.7, ...F(-8, HIP - 12, LF - 4, RF - 8), torso: 16, bend: 2, head: -4, la: [-36, -28], ra: [30, 110] }, 220, 'inOut'),
  K({ face: 0.9, ...F(-2, HIP - 4, LF - 4, RF - 8), torso: 2, bend: -2, head: -10, la: [70, 108], ra: [30, 116] }, 110, 'out', 'release'),
  K({ face: 0.85, ...F(-2, HIP - 2, LF - 4, RF - 8), torso: 0, head: -10, la: [96, 140], ra: [30, 118] }, 200, 'out'),
  K({ face: 0.6, ...F(-2, HIP - 1, LF - 4, RF - 8), torso: 4, head: -6, la: [40, 110], ra: [60, 162] }, 240, 'inOut'),
  K({ face: 0.55, ...F(-2, HIP, LF - 4, RF - 8), torso: 4, head: -8, la: [38, 110], ra: [100, 190] }, 0, 'sine'),
] };

export default {
  dance,
  perfect,
  id: 'accountant',
  name: 'ACCOUNTANT',
  tagline: 'READ THE FINE PRINT. THEN THE OVERHEAD',
  // how it moves (the life layer's signature, src/fighter/life.js: drawn only): precise: well-damped springs, barely a sway, straightens up exactly
  life: { spring: 0.8, damp: 1.4, eye: 1.1, breath: 0.95, sway: 0.3, swayHz: 0.5, habits: ['straighten'] },
  color: '#ffe066',
  altColor: '#c6ff3d',
  accent: '#7af0ff',
  stats: { health: 100, walk: 1, backWalk: 1, run: 1, jump: 1, dash: 1, weight: 0.98, stamina: 1, regen: 1.05, damage: 1.04 },
  body: { scale: 0.99, headR: 14.5, limbW: 11.2, limbTip: 8.6, torsoW: 14, hipW: 10.5, lean: 2, accessory: glasses },
  moves: {
    finePrint: { rig: finePrint, frame: { limb: 'foot', damage: 5, kb: { x: 0, y: 0 }, hitstun: 26, blockstun: 15, hitstop: 5, knockdown: false, height: 'low', tc: true,
      cost: 14, reach: 80, flashR: 24, callout: null } },
    subClause: { rig: subClause, frame: { limb: 'foot', damage: 6, kb: { x: 0, y: 0 }, hitstun: 26, blockstun: 6, hitstop: 5, knockdown: false, height: 'low', tc: true,
      travel: { vx: 220, at: 120, ms: 160 }, cost: 15, reach: 90, flashR: 24 } },
    balanceSheet: { rig: balanceSheet, frame: { limb: 'hand', damage: 12, kb: { x: 0, y: 0 }, hitstun: 32, blockstun: 10, hitstop: 8, knockdown: false, height: 'overhead',
      travel: { vx: 260, at: 120, ms: 150 }, cost: 20, reach: 90, flashR: 36, callout: 'BALANCE SHEET' } },
    writeOff: { rig: writeOff, frame: { limb: 'hand', damage: 13, kb: { x: 440, y: 300 }, hitstun: 0, blockstun: 14, hitstop: 9, knockdown: true, ender: true, height: 'mid',
      reach: 80, flashR: 38, callout: 'WRITE-OFF' } },
  },
  commands: [
    { button: '3', motion: 'd', move: 'finePrint' },
  ],
  strings: {
    drop: ['GROUND RUSH'],
    add: [
      { name: 'WRITE-OFF', keys: ['d3', '3', '2'], moves: ['finePrint', 'subClause', 'writeOff'] },
      { name: 'BALANCE SHEET', keys: ['d3', '4'], moves: ['finePrint', 'balanceSheet'] },
    ],
  },
  ai: {
    style: null,
    range: 'close',
    specials: [
      // punish a whiff with the fast poke (the follow-up reflex carries the string on when it lands)
      { move: 'finePrint', min: 0, max: 95, when: 'whiff', chance: 0.85, cooldown: 40 },
      // a standing guard: the low; a crouching one: the poke anyway, to get the plus frames and the guess
      { move: 'finePrint', min: 0, max: 92, when: (me, o) => o.grounded && !o.crouch && (o.backHeld || o.state === 'block'), chance: 0.55, cooldown: 60 },
      { move: 'finePrint', min: 0, max: 92, when: 'crouching', chance: 0.35, cooldown: 90 },
      { move: 'finePrint', min: 30, max: 92, when: 'standing', chance: 0.2, cooldown: 100 },
    ],
  },
  moveList: [
    { name: 'FINE PRINT', input: '↓ 3', note: 'fast low poke, plus on block' },
    { name: 'BALANCE SHEET', input: '↓3, 4', note: 'overhead out of Fine Print' },
    { name: 'WRITE-OFF', input: '↓3, 3, 2', note: 'low, low, then the ender' },
  ],
  // STRATEGY, for the fighter page only (README, Site): how to beat each unique move. The game never shows it,
  // and site/vite-plugin.mjs cuts it from the bundle. Every tip is measured: `node gauntlet/counters.mjs accountant`
  // prints the numbers behind each one. Measure again when the frame data changes.
  strategy: [
    { move: 'finePrint', tips: [
      "Crouch-block it. It's a low, and it's too fast to interrupt.",
      "Blocking it doesn't give you a turn. He recovers first, and nothing you press afterwards catches him.",
      "↘ parries it, but only as a guess: it lands almost as soon as he presses.",
    ] },
    { string: 'WRITE-OFF', tips: [
      "Crouch-block the first two kicks, then stand up: the last hit is a mid. Staying down gets you knocked over, and a standing block loses to the first kick.",
      "Better, after you block the second low, press snap kick (3). It beats the last hit.",
      "The second kick is slow to arrive. A low jab (↓1) thrown a beat after you block Fine Print gets there first.",
      "If you do block all three, a jab (1) or a snap kick (3) punishes.",
    ] },
    { string: 'BALANCE SHEET', tips: [
      "Crouch-block Fine Print, then stand up and block. The second hit is an overhead, and it hits you if you stay down.",
      "Once both are blocked, jab (1) punishes.",
      "After Fine Print he can go low again (WRITE-OFF) or overhead (this), and both land at about the same moment. Up close no button covers both, so it's a guess.",
    ] },
  ],
};
