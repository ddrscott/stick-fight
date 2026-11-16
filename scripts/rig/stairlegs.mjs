// npm run test:stairs:legs: legs on the stairs never stretch, squash, bend backward, sink or pop (README, Floors: The stairs).
//
// Every character is put on both flights at several spots, facing down the flight and facing up it, and run through
// idle, walk, back-walk, run, guard, crouch and a few strikes in the real sim (createCombat on the building). On every
// tick the body is on a flight and on its feet, the joints the sim ends with (the hitboxes; slopePose() then
// fitToGround()) are held up against the clip's own pose from before the stair fit (sim.onStairLegs):
//   - a thigh or a shin more than LEN px longer or shorter than the clip drew it
//   - a knee past the joint limit (shin - thigh <= +3 deg, effective facing; skipped while the limbs are loose)
//   - a planted foot (the clip has it on its floor) inside the tread under it, or more than ABOVE px over it
//   - a foot that pops: its height off what a smooth path would give (the change in its vertical speed in one tick,
//     less the clip's own and the slope's share; see below) by more than JUMP px. JUMP is 18, just under a rise, so any
//     foot snapping from one tread to the next fails; the smaller kinks are counted and printed (POP_BINS), not failed.
//     main, measured by this script: 38,624 foot-ticks over 4 px, 2,854 over 18. This build: about 4,100 over 4, none
//     over 18; most of what's left is backing up a flight facing down (README, Floors: Legs on the steps, What's left).
// A planted foot is one the sim has standing (not swinging by its lift or by its speed over the ground). A tick where
// fitToGround lifts the whole body because an arm or the head would go into a step (a punch up the flight) is counted
// on its own line and not held against the legs: that's the upper body against the steps.
//
//   node scripts/rig/stairlegs.mjs           the stairs check (exit 1 on any failure)
//   node scripts/rig/stairlegs.mjs --flat    the flat-floor digest: a hash of every clip's joints and hitboxes on the
//                                            main floor and the lower floor, to hold against the same script on main
//   node scripts/rig/stairlegs.mjs --verbose list every failure, not the first few of each kind
//   ONLY=intern,chef   just those characters;   FOCUS='chef flight 0 @140 up walk'   print that run tick by tick
//   SF_ROOT=/path/to/main/   run it against another checkout (main needs sim.onStairLegs; README, The stairs)
import { createHash } from 'node:crypto';

const ROOT = process.env.SF_ROOT || new URL('../../', import.meta.url).pathname;   // SF_ROOT=/path/to/main for the flat digest of another checkout
await import(ROOT + 'src/characters/index.js');
const { roster } = await import(ROOT + 'src/characters/index.js');
const { createArena } = await import(ROOT + 'src/arena/index.js');
const { createCombat } = await import(ROOT + 'src/combat/sim.js');
const { EMPTY_INPUT } = await import(ROOT + 'src/combat/input.js');
const { createFighter, MOVES, MOVE_DATA, JOINT_LIMITS } = await import(ROOT + 'src/fighter/index.js');

const FLAT = process.argv.includes('--flat'), VERBOSE = process.argv.includes('--verbose');
const LEN = 0.5, ABOVE = 2, INSIDE = 0.5, JUMP = 18, HOLD = 8, KINK = 6, POP_BINS = [4, 6, 10, 18];
const R2D = 180 / Math.PI;

