// LAWYER: throws and the answer to throws. A standard body with a lot of tools for the close game. Two unique
// moves: Objection! (b+1, a throw counter: a stance that catches an incoming throw or command grab in its
// startup or active frames and turns it into his own throw, the `throwCounter` hook; any strike beats it,
// and a whiff is a long, open recovery) and Cross-Examination (f+1, a quick pointing jab to the chest: a mid,
// plus on block, so his throw or a mid comes next and the guard has to guess: stand and get thrown, duck and
// eat the mid). One unique string, CLOSING ARGUMENT (2, 3, 2), ending in a full swing of the briefcase.
// Keeps every shared string.
import { RIG_KIT } from '../fighter/index.js';
import { stoop, lift } from './perfectKit.js';
import { FRAME_DATA } from '../combat/frameData.js';

const { K, F, LF, RF, HIP, base, deepKeys } = RIG_KIT;

// b+1: the weight rocks back onto the rear foot and the lead arm shoots out straight, finger pointed at
// him, the rear hand (the briefcase) pulled in to the hip. The point holds (the catch window is startup
// and active), then the arm drops and he has to collect himself: a whiff is a long recovery.
const objection = { blend: 40, limb: 'lHand', keys: [
  K({ ...F(-3, HIP - 2, LF, RF), torso: 0, bend: -2, head: -2, tw: 6, la: [70, 120], ra: [20, 110] }, 40, 'in'),
  K({ ...F(-7, HIP - 4, LF, RF), torso: -6, bend: -3, head: 2, tw: -10, la: [104, 100], ra: [12, 90] }, 40, 'out', 'active'),
  K({ ...F(-8, HIP - 4, LF, RF), torso: -7, bend: -3, head: 3, tw: -11, la: [106, 102], ra: [12, 88] }, 180, 'sine'),
  K({ ...F(-6, HIP - 3, LF, RF), torso: -4, bend: -2, head: 1, tw: -8, la: [98, 104], ra: [14, 94] }, 60, 'inOut', 'recover'),
  K({ ...F(-3, HIP - 3, LF, RF), torso: 8, bend: 2, head: -6, tw: 0, la: [30, 60], ra: [18, 80] }, 200, 'inOut'),
  K({ ...F(-1, HIP - 2, LF, RF), torso: 7, bend: 1, head: -5, la: [46, 124], ra: [26, 140] }, 130, 'out'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4 }, 0, 'sine'),
] };

// the reversal: his pointing hand closes on the thrower's wrist and the briefcase hand takes the collar
// (the catch is the clip's first pose, since the grab freezes it there for the hold), then the shared
// throw's sink, turn and heave over in front of him. The victim takes the rig's thrown reaction.
const sustained = { blend: 30, limb: 'lHand', keys: [
  K({ ...F(4, HIP - 5, LF + 6, RF, 6, 0), torso: 12, bend: 3, head: -6, tw: -4, la: [88, 78], ra: [72, 86] }, 40, 'out', 'active'),
  ...deepKeys(base('throw')).slice(2).map((k) => ({ ...k, p: { ...k.p, hx: k.p.hx - 2 } })),
] };

// f+1: a short, sharp point to the sternum, the lead arm snapping straight at chest height and straight
// back. Fast in and fast out: the recovery is short, so he's plus when it's blocked.
const crossExam = { blend: 30, limb: 'lHand', keys: [
  K({ ...F(-1, HIP - 2, LF, RF), torso: 4, bend: -1, head: -3, tw: 4, la: [44, 118], ra: [24, 120] }, 40, 'in'),
  K({ ...F(4, HIP - 3, LF, RF), torso: 12, bend: 2, head: -5, tw: -6, la: [70, 84], ra: [24, 118] }, 30, 'linear'),
  K({ ...F(9, HIP - 3, LF, RF), torso: 18, bend: 3, head: -7, tw: -12, la: [84, 84], ra: [22, 116] }, 30, 'out', 'active'),
  K({ ...F(9, HIP - 3, LF, RF), torso: 18, bend: 3, head: -7, tw: -12, la: [85, 85], ra: [22, 116] }, 30, 'inOut'),
  K({ ...F(6, HIP - 2, LF, RF), torso: 12, bend: 2, head: -6, tw: -6, la: [70, 112], ra: [24, 124] }, 60, 'out', 'recover'),
  K({ ...F(1, HIP - 1, LF, RF), torso: 7, head: -4, la: [54, 146], ra: [28, 158] }, 60, 'out'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4 }, 0, 'sine'),
] };

