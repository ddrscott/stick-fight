// Frame profiler and the ?perf=1 overlay (README, Performance). Always on and cheap: a few
// performance.now() reads a frame into fixed typed-array rings, no garbage. The overlay is a small DOM
// panel that refreshes 4 times a second. window.__perf is what the measurement harness reads
// (scripts/perf/run.mjs).
//
//   perf.begin(now)            top of the rAF callback: the interval since the last frame
//   perf.mark('sim'|'draw'|'gl'|'hud')   end of that phase (times are from the previous mark)
//   perf.end()                 bottom of the rAF callback
//   perf.rollback(ms, depth)   a correction re-ran depth frames in ms (src/net/rollback.js reports it)
//   perf.summary()             p50/p95/p99 of the frame interval and each phase over the ring, long frames a minute

const N = 600;   // 10 s at 60 fps
const PHASES = ['sim', 'draw', 'gl', 'hud'];
const ring = { iv: new Float32Array(N), work: new Float32Array(N) };
for (const p of PHASES) ring[p] = new Float32Array(N);
let n = 0, head = 0, last = 0, t0 = 0, tMark = 0;
const cur = { sim: 0, draw: 0, gl: 0, hud: 0 };
const rb = { last: 0, lastDepth: 0, max: 0, maxDepth: 0, count: 0, at: -1e9 };
// long frames: an interval over 25 ms (a missed vsync and then some), counted with their times over the last minute
const longAt = new Float64Array(512); let longHead = 0;
let info = { tier: 0, dpr: 1, scale: 1 };

function pct(a, count, p) {
  if (!count) return 0;
  const s = Array.prototype.slice.call(a, 0, count).sort((x, y) => x - y);
  return s[Math.min(count - 1, Math.floor(p * count))];
}

export const perf = {
  begin(now) {
    if (last) {
      const iv = now - last;
      if (iv < 500) {   // a hidden tab or a breakpoint is not a frame
        ring.iv[head] = iv;
        if (iv > 25) { longAt[longHead] = now; longHead = (longHead + 1) % longAt.length; }
      }
    }
    last = now; t0 = tMark = performance.now();
    cur.sim = cur.draw = cur.gl = cur.hud = 0;
  },
  mark(phase) { const t = performance.now(); cur[phase] += t - tMark; tMark = t; },
  end() {
    const t = performance.now();
    ring.work[head] = t - t0;
    for (const p of PHASES) ring[p][head] = cur[p];
    head = (head + 1) % N; if (n < N) n++;
  },
  rollback(ms, depth) {
    rb.last = ms; rb.lastDepth = depth; rb.count++; rb.at = performance.now();
    if (ms > rb.max) { rb.max = ms; rb.maxDepth = depth; }
  },
  setInfo(o) { info = { ...info, ...o }; },
  reset() { n = 0; head = 0; last = 0; longHead = 0; longAt.fill(0); rb.last = rb.lastDepth = rb.max = rb.maxDepth = rb.count = 0; },
  summary() {
    const out = { frames: n, info, rollback: { ...rb } };
    const now = performance.now();
    let long = 0; for (let i = 0; i < longAt.length; i++) if (longAt[i] && now - longAt[i] < 60000) long++;
    const span = Math.min(60000, n ? ring.iv.slice(0, n).reduce((a, b) => a + b, 0) : 0);
    out.longPerMin = span > 1000 ? long * 60000 / Math.max(span, 1) : 0;
    for (const k of ['iv', 'work', ...PHASES]) out[k] = { p50: pct(ring[k], n, 0.5), p95: pct(ring[k], n, 0.95), p99: pct(ring[k], n, 0.99), max: n ? Math.max(...ring[k].subarray(0, n)) : 0 };
    out.fps = out.iv.p50 ? 1000 / (ring.iv.subarray(0, n).reduce((a, b) => a + b, 0) / n) : 0;
    return out;
  },
};
if (typeof window !== 'undefined') window.__perf = perf;

// ---- the overlay -----------------------------------------------------------------------------------
// ?perf=1: frame time, the work in it by phase (sim, 2D draw, GL, HUD), the last and worst rollback
// re-sim, the tier and the canvas scale. Hard corners and mono figures; it sits top left under the HUD's bars.
export function perfOverlay(parent) {
  const el = document.createElement('div');
  el.id = 'perf';
  el.style.cssText = 'position:absolute;left:6px;top:14%;z-index:60;pointer-events:none;padding:5px 8px;'
    + 'font:600 11px/1.35 ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace;color:#e9e2ff;'
    + 'background:rgba(10,6,20,0.82);border:1px solid rgba(232,93,0,0.85);white-space:pre';
  parent.appendChild(el);
  const f = (v) => v.toFixed(1).padStart(5);
  setInterval(() => {
    const s = perf.summary();
    const { iv, sim, draw, gl, hud, work } = s;
    const r = s.rollback, ago = (performance.now() - r.at) / 1000;
    el.textContent =
      `$ FRAME ${f(iv.p50)} p95${f(iv.p95)} p99${f(iv.p99)} ms  ${s.fps.toFixed(0)} fps\n`
      + `  work  ${f(work.p50)} p95${f(work.p95)}  long/min ${s.longPerMin.toFixed(0)}\n`
      + `  sim   ${f(sim.p50)} p95${f(sim.p95)}\n`
      + `  draw  ${f(draw.p50)} p95${f(draw.p95)}\n`
      + `  gl    ${f(gl.p50)} p95${f(gl.p95)}\n`
      + `  hud   ${f(hud.p50)} p95${f(hud.p95)}\n`
      + `  rollback last ${r.last.toFixed(1)}ms/${r.lastDepth}f${r.count ? ` ${ago.toFixed(0)}s ago` : ''}  worst ${r.max.toFixed(1)}ms/${r.maxDepth}f\n`
      + `  tier ${s.info.tier}${s.info.adaptive ? ' auto' : ' pinned'}  dpr ${s.info.dpr} (hud ${s.info.hud}x)  canvas ${s.info.w}x${s.info.h}`;
  }, 250);
  return el;
}
