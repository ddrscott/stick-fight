// INTERN: the scrappy all-rounder and the ladder's first stage. A slightly smaller body with a bit less
// health and damage, back on his feet and his stamina a touch quicker. Two unique moves, Coffee Run
// (f,f+1, a dash-in elbow that slides in behind the arm: a good way in, punishable when it's blocked) and
// Paper Cut (d+1, quick low jabs: d+1, d+1, then 2 for a rising mid finisher; the second low is the rear
// hand), and one unique string, REPLY ALL (1, 2, 2), whose ender is a wild haymaker he overcommits to.
// Paper Cut replaces LOW RUSH (d+1, d+1, d+3 now finishes with the low kick off the paper cuts).
import { RIG_KIT } from '../fighter/index.js';
import { chainPath } from '../fighter/cloth.js';

const { K, F, LF, RF, HIP, CH, crouchP } = RIG_KIT;

// f,f+1: tuck the lead arm, drop the shoulder and slide in behind the point of the elbow (frame data
// travel carries the body), the rear hand held up at the chin as if a coffee is still in it. Lands a step on.
const coffeeRun = { blend: 40, limb: 'lElbow', shift: 26, keys: [
  K({ ...F(-4, HIP - 6, LF, RF), torso: 14, bend: 3, head: -6, tw: 8, la: [40, 130], ra: [34, 172] }, 50, 'in'),
  K({ ...F(4, HIP - 9, LF + 16, RF, 7, 0), torso: 24, bend: 5, head: -10, tw: -2, la: [72, -36], ra: [40, 176] }, 50, 'linear'),
  K({ ...F(16, HIP - 10, LF + 28, RF + 2), torso: 30, bend: 6, head: -12, tw: -14, la: [96, -78], ra: [44, 178] }, 40, 'out', 'active'),
  K({ ...F(17, HIP - 10, LF + 28, RF + 2), torso: 31, bend: 6, head: -12, tw: -15, la: [97, -79], ra: [44, 178] }, 80, 'inOut'),
  K({ ...F(18, HIP - 7, LF + 28, RF + 8), torso: 20, bend: 4, head: -8, tw: -6, la: [64, 30], ra: [40, 170] }, 110, 'inOut', 'recover'),
  K({ ...F(22, HIP - 2, LF + 28, RF + 26, 0, 8), torso: 8, head: -4, la: [54, 148], ra: [30, 164] }, 110, 'inOut', 'footstep'),
  K({ ...F(26, HIP - 1, LF + 26, RF + 26), torso: 6, head: -4 }, 0, 'sine'),
] };

// d+1: a quick flick of the lead hand at the shin from the crouch, the wrist snapping through (faster than
// the low jab, and shorter). Stays down.
const paperCut = { blend: 30, limb: 'lHand', keys: [
  K({ ...crouchP, ...F(-2, CH - 1, LF + 2, RF - 2), torso: 16, tw: 4, la: [36, 140] }, 30, 'in'),
  K({ ...crouchP, ...F(4, CH - 1, LF + 2, RF - 2), torso: 26, bend: 8, tw: -6, head: -12, la: [50, 84] }, 30, 'linear'),
  K({ ...crouchP, ...F(7, CH - 2, LF + 2, RF - 2), torso: 30, bend: 9, tw: -12, head: -14, la: [56, 50] }, 30, 'out', 'active'),
  K({ ...crouchP, ...F(7, CH - 2, LF + 2, RF - 2), torso: 30, bend: 9, tw: -12, head: -14, la: [57, 40] }, 40, 'inOut'),
  K({ ...crouchP, ...F(4, CH - 1, LF + 2, RF - 2), torso: 24, bend: 7, la: [48, 110] }, 90, 'inOut', 'recover'),
  K({ ...crouchP }, 70, 'out'),
  K({ ...crouchP }, 0, 'sine'),
] };

