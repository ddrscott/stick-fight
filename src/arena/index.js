// Arena module. Contract: gauntlet/BRIEF.md, "Arena (piece D)".
//
//   const a = createArena('building');
//   a.floors, a.stairs, a.lights, a.spawns      floors[0] is the main fight floor (y=360 here)
//   a.drawBackground(ctx, camera?)   unlit line art + fills, then the body pile
//   a.drawForeground(ctx)            what stands in front of the section cut: the street lamp outside
//   a.drawEmissive(ctx, camera?)     glowing cores for the FX emissive layer
//   a.update(dt)                     bodies settle, lights flicker
//   a.addBody(snapshot)              a KO'd fighter joins the pile on the nearest floor
//   a.reflectY, a.gloss              the wet floor plane for the compositor's mirror: { y, depth, x0, x1, gaps }
//   a.walls                          { left, right } x of the wall faces at the main floor's ends
//   floors[i].fightBand / .walls / .spawns, a.spawnsByFloor[i]   per-floor fight data
//   a.stairwell                      { x0, x1, y, rail: { x0, x1, h }, toFloor } opening in floors[0]
//   a.treads, a.stairRail            stair step tops and handrails, collision for falling bodies
//   a.doors[i]                       [{ x, y, side, kind }] where goons enter floor i
//   a.openDoor(f, j, s), a.doorOpen(f, j)   swing a door open for s seconds; 0..1 openness
//   a.drawFar(ctx, camera)           the night outside, full frame, behind the background (which
//                                    leaves its openings transparent). Caller moves it at a.farParallax.
//   a.farParallax (0.35)             how much of the camera the far layer follows
//   a.foregroundParallax (1.4)       how much of the camera the foreground layer follows
//   a.liveColors                     set by the game: the live fighters' colors. A body whose
//                                    color is within 30 degrees of one of them is shifted to a
//                                    palette color that is not, so no fighter stands in a pile
//                                    of its own hue.
//
// Extras: a.setStyle('shaded' | 'lineart'), a.bodies, a.clearBodies(), a.time,
// a.drawBodies(ctx) with a.bodiesInBackground = false to draw the pile on the figures
// layer instead (keeps the bodies out of the ambient tint).

import {
  geometry as buildingGeometry, PALETTES, drawFar, drawBuilding, drawBuildingForeground, drawBuildingEmissive,
} from './building.js';

const DEFAULT_CAMERA = { x: 640, y: 360, zoom: 1 };
const SETTLE_SECONDS = 0.45;
const BODY_LIFT = 9;       // how much each body underneath raises the next one
const BODY_REACH = 70;     // bodies closer than this in x stack on each other
const MAX_PILE = 6;        // never taller than this many bodies
const HUE_CLEARANCE = 30;  // degrees a body hue must keep from any live fighter

// Saturated body colors that share no hue with the stage's purples.
export const BODY_PALETTE = ['#e04848', '#3f8fe8', '#e8c43a', '#4fc46a', '#ff7a2e', '#f4f4f4', '#ff4fa3', '#45e0d0', '#b7e23a', '#8c6bff', '#2fd36b', '#ffa6f0'];

const JOINT_NAMES = ['head', 'neck', 'hip', 'lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lHand', 'rHand', 'lKnee', 'rKnee', 'lFoot', 'rFoot'];

// Draw a stick figure from a joint dict. Shared with the demo page so stand-ins
// and the pile look the same. No outline, filled head, round caps, like the reference.
// `rim` adds a lighter edge under the stroke so a dark color still reads once lit.
export function drawJoints(ctx, j, color, lineWidth = 5, headRadius = 11, rim = null) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const pass = (c, lw, r) => {
    ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(j.neck.x, j.neck.y); ctx.lineTo(j.hip.x, j.hip.y);
    ctx.moveTo(j.lShoulder.x, j.lShoulder.y); ctx.lineTo(j.lElbow.x, j.lElbow.y); ctx.lineTo(j.lHand.x, j.lHand.y);
    ctx.moveTo(j.rShoulder.x, j.rShoulder.y); ctx.lineTo(j.rElbow.x, j.rElbow.y); ctx.lineTo(j.rHand.x, j.rHand.y);
    ctx.moveTo(j.hip.x, j.hip.y); ctx.lineTo(j.lKnee.x, j.lKnee.y); ctx.lineTo(j.lFoot.x, j.lFoot.y);
    ctx.moveTo(j.hip.x, j.hip.y); ctx.lineTo(j.rKnee.x, j.rKnee.y); ctx.lineTo(j.rFoot.x, j.rFoot.y);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(j.head.x, j.head.y, r, 0, Math.PI * 2); ctx.fill();
  };
  if (rim) pass(rim, lineWidth + 2, headRadius + 1);
  pass(color, lineWidth, headRadius);
  ctx.restore();
}

