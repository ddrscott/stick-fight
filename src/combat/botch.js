// Botches and happy accidents. A press thrown in the middle of another strike, outside everything that
// legally carries on from it (a string's next press, a listed cancel, a juggle's follow-up, the last
// few frames of the recovery), doesn't wait in the buffer any more: the two moves fight over one body
// and he messes up. What happens comes from the forces involved (chooseBotch below, measured by the
// sim): which limb was out and which way it was turning the body, how fast the hips were going, which
// limb the new press wanted and where. A few exact timings turn the mess into a hidden technique
// instead, a happy accident (ACCIDENTS below).
//
// Everything here is a pure function of the numbers the sim passes in (quantized from its state) and
// one draw from sim.rng, so a botch replays bit for bit under rollback and on every engine, and a
// player who repeats a mistake exactly gets the same mess (that's what makes the techniques findable).
import { addFrameData } from './frameData.js';
import { addMoves, RIG_KIT } from '../fighter/index.js';

// Steps at the end of a recovery where a press buffers like it always did (8 steps, about 4 frames at
// 60fps), so pressing a hair early for the next move never botches.
export const BOTCH_GRACE = 8;

export const BOTCH_KINDS = ['over', 'spin', 'trip', 'flail', 'whiff', 'air'];
export const BOTCH_CALLOUT = { over: 'OVERBALANCED', spin: 'SPUN OUT', trip: 'TRIPPED', flail: 'FLAIL', whiff: 'WHIFF', air: 'TANGLED' };

// Which way a strike turns the body: a rear-side limb (r*) drives the hips round forward, a lead-side
// one (l*) the other way; a kick turns it harder than a punch.
export const sideOf = (joint) => (!joint ? 0 : joint[0] === 'l' ? -1 : 1);
export const isFoot = (joint) => !!joint && /Foot|Knee/.test(joint);

// The forces (all small integers, so nothing depends on the last bit of a float):
//   cur: { foot, side, phase (0 startup, 1 active, 2 recovery), spin, travel, ender, low }
//   nw:  { foot, side, low, fwd, thrown }
//   hv   hip speed toward the opponent, in 40 px/s steps;  lv  the striking limb's speed, in 100 px/s steps
//   lean the torso's pitch in 5 degree steps
// r is one draw from sim.rng in [0, 1). Returns { kind, sev 1..3, alt 0..3, scores }.
export function chooseBotch(f, r, { noTrip = false } = {}) {
  const { cur, nw, hv, lv, lean } = f;
  const turnCur = cur.side * (cur.foot ? 2 : 1), turnNew = nw.side * (nw.foot ? 2 : 1);
  const s = {
    // legs fighting: a kick on top of a kick (worst with the same leg already in the air), a low on a kick
    trip: (cur.foot && nw.foot ? 3 : 0) + (cur.foot && cur.phase === 1 ? 1 : 0) + (cur.foot && nw.low ? 2 : 0) + (cur.low && nw.foot ? 1 : 0) + (cur.foot && nw.foot && cur.side === nw.side ? 1.5 : 0),
    // the body still turning one way while the new strike turns it the other
    spin: (turnCur * turnNew < 0 ? 1.5 + 0.25 * Math.abs(turnCur - turnNew) : 0) + (cur.spin ? 2.5 : 0) + (cur.phase === 1 ? 0.5 : 0) + Math.min(2, lv * 0.15),
    // weight already going forward (a lunge, a glide, a deep lean) and the new strike going forward too
    over: Math.max(0, hv) * 0.6 + (cur.travel ? 2.5 : 0) + (nw.fwd ? 1 : 0) + (cur.travel && nw.fwd ? 1.5 : 0) + (lean >= 5 ? 1 : 0) + (!cur.foot && !nw.foot ? 0.5 : 0),
    // both arms swinging at once
    flail: (!cur.foot && !nw.foot ? 2.5 : 0) + (!cur.foot && !nw.foot && cur.side === nw.side ? 1 : 0) + (cur.phase === 0 ? 0.5 : 0),
    // the body mostly done with the first move: the new limb just comes out wrong
    whiff: 1.5 + (cur.phase === 2 ? 1.5 : 0) + (nw.thrown ? 2 : 0),
  };
  if (noTrip) s.trip = -99;   // low on stamina: he faints standing (a knockdown would wake him)
  // a little variety from the draw: each family gets its own slice of it
  let best = 'whiff', bv = -Infinity, i = 0;
  for (const k of ['trip', 'spin', 'over', 'flail', 'whiff']) {
    const j = ((r * 9973 * (i + 1)) % 1) * 1.6;
    if (s[k] + j > bv) { bv = s[k] + j; best = k; }
    i++;
  }
  const sev = Math.max(1, Math.min(3, 1 + (cur.phase === 1 ? 1 : 0) + (Math.abs(hv) >= 6 || lv >= 12 ? 1 : 0)));
  return { kind: best, sev, alt: Math.floor(r * 4) & 3, scores: s };
}

