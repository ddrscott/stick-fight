// HR REP: defensive and procedural. An ordinary, upright build with a little more health and stamina regen,
// slower on his feet, a little less damage per hit. Two unique moves: Write-Up (b+1, a quick clipboard swat
// to the head that puts him on notice: WRITTEN UP, his stamina regen halved for 3 seconds, the `status`
// hook) and Mandatory Training (b+2, a slow, long-reaching two-handed shove that sends him staggering
// back out of range on his feet), and one unique string, EXIT INTERVIEW (2, 1, 2), whose ender is a heavy
// palm that writes him up and shoves him out the door. It never knocks down, so he gets up with no free
// refill: the regen cut sticks. Keeps every shared string.
import { RIG_KIT } from '../fighter/index.js';
import { stoop, lift } from './perfectKit.js';

const { K, F, LF, RF, HIP } = RIG_KIT;

// b+1: the clipboard (in the lead hand) goes up beside the head, a short step, and it swats down across
// his face, the arm nearly straight at head height. Quick, a high: a croucher ducks it.
const writeUp = { blend: 40, limb: 'lHand', shift: 14, keys: [
  K({ ...F(-3, HIP - 2, LF, RF), torso: 0, bend: -2, head: -2, tw: 6, la: [138, 118], ra: [30, 162] }, 70, 'in'),
  K({ ...F(2, HIP - 4, LF + 8, RF, 7, 0), torso: 6, bend: -1, head: -4, tw: 8, la: [158, 156], ra: [30, 164] }, 60, 'linear'),
  K({ ...F(10, HIP - 6, LF + 14, RF), torso: 20, bend: 4, head: -8, tw: -10, la: [100, 92], ra: [34, 160] }, 40, 'out', 'active'),
  K({ ...F(11, HIP - 6.5, LF + 14, RF), torso: 21, bend: 4, head: -8, tw: -11, la: [96, 84], ra: [34, 160] }, 60, 'inOut'),
  K({ ...F(10, HIP - 4, LF + 14, RF), torso: 12, bend: 2, head: -6, tw: -4, la: [62, 112], ra: [32, 162] }, 90, 'inOut', 'recover'),
  K({ ...F(12, HIP - 2, LF + 14, RF + 14, 0, 8), torso: 7, head: -4, la: [54, 148], ra: [28, 166] }, 90, 'inOut', 'footstep'),
  K({ ...F(14, HIP - 1, LF + 14, RF + 14), torso: 6, head: -4 }, 0, 'sine'),
] };

// b+2: both hands come up to the chest holding the binder, he rises a little (the presentation), then a
// long step and both arms drive straight out at chest height, the body laid in behind them. Slow and long:
// contact about a quarter second after the press, with a glide in (frame data travel).
const training = { blend: 50, limb: 'rHand', shift: 34, keys: [
  K({ ...F(-5, HIP - 2, LF, RF), torso: -2, bend: -3, head: 2, tw: -6, la: [18, 112], ra: [8, 118] }, 90, 'in'),
  K({ ...F(-7, HIP + 1, LF, RF), torso: -6, bend: -4, head: 4, tw: -4, la: [36, 150], ra: [28, 152] }, 80, 'sine'),
  K({ ...F(4, HIP - 6, LF + 20, RF, 10, 0), torso: 8, bend: 1, head: -2, tw: -2, la: [52, 118], ra: [42, 116] }, 60, 'linear'),
  K({ ...F(18, HIP - 10, LF + 34, RF), torso: 24, bend: 5, head: -7, tw: 2, la: [88, 86], ra: [84, 82] }, 40, 'out', 'active'),
  K({ ...F(19, HIP - 10.5, LF + 34, RF + 2), torso: 26, bend: 5, head: -7, tw: 2, la: [90, 88], ra: [86, 84] }, 100, 'inOut'),
  K({ ...F(18, HIP - 6, LF + 34, RF + 8), torso: 14, bend: 2, head: -5, la: [52, 116], ra: [42, 118] }, 120, 'inOut', 'recover'),
  K({ ...F(26, HIP - 2, LF + 34, RF + 34, 0, 8), torso: 7, head: -4, la: [54, 148], ra: [30, 162] }, 110, 'inOut', 'footstep'),
  K({ ...F(34, HIP - 1, LF + 34, RF + 34), torso: 6, head: -4 }, 0, 'sine'),
] };

