#!/usr/bin/env node
// Markdown before/after tables from scripts/perf/results/*.json (README, Performance).
import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'results');
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return []; } };
const B = read('before-frames.json'), A = read('after-frames.json');
const key = (r) => `${r.scenario}|${r.throttle}|${r.tier}`;
const bm = new Map(B.map((r) => [key(r), r]));
const ba = (b, a, k, d = 1) => `${b ? (+b[k]).toFixed(d) : '?'} → ${(+a[k]).toFixed(d)}`;
console.log('| Scenario | CPU | Tier | Frame p50 / p95 / p99 ms, before → after | Long frames a minute | Main-thread work p50 / p95 ms | fps |');
console.log('|---|---|---|---|---|---|---|');
for (const a of A) {
  const b = bm.get(key(a));
  console.log(`| ${a.scenario} | ${a.throttle}x | ${a.tier} | ${b ? `${b.p50.toFixed(1)} / ${b.p95.toFixed(1)} / ${b.p99.toFixed(1)}` : '?'} → ${a.p50.toFixed(1)} / ${a.p95.toFixed(1)} / ${a.p99.toFixed(1)} | ${ba(b, a, 'longPerMin', 0)} | ${b ? `${b.work50.toFixed(1)} / ${b.work95.toFixed(1)}` : '?'} → ${a.work50.toFixed(1)} / ${a.work95.toFixed(1)} | ${ba(b, a, 'fps', 0)} |`);
}
const RB = read('before-rollback.json'), RA = read('after-rollback.json');
console.log('\n| Rollback burst (12 steps) | CPU | p50 ms before → after | worst ms before → after |\n|---|---|---|---|');
for (const a of RA) { const b = RB.find((r) => r.scenario === a.scenario && r.throttle === a.throttle); console.log(`| ${a.scenario} | ${a.throttle}x | ${ba(b, a, 'burst50')} | ${ba(b, a, 'burstMax')} |`); }
const LB = [...read('before-load.json'), ...read('before-load-4g.json')], LA = [...read('after-load.json'), ...read('after-load-4g.json')];
console.log('\n| Load `/play/` | CPU | Network | First frame ms | First paint ms | Main thread ms | KB |\n|---|---|---|---|---|---|---|');
for (const a of LA) { const b = LB.find((r) => r.throttle === a.throttle && r.net === a.net); console.log(`| cold | ${a.throttle}x | ${a.net} | ${ba(b, a, 'firstFrameMs', 0)} | ${ba(b, a, 'fcpMs', 0)} | ${ba(b, a, 'mainThreadMs', 0)} | ${ba(b, a, 'kb', 0)} |`); }
const SB = read('before-swiftshader.json'), SA = read('after-swiftshader.json');
console.log('\n| GPU work (SwiftShader, ms a frame) | Tier | p50 before → after | p95 before → after |\n|---|---|---|---|');
for (const a of SA) { const b = SB.find((r) => r.scenario === a.scenario && r.tier === a.tier); console.log(`| ${a.scenario} | ${a.tier} | ${ba(b, a, 'synced50', 0)} | ${ba(b, a, 'synced95', 0)} |`); }
const AU = read('after-auto.json');
if (AU.length) { console.log('\n| Adaptive tier (phone start: 2) | CPU | settled on | fps | p95 ms |\n|---|---|---|---|---|'); for (const a of AU) console.log(`| ${a.scenario} | ${a.throttle}x | tier ${a.tier} | ${a.fps.toFixed(0)} | ${a.p95.toFixed(1)} |`); }

// The Chromebook stand-in (README, Performance, Chromebooks): 6x CPU plus SwiftShader, before (tiers 3, 2, 1) and after
// (3, 2, 1, 0 and AUTO). Rows say the tier asked for (asked; older runs are in the order they ran), the tier AUTO
// settled on, pictures drawn a second, and the frame p95. "<2" is a run whose every frame took over half a second,
// which the profiler drops as a pause.
for (const dev of ['cros', 'croshd']) {
  const CB = read(`${dev}-before.json`), CA = read(`${dev}-after.json`);
  if (!CA.length) continue;
  const tag = (rows, order) => { const n = new Map(); return rows.map((r) => { const i = n.get(r.scenario) || 0; n.set(r.scenario, i + 1); return { ...r, asked: r.asked ?? order[i] }; }); };
  let b = tag(CB, ['3', '2', '1']), a = tag(CA, ['3', '2', '1', '0', 'auto']);
  // ${dev}-auto.json: AUTO measured again on its own (a later build's adaptive rules), in place of the AUTO rows
  const AUTO = read(`${dev}-auto.json`);
  if (AUTO.length) a = a.map((r) => (r.asked === 'auto' ? AUTO.find((x) => x.scenario === r.scenario) || r : r)).map((r) => ({ ...r, asked: r.asked ?? 'auto' }));
  const fps = (r) => (!r ? '-' : r.fps < 1 ? '<2' : `${Math.round(r.drawn ?? r.fps)}${r.every > 1 ? ' (every 2nd)' : ''}`);
  const p95 = (r) => (!r ? '-' : r.fps < 1 ? '>500' : r.p95.toFixed(0));
  console.log(`\n| ${dev === 'cros' ? '1366x768 @1' : '1920x1080 @1.25'}, 6x CPU, SwiftShader | Tier | fps before → after | frame p95 ms before → after | main thread p50 ms after |\n|---|---|---|---|---|`);
  for (const r of a) {
    const o = b.find((x) => x.scenario === r.scenario && String(x.asked) === String(r.asked));
    const tier = r.asked === 'auto' ? `AUTO → ${r.tier}` : r.asked;
    console.log(`| ${r.scenario} | ${tier} | ${fps(o)} → ${fps(r)} | ${p95(o)} → ${p95(r)} | ${r.work50.toFixed(1)} |`);
  }
}

// AUTO at other throttles (cros-throttle.json: 1x, 10x, 20x)
const TH = read('cros-throttle.json');
if (TH.length) {
  console.log('\n| AUTO, 1366x768 @1, SwiftShader | CPU | settled on | fps | frame p95 ms | main thread p50 ms |\n|---|---|---|---|---|---|');
  for (const r of TH) console.log(`| ${r.scenario} | ${r.throttle}x | tier ${r.tier}${r.every > 1 ? ', every 2nd frame' : ''} | ${Math.round(r.drawn ?? r.fps)} | ${r.p95.toFixed(0)} | ${r.work50.toFixed(1)} |`);
}