// What a botch costs: a share of the new move's price, more for two kicks or an ender under it, more
// the harder it was. A flail costs the most. Low on stamina, it empties the bar and he faints.
export function botchCost(kind, sev, f, newCost, curEnder) {
  return Math.round(8 + 0.6 * (newCost || 18) + (f.cur.foot && f.nw.foot ? 8 : 0) + (curEnder ? 6 : 0) + 3 * sev + (kind === 'flail' ? 12 : 0));
}

// ---- happy accidents ----------------------------------------------------------------------------
// A mistimed press of `tok` (a button's digit, or 'T' for a throw) while the current move is one of
// `from`, landing in steps [at[0], at[1]) counted from `rel` ('start' = the press that started it,
// 'active' = its first active step, 'recover' = its recovery key), comes out as `move`. The windows
// are 4 steps (two 60fps frames) or 3; a step either side botches. Kept out of the player-facing
// README on purpose; the hints are what the pause menu shows.
export const ACCIDENTS = [
  { id: 'scissorKick', name: 'SCISSOR KICK', from: ['lkick'], tok: '4', rel: 'active', at: [0, 4], move: 'scissorKick',
    hint: 'THE SNAP KICK DOESN\'T HAVE TO COME HOME BEFORE THE OTHER LEG GOES' },
  { id: 'supermanPunch', name: 'SUPERMAN PUNCH', from: ['roundhouse'], tok: '2', rel: 'start', at: [24, 28], move: 'supermanPunch',
    hint: 'SELL THE ROUNDHOUSE. THE REAR HAND GOES BEFORE THE LEG DOES' },
  { id: 'pivotBackfist', name: 'PIVOT BACKFIST', from: ['roundhouse'], tok: '1', rel: 'recover', at: [17, 21], move: 'pivotBackfist',
    hint: 'WHEN A ROUNDHOUSE COMES DOWN, THE LEAD HAND CAN KEEP THE TURN GOING' },
  { id: 'flashKick', name: 'FLASH KICK', from: ['uppercut', 'risingUppercut'], tok: '4', rel: 'active', at: [2, 6], move: 'flashKick',
    hint: 'AN UPPERCUT THAT DOESN\'T STOP. LET THE REAR LEG FOLLOW IT UP' },
  { id: 'helicopter', name: 'HELICOPTER', from: ['sweep'], tok: '4', rel: 'active', at: [4, 8], move: 'helicopter',
    hint: 'THE SWEEP\'S SPIN DOESN\'T HAVE TO END AT THE FLOOR' },
  { id: 'flyingTackle', name: 'FLYING TACKLE', from: ['lungeCross'], tok: 'T', rel: 'active', at: [0, 4], move: 'flyingTackle',
    hint: 'A LUNGE IS ALREADY HALFWAY TO A GRAB' },
  { id: 'crossKnee', name: 'CROSS KNEE', from: ['cross'], tok: '4', rel: 'active', at: [6, 10], move: 'crossKnee',
    hint: 'THE CROSS DRAGS THE REAR HIP THROUGH. SO COULD A KNEE' },
  { id: 'springUppercut', name: 'SPRING UPPERCUT', from: ['lowKick', 'finePrint'], tok: '2', rel: 'active', at: [0, 3], move: 'springUppercut',
    hint: 'FROM THE LOW KICK\'S CROUCH, STAND UP SWINGING' },
];
export const ACCIDENT_BY_MOVE = Object.fromEntries(ACCIDENTS.map((a) => [a.move, a]));

/** the accident a mistimed press makes, if it lands in one's window. since(rel) is the sim's count of
 *  steps since that key of the strike out now, on the strike's own clock (so a hit's freeze holds it:
 *  a press during the hitstop counts as the frame that hit) */
export function accidentFor(u, tok, since) {
  if (!tok || u.state !== 'attack') return null;
  for (const a of ACCIDENTS) {
    if (a.tok !== tok || !a.from.includes(u.move)) continue;
    const k = since(a.rel);
    if (k != null && k >= a.at[0] && k < a.at[1]) return a;
  }
  return null;
}