// the reaction to Mandatory Training and the EXIT INTERVIEW (frame data react): the chest takes it, the
// arms fly forward, and he backpedals two long steps (the root goes 64 px back with the clip, `shift`)
const shoved = { blend: 30, shift: -64, keys: [
  K({ ...F(-3, HIP - 2, LF, RF), torso: -12, bend: -10, head: -24, tw: 4, la: [70, 50], ra: [52, 30] }, 40, 'out'),
  K({ ...F(-12, HIP - 4, LF, RF - 24, 0, 10), torso: -15, bend: -8, head: -18, tw: 2, la: [84, 62], ra: [-16, 14] }, 60, 'out'),
  K({ ...F(-26, HIP - 6, LF - 8, RF - 40), torso: -10, bend: -6, head: -14, la: [62, 72], ra: [-10, 30] }, 70, 'inOut', 'footstep'),
  K({ ...F(-40, HIP - 4, LF - 32, RF - 40, 10, 0), torso: -6, bend: -3, head: -10, la: [44, 90], ra: [8, 60] }, 80, 'inOut'),
  K({ ...F(-56, HIP - 3, LF - 64, RF - 40), torso: -2, head: -6, la: [34, 70], ra: [14, 56] }, 80, 'out', 'footstep'),
  K({ ...F(-62, HIP - 2, LF - 64, RF - 64, 0, 8), torso: 4, head: -4, la: [30, 66], ra: [16, 54] }, 90, 'inOut', 'recover'),
  K({ ...F(-64, HIP - 3, LF - 64, RF - 64), torso: 5, head: -3, la: [28, 62], ra: [16, 54] }, 0, 'sine'),
] };

// EXIT INTERVIEW's ender: the rear hand goes up by the ear, a step, and a heavy palm comes down and
// through his chest with the whole body turning behind it. He's written up and shoved out on his feet.
const exitInterview = { blend: 40, limb: 'rHand', shift: 28, keys: [
  K({ ...F(-4, HIP - 3, LF, RF), torso: -4, bend: -3, head: 4, tw: -18, la: [50, 150], ra: [118, 172] }, 70, 'in'),
  K({ ...F(4, HIP - 6, LF + 18, RF, 8, 0), torso: 6, bend: 0, head: 0, tw: -12, la: [46, 146], ra: [150, 160] }, 60, 'linear'),
  K({ ...F(16, HIP - 9, LF + 28, RF), torso: 30, bend: 6, head: -12, tw: 18, la: [20, 136], ra: [96, 88] }, 40, 'out', 'active'),
  K({ ...F(17, HIP - 10, LF + 28, RF), torso: 32, bend: 7, head: -12, tw: 19, la: [18, 134], ra: [94, 84] }, 90, 'inOut'),
  K({ ...F(16, HIP - 6, LF + 28, RF + 6), torso: 16, bend: 3, head: -8, tw: 8, la: [40, 140], ra: [52, 118] }, 110, 'inOut', 'recover'),
  K({ ...F(22, HIP - 2, LF + 28, RF + 28, 0, 8), torso: 7, head: -4, la: [54, 148], ra: [30, 162] }, 100, 'inOut', 'footstep'),
  K({ ...F(28, HIP - 1, LF + 28, RF + 28), torso: 6, head: -4 }, 0, 'sine'),
] };

