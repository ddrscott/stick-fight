#!/usr/bin/env node
// CPU profile of one scenario (README, Performance): the top functions by self time, from the production build.
//   node scripts/perf/profile.mjs [scene query] [--throttle 4] [--secs 5]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(process.execPath, '../../lib/node_modules/playwright')); }
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const query = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'scene=attract';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../dist');
const server = http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  const ext = path.extname(p);
  res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[ext] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await pw.chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: +opt('--throttle', 4) });
if (argv.includes('--load')) {
  // the load itself: from navigation to the first drawn frame
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
}
await page.goto(`http://127.0.0.1:${server.address().port}/play/?${query}`);
await page.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 60000 });
if (!argv.includes('--load')) await page.waitForTimeout(3000);
if (argv.includes('--alloc')) {
  // allocations (sampled, collected ones included) by the function that made them
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMinorGC: true, includeObjectsCollectedByMajorGC: true });
  const secs = +opt('--secs', 5);
  await page.waitForTimeout(secs * 1000);
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  const agg = new Map(); let tot = 0;
  (function walk(n) { const f = n.callFrame; const k = `${f.functionName || '(anon)'} ${(f.url || '').split('/').pop()}:${f.lineNumber}`; agg.set(k, (agg.get(k) || 0) + n.selfSize); tot += n.selfSize; (n.children || []).forEach(walk); })(profile.head);
  console.log(`${(tot / 1024 / secs).toFixed(0)} KB allocated a second`);
  for (const [k, t] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, +opt('--top', 25))) console.log(`${(100 * t / tot).toFixed(1).padStart(5)}%  ${k}`);
  await browser.close(); server.close(); process.exit(0);
}
if (!argv.includes('--load')) {
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await page.waitForTimeout(+opt('--secs', 5) * 1000);
}
const { profile } = await cdp.send('Profiler.stop');
const dt = profile.timeDeltas, self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n]));
const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) || 0) + (dt[i] || 0));
const agg = new Map(); let total = 0;
for (const [id, t] of self) { const f = byId.get(id).callFrame; const k = `${f.functionName || '(anon)'} ${(f.url || '').split('/').pop()}:${f.lineNumber}`; agg.set(k, (agg.get(k) || 0) + t); total += t; }
console.log(`total ${(total / 1000).toFixed(0)} ms sampled`);
for (const [k, t] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, +opt('--top', 25))) console.log(`${(100 * t / total).toFixed(1).padStart(5)}%  ${k}`);
await browser.close(); server.close();
