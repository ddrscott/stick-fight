#!/usr/bin/env node
// Horde is endless (README, Arcade flow, Horde): `npm run test:horde`. Headless Chromium on the raw source, the sim
// stepped in the page.
//   1. clock      a run has no clock: a 30 s TIME rule going in leaves roundTime 0, and 150 s on one goon ends nothing
//   2. regen      the hero heals HORDE_REGEN a second after HORDE_REGEN_DELAY seconds untouched, to a full bar; a hit
//                 starts the wait over
//   3. trips      a CPU hero against weak goons, 12 seeds up to 12 floors: every trip to the next floor starts its wave
//                 (the old build left him upstairs on 4 of them, until TIME)
//      sides      over the same runs, a goon coming in while another is up enters on that goon's side of the hero, so
//                 two never surround him (the old build took the doors in turn, so the second came in behind him); and
//                 when he gets between two anyway (a jump or a walk past one), the one on the wrong side goes over him
//                 to its partner's side: never 3 s between them
//   4. KOs        ?scene=horde-ko-test: a goon put down by a plain hit, a juggle, a counter on its wake-up strike, a
//                 hit through armor and a throw. Each keeps the run going and counts exactly once, the fifth clears
//                 the floor, and then a goon KOing the hero still ends the run (the old build ended it on a juggle,
//                 wake or armor KO of a goon)
//   5. flow       the same run inside the arcade flow (index.html, HORDE): run.goons goes up by one a goon and the
//                 flow reaches GAME OVER only after the hero goes down
//   6. debugKO    the flow's test hook goes through the sim's KO resolution: debugKO(0) puts a goon down and the run
//                 goes on (it used to end it), debugKO(1) puts the hero down, sim.result says heroDown, GAME OVER follows
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, executablePath } from '../../gauntlet/browser.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glsl': 'text/plain' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
const errors = [];
pg.on('pageerror', e => errors.push(String(e)));
await pg.goto(`http://127.0.0.1:${server.address().port}/play/index.html?scene=dummy`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await pg.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 30000 });

