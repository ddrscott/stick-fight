// The fighter pages' live rigs (README, "Site"): the game's real rig (src/fighter/) in each character's
// own body, colors and pants from its file (src/characters/). site/site.js loads this only on a page that
// has rig canvases, so the homepage and the roster (whose cards are pre-rendered sprites) skip it.
//   data-mode="move"      a move card: plays its clips (data-seq: a string's presses, a stance first) on a loop
//                         while it's on screen, and again at once on hover or tap
//   data-mode="showcase"  a fighter page's big rig: guard, then one of its unique moves every few seconds
// Only what's on screen animates (IntersectionObserver), nothing runs in a hidden tab, phones draw at a
// lower resolution, and prefers-reduced-motion gets still poses (a move card still plays on a tap).
import { getCharacter, TEMP_ID } from '../src/characters/index.js';
import { createFighter, MOVE_DATA } from '../src/fighter/index.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE = matchMedia('(pointer: coarse)').matches;
const MAX_DPR = COARSE ? 1.5 : 2;
const rand = (a, b) => a + Math.random() * (b - a);
const hasClip = (n) => !!MOVE_DATA[n];

function makeRig(c, color = c.color, pants = c.pants || null) {
  const rig = createFighter({ color, x: 0, y: 0, facing: 1, body: c.body });
  rig.pants = c.id === TEMP_ID ? null : pants;
  rig.setBody(c.body, { accent: c.accent });
  rig.speedLines = false;
  return rig;
}
function safePlay(rig, name, opt) { try { rig.play(name, opt); return true; } catch { return false; } }

// a canvas that keeps its backing store at its CSS size times the (capped) device pixel ratio
class Surface {
  constructor(canvas, maxDpr = MAX_DPR) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.maxDpr = maxDpr; this.dirty = true;
    new ResizeObserver(() => { this.dirty = true; }).observe(canvas);
  }
  fit() {
    if (!this.dirty) return;
    const r = this.canvas.getBoundingClientRect(), dpr = Math.min(this.maxDpr, devicePixelRatio || 1);
    this.w = Math.max(1, Math.round(r.width * dpr)); this.h = Math.max(1, Math.round(r.height * dpr)); this.dpr = dpr;
    if (this.canvas.width !== this.w || this.canvas.height !== this.h) { this.canvas.width = this.w; this.canvas.height = this.h; }
    this.dirty = false;
  }
  clear() { this.fit(); const { ctx } = this; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.w, this.h); }
  // a soft ellipse of the fighter's color on the floor (a circle squashed flat, so no hard edges)
  floorGlow(x, y, r, color) {
    const { ctx } = this;
    ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.22);
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, r);
    g.addColorStop(0, color + '66'); g.addColorStop(1, color + '00');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  rig(rig, color, x, y, zoom, glow = 9, reflect = 0) {
    const { ctx } = this;
    ctx.save(); ctx.translate(x, y); ctx.scale(zoom, zoom);
    ctx.shadowColor = color; ctx.shadowBlur = glow * this.dpr;
    rig.draw(ctx);
    if (reflect) { ctx.globalAlpha = reflect; ctx.shadowBlur = 0; ctx.scale(1, -1); rig.draw(ctx); }
    ctx.restore();
  }
}

// ---- the views ------------------------------------------------------------------------------------------
class MoveView {
  constructor(canvas, c, seq) {
    this.s = new Surface(canvas); this.c = c; this.rig = makeRig(c);
    this.seq = seq.filter(hasClip); this.i = -1; this.wait = rand(0.2, 0.6);
    const replay = () => this.start();
    canvas.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') replay(); });
    canvas.addEventListener('click', replay);
  }
  start() {
    if (!this.seq.length) return;
    this.rig.x = 0; this.i = 0;
    safePlay(this.rig, this.seq[0]);
    wake(this);
  }
  tick(dt) {
    const { rig, s, c } = this;
    if (this.i < 0) {
      if (!REDUCED && (this.wait -= dt) <= 0) this.start();
    } else {
      // a string's next press goes in at the recover key, like the game's cancel window
      for (const ev of rig.events) if (ev.type === 'recover' && this.i < this.seq.length - 1) { this.i++; safePlay(rig, this.seq[this.i], { chain: true }); break; }
    }
    rig.events.length = 0;
    rig.update(dt);
    if (this.i >= 0 && rig.current.done && this.i >= this.seq.length - 1) { this.i = -1; this.wait = 0.9; safePlay(rig, 'idle'); }
    if (this.i < 0 && Math.abs(rig.x) > 0.5) rig.x *= Math.max(0, 1 - dt * 6);   // ease back to the mark between loops
    s.clear();
    // the body fills the card's height; kicks and slides reach forward into the room in front of him
    const zoom = Math.min(s.h / 215, s.w / 175), x = s.w * (s.w > s.h * 1.2 ? 0.36 : 0.27), y = s.h * 0.92;
    s.floorGlow(x + 30 * zoom, y, s.w * 0.5, c.color);
    s.rig(rig, c.color, x, y, zoom);
  }
}

