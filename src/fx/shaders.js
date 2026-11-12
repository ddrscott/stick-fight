// GLSL ES 1.0 so WebGL1, WebGL2 and SwiftShader all take it.
//
// Precision rules (phones run these at mediump, max 65504, ~3 significant digits):
// - never square a pixel-unit quantity: divide a pixel vector by its radius (or a scale) first,
//   then take length(); distance() and length() on raw pixel vectors overflow past ~255px.
// - never pow() a value that can be negative (pow(x, y) is undefined for x < 0 and is NaN on
//   Mali/Adreno); square by multiplying.
// - guard every divide; a NaN written to the scene target blacks out the pixel and anything blurred from it.
// The light arrays are sized by NLIGHTS, a #define prepended at compile time (see fx/index.js),
// so phones with few fragment uniform vectors get a smaller array.
export const MAX_LIGHTS = 32;

const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

export const QUAD_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Shared noise + light helpers. Pixel coords are screen pixels, y down.
const COMMON = `
uniform vec2 u_res;
uniform float u_time;
uniform int u_nLights;
uniform vec2 u_lpos[NLIGHTS];
uniform vec3 u_lcol[NLIGHTS];
uniform float u_lrad[NLIGHTS];
uniform float u_haze;

uniform float u_shOn;
uniform vec2 u_shPos;
uniform vec2 u_shDir;
uniform float u_shSpacing;
uniform float u_shWidth;
uniform float u_shLen;
uniform float u_shCount;
uniform vec3 u_shCol;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) { return vnoise(p) * 0.625 + vnoise(p * 2.03 + 7.7) * 0.25 + vnoise(p * 4.1 + 3.1) * 0.125; }

// Soft, wide falloff: bright core, long tail that tints geometry.
// Peaked at the source with a real gradient (no plateau disc), gone by 0.6 of the radius.
float falloff(float x) {
  float t = clamp(1.0 - x / 0.6, 0.0, 1.0);
  return t * t * t;
}

// Light scattered in the air around a light (the halo you see in fog).
vec3 hazeAt(vec2 px) {
  vec3 h = vec3(0.0);
  float n = 0.7 + 0.3 * fbm(px * 0.004 + vec2(u_time * 0.05, -u_time * 0.03));
  for (int i = 0; i < NLIGHTS; i++) {
    if (i >= u_nLights) break;
    float x = length((px - u_lpos[i]) / (u_lrad[i] * 1.35)); // normalized before squaring (mediump)
    float t = clamp(1.0 - x, 0.0, 1.0);
    h += u_lcol[i] * (t * t * t) * n;
  }
  return h * u_haze;
}

float shaftMask(vec2 px) {
  if (u_shOn < 0.5) return 0.0;
  vec2 d = px - u_shPos;
  float along = dot(d, u_shDir);
  float perp = dot(d, vec2(-u_shDir.y, u_shDir.x));
  if (along < -40.0) return 0.0;
  float idx = floor(perp / u_shSpacing + 0.5);
  if (abs(idx) > u_shCount) return 0.0;
  float band = abs(perp - idx * u_shSpacing);
  float w = u_shWidth * (0.8 + 0.4 * hash12(vec2(idx, 3.0)));
  float m = 1.0 - smoothstep(w * 0.35, w * 0.5 + 6.0, band);
  float core = 1.0 - smoothstep(0.0, w * 0.3, band);
  float fade = 1.0 - smoothstep(u_shLen * 0.2, u_shLen, along);
  float n = 0.8 + 0.2 * fbm(vec2(perp * 0.02, along * 0.006 - u_time * 0.25));
  float wide = 0.07 * (1.0 - smoothstep(0.0, u_shSpacing * 1.2, band));
  return (m * (0.75 + 0.45 * core) + wide) * fade * n;
}
`;