const results = await pg.evaluate(() => {
  const g = window.__game, sim = g.sim, out = [];
  const ok = (name, pass, detail) => out.push({ name, pass: !!pass, detail });
  const step = (secs, each) => { for (let i = 0; i < secs * 60; i++) { sim.step(1000 / 60); if (each && each(i) === false) return i; } return -1; };
  const WEAK = { goonHealth: 7, goonDifficulty: 0.02, heal: 40 };

  // 1. the clock
  g.setScene('horde-floors-ai', {});
  sim.roundTime = 30; sim.resetMatch({ seed: 3, skipIntro: true, horde: WEAK });
  ok('clock: a 30 s rule going in, roundTime is 0', sim.roundTime === 0, `roundTime ${sim.roundTime}`);
  sim.setController(0, 'script', () => ({ dx: 0, block: true }));
  sim.setController(1, 'script', () => ({ dx: 0 }));
  let ended = null;
  step(150, (i) => { if (sim.phase !== 'fight') { ended = `${(i / 60).toFixed(1)}s ${sim.phase} ${sim.banner}`; return false; } });
  ok('clock: 150 s with no goon down ends nothing', !ended, ended || 'still fighting');

  // 2. regen
  const p = sim.units[0], H = sim.horde;
  p.health = 40; H.lastHp = 40; H.calm = 0;
  step(2.9); const early = p.health;
  ok('regen: nothing in the first 3 s', early === 40, `at 2.9 s ${early.toFixed(2)}`);
  step(10.1); const t13 = p.health;
  ok('regen: 1 a second after that', Math.abs(t13 - 50) < 0.2, `at 13 s ${t13.toFixed(2)} (want 50)`);
  step(60); ok('regen: stops at a full bar', p.health === (p.maxHealth || 100), `at 73 s ${p.health}`);
  p.health = 60; H.lastHp = 60; step(5); const before = p.health; p.health -= 10; step(2.9); const held = p.health; step(2);
  ok('regen: a hit starts the wait over', held === before - 10 && p.health > held, `${before.toFixed(1)} -10 -> ${held.toFixed(1)} after 2.9 s -> ${p.health.toFixed(1)} after 4.9 s`);

  // 3. the trips between floors: a CPU hero against weak goons, 12 seeds, up to 12 floors each. The old build left
  // the hero upstairs after some trips (an attack on the vault's drop lands him high on the flight, still counted
  // as upstairs) with no wave coming, until TIME ended the run: 4 of these 12 runs. A KO is fair; a trip
  // over 9 s, or any TIME, is not.
  const runs = [], bad = [];
  let longest = 0, floors = 0, pairs = 0, twoUp = 0, flanked = 0, flankRun = 0, flankLong = 0;
  const flanks = [], prevFilter = sim.eventFilter;
  sim.eventFilter = (ev) => {
    if (ev.type === 'goon' && ev.unit) {
      const p = sim.units[0], o = sim.units.find(u => u.id >= 1 && u !== ev.unit && !u.hidden);
      if (o) { pairs++; if (Math.sign(o.x - p.x) !== Math.sign(ev.unit.x - p.x)) flanks.push(`floor ${ev.floor}: hero ${p.x.toFixed(0)}, up ${o.x.toFixed(0)}, new ${ev.unit.x.toFixed(0)}`); }
    }
    return prevFilter ? prevFilter(ev) : true;
  };
  for (let seed = 1; seed <= 12; seed++) {
    g.setScene('horde-floors-ai', { seed }); sim.setAI(0, 1.0);
    let at = -1, res = '';
    step(300, (i) => {
      const H = sim.horde, p = sim.units[0];
      // two goons up on his floor, off the stairs: how many steps they had him between them, and the longest stretch
      const gs = sim.units.filter(u => u.id >= 1 && !u.hidden && u.state !== 'ko' && (u.floor || 0) === (p.floor || 0));
      if (gs.length === 2 && !(p.stair >= 0) && sim.phase === 'fight') {
        twoUp++;
        if (Math.sign(gs[0].rig.joints.hip.x - p.rig.joints.hip.x) * Math.sign(gs[1].rig.joints.hip.x - p.rig.joints.hip.x) < 0) { flanked++; flankLong = Math.max(flankLong, ++flankRun); } else flankRun = 0;
      } else flankRun = 0;
      if (sim.phase === 'ko' || sim.phase === 'match') { res = sim.banner === 'TIME' ? 'TIME' : 'KO'; return false; }
      if (H.transit && at < 0) at = i; if (!H.transit) at = -1;
      if (at >= 0) longest = Math.max(longest, (i - at) / 60);
      if (at >= 0 && i - at > 9 * 60) { res = `STUCK heroFloor ${p.floor} stair ${p.stair}`; return false; }
      if (H.floorsCleared >= 12) { res = '12'; return false; }
    });
    floors += sim.horde.floorsCleared;
    runs.push(`${seed}:${res || sim.horde.floorsCleared}`);
    if (res === 'TIME' || res.startsWith('STUCK')) bad.push(`seed ${seed} ${res} after ${sim.horde.floorsCleared} floors`);
  }
  sim.eventFilter = prevFilter;
  ok('sides: a second goon never comes in on the hero\'s other side', pairs > 0 && !flanks.length, `${pairs} goons came in with another up, ${flanks.length} behind the hero${flanks.length ? ': ' + flanks.slice(0, 4).join('; ') : ''}`);
  ok('sides: two goons up never keep him between them', twoUp > 0 && flankLong <= 3 * 60, `with two goons up he was between them ${(100 * flanked / Math.max(1, twoUp)).toFixed(1)}% of the time (${(flanked / 60).toFixed(1)} of ${(twoUp / 60).toFixed(0)} s), longest ${(flankLong / 60).toFixed(2)} s (3 s at most)`);
  ok('trips: every trip to the next floor starts its wave, no TIME', !bad.length && longest <= 9, `${floors} floors over 12 runs (seed:floors or KO) ${runs.join(' ')}, longest trip ${longest.toFixed(1)} s${bad.length ? '; ' + bad.join('; ') : ''}`);

  // 3b. put him between two goons and hold him still (a guard, his bar kept full): the one on the wrong side goes
  // over him to its partner's side. 8 tries with the gap and the side the near one is on varied.
  const tries = [];
  for (let t = 0; t < 8; t++) {
    g.setScene('horde-floors-ai', { seed: 20 + t });
    sim.setController(0, 'script', () => ({ dx: 0, block: true }));
    // two goons down brings the second in with the third
    for (let k = 0; k < 40 && sim.units.filter(u => u.id >= 1 && !u.hidden).length < 2; k++) {
      const gl = sim.units.find(u => u.id >= 1 && !u.hidden && u.state !== 'ko');
      if (gl) sim.forceKO(gl, sim.units[0]);
      step(0.5);
    }
    const p = sim.units[0], gs = sim.units.filter(u => u.id >= 1 && !u.hidden);
    if (gs.length < 2) { tries.push('no second goon'); continue; }
    const fl = sim.bounds, mid = (fl.x0 + fl.x1) / 2, near = 90 + 20 * t, far = 260 - 10 * t, s = t % 2 ? 1 : -1;
    p.x = mid; gs[0].x = mid + s * near; gs[1].x = mid - s * far;
    for (const u of [p, ...gs]) { u.vx = 0; u.prevX = u.x; }
    let at = -1, from = -1;
    step(6, (i) => {
      p.health = p.maxHealth || 100;
      const a = gs.filter(u => !u.hidden && u.state !== 'ko');
      if (a.length < 2) { at = -2; return false; }
      const hx = (u) => u.rig.joints.hip.x;   // by the bodies, like the sim (a lying one's root is off at its feet)
      // apart for good: on one side for half a second (one shoved straight back across doesn't count)
      if (Math.sign(hx(a[0]) - hx(p)) === Math.sign(hx(a[1]) - hx(p))) { if (from < 0) from = i; if (i - from >= 30) { at = from; return false; } } else from = -1;
    });
    tries.push(at === -2 ? 'a goon went down' : at < 0 ? 'still between them after 6 s' : (at / 60).toFixed(2) + ' s');
  }
  ok('sides: held between two goons, they get to one side of him', tries.every(x => / s$/.test(x) && parseFloat(x) <= 3), tries.join(', '));

  // 3c. the same with him lying on the floor (held down): in the middle of the floor, a goon on each side of his hip
  // both ways round, and at the left stairwell's lip with one goon in the strip between his body and the opening.
  // The old build bounced the goon back at his hip (its side of him, kept by the lying-body rules, was still the
  // old one), and the partner standing at his hip left it no room to come into.
  const downTries = [];
  for (let t = 0; t < 4; t++) {
    g.setScene('horde-floors-ai', { seed: 40 + t });
    sim.setController(0, 'script', () => ({ dx: 0 }));
    for (let k = 0; k < 40 && sim.units.filter(u => u.id >= 1 && !u.hidden).length < 2; k++) {
      const gl = sim.units.find(u => u.id >= 1 && !u.hidden && u.state !== 'ko');
      if (gl) sim.forceKO(gl, sim.units[0]);
      step(0.5);
    }
    const p = sim.units[0], gs = sim.units.filter(u => u.id >= 1 && !u.hidden);
    if (gs.length < 2) { downTries.push('no second goon'); continue; }
    const lip = t >= 2, mid = (sim.bounds.x0 + sim.bounds.x1) / 2, well = sim.stairwells.slice().sort((a, b) => a.x0 - b.x0)[0];
    const hold = () => { p.health = p.maxHealth || 100; if (p.state === 'down') p.downTimer = 9; };
    p.x = mid; sim.enter(p, 'down'); p.rig.play('knockdown'); p.rig.update(1.5); p.vx = 0; sim.rigUpd(p, 0);
    gs[0].x = mid + 600; gs[1].x = mid - 600;
    step(0.1, hold);
    const h0 = p.rig.joints.hip.x;
    p.x += lip ? well.x1 + 70 - Math.min(p.x, h0) : mid - h0; sim.rigUpd(p, 0);
    step(0.05, hold);
    const H = p.rig.joints.hip.x, lo = Math.min(p.x, H), hi = Math.max(p.x, H), s = t % 2 ? 1 : -1;
    if (lip) { gs[1].x = Math.max(well.x1 + 15, lo - 30); gs[0].x = hi + 120; }
    else { gs[0].x = H + s * 120; gs[1].x = H - s * 70; }
    for (const u of [p, ...gs]) { u.prevX = u.x; u.vx = 0; }
    for (const u of gs) u.home = Math.sign(u.x - H);   // their side of him, as if they'd walked up (they were put there)
    let at = -1, from = -1;
    step(4, (i) => {
      hold();
      const a = gs.filter(u => !u.hidden && u.state !== 'ko');
      if (a.length < 2) { at = -2; return false; }
      const hx = (u) => u.rig.joints.hip.x;
      if (Math.sign(hx(a[0]) - hx(p)) === Math.sign(hx(a[1]) - hx(p))) { if (from < 0) from = i; if (i - from >= 30) { at = from; return false; } } else from = -1;
    });
    downTries.push(`${lip ? 'lip' : 'mid'} ` + (at === -2 ? 'a goon went down' : at < 0 ? 'still between them after 4 s' : (at / 60).toFixed(2) + ' s'));
  }
  ok('sides: him lying between two goons (at a stairwell lip too), they get to one side of him', downTries.every(x => / s$/.test(x) && parseFloat(x.split(' ')[1]) <= 2), downTries.join(', '));

  // 4. every way a goon goes down
  g.setScene('horde-ko-test', {});
  const T = g.hordeKoTest;
  step(90, () => (T.done ? false : undefined));
  const kinds = ['plain', 'juggle', 'wake', 'armor', 'throw'];
  for (const k of kinds) {
    const r = T.results.find(x => x.kind === k);
    ok(`KOs: a goon down by ${k} keeps the run going, counts once`, r && r.ok, r ? JSON.stringify(r) : 'no result');
  }
  const last = T.results.find(x => x.kind === 'throw');
  ok('KOs: the fifth goon down clears the floor', last && last.floorsCleared === 1 && last.wave === '5/5', last ? `wave ${last.wave}, floors ${last.floorsCleared}` : 'none');
  const hk = T.results.find(x => x.kind === 'hero');
  ok('KOs: a goon KOing the hero still ends the run', hk && hk.ok && sim.phase === 'match', hk ? JSON.stringify(hk) + ` phase ${sim.phase}` : 'no result');
  return out;
});

