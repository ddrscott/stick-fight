// The perfect round finisher, drawn (README, Perfect rounds). The sim decides everything (sim.js startPerfect,
// perfectStep: who throws, when the body leaves the floor, when it's released, when it's over or skipped); this
// draws the body on its clock and never writes to the sim.
//
//   drawWorld(ctx, sim)               the figures layer, under the camera: the body in the winner's hand,
//                                     from the 'grab' key to the 'release' key, swinging on its grip
//   drawScreen(ctx, sim, camera, dt)  the HUD canvas in screen space (1280x720), under the HUD: the body
//                                     flying at the lens, the splat on the glass, the squeak down it and the
//                                     drop out of the bottom, with the crack, the smear and the stamp
//
// The body is the loser's own rig drawn with joints put together here (rig.draw with swapped joints, put back in
// a finally), so it keeps its colors, pants and accessories, and stays flat solid color: only the glass marks
// (the crack, the smear's streaks, the stamp) glow. Clock: frameData PERFECT, seconds after the release.

import { RIG_KIT } from '../fighter/index.js';
import { PERFECT } from '../combat/frameData.js';
import { mulberry32 } from '../combat/rng.js';

const { P } = RIG_KIT;
const W = 1280, H = 720;
const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// local poses: solved on the loser's rig, then taken relative to the hip with the facing taken out
const POSES = {
  hang: P({ torso: 0, bend: 6, head: 26, la: [8, 14], ra: [-6, 2], ll: [8, -2], rl: [-8, 4] }),
  ankle: P({ torso: 0, bend: -6, head: -14, la: [172, 178], ra: [186, 194], ll: [0, 0], rl: [36, 66] }),
  tumbleA: P({ torso: 10, bend: -10, head: -10, la: [150, 110], ra: [-70, -30], ll: [60, 100], rl: [-30, -70] }),
  tumbleB: P({ torso: -10, bend: 8, head: 10, la: [-60, -100], ra: [140, 180], ll: [-20, 20], rl: [70, 40] }),
  splat: P({ torso: 0, bend: 0, head: 0, la: [124, 136], ra: [-124, -136], ll: [26, 20], rl: [-26, -20] }),
  smear: P({ torso: 0, bend: 0, head: 8, la: [152, 168], ra: [-152, -168], ll: [16, 8], rl: [-16, -8] }),
  peel: P({ torso: 0, bend: 10, head: 24, la: [96, 60], ra: [-96, -60], ll: [12, 2], rl: [-12, -2] }),
};
// carried across the hands: the limbs hang toward the floor (droop: their angle in the body's frame)
const carryPose = (droop) => P({ torso: 0, bend: -4, head: -14, la: [droop + 12, droop + 22], ra: [droop - 10, droop], ll: [droop + 6, droop + 16], rl: [droop - 8, droop + 2] });

const cache = new WeakMap();   // rig -> { body, poses }
function localOf(rig, pose) {
  const s = rig.scale || 1, saveF = rig.facing, saveX = rig.x, saveY = rig.y;
  rig.facing = 1; rig.x = 0; rig.y = 0;
  let j;
  try { j = rig._solve(pose); } finally { rig.facing = saveF; rig.x = saveX; rig.y = saveY; }
  const o = {}, hx = j.hip.x, hy = j.hip.y;
  for (const k in j) o[k] = { x: j[k].x - hx, y: j[k].y - hy };
  o._s = s;
  return o;
}
function posesOf(rig) {
  const hit = cache.get(rig);
  if (hit && hit.body === rig.body && hit.scale === rig.scale) return hit.poses;
  const poses = {};
  for (const k in POSES) poses[k] = localOf(rig, POSES[k]);
  // the splat's box (head circle and limb ends), for sizing it to the screen
  const sp = poses.splat, r = (rig.radius || 15);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const k in sp) { if (k[0] === '_') continue; const e = k === 'head' ? r : 6 * (rig.scale || 1); x0 = Math.min(x0, sp[k].x - e); x1 = Math.max(x1, sp[k].x + e); y0 = Math.min(y0, sp[k].y - e); y1 = Math.max(y1, sp[k].y + e); }
  const c = center(sp);   // the box's middle relative to where a body is placed (between chest and hip)
  poses.box = { x0, x1, y0, y1, cx: (x0 + x1) / 2 - c.x, cy: (y0 + y1) / 2 - c.y, w: x1 - x0, h: y1 - y0 };
  cache.set(rig, { body: rig.body, scale: rig.scale, poses });
  return poses;
}
const KEYS = ['head', 'neck', 'chest', 'hip', 'lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lHand', 'rHand', 'lKnee', 'rKnee', 'lFoot', 'rFoot'];
function mix(a, b, t, out = {}) {
  for (const k of KEYS) { const p = a[k], q = b[k]; if (!p || !q) continue; out[k] = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }; }
  return out;
}
const center = (j) => ({ x: (j.chest.x + j.hip.x) / 2, y: (j.chest.y + j.hip.y) / 2 });
// place local joints: the grip point at G, turned by psi (radians, canvas sense), mirrored by side
function place(local, grip, psi, side, G, k = 1) {
  const c = Math.cos(psi), s = Math.sin(psi), out = {};
  for (const n of KEYS) {
    const p = local[n]; if (!p) continue;
    const x = (p.x - grip.x) * side * k, y = (p.y - grip.y) * k;
    out[n] = { x: G.x + x * c - y * s, y: G.y + x * s + y * c };
  }
  return out;
}
function drawBody(ctx, rig, joints) {
  const real = rig.joints, cloth = rig.cloth;
  rig.joints = joints; rig.cloth = null;
  ctx.save(); ctx.shadowBlur = 0;
  try { rig.draw(ctx); } catch (e) { /* a bad frame never breaks the game */ } finally { ctx.restore(); rig.joints = real; rig.cloth = cloth; }
}