// --- color helpers -----------------------------------------------------------

function parseRGB(c) {
  const s = String(c).trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return m[1].split('').map((h) => parseInt(h + h, 16));
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}

// Hue in degrees and saturation 0..1, or null for greys / unparseable colors.
export function hueOf(c) {
  const rgb = parseRGB(c);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 0.08) return null; // grey-ish: no hue to collide with
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return h;
}

function hueDist(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

// Mix a CSS color toward white, for the rim.
export function lighten(c, amount = 0.45) {
  const rgb = parseRGB(c);
  if (!rgb) return 'rgba(255,255,255,0.6)';
  const ch = (v) => Math.round(v + (255 - v) * amount);
  return `rgb(${ch(rgb[0])},${ch(rgb[1])},${ch(rgb[2])})`;
}

// Mix a CSS color toward black.
export function darken(c, amount = 0.28) {
  const rgb = parseRGB(c);
  if (!rgb) return c;
  const ch = (v) => Math.round(v * (1 - amount));
  return `rgb(${ch(rgb[0])},${ch(rgb[1])},${ch(rgb[2])})`;
}

// Rec.601 luma of a CSS color, 0..255.
export function lumaOf(c) {
  const rgb = parseRGB(c);
  return rgb ? 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] : 128;
}

// Pull a color toward grey of the same luma. The dead lose half their saturation on landing.
export function desaturate(c, amount = 0.5) {
  const rgb = parseRGB(c);
  if (!rgb) return c;
  const l = lumaOf(c);
  return `rgb(${rgb.map((v) => Math.round(v + (l - v) * amount)).join(',')})`;
}

// Scale a color so its luma sits inside [min, max]. The dead are dimmer than the living but
// readable against the floor: the game's compositor lights figure strokes at about 0.7x, so
// this band lands corpse p50 near 75 to 95 after lighting, over a floor of 25 to 35.
export const CORPSE_LUMA_MAX = 100;
export const CORPSE_LUMA_MIN = 85;
export function capLuma(c, max = CORPSE_LUMA_MAX, min = CORPSE_LUMA_MIN) {
  const rgb = parseRGB(c);
  if (!rgb) return c;
  const l = lumaOf(c);
  const target = l > max ? max : l < min ? min : l;
  if (target === l) return c;
  const s = target / Math.max(1, l);
  return `rgb(${rgb.map((v) => Math.min(255, Math.round(v * s))).join(',')})`;
}

// True when a joint set lies along one line (a ragdoll flattened to a bar): then there is
// no pose worth tweening from, and the body takes a lying variant outright.
function collinear(j) {
  const pts = JOINT_NAMES.map((n) => j[n]);
  const a = pts[0], b = pts.reduce((best, p) => (dist(p, a) > dist(best, a) ? p : best), pts[0]);
  const L = dist(a, b) || 1, nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
  return pts.every((p) => Math.abs((p.x - a.x) * nx + (p.y - a.y) * ny) < 9);
}

