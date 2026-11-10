#!/usr/bin/env node
// Headless match measurements (README, Stamina and Faint): mashers against a CPU, and CPU vs CPU win rates.
// Serves the game raw (like capture.mjs), drives whole matches with __game.advance and prints JSON.
//
//   node gauntlet/measure.mjs mash [--root DIR] [--matches 3] [--diffs 0.3,0.7] [--char temp]
//     two mashers, P1 against a CPU at each difficulty, `--matches` matches each:
//       random  every 10 to 18 steps (120 Hz) a random button, the stick re-rolled every 40 steps
//       one     walks in, then presses 1 every 12 steps
//   node gauntlet/measure.mjs cpu [--root DIR] [--matches 24] [--diff 0.7] [--pairs temp:courier,security:helpdesk]
//     CPU vs CPU, sides swapped every match; rounds won per character
//   node gauntlet/measure.mjs scene NAME     a timeline scene phase by phase: P1's stamina at each hit, block, botch, faint
//   node gauntlet/measure.mjs faint          faint-test phase by phase: how long P1 stayed fainted, shakes, movement while fainted
//   node gauntlet/measure.mjs faintsave      save/restore checks through faints with head shakes (state hash per restored step)
//   node gauntlet/measure.mjs cpufaint       a fainted CPU shaking it off at each difficulty: average and best faint length
//   PW_CHROME=/path/to/chrome-headless-shell  a browser binary when the installed playwright's own isn't downloaded
//   --set k=v,...  overrides STAMINA fields (frameData.js) for the run, e.g. --set refundHit=0.4
//
// --root points at another checkout (say, main unpacked under gauntlet/captures/base) for a before/after.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return require(path.join(path.dirname(process.execPath), '../lib/node_modules/playwright')); } })();   // local, else the global install beside this node

const [,, mode = 'mash', ...rest] = process.argv;
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
const root = path.resolve(opt('--root', path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.glsl': 'text/plain' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
const errors = [];
pg.on('pageerror', e => errors.push(String(e)));
await pg.goto(`http://127.0.0.1:${server.address().port}/play/index.html?scene=dummy`);
await pg.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 30000 });
// --set k=v,k=v overrides STAMINA fields for this run (the module is shared with the game, so it takes effect)
const sets = Object.fromEntries((opt('--set', '') || '').split(',').filter(Boolean).map(kv => { const [k, v] = kv.split('='); return [k, +v]; }));
if (Object.keys(sets).length) await pg.evaluate(async (sets) => { const m = await import('/src/combat/frameData.js'); Object.assign(m.STAMINA, sets); }, sets);

