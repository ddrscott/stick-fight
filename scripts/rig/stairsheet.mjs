// The stairs' before/after contact sheet (README, Floors: The stairs): a fighter on a flight in the real sim, main on the
// left and this build on the right, each at the tick where main's legs were furthest off (a thigh or shin stretched or
// squashed against the clip, or a planted foot hanging over its tread). Bones off by more than 0.5 px are drawn red,
// with how far; the treads are drawn with their nosings.
//   node scripts/rig/stairsheet.mjs --old /path/to/main/checkout [--out scripts/rig/results/stairs-before-after.jpg]
// The old checkout needs sim.onStairLegs (the hook scripts/rig/stairlegs.mjs uses); see the README for the two lines.
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OLD = resolve(arg('--old', '/tmp/sf-main-tp94')), NEW = resolve(new URL('../..', import.meta.url).pathname);
const OUT = arg('--out', 'scripts/rig/results/stairs-before-after.jpg');

async function load(root) {
  const u = (p) => pathToFileURL(root + p).href;
  await import(u('/src/characters/index.js'));
  return {
    createArena: (await import(u('/src/arena/index.js'))).createArena, createCombat: (await import(u('/src/combat/sim.js'))).createCombat,
    EMPTY: (await import(u('/src/combat/input.js'))).EMPTY_INPUT, fi: await import(u('/src/fighter/index.js')),
  };
}
// [label, character, along the flight, facing down?, input(t, fc), ticks]
const LIST = [
  ['idle, facing down', 'temp', 200, true, () => ({}), 40],
  ['idle, facing up', 'security', 200, false, () => ({}), 40],
  ['walk down', 'temp', 120, true, (t, f) => ({ dx: f }), 110],
  ['walk up', 'intern', 280, false, (t, f) => ({ dx: f }), 110],
  ['back-walk up the flight', 'chef', 200, true, (t, f) => ({ dx: -f }), 110],
  ['run down', 'temp', 80, true, (t, f) => ({ dx: f, run: true }), 50],
  ['guard, facing down', 'lawyer', 200, true, () => ({ block: true }), 50],
  ['crouch, facing up', 'temp', 200, false, () => ({ down: true }), 50],
  ['cross, facing down', 'barista', 200, true, (t) => ({ rp: t < 3 }), 80],
  ['low kick, facing down', 'temp', 240, true, (t) => ({ down: t < 20, lk: t >= 1 && t < 4 }), 80],
  ['roundhouse, facing up', 'manager', 200, false, (t) => ({ rk: t < 3 }), 90],
  ['jab, facing up', 'courier', 200, false, (t) => ({ lp: t < 3 }), 60],
];

function run(L, [, who, along, down, act, len], record) {
  const arena = L.createArena('building'), sp = arena.spawns;
  const rigs = [L.fi.createFighter({ x: sp[0].x, y: sp[0].y, facing: 1 }), L.fi.createFighter({ x: sp[1].x, y: sp[1].y, facing: -1 })];
  let pad = L.EMPTY;
  const sim = L.createCombat({ fighters: rigs, arena, input: { snapshot: () => pad }, onEvent() {}, makeRig: null, moves: L.fi.MOVES, moveData: L.fi.MOVE_DATA });
  sim.setCharacters([who, 'temp'], [], []); sim.setHuman(0); sim.setController(1, 'none'); sim.resetMatch({ seed: 1, skipIntro: true, startHealth: 100000 });
  const st = arena.stairs[0], u = sim.units[0], o = sim.units[1], fc = down ? st.dir : -st.dir;
  o.floor = 0; o.stair = -1; o.x = down ? 1280 : 200; o.y = arena.floors[0].y;
  u.x = st.head + st.dir * along; u.stair = 0; u.floor = 0; u.y = arena.stairY(0, u.x); u.facing = fc;
  let before = null;
  sim.onStairLegs((v, b) => { if (v === u) before = b; });
  for (let t = 0; t < 30; t++) { pad = L.EMPTY; sim.tick(); }
  const out = [];
  for (let t = 0; t < len; t++) {
    before = null; pad = { ...L.EMPTY, ...act(t, fc) }; sim.tick();
    if (before && u.stair >= 0 && u.grounded) out.push({ t, J: JSON.parse(JSON.stringify(u.rig.joints)), B: before, rad: u.rig.radii });
    if (record && record(t)) break;
  }
  return { out, arena };
}
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const BONES = [['hip', 'lKnee', 'thigh'], ['lKnee', 'lFoot', 'shin'], ['hip', 'rKnee', 'thigh'], ['rKnee', 'rFoot', 'shin']];
function badness(f, arena) {
  let w = 0;
  for (const [a, b] of BONES) w = Math.max(w, Math.abs(d(f.J[a], f.J[b]) - d(f.B[a], f.B[b])));
  for (const ft of ['lFoot', 'rFoot']) if (f.B[ft].y > arena.stairY(0, f.B[ft].x) - 30) w = Math.max(w, arena.treadY(0, f.J[ft].x) - f.J[ft].y - (f.rad[ft] || 0));
  return w;
}