// ---- the moves: the flail and the eight techniques ------------------------------------------------
const { K, F, L, LF, RF, HIP } = RIG_KIT;
// Each technique is strong (big damage, a launch, a knockdown) and risky: a long recovery, little
// blockstun, so blocked or whiffed it's a free punish.
const CLIPS = {
  // the rear leg whips up past the snap kick as it comes down, both feet off the floor, a hard landing
  scissorKick: { blend: 30, limb: 'rFoot', shift: 16, height: 'mid', keys: [
    K({ hx: 4, ll: [70, 40], rl: [30, -30], torso: -20, bend: -4, head: 12, la: [60, 120], ra: [-40, -10], air: 18 }, 40, 'linear'),
    K({ hx: 10, ll: [20, 0], rl: [104, 100], torso: -40, bend: -8, head: 18, tw: 14, la: [100, 150], ra: [-70, -60], air: 30 }, 40, 'out', 'active'),
    K({ hx: 11, ll: [18, -4], rl: [112, 108], torso: -44, bend: -9, head: 20, tw: 16, la: [104, 154], ra: [-74, -64], air: 26 }, 60, 'inOut'),
    K({ hx: 12, ll: [40, -10], rl: [70, 20], torso: -20, bend: -4, head: 10, la: [80, 130], ra: [-40, -20], air: 14 }, 70, 'in', 'recover'),
    K({ ...F(16, HIP - 14, LF + 16, RF + 30), torso: 22, bend: 6, head: -8, la: [50, 100], ra: [20, 80] }, 90, 'out', 'land'),
    K({ ...F(16, HIP - 10, LF + 16, RF + 30), torso: 16, bend: 4, head: -6, la: [44, 110], ra: [24, 100] }, 160, 'sine'),
    K({ ...F(16, HIP - 1, LF + 16, RF + 16, 0, 6), torso: 7, head: -4, la: [54, 148], ra: [28, 160] }, 120, 'inOut', 'footstep'),
    K({ ...F(16, HIP - 1, LF + 16, RF + 16), torso: 6, head: -3 }, 0, 'sine'),
  ] },
  // the roundhouse's knee keeps rising as a feint, then he springs off the lead leg, the rear leg kicks
  // back and the rear fist flies out ahead of him; a long landing
  supermanPunch: { blend: 30, limb: 'rHand', shift: 22, height: 'high', keys: [
    K({ hx: 4, ll: L(4, 52, LF), rl: [64, -18], torso: 10, bend: 2, head: 4, tw: -16, la: [40, 150], ra: [20, 160], air: 4 }, 50, 'in'),
    K({ hx: 8, ll: [20, -10], rl: [-40, -80], torso: 24, bend: 4, head: -6, tw: -6, la: [30, 140], ra: [60, 110], air: 22 }, 50, 'linear'),
    K({ hx: 16, ll: [30, 10], rl: [-60, -70], torso: 40, bend: 8, head: -18, tw: 18, la: [10, 120], ra: [96, 96], air: 20 }, 40, 'out', 'active'),
    K({ hx: 18, ll: [24, 6], rl: [-50, -60], torso: 40, bend: 8, head: -18, tw: 18, la: [10, 120], ra: [97, 97], air: 12 }, 80, 'inOut'),
    K({ ...F(20, HIP - 12, LF + 20, RF + 8), torso: 30, bend: 6, head: -12, tw: 10, la: [20, 130], ra: [80, 80] }, 80, 'in', 'recover'),
    K({ ...F(22, HIP - 8, LF + 22, RF + 12), torso: 18, bend: 4, head: -8, la: [36, 140], ra: [50, 110] }, 180, 'sine', 'footstep'),
    K({ ...F(22, HIP - 1, LF + 22, RF + 22, 0, 6), torso: 7, head: -4, la: [54, 148], ra: [28, 160] }, 120, 'out'),
    K({ ...F(22, HIP - 1, LF + 22, RF + 22), torso: 6, head: -3 }, 0, 'sine'),
  ] },
  // from the roundhouse's planted lunge he keeps turning: the back comes round (spin), the lead fist
  // whips out as he faces again, and the turn carries him past balance for a beat
  pivotBackfist: { blend: 30, limb: 'lHand', shift: 12, height: 'high', keys: [
    K({ ...F(14, HIP - 4, 16, 44), torso: 14, bend: 2, head: 6, spin: 90, la: [80, 170], ra: [30, 150] }, 50, 'in'),
    K({ ...F(14, HIP - 6, 16, 44), torso: 18, bend: 3, head: -10, spin: 200, la: [100, 196], ra: [24, 140] }, 50, 'linear'),
    K({ ...F(14, HIP - 4, 16, 44), torso: 16, bend: 3, head: -6, tw: -14, spin: 345, la: [92, 96], ra: [20, 140] }, 40, 'out', 'active'),
    K({ ...F(14, HIP - 4, 16, 44), torso: 18, bend: 4, head: -6, tw: -15, spin: 360, la: [94, 90], ra: [20, 140] }, 70, 'inOut'),
    K({ ...F(14, HIP - 5, 16, 44), torso: 14, bend: 3, head: -4, tw: -8, spin: 360, la: [70, 60], ra: [24, 140] }, 90, 'in', 'recover'),
    K({ ...F(13, HIP - 6, 16, 40), torso: 12, bend: 2, head: -2, spin: 360, la: [40, 80], ra: [26, 140] }, 170, 'sine'),
    K({ ...F(12, HIP - 1, LF + 12, RF + 12), torso: 6, head: -4, spin: 360, la: [54, 148], ra: [28, 160] }, 120, 'out', 'footstep'),
    K({ ...F(12, HIP - 1, LF + 12, RF + 12), torso: 6, head: -3, spin: 360 }, 0, 'sine'),
  ] },
  // the uppercut keeps going up into a back flip, the rear leg sweeping up through the space in front of
  // him and over; he lands back where he came from, crouched, and stays there a while
  flashKick: { blend: 30, limb: 'rFoot', shift: -24, height: 'mid', keys: [
    K({ hx: 0, ll: [10, -10], rl: [60, 40], torso: -30, bend: -8, head: 14, la: [140, 170], ra: [150, 180], air: 20 }, 40, 'linear'),
    K({ hx: -2, ll: [20, -40], rl: [150, 160], torso: -70, bend: -14, head: 30, la: [170, 200], ra: [180, 210], air: 44 }, 40, 'out', 'active'),
    K({ hx: -6, ll: [60, -30], rl: [190, 200], torso: -100, bend: -16, head: 36, la: [190, 220], ra: [200, 230], air: 54 }, 70, 'inOut'),
    K({ hx: -16, ll: [40, -40], rl: [70, 10], torso: -40, bend: -6, head: 16, la: [120, 150], ra: [110, 140], air: 28 }, 90, 'in', 'recover'),
    K({ ...F(-24, HIP - 16, LF - 24, RF - 24), torso: 28, bend: 8, head: -12, la: [60, 90], ra: [50, 80] }, 90, 'out', 'land'),
    K({ ...F(-24, HIP - 12, LF - 24, RF - 24), torso: 20, bend: 6, head: -8, la: [50, 110], ra: [36, 110] }, 200, 'sine'),
    K({ ...F(-24, HIP - 1, LF - 24, RF - 24, 0, 6), torso: 7, head: -4, la: [54, 148], ra: [28, 160] }, 120, 'out', 'footstep'),
    K({ ...F(-24, HIP - 1, LF - 24, RF - 24), torso: 6, head: -3 }, 0, 'sine'),
  ] },
  // the sweep's spin carries on round and up off the floor: the leg rises from the shin to the ribs as
  // he comes back to face him
  helicopter: { blend: 30, limb: 'rFoot', shift: 14, height: 'mid', keys: [
    K({ hx: 10, torso: 40, bend: 8, head: -6, spin: 90, ll: [76, -70], rl: [90, 90], la: [-40, -10], ra: [60, 40] }, 50, 'linear'),
    K({ hx: 8, torso: 16, bend: 4, head: -2, spin: 200, ll: L(8, 48, 10), rl: [100, 100], la: [40, 100], ra: [-20, 20] }, 50, 'linear'),
    K({ hx: 12, torso: -20, bend: -4, head: 10, spin: 340, ll: L(12, 56, 14), rl: [110, 108], la: [90, 140], ra: [-60, -50], air: 10 }, 40, 'out', 'active'),
    K({ hx: 13, torso: -26, bend: -6, head: 14, spin: 360, ll: L(13, 57, 14), rl: [116, 112], la: [96, 146], ra: [-66, -56], air: 12 }, 70, 'inOut'),
    K({ hx: 14, torso: -10, bend: -2, head: 8, spin: 360, ll: L(14, 56, 14), rl: [70, 20], la: [70, 130], ra: [-30, 0], air: 4 }, 90, 'in', 'recover'),
    K({ ...F(14, HIP - 8, LF + 14, RF + 30), torso: 16, bend: 4, head: -6, spin: 360, la: [50, 120], ra: [20, 100] }, 180, 'sine', 'footstep'),
    K({ ...F(14, HIP - 1, LF + 14, RF + 14, 0, 6), torso: 7, head: -4, spin: 360, la: [54, 148], ra: [28, 160] }, 120, 'out'),
    K({ ...F(14, HIP - 1, LF + 14, RF + 14), torso: 6, head: -3, spin: 360 }, 0, 'sine'),
  ] },
  // the lunge turns into a dive: both arms out, the feet leave the floor, he wraps him up (a grab) and
  // they go down; he ends on his hands and knees and takes a while to get up
  flyingTackle: { blend: 30, limb: 'rHand', shift: 40, height: 'throw', keys: [
    K({ ...F(6, HIP - 10, LF + 10, RF), torso: 40, bend: 6, head: -24, la: [80, 90], ra: [80, 90] }, 40, 'in'),
    K({ hx: 24, torso: 66, bend: 6, head: -30, ll: [20, -40], rl: [-50, -60], la: [100, 100], ra: [96, 96], air: 18 }, 40, 'out', 'active'),
    K({ hx: 30, torso: 70, bend: 6, head: -30, ll: [10, -50], rl: [-60, -70], la: [104, 110], ra: [100, 104], air: 14 }, 80, 'inOut'),
    K({ ...F(36, HIP - 30, LF + 36, RF + 10), torso: 70, bend: 6, head: -26, la: [80, 40], ra: [80, 40] }, 90, 'in', 'recover'),
    K({ ...F(38, HIP - 28, LF + 38, RF + 14), torso: 64, bend: 6, head: -20, la: [76, 36], ra: [76, 36] }, 220, 'sine'),
    K({ ...F(40, HIP - 6, LF + 40, RF + 30), torso: 20, bend: 4, head: -8, la: [44, 120], ra: [30, 120] }, 160, 'inOut', 'footstep'),
    K({ ...F(40, HIP - 1, LF + 40, RF + 40), torso: 7, head: -4, la: [54, 148], ra: [28, 160] }, 100, 'out'),
    K({ ...F(40, HIP - 1, LF + 40, RF + 40), torso: 6, head: -3 }, 0, 'sine'),
  ] },
  // the cross's weight carries the rear hip on through: both hands pull his head down and the rear knee
  // drives up into him off the toes
  crossKnee: { blend: 30, limb: 'rKnee', shift: 10, height: 'mid', keys: [
    K({ hx: 2, ll: L(2, 50, LF), rl: [40, -40], torso: 30, bend: 6, head: -12, tw: 10, la: [30, 150], ra: [80, 120] }, 40, 'linear'),
    K({ hx: 8, ll: L(8, 56, LF), rl: [100, -20], torso: 10, bend: -4, head: -6, la: [70, 150], ra: [60, 160], air: 10 }, 40, 'out', 'active'),
    K({ hx: 9, ll: L(9, 57, LF), rl: [104, -16], torso: 6, bend: -4, head: -4, la: [72, 152], ra: [62, 162], air: 12 }, 70, 'inOut'),
    K({ hx: 10, ll: L(10, 55, LF), rl: [60, -30], torso: 14, bend: 0, head: -4, la: [60, 140], ra: [50, 140], air: 4 }, 90, 'in', 'recover'),
    K({ ...F(10, HIP - 8, LF + 10, RF + 24), torso: 20, bend: 4, head: -6, la: [44, 120], ra: [30, 120] }, 170, 'sine', 'footstep'),
    K({ ...F(10, HIP - 1, LF + 10, RF + 10, 0, 6), torso: 7, head: -4, la: [54, 148], ra: [28, 160] }, 120, 'out'),
    K({ ...F(10, HIP - 1, LF + 10, RF + 10), torso: 6, head: -3 }, 0, 'sine'),
  ] },
  // out of the low kick's crouch he springs straight up behind a rear uppercut, both feet off the floor
  springUppercut: { blend: 30, limb: 'rHand', shift: 6, height: 'mid', keys: [
    K({ ...F(2, HIP - 14, LF, RF), torso: 20, bend: 6, head: 4, tw: -10, la: [40, 150], ra: [-10, 20] }, 40, 'in'),
    K({ hx: 14, ll: [20, 10], rl: [-20, -30], torso: 6, bend: 0, head: -16, tw: 14, la: [20, 120], ra: [98, 150], air: 22 }, 40, 'out', 'active'),
    K({ hx: 15, ll: [22, 8], rl: [-18, -32], torso: 0, bend: -2, head: -18, tw: 16, la: [20, 120], ra: [108, 162], air: 30 }, 80, 'inOut'),
    K({ hx: 7, ll: [30, -20], rl: [-10, -40], torso: 4, bend: 0, head: -8, la: [30, 130], ra: [110, 150], air: 14 }, 90, 'in', 'recover'),
    K({ ...F(6, HIP - 14, LF + 6, RF + 4), torso: 22, bend: 6, head: -8, la: [40, 120], ra: [40, 110] }, 90, 'out', 'land'),
    K({ ...F(6, HIP - 10, LF + 6, RF + 4), torso: 18, bend: 4, head: -6, la: [44, 130], ra: [36, 120] }, 170, 'sine'),
    K({ ...F(6, HIP - 1, LF + 6, RF + 6, 0, 6), torso: 7, head: -4, la: [54, 148], ra: [28, 160] }, 120, 'out', 'footstep'),
    K({ ...F(6, HIP - 1, LF + 6, RF + 6), torso: 6, head: -3 }, 0, 'sine'),
  ] },
};
const FRAMES = {
  // the flail (a botch, never pressed): two weak swings, the second only if the first connects or not
  flail: { limb: 'hand', damage: 3, kb: { x: 0, y: 0 }, hitstun: 14, blockstun: 4, hitstop: 3, hits: 2, rush: { damage: 2, hitstun: 12 }, cost: 0, botch: true, reach: 70, flashR: 22 },
  scissorKick: { limb: 'foot', damage: 15, kb: { x: 380, y: 300 }, hitstun: 0, blockstun: 10, hitstop: 9, knockdown: true, height: 'mid', cost: 26, reach: 95, flashR: 34, accident: true },
  supermanPunch: { limb: 'hand', damage: 16, kb: { x: 640, y: 180 }, hitstun: 0, blockstun: 12, hitstop: 9, knockdown: true, splat: true, height: 'high', cost: 26, reach: 110, flashR: 40, accident: true },
  pivotBackfist: { limb: 'hand', damage: 14, kb: { x: 520, y: 240 }, hitstun: 0, blockstun: 10, hitstop: 9, knockdown: true, height: 'high', travel: { vx: 300, at: 40, ms: 130 }, cost: 24, reach: 90, flashR: 38, accident: true },
  flashKick: { limb: 'foot', damage: 15, kb: { x: 80, y: 520 }, hitstun: 0, blockstun: 10, hitstop: 9, knockdown: true, juggle: true, lowInvuln: true, height: 'mid', cost: 28, reach: 70, flashR: 36, accident: true },
  helicopter: { limb: 'foot', damage: 14, kb: { x: 460, y: 300 }, hitstun: 0, blockstun: 10, hitstop: 9, knockdown: true, wallBounce: true, height: 'mid', cost: 26, reach: 95, flashR: 34, accident: true },
  flyingTackle: { limb: 'hand', damage: 14, kb: { x: 520, y: 260 }, hitstun: 0, blockstun: 0, hitstop: 6, knockdown: true, throw: true, grab: true, range: 150, hold: 12, splat: true, unblockable: true, cost: 24, reach: 120, flashR: 34, accident: true },
  crossKnee: { limb: 'foot', damage: 13, kb: { x: 120, y: 480 }, hitstun: 0, blockstun: 10, hitstop: 9, knockdown: true, juggle: true, lowInvuln: true, height: 'mid', travel: { vx: 360, at: 0, ms: 140 }, cost: 26, reach: 60, flashR: 32, accident: true },
  springUppercut: { limb: 'hand', damage: 15, kb: { x: 100, y: 540 }, hitstun: 0, blockstun: 10, hitstop: 9, knockdown: true, juggle: true, height: 'mid', travel: { vx: 320, at: 0, ms: 130 }, cost: 26, reach: 60, flashR: 36, accident: true },
};
let registered = false;
// Called once, after every character has registered (characters/index.js), so these land at the end of
// the move tables and nothing measured before them changes.
export function registerBotchMoves() {
  if (registered) return;
  registered = true;
  addMoves(CLIPS);
  addFrameData(FRAMES);
}
