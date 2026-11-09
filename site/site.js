// The site's script (README, "Site"): every page around the game loads it. The pages themselves are
// generated HTML; this only brings them to life with the game's real rig (src/fighter/), in each
// character's own body, colors and pants from its file (src/characters/):
//   data-mode="idle"      a roster card: the fighter breathing in guard
//   data-mode="move"      a move card: plays its clips (data-seq: a string's presses, a stance first) on a loop
//                         while it's on screen, and again at once on hover or tap
//   data-mode="showcase"  a fighter page's big rig: guard, then one of its unique moves every few seconds
//   data-mode="duel"      the homepage hero: two random fighters trading strings, blocks and knockdowns
// Only what's on screen animates (IntersectionObserver), nothing runs in a hidden tab, phones draw at a
// lower resolution, and prefers-reduced-motion gets still poses (a move card still plays on a tap).
import '../src/analytics.js';
import { install } from '../src/install.js';
import { getCharacter, roster, colorFor, pantsFor, TEMP_ID } from '../src/characters/index.js';
import { createFighter, MOVE_DATA } from '../src/fighter/index.js';
import { FRAME_DATA } from '../src/combat/frameData.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE = matchMedia('(pointer: coarse)').matches;
const MAX_DPR = COARSE ? 1.5 : 2;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const hasClip = (n) => !!MOVE_DATA[n];
// the clip a move plays (the sim resolves it the same way: its own, else the first of its anims)
const animOf = (m) => { const fd = FRAME_DATA[m]; return fd ? [m, ...(fd.anims || []), ...(fd.anim ? [fd.anim] : [])].find(hasClip) || null : hasClip(m) ? m : null; };

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
class IdleView {
  constructor(canvas, c) {
    this.s = new Surface(canvas); this.c = c; this.rig = makeRig(c);
    this.rig.update(rand(0, 1.2));   // not every card breathes in step
  }
  tick(dt) {
    const { s, c } = this;
    this.rig.update(dt);
    s.clear();
    s.floorGlow(s.w / 2, s.h * 0.93, s.w * 0.45, c.color);
    s.rig(this.rig, c.color, s.w / 2, s.h * 0.93, s.h / 200 * 1.05);
  }
}

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

// ---- the homepage duel ---------------------------------------------------------------------------------
const SPACING = 150;   // root to root, in rig units: a jab's reach plus the other body
const SHARED_SEQS = [['jab', 'jab', 'cross'], ['jab', 'cross', 'roundhouse'], ['cross', 'lkick'], ['lkick', 'lkick', 'crescent'],
  ['lowJab', 'lowJab', 'lowKick'], ['jab', 'cross', 'uptown', 'neonTornado'], ['bodyBlow'], ['sweep'], ['overhead'], ['cross', 'jab', 'spinHeel']];
const quietMove = (fd) => !fd || fd.noHit || fd.stance || fd.parry || fd.throwCounter || fd.throw || fd.air || fd.stanceOnly;

// what a character might throw in the demo: its own strike commands and strings, and the shared strings
function optionsFor(c) {
  const own = [];
  for (const k of c.commands) { const fd = FRAME_DATA[k.move], a = animOf(k.move); if (a && !quietMove(fd) && k.motion !== 'airDown') own.push([{ move: k.move, clip: a }]); }
  for (const st of c.strings) {
    if (!st.moves.some((m) => FRAME_DATA[m] && FRAME_DATA[m].owner === c.id)) continue;
    const q = st.moves.map((m) => ({ move: m, clip: animOf(m) }));
    if (q.every((x) => x.clip && !quietMove(FRAME_DATA[x.move]))) own.push(q);
  }
  // a shared string only if this character keeps it (THE MANAGER's 1, 2 goes into his own review)
  const keeps = (q) => q.length === 1 || c.strings.some((st) => q.every((m, i) => st.moves[i] === m));
  const shared = SHARED_SEQS.filter(keeps).map((q) => q.map((m) => ({ move: m, clip: animOf(m) }))).filter((q) => q.every((x) => x.clip));
  return { own, shared };
}