export const SCENE_FS = PRECISION + COMMON + `
varying vec2 v_uv;
uniform sampler2D u_bg, u_fig, u_emi, u_far, u_body;
uniform vec4 u_bgMap;    // screen uv -> background uv (uv * xy + zw): identity for the layer, a world cache's window otherwise
uniform sampler2D u_nearA, u_nearB, u_nearC; // blurred emissive (quarter and eighth res bloom): near-field light from the signs
uniform float u_emiLight, u_emiLightA, u_emiLightC, u_coreCap, u_bodyOn, u_bodyAmb, u_bodyGain;
uniform float u_farOn, u_farAmount, u_farLight;
uniform vec3 u_farHaze;
uniform vec2 u_farOffset;
uniform vec3 u_horizon; uniform float u_horizonY, u_horizonW;
uniform vec3 u_ambient;
uniform vec3 u_skyTop, u_skyBot;
uniform vec4 u_fog;      // rgb, density
uniform vec2 u_fogY;     // y where fog is full, y where fog is gone
uniform float u_lighting, u_shadows, u_fogOn, u_hazeOn;
uniform float u_shadowK, u_figAmb, u_figGain, u_rimK, u_emiGain, u_coreWhite, u_outline;
uniform float u_raw;

// Every light's contribution in one pass over the array (it was three: the background's light with its
// contact shadows, the figures' light and rim, and the haze): the distance and falloff are worked out once
// per light. Same sums as before; the figures' terms only where there is a figure (fg).
void lightAll(vec2 px, vec2 n, float edge, bool lit, bool fg, bool hz, out vec3 Lbg, out vec3 Lfig, out vec3 rim, out vec3 hsum) {
  Lbg = u_ambient; Lfig = u_ambient; rim = vec3(0.0); hsum = vec3(0.0);
  for (int i = 0; i < NLIGHTS; i++) {
    if (i >= u_nLights) break;
    vec2 dn = (u_lpos[i] - px) / u_lrad[i]; // in radii, so length() never squares pixels
    float x = length(dn);
    // Light scattered in the air around a light (the halo you see in fog): reaches 1.35 radii
    if (hz) { float t = clamp(1.0 - x / 1.35, 0.0, 1.0); hsum += u_lcol[i] * (t * t * t); }
    if (!lit) continue;
    float a = falloff(x);
    if (a <= 0.0005) continue;
    if (fg) {
      Lfig += u_lcol[i] * a;
      float facing = max(0.0, dot(n, dn / max(x, 0.0001)));
      rim += u_lcol[i] * a * facing * edge;
    }
    if (u_shadows > 0.5) {
      float dist = x * u_lrad[i];
      // Occlusion toward the light by anything on the figure layer: a soft contact shadow.
      vec2 step = (dn / max(x, 0.0001)) / u_res;
      float occ = 0.0;
      occ = max(occ, texture2D(u_fig, v_uv + vec2(step.x, -step.y) * 4.0).a * 1.0);
      occ = max(occ, texture2D(u_fig, v_uv + vec2(step.x, -step.y) * 9.0).a * 0.7);
      occ = max(occ, texture2D(u_fig, v_uv + vec2(step.x, -step.y) * 15.0).a * 0.4);
      // A light sitting on a body (a hit flash) must not wrap the body in its own shadow.
      a *= 1.0 - u_shadowK * occ * smoothstep(50.0, 180.0, dist);
    }
    Lbg += u_lcol[i] * a;
  }
}

void main() {
  vec2 uv = v_uv;
  vec2 px = vec2(uv.x * u_res.x, (1.0 - uv.y) * u_res.y);
  vec4 bg = texture2D(u_bg, uv * u_bgMap.xy + u_bgMap.zw);
  vec4 fig = texture2D(u_fig, uv);
  vec4 emi = texture2D(u_emi, uv);

  vec4 far = (u_farOn > 0.5) ? texture2D(u_far, clamp(uv + u_farOffset, vec2(0.0), vec2(1.0))) : vec4(0.0);

  if (u_raw > 0.5) {
    vec3 c = mix(vec3(0.125, 0.125, 0.14), far.rgb, far.a);
    c = mix(c, bg.rgb, bg.a);
    c = mix(c, fig.rgb, fig.a);
    c = mix(c, emi.rgb, emi.a);
    gl_FragColor = vec4(c, 0.0);
    return;
  }

  // Sky behind anything the background leaves transparent.
  float sv = px.y / u_res.y;
  vec3 sky = mix(u_skyTop, u_skyBot, smoothstep(0.0, 1.0, sv));
  sky *= 0.9 + 0.1 * fbm(px * 0.003 + vec2(u_time * 0.01, 0.0));
  // Cloud band at the roofline: a soft violet lift around the horizon.
  float hzt = (px.y - u_horizonY) / max(u_horizonW, 1.0);
  float hz = exp(-hzt * hzt); // not pow(): pow of a negative base is NaN on phone GPUs and blacked out the upper band
  sky += u_horizon * hz * (0.75 + 0.25 * fbm(px * vec2(0.004, 0.012) + vec2(u_time * 0.02, 0.0)));

  // the figure's edge normal from its alpha gradient (the rim light and the outline below use it)
  vec2 tx = 1.0 / u_res;
  float ax = texture2D(u_fig, uv + vec2(tx.x, 0.0)).a - texture2D(u_fig, uv - vec2(tx.x, 0.0)).a;
  float ay = texture2D(u_fig, uv + vec2(0.0, tx.y)).a - texture2D(u_fig, uv - vec2(0.0, tx.y)).a;
  vec2 g = vec2(ax, -ay); // screen space, y down; points inward (toward more alpha)
  float edge = clamp(length(g) * 1.5, 0.0, 1.0);
  vec2 n = -g / max(length(g), 0.0001); // outward

  bool lit = u_lighting > 0.5, hzOn = u_hazeOn > 0.5;
  vec3 Lbg = u_ambient, Lf = u_ambient, rim = vec3(0.0), hsum = vec3(0.0);
  if (lit || hzOn) lightAll(px, n, edge, lit, fig.a > 0.0, hzOn, Lbg, Lf, rim, hsum);

  vec3 col;
  if (lit) {
    // Emissive near-field light: every glowing face lights the wall around it, through the same
    // blur the bloom uses (~20px tight and ~50-80px wide). It only exists near emitters, so the
    // ambient stays dark while the wall 40-80px from a sign picks up the sign's color.
    if (u_emiLight > 0.0) {
      vec3 near = texture2D(u_nearA, uv).rgb * u_emiLightA + texture2D(u_nearB, uv).rgb + texture2D(u_nearC, uv).rgb * u_emiLightC;
      Lbg += near * u_emiLight;
    }
    // Far plane: ambient plus a fraction of the point lights, then hazed toward the sky/fog color.
    vec3 Lfar = u_ambient + (Lbg - u_ambient) * u_farLight;
    vec3 farLit = mix(far.rgb * Lfar, u_farHaze, u_farAmount);
    col = mix(sky, farLit, far.a);
    col = mix(col, bg.rgb * Lbg, bg.a);
  } else {
    col = mix(sky, far.rgb, far.a);
    col = mix(col, bg.rgb, bg.a);
  }

  if (u_fogOn > 0.5) {
    float f = u_fog.a * (1.0 - smoothstep(u_fogY.x, u_fogY.y, px.y));
    f *= 0.8 + 0.2 * fbm(px * 0.005 + vec2(u_time * 0.04, u_time * 0.01));
    col = mix(col, u_fog.rgb, clamp(f, 0.0, 1.0));
  }

  float sh = shaftMask(px);
  col += u_shCol * sh;

  vec3 haze = hzOn ? hsum * (0.7 + 0.3 * fbm(px * 0.004 + vec2(u_time * 0.05, -u_time * 0.03))) * u_haze : vec3(0.0);
  col += haze;

  // Soft knee on lit surfaces only: a strong light on a light fill rolls off instead of flattening
  // into a uniform disc. Emissives are composited after this and keep their full brightness.
  {
    float m = max(col.r, max(col.g, col.b));
    if (m > 0.92) col *= (0.92 + (m - 0.92) * 0.5) / m;
  }

  // Emissive layer (signs, screens, EXIT): composited under the bodies and figures, so no glowing
  // face ever covers a player (owner requirement 5); bloom is extracted from it separately. u_emiGain lifts
  // half-covered fills to solid, u_coreWhite pushes the core toward white-hot while keeping the hue.
  // Only near-solid fills (the sign faces) get the gain and the whitening; low-alpha glow the
  // arena paints around them stays what it is.
  float solid = smoothstep(0.35, 0.7, emi.a);
  float ea = clamp(emi.a * mix(1.0, u_emiGain, solid), 0.0, 1.0);
  vec3 ec = mix(emi.rgb, vec3(1.0), u_coreWhite * solid);
  // Hue-keeping core cap: a solid face stops at u_coreCap on its brightest channel, scaled as a
  // whole so a pink sign stays pink instead of clipping toward white.
  // Saturated faces cap a little lower: the grade's saturation lifts their top channel after this.
  float em = max(ec.r, max(ec.g, ec.b));
  float esat = (em - min(ec.r, min(ec.g, ec.b))) / max(em, 0.001);
  float cap = u_coreCap * (1.0 - 0.12 * esat);
  if (em > cap) ec = mix(ec, ec * (cap / em), solid);
  col = col * (1.0 - ea) + ec * ea;

  // Figures: lit by ambient + lights with a floor so they always read, plus a rim
  // on the edge facing each light. The edge normal comes from the alpha gradient.
  // Readability rim: darken the backdrop in a ~2px band just outside every figure, so a hue-only
  // fighter (orange on a pink-lit wall) still has a luma edge.
  if (u_outline > 0.0) {
    float d = 0.0;
    d = max(d, texture2D(u_fig, uv + vec2(tx.x * 3.0, 0.0)).a);
    d = max(d, texture2D(u_fig, uv - vec2(tx.x * 3.0, 0.0)).a);
    d = max(d, texture2D(u_fig, uv + vec2(0.0, tx.y * 3.0)).a);
    d = max(d, texture2D(u_fig, uv - vec2(0.0, tx.y * 3.0)).a);
    d = max(d, texture2D(u_fig, uv + tx * 2.2).a);
    d = max(d, texture2D(u_fig, uv - tx * 2.2).a);
    d = max(d, texture2D(u_fig, uv + vec2(tx.x, -tx.y) * 2.2).a);
    d = max(d, texture2D(u_fig, uv + vec2(-tx.x, tx.y) * 2.2).a);
    d = max(d, texture2D(u_fig, uv + vec2(tx.x * 1.5, 0.0)).a);
    d = max(d, texture2D(u_fig, uv - vec2(tx.x * 1.5, 0.0)).a);
    col *= 1.0 - u_outline * d * (1.0 - fig.a);
  }
  // Bodies (corpses on the floor): lit like the room, not like a live fighter, so they take the
  // scene's color and sit in it. They get the same dark outline so they still separate from the floor.
  if (u_bodyOn > 0.5) {
    vec4 bod = texture2D(u_body, uv);
    if (u_outline > 0.0) {
      float d = 0.0;
      d = max(d, texture2D(u_body, uv + vec2(tx.x * 2.5, 0.0)).a);
      d = max(d, texture2D(u_body, uv - vec2(tx.x * 2.5, 0.0)).a);
      d = max(d, texture2D(u_body, uv + vec2(0.0, tx.y * 2.5)).a);
      d = max(d, texture2D(u_body, uv - vec2(0.0, tx.y * 2.5)).a);
      d = max(d, texture2D(u_body, uv + tx * 1.8).a);
      d = max(d, texture2D(u_body, uv - tx * 1.8).a);
      col *= 1.0 - u_outline * d * (1.0 - bod.a) * (1.0 - fig.a);
    }
    vec3 bodyCol = (u_lighting > 0.5) ? bod.rgb * min(vec3(1.4), u_bodyAmb + Lbg * u_bodyGain) : bod.rgb;
    col = mix(col, bodyCol, bod.a);
  }
  vec3 figCol;
  if (lit) {
    figCol = fig.rgb * min(vec3(1.35), u_figAmb + Lf * u_figGain) + rim * u_rimK;
  } else {
    figCol = fig.rgb;
  }
  col = mix(col, figCol + haze * 0.25, fig.a);

  // Alpha carries particle coverage (particles add to it later) so bloom can stay off opaque chunks.
  gl_FragColor = vec4(col, 0.0);
}
`;

