// npm run test:limits: knees and elbows never bend the wrong way (README, "Joint limits", 2026-11-15).
//
// Every clip on every body is stepped through createFighter and the real solve() at 240 Hz (so the blend in and every
// in-between is seen), and each knee (hip -> knee -> foot) and elbow (shoulder -> elbow -> hand) is measured on the
// drawn joints with the body's effective facing. A knee may straighten to +3 deg and fold back from there; an elbow may
// straighten to -5 and fold forward. A spin squashes x by cos(spin) and shifts the near and far limbs apart: the check
// takes both out before it measures (the squash keeps the bend's sign but stretches its size, so a limb seen nearly
// edge-on would read 80 deg off for a 10 deg bend), and skips the frames within 6 deg of edge-on.
//
// Part 1, the clips themselves, runs with the runtime guard off (setJointGuard(false)): every clip, a strike retargeted
// by `adapt` (reach and target), and the botch mixes (makeBotch, limbBlend.js). These must be clean on their own.
// Part 2 runs with the guard on and measures what's drawn: f.joints after the springs and the crossfade, the additive
// hit reactions, the point simulation (launch, juggle, wall splat, ground bounce), the life layer's offsets (fatigue,
// takes, habits, hand springs) and the perfect finisher's carried bodies and turned thrower. These must be clean, full
// stop: no allowlist.
//
//   node scripts/rig/limits.mjs            run it (exit 1 on any violation not on the allowlist)
//   node scripts/rig/limits.mjs --all      also print the allowlisted ones
import '../../src/characters/index.js';
import { roster } from '../../src/characters/index.js';
import { createFighter, MOVES, MOVE_DATA, RIG_KIT, setJointGuard, JOINT_LIMITS } from '../../src/fighter/index.js';
import { createLife } from '../../src/fighter/life.js';
import { POSES, carryPose } from '../../src/fx/perfect.js';

const SHOW_ALL = process.argv.includes('--all');
const R2D = 180 / Math.PI, DT = 1 / 240;
const { knee: KNEE, elbow: ELBOW, fold: FOLD } = JOINT_LIMITS;

// The allowlist: clip (or pose) and limb, with why it may bend past the limit. Keep it short.
const ALLOW = {
  // the perfect finisher's body on the glass is seen from the front, splayed left and right, so one side of each pair
  // reads backward in the side view's sense (src/fx/perfect.js FRONT, solved with the guard off)
  'glass:splat ra': 'front view on the glass, arms splayed symmetrically', 'glass:splat rl': 'front view on the glass, legs splayed symmetrically',
  'glass:smear ra': 'front view on the glass, arms splayed symmetrically', 'glass:smear rl': 'front view on the glass, legs splayed symmetrically',
  'glass:peel la': 'front view on the glass, arms splayed symmetrically', 'glass:peel rl': 'front view on the glass, legs splayed symmetrically',
};

const LIMBS = [['la', 'lShoulder', 'lElbow', 'lHand', 0, -1], ['ra', 'rShoulder', 'rElbow', 'rHand', 0, 1], ['ll', 'hip', 'lKnee', 'lFoot', 1, -1], ['rl', 'hip', 'rKnee', 'rFoot', 1, 1]];
// signed bend of a -> b -> c in body space (x forward, y down): + when the far segment swings forward of the near one
function bend(J, a, b, c, isLeg, side, fc, s, spin) {
  const cs = Math.cos(spin * Math.PI / 180), off = side * Math.abs(Math.sin(spin * Math.PI / 180)) * 12, hx = J.hip.x, k = fc * s;
  const bx = (p) => ((p.x - hx) / k - off) / cs;
  const ax = isLeg ? 0 : bx(J[a]);
  const ux = bx(J[b]) - ax, uy = (J[b].y - J[a].y) / s, vx = bx(J[c]) - bx(J[b]), vy = (J[c].y - J[b].y) / s;
  return Math.atan2(uy * vx - ux * vy, ux * vx + uy * vy) * R2D;
}
// degrees past the limit (0 if inside)
// (a bend past FOLD, a limb flat on itself, reads the same either way: the distance is to the nearer of the two bounds)
const past = (v, isLeg) => (isLeg ? (v > KNEE && v < FOLD ? Math.min(v - KNEE, FOLD - v) : 0) : (v < ELBOW && v > -FOLD ? Math.min(ELBOW - v, v + FOLD) : 0));