// CLOSING ARGUMENT's ender: the briefcase hand winds all the way back behind him, he steps through and
// swings it round at rib height, the whole body turning behind it. Mid, knocks down, splats on a wall.
const closingArgument = { blend: 40, limb: 'rHand', shift: 18, keys: [
  K({ ...F(-4, HIP - 3, LF, RF), torso: 2, bend: -2, head: 2, tw: -16, la: [60, 120], ra: [-34, -10] }, 70, 'in'),
  K({ ...F(-6, HIP - 5, LF, RF), torso: -4, bend: -3, head: 4, tw: -20, la: [66, 116], ra: [-56, -30] }, 50, 'in'),
  K({ ...F(6, HIP - 8, LF + 18, RF, 8, 0), torso: 12, bend: 3, head: -4, tw: 4, la: [40, 90], ra: [40, 50] }, 40, 'linear'),
  K({ ...F(16, HIP - 9, LF + 18, RF), torso: 26, bend: 5, head: -10, tw: 18, la: [20, 60], ra: [90, 92] }, 40, 'out', 'active'),
  K({ ...F(18, HIP - 9, LF + 18, RF + 4), torso: 28, bend: 5, head: -10, tw: 20, la: [16, 56], ra: [110, 120] }, 80, 'inOut'),
  K({ ...F(16, HIP - 5, LF + 18, RF + 8), torso: 14, bend: 2, head: -6, tw: 8, la: [40, 110], ra: [70, 120] }, 100, 'inOut', 'recover'),
  K({ ...F(16, HIP - 2, LF + 18, RF + 18, 0, 8), torso: 7, head: -4, la: [54, 148], ra: [30, 160] }, 110, 'inOut', 'footstep'),
  K({ ...F(18, HIP - 1, LF + 18, RF + 18), torso: 6, head: -4 }, 0, 'sine'),
] };

