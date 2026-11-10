// The room's side of spectating (README, Multiplayer, Spectators): what the quick room's Durable Object
// (worker/index.ts Room) does with the host's {t:'watch'} messages and input batches, and with spectator
// sockets. It lives here, as plain code over a few callbacks, so the Node proof (scripts/netsim/watch.mjs)
// runs the very same room the Worker does.
//
//   const desk = createWatchRoom({ players, spectators, kick, list, unlist })
//     players(text)        send a notice to both players' sockets
//     spectators(except?)  the open spectator sockets (anything with send(data))
//     kick(reason)         close every spectator socket
//     list(entry)          put the match in the LIVE list (or refresh it); unlist() takes it out
//   desk.priv / desk.off   a crew's match room (never watchable) / the host's off switch
//   desk.refusal(n)        why a spectator can't come in, '' if they can (n: how many are in already)
//   desk.join(sock)        a spectator came in: the welcome, the match so far, then the count to everyone
//   desk.count(except?)    the number watching changed
//   desk.onWatch(text)     a {t:'watch'} message from the host; returns { off } when the switch changed
//   desk.onBatch(buf)      a batch of confirmed inputs from the host
//   desk.onSync(text)      the host's resync on its way to the guest: spectators get it too
//   desk.stop(reason, close?, unlist?)  the match is over for spectators (a player left; with close, the room emptied)
//
// Everything is in memory. A room that forgets (a restart) answers the host's next message with what it
// needs, and the host sends the match again from frame 0.

import { createLog, decodeBatch, cleanSetup, MAX_SPECTATORS } from './watchlog.js';

const LIST_GAP_MS = 10000;

/**
 * @param {{ players: (text: string) => void, spectators: (except?: any) => { send(data: string | ArrayBuffer): void }[],
 *   kick: (reason: string) => void, list: (e: any) => void, unlist: () => void, now?: () => number }} io
 */