function makeSim(ids) {
  const arena = createArena('building'), sp = arena.spawns;
  const rigs = [createFighter({ x: sp[0].x, y: sp[0].y, facing: 1 }), createFighter({ x: sp[1].x, y: sp[1].y, facing: -1 })];
  let sim;
  let pad = EMPTY_INPUT;
  const input = { snapshot: () => pad };
  const makeRig = (c) => { const g = sim.units[0]; return createFighter({ color: c, x: g.x, y: g.y, facing: -1 }); };
  sim = createCombat({ fighters: rigs, arena, input, onEvent() {}, makeRig, moves: MOVES, moveData: MOVE_DATA });
  sim.setCharacters(ids, [], []);
  sim.setHuman(0); sim.setController(1, 'none');
  sim.resetMatch({ seed: 1, skipIntro: true, startHealth: 100000 });
  return { sim, arena, press: (p) => { pad = p; } };
}
// what the player holds for each clip; fwd is the facing
const ACTS = [
  ['idle', (_f) => EMPTY_INPUT, 90],
  ['walk', (f) => ({ ...EMPTY_INPUT, dx: f }), 110],
  ['backWalk', (f) => ({ ...EMPTY_INPUT, dx: -f }), 110],
  ['run', (f) => ({ ...EMPTY_INPUT, dx: f, run: true }), 60],
  ['block', () => ({ ...EMPTY_INPUT, block: true }), 60],
  ['crouch', () => ({ ...EMPTY_INPUT, down: true }), 60],
  ['lp', (f, t) => (t < 3 ? { ...EMPTY_INPUT, lp: true } : EMPTY_INPUT), 80],
  ['rp', (f, t) => (t < 3 ? { ...EMPTY_INPUT, rp: true } : EMPTY_INPUT), 90],
  ['lk', (f, t) => (t < 3 ? { ...EMPTY_INPUT, lk: true } : EMPTY_INPUT), 90],
  ['rk', (f, t) => (t < 3 ? { ...EMPTY_INPUT, rk: true } : EMPTY_INPUT), 100],
  ['lowKick', (f, t) => ({ ...EMPTY_INPUT, down: t < 20, lk: t >= 1 && t < 4 }), 90],
];

// ---- the flat digest ------------------------------------------------------------------------------------------------
if (FLAT) {
  // every clip on every character, played on the rig straight (createFighter at 120 Hz), and every ACTS input in the
  // sim on the main floor and on the lower floor (away from the flights): joints and the sim's hitboxes, hashed
  const h = createHash('sha256'), part = { rig: createHash('sha256'), floor0: createHash('sha256'), floor1: createHash('sha256') };
  let cur = part.rig;
  const put = (J) => { for (const k of Object.keys(J).sort()) { const v = `${k}${J[k].x},${J[k].y};`; h.update(v); cur.update(v); } };
  let n = 0;
  for (const c of roster()) {
    const { sim } = makeSim([c.id, 'temp']);
    cur = part.rig;
    for (const m of MOVES) {
      const f = sim.units[0].rig;
      try { f.play(m); } catch { continue; }
      for (let i = 0; i < 90; i++) { f.update(1 / 120); put(f.joints); n++; }
    }
    for (const where of [{ x: 1280, floor: 0 }, { x: 1280, floor: 1 }]) for (const [name, act, len] of ACTS) for (const fc of [1, -1]) {
      const { sim, arena, press } = makeSim([c.id, 'temp']);
      const u = sim.units[0], o = sim.units[1];
      cur = where.floor ? part.floor1 : part.floor0;
      u.floor = where.floor; o.floor = where.floor; u.x = where.x; o.x = where.x + 260 * fc;
      u.y = arena.floors[where.floor].y; o.y = u.y;
      for (let t = 0; t < len; t++) {
        press(act(fc, t)); sim.tick();
        put(u.rig.joints); h.update(name + JSON.stringify(sim.debugBoxes(u))); n++;
      }
    }
  }
  console.log(`flat digest ${h.digest('hex').slice(0, 32)}  (${n} poses; ${Object.entries(part).map(([k, v]) => `${k} ${v.digest('hex').slice(0, 12)}`).join(', ')})`);
  process.exit(0);
}