// 5. the same run in the arcade flow: its own scoring and its GAME OVER
await pg.goto(`http://127.0.0.1:${server.address().port}/play/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await pg.waitForFunction(() => window.__flow && window.__game, null, { timeout: 30000 });
const flowRes = await pg.evaluate(async () => {
  const g = window.__game, sim = g.sim, F = window.__flow, out = [];
  const ok = (name, pass, detail) => out.push({ name, pass: !!pass, detail });
  F.debug.go('modeSelect'); F.debug.sel.player = 'temp'; F.debug.startHorde();
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 200 && sim.phase !== 'fight'; i++) await wait(50);
  g.installHordeKo({});
  const T = g.hordeKoTest, states = new Set();
  // real time, the flow's own loop; record every flow state on the way
  for (let i = 0; i < 1200 && !(T.done && F.state === 'gameOver'); i++) { states.add(F.state); await wait(50); }
  states.add(F.state);
  const goonRes = T.results.filter(r => r.kind !== 'hero');
  ok('flow: run.goons up by exactly one for each of the five goons', goonRes.length === 5 && goonRes.every(r => r.goonsUp === 1) && F.debug.run.goons === 5,
    `${goonRes.map(r => `${r.kind}:${r.goonsUp}`).join(' ')} run.goons ${F.debug.run.goons}`);
  ok('flow: every goon KO keeps the run going', goonRes.length === 5 && goonRes.every(r => r.ok), goonRes.map(r => `${r.kind}:${r.ok ? 'ok' : r.why || JSON.stringify(r)}`).join(' '));
  const hk = T.results.find(r => r.kind === 'hero');
  ok('flow: GAME OVER comes after the hero goes down, not before', hk && hk.heroDown && F.state === 'gameOver', `hero ${hk ? JSON.stringify(hk) : 'none'}, flow ${F.state}, states ${[...states].join(' > ')}`);
  return out;
}).catch(e => [{ name: 'flow: ran', pass: false, detail: String(e) }]);
results.push(...flowRes);

// 6. the flow's debugKO in horde
await pg.goto(`http://127.0.0.1:${server.address().port}/play/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await pg.waitForFunction(() => window.__flow && window.__game, null, { timeout: 30000 });
const dbgRes = await pg.evaluate(async () => {
  const g = window.__game, sim = g.sim, F = window.__flow, out = [];
  const ok = (name, pass, detail) => out.push({ name, pass: !!pass, detail });
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  F.debug.go('modeSelect'); F.debug.sel.player = 'temp'; F.debug.startHorde();
  for (let i = 0; i < 200 && sim.phase !== 'fight'; i++) await wait(50);
  const c0 = sim.horde.count;
  F.debug.debugKO(0);
  await wait(1500);
  ok('debugKO: debugKO(0) in horde puts a goon down and the run goes on', sim.horde.count === c0 + 1 && F.debug.run.goons === 1 && !sim.result.over && F.state === 'fighting',
    `count ${c0} -> ${sim.horde.count}, run.goons ${F.debug.run.goons}, result ${JSON.stringify(sim.result)}, flow ${F.state}`);
  F.debug.debugKO(1);
  const reason = sim.result.reason;
  for (let i = 0; i < 300 && F.state !== 'gameOver'; i++) await wait(50);
  ok('debugKO: debugKO(1) puts the hero down: heroDown, then GAME OVER', reason === 'heroDown' && F.state === 'gameOver', `reason ${reason}, flow ${F.state}`);
  return out;
}).catch(e => [{ name: 'debugKO: ran', pass: false, detail: String(e) }]);
results.push(...dbgRes);

let fail = 0;
for (const r of results) { if (!r.pass) fail++; console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name}  (${r.detail})`); }
if (errors.length) { fail++; console.log('FAIL page errors:\n  ' + errors.join('\n  ')); }
console.log(`${results.length - (fail - (errors.length ? 1 : 0))} of ${results.length} passed`);
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