// the second cut: the rear hand, the shoulders turning the other way
const paperCut2 = { blend: 30, limb: 'rHand', keys: [
  K({ ...crouchP, ...F(-2, CH - 1, LF + 2, RF - 2), torso: 16, tw: -6, ra: [20, 150] }, 30, 'in'),
  K({ ...crouchP, ...F(5, CH - 2, LF + 2, RF - 2), torso: 28, bend: 8, tw: 6, head: -12, la: [34, 150], ra: [46, 86] }, 30, 'linear'),
  K({ ...crouchP, ...F(9, CH - 3, LF + 2, RF - 2), torso: 32, bend: 9, tw: 14, head: -14, la: [30, 150], ra: [58, 50] }, 30, 'out', 'active'),
  K({ ...crouchP, ...F(9, CH - 3, LF + 2, RF - 2), torso: 32, bend: 9, tw: 15, head: -14, la: [30, 150], ra: [59, 40] }, 40, 'inOut'),
  K({ ...crouchP, ...F(5, CH - 1, LF + 2, RF - 2), torso: 24, bend: 7, la: [36, 156], ra: [40, 110] }, 90, 'inOut', 'recover'),
  K({ ...crouchP }, 70, 'out'),
  K({ ...crouchP }, 0, 'sine'),
] };

// Paper Cut's finisher (d+1, d+1, 2): up out of the crouch with a rising rear backfist to the chin, the
// body coming up tall behind it. Mid, knocks down.
const paperCutUp = { blend: 40, limb: 'rHand', shift: 8, keys: [
  K({ ...crouchP, ...F(-2, CH - 3, LF + 2, RF - 2), torso: 22, bend: 7, head: -8, tw: -10, ra: [-6, 30] }, 50, 'in'),
  K({ ...F(4, HIP - 10, LF + 8, RF - 2), torso: 12, bend: 3, head: -4, tw: -4, la: [30, 150], ra: [40, 110] }, 40, 'linear'),
  K({ ...F(10, HIP, LF + 8, RF - 2), torso: 2, bend: -2, head: -10, tw: 12, la: [26, 150], ra: [96, 168] }, 40, 'out', 'active'),
  K({ ...F(10, HIP + 1, LF + 8, RF - 2, 0, 4), torso: -2, bend: -3, head: -12, tw: 13, la: [26, 150], ra: [100, 172] }, 60, 'inOut'),
  K({ ...F(8, HIP, LF + 8, RF), torso: -4, bend: -2, head: -8, tw: 8, la: [32, 156], ra: [70, 150] }, 90, 'inOut', 'recover'),
  K({ ...F(6, HIP - 1, LF + 8, RF + 8, 0, 6), torso: 4, head: -4, la: [52, 150], ra: [36, 160] }, 90, 'inOut', 'footstep'),
  K({ ...F(8, HIP - 1, LF + 8, RF + 8), torso: 6, head: -4 }, 0, 'sine'),
] };

// REPLY ALL's ender: the rear arm swung all the way back, then a wide haymaker hook thrown with
// everything, the body following it through and a stumble step to get his balance back.
const replyAll = { blend: 40, limb: 'rHand', shift: 28, keys: [
  K({ ...F(-6, HIP - 5, LF, RF), torso: -8, bend: -4, head: 6, tw: -22, la: [50, 120], ra: [-70, -10] }, 90, 'in'),
  K({ ...F(4, HIP - 7, LF + 16, RF, 8, 0), torso: 10, bend: 2, head: 0, tw: -6, la: [34, 104], ra: [10, 60] }, 40, 'linear'),
  K({ ...F(18, HIP - 9, LF + 30, RF), torso: 32, bend: 8, head: -12, tw: 20, la: [4, 84], ra: [92, 118] }, 40, 'out', 'active'),
  K({ ...F(22, HIP - 10, LF + 30, RF), torso: 40, bend: 10, head: -16, tw: 25, la: [-6, 64], ra: [108, 146] }, 70, 'inOut'),
  K({ ...F(24, HIP - 8, LF + 30, RF + 10, 0, 10), torso: 30, bend: 6, head: -10, tw: 16, la: [20, 100], ra: [80, 120] }, 120, 'inOut', 'recover'),
  K({ ...F(28, HIP - 2, LF + 30, RF + 28), torso: 10, head: -6, la: [54, 148], ra: [30, 164] }, 120, 'inOut', 'footstep'),
  K({ ...F(28, HIP - 1, LF + 28, RF + 28), torso: 6, head: -4 }, 0, 'sine'),
] };