// ---- the stairs check -----------------------------------------------------------------------------------------------
const { knee: KNEE, fold: FOLD } = JOINT_LIMITS;
function bend(J, b, c, side, fc, s, spin) {
  const cs = Math.cos(spin * Math.PI / 180), off = side * Math.abs(Math.sin(spin * Math.PI / 180)) * 12, hx = J.hip.x, k = fc * s;
  const bx = (p) => ((p.x - hx) / k - off) / cs;
  const ux = bx(J[b]), uy = (J[b].y - J.hip.y) / s, vx = bx(J[c]) - bx(J[b]), vy = (J[c].y - J[b].y) / s;
  return Math.atan2(uy * vx - ux * vy, ux * vx + uy * vy) * R2D;
}
const pastKnee = (v) => (v > KNEE && v < FOLD ? Math.min(v - KNEE, FOLD - v) : 0);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const fails = new Map();   // kind -> [{...}]
const worst = { len: 0, knee: 0, inside: 0, above: 0, jump: 0, drop: 0 };
let ticks = 0, liftedTicks = 0;
const jumpBy = { fit: 0, legs: 0 }, pops = POP_BINS.map(() => 0), kinkBy = new Map(), kinkEx = new Map();   // kinks over KINK by facing and input
function fail(kind, v, where) {
  if (!fails.has(kind)) fails.set(kind, []);
  fails.get(kind).push({ v, where });
}
const LEGS = [['l', 'lKnee', 'lFoot', -1], ['r', 'rKnee', 'rFoot', 1]];

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;   // ONLY=intern,chef: just those characters
for (const c of roster().filter((x) => !ONLY || ONLY.includes(x.id))) {
  for (const k of [0, 1]) for (const along of [40, 140, 240, 340]) for (const down of [true, false]) for (const [name, act, len] of ACTS) {
    const { sim, arena, press } = makeSim([c.id, 'temp']);
    const st = arena.stairs[k], u = sim.units[0], o = sim.units[1];
    const fc = down ? st.dir : -st.dir;
    // the opponent off on the main floor (so he's who the fighter faces), far enough to never touch
    o.floor = 0; o.stair = -1; o.x = down ? 1280 : (st.dir > 0 ? 200 : 2360); o.y = arena.floors[0].y;
    u.x = st.head + st.dir * along; u.stair = k; u.floor = 0; u.y = arena.stairY(k, u.x); u.facing = fc;
    let before = null, drop = 0, strike = null, fitted = [], mid = null;
    sim.onStairLegs((v, b, j, d, sk, lg) => { if (v === u) { before = b; drop = d; strike = sk; fitted = lg; mid = JSON.parse(JSON.stringify(j)); } });
    const hist = {};
    // settle first: a quarter second standing where it was put (the test teleports it onto the steps)
    for (let t = 0; t < 30; t++) { press(EMPTY_INPUT); sim.tick(); }
    for (let t = 0; t < len; t++) {
      before = null;
      globalThis.__on = process.env.FOCUS && `${c.id} flight ${k} @${along} ${down ? 'down' : 'up'} ${name}` === process.env.FOCUS && t >= +(process.env.T0 || 50) && t <= +(process.env.T1 || 58);
      press(act(fc, t)); sim.tick();
      if (!before || !(u.stair >= 0) || !u.grounded || u.rag) { for (const q in hist) delete hist[q]; continue; }
      ticks++;
      const J = u.rig.joints, rad = u.rig.radii, where = `${c.id} flight ${k} @${along} ${down ? 'down' : 'up'} ${name} t${t} (${u.rig.current.move})`;
      worst.drop = Math.max(worst.drop, drop);
      for (const [side, kn, ft, sd] of LEGS) {
        for (const [a, b, nm] of [['hip', kn, 'thigh'], [kn, ft, 'shin']]) {
          const e = Math.abs(dist(J[a], J[b]) - dist(before[a], before[b]));
          worst.len = Math.max(worst.len, e);
          if (e > LEN) fail(`${nm} length`, e, `${where} ${side}`);
        }
        if (!u.rig.limbsLoose()) {
          const p = pastKnee(bend(J, kn, ft, sd, u.facing, u.rig.scale || 1, (u.rig.pose && u.rig.pose.spin) || 0));
          const p0 = pastKnee(bend(before, kn, ft, sd, u.facing, u.rig.scale || 1, (u.rig.pose && u.rig.pose.spin) || 0));
          worst.knee = Math.max(worst.knee, p - p0);
          if (p > 0.05 + p0) fail('knee past the limit', p, `${where} ${side} (clip ${p0.toFixed(2)})`);
        }
        // planted: the sim has it standing (not swinging by its lift or its speed over the ground: w1 0)
        // (SF_ROOT on main, whose hook has no legs list: the clip's foot within 2 px of its floor)
        const g = fitted && fitted.find((q) => q.ft === ft), planted = fitted ? !!g && g.w1 === 0 && ft !== strike : u.rig.y - before[ft].y - (rad[ft] || 0) < 2;
        // inside: against the tread under the foot; above: against the highest tread top within HOLD px of it (a
        // planted foot that slid a little past a tread's front edge rests its toe on that nosing: FOOT_HOLD in sim.js)
        const low = J[ft].y + (rad[ft] || 0), inside = low - arena.treadY(k, J[ft].x);
        if (inside > worst.inside) worst.inside = inside;
        if (inside > INSIDE && planted) fail('planted foot inside its tread', inside, `${where} ${side}`);
        // fitToGround's last resort lifted the whole body because an arm or the head would go into a step (a punch up the
        // flight): the feet leave the treads with it. That's the upper body against the steps (leaning into the slope is
        // later work), so it's counted on its own line, not as a leg failure.
        const legsIn = ['lKnee', 'rKnee', 'lFoot', 'rFoot'].some((q) => mid[q].y + (rad[q] || 0) - arena.treadY(k, mid[q].x) > 0.01);
        const upperLift = J.hip.y - mid.hip.y < -0.5 && !legsIn;
        if (upperLift && side === 'l') liftedTicks++;
        if (planted && !upperLift) {
          const top = Math.min(arena.treadY(k, J[ft].x - HOLD), arena.treadY(k, J[ft].x), arena.treadY(k, J[ft].x + HOLD));
          const gap = top - low;
          if (gap > worst.above) worst.above = gap;
          if (gap > ABOVE) fail('planted foot above its tread', gap, `${where} ${side}`);
        }
        // A pop is the foot's speed changing all at once. Each tick's history: the drawn foot (y, x), the clip's foot in
        // the world, and the clip's foot relative to its root. The jump is the change in the drawn foot's vertical speed
        // less the change in the clip's own (whichever frame explains more of it: a stride is planted in the world, a
        // kick moves with the body, and the sim moves the root, as when an attack ends and the root goes back onto the
        // walking line) and less what the slope accounts for when the foot speeds up or slows down along the flight.
        const h = hist[ft] || (hist[ft] = []);
        h.fm = h.length && Math.hypot(h[h.length - 1].y - h[h.length - 1].my, h[h.length - 1].x - h[h.length - 1].mx) > 0.5;   // fitToGround moved it last tick
        const gg = fitted && fitted.find((q) => q.ft === ft);
        h.push({ y: J[ft].y, x: J[ft].x, w: before[ft].y, r: before[ft].y - u.rig.y, my: mid[ft].y, mx: mid[ft].x, cl: gg ? gg.cl > 0 : false, rl: gg ? gg.rl : false, rch: gg ? Math.hypot(mid[ft].x - gg.T.x, mid[ft].y - gg.T.y) > 0.05 : false, off: !gg, w1: gg ? gg.w1 : -1, lift: J.hip.y - mid.hip.y < -0.5, up: upperLift });
        if (h.length > 3) h.shift();
        if (h.length === 3) {
          const d2 = (q) => h[2][q] - 2 * h[1][q] + h[0][q];
          const jmp = Math.min(Math.abs(d2('y') - d2('w')), Math.abs(d2('y') - d2('r'))) - st.slope * Math.abs(d2('x'));
          worst.jump = Math.max(worst.jump, jmp);
          POP_BINS.forEach((b, i) => { if (jmp > b) pops[i]++; });
          if (jmp > KINK) { const kk = `${down ? 'down' : 'up'} ${name}` + (process.env.KINKS ? ` ${h.some((q) => q.up) ? 'upperLift' : h.some((q) => q.lift) ? 'bodyLift' : Math.hypot(J[ft].x - mid[ft].x, J[ft].y - mid[ft].y) > 0.5 || h.fm ? 'fit' : h.some((q) => q.off) && !h.every((q) => q.off) ? 'offEdge' : h.some((q) => q.cl) ? 'clamp' : h.some((q) => q.rl) ? 'rate' : h.some((q) => q.rch) ? 'reach' : 'blend'}` : ''); kinkBy.set(kk, (kinkBy.get(kk) || 0) + 1); if (process.env.KINKS) { const ex = kinkEx.get(kk) || []; ex.push(`${jmp.toFixed(1)} ${where} ${side}`); kinkEx.set(kk, ex); } }
          if (jmp > POP_BINS[0]) { const fm = Math.hypot(J[ft].x - mid[ft].x, J[ft].y - mid[ft].y) > 0.5 || h.fm; jumpBy[fm ? 'fit' : 'legs']++; }
          if (jmp > JUMP) fail('foot pops in one tick', jmp, `${where} ${side}`);
          if (process.env.FOCUS && where.startsWith(process.env.FOCUS)) { const g = fitted && fitted.find((q) => q.ft === ft); console.log(where, side, 'jmp', jmp.toFixed(2), 'clip', before[ft].x.toFixed(1), before[ft].y.toFixed(1), 'legs', mid[ft].x.toFixed(1), mid[ft].y.toFixed(1), 'final', J[ft].x.toFixed(1), J[ft].y.toFixed(1), 'tread', arena.treadY(k, J[ft].x), 'y0', u.rig.y.toFixed(1), 'drop', drop.toFixed(1), g ? `w1 ${g.w1.toFixed(2)} T ${g.T.y.toFixed(1)}` : 'unfit', 'hipFit', (J.hip.y - mid.hip.y).toFixed(1), 'knee', mid[kn].x.toFixed(1), mid[kn].y.toFixed(1), 'in', (mid[kn].y + (rad[kn] || 0) - arena.treadY(k, mid[kn].x)).toFixed(1), 'kneeFinal', J[kn].x.toFixed(1), J[kn].y.toFixed(1), 'hip', J.hip.x.toFixed(1), J.hip.y.toFixed(1), 'd', (ft === 'lFoot' ? u.footDL : u.footDR)?.toFixed(2), 'reach', g ? Math.hypot(mid[ft].x - g.T.x, mid[ft].y - g.T.y).toFixed(1) : '-'); }
        }
      }
    }
  }
}

