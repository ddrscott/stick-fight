// HELPDESK: defense and counters. A standard-sized body, a little less damage per hit and a lot more
// stamina regen, so he can sit on his guard and still have a bar to answer with. Two unique moves:
// Ticket Closed (b+1, a counter stance: a high or mid strike that lands in it is caught and answered
// with a stepping elbow; lows and throws beat it, and a whiffed stance is a long, open recovery) and
// Reboot (b+2, a two-handed palm push that carries him across the floor into the wall, splatting him
// there when it's close). One unique string, CTRL ALT DEL (1, 3, 2), ending in a rising double palm
// that launches. Keeps every shared string.
import { RIG_KIT } from '../fighter/index.js';
import { stoop, lift } from './perfectKit.js';
import { FRAME_DATA } from '../combat/frameData.js';

const { K, F, LF, RF, HIP } = RIG_KIT;

// b+1: settle the weight back, the lead hand comes out open at chest height to take the strike and
// the rear hand covers the chin. The stance holds (the catch window is startup + active), then the
// hands drop and he has to rebuild his guard: a whiff is a long recovery.
const ticketClosed = { blend: 40, limb: 'lHand', keys: [
  K({ ...F(-2, HIP - 3, LF, RF), torso: 3, bend: -1, head: -3, tw: 4, la: [74, 136], ra: [30, 120] }, 50, 'in'),
  K({ ...F(-6, HIP - 6, LF, RF), torso: -3, bend: -3, head: -1, tw: 10, la: [98, 124], ra: [16, 96] }, 40, 'out', 'active'),
  K({ ...F(-7, HIP - 7, LF, RF), torso: -4, bend: -3, head: 0, tw: 11, la: [100, 126], ra: [18, 98] }, 150, 'sine'),
  K({ ...F(-5, HIP - 6, LF, RF), torso: -2, bend: -2, head: -1, tw: 9, la: [94, 120], ra: [18, 96] }, 60, 'inOut', 'recover'),
  K({ ...F(-2, HIP - 3, LF, RF), torso: 9, bend: 2, head: -6, tw: 0, la: [34, 70], ra: [18, 80] }, 200, 'inOut'),
  K({ ...F(-1, HIP - 2, LF, RF), torso: 7, bend: 1, head: -5, la: [44, 120], ra: [26, 140] }, 130, 'out'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4 }, 0, 'sine'),
] };

// the reversal: the lead hand traps his arm down and away while the rear elbow drives through his
// chest behind a short step, the shoulders turning into it
const ticketReversal = { blend: 30, limb: 'rElbow', shift: 10, keys: [
  K({ ...F(-3, HIP - 5, LF, RF), torso: 2, bend: -1, head: -2, tw: -12, la: [40, 30], ra: [-24, 120] }, 40, 'in'),
  K({ ...F(5, HIP - 8, LF + 8, RF, 6, 0), torso: 14, bend: 3, head: -6, tw: 2, la: [16, 10], ra: [50, -100] }, 40, 'linear'),
  K({ ...F(12, HIP - 9, LF + 10, RF), torso: 26, bend: 6, head: -10, tw: 16, la: [4, 20], ra: [94, -160] }, 40, 'out', 'active'),
  K({ ...F(13, HIP - 9, LF + 10, RF), torso: 27, bend: 6, head: -10, tw: 17, la: [2, 22], ra: [96, -162] }, 70, 'inOut'),
  K({ ...F(10, HIP - 5, LF + 10, RF), torso: 14, bend: 3, head: -6, tw: 8, la: [30, 110], ra: [60, 50] }, 90, 'inOut', 'recover'),
  K({ ...F(9, HIP - 2, LF + 10, RF + 10, 0, 8), torso: 7, head: -4, la: [54, 148], ra: [30, 162] }, 100, 'inOut', 'footstep'),
  K({ ...F(10, HIP - 1, LF + 10, RF + 10), torso: 6, head: -4 }, 0, 'sine'),
] };

