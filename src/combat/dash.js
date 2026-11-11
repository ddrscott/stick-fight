// The dashes' clips and the shared moves that came with them (README, Controls and Fundamentals): a dash attack
// on every button (→→1 BULLET JAB, →→3 SKID KICK, →→4 RUNNING BOOT; →→2 is still COMET CROSS) and a while-rising
// attack on every limb (RISING JAB and RISING KICK beside the rising uppercut and knee), plus the one string
// they make: ↓1, release ↓, 3 (RISE AND SHINE).
//
// Registered after the characters and the botch moves (src/characters/index.js), so they land at the end of
// the move tables and nothing measured before them changes. Every character has them; a character's own
// `motion: 'ff'` or `motion: 'rise'` command on a button still wins (sim.js commandMove).

import { addMoves, RIG_KIT } from '../fighter/index.js';
import { addFrameData } from './frameData.js';
import { STRINGS } from './strings.js';

const { K, F, L, LF, RF, HIP, CH, crouchP } = RIG_KIT;

const CLIPS = {
  // →→: a low skim forward off the rear foot, the lead foot reaching, landing in the guard. The sim moves the
  // root (sim.js 'dash'); the feet are off the floor while it travels, so nothing skates.
  dashF: { blend: 30, keys: [
    K({ ...F(4, HIP - 6, LF + 6, RF - 4), torso: 20, bend: 4, head: -10, la: [40, 130], ra: [10, 120] }, 40, 'out'),
    K({ hx: 6, ll: [50, 10], rl: [-30, -60], torso: 24, bend: 4, head: -12, la: [30, 120], ra: [-10, 80], air: 5 }, 70, 'linear'),
    K({ ...F(2, HIP - 7, LF + 8, RF + 2, 0, 4), torso: 16, bend: 3, head: -8, la: [46, 140], ra: [20, 150] }, 50, 'out', 'footstep'),
    K({ ...F(0, HIP - 2, LF, RF), torso: 8, head: -5 }, 60, 'inOut'),
    K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4 }, 0, 'sine'),
  ] },
  // ←←: a hop back off the lead foot, the body upright and the legs trailing forward, then a deep absorb on
  // landing: the recovery the sim holds him in (no guard) is that absorb
  dashB: { blend: 30, keys: [
    K({ ...F(-4, HIP - 7, LF - 2, RF - 2), torso: -2, bend: -2, head: 2, la: [60, 160], ra: [40, 165] }, 30, 'out'),
    K({ hx: -6, ll: [40, 20], rl: [-10, -50], torso: -8, bend: -3, head: 6, la: [70, 150], ra: [50, 150], air: 8 }, 80, 'out'),
    K({ ...F(-2, HIP - 9, LF + 4, RF - 4), torso: 12, bend: 4, head: -4, la: [50, 150], ra: [30, 160] }, 60, 'out', 'footstep'),
    K({ ...F(0, HIP - 4, LF, RF), torso: 8, head: -4 }, 80, 'inOut'),
    K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4 }, 0, 'sine'),
  ] },
  // →→1: the lead fist goes out straight as the lead foot steps through the dash; the rear foot follows on
  // the recovery. High, so it sails over a croucher.
  bulletJab: { blend: 40, limb: 'lHand', shift: 14, adapt: 'none', height: 'high', keys: [
    K({ ...F(1, HIP - 2, LF, RF), torso: 9, bend: 1, head: -5, tw: 4, la: [46, 146], ra: [30, 165] }, 40, 'in'),
    K({ ...F(2, HIP - 3, LF, RF), torso: 12, bend: 2, head: -6, tw: 6, la: [40, 140], ra: [30, 165] }, 40, 'in'),
    K({ ...F(8, HIP - 4, LF + 10, RF, 6, 0), torso: 16, bend: 3, head: -6, tw: -2, la: [70, 104], ra: [32, 163] }, 40, 'linear'),
    K({ ...F(16, HIP - 5, LF + 14, RF), torso: 24, bend: 4, head: -8, tw: -14, la: [92, 92], ra: [36, 158] }, 40, 'out', 'active'),
    K({ ...F(17, HIP - 5, LF + 14, RF), torso: 25, bend: 4, head: -6, tw: -15, la: [93, 92], ra: [36, 158] }, 60, 'inOut'),
    K({ ...F(16, HIP - 4, LF + 14, RF), torso: 22, bend: 3, head: -6, tw: -12, la: [90, 76], ra: [36, 160] }, 100, 'in', 'recover'),
    K({ ...F(14, HIP, LF + 14, RF + 8, 0, 8), torso: 10, bend: 0, head: -8, tw: -4, la: [60, 130], ra: [32, 163] }, 100, 'out'),
    K({ ...F(14, HIP + 1, LF + 14, RF + 14), torso: 4, head: -6, tw: 2, la: [57, 148], ra: [28, 168] }, 80, 'out', 'footstep'),
    K({ ...F(14, HIP - 1, LF + 14, RF + 14), torso: 6, head: -4 }, 0, 'sine'),
  ] },
  // →→3: he sits back onto the rear leg and the lead foot skims out along the floor into the shin. Low, and
  // he is upright the whole way (it ducks nothing).
  skidKick: { blend: 40, limb: 'lFoot', shift: 10, adapt: 'none', height: 'low', keys: [
    K({ ...F(2, HIP - 4, LF, RF), torso: 10, bend: 2, head: -4, la: [40, 150], ra: [10, 120] }, 60, 'in'),
    K({ hx: 6, rl: L(6, HIP - 8, RF + 6), ll: [40, -30], torso: 2, bend: 0, head: 4, la: [30, 150], ra: [-10, 60] }, 60, 'linear'),
    K({ hx: 12, rl: L(12, HIP - 12, RF + 6), ll: [66, 20], torso: -8, bend: -2, head: 8, la: [20, 140], ra: [-30, 20] }, 40, 'linear'),
    K({ hx: 16, rl: L(16, HIP - 14, RF + 6), ll: [72, 80], torso: -16, bend: -4, head: 12, tw: -4, la: [10, 130], ra: [-40, 0] }, 40, 'out', 'active'),
    K({ hx: 16, rl: L(16, HIP - 14, RF + 6), ll: [73, 81], torso: -17, bend: -4, head: 12, tw: -4, la: [10, 130], ra: [-40, 0] }, 70, 'inOut'),
    K({ hx: 12, rl: L(12, HIP - 10, RF + 6), ll: [60, 10], torso: -8, head: 8, la: [24, 150], ra: [-10, 60] }, 100, 'inOut', 'recover'),
    K({ ...F(8, HIP - 4, LF + 10, RF + 6, 6, 0), torso: 2, head: 0, la: [40, 156], ra: [16, 150] }, 100, 'inOut'),
    K({ ...F(10, HIP, LF + 10, RF + 10, 0, 6), torso: 5, head: -4, la: [52, 152], ra: [28, 166] }, 80, 'out', 'footstep'),
    K({ ...F(10, HIP - 1, LF + 10, RF + 10), torso: 5, head: -3 }, 0, 'sine'),
  ] },
  // →→4: the rear knee comes up through the dash and the heel drives straight out at the belt, the torso
  // thrown back behind it; the foot plants ahead in a lunge and he has to walk the other one up. Slow out, slow back.
  runningBoot: { blend: 40, limb: 'rFoot', shift: 34, adapt: 'none', height: 'mid', keys: [
    K({ ...F(4, HIP - 3, LF + 4, RF), torso: 14, bend: 3, head: -6, la: [30, 130], ra: [50, 150] }, 60, 'in'),
    K({ hx: 8, ll: L(8, HIP - 1, LF + 6), rl: [60, -50], torso: 6, bend: 1, head: 0, la: [40, 150], ra: [20, 140] }, 60, 'linear'),
    K({ hx: 12, ll: L(12, HIP + 1, LF + 6), rl: [100, -10], torso: -6, bend: -2, head: 6, la: [50, 160], ra: [0, 110] }, 60, 'linear'),
    K({ hx: 20, ll: L(20, HIP + 2, LF + 6), rl: [92, 88], torso: -22, bend: -5, head: 12, tw: 6, la: [60, 150], ra: [-30, 40] }, 40, 'out', 'active'),
    K({ hx: 21, ll: L(21, HIP + 2, LF + 6), rl: [93, 90], torso: -23, bend: -5, head: 12, tw: 6, la: [60, 150], ra: [-30, 40] }, 80, 'inOut'),
    K({ hx: 18, ll: L(18, HIP, LF + 6), rl: [90, 10], torso: -12, bend: -2, head: 8, la: [50, 150], ra: [-10, 80] }, 110, 'inOut', 'recover'),
    K({ ...F(20, HIP - 8, LF + 6, 50), torso: 14, bend: 4, head: -6, la: [40, 120], ra: [24, 120] }, 110, 'out', 'footstep'),
    K({ ...F(22, HIP - 4, LF + 26, 50, 8, 0), torso: 10, bend: 2, head: -4, la: [46, 140], ra: [26, 150] }, 110, 'inOut'),
    K({ ...F(34, HIP - 1, LF + 34, RF + 34, 0, 6), torso: 6, head: -4, la: [54, 148], ra: [28, 166] }, 100, 'out', 'footstep'),
    K({ ...F(34, HIP - 1, LF + 34, RF + 34), torso: 6, head: -4 }, 0, 'sine'),
  ] },
  // release ↓, 1: the lead fist drives up and out of the crouch into the chest as the knees straighten. Mid.
  risingJab: { blend: 40, limb: 'lHand', height: 'mid', keys: [
    K({ ...crouchP, ...F(-1, CH + 2, LF + 2, RF - 2), torso: 16, la: [36, 150] }, 40, 'in'),
    K({ ...F(4, CH + 8, LF + 2, RF - 2), torso: 18, bend: 5, head: -8, tw: -6, la: [58, 100], ra: [28, 166] }, 40, 'linear'),
    K({ ...F(9, HIP - 4, LF + 2, RF - 2), torso: 20, bend: 4, head: -8, tw: -12, la: [80, 82], ra: [32, 164] }, 40, 'out', 'active'),
    K({ ...F(9, HIP - 3, LF + 2, RF - 2), torso: 20, bend: 4, head: -7, tw: -12, la: [81, 83], ra: [32, 164] }, 50, 'inOut'),
    K({ ...F(6, HIP - 2, LF + 2, RF - 2), torso: 14, bend: 2, head: -6, tw: -6, la: [70, 110], ra: [30, 165] }, 90, 'inOut', 'recover'),
    K({ ...F(2, HIP, LF, RF), torso: 7, head: -5, la: [56, 146], ra: [28, 166] }, 90, 'out'),
    K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4 }, 0, 'sine'),
  ] },
  // release ↓, 3: out of the crouch the lead knee chambers as he stands and the foot snaps out at the belt,
  // the torso leaning away from it; rechamber and plant. Mid.
  risingKick: { blend: 40, limb: 'lFoot', height: 'mid', keys: [
    K({ ...crouchP, hx: -3, rl: L(-3, CH + 2, RF - 2), ll: [50, -40], torso: 14, head: -6 }, 50, 'in'),
    K({ hx: 0, rl: L(0, HIP - 6, RF), ll: [98, -10], torso: 0, bend: 0, head: 4, tw: 2, la: [30, 160], ra: [22, 168] }, 40, 'linear'),
    K({ hx: 13, rl: L(13, HIP, RF), ll: [96, 92], torso: -18, bend: -4, head: 12, tw: -4, la: [20, 165], ra: [10, 170] }, 40, 'out', 'active'),
    K({ hx: 13.5, rl: L(13.5, HIP + 0.5, RF), ll: [98, 95], torso: -19, bend: -4, head: 12, tw: -4, la: [20, 165], ra: [10, 170] }, 60, 'inOut'),
    K({ hx: 8, rl: L(8, HIP, RF), ll: [98, 10], torso: -12, bend: -2, head: 8, la: [26, 162], ra: [16, 168] }, 80, 'inOut', 'recover'),
    K({ hx: 4, rl: L(4, HIP - 1, RF), ll: [60, -30], torso: -4, head: 2, la: [32, 160], ra: [22, 166] }, 80, 'inOut'),
    K({ ...F(1, HIP, LF, RF), torso: 4, head: -4, la: [52, 152], ra: [28, 166] }, 70, 'out', 'footstep'),
    K({ ...F(0, HIP - 1, LF, RF), torso: 5, head: -3 }, 0, 'sine'),
  ] },
};

