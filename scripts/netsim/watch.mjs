// Spectator proof (README, Multiplayer, Spectators): real matches, played by two phones over a bad network with
// the real session and rollback netcode (as in run.mjs), watched by spectators through the real host feed
// (src/net/watchfeed.js), the room's own watch code (src/net/watchroom.js, the code the Worker runs) and the
// real spectator (src/net/watch.js), each on its own sim. Then it compares:
//
//   - every 30th frame's state hash a spectator played against the host's confirmed hash of the same frame
//   - each match's final state and result against the players'
//   - who got in: from the first frame, mid-match, after leaving and coming back, across a rematch
//   - a host whose sim was knocked off (the resync reaches spectators), a host who turns spectating off, a host
//     who leaves mid-match, a crew match (nothing reaches the room, and it refuses spectators)
//
//   npm run netsim:watch                    every scenario, 2 seeds
//   npm run netsim:watch -- --seeds 6 --only late-joiners
//   npm run netsim:watch -- --upgrades even  at the room rule UPGRADES: EVEN
//
// Exit code 1 if any spectator ever showed a different fight from the players'.

const UPGRADES = process.argv.includes('--upgrades') && process.argv[process.argv.indexOf('--upgrades') + 1] === 'even' ? 'even' : 'off';
import { installDom, installClock, sched, runUntil, resetClock, at } from './env.mjs';
installDom();
const { createNetwork } = await import('./network.mjs');
const { createClient, createSpectator } = await import('./client.mjs');
const { createWatch, BUFFER_MS } = await import('../../src/net/watch.js');
const { HOLD_MS } = await import('../../src/net/watchlog.js');
const { roster } = await import('../../src/characters/index.js');
const { mulberry32 } = await import('../../src/combat/rng.js');
installClock();
console.info = () => {};
const warn = console.warn; console.warn = (...a) => { if (process.env.NETSIM_DEBUG) warn(...a); };

const cell = (base, jitter, loss) => ({ base, jitter, loss, drift: base * 0.4, driftPeriod: 17000, burst: { enter: 0.01, exit: 0.25, loss: 0.7 } });
/** what: who watches and when (ms after the first match starts; 'pre' = before it), and what else happens */
const SCENARIOS = {
  'first-frame':   { cond: () => cell(80, 25, 0.05), frames: [{ fps: 60 }, { fps: 60 }], watchers: [{ at: 'pre' }, { at: 'pre', fps: 30 }] },
  'late-joiners':  { cond: () => cell(120, 40, 0.08), frames: [{ fps: 60 }, { fps: 30 }], watchers: [{ at: 9000 }, { at: 31000, uneven: true }, { at: 55000, fps: 120 }] },
  'come-and-go':   { cond: () => cell(150, 50, 0.08), frames: [{ uneven: true }, { fps: 60 }], watchers: [{ at: 4000, leave: 20000, back: 33000 }, { at: 'pre', drop: 25000 }, { at: 15000, hide: [30000, 9000] }] },
  'cell-400ms':    { cond: () => cell(400, 100, 0.15), frames: [{ fps: 120 }, { fps: 60 }], watchers: [{ at: 'pre' }, { at: 20000 }] },
  'guest-knocked': { cond: () => cell(200, 60, 0.10), frames: [{ fps: 60 }, { uneven: true }], inject: [null, { every: 12000, atEnd: true }], watchers: [{ at: 'pre' }, { at: 26000 }] },
  'host-knocked':  { cond: () => cell(200, 60, 0.10), frames: [{ fps: 30 }, { fps: 60 }], inject: [{ every: 12000, atEnd: true }, null], watchers: [{ at: 'pre' }, { at: 26000 }], hostWrong: true },
  'turned-off':    { cond: () => cell(80, 25, 0.05), frames: [{ fps: 60 }, { fps: 60 }], watchers: [{ at: 'pre' }, { at: 8000 }], off: 16000, lateTry: 20000, matches: 1 },
  'host-leaves':   { cond: () => cell(80, 25, 0.05), frames: [{ fps: 60 }, { fps: 60 }], watchers: [{ at: 'pre' }, { at: 8000 }], hostLeaves: 18000, matches: 1 },
  'crew-match':    { cond: () => cell(80, 25, 0.05), frames: [{ fps: 60 }, { fps: 60 }], crew: true, watchers: [{ at: 'pre' }, { at: 12000 }], matches: 1 },
};