// b+2: both palms pull back to the ribs, the lead foot steps long, and both arms shoot straight out
// at chest height, heels of the hands first. He follows the body across the floor.
const reboot = { blend: 40, limb: 'lHand', shift: 30, keys: [
  K({ ...F(-4, HIP - 4, LF, RF), torso: 0, bend: -2, head: 2, tw: -4, la: [-12, 100], ra: [-22, 96] }, 80, 'in'),
  K({ ...F(6, HIP - 8, LF + 18, RF, 8, 0), torso: 10, bend: 2, head: -2, tw: -2, la: [34, 90], ra: [24, 86] }, 60, 'linear'),
  K({ ...F(18, HIP - 9, LF + 30, RF), torso: 22, bend: 4, head: -6, tw: 4, la: [88, 82], ra: [84, 78] }, 40, 'out', 'active'),
  K({ ...F(20, HIP - 9, LF + 30, RF + 4), torso: 24, bend: 4, head: -6, tw: 4, la: [90, 84], ra: [86, 80] }, 90, 'inOut'),
  K({ ...F(18, HIP - 5, LF + 30, RF + 8), torso: 12, bend: 2, head: -5, la: [50, 116], ra: [40, 118] }, 110, 'inOut', 'recover'),
  K({ ...F(26, HIP - 2, LF + 30, RF + 30, 0, 8), torso: 7, head: -4, la: [54, 148], ra: [30, 162] }, 110, 'inOut', 'footstep'),
  K({ ...F(30, HIP - 1, LF + 30, RF + 30), torso: 6, head: -4 }, 0, 'sine'),
] };

// CTRL ALT DEL's ender: sink with both palms low, then drive up through his chin with both hands,
// the body rising onto the toes behind them. Launches.
const ctrlAltDel = { blend: 40, limb: 'rHand', shift: 10, keys: [
  K({ ...F(0, HIP - 10, LF, RF), torso: 18, bend: 6, head: 4, tw: -4, la: [14, 40], ra: [4, 30] }, 60, 'in'),
  K({ ...F(4, HIP - 8, LF + 8, RF, 6, 0), torso: 12, bend: 4, head: 0, la: [50, 96], ra: [40, 92] }, 40, 'linear'),
  K({ ...F(10, HIP + 1, LF + 10, RF, 0, 4), torso: 0, bend: -2, head: -10, la: [102, 128], ra: [96, 124] }, 40, 'out', 'active'),
  K({ ...F(10, HIP + 2, LF + 10, RF, 0, 6), torso: -4, bend: -3, head: -12, la: [114, 142], ra: [108, 138] }, 70, 'inOut'),
  K({ ...F(9, HIP, LF + 10, RF), torso: 2, bend: -1, head: -6, la: [84, 134], ra: [76, 128] }, 90, 'inOut', 'recover'),
  K({ ...F(9, HIP - 2, LF + 10, RF + 10, 0, 8), torso: 7, head: -4, la: [54, 148], ra: [30, 162] }, 100, 'inOut', 'footstep'),
  K({ ...F(10, HIP - 1, LF + 10, RF + 10), torso: 6, head: -4 }, 0, 'sine'),
] };