const CW = 300, CH = 280, ZOOM = 1.5;
function cell(ctx, f, arena, cx, cy, label) {
  const hip = f.J.hip, ox = cx - hip.x * ZOOM, oy = cy - (hip.y + 30) * ZOOM;
  const X = (x) => ox + x * ZOOM, Y = (y) => oy + y * ZOOM;
  ctx.save(); ctx.beginPath(); ctx.rect(cx - CW / 2 + 4, cy - CH / 2 + 34, CW - 8, CH - 60); ctx.clip();
  // the treads
  const st = arena.stairs[0];
  ctx.fillStyle = '#241640'; ctx.strokeStyle = '#E85D00'; ctx.lineWidth = 2;
  for (let x = hip.x - 140; x < hip.x + 140; x += 1) {
    const t = arena.treadY(0, x);
    ctx.fillStyle = '#241640'; ctx.fillRect(X(x), Y(t), ZOOM + 0.5, 400);
  }
  for (let i = -1; i < 20; i++) { const x = st.back0 + i * st.run * st.dir; const t = arena.treadY(0, x + st.dir); ctx.fillStyle = '#E85D00'; ctx.fillRect(X(x) - 2, Y(t) - 1, 4, 3); }
  // the body
  const seg = (a, b, col, w) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(X(f.J[a].x), Y(f.J[a].y)); ctx.lineTo(X(f.J[b].x), Y(f.J[b].y)); ctx.stroke(); };
  ctx.lineCap = 'round';
  for (const [a, b] of [['hip', 'chest'], ['chest', 'neck'], ['lShoulder', 'lElbow'], ['lElbow', 'lHand'], ['rShoulder', 'rElbow'], ['rElbow', 'rHand']]) seg(a, b, '#d8d8e8', 5);
  ctx.strokeStyle = '#d8d8e8'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(X(f.J.head.x), Y(f.J.head.y), 13 * ZOOM * 0.8, 0, Math.PI * 2); ctx.stroke();
  let worst = 0;
  ctx.font = 'bold 12px monospace';
  for (const [a, b, nm] of BONES) {
    const e = d(f.J[a], f.J[b]) - d(f.B[a], f.B[b]);
    worst = Math.max(worst, Math.abs(e));
    seg(a, b, Math.abs(e) > 0.5 ? (b[0] === 'l' ? '#b83a3a' : '#ff4d4d') : (b[0] === 'l' ? '#4f8f5c' : '#7fd88f'), 6);
    if (Math.abs(e) > 0.5) { ctx.fillStyle = '#ff4d4d'; ctx.fillText(`${nm} ${e > 0 ? '+' : ''}${e.toFixed(0)}`, X((f.J[a].x + f.J[b].x) / 2) + 8, Y((f.J[a].y + f.J[b].y) / 2)); }
  }
  // the feet at their drawn size (the far leg's dimmer)
  for (const k of ['lFoot', 'rFoot']) { ctx.fillStyle = k === 'lFoot' ? '#8a8aa0' : '#ffffff'; ctx.beginPath(); ctx.arc(X(f.J[k].x), Y(f.J[k].y), (f.rad[k] || 4) * ZOOM, 0, Math.PI * 2); ctx.fill(); }
  for (const k of ['lKnee', 'rKnee']) { ctx.fillStyle = k === 'lKnee' ? '#8a8aa0' : '#ffffff'; ctx.beginPath(); ctx.arc(X(f.J[k].x), Y(f.J[k].y), 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  ctx.font = '13px monospace'; ctx.fillStyle = worst > 0.5 ? '#ff6b6b' : '#7fd88f';
  ctx.fillText(worst > 0.5 ? `${label}: a bone ${worst.toFixed(1)} px off` : `${label}: bones exact`, cx - CW / 2 + 10, cy + CH / 2 - 14);
}

const oldL = await load(OLD), newL = await load(NEW);
const COLS = 3, ROWS = Math.ceil(LIST.length / COLS), HEAD = 64;
const cv = createCanvas(CW * 2 * COLS + 10 * (COLS - 1), HEAD + CH * ROWS), ctx = cv.getContext('2d');
ctx.fillStyle = '#0b0614'; ctx.fillRect(0, 0, cv.width, cv.height);
ctx.font = 'bold 22px monospace'; ctx.fillStyle = '#E85D00'; ctx.fillText('//', 16, 38);
ctx.fillStyle = '#f2f2f2'; ctx.fillText('STAIR_LEGS   main | now, at main\'s worst tick   green: the clip\'s bone length   red: stretched (+) / squashed (-) px   dim: far leg', 50, 38);
for (const [i, sc] of LIST.entries()) {
  const col = i % COLS, row = Math.floor(i / COLS), x0 = col * (CW * 2 + 10), y0 = HEAD + row * CH;
  const o = run(oldL, sc), n = run(newL, sc);
  const pick = o.out.reduce((a, b) => (badness(b, o.arena) > badness(a, o.arena) ? b : a), o.out[0]);
  const nf = n.out.find((f) => f.t === pick.t) || n.out[n.out.length - 1];
  ctx.fillStyle = '#140c24'; ctx.fillRect(x0, y0 + 4, CW * 2, CH - 8);
  ctx.strokeStyle = '#3a2a55'; ctx.beginPath(); ctx.moveTo(x0 + CW, y0 + 30); ctx.lineTo(x0 + CW, y0 + CH - 12); ctx.stroke();
  ctx.fillStyle = '#f2f2f2'; ctx.font = 'bold 15px monospace';
  ctx.fillText(`${sc[0]} · ${sc[1].toUpperCase()} · t${pick.t}`, x0 + 10, y0 + 24);
  cell(ctx, pick, o.arena, x0 + CW / 2, y0 + CH / 2 + 6, 'main');
  cell(ctx, nf, n.arena, x0 + CW + CW / 2, y0 + CH / 2 + 6, 'now');
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, cv.toBuffer('image/jpeg', 88));
console.log('wrote', OUT);
