#!/usr/bin/env node
// The capability check and the `perf` event's privacy (README, Performance, Chromebooks; Analytics): npm run test:device.
//   1. src/device.js in Node: renderer strings and user agents land in the right coarse buckets, the start tier follows
//      them, and the labels built from them are only fixed words (no renderer string can get through).
//   2. The built game (dist/, npm run build first) in headless Chromium on SwiftShader with a Chromebook's user agent:
//      it starts at tier 0, and the perf event it really sends to api/e carries the buckets and nothing of the
//      renderer string. --no-browser skips this part.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { osBucket, gpuBucket, coresBucket, memBucket, startTier, perfLabels, boundBucket } from '../../src/device.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };

// ---- 1. the buckets ---------------------------------------------------------------------------------
const GPUS = [
  ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'software'],
  ['Google SwiftShader', 'software'],
  ['llvmpipe (LLVM 15.0.7, 256 bits)', 'software'],
  ['ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)', 'software'],
  ['ANGLE (Intel, Mesa Intel(R) UHD Graphics 600 (GLK 2), OpenGL ES 3.2)', 'intel'],
  ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'intel'],
  ['Mali-G52 MC2', 'mali'],
  ['ANGLE (ARM, Mali-G72, OpenGL ES 3.2)', 'mali'],
  ['Adreno (TM) 618', 'adreno'],
  ['PowerVR Rogue GE8320', 'powervr'],
  ['Apple GPU', 'apple'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)', 'apple'],
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'nvidia-amd'],
  ['ANGLE (AMD, AMD Radeon(TM) Graphics, OpenGL 4.6)', 'nvidia-amd'],
  ['WebKit WebGL', 'other'],
  ['', 'other'],
];
for (const [r, want] of GPUS) ok(gpuBucket(r) === want, `gpuBucket(${JSON.stringify(r)}) = ${gpuBucket(r)}, want ${want}`);