export function createPerfectFX() {
  let show = null;   // this round's finisher, as seen from here

  function begin(sim, w, l) {
    const seed = ((sim.seed || 1) * 977 + sim.round * 131 + sim.winner * 17) >>> 0;
    show = { key: `${sim.seed}:${sim.round}:${sim.winner}:${sim.stepCount - Math.round(sim.perfectT * 120)}`, w, l, rng: mulberry32(seed),
      theta: 0, omega: 0, hand: null, vel: null, held: null, rel0: null, crack: null, streak: null, endAt: -1, lastTr: -1, shake: 0, seed };
    show.lines = Array.from({ length: 22 }, () => ({ a: show.rng() * TAU, r: 0.25 + show.rng() * 0.6, w: 1 + show.rng() * 2.5 }));
  }
  function current(sim) {
    if (!(sim.perfectT >= 0)) return show && show.endAt >= 0 ? show : null;
    const w = sim.units[sim.winner], l = w && sim.oppOf(w);
    if (!w || !l || !w.char || !w.char.perfect) return null;
    const key = `${sim.seed}:${sim.round}:${sim.winner}:${sim.stepCount - Math.round(sim.perfectT * 120)}`;
    if (!show || show.key !== key) begin(sim, w, l);
    show.endAt = -1;
    return show;
  }

  // ---- in the hand (world space, the figures layer) ---------------------------------------
  function drawWorld(ctx, sim, dt = 1 / 60) {
    const S = current(sim);
    if (!S || !(sim.perfectT >= 0)) return;
    const { w, l } = S, pf = w.char.perfect;
    if (!l.hidden || l.pfRel || !l.pfFrom || w.pfFar) return;   // on the floor (drawn as usual), or already thrown
    const poses = posesOf(l.rig), side = -w.facing;
    const h = w.rig.joints[pf.hand] || w.rig.joints.lHand, e = w.rig.joints[pf.hand.replace('Hand', 'Elbow')] || w.rig.joints.lElbow;
    dt = Math.min(1 / 30, Math.max(1 / 240, dt));
    // the hand's motion swings the body on its grip: a damped pendulum driven by the hand's acceleration
    const v = S.hand ? { x: (h.x - S.hand.x) / dt, y: (h.y - S.hand.y) / dt } : { x: 0, y: 0 };
    const a = S.vel ? { x: (v.x - S.vel.x) / dt, y: (v.y - S.vel.y) / dt } : { x: 0, y: 0 };
    S.hand = { x: h.x, y: h.y }; S.vel = v;
    const Lp = 50 * (l.rig.scale || 1), g = 1500, ax = Math.max(-9000, Math.min(9000, a.x)), ay = Math.max(-9000, Math.min(9000, a.y));
    S.omega += ((-(g + ay) * Math.sin(S.theta) - ax * Math.cos(S.theta)) / Lp - 4 * S.omega) * dt;
    S.theta = Math.max(-2.6, Math.min(2.6, S.theta + S.omega * dt));
    let J;
    if (pf.hold === 'carry') {
      // laid across the hands, head toward the way he faces, tipping a little with the forearm
      const fa = Math.atan2(h.y - e.y, h.x - e.x), tilt = Math.max(-0.35, Math.min(0.35, (fa + Math.PI / 2) * 0.25 * w.facing));
      const psi = (w.facing > 0 ? Math.PI / 2 : -Math.PI / 2) + tilt;
      const droop = side > 0 ? psi * 180 / Math.PI : -psi * 180 / Math.PI;
      const local = localOf(l.rig, carryPose(droop)), c = center(local);
      J = place(local, { x: c.x - 10 * side, y: c.y }, psi, side, { x: h.x, y: h.y - 4 });
    } else if (pf.hold === 'ankle') {
      J = place(poses.ankle, poses.ankle.lFoot, Math.PI - S.theta, side, h);
    } else {
      J = place(poses.hang, poses.hang.neck, -S.theta, side, { x: h.x, y: h.y + 4 });
    }
    // it comes up off the floor over the first moments
    const k = smooth(0, 0.2, sim.perfectT - (l.pfGrabT >= 0 ? l.pfGrabT : sim.perfectT));
    if (k < 1) J = mix(l.pfFrom, J, k);
    S.held = J;
    drawBody(ctx, l.rig, J);
  }

  // ---- at the glass (screen space, under the HUD) -----------------------------------------
  function toScreen(p, cam) {
    const z = cam.zoom, m = cam.mirror ? -1 : 1;
    return { x: W / 2 + m * (p.x - (cam.x + (cam.shakeX || 0))) * z, y: H / 2 + (p.y - (cam.y + (cam.shakeY || 0))) * z };
  }
  function makeCrack(S, cx, cy) {
    const rng = mulberry32(S.seed ^ 0x5bd1), rays = [], n = 11;
    for (let i = 0; i < n; i++) {
      let a = (i / n) * TAU + (rng() - 0.5) * 0.4, x = cx, y = cy;
      const len = 150 + rng() * 300, segs = 4 + Math.floor(rng() * 3), pts = [{ x, y }];
      for (let s = 0; s < segs; s++) { a += (rng() - 0.5) * 0.5; const d = len / segs * (0.7 + rng() * 0.6); x += Math.cos(a) * d; y += Math.sin(a) * d; pts.push({ x, y }); }
      rays.push(pts);
    }
    const rings = [];
    for (const r of [0.22, 0.45]) for (let i = 0; i < n; i++) {
      if (rng() < 0.3) continue;
      const p = rays[i], q = rays[(i + 1) % n], ip = Math.max(1, Math.round(r * (p.length - 1))), iq = Math.max(1, Math.round(r * (q.length - 1)));
      rings.push([p[ip], q[iq]]);
    }
    return { rays, rings, cx, cy };
  }
  function drawCrack(ctx, C, grow, alpha) {
    if (!C || alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    // the smudge where it hit: a soft pale blot
    const g = ctx.createRadialGradient(C.cx, C.cy, 0, C.cx, C.cy, 230);
    g.addColorStop(0, 'rgba(235,250,255,0.16)'); g.addColorStop(1, 'rgba(235,250,255,0)');
    ctx.fillStyle = g; ctx.fillRect(C.cx - 240, C.cy - 240, 480, 480);
    ctx.strokeStyle = 'rgba(225,250,255,0.92)'; ctx.shadowColor = '#9ff4ff'; ctx.shadowBlur = 10; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const pts of C.rays) {
      const m = Math.max(1, Math.round((pts.length - 1) * grow));
      ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i <= m; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    if (grow >= 1) { ctx.lineWidth = 1.6; ctx.beginPath(); for (const [p, q] of C.rings) { ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); } ctx.stroke(); }
    ctx.restore();
  }
  function drawStamp(ctx, text, color, x, y, age, alpha) {
    if (!text || alpha <= 0) return;
    const pop = 1 + Math.max(0, 0.5 - age * 3);
    ctx.save();
    ctx.globalAlpha = alpha * 0.92; ctx.translate(x, y); ctx.rotate(-0.17); ctx.scale(pop, pop);
    const size = text.length > 12 ? 30 : 40;
    ctx.font = `${size}px Bungee, Impact, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = (ctx.measureText ? ctx.measureText(text).width : size * text.length * 0.7) + 34, th = size * 1.5;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.lineWidth = 4;
    ctx.strokeRect(-tw / 2, -th / 2, tw, th);
    ctx.lineWidth = 1.5; ctx.strokeRect(-tw / 2 + 6, -th / 2 + 6, tw - 12, th - 12);
    ctx.fillText(text, 0, 2);
    ctx.restore();
  }
  function drawSpeedLines(ctx, S, u, color) {
    ctx.save();
    ctx.globalAlpha = 0.55 * smooth(0.05, 0.6, u) * (1 - smooth(0.9, 1, u));
    ctx.strokeStyle = '#ffffff'; ctx.lineCap = 'round';
    const R = Math.hypot(W, H) / 2;
    for (const ln of S.lines) {
      const r0 = R * lerp(ln.r, ln.r * 0.35, u), r1 = r0 + R * (0.25 + 0.45 * u);
      ctx.lineWidth = ln.w;
      ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(ln.a) * r0, H / 2 + Math.sin(ln.a) * r0); ctx.lineTo(W / 2 + Math.cos(ln.a) * r1, H / 2 + Math.sin(ln.a) * r1); ctx.stroke();
    }
    ctx.globalAlpha *= 0.4; ctx.strokeStyle = color;
    for (let i = 0; i < S.lines.length; i += 3) { const ln = S.lines[i], r0 = R * ln.r * (1 - u * 0.5); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(ln.a + 0.05) * r0, H / 2 + Math.sin(ln.a + 0.05) * r0); ctx.lineTo(W / 2 + Math.cos(ln.a + 0.05) * (r0 + R * 0.5), H / 2 + Math.sin(ln.a + 0.05) * (r0 + R * 0.5)); ctx.stroke(); }
    ctx.restore();
  }
  // the slide's stick-slip: always going down, in jerks (velocity 1 -/+ 0.85), the squeak keys off the same beat
  const stick = (t, n = 6) => { const s = Math.pow(clamp01(t), 1.15); return s - 0.85 * Math.sin(TAU * n * s) / (TAU * n); };

  // body on screen: local joints placed around (cx, cy) at scale k, turned by rot, squashed kx/ky in screen axes
  function drawScreenBody(ctx, rig, local, cx, cy, k, rot, side, kx = 1, ky = 1, alpha = 1) {
    if (alpha <= 0) return;
    const c = center(local), J = place(local, c, rot, side, { x: 0, y: 0 });
    ctx.save();
    ctx.globalAlpha = alpha; ctx.translate(cx, cy); ctx.scale(k * kx, k * ky);
    drawBody(ctx, rig, J);
    ctx.restore();
  }

  function drawScreen(ctx, sim, camera, dt = 1 / 60) {
    const S = current(sim);
    if (!S) return;
    const { w, l } = S, pf = w.char.perfect, fly = pf.fly, slide = pf.slide;
    const running = sim.perfectT >= 0;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    if (!running && S.endAt < 0) S.endAt = now;
    let tr = running ? (sim.perfectRel >= 0 ? sim.perfectT - sim.perfectRel : -1) : S.lastTr;
    if (running) S.lastTr = tr;
    const fade = running ? 1 : 1 - clamp01((now - S.endAt) / 0.45);
    if (fade <= 0) { show = null; return; }
    if (tr < 0) return;   // not thrown yet: the hand has it (drawWorld)
    const poses = posesOf(l.rig), box = poses.box, side = (-w.facing) * (camera.mirror ? -1 : 1);
    const S1 = (H * 0.92) / box.h, target = { x: W / 2, y: H * 0.5 };
    // the throw's start: where the hand let go, as big as the world draws it
    if (!S.rel0) {
      const from = S.held || l.pfFrom || poses.hang;
      const c = center(from), local = {};
      for (const k of KEYS) if (from[k]) local[k] = { x: (from[k].x - c.x) * (camera.mirror ? -1 : 1) * side, y: from[k].y - c.y };
      S.rel0 = { local, p0: toScreen(l.pfRel || c, camera), s0: camera.zoom };
    }
    const { p0, s0 } = S.rel0;
    const spin = Math.round(fly.spin || 0), flip = Math.round(fly.flip || 0);
    ctx.save();
    // the overlay's own shake on the hit (the world shakes too: main.js on perfectSplat)
    const tau = tr - PERFECT.fly;
    if (tau >= 0 && tau < 0.5) { const a = 26 * Math.exp(-tau * 9); ctx.translate((S.rng() - 0.5) * a, (S.rng() - 0.5) * a); }
    const marks = (tau >= 0 ? 1 : 0) * fade * (running ? 1 - smooth(PERFECT.after - 0.15, PERFECT.after + 0.3, tr) * 0.5 : 1);
    // the smear: a pale band from where it hit down to where it is, with streaks from the hands and head
    if (S.streak && tr >= PERFECT.slide) {
      const st = S.streak;
      ctx.save(); ctx.globalAlpha = marks;
      if (!slide.squeegee) {
        const gr = ctx.createLinearGradient(0, st.y0, 0, st.y1 + 1);
        gr.addColorStop(0, 'rgba(240,250,255,0.03)'); gr.addColorStop(1, 'rgba(240,250,255,0.13)');
        ctx.fillStyle = gr; ctx.fillRect(Math.min(st.x0, st.x1) - st.w / 2, st.y0, Math.abs(st.x1 - st.x0) + st.w, Math.max(0, st.y1 - st.y0));
      }
      ctx.strokeStyle = slide.squeegee ? 'rgba(160,240,255,0.55)' : 'rgba(255,255,255,0.45)'; ctx.shadowColor = slide.squeegee ? '#9ff4ff' : l.color || '#fff'; ctx.shadowBlur = 8; ctx.lineCap = 'round';
      for (const tr0 of st.tracks) { ctx.lineWidth = tr0.w; ctx.beginPath(); ctx.moveTo(tr0.a.x, tr0.a.y); ctx.lineTo(tr0.b.x, tr0.b.y); ctx.stroke(); }
      ctx.restore();
    }
    let cx, cy, k, rot = 0, kx = 1, ky = 1, local, alpha = fade;
    if (tr < PERFECT.fly) {
      // in flight: depth closes linearly, so it grows the way a thing coming at you does
      const u = clamp01(tr / PERFECT.fly), s1 = S1, d1 = s0 / s1;
      k = s0 / (1 + (d1 - 1) * u);
      const kk = clamp01((k - s0) / (s1 - s0));
      const endC = { x: target.x - box.cx * s1 * side, y: target.y - box.cy * s1 };
      cx = lerp(p0.x, endC.x, kk); cy = lerp(p0.y, endC.y, kk) - (fly.arc || 0) * Math.sin(Math.PI * kk) * (1 - kk * 0.3);
      const e = 1 - Math.pow(1 - u, 1.6);
      rot = -TAU * spin * (1 - e) * side + (fly.wobble || 0) * 0.35 * Math.sin(u * 22) * (1 - u);
      if (flip) ky = Math.cos(TAU * flip * e);
      const tumble = mix(poses.tumbleA, poses.tumbleB, 0.5 + 0.5 * Math.sin(tr * 26));
      local = mix(mix(S.rel0.local, tumble, smooth(0, 0.35, u)), poses.splat, smooth(0.55, 1, u));
      drawSpeedLines(ctx, S, u, l.color || '#fff');
      // motion blur: two fading copies a moment behind
      for (const [lag, al] of [[0.1, 0.14], [0.05, 0.26]]) {
        const ub = u - lag; if (ub <= 0.05) continue;
        const kb = s0 / (1 + (d1 - 1) * ub), kkb = clamp01((kb - s0) / (s1 - s0));
        const bx = lerp(p0.x, endC.x, kkb), by = lerp(p0.y, endC.y, kkb) - (fly.arc || 0) * Math.sin(Math.PI * kkb) * (1 - kkb * 0.3);
        drawScreenBody(ctx, l.rig, local, bx, by, kb, rot + 0.25 * spin * side * lag * 8, side, 1, ky, al * fade);
      }
    } else {
      const sp = poses.splat;
      const c0 = { x: target.x - box.cx * S1 * side, y: target.y - box.cy * S1 };
      if (!S.crack) S.crack = makeCrack(S, target.x, target.y);
      k = S1; cx = c0.x; cy = c0.y; local = sp;
      // the hit: squashed flat and splayed, wobbling back
      const wob = Math.exp(-tau * 12) * Math.cos(tau * 46);
      kx = 1.07 + 0.14 * wob; ky = 0.94 - 0.1 * wob;
      if (slide.blink && tau < 0.36) alpha *= (tau > 0.06 && tau < 0.13) || (tau > 0.2 && tau < 0.26) ? 0 : 1;   // off and on again
      if (tr >= PERFECT.slide) {
        const ts = clamp01((tr - PERFECT.slide) / (PERFECT.drop - PERFECT.slide)), m = stick(ts) * (slide.rate || 1);
        cy += H * 0.38 * m; cx += (slide.dx || 0) * m * side;
        local = mix(sp, poses.smear, smooth(0, 0.6, ts));
        ky = 0.93; kx = 1.07;
        // the streaks follow the hands and the head from where they stuck
        const cc = center(local), at = (n) => ({ x: cx + (local[n].x - cc.x) * side * k * kx, y: cy + (local[n].y - cc.y) * k * ky });
        if (!S.streak) S.streak = { y0: cy - box.h * S1 * 0.2, x0: cx, w: box.w * S1 * 0.42, from: { lHand: at('lHand'), rHand: at('rHand'), head: at('head') } };
        const st = S.streak;
        st.x1 = cx; st.y1 = cy - box.h * S1 * 0.2;
        st.tracks = [['lHand', 7], ['rHand', 7], ['head', 12]].map(([n, wd]) => ({ a: st.from[n], b: at(n), w: wd }));
      }
      if (tr >= PERFECT.drop) {
        // it peels off the glass and drops out of the bottom
        const td = clamp01((tr - PERFECT.drop) / (PERFECT.after - PERFECT.drop));
        if (slide.chute) { cy += H * 0.75 * Math.pow(td, 1.3); cx += 40 * Math.sin(td * 7) * side; }
        else cy += H * 1.1 * td * td;
        rot = 0.4 * td * side; k *= 1 - 0.18 * td; kx = lerp(kx, 1, td); ky = lerp(ky, 1, td);
        local = mix(local, poses.peel, smooth(0, 0.5, td));
      }
      // the parachute (THE CEO's): a canopy in the winner's accent, flat, opening as it starts to slide
      if (slide.chute && tr >= PERFECT.slide) {
        const op = smooth(PERFECT.slide, PERFECT.slide + 0.3, tr), cw = box.w * k * 0.75 * op, top = cy - box.h * k * 0.55 - 70 * op;
        const cc = center(local), hand = (n) => ({ x: cx + (local[n].x - cc.x) * side * k * kx, y: cy + (local[n].y - cc.y) * k * ky });
        ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = w.rig.accent || w.color || '#ffd23f'; ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(cx, top, Math.max(1, cw), Math.max(1, cw * 0.45), 0, Math.PI, 0); ctx.closePath(); ctx.fill();
        for (const n of ['lHand', 'rHand']) { const p = hand(n); ctx.beginPath(); ctx.moveTo(cx + (n === 'lHand' ? -cw : cw) * side, top); ctx.lineTo(p.x, p.y); ctx.stroke(); }
        ctx.restore();
      }
    }
    drawScreenBody(ctx, l.rig, local, cx, cy, k, rot, side, kx, ky, alpha);
    // the squeegee (WINDOW WASHER's): a blade across the top of the body, pushing it along the glass
    if (slide.squeegee && tr >= PERFECT.slide && tr < PERFECT.drop + 0.1) {
      const bw = box.w * k * 0.7, by = cy - box.h * k * 0.52;
      ctx.save(); ctx.globalAlpha = fade; ctx.fillStyle = w.rig.accent || w.color || '#fff'; ctx.strokeStyle = w.color || '#fff'; ctx.lineWidth = 10; ctx.lineCap = 'square';
      ctx.fillRect(cx - bw / 2, by - 10, bw, 20);
      ctx.beginPath(); ctx.moveTo(cx, by - 10); ctx.lineTo(cx - 60 * side, by - 140); ctx.stroke();
      ctx.restore();
    }
    // on the glass, over the body: the crack, a white flash on the hit, the stamp
    if (S.crack) {
      drawCrack(ctx, S.crack, smooth(0, 0.07, tau), marks);
      if (tau < 0.2) { ctx.save(); ctx.globalAlpha = 0.5 * Math.exp(-tau * 16) * fade; ctx.fillStyle = '#fff'; ctx.fillRect(-40, -40, W + 80, H + 80); ctx.restore(); }
      drawStamp(ctx, pf.stamp, w.color || '#2ef2ff', W * 0.74, H * 0.72, tau, marks);
    }
    ctx.restore();
  }

  return { drawWorld, drawScreen, reset() { show = null; }, get active() { return !!show; } };
}