async function session(name, seed, wantMatches) {
  const sc = SCENARIOS[name];
  resetClock();
  const r = mulberry32((seed * 2654435761) >>> 0);
  const network = createNetwork(sc.cond(r), seed);
  const rules = { roundTime: 30, winsNeeded: 2, upgrades: UPGRADES };   // --upgrades even: the room rule that puts every stat's top tier on both fighters
  const A = createClient({ name: 'host', seed: seed * 2 + 1, network, frames: sc.frames[0], rules, inject: sc.inject ? sc.inject[0] : null });
  const B = createClient({ name: 'guest', seed: seed * 2 + 2, network, frames: sc.frames[1], rules, inject: sc.inject ? sc.inject[1] : null });
  const matches = sc.matches || wantMatches;
  const ids = roster().map((c) => c.id), pickRng = mulberry32(seed + 99);
  for (const c of [A, B]) {
    let pickedFor = '';
    c.net.on('session', (v) => {
      if (v.phase === 'select' && !v.mine.ready && pickedFor !== `${v.n}`) {
        pickedFor = `${v.n}`;
        const id = ids[Math.floor(pickRng() * ids.length)];
        setTimeout(() => { c.net.pick(id, false); setTimeout(() => c.net.pick(id, true), 300 + pickRng() * 1500); }, 400 + pickRng() * 1500);
      }
    });
    c.net.setName(c === A ? 'ALICE' : 'BOB');
  }
  A.start(0); B.start(9);
  let code = '', matchStart = -1, watchingMax = 0, listed = 0, listedPrivate = 0;
  A.net.on('start', (e) => { if (e.n === 1) matchStart = sched.t; });
  A.net.on('watching', (n) => { watchingMax = Math.max(watchingMax, n); });
  const opts = { pickFirst: true, crew: !!sc.crew };
  at(3000, () => { A.net.host(opts).then((o) => { code = o.code; if (sc.crew) network.claimPrivate(code); }); }, A, 'timer');
  at(5500, () => { if (code) B.net.join(code, opts); }, B, 'timer');
  // the spectators
  const specs = sc.watchers.map((w, i) => {
    const s = createSpectator({ name: `spec${i}`, seed: seed * 31 + i * 7 + 5, network, frames: w.uneven ? { uneven: true } : { fps: w.fps || 60 }, createWatch });
    s.plan = w; s.opens = 0;
    s.hostFrame = () => (A.net.netcode ? A.net.netcode.frame : -1);
    s.start(11 + i * 3);
    return s;
  });
  const open = (s) => { if (code) { s.opens++; s.watch.open(code); } };
  for (const s of specs) if (s.plan.at === 'pre') at(7000, () => open(s), s, 'timer');
  // the timed parts hang off the first match's start
  let armed = false;
  const arm = () => {
    if (armed || matchStart < 0) return;
    armed = true;
    for (const s of specs) {
      const w = s.plan;
      if (typeof w.at === 'number') at(matchStart + w.at, () => open(s), s, 'timer');
      if (w.leave) at(matchStart + w.leave, () => s.watch.leave(), s, 'timer');
      if (w.back) at(matchStart + w.back, () => open(s), s, 'timer');
      // the network dies under it (nothing arrives, and it isn't told): watch.js notices and reconnects
      if (w.drop) at(matchStart + w.drop, () => { const room = network.rooms.get(code); for (const k of [...room.watchers]) if (k.owner === s) { k.closed = true; room.watchers.delete(k); room.desk.count(); } }, null, 'net');
      if (w.hide) at(matchStart + w.hide[0], () => { s.hiddenUntil = matchStart + w.hide[0] + w.hide[1]; }, null, 'net');
    }
    if (sc.off) at(matchStart + sc.off, () => A.net.setWatchable(false), A, 'timer');
    if (sc.lateTry) at(matchStart + sc.lateTry, () => { const s = specs[0]; s.late = true; open(s); }, specs[0], 'timer');
    if (sc.hostLeaves) at(matchStart + sc.hostLeaves, () => A.net.leave(), A, 'timer');
  };
  const done = () => { arm(); const room = network.rooms.get(code); if (room && network.live.has(code)) { listed++; if (room.priv) listedPrivate++; } return (Object.keys(A.results).length >= matches && Object.keys(B.results).length >= matches) || (A.ended && B.ended); };
  const limit = 9000 + matches * 260000;
  await runUntil(limit, done);
  await runUntil(sched.t + 6000);   // the last frames reach the spectators (the hold and the buffer), and they play them out
  const room = network.rooms.get(code);
  if (process.env.WATCH_DEBUG) {
    const dm = room.desk.match;
    console.log('  room:', dm ? { n: dm.setup.n, frames: dm.log.frames, released: dm.log.released, newest: dm.log.newest } : null, 'starts', room.starts, 'batches', room.batches, 'feed', JSON.stringify(A.net.feed.stats), 'host', A.net.state, A.net.match, A.net.netcode && A.net.netcode.frame);
    for (const s of specs) console.log('  ', s.name, JSON.stringify(s.watch.stats()).slice(0, 300), s.started, Object.keys(s.results), s.overs);
  }
  const rep = evaluate(name, seed, sc, A, B, specs, room, { watchingMax, listed, listedPrivate, matches, stillListed: network.live.has(code), unlisted: network.stats.unlisted });
  A.net.setWatchable(true);
  for (const s of specs) { try { s.watch.leave(); } catch { /* gone */ } }
  for (const c of [A, B]) { try { c.net.leave(); } catch { /* gone */ } }
  return rep;
}