// Half-res bright source for bloom: emissive layer + shafts + light haze.
export const BRIGHT_FS = PRECISION + COMMON + `
varying vec2 v_uv;
uniform sampler2D u_emi;
uniform float u_emiBloom, u_shaftBloom, u_hazeBloom;
void main() {
  vec2 px = vec2(v_uv.x * u_res.x, (1.0 - v_uv.y) * u_res.y);
  // Dilate the emissive layer by ~2.5px (9-tap max) so a 2-3px dot becomes a real bloom source.
  vec2 t = 1.0 / u_res;
  vec4 e = texture2D(u_emi, v_uv);
  e = max(e, texture2D(u_emi, v_uv + vec2(t.x, 0.0)));
  e = max(e, texture2D(u_emi, v_uv - vec2(t.x, 0.0)));
  e = max(e, texture2D(u_emi, v_uv + vec2(0.0, t.y)));
  e = max(e, texture2D(u_emi, v_uv - vec2(0.0, t.y)));
  e = max(e, texture2D(u_emi, v_uv + t * 0.7071));
  e = max(e, texture2D(u_emi, v_uv - t * 0.7071));
  e = max(e, texture2D(u_emi, v_uv + vec2(t.x, -t.y) * 0.7071));
  e = max(e, texture2D(u_emi, v_uv + vec2(-t.x, t.y) * 0.7071));
  vec3 c = e.rgb * e.a * u_emiBloom;
  c += u_shCol * shaftMask(px) * u_shaftBloom;
  c += hazeAt(px) * u_hazeBloom;
  gl_FragColor = vec4(c, 1.0);
}
`;