const found = new Map();   // "part|name side" -> worst { deg, v, ... }
function judge(part, name, J, fc, s, spin, where, tol = 0.05) {
  const cs = Math.cos(spin * Math.PI / 180);
  if (Math.abs(cs) < 0.1) return;
  for (const [side, a, b, c, isLeg, sd] of LIMBS) {
    if (!J[a] || !J[b] || !J[c]) continue;
    const v = bend(J, a, b, c, isLeg, sd, fc, s, spin), d = past(v, isLeg);
    if (d > tol) {
      const key = `${part}|${name} ${side}`, w = found.get(key);
      if (!w || d > w.d) found.set(key, { part, name, side, d, v, where });
    }
  }
}

const chars = roster();
const rigOf = (c, facing = 1) => { const r = createFighter({ x: 400, y: 600, facing, body: c.body }); r.setBody(c.body, { accent: c.accent }); r.charDef = c; return r; };
const durOf = (def) => (def.blend || 0) + def.keys.reduce((s2, k) => s2 + k.d, 0);
// play a clip and step it to the end, judging every step. opt: play options; pre: called before play (another move first)
function runClip(part, name, rig, label, opt, pre, drawn = false) {
  rig.reset({ full: true });
  if (pre) pre(rig);
  try { rig.play(name, opt); } catch (e) { return; }
  const def = RIG_KIT.base(name), dur = name === 'botch' || name === 'flail' || name === 'vault' || name === 'advance' ? 3000 : durOf(def) + 40;
  for (let t = 0; t <= dur; t += DT * 1000) {
    rig.update(DT);
    if (rig.airborne) break;
    const p = rig.pose, J = drawn ? rig.joints : rig._solve(p);
    judge(part, label, J, rig.facing, rig.scale, p.spin || 0, `key ${rig.current.frame} t ${Math.round(t)}ms ${rig.charDef.id}`);
    if (rig.current.done && !(def && def.loop)) break;
  }
}

const t0 = Date.now();
let samples = 0;
const strikes = MOVES.filter((n) => MOVE_DATA[n] && MOVE_DATA[n].limb);

// ---- part 1: the clips, guard off ---------------------------------------------------------------------------------
setJointGuard(false);
for (const facing of [1, -1]) for (const c of chars) {
  const rig = rigOf(c, facing);
  for (const n of MOVES) { runClip('clip', n, rig, n); samples++; }
}
// adapt: reach retargets (punches lean, kicks ride the hips, the cross family steps) and aimed targets
for (const c of chars) {
  const rig = rigOf(c);
  for (const n of strikes) {
    const def = RIG_KIT.base(n), md = MOVE_DATA[n];
    if (!def.adapt || !md.reach) continue;
    for (const e of [-40, -20, 20, 40, 70]) { runClip('adapt', n, rig, `${n} (reach ${e > 0 ? '+' : ''}${e})`, { reach: md.reach + e }); samples++; }
    for (const [dx, dy] of [[0.7, -120], [1, -60], [1.3, -20], [0.9, -150]]) { runClip('adapt', n, rig, `${n} (target)`, { target: { x: 400 + md.reach * dx, y: 600 + dy } }); samples++; }
  }
}
// botches: the canned families, and the limb mixes off a move in progress (limbBlend.js)
{
  const rig = rigOf(chars[0]);
  const shared = strikes.filter((n) => !/_/.test(n)).slice(0, 40);
  for (const kind of ['over', 'spin', 'trip', 'whiff']) for (const sev of [1, 2, 3]) for (const alt of [0, 1, 2, 3]) {
    for (const anim of kind === 'whiff' ? shared : ['jab', 'roundhouse', 'lkick', 'cross']) {
      const limb = MOVE_DATA[anim].limb;
      const b = { kind, sev, alt, d: 30, limb, anim, rot: alt % 2 ? 1 : -1, fwd: alt > 1 };
      runClip('botch', 'botch', rig, `botch ${kind} (${anim})`, { botch: b }); samples++;
      for (const from of ['jab', 'roundhouse', 'lkick', 'spinKick']) for (const at of [60, 160]) {
        runClip('botch', 'botch', rig, `botch ${kind} mix (${anim} off ${from})`, { botch: b }, (r) => { r.play(from); for (let t = 0; t < at; t += 1000 / 120) r.update(1 / 120); }); samples++;
      }
    }
  }
  runClip('botch', 'flail', rig, 'flail', { botch: { alt: 1, sev: 2 } });
}
// the perfect finisher's local poses (the body in the hand, the flight's tumble, the glass)
{
  const rig = rigOf(chars[0]);
  for (const [k, p] of Object.entries(POSES)) judge('pose', `glass:${k}`, rig._solve(p), rig.facing, rig.scale, 0, 'src/fx/perfect.js POSES');
  for (let d = -120; d <= 120; d += 10) judge('pose', 'perfect carryPose', rig._solve(carryPose(d)), rig.facing, rig.scale, 0, `droop ${d}`);
}

