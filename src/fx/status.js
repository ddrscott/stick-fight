// Status effects on the fighters: the state of each body read off the body itself, so nobody has to
// look at the corners. Everything here draws on the FX emissive layer, which the compositor hides
// wherever a fighter is (its dilated protect mask, owner requirement 5), so these sit behind the
// fighters and show as rims, halos and glints around them, never over them. It only reads the sim.
//
//   hitstun      a red halo and a red light on the chest, fading as the stun drains; thin and faint
//                after a light hit, full after a heavy one or a counter (hitWeight)
//   guard        nothing while a guard is just held; a blocked strike puts a brief thin cyan glint on
//                the guard side of the contact, sized by the blocked strike (blockWeight)
//   faint        three stars circling over the head and a wobbling violet halo ring
//   armor        an amber halo while Security's shoulder check still has its armor
//   parry stance a white-cyan shield ring in front of Helpdesk's stance; a burst when it catches
//   counter hit  a hot white halo for a beat (main.js also flashes the body harder)
//   air jump     a cyan ring kicked out under the feet when an extra jump is spent
//   low stamina  a breath puff every second or so; exhausted, sweat flicks and steam wisps too
//   accident     a gold four-point glint where a happy accident lands
//   shocked      yellow-white arcs crackling off the joints while a shock (frame data shock) runs
//   rooted       a yellow ring pulsing round each foot while a root (frame data root) holds
//
// Quality tiers (fx.tier): tier 1 drops the sweat, steam and the halos' second pass, and caps the puffs.
import { FRAME_DATA } from '../combat/frameData.js';
import { drawJoints } from '../arena/index.js';

const RED = '#ff2b4a', CYAN = '#2ef2ff', VIOLET = '#a66bff', AMBER = '#ffb02e', GOLD = '#ffd84a', WHITE = '#fff4fd';
const FAINT_MAX = 1.5 * 120;   // STAMINA.faintTime in sim steps (src/combat/sim.js FAINT_STEPS)

/** How heavy a hit event looks: 0 light (jab, low jab, the light kicks), 1 medium (cross, body blow,
 * 9+ damage that doesn't knock down), 2 heavy (enders, launchers, knockdowns, splats, KOs). The hit's
 * effects (sparks, the ring, the halo, shake) all scale off this, so a jab only sparks. Reads the
 * event and the frame data, never the sim. */
export function hitWeight(ev) {
  const fd = (ev && FRAME_DATA[ev.move]) || {};
  if (ev.ko || ev.knockdown || fd.ender || fd.juggle || fd.splat || fd.groundBounce) return 2;
  return (ev.strength ?? 0) >= 0.6 ? 1 : 0;
}

/** How heavy a blocked strike looks, on the same 0..2 scale as hitWeight: a blocked event carries no
 * knockdown or KO, so the frame data decides. Enders, launchers, splats and 14+ damage are heavy; 9+
 * damage or a knockdown (the sweep) medium; jabs and light kicks light. Reads the event and the frame data. */
export function blockWeight(ev) {
  const fd = (ev && FRAME_DATA[ev.move]) || {};
  if (fd.ender || fd.juggle || fd.splat || fd.groundBounce || (fd.damage || 0) >= 14) return 2;
  return (fd.damage || 0) >= 9 || fd.knockdown ? 1 : 0;
}

// the guard glint by block weight: seconds, arc radius, arc span (rad), line width, alpha, light [radius, intensity]
const GUARD_GLINT = [
  { t: 0.08, r: 14, span: 1.0, width: 1.5, alpha: 0.6, light: [40, 0.14] },   // light: a jab
  { t: 0.11, r: 19, span: 1.3, width: 2, alpha: 0.75, light: [55, 0.22] },    // medium: a cross, a sweep
  { t: 0.15, r: 26, span: 1.7, width: 2.5, alpha: 0.9, light: [75, 0.35] },   // heavy: an ender
];

