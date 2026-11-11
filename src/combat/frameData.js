// Frame data per attack. Startup / active / recovery come from the fighter rig's own
// 'active' and 'recover' events, so they follow whatever piece A animates. Everything
// here is what the sim adds on top. Durations are in 60fps frames (the language of
// frame data); f60() converts them to 120Hz sim steps.
//
//   limb       which joints carry the hitbox: 'hand' or 'foot' (the most forward one)
//   damage     out of 100 health
//   kb         knockback velocity px/s: x away from the attacker, y upward
//   hitstun    frames the victim is locked after a standing hit
//   blockstun  frames the victim is locked after blocking it
//   hitstop    frames BOTH fighters freeze on contact (half that on block)
//   knockdown  victim goes to the floor instead of hitstun
//   low        goes under a standing block
//   cancels    moves this can cancel into once it has connected
//   reach      AI's starting guess for horizontal reach; the sim measures the real one

export const FRAME_DATA = {
  // kb.x on a standing hit is a stumble: it decays at 0.95/step, so the victim slides
  // kb.x/6 px in total (jab ~70px, cross ~100px: at least one body width per hit).
  // flashR is the FX burst radius passed to fx.hit; kicks get a small one so the
  // defender stays readable at contact.
  jab:        { limb: 'hand', damage: 6,  kb: { x: 360, y: 0 },   hitstun: 26, blockstun: 8,  hitstop: 5,  knockdown: false, low: false, cancels: ['cross', 'jab', 'sweep'],        reach: 80,  flashR: 36 },
  cross:      { limb: 'hand', damage: 10, kb: { x: 300, y: 0 },   hitstun: 30, blockstun: 12, hitstop: 7,  knockdown: false, low: false, cancels: ['roundhouse', 'sweep'], reach: 100, flashR: 40 },
  roundhouse: { limb: 'foot', damage: 16, kb: { x: 480, y: 280 }, hitstun: 0,  blockstun: 16, hitstop: 8,  knockdown: true,  low: false, cancels: [],                       reach: 85,  flashR: 26 },
  sweep:      { limb: 'foot', damage: 9,  kb: { x: 260, y: 190 }, hitstun: 0,  blockstun: 0,  hitstop: 7,  knockdown: true,  low: true,  cancels: [],                       reach: 85,  flashR: 26 },
};