// the fighter page's big rig: guard, then one of its moves, round and round
class ShowcaseView {
  constructor(canvas, c, seqs) {
    this.s = new Surface(canvas); this.c = c; this.rig = makeRig(c);
    this.seqs = seqs.map((q) => q.filter(hasClip)).filter((q) => q.length);
    this.n = 0; this.i = -1; this.t = 0;
  }
  tick(dt) {
    const { rig, s, c } = this;
    this.t += dt;
    if (this.i < 0 && this.t > 2.2 && this.seqs.length && !REDUCED) {
      this.q = this.seqs[this.n++ % this.seqs.length]; this.i = 0; rig.x = 0; safePlay(rig, this.q[0]);
    } else if (this.i >= 0) {
      for (const ev of rig.events) if (ev.type === 'recover' && this.i < this.q.length - 1) { this.i++; safePlay(rig, this.q[this.i], { chain: true }); break; }
    }
    rig.events.length = 0;
    rig.update(dt);
    if (this.i >= 0 && rig.current.done && this.i >= this.q.length - 1) { this.i = -1; this.t = 0; safePlay(rig, 'idle'); }
    if (this.i < 0 && Math.abs(rig.x) > 0.5) rig.x *= Math.max(0, 1 - dt * 5);
    s.clear();
    const zoom = s.h / 235, x = s.w * 0.4, y = s.h * 0.92;
    s.floorGlow(x + 20 * zoom, y, s.w * 0.55, c.color);
    s.rig(rig, c.color, x, y, zoom, 12);
  }
}

// shared strings a showcase falls back on when its fighter has no unique moves
const SHARED_SEQS = [['jab', 'jab', 'cross'], ['jab', 'cross', 'roundhouse'], ['cross', 'lkick'], ['lkick', 'lkick', 'crescent'],
  ['lowJab', 'lowJab', 'lowKick'], ['jab', 'cross', 'uptown', 'neonTornado'], ['bodyBlow'], ['sweep'], ['overhead'], ['cross', 'jab', 'spinHeel']];

// ---- the scheduler: only what's on screen, never in a hidden tab ------------------------------------------
const live = new Set();
let raf = 0, last = 0;
function frame(t) {
  const dt = Math.min(0.05, Math.max(0, (t - last) / 1000)); last = t;
  for (const v of live) { try { v.tick(dt); } catch (e) { live.delete(v); console.error(e); } }
  raf = live.size && !document.hidden && !REDUCED ? requestAnimationFrame(frame) : 0;
}
function wake(v) {
  if (REDUCED && v) {   // still poses, except a move card someone tapped: it plays once
    let t = performance.now();
    const run = (now) => { v.tick(Math.min(0.05, (now - t) / 1000)); t = now; if (v.i >= 0) requestAnimationFrame(run); };
    requestAnimationFrame(run);
    return;
  }
  if (!raf && live.size && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); }
}
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const v = e.target.__view;
    if (!v) continue;
    if (e.isIntersecting) live.add(v); else live.delete(v);
  }
  wake();
}, { rootMargin: '80px' });
document.addEventListener('visibilitychange', () => wake());

// every view draws its first pose at once, so nothing on the page is ever an empty box
function mount(canvas, view) { canvas.__view = view; try { view.tick(0); } catch (e) { console.error(e); } seen.observe(canvas); }

const pageSeqs = [...document.querySelectorAll('canvas[data-mode="move"]')].map((cv) => (cv.dataset.seq || '').split(',').filter(Boolean));
for (const cv of document.querySelectorAll('canvas[data-mode]')) {
  const mode = cv.dataset.mode, c = cv.dataset.char ? getCharacter(cv.dataset.char) : null;
  try {
    if (!c) continue;
    else if (mode === 'move') mount(cv, new MoveView(cv, c, (cv.dataset.seq || '').split(',').filter(Boolean)));
    else if (mode === 'showcase') mount(cv, new ShowcaseView(cv, c, pageSeqs.length ? pageSeqs : SHARED_SEQS.slice(0, 6)));
  } catch (e) { console.error(`[site] ${mode} ${cv.dataset.char || ''}:`, e); }
}