let bad = 0;
for (const [kind, list] of fails) {
  bad += list.length;
  list.sort((a, b) => b.v - a.v);
  console.log(`FAIL ${kind}: ${list.length} ticks, worst ${list[0].v.toFixed(2)}`);
  for (const f of list.slice(0, VERBOSE ? 1e9 : 6)) console.log(`   ${f.v.toFixed(2)}  ${f.where}`);
}
console.log(`${ticks} ticks on the stairs checked; worst: bone length ${worst.len.toFixed(3)} px, knee past limit ${worst.knee.toFixed(2)} deg, foot inside ${worst.inside.toFixed(2)} px, planted foot above ${worst.above.toFixed(2)} px, foot jump ${worst.jump.toFixed(2)} px/tick, hip drop ${worst.drop.toFixed(1)} px`);
console.log(`foot kinks (px off a smooth path in one tick, of ${ticks * 2} foot-ticks): ${POP_BINS.map((b, i) => `over ${b}: ${pops[i]}`).join(', ')}; of those over ${POP_BINS[0]}, fitToGround's turn of a limb moved the foot in ${jumpBy.fit}, the leg fit alone ${jumpBy.legs}`);
console.log(`kinks over ${KINK} by facing and input: ${[...kinkBy].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
if (process.env.KINKS) for (const [k, ex] of kinkEx) console.log(`  ${k}:\n    ${ex.slice(0, +process.env.KINKS || 3).join('\n    ')}`);
console.log(`${liftedTicks} ticks the body was lifted off its feet by an arm or the head against a step (not counted against the legs)`);
console.log(bad ? `FAIL (${bad})` : 'PASS');
process.exit(bad ? 1 : 0);