// Keep the snapshot color unless it sits within HUE_CLEARANCE degrees of a live
// fighter; then take the next palette color (round-robin by body index) that clears
// every live hue and was not used by a recent body, so a heap stays varied.
export function pickBodyColor(color, liveColors, index, recent = []) {
  const live = (liveColors || []).map(hueOf).filter((h) => h !== null);
  const clear = (c) => { const h = hueOf(c); return h === null || live.every((l) => hueDist(h, l) >= HUE_CLEARANCE); };
  const used = new Set(recent.map((c) => String(c).toLowerCase()));
  if (color && clear(color) && !used.has(String(color).toLowerCase())) return color;
  let fallback = null;
  for (let i = 0; i < BODY_PALETTE.length; i++) {
    const c = BODY_PALETTE[(index + i) % BODY_PALETTE.length];
    if (!clear(c)) continue;
    if (!used.has(c.toLowerCase())) return c;
    if (!fallback) fallback = c;
  }
  return fallback || color || BODY_PALETTE[index % BODY_PALETTE.length];
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

// Segment lengths from a snapshot's joints, with defaults for a ~130px fighter.
function measure(j) {
  const d = { torso: 44, upper: 26, fore: 26, thigh: 34, shin: 34, headOff: 14 };
  if (!j) return d;
  const has = (n) => j[n] && typeof j[n].x === 'number';
  if (has('neck') && has('hip')) d.torso = dist(j.neck, j.hip) || d.torso;
  if (has('lShoulder') && has('lElbow')) d.upper = dist(j.lShoulder, j.lElbow) || d.upper;
  if (has('lElbow') && has('lHand')) d.fore = dist(j.lElbow, j.lHand) || d.fore;
  if (has('hip') && has('lKnee')) d.thigh = dist(j.hip, j.lKnee) || d.thigh;
  if (has('lKnee') && has('lFoot')) d.shin = dist(j.lKnee, j.lFoot) || d.shin;
  if (has('neck') && has('head')) d.headOff = dist(j.neck, j.head) || d.headOff;
  return d;
}

// A fallen pose lying along the floor. dir = +1 means the head points right.
// `v` (0..1) picks a variant so a pile is not six copies of one body.
function lyingPose(x, y, dir, m, v) {
  const P = (dx, dy) => ({ x: x + dir * dx, y: y + dy });
  const hip = P(0, -6);
  const neckX = m.torso * 0.97, neckY = -6 - m.torso * 0.12 - v * 3;
  const neck = P(neckX, neckY);
  const head = P(neckX + m.headOff * 0.95, neckY - 4 - v * 4);
  const lShoulder = P(neckX - 3, neckY + 1);
  const rShoulder = P(neckX - 1, neckY - 2);
  const a1 = 0.55 + v * 0.5, a2 = -0.35 - v * 0.6;
  const lElbow = P(neckX + Math.cos(a1) * m.upper, neckY - Math.sin(a1) * m.upper * 0.45);
  const lHand = P(neckX + Math.cos(a1) * m.upper + Math.cos(a1 - 0.6) * m.fore, neckY - Math.sin(a1) * m.upper * 0.45 - 2);
  const rElbow = P(neckX + Math.cos(a2) * m.upper, neckY - Math.sin(a2) * m.upper * 0.5 + 2);
  const rHand = P(neckX + Math.cos(a2) * m.upper + Math.cos(a2 + 0.4) * m.fore, neckY - Math.sin(a2) * m.upper * 0.5 + 4);
  const bend = 6 + v * 14;
  const lKnee = P(-m.thigh * 0.95, -6 - 2);
  const lFoot = P(-m.thigh * 0.95 - m.shin * 0.97, -3);
  const rKnee = P(-m.thigh * 0.8, -6 - bend);
  const rFoot = P(-m.thigh * 0.8 - m.shin * 0.85, -6 - bend * 0.3);
  return { head, neck, hip, lShoulder, rShoulder, lElbow, rElbow, lHand, rHand, lKnee, rKnee, lFoot, rFoot };
}

function copyJoints(j) {
  const out = {};
  for (const n of JOINT_NAMES) out[n] = { x: j[n].x, y: j[n].y };
  return out;
}

function hasAllJoints(j) {
  return !!j && JOINT_NAMES.every((n) => j[n] && typeof j[n].x === 'number' && typeof j[n].y === 'number');
}

const ARENAS = {
  building: {
    geometry: buildingGeometry,
    palettes: PALETTES,
    draw: drawBuilding,
    drawFar,
    drawForeground: drawBuildingForeground,
    drawEmissive: drawBuildingEmissive,
    // deterministic flicker: the dying tube, the vending ballast, the beacon's pulse, the plant's fairy light
    flicker(lights, t) {
      const by = {};
      for (const l of lights) by[l.name] = l;
      if (by.tubeB) {
        // mostly on, with a brief stutter every few seconds
        const phase = t % 3.1;
        by.tubeB.intensity = phase < 0.18 ? 0.25 + 0.35 * (Math.sin(phase * 140) * 0.5 + 0.5) : 0.6;
      }
      if (by.tubeA) by.tubeA.intensity = 0.6 + 0.02 * Math.sin(t * 31) + 0.01 * Math.sin(t * 7.3);
      if (by.vending) by.vending.intensity = 0.9 + 0.03 * Math.sin(t * 19);
      if (by.beacon) by.beacon.intensity = 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(t * 4.2));
      if (by.plantSparkle) by.plantSparkle.intensity = 0.3 + 0.12 * Math.sin(t * 2.3);
    },
  },
};

