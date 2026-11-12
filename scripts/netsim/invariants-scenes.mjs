#!/usr/bin/env node
// Every ?scene= through the sim's invariants (README, Run; README, Fundamentals, States and the flags they own).
//   npm run test:invariants:scenes        (node scripts/netsim/invariants-scenes.mjs [--secs 20] [--scenes a,b])
// Headless Chromium on the raw source, no dev server: the page opens with ?invariants (src/main.js hooks
// src/combat/invariants.js to sim.afterTick), then each scene in window.__gauntlet.scenes (the 1v1 test timelines, the
// fights, horde) plays from its start for --secs seconds. The scripted scenes reach what CPU play rarely does (a scene
// switching mid-strike, posed bodies, every character's specials in turn), which netsim:invariants can't. The first
// violation in a scene is printed with its last log entries, the page reloads, and the rest still run; exit 1 if any.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const SECS = +opt('secs', 20), ONLY = opt('scenes', '') ? opt('scenes').split(',') : null;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glsl': 'text/plain' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/play/index.html?scene=dummy&invariants`;
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(String(e)));
const open = async () => {
  await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready && window.__game.sim.afterTick, null, { timeout: 60000 });
};
await open();
const all = ONLY || await pg.evaluate(() => window.__gauntlet.scenes);
let bad = 0, steps = 0;
for (const name of all) {
  const r = await pg.evaluate(({ name, secs }) => {
    const sim = window.__game.sim;
    window.__invariant = null;
    try { window.__gauntlet.setScene(name, {}); } catch (e) { return { err: String(e) }; }
    let n = 0;
    for (let i = 0; i < secs * 60 && !window.__invariant; i++) n += sim.step(1000 / 60);
    return { inv: window.__invariant, steps: n };
  }, { name, secs: SECS });
  if (r.err) { bad++; console.log(`FAIL ${name}: the scene threw: ${r.err}`); await open(); continue; }
  steps += r.steps;
  if (!r.inv) continue;
  bad++;
  const v = r.inv;
  console.log(`FAIL ${name}: ${v.rule}, unit ${v.unit} in ${v.state} at sim.stepCount ${v.step} (phase ${v.phase}): ${v.detail}`);
  for (const e of v.log || []) console.log('   ', JSON.stringify(e));
  await open();   // the hook switched itself off at the violation
}
await browser.close(); server.close();
console.log(`${all.length} scenes, ${SECS} s each, ${steps} steps checked: ${bad ? `${bad} with a violation` : 'no violations'}${errors.length ? `\npage errors: ${errors.slice(0, 5).join(' | ')}` : ''}`);
process.exit(bad || errors.length ? 1 : 0);