// one match in the page: P1 is a masher or a CPU, P2 a CPU; returns per-match stats for P1 and P2
async function match(o) {
  return pg.evaluate(async (o) => {
    const g = window.__game, sim = g.sim;
    window.__gauntlet.setScene('ai-fight', { seed: o.seed, chars: o.chars });
    let s = o.seed >>> 0;
    const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    if (o.p1 === 'cpu') sim.setAI(0, o.diff); else {
      let next = 10, hold = 0, btn = 'lp', dx = 0, reroll = 0, t = 0;
      sim.setController(0, 'script', (me, opp) => {
        t++;
        const toward = Math.sign(opp.x - me.x) || 1, inp = { dx: 0, jump: false, block: false, down: false, run: false, lp: false, rp: false, lk: false, rk: false };
        if (o.p1 === 'one') {
          inp.dx = Math.abs(opp.x - me.x) > 110 ? toward : 0;
          if (t % 12 < 2) inp.lp = true;
          return inp;
        }
        if (t >= reroll) { const r = rnd(); dx = r < 0.6 ? toward : r < 0.8 ? 0 : -toward; reroll = t + 40; }
        inp.dx = dx;
        if (t >= next) { btn = ['lp', 'rp', 'lk', 'rk'][Math.floor(rnd() * 4)]; hold = 2; next = t + 10 + Math.floor(rnd() * 9); }
        if (hold > 0) { inp[btn] = true; hold--; }
        return inp;
      });
    }
    sim.setAI(1, o.diff2 != null ? o.diff2 : o.diff);
    const st = [0, 1].map(() => ({ dmg: 0, best: 0, combos: [], open: 0, faints: 0, rounds: 0, botches: 0, hits: 0, blocks: 0, timeWins: 0 }));
    let steps = 0, lastH = sim.units.map(u => u.health), lastFaint = sim.units.map(u => u.faintAt), curCombo = [0, 0], seen = new WeakSet(sim.log), lastPhase = sim.phase;
    const OPEN = /^(botch|knockdown|down|getup|roll|splat|grabbed)$/;
    for (let f = 0; f < 60 * 60 * 8 && sim.phase !== 'match'; f++) {
      g.advance(1000 / 60);
      for (const n of sim.log) {
        if (seen.has(n)) continue; seen.add(n);
        if (n.type === 'botch' && n.att <= 1) st[n.att].botches++;
        if (n.type === 'hit' && n.att <= 1) st[n.att].hits++;
        if (n.type === 'block' && n.att <= 1) st[n.att].blocks++;
      }
      if (lastPhase === 'fight' && sim.phase !== 'fight' && sim.banner === 'TIME' && sim.winner >= 0 && sim.winner <= 1) st[sim.winner].timeWins++;
      lastPhase = sim.phase;
      sim.units.forEach((u, i) => { if (u.health < lastH[i] && u.health < lastH[i]) st[1 - i].dmg += lastH[i] - u.health; lastH[i] = u.health; });
      if (sim.phase !== 'fight') { lastH = sim.units.map(u => u.health); continue; }
      steps++;
      sim.units.forEach((u, i) => {
        if (u.faintAt !== lastFaint[i] && u.faintAt >= 0) { st[i].faints++; lastFaint[i] = u.faintAt; }
        if (OPEN.test(u.state) || u.faint > 0) st[i].open++;
        // the combo this unit is taking: record its length when it ends
        const c = u.combo && u.comboBy === 1 - i ? u.combo : 0;
        if (c >= curCombo[i]) curCombo[i] = c; else { if (curCombo[i]) st[1 - i].combos.push(curCombo[i]); curCombo[i] = c; }
      });
    }
    [0, 1].forEach((i) => { if (curCombo[i]) st[1 - i].combos.push(curCombo[i]); });
    st[0].rounds = sim.wins[0]; st[1].rounds = sim.wins[1];
    for (const x of st) { x.best = Math.max(0, ...x.combos); x.avg = x.combos.length ? x.combos.reduce((a, b) => a + b, 0) / x.combos.length : 0; x.open = x.open / Math.max(1, steps); delete x.combos; }
    return st;
  }, o);
}

