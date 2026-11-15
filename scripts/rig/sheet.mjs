// The joint limits' before/after contact sheet (README, Joint limits): one frame per move at its worst moment on the
// old rig (the step where a knee or elbow bent furthest the wrong way), the old pose on the left and the new on the
// right, with the bad limb ringed on the old one.
//   node scripts/rig/sheet.mjs --old /path/to/main/checkout [--out scripts/rig/results/limits-before-after.jpg]
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OLD = resolve(arg('--old', '/tmp/sf-main')), NEW = resolve(new URL('../..', import.meta.url).pathname);
const OUT = arg('--out', 'scripts/rig/results/limits-before-after.jpg');
// [move, character], the moves the task named first
const LIST = [['risingKnee', 'temp'], ['dropOffKnee', 'courier'], ['sr_pitch', 'salesRep'], ['crescent', 'security'], ['flashKick', 'temp'],
  ['lowKick', 'temp'], ['spinKick', 'temp'], ['updraft', 'windowWasher'], ['coffeeRun', 'intern'], ['hitBody', 'temp'], ['ticketReversal', 'helpdesk'], ['cross', 'temp'],
  ['jab', 'temp'], ['security_dance', 'security'], ['electrician_victory', 'electrician'], ['airTech', 'temp'], ['knockdown', 'temp'], ['sweep', 'temp']];