// a call-center headset: the band over the crown, an ear cup on the near side, and the mic boom
// reaching round to the mouth with a lit tip
function headset(ctx, J, o) {
  const h = J.head, n = J.neck, r = o.headR, s = o.scale;
  let ux = h.x - n.x, uy = h.y - n.y; const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
  const fx = -uy * o.facing, fy = ux * o.facing;
  const a = Math.atan2(uy, ux);
  ctx.lineCap = 'round';
  ctx.strokeStyle = o.accent; ctx.lineWidth = 2.6 * s;
  ctx.beginPath(); ctx.arc(h.x, h.y, r * 1.14, a - 1.25, a + 1.25); ctx.stroke();
  // the ear cup, a touch behind the middle of the head
  const ex = h.x - fx * r * 0.12 - ux * r * 0.05, ey = h.y - fy * r * 0.12 - uy * r * 0.05;
  ctx.fillStyle = '#0a0414'; ctx.beginPath(); ctx.arc(ex, ey, r * 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = o.accent; ctx.beginPath(); ctx.arc(ex, ey, r * 0.38, 0, Math.PI * 2); ctx.fill();
  // the boom, curving forward and down to the mouth
  const mx = h.x + fx * r * 0.95 - ux * r * 0.55, my = h.y + fy * r * 0.95 - uy * r * 0.55;
  ctx.lineWidth = 1.8 * s;
  ctx.beginPath(); ctx.moveTo(ex, ey);
  ctx.quadraticCurveTo(h.x + fx * r * 0.45 - ux * r * 0.95, h.y + fy * r * 0.45 - uy * r * 0.95, mx, my); ctx.stroke();
  ctx.fillStyle = o.color; ctx.beginPath(); ctx.arc(mx, my, 2.3 * s, 0, Math.PI * 2); ctx.fill();
}

// The celebration (registry `dance`, played by the match winner under the WINS banner): The robot: stiff right angles at the elbows, the head ticking side to side, a reboot slump and back.
const dance = { keys: [
  K({ ...F(0, HIP, LF, RF), torso: 0, head: 0, la: [90, 180], ra: [0, 90] }, 180, 'snap'),
  K({ ...F(0, HIP, LF, RF), torso: 0, head: 0, la: [90, 180], ra: [0, 90] }, 120, 'linear'),
  K({ ...F(0, HIP, LF, RF), torso: 0, head: 10, la: [0, 90], ra: [90, 180] }, 180, 'snap'),
  K({ ...F(0, HIP, LF, RF), torso: 0, head: 10, la: [0, 90], ra: [90, 180] }, 120, 'linear'),
  K({ ...F(0, HIP - 4, LF, RF), torso: 0, head: -10, la: [90, 90], ra: [90, 90] }, 180, 'snap'),
  K({ ...F(0, HIP - 4, LF, RF), torso: 0, head: -10, la: [90, 90], ra: [90, 90] }, 120, 'linear'),
  K({ ...F(0, HIP - 12, LF, RF), torso: 24, bend: 10, head: 30, la: [10, 4], ra: [6, 0] }, 300, 'in'),
  K({ ...F(0, HIP - 12, LF, RF), torso: 24, bend: 10, head: 30, la: [10, 4], ra: [6, 0] }, 260, 'linear'),
  K({ ...F(0, HIP, LF, RF), torso: 0, head: 0, la: [90, 180], ra: [0, 90] }, 0, 'snap'),
] };

// The perfect round finisher (registry `perfect`, README Perfect rounds): have you tried turning them off and on: he spins once with the body held out by the collar and lets go on the way round; on the glass it blinks off and back on; then a calm thumbs-up.
const perfect = { name: 'OFF AND ON AGAIN', note: 'Have you tried turning them off and on: he spins once with the body held out by the collar and lets go on the way round; on the glass it blinks off and back on; then a calm thumbs-up.', stamp: 'TICKET CLOSED', hand: 'lHand', hold: 'collar', fly: { spin: 3, arc: 30 }, slide: { blink: true }, keys: [
  ...stoop('lHand'),
  lift('collar', 'lHand', 200),
  K({ face: 0.15, ...F(-2, HIP - 6, LF, RF), torso: 4, bend: -2, head: -4, tw: -10, la: [96, 100], ra: [40, 110], spin: 0 }, 120, 'in'),
  K({ face: 0.15, ...F(-2, HIP - 4, LF, RF), torso: 0, head: -4, la: [94, 96], ra: [60, 90], spin: 140 }, 120, 'linear'),
  K({ face: 0.4, ...F(-2, HIP - 4, LF, RF), torso: -4, head: -4, la: [94, 94], ra: [70, 80], spin: 270 }, 100, 'linear', 'release'),
  K({ face: 0.6, ...F(-1, HIP - 3, LF, RF), torso: 2, head: -4, la: [90, 92], ra: [40, 100], spin: 360 }, 0, 'out'),
  K({ face: 0.6, ...F(-1, HIP - 3, LF, RF), torso: 2, head: -4, la: [90, 92], ra: [40, 100], spin: 0 }, 180, 'out', 'footstep'),
  K({ face: 0.8, ...F(0, HIP - 1, LF, RF), torso: 4, head: -6, la: [30, 40], ra: [70, 170] }, 260, 'inOut'),
  K({ face: 0.7, ...F(0, HIP, LF, RF), torso: 4, head: -8, la: [26, 36], ra: [74, 174] }, 0, 'sine'),
] };

// Fighter mastery (README, Progression, Fighter mastery; the names are src/career/mastery.js KIT). The victory pose
// (registry `victory`, in place of the dance once it's unlocked and on): Ticket resolved: one stiff arm out with a thumbs up, the other hand on the hip.
const victory = { keys: [
  K({ ...F(0, HIP - 2, LF, RF), torso: 4, head: 4, la: [40, 120], ra: [30, -70] }, 180, 'snap'),
  K({ ...F(0, HIP - 1, LF + 2, RF), torso: -2, head: -6, la: [84, 160], ra: [30, -70] }, 220, 'out'),
  K({ ...F(0, HIP - 1, LF + 2, RF), torso: -2, head: -8, la: [84, 162], ra: [30, -70] }, 420, 'sine'),
] };
// The taunt (registry `taunt`): the last round's winner plays it under the next ROUND card, never in a fight, and it's
// over by FIGHT (TAUNT_MAX_MS). Turn it off and on: a finger presses an invisible button, the body slumps, then snaps back up.
const taunt = { keys: [
  K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: 6, la: [80, 90], ra: [12, 24] }, 180, 'out'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 8, head: 8, la: [84, 84], ra: [12, 24] }, 100, 'snap'),
  K({ ...F(0, HIP - 8, LF, RF), torso: 30, bend: 10, head: 30, la: [4, 8], ra: [2, 6] }, 300, 'in'),
  K({ ...F(0, HIP, LF, RF), torso: -2, head: -8, la: [20, 40], ra: [16, 36] }, 200, 'snap'),
  K({ ...F(0, HIP, LF, RF), torso: 2, head: 0, la: [12, 24], ra: [8, 20] }, 220, 'inOut'),
] };

