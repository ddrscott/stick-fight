// The fighter pages' live rigs (README, "Site"): the game's real rig (src/fighter/) in each character's
// own body, colors and pants from its file (src/characters/). site/site.js loads this only on a page that
// has rig canvases, so the homepage and the roster (whose cards are pre-rendered sprites) skip it.
//   data-mode="move"      a move card: plays its clips (data-seq: a string's presses, a stance first) on a loop
//                         while it's on screen, and again at once on hover or tap
//   data-mode="perfect"   the PERFECT card: the perfect round finisher with the thrown body (PerfectView)
//   data-mode="showcase"  a fighter page's big rig: guard, then one of its unique moves every few seconds
// Only what's on screen animates (IntersectionObserver), nothing runs in a hidden tab, phones draw at a
// lower resolution, and prefers-reduced-motion gets still poses (a move card still plays on a tap).
import { getCharacter, TEMP_ID } from '../src/characters/index.js';
import { colorFor } from '../src/characters/registry.js';
import { createFighter, MOVE_DATA } from '../src/fighter/index.js';
import { createLife } from '../src/fighter/life.js';
import { createPerfectFX } from '../src/fx/perfect.js';

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
  rig.charDef = c;   // its cloth (a tie, a lanyard, an apron's hem) hangs at rest: the life layer is the game's only
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

// the fighter page's big rig: guard, then one of its moves, round and round. Between moves it stands with the
// game's life layer on top (src/fighter/life.js): the character's own sway, bounce and breath, its cloth swinging,
// and now and then one of its idle habits, which the next move waits for.
class ShowcaseView {
  constructor(canvas, c, seqs) {
    this.s = new Surface(canvas); this.c = c; this.rig = makeRig(c);
    this.seqs = seqs.map((q) => q.filter(hasClip)).filter((q) => q.length);
    this.n = 0; this.i = -1; this.t = 0; this.gap = rand(2.2, 4.4);
    this.life = createLife();
    this.unit = { id: 0, state: 'idle', phase: 'recovery', rig: this.rig, facing: 1, x: 0, char: c, health: 1, stamina: 1, staminaMax: 1, hitstop: 0 };
    this.sim = { units: [this.unit], phase: null, hitstopActive: 0 };
  }
  tick(dt) {
    const { rig, s, c } = this;
    this.t += dt;
    if (this.i < 0 && this.t > this.gap && this.seqs.length && !REDUCED && !this.life.busy(this.unit)) {
      this.q = this.seqs[this.n++ % this.seqs.length]; this.i = 0; rig.x = 0; safePlay(rig, this.q[0]); this.gap = rand(2.2, 4.4);
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
    // the life layer draws on a copy of the joints, like the game's render()
    this.unit.state = this.i >= 0 ? 'attack' : 'idle'; this.unit.x = rig.x;
    const real = rig.joints, J = REDUCED ? real : this.life.apply(this.unit, real, this.sim, dt);
    rig.joints = J;
    s.rig(rig, c.color, x, y, zoom, 12);
    rig.joints = real; rig.cloth = null;
  }
}

// the PERFECT card: the fighter's perfect round finisher on a TEMP lying in front of him, played on the same clock as
// the game (frameData PERFECT) with the game's own drawing of the thrown body (src/fx/perfect.js), the card standing
// in for the screen. A stand-in for the sim carries just what that drawing reads.
class PerfectView {
  constructor(canvas, c) {
    this.s = new Surface(canvas); this.c = c; this.rig = makeRig(c);
    const temp = getCharacter(TEMP_ID), loserColor = colorFor(temp, 1, c);   // as the game colors a P2 TEMP against this fighter
    this.lrig = makeRig(temp, loserColor);
    this.fx = createPerfectFX();
    this.w = { id: 0, char: c, rig: this.rig, facing: 1, pfFar: false, color: c.color };
    this.l = { id: 1, char: temp, rig: this.lrig, facing: -1, color: loserColor };
    this.sim = { units: [this.w, this.l], winner: 0, round: 0, seed: 7, stepCount: 0, perfectT: -2, perfectRel: -1, oppOf: (u) => (u === this.w ? this.l : this.w) };
    this.cam = { x: 70, y: -70, zoom: 2.3, shakeX: 0, shakeY: 0 };
    this.wait = rand(0.3, 0.8);
    canvas.addEventListener('click', () => this.start());
  }
  start() {
    const { sim, l, rig, lrig } = this;
    sim.round++; sim.perfectT = 0; sim.perfectRel = -1; sim.stepCount = 0;
    l.hidden = false; l.pfFrom = null; l.pfRel = null; l.pfGrabT = -1;
    lrig.x = 110; lrig.facing = -1; safePlay(lrig, 'ko'); for (let i = 0; i < 40; i++) lrig.update(0.05); lrig.events.length = 0;
    rig.x = 0; safePlay(rig, this.c.perfect.clip); rig.events.length = 0;
    wake(this);
  }
  tick(dt) {
    const { sim, rig, l, s, c } = this;
    if (sim.perfectT < 0) { if (!REDUCED && (this.wait -= dt) <= 0) this.start(); }
    else {
      sim.perfectT += dt; sim.stepCount = Math.round(sim.perfectT * 120);
      for (const ev of rig.events) {
        if (ev.type === 'grab' && l.pfGrabT < 0) { l.pfGrabT = sim.perfectT; l.pfFrom = copyJ(this.lrig.joints); l.hidden = true; }
        if (ev.type === 'release' && !l.pfRel) { const h = rig.joints[c.perfect.hand] || rig.joints.lHand; l.pfRel = { x: h.x, y: h.y }; l.hidden = true; sim.perfectRel = sim.perfectT; }
      }
      if (sim.perfectRel >= 0 && sim.perfectT > sim.perfectRel + 2.15) { sim.perfectT = -2; this.wait = 1.4; }
    }
    rig.events.length = 0;
    rig.update(dt);
    s.clear();
    const k = s.w / 1280, { cam } = this, ctx = s.ctx;
    // the room: the card is the screen, at the camera's framing
    ctx.setTransform(k * cam.zoom, 0, 0, k * cam.zoom, k * (640 - cam.x * cam.zoom), s.h / 2 - k * cam.y * cam.zoom);
    if (!l.hidden) { ctx.save(); ctx.globalAlpha = 0.7; this.lrig.draw(ctx); ctx.restore(); }
    ctx.save(); ctx.shadowColor = c.color; ctx.shadowBlur = 8 * s.dpr; rig.draw(ctx); ctx.restore();
    this.fx.drawWorld(ctx, sim, dt);
    // the glass: the screen-space part, the card scaled to 1280 wide
    ctx.setTransform(k, 0, 0, k, 0, (s.h - 720 * k) / 2);
    this.fx.drawScreen(ctx, sim, cam, dt);
  }
}
const copyJ = (j) => { const o = {}; for (const n in j) o[n] = { x: j[n].x, y: j[n].y }; return o; };

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
    else if (mode === 'perfect' && c.perfect) mount(cv, new PerfectView(cv, c));
    else if (mode === 'showcase') mount(cv, new ShowcaseView(cv, c, pageSeqs.length ? pageSeqs : SHARED_SEQS.slice(0, 6)));
  } catch (e) { console.error(`[site] ${mode} ${cv.dataset.char || ''}:`, e); }
}

