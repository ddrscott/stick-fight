// Online desync harness: two phones in one Node process, each with its own sim, rigs and arena, the real
// online session (src/net/online.js), rollback netcode (src/net/rollback.js) and codec, linked through a fake
// room with a bad cellular network (scripts/netsim/network.mjs), on a virtual clock. They play crew-style
// best-of-3 matches back to back (the pick screen, rematches, NEW CHARACTERS) and the harness compares what
// each side confirmed: every 30th frame's state hash, each match's result, and how the session ended.
//
//   npm run netsim                          every scenario, 4 seeds each
//   npm run netsim -- --seeds 10 --matches 3 --only dropout-10s
//   npm run netsim -- --upgrades even        the same at the room rule UPGRADES: EVEN (both fighters fully upgraded)
//   npm run netsim -- --loadouts             the same with the custom employee: each phone slots random moves in its fighters (their looks carry them) and its thumbs press the slots
//   npm run netsim -- --list                the scenarios
//
// Exit code 1 if any run ends with the two sides in different fights (an unrecovered desync, different
// match results, or one side playing on after the other stopped).

const LOADOUTS = process.argv.includes('--loadouts');   // the custom employee: each phone slots random moves in its fighters
const UPGRADES = process.argv.includes('--upgrades') && process.argv[process.argv.indexOf('--upgrades') + 1] === 'even' ? 'even' : 'off';
import { installDom, installClock, sched, runUntil, resetClock } from './env.mjs';
installDom();
const { createNetwork } = await import('./network.mjs');
const { createClient } = await import('./client.mjs');
const { roster } = await import('../../src/characters/index.js');
const { mulberry32 } = await import('../../src/combat/rng.js');
installClock();
console.info = () => {};   // online.js's netsim notice and friends

// ---- scenarios: cellular in a moving car --------------------------------------------------------------------
const cell = (base, jitter, loss, extra = {}) => ({ base, jitter, loss, drift: base * 0.4, driftPeriod: 17000, burst: { enter: 0.01, exit: 0.25, loss: 0.7 }, ...extra });
/** @type {Record<string, { cond: (r: () => number) => any, frames: [any, any], bg?: (r: () => number) => { who: number, at: number, dur: number, kind: 'freeze' | 'hidden' }[], drawCheck?: boolean, inject?: [any, any] }>} */
const SCENARIOS = {
  'cell-80ms-5%':        { cond: () => cell(80, 25, 0.05), frames: [{ fps: 60 }, { fps: 60 }], drawCheck: true },
  'cell-200ms-10%':      { cond: () => cell(200, 60, 0.10), frames: [{ fps: 60 }, { fps: 30 }] },
  'cell-400ms-15%':      { cond: () => cell(400, 100, 0.15), frames: [{ fps: 120 }, { fps: 60 }] },
  '30hz-vs-120hz':       { cond: () => cell(120, 40, 0.08), frames: [{ fps: 30 }, { fps: 120 }], drawCheck: true },
  'uneven-frames':       { cond: () => cell(150, 50, 0.08), frames: [{ uneven: true }, { fps: 60 }], drawCheck: true },
  'dropout-2s':          { cond: (r) => cell(150, 40, 0.08, { dropouts: drops(r, 2000) }), frames: [{ fps: 60 }, { fps: 60 }] },
  'dropout-5s':          { cond: (r) => cell(150, 40, 0.08, { dropouts: drops(r, 5000) }), frames: [{ fps: 60 }, { uneven: true }] },
  'dropout-10s':         { cond: (r) => cell(150, 40, 0.08, { dropouts: drops(r, 10000) }), frames: [{ fps: 60 }, { fps: 60 }] },
  'background-freeze':   { cond: () => cell(150, 40, 0.06), frames: [{ fps: 60 }, { fps: 60 }], bg: (r) => bgs(r, 'freeze') },
  'background-hidden':   { cond: () => cell(150, 40, 0.06), frames: [{ fps: 60 }, { fps: 30 }], bg: (r) => bgs(r, 'hidden') },
  // desyncs on purpose: one phone's sim nudged every ~15 s and on the frame each match's result shows
  'inject-guest':        { cond: () => cell(200, 60, 0.10), frames: [{ fps: 60 }, { uneven: true }], inject: [null, { every: 15000, atEnd: true }] },
  'inject-host':         { cond: () => cell(200, 60, 0.10), frames: [{ fps: 30 }, { fps: 60 }], inject: [{ every: 15000, atEnd: true }, null] },
  'inject-both-dropout': { cond: (r) => cell(250, 80, 0.12, { dropouts: drops(r, 5000) }), frames: [{ uneven: true }, { fps: 120 }], inject: [{ every: 20000, atEnd: true }, { every: 20000, atEnd: true }] },
  'everything':          { cond: (r) => cell(250, 80, 0.12, { dropouts: [...drops(r, 2000), ...drops(r, 5000, 90000)] }), frames: [{ uneven: true }, { fps: 30 }], bg: (r) => bgs(r, 'hidden', 1) },
};
// dropouts (both ways) at a few points in the session, the first one mid-fight
function drops(r, dur, from = 25000) { const out = []; let t = from + r() * 20000; for (let i = 0; i < 3; i++) { out.push({ at: t, dur }); t += 60000 + r() * 60000; } return out; }
// one phone backgrounded for 3 to 8 s, a couple of times
function bgs(r, kind, n = 2) { const out = []; let t = 30000 + r() * 30000; for (let i = 0; i < n; i++) { out.push({ who: i % 2, at: t, dur: 3000 + r() * 5000, kind }); t += 70000 + r() * 50000; } return out; }