// What each is for, and what it gives up (README has the measured frames):
//   bulletJab    the fast way in: live about as soon as a jab, with the dash's ground under it. High (a crouch
//                ducks it), and blocked he's stuck in a longer recovery than a jab's.
//   skidKick     the low off a dash, for a standing guard. No knockdown, and blocked low (down-back) it has no
//                blockstun at all: the whole recovery is open.
//   runningBoot  the mid off a dash: beats a crouch, knocks down and shoves him a long way. The slowest of the
//                four out and by far the slowest back, hit, blocked or whiffed.
//   risingJab    the quick one out of a crouch, a mid (the standing jab is a high). Small damage, minus on block.
//   risingKick   the lead kick out of the rise, the second hit of ↓1, release ↓, 3. More damage and a push; a
//                jab punishes it blocked.
const FRAMES = {
  bulletJab:   { limb: 'hand', damage: 7,  kb: { x: 320, y: 0 },   hitstun: 26, blockstun: 8,  hitstop: 5, height: 'high', travel: { vx: 520, at: 40, ms: 110 }, cost: 19, reach: 95, flashR: 36 },
  skidKick:    { limb: 'foot', damage: 8,  kb: { x: 0, y: 0 },     hitstun: 24, blockstun: 0,  hitstop: 5, height: 'low',  travel: { vx: 460, at: 50, ms: 150 }, cost: 20, reach: 85, flashR: 24 },
  runningBoot: { limb: 'foot', damage: 13, kb: { x: 620, y: 200 }, hitstun: 0,  blockstun: 14, hitstop: 8, knockdown: true, height: 'mid', travel: { vx: 480, at: 40, ms: 170 }, cost: 24, reach: 100, flashR: 32 },
  risingJab:   { limb: 'hand', damage: 7,  kb: { x: 0, y: 0 },     hitstun: 22, blockstun: 8,  hitstop: 5, height: 'mid', cost: 17, reach: 80, flashR: 30 },
  risingKick:  { limb: 'foot', damage: 11, kb: { x: 260, y: 0 },   hitstun: 28, blockstun: 10, hitstop: 6, height: 'mid', cost: 22, reach: 85, flashR: 30 },
};

// ↓1, release ↓, 3: the crouch jab into the rising kick. 'r3' is button 3 pressed while rising (strings.js).
export const RISE_STRING = { name: 'RISE AND SHINE', keys: ['d1', 'r3'], moves: ['lowJab', 'risingKick'] };

let registered = false;
/** @param {any[]} chars every registered character: each gets the string, opened by its own ↓1 when it has one */
export function registerDashMoves(chars = []) {
  if (registered) return;
  registered = true;
  addMoves(CLIPS);
  addFrameData(FRAMES);
  STRINGS.push(RISE_STRING);
  for (const c of chars) {
    if (c.strings.some((s) => s.name === RISE_STRING.name)) continue;
    // a character whose ↓1 is its own move (INTERN's Paper Cut) opens the string with that move, so its other ↓1 strings still agree
    const d1 = c.commands.find((k) => k.button === '1' && k.motion === 'd');
    const clash = c.strings.find((s) => s.keys[0] === 'd1' && s.keys[1] === '3');   // a string of its own already on ↓1, 3
    if (clash) continue;
    c.strings.push(d1 ? { ...RISE_STRING, moves: [d1.move, 'risingKick'] } : RISE_STRING);
  }
}