const UAS = [
  ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', '', 'cros'],
  ['Mozilla/5.0 (X11; CrOS aarch64 15633.69.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36', '', 'cros'],
  ['Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', '', 'android'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', '', 'ios'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', '', 'mac'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', '', 'win'],
  ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', '', 'linux'],
  ['Mozilla/5.0 (X11; Linux x86_64) Chrome/130', 'Chrome OS', 'cros'],
  ['SomethingElse/1.0', '', 'other'],
];
for (const [ua, plat, want] of UAS) ok(osBucket(ua, plat) === want, `osBucket(${ua.slice(0, 40)}…, ${plat}) = ${osBucket(ua, plat)}, want ${want}`);

ok(coresBucket(2) === 'le2' && coresBucket(1) === 'le2' && coresBucket(4) === '4' && coresBucket(3) === '4' && coresBucket(6) === '6plus' && coresBucket(12) === '6plus' && coresBucket(undefined) === 'unknown', 'coresBucket');
ok(memBucket(2) === 'le4' && memBucket(4) === 'le4' && memBucket(0.5) === 'le4' && memBucket(8) === '8plus' && memBucket(undefined) === 'unknown', 'memBucket');
ok(boundBucket(16.7, 15) === 'none' && boundBucket(33, 25) === 'main' && boundBucket(33, 6) === 'gpu', 'boundBucket');

const D = (os, gpu, cores = '6plus', mem = '8plus') => ({ os, gpu, cores, mem });
ok(startTier(D('cros', 'software'), false) === 0, 'software GL starts at 0');
ok(startTier(D('win', 'software'), false) === 0, 'software GL on Windows starts at 0');
ok(startTier(D('cros', 'intel'), false) === 1, 'a Chromebook starts at 1');
ok(startTier(D('win', 'intel', '4'), false) === 1, '4 cores start at 1');
ok(startTier(D('win', 'intel', 'le2'), false) === 1, '2 cores start at 1');
ok(startTier(D('linux', 'intel', '6plus', 'le4'), false) === 1, '4 GB starts at 1');
ok(startTier(D('android', 'adreno'), true) === 2, 'a big phone starts at 2');
ok(startTier(D('mac', 'apple', '6plus', 'unknown'), false) === 3, 'a Mac starts at 3');
ok(startTier(D('win', 'nvidia-amd'), false) === 3, 'a gaming PC starts at 3');

// every label is one of a fixed set of words: a raw renderer string can't be one
const LABEL = [/^t[0-3]$/, /^start t[0-3]$/, /^(touch|mouse)$/, /^p95 \d{1,3}$/, /^os (cros|android|ios|mac|win|linux|other)$/,
  /^gpu (software|intel|mali|adreno|powervr|apple|nvidia-amd|other)$/, /^cores (le2|4|6plus|unknown) mem (le4|8plus|unknown)$/,
  /^bound (none|main|gpu)$/, /^set (auto|[0-3]|url)$/];
const checkLabels = (l, raw, where) => {
  ok(Array.isArray(l) && l.length === LABEL.length, `${where}: ${l.length} labels`);
  l.forEach((x, i) => ok(LABEL[i] && LABEL[i].test(x), `${where}: label ${i} ${JSON.stringify(x)}`));
  const words = String(raw).split(/[\s(),]+/).filter((w) => w.length >= 4 && !/^(intel|apple|other|mali|adreno|powervr|nvidia)$/i.test(w));
  for (const w of words) ok(!l.some((x) => x.toLowerCase().includes(w.toLowerCase())), `${where}: renderer word ${w} in ${JSON.stringify(l)}`);
};
for (const [r] of GPUS) {
  const dev = { os: 'cros', gpu: gpuBucket(r), cores: coresBucket(4), mem: memBucket(4) };
  checkLabels(perfLabels({ tier: 0, start: startTier(dev, false), coarse: false, p95: 41.3, dev, bound: 'main', pick: 'auto' }), r, `labels for ${r.slice(0, 30) || '(empty)'}`);
}
console.log(`device.js: ${pass} passed, ${fail} failed`);

// ---- 2. the real event from the built game ------------------------------------------------------------
if (!process.argv.includes('--no-browser')) {
  const require = createRequire(import.meta.url);
  let pw;
  try { pw = require('playwright'); } catch { pw = require(path.join(process.execPath, '../../lib/node_modules/playwright')); }
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../dist');
  if (!fs.existsSync(path.join(root, 'play/index.html'))) { console.log('FAIL no build: npm run build first'); process.exit(1); }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
  const beacons = [];
  const server = http.createServer((req, res) => {
    if (req.url.includes('/api/e')) {   // the analytics endpoint: keep what the page sent
      let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => { beacons.push(body); res.writeHead(204); res.end(); });
      return;
    }
    if (req.url.includes('/api/')) { res.writeHead(404); return res.end(); }
    let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });
  const page = await ctx.newPage();
  // analytics are off on localhost unless asked for (README, Analytics, Checking it locally)
  await page.addInitScript(() => { try { localStorage.setItem('stick-fight-track', '1'); localStorage.removeItem('stick-fight-gfx'); } catch { /* */ } });
  await page.goto(`http://127.0.0.1:${server.address().port}/play/`);
  await page.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 60000 });
  const tier0 = await page.evaluate(() => window.__game.fx.tier);
  ok(tier0 === 0, `a Chromebook on software GL starts at tier 0 (got ${tier0})`);
  const renderer = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); });
  await page.waitForTimeout(11000);   // the event waits 10 s before a hidden or closed tab may send it
  await page.evaluate(() => dispatchEvent(new Event('pagehide')));
  await page.waitForTimeout(1500);
  const events = beacons.flatMap((b) => { try { const j = JSON.parse(b); return Array.isArray(j) ? j : [j]; } catch { return []; } });
  const perfEv = events.find((e) => e.e === 'perf');
  ok(!!perfEv, `the perf event was sent (got ${events.map((e) => e.e).join(', ') || 'nothing'})`);
  if (perfEv) {
    checkLabels(perfEv.l, renderer, 'the sent perf event');
    ok(perfEv.l[4] === 'os cros' && perfEv.l[5] === 'gpu software', `os and gpu buckets: ${perfEv.l.slice(4, 6).join(', ')}`);
    ok(perfEv.l[1] === 'start t0', `start tier: ${perfEv.l[1]}`);
    ok(Array.isArray(perfEv.d) && perfEv.d.length === 6 && perfEv.d.every((n) => typeof n === 'number'), `numbers: ${JSON.stringify(perfEv.d)}`);
    console.log('sent:', JSON.stringify(perfEv));
  }
  // nothing anywhere in anything sent carries the renderer string or its distinctive words
  const all = beacons.join('\n').toLowerCase();
  ok(!all.includes(String(renderer).toLowerCase()), 'the renderer string is never sent');
  for (const w of ['swiftshader', 'angle (', 'subzero', 'vulkan']) ok(!all.includes(w), `"${w}" is never sent`);
  console.log(`renderer here: ${renderer}`);
  await browser.close();

  // ---- 3. the adaptive tier down to 0 and back, on this machine's GPU with a scripted load a frame ----------
  // A desktop starts at 3. 22 ms of busy work a frame (~45 fps) steps it down tier by tier to 0, and it stays drawing
  // every frame there; 60 ms (~15 fps) turns on drawing every other frame; no load brings every frame back, then
  // climbs a tier per 5 good seconds. --no-adapt skips it (35 s).
  if (!process.argv.includes('--no-adapt')) {
    const b2 = await pw.chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-blink-features=AutomationControlled'] });
    const p2 = await (await b2.newContext({ viewport: { width: 1280, height: 720 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' })).newPage();
    await p2.addInitScript(() => { try { localStorage.removeItem('stick-fight-gfx'); } catch { /* */ } });
    await p2.goto(`http://127.0.0.1:${server.address().port}/play/?scene=ai-fight`);
    await p2.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 60000 });
    const start = await p2.evaluate(() => [window.__game.fx.tier, window.__game.fx.adaptive]);
    ok(start[0] === 3 && start[1], `a desktop starts at tier 3, adaptive (got ${start})`);
    await p2.evaluate(() => {
      const fx = window.__game.fx, r = fx.render.bind(fx);
      window.__load = 0; window.__log = [];
      fx.render = (c) => { const t = performance.now() + window.__load; while (performance.now() < t) { /* busy */ } return r(c); };
      setInterval(() => window.__log.push([Math.round(performance.now()), fx.tier, fx.drawEvery, window.__load]), 250);
    });
    const phase = async (load, ms) => { await p2.evaluate((l) => { window.__load = l; }, load); await p2.waitForTimeout(ms); return p2.evaluate(() => [window.__game.fx.tier, window.__game.fx.drawEvery]); };
    const a = await phase(22, 9000);
    ok(a[0] === 0 && a[1] === 1, `22 ms a frame: down to tier 0, still drawing every frame (got tier ${a[0]}, every ${a[1]})`);
    const b = await phase(60, 4000);
    ok(b[0] === 0 && b[1] === 2, `60 ms a frame: drawing every other frame (got tier ${b[0]}, every ${b[1]})`);
    const c = await phase(0, 7000);
    ok(c[1] === 1, `no load: every frame again (got every ${c[1]})`);
    const d = await phase(0, 6000);
    ok(d[0] >= 1, `no load: climbing back (tier ${d[0]})`);
    const log = await p2.evaluate(() => window.__log);
    // the path it took, as changes only
    const path = log.filter((x, i) => i === 0 || x[1] !== log[i - 1][1] || x[2] !== log[i - 1][2]).map((x) => `t${x[1]}${x[2] > 1 ? '/2' : ''}@${x[3]}ms`);
    console.log('adaptive path (tier/every-2nd @ load):', path.join(' '));
    // under a steady load it only ever goes one way
    const steady = log.filter((x) => x[3] === 22).map((x) => x[1]);
    ok(steady.every((t, i) => i === 0 || t <= steady[i - 1]), `under a steady 22 ms load the tier only goes down (${[...new Set(steady)].join(' ')})`);
    await b2.close();
  }
  server.close();
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
