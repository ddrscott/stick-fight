#!/usr/bin/env node
// Floor logger: how far any drawn joint's outer edge sits below the floor under it, per 60fps frame, over CPU
// bouts and the scripted scenes. Serves the repo raw (like gauntlet/capture.mjs), drives play/index.html in
// headless Chromium through window.__game.stepPosed (the frame posed exactly as render() poses it, unpainted)
// and the page-side probe (scripts/floorlog/probe.js).
//   node scripts/floorlog/run.mjs [--secs 90] [--seeds 2] [--jobs 4] [--only scene,scene] [--no-bouts] [--out file.json]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SECS = +opt('--secs', 90), SEEDS = +opt('--seeds', 2), JOBS = +opt('--jobs', 4), OUT = opt('--out', null);
const ONLY = (opt('--only', '') || '').split(',').filter(Boolean), BOUTS = !argv.includes('--no-bouts');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/play/index.html`;
const probe = fs.readFileSync(path.join(root, 'scripts/floorlog/probe.js'), 'utf8');

const SCRIPTED = ['juggle-test', 'floor-break-test', 'throw-test', 'getup-test', 'wall-test', 'air-recovery-test', 'botch-test', 'stair-test', 'stomp-test', 'combo-test', 'string-ender-test', 'accident-test',
  'courier-test', 'security-test', 'intern-test', 'windowwasher-test', 'helpdesk-test', 'manager-test', 'accountant-test', 'receptionist-test', 'lawyer-test', 'ceo-test', 'janitor-test',
  'hrrep-test', 'salesrep-test', 'barista-test', 'chef-test', 'wellness-test', 'electrician-test'];
const HORDE = [['horde-floors-ai', 120], ['horde-ai', 90]];
const ROSTER = ['temp', 'intern', 'helpdesk', 'courier', 'security', 'janitor', 'manager', 'accountant', 'windowWasher', 'ceo', 'receptionist', 'lawyer', 'salesRep', 'hrRep', 'barista', 'chef', 'wellness', 'electrician'];
const jobs = [];
for (const s of SCRIPTED) if (!ONLY.length || ONLY.includes(s)) jobs.push({ scene: s, cycle: true });
for (const [s, secs] of HORDE) if (!ONLY.length || ONLY.includes(s)) jobs.push({ scene: s, secs });
if (BOUTS && (!ONLY.length || ONLY.includes('ai-fight'))) {
  for (let i = 0; i < ROSTER.length; i++) for (let sd = 0; sd < SEEDS; sd++) {
    const a = ROSTER[i], b = ROSTER[(i + 1 + sd * 4) % ROSTER.length];
    jobs.push({ scene: 'ai-fight', chars: [a, b], seed: 42 + i * 13 + sd * 1000, secs: SECS });
  }
}

// the browser playwright wants, else any headless shell already downloaded (a global playwright newer or older than its browsers)
let executablePath;
try { if (!fs.existsSync(chromium.executablePath())) throw 0; } catch {
  const dir = path.join(process.env.HOME || '', '.cache/ms-playwright');
  const hit = fs.existsSync(dir) && fs.readdirSync(dir).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse()
    .map(d => path.join(dir, d, 'chrome-headless-shell-linux64/chrome-headless-shell')).find(f => fs.existsSync(f));
  if (hit) executablePath = hit;
}
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
const errors = [];
async function worker() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(String(e)));
  // the roster ids the game knows (character files use their own ids)
  await pg.goto(base + '?scene=idle');
  await pg.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 30000 });
  await pg.evaluate(probe);
  await pg.evaluate(() => window.__floorlogReady);
  while (jobs.length) {
    const j = jobs.shift();
    const lab = j.scene + (j.chars ? `:${j.chars.join('-')}:${j.seed}` : '');
    const r = await pg.evaluate(async ({ j, lab }) => {
      const G = window.__game, ids = G.roster().map(c => c.id);
      const pick = (want) => ids.find(id => id.toLowerCase() === want.toLowerCase()) || ids.find(id => id.toLowerCase().startsWith(want.toLowerCase().slice(0, 4))) || ids[0];
      const opts = {}; if (j.chars) opts.chars = j.chars.map(pick); if (j.seed != null) opts.seed = j.seed;
      window.__gauntlet.setScene(j.scene, opts);
      window.__floorlog.begin(lab);
      const dt = 1000 / 60;
      if (j.cycle) {
        const first = G.sim.phaseName; let left = false, n = 0;
        while (n++ < (first ? 40000 : 60 * 60)) {   // a timeline runs one full cycle; a plain scene a minute
          window.__floorlog.step(dt);
          const p = G.sim.phaseName;
          if (p && p !== first) left = true;
          if (left && p === first) break;
          if (!left && n > 1500) break;   // a timeline of one phase
        }
      } else for (let n = 0; n < j.secs * 60; n++) window.__floorlog.step(dt);
      return window.__floorlog.report();
    }, { j, lab });
    results.push({ label: lab, ...r });
    process.stderr.write(`${lab}: ${r.frames} frames, drawn>1px ${(r.stages.drawn && r.stages.drawn.over[0]) || 0}\n`);
  }
  await ctx.close();
}
await Promise.all(Array.from({ length: JOBS }, worker));
await browser.close(); server.close();

// ---- the summary ----------------------------------------------------------------------------
const merge = (into, tab) => { for (const k in tab) { const e = tab[k], m = into[k] || (into[k] = { n: 0, over: [0, 0, 0, 0], max: 0 }); m.n += e.n; for (let i = 0; i < 4; i++) m.over[i] += e.over[i]; m.max = Math.max(m.max, e.max); } };
const byKeyCtx = {}, byCtx = {}, stages = {}, byKey = {}, pile = {}, ragdolls = {}, byScene = {};
let worst = [], frames = 0;
for (const r of results) {
  frames += r.frames; merge(byCtx, r.byCtx); merge(byKeyCtx, r.byKeyCtx); merge(stages, r.stages); merge(byKey, r.byKey); merge(pile, r.pile); merge(ragdolls, r.ragdolls);
  const sc = r.label.split(':')[0]; merge(byScene, { [sc]: (r.stages.drawn || { n: 0, over: [0, 0, 0, 0], max: 0 }) });
  worst.push(...r.worst);
}
worst.sort((a, b) => b.d - a.d); worst = worst.slice(0, 40);
const fmt = (k, e) => `${k.padEnd(34)} ${String(e.n).padStart(8)} ${e.over.map(v => String(v).padStart(7)).join('')} ${e.max.toFixed(1).padStart(7)}`;
const head = `${''.padEnd(34)} ${'frames'.padStart(8)} ${['>1px', '>3px', '>6px', '>10px'].map(v => v.padStart(7)).join('')} ${'max'.padStart(7)}`;
const lines = [];
lines.push(`floor logger: ${results.length} runs, ${frames} frames (60fps), unit-frames per stage`);
lines.push(head);
for (const k of ['rig', 'smooth', 'drawn', 'cloth']) if (stages[k]) lines.push(fmt(k, stages[k]));
for (const k in ragdolls) lines.push(fmt('horde ragdoll ' + k, ragdolls[k]));
for (const k in pile) lines.push(fmt('pile ' + k, pile[k]));
lines.push('', 'by surface (main: the main floor, low: the lower floor or a flight from it, stair: on a flight, fall: through a stairwell)', head);
for (const k of Object.keys(byCtx).sort()) lines.push(fmt(k, byCtx[k]));
lines.push('', 'drawn, by state/clip (rows with any frame over 1px)', head);
for (const [k, e] of Object.entries(byKey).filter(([, e]) => e.over[0] > 0).sort((a, b) => b[1].over[0] - a[1].over[0])) lines.push(fmt(k, e));
lines.push('', 'drawn, by scene', head);
for (const [k, e] of Object.entries(byScene).sort((a, b) => b[1].over[0] - a[1].over[0])) lines.push(fmt(k, e));
lines.push('', 'worst offenders (px below the floor; stages: rig = the sim\'s joints, smooth = after the draw smoothing, drawn = with the life layer)');
const line = (w) => `${w.d.toFixed(1).padStart(6)}  ${w.scene} f${w.frame} u${w.unit} ${w.char || ''} ${w.key} ${w.joint}${w.rig != null ? `  rig ${w.rig} smooth ${w.smooth} drawn ${w.drawn}${w.cloth != null ? ' cloth ' + w.cloth : ''} ${w.ctx}${w.juggle ? ' juggle' : ''}${w.grounded ? ' grounded' : ''}` : ''}${w.where ? `  at ${JSON.stringify(w.where)} u ${w.ux},${w.uy} stair ${w.stair} floor ${w.floor} hip ${w.hip.x},${w.hip.y}` : ''}`;
for (const w of worst.slice(0, 25)) lines.push(line(w));
lines.push('', 'the worst frame of each state/clip');
const perKey = {};
for (const r of results) for (const w of r.worstByKey || []) if (!perKey[w.key] || w.d > perKey[w.key].d) perKey[w.key] = w;
for (const w of Object.values(perKey).sort((a, b) => b.d - a.d).slice(0, 40)) lines.push(line(w));
if (errors.length) lines.push('', 'page errors:', ...errors.slice(0, 10));
console.log(lines.join('\n'));
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ frames, byKeyCtx, byCtx, stages, byKey, pile, ragdolls, byScene, worst, runs: results.map(r => ({ label: r.label, frames: r.frames, drawn: r.stages.drawn })) }, null, 1));