// throw: point-blank grab on the cross clip, can't be blocked, knocks down. The guard's
// second answer next to the sweep (a standing block stops everything else).
// the rest of the four-limb table (fighter round 12): one strike per limb plus direction variants
Object.assign(FRAME_DATA, {
  lkick:      { limb: 'foot', damage: 7,  kb: { x: 0, y: 0 },     hitstun: 24, blockstun: 10, hitstop: 5, knockdown: false, low: false, cancels: [], reach: 80, flashR: 28 },
  lowKick:    { limb: 'foot', damage: 6,  kb: { x: 0, y: 0 },     hitstun: 22, blockstun: 0,  hitstop: 5, knockdown: false, low: true,  cancels: [], reach: 75, flashR: 24 },
  lungeCross: { limb: 'hand', damage: 11, kb: { x: 0, y: 0 },     hitstun: 28, blockstun: 12, hitstop: 7, knockdown: false, low: false, cancels: [], reach: 120, flashR: 40 },
  spinKick:   { limb: 'foot', damage: 15, kb: { x: 420, y: 260 }, hitstun: 0,  blockstun: 16, hitstop: 8, knockdown: true,  low: false, cancels: [], reach: 80, flashR: 26 },
  uppercut:   { limb: 'hand', damage: 9,  kb: { x: 120, y: 420 }, hitstun: 0,  blockstun: 12, hitstop: 7, knockdown: true,  low: false, juggle: true, cancels: [], reach: 50, flashR: 34 },
});
FRAME_DATA.throw = { limb: 'hand', damage: 8, kb: { x: 300, y: 240 }, hitstun: 0, blockstun: 0, hitstop: 6, knockdown: true, low: false, unblockable: true, range: 100, anim: 'cross', cancels: [], reach: 60, flashR: 30 };
FRAME_DATA.throw.throw = true;
FRAME_DATA.throw.anims = ['throw', 'wallSlam', 'cross'];
// v2: crouch attacks, rising attacks, forward attacks and the string enders. `anims` lists the
// rig clips to try in order; createCombat resolves `anim` to the first one the rig has, so the
// game keeps working while the rig builder adds the new clips. `tc` keeps the body low through
// the move (it ducks highs). Enders are the last hit of a string (strings.js) and pay off with
// `payoff`: knockdown, launch (a juggle), splat (wall splat if the body reaches a wall),
// groundBounce (a downward hit on an airborne body) .
Object.assign(FRAME_DATA, {
  lowJab:         { limb: 'hand', damage: 5,  kb: { x: 0, y: 0 },     hitstun: 20, blockstun: 6,  hitstop: 4, knockdown: false, tc: true, cancels: [], reach: 75, flashR: 24, anims: ['lowJab', 'jab'] },
  bodyBlow:       { limb: 'hand', damage: 9,  kb: { x: 0, y: 0 },     hitstun: 26, blockstun: 10, hitstop: 6, knockdown: false, cancels: [], reach: 80, flashR: 32, anims: ['bodyBlow', 'jab'] },
  risingUppercut: { limb: 'hand', damage: 11, kb: { x: 110, y: 460 }, hitstun: 0,  blockstun: 14, hitstop: 7, knockdown: true, juggle: true, cancels: [], reach: 55, flashR: 34, anims: ['risingUppercut', 'uppercut'] },
  risingKnee:     { limb: 'foot', damage: 12, kb: { x: 100, y: 460 }, hitstun: 0,  blockstun: 14, hitstop: 7, knockdown: true, juggle: true, cancels: [], reach: 60, flashR: 30, anims: ['risingKnee', 'lkick'] },
  overhead:       { limb: 'foot', damage: 13, kb: { x: 0, y: 0 },     hitstun: 32, blockstun: 14, hitstop: 8, knockdown: false, cancels: [], reach: 85, flashR: 30, anims: ['overhead', 'roundhouse'] },
  uptown:         { limb: 'foot', damage: 10, kb: { x: 0, y: 0 },     hitstun: 30, blockstun: 12, hitstop: 7, knockdown: false, cancels: [], reach: 80, flashR: 30, anims: ['lkick'], callout: 'UPTOWN' },
  flashRoundhouse:{ limb: 'foot', damage: 18, kb: { x: 500, y: 300 }, hitstun: 0,  blockstun: 16, hitstop: 9, knockdown: true, ender: true, cancels: [], reach: 85, flashR: 34, anims: ['roundhouse'] },
  neonTornado:    { limb: 'foot', damage: 14, kb: { x: 140, y: 470 }, hitstun: 0,  blockstun: 16, hitstop: 9, knockdown: true, juggle: true, ender: true, cancels: [], reach: 80, flashR: 36, anims: ['neonTornado', 'spinKick'] },
  spinHeel:       { limb: 'foot', damage: 15, kb: { x: 720, y: 180 }, hitstun: 0,  blockstun: 16, hitstop: 9, knockdown: true, splat: true, ender: true, cancels: [], reach: 80, flashR: 34, anims: ['spinHeel', 'spinKick'] },
  crescent:       { limb: 'foot', damage: 16, kb: { x: 440, y: 320 }, hitstun: 0,  blockstun: 16, hitstop: 9, knockdown: true, ender: true, cancels: [], reach: 85, flashR: 34, anims: ['crescent', 'roundhouse'] },
  rushKnee:       { limb: 'foot', damage: 14, kb: { x: 400, y: 340 }, hitstun: 0,  blockstun: 14, hitstop: 8, knockdown: true, ender: true, cancels: [], reach: 70, flashR: 32, anims: ['risingKnee', 'lkick'] },
  skySpike:       { limb: 'foot', damage: 12, kb: { x: 120, y: 300 }, hitstun: 0,  blockstun: 14, hitstop: 9, knockdown: true, groundBounce: true, ender: true, cancels: [], reach: 85, flashR: 36, anims: ['overhead', 'roundhouse'] },
  cometCross:     { limb: 'hand', damage: 16, kb: { x: 760, y: 160 }, hitstun: 0,  blockstun: 16, hitstop: 9, knockdown: true, splat: true, ender: true, special: true, cancels: [], reach: 120, flashR: 40, anims: ['cometCross', 'lungeCross'] },
});
// v3b: air attacks, one per jump. Overheads: mid, so a croucher can't duck or low-guard them but a
// standing guard holds. A hit leaves the defender stumbling long enough for a ground string on landing.
Object.assign(FRAME_DATA, {
  jumpJab:       { limb: 'hand', damage: 6,  kb: { x: 0, y: 0 },     hitstun: 34, blockstun: 10, hitstop: 5, knockdown: false, air: true, cancels: [], reach: 80, flashR: 30, anims: ['jumpJab', 'jab'] },
  jumpCross:     { limb: 'hand', damage: 9,  kb: { x: 0, y: 0 },     hitstun: 38, blockstun: 12, hitstop: 6, knockdown: false, air: true, cancels: [], reach: 95, flashR: 34, anims: ['jumpCross', 'cross'] },
  flyingKick:    { limb: 'foot', damage: 10, kb: { x: 0, y: 0 },     hitstun: 38, blockstun: 12, hitstop: 7, knockdown: false, air: true, cancels: [], reach: 110, flashR: 32, anims: ['flyingKick', 'lkick'] },
  airRoundhouse: { limb: 'foot', damage: 13, kb: { x: 420, y: 240 }, hitstun: 0,  blockstun: 14, hitstop: 8, knockdown: true,  air: true, cancels: [], reach: 95, flashR: 34, anims: ['airRoundhouse', 'roundhouse'] },
  diveKick:      { limb: 'foot', damage: 11, kb: { x: 0, y: 0 },     hitstun: 36, blockstun: 12, hitstop: 7, knockdown: false, air: true, dive: true, cancels: [], reach: 90, flashR: 32, anims: ['diveKick', 'overhead', 'roundhouse'] },
});
// Wake-up strikes, from the floor (shared by every character; sim.js 'down'). `wake`: started only from
// lying down, invulnerable until the strike is live, lying until the clip's 'stand' key (a hit there puts
// him back down), and a press in the middle of one is lost rather than botched (there's no body to botch).
// Both knock down on hit and are badly minus on block: the stand-up is the punish.
Object.assign(FRAME_DATA, {
  wakeKick:  { limb: 'foot', damage: 8, kb: { x: 320, y: 220 }, hitstun: 0, blockstun: 10, hitstop: 7, knockdown: true, wake: true, cancels: [], reach: 100, flashR: 28 },
  wakeSweep: { limb: 'foot', damage: 7, kb: { x: 220, y: 170 }, hitstun: 0, blockstun: 6,  hitstop: 6, knockdown: true, wake: true, cancels: [], reach: 110, flashR: 26 },
});
// The stomp (down + 3 or 4 with the opponent on the floor near you): a ground hit for real damage (`otg`:
// it lands on a floored body, once per knockdown like every ground hit), a step in behind it (`travel`) so
// it reaches a body you're standing at the feet of, and no cancel: on hit the body is pinned under the heel
// for `pin` frames, about until the stomper can guard again, and on a whiff (a roll, a wake-up strike rising
// through it, a body already standing) the long recovery is a free punish.
FRAME_DATA.stomp = { limb: 'foot', damage: 9, kb: { x: 0, y: 0 }, hitstun: 18, blockstun: 6, hitstop: 6, knockdown: false, otg: true, pin: 22,
  travel: { vx: 260, at: 90, ms: 110 }, cancels: [], reach: 95, flashR: 26 };
