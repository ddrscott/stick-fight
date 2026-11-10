// A world-space bitmap cache for static scenery (README, Performance). The building's art is hundreds
// of paths and gradients; drawing it every frame was the biggest share of a phone's frame. Instead it's
// drawn once into an offscreen canvas covering the view plus a margin, at the camera's zoom rounded up
// to the next 1/8 octave (so it's never stretched, at most 9% bigger than the screen needs and so still
// crisp at the close framing), and redrawn only when the camera leaves that region, the zoom moves to
// another step, or the key changes (the mirror, the palette, a door). Zooming in it draws a step ahead, and a
// bitmap serves until it's 30% bigger than needed, so an easing zoom redraws every few steps, not every one.
//
//   const c = createWorldCache({ x0, y0, x1, y1 })   the world rect the camera can ever show
//   c.ensure(view, scale, key, draw) -> boolean      view: the world rect on screen; scale: canvas px per
//                                                    world px wanted; draw(ctx): paints in world coords.
//                                                    false when no cache could hold it (the caller draws live)
//   c.canvas, c.x0, c.y0, c.s, c.version             what was drawn, where, at what scale (version bumps on
//                                                    every redraw, so a GL texture knows to re-upload)
//   c.map(camera, W, H, out)                         screen uv (0..1, v up) -> cache uv (v up, as uploaded
//                                                    flipped), as out = [ax, ay, bx, by]: uv * a + b

const STEP = Math.pow(2, 1 / 8);   // scale steps (1/8 octave, 9%)
const KEEP = STEP * STEP * STEP;   // a bitmap serves until it is this much bigger than the screen needs (30%)
const MARGIN = 0.5;                // of the view's size, on each side
const MAX_SIDE = 4096, MAX_AREA = 4096 * 2304;   // phones refuse bigger canvases (iOS caps a canvas's area)

export function createWorldCache(bounds) {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (canvas) { canvas.width = 1; canvas.height = 1; }
  const c = {
    canvas, key: null, x0: 0, y0: 0, x1: 0, y1: 0, s: 0, version: 0, redraws: 0, ms: 0, maxMs: 0,
    invalidate() { c.key = null; },
    ensure(view, scale, key, draw) {
      if (!canvas) return false;
      if (c.key === key && scale <= c.s * 1.0001 && scale >= c.s / KEEP
        && view.x0 >= c.x0 && view.y0 >= c.y0 && view.x1 <= c.x1 && view.y1 <= c.y1) return true;
      // the next step up; zooming in, one more, so the zoom can keep coming in a while before the next redraw
      let s = Math.pow(STEP, Math.ceil(Math.log(scale) / Math.log(STEP) - 1e-6));
      if (c.key === key && scale > c.s * 1.0001) s *= STEP;
      const vw = view.x1 - view.x0, vh = view.y1 - view.y0;
      for (const m of [MARGIN, MARGIN / 2, 0]) {
        // on the cache's own pixel grid, so a world point always lands on the same canvas pixel
        const g = 1 / s;
        // the margin stops at the bounds, the view itself never does (a shaken camera can peek past them)
        const x0 = Math.floor(Math.min(view.x0, Math.max(bounds.x0, view.x0 - vw * m)) / g) * g;
        const y0 = Math.floor(Math.min(view.y0, Math.max(bounds.y0, view.y0 - vh * m)) / g) * g;
        const x1 = Math.ceil(Math.max(view.x1, Math.min(bounds.x1, view.x1 + vw * m)) / g) * g;
        const y1 = Math.ceil(Math.max(view.y1, Math.min(bounds.y1, view.y1 + vh * m)) / g) * g;
        const w = Math.round((x1 - x0) * s), h = Math.round((y1 - y0) * s);
        if (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_AREA) continue;
        const t0 = performance.now();
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h);
        ctx.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
        draw(ctx);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        Object.assign(c, { key, x0, y0, x1, y1, s });
        c.version++; c.redraws++;
        c.ms = performance.now() - t0; if (c.ms > c.maxMs) c.maxMs = c.ms;   // what a redraw costs (the perf overlay shows it)
        return true;
      }
      c.key = null;
      return false;
    },
    // where screen uv lands in the cache, for a camera (with its shake) on a W x H screen
    map(cam, W, H, out) {
      const z = cam.zoom, cx = cam.x + (cam.shakeX || 0), cy = cam.y + (cam.shakeY || 0);
      const cw = canvas.width / c.s, ch = canvas.height / c.s;   // the cache's size in world px
      out[0] = W / z / cw; out[2] = (cx - W / 2 / z - c.x0) / cw;
      out[1] = H / z / ch; out[3] = 1 - (cy + H / 2 / z - c.y0) / ch;
      return out;
    },
    // draw the cache into a layer through its camera transform (ctx already holds the layer's camera)
    blit(ctx) {
      ctx.drawImage(canvas, c.x0, c.y0, canvas.width / c.s, canvas.height / c.s);
    },
  };
  return c;
}

// The world rect a camera shows on a W x H screen (shake included), for ensure()
export function viewRect(cam, W, H, out = { x0: 0, y0: 0, x1: 0, y1: 0 }) {
  const z = cam.zoom, cx = cam.x + (cam.shakeX || 0), cy = cam.y + (cam.shakeY || 0);
  out.x0 = cx - W / 2 / z; out.x1 = cx + W / 2 / z; out.y0 = cy - H / 2 / z; out.y1 = cy + H / 2 / z;
  return out;
}
