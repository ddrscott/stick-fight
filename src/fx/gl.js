// Small WebGL helpers. WebGL1-flavoured GLSL so the same shaders run on WebGL2,
// WebGL1 and SwiftShader. No extensions are required; the ones we probe are optional.

// preserveDrawingBuffer forces a full copy every frame on mobile tile GPUs, so it is off unless a
// capture needs to read the canvas back after the frame was presented.
export function getContext(canvas, { preserve = false } = {}) {
  const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: preserve, powerPreference: 'high-performance' };
  let gl = null, version = 0;
  try { gl = canvas.getContext('webgl2', opts); version = gl ? 2 : 0; } catch (e) { gl = null; }
  if (!gl) {
    try { gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts); version = gl ? 1 : 0; } catch (e) { gl = null; }
  }
  if (!gl) throw new Error('WebGL is not available');
  return { gl, version };
}

export function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`fx shader "${label}" failed: ${log}\n${numbered(src)}`);
  }
  return sh;
}

function numbered(src) { return src.split('\n').map((l, i) => `${String(i + 1).padStart(3)}: ${l}`).join('\n'); }

export function program(gl, vs, fs, label) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, label + '.vert'));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, label + '.frag'));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`fx program "${label}" failed to link: ${gl.getProgramInfoLog(p)}`);
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(p, info.name);
  }
  const attribs = {};
  const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) {
    const info = gl.getActiveAttrib(p, i);
    attribs[info.name] = gl.getAttribLocation(p, info.name);
  }
  return { p, u: uniforms, a: attribs };
}

export function texture(gl, w, h, { filter = gl.LINEAR, data = null } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return t;
}

export function framebuffer(gl, w, h) {
  const tex = texture(gl, w, h);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) throw new Error('fx framebuffer incomplete');
  return { fb, tex, w, h };
}

// Upload a 2D canvas into a texture. Flipped so v=0 is the bottom, same as our FBOs.
export function uploadCanvas(gl, tex, canvas) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
}

export function quadBuffer(gl) {
  const b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  return b;
}