export const BLUR_FS = PRECISION + `
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_dir; // texel step * radius
void main() {
  vec4 c = texture2D(u_tex, v_uv) * 0.2270270270;
  c += texture2D(u_tex, v_uv + u_dir * 1.3846153846) * 0.3162162162;
  c += texture2D(u_tex, v_uv - u_dir * 1.3846153846) * 0.3162162162;
  c += texture2D(u_tex, v_uv + u_dir * 3.2307692308) * 0.0702702703;
  c += texture2D(u_tex, v_uv - u_dir * 3.2307692308) * 0.0702702703;
  gl_FragColor = c;
}
`;

// Horizontal + vertical streaks so small bright points bloom into four-point stars.
export const STAR_FS = PRECISION + `
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_len;
void main() {
  vec3 c = vec3(0.0);
  float wsum = 0.0;
  for (int k = -10; k <= 10; k++) {
    float fk = float(k);
    float w = exp(-abs(fk) * 0.35);
    c += texture2D(u_tex, v_uv + vec2(u_texel.x * fk * u_len, 0.0)).rgb * w;
    c += texture2D(u_tex, v_uv + vec2(0.0, u_texel.y * fk * u_len)).rgb * w;
    wsum += 2.0 * w;
  }
  gl_FragColor = vec4(c / wsum * 2.2, 1.0);
}
`;

