// FX compositor: owns all WebGL. Other modules draw into fx.layers.* (2D canvases);
// render() lights them, blooms the emissive layer, adds particles, wet-ground
// reflections, fog, light shafts, shake, vignette, grain and a grade, then puts the
// result on the GL canvas. See gauntlet/BRIEF.md for the contract.
//
// Presets (fx.preset(name)): 'night' is applied by createFX and is what src/arena pitches its
// fills for; 'night-rain' adds rain; 'neon' / 'neon-rain' are the demo's brighter street.
// A preset sets ambient, sky, fog, far, lift, toe, vignette and weather in one call. Glue
// code should call a preset and leave the fields alone unless it has a reason.
//
// Extras beyond the contract (all optional, defaults are safe):
//   fx.layers.foreground   2D canvas, blurred dark silhouettes composited on top
//   fx.layers.far          2D canvas behind the background: hazed toward fx.far.haze, parallaxed, lit by ambient + fx.far.light of the point lights
//   fx.sky / fx.fog / fx.haze / fx.shafts / fx.reflect / fx.foreground / fx.far / fx.options / fx.tune
//   fx.weather('rain'|'none', { rate, wind, region })   region: world rect {x0,x1,y0,y1}, e.g. arena.rainRegion
//   fx.ground = y, fx.floors = [{x0,x1,y}]   where debris lands
//   fx.seed(n)  reseed the particle RNG (deterministic captures)
//   fx.clear()  clear all layer canvases (callers may also clear their own)
//   fx.hit({ x, y, strength, dir, flashR, color, debris: 'crate'|'dust'|'none', ring })
//       ring (default true): the amber shockwave ring; main.js passes it for heavy hits only
//       debris defaults to 'none' (a body hit sheds nothing). 'crate' chunks live 6 to 10s and
//       fade; at most tune.maxDebris are alive at once. 'dust' is a few short-lived dark specks.
//   fx.wallImpact({ x, y, side, strength })   wall splat / wall bounce: a vertical shock line on the wall at
//       (x, y), dust and grit rolling off it, a small jolt toward the wall and a pink-white flash. side is
//       where the wall is relative to the contact: -1 left, +1 right. strength 0.2..2 (1 = a splat).
//   fx.counterFlash({ x, y, scale })  counter hit (scale 1 heavy, about 0.5 on a jab): a cyan and magenta double ring with eight short spokes and a cyan
//       flash, distinct from the amber hit ring. Call it alongside fx.hit for the same contact.
//   fx.shake    { x, y } computed every update() whether or not options.shake is on. With
//       options.shake = true the compositor applies it and copies it into camera.shakeX/Y.
//       With options.shake = false it applies nothing and writes nothing: the caller reads
//       fx.shake.x/y and adds them to its own camera offset when it wants them.
//   fx.tune.lightGain  multiplies every point light's intensity (a preset-level exposure knob).
//   fx.tune.emiGain / coreWhite  emissive coverage gain and white-hot core push (preset emissiveGain / coreWhite).
//   fx.layers.bodies     2D canvas for corpses: lit like the room (tune.bodyAmb + light * tune.bodyGain) so they
//       take the scene's color, with the same dark outline as the fighters. Drawn under the figures.
//   fx.tune.emiLight / emiLightA / emiLightC  near-field light from the emissive layer onto the background, read
//       from the bloom blurs (~20px, ~50-80px, ~120px). Lights walls near signs while the ambient stays dark.
//   fx.tune.coreCap  hue-keeping cap on solid emissive faces (brightest channel), a little lower when saturated.
//   fx.tune.hiLift   shoulder lift on lit surfaces in the upper range (not emissive cores).
//   fx.reflect.depth the wet floor plane's depth under reflect.y: the mirror is gone by then.
//   fx.reflect.x0/x1 world x the mirror spans (the floor between the walls), fx.reflect.gaps [{x0,x1}] world x
//       where it doesn't (a hole in the floor: the stairwell). Only the first gap is used.
//   Callers must not add camera.shakeX/Y into their own transforms when options.shake is on.

import { getContext, program, texture, framebuffer, uploadCanvas, quadBuffer } from './gl.js';
import { QUAD_VS, SCENE_FS, BRIGHT_FS, BLUR_FS, STAR_FS, COPY_FS, MASK_FS, PART_VS, PART_FS, FINAL_FS, MAX_LIGHTS } from './shaders.js';
import { createParticles } from './particles.js';

function makeLayer(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function falloffJS(x) {
  const t = Math.max(0, Math.min(1, 1 - x / 0.6));
  return t * t;
}

const PRESETS = {
  // What the arena is pitched for: deep night, cool far plane, real shadow mass.
  night: {
    ambient: [0.40, 0.27, 0.58],
    sky: { top: [0.11, 0.05, 0.24], bottom: [0.28, 0.14, 0.42], horizon: [0.14, 0.08, 0.20], horizonY: 300, horizonWidth: 110 },
    fog: { color: [0.24, 0.14, 0.38], density: 0.08, y0: 0, y1: 600 },
    far: { haze: [0.04, 0.10, 0.28], amount: 0.6, light: 0.1, parallax: 0.35 },
    lift: [0.004, 0.002, 0.008], toe: 0.4, black: 0.03, vignette: 0.3, lightGain: 3.4, emissiveGain: 1.5, coreWhite: 0.4, outline: 0.6, bloomA: 2.0, figAmb: 1.1, reflect: { stretch: 1.0, fade: 45 },
    emiLight: 4.0, emiLightA: 0.6, emiLightC: 0.55, coreCap: 0.935, hiLift: 0.16,
    fgTint: [1, 1, 1], fgBlur: 0, // the arena paints its own near-black silhouettes and lit edges: composite them as drawn
    rain: null,
  },
  // The demo's neon street: brighter ambient, violet-hazed skyline that converges to its sky.
  neon: {
    ambient: [0.54, 0.35, 0.78],
    sky: { top: [0.23, 0.13, 0.40], bottom: [0.30, 0.16, 0.44], horizon: [0.14, 0.08, 0.20], horizonY: 300, horizonWidth: 110 },
    fog: { color: [0.24, 0.14, 0.38], density: 0.14, y0: 0, y1: 600 },
    far: { haze: [0.30, 0.18, 0.46], amount: 0.7, light: 0.2, parallax: 0.35 },
    lift: [0.008, 0.004, 0.014], toe: 0.0, black: 0.0, vignette: 0.26, lightGain: 1.0, emissiveGain: 1.0, coreWhite: 0.0, outline: 0.35, bloomA: 1.0, figAmb: 0.95, reflect: { stretch: 4.0, fade: 120 },
    rain: null,
  },
};
PRESETS['night-rain'] = { ...PRESETS.night, rain: { rate: 160, wind: -0.3 } };
PRESETS['neon-rain'] = { ...PRESETS.neon, rain: { rate: 160, wind: -0.3 } };

function smoothstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// Quality tiers. 3 is the full look (what every capture and critic saw); lower tiers drop the
// costliest passes for phones. The adaptive controller moves between them on frame time.
const TIERS = {
  3: { name: 'full', shadows: true, stars: true, wideLight: true, haze: true, sceneScale: 1, layerScale: 1, maxLights: 32 },
  2: { name: 'mid', shadows: false, stars: false, wideLight: true, haze: true, sceneScale: 1, layerScale: 1, maxLights: 24 },
  1: { name: 'low', shadows: false, stars: false, wideLight: false, haze: false, sceneScale: 0.5, layerScale: 0.5, maxLights: 16 },
};
const PREC_BLOCK = /#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif/;

function queryParams() { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(''); } }

