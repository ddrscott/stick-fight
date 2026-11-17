// Phones that change networks: the real link (src/net/link.js) over a fake network (scripts/netsim/wire.mjs),
// with the real session (src/net/online.js), netcode and sims on top, two phones in one Node process on a
// virtual clock (scripts/netsim/client.mjs, as npm run netsim). Each scenario does one bad thing to one phone
// in the middle of a match: a full dropout of 3, 10 or 18 s, the DataChannel's path dying while the room socket
// lives and then a switch to a new network killing both, 200 to 400 ms of jitter with 5% loss, a locked iPhone
// and an Android phone in the background. Every session has to finish its matches with the two sides' state
// hashes agreeing, no match dropped (what the page would send as online_drop), and the HUD saying RECONNECTING
// whenever the fight is held up waiting on the network.
//
//   npm run test:net:handoff                          every scenario, 3 seeds each
//   npm run test:net:handoff -- --only drop-18s --seeds 5
//   npm run test:net:handoff -- --legacy              the room as it was (no 'away', no seat memory): for the
//                                                     before numbers, run from a checkout of the old build whose
//                                                     createLink starts with the io shim (README, Reconnecting)
//
// Exit code 1 if any session drops a match, ends in different fights, or stalls without RECONNECTING.

import { installDom, installClock, sched, runUntil, resetClock, at } from './env.mjs';
installDom();
const { createWire } = await import('./wire.mjs');
const { createClient } = await import('./client.mjs');
const { createLink } = await import('../../src/net/link.js');
const onlineMod = await import('../../src/net/online.js');
const { roster } = await import('../../src/characters/index.js');
const { mulberry32 } = await import('../../src/combat/rng.js');
installClock();
console.info = () => {};
const quiet = !process.env.NETSIM_DEBUG;
// a dropped match's own line ([net] match dropped: why, path, frame) is kept even when quiet, for the failure report
const dropLines = [];
if (quiet) console.warn = (...a) => { const t = a.map(String).join(' '); if (/match dropped/.test(t)) dropLines.push(`t=${Math.round(sched.t / 1000)}s ${t.slice(0, 200)}`); };
const LEGACY = process.argv.includes('--legacy');
// an old link fetches its ICE servers itself
/** @type {any} */ (globalThis).fetch = async () => ({ ok: true, json: async () => ({ iceServers: [{ urls: ['stun:stun.test:3478'] }] }) });
// the label the HUD shows (an old build only had the socket's own flag)
const labelOf = onlineMod.showsReconnecting || ((_s, l) => !!l && !!l.reconnecting);

const CALM = { base: 35, jitter: 10, loss: 0.01 };
// weak-cell ([t6sye7]): one phone on home wifi, the other on a weak cellular signal. Phone to phone that's about
// 2 * (15 + 7 + 70 + 48) = 280 ms of round trip with ~100 ms of jitter (half-normal on each leg, both ways) and 3% loss
const WIFI = { base: 12, jitter: 5, loss: 0.003 };
const WEAK_CELL = { base: 55, jitter: 60, loss: 0.03 };
/** The weak phone's dropouts: 2 to 5 s with no network every 20 to 30 s, all session, in a cycle of five: two short
 *  enough for TCP to hold, one that kills the room socket half-open, one wifi -> cellular switch (everything made on
 *  the old network is dead, then 'change'), and one one-way (nothing this phone sends gets out while it still hears
 *  the other side for a few seconds: the signature of the 2026-11-16 20:11 drop, README, Reconnecting).
 *  r: the session's rng. Returns the plan, starting `from` ms. */
