// Particle system: sparks, debris, dust, motes, rain, trails. Pure JS, builds one
// vertex array per frame for the GL particle program. Deterministic given the RNG.

export const SHAPE = { SOFT: 0, POLY: 1, STREAK: 2, DISC: 3, RING: 4, CHUNK: 5 };
export const BEHIND = 10; // add to a shape code to render it behind the figures
const FLOATS_PER_VERT = 9; // x y u v r g b a shape
const MAX_PARTICLES = 4000;
const MAX_SPARKS = 60;      // live hit sparks across every hit on screen
const SPARK_REACH = 250;    // px from the contact point; a spark past it is gone

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createParticles() {
  let rnd = mulberry32(1);
  const parts = [];
  const verts = new Float32Array(MAX_PARTICLES * 6 * FLOATS_PER_VERT);
  let rainRate = 0, rainWind = -0.08, rainAccum = 0, rainRegion = null;
  let moteTarget = 0;
  let moteCount = 0;
  // scratch for build(): screen points (toScreen(x, y, out) writes into out) and a light sample, so a frame's
  // particles make no garbage
  const S = Array.from({ length: 6 }, () => [0, 0]), Lbuf = [0, 0, 0];

  const sys = {
    ground: 640,
    floors: null,         // optional [{x0,x1,y}] for bounce; ground is the fallback
    bounds: { x0: -200, x1: 1480, y0: -200, y1: 920 },
    lightAt: () => [1, 1, 1],
    seed(n) { rnd = mulberry32(n); },
    get count() { return parts.length; },
    rnd: () => rnd(),
    clear() { parts.length = 0; moteCount = 0; rainAccum = 0; },
    // region: optional world rect {x0,x1,y0,y1}. Rain then spawns along its top edge, falls inside it,
    // drifts with the wind, dies the moment it crosses a side, and splashes on its bottom edge. Each
    // streak is clipped to the rect when drawn, so nothing shows outside it.
    setRain(rate, wind, region) { rainRate = rate; if (wind !== undefined) rainWind = wind; rainRegion = region || null; },
    setMotes(n) { moteTarget = n; },
    push(p) { if (parts.length < MAX_PARTICLES) parts.push(p); },

    hit({ x, y, strength = 1, dir = 1, color = null, flashR = 36, debris, maxDebris = 60, ring = true }) {
      const s = Math.max(0.15, Math.min(2, strength));
      const style = debris || 'none'; // chunks only when a caller asks for them: a body hit sheds nothing
      const ss = Math.max(0, Math.min(1, (s - 0.55) / 0.45)); const smokeK = ss * ss * (3 - 2 * ss); // 0 below a heavy hit, 1 at a KO
      const R = Math.max(8, flashR); // radius of the flash core at full size; default stays smaller than a figure
      const dx = typeof dir === 'number' ? dir : (dir && dir.x) || 1;
      const dy = typeof dir === 'number' ? 0 : (dir && dir.y) || 0;
      const base = Math.atan2(dy, dx);
      // Core flash: a small hot blob at the contact point, behind the bodies, gone in a few frames.
      // The warm core does not scale down with strength: a jab still shows a contact flash. The contact
      // point is usually on a body, so a small core sits on top of the figures and a wider glow behind them.
      sys.push({ kind: 'flash', x, y, vx: 0, vy: 0, life: 0.12, age: 0, size: R * 0.35, shape: SHAPE.SOFT, color: [1, 0.72, 0.22], alpha: 0.7, emissive: true, grow: R * 0.3 });
      sys.push({ kind: 'flash', x, y, vx: 0, vy: 0, life: 0.14, age: 0, size: R * 0.8, shape: SHAPE.SOFT + BEHIND, color: [1, 0.6, 0.14], alpha: 0.8, emissive: true, grow: R * 0.6 });
      // Shockwave: a dark translucent smoke disc behind the bodies, a thin ring with a hard leading edge on top.
      // The smoke disc scales with strength: subtle on a jab, a real dark disc on a heavy hit.
      // Capped at 30%: the backdrop never drops below ~70% of its rest value, so a KO is not a black hole.
      if (smokeK > 0.02) sys.push({ kind: 'smoke', x, y, vx: 0, vy: 0, life: 0.4, age: 0, size: 30 * s, shape: SHAPE.DISC + BEHIND, color: [0.06, 0.03, 0.1], alpha: 0.3 * smokeK, emissive: false, grow: 70 * s });
      // One thin flat ring, invisible on the jolt frame, expanding to a radius of ~210px on a KO then gone.
      // Heavy hits only: a caller passes ring: false for light and medium contact (a jab just sparks).
      if (ring) sys.push({ kind: 'shock', x, y, vx: 0, vy: 0, life: 0.22, age: 0, delay: 0.02, size: 40 * s, shape: SHAPE.RING + BEHIND, ringPx: 5, color: [1, 0.78, 0.38], alpha: 0.6, emissive: true, grow: 170 * s });
      // Sparks: short hot streaks (white, yellow, orange), about 11 on a jab, 17 on a cross and 40 on a KO.
      // A light hit's sparks are slower too, so they stay close to the contact; none goes past ~250px.
      // A burst of overlapping hits never fills the screen: at most MAX_SPARKS are alive, the oldest go first.
      const sk = Math.max(0, Math.min(1, (s - 0.15) / 0.85));
      const n = Math.round(6 + 34 * sk);
      const reach = 0.55 + 0.45 * sk;
      const live = parts.filter(p => p.kind === 'spark').sort((a, b) => a.age - b.age);
      for (let i = live.length + n - MAX_SPARKS; i > 0; i--) { const old = live.pop(); if (old) old.life = old.age; }
      for (let i = 0; i < n; i++) {
        const back = rnd() < 0.3;
        const a = base + (rnd() - 0.5) * (back ? 3.0 : 2.0) + (back ? Math.PI : 0);
        const sp = (160 + rnd() * 340) * reach;
        const cc = rnd();
        const col = cc < 0.45 ? [1, 1, 0.92] : cc < 0.75 ? [1, 0.85, 0.35] : [1, 0.5, 0.12];
        sys.push({ kind: 'spark', x, y, ox: x, oy: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120 * rnd(), age: 0,
          size: 1.1 + rnd() * 1.5, shape: SHAPE.STREAK + BEHIND, color: col, alpha: 1, emissive: true, gravity: 1100, drag: 1.6, bounce: 0.3, life: 0.25 + rnd() * 0.3 });
      }
      // Debris. 'crate': big tumbling chunks of whatever got hit, long-lived, capped. 'dust': a few
      // dark specks. 'none': nothing.
      if (style === 'crate') {
        const live = parts.filter(p => p.kind === 'debris').sort((a, b) => a.age - b.age);
        const nd = Math.round(4 + 5 * s);
        for (let i = live.length + nd - maxDebris; i > 0; i--) { const old = live.pop(); if (old) old.life = old.age; }
        for (let i = 0; i < nd; i++) {
          const a = base + (rnd() - 0.5) * 2.4;
          const sp = (220 + rnd() * 420) * (0.6 + 0.6 * s);
          const g = 0.35 + rnd() * 0.3;
          sys.push({ kind: 'debris', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 260 - 200 * rnd(), life: 6 + rnd() * 4, age: 0, fadeIn: 1.5,
            size: (6 + rnd() * 10) * Math.min(1.4, 0.7 + 0.5 * s), shape: SHAPE.CHUNK + BEHIND, rot: rnd() * 6.28, rotV: (rnd() - 0.5) * 30, aspect: 0.45 + rnd() * 0.8,
            color: color || [g, g * 0.95, g * 1.05], alpha: 1, emissive: false, gravity: 1500, drag: 0.4, bounce: 0.38, friction: 0.7, lit: true });
        }
      } else if (style === 'dust') {
        for (let i = 0; i < 3 + Math.round(3 * s); i++) {
          const a = base + (rnd() - 0.5) * 2.6;
          const sp = (120 + rnd() * 260) * (0.6 + 0.6 * s);
          sys.push({ kind: 'debris', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120 - 120 * rnd(), life: 0.7 + rnd() * 0.5, age: 0, fadeIn: 0.3,
            size: 1.2 + rnd() * 1.8, shape: SHAPE.POLY + BEHIND, rot: rnd() * 6.28, rotV: (rnd() - 0.5) * 20, aspect: 0.6 + rnd() * 0.6,
            color: [0.22, 0.16, 0.26], alpha: 0.9, emissive: false, gravity: 1400, drag: 0.5, bounce: 0.3, friction: 0.6, lit: true });
        }
      }
      // Smoke/dust puff around the impact, drifting with the hit.
      const np = Math.round(1 + 9 * s);
      for (let i = 0; i < np; i++) {
        const a = base + (rnd() - 0.5) * 2.8;
        const sp = 40 + rnd() * 140 * s;
        sys.push({ kind: 'dust', x: x + (rnd() - 0.5) * 10, y: y + (rnd() - 0.5) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, life: 0.45 + rnd() * 0.5, age: 0,
          size: 8 + rnd() * 10 * s, shape: SHAPE.SOFT + BEHIND, color: [0.72, 0.68, 0.75], alpha: 0.32, emissive: false, gravity: -40, drag: 2.5, grow: 50 * s, lit: true });
      }
    },

    // A blocked strike: a tiny cool-white core and a few short, slow sparks kicked back toward the
    // attacker (dir), gone in a fifth of a second. weight 0..2 (blockWeight): 4 sparks on a jab, 10 on an ender.
    guardSpark({ x, y, dir = -1, weight = 0 }) {
      const w = Math.max(0, Math.min(2, weight | 0));
      sys.push({ kind: 'flash', x, y, vx: 0, vy: 0, life: 0.07 + 0.02 * w, age: 0, size: 4 + 2 * w, shape: SHAPE.SOFT, color: [0.85, 0.95, 1], alpha: 0.6, emissive: true, grow: 3 + 2 * w });
      const n = [4, 6, 10][w], reach = [0.35, 0.45, 0.6][w];
      for (let i = 0; i < n; i++) {
        const a = (dir < 0 ? Math.PI : 0) + (rnd() - 0.5) * 1.8;
        const sp = (160 + rnd() * 280) * reach;
        sys.push({ kind: 'spark', x, y, ox: x, oy: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60 * rnd(), age: 0,
          size: 0.9 + rnd() * 0.8, shape: SHAPE.STREAK + BEHIND, color: rnd() < 0.6 ? [0.9, 0.97, 1] : [0.55, 0.9, 1], alpha: 1, emissive: true, gravity: 900, drag: 2.5, life: 0.12 + rnd() * 0.12 });
      }
    },

    // Wall splat / wall bounce: a vertical shock line along the wall at the contact point (a hot core
    // and a wider soft glow that stretch up and down and fade), grit and dust rolling off the wall
    // away from it. side: -1 = a wall on the left of the contact, +1 = on the right. Behind the bodies.
    wallImpact({ x, y, side = 1, strength = 1 }) {
      const s = Math.max(0.2, Math.min(2, strength));
      const away = -Math.sign(side || 1);
      sys.push({ kind: 'wallLine', x, y, vx: 0, vy: 0, life: 0.2, age: 0, size: 2.2, len: 40 * s, grow: 110 * s, shape: SHAPE.STREAK + BEHIND, color: [1, 0.95, 0.85], alpha: 0.95, emissive: true });
      sys.push({ kind: 'wallLine', x, y, vx: 0, vy: 0, life: 0.28, age: 0, size: 9, len: 50 * s, grow: 150 * s, shape: SHAPE.STREAK + BEHIND, color: [1, 0.55, 0.9], alpha: 0.45, emissive: true });
      for (let i = 0; i < 6 + Math.round(4 * s); i++) {
        const a = (away > 0 ? 0 : Math.PI) + (rnd() - 0.5) * 1.4;
        const sp = 60 + rnd() * 160 * s;
        sys.push({ kind: 'dust', x: x + away * 4, y: y + (rnd() - 0.5) * 70 * s, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - 20, life: 0.45 + rnd() * 0.45, age: 0,
          size: 7 + rnd() * 9, shape: SHAPE.SOFT + BEHIND, color: [0.8, 0.76, 0.86], alpha: 0.3, emissive: false, gravity: -30, drag: 2.8, grow: 34 * s, lit: true });
      }
      for (let i = 0; i < 4 + Math.round(3 * s); i++) {
        const a = (away > 0 ? 0 : Math.PI) + (rnd() - 0.5) * 1.8;
        const sp = 120 + rnd() * 220;
        sys.push({ kind: 'debris', x: x + away * 3, y: y + (rnd() - 0.5) * 40, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: 0.6 + rnd() * 0.4, age: 0,
          size: 1.2 + rnd() * 1.4, shape: SHAPE.POLY + BEHIND, rot: 0, rotV: (rnd() - 0.5) * 10, aspect: 1, color: [0.14, 0.11, 0.2], alpha: 1, emissive: false, gravity: 1400, drag: 0.3, bounce: 0.3, friction: 0.6, lit: true });
      }
    },

    // Counter hit: a cyan double ring (two thick rings a beat apart) and eight short spokes, so it
    // reads apart from the normal amber hit ring. Behind the bodies. scale 1 (a heavy counter) reaches a
    // radius of ~140px; a jab counter passes about 0.5, a ring about the size of a head and shoulders.
    counterFlash({ x, y, scale = 1 }) {
      const k = Math.max(0.3, Math.min(1, scale));
      sys.push({ kind: 'shock', x, y, vx: 0, vy: 0, life: 0.2, age: 0, delay: 0, size: 18 * k, shape: SHAPE.RING + BEHIND, ringPx: 3 + 4 * k, color: [0.45, 0.95, 1.0], alpha: 0.9, emissive: true, grow: 100 * k });
      sys.push({ kind: 'shock', x, y, vx: 0, vy: 0, life: 0.24, age: 0, delay: 0.06, size: 14 * k, shape: SHAPE.RING + BEHIND, ringPx: 2 + 2 * k, color: [1.0, 0.45, 0.9], alpha: 0.8, emissive: true, grow: 130 * k });
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4 + Math.PI / 8;
        sys.push({ kind: 'spoke', x, y, ox: x, oy: y, vx: Math.cos(a) * 420 * k, vy: Math.sin(a) * 420 * k, life: 0.16, age: 0, size: 1.6, len: 14 * k, shape: SHAPE.STREAK + BEHIND, color: [0.75, 1.0, 1.0], alpha: 1, emissive: true, drag: 6 });
      }
    },

    dust({ x, y, dir = 0, amount = 1 }) {
      const n = Math.round(10 + 8 * amount);
      const ddx = typeof dir === 'number' ? dir : (dir && dir.x) || 0;
      for (let i = 0; i < n; i++) {
        const side = ddx !== 0 ? -Math.sign(ddx) : (i % 2 ? 1 : -1);
        const sp = 40 + rnd() * 120 * amount;
        const a = (side > 0 ? 0 : Math.PI) + (rnd() - 0.5) * 1.2;
        sys.push({ kind: 'dust', x: x + (rnd() - 0.5) * 14, y: y - 2 - rnd() * 6, vx: Math.cos(a) * sp, vy: -Math.abs(Math.sin(a)) * sp * 0.7 - 20 * rnd(), life: 0.4 + rnd() * 0.5, age: 0,
          size: 6 + rnd() * 8, shape: SHAPE.SOFT + BEHIND, color: [0.82, 0.78, 0.84], alpha: 0.28, emissive: false, gravity: -30, drag: 3.0, grow: 28 * amount, lit: true });
      }
      // A few grit specks that bounce.
      for (let i = 0; i < 3 + 2 * amount; i++) {
        const a = -Math.PI / 2 + (rnd() - 0.5) * 2.0;
        const sp = 80 + rnd() * 160;
        const g = 0.12 + rnd() * 0.08; // dark grit, so it never reads as a row of grey chips on the floor line
        sys.push({ kind: 'debris', x, y: y - 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6 + rnd() * 0.5, age: 0,
          size: 1.2 + rnd() * 1.5, shape: SHAPE.POLY, rot: 0, rotV: (rnd() - 0.5) * 10, aspect: 1, color: [g, g, g], alpha: 1, emissive: false, gravity: 1400, drag: 0.3, bounce: 0.3, friction: 0.6, lit: true });
      }
    },

    trail(prev, now, color, alpha = 0.3) {
      if (!prev || !now) return;
      const pairs = [['lShoulder', 'lElbow'], ['lElbow', 'lHand'], ['rShoulder', 'rElbow'], ['rElbow', 'rHand'], ['lHip', 'lKnee'], ['hip', 'lKnee'], ['lKnee', 'lFoot'], ['rHip', 'rKnee'], ['hip', 'rKnee'], ['rKnee', 'rFoot']];
      const col = parseColor(color);
      for (const [a, b] of pairs) {
        const pa = prev[a], pb = prev[b], na = now[a], nb = now[b];
        if (!pa || !pb || !na || !nb) continue;
        const move = Math.hypot(nb.x - pb.x, nb.y - pb.y);
        if (move < 10) continue;
        sys.push({ kind: 'trail', corners: [pa.x, pa.y, pb.x, pb.y, nb.x, nb.y, na.x, na.y], life: 0.12, age: 0, color: col, alpha: alpha * Math.min(1, move / 60), emissive: false, x: na.x, y: na.y, vx: 0, vy: 0, size: 0 });
      }
    },

    update(dt, view) {
      // Ambient motes: spawn up to target, drifting slowly, wrapping in view.
      if (moteCount < moteTarget) {
        const n = Math.min(moteTarget - moteCount, 6);
        for (let i = 0; i < n; i++) {
          sys.push({ kind: 'mote', x: view.x0 + rnd() * (view.x1 - view.x0), y: view.y0 + rnd() * (view.y1 - view.y0), vx: (rnd() - 0.5) * 14, vy: -4 - rnd() * 10, life: 1e9, age: rnd() * 10,
            size: 0.9 + rnd() * 1.6, shape: SHAPE.SOFT, color: [1, 0.9, 0.7], alpha: 0.25 + rnd() * 0.45, emissive: true, wob: rnd() * 6.28, lit: true });
          moteCount++;
        }
      }
      if (rainRate > 0) {
        rainAccum += rainRate * dt;
        while (rainAccum >= 1) {
          rainAccum -= 1;
          const R = rainRegion;
          const x = R ? R.x0 + rnd() * (R.x1 - R.x0) : view.x0 - 100 + rnd() * (view.x1 - view.x0 + 200);
          const y0 = R ? R.y0 - 4 + rnd() * 8 : view.y0 - 40;
          const depth = rnd();
          const far = depth < 0.4;
          const drop = !far && rnd() < 0.04;
          sys.push({ kind: 'rain', x, y: y0, region: R, vx: (far ? 900 : 1400) * rainWind + (rnd() - 0.5) * 30, vy: far ? 800 + 300 * depth : 1100 + 500 * depth, life: 3, age: 0,
            size: drop ? 1.4 : far ? 0.45 + rnd() * 0.2 : 0.5 + rnd() * 0.5, len: drop ? 30 + rnd() * 30 : far ? 8 + rnd() * 14 : 20 + rnd() * 40, shape: SHAPE.STREAK, color: drop ? [0.85, 0.9, 1.0] : [0.72, 0.8, 1.0], alpha: drop ? 0.3 : far ? 0.025 + 0.02 * depth : 0.07 + 0.07 * rnd(), emissive: true, lit: true, depth });
        }
      }

      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        if (p.age >= p.life) { if (p.kind === 'mote') moteCount--; parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
        if (p.kind === 'trail') continue;
        if (p.gravity) p.vy += p.gravity * dt;
        if (p.drag) { const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; }
        if (p.kind === 'mote') {
          p.vx += Math.sin(p.age * 0.7 + p.wob) * 8 * dt;
          p.vy += Math.cos(p.age * 0.5 + p.wob) * 5 * dt;
          if (p.x < view.x0) p.x = view.x1; else if (p.x > view.x1) p.x = view.x0;
          if (p.y < view.y0) p.y = view.y1; else if (p.y > view.y1) p.y = view.y0;
        }
        const px = p.x, py = p.y;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.rotV) p.rot += p.rotV * dt;

        if (p.kind === 'rain') {
          const R = p.region;
          const gy = R ? R.y1 : groundAt(sys, p.x, py);
          if (R && (p.x < R.x0 || p.x > R.x1)) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
          if (p.y >= gy) {
            // splash
            for (let k = 0; k < 2; k++) {
              const a = -Math.PI / 2 + (rnd() - 0.5) * 1.6;
              const sp = 40 + rnd() * 90;
              sys.push({ kind: 'splash', region: R, x: p.x, y: gy - 1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.12 + rnd() * 0.1, age: 0, size: 0.8, shape: SHAPE.DISC, color: [0.8, 0.85, 1.0], alpha: 0.5, emissive: true, gravity: 1200, lit: true });
            }
            parts[i] = parts[parts.length - 1]; parts.pop(); continue;
          }
          if (p.y > view.y1 + 50) { parts[i] = parts[parts.length - 1]; parts.pop(); }
          continue;
        }

        if (p.kind === 'spark' && Math.hypot(p.x - p.ox, p.y - p.oy) > SPARK_REACH) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
        if (p.kind === 'splash' && p.region && (p.x < p.region.x0 || p.x > p.region.x1 || p.y > p.region.y1 + 2)) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
        if (p.bounce !== undefined) {
          const gy = groundAt(sys, p.x, py);
          if (p.y >= gy && py <= gy + 1) {
            p.y = gy;
            if (Math.abs(p.vy) < 40) { p.vy = 0; p.vx *= Math.max(0, 1 - 6 * dt); p.rotV = 0; }
            else { p.vy = -p.vy * p.bounce; p.vx *= p.friction !== undefined ? p.friction : 0.8; if (p.rotV) p.rotV *= 0.6; }
          }
        }
        if (p.x < sys.bounds.x0 || p.x > sys.bounds.x1 || p.y > sys.bounds.y1) { if (p.kind === 'mote') moteCount--; parts[i] = parts[parts.length - 1]; parts.pop(); }
      }
    },

    // Fill the vertex array. toScreen maps world to screen. Returns { lit: [start, count], emissive: [start, count] }.
    build(toScreen, camZoom) {
      let n = 0;
      const emit = (x, y, u, v, c, a, shape) => {
        const o = n * FLOATS_PER_VERT;
        verts[o] = x; verts[o + 1] = y; verts[o + 2] = u; verts[o + 3] = v; verts[o + 4] = c[0]; verts[o + 5] = c[1]; verts[o + 6] = c[2]; verts[o + 7] = a; verts[o + 8] = shape;
        n++;
      };
      const quad = (cx, cy, hw, hh, rot, c, a, shape) => {
        if (n + 6 > MAX_PARTICLES * 6) return;
        const cs = Math.cos(rot), sn = Math.sin(rot);
        const ax = cs * hw, ay = sn * hw, bx = -sn * hh, by = cs * hh;
        const x0 = cx - ax - bx, y0 = cy - ay - by, x1 = cx + ax - bx, y1 = cy + ay - by, x2 = cx + ax + bx, y2 = cy + ay + by, x3 = cx - ax + bx, y3 = cy - ay + by;
        emit(x0, y0, -1, -1, c, a, shape); emit(x1, y1, 1, -1, c, a, shape); emit(x2, y2, 1, 1, c, a, shape);
        emit(x0, y0, -1, -1, c, a, shape); emit(x2, y2, 1, 1, c, a, shape); emit(x3, y3, -1, 1, c, a, shape);
      };
      const ranges = { lit: [0, 0], emissive: [0, 0] };
      const tmp = [0, 0, 0];
      for (let pass = 0; pass < 2; pass++) {
        const wantEmissive = pass === 1;
        const start = n;
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          if (!!p.emissive !== wantEmissive) continue;
          const t = p.age / p.life;
          let a = p.alpha, c = p.color;
          if (p.lit && !p.flat) {
            const L = sys.lightAt(p.x, p.y, Lbuf);
            if (p.emissive) { // rain and motes: visible in the dark, sparkle near lights
              const l = Math.min(2.2, 0.8 + (L[0] + L[1] + L[2]) * 0.3);
              tmp[0] = Math.min(1.6, c[0] * (0.5 + L[0]) * l); tmp[1] = Math.min(1.6, c[1] * (0.5 + L[1]) * l); tmp[2] = Math.min(1.6, c[2] * (0.5 + L[2]) * l);
              c = tmp;
            } else {
              // Debris never goes brighter than ~1.3x its own color, so chunks stay the crate's color inside a light pool.
              const kk = p.kind === 'debris' ? 0.6 : 0.45, cap = p.kind === 'debris' ? 1.3 : 99;
              tmp[0] = Math.min(1.0, c[0] * Math.min(cap, kk + L[0])); tmp[1] = Math.min(1.0, c[1] * Math.min(cap, kk + L[1])); tmp[2] = Math.min(1.0, c[2] * Math.min(cap, kk + L[2]));
              c = tmp;
            }
          }
          if (p.kind === 'trail') {
            if (n + 6 > MAX_PARTICLES * 6) continue;
            const fade = a * (1 - t);
            const q = p.corners;
            const s0 = toScreen(q[0], q[1], S[0]), s1 = toScreen(q[2], q[3], S[1]), s2 = toScreen(q[4], q[5], S[2]), s3 = toScreen(q[6], q[7], S[3]);
            emit(s0[0], s0[1], 0, 0, c, 0, SHAPE.POLY); emit(s1[0], s1[1], 0, 0, c, 0, SHAPE.POLY); emit(s2[0], s2[1], 0, 0, c, fade, SHAPE.POLY);
            emit(s0[0], s0[1], 0, 0, c, 0, SHAPE.POLY); emit(s2[0], s2[1], 0, 0, c, fade, SHAPE.POLY); emit(s3[0], s3[1], 0, 0, c, fade, SHAPE.POLY);
            continue;
          }
          const s = toScreen(p.x, p.y, S[4]);
          let size = p.size + (p.grow || 0) * t;
          size *= camZoom;
          switch (p.kind) {
            case 'spark': {
              // Hot streaks: a short line along the velocity, longer when fast, shrinking a little over life.
              const k = 1 - t * 0.4;
              const sp = Math.hypot(p.vx, p.vy);
              const len = Math.min(14, 2.5 + sp * 0.012) * camZoom;
              const rot = Math.atan2(p.vy, p.vx);
              a *= 1 - t * t;
              quad(s[0], s[1], len * k, size * k, rot, c, a, p.shape);
              break;
            }
            case 'shock': { if (p.delay && p.age < p.delay) break; a *= 1 - t * t; const inner = Math.max(0, Math.min(0.98, 1 - (p.ringPx || 17) * camZoom / size)); quad(s[0], s[1], size, size, 0, c, a, p.shape + inner); break; }
            case 'smoke': a *= t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9; quad(s[0], s[1], size, size, 0, c, a, p.shape); break;
            case 'rain': {
              // The head is the particle; the streak trails back along the velocity. In a region the
              // segment is clipped to the rect, so no streak pokes past the frame of the pane.
              const sp = Math.hypot(p.vx, p.vy) || 1, ux = p.vx / sp, uy = p.vy / sp;
              let t0 = 0, t1 = p.len * 2; // distance back from the head
              const R = p.region;
              if (R) {
                // keep points with y in [y0, y1] and x in [x0, x1]: head - u * t
                const clip = (pos, dir, lo, hi) => {
                  if (Math.abs(dir) < 1e-6) { if (pos < lo || pos > hi) t1 = -1; return; }
                  let ta = (pos - lo) / dir, tb = (pos - hi) / dir; if (ta > tb) { const q = ta; ta = tb; tb = q; }
                  t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
                };
                clip(p.y, uy, R.y0, R.y1); clip(p.x, ux, R.x0, R.x1);
              }
              if (t1 - t0 < 1) break;
              const tm = (t0 + t1) / 2;
              const ms = toScreen(p.x - ux * tm, p.y - uy * tm, S[5]);
              quad(ms[0], ms[1], (t1 - t0) / 2 * camZoom, size, Math.atan2(p.vy, p.vx), c, a, SHAPE.STREAK + BEHIND); // behind the fighters: rain never lowers their contrast
              break;
            }
            case 'flash': a *= 1 - t; quad(s[0], s[1], size, size, 0, c, a, p.shape); break;
            case 'wallLine': { a *= (1 - t) * (1 - t); quad(s[0], s[1], (p.len + (p.grow || 0) * Math.sqrt(t)) * camZoom, p.size * camZoom, Math.PI / 2, c, a, p.shape); break; }
            case 'spoke': { a *= 1 - t; quad(s[0], s[1], p.len * (1 - 0.5 * t) * camZoom, p.size * camZoom, Math.atan2(p.vy, p.vx), c, a, p.shape); break; }
            case 'halo': a *= (1 - t) * (1 - t); quad(s[0], s[1], size, size, 0, c, a, p.shape); break;
            case 'dust': a *= t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85; quad(s[0], s[1], size, size, 0, c, a, p.shape); break;
            case 'debris': { const left = p.life - p.age, f = p.fadeIn || 0.5; a *= left < f ? left / f : 1; quad(s[0], s[1], size, size * p.aspect, p.rot, c, a, p.shape); break; }
            case 'mote': { const tw = 0.7 + 0.3 * Math.sin(p.age * 2.1 + p.wob); quad(s[0], s[1], size * 1.6, size * 1.6, 0, c, a * tw, SHAPE.SOFT + BEHIND); break; }
            case 'splash': a *= 1 - t; quad(s[0], s[1], size, size, 0, c, a, SHAPE.DISC + BEHIND); break;
            default: quad(s[0], s[1], size, size, p.rot || 0, c, a, p.shape); break;
          }
        }
        ranges[wantEmissive ? 'emissive' : 'lit'] = [start, n - start];
      }
      return { verts: verts.subarray(0, n * FLOATS_PER_VERT), ranges, floatsPerVert: FLOATS_PER_VERT };
    },
  };
  return sys;
}

// First walkable line at or below y under x; the global ground is the fallback.
function groundAt(sys, x, y) {
  let best = sys.ground;
  if (sys.floors && sys.floors.length) {
    for (const f of sys.floors) if (x >= f.x0 && x <= f.x1 && f.y >= y - 1 && f.y < best) best = f.y;
  }
  return best;
}

export function parseColor(c) {
  if (Array.isArray(c)) return c;
  if (typeof c !== 'string') return [1, 1, 1];
  const m = c.trim();
  if (m[0] === '#') {
    const h = m.length === 4 ? m.slice(1).split('').map(ch => ch + ch).join('') : m.slice(1, 7);
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
  }
  const r = m.match(/rgba?\(([^)]+)\)/);
  if (r) { const v = r[1].split(',').map(Number); return [v[0] / 255, v[1] / 255, v[2] / 255]; }
  return [1, 1, 1];
}