// options.layerScaling: the caller draws into fx.layers.* with a transform scaled by layer.width / width
// (src/main.js does), so the low tier may shrink the layer canvases. Callers that assume full-size
// layers (the demo pages) leave it off and keep full-size layers at every tier.
export function createFX(glCanvas, { width = 1280, height = 720, layerScaling = false } = {}) {
  const W = width, H = height;
  glCanvas.width = W; glCanvas.height = H;
  const params = queryParams();
  const automated = (typeof navigator !== 'undefined' && navigator.webdriver) || params.has('capture');
  const { gl, version } = getContext(glCanvas, { preserve: !!automated });
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  // Device limits. The scene and particle shaders carry 3 uniform vectors per light plus ~48 others,
  // so a phone with few fragment uniform vectors gets a smaller light array.
  const limits = {
    fragUniforms: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
    texUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
    texSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
  };
  const forceMediump = params.get('fxprec') === 'mediump';
  let nLightsCap = Math.max(8, Math.min(MAX_LIGHTS, Math.floor((limits.fragUniforms - 48) / 3)));
  const noProtect = limits.texUnits < 9; // the final pass samples 9 textures; with 8 units the player mask falls back to the figure alpha
  const src = (fs, extra = '') => {
    let f = fs;
    if (forceMediump) f = f.replace(PREC_BLOCK, 'precision mediump float;');
    return `#define NLIGHTS ${nLightsCap}\n${extra}` + f;
  };
  const prec = (() => {
    const fmt = (p) => { const r = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, p); return r ? { min: r.rangeMin, max: r.rangeMax, precision: r.precision } : null; };
    return { highp: fmt(gl.HIGH_FLOAT), mediump: fmt(gl.MEDIUM_FLOAT) };
  })();
  let renderer = '', vendor = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
  } catch (e) { /* no info */ }

  const layers = {
    background: makeLayer(W, H),
    figures: makeLayer(W, H),
    emissive: makeLayer(W, H),
    foreground: makeLayer(W, H),
    far: makeLayer(W, H),
    bodies: makeLayer(W, H),
  };
  const tex = {
    background: texture(gl, W, H),
    figures: texture(gl, W, H),
    emissive: texture(gl, W, H),
    foreground: texture(gl, W, H),
    far: texture(gl, W, H),
    bodies: texture(gl, W, H),
  };
  const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1), qw = Math.max(1, W >> 2), qh = Math.max(1, H >> 2), ew = Math.max(1, W >> 3), eh = Math.max(1, H >> 3);
  const fb = {
    scene: framebuffer(gl, W, H),
    halfA: framebuffer(gl, hw, hh), halfB: framebuffer(gl, hw, hh),
    quarterA: framebuffer(gl, qw, qh), quarterB: framebuffer(gl, qw, qh),
    eighthA: framebuffer(gl, ew, eh), eighthB: framebuffer(gl, ew, eh),
    star: framebuffer(gl, qw, qh),
    lightA: framebuffer(gl, ew, eh), lightB: framebuffer(gl, ew, eh), // widest blur of the emissive: near-field light only
    fgA: framebuffer(gl, hw, hh), fgB: framebuffer(gl, hw, hh),
    protect: framebuffer(gl, hw, hh), // owner requirement 5: where the players (and bodies) are, dilated
  };
  // Compile; if a driver refuses the light arrays (uniform limits it under-reports), halve them and retry.
  let prog;
  for (;;) {
    try {
      prog = {
        scene: program(gl, QUAD_VS, src(SCENE_FS), 'scene'),
        bright: program(gl, QUAD_VS, src(BRIGHT_FS), 'bright'),
        blur: program(gl, QUAD_VS, src(BLUR_FS), 'blur'),
        star: program(gl, QUAD_VS, src(STAR_FS), 'star'),
        copy: program(gl, QUAD_VS, src(COPY_FS), 'copy'),
        mask: program(gl, QUAD_VS, src(MASK_FS), 'mask'),
        part: program(gl, PART_VS, src(PART_FS), 'particles'),
        final: program(gl, QUAD_VS, src(FINAL_FS, noProtect ? '#define NO_PROTECT 1\n' : ''), 'final'),
      };
      break;
    } catch (e) {
      if (nLightsCap <= 8) throw e;
      console.warn('[fx] shaders failed with', nLightsCap, 'lights, retrying with fewer:', String(e.message).split('\n')[0]);
      nLightsCap = Math.max(8, nLightsCap >> 1);
    }
  }

  // Quality tier: full on desktop and in captures, mid on touch devices, adaptive unless pinned.
  const pinned = params.has('tier') ? Math.max(1, Math.min(3, +params.get('tier') || 3)) : null;
  let tier = pinned || (automated ? 3 : coarse ? 2 : 3);
  const adapt = { on: !pinned && !automated, intervals: [], last: 0, windowStart: 0, good: 0, ceiling: 3, lastChange: 0, lastDown: -1e9 };
  const frameStats = { avg: 0, worst: 0 };
  let sceneScaleNow = 1, layerScaleNow = 1;
  function applyTier() {
    const T = TIERS[tier];
    if (T.sceneScale !== sceneScaleNow) {
      gl.deleteFramebuffer(fb.scene.fb); gl.deleteTexture(fb.scene.tex);
      fb.scene = framebuffer(gl, Math.max(1, Math.round(W * T.sceneScale)), Math.max(1, Math.round(H * T.sceneScale)));
      sceneScaleNow = T.sceneScale;
    }
    const ls = layerScaling ? T.layerScale : 1;
    if (ls !== layerScaleNow) {
      // Callers draw with ctx scale layer.width / W (src/main.js applyCamera), so a smaller canvas just works.
      for (const k in layers) { layers[k].width = Math.round(W * ls); layers[k].height = Math.round(H * ls); }
      layerScaleNow = ls;
    }
  }
  applyTier();
  const quad = quadBuffer(gl);
  const partBuf = gl.createBuffer();
  const particles = createParticles();

  // Uniform scratch
  const lpos = new Float32Array(nLightsCap * 2), lcol = new Float32Array(nLightsCap * 3), lrad = new Float32Array(nLightsCap);
  const lightPick = [];

  let time = 0;
  let lastLightCount = 0;
  let trauma = 0;
  const punch = { x: 0, y: 0, age: 0 };
  const flash = { a: 0, x: W / 2, y: H / 2, r: 200, col: [1, 0.9, 0.75] };
  let lastCam = { x: W / 2, y: H / 2, zoom: 1 };

  // Frame timing and the adaptive tier. Intervals between render() calls over 1s windows: step down
  // when the average misses ~55fps, step back up after 5 good seconds, and stop climbing to a tier
  // that already failed within 20s of reaching it.
  // A tier change resizes canvases (which clears them), so it is applied after the frame is composited.
  let tierPending = false;
  function frameTick() {
    const now = performance.now();
    if (adapt.last) {
      const dt = now - adapt.last;
      if (dt < 500) adapt.intervals.push(dt); // ignore pauses (tab hidden, breakpoints)
    }
    adapt.last = now;
    if (!adapt.windowStart) adapt.windowStart = now;
    if (now - adapt.windowStart < 1000) return;
    const iv = adapt.intervals;
    frameStats.avg = iv.length ? iv.reduce((a, b) => a + b, 0) / iv.length : 0;
    frameStats.worst = iv.length ? Math.max(...iv) : 0;
    adapt.intervals = []; adapt.windowStart = now;
    if (diagEl) updateDiag();
    if (!adapt.on || !frameStats.avg) return;
    if (frameStats.avg > 18 && tier > 1) {
      if (now - adapt.lastChange < 20000) adapt.ceiling = tier - 1; // the tier we just climbed to cannot hold
      tier--; adapt.lastChange = now; adapt.good = 0; tierPending = true;
    } else if (frameStats.avg < 17.4) {
      if (++adapt.good >= 5 && tier < adapt.ceiling) { tier++; adapt.lastChange = now; adapt.good = 0; tierPending = true; }
    } else adapt.good = 0;
  }

  // ?diag=1: a small corner readout of the GPU, its limits and the live quality state.
  let diagEl = null;
  function updateDiag() {
    const d = fx.diagnostics(), o = fx.options, Q = TIERS[tier];
    const pf = (p) => p ? `${p.precision}b 2^${p.max}` : 'none';
    const onoff = (b) => (b ? 'on' : 'off');
    const lines = [
      `${(d.renderer || '?').replace(/^ANGLE \((.*)\)$/, '$1').slice(0, 72)}`,
      `${d.vendor || '?'} | webgl${d.webgl}${d.forcedMediump ? ' | FORCED mediump' : ''}`,
      `frag highp ${pf(d.precision.highp)} | mediump ${pf(d.precision.mediump)}`,
      `uniform vec ${d.limits.fragUniforms} | tex units ${d.limits.texUnits} | max tex ${d.limits.texSize}`,
      `tier ${tier} ${Q.name}${d.adaptive ? ' (adaptive)' : pinned ? ' (pinned by ?tier)' : ' (fixed: capture)'} | coarse ${d.coarse} | preserve ${d.preserveDrawingBuffer}`,
      `frame avg ${frameStats.avg.toFixed(1)}ms worst ${frameStats.worst.toFixed(1)}ms`,
      `lights ${d.lights.used}/${Math.min(d.lights.cap, d.lights.tierCap)} (shader ${d.lights.cap}) | scene ${sceneScaleNow}x layers ${layerScaleNow}x`,
      `bloom ${onoff(o.bloom)} stars ${onoff(o.stars && Q.stars)} shadows ${onoff(o.shadows && Q.shadows)} haze ${onoff(o.haze && Q.haze)} wide light ${onoff(Q.wideLight)}`,
      `reflect ${onoff(o.reflect)} fg ${onoff(o.foreground)} particles ${onoff(o.particles)} protect ${onoff(d.protectMask)}`,
    ];
    // One row per line: the GPU name in magenta, the live numbers (tier, frame time) in cyan.
    diagEl.replaceChildren(...lines.map((t, i) => {
      const row = document.createElement('div');
      row.textContent = t;
      if (i === 0) row.style.cssText = 'color:#ff7be3;font-weight:700;text-shadow:0 0 6px rgba(255,79,216,.7)';
      else if (i === 4 || i === 5) row.style.cssText = 'color:#8ff3ff;text-shadow:0 0 6px rgba(90,235,255,.6)';
      return row;
    }));
  }
  if (params.get('diag') === '1' && typeof document !== 'undefined') {
    // A small neon panel (no terminal look): system sans for readability on a phone, a glowing cyan edge.
    diagEl = document.createElement('div');
    diagEl.style.cssText = 'position:absolute;left:6px;bottom:6px;padding:6px 9px;font:600 clamp(8px,1vw,11px)/1.35 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;'
      + 'color:#f1ecff;background:rgba(14,9,28,0.84);border:1.5px solid rgba(90,235,255,0.75);border-radius:6px;'
      + 'box-shadow:0 0 10px rgba(90,235,255,0.45),inset 0 0 8px rgba(255,79,216,0.18);pointer-events:none;z-index:50;max-width:min(520px,62%);overflow:hidden;overflow-wrap:anywhere';
    (glCanvas.parentElement || document.body).appendChild(diagEl);
  }

  const fx = {
    gl, version, width: W, height: H,
    layers,
    lights: [],
    ambient: [0.26, 0.17, 0.40],
    sky: { top: [0.11, 0.05, 0.24], bottom: [0.28, 0.14, 0.42], horizon: [0.14, 0.08, 0.20], horizonY: 300, horizonWidth: 110 },
    far: { on: true, haze: [0.06, 0.10, 0.24], amount: 0.30, light: 0.45, parallax: 0.35 },
    fog: { color: [0.24, 0.14, 0.38], density: 0.08, y0: 0, y1: 600 },
    shafts: { on: false, x: 1400, y: -80, angle: 2.4, spacing: 120, width: 34, length: 1500, count: 6, color: [1.0, 0.82, 0.5], intensity: 0.55 },
    reflect: { y: 640, strength: 0.0, fade: 120, stretch: 4.0, ripple: 1.0, depth: 80, x0: -1e5, x1: 1e5, gaps: [] }, // depth: the wet floor's depth below y (the mirror fades out by then) // stretch > 1 compresses the mirror so a shallow strip of floor still shows the lights
    foreground: { on: true, blur: 0, opacity: 1.0, tint: [0.3, 0.25, 0.45] }, // crisp by default; opacity applies only where a figure is behind
    options: { enabled: true, lighting: true, shadows: true, bloom: true, stars: true, fog: true, haze: true, shafts: true, vignette: true, grain: true, grade: true, particles: true, shake: true, aberration: true, reflect: true, foreground: true, motes: true },
    tune: { bloomA: 1.0, bloomB: 0.05, bloomC: 0.03, star: 0.08, vignette: 0.26, grain: 0.03, haze: 0.03, shadow: 0.5, figAmb: 0.95, figGain: 0.25, rim: 0.6, emiGain: 1.0, coreWhite: 0.0, outline: 0.5, emiBloom: 1.5, shaftBloom: 0.5, hazeBloom: 0.2, blurRadius: 0.6, lift: [0.008, 0.004, 0.014], toe: 0.5, black: 0.0, lightGain: 1.0, maxDebris: 60, shakeMax: 24, punch: 16, punchHold: 0.045, aberration: 0.005, emiLight: 0.0, emiLightA: 0.5, emiLightC: 1.0, coreCap: 1.0, hiLift: 0, fgCut: 0.12, bodyAmb: 0.5, bodyGain: 0.8 },
    shake: { x: 0, y: 0 },
    skip: {},              // { layerName: true } = unchanged since the last frame, do not re-upload
    get tier() { return tier; },
    setTier(t) { tier = Math.max(1, Math.min(3, t | 0)); adapt.on = false; applyTier(); },
    get adaptive() { return adapt.on; },
    set adaptive(v) { adapt.on = !!v; },
    diagnostics() {
      return { renderer, vendor, webgl: version, precision: prec, forcedMediump: forceMediump, limits, lights: { cap: nLightsCap, tierCap: TIERS[tier].maxLights, used: lastLightCount },
        tier, tierName: TIERS[tier].name, adaptive: adapt.on, coarse, preserveDrawingBuffer: !!automated, protectMask: !noProtect, frame: { ...frameStats } };
    },
    particles,
    get ground() { return particles.ground; },
    set ground(y) { particles.ground = y; },
    get floors() { return particles.floors; },
    set floors(f) { particles.floors = f; },
    get time() { return time; },

    preset(name, overrides = {}) {
      const P = PRESETS[name];
      if (!P) throw new Error(`fx.preset: unknown preset "${name}" (have ${Object.keys(PRESETS).join(', ')})`);
      const Q = { ...P, ...overrides };
      fx.ambient = [...Q.ambient];
      fx.sky = { ...Q.sky, top: [...Q.sky.top], bottom: [...Q.sky.bottom], horizon: [...Q.sky.horizon] };
      fx.fog = { ...Q.fog, color: [...Q.fog.color] };
      Object.assign(fx.far, Q.far, { haze: [...Q.far.haze] });
      fx.tune.lift = [...Q.lift]; fx.tune.toe = Q.toe; fx.tune.black = Q.black || 0; fx.tune.vignette = Q.vignette; fx.tune.lightGain = Q.lightGain;
      fx.tune.emiGain = Q.emissiveGain; fx.tune.coreWhite = Q.coreWhite; fx.tune.outline = Q.outline;
      if (Q.bloomA !== undefined) fx.tune.bloomA = Q.bloomA; if (Q.figAmb !== undefined) fx.tune.figAmb = Q.figAmb;
      if (Q.fgTint) fx.foreground.tint = [...Q.fgTint];
      if (Q.fgBlur !== undefined) fx.foreground.blur = Q.fgBlur;
      fx.tune.emiLight = Q.emiLight ?? 0; fx.tune.emiLightA = Q.emiLightA ?? 0.5; fx.tune.emiLightC = Q.emiLightC ?? 1; fx.tune.coreCap = Q.coreCap ?? 1; fx.tune.hiLift = Q.hiLift ?? 0;
      if (Q.reflect) { fx.reflect.stretch = Q.reflect.stretch; fx.reflect.fade = Q.reflect.fade; }
      if (Q.rain) particles.setRain(Q.rain.rate, Q.rain.wind); else particles.setRain(0);
      return fx;
    },
    seed(n) { particles.seed(n); time = 0; },
    clear() { for (const k in layers) layers[k].getContext('2d').clearRect(0, 0, W, H); },
    // fx.weather('rain', { rate, wind, region }): region is an optional world rect {x0,x1,y0,y1}
    // (same camera as the figures). With a region, rain spawns along its top edge, falls inside it,
    // drifts with the wind, and splashes on its bottom edge; without one it is whole-frame rain.
    weather(kind, opts = {}) {
      if (kind === 'rain') particles.setRain(opts.rate ?? 160, opts.wind ?? -0.3, opts.region || null);
      else particles.setRain(0);
    },

    hit(ev) {
      const s = Math.max(0.1, Math.min(2, ev.strength ?? 1));
      if (fx.options.particles) particles.hit({ ...ev, maxDebris: fx.tune.maxDebris });
      trauma = Math.min(1, trauma + 0.55 * s);
      const dx = typeof ev.dir === 'number' ? ev.dir : (ev.dir && ev.dir.x) || 1;
      const dy = typeof ev.dir === 'number' ? 0 : (ev.dir && ev.dir.y) || 0;
      const len = Math.hypot(dx, dy) || 1;
      punch.x = (dx / len) * fx.tune.punch * s; punch.y = (dy / len) * fx.tune.punch * s - 5 * s; punch.age = 0;
      const R = Math.max(8, ev.flashR ?? 36);
      flash.a = Math.min(0.6, 0.12 + 0.25 * s); flash.x = ev.x; flash.y = ev.y; flash.r = R * 2.2;
      flash.col = ev.flashColor ? ev.flashColor : [1, 0.8, 0.4];
    },
    // Trick-shot helpers (wall splat, wall bounce, counter hit). See the header.
    wallImpact(ev) {
      const st = Math.max(0.2, Math.min(2, ev.strength ?? 1));
      if (fx.options.particles) particles.wallImpact(ev);
      trauma = Math.min(1, trauma + 0.35 * st);
      const side = Math.sign(ev.side || 1);
      punch.x = side * fx.tune.punch * 0.8 * st; punch.y = 0; punch.age = 0; // the camera jolts toward the wall
      flash.a = Math.min(0.5, 0.1 + 0.2 * st); flash.x = ev.x; flash.y = ev.y; flash.r = 70 * st; flash.col = [1, 0.75, 0.9];
    },
    counterFlash(ev) {
      if (fx.options.particles) particles.counterFlash(ev);
      const k = Math.max(0.3, Math.min(1, ev.scale ?? 1));
      flash.a = 0.25 + 0.2 * k; flash.x = ev.x; flash.y = ev.y; flash.r = 90 * k; flash.col = [0.45, 0.95, 1.0];
    },
    dust(ev) { if (fx.options.particles) particles.dust(ev); },
    trail(prev, now, color, alpha) { if (fx.options.particles) particles.trail(prev, now, color, alpha); },
    addTrauma(t) { trauma = Math.min(1, trauma + t); },

    update(dt) {
      dt = Math.min(dt, 0.1);
      time += dt;
      const z = lastCam.zoom || 1;
      const view = { x0: lastCam.x - W / 2 / z, x1: lastCam.x + W / 2 / z, y0: lastCam.y - H / 2 / z, y1: lastCam.y + H / 2 / z };
      particles.setMotes(fx.options.motes && fx.options.particles ? 70 : 0);
      particles.update(dt, view);
      trauma = Math.max(0, trauma - dt * 2.2);
      flash.a *= Math.exp(-dt / 0.075);
      if (flash.a < 0.002) flash.a = 0;
      const amp = trauma * trauma * fx.tune.shakeMax;
      const t = time * 28;
      // The punch flips sign as it decays so the camera recoils, then settles.
      punch.age += dt;
      const held = punch.age < fx.tune.punchHold;
      const pk = held ? 1 : Math.exp(-dt / 0.12);
      punch.x *= pk; punch.y *= pk;
      const sgn = held ? 1 : Math.cos((punch.age - fx.tune.punchHold) * 45);
      // Always computed, so a caller that owns the camera can read it even with options.shake off.
      fx.shake.x = punch.x * sgn + amp * (Math.sin(t * 1.17) * 0.6 + Math.sin(t * 2.71 + 1.3) * 0.4);
      fx.shake.y = punch.y * sgn + amp * (Math.sin(t * 1.43 + 0.7) * 0.6 + Math.sin(t * 3.11 + 2.1) * 0.4);
    },

    // Light (ambient + point lights) at a world position, as [r,g,b].
    lightAt(x, y) {
      const a = fx.ambient;
      let r = a[0], g = a[1], b = a[2];
      for (const L of fx.lights) {
        const d = Math.hypot(L.x - x, L.y - y) / (L.radius || 200);
        if (d >= 1) continue;
        const f = falloffJS(d) * (L.intensity ?? 1) * fx.tune.lightGain;
        r += L.color[0] * f; g += L.color[1] * f; b += L.color[2] * f;
      }
      return [r, g, b];
    },

    render(camera) {
      const cam = camera || { x: W / 2, y: H / 2, zoom: 1 };
      lastCam = { x: cam.x, y: cam.y, zoom: cam.zoom || 1 };
      const z = lastCam.zoom;
      const toScreen = (x, y) => [(x - cam.x) * z + W / 2, (y - cam.y) * z + H / 2];
      if (camera && fx.options.shake) { camera.shakeX = fx.shake.x; camera.shakeY = fx.shake.y; }
      const o = fx.options, T = fx.tune;
      frameTick();
      const Q = TIERS[tier];
      const on = o.enabled;

      // 1. Upload the 2D layers.
      // fx.skip[name] = true tells the compositor a layer did not change since its last upload (the
      // caller knows; the compositor cannot without reading the canvas back). Uploads are the most
      // expensive per-frame cost on phones.
      const up = (k) => { if (!fx.skip[k]) uploadCanvas(gl, tex[k], layers[k]); };
      up('background');
      up('figures');
      up('emissive');
      const fgOn = o.foreground && fx.foreground.on;
      if (fgOn) up('foreground');
      const farOn = fx.far.on;
      if (farOn) up('far');
      // Bodies layer (corpses): lit like the room rather than like a live fighter.
      const bodyOn = true;
      up('bodies');

      // Lights to screen space. Lights whose reach (1.35 radii, the haze's) misses the screen are
      // skipped; if more remain than the tier allows, the strongest (intensity x radius) are kept.
      const cap = Math.min(nLightsCap, TIERS[tier].maxLights);
      lightPick.length = 0;
      for (const L of fx.lights) {
        const s = toScreen(L.x, L.y), r = (L.radius || 200) * z * 1.35;
        if (s[0] < -r || s[0] > W + r || s[1] < -r || s[1] > H + r) continue;
        lightPick.push(L);
      }
      if (lightPick.length > cap) {
        const idx = new Map(lightPick.map((L, i) => [L, i]));
        lightPick.sort((a, b) => ((b.intensity ?? 1) * (b.radius || 200)) - ((a.intensity ?? 1) * (a.radius || 200)) || idx.get(a) - idx.get(b));
        lightPick.length = cap;
      }
      let n = 0;
      for (const L of lightPick) {
        const s = toScreen(L.x, L.y);
        const k = (L.intensity ?? 1) * fx.tune.lightGain;
        lpos[n * 2] = s[0]; lpos[n * 2 + 1] = s[1];
        lcol[n * 3] = L.color[0] * k; lcol[n * 3 + 1] = L.color[1] * k; lcol[n * 3 + 2] = L.color[2] * k;
        lrad[n] = Math.max(1, (L.radius || 200) * z);
        n++;
      }
      lastLightCount = n;
      const setCommon = (P) => {
        gl.uniform2f(P.u.u_res, W, H);
        gl.uniform1f(P.u.u_time, time % 900); // bounded: mediump noise breaks down on large inputs
        gl.uniform1i(P.u.u_nLights, on && o.lighting ? n : 0);
        if (n) { gl.uniform2fv(P.u.u_lpos, lpos); gl.uniform3fv(P.u.u_lcol, lcol); gl.uniform1fv(P.u.u_lrad, lrad); }
        gl.uniform1f(P.u.u_haze, T.haze);
        const S = fx.shafts;
        gl.uniform1f(P.u.u_shOn, on && o.shafts && S.on ? 1 : 0);
        const sp = toScreen(S.x, S.y);
        gl.uniform2f(P.u.u_shPos, sp[0], sp[1]);
        gl.uniform2f(P.u.u_shDir, Math.cos(S.angle), Math.sin(S.angle));
        gl.uniform1f(P.u.u_shSpacing, S.spacing * z);
        gl.uniform1f(P.u.u_shWidth, S.width * z);
        gl.uniform1f(P.u.u_shLen, S.length * z);
        gl.uniform1f(P.u.u_shCount, S.count);
        gl.uniform3f(P.u.u_shCol, S.color[0] * S.intensity, S.color[1] * S.intensity, S.color[2] * S.intensity);
      };
      const bindQuad = (P) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.enableVertexAttribArray(P.a.a_pos);
        gl.vertexAttribPointer(P.a.a_pos, 2, gl.FLOAT, false, 0, 0);
      };
      const bindTex = (unit, t, loc) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc, unit); };
      const target = (f) => { gl.bindFramebuffer(gl.FRAMEBUFFER, f ? f.fb : null); gl.viewport(0, 0, f ? f.w : W, f ? f.h : H); };
      const draw = () => gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);

      // 2. Particles are built first: their emissive part feeds the bloom, and the bloom (blurred
      //    emissive) is also the near-field light the scene pass reads, so bloom runs before the scene.
      let built = null;
      if (on && o.particles && particles.count > 0) {
        built = particles.build(toScreen, z);
        gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
        gl.bufferData(gl.ARRAY_BUFFER, built.verts, gl.DYNAMIC_DRAW);
      }

      const wantBloom = on && (o.bloom || o.stars);
      if (wantBloom) {
        // 3. Bright source at half res: emissive + shafts + haze, plus emissive particles.
        {
          const P = prog.bright;
          gl.useProgram(P.p);
          target(fb.halfA);
          bindQuad(P);
          setCommon(P);
          bindTex(0, tex.emissive, P.u.u_emi);
          gl.uniform1f(P.u.u_emiBloom, T.emiBloom);
          gl.uniform1f(P.u.u_shaftBloom, T.shaftBloom);
          gl.uniform1f(P.u.u_hazeBloom, o.haze && Q.haze ? T.hazeBloom : 0);
          draw();
        }
        if (built && built.ranges.emissive[1]) {
          const P = prog.part;
          gl.useProgram(P.p);
          gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
          const stride = built.floatsPerVert * 4;
          gl.enableVertexAttribArray(P.a.a_pos); gl.vertexAttribPointer(P.a.a_pos, 2, gl.FLOAT, false, stride, 0);
          gl.enableVertexAttribArray(P.a.a_uv); gl.vertexAttribPointer(P.a.a_uv, 2, gl.FLOAT, false, stride, 8);
          gl.enableVertexAttribArray(P.a.a_col); gl.vertexAttribPointer(P.a.a_col, 4, gl.FLOAT, false, stride, 16);
          gl.enableVertexAttribArray(P.a.a_shape); gl.vertexAttribPointer(P.a.a_shape, 1, gl.FLOAT, false, stride, 32);
          gl.uniform2f(P.u.u_res, W, H);
          bindTex(0, tex.figures, P.u.u_fig);
          gl.uniform1f(P.u.u_figMask, 0.7); // bloom source: mostly masked too, so the glow does not sit on the bodies
          gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
          const [es, ec] = built.ranges.emissive;
          gl.drawArrays(gl.TRIANGLES, es, ec);
          gl.disable(gl.BLEND);
          gl.disableVertexAttribArray(P.a.a_uv); gl.disableVertexAttribArray(P.a.a_col); gl.disableVertexAttribArray(P.a.a_shape);
        }
        // 4. Star streaks from the raw bright source, at quarter res.
        if (o.stars && Q.stars) {
          const P = prog.star;
          gl.useProgram(P.p);
          target(fb.star);
          bindQuad(P);
          bindTex(0, fb.halfA.tex, P.u.u_tex);
          gl.uniform2f(P.u.u_texel, 1 / hw, 1 / hh);
          gl.uniform1f(P.u.u_len, 1.6);
          draw();
        }
        // 5. Tight bloom at half res (two blur rounds), wide halo at quarter res.
        const blur = (src, dst, dx, dy) => {
          const P = prog.blur;
          gl.useProgram(P.p);
          target(dst);
          bindQuad(P);
          bindTex(0, src.tex, P.u.u_tex);
          gl.uniform2f(P.u.u_dir, dx, dy);
          draw();
        };
        const r = T.blurRadius;
        blur(fb.halfA, fb.halfB, r / hw, 0);
        blur(fb.halfB, fb.halfA, 0, r / hh);
        // halfA now holds the tight bloom (one round: the halo stays inside the emitter's own width). Downsample to quarter and blur wide.
        {
          const P = prog.copy;
          gl.useProgram(P.p);
          target(fb.quarterA);
          bindQuad(P);
          bindTex(0, fb.halfA.tex, P.u.u_tex);
          draw();
        }
        blur(fb.quarterA, fb.quarterB, 1.5 * r / qw, 0);
        blur(fb.quarterB, fb.quarterA, 0, 1.5 * r / qh);
        // Very wide, low-intensity halo (~50px at 1280) at eighth res.
        {
          const P = prog.copy;
          gl.useProgram(P.p);
          target(fb.eighthA);
          bindQuad(P);
          bindTex(0, fb.quarterA.tex, P.u.u_tex);
          draw();
        }
        blur(fb.eighthA, fb.eighthB, 3 * r / ew, 0);
        blur(fb.eighthB, fb.eighthA, 0, 3 * r / eh);
        blur(fb.eighthA, fb.eighthB, 5 * r / ew, 0);
        blur(fb.eighthB, fb.eighthA, 0, 5 * r / eh);
        // Near-field light reaches past the halo: one more, wider blur (~120px) that only the scene pass reads.
        if (T.emiLight > 0 && Q.wideLight) {
          blur(fb.eighthA, fb.lightB, 8 * r / ew, 0);
          blur(fb.lightB, fb.lightA, 0, 8 * r / eh);
        }
      }

      // 6. Scene pass: lit background + figures + emissive into the scene FBO.
      {
        const P = prog.scene;
        gl.useProgram(P.p);
        target(fb.scene);
        bindQuad(P);
        setCommon(P);
        bindTex(0, tex.background, P.u.u_bg);
        bindTex(1, tex.figures, P.u.u_fig);
        bindTex(2, tex.emissive, P.u.u_emi);
        bindTex(3, tex.far, P.u.u_far);
        gl.uniform1f(P.u.u_farOn, farOn ? 1 : 0);
        gl.uniform1f(P.u.u_farAmount, on ? fx.far.amount : 0);
        gl.uniform1f(P.u.u_farLight, fx.far.light);
        gl.uniform3fv(P.u.u_farHaze, fx.far.haze);
        // Parallax: the far plane moves less than the camera.
        gl.uniform2f(P.u.u_farOffset, ((cam.x - W / 2) * fx.far.parallax) / W, -((cam.y - H / 2) * fx.far.parallax) / H);
        gl.uniform3fv(P.u.u_horizon, fx.sky.horizon);
        gl.uniform1f(P.u.u_horizonY, toScreen(0, fx.sky.horizonY)[1]);
        gl.uniform1f(P.u.u_horizonW, fx.sky.horizonWidth * z);
        gl.uniform3fv(P.u.u_ambient, fx.ambient);
        gl.uniform3fv(P.u.u_skyTop, fx.sky.top);
        gl.uniform3fv(P.u.u_skyBot, fx.sky.bottom);
        gl.uniform4f(P.u.u_fog, fx.fog.color[0], fx.fog.color[1], fx.fog.color[2], fx.fog.density);
        const f0 = toScreen(0, fx.fog.y0)[1], f1 = toScreen(0, fx.fog.y1)[1];
        gl.uniform2f(P.u.u_fogY, f0, f1);
        gl.uniform1f(P.u.u_lighting, on && o.lighting ? 1 : 0);
        gl.uniform1f(P.u.u_shadows, on && o.shadows && Q.shadows ? 1 : 0);
        gl.uniform1f(P.u.u_fogOn, on && o.fog ? 1 : 0);
        gl.uniform1f(P.u.u_hazeOn, on && o.haze && Q.haze ? 1 : 0);
        gl.uniform1f(P.u.u_shadowK, T.shadow);
        gl.uniform1f(P.u.u_figAmb, T.figAmb);
        gl.uniform1f(P.u.u_figGain, T.figGain);
        gl.uniform1f(P.u.u_rimK, T.rim);
        gl.uniform1f(P.u.u_emiGain, on ? T.emiGain : 1);
        gl.uniform1f(P.u.u_coreWhite, on ? T.coreWhite : 0);
        gl.uniform1f(P.u.u_outline, on && o.lighting ? T.outline : 0);
        gl.uniform1f(P.u.u_raw, on ? 0 : 1);
        bindTex(4, tex.bodies, P.u.u_body);
        bindTex(5, fb.quarterA.tex, P.u.u_nearA);
        bindTex(6, fb.eighthA.tex, P.u.u_nearB);
        bindTex(7, fb.lightA.tex, P.u.u_nearC);
        gl.uniform1f(P.u.u_emiLightC, Q.wideLight ? T.emiLightC : 0);
        gl.uniform1f(P.u.u_emiLight, on && o.lighting && wantBloom ? T.emiLight * (Q.wideLight ? 1 : 1.2) : 0); // the low tier has no widest blur: a little more of the rest
        gl.uniform1f(P.u.u_emiLightA, T.emiLightA);
        gl.uniform1f(P.u.u_coreCap, on ? T.coreCap : 1);
        gl.uniform1f(P.u.u_bodyOn, bodyOn ? 1 : 0);
        gl.uniform1f(P.u.u_bodyAmb, T.bodyAmb);
        gl.uniform1f(P.u.u_bodyGain, T.bodyGain);
        draw();
      }

      // 6b. Particles: lit (alpha) then emissive (additive) onto the scene.
      if (built) {
        const P = prog.part;
        gl.useProgram(P.p);
        gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
        const stride = built.floatsPerVert * 4;
        gl.enableVertexAttribArray(P.a.a_pos); gl.vertexAttribPointer(P.a.a_pos, 2, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(P.a.a_uv); gl.vertexAttribPointer(P.a.a_uv, 2, gl.FLOAT, false, stride, 8);
        gl.enableVertexAttribArray(P.a.a_col); gl.vertexAttribPointer(P.a.a_col, 4, gl.FLOAT, false, stride, 16);
        gl.enableVertexAttribArray(P.a.a_shape); gl.vertexAttribPointer(P.a.a_shape, 1, gl.FLOAT, false, stride, 32);
        gl.uniform2f(P.u.u_res, W, H);
        bindTex(0, tex.figures, P.u.u_fig);
        gl.uniform1f(P.u.u_figMask, 1.0);
        gl.enable(gl.BLEND);
        target(fb.scene);
        const [ls, lc] = built.ranges.lit, [es, ec] = built.ranges.emissive;
        if (lc) { gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE); gl.drawArrays(gl.TRIANGLES, ls, lc); }
        if (ec) { gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE); gl.drawArrays(gl.TRIANGLES, es, ec); }
        gl.disable(gl.BLEND);
        gl.disableVertexAttribArray(P.a.a_uv); gl.disableVertexAttribArray(P.a.a_col); gl.disableVertexAttribArray(P.a.a_shape);
      }

      // 7. Foreground silhouettes: downsample and blur.
      if (fgOn && on && fx.foreground.blur > 0) {
        const P = prog.copy;
        gl.useProgram(P.p);
        target(fb.fgA);
        bindQuad(P);
        bindTex(0, tex.foreground, P.u.u_tex);
        draw();
        const B = prog.blur;
        const r = fx.foreground.blur * 1.6;
        const blur = (src, dst, dx, dy) => { gl.useProgram(B.p); target(dst); bindQuad(B); bindTex(0, src.tex, B.u.u_tex); gl.uniform2f(B.u.u_dir, dx, dy); draw(); };
        blur(fb.fgA, fb.fgB, r / hw, 0);
        blur(fb.fgB, fb.fgA, 0, r / hh);
        blur(fb.fgA, fb.fgB, 2 * r / hw, 0);
        blur(fb.fgB, fb.fgA, 0, 2 * r / hh);
      }

      // 7b. Protection mask: figures + bodies, dilated ~6px, at half res.
      {
        const P = prog.mask;
        gl.useProgram(P.p);
        target(fb.protect);
        bindQuad(P);
        bindTex(0, tex.figures, P.u.u_fig);
        bindTex(1, tex.bodies, P.u.u_body);
        gl.uniform2f(P.u.u_res, W, H);
        draw();
      }

      // 8. Final composite to the canvas.
      {
        const P = prog.final;
        gl.useProgram(P.p);
        target(null);
        bindQuad(P);
        bindTex(0, fb.scene.tex, P.u.u_scene);
        bindTex(1, fb.halfA.tex, P.u.u_bloomA);
        bindTex(2, fb.quarterA.tex, P.u.u_bloomB);
        bindTex(3, fb.star.tex, P.u.u_star);
        bindTex(4, (on && fx.foreground.blur > 0) ? fb.fgA.tex : tex.foreground, P.u.u_fg);
        bindTex(5, fb.eighthA.tex, P.u.u_bloomC);
        bindTex(6, tex.figures, P.u.u_figA);
        bindTex(7, tex.emissive, P.u.u_emiA);
        if (!noProtect) bindTex(8, fb.protect.tex, P.u.u_protect);
        gl.uniform1f(P.u.u_fgCut, T.fgCut);
        gl.uniform2f(P.u.u_res, W, H);
        gl.uniform1f(P.u.u_time, time % 900);
        gl.uniform2f(P.u.u_shake, on && o.shake ? fx.shake.x : 0, on && o.shake ? fx.shake.y : 0);
        gl.uniform1f(P.u.u_aberr, on && o.aberration ? trauma * trauma * T.aberration : 0);
        gl.uniform3fv(P.u.u_flashCol, flash.col);
        gl.uniform1f(P.u.u_flashA, on ? flash.a : 0);
        const fp = toScreen(flash.x, flash.y);
        gl.uniform2f(P.u.u_flashPos, fp[0], fp[1]);
        gl.uniform1f(P.u.u_flashR, flash.r * z);
        gl.uniform1f(P.u.u_bloomOn, on && o.bloom ? 1 : 0);
        gl.uniform1f(P.u.u_bloomA_w, T.bloomA);
        gl.uniform1f(P.u.u_bloomB_w, T.bloomB);
        gl.uniform1f(P.u.u_bloomC_w, T.bloomC);
        gl.uniform1f(P.u.u_starOn, on && o.stars && Q.stars ? 1 : 0);
        gl.uniform1f(P.u.u_star_w, T.star);
        gl.uniform1f(P.u.u_vig, on && o.vignette ? T.vignette : 0);
        gl.uniform1f(P.u.u_grain, on && o.grain ? T.grain : 0);
        gl.uniform1f(P.u.u_grade, on && o.grade ? 1 : 0);
        gl.uniform3fv(P.u.u_lift, T.lift);
        gl.uniform1f(P.u.u_toe, T.toe);
        gl.uniform1f(P.u.u_black, on && o.grade ? (T.black || 0) : 0);
        gl.uniform1f(P.u.u_hiLift, T.hiLift || 0);
        const R = fx.reflect;
        const reflOn = on && o.reflect && R && R.strength > 0;
        gl.uniform1f(P.u.u_reflOn, reflOn ? 1 : 0);
        gl.uniform1f(P.u.u_reflY, reflOn ? toScreen(0, R.y)[1] : H * 2);
        gl.uniform1f(P.u.u_reflStrength, R ? R.strength : 0);
        gl.uniform1f(P.u.u_reflFade, (R && R.fade ? R.fade : 70) * z);
        gl.uniform1f(P.u.u_reflStretch, R && R.stretch !== undefined ? R.stretch : 1);
        gl.uniform1f(P.u.u_reflRipple, R && R.ripple !== undefined ? R.ripple : 1);
        gl.uniform1f(P.u.u_reflDepth, (R && R.depth ? R.depth : 80) * z);
        {
          const g = R && R.gaps && R.gaps[0];
          const sx = (x) => toScreen(x, 0)[0];
          gl.uniform4f(P.u.u_reflMask, g ? sx(g.x0) : -1e5, g ? sx(g.x1) : -1e5,
            R && typeof R.x0 === 'number' ? sx(R.x0) : -1e5, R && typeof R.x1 === 'number' ? sx(R.x1) : 1e5);
        }
        gl.uniform1f(P.u.u_fgOn, fgOn ? 1 : 0);
        gl.uniform1f(P.u.u_fgOpacity, fx.foreground.opacity);
        const tint = on ? fx.foreground.tint : [1, 1, 1];
        gl.uniform3fv(P.u.u_fgTint, tint);
        draw();
      }
      gl.bindTexture(gl.TEXTURE_2D, null);
      if (tierPending) { tierPending = false; applyTier(); }
    },
  };

  particles.lightAt = (x, y) => fx.lightAt(x, y);
  if (diagEl) updateDiag();
  fx.preset('night');
  return fx;
}
