// The host's side of spectating (README, Multiplayer, Spectators). A match runs peer to peer, so the room
// never sees its inputs; the host tells it what a spectator needs, over the room socket it already has:
//
//   {t:'watch', ev:'start', n, v, seed, chars, botch, rules, names, tally, round, wins}   a match began (always: the LIVE list)
//   {t:'watch', ev:'score', n, round, wins}     a round ended, and once a minute so the LIVE list keeps the match
//   a batch (watchlog.js)                         the inputs both machines have confirmed, stamped with this side's
//                                                 clock, every UPLOAD_MS, only while the room says someone is watching
//   {t:'watch', ev:'end', n, f, wins, tally}    the match ended on frame f (the rest of the inputs go first)
//   {t:'watch', ev:'over', n}                   the match was dropped (a player left, the link died)
//   {t:'watch', ev:'allow', on}                 the host's switch: off closes the room to spectators
//
// The room answers {t:'sys', ev:'watching', n, have, need}: how many are watching, the match it knows (if not
// this one, it gets the start again) and the next frame it wants (-1: nobody is watching, send nothing).
// This side keeps the whole match's confirmed inputs (4 bytes a frame), so a room that has nothing yet, the
// first spectator arriving mid-match or a room that restarted, gets the match from frame 0 in one go.
//
// Cost on the host: each frame, two array writes per newly confirmed frame; every UPLOAD_MS while watched, one
// message of about 200 bytes. Nothing here touches the sim or the netcode's timing.

import { createLog, hashNum } from './watchlog.js';

export const UPLOAD_MS = 500; // a stamp this often, and with it a batch while watched (60 frames, about 250 bytes)
const LIVE_MS = 60000;        // the score again this often, so the LIVE list knows the match is still on
const HASH_EVERY = 30;        // rollback.js hashes every 30th frame

/** @param {{ now: () => number, version: number }} o */
export function createWatchFeed({ now, version }) {
  /** @type {null | ((data: string | ArrayBuffer) => void)} */ let send = null;
  let on = false;            // this side feeds the room: the host of a quick room (never a crew's match)
  let allowed = true;        // the host's switch
  /** @type {any} */ let setup = null;
  /** @type {any} */ let log = null;
  /** @type {any} */ let ls = null;
  let sent = 0;              // the next frame the room needs
  let wanted = false, count = 0;
  let t0 = 0, lastMark = -1e9, lastLive = -1e9, score = '';
  const stats = { batches: 0, bytes: 0, ms: 0, ticks: 0 };

  const say = (o) => { if (send && on && allowed) { try { send(JSON.stringify(o)); } catch { /* socket closing */ } } };
  function sendStart(sim) {
    if (!setup) return;
    if (sim) { setup.round = sim.round | 0 || 1; setup.wins = [sim.wins[0] | 0, sim.wins[1] | 0]; }
    say({ t: 'watch', ev: 'start', ...setup });   // (t first: the room knows its own messages by how they begin)
    lastLive = now();
  }
  /** the frames confirmed since the last look go in the log (with the host's hash on every 30th) */
  function collect() {
    if (!ls || !log) return;
    const top = ls.confirmed;
    for (let f = log.frames; f <= top; f++) {
      const a = ls.input(0, f), b = ls.input(1, f);
      if (a < 0 || b < 0) { feed.abort(); return; }   // out of the netcode's history (never: this runs every frame)
      log.push(a, b);
      if ((f + 1) % HASH_EVERY === 0) { const h = ls.hashes.get(f); if (h != null) log.hash(f, hashNum(h)); }
    }
  }
  /** stamp what's confirmed with the host's clock (ms into the match): the room's hold and a spectator's pace go by it */
  function mark() { if (log) { lastMark = now(); log.mark(Math.max(1, Math.round(lastMark - t0))); } }
  function upload() {
    if (!log || !send || !on || !allowed) return;
    for (const b of log.since(sent)) { try { send(b); } catch { return; } stats.batches++; stats.bytes += b.byteLength; }
    sent = log.marked;   // (frames confirmed since the last stamp go with the next one)
  }

  const feed = {
    /** the room's socket is there. opts.on: this side is the host of a room that may be watched */
    open(sendFn, opts = {}) { send = sendFn; on = !!opts.on; count = 0; wanted = false; setup = null; log = null; ls = null; },
    /** the socket opened: an off switch goes first, before any match */
    hello() { if (send && on && !allowed) { try { send(JSON.stringify({ t: 'watch', ev: 'allow', on: false })); } catch { /* closing */ } } },
    close() { send = null; on = false; setup = null; log = null; ls = null; count = 0; wanted = false; },
    /** a match starts: s is { n, seed, chars, botch, rules, names, tally }, netcode the rollback session */
    begin(s, netcode) {
      if (!on) return;
      setup = { ...s, v: version, round: 1, wins: [0, 0] };
      log = createLog(s.n & 255); ls = netcode; sent = 0; score = '1:0:0'; t0 = now(); lastMark = t0;
      sendStart(null);
    },
    /** every frame of a match, after the netcode advanced */
    tick(sim) {
      if (!ls) return;
      const t0 = performance.now();
      collect();
      if (!ls) return;
      const t = now(), sc = `${sim.round}:${sim.wins[0]}:${sim.wins[1]}`;
      if (sc !== score || t - lastLive > LIVE_MS) { score = sc; lastLive = t; setup.round = sim.round | 0; setup.wins = [sim.wins[0] | 0, sim.wins[1] | 0]; say({ t: 'watch', ev: 'score', n: setup.n, round: sim.round | 0, wins: [sim.wins[0] | 0, sim.wins[1] | 0] }); }
      if (t - lastMark >= UPLOAD_MS) { mark(); if (wanted) upload(); }
      stats.ms += performance.now() - t0; stats.ticks++;
    },
    /** the match ended on frame f on both machines */
    end({ f, wins, tally }) {
      if (!ls) return;
      collect();
      if (!ls) return;
      mark();
      if (wanted) upload();
      say({ t: 'watch', ev: 'end', n: setup.n, f, wins, tally });
      setup = null; log = null; ls = null;
    },
    /** the match was dropped */
    abort() {
      if (!setup) return;
      say({ t: 'watch', ev: 'over', n: setup.n });
      setup = null; log = null; ls = null;
    },
    /** the room's word on who's watching and what it needs */
    onWatching(msg) {
      count = Math.max(0, msg.n | 0);
      wanted = (msg.need | 0) >= 0;
      if (!on || !setup || !allowed) return;
      if ((msg.have | 0) !== setup.n) { sent = 0; sendStart(null); return; }   // the room doesn't know this match: its answer says what to send
      if (wanted) { sent = Math.min(msg.need | 0, log.marked); upload(); }   // (what's stamped so far; the rest follows at the next stamp)
    },
    /** the host's switch */
    setAllowed(v) {
      v = !!v;
      if (v === allowed) return;
      allowed = v;
      if (!send || !on) return;
      try { send(JSON.stringify({ t: 'watch', ev: 'allow', on: v })); } catch { /* closing */ }
      if (v && setup) { sent = 0; sendStart(null); } else if (!v) { count = 0; wanted = false; }
    },
    get allowed() { return allowed; },
    /** how many are watching this room */
    get count() { return count; },
    get stats() { return { ...stats, frames: log ? log.frames : 0, sent }; },
  };
  return feed;
}
