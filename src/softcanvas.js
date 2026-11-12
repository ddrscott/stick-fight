// Software GL means software 2D canvases too (README, Performance, Chromebooks). Imported first by src/main.js, before
// any canvas has a context. It reads the GL renderer from a throwaway 1x1 context (a few ms) and, when it's software
// (SwiftShader, llvmpipe: src/device.js gpuBucket), makes every 2D context from then on ask for willReadFrequently,
// which keeps it on the CPU. An accelerated 2D canvas over a software GL rasters through that GL, about three times
// slower than the CPU, and copying one into a CPU canvas (the HUD's text stamps, the scenery caches, the layers the
// compositor uploads) reads it back each time, so it has to be all of them or none. A real GPU changes nothing here.
import { gpuBucket } from './device.js';

function probe() {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const gl = /** @type {WebGLRenderingContext|null} */ (c.getContext('webgl') || c.getContext('experimental-webgl'));
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return r;
  } catch { return ''; }
}

/** true when the 2D canvases were switched to the CPU */
export const softCanvas = (() => {
  if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') return false;
  if (gpuBucket(probe()) !== 'software') return false;
  const get = HTMLCanvasElement.prototype.getContext;
  /** @this {HTMLCanvasElement} */
  HTMLCanvasElement.prototype.getContext = /** @type {any} */ (function (type, opts) {
    return type === '2d' ? get.call(this, type, { ...(opts || {}), willReadFrequently: true }) : get.call(this, type, opts);
  });
  return true;
})();