const out = { root, mode };
if (mode === 'faintsave') {
  // save/restore across faints: P1 faints and shakes (alternating every 12 to 17 steps) while P2 jabs him now
  // and then; at save points through each faint, save, run 40 steps, load, run them again: every step's state
  // hash must match, and loading a state with faintCut or shakeDir nudged must not
  out.faintsave = await pg.evaluate(async () => {
    const g = window.__game, sim = g.sim, { hashSim } = await import('/src/net/hash.js');
    window.__gauntlet.setScene('dummy', {});
    let s0 = 0;
    const E = { dx: 0, jump: false, block: false, down: false, run: false, lp: false, rp: false, lk: false, rk: false };
    sim.setController(0, 'script', () => { const t = sim.stepCount - s0, n = 12 + (Math.floor(t / 97) % 6); return t >= 20 && t % n < 6 ? { ...E, dx: Math.floor(t / n) % 2 ? 1 : -1 } : E; });
    sim.setController(1, 'script', () => { const t = sim.stepCount - s0; return t % 70 === 45 ? { ...E, lp: true } : E; });
    let checks = 0, bad = 0, caught = 0, tries = 0, faints = 0, shakes = 0;
    for (let rep = 0; rep < 12; rep++) {
      for (let i = 0; i < 30; i++) sim.tick();
      const u = sim.units[0]; u.stamina = 0; sim.faintNow(u); s0 = sim.stepCount; faints++;
      for (let at = 0; at < 200 && u.faint > 0; at += 9) {
        for (let i = 0; i < 9; i++) sim.tick();
        const st = sim.saveState(), ref = [];
        for (let i = 0; i < 40; i++) { sim.tick(); ref.push(hashSim(sim)); }
        sim.loadState(st);
        for (let i = 0; i < 40; i++) { sim.tick(); checks++; if (hashSim(sim) !== ref[i]) bad++; }
        // a nudged restore must show up
        sim.loadState(st);
        if (u.faint > 0) { tries++; u.faintCut += 1; u.shakeDir = -u.shakeDir || 1; let diff = false; for (let i = 0; i < 40; i++) { sim.tick(); if (hashSim(sim) !== ref[i]) { diff = true; break; } } if (diff) caught++; }
        sim.loadState(st);
        for (let i = 0; i < 40; i++) sim.tick();
        shakes = Math.max(shakes, u.faintCut / 12);
      }
    }
    return { faints, checks, mismatched: bad, nudged: tries, nudgesCaught: caught, maxCutShakes: shakes };
  });
  process.stderr.write(JSON.stringify(out.faintsave) + '\n');
} else if (mode === 'cpufaint') {
  // a fainted CPU shaking it off: P1 is the CPU at each difficulty (and the showcase), P2 stands still; P1 faints
  // 40 times on the spot. Average and best faint length, shakes counted, and how often it shook at all
  for (const [d, style] of [[0.1, null], [0.3, null], [0.5, null], [0.7, null], [0.9, null], [1, 'showcase']]) {
    const r = await pg.evaluate(({ d, style }) => {
      const g = window.__game, sim = g.sim;
      window.__gauntlet.setScene('ai-fight', { seed: 7 });
      sim.setAI(0, d, style ? { style } : undefined);
      const E = { dx: 0, jump: false, block: false, down: false, run: false, lp: false, rp: false, lk: false, rk: false };
      sim.setController(1, 'script', () => E);
      const lens = [], cuts = []; let shook = 0, moved = 0;
      for (let rep = 0; rep < 40; rep++) {
        for (let i = 0; i < 90; i++) sim.tick();
        const u = sim.units[0];
        for (let i = 0; i < 600 && !(/^(idle|walk)$/.test(u.state) && u.grounded && sim.phase === 'fight'); i++) sim.tick();   // faint him on his feet, free
        u.stamina = 0; sim.faintNow(u); const s0 = sim.stepCount, x0 = u.x;
        while (u.faint > 0 && sim.stepCount - s0 < 400) sim.tick();
        lens.push((sim.stepCount - s0) / 0.12); cuts.push(u.faintCut); if (u.shakeDir) shook++; moved = Math.max(moved, Math.abs(u.x - x0));
        sim.units[1].health = sim.units[1].maxHealth; u.health = u.maxHealth;
      }
      const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
      return { d, style, avgMs: Math.round(avg), bestMs: Math.round(Math.min(...lens)), worstMs: Math.round(Math.max(...lens)), shookShare: shook / lens.length, avgShakes: +(cuts.reduce((a, b) => a + b, 0) / cuts.length / 12).toFixed(1), maxMoved: Math.round(moved) };
    }, { d, style });
    out[`${style || d}`] = r; process.stderr.write(JSON.stringify(r) + '\n');
  }
} else if (mode === 'faint') {
  // faint-test phase by phase: how long P1 stayed fainted, shakes counted, how far the body moved
  for (let k = 0; k < 20; k++) {
    const r = await pg.evaluate((k) => {
      const g = window.__game, sim = g.sim;
      try { window.__gauntlet.setScene('faint-test', { only: k }); } catch (e) { return null; }
      const ph = sim.phaseName; if (!ph) return null;
      const u = sim.units[0], s0 = sim.stepCount;
      let shakes = 0, end = -1, minX = u.x, maxX = u.x, last = u.shakeAt, ns = 0;
      for (let f = 0; f < 60 * 3; f++) {
        g.advance(1000 / 60);
        if (u.shakeAt !== last) { last = u.shakeAt; shakes++; }
        if (end < 0) { minX = Math.min(minX, u.x); maxX = Math.max(maxX, u.x); }   // while fainted
        if (end < 0 && !(u.faint > 0)) { end = sim.stepCount - s0; ns = u.faintCut; }
        if (sim.phaseName !== ph) break;
      }
      return { phase: ph, faintMs: Math.round(end / 0.12), shakes, cutMs: Math.round(ns / 0.12), movedWhileFainted: Math.round(maxX - minX) };
    }, k);
    if (!r) break;
    out[k] = r; process.stderr.write(`${k} ${JSON.stringify(r)}\n`);
  }
} else if (mode === 'scene') {
  // a scripted scene, phase by phase: P1's stamina trace at each hit, block, refund and faint, the best combo, P2's damage
  const name = rest[0];
  for (let k = 0; k < 40; k++) {
    const r = await pg.evaluate(({ name, k }) => {
      const g = window.__game, sim = g.sim;
      try { window.__gauntlet.setScene(name, { only: k }); } catch (e) { return null; }   // past the last phase
      const ph = sim.phaseName; if (!ph) return null;
      const u = sim.units[0], d = sim.units[1], trace = [], seen = new WeakSet(sim.log), h0 = d.health;
      let best = 0, minSt = u.stamina, fainted = false, last = u.stamina, endSt = u.stamina;
      for (let f = 0; f < 60 * 9; f++) {
        g.advance(1000 / 60);
        for (const e of sim.log) {
          if (seen.has(e)) continue; seen.add(e);
          if (e.att === 0 && /hit|block|botch|armor/.test(e.type) || e.type === 'faint') trace.push(`${e.type}${e.move ? ':' + e.move : ''}${e.kind ? ':' + e.kind : ''}@${Math.round(u.stamina)}`);
        }
        if (u.stamina > last + 0.5 && u.state === 'attack') trace.push(`+${Math.round(u.stamina - last)}`);
        last = u.stamina; minSt = Math.min(minSt, u.stamina); if (u.faint > 0) fainted = true;
        if (sim.combo && sim.combo.by === 0) best = Math.max(best, sim.combo.count);
        if (sim.phaseName !== ph) break;
        endSt = u.stamina;
      }
      return { phase: ph, best, dmg: h0 - d.health, minStamina: Math.round(minSt), end: Math.round(endSt), fainted, trace: trace.join(' ') };
    }, { name, k });
    if (!r) break;
    out[k] = r; process.stderr.write(`${k} ${JSON.stringify(r)}\n`);
  }
} else if (mode === 'mash') {
  const N = +opt('--matches', 3), diffs = opt('--diffs', '0.3,0.7').split(',').map(Number), ch = opt('--char', 'temp');
  for (const kind of opt('--kinds', 'random,one').split(',')) for (const d of diffs) {
    const rows = [];
    for (let m = 0; m < N; m++) { const r = await match({ p1: kind, diff: d, seed: 101 + m * 17, chars: [ch, 'temp'] }); rows.push({ ...r[0], cpuRounds: r[1].rounds }); }
    const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
    out[`${kind}@${d}`] = { rounds: sum('rounds'), dmg: Math.round(sum('dmg')), best: Math.max(...rows.map(r => r.best)), avgCombo: +(sum('avg') / N).toFixed(2), open: +(sum('open') / N * 100).toFixed(1), faints: sum('faints'), botches: sum('botches'), hits: sum('hits'), blocks: sum('blocks'), timeWins: sum('timeWins'), cpuRounds: rows.reduce((a, r) => a + r.cpuRounds, 0) };
    process.stderr.write(`${kind}@${d} ${JSON.stringify(out[`${kind}@${d}`])}\n`);
  }
} else {
  const N = +opt('--matches', 24), d = +opt('--diff', 0.7);
  for (const pr of opt('--pairs', 'temp:temp,temp:courier,security:helpdesk,manager:intern').split(',')) {
    const [a, b] = pr.split(':'); let ra = 0, rb = 0, fa = 0, fb = 0;
    for (let m = 0; m < N; m++) {
      const swap = m % 2 === 1, r = await match({ p1: 'cpu', diff: d, seed: 500 + m * 31, chars: swap ? [b, a] : [a, b] });
      const [A, B] = swap ? [r[1], r[0]] : [r[0], r[1]];
      ra += A.rounds; rb += B.rounds; fa += A.faints; fb += B.faints;
    }
    out[pr] = { rounds: `${ra}-${rb}`, pct: +(100 * ra / Math.max(1, ra + rb)).toFixed(1), faints: `${fa}-${fb}` };
    process.stderr.write(`${pr} ${JSON.stringify(out[pr])}\n`);
  }
}
out.errors = errors.slice(0, 5);
console.log(JSON.stringify(out, null, 1));
await browser.close(); server.close();
