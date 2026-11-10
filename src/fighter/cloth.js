// Cloth: the short chains that hang off a fighter (a tie, a lanyard, an apron's hem, a ponytail), drawn only.
// A character lists them as `cloth: [...]` (src/characters/; README, Adding a character). Each item is a chain of
// 1 to 5 segments anchored on the body. This module is the shared geometry and physics:
//   - clothRest(): where a chain hangs at rest. The rig draws that whenever the life layer hasn't handed it a live
//     chain (?life=0, the character select, the fighter pages' move cards, the build's roster sprites).
//   - clothStep(): one rendered frame of a chain for the life layer (src/fighter/life.js): verlet points pulled
//     toward the rest shape (the first link stiffest, so the end lags the middle), gravity, damping against the
//     anchor's motion plus a little air drag, a hit's kick, then constraints so it never stretches, never bends
//     past its limit and never passes through the body.
// Nothing here is sim state: it never touches the rig's pose, the hitboxes, rollback or NET_VERSION, and it may
// use Math (only the sim needs dmath).

// every field an item may give (lengths and offsets in px at rig scale 1)
//   axis     [a, b] two joints: the body frame. "down" runs from a to b, "forward" is the facing side of it.
//   at, off  the anchor: at of the way from a to b, then off[0] px forward and off[1] px down
//   dir      the rest direction in that frame, [forward, down] (one for every segment: an array of pairs), or
//            a function (J, facing, fr) returning a world unit vector
//   hang     0..1: how far the rest direction leans toward plain world down (0: it lies along the body)
//   len, seg total length and segment count, or len as an array of segment lengths
//   hz       how stiffly it holds its rest shape (the first link; the last is 55% of it)
//   damping  how fast a swing dies, relative to the anchor (0.2 loose, 0.6 heavy cloth)
//   air      drag against moving through the air, 1/s (a run streams it back a little)
//   gravity  px/s^2 at scale 1
//   side     'front' or 'back': kept clear of the body line through axis (clear px off it), or null
//   limit    radians a segment may swing away from its rest direction
//   push     joints whose thigh (hip to that joint) pushes the chain aside, pushR px wide (an apron's hem)
//   end      a joint the last point is pinned to (a phone cord between the hip and the hand), or null
//   kick     how hard a hit flings it (1 = the default)
//   layer    'front' (over the chest, after the head) or 'back' (behind the far arm, the body and the head)
//   draw     (ctx, P, o): P the chain's points [{ x, y }], anchor first; o { scale, facing, color, accent, R, headR, pose, J }
const DEF = {
  axis: ['neck', 'chest'], at: 0, off: [0, 0], dir: [0, 1], hang: 0, len: 20, seg: 3,
  hz: 2, damping: 0.35, air: 1.2, gravity: 300, side: null, clear: 2, limit: 2.4, push: null, pushR: 7,
  end: null, kick: 1, layer: 'front', draw: null,
};
const norm = new WeakMap();
/** an item with every default filled in (cached per item) */
export function clothItem(raw) {
  let v = norm.get(raw);
  if (!v) { v = { ...DEF, ...raw }; norm.set(raw, v); }
  return v;
}

/** the body frame of an item: the axis' start, down and forward unit vectors (facing may be eased, -1..1) */
export function clothFrame(it, J, facing) {
  const A = J[it.axis[0]], B = J[it.axis[1]];
  if (!A || !B) return null;
  const vx = B.x - A.x, vy = B.y - A.y, L = Math.hypot(vx, vy) || 1, dx = vx / L, dy = vy / L;
  return { A, B, vx, vy, dx, dy, fx: dy * facing, fy: -dx * facing };
}

function lensOf(it, sc) {
  if (Array.isArray(it.len)) return it.len.map((l) => l * sc);
  const n = Math.max(1, it.seg | 0), out = [];
  for (let i = 0; i < n; i++) out.push(it.len / n * sc);
  return out;
}