// Player protection mask at half res: figure + body alpha dilated by ~6px (so outline and rim are
// inside it). The final pass fades the foreground, vignette and grain wherever this is set.
export const MASK_FS = PRECISION + `
varying vec2 v_uv;
uniform sampler2D u_fig, u_body;
uniform vec2 u_res;
float A(vec2 o) { vec2 q = v_uv + o / u_res; return max(texture2D(u_fig, q).a, texture2D(u_body, q).a); }
void main() {
  float m = A(vec2(0.0));
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982;
    vec2 d = vec2(cos(a), sin(a));
    m = max(m, A(d * 3.0));
    m = max(m, A(d * 6.0));
  }
  gl_FragColor = vec4(m, m, m, 1.0);
}
`;

export const COPY_FS = PRECISION + `
varying vec2 v_uv;
uniform sampler2D u_tex;
void main() { gl_FragColor = texture2D(u_tex, v_uv); }
`;

// Particles: quads expanded on the CPU. Shape: 0 soft disc, 1 hard polygon, 2 streak, 3 hard disc.
export const PART_VS = `
attribute vec2 a_pos;
attribute vec2 a_uv;
attribute vec4 a_col;
attribute float a_shape;
uniform vec2 u_res;
varying vec2 v_uv; varying vec4 v_col; varying float v_shape; varying vec2 v_suv;
void main() {
  v_uv = a_uv; v_col = a_col; v_shape = a_shape;
  gl_Position = vec4(a_pos.x / u_res.x * 2.0 - 1.0, 1.0 - a_pos.y / u_res.y * 2.0, 0.0, 1.0);
  v_suv = gl_Position.xy * 0.5 + 0.5;
}
`;
export const PART_FS = PRECISION + `
varying vec2 v_uv; varying vec4 v_col; varying float v_shape; varying vec2 v_suv;
uniform sampler2D u_fig;
uniform float u_figMask;
void main() {
  float m;
  // Shape codes >= 10 render behind the figures: masked out wherever a figure pixel is.
  float behind = step(9.5, v_shape);
  float shv = v_shape - behind * 10.0;
  float sh = floor(shv + 0.001);
  float frac = shv - sh;
  float keep = 1.0 - behind * u_figMask * texture2D(u_fig, v_suv).a;
  if (sh < 0.5) { float r = length(v_uv); m = (1.0 - smoothstep(0.0, 1.0, r)); m *= m; }
  else if (sh < 1.5) { m = 1.0; }
  else if (sh < 2.5) { float r = length(vec2(v_uv.x * 0.6, v_uv.y)); m = 1.0 - smoothstep(0.3, 1.0, r); }
  else if (sh < 3.5) { m = 1.0 - smoothstep(0.85, 1.0, length(v_uv)); }
  else if (sh < 4.5) { float r = length(v_uv); float inner = frac; m = smoothstep(inner, inner + (1.0 - inner) * 0.4, r) * (1.0 - step(1.0, r)); }
  else {
    // Crate chunk: opaque, darker border and a diagonal brace in the crate's own color.
    m = 1.0;
    float border = step(0.78, max(abs(v_uv.x), abs(v_uv.y)));
    float brace = 1.0 - step(0.14, abs(v_uv.x - v_uv.y));
    gl_FragColor = vec4(v_col.rgb * (1.0 - 0.45 * max(border, brace)), v_col.a * keep);
    return;
  }
  gl_FragColor = vec4(v_col.rgb, v_col.a * m * keep);
}
`;