export function createArena(name = 'building') {
  const def = ARENAS[name];
  if (!def) throw new Error(`createArena: unknown arena '${name}' (have: ${Object.keys(ARENAS).join(', ')})`);

  const g = def.geometry;
  const floors = g.floors.map((f) => ({ ...f, fightBand: f.fightBand && { ...f.fightBand }, walls: f.walls && { ...f.walls }, spawns: f.spawns && f.spawns.map((p) => ({ ...p })) }));
  const stairs = g.stairs.map((s) => ({ ...s }));
  const lights = g.lights.map((l) => ({ ...l, color: [...l.color] }));
  const spawns = g.spawns.map((s) => ({ ...s }));

  const arena = {
    name,
    floors, stairs, lights, spawns,
    reflectY: g.reflectY,
    // where a fighter hits a wall on the main floor (compatibility; each floor carries its own walls)
    walls: floors[0].walls ? { ...floors[0].walls } : { left: floors[0].x0, right: floors[0].x1 },
    spawnsByFloor: floors.map((f, i) => (f.spawns ? f.spawns.map((p) => ({ ...p })) : i === 0 ? spawns.map((p) => ({ ...p })) : [])),
    stairwell: g.stairwell ? { ...g.stairwell, rail: { ...g.stairwell.rail } } : null,
    treads: (g.treads || []).map((t) => ({ ...t })),
    stairRail: (g.stairRail || []).map((t) => ({ ...t })),
    doors: (g.doors || []).map((list) => list.map((d) => ({ ...d }))),
    doorState: {},
    // open door j on floor f for `seconds` (horde goons entering); the art swings it open and shut
    openDoor(f, j, seconds = 1.4) { arena.doorState[f + ':' + j] = { t: seconds, dur: seconds }; },
    doorOpen(f, j) {
      const s = arena.doorState[f + ':' + j];
      if (!s || s.t <= 0) return 0;
      return Math.max(0, Math.min(1, (s.dur - s.t) / 0.2, s.t / 0.3));
    },
    gloss: g.gloss ? { ...g.gloss } : null,
    farParallax: typeof g.farParallax === 'number' ? g.farParallax : 0.35,
    foregroundParallax: typeof g.foregroundParallax === 'number' ? g.foregroundParallax : 1.4,
    // { x0, x1, y0, y1 } in world space, or null: the only place rain should fall indoors
    rainRegion: g.rainRegion ? { ...g.rainRegion } : null,
    liveColors: [],
    bodies: [],
    time: 0,
    style: 'shaded',
    palette: def.palettes.shaded,
    bodiesInBackground: true,

    setStyle(style) {
      if (!def.palettes[style]) throw new Error(`setStyle: unknown style '${style}'`);
      arena.style = style;
      arena.palette = def.palettes[style];
      return arena;
    },

    update(dt) {
      if (!(dt > 0)) return;
      arena.time += dt;
      for (const b of arena.bodies) if (b.t < 1) b.t = Math.min(1, b.t + dt / SETTLE_SECONDS);
      for (const k in arena.doorState) arena.doorState[k].t -= dt;
      if (def.flicker) def.flicker(lights, arena.time);
    },

    // snapshot: { x, y, facing, color, radius, joints, lineWidth } (all optional except x).
    // The body lands on the floor nearest the snapshot's y, so a fighter knocked off
    // the main floor can pile up on the lower one.
    addBody(snap = {}) {
      const dir = snap.facing === -1 || snap.facing === 1 ? -snap.facing : (arena.bodies.length % 2 ? -1 : 1);
      const sy = typeof snap.y === 'number' ? snap.y : floors[0].y;
      let floor = floors[0];
      for (const f of floors) if (Math.abs(f.y - sy) < Math.abs(floor.y - sy)) floor = f;
      // bodies lie inside the floor's fight band (on the lower floor, left of the stair)
      const band = floor.fightBand || { x0: floor.x0 + 70, x1: floor.x1 - 70 };
      const margin = floor.fightBand ? 40 : 0;
      let x = Math.max(band.x0 + margin, Math.min(band.x1 - margin, typeof snap.x === 'number' ? snap.x : (band.x0 + band.x1) / 2));
      const m = measure(snap.joints);
      // Nothing rests over the stairwell's opening (the fighters' walking line runs across it, the
      // floor doesn't): a body that would lie over the hole slides off to the nearer solid edge
      // (the settle tween carries it there), or the other edge when the nearer one is out of band.
      const sw = arena.stairwell;
      if (sw && Math.abs(floor.y - sw.y) < 1) {
        let a = Infinity, b = -Infinity;
        for (const v of [0, 1]) { const p = lyingPose(x, floor.y, dir, m, v); for (const k in p) { a = Math.min(a, p[k].x); b = Math.max(b, p[k].x); } }
        a -= 12; b += 12;   // the head's and limbs' thickness
        if (b > sw.x0 && a < sw.x1) {
          const left = x - (b - sw.x0), right = x + (sw.x1 - a);
          const okL = left >= band.x0 + margin, okR = right <= band.x1 - margin;
          if (okL && (!okR || x - left <= right - x)) x = left;
          else if (okR) x = right;
        }
      }
      let top = floor.y, under = 0;
      for (const b of arena.bodies) {
        if (b.floor === floor && Math.abs(b.x - x) < BODY_REACH) { top = Math.min(top, b.y - BODY_LIFT); under++; }
      }
      const y = Math.max(floor.y - BODY_LIFT * MAX_PILE, top);
      const idx = arena.bodies.length;
      const variant = ((idx * 7 + under * 3) % 5) / 4;
      const to = lyingPose(x, y, dir, m, variant);
      const from = hasAllJoints(snap.joints) && !collinear(snap.joints) ? copyJoints(snap.joints) : copyJoints(to);
      const recent = arena.bodies.slice(-4).map((b) => b.color);
      const color = pickBodyColor(snap.color || '#333', arena.liveColors, idx, recent);
      const drawColor = capLuma(desaturate(color, 0.55));
      const body = {
        x, y, dir, floor,
        color,          // the hue the body was given (for the record)
        drawColor,      // what is painted: luma-capped so live fighters outrank the pile
        rim: lighten(drawColor, 0.22), // a 1px lighter rim, so the silhouette and limb angles read on the floor
        radius: typeof snap.radius === 'number' ? snap.radius : 11,
        lineWidth: typeof snap.lineWidth === 'number' ? snap.lineWidth : 5,
        from, to, t: 0,
        joints: copyJoints(from),
      };
      arena.bodies.push(body);
      return body;
    },

    clearBodies() { arena.bodies.length = 0; },

    drawBodies(ctx) { drawBodies(ctx, arena.bodies, arena.style === 'shaded'); },

    // World space; the caller applies the camera scaled by arena.farParallax (the FX far
    // layer does this itself). Paints the full frame so it never shows a gap.
    drawFar(ctx, camera = DEFAULT_CAMERA) {
      def.drawFar(ctx, arena.palette, camera);
    },

    drawBackground(ctx, camera = DEFAULT_CAMERA) {
      def.draw(ctx, arena.palette, camera, arena);
      if (arena.bodiesInBackground) arena.drawBodies(ctx);
    },

    drawForeground(ctx) {
      def.drawForeground(ctx, arena.palette, lights);
    },

    drawEmissive(ctx, camera = DEFAULT_CAMERA) {
      def.drawEmissive(ctx, camera, lights);
    },
  };

  if (def.flicker) def.flicker(lights, 0);
  return arena;
}

function drawBodies(ctx, bodies, withRim) {
  for (const b of bodies) {
    const k = easeOut(b.t);
    const j = b.joints;
    for (const n of JOINT_NAMES) {
      j[n].x = b.from[n].x + (b.to[n].x - b.from[n].x) * k;
      j[n].y = b.from[n].y + (b.to[n].y - b.from[n].y) * k;
    }
    drawJoints(ctx, j, withRim ? b.drawColor : b.color, b.lineWidth, b.radius, withRim ? b.rim : null);
  }
}
