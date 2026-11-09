// The roster cards' idle animations, pre-rendered (README, "Site"). A live canvas rig per card was too
// slow on phones, so the build draws each fighter's idle loop with the game's own rig (createFighter +
// draw, in its body, colors, pants and glow) into a sprite sheet, and the page plays it with CSS steps().
// Runs in Node from site/generate.mjs, on @napi-rs/canvas (Skia, prebuilt for macOS and Linux, no
// browser needed), writing public/sprites/<id>-idle.webp and <id>-idle@2x.webp. Vite copies public/
// into the build; the folder is a build product (gitignored).
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getCharacter, TEMP_ID } from '../src/characters/index.js';
import { createFighter } from '../src/fighter/index.js';

export const FRAMES = 12;            // one idle loop: the clip's four 400 ms keys, a frame every 133 ms
export const LOOP_S = 1.6;
export const W = 160, H = 200;       // one frame at 1x (the roster card's 4:5 rig box)
export const PANEL = '#140829';      // the card background, site.css --panel (keep the two together)
const SETTLE_S = 2.4;               // play into the loop first, so the blend from the spawn pose is gone

function makeRig(c) {
  const rig = createFighter({ color: c.color, x: 0, y: 0, facing: 1, body: c.body });
  rig.pants = c.id === TEMP_ID ? null : c.pants || null;
  rig.setBody(c.body, { accent: c.accent });
  rig.speedLines = false;
  return rig;
}

// the same look as the old live card (site.js IdleView): a soft floor glow and the rig with a neon blur
function drawFrame(ctx, rig, c, x0, scale) {
  const w = W * scale, h = H * scale, fx = x0 + w / 2, fy = h * 0.93, zoom = h / 200 * 1.05;
  ctx.save(); ctx.translate(fx, fy); ctx.scale(1, 0.22);
  const r = w * 0.45, g = ctx.createRadialGradient(0, 0, 1, 0, 0, r);
  g.addColorStop(0, c.color + '66'); g.addColorStop(1, c.color + '00');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.save(); ctx.translate(fx, fy); ctx.scale(zoom, zoom);
  ctx.shadowColor = c.color; ctx.shadowBlur = 9 * scale;
  rig.draw(ctx);
  ctx.restore();
}

export function renderIdle(c, scale) {
  const canvas = createCanvas(W * scale * FRAMES, H * scale);
  const ctx = canvas.getContext('2d');
  // drawn on the card's own panel color (site.css --panel): an opaque sheet compresses about 5x smaller
  // than one whose soft glow lives in a lossless alpha channel
  ctx.fillStyle = PANEL; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const rig = makeRig(c);
  const dt = 1 / 120;
  for (let t = 0; t < SETTLE_S; t += dt) rig.update(dt);
  const per = LOOP_S / FRAMES;
  for (let i = 0; i < FRAMES; i++) {
    drawFrame(ctx, rig, c, i * W * scale, scale);
    for (let t = 0; t < per - 1e-9; t += dt) rig.update(dt);
  }
  return canvas.toBuffer('image/webp', 75);
}

/** write every fighter's sheets; throws (failing the build) if any can't be drawn */
export function writeSprites(sheets, dir) {
  mkdirSync(dir, { recursive: true });
  const want = new Set();
  for (const s of sheets) {
    const c = getCharacter(s.id);
    if (!c || c.id !== s.id) throw new Error(`[sprites] no character for ${s.id}`);
    for (const [scale, suffix] of [[1, ''], [2, '@2x']]) {
      const name = `${s.id}-idle${suffix}.webp`;
      writeFileSync(join(dir, name), renderIdle(c, scale));
      want.add(name);
    }
  }
  for (const f of readdirSync(dir)) if (!want.has(f)) rmSync(join(dir, f));
  for (const f of want) if (!existsSync(join(dir, f))) throw new Error(`[sprites] missing ${f}`);
  return want.size;
}