class DuelView {
  constructor(canvas) {
    this.s = new Surface(canvas, COARSE ? 1.25 : 1.75);
    this.fade = 0; this.swap = false; this.exchanges = 0;
    this.camX = 0; this.camZ = 0;
    this.newPair();
  }
  newPair() {
    const list = roster();
    const a = pick(list); let b = pick(list); while (list.length > 1 && b.id === a.id) b = pick(list);
    const ca = colorFor(a, 0, b), cb = colorFor(b, 1, a), pa = pantsFor(a, 0, b), pb = pantsFor(b, 1, a, pa);
    this.f = [{ c: a, color: ca, rig: makeRig(a, ca, pa), home: -SPACING / 2, facing: 1 }, { c: b, color: cb, rig: makeRig(b, cb, pb), home: SPACING / 2, facing: -1 }];
    for (const u of this.f) { u.rig.x = u.home; u.rig.facing = u.facing; u.opts = optionsFor(u.c); u.rig.update(rand(0, 1)); }
    this.state = 'neutral'; this.t = rand(0.4, 0.9); this.exchanges = 0;
  }
  begin() {
    const att = this.f[Math.random() < 0.5 ? 0 : 1], def = this.f[att === this.f[0] ? 1 : 0];
    const { own, shared } = att.opts;
    this.att = att; this.def = def;
    this.q = own.length && Math.random() < 0.55 ? pick(own) : pick(shared);
    this.i = 0; this.guard = Math.random() < 0.38; this.down = false;
    this.strike(0, false);
    this.state = 'attack';
  }
  strike(i, chain) {
    const gap = Math.abs(this.def.rig.x - this.att.rig.x);
    safePlay(this.att.rig, this.q[i].clip, { reach: gap - 14, ...(chain ? { chain: true } : {}) });
  }
  react(i) {
    const fd = FRAME_DATA[this.q[i].move] || {}, last = i === this.q.length - 1, d = this.def.rig;
    const low = fd.height === 'low';
    if (this.guard && !fd.unblockable) { safePlay(d, low ? 'crouchBlockHit' : 'blockHit'); return; }
    if (last && fd.knockdown) { safePlay(d, 'knockdown'); this.down = true; return; }
    safePlay(d, low ? 'hitLow' : fd.damage >= 12 ? 'hitHeavy' : fd.height === 'mid' ? 'hitBody' : 'hitLight');
  }
  // walk each fighter back to his mark, one step at a time, feet planted (the rig's advance clip)
  regroup() {
    let busy = false;
    for (const u of this.f) {
      if (!u.rig.current.done && u.rig.current.move !== 'idle') { busy = true; continue; }
      const d = (u.home - u.rig.x) * u.facing;
      if (Math.abs(d) > 8) { safePlay(u.rig, 'advance', { distance: Math.max(-60, Math.min(60, d)) }); busy = true; }
      else if (u.rig.current.done) safePlay(u.rig, 'idle');
    }
    return busy;
  }
  tick(dt) {
    const [A, B] = this.f;
    this.dtLast = dt;
    if (this.state === 'neutral') {
      if ((this.t -= dt) <= 0) {
        if (this.exchanges >= 5) { if (!this.swap) this.swap = true; }
        else this.begin();
      }
    } else if (this.state === 'attack') {
      for (const ev of this.att.rig.events) {
        if (ev.type === 'active') this.react(this.i);
        if (ev.type === 'recover' && this.i < this.q.length - 1) { this.i++; this.strike(this.i, true); }
      }
      if (this.att.rig.current.done && this.i >= this.q.length - 1) { this.state = 'after'; this.t = this.down ? 0.5 : 0.25; }
    } else if (this.state === 'after') {
      const d = this.def.rig;
      if (this.down && d.current.done && d.current.move === 'knockdown' && (this.t -= dt) <= 0) safePlay(d, 'getup');
      else if (!this.down) this.t -= dt;
      if ((this.down ? d.current.move === 'getup' && d.current.done : this.t <= 0 && d.current.done)) { this.state = 'regroup'; }
    } else if (this.state === 'regroup') {
      if (!this.regroup()) { this.state = 'neutral'; this.t = rand(0.35, 0.9); this.exchanges++; }
    }
    for (const u of this.f) u.rig.events.length = 0;
    for (const u of this.f) u.rig.update(dt);
    // a new pair every few exchanges, under a quick fade
    if (this.swap) { this.fade += dt * 3; if (this.fade >= 1) { this.newPair(); this.swap = false; } }
    else if (this.fade > 0) this.fade = Math.max(0, this.fade - dt * 3);
    this.draw(A, B);
  }
  draw(A, B) {
    const { s } = this;
    s.clear();
    const { ctx, w, h } = s;
    // on a narrow phone the duel has its own strip above the copy (site.css): center it and fill it
    const stacked = getComputedStyle(s.canvas).position !== 'absolute';
    const portrait = stacked || h > w * 1.05;
    // the camera follows the pair (a getup or a long string can carry them off their marks) and pulls
    // back to keep both in frame, eased so it never jumps
    const mid = (A.rig.x + B.rig.x) / 2, sep = Math.abs(A.rig.x - B.rig.x) + 250;
    const wantZ = stacked ? Math.min(h * 0.78 / 230, w * 0.9 / sep) : portrait ? Math.min(h * 0.4 / 230, w * 0.9 / sep) : Math.min(h * 0.62 / 230, (w > 900 * s.dpr ? w * 0.42 : w * 0.5) / sep);
    const k = this.camZ ? Math.min(1, (this.dtLast || 0.016) * 4) : 1;
    this.camZ += (wantZ - this.camZ) * k; this.camX += (mid - this.camX) * k;
    const zoom = this.camZ;
    const cx = (portrait ? w * 0.5 : w > 900 * s.dpr ? w * 0.74 : w * 0.7) - this.camX * zoom;
    const fy = stacked ? h * 0.86 : portrait ? h * 0.44 : h * 0.8;
    // the floor: a glowing line and a grid running away into the dark
    ctx.save();
    const grad = ctx.createLinearGradient(0, fy, 0, h);
    grad.addColorStop(0, 'rgba(255,43,214,0.16)'); grad.addColorStop(1, 'rgba(7,2,15,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, fy, w, h - fy);
    ctx.strokeStyle = 'rgba(180,107,255,0.22)'; ctx.lineWidth = 1 * s.dpr;
    const gx = cx + this.camX * zoom;
    for (let i = -14; i <= 14; i++) { ctx.beginPath(); ctx.moveTo(gx + i * 40 * zoom, fy); ctx.lineTo(gx + i * 220 * zoom, h); ctx.stroke(); }
    for (let k = 1; k < 6; k++) { const y = fy + (h - fy) * (k * k) / 36; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.shadowColor = '#ff2bd6'; ctx.shadowBlur = 14 * s.dpr; ctx.strokeStyle = 'rgba(255,90,230,0.85)'; ctx.lineWidth = 2 * s.dpr;
    ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(w, fy); ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 1 - this.fade;
    for (const u of [A, B]) s.floorGlow(cx + u.rig.x * zoom, fy, 90 * zoom, u.color);
    for (const u of [A, B]) s.rig(u.rig, u.color, cx, fy, zoom, 12, 0.16);
    ctx.restore();
  }
}

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
    if (mode === 'duel') mount(cv, new DuelView(cv));
    else if (!c) continue;
    else if (mode === 'idle') mount(cv, new IdleView(cv, c));
    else if (mode === 'move') mount(cv, new MoveView(cv, c, (cv.dataset.seq || '').split(',').filter(Boolean)));
    else if (mode === 'showcase') mount(cv, new ShowcaseView(cv, c, pageSeqs.length ? pageSeqs : SHARED_SEQS.slice(0, 6)));
  } catch (e) { console.error(`[site] ${mode} ${cv.dataset.char || ''}:`, e); }
}

// ---- install: the browser's own prompt where there is one, the how-to on an iPhone ---------------------------
const box = document.querySelector('[data-install]');
if (box) {
  const btn = box.querySelector('[data-install-button]'), text = box.querySelector('[data-install-text]');
  const paint = () => {
    if (install.standalone) { box.hidden = true; return; }
    const k = install.kind;
    btn.hidden = k !== 'prompt';
    if (k === 'prompt') text.innerHTML = '<b>INSTALL IT</b> and it opens full screen, like a native game.';
    else if (k === 'ios') text.innerHTML = '<b>INSTALL IT:</b> tap Share, then Add to Home Screen. It opens full screen, like a native game.';
  };
  btn.addEventListener('click', () => install.prompt());
  install.onChange(paint);
  paint();
}