function weakCellPlan(r, from = 12000, until = 40 * 60000) {
  const evs = [];
  let t = from, k = 0;
  while (t < until) {
    const dur = 2000 + r() * 3000, kind = ['survive', 'die', 'oneway', 'switch', 'survive'][k % 5];
    evs.push({ at: t, dur, kind });
    t += dur + 20000 + r() * 10000; k++;
  }
  return evs;
}
const JITTERY = { base: 60, jitter: 200, jitterSwing: 200, loss: 0.05 };
/** @type {Record<string, { legs?: [any, any], relay?: boolean, slow?: boolean, matches?: number, seeds?: number, rehost?: boolean, judgeFrozen?: number, plan?: (r: () => number) => { at: number, dur: number, kind: string }[], setup?: (w: any) => void, events: { at: number, run: (w: any) => void }[], note: string }>} */
const SCENARIOS = {
  'drop-3s':    { note: 'guest loses all network for 3 s (TCP holds)', events: [{ at: 20000, run: (w) => w.dropout(1, 3000, 'survive') }] },
  'drop-10s':   { note: 'guest loses all network for 10 s (its socket dies half-open)', events: [{ at: 20000, run: (w) => w.dropout(1, 10000, 'die') }] },
  'drop-18s':   { note: 'host loses all network for 18 s (its socket dies half-open)', events: [{ at: 20000, run: (w) => w.dropout(0, 18000, 'die') }] },
  'switch':     { note: 'guest: the DataChannel path dies with the socket fine, then 30 s on a new network kills both', events: [{ at: 20000, run: (w) => w.killUdp(1) }, { at: 50000, run: (w) => w.switchNetwork(1) }] },
  'late-p2p':   { note: 'guest has no UDP at first (the match starts on the relay), then it opens 20 s into the match', setup: (w) => w.blockUdp(1, true), events: [{ at: 20000, run: (w) => w.blockUdp(1, false) }] },
  'jitter':     { note: 'guest on 60 ms + 200 to 400 ms jitter, 5% loss, all session', legs: [CALM, JITTERY], events: [] },
  'background': { note: 'guest locks the phone 12 s (iOS: frozen, socket killed), later the host backgrounds 8 s (Android)', events: [{ at: 20000, run: (w) => w.freeze(1, 12000) }, { at: 60000, run: (w) => w.hide(0, 8000) }] },
  // measured, not judged on time: ordered TCP holds every packet behind a lost or late one, so the fight stalls
  // often and takes longer (README, Reconnecting: the relay on a jittery phone)
  // the bar for [t6sye7]: ten matches in a row on 5 seeds, nothing dropped, the fight frozen under 5% of the time
  // outside the dropouts themselves (judgeFrozen), hashes and results agreeing
  'weak-cell': { note: 'guest on weak cellular (~280 ms, ~100 ms jitter, 3% loss) with a 2-5 s dropout every 20-30 s (some half-open, some a network switch); host on wifi; 10 matches', legs: [WIFI, WEAK_CELL], matches: 10, rehost: true, seeds: 5, judgeFrozen: 0.05, plan: (r) => weakCellPlan(r), events: [] },
  // carrier-grade NAT on the weak phone: no direct path at all, and api/ice slow enough on that signal that the first
  // fetch can time out (then the link has public STUN only, which can't reach TURN)
  'turn-cell': { note: 'weak-cell behind a symmetric NAT (no direct path, TURN works) with a slow api/ice; 4 matches', legs: [WIFI, WEAK_CELL], matches: 4, rehost: true, judgeFrozen: 0.05, plan: (r) => weakCellPlan(r), setup: (w) => w.nat(1, 2000), events: [] },
  // the 2026-11-16 20:11 drop: on the relay, the guest's room socket stops delivering what it sends while it keeps
  // hearing the host (a stale carrier NAT mapping), once in each match. Nothing errors, so only a missing pong says so
  'stale-uplink': { note: 'guest on the relay (no UDP); its room socket\'s sends vanish for good while it still hears the host, once a match', legs: [WIFI, WIFI], matches: 2, setup: (w) => w.blockUdp(1, true), events: [{ at: 20000, run: (w) => w.staleUplink(1) }, { at: 110000, run: (w) => w.staleUplink(1) }] },
  'relay-jitter': { note: 'the jitter scenario on the relay (no DataChannel): the lag numbers for the slow path', legs: [CALM, JITTERY], relay: true, slow: true, events: [] },
};

// the frozen measure leaves out each dropout and this much after it (the first packets back are a round trip away)
const DOWN_TAIL_MS = 500;