// ---- one session ------------------------------------------------------------------------------------------
async function session(name, seed, matches) {
  const sc = SCENARIOS[name];
  resetClock();
  const r = mulberry32(seed * 2654435761 >>> 0);
  const cond = sc.cond(r);
  const network = createNetwork(cond, seed);
  const rules = { roundTime: 30, winsNeeded: 2, upgrades: UPGRADES };   // best of 3 with 30 s rounds: plenty of round and match ends; --upgrades even: both fighters fully upgraded
  const A = createClient({ name: 'host', seed: seed * 2 + 1, network, frames: sc.frames[0], rules, drawCheck: !!sc.drawCheck, inject: sc.inject ? sc.inject[0] : null, loadouts: LOADOUTS });
  const B = createClient({ name: 'guest', seed: seed * 2 + 2, network, frames: sc.frames[1], rules, drawCheck: !!sc.drawCheck, inject: sc.inject ? sc.inject[1] : null, loadouts: LOADOUTS });
  const both = [A, B];
  for (const w of sc.bg ? sc.bg(r) : []) {
    const c = both[w.who];
    sched.heap.length;   // (scheduled below)
    const k = w.kind === 'freeze' ? 'frozenUntil' : 'hiddenUntil';
    // set at w.at (as the network, so it isn't deferred by itself)
    const { at } = await import('./env.mjs');
    at(w.at, () => { c[k] = w.at + w.dur; }, null, 'net');
  }
  const ids = roster().map((c) => c.id);
  const pickRng = mulberry32(seed + 99);
  // the session's buttons: picks on the pick screen, and now and then NEW CHARACTERS after a match
  for (const c of both) {
    let pickedFor = '';
    c.net.on('session', (v) => {
      if (v.phase === 'select' && !v.mine.ready && pickedFor !== `${v.n}`) {
        pickedFor = `${v.n}`;
        const id = ids[Math.floor(pickRng() * ids.length)];
        setTimeout(() => { c.net.pick(id, false); setTimeout(() => c.net.pick(id, true), 300 + pickRng() * 1500); }, 400 + pickRng() * 1500);
      }
    });
    c.net.on('match-over', (v) => {
      if (v.role === 'host' && pickRng() < 0.35) setTimeout(() => c.net.postChoose('chars'), 800 + pickRng() * 1500);
      else if (v.role === 'guest' && pickRng() < 0.3) setTimeout(() => c.net.postChoose('rematch'), 500 + pickRng() * 1500);
    });
  }
  A.start(0); B.start(7 + r() * 9);
  // each phone shows its own demo for a while, then the host opens a crew match and the guest joins
  const hostAt = 4000 + r() * 6000, joinAt = hostAt + 1500 + r() * 4000;
  const { at } = await import('./env.mjs');
  let code = '';
  at(hostAt, () => { A.net.host({ pickFirst: true, crew: true }).then((o) => { code = o.code; }); }, A, 'timer');
  at(joinAt, () => { if (code) B.net.join(code, { pickFirst: true, crew: true }); }, B, 'timer');
  const done = () => (Object.keys(A.results).length >= matches && Object.keys(B.results).length >= matches) || (A.ended && B.ended);
  const limit = joinAt + matches * 260000;
  await runUntil(limit, done);
  // let the last messages land, then both leave
  await runUntil(sched.t + 3000);
  const report = evaluate(name, seed, A, B, network, matches, sched.t >= limit);
  if (report.stuck || report.bad || process.env.NETSIM_DEBUG) for (const c of both) {
    const s = c.net.stats(), v = c.net.view();
    console.error(`  [${c.name}] state ${s.state} n ${v.n} frame ${s.frame} confirmed ${s.confirmed} remoteTop ${s.remoteTop} stalledMs ${Math.round(s.stalledMs || 0)} halted ${s.halted} endWait ${Math.round(s.endWaitMs)} matchAt ${c.net.netcode && c.net.netcode.matchAt} epoch ${s.epoch} resyncs ${s.resyncs} phase ${c.sim.phase} round ${c.sim.round} wins ${c.sim.wins} ended ${c.ended} cd ${JSON.stringify(v.cd)} mine ${JSON.stringify(v.mine)} rival ${JSON.stringify({ want: v.rival.want, ready: v.rival.ready })}`);
  }
  for (const c of both) { try { c.net.leave(); } catch { /* gone */ } }
  return report;
}