FRAME_DATA.wallSlam = { ...FRAME_DATA.throw, damage: 14, kb: { x: 760, y: 160 }, splat: true, anims: ['wallSlam', 'cross'], anim: undefined };
FRAME_DATA.uppercut.kb = { x: 90, y: 420 };   // a launcher: the body flies at jab height on the rig's point simulation

// heights (Tekken): high is ducked by a croucher, low beats standing guard, mid beats crouch
const HEIGHT = { jab: 'high', cross: 'high', roundhouse: 'high', flashRoundhouse: 'high', spinKick: 'high', spinHeel: 'high', crescent: 'mid',
  sweep: 'low', lowKick: 'low', lowJab: 'low', throw: 'throw', wallSlam: 'throw', wakeSweep: 'low', stomp: 'low' };
for (const [m, fd] of Object.entries(FRAME_DATA)) { fd.height = HEIGHT[m] || 'mid'; fd.low = fd.height === 'low'; }
for (const m of ['sweep', 'lowKick']) FRAME_DATA[m].tc = true;

// Stamina costs. A fighter has 100 and faints at 0 (sim.js), so the costs are the attack budget:
// plain jabs faint you on the 6th press, crosses and kicks on the 5th, and a full four-hit string
// with its ender (1,1,2,4 is 85, 1,2,3,4 is 90, Sky Spike 92) fits from full but leaves you low.
const COST = { wakeKick: 12, wakeSweep: 12, stomp: 18, jab: 17, lowJab: 15, cross: 21, bodyBlow: 19, lungeCross: 22, lowKick: 18, uppercut: 24, risingUppercut: 24, risingKnee: 24, throw: 22, wallSlam: 22 };
const AIR_COST = { jumpJab: 12, jumpCross: 15, flyingKick: 16, airRoundhouse: 18, diveKick: 16 };
Object.assign(COST, AIR_COST);
for (const [m, fd] of Object.entries(FRAME_DATA)) fd.cost = fd.ender ? 30 : COST[m] != null ? COST[m] : fd.limb === 'foot' ? 22 : 19;
// callout names for enders reached outside a string (the string's own name wins when there is one)
for (const [m, name] of Object.entries({ flashRoundhouse: 'FLASH ROUNDHOUSE', neonTornado: 'NEON TORNADO', spinHeel: 'SPIN HEEL', crescent: 'CRESCENT',
  rushKnee: 'GROUND RUSH', skySpike: 'SKY SPIKE', cometCross: 'COMET CROSS', wallSlam: 'WALL SLAM' })) FRAME_DATA[m].callout = name;
