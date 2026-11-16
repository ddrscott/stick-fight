// A stride on the stairs, frame by frame (README, Floors: Legs on the steps): one fighter on a flight in the real sim,
// a row of frames per build (main on top when --old is given, this build under it), with each foot's path drawn as a
// trail and every tick where a foot kinks (the same measure as scripts/rig/stairlegs.mjs: the foot's vertical speed
// changing by more than the clip's own, KINK px) marked in red on the trail and on the frame.
//   node scripts/rig/stairstrip.mjs [--old /path/to/main] [--who chef] [--along 200] [--up] [--act backWalk]
//                                   [--from 40] [--to 100] [--every 4] [--out scripts/rig/results/stairs-backwalk.jpg]
// --up faces up the flight (default: facing down). --act is idle, walk, backWalk or run.
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OLD = arg('--old', null), NEW = resolve(new URL('../..', import.meta.url).pathname);
const WHO = arg('--who', 'chef'), ALONG = +arg('--along', 200), DOWN = !process.argv.includes('--up'), ACT = arg('--act', 'backWalk');
const FROM = +arg('--from', 0), TO = +arg('--to', 110), EVERY = +arg('--every', 4), KINK = 6, FLIGHT = +arg('--flight', 0);
const OUT = arg('--out', 'scripts/rig/results/stairs-backwalk.jpg');
const ACTS = { idle: () => ({}), walk: (f) => ({ dx: f }), backWalk: (f) => ({ dx: -f }), run: (f) => ({ dx: f, run: true }) };

async function load(root) {
  const u = (p) => pathToFileURL(root + p).href;
  await import(u('/src/characters/index.js'));
  return {
    createArena: (await import(u('/src/arena/index.js'))).createArena, createCombat: (await import(u('/src/combat/sim.js'))).createCombat,
    EMPTY: (await import(u('/src/combat/input.js'))).EMPTY_INPUT, fi: await import(u('/src/fighter/index.js')),
  };
}

function run(L) {
  const arena = L.createArena('building'), sp = arena.spawns;
  const rigs = [L.fi.createFighter({ x: sp[0].x, y: sp[0].y, facing: 1 }), L.fi.createFighter({ x: sp[1].x, y: sp[1].y, facing: -1 })];
  let pad = L.EMPTY;
  const sim = L.createCombat({ fighters: rigs, arena, input: { snapshot: () => pad }, onEvent() {}, makeRig: null, moves: L.fi.MOVES, moveData: L.fi.MOVE_DATA });
  sim.setCharacters([WHO, 'temp'], [], []); sim.setHuman(0); sim.setController(1, 'none'); sim.resetMatch({ seed: 1, skipIntro: true, startHealth: 100000 });
  const st = arena.stairs[FLIGHT], u = sim.units[0], o = sim.units[1], fc = DOWN ? st.dir : -st.dir;
  o.floor = 0; o.stair = -1; o.x = DOWN ? 1280 : (st.dir > 0 ? 200 : 2360); o.y = arena.floors[0].y;
  u.x = st.head + st.dir * ALONG; u.stair = FLIGHT; u.floor = 0; u.y = arena.stairY(FLIGHT, u.x); u.facing = fc;
  let before = null;
  sim.onStairLegs((v, b) => { if (v === u) before = b; });
  for (let t = 0; t < 30; t++) { pad = L.EMPTY; sim.tick(); }
  const out = [], hist = { lFoot: [], rFoot: [] };
  for (let t = 0; t < TO; t++) {
    before = null; pad = { ...L.EMPTY, ...ACTS[ACT](fc) }; sim.tick();
    if (!before || !(u.stair >= 0) || !u.grounded) { hist.lFoot = []; hist.rFoot = []; continue; }
    const J = JSON.parse(JSON.stringify(u.rig.joints)), f = { t, J, rad: u.rig.radii, kink: {} };
    for (const ft of ['lFoot', 'rFoot']) {
      const h = hist[ft];
      h.push({ y: J[ft].y, x: J[ft].x, w: before[ft].y, r: before[ft].y - u.rig.y });
      if (h.length > 3) h.shift();
      if (h.length === 3) {
        const d2 = (q) => h[2][q] - 2 * h[1][q] + h[0][q];
        f.kink[ft] = Math.min(Math.abs(d2('y') - d2('w')), Math.abs(d2('y') - d2('r'))) - st.slope * Math.abs(d2('x'));
      }
    }
    out.push(f);
  }
  return { out, arena, st };
}

