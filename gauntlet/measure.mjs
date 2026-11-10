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
//   --set k=v,...  overrides STAMINA fields (frameData.js) for the run, e.g. --set refundHit=0.4
//
// --root points at another checkout (say, main unpacked under gauntlet/captures/base) for a before/after.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// playwright from the global npm root (any machine), the old fixed path as a fallback
const { chromium } = require([(() => { try { return require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright'; } catch { return ''; } })(), '/Users/spierce/.nvm/versions/node/v22.23.2/lib/node_modules/playwright'].find((q) => q && require('node:fs').existsSync(q)));

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
const browser = await chromium.launch({ ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
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
if (mode === 'scene') {
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