// round, rimless reading glasses on the nose (two lens glints and a bridge)
function glasses(ctx, J, o) {
  const h = J.head, n = J.neck, r = o.headR, s = o.scale;
  let ux = h.x - n.x, uy = h.y - n.y; const Ln = Math.hypot(ux, uy) || 1; ux /= Ln; uy /= Ln;
  const fx = -uy * o.facing, fy = ux * o.facing;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const gx = h.x + fx * r * 0.58 + ux * r * 0.12, gy = h.y + fy * r * 0.58 + uy * r * 0.12;
  ctx.strokeStyle = '#0a0414'; ctx.lineWidth = 2.6 * s;
  ctx.beginPath(); ctx.moveTo(gx - fx * r * 0.62, gy - fy * r * 0.62); ctx.lineTo(gx + fx * r * 0.42, gy + fy * r * 0.42); ctx.stroke();
  ctx.strokeStyle = o.accent; ctx.lineWidth = 1.4 * s;
  ctx.beginPath(); ctx.arc(gx + fx * r * 0.16, gy + fy * r * 0.16, r * 0.26, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(gx - fx * r * 0.1, gy - fy * r * 0.1); ctx.lineTo(gx - fx * r * 0.7, gy - fy * r * 0.7 + uy * 0); ctx.stroke();   // the arm back to the ear
}
// the briefcase in the rear hand, a cloth chain of one link (below): its rest hangs from the handle when the
// arm is down and swings out along the forearm when it swings, and the case swings on the handle round that
const caseRest = (J) => {
  const hand = J.rHand, el = J.rElbow;
  let ax = hand.x - el.x, ay = hand.y - el.y; const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
  const w = Math.max(0, Math.min(1, (ay + 0.5) / 0.7));   // forearm pointing up: it hangs; level or down: it follows the swing
  const dx = ax * 0.9 * w, dy = 1 + ay * 0.9 * w, dl = Math.hypot(dx, dy) || 1;
  return { x: dx / dl, y: dy / dl };
};
function briefcase(ctx, P, o) {
  const s = o.scale, hand = P[0];
  let dx = P[1].x - hand.x, dy = P[1].y - hand.y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const px = -dy, py = dx, len = 15 * s, half = 10 * s, top = 3 * s;
  const c0x = hand.x + dx * top, c0y = hand.y + dy * top;
  const pts = [[c0x - px * half, c0y - py * half], [c0x + px * half, c0y + py * half], [c0x + px * half + dx * len, c0y + py * half + dy * len], [c0x - px * half + dx * len, c0y - py * half + dy * len]];
  ctx.fillStyle = '#0a0414'; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = o.accent; ctx.lineWidth = 1.6 * s; ctx.stroke();
  ctx.lineWidth = 1.4 * s; ctx.beginPath(); ctx.moveTo(hand.x - px * 3 * s, hand.y - py * 3 * s); ctx.lineTo(c0x - px * 3 * s, c0y - py * 3 * s); ctx.moveTo(hand.x + px * 3 * s, hand.y + py * 3 * s); ctx.lineTo(c0x + px * 3 * s, c0y + py * 3 * s); ctx.stroke();
  ctx.fillStyle = o.color; ctx.beginPath(); ctx.arc(c0x + dx * 4 * s, c0y + dy * 4 * s, 1.6 * s, 0, Math.PI * 2); ctx.fill();
}

// The celebration (registry `dance`, played by the match winner under the WINS banner): Objection sustained: a point at the jury, then a slow strut with the lapels held.
const dance = { keys: [
  K({ ...F(0, HIP, LF, RF), torso: -2, bend: -3, head: -8, tw: -6, la: [100, 100], ra: [20, 60] }, 200, 'snap'),
  K({ ...F(0, HIP, LF, RF), torso: -2, bend: -3, head: -8, tw: -6, la: [102, 102], ra: [20, 60] }, 360, 'sine'),
  K({ ...F(0, HIP - 2, LF, RF, 0, 8), torso: -4, bend: -4, head: -10, la: [40, 170], ra: [36, 168] }, 260, 'inOut'),
  K({ ...F(0, HIP, LF, RF), torso: -6, bend: -4, head: -12, la: [40, 170], ra: [36, 168] }, 260, 'inOut'),
  K({ ...F(0, HIP - 2, LF, RF, 8, 0), torso: -4, bend: -4, head: -10, la: [40, 170], ra: [36, 168] }, 260, 'inOut'),
  K({ ...F(0, HIP, LF, RF), torso: -6, bend: -4, head: -12, la: [40, 170], ra: [36, 168] }, 260, 'inOut'),
] };

// The perfect round finisher (registry `perfect`, README Perfect rounds): up by the collar in the pointing hand, the briefcase wound back, and a full swing of it that sends the body at the camera; then the point and the lapel tug.
const perfect = { name: 'CASE CLOSED', note: 'Up by the collar in the pointing hand, the briefcase wound back, and a full swing of it that sends the body at the camera; then the point and the lapel tug.', stamp: 'CASE CLOSED', hand: 'lHand', hold: 'collar', fly: { spin: 1, arc: 40 }, keys: [
  ...stoop('lHand'),
  lift('collar', 'lHand', 200),
  K({ face: 0.3, ...F(-4, HIP - 6, LF, RF - 4), torso: 0, bend: -2, head: -6, tw: -14, la: [100, 108], ra: [-70, -50] }, 220, 'inOut'),
  K({ face: 0.35, ...F(-4, HIP - 7, LF, RF - 4), torso: 0, bend: -2, head: -6, tw: -16, la: [100, 108], ra: [-80, -60] }, 80, 'sine'),
  K({ face: 0.9, ...F(8, HIP - 4, LF + 12, RF - 4), torso: 18, bend: 4, head: -8, tw: 14, la: [60, 80], ra: [100, 90] }, 80, 'out', 'release'),
  K({ face: 0.85, ...F(10, HIP - 3, LF + 12, RF), torso: 14, head: -8, tw: 12, la: [50, 90], ra: [120, 110] }, 200, 'out', 'footstep'),
  K({ face: 0.8, ...F(8, HIP - 1, LF + 12, RF + 4), torso: 0, head: -8, la: [95, 92], ra: [30, 120] }, 240, 'inOut'),
  K({ face: 0.6, ...F(8, HIP, LF + 12, RF + 4), torso: -2, head: -10, la: [70, 150], ra: [30, 120] }, 260, 'inOut'),
  K({ face: 0.6, ...F(8, HIP, LF + 12, RF + 4), torso: -2, head: -12, la: [72, 152], ra: [30, 120] }, 0, 'sine'),
] };

// Fighter mastery (README, Progression, Fighter mastery; the names are src/career/mastery.js KIT). The victory pose
// (registry `victory`, in place of the dance once it's unlocked and on): Case closed: one hand on the lapel, the other pointing straight up. The court has ruled.
const victory = { keys: [
  K({ ...F(0, HIP - 2, LF, RF), torso: 4, head: 4, la: [60, 140], ra: [40, 150] }, 200, 'in'),
  K({ ...F(0, HIP, LF + 4, RF - 2), torso: -4, bend: -3, head: -12, la: [172, 178], ra: [40, 160] }, 240, 'out'),
  K({ ...F(0, HIP, LF + 4, RF - 2), torso: -4, bend: -3, head: -14, la: [172, 178], ra: [40, 160] }, 460, 'sine'),
] };
// The taunt (registry `taunt`): the last round's winner plays it under the next ROUND card, never in a fight, and it's
// over by FIGHT (TAUNT_MAX_MS). Objection!: a sharp step in and a finger thrust at them.
const taunt = { keys: [
  K({ ...F(0, HIP - 2, LF, RF), torso: 4, head: 4, la: [60, 140], ra: [40, 150] }, 200, 'in'),
  K({ ...F(6, HIP - 2, LF + 14, RF), torso: 10, head: -6, la: [94, 94], ra: [40, 150] }, 140, 'snap'),
  K({ ...F(6, HIP - 2, LF + 14, RF), torso: 10, head: -8, la: [96, 96], ra: [40, 150] }, 360, 'sine'),
  K({ ...F(0, HIP, LF, RF), torso: 2, head: 0, la: [12, 24], ra: [8, 20] }, 280, 'inOut'),
] };

export default {
  dance,
  victory,
  taunt,
  perfect,
  id: 'lawyer',
  name: 'LAWYER',
  tagline: 'OBJECTION. ALSO, YOU’RE ON THE FLOOR',
  // how it moves (the life layer's signature, src/fighter/life.js: drawn only): measured: damped springs, straightens up, a shrug
  life: { spring: 0.9, damp: 1.2, breath: 0.95, sway: 0.4, swayHz: 0.4, habits: ['straighten', 'shrug'] },
  color: '#9aa7ff',
  altColor: '#5effc0',
  accent: '#f2f4ff',
  pants: '#ffb02e',
  altPants: '#ff5fd2',
  // average everything; the edge is the close game, not the stats
  stats: { health: 100, walk: 0.98, backWalk: 1, run: 0.98, jump: 1, dash: 1, weight: 1, stamina: 1, regen: 1.05, damage: 1 },
  body: { scale: 1, headR: 14.6, limbW: 11.6, limbTip: 8.8, torsoW: 15, hipW: 11.4, lean: 2, accessory: glasses },
  cloth: [{ draw: briefcase, axis: ['rElbow', 'rHand'], at: 1, dir: caseRest, len: 18, seg: 1, hz: 3.2, damping: 0.35, gravity: 400, limit: 1.6 }],
  moves: {
    // the stance never strikes (noHit); a throw or command grab landing in its startup or active frames is caught
    lawyer_objection: { rig: objection, frame: { limb: 'hand', damage: 0, kb: { x: 0, y: 0 }, hitstun: 0, blockstun: 0, hitstop: 0, height: 'mid', cost: 14, reach: 60, flashR: 0,
      noHit: true, throwCounter: { reversal: 'lawyer_sustained', callout: 'OBJECTION!' } } },
    // the reversal: a grab of his own that can't be broken, and the victim takes the shared thrown reaction
    lawyer_sustained: { rig: sustained, frame: { limb: 'hand', damage: 12, kb: { x: 300, y: 240 }, hitstun: 0, blockstun: 0, hitstop: 6, knockdown: true, height: 'throw',
      throw: true, grab: true, noBreak: true, unblockable: true, range: 200, hold: 12, thrownClip: true, cost: 0, reach: 60, flashR: 30, callout: 'SUSTAINED' } },
    lawyer_crossExam: { rig: crossExam, frame: { limb: 'hand', damage: 5, kb: { x: 200, y: 0 }, hitstun: 26, blockstun: 15, hitstop: 4, knockdown: false, height: 'mid',
      travel: { vx: 220, at: 30, ms: 80 }, blockPush: -150, cost: 14, reach: 80, flashR: 26, cancels: ['cross', 'jab', 'lkick'] } },
    lawyer_closingArgument: { rig: closingArgument, frame: { limb: 'hand', damage: 15, kb: { x: 680, y: 200 }, hitstun: 0, blockstun: 16, hitstop: 9, knockdown: true, splat: true, ender: true,
      height: 'mid', reach: 95, flashR: 38, callout: 'CLOSING ARGUMENT' } },
  },
  commands: [
    { button: '1', motion: 'b', move: 'lawyer_objection' },
    { button: '1', motion: 'f', move: 'lawyer_crossExam' },
  ],
  strings: { add: [{ name: 'CLOSING ARGUMENT', keys: ['2', '3', '2'], moves: ['cross', 'lkick', 'lawyer_closingArgument'] }] },
  ai: {
    style: 'grappler',
    specials: [
      // a throw or command grab starting up in reach: object, a reflex looked at every step (a slow command grab like
      // ESCORT is easy to see, a plain throw's few frames of startup are hard)
      { move: 'lawyer_objection', min: 0, max: 135, lead: 0, chance: 0.12, cooldown: 40, reflex: true,
        when: (me, o) => o.state === 'attack' && o.phase === 'startup' && throwish(o.move) },
      // reading one: he's walking in close, or he has me in blockstun up close (the tick throw is coming)
      { move: 'lawyer_objection', min: 0, max: 105, lead: 0, chance: 0.2, cooldown: 120,
        when: (me, o) => o.grounded && (o.state === 'walk' || o.state === 'run') && Math.sign(o.vx || 0) === Math.sign(me.x - o.x) },
      { move: 'lawyer_objection', min: 0, max: 100, lead: 0, chance: 0.22, cooldown: 140, when: (me) => me.state === 'blockstun' },
      // the tick: the point, then on block a throw or a mid (a guess for him), on hit the cross
      { name: 'crossExam', cost: 36, min: 0, max: 92, lead: 40, chance: 0.4, cooldown: 90, when: (me, o) => o.grounded && o.state !== 'attack' && !o.crouch,
        plan: (me, o, sim, d, toward, kit) => {
          const r = sim.reachOf(me, 'lawyer_crossExam') - 4, next = kit.chance(0.55) ? 'throw' : kit.chance(0.5) ? 'lkick' : 'overhead';
          return [
            ...(d > r ? [kit.move(toward, kit.closer(r))] : []),
            { ...kit.attack('lawyer_crossExam'), ok: true },
            kit.move(0, (m) => m.hitConfirmed || m.state !== 'attack'),
            { ...kit.attack('cross'), ok: true, onlyIf: (m, op) => m.state === 'attack' && m.hitConfirmed && op.state === 'hitstun' },
            kit.move(toward, (m) => m.state !== 'attack'),
            { ...kit.attack(next), ok: true, onlyIf: (m, op) => (op.state === 'blockstun' || op.state === 'block' || op.state === 'idle' || op.state === 'walk' || op.state === 'crouch') && Math.abs(op.x - m.x) < 110 },
          ];
        } },
    ],
  },
  moveList: [
    { name: 'OBJECTION!', input: '← 1', note: 'catches a throw or grab and throws him' },
    { name: 'CROSS-EXAMINATION', input: '→ 1', note: 'quick mid, plus on block: then throw or mid' },
    { name: 'CLOSING ARGUMENT', input: '2, 3, 2', note: 'string, briefcase swing, wall splat' },
  ],
  // STRATEGY, for the fighter page only (README, Site): how to beat each unique move. The game never shows it,
  // and site/vite-plugin.mjs cuts it from the bundle. Every tip is measured: `node gauntlet/counters.mjs lawyer`
  // prints the numbers behind each one. Measure again when the frame data changes.
  strategy: [
    { move: 'lawyer_objection', also: ['lawyer_sustained'], tips: [
      "It only catches throws. Any strike beats it: he stands there with his hand up for over half a second, so hit him. The cross (2) or →2 has all the time it needs.",
      "Don't throw him while the hand is up. He catches it and throws you instead, and that throw can't be broken.",
    ] },
    { move: 'lawyer_crossExam', tips: [
      "Stand-block it. It's a quick mid, and after you block it he still moves first, so a jab back loses.",
      "What comes next is a throw or a kick. Press throw (1+3) as you come out of the block. That breaks his throw, and you have about a third of a second to do it. Pressed promptly, it also grabs him out of the snap kick or the overhead.",
      "Crouching is wrong twice. Cross-Examination hits a croucher, and there's no time to duck the throw behind it.",
      "→ parries it, but only as a guess. It lands almost as soon as he presses.",
    ] },
    { string: 'CLOSING ARGUMENT', tips: [
      "Stand-block the opening cross. It pushes you back far enough that the kick behind it falls short, and the string dies there.",
      "Then punish the missed kick with your own cross (2) or →2.",
      "Crouching from the start works too. The cross is a high and goes over your head.",
    ] },
  ],
};

// a throw or a command grab
function throwish(move) { const fd = move && FRAME_DATA[move]; return !!fd && !!fd.throw; }