function dirOf(it, i, J, facing, fr) {
  if (typeof it.dir === 'function') return it.dir(J, facing, fr);
  const d = Array.isArray(it.dir[0]) ? it.dir[Math.min(i, it.dir.length - 1)] : it.dir;
  let x = fr.fx * d[0] + fr.dx * d[1], y = fr.fy * d[0] + fr.dy * d[1];
  if (it.hang) { x *= 1 - it.hang; y = y * (1 - it.hang) + it.hang; }
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

/** where an item hangs at rest: its points, anchor first (world px); null when its joints are missing */
export function clothRest(raw, J, facing, sc, lens) {
  const it = clothItem(raw), fr = clothFrame(it, J, facing);
  if (!fr) return null;
  lens = lens || lensOf(it, sc);
  const ax = fr.A.x + fr.vx * it.at + (fr.fx * it.off[0] + fr.dx * it.off[1]) * sc;
  const ay = fr.A.y + fr.vy * it.at + (fr.fy * it.off[0] + fr.dy * it.off[1]) * sc;
  const P = [{ x: ax, y: ay }];
  const E = it.end && J[it.end];
  if (E) {   // pinned at both ends: a sagging line between them
    const total = lens.reduce((a, b) => a + b, 0), d = Math.hypot(E.x - ax, E.y - ay);
    const sag = Math.sqrt(Math.max(0, total * total - d * d)) * 0.5;
    for (let i = 1; i <= lens.length; i++) {
      const t = i / lens.length;
      P.push({ x: ax + (E.x - ax) * t, y: ay + (E.y - ay) * t + sag * Math.sin(Math.PI * t) });
    }
    return P;
  }
  let x = ax, y = ay;
  for (let i = 0; i < lens.length; i++) {
    const u = dirOf(it, i, J, facing, fr);
    x += u.x * lens[i]; y += u.y * lens[i];
    P.push({ x, y });
  }
  return P;
}

const H = 1 / 240, MAX_STEPS = 14;
const ease = (v, target, dt, tau) => v + (target - v) * (1 - Math.exp(-dt / tau));

/**
 * One rendered frame of a chain. st is the chain's own state (an empty object to begin), facing the unit's,
 * dt real seconds (0: frozen), kick { x, y } px/s at the free end or null. Returns the points to draw.
 */
export function clothStep(st, raw, J, facing, sc, dt, kick) {
  const it = clothItem(raw);
  if (st.fs == null) st.fs = facing;
  // the facing eases across a turn, so the rest shape (and the body line it keeps clear of) swings round
  // instead of mirroring in one frame
  if (dt > 0) st.fs = ease(st.fs, facing, dt, 0.07);
  const lens = st.lens || (st.lens = lensOf(it, sc));
  const R = clothRest(it, J, st.fs, sc, lens);
  if (!R) return null;
  const n = lens.length;
  if (!st.P || Math.hypot(R[0].x - st.ax, R[0].y - st.ay) > 120 * sc) {   // first frame, or a respawn: hang at rest
    st.P = R.map((p) => ({ x: p.x, y: p.y, px: p.x, py: p.y }));
    st.ax = R[0].x; st.ay = R[0].y; st.acc = 0;
    return st.P;
  }
  const P = st.P;
  if (dt <= 0) return P;
  if (kick) for (let i = 1; i <= n; i++) { const k = (i / n) * it.kick * H; P[i].px -= kick.x * k; P[i].py -= kick.y * k; }
  st.acc = Math.min(st.acc + dt, MAX_STEPS * H);
  const steps = Math.floor(st.acc / H);
  if (!steps) return P;   // a very fast display: wait for a whole step (the anchor's move is kept for it)
  st.acc -= steps * H;
  const w0 = 2 * Math.PI * it.hz, air = Math.exp(-it.air * H), g = it.gravity * sc * H * H;
  const sdx = (R[0].x - st.ax) / steps, sdy = (R[0].y - st.ay) / steps;   // the anchor's move per step
  const E = it.end && J[it.end];
  const fr = clothFrame(it, J, Math.sign(st.fs) || 1);
  const sideN = it.side && Math.abs(st.fs) > 0.85 ? (it.side === 'back' ? -1 : 1) : 0;
  const clear = it.clear * sc, maxV = 1800 * sc * H;
  for (let k = 1; k <= steps; k++) {
    const ax = st.ax + sdx * k, ay = st.ay + sdy * k;
    P[0].x = ax; P[0].y = ay;
    for (let i = 1; i <= n; i++) {
      const p = P[i], t = n > 1 ? (i - 1) / (n - 1) : 0;
      const w = w0 * (1 - 0.45 * t), damp = Math.exp(-2 * it.damping * w * H);
      let vx = p.x - p.px, vy = p.y - p.py;
      let rx = (vx - sdx) * damp, ry = (vy - sdy) * damp;
      const rl = Math.hypot(rx, ry);
      if (rl > maxV) { rx *= maxV / rl; ry *= maxV / rl; }
      vx = (sdx + rx) * air; vy = (sdy + ry) * air;
      const tx = ax + R[i].x - R[0].x, ty = ay + R[i].y - R[0].y;
      p.px = p.x; p.py = p.y;
      p.x += vx + w * w * (tx - p.x) * H * H;
      p.y += vy + w * w * (ty - p.y) * H * H + g;
    }
    // the body: off its line through the axis (front or back), and out of a thigh's way
    if (sideN && fr) {
      const nx = fr.fx * sideN, ny = fr.fy * sideN;
      for (let i = 1; i <= n; i++) {
        const p = P[i], s = (p.x - fr.A.x) * nx + (p.y - fr.A.y) * ny;
        if (s < clear) { p.x += (clear - s) * nx; p.y += (clear - s) * ny; }
      }
    }
    if (it.push && J.hip) {
      const r = it.pushR * sc;
      for (const jn of it.push) {
        const K = J[jn];
        if (!K) continue;
        const ex = K.x - J.hip.x, ey = K.y - J.hip.y, el = ex * ex + ey * ey || 1;
        for (let i = 1; i <= n; i++) {
          const p = P[i], u = Math.max(0, Math.min(1, ((p.x - J.hip.x) * ex + (p.y - J.hip.y) * ey) / el));
          const qx = p.x - (J.hip.x + ex * u), qy = p.y - (J.hip.y + ey * u), ql = Math.hypot(qx, qy);
          if (ql < r && ql > 1e-3) { p.x += qx / ql * (r - ql); p.y += qy / ql * (r - ql); }
        }
      }
    }
    if (E) {
      // pinned at both ends (FABRIK): from the free end back, then from the anchor out; never stretched past
      // its length, and pulled straight when the hand reaches farther than the cord
      const total = lens.reduce((a, b) => a + b, 0), d = Math.hypot(E.x - ax, E.y - ay), stretch = d > total ? d / total : 1;
      for (let pass = 0; pass < 2; pass++) {
        P[n].x = E.x; P[n].y = E.y;
        for (let i = n - 1; i >= 1; i--) seat(P[i], P[i + 1], lens[i] * stretch);
        for (let i = 1; i <= n; i++) seat(P[i], P[i - 1], lens[i - 1] * stretch);
      }
    } else {
      // follow the leader from the anchor: exact lengths, and no segment swings past its limit from rest
      for (let i = 1; i <= n; i++) {
        const a = P[i - 1], p = P[i], L = lens[i - 1];
        let ux = p.x - a.x, uy = p.y - a.y; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
        let rx = R[i].x - R[i - 1].x, ry = R[i].y - R[i - 1].y; const rl = Math.hypot(rx, ry) || 1; rx /= rl; ry /= rl;
        const ang = Math.atan2(rx * uy - ry * ux, rx * ux + ry * uy);
        if (Math.abs(ang) > it.limit) {
          const c = Math.cos(it.limit), sn = Math.sin(it.limit) * Math.sign(ang);
          ux = rx * c - ry * sn; uy = rx * sn + ry * c;
        }
        p.x = a.x + ux * L; p.y = a.y + uy * L;
      }
    }
  }
  st.ax = R[0].x; st.ay = R[0].y;
  return P;
}
function seat(p, q, L) {
  const dx = p.x - q.x, dy = p.y - q.y, l = Math.hypot(dx, dy) || 1;
  p.x = q.x + dx / l * L; p.y = q.y + dy / l * L;
}

// ---- drawing helpers for the characters' cloth draws (flat color: nothing on a fighter glows)

/** a smooth path through the points (quadratic through the midpoints), from an optional fixed start */
export function chainPath(ctx, P, from) {
  ctx.beginPath();
  const pts = from ? [from, ...P] : P;
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) { ctx.lineTo(pts[1].x, pts[1].y); return; }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, i === pts.length - 2 ? pts[i + 1].x : mx, i === pts.length - 2 ? pts[i + 1].y : my);
  }
}

