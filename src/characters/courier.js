// COURIER: speed rushdown. Lower health, a lighter body that flies farther, faster walk, run and dash,
// quicker stamina. Two unique moves off a dash, Express Slide (f,f+3, a low baseball slide under highs)
// and Drop-Off Knee (f,f+4, a running flying knee that hops over lows and launches), and one unique
// string, SAME DAY (1,1,3), whose ender is the slide. Keeps every shared string.
import { RIG_KIT } from '../fighter/index.js';
import { stoop, lift } from './perfectKit.js';

const { K, F, LF, RF, HIP, CH, crouchP } = RIG_KIT;

// f,f+3: drop into a feet-first slide along the floor, lead foot out at shin height; the body travels on
// (frame data travel) and comes back up through a crouch. Low, under highs (tc), a knockdown.
const expressSlide = { blend: 40, limb: 'lFoot', keys: [
  K({ ...crouchP, ...F(4, CH + 4, LF + 2, RF - 2), torso: 22, bend: 6, head: -10, la: [30, 120], ra: [-20, 60] }, 60, 'in'),
  K({ hx: 10, ll: [70, 82], rl: [30, -70], torso: -18, bend: -6, head: 14, tw: 4, la: [-40, -10], ra: [-60, -40] }, 50, 'out'),
  K({ hx: 14, ll: [84, 88], rl: [42, -80], torso: -36, bend: -8, head: 22, tw: 6, la: [-62, -30], ra: [-82, -60] }, 40, 'out', 'active'),
  K({ hx: 15, ll: [85, 89], rl: [44, -82], torso: -38, bend: -8, head: 24, tw: 6, la: [-64, -32], ra: [-84, -62] }, 190, 'linear'),
  K({ hx: 10, ll: [62, 24], rl: [42, -72], torso: -10, bend: -2, head: 6, la: [20, 80], ra: [0, 60] }, 90, 'inOut', 'recover'),
  K({ ...crouchP, ...F(4, CH + 2, LF + 2, RF - 2), torso: 16 }, 100, 'out'),
  K({ ...F(1, HIP - 2, LF, RF), torso: 7, head: -4, la: [54, 148], ra: [28, 166] }, 90, 'out', 'footstep'),
  K({ ...F(0, HIP - 1, LF, RF), torso: 6, head: -4 }, 0, 'sine'),
] };

// f,f+4: spring off the run, rear knee driving up and forward into the chest with the arms pulling
// down, land on the kicking foot ahead. Airborne through startup and active (lows pass under), launches.
const dropOffKnee = { blend: 40, limb: 'rKnee', shift: 24, keys: [
  K({ ...F(-4, HIP - 8, LF, RF), torso: 20, bend: 4, head: -6, tw: -6, la: [-30, 20], ra: [60, 120] }, 50, 'in'),
  K({ hx: 6, ll: [20, -40], rl: [80, 120], torso: 4, bend: 0, head: -4, la: [40, 100], ra: [-40, -10], air: 16 }, 50, 'out'),
  K({ hx: 14, ll: [10, -70], rl: [116, 174], torso: -14, bend: -6, head: -10, la: [100, 140], ra: [-30, -70], air: 28 }, 40, 'out', 'active'),
  K({ hx: 15, ll: [12, -72], rl: [118, 176], torso: -16, bend: -6, head: -10, la: [96, 132], ra: [-28, -66], air: 27 }, 80, 'inOut'),
  K({ hx: 14, ll: [24, -30], rl: [70, 20], torso: 4, head: -4, la: [40, 120], ra: [20, 110], air: 10 }, 80, 'in', 'recover'),
  K({ ...F(18, HIP - 8, LF + 10, 44), torso: 14, bend: 4, head: -6, la: [40, 120], ra: [24, 130] }, 80, 'out', 'land'),
  K({ ...F(20, HIP - 2, LF + 24, RF + 24, 0, 8), torso: 6, head: -4, la: [54, 148], ra: [28, 160] }, 100, 'inOut', 'footstep'),
  K({ ...F(24, HIP - 1, LF + 24, RF + 24), torso: 6, head: -4 }, 0, 'sine'),
] };