function evaluate(name, seed, A, B, network, matches, timedOut) {
  // confirmed hash frames both sides have: how many differed (each a moment the two sims disagreed, whether or
  // not a resync then fixed it)
  let checks = 0, diffs = 0;
  for (const [k, h] of A.confirmed) { if (!B.confirmed.has(k)) continue; checks++; if (B.confirmed.get(k) !== h) diffs++; }
  // every match both finished: the same result, and the same final state on the same frame (the state each
  // side stopped on, hashed when it counted the result)
  const ns = new Set([...Object.keys(A.results), ...Object.keys(B.results)].map(Number));
  let resultDiffs = 0, endDiverged = 0, finished = 0;
  for (const n of ns) {
    const a = A.results[n], b = B.results[n];
    if (!a || !b) continue;
    finished++;
    if (a.winner !== b.winner || a.wins.join() !== b.wins.join()) resultDiffs++;
    if (a.hash !== b.hash || a.frame !== b.frame) endDiverged++;
  }
  // the session ended for one side only (one stopped, the other played on), or nobody finished in time
  const oneSided = !!A.ended !== !!B.ended && !(timedOut && !A.ended && !B.ended);
  const stuck = timedOut && !(A.ended && B.ended) && finished < matches;
  const desyncs = A.desyncs.length + B.desyncs.length;
  const firstDesync = [...A.desyncs, ...B.desyncs].sort((x, y) => x.t - y.t)[0] || null;
  const bad = endDiverged > 0 || resultDiffs > 0 || oneSided;
  return {
    name, seed, matches: finished, injected: A.injected + B.injected, checks, diffs, endDiverged, resultDiffs, desyncs, resyncs: A.resyncs + B.resyncs,
    ended: [A.ended, B.ended].map((e) => e || '-').join('/'), oneSided, stuck, bad,
    drawLeaks: A.drawLeaks + B.drawLeaks, drawChecks: A.drawChecks + B.drawChecks,
    lent: (A.lentOut || 0) + (B.lentOut || 0),   // --loadouts: borrowed moves that came out, on either phone
    firstDesync: firstDesync && { n: firstDesync.n, frame: firstDesync.frame, diff: (firstDesync.diff || []).slice(0, 4) },
    loss: network.stats.sent ? (network.stats.lost + network.stats.dropped) / network.stats.sent : 0,
    minutes: sched.t / 60000,
  };
}

// ---- main -------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
if (argv.includes('--list')) { console.log(Object.keys(SCENARIOS).join('\n')); process.exit(0); }
const seeds = +arg('seeds', 4), matches = +arg('matches', 3), first = +arg('seed', 1);
const only = arg('only', '');
const names = Object.keys(SCENARIOS).filter((n) => !only || only.split(',').includes(n));
const rows = [];
const t0 = Date.now();
for (const name of names) {
  for (let s = first; s < first + seeds; s++) {
    const rep = await session(name, s, matches);
    rows.push(rep);
    const flag = rep.bad ? 'DIVERGED' : rep.stuck ? 'STUCK' : 'ok';
    const why = rep.firstDesync ? `  first desync m${rep.firstDesync.n} f${rep.firstDesync.frame}: ${rep.firstDesync.diff.join(' | ')}` : '';
    process.stdout.write(`${name.padEnd(19)} seed ${String(s).padStart(2)}  ${flag.padEnd(8)} matches ${rep.matches}  hash checks ${String(rep.checks).padStart(5)}  differ ${String(rep.diffs).padStart(4)}  end-diverged ${rep.endDiverged}  results-differ ${rep.resultDiffs}  desyncs ${rep.desyncs}${rep.injected ? ` (${rep.injected} injected)` : ''}  resyncs ${rep.resyncs}  ended ${rep.ended}  draw ${rep.drawLeaks}/${rep.drawChecks}  loss ${(rep.loss * 100).toFixed(1)}%  ${rep.minutes.toFixed(1)} min${LOADOUTS ? `  borrowed moves ${rep.lent}` : ''}${why}\n`);
  }
}
const tot = (k) => rows.reduce((s, r) => s + (typeof r[k] === 'boolean' ? +r[k] : r[k]), 0);
console.log(`\n${rows.length} sessions, ${tot('matches')} matches, ${tot('checks')} hash checks: ${tot('diffs')} differed, ${tot('desyncs')} desync reports, ${tot('resyncs')} resyncs; ` +
  `${tot('bad')} sessions ended in different fights (${tot('endDiverged')} matches diverged at the end, ${tot('resultDiffs')} results differ, ${tot('oneSided')} one-sided), ${tot('stuck')} stuck; draw leaks ${tot('drawLeaks')}/${tot('drawChecks')}; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(tot('bad') ? 1 : 0);