// an ID badge on a lanyard: the cord round the neck and down the front of the chest, the badge hanging
// from its clip. A cloth chain (below): the cord swings with him and the badge swings on the clip under it
function lanyard(ctx, P, o) {
  const J = o.J, s = o.scale, n = J.neck, h = J.hip;
  let ux = n.x - h.x, uy = n.y - h.y; const Lt = Math.hypot(ux, uy) || 1; ux /= Lt; uy /= Lt;   // up the spine
  const fx = -uy * o.facing, fy = ux * o.facing;                                                  // forward, across it
  const w = (o.R.torsoW || 15) * s * 0.5;
  const back = { x: n.x - fx * w * 0.5 + ux * 1 * s, y: n.y - fy * w * 0.5 + uy * 1 * s };
  const front = P[0], tip = P[2], clip = P[3];
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = o.accent; ctx.fillStyle = o.accent;
  ctx.lineWidth = 1.8 * s;
  ctx.beginPath(); ctx.moveTo(back.x, back.y); ctx.quadraticCurveTo(front.x + fx * 2 * s, front.y + fy * 2 * s, tip.x, tip.y); ctx.stroke();
  chainPath(ctx, P.slice(0, 3)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(clip.x, clip.y); ctx.stroke();
  // the badge hangs from the clip, swinging on it
  const bw = 7 * s, bh = 9 * s;
  ctx.save(); ctx.translate(clip.x, clip.y); ctx.rotate(Math.atan2(clip.y - tip.y, clip.x - tip.x) - Math.PI / 2);
  ctx.fillRect(-bw / 2, 0, bw, bh);
  ctx.fillStyle = '#1a0f05';   // the photo and a name line, dark on the badge
  ctx.fillRect(-bw / 2 + 1.4 * s, 1.6 * s, bw * 0.38, bh * 0.4);
  ctx.fillRect(-bw / 2 + 1.4 * s, bh * 0.68, bw - 2.8 * s, 1.2 * s);
  ctx.restore();
}

// The celebration (registry `dance`, played by the match winner under the WINS banner): Unpaid and over the moon: a crouch, a star jump with both arms up, a hop that turns all the way round,
// and arms going everywhere.
const dance = { keys: [
  K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4, la: [50, 120], ra: [30, 120] }, 120, 'inOut'),
  K({ ...F(0, HIP - 9, LF, RF), torso: 18, bend: 5, head: 8, la: [26, 60], ra: [14, 46] }, 140, 'in'),
  K({ ...F(0, HIP + 4, LF + 8, RF - 8), torso: -4, bend: -3, head: -20, la: [168, 190], ra: [150, 172], air: 24 }, 170, 'out'),
  K({ ...F(0, HIP - 7, LF, RF), torso: 14, bend: 4, head: 4, la: [70, 96], ra: [50, 80] }, 130, 'in'),
  K({ ...F(0, HIP + 1, LF, RF), torso: 4, head: -10, la: [130, 170], ra: [-50, -20], spin: 180, air: 16 }, 170, 'linear'),
  K({ ...F(0, HIP - 4, LF, RF), torso: 8, head: -6, la: [96, 110], ra: [-70, -80], spin: 360 }, 140, 'out'),
  K({ ...F(0, HIP - 2, LF, RF, 6, 0), torso: 2, bend: -2, head: -14, la: [150, 210], ra: [40, 20], spin: 360 }, 120, 'sine'),
  K({ ...F(0, HIP - 2, LF, RF, 0, 6), torso: 2, bend: -2, head: -14, la: [60, 30], ra: [150, 210], spin: 360 }, 120, 'sine'),
  K({ ...F(0, HIP - 2, LF, RF, 6, 0), torso: 2, bend: -2, head: -14, la: [150, 210], ra: [40, 20], spin: 360 }, 120, 'sine'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4, la: [50, 120], ra: [30, 120], spin: 360 }, 0, 'inOut'),
] };