// a bike messenger's cap, bill forward, in the accent neon
function cap(ctx, J, o) {
  const h = J.head, n = J.neck, r = o.headR;
  let ux = h.x - n.x, uy = h.y - n.y; const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
  const fx = -uy * o.facing, fy = ux * o.facing;   // forward, across the head
  const a = Math.atan2(uy, ux);
  ctx.fillStyle = o.accent; ctx.strokeStyle = o.accent; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(h.x, h.y, r * 1.1, a - 1.5, a + 1.5); ctx.closePath(); ctx.fill();
  ctx.lineWidth = 3.2 * o.scale;
  const bx = h.x + fx * r * 0.9 + ux * r * 0.18, by = h.y + fy * r * 0.9 + uy * r * 0.18;
  ctx.beginPath(); ctx.moveTo(bx - fx * r * 0.3, by - fy * r * 0.3); ctx.lineTo(bx + fx * r * 0.75 - ux * r * 0.12, by + fy * r * 0.75 - uy * r * 0.12); ctx.stroke();
}

// The celebration (registry `dance`, played by the match winner under the WINS banner): The running man: a knee comes up as the other foot slides back, on the spot, arms pumping.
const dance = { keys: [
  K({ ...F(0, HIP - 6, LF + 4, RF - 22), rl: [96, 20], torso: 12, bend: 3, head: -6, la: [-40, 40], ra: [80, 160] }, 150, 'out'),
  K({ ...F(0, HIP - 2, LF - 22, RF), torso: 10, head: -4, la: [20, 100], ra: [30, 110] }, 150, 'in'),
  K({ ...F(0, HIP - 6, LF - 22, RF + 4), ll: [96, 20], torso: 12, bend: 3, head: -6, la: [80, 160], ra: [-40, 40] }, 150, 'out'),
  K({ ...F(0, HIP - 2, LF, RF - 22), torso: 10, head: -4, la: [30, 110], ra: [20, 100] }, 150, 'in'),
] };

// The perfect round finisher (registry `perfect`, README Perfect rounds): he picks it up like a parcel across both arms, tosses it up and drop-kicks it at the camera, then tips his cap.
const perfect = { name: 'SAME-DAY DROP KICK', stamp: 'DELIVERED', hand: 'lHand', hold: 'carry', fly: { spin: 1, arc: 10 }, keys: [
  ...stoop('both'),
  lift('chest', 'lHand', 200),
  K({ ...F(-2, HIP - 8, LF - 2, RF), torso: 10, bend: 2, head: -8, la: [74, 118], ra: [66, 112] }, 120, 'in'),
  K({ ...F(0, HIP + 2, LF, RF, 0, 4), torso: -4, bend: -4, head: -14, la: [130, 150], ra: [120, 146] }, 120, 'out'),
  K({ hx: -6, ll: RIG_KIT.L(-6, HIP + 2, LF - 4), rl: [104, 96], torso: -24, bend: -6, head: -10, la: [150, 200], ra: [-40, -20] }, 90, 'out', 'release'),
  K({ hx: -4, ll: RIG_KIT.L(-4, HIP + 2, LF - 4), rl: [96, 84], torso: -22, bend: -6, head: -8, la: [140, 190], ra: [-30, -10] }, 160, 'out'),
  K({ ...F(2, HIP - 2, LF, RF + 6), torso: 4, head: -6, la: [40, 100], ra: [30, 110] }, 220, 'inOut', 'footstep'),
  K({ ...F(2, HIP, LF, RF + 6), torso: 2, head: -8, la: [150, 230], ra: [20, 40] }, 260, 'inOut'),
  K({ ...F(2, HIP, LF, RF + 6), torso: 2, head: -10, la: [156, 236], ra: [20, 40] }, 0, 'sine'),
] };