// ---- part 2: what's drawn, guard on ---------------------------------------------------------------------------------
setJointGuard(true);
for (const c of chars) {
  const rig = rigOf(c);
  for (const n of MOVES) { runClip('drawn', n, rig, n, undefined, undefined, true); samples++; }
  // the additive hit reactions over a guard and a strike
  for (const r of ['hitBody', 'hitLight', 'headShake', 'electrician_shocked']) {
    if (!RIG_KIT.base(r)) continue;
    for (const base of ['idle', 'jab', 'roundhouse', 'block']) {
      runClip('drawn', base, rig, `${base} + react ${r}`, undefined, null, true);
      rig.reset({ full: true }); rig.play(base); rig.update(0.05); rig.react(r, { weight: 1, dir: 1 });
      for (let t = 0; t < 600; t += 1000 / 240) { rig.update(DT); judge('drawn', `${base} + react ${r}`, rig.joints, rig.facing, rig.scale, rig.pose.spin || 0, c.id); }
    }
  }
  // the point simulation: launched every which way, splatted on a wall, bounced off the floor, until it lies still
  for (const [vx, vy, spin, wall] of [[260, -620, 360, 'splat'], [-200, -800, -540, 'bounce'], [500, -300, 720, 'splat'], [60, -900, 200, 'bounce'], [0, -200, 0, 'splat']]) {
    for (const facing of [1, -1]) {
      rig.reset({ full: true }); rig.facing = facing; rig.walls = [100, 700]; rig.update(DT);
      rig.play('hitBody'); rig.update(0.05);
      rig.launch({ vx, vy, spin, wall });
      let bounced = false;
      for (let t = 0; t < 5; t += DT) {
        rig.update(DT);
        if (!bounced && t > 0.5 && rig.airborne) { rig.groundBounce(); bounced = true; }
        if (rig.airborne) judge('rag', `ragdoll (launch ${vx},${vy} spin ${spin} ${wall})`, rig.joints, rig._ragFacing(), rig.scale, 0, c.id);
        else { judge('rag', 'ragdoll -> knockdown fade', rig.joints, rig.facing, rig.scale, 0, c.id); }
        samples++;
      }
      rig.reset({ full: true }); rig.facing = facing; rig.walls = [100, 700]; rig.update(DT); rig.launch({ vx: 0, vy: 0, spin: 0 }); rig.wallSplat(facing);
      for (let t = 0; t < 3; t += DT) { rig.update(DT); if (rig.airborne) judge('rag', 'wall splat', rig.joints, rig._ragFacing(), rig.scale, 0, c.id); }
    }
  }
}
// the life layer: fatigue, the takes and habits on every character's signature, over idle, block and walk
{
  const life = createLife();
  for (const c of chars) for (const state of ['idle', 'block', 'walk', 'crouch']) for (const tired of [false, true]) {
    const rig = rigOf(c), opp = rigOf(chars[0], -1);
    opp.x = 700; rig.reset({ full: true }); opp.reset({ full: true });
    rig.play(state === 'crouch' ? (RIG_KIT.base('crouch') ? 'crouch' : 'idle') : state);
    const u = { id: 0, rig, char: c, state, facing: 1, x: rig.x, health: 100, stamina: tired ? 5 : 100, staminaMax: 100, hitstop: 0 };
    const o = { faint: 0, botchKind: null, id: 1, rig: opp, char: chars[0], state: 'idle', facing: -1, x: 700, health: 100, stamina: 100, staminaMax: 100, hitstop: 0, botchAt: -1, faintAt: -1 };
    const sim = { units: [u, o], phase: 'fight', hitstopActive: 0, winner: -1 };
    life.reset();
    for (let t = 0; t < 14; t += 1 / 60) {
      rig.update(1 / 60); opp.update(1 / 60);
      // a botch, a faint, a hit and a parry from the other side now and then, for the takes
      if (Math.abs(t - 3) < 0.01) { o.botchAt = 300; o.botchKind = 'whiff'; }
      if (Math.abs(t - 6) < 0.01) u.health -= 10;
      if (t > 8 && t < 9) { o.faint = 1; o.faintAt = 900; } else o.faint = 0;
      if (Math.abs(t - 11) < 0.01) { sim.phase = 'ko'; sim.winner = 0; }
      const M = life.apply(u, rig.joints, sim, 1 / 60);
      judge('life', `life layer (${state}${tired ? ', tired' : ''})`, M, 1, rig.scale, rig.pose.spin || 0, `${c.id} t ${t.toFixed(2)}s`);
      samples++;
    }
  }
}
// the perfect finisher's thrower turned toward the camera: judged while he's within 45 deg of the side view
for (const c of chars) {
  if (!c.perfect) continue;
  const rig = rigOf(c), def = RIG_KIT.base(c.perfect.clip);
  rig.reset({ full: true }); rig.play(c.perfect.clip);
  for (let t = 0; t < durOf(def) + 40; t += DT * 1000) {
    rig.update(DT);
    const T = rig.turnPoints(rig.joints), face = rig.turnNow().face;
    const sp = Math.abs(Math.sin((rig.pose.spin || 0) * Math.PI / 180));   // a spin under the turn is judged in part 1 (the turn's own perspective doesn't unsquash)
    if (T && face <= 0.5 && sp < 0.05) judge('turned', `${c.perfect.clip} (turned)`, T, rig.facing, rig.scale, rig.pose.spin || 0, `face ${face.toFixed(2)}`, 2);   // 2 deg: the perspective's own skew
  }
}

