#!/usr/bin/env node
// Timeline trace of one scenario: main-thread events by total self-ish duration (README, Performance).
//   node scripts/perf/trace.mjs [scene query] [--throttle 4] [--secs 4] [--out trace.json]
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
  res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await pw.chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: +opt('--throttle', 4) });
await page.goto(`http://127.0.0.1:${server.address().port}/play/?${query}`);
await page.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 60000 });
await page.waitForTimeout(3000);
const events = [];
cdp.on('Tracing.dataCollected', (e) => events.push(...e.value));
const done = new Promise(r => cdp.once('Tracing.tracingComplete', r));
await cdp.send('Tracing.start', { traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8', 'blink', 'cc', 'gpu'] }, transferMode: 'ReportEvents' });
await page.waitForTimeout(+opt('--secs', 4) * 1000);
await cdp.send('Tracing.end'); await done;
if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify({ traceEvents: events }));
// the renderer main thread: the thread named CrRendererMain in the page's process
const main = events.find(e => e.name === 'thread_name' && e.args && e.args.name === 'CrRendererMain');
const tot = new Map();
for (const e of events) {
  if (e.ph !== 'X' || !main || e.pid !== main.pid || e.tid !== main.tid) continue;
  tot.set(e.name, (tot.get(e.name) || 0) + (e.dur || 0));
}
for (const [k, v] of [...tot].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`${(v / 1000).toFixed(0).padStart(7)} ms  ${k}`);
await browser.close(); server.close();