export const FINAL_FS = PRECISION + `
varying vec2 v_uv;
uniform sampler2D u_scene, u_bloomA, u_bloomB, u_bloomC, u_star, u_fg, u_figA, u_emiA, u_protect;
uniform float u_fgCut;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_shake;
uniform float u_aberr;
uniform vec3 u_flashCol; uniform float u_flashA; uniform vec2 u_flashPos; uniform float u_flashR;
uniform float u_bloomOn, u_bloomA_w, u_bloomB_w, u_bloomC_w, u_starOn, u_star_w;
uniform float u_vig, u_grain, u_grade, u_toe, u_black, u_hiLift;
uniform vec3 u_lift;
uniform float u_reflOn, u_reflY, u_reflStrength, u_reflFade, u_reflStretch, u_reflRipple, u_reflDepth;
uniform vec4 u_reflMask; // screen x: (gap x0, gap x1, floor x0, floor x1): no mirror over a hole or past the walls
uniform vec2 u_reflGap2; // screen x of a second hole (gap x0, gap x1): the building has a stairwell at each end
uniform float u_fgOn, u_fgOpacity; uniform vec3 u_fgTint;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 bloomAt(vec2 uv) {
  vec3 b = vec3(0.0);
  if (u_bloomOn > 0.5) b += texture2D(u_bloomA, uv).rgb * u_bloomA_w + texture2D(u_bloomB, uv).rgb * u_bloomB_w + texture2D(u_bloomC, uv).rgb * u_bloomC_w;
  if (u_starOn > 0.5) b += texture2D(u_star, uv).rgb * u_star_w;
  return b;
}

void main() {
  vec2 uv = v_uv + vec2(u_shake.x, -u_shake.y) / u_res;
  uv = clamp(uv, vec2(0.002), vec2(0.998));
  vec2 px = vec2(uv.x * u_res.x, (1.0 - uv.y) * u_res.y);

  vec3 c;
  if (u_aberr > 0.0001) {
    // Local to the hit: the split fades out ~2.5 flash radii from the contact point, so thin
    // emitters elsewhere (rain in the pane, window dots) never show RGB fringes.
    float ad = length((px - u_flashPos) / max(u_flashR * 2.5, 1.0));
    vec2 off = (uv - 0.5) * u_aberr * exp(-ad * ad);
    c = vec3(texture2D(u_scene, uv + off).r, texture2D(u_scene, uv).g, texture2D(u_scene, uv - off).b);
  } else {
    c = texture2D(u_scene, uv).rgb;
  }

  // (the floor plane's front edge is the slab's lit cut edge, drawn by the arena: no blending over it,
  // the slab is meant to read as a solid section between the two rooms)

  // Wet ground: mirror the scene about the water line, compressed (stretch) so a shallow
  // strip still shows the signs, smeared down a tall column, with horizontal ripple bands.
  bool reflHere = px.x > u_reflMask.z && px.x < u_reflMask.w && (px.x < u_reflMask.x || px.x > u_reflMask.y) && (px.x < u_reflGap2.x || px.x > u_reflGap2.y);
  if (u_reflOn > 0.5 && px.y > u_reflY && reflHere) {
    float dy = px.y - u_reflY;
    float fade = exp(-dy / u_reflFade);
    float ripple = (vnoise(vec2(px.x * 0.03, dy * 0.12 + u_time * 1.5)) - 0.5) * u_reflRipple * (4.0 + dy * 0.06);
    float band = 0.72 + 0.28 * vnoise(vec2(px.x * 0.0015 + u_time * 0.1, dy * 0.45 - u_time * 1.2));
    float my = u_reflY - dy * u_reflStretch;
    float smear = 12.0 + dy * 0.6;
    vec3 r = vec3(0.0);
    vec3 rb = vec3(0.0);
    for (int k = -3; k <= 3; k++) {
      float yy = my + float(k) * smear;
      vec2 suv = vec2((px.x + ripple) / u_res.x, 1.0 - yy / u_res.y);
      suv = clamp(suv, vec2(0.0), vec2(1.0));
      r += texture2D(u_scene, suv).rgb;
      rb += bloomAt(suv);
    }
    r /= 7.0; rb /= 7.0;
    // Figures reflect as themselves: a short smear of the figures layer, hue kept.
    vec3 fr = vec3(0.0);
    for (int k = -2; k <= 2; k++) {
      float yy = my + float(k) * smear * 0.3;
      vec2 fuv = clamp(vec2((px.x + ripple * 0.5) / u_res.x, 1.0 - yy / u_res.y), vec2(0.0), vec2(1.0));
      vec4 fs = texture2D(u_figA, fuv);
      fr += fs.rgb * fs.a;
    }
    fr /= 5.0;
    // Bright things reflect far more than dim walls, like a wet street.
    float lum = dot(r, vec3(0.299, 0.587, 0.114));
    vec3 refl = (r * (0.25 + 1.0 * lum) + rb * 1.3 + fr * 1.1) * band;
    // The mirror sits over whatever is drawn below the line and fades out from the line down.
    // ... and is gone before the slab's bottom edge, so the mirror never ends on a seam.
    float k = clamp(u_reflStrength * fade, 0.0, 1.0) * (1.0 - smoothstep(u_reflDepth * 0.5, u_reflDepth, dy));
    c = mix(c, refl + c * 0.15, k);
  }

  // Figures stay crisp: bloom from the scene washes over them at half strength.
  float figA = texture2D(u_figA, uv).a;
#ifdef NO_PROTECT
  float protect = figA; // 8 texture units: no dilated mask, the figure alpha stands in
#else
  float protect = smoothstep(0.05, 0.6, texture2D(u_protect, uv).r);
#endif
  float emiA = texture2D(u_emiA, uv).a;
  float partA = clamp(texture2D(u_scene, uv).a, 0.0, 1.0); // opaque particle coverage
  // Bloom lives around emitters, not on top of them (or on top of chunks): the core keeps its own color.
  // A face the arena paints at partial alpha (a tube at 0.6) still counts as the core: the scene pass
  // already gained it to solid, and bloom stacked on it would push it past the core cap to white.
  // A figure or body in front of a sign hides the sign there, so the core terms do not apply on it.
  float cover = max(figA, protect);
  float emiCore = max(emiA, smoothstep(0.3, 0.6, emiA)) * (1.0 - cover);
  emiA *= 1.0 - cover;
  // Bloom stays off the players and mostly off their ~6px rim (the protect mask), so a fighter in
  // front of a glowing sign keeps its own color and its dark outline.
  c += bloomAt(uv) * (1.0 - 0.95 * max(figA, protect)) * (1.0 - emiCore) * (1.0 - 0.9 * partA);

  if (u_flashA > 0.0001) {
    float d = length((px - u_flashPos) / max(u_flashR, 1.0));
    c += u_flashCol * u_flashA * exp(-d * d * 2.0) * (1.0 - figA);
  }

  if (u_fgOn > 0.5) {
    vec4 f = texture2D(u_fg, uv);
    // Owner requirement 5: no decorative object obscures a player. Silhouettes are solid elsewhere;
    // over a fighter or a body (mask dilated ~6px, soft at half res) they thin to u_fgCut, so they
    // still read as in front but the fighter is fully visible. Bright bits on the layer (bulb glints, a lit rail edge) keep
    // their color instead of being tinted to mud.
    float fl = dot(f.rgb, vec3(0.299, 0.587, 0.114));
    vec3 fc = f.rgb * mix(u_fgTint, vec3(1.0), smoothstep(0.35, 0.8, fl));
    c = mix(c, fc, clamp(f.a * u_fgOpacity * mix(1.0, u_fgCut, protect), 0.0, 1.0));
  }

  // Hue-preserving knee: scale by the max channel above 0.8 instead of clipping each channel to white.
  float mx = max(c.r, max(c.g, c.b));
  if (mx > 1.0) { c /= mx; }

  if (u_grade > 0.5) {
    c = c * (1.0 - u_lift) + u_lift;              // lift shadows toward the ambient tint, never black
    c = (c - 0.5) * 1.06 + 0.5;                   // a touch of contrast
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(lum), c, 1.12);                  // a touch of saturation
    // Toe: the compositor subtracts in the shadows. Anything the lights do not reach sinks toward black.
    float l2 = dot(max(c, 0.0), vec3(0.2126, 0.7152, 0.0722));
    c *= mix(1.0 - u_toe, 1.0, smoothstep(0.0, 0.36, l2));
    // Black pedestal: the darkest surfaces reach black instead of floating at luma 10-15.
    c = max(c - u_black, 0.0) / (1.0 - u_black);
    // Shoulder lift: lit surfaces in the upper range (walls in a sign's near field, pools) open up
    // toward the bar's p95 without touching the mids. Emissive cores keep their cap.
    float l3 = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c *= 1.0 + u_hiLift * smoothstep(0.4, 0.8, l3) * (1.0 - emiCore);
  }

  vec2 q = (v_uv - 0.5) * vec2(u_res.x / u_res.y * 0.82, 1.0);
  float v = smoothstep(0.35, 1.25, length(q) * 1.35);
  c *= 1.0 - u_vig * v * (1.0 - emiA) * (1.0 - protect); // a fighter near the edge keeps its luma

  float lum2 = dot(c, vec3(0.299, 0.587, 0.114));
  float g = hash12(v_uv * u_res + fract(u_time * 7.31) * 100.0) - 0.5;
  c += g * u_grain * (0.85 - 0.35 * clamp(lum2, 0.0, 1.0)) * (1.0 - 0.7 * protect);

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

// Tier 0 (README, Performance, Chromebooks): one pass straight to a half-size canvas, for a software GL or a
// school Chromebook's GPU. No per-pixel lights, no bloom chain, no mask, no grade: the sky, the skyline, the room
// lit flat (u_flat, worked out on the CPU from the ambient and the lights on screen), the neon faces with a short
// glow from eight taps of the emissive layer, the bodies, the fighters in their own flat color with a dark edge, the
// foreground and the hit flash. The glow and the flash stay off the fighters: fighters never glow.
export const FLAT_FS = PRECISION + `
varying vec2 v_uv;
uniform vec2 u_res;
uniform sampler2D u_bg, u_fig, u_emi, u_far, u_body, u_fg;
uniform vec4 u_bgMap;
uniform float u_farOn, u_farAmount, u_fgOn, u_fgOpacity, u_fgCut, u_glow, u_outline;
uniform vec2 u_farOffset;
uniform vec3 u_farHaze, u_skyTop, u_skyBot, u_flat, u_fgTint;
uniform vec4 u_fog; uniform vec2 u_fogY;
uniform vec3 u_flashCol; uniform float u_flashA; uniform vec2 u_flashPos; uniform float u_flashR;
uniform float u_toe;
void main() {
  vec2 uv = v_uv;
  vec2 px = vec2(uv.x * u_res.x, (1.0 - uv.y) * u_res.y);
  vec4 bg = texture2D(u_bg, uv * u_bgMap.xy + u_bgMap.zw);
  vec4 fig = texture2D(u_fig, uv);
  vec4 emi = texture2D(u_emi, uv);
  vec4 bod = texture2D(u_body, uv);
  vec3 col = mix(u_skyTop, u_skyBot, px.y / u_res.y);
  if (u_farOn > 0.5) {
    vec4 far = texture2D(u_far, clamp(uv + u_farOffset, vec2(0.0), vec2(1.0)));
    col = mix(col, mix(far.rgb * u_flat, u_farHaze, u_farAmount), far.a);
  }
  col = mix(col, bg.rgb * u_flat, bg.a);
  float f = u_fog.a * (1.0 - smoothstep(u_fogY.x, u_fogY.y, px.y));
  col = mix(col, u_fog.rgb, clamp(f, 0.0, 1.0));
  // the neon: the face itself, then a short halo around it (eight taps, ~3 and ~7 px at 1280)
  vec2 t = 1.0 / u_res;
  vec3 halo = texture2D(u_emi, uv + vec2(t.x * 3.0, 0.0)).rgb + texture2D(u_emi, uv - vec2(t.x * 3.0, 0.0)).rgb
    + texture2D(u_emi, uv + vec2(0.0, t.y * 3.0)).rgb + texture2D(u_emi, uv - vec2(0.0, t.y * 3.0)).rgb;
  vec3 halo2 = texture2D(u_emi, uv + t * 5.0).rgb + texture2D(u_emi, uv - t * 5.0).rgb
    + texture2D(u_emi, uv + vec2(t.x, -t.y) * 5.0).rgb + texture2D(u_emi, uv + vec2(-t.x, t.y) * 5.0).rgb;
  float solid = smoothstep(0.35, 0.7, emi.a);
  float ea = clamp(emi.a * mix(1.0, 1.6, solid), 0.0, 1.0);
  col = col * (1.0 - ea) + emi.rgb * ea;
  col += (halo * 0.14 + halo2 * 0.07) * u_glow * (1.0 - ea);
  // a dark edge outside each fighter and body, so a fighter reads on any wall (four taps)
  float d = max(max(texture2D(u_fig, uv + vec2(t.x * 2.5, 0.0)).a, texture2D(u_fig, uv - vec2(t.x * 2.5, 0.0)).a),
                max(texture2D(u_fig, uv + vec2(0.0, t.y * 2.5)).a, texture2D(u_fig, uv - vec2(0.0, t.y * 2.5)).a));
  col *= 1.0 - u_outline * d * (1.0 - fig.a);
  col = mix(col, bod.rgb * min(vec3(1.3), u_flat * 1.1 + 0.25), bod.a);
  col = mix(col, fig.rgb, fig.a);
  if (u_flashA > 0.0001) {
    float r = length((px - u_flashPos) / max(u_flashR, 1.0));
    col += u_flashCol * u_flashA * exp(-r * r * 2.0) * (1.0 - fig.a);
  }
  if (u_fgOn > 0.5) {
    vec4 g = texture2D(u_fg, uv);
    col = mix(col, g.rgb * u_fgTint, clamp(g.a * u_fgOpacity * mix(1.0, u_fgCut, max(d, bod.a)), 0.0, 1.0));
  }
  float mx = max(col.r, max(col.g, col.b));
  if (mx > 1.0) col /= mx;
  // the grade's cheap part: a little contrast and saturation, and the toe that sinks unlit corners toward black
  col = (col - 0.5) * 1.06 + 0.5;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, 1.15);
  float l2 = dot(max(col, 0.0), vec3(0.2126, 0.7152, 0.0722));
  col *= mix(1.0 - u_toe, 1.0, smoothstep(0.0, 0.36, l2) * (1.0 - fig.a) + fig.a);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
