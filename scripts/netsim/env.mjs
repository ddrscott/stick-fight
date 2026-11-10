// The browser around the game, faked for Node: a virtual clock that drives performance.now(), setTimeout and
// setInterval, and just enough DOM for src/net/online.js (its readout and lobby panel build elements nobody sees).
// Every scheduled callback has an owner (the client it belongs to), so a phone can be frozen (iOS suspends a
// backgrounded page: no frames, no timers, nothing delivered) or hidden (Android: no frames, the rest runs).

export const sched = { t: 0, seq: 0, heap: /** @type {any[]} */ ([]), cur: /** @type {any} */ (null) };

const less = (a, b) => a.t < b.t || (a.t === b.t && a.seq < b.seq);
function push(ev) {
  const h = sched.heap; h.push(ev);
  let i = h.length - 1;
  while (i > 0) { const p = (i - 1) >> 1; if (!less(h[i], h[p])) break; [h[i], h[p]] = [h[p], h[i]]; i = p; }
}
function pop() {
  const h = sched.heap, top = h[0], last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && less(h[l], h[m])) m = l;
      if (r < h.length && less(h[r], h[m])) m = r;
      if (m === i) break;
      [h[i], h[m]] = [h[m], h[i]]; i = m;
    }
  }
  return top;
}

/** run fn at virtual time t (ms), as `owner` (a client, or null for the network itself) */
export function at(t, fn, owner = sched.cur, kind = 'timer') {
  const ev = { t: Math.max(t, sched.t), seq: sched.seq++, fn, owner, kind, dead: false };
  push(ev);
  return ev;
}

/** run everything due up to tEnd (or until stop() says so). Microtasks (promise continuations) get to run
 *  between events, the way a browser's event loop lets them. */
export async function runUntil(tEnd, stop) {
  let n = 0;
  while (sched.heap.length && sched.heap[0].t <= tEnd) {
    const ev = pop();
    if (ev.dead) continue;
    const o = ev.owner;
    // a frozen phone runs nothing until it wakes; a hidden one draws no frames
    if (o && (o.frozenUntil > ev.t || (ev.kind === 'frame' && o.hiddenUntil > ev.t))) {
      ev.t = Math.max(o.frozenUntil, ev.kind === 'frame' ? o.hiddenUntil : 0); ev.seq = sched.seq++; push(ev); continue;
    }
    sched.t = ev.t; sched.cur = o;
    try { ev.fn(); } finally { sched.cur = null; }
    if (++n % 8 === 0) await null;
    if (stop && stop()) return;
  }
  if (!(stop && stop())) sched.t = Math.max(sched.t, tEnd);
}

export function resetClock() { sched.t = 0; sched.seq = 0; sched.heap.length = 0; sched.cur = null; }

// ---- the fake DOM ------------------------------------------------------------------------------------------
class ClassList { constructor() { this.s = new Set(); } add(...c) { c.forEach((x) => this.s.add(x)); } remove(...c) { c.forEach((x) => this.s.delete(x)); } toggle(c, on) { const v = on === undefined ? !this.s.has(c) : !!on; if (v) this.s.add(c); else this.s.delete(c); return v; } contains(c) { return this.s.has(c); } *[Symbol.iterator]() { yield* this.s; } }
class El {
  constructor() { this.classList = new ClassList(); this.style = { setProperty() {}, removeProperty() {} }; this.dataset = {}; this.hidden = false; this.className = ''; this.textContent = ''; this.value = ''; this.children = []; }
  set innerHTML(v) { this._html = v; } get innerHTML() { return this._html || ''; }
  appendChild(c) { this.children.push(c); return c; }
  append(...c) { this.children.push(...c); }
  querySelector() { return new El(); }
  querySelectorAll() { return []; }
  addEventListener() {} removeEventListener() {}
  focus() {} blur() {} click() {} remove() {} setSelectionRange() {}
  contains() { return false; }
  getBoundingClientRect() { return { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 }; }
}

export function installDom() {
  const g = /** @type {any} */ (globalThis);
  const documentElement = new El();
  g.HTMLElement = El; g.Element = El; g.HTMLInputElement = class extends El {};
  g.document = {
    documentElement, body: new El(), head: new El(), activeElement: null, referrer: '', fonts: null, baseURI: 'http://localhost/play/',
    createElement: () => new El(), createTextNode: (t) => ({ textContent: t }), getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
  };
  g.window = g; g.top = g;
  g.addEventListener = () => {}; g.removeEventListener = () => {};
  g.location = { href: 'http://localhost/play/', search: '', protocol: 'http:', hostname: 'localhost', origin: 'http://localhost', pathname: '/play/', hash: '' };
  g.history = { replaceState() {} };
  const store = new Map();
  g.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  try { Object.defineProperty(g, 'navigator', { value: { userAgent: 'node', doNotTrack: '1' }, configurable: true, writable: true }); } catch { /* read-only */ }
  g.matchMedia = () => ({ matches: false, addEventListener() {} });
  g.requestAnimationFrame = () => 0; g.cancelAnimationFrame = () => {};
}

/** performance.now() and the timers on the virtual clock (after the game's modules are imported) */
export function installClock() {
  const g = /** @type {any} */ (globalThis);
  Object.defineProperty(g, 'performance', { value: { now: () => sched.t }, configurable: true, writable: true });
  const timers = new Map();
  let id = 1;
  g.setTimeout = (fn, ms = 0, ...a) => { const k = id++; timers.set(k, at(sched.t + Math.max(0, +ms || 0), () => { timers.delete(k); fn(...a); })); return k; };
  g.clearTimeout = (k) => { const ev = timers.get(k); if (ev) { ev.dead = true; timers.delete(k); } };
  g.setInterval = (fn, ms = 0) => {
    const k = id++, every = Math.max(1, +ms || 0), owner = sched.cur;
    const tick = () => { timers.set(k, at(sched.t + every, tick, owner)); fn(); };
    timers.set(k, at(sched.t + every, tick, owner));
    return k;
  };
  g.clearInterval = g.clearTimeout;
}

/** a canvas context that swallows every call (the rig draws into it; only its side effects matter here) */
export const nullCtx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