export function createWatchRoom(io) {
  const now = io.now || (() => Date.now());
  /** the match being played, as the host told it: the setup, the confirmed inputs so far, when it started, and
   *  the host's last resync (its state as text, which a spectator loads at that frame like the guest did)
   *  @type {null | { setup: NonNullable<ReturnType<typeof cleanSetup>>, log: ReturnType<typeof createLog>, at: number, sync: null | { id: string, parts: string[] } }} */
  let m = null;
  const toAll = (msg, except) => { for (const w of io.spectators(except)) { try { w.send(msg); } catch { /* closing */ } } };
  /** to the players: how many are watching, which match the room knows (0: none, send its setup) and the next
   *  frame it wants (-1: nobody is watching, send nothing) */
  const note = (n) => JSON.stringify({ t: 'sys', ev: 'watching', n, have: m ? m.setup.n : 0, need: n > 0 ? (m ? m.log.frames : 0) : -1 });
  const tellPlayers = (n = io.spectators().length) => io.players(note(n));
  // the LIVE list hears about a new match and a new round at once, and about people coming and going at most
  // every LIST_GAP_MS (the next batch or score carries a change that was held back)
  let listedAt = -1e12, dirty = false;
  function list(force = true, n = io.spectators().length) {
    if (!m || desk.priv || desk.off) return;
    const t = now();
    if (!force && t - listedAt < LIST_GAP_MS) { dirty = true; return; }
    listedAt = t; dirty = false;
    const s = m.setup;
    io.list({ n: s.n, chars: s.chars, names: s.names, round: s.round, wins: s.wins, tally: s.tally, watching: n, at: m.at });
  }

  const desk = {
    priv: false, off: false,
    get match() { return m; },
    /** the notice a player gets when they come in while people are watching */
    note,
    refusal(n) { return desk.priv ? 'no-room' : desk.off ? 'off' : n >= MAX_SPECTATORS ? 'watch-full' : ''; },
    join(sock) {
      sock.send(JSON.stringify({ t: 'sys', ev: 'welcome', role: 'spectator', watching: io.spectators().length }));
      if (m) {
        // the match so far: its setup, the frames already old enough to show, and the host's last resync
        sock.send(JSON.stringify({ t: 'w', ev: 'start', ...m.setup }));
        for (const b of m.log.backlog()) sock.send(b);
        if (m.sync) for (const p of m.sync.parts) if (p) sock.send(p);
      } else sock.send(JSON.stringify({ t: 'w', ev: 'idle' }));
      desk.count();
    },
    /** the count changed: the players' WATCHING readout, the spectators' own, and the LIVE list */
    count(except) {
      const n = io.spectators(except).length;
      tellPlayers(n);
      toAll(JSON.stringify({ t: 'w', ev: 'count', n }), except);
      list(n === 0, n);   // (the last one leaving is told at once: no batch follows to carry it)
    },
    stop(reason, close = false, unlist = false) {
      if (m) { m = null; io.unlist(); toAll(JSON.stringify({ t: 'w', ev: 'over', reason })); }
      else if (unlist && !desk.priv) io.unlist();
      if (close) io.kick(reason);
    },
    onWatch(text) {
      let msg;
      try { msg = JSON.parse(text); } catch { return null; }
      if (desk.priv || !msg || typeof msg !== 'object') return null;
      if (msg.ev === 'allow') {
        const off = msg.on === false;
        if (off === desk.off) return null;
        desk.off = off;
        if (off) { desk.stop('off', true); io.unlist(); } else tellPlayers();   // back on: the host's answer is the match's setup
        return { off };
      }
      if (desk.off) return null;
      if (msg.ev === 'start') {
        const setup = cleanSetup(msg);
        if (!setup) return null;
        // (the same match again: the room forgot it, or the host turned spectating back on)
        m = { setup, log: createLog(setup.n & 255), at: m && m.setup.n === setup.n ? m.at : now(), sync: null };
        toAll(JSON.stringify({ t: 'w', ev: 'start', ...setup }));
        list();
        tellPlayers();
        return null;
      }
      const n = Number(msg.n) | 0;
      if (!m || m.setup.n !== n) { if (msg.ev === 'score') tellPlayers(); return null; }   // a match the room doesn't know: ask for it
      if (msg.ev === 'score') {
        const s = cleanSetup({ ...m.setup, round: msg.round, wins: msg.wins });
        if (s) { m.setup.round = s.round; m.setup.wins = s.wins; }
        list();
      } else if (msg.ev === 'end') {
        // the match ended on frame f: everything held goes out now, then the result
        const f = Number(msg.f) | 0, s = cleanSetup({ ...m.setup, wins: msg.wins, tally: msg.tally });
        const whole = m.log.frames >= f;
        for (const b of m.log.release(true)) toAll(b);
        m = null; io.unlist();
        if (whole && s) toAll(JSON.stringify({ t: 'w', ev: 'end', n, f, wins: s.wins, winner: s.wins[0] > s.wins[1] ? 0 : s.wins[1] > s.wins[0] ? 1 : -1, tally: s.tally }));
        else toAll(JSON.stringify({ t: 'w', ev: 'over', reason: 'ended' }));
      } else if (msg.ev === 'over') desk.stop('left');
      return null;
    },
    /** into the log, and the frames now old enough out to spectators */
    onBatch(buf) {
      const b = decodeBatch(buf);
      if (!b) return;
      if (!m || (m.setup.n & 255) !== b.match || !m.log.add(b)) { tellPlayers(); return; }   // not what the room has: say what it needs
      for (const out of m.log.release()) toAll(out);
      if (dirty) list(false);
    },
    onSync(text) {
      if (!m) return;
      let p;
      try { p = JSON.parse(text); } catch { return; }
      const id = String(p.id), i = Number(p.i) | 0, of = Number(p.of) | 0;
      if ((Number(p.m) | 0) !== (m.setup.n & 255) || of < 1 || of > 64 || i < 0 || i >= of) return;
      if (!m.sync || m.sync.id !== id) m.sync = { id, parts: new Array(of) };
      m.sync.parts[i] = text;
      toAll(text);
    },
  };
  return desk;
}