export default {
  dance,
  id: 'intern',
  name: 'INTERN',
  tagline: 'UNPAID, AND SWINGING LIKE IT',
  // how it moves (the life layer's signature, src/fighter/life.js: drawn only): can't stand still: loose springs, a quick eye, foot-to-foot fidgeting; laughs at your botch
  life: { spring: 1.25, damp: 0.85, eye: 1.35, breath: 1.2, sway: 1.6, swayHz: 0.7, habits: ['fidget', 'fidget', 'glance'], laugh: true },
  color: '#ffb02e',
  altColor: '#3fd0ff',
  accent: '#ff4f7b',
  // a little lighter and a little weaker; his stamina comes back quicker (he's young)
  stats: { health: 96, walk: 1.04, backWalk: 1, run: 1.05, jump: 1.02, dash: 1.05, weight: 0.95, stamina: 1, regen: 1.15, damage: 0.97 },
  // a touch smaller all over (scale), the head a bit big for the body; same proportions otherwise, so his
  // reach is a little short of TEMP's
  body: { scale: 0.95, headR: 15.5, limbW: 11.5, limbTip: 8.8, torsoW: 14, lean: 2 },
  // the lanyard: the cord from the collar to the clip, then the badge on a short clip that swings on its own
  cloth: [{ draw: lanyard, axis: ['neck', 'chest'], off: [5.6, 0], dir: [[0.263, 0.965], [0.263, 0.965], [0, 1]], len: [8.35, 8.35, 2.5], hz: 2.4, damping: 0.22, side: 'front', clear: 5 }],
  moves: {
    coffeeRun: { rig: coffeeRun, frame: { limb: 'hand', damage: 11, kb: { x: 340, y: 0 }, hitstun: 30, blockstun: 8, hitstop: 7, height: 'mid',
      travel: { vx: 420, at: 40, ms: 160 }, cost: 19, reach: 90, flashR: 34, callout: 'COFFEE RUN' } },
    paperCut: { rig: paperCut, frame: { limb: 'hand', damage: 4, kb: { x: 0, y: 0 }, hitstun: 17, blockstun: 6, hitstop: 4, height: 'low', tc: true, cost: 12, reach: 72, flashR: 22 } },
    paperCut2: { rig: paperCut2, frame: { limb: 'hand', damage: 4, kb: { x: 0, y: 0 }, hitstun: 15, blockstun: 6, hitstop: 4, height: 'low', tc: true, cost: 12, reach: 74, flashR: 22 } },
    paperCutUp: { rig: paperCutUp, frame: { limb: 'hand', damage: 9, kb: { x: 300, y: 260 }, hitstun: 0, blockstun: 12, hitstop: 8, knockdown: true, height: 'mid',
      cost: 20, reach: 70, flashR: 32, callout: 'PAPER CUT' } },
    replyAll: { rig: replyAll, frame: { limb: 'hand', damage: 15, kb: { x: 520, y: 260 }, hitstun: 0, blockstun: 16, hitstop: 9, knockdown: true, ender: true, height: 'mid',
      reach: 95, flashR: 40, callout: 'REPLY ALL' } },
  },
  commands: [
    { button: '1', motion: 'ff', move: 'coffeeRun' },
    { button: '1', motion: 'd', move: 'paperCut' },
    { button: '1', motion: 'df', move: 'paperCut' },
    { button: '1', motion: 'db', move: 'paperCut' },
  ],
  strings: {
    drop: ['LOW RUSH'],
    add: [
      { name: 'PAPER CUT', keys: ['d1', 'd1', '2'], moves: ['paperCut', 'paperCut2', 'paperCutUp'] },
      { name: 'PAPER CUTS', keys: ['d1', 'd1', 'd3'], moves: ['paperCut', 'paperCut2', 'lowKick'] },
      { name: 'REPLY ALL', keys: ['1', '2', '2'], moves: ['jab', 'cross', 'replyAll'] },
    ],
  },
  ai: {
    style: null,
    specials: [
      // runs in with the elbow, from a bit outside his punches; after a whiff it's his favorite thing
      { move: 'coffeeRun', min: 70, max: 190, when: 'whiff', chance: 0.6, cooldown: 80 },
      { move: 'coffeeRun', min: 100, max: 180, when: 'standing', chance: 0.28, cooldown: 160 },
      // the paper cuts on a standing guard, as a press so the string carries on into its finisher
      { name: 'paperCuts', cost: 12, min: 0, max: 72, lead: 40, chance: 0.4, cooldown: 120, when: (me, o) => o.grounded && !o.crouch,
        plan: (me, o, sim, dist, toward, k) => [k.move(toward, k.closer(66)), k.press('d1')] },
    ],
  },
  moveList: [
    { name: 'COFFEE RUN', input: '→→ 1', note: 'dash-in elbow, unsafe if blocked' },
    { name: 'PAPER CUT', input: '↓1, ↓1, 2', note: 'quick lows, then a mid finisher' },
    { name: 'REPLY ALL', input: '1, 2, 2', note: 'string, a wild haymaker' },
  ],
};
