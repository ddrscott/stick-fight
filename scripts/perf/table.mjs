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