const CW = 150, CH = 250, ZOOM = 1.6, HEAD = 70, ROWH = CH + 40;
const rows = [];
if (OLD) rows.push(['main', run(await load(resolve(OLD)))]);
rows.push([OLD ? 'this branch' : 'now', run(await load(NEW))]);
const frames = (r) => r.out.filter((f) => f.t >= FROM && f.t < TO && (f.t - FROM) % EVERY === 0);
const ncol = Math.max(...rows.map(([, r]) => frames(r).length));
const cv = createCanvas(Math.max(900, 20 + CW * ncol), HEAD + ROWH * rows.length + 10), ctx = cv.getContext('2d');
ctx.fillStyle = '#0b0614'; ctx.fillRect(0, 0, cv.width, cv.height);
ctx.font = 'bold 22px monospace'; ctx.fillStyle = '#E85D00'; ctx.fillText('//', 16, 34);
ctx.fillStyle = '#f2f2f2';
ctx.fillText(`STAIR_STRIDE   ${WHO.toUpperCase()} ${ACT === 'backWalk' ? 'backing' : ACT} ${DOWN ? (ACT === 'backWalk' ? 'up the flight, facing down' : 'facing down') : 'facing up'}   t${FROM}-${TO} every ${EVERY}`, 50, 34);
ctx.font = '13px monospace'; ctx.fillStyle = '#b8b8c8';
ctx.fillText(`trails: each foot's path over the whole run (white near foot, grey far foot); red dot: a tick where that foot kinks more than ${KINK} px`, 16, 56);
for (const [ri, [label, r]] of rows.entries()) {
  const y0 = HEAD + ri * ROWH, fs = frames(r), all = r.out.filter((f) => f.t >= FROM && f.t < TO);
  const n = all.reduce((a, f) => a + Object.values(f.kink).filter((v) => v > KINK).length, 0);
  ctx.font = 'bold 16px monospace'; ctx.fillStyle = n ? '#ff6b6b' : '#7fd88f';
  ctx.fillText(`${label}: ${n} foot kinks over ${KINK} px in these ${all.length} ticks`, 16, y0 + 18);
  for (const [ci, f] of fs.entries()) {
    const cx = 10 + ci * CW + CW / 2, cy = y0 + 30 + CH / 2, hip = f.J.hip;
    const X = (x) => cx + (x - hip.x) * ZOOM, Y = (y) => cy + (y - hip.y - 25) * ZOOM;
    ctx.save(); ctx.beginPath(); ctx.rect(cx - CW / 2 + 2, y0 + 28, CW - 4, CH); ctx.clip();
    ctx.fillStyle = '#140c24'; ctx.fillRect(cx - CW / 2, y0 + 28, CW, CH);
    for (let x = hip.x - CW; x < hip.x + CW; x += 0.5) { ctx.fillStyle = '#2a1a4a'; ctx.fillRect(X(x), Y(r.arena.treadY(FLIGHT, x)), ZOOM * 0.5 + 0.5, 400); }
    for (let i = -1; i < 20; i++) { const x = r.st.back0 + i * r.st.run * r.st.dir; ctx.fillStyle = '#E85D00'; ctx.fillRect(X(x) - 1.5, Y(r.arena.treadY(FLIGHT, x + r.st.dir)) - 1, 3, 3); }
    // trails (the feet over the whole run, in this frame's coordinates)
    for (const ft of ['lFoot', 'rFoot']) {
      ctx.strokeStyle = ft === 'lFoot' ? 'rgba(138,138,160,0.55)' : 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1; ctx.beginPath();
      all.forEach((g, i) => { const p = g.J[ft]; if (i) ctx.lineTo(X(p.x), Y(p.y)); else ctx.moveTo(X(p.x), Y(p.y)); });
      ctx.stroke();
      for (const g of all) if (g.kink[ft] > KINK) { ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(X(g.J[ft].x), Y(g.J[ft].y), 2.5, 0, Math.PI * 2); ctx.fill(); }
    }
    const seg = (a, b, col, w) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(X(f.J[a].x), Y(f.J[a].y)); ctx.lineTo(X(f.J[b].x), Y(f.J[b].y)); ctx.stroke(); };
    ctx.lineCap = 'round';
    for (const [a, b] of [['hip', 'lKnee'], ['lKnee', 'lFoot']]) seg(a, b, '#8a8aa0', 5);
    for (const [a, b] of [['hip', 'chest'], ['chest', 'neck'], ['lShoulder', 'lElbow'], ['lElbow', 'lHand'], ['rShoulder', 'rElbow'], ['rElbow', 'rHand']]) seg(a, b, '#d8d8e8', 4);
    for (const [a, b] of [['hip', 'rKnee'], ['rKnee', 'rFoot']]) seg(a, b, '#ffffff', 5);
    ctx.strokeStyle = '#d8d8e8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(X(f.J.head.x), Y(f.J.head.y), (f.rad.head || 10) * ZOOM, 0, Math.PI * 2); ctx.stroke();
    for (const ft of ['lFoot', 'rFoot']) { const bad = f.kink[ft] > KINK; ctx.fillStyle = bad ? '#ff3b3b' : ft === 'lFoot' ? '#8a8aa0' : '#ffffff'; ctx.beginPath(); ctx.arc(X(f.J[ft].x), Y(f.J[ft].y), (f.rad[ft] || 3) * ZOOM + (bad ? 2 : 0), 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    ctx.font = '12px monospace'; ctx.fillStyle = '#9a9ab0'; ctx.fillText(`t${f.t}`, cx - CW / 2 + 6, y0 + 42);
  }
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, cv.toBuffer('image/jpeg', 90));
console.log('wrote', OUT);