export default {
  dance,
  victory,
  taunt,
  perfect,
  id: 'helpdesk',
  name: 'HELPDESK',
  tagline: 'HAVE YOU TRIED BLOCKING?',
  // how it moves (the life layer's signature, src/fighter/life.js: drawn only): patient: a slow, even sway, a shrug, a neck roll between tickets
  life: { spring: 0.9, damp: 1.1, eye: 0.9, breath: 0.9, sway: 0.5, swayHz: 0.35, habits: ['shrug', 'neckRoll'] },
  color: '#2ee8ff',
  altColor: '#ff5fd2',
  accent: '#f4fbff',
  // a standard body; the edge is the bar: more of it and it comes back much faster, while each hit lands a bit lighter
  stats: { health: 100, walk: 0.97, backWalk: 1.06, run: 0.95, jump: 1, dash: 1, weight: 1.02, stamina: 1.05, regen: 1.15, damage: 0.92 },
  body: { scale: 1, headR: 15, torsoW: 15.5, hipW: 11.5, lean: -1, accessory: headset },
  moves: {
    // the stance never strikes on its own (parry hook): the window is its startup and active frames
    ticketClosed: { rig: ticketClosed, frame: { transfer: 'a parry stance whose catch fires a second move of HELPDESK\'s own (Ticket Reversal)', limb: 'hand', damage: 0, kb: { x: 0, y: 0 }, hitstun: 0, blockstun: 0, hitstop: 0, height: 'mid', cost: 18, reach: 60, flashR: 0,
      parry: { heights: ['high', 'mid'], reversal: 'ticketReversal', stun: 46, callout: 'TICKET CLOSED' } } },
    // the reversal closes the gap itself (travel stops at the body), so a strike caught at the tip of its reach is still answered
    ticketReversal: { rig: ticketReversal, frame: { transfer: 'not a press of its own: it comes out of a string, a stance, a feint or a catch', limb: 'hand', damage: 10, kb: { x: 420, y: 280 }, hitstun: 0, blockstun: 14, hitstop: 10, knockdown: true, height: 'mid',
      travel: { vx: 520, at: 30, ms: 170 }, cost: 0, reach: 70, flashR: 38 } },
    reboot: { rig: reboot, frame: { transfer: true, limb: 'hand', damage: 11, kb: { x: 700, y: 170 }, hitstun: 0, blockstun: 12, hitstop: 9, knockdown: true, splat: true, height: 'mid',
      travel: { vx: 240, at: 70, ms: 110 }, cost: 24, reach: 100, flashR: 38, callout: 'REBOOT' } },
    ctrlAltDel: { rig: ctrlAltDel, frame: { transfer: 'not a press of its own: it comes out of a string, a stance, a feint or a catch', limb: 'hand', damage: 13, kb: { x: 140, y: 470 }, hitstun: 0, blockstun: 16, hitstop: 9, knockdown: true, juggle: true, ender: true,
      height: 'mid', reach: 70, flashR: 36, callout: 'CTRL ALT DEL' } },
  },
  commands: [
    { button: '1', motion: 'b', move: 'ticketClosed' },
    { button: '2', motion: 'b', move: 'reboot' },
  ],
  strings: { add: [{ name: 'CTRL ALT DEL', keys: ['1', '3', '2'], moves: ['jab', 'lkick', 'ctrlAltDel'] }] },
  ai: {
    style: 'turtle',
    specials: [
      // a high or mid coming in: catch it. A string in progress (his last hit landed or was blocked and
      // the next press is a high or mid) gets read the same way, buffered out of blockstun
      { move: 'ticketClosed', min: 0, max: 150, lead: 0, chance: 0.4, cooldown: 90,
        when: (me, o, sim, d) => o.state === 'attack' && o.phase === 'startup' && o.grounded && parryable(o.move) && d < sim.reachOf(o, o.move) + 24 },
      { move: 'ticketClosed', min: 0, max: 130, lead: 0, chance: 0.3, cooldown: 110,
        when: (me, o) => stringNext(o) },
      { move: 'reboot', min: 70, max: 150, when: 'wall', chance: 0.5, cooldown: 120 },
      { move: 'reboot', min: 70, max: 145, when: 'whiff', chance: 0.6, cooldown: 90 },
      { move: 'reboot', min: 90, max: 140, when: 'standing', chance: 0.1, cooldown: 200 },
    ],
  },
  moveList: [
    { name: 'TICKET CLOSED', input: '← 1', note: 'parry a high or mid, then an elbow' },
    { name: 'REBOOT', input: '← 2', note: 'palm push, carries him to the wall' },
    { name: 'CTRL ALT DEL', input: '1, 3, 2', note: 'string, rising palms launch' },
  ],
  // STRATEGY, for the fighter page only (README, Site): how to beat each unique move. The game never shows it,
  // and site/vite-plugin.mjs cuts it from the bundle. Every tip is measured: `node gauntlet/counters.mjs helpdesk`
  // prints the numbers behind each one. Measure again when the frame data changes.
  strategy: [
    { move: 'ticketClosed', also: ['ticketReversal'], tips: [
      "It only catches highs and mids. A low kick (↓3) or a sweep (↓4) beats it at any moment, and so does a throw (1+3) from right next to him.",
      "Don't jab or cross the instant he sets it. That's what it's for: you get caught and knocked down.",
      "It's over fast, and then he's stuck for about half a second. If you didn't swing, hit him as his guard drops: the cross (2) lands up close, and →2 reaches from a step back.",
    ] },
    { move: 'reboot', tips: [
      "Stand-block it. It's a mid, so a crouch-block gets you shoved over.",
      "Blocked, it's a free hit for you. A jab (1) or a snap kick (3) lands every time.",
      "It's too quick to out-punch once it has started, so block it or parry it with →.",
    ] },
    { string: 'CTRL ALT DEL', tips: [
      "Stand-block all three hits. There's no low in it.",
      "The last hit leaves him wide open. As soon as you can move, punish with the cross (2) or →2.",
      "Or crouch from the start. The first jab goes over your head, the string stops there, and a low kick (↓3) punishes.",
    ] },
  ],
};

// a strike the stance can take: a grounded high or mid, never a throw or an air attack
function parryable(move) {
  const fd = move && FRAME_DATA[move];
  return !!fd && !fd.throw && !fd.air && (fd.height === 'high' || fd.height === 'mid') && !(fd.parry);
}
// he's inside a string whose last hit just connected, and the press that would continue it is coming
function stringNext(o) {
  if (o.state !== 'attack' || !o.hitConfirmed || !o.seq || o.phase === 'startup') return false;
  const list = (o.char && o.char.strings) || [];
  return list.some((s) => s.keys.length > o.seq.length && o.seq.every((t, i) => s.keys[i] === t || s.keys[i] === t.replace(/^d/, '')) && parryable(s.moves[o.seq.length]));
}