// ---- report ---------------------------------------------------------------------------------------------------------
const rows = [...found.values()].sort((a, b) => b.d - a.d);
const allowKey = (r) => `${r.name.replace(/ \(.*$/, '')} ${r.side}`;
const bad = rows.filter((r) => !ALLOW[allowKey(r)]), ok = rows.filter((r) => ALLOW[allowKey(r)]);
const fmt = (r) => `  ${r.part.padEnd(6)} ${(r.name + ' ' + r.side).padEnd(52)} ${(r.side[1] === 'l' ? 'knee' : 'elbow').padEnd(5)} ${r.v.toFixed(1).padStart(7)} deg (${r.d.toFixed(1)} past)  ${r.where}`;
if (SHOW_ALL && ok.length) { console.log(`allowlisted (${ok.length}):`); for (const r of ok) console.log(fmt(r) + `  -- ${ALLOW[allowKey(r)]}`); }
const unused = Object.keys(ALLOW).filter((k) => !ok.some((r) => allowKey(r) === k));
if (unused.length) console.log(`allowlist entries no longer needed: ${unused.join(', ')}`);
console.log(`joint limits: knee <= +${KNEE}, elbow >= ${ELBOW}; ${chars.length} bodies, ${MOVES.length} clips, ${samples} runs, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (bad.length) {
  console.log(`FAIL: ${bad.length} limb(s) bend the wrong way:`);
  for (const r of bad) console.log(fmt(r));
  process.exit(1);
}
console.log(`PASS (${ok.length} allowlisted)`);