// the hitstun halo by hit weight: line width, pulse alpha, the alpha floor, the outer pass, the chest light
const HITSTUN_HALO = [
  { width: 8, alpha: 0.2, floor: 0.04, outer: false, light: [80, 0.18] },    // light: a jab
  { width: 12, alpha: 0.32, floor: 0.06, outer: false, light: [100, 0.35] }, // medium: a cross, a body blow
  { width: 16, alpha: 0.45, floor: 0.08, outer: true, light: [120, 0.55] },  // heavy (or a counter)
];

export function createStatusFX() {
  const per = new WeakMap();   // unit -> { stunMax, puffT, sweatT, airUsed, counter, armorHit, parryHit, weight }
  const bits = [];             // puffs, sweat, steam, rings and glints: { kind, x, y, vx, vy, t, max, ... }
  let clock = 0;
  const st = (u) => { let s = per.get(u); if (!s) { s = { stunMax: 1, lastStun: 0, puffT: 0.4, sweatT: 0, airUsed: 0, counter: 0, armorHit: 0, parryHit: 0, weight: 0 }; per.set(u, s); } return s; };

  // the sim's events (main.js forwards them): a counter hit, an armored absorb, a parry, an accident
  function event(ev) {
    if (ev.type === 'hit' && ev.defender) {
      const d = st(ev.defender);
      // the halo's weight: the hit that put him in stun (a counter reads one step heavier)
      d.weight = Math.min(2, hitWeight(ev) + (ev.counter ? 1 : 0));
      // the white counter flash: a beat on a light counter, the full flash on a heavier one
      if (ev.counter) d.counter = d.weight >= 2 ? 0.22 : 0.15;
      if (ev.armor) st(ev.defender).armorHit = 0.25;
    } else if (ev.type === 'block' && ev.parry && ev.defender) {
      st(ev.defender).parryHit = 0.3;
      bits.push({ kind: 'ring', x: ev.x, y: ev.y, t: 0.3, max: 0.3, r0: 10, r1: 70, color: WHITE, flat: 1 });
    } else if (ev.type === 'block' && ev.defender && ev.move !== 'throw') {
      // a blocked strike: a quick thin glint on the guard side of the contact, sized by the strike
      const d = st(ev.defender), w = blockWeight(ev);
      d.guard = { t: GUARD_GLINT[w].t, w, x: ev.x, y: ev.y, dir: ev.dir || 1 };
    } else if (ev.type === 'accident') {
      // over the head, toward the opponent: the body itself would hide it (owner requirement 5)
      const h = ev.unit && ev.unit.rig && ev.unit.rig.joints && ev.unit.rig.joints.head;
      bits.push({ kind: 'glint', x: h ? h.x + (ev.unit.facing || 1) * 26 : ev.x, y: h ? h.y - 36 : ev.y - 10, t: 0.55, max: 0.55 });
    }
  }
  /** is this unit inside a counter-hit flash (main.js tints the body harder then) */
  const counterOn = (u) => { const s = per.get(u); return !!s && s.counter > 0; };

  // the halo: the body's own line drawing, fat and soft, in the status color
  function halo(ctx, u, color, alpha, width, tier) {
    const j = u.rig && u.rig.joints;
    if (!j || !j.head || alpha <= 0.01) return;
    const r = (u.rig.radius || 11);
    ctx.save(); ctx.globalAlpha = Math.min(1, alpha);
    drawJoints(ctx, j, color, width, r + width * 0.35);
    if (tier > 1) { ctx.globalAlpha = Math.min(1, alpha) * 0.35; drawJoints(ctx, j, color, width * 1.7, r + width * 0.6); }
    ctx.restore();
  }
  // electric arcs jumping off the joints, out past the outline (the layer is hidden over the body), jagged,
  // a new set every 50ms (drawing only, never the sim)
  const ARC_J = ['head', 'lHand', 'rHand', 'lElbow', 'rElbow', 'lKnee', 'rKnee', 'lFoot', 'rFoot', 'neck'];
  function crackle(ctx, j, tier, lights, chest) {
    const seed = Math.floor(clock * 20);
    let q = (seed * 7919) % 233280;
    const rnd = () => { q = (q * 9301 + 49297) % 233280; return q / 233280; };
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let n = 0; n < (tier > 1 ? 5 : 3); n++) {
      const a = j[ARC_J[Math.floor(rnd() * ARC_J.length)]];
      if (!a) continue;
      let dx = a.x - (j.neck.x + j.hip.x) / 2, dy = a.y - (j.neck.y + j.hip.y) / 2; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      const len = 26 + rnd() * 22, sw = (rnd() - 0.5) * 1.2;
      const b = { x: a.x + (dx + dy * sw) * len, y: a.y + (dy - dx * sw) * len };
      ctx.beginPath(); ctx.moveTo(a.x, a.y);
      for (let k = 1; k < 5; k++) ctx.lineTo(a.x + (b.x - a.x) * k / 5 + (rnd() - 0.5) * 18, a.y + (b.y - a.y) * k / 5 + (rnd() - 0.5) * 18);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = '#ffe066'; ctx.globalAlpha = 0.5; ctx.lineWidth = 5; ctx.stroke();
      ctx.strokeStyle = WHITE; ctx.globalAlpha = 0.95; ctx.lineWidth = 1.6; ctx.stroke();
    }
    ctx.restore();
    lights.push({ x: chest.x, y: chest.y, radius: 140, color: [1, 0.95, 0.45], intensity: 0.5 + 0.3 * rnd() });
  }
  function star(ctx, x, y, s, color, rot = 0) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = color;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, rr = k % 2 ? s * 0.28 : s; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  /**
   * Draw this frame's status effects on the emissive layer (camera already applied) and return the
   * point lights they add. offset(u) is the glue's draw-smoothing offset, so a halo sits on the body drawn.
   */
  function draw(ctx, sim, { dt = 1 / 60, tier = 3, offset = null } = {}) {
    clock += dt;
    const lights = [];
    if (!ctx) return lights;
    for (const u of sim.units) {
      if (u.hidden || u.state === 'ko' || !u.rig || !u.rig.joints || !u.rig.joints.head) continue;
      const s = st(u), j = u.rig.joints, r = u.rig.radius || 11;
      s.counter = Math.max(0, s.counter - dt); s.armorHit = Math.max(0, s.armorHit - dt); s.parryHit = Math.max(0, s.parryHit - dt);
      if (u.stun > s.lastStun) s.stunMax = Math.max(1, u.stun);
      s.lastStun = u.stun;
      const off = offset ? offset(u) : { x: 0, y: 0 };
      ctx.save(); ctx.translate(off.x, off.y);
      const chest = { x: (j.neck.x + j.hip.x) / 2 + off.x, y: (j.neck.y + j.hip.y) / 2 + off.y };
      const fd = u.state === 'attack' && u.move ? FRAME_DATA[u.move] : null;

      if (s.counter > 0) halo(ctx, u, WHITE, 0.8 * s.counter / 0.22, s.weight >= 2 ? 18 : 12, 1);
      else if (u.state === 'hitstun') {
        // still readable as a status, but scaled by the hit: a thin faint rim on a jab, the full
        // pulsing halo and red light on a heavy one (or deep in a combo)
        const k = Math.max(0, Math.min(1, u.stun / s.stunMax));
        const pulse = 0.75 + 0.25 * Math.sin(clock * 28);
        const H = HITSTUN_HALO[Math.max(s.weight, u.combo >= 3 ? 1 : 0)];
        halo(ctx, u, RED, H.alpha * k * pulse + H.floor, H.width, H.outer ? tier : 1);
        lights.push({ x: chest.x, y: chest.y, radius: H.light[0], color: [1, 0.15, 0.25], intensity: H.light[1] * k + 0.05 });
      }
      // shocked (frame data shock): crackling arcs jumping between the joints, re-drawn every few frames
      if (u.shockT > 0 && u.state === 'hitstun') crackle(ctx, j, tier, lights, chest);
      // rooted (frame data root): a yellow ring pulsing round each planted foot
      if (u.rootT > 0 && u.grounded) {
        ctx.save(); ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 2; ctx.globalAlpha = 0.5 + 0.3 * Math.sin(clock * 14);
        for (const f of [j.lFoot, j.rFoot]) { ctx.beginPath(); ctx.ellipse(f.x, u.y + 2, 14, 4, 0, 0, Math.PI * 2); ctx.stroke(); }
        ctx.restore();
      }
      // a blocked strike: a thin glint arc bracketing the contact on the guard side, gone in a few
      // frames. A held guard with nothing coming draws nothing here (main.js's guard mark reads it).
      if (s.guard && s.guard.t > 0) {
        const g = s.guard, G = GUARD_GLINT[g.w];
        g.t -= dt;
        if (!(u.faint > 0) && g.t > 0) {
          const k = g.t / G.t, grow = 0.8 + 0.2 * (1 - k);
          const cx = g.x - off.x + g.dir * G.r * 0.7, a0 = g.dir > 0 ? Math.PI : 0;   // the world contact (undo the body offset)
          ctx.save();
          ctx.strokeStyle = WHITE; ctx.lineWidth = G.width; ctx.lineCap = 'round'; ctx.globalAlpha = G.alpha * k;
          ctx.beginPath(); ctx.arc(cx, g.y - off.y, G.r * grow, a0 - G.span / 2, a0 + G.span / 2); ctx.stroke();
          ctx.strokeStyle = CYAN; ctx.lineWidth = G.width * 2.2; ctx.globalAlpha = G.alpha * k * 0.35;
          ctx.stroke();
          ctx.restore();
          lights.push({ x: g.x, y: g.y, radius: G.light[0], color: [0.4, 0.85, 1], intensity: G.light[1] * k });
        }
      }
      // armor: the shoulder check still has its armor (it absorbs the next hit)
      if (fd && fd.armor && u.armorLeft > 0 && u.phase !== 'recovery') {
        halo(ctx, u, AMBER, 0.26 + 0.1 * Math.sin(clock * 22), 14, 1);
        lights.push({ x: chest.x, y: chest.y, radius: 100, color: [1, 0.7, 0.2], intensity: 0.3 });
      }
      if (s.armorHit > 0) halo(ctx, u, AMBER, 0.7 * s.armorHit / 0.25, 18, 1);
      // parry stance: a shield ring in front, breathing
      if (fd && fd.parry && u.phase !== 'recovery') {
        const px = u.x + u.facing * 30, py = u.y - 92;
        ctx.save(); ctx.strokeStyle = WHITE; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.65 + 0.25 * Math.sin(clock * 16);
        ctx.beginPath(); ctx.ellipse(px, py, 9, 48, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = CYAN; ctx.lineWidth = 1.5; ctx.globalAlpha *= 0.7;
        ctx.beginPath(); ctx.ellipse(px + u.facing * 6, py, 6, 40, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        lights.push({ x: px, y: py, radius: 90, color: [0.7, 0.95, 1], intensity: 0.4 });
      }
      if (s.parryHit > 0) halo(ctx, u, WHITE, s.parryHit / 0.3, 18, tier);
      // faint: stars circling over the head, a wobbling halo ring
      if (u.faint > 0) {
        const hx = j.head.x, hy = j.head.y - r - 10, k = Math.min(1, u.faint / 20);
        ctx.save(); ctx.globalAlpha = 0.55 * k; ctx.strokeStyle = VIOLET; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(hx, hy, 20 + 2 * Math.sin(clock * 5), 6, Math.sin(clock * 3.3) * 0.25, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        for (let n = 0; n < 3; n++) {
          const a = clock * 5.5 + n * Math.PI * 2 / 3, front = Math.sin(a) > 0;
          ctx.save(); ctx.globalAlpha = k * (front ? 1 : 0.45);
          star(ctx, hx + Math.cos(a) * 24, hy + Math.sin(a) * 7, front ? 8 : 6, n === 1 ? WHITE : GOLD, clock * 4 + n);
          ctx.restore();
        }
        lights.push({ x: hx, y: hy, radius: 90, color: [0.65, 0.42, 1], intensity: 0.45 * k });
      }
      // an extra jump spent in the air: a ring kicked out under the feet
      const used = (u.airJumpsUsed || 0) + (u.wallJumps || 0);
      if (used > s.airUsed && !u.grounded) bits.push({ kind: 'ring', x: u.x, y: Math.max(j.lFoot.y, j.rFoot.y) + off.y + 4, t: 0.32, max: 0.32, r0: 8, r1: 44, color: CYAN, flat: 0.3 });
      s.airUsed = used;
      ctx.restore();

      // breath: low stamina puffs; exhausted (fainted, or nearly empty) sweats and steams too
      const stam = (u.stamina == null ? 100 : u.stamina) / (u.staminaMax || 100);
      const low = stam < 0.35 || u.faint > 0, spent = u.faint > 0 || stam < 0.15;
      const mouth = { x: j.head.x + u.facing * r * 0.9 + off.x, y: j.head.y + r * 0.3 + off.y };
      if (low && u.state !== 'down' && u.state !== 'knockdown' && u.state !== 'roll') {
        s.puffT -= dt;
        if (s.puffT <= 0) {
          s.puffT = spent ? 0.6 : 0.95;
          bits.push({ kind: 'puff', x: mouth.x, y: mouth.y, vx: u.facing * 26, vy: -12, t: 0.75, max: 0.75, s: 3 });
        }
        if (spent && tier > 1) {
          s.sweatT -= dt;
          if (s.sweatT <= 0) {
            s.sweatT = 0.32;
            const side = (Math.floor(clock * 3.1) % 2) ? 1 : -1;
            bits.push({ kind: 'sweat', x: j.head.x + side * r + off.x, y: j.head.y - r * 0.4 + off.y, vx: side * 60, vy: -90, t: 0.5, max: 0.5 });
            bits.push({ kind: 'steam', x: (side > 0 ? j.rShoulder.x : j.lShoulder.x) + off.x, y: j.neck.y + off.y, vx: side * 6, vy: -34, t: 0.9, max: 0.9, s: 4 });
          }
        }
      }
    }

    // the loose bits
    const cap = tier > 1 ? 80 : 24;
    if (bits.length > cap) bits.splice(0, bits.length - cap);
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      b.t -= dt;
      if (b.t <= 0) { bits.splice(i, 1); continue; }
      const k = b.t / b.max, age = 1 - k;
      if (b.vx != null) { b.x += b.vx * dt; b.y += b.vy * dt; }
      ctx.save();
      if (b.kind === 'puff' || b.kind === 'steam') {
        ctx.globalAlpha = (b.kind === 'puff' ? 0.32 : 0.22) * k; ctx.fillStyle = b.kind === 'puff' ? '#d9ccff' : '#cfe8ff';
        ctx.beginPath(); ctx.arc(b.x, b.y, b.s + age * (b.kind === 'puff' ? 9 : 12), 0, Math.PI * 2); ctx.fill();
      } else if (b.kind === 'sweat') {
        b.vy += 420 * dt;
        ctx.globalAlpha = 0.85 * k; ctx.strokeStyle = '#9fe9ff'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02); ctx.stroke();
      } else if (b.kind === 'ring') {
        const rr = b.r0 + (b.r1 - b.r0) * (1 - k * k);
        ctx.globalAlpha = 0.8 * k; ctx.strokeStyle = b.color; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(b.x, b.y, rr, rr * b.flat, 0, 0, Math.PI * 2); ctx.stroke();
      } else if (b.kind === 'glint') {
        const sz = 26 * Math.sin(Math.PI * Math.min(1, age * 1.2));
        ctx.globalAlpha = Math.min(1, k * 2);
        star(ctx, b.x, b.y, sz, GOLD, age * 1.5);
        star(ctx, b.x, b.y, sz * 0.45, WHITE, age * 1.5 + Math.PI / 4);
      }
      ctx.restore();
    }
    return lights;
  }
  function reset() { bits.length = 0; }
  return { event, draw, counterOn, reset };
}