function evaluate(name, seed, sc, A, B, specs, room, x) {
  let checks = 0, diffs = 0, ownChecks = 0, ownBad = 0, ends = 0, endDiffs = 0, missed = 0, lag = 0, lagN = 0, stalls = 0, catchUps = 0;
  const notes = [];
  for (const s of specs) {
    // every hash frame this spectator played, against the host's confirmed hash of it (a host that was knocked off
    // re-hashes from its resync on; before that point the spectator has the true fight and the host didn't)
    if (!sc.hostWrong) for (const [k, h] of s.hashes) { const theirs = A.confirmed.get(k); if (theirs == null) continue; checks++; if (theirs !== h) { diffs++; if (notes.length < 3) notes.push(`${s.name} ${k}: ${h} vs host ${theirs}`); } }
    const t = s.watch.stats().totals;
    ownChecks += t.checks; ownBad += t.bad;
    for (const n of Object.keys(s.results)) {
      const mine = s.results[n], theirs = A.results[n];
      if (!theirs) continue;
      ends++;
      if (mine.hash !== theirs.hash || mine.frame !== theirs.frame || mine.winner !== theirs.winner || mine.wins.join() !== theirs.wins.join()) { endDiffs++; notes.push(`${s.name} match ${n} ended ${mine.frame}/${mine.hash}/${mine.wins} vs host ${theirs.frame}/${theirs.hash}/${theirs.wins}`); }
    }
    lag += s.lagMs; lagN += s.lagN; stalls += t.starved; catchUps += s.catchUps;
  }
  const fail = [];
  if (diffs || ownBad) fail.push(`${diffs + ownBad} hashes differ`);
  if (endDiffs) fail.push(`${endDiffs} final states differ`);
  if (sc.crew) {
    // a crew's match: the host's page sends the room nothing, the room lets nobody in and lists nothing
    if (room.starts || room.batches) fail.push(`a crew match fed the room (${room.starts} starts, ${room.batches} batches)`);
    if (x.listedPrivate || x.listed) fail.push('a crew match was listed');
    for (const s of specs) { if (s.started.length) fail.push(`${s.name} watched a crew match`); if (s.watch.state !== 'error' || s.watch.detail !== 'no-room') fail.push(`${s.name} wasn't refused (${s.watch.state} ${s.watch.detail})`); }
  } else if (sc.off) {
    for (const s of specs) if (s.watch.state !== 'error' || s.watch.detail !== 'off') fail.push(`${s.name} wasn't sent away when the host turned spectating off (${s.watch.state} ${s.watch.detail})`);
    if (x.stillListed) fail.push('still in the LIVE list after the host turned spectating off');
    if (Object.keys(A.results).length < 1) fail.push('the players\' own match didn\'t finish');
  } else if (sc.hostLeaves) {
    for (const s of specs) if (!(s.watch.state === 'error' && s.watch.detail === 'closed') && s.watch.state !== 'over') fail.push(`${s.name} didn't see the match end when the host left (${s.watch.state} ${s.watch.detail})`);
    if (B.ended !== 'peer-left') fail.push(`the guest ended as ${B.ended}`);
    if (x.stillListed) fail.push('still in the LIVE list after the host left');
  } else {
    // everyone who came saw every match that started after they did through to its real end
    for (const s of specs) {
      for (const n of Object.keys(A.results)) if (s.started.includes(+n) && !s.results[n] && !(s.plan.leave && !s.plan.back)) { missed++; notes.push(`${s.name} never finished match ${n} (${s.watch.state} ${s.watch.detail}, frame ${s.watch.stats().frame}/${s.watch.stats().frames})`); }
      if (!s.started.length) { missed++; notes.push(`${s.name} never got a match`); }
    }
    if (missed) fail.push(`${missed} matches not seen through`);
    if (!x.listed) fail.push('never in the LIVE list');
    if (x.unlisted < Object.keys(A.results).length) fail.push(`left the LIVE list ${x.unlisted} times for ${Object.keys(A.results).length} finished matches`);
    if (x.watchingMax < 1) fail.push('the host never saw anyone watching');
    if (ownChecks === 0) fail.push('no hash was checked');
  }
  return { name, seed, ok: !fail.length, fail, notes, checks, diffs, ownChecks, ownBad, ends, endDiffs, lagMs: lagN ? lag / lagN : 0, stalls, catchUps,
    resyncs: A.resyncs + B.resyncs, specResyncs: specs.reduce((k, s) => k + s.watch.stats().totals.resyncs, 0), matches: Object.keys(A.results).length, watchingMax: x.watchingMax,
    starts: room ? room.starts : 0, batches: room ? room.batches : 0, feed: A.net.feed.stats, minutes: sched.t / 60000 };
}

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
if (argv.includes('--list')) { console.log(Object.keys(SCENARIOS).join('\n')); process.exit(0); }
const seeds = +arg('seeds', 2), matches = +arg('matches', 2), first = +arg('seed', 1), only = arg('only', '');
const names = Object.keys(SCENARIOS).filter((n) => !only || only.split(',').includes(n));
const rows = [], t0 = Date.now();
for (const name of names) for (let s = first; s < first + seeds; s++) {
  const rep = await session(name, s, matches);
  rows.push(rep);
  console.log(`${name.padEnd(14)} seed ${String(s).padStart(2)}  ${rep.ok ? 'ok  ' : 'FAIL'}  matches ${rep.matches}  spectator hashes vs host ${String(rep.checks).padStart(5)} (${rep.diffs} differ)  own checks ${String(rep.ownChecks).padStart(5)} (${rep.ownBad} bad)  ends ${rep.ends} (${rep.endDiffs} differ)  behind ${(rep.lagMs / 1000).toFixed(2)} s  ran dry ${rep.stalls}  catch-ups ${rep.catchUps}  resyncs ${rep.resyncs}/${rep.specResyncs} loaded  watching ${rep.watchingMax}  batches ${rep.batches}  ${rep.minutes.toFixed(1)} min` + (rep.fail.length ? `\n    ${rep.fail.join('; ')}` : '') + (rep.notes.length ? `\n    ${rep.notes.slice(0, 5).join('\n    ')}` : ''));
}
const tot = (k) => rows.reduce((s, r) => s + r[k], 0);
const bad = rows.filter((r) => !r.ok).length;
const lagRows = rows.filter((r) => r.lagMs > 0);
console.log(`\n${rows.length} sessions, ${tot('matches')} matches: ${tot('checks')} spectator hashes compared with the host's (${tot('diffs')} differ), ${tot('ownChecks')} checked by the spectators themselves (${tot('ownBad')} bad), ${tot('ends')} final states (${tot('endDiffs')} differ); ` +
  `${(lagRows.reduce((s, r) => s + r.lagMs, 0) / Math.max(1, lagRows.length) / 1000).toFixed(2)} s behind the host on average (hold ${HOLD_MS} ms + buffer ${BUFFER_MS} ms + the trip); ran out of frames on a slow delivery ${tot('stalls')} times; ${bad} sessions failed; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(bad ? 1 : 0);