// a lanyard round the neck with an ID card on the chest: a cloth chain (below), the strap's V down to the clip
// and the card swinging from it
function lanyard(ctx, P, o) {
  const J = o.J, s = o.scale, n = J.neck, c = J.chest;
  let dx = c.x - n.x, dy = c.y - n.y; const L0 = Math.hypot(dx, dy) || 1; dx /= L0; dy /= L0;
  const fx = dy * o.facing, fy = -dx * o.facing;
  const clip = P[1], end = P[2];
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#2ee8ff'; ctx.lineWidth = 1.6 * s;
  ctx.beginPath(); ctx.moveTo(n.x - fx * 4 * s, n.y - fy * 4 * s); ctx.lineTo(clip.x, clip.y); ctx.lineTo(n.x + fx * 6 * s, n.y + fy * 6 * s); ctx.stroke();
  ctx.save(); ctx.translate(clip.x, clip.y); ctx.rotate(Math.atan2(end.y - clip.y, end.x - clip.x) - Math.PI / 2);
  ctx.fillStyle = '#0a0414'; ctx.fillRect(-3.4 * s, 0, 6.8 * s, 8.6 * s);
  ctx.fillStyle = o.accent; ctx.fillRect(-2.6 * s, 0.8 * s, 5.2 * s, 7 * s);
  ctx.fillStyle = '#2ee8ff'; ctx.fillRect(-2.6 * s, 0.8 * s, 5.2 * s, 2 * s);
  ctx.restore();
}
// a clipboard held flat along the lead forearm (it never reaches past the fist, so a swat still touches with the hand)
function clipboard(ctx, J, o) {
  const s = o.scale;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // the clipboard: a board on the lead forearm, from a third of the way down to just short of the fist
  const e = J.lElbow, h = J.lHand;
  let ax = h.x - e.x, ay = h.y - e.y; const La = Math.hypot(ax, ay) || 1; ax /= La; ay /= La;
  const px = -ay, py = ax, w = 7 * s;
  const p0 = { x: e.x + ax * La * 0.3, y: e.y + ay * La * 0.3 }, p1 = { x: e.x + ax * La * 0.86, y: e.y + ay * La * 0.86 };
  const quad = (k) => {
    ctx.beginPath();
    ctx.moveTo(p0.x + px * w * k, p0.y + py * w * k); ctx.lineTo(p1.x + px * w * k, p1.y + py * w * k);
    ctx.lineTo(p1.x - px * w * k, p1.y - py * w * k); ctx.lineTo(p0.x - px * w * k, p0.y - py * w * k); ctx.closePath();
  };
  ctx.fillStyle = '#0a0414'; quad(1.18); ctx.fill();
  ctx.fillStyle = o.accent; quad(1); ctx.fill();
  // the clip at the top edge and two lines of the form
  ctx.strokeStyle = '#0a0414'; ctx.lineWidth = 1.2 * s;
  for (const t of [0.42, 0.62]) {
    const q = { x: e.x + ax * La * t, y: e.y + ay * La * t };
    ctx.beginPath(); ctx.moveTo(q.x + px * w * 0.6, q.y + py * w * 0.6); ctx.lineTo(q.x - px * w * 0.6, q.y - py * w * 0.6); ctx.stroke();
  }
  ctx.fillStyle = '#2ee8ff'; ctx.beginPath(); ctx.arc(p0.x + ax * 1.5 * s, p0.y + ay * 1.5 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
}

// on notice: half stamina regen for three seconds (the sim's `status` hook; the HUD shows WRITTEN UP)
const WRITTEN_UP = { regen: 0.5, ms: 3000, tag: 'WRITTEN UP' };

// The celebration (registry `dance`, played by the match winner under the WINS banner): Noted: a quick scribble on the clipboard, a satisfied nod, and two thumbs up.
const dance = { keys: [
  K({ ...F(0, HIP, LF, RF), torso: 6, bend: 2, head: 16, la: [50, 100], ra: [40, 120] }, 140, 'inOut'),
  K({ ...F(0, HIP, LF, RF), torso: 6, bend: 2, head: 16, la: [50, 100], ra: [46, 112] }, 100, 'inOut'),
  K({ ...F(0, HIP, LF, RF), torso: 6, bend: 2, head: 16, la: [50, 100], ra: [40, 120] }, 100, 'inOut'),
  K({ ...F(0, HIP, LF, RF), torso: 6, bend: 2, head: 16, la: [50, 100], ra: [46, 112] }, 100, 'inOut'),
  K({ ...F(0, HIP, LF, RF), torso: 2, bend: 0, head: 2, la: [50, 100], ra: [40, 120] }, 200, 'inOut'),
  K({ ...F(0, HIP, LF, RF), torso: 2, bend: 0, head: 12, la: [50, 100], ra: [40, 120] }, 200, 'inOut'),
  K({ ...F(0, HIP - 2, LF, RF), torso: -2, bend: -2, head: -6, la: [70, 170], ra: [60, 168] }, 180, 'out'),
  K({ ...F(0, HIP - 2, LF, RF), torso: -2, bend: -2, head: -6, la: [72, 172], ra: [62, 170] }, 420, 'sine'),
] };

// The perfect round finisher (registry `perfect`, README Perfect rounds): up by the collar, the presentation rise, and the Mandatory Training shove with both hands out long; then the clipboard scribble.
const perfect = { name: 'MANDATORY OFFBOARDING', stamp: 'OFFBOARDED', hand: 'lHand', hold: 'collar', fly: { spin: 0.5, arc: 30, wobble: 0.5 }, keys: [
  ...stoop('lHand'),
  lift('collar', 'lHand', 200),
  K({ ...F(0, HIP + 2, LF, RF), torso: -4, bend: -4, head: -10, la: [110, 116], ra: [70, 120] }, 220, 'inOut'),
  K({ ...F(-4, HIP - 6, LF - 2, RF - 2), torso: 4, head: -4, la: [64, 60], ra: [60, 56] }, 140, 'in'),
  K({ ...F(14, HIP - 6, LF + 22, RF - 2), torso: 24, bend: 4, head: -8, la: [92, 92], ra: [90, 90] }, 80, 'out', 'release'),
  K({ ...F(16, HIP - 5, LF + 22, RF + 4, 0, 4), torso: 20, bend: 4, head: -8, la: [94, 94], ra: [92, 92] }, 200, 'linear', 'footstep'),
  K({ ...F(14, HIP - 1, LF + 22, RF + 10), torso: 6, head: 4, la: [62, 118], ra: [70, 100] }, 220, 'inOut'),
  K({ ...F(14, HIP - 1, LF + 22, RF + 10), torso: 6, head: 6, la: [62, 118], ra: [76, 112] }, 140, 'sine'),
  K({ ...F(14, HIP, LF + 22, RF + 10), torso: 6, head: 6, la: [62, 118], ra: [68, 98] }, 0, 'sine'),
] };

export default {
  dance,
  perfect,
  id: 'hrRep',
  name: 'HR REP',
  tagline: 'THIS IS GOING IN YOUR FILE',
  // how it moves (the life layer's signature, src/fighter/life.js: drawn only): watchful: damped springs, straightens up, a glance at the file
  life: { spring: 0.9, damp: 1.2, eye: 1.05, breath: 0.9, sway: 0.4, swayHz: 0.35, habits: ['straighten', 'glance'] },
  color: '#ff9de6',
  altColor: '#7dffb2',
  accent: '#fff0b8',
  pants: '#2ee8ff',
  altPants: '#ff8a3d',
  // an upright, ordinary body; a bit more health and a steadier bar, a bit less behind each hit
  stats: { health: 104, walk: 0.95, backWalk: 1.05, run: 0.95, jump: 0.98, dash: 1, weight: 1.04, stamina: 1.05, regen: 1.1, damage: 0.97 },
  body: { scale: 1, headR: 15, torsoW: 15, hipW: 11.5, limbW: 11.6, limbTip: 8.8, lean: -1, accessory: clipboard },
  cloth: [{ draw: lanyard, axis: ['neck', 'chest'], off: [1, 0], dir: [[0.246, 0.969], [0, 1]], len: [12.2, 8.6], hz: 2.2, damping: 0.25, side: 'front', clear: 4 }],
  moves: {
    hr_writeUp: { rig: writeUp, frame: { limb: 'hand', damage: 7, kb: { x: 0, y: 0 }, hitstun: 26, blockstun: 8, hitstop: 7, knockdown: false, height: 'high',
      status: WRITTEN_UP, cost: 19, reach: 85, flashR: 32, callout: 'WRITE-UP' } },
    hr_training: { rig: training, frame: { limb: 'hand', damage: 8, kb: { x: 0, y: 0 }, hitstun: 34, blockstun: 14, hitstop: 8, knockdown: false, height: 'mid',
      react: 'hr_shoved', travel: { vx: 300, at: 150, ms: 130 }, cost: 22, reach: 110, flashR: 36, callout: 'MANDATORY TRAINING' } },
    hr_shoved: { rig: shoved },
    hr_exitInterview: { rig: exitInterview, frame: { limb: 'hand', damage: 13, kb: { x: 0, y: 0 }, hitstun: 40, blockstun: 16, hitstop: 10, knockdown: false, ender: true, height: 'mid',
      react: 'hr_shoved', status: WRITTEN_UP, reach: 90, flashR: 40, callout: 'EXIT INTERVIEW' } },
  },
  commands: [
    { button: '1', motion: 'b', move: 'hr_writeUp' },
    { button: '2', motion: 'b', move: 'hr_training' },
  ],
  strings: { add: [{ name: 'EXIT INTERVIEW', keys: ['2', '1', '2'], moves: ['cross', 'jab', 'hr_exitInterview'] }] },
  ai: {
    style: 'turtle',
    range: 'mid',
    specials: [
      // the write-up on anyone who isn't already on notice, from just outside a jab, or on a whiff
      { move: 'hr_writeUp', min: 40, max: 95, when: (me, o, sim) => o.grounded && !o.crouch && !(sim.stepCount < o.regenEnd) && o.state !== 'attack', chance: 0.4, cooldown: 110 },
      { move: 'hr_writeUp', min: 40, max: 95, when: 'whiff', chance: 0.6, cooldown: 80 },
      // training from range: a whiff, a guard, or someone walking in; it sends them back where he wants them
      { move: 'hr_training', min: 100, max: 155, lead: 30, when: 'whiff', chance: 0.6, cooldown: 90 },
      { move: 'hr_training', min: 110, max: 155, lead: 20, when: (me, o) => o.grounded && o.state === 'walk' && Math.sign(o.vx || 0) === Math.sign(me.x - o.x), chance: 0.35, cooldown: 140 },
      { move: 'hr_training', min: 100, max: 160, lead: 20, when: 'guarding', chance: 0.25, cooldown: 160 },
    ],
  },
  moveList: [
    { name: 'WRITE-UP', input: '← 1', note: 'clipboard swat, halves his regen 3s' },
    { name: 'MANDATORY TRAINING', input: '← 2', note: 'slow long shove, sends him back' },
    { name: 'EXIT INTERVIEW', input: '2, 1, 2', note: 'string, writes him up, no knockdown' },
  ],
};