async function session(name, seed, matchesArg) {
  const sc = SCENARIOS[name];
  const matches = sc.matches || matchesArg;
  resetClock();
  try { if (sc.relay) localStorage.setItem('stick-fight-net', JSON.stringify({ relay: true })); else localStorage.removeItem('stick-fight-net'); } catch { /* */ }
  const r = mulberry32(seed * 2654435761 >>> 0);
  const wire = createWire({ seed, legs: sc.legs || [CALM, CALM], room: LEGACY ? { away: false, seats: false } : { away: true, seats: true } });
  if (sc.setup) sc.setup(wire);
  const network = { createRoom: () => wire.createRoom(), createLink: wire.createLinkWith(createLink) };
  const rules = { roundTime: 30, winsNeeded: 2, upgrades: 'off' };
  const A = createClient({ name: 'host', seed: seed * 2 + 1, network, frames: { fps: 60 }, rules });
  const B = createClient({ name: 'guest', seed: seed * 2 + 2, network, frames: { fps: 60 }, rules });
  const both = [A, B];
  /** @type {[number, number][]} */ const downs = [];
  const inDown = (t) => downs.some(([a, b]) => t >= a && t < b + DOWN_TAIL_MS);
  const m = { events: /** @type {Record<string, number>} */ ({}), outSamples: 0, outFrozen: 0, frozenRuns: /** @type {number[]} */ ([]), rtt: 0, jitter: 0, rttN: 0, turn: 0, waitSamples: 0, samples: 0, p2p: 0, relay: 0, stalled: 0, unlabeled: 0, labeled: 0, maxStall: 0, delay: 0, depth: 0, rejoins: /** @type {Record<string, number>} */ ({}), resyncs: 0, firstStart: 0 };
  const ids = roster().map((c) => c.id);
  const pickRng = mulberry32(seed + 99);
  const seenLinks = new WeakSet();
  let rooms = 0;   // rooms opened this session (a rehost opens another)
  for (const c of both) {
    let pickedFor = '';
    c.net.on('session', (v) => {
      if (v.phase === 'select' && !v.mine.ready && pickedFor !== `${rooms}:${v.n}`) {
        pickedFor = `${rooms}:${v.n}`;
        const id = ids[Math.floor(pickRng() * ids.length)];
        setTimeout(() => { c.net.pick(id, false); setTimeout(() => c.net.pick(id, true), 300 + pickRng() * 1500); }, 400 + pickRng() * 1500);
      }
    });
    c.net.on('start', () => {
      const l = c.net.link;
      if (l && !seenLinks.has(l)) { seenLinks.add(l); l.on('rejoined', ({ who }) => { m.rejoins[who] = (m.rejoins[who] || 0) + 1; }); }
      if (!m.firstStart) {
        m.firstStart = sched.t;
        for (const ev of sc.events) at(sched.t + ev.at, () => ev.run(wire), null, 'net');
        // a plan of dropouts on the guest's phone (weak-cell): each window is left out of the frozen measure
        if (sc.plan) for (const d of sc.plan(mulberry32(seed * 7 + 3))) {
          const t0 = sched.t + d.at;
          downs.push([t0, t0 + d.dur]);
          at(t0, () => {
            m.events[d.kind] = (m.events[d.kind] || 0) + 1;
            if (d.kind === 'oneway') { wire.oneway(1, d.dur); return; }
            if (d.kind === 'switch') wire.switchNetwork(1);
            wire.dropout(1, d.dur, d.kind === 'survive' ? 'survive' : 'die');
          }, null, 'net');
        }
      }
    });
  }
  A.start(0); B.start(7 + r() * 9);
  const hostAt = 2000 + r() * 2000, joinAt = hostAt + 1000 + r() * 2000;
  const open = (t0) => {
    rooms++;
    let code = '';
    at(t0, () => { A.net.host({ pickFirst: true, crew: true }).then((o) => { code = o.code; }); }, A, 'timer');
    at(t0 + (joinAt - hostAt), () => { if (code) B.net.join(code, { pickFirst: true, crew: true }); }, B, 'timer');
  };
  open(hostAt);
  // rehost (weak-cell): a dropped match doesn't end the session. The two players make a new room and play on, as
  // the kids would, so a before number reads as drops per ten matches rather than stopping at the first one
  const bank = { checks: 0, diffs: 0, finished: 0, resultDiffs: 0, endDiverged: 0, drops: 0, why: /** @type {string[]} */ ([]) };
  const settle = () => {
    const e = tally(A, B);
    for (const k of ['checks', 'diffs', 'finished', 'resultDiffs', 'endDiverged']) bank[k] += e[k];
    A.results = {}; B.results = {}; A.confirmed.clear(); B.confirmed.clear();
  };
  if (sc.rehost) {
    const watchDrop = () => {
      if (A.ended || B.ended) {
        bank.drops++; bank.why.push(`${A.ended || '-'}/${B.ended || '-'}`);
        for (const c of both) { try { c.net.leave(); } catch { /* gone */ } }
        settle();
        A.ended = null; B.ended = null;
        open(sched.t + 3000);
      }
      at(sched.t + 200, watchDrop, null, 'net');
    };
    at(hostAt, watchDrop, null, 'net');
  }
  // what the HUD would show, every 100 ms, on each phone that's in a match and on screen
  const sample = () => {
    for (const c of both) {
      if (!c.net.active || c.frozenUntil > sched.t || c.hiddenUntil > sched.t) continue;
      const s = c.net.stats(), l = c.net.link, label = labelOf(s, l);
      m.samples++;
      if (s.mode === 'p2p') m.p2p++; else if (s.mode === 'relay') m.relay++;
      m.delay += s.delay || 0; m.depth += s.lastDepth || 0;
      const waiting = Math.max(s.stalledMs || 0, s.endWaitMs || 0);
      if (waiting > 50) m.waitSamples++;
      if (!inDown(sched.t)) { m.outSamples++; if (waiting > 50) m.outFrozen++; }
      if (s.rtt) { m.rtt += s.rtt; m.jitter += s.jitter || 0; m.rttN++; }
      if (s.mode === 'p2p' && l && l.candidate === 'relay') m.turn++;   // the DataChannel through a TURN server
      if (waiting > 500) { m.stalled++; if (label) m.labeled++; }
      if (waiting > 1500 && (s.lostMs || 0) > 1000 && !label) m.unlabeled++;
      m.maxStall = Math.max(m.maxStall, s.stalledMs || 0);
    }
    at(sched.t + 100, sample, null, 'net');
  };
  at(100, sample, null, 'net');
  for (const c of both) c.net.on('resync', () => { m.resyncs++; });
  const played = () => bank.finished + Math.min(Object.keys(A.results).length, Object.keys(B.results).length);
  const done = () => played() >= matches || (!sc.rehost && (!!A.ended || !!B.ended));
  const limit = joinAt + matches * (sc.slow ? 600000 : 260000);
  await runUntil(limit, done);
  await runUntil(sched.t + 3000);
  const rep = evaluate(name, seed, A, B, matches, m, wire, bank);
  if (!rep.pass) for (const l of dropLines.splice(0)) console.error(`  ${l}`);
  dropLines.length = 0;
  if (!rep.pass || process.env.NETSIM_DEBUG) for (const c of both) {
    const s = c.net.stats();
    console.error(`  [${c.name}] state ${s.state} frame ${s.frame} confirmed ${s.confirmed} stalledMs ${Math.round(s.stalledMs || 0)} lostMs ${Math.round(s.lostMs || 0)} mode ${s.mode} ended ${c.ended} link ${JSON.stringify(c.net.link && c.net.link.debug)}`);
  }
  for (const c of both) { try { c.net.leave(); } catch { /* gone */ } }
  return rep;
}