async function load(root) {
  const ch = await import(pathToFileURL(root + '/src/characters/index.js').href);
  const fi = await import(pathToFileURL(root + '/src/fighter/index.js').href);
  return { getCharacter: ch.getCharacter, createFighter: fi.createFighter, base: fi.RIG_KIT.base, setJointGuard: fi.setJointGuard };
}
const R2D = 180 / Math.PI;
const LIMBS = [['la', 'lShoulder', 'lElbow', 'lHand', 0, -1], ['ra', 'rShoulder', 'rElbow', 'rHand', 0, 1], ['ll', 'hip', 'lKnee', 'lFoot', 1, -1], ['rl', 'hip', 'rKnee', 'rFoot', 1, 1]];
function worst(J, spin) {
  const cs = Math.cos(spin * Math.PI / 180);
  if (Math.abs(cs) < 0.1) return { d: 0 };
  let best = { d: 0 };
  for (const [side, a, b, c, leg, sd] of LIMBS) {
    const off = sd * Math.abs(Math.sin(spin * Math.PI / 180)) * 12, bx = (p) => ((p.x - J.hip.x) - off) / cs;
    const ax = leg ? 0 : bx(J[a]), ux = bx(J[b]) - ax, uy = J[b].y - J[a].y, vx = bx(J[c]) - bx(J[b]), vy = J[c].y - J[b].y;
    const v = Math.atan2(uy * vx - ux * vy, ux * vx + uy * vy) * R2D;
    const d = leg ? (v > 3 && v < 170 ? Math.min(v - 3, 170 - v) : 0) : (v < -5 && v > -170 ? Math.min(-5 - v, v + 170) : 0);
    if (d > best.d) best = { d, side, v, joint: b };
  }
  return best;
}
function rigOf(L, id) {
  const c = L.getCharacter(id);
  const r = L.createFighter({ color: c.color, x: 0, y: 0, facing: 1, body: c.body });
  r.pants = id === 'temp' ? null : c.pants || null; r.setBody(c.body, { accent: c.accent }); r.speedLines = false; r.charDef = c;
  return { r, c };
}
// step a clip at 240 Hz, return [{ t, J, w }] ; at: a time to stop at instead of scanning
function frames(L, id, move) {
  const { r } = rigOf(L, id);
  r.reset({ full: true }); r.play(move);
  const def = L.base(move), dur = (def.blend || 0) + def.keys.reduce((s, k) => s + k.d, 0), out = [];
  for (let t = 0; t <= dur; t += 1000 / 240) { r.update(1 / 240); out.push({ t, w: worst(r._solve(r.pose), r.pose.spin || 0), spin: r.pose.spin || 0 }); if (r.current.done) break; }
  return out;
}
function drawAt(L, id, move, tStop, ctx, cx, cy, ring, zoom) {
  const { r, c } = rigOf(L, id);
  r.reset({ full: true }); r.play(move);
  for (let t = 0; t < tStop - 1e-6; t += 1000 / 240) r.update(1 / 240);
  r.joints = r._solve(r.pose);   // the pose as keyed (no spring lag), so old and new line up
  // centered on its own box, standing on the cell's floor
  let x0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const k in r.joints) { x0 = Math.min(x0, r.joints[k].x); x1 = Math.max(x1, r.joints[k].x); y1 = Math.max(y1, r.joints[k].y); }
  ctx.save(); ctx.beginPath(); ctx.rect(cx - CW / 2 + 2, cy - CH + 60, CW - 4, CH - 40); ctx.clip();
  ctx.translate(cx, cy); ctx.scale(zoom, zoom); ctx.translate(-(x0 + x1) / 2, -y1 + 0);
  ctx.shadowColor = c.color; ctx.shadowBlur = 6;
  r.draw(ctx);
  ctx.shadowBlur = 0;
  if (ring) { const j = r.joints[ring]; ctx.strokeStyle = '#E85D00'; ctx.lineWidth = 2.5 / zoom * 1.4; ctx.beginPath(); ctx.arc(j.x, j.y, 11, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
}

const CW = 300, CH = 250;
const oldL = await load(OLD), newL = await load(NEW);
newL.setJointGuard(false);   // the clips as keyed, so the sheet shows the reposes, not the safety net
const COLS = 3, ROWS = Math.ceil(LIST.length / COLS), HEAD = 64;
const cv = createCanvas(CW * 2 * COLS + 10 * (COLS - 1), HEAD + CH * ROWS), ctx = cv.getContext('2d');
ctx.fillStyle = '#0b0614'; ctx.fillRect(0, 0, cv.width, cv.height);
ctx.font = 'bold 22px monospace'; ctx.fillStyle = '#E85D00'; ctx.fillText('//', 16, 38);
ctx.fillStyle = '#f2f2f2'; ctx.fillText('JOINT_LIMITS   before (main) | after, at each move\'s worst old frame', 50, 38);
LIST.forEach(([move, id, mode], i) => {
  const col = i % COLS, row = Math.floor(i / COLS), x0 = col * (CW * 2 + 10), y0 = HEAD + row * CH;
  const fr = frames(oldL, id, move);
  let pick = fr.reduce((a, b) => (b.w.d > a.w.d ? b : a), fr[0]);
  if (mode === 'spin') { const s = fr.filter((f) => Math.abs(f.spin) > 120 && Math.abs(f.spin) < 240); if (s.length) pick = s.reduce((a, b) => (b.w.d > a.w.d ? b : a), s[0]); }
  const nf = frames(newL, id, move), nw = nf.reduce((a, b) => (b.w.d > a.w.d ? b : a), nf[0]);
  ctx.fillStyle = '#1a0f2e'; ctx.fillRect(x0, y0 + 4, CW * 2, CH - 8);
  ctx.strokeStyle = '#3a2a55'; ctx.beginPath(); ctx.moveTo(x0 + CW, y0 + 30); ctx.lineTo(x0 + CW, y0 + CH - 12); ctx.stroke();
  ctx.fillStyle = '#f2f2f2'; ctx.font = 'bold 15px monospace';
  ctx.fillText(`${move}${mode === 'spin' ? ' (mid-spin)' : ''} · ${id.toUpperCase()} · ${Math.round(pick.t)} ms`, x0 + 10, y0 + 24);
  ctx.font = '13px monospace';
  ctx.fillStyle = pick.w.d ? '#ff6b6b' : '#9a9a9a';
  ctx.fillText(pick.w.d ? `${pick.w.side} ${pick.w.side[1] === 'l' ? 'knee' : 'elbow'} ${pick.w.v.toFixed(0)}°` : 'clean', x0 + 10, y0 + CH - 14);
  ctx.fillStyle = nw.w.d ? '#ff6b6b' : '#7fd88f';
  ctx.fillText(nw.w.d ? `worst ${nw.w.v.toFixed(0)}°` : 'every frame clean', x0 + CW + 10, y0 + CH - 14);
  const zoom = 1.25;
  drawAt(oldL, id, move, pick.t, ctx, x0 + CW / 2, y0 + CH - 34, pick.w.d ? pick.w.joint : null, zoom);
  drawAt(newL, id, move, pick.t, ctx, x0 + CW + CW / 2, y0 + CH - 34, null, zoom);
});
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, cv.toBuffer('image/jpeg', 88));
console.log('wrote', OUT);
