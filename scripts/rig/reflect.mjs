// One-off helper for the joint limits pass (2026-11-15): finds literal limb pairs in the clip sources
// (`la: [a, b]`, `ra:`, `ll:`, `rl:`) that bend a knee or elbow the wrong way and mirrors the limb about the line from
// its root to its tip. The hand or foot stays exactly where it was (so a strike's tip and reach hold), the elbow or
// knee goes to the other side, and the bend keeps its size. Prints every change; --write applies them.
import fs from 'node:fs';

const FILES = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const WRITE = process.argv.includes('--write');
const D = Math.PI / 180;
const ARM = [24, 23], LEG = [31, 30], KNEE = 3, ELBOW = -5, FOLD = 170;
const r1 = (v) => Math.round(v);
let n = 0;
for (const file of FILES) {
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(/\b(la|ra|ll|rl): \[(-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)\]/g, (m, k, a, b, off) => {
    const a0 = +a, a1 = +b, leg = k[1] === 'l';
    const w = ((a1 - a0) % 360 + 540) % 360 - 180;
    const bad = leg ? w > KNEE && w < FOLD : w < ELBOW && w > -FOLD;
    if (!bad) return m;
    const [U, L] = leg ? LEG : ARM;
    const x = Math.sin(a0 * D) * U + Math.sin(a1 * D) * L, y = Math.cos(a0 * D) * U + Math.cos(a1 * D) * L;
    const phi = Math.atan2(x, y) / D;
    // unwrap phi next to the pair so the new angles stay in the same turn as the old ones
    let p = phi; while (p - (a0 + a1) / 2 > 180) p -= 360; while (p - (a0 + a1) / 2 < -180) p += 360;
    const b0 = r1(2 * p - a0), b1 = r1(2 * p - a1);
    const line = src.slice(0, off).split('\n').length;
    console.log(`${file}:${line}  ${k}: [${a0}, ${a1}] (${w.toFixed(0)}) -> [${b0}, ${b1}] (${(b1 - b0).toFixed(0)})`);
    n++;
    return `${k}: [${b0}, ${b1}]`;
  });
  if (WRITE && out !== src) fs.writeFileSync(file, out);
}
console.log(`${n} limb pair(s)${WRITE ? ' rewritten' : ''}`);