/** one room's worth: hash checks and finished matches agreeing on both phones */
function tally(A, B) {
  let checks = 0, diffs = 0;
  for (const [k, h] of A.confirmed) { if (!B.confirmed.has(k)) continue; checks++; if (B.confirmed.get(k) !== h) diffs++; }
  let finished = 0, resultDiffs = 0, endDiverged = 0;
  for (const n of new Set([...Object.keys(A.results), ...Object.keys(B.results)].map(Number))) {
    const a = A.results[n], b = B.results[n];
    if (!a || !b) continue;
    finished++;
    if (a.winner !== b.winner || a.wins.join() !== b.wins.join()) resultDiffs++;
    if (a.hash !== b.hash || a.frame !== b.frame) endDiverged++;
  }
  return { checks, diffs, finished, resultDiffs, endDiverged };
}

function evaluate(name, seed, A, B, matches, m, wire, bank) {
  const e = tally(A, B);
  const checks = e.checks + bank.checks, diffs = e.diffs + bank.diffs, finished = e.finished + bank.finished;
  const resultDiffs = e.resultDiffs + bank.resultDiffs, endDiverged = e.endDiverged + bank.endDiverged;
  const dropped = bank.drops + ([A.ended, B.ended].some(Boolean) ? 1 : 0);
  const endedWhy = [...bank.why, ...(A.ended || B.ended ? [`${A.ended || '-'}/${B.ended || '-'}`] : [])];
  const frozenPct = m.outSamples ? m.outFrozen / m.outSamples : 0;
  const frozenOk = !SCENARIOS[name].judgeFrozen || frozenPct < SCENARIOS[name].judgeFrozen;
  const pass = finished >= matches && !dropped && diffs === 0 && !resultDiffs && !endDiverged && m.unlabeled === 0 && frozenOk;
  return {
    name, seed, pass, finished, dropped, ended: endedWhy.join(' ') || '-', checks, diffs, resultDiffs, endDiverged,
    resyncs: m.resyncs, rejoins: m.rejoins, unlabeled: m.unlabeled, labeledPct: m.stalled ? m.labeled / m.stalled : 1,
    maxStall: m.maxStall / 1000, stallPct: m.samples ? m.waitSamples / m.samples : 0, perMatch: finished ? (sched.t - m.firstStart) / 1000 / finished : 0, p2pPct: m.samples ? m.p2p / m.samples : 0, delay: m.samples ? m.delay / m.samples : 0, depth: m.samples ? m.depth / m.samples : 0,
    dials: wire.stats.pcs, away: wire.stats.roomAway, minutes: sched.t / 60000, stunOnly: wire.stats.iceStunOnly,
    frozenPct, frozenOk, rtt: m.rttN ? m.rtt / m.rttN : 0, jitter: m.rttN ? m.jitter / m.rttN : 0, turnPct: m.samples ? m.turn / m.samples : 0, relayPct: m.samples ? m.relay / m.samples : 0, events: m.events,
  };
}

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
if (argv.includes('--list')) { for (const [k, v] of Object.entries(SCENARIOS)) console.log(`${k.padEnd(13)} ${v.note}`); process.exit(0); }
const seedsArg = arg('seeds', ''), matches = +arg('matches', 2), first = +arg('seed', 1), only = arg('only', '');
const names = Object.keys(SCENARIOS).filter((n) => !only || only.split(',').includes(n));
const rows = [];
const t0 = Date.now();
console.log(`handoff: the real link over a fake network${LEGACY ? ' (legacy room)' : ''}; ${matches} best-of-3 matches a session\n`);
for (const name of names) {
  const seeds = seedsArg ? +seedsArg : SCENARIOS[name].seeds || 3;
  for (let s = first; s < first + seeds; s++) {
    const rep = await session(name, s, matches);
    rows.push(rep);
    const rj = Object.entries(rep.rejoins).map(([k, v]) => `${k}:${v}`).join(',') || '-';
    process.stdout.write(`${name.padEnd(13)} seed ${s}  ${(rep.pass ? 'ok' : 'FAIL').padEnd(4)}  matches ${rep.finished}/${matches}  dropped ${rep.dropped} (${rep.ended})  hashes ${String(rep.checks).padStart(4)} differ ${rep.diffs}  resyncs ${rep.resyncs}  ` +
      `max stall ${rep.maxStall.toFixed(1)} s  stalled ${(rep.stallPct * 100).toFixed(1)}%  ${rep.perMatch.toFixed(0)} s/match  RECONNECTING ${(rep.labeledPct * 100).toFixed(0)}% of stalls (${rep.unlabeled} unlabeled)  p2p ${(rep.p2pPct * 100).toFixed(0)}% turn ${(rep.turnPct * 100).toFixed(0)}% relay ${(rep.relayPct * 100).toFixed(0)}%  frozen outside dropouts ${(rep.frozenPct * 100).toFixed(1)}%${rep.frozenOk ? '' : ' (OVER)'}  rtt ${rep.rtt.toFixed(0)} ±${rep.jitter.toFixed(0)}  delay ${rep.delay.toFixed(1)}  rb ${rep.depth.toFixed(1)}  dials ${rep.dials}  away ${rep.away}  rejoins ${rj}${Object.keys(rep.events).length ? '  events ' + Object.entries(rep.events).map(([k, v]) => `${k}:${v}`).join(',') : ''}\n`);
  }
}
const by = {};
for (const r of rows) (by[r.name] = by[r.name] || []).push(r);
console.log('\nscenario       pass  dropped  hash diffs  max stall  stalled  frozen*  s/match  p2p   delay  rb    resyncs  rtt');
for (const [n, rs] of Object.entries(by)) {
  const avg = (k) => rs.reduce((s, r) => s + r[k], 0) / rs.length, sum = (k) => rs.reduce((s, r) => s + r[k], 0);
  console.log(`${n.padEnd(14)} ${String(rs.filter((r) => r.pass).length).padStart(2)}/${rs.length}  ${String(sum('dropped')).padStart(4)}     ${String(sum('diffs')).padStart(4)}       ${Math.max(...rs.map((r) => r.maxStall)).toFixed(1).padStart(5)} s  ${(avg('stallPct') * 100).toFixed(1).padStart(5)}%  ${(avg('frozenPct') * 100).toFixed(1).padStart(5)}%  ${avg('perMatch').toFixed(0).padStart(5)}    ${(avg('p2pPct') * 100).toFixed(0).padStart(3)}%  ${avg('delay').toFixed(1).padStart(4)}  ${avg('depth').toFixed(1).padStart(4)}  ${String(sum('resyncs')).padStart(4)}     ${avg('rtt').toFixed(0)} ±${avg('jitter').toFixed(0)}`);
}
console.log('* frozen: the share of 100 ms samples with the fight waiting on inputs, leaving out each dropout and 0.5 s after it');
const failed = rows.filter((r) => !r.pass).length;
console.log(`\n${rows.length} sessions, ${failed} failed; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(failed ? 1 : 0);