// regen per second once `delay` has passed since the last spend (none while attacking or running);
// regenBlock while guarding, from the first frame. Blocking a hit costs blockCost of its price and
// never faints you. At 0 the fighter faints for faintTime seconds (no attacks, no guard, rooted in
// place), wakes with faintRecover, and wakes early from a knockdown or after taking faintDmgCap damage.
// Shaking it off: a fresh left or right press opposite to the last one counted, at least shakeGap s after
// it, takes shakeCut s off the faint; the cuts never bring a faint under faintMin s in all.
// refundHit / refundBlock: the share of a strike's price it gives back when it connects (hit / blocked; a whiff,
// a parried strike and a botch give nothing back; the same move refunded again within refundRepeat s gives half as
// much each time). A strike that empties the bar and then hits leaves 1, no faint.
export const STAMINA = { max: 100, regen: 90, regenBlock: 36, delay: 0.3, run: 14, jump: 8, blockCost: 1 / 3,
  faintTime: 1.5, faintRecover: 30, faintDmgCap: 20, shakeGap: 0.1, shakeCut: 0.1, faintMin: 0.7, refundHit: 0.5, refundBlock: 0.25, refundRepeat: 1.5, saveShare: 0.5 };
// Combo decay, by the hit's place in the combo (1st, 2nd, ...; the last entry repeats). Hitstun
// shrinks from the 3rd hit so a repeated loop drops and the defender can act; damage from the 4th,
// and past COMBO_SOFTCAP damage in one combo the rest counts COMBO_OVERCAP as much.
// Air recovery (sim.js airRecover): a button once `min` steps (120Hz) have passed since the last hit flips a
// juggled or launched body upright; inside the first `perfect` steps of that it comes with a jab; a press before
// `min` locks it out for `lock` steps (a press while locked keeps it locked). The juggle's next hit restarts the wait.
export const AIR_TECH = { min: 36, perfect: 10, lock: 24 };
// The perfect round finisher's clock after the throw's release, in seconds (sim.js perfectStep fires an event at
// each mark, src/fx/perfect.js draws to the same marks): the body flies at the lens until fly, hits the glass and
// sticks until slide, squeaks down it until drop, and peels off out of the bottom of the screen until after.
export const PERFECT = { fly: 0.42, slide: 0.7, drop: 1.75, after: 2.15 };
// The universal parry (sim.js uParry): a fresh tap toward the opponent (down-forward for a low) within `win`
// steps (120Hz) before a strike lands catches it: no damage, the striker reels `stun` frames. A tap starts a
// `lock` of steps in which another tap doesn't count (and keeps it locked), so mashing forward never parries, and
// a tap within `quiet` steps of a button press doesn't count either, so mashing buttons never parries.
export const PARRY = { win: 12, lock: 40, stun: 16, quiet: 24 };
// The clash (sim.js clashTest): two live strikes whose striking limbs touch stop each other. No damage and no stun:
// both freeze `hitstop` frames at the contact, bounce back (`push` px/s, dying out over the stun) and are free on
// the same step, `stun` frames later. Both keep what the swing cost. `slack` px on top of the two drawn limbs counts
// as touching; tips that ran past each other are backed out to meet, each body giving up to `seat` px. A strike whose weight (frame data `weight`, else its damage) is `breakBy` or more above the other's
// breaks through instead: it carries on and lands as usual, and the lighter strike is batted aside (it ends, he
// reels `batStun` frames, it's no counter hit). With breakBy 8 a jab (6) clashes with a jab, a cross (10), a light
// kick (7) or a lunge cross (11), a cross with a roundhouse (16), and a roundhouse or any ender (14 to 18) breaks
// through a jab. Never a clash: a throw or grab, a counter stance, a stance, a noHit move, an armored move (its
// armor absorbs, as ever), an invulnerable one, a wake-up strike, a botch's flail, a strike in the air.
export const CLASH = { breakBy: 8, hitstop: 4, stun: 14, push: 320, slack: 2, batStun: 10, seat: 24 };
// Dashes (sim.js startDash, README Controls and Fundamentals). A double tap is two fresh presses of one direction
// within `tap` steps (120Hz); a third press inside `tap` of the last is a mash, and it and every press after it
// count for nothing until the stick has rested `tap` steps. A double tap within `quiet` steps of a button press
// doesn't count either. fwd / back: `steps` of burst at `speed` px/s (x the character's dash stat), then `rec`
// steps of braking (`brake` a step) in which he can't guard, jump, crouch or walk; `cost` stamina, and a dash needs
// more than its cost in the bar (it never faints). A forward dash can be cut by a strike at any point (the dash
// attacks, for `attack` steps after it too) and, with forward still held when the burst ends, becomes the run.
// A back dash can't be cut by anything, and nothing guards during it.
export const DASH = { tap: 30, quiet: 24, attack: 14, brake: 0.8,
  fwd: { steps: 14, speed: 660, rec: 10, cost: 6 }, back: { steps: 12, speed: 420, rec: 14, cost: 8 } };
