// What this device can do, in coarse buckets only (README, Performance, Chromebooks; Analytics, `perf`).
// Two jobs: pick the tier a session starts on, so a school Chromebook doesn't find out the slow way, and label
// the `perf` event so the data shows which devices struggle. Minors play, so nothing here is fingerprint-grade:
// the GPU's renderer string is read once, sorted into one of eight families, and never stored or sent; the core
// count and memory go out as three buckets each. Everything is a pure function of what it's handed, so
// scripts/perf/device.mjs checks it in Node (npm run test:device).
//
//   osBucket(ua, platform)      cros | android | ios | mac | win | linux | other
//   gpuBucket(renderer)         software | intel | mali | adreno | powervr | apple | nvidia-amd | other
//   coresBucket(n)              le2 | 4 | 6plus | unknown
//   memBucket(gb)               le4 | 8plus | unknown   (navigator.deviceMemory: Chrome only, capped at 8)
//   readDevice(rendererString)  { os, gpu, cores, mem } for this browser
//   startTier(dev, coarse)      the tier to start on before anything is measured
//   perfLabels(...)             the `perf` event's labels, built only from the buckets above

/** @param {string} ua @param {string} [platform] */
export function osBucket(ua, platform = '') {
  const u = String(ua || ''), p = String(platform || '');
  if (/\bCrOS\b/.test(u) || /Chrome OS|ChromeOS/i.test(p)) return 'cros';
  if (/Android/i.test(u)) return 'android';
  if (/iPhone|iPad|iPod/.test(u)) return 'ios';
  // an iPad in desktop mode says Macintosh; the touch check is the caller's (readDevice)
  if (/Macintosh|Mac OS X/.test(u) || /^Mac/i.test(p)) return 'mac';
  if (/Windows/i.test(u) || /^Win/i.test(p)) return 'win';
  if (/Linux|X11/i.test(u) || /Linux/i.test(p)) return 'linux';
  return 'other';
}

/** The renderer string, sorted into a family. Software first: SwiftShader, llvmpipe, Microsoft Basic Render.
 *  @param {string} renderer */
export function gpuBucket(renderer) {
  const r = String(renderer || '').toLowerCase();
  if (!r) return 'other';
  if (/swiftshader|llvmpipe|softpipe|basic render|software|subzero/.test(r)) return 'software';
  if (/mali/.test(r)) return 'mali';
  if (/adreno/.test(r)) return 'adreno';
  if (/powervr|img tec|imagination/.test(r)) return 'powervr';
  if (/apple/.test(r)) return 'apple';
  if (/nvidia|geforce|quadro|rtx|radeon|amd|ati technologies/.test(r)) return 'nvidia-amd';
  if (/intel/.test(r)) return 'intel';
  return 'other';
}

/** @param {number} [n] */
export function coresBucket(n) {
  const c = Number(n) || 0;
  if (!c) return 'unknown';
  return c <= 2 ? 'le2' : c <= 4 ? '4' : '6plus';
}

/** @param {number} [gb] */
export function memBucket(gb) {
  const m = Number(gb) || 0;
  if (!m) return 'unknown';
  return m <= 4 ? 'le4' : '8plus';
}

/** This browser's buckets. The renderer string is only looked at here, never kept.
 *  @param {string} renderer */
export function readDevice(renderer) {
  const nav = typeof navigator !== 'undefined' ? /** @type {any} */ (navigator) : {};
  let os = osBucket(nav.userAgent, (nav.userAgentData && nav.userAgentData.platform) || nav.platform);
  if (os === 'mac' && nav.maxTouchPoints > 1) os = 'ios';   // iPadOS asks for the desktop site
  return { os, gpu: gpuBucket(renderer), cores: coresBucket(nav.hardwareConcurrency), mem: memBucket(nav.deviceMemory) };
}

/** Where a session starts before a frame is measured. Software GL starts at the lowest tier (0); a Chromebook,
 *  or anything with 4 cores or fewer or 4 GB or less, at tier 1; a phone at 2; the rest at 3. The adaptive tier
 *  climbs from there after 5 good seconds, so starting low costs a few seconds of the plainer look at most.
 *  @param {{os:string,gpu:string,cores:string,mem:string}} dev @param {boolean} coarse */
export function startTier(dev, coarse) {
  if (dev.gpu === 'software') return 0;
  if (dev.os === 'cros' || dev.cores === 'le2' || dev.cores === '4' || dev.mem === 'le4') return 1;
  return coarse ? 2 : 3;
}

/** What held the frame back: `main` (the main thread's own work fills most of the frame), `gpu` (the frame
 *  waited on something else: the GPU, or the compositor), or `none` (frames hold ~60 fps).
 *  @param {number} frameP50 @param {number} workP50 */
export function boundBucket(frameP50, workP50) {
  if (!(frameP50 > 17.5)) return 'none';
  return workP50 >= frameP50 * 0.6 ? 'main' : 'gpu';
}

/** The `perf` event's labels (README, Analytics). Only buckets and small numbers: every label is one of a fixed
 *  set of words, so no raw renderer string can get through (scripts/perf/device.mjs checks it).
 *  @param {{tier:number, start:number, coarse:boolean, p95:number, dev:{os:string,gpu:string,cores:string,mem:string}, bound:string, pick:string}} o */
export function perfLabels({ tier, start, coarse, p95, dev, bound, pick }) {
  return [`t${tier}`, `start t${start}`, coarse ? 'touch' : 'mouse', `p95 ${Math.max(0, Math.min(999, Math.round(p95) || 0))}`,
    `os ${dev.os}`, `gpu ${dev.gpu}`, `cores ${dev.cores} mem ${dev.mem}`, `bound ${bound}`, `set ${pick}`];
}