/** the unit normal at point i of a chain (the average of its segments' normals), turned to the facing side */
export function chainNormal(P, i, facing) {
  const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  return { x: dy / l * facing, y: -dx / l * facing };
}

/** a ribbon along the chain, half width w(i, t) at each point (t 0 at the anchor, 1 at the end); point: end in a tip */
export function ribbonPath(ctx, P, facing, w, point) {
  const n = P.length - 1, L = [], Rt = [];
  for (let i = 0; i <= n; i++) {
    const nm = chainNormal(P, i, facing), hw = w(i / n);
    if (point && i === n) {
      // the blade's shoulders a width short of the end, then the tip
      const ux = P[n].x - P[n - 1].x, uy = P[n].y - P[n - 1].y, ul = Math.hypot(ux, uy) || 1, b = hw * 0.75;
      L.push({ x: P[n].x - ux / ul * b + nm.x * hw, y: P[n].y - uy / ul * b + nm.y * hw });
      Rt.push({ x: P[n].x - ux / ul * b - nm.x * hw, y: P[n].y - uy / ul * b - nm.y * hw });
      L.push({ x: P[n].x, y: P[n].y });
      continue;
    }
    L.push({ x: P[i].x + nm.x * hw, y: P[i].y + nm.y * hw });
    Rt.push({ x: P[i].x - nm.x * hw, y: P[i].y - nm.y * hw });
  }
  ctx.beginPath();
  ctx.moveTo(L[0].x, L[0].y);
  for (let i = 1; i < L.length; i++) ctx.lineTo(L[i].x, L[i].y);
  for (let i = Rt.length - 1; i >= 0; i--) ctx.lineTo(Rt[i].x, Rt[i].y);
  ctx.closePath();
}

/** the point t (0..1) of the way along a chain, by length */
export function chainAt(P, t) {
  let total = 0;
  const seg = [];
  for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y); seg.push(l); total += l; }
  let d = t * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) { const k = seg[i] ? Math.min(1, d / seg[i]) : 0; return { x: P[i].x + (P[i + 1].x - P[i].x) * k, y: P[i].y + (P[i + 1].y - P[i].y) * k, i }; }
    d -= seg[i];
  }
  return { x: P[0].x, y: P[0].y, i: 0 };
}

/** a coiled cord along a chain: turns per px of length, amp px each side */
export function coilPath(ctx, P, perPx, amp) {
  ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y);
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i], cx = b.x - a.x, cy = b.y - a.y, cl = Math.hypot(cx, cy) || 1, nx = -cy / cl, ny = cx / cl;
    const half = Math.max(1, Math.round(cl * perPx * 2));
    for (let j = 1; j <= half; j++) { const t = j / half, w = (j % 2 ? 1 : -1) * amp * (j === half ? 0 : 1); ctx.lineTo(a.x + cx * t + nx * w, a.y + cy * t + ny * w); }
  }
  ctx.stroke();
}