export const COMBO_STUN = [1, 1, 0.85, 0.65, 0.45, 0.3];
export const COMBO_DMG = [1, 1, 1, 0.8, 0.65, 0.5];
export const COMBO_SOFTCAP = 30, COMBO_OVERCAP = 0.25;
export const comboScale = (table, n) => table[Math.max(0, Math.min(table.length - 1, n - 1))];

export const ATTACKS = Object.keys(FRAME_DATA);

// ---- characters (src/characters/) ---------------------------------------------------------------
// addFrameData({ name: entry }) merges a character's own moves into the table, filling what the
// entry leaves out the way the shared moves are filled: height ('high' | 'mid' | 'low' | 'overhead' |
// 'throw'; an overhead is a mid that's flagged as one), low, cost (an ender 30, a kick 22, else 19),
// cancels, kb, reach, flashR. `owner` (the character id) keeps it to that character. The generic hooks
// a character move can carry (sim.js reads them):
//   travel: { vx, at, ms }       the body slides vx px/s (x the character's dash stat) from `at` ms in, for `ms`
//   armor: { hits, dmg }         absorbs that many hits from the press until recovery, taking dmg x damage
//   parry: { heights, reversal, stun, callout }   a counter stance: a strike of one of those heights that
//                                lands in startup or active is caught, the striker reels for `stun` frames
//                                and the stance turns into the `reversal` move
//   grab: true + throw: true     a command grab: range px at the press, hold frames, noBreak (can't be broken)
//   hits: n                      a multi-hit: each 'active' key in the clip may connect again, up to n
//   lowInvuln: true              lows pass under it (a hop, a flying knee) from the press until recovery
//   wallBounce: true             near a wall the body bounces off it into a juggle (like Wall Spin)
//   groundBounce, splat, juggle, ender, callout, tc   as on the shared moves
export function addFrameData(entries, owner = null) {
  for (const [m, e] of Object.entries(entries)) {
    const fd = { limb: 'hand', damage: 8, kb: { x: 0, y: 0 }, hitstun: 24, blockstun: 10, hitstop: 6, knockdown: false, cancels: [], reach: 80, flashR: 30, ...e };
    if (fd.height === 'overhead') { fd.overhead = true; fd.height = 'mid'; }
    fd.height = fd.height || (fd.throw ? 'throw' : 'mid');
    fd.low = fd.height === 'low';
    if (fd.cost == null) fd.cost = fd.ender ? 30 : fd.limb === 'foot' ? 22 : 19;
    if (owner && !fd.owner) fd.owner = owner;
    if (fd.ender && !fd.callout) fd.callout = m.replace(/([A-Z])/g, ' $1').toUpperCase();
    FRAME_DATA[m] = fd;
    if (!ATTACKS.includes(m)) ATTACKS.push(m);
  }
}
export const STEP_HZ = 120;
export const DT = 1 / STEP_HZ;
export const f60 = (frames) => Math.round(frames * STEP_HZ / 60);