export default {
  dance,
  perfect,
  id: 'courier',
  name: 'COURIER',
  tagline: 'DELIVERS IN THIRTY SECONDS OR LESS',
  // how it moves (the life layer's signature, src/fighter/life.js: drawn only): light on the toes: a quick bounce, quick eyes, shaking the hands out
  life: { spring: 1.3, damp: 0.9, eye: 1.3, breath: 1.25, sway: 0.4, swayHz: 0.6, bounce: 1.2, bounceHz: 2.2, habits: ['shakeOut', 'glance'], laugh: true },
  color: '#ff2bd6',
  altColor: '#ff8a3d',
  accent: '#2ef2ff',
  // walk/run/jump/dash multiply the baseline; health is out of 100; a light body (weight < 1) flies farther
  stats: { health: 97, walk: 1.2, backWalk: 0.95, run: 1.2, jump: 1.06, dash: 1.2, weight: 0.9, stamina: 1, regen: 1.25, damage: 1.03 },
  body: { scale: 0.96, headR: 14.5, upperLeg: 32, lowerLeg: 31.5, limbW: 11, limbTip: 8.5, torsoW: 13.5, hipW: 10, lean: 5, accessory: cap },
  moves: {
    expressSlide: { rig: expressSlide, frame: { limb: 'foot', damage: 10, kb: { x: 260, y: 210 }, hitstun: 0, blockstun: 10, hitstop: 7, knockdown: true, height: 'low', tc: true,
      travel: { vx: 520, at: 60, ms: 230 }, cost: 22, reach: 140, flashR: 28, callout: 'EXPRESS SLIDE' } },
    dropOffKnee: { rig: dropOffKnee, frame: { limb: 'foot', damage: 13, kb: { x: 130, y: 450 }, hitstun: 0, blockstun: 14, hitstop: 8, knockdown: true, juggle: true, height: 'mid',
      travel: { vx: 420, at: 50, ms: 190 }, lowInvuln: true, cost: 24, reach: 70, flashR: 32, callout: 'DROP-OFF KNEE' } },
    // SAME DAY's ender: the slide off two jabs, harder
    sameDay: { frame: { limb: 'foot', damage: 12, kb: { x: 320, y: 240 }, hitstun: 0, blockstun: 10, hitstop: 9, knockdown: true, ender: true, height: 'low', tc: true,
      travel: { vx: 460, at: 60, ms: 200 }, reach: 140, flashR: 32, anims: ['expressSlide'], callout: 'SAME DAY' } },
  },
  commands: [
    { button: '3', motion: 'ff', move: 'expressSlide' },
    { button: '4', motion: 'ff', move: 'dropOffKnee' },
  ],
  strings: { add: [{ name: 'SAME DAY', keys: ['1', '1', '3'], moves: ['jab', 'jab', 'sameDay'] }] },
  ai: {
    style: 'rushdown',
    range: 'close',
    specials: [
      { move: 'expressSlide', min: 60, max: 240, when: 'whiff', chance: 0.8, cooldown: 60 },
      { move: 'expressSlide', min: 100, max: 210, when: 'guarding', chance: 0.55, run: true, cooldown: 150 },
      { move: 'dropOffKnee', min: 90, max: 190, when: (me, o) => o.grounded && !o.crouch && o.state !== 'attack', chance: 0.3, run: true, cooldown: 170 },
      { move: 'expressSlide', min: 110, max: 220, when: 'standing', chance: 0.22, run: true, cooldown: 170 },
    ],
  },
  moveList: [
    { name: 'EXPRESS SLIDE', input: '→→ 3', note: 'low slide under highs, knocks down' },
    { name: 'DROP-OFF KNEE', input: '→→ 4', note: 'flying knee over lows, launches' },
    { name: 'SAME DAY', input: '1, 1, 3', note: 'string, ends in the slide' },
  ],
};
