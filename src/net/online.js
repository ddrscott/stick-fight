// Online play: the session API, the in-match connection readout, and an optional lobby panel.
// The game's menus (src/flow/) own the screens; this module owns the network. main.js makes
// three calls: createOnline(...) once, online.advance(ms) instead of sim.step while a match is
// on, and online.onKey(code) to swallow hotkeys (pause, reset, horde) that would break a match.
//
//   const net = createOnline({ sim, input, startMatch, endMatch })
//   await net.host()            -> { code, url }   a new room; resolves once the room is open
//   await net.join(code)        -> { code }        resolves when connected to the room
//   net.on('status' | 'connected' | 'peer-left' | 'start' | 'end' | 'desync' | 'resync', fn)
//   net.leave()                 hang up and end the match (endMatch is called)
//   net.roomFromUrl()           the room this page was opened for (room/CODE, or an old ?room=CODE), or ''
//   net.openLobby(mode?)        the built-in panel: 'menu' | 'host' | 'join' (+ code)
//   net.active                  a match is running (main.js steps it through net.advance)
//   net.watchers                how many are watching this room ('watching' fires when it changes)
//   net.watchable / net.setWatchable(on)   the host's switch: may anyone watch my quick rooms (kept in localStorage)
//
// Once both players are linked (peer to peer, or the relay after RTC_TIMEOUT_MS), the host
// picks a seed and sends {t:'start', seed, chars, botch, rules}; both call startMatch({ seed, localIndex, lockstep, chars, botch, rules }),
// botch being the host's botch setting (game.botchSetting(), src/combat/botch.js) and rules the host's round time and
// round wins ({ roundTime, winsNeeded }, game.rulesSetting(), src/flow/rules.js), so both sims play the same rules;
// chars being [host's character, guest's character] (each side's pick rides its {t:'ready'} message;
// net.setCharacter(id) sets this side's, TEMP if it never picks),
// which main.js turns into the 'online' scene: unit 0 is the host, unit 1 the guest, each
// unit's controller reads the netcode's input for the frame. (The key is still `lockstep` for
// main.js; the netcode is rollback now, src/net/rollback.js.)
//
// Between matches (the room session). A match ends END_HOLD frames after the frame the sim first
// shows the result, once that frame is confirmed on both sides and both have said so with the same
// state hash ({t:'end', n, f, h}; a disagreement gets the guest the host's state first, see
// src/net/rollback.js, Resync), so both machines stop on the same state and count the same result.
// The link stays up, and the session goes to 'post':
//   - each side sends {t:'post', n, want, focus, poke?}: what it asked for (rematch, chars, wait)
//     and where its cursor is; the guest's want is a request, the host's is the decision
//   - the host runs the countdowns and tells the guest ({t:'cd', n, kind, ms}): 'auto' (5 s from
//     the end of the match: a couch session keeps going; any press on either side stops it),
//     'agree' (3 s: the host picked REMATCH and the guest wants it too or hasn't said; the guest's
//     B or another choice stops it) and 'host' (3 s: the host overrode the guest's request; only the
//     host can stop it). A second REMATCH press from the host starts at once
//   - NEW CHARACTERS from the host is final at once ({t:'go', n}): both go to 'select', send
//     {t:'pick', n, id, ready} as they browse and pick; once both are ready the host's 'agree'
//     countdown runs (or START), and after GRACE_MS of a silent rival the host may start with the
//     rival's current card
//   - the host's {t:'start', seed, chars, botch, n, tally} starts the next match on both (n counts
//     the room's matches and tags every input packet and hash, so nothing from one match lands
//     in the next); {t:'result', n, tally} after each match, and the start's tally, keep the guest's
//     tally equal to the host's (the host's is the one that counts if they ever differ)
//   - {t:'alive'} every ALIVE_MS while between matches; SILENT_MS without a word is a lost link
//
// Testing: ?netsim=LATENCY,JITTER,LOSS delays everything this side sends by LATENCY ms (one way),
// give or take up to JITTER ms, and drops LOSS percent of game packets (control messages ride the
// reliable socket and are only delayed). Set it on both pages: ?netsim=30,5,2 on each is about
// 60 ms of round trip with 2% loss. ?relay=1 forces the relay.

import { ROUND_TIMES, DEFAULT_ROUND_TIME, DEFAULT_BEST_OF, winsFor } from '../flow/rules.js';
import { track, analyticsOn } from '../analytics.js';
import { howEnded } from '../bookkeeping.js';
import { createLink, createRoom } from './link.js';
import { createRollback } from './rollback.js';
import { createWatchFeed } from './watchfeed.js';
import { hashSim } from './hash.js';
import { legend, watchDevice } from '../flow/controls.js';
import { PLAIN } from '../plaintext.js';   // readable text never glows: the shared dark outline
import { linkFromUrl, linkUrl, setLinkInBar } from '../links.js';

export const NET_VERSION = 24;   // bump when the sim or the netcode changes in a way old builds can't play against (24: dashes: a double tap is a forward or a back dash (the 'dash' state, u.dashDir / dashT, the tap count u.tapDir / tapAt / tapN in place of the old tap timer), the input's 12th bit `dash` (the touch stick's double flick), a dash attack on every button and a rising attack on every limb with the rise read out of a crouching attack too (u.lowStance), the 'r' string token and RISE AND SHINE; 23: the clash: two live strikes whose striking limbs touch stop each other with no damage, both bounce back and recover on the same step (u.clashUntil, in the state hash with tradeUntil / tradeLimb), a much heavier strike breaks through and bats the lighter aside (frame data CLASH), and a striking limb on its way is no longer body to another strike; 22: the perfect round finisher, a sim stage inside the KO phase (sim.perfectT, the winner's 'perfect' state, the body thrown at the camera) that only the winner's press skips; 21: getups by the sides (u.home fixed at touchdown, rolls away / toward with a cross under a man standing near, u.roll* fields, rig.rebase and the roll clips), a body on the floor held off to its drawn feet and short of its hip, lows that touch a floored body as its one ground hit and grazes (u.grazeId), the stomp on down+4 only; 'home', 'rollT' and 'otgHit' in the state hash; 20: a fainted fighter is rooted and shakes it off with alternating left/right presses (u.shakeDir, u.shakeAt, u.faintCut, in the state hash), the CPU's faint shake; 19: bodies never sink into the floor: the ground snap and the point simulation use each joint's drawn radius, the stairs' solid line runs through the nosings, tumbling joints stop at the risers, poses on and beside a flight are fitted to its treads, the vault faces the opening; all of it moves the rig's joints, which are the hitboxes and are hashed; 18: stamina refunds on contact and the no-faint save on a connecting strike (u.paid, u.faintPending, u.refundMove/refundRep/refundAt), so an old build's sim drifts from a new one's; 17: resync (the host sends its confirmed state on a hash mismatch), the end of a match agreed by state hash, a character's reach measured on a reset rig (it depended on what the rig was doing the first time that phone saw the character), the rng and the reach table in the state hash; 16: quick rooms from the menus open on the pick screen too (pickFirst, the 'go' at match 0), which an old guest would ignore; 15: the building twice as wide with a stair at each end, walkable both ways (u.stair, slopes on the rig), floor breaks over either rail; 14: the winner's celebration dance; 13: the host's round time and best-of in the start message, 99s rounds, sim.roundClock; 12: getup options, wake-up strikes, the stomp, air recovery, falling attacks, the universal parry; 11: nine more characters, pants, status/stance/invuln/throw-counter hooks; 2: rollback, 3: stamina faint and combo decay, 4: side keeping and knockback away from the attacker, 5: characters, and holding back walks back, 7: botches and happy accidents, the host's botch setting in the start message, 8: the room session: matches end on a confirmed frame, the post-match and pick messages, the match number on packets and hashes, the tally, no mirrored guest, 9: player names in the ready message, and crew matches that open on the pick screen: a 'go' at match 0, 10: no side swaps without motion (the root follows a clip's step, pushbox separation toward each body's own side and capped per step, the grab pulls the victim in), faster stamina regen and a knockdown refill)
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const STORE = 'stick-fight-net';   // localStorage: { relay: true } forces the relay (testing)
const WATCH_KEY = 'stick-fight-watch';   // localStorage: '0' when the host has turned spectators off for their rooms
const PID_KEY = 'stick-fight-pid', RIVALS_KEY = 'stick-fight-rivals';   // this browser's random id, and the all-time record per rival id
const END_HOLD = 150;     // frames of the WINS card after the result shows (the sim's own hold, 216, would reset the match)
const AUTO_MS = 5000, AGREE_MS = 3000, GRACE_MS = 20000, ALIVE_MS = 3000, SILENT_MS = 15000;
// a match that can't go on is dropped as CONNECTION LOST on both sides: stalled (WAITING FOR RIVAL) this long with
// packets still arriving, or at the end this long without the other side agreeing on the final state
const STALL_LOST_MS = 20000, END_WAIT_MS = 15000;
const WANTS = new Set(['rematch', 'chars', 'wait']);

/** this browser's id for the all-time record (random, kept in localStorage; '' when storage is off) */
function myPid() {
  try {
    let id = localStorage.getItem(PID_KEY);
    if (!id || !/^[a-z0-9]{8,16}$/.test(id)) { id = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-4); localStorage.setItem(PID_KEY, id); }
    return id;
  } catch { return ''; }
}
function readRivals() { try { const o = JSON.parse(localStorage.getItem(RIVALS_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } }
/** the all-time record against a rival id: { w, l, d } from this side */
function rivalRecord(pid) { const r = pid ? readRivals()[pid] : null; return r ? { w: r.w | 0, l: r.l | 0, d: r.d | 0 } : null; }
function addRivalResult(pid, res) {
  if (!pid || !/^[a-z0-9]{8,16}$/.test(pid)) return;
  try {
    const all = readRivals(), r = all[pid] || { w: 0, l: 0, d: 0, t: 0 };
    r[res] = (r[res] | 0) + 1; r.t = Date.now(); all[pid] = r;
    const keep = Object.entries(all).sort((a, b) => (b[1].t || 0) - (a[1].t || 0)).slice(0, 30);   // the 30 most recent rivals
    localStorage.setItem(RIVALS_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch { /* storage off */ }
}
export const cleanRules = (r) => ({
  roundTime: r && ROUND_TIMES.includes(r.roundTime) ? r.roundTime : DEFAULT_ROUND_TIME,
  winsNeeded: r && [1, 2, 3].includes(r.winsNeeded) ? r.winsNeeded : winsFor(DEFAULT_BEST_OF),
});
const freshTally = () => ({ host: 0, guest: 0, draw: 0, rounds: [0, 0] });

/**
 * @param {{ sim: any, input: any, startMatch: (o: { seed: number, localIndex: number, lockstep: any, chars?: string[], botch?: boolean, rules?: { roundTime: number, winsNeeded: number } }) => void,
 *           endMatch: (reason: string) => void, stage?: HTMLElement | null, botchSetting?: () => boolean, rulesSetting?: () => { roundTime: number, winsNeeded: number } }} game
 */
export function createOnline(game) {
  /** @type {Record<string, Function[]>} */
  const handlers = {};
  const emit = (ev, ...a) => { for (const f of handlers[ev] || []) { try { f(...a); } catch (e) { console.error(e); } } };
  /** @type {any} */ let link = null;
  /** @type {any} */ let lockstep = null;
  let localReady = false, remoteReady = false, state = 'idle', detail = '', code = '', role = '';
  let localChar = 'temp', remoteChar = 'temp';   // the fighters each side picked (src/characters/)
  // the room session: the match number, the tally, and the between-matches choices (see the top)
  const pid = myPid();
  let n = 0, tally = freshTally(), rivalPid = '', last = /** @type {any} */ (null);
  let mine = { want: /** @type {string|null} */ (null), focus: 'rematch', id: 'temp', ready: false };
  let rival = { want: /** @type {string|null} */ (null), focus: '', id: 'temp', ready: false, at: 0 };
  let cd = /** @type {null | { kind: string, until: number }} */ (null), autoOff = false;
  let pendingResult = /** @type {any} */ (null), pendingGo = false;
  /** @type {any} */ let drain = null;   // the finished match's netcode: keeps sending acks until the next start
  let timer = 0, heardAt = 0, aliveAt = 0;
  // the end of the match: what this side last said ({t:'end'}), the other side's word, and since when we wait
  let endSent = '', rivalEnd = /** @type {null | { n: number, f: number, h: string, e: number }} */ (null), endWait = 0;
  // the player's display name (rides the ready message; the only thing about a player the other sees),
  // and the rival's. A room the menus open (quick or crew) starts on the pick screen
  // (pickFirst: the host's 'go' at match 0 instead of a start; a ?scene= lobby starts at once), and its all-time record is the
  // crew's, kept on the server, so this browser's per-rival record stays out of it
  let myName = '', rivalName = '', pickFirst = false, crewMode = false;
  let matchSeed = 0;   // this match's seed: with the match number it names the match in the result both pages report
  const now = () => performance.now();
  // spectators (watchfeed.js): the host tells the room about each match and, while anyone watches, its confirmed
  // inputs. Quick rooms only: a crew's match never feeds the room
  const feed = createWatchFeed({ now, version: NET_VERSION });
  try { feed.setAllowed(localStorage.getItem(WATCH_KEY) !== '0'); } catch { /* storage off: spectators stay on */ }
  /** @type {null | ((frame: number) => any)} */ let localSource = null;
  const params = new URLSearchParams(location.search);
  const forceRelay = () => params.get('relay') === '1' || net.forceRelay || (() => { try { return !!JSON.parse(localStorage.getItem(STORE) || '{}').relay; } catch { return false; } })();

  function setState(s, d = '') { state = s; detail = d; emit('status', s, d); lobby.render(); }

  const shareUrl = (c) => linkUrl('room', c).href;

  function wire(l) {
    link = l;
    feed.open(typeof l.sendRoom === 'function' ? (d) => l.sendRoom(d) : null, { on: role === 'host' && !crewMode });
    l.on('open', () => feed.hello());
    l.on('watching', (m) => { const was = feed.count; feed.onWatching(m || {}); if (feed.count !== was) { emit('watching', feed.count); readout.render(); } });
    l.on('peer', (present) => {
      if (present) { localReady = false; remoteReady = false; setState('linking'); return; }
      if (lockstep || between()) finish('peer-left');
      else if (state !== 'idle') setState(role === 'host' ? 'waiting' : 'host-gone');
    });
    l.on('status', () => {
      lobby.render();
      if (l.ready && !localReady && !lockstep && !between()) { localReady = true; l.sendControl({ t: 'ready', v: NET_VERSION, char: localChar, pid, name: myName }); maybeStart(); }
    });
    l.on('control', (msg) => {
      heardAt = now();
      if (lockstep && lockstep.onControl(msg)) return;
      if (msg.t === 'hash' || msg.t === 'dump' || msg.t === 'sync' || msg.t === 'resync?') return;   // the match before's, arriving late
      if (msg.t === 'end') {
        // the other side's final state for this match, and how many resyncs it had been through (its epoch)
        if ((msg.n | 0) === n && lockstep) rivalEnd = { n: msg.n | 0, f: msg.f | 0, h: String(msg.h), e: msg.e | 0 };
        return;
      }
      if (msg.t === 'lost') { if (lockstep || between()) finish('lost'); return; }   // the other side gave up on the link
      if (msg.t === 'ready') {
        if (msg.v !== NET_VERSION) { setState('error', 'version'); l.close(); return; }
        remoteChar = typeof msg.char === 'string' ? msg.char : 'temp';
        rivalPid = typeof msg.pid === 'string' ? msg.pid.slice(0, 16) : '';
        rivalName = typeof msg.name === 'string' ? msg.name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().slice(0, 12) : '';
        remoteReady = true; maybeStart();
      } else if (msg.t === 'start' && role === 'guest') {
        const m = (msg.n | 0) || 1;
        if (m <= n) return;   // a start we already played
        if (lockstep) lockstep = null;   // still finishing the match before (a stall): the host has it confirmed, its tally counts
        if (msg.tally) adoptTally(msg.tally);
        begin(msg.seed >>> 0, Array.isArray(msg.chars) ? msg.chars : ['temp', localChar], msg.botch !== false, m, cleanRules(msg.rules));
      } else onSession(msg);
    });
    l.on('packet', (buf) => { heardAt = now(); if (lockstep) lockstep.onPacket(buf); else if (drain) drain.onPacket(buf); });
    l.on('closed', (reason) => {
      if (lockstep || between()) finish(reason === 'closed' ? 'peer-left' : 'lost');
      else if (state !== 'idle') setState('error', reason);
      link = null;
    });
  }

  function maybeStart() {
    if (role !== 'host' || !localReady || !remoteReady || lockstep) return;
    if (pickFirst && n === 0) { if (!between()) toSelect(); return; }   // a crew match: both pick first
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const chars = [localChar, remoteChar];   // the host is P1
    const botch = typeof game.botchSetting === 'function' ? !!game.botchSetting() : true;   // the host's rules for both
    const rules = hostRules();
    link.sendControl({ t: 'start', seed, chars, botch, rules, n: 1, tally });
    begin(seed, chars, botch, 1, rules);
  }

  // the host's round time and round wins (src/flow/rules.js); a guest takes only values it knows
  function hostRules() { return cleanRules(typeof game.rulesSetting === 'function' ? game.rulesSetting() : null); }
  function begin(seed, chars = ['temp', 'temp'], botch = true, m = 1, rules = cleanRules(null)) {
    const localIndex = role === 'host' ? 0 : 1;
    n = m; matchSeed = seed >>> 0; drain = null; stopTimer();
    endSent = ''; rivalEnd = null; endWait = 0;
    localChar = chars[localIndex] || localChar; remoteChar = chars[1 - localIndex] || remoteChar;
    mine = { want: null, focus: 'rematch', id: localChar, ready: false };
    rival = { want: null, focus: '', id: remoteChar, ready: false, at: now() };
    cd = null; autoOff = false; pendingGo = false;
    lockstep = createRollback({
      sim: game.sim, localIndex, link: netsimLink(link, params.get('netsim')), match: m, endHold: END_HOLD,
      sampleLocal: (f) => (localSource ? localSource(f) : game.input.snapshot()),
      onDesync: (d) => { emit('desync', d); readout.render(); },
      onResync: (r) => { emit('resync', r); readout.render(); },
    });
    if (localIndex === 0) feed.begin({ n: m, seed, chars, botch, rules, names: [myName, rivalName], tally: { host: tally.host, guest: tally.guest, draw: tally.draw } }, lockstep);
    lobby.close();
    setState('playing');
    try { game.input.swallowHeld(); } catch { /* old input */ }
    document.documentElement.classList.add('online');
    emit('connected', { mode: link.mode, role, code });
    game.startMatch({ seed, localIndex, lockstep, chars, botch, rules });
    if (localIndex === 0) track('online_match', [chars[0] || '', chars[1] || '', crewMode ? 'crew' : 'quick'], m);   // the host counts it once
    // the live count (api/now): the host tells its room a match is on, with the two fighters and nothing else; the
    // room takes it off when the result comes in or a player leaves (worker/index.ts Lobby)
    if (localIndex === 0 && analyticsOn && link) { try { link.sendControl({ t: 'sys', ev: 'live', chars: [chars[0] || '', chars[1] || ''] }); } catch { /* closing */ } }
    emit('start', { seed, localIndex, chars, botch, n: m, crew: crewMode });
    readout.show(true);
  }

  // ---- the room session: the end of a match, and between matches -------------------------------
  const between = () => state === 'post' || state === 'select';
  /** after each advance: the match is over once the netcode has halted END_HOLD frames past the result, that
   *  frame is confirmed here, and the other side has said it halted there on the same state (the drain keeps
   *  sending our inputs after, for its last frames). Two different ends are a desync: the host's state wins. */
  function checkEnd() {
    const ls = lockstep;
    if (!ls) return;
    const at = ls.matchAt;
    // the other side's word counts against ours only once both have been through the same resyncs (a resync in
    // flight will change one of them)
    const word = rivalEnd && rivalEnd.n === n ? rivalEnd : null, current = !!word && word.e === ls.epoch;
    // the other side halted on a frame this side has confirmed without a result there: the states differ
    if (current && word && (at < 0 || at + END_HOLD !== word.f) && ls.confirmed >= word.f - 1) ls.resync();
    if (at < 0) { endWait = 0; return; }   // no result yet (or one a correction took back)
    const end = at + END_HOLD;
    if (!(ls.frame >= end && ls.confirmed >= end - 1)) { endWait = 0; return; }
    const h = hashSim(game.sim), key = `${end}:${h}:${ls.epoch}`;
    if (key !== endSent) { endSent = key; if (link) link.sendControl({ t: 'end', n, f: end, h, e: ls.epoch }); }
    if (!endWait) endWait = now();
    if (word && word.f === end && word.h === h) { matchOver(); return; }
    if (current) ls.resync();
    if (now() - endWait > END_WAIT_MS) finish('lost');
  }
  function matchOver() {
    const sim = game.sim, ls = lockstep;
    lockstep = null; drain = ls;
    const wins = [sim.wins[0] | 0, sim.wins[1] | 0];
    const winner = wins[0] > wins[1] ? 0 : wins[1] > wins[0] ? 1 : -1;
    if (winner === 0) tally.host++; else if (winner === 1) tally.guest++; else tally.draw++;
    tally.rounds[0] += wins[0]; tally.rounds[1] += wins[1];
    const me = role === 'host' ? 0 : 1;
    if (!crewMode) addRivalResult(rivalPid, winner < 0 ? 'd' : winner === me ? 'w' : 'l');   // a crew keeps its own, on the server
    feed.end({ f: ls ? ls.frame : 0, wins, tally: { host: tally.host, guest: tally.guest, draw: tally.draw } });   // spectators: the last frames, then the result
    last = { n, winner, wins, chars: [(sim.units[0].char && sim.units[0].char.id) || '', (sim.units[1].char && sim.units[1].char.id) || ''], hash: hashSim(sim), frame: ls ? ls.frame : -1,
      secs: ls ? Math.round(Math.max(0, ls.matchAt | 0) / 120) : 0 };   // the match's length (the sim steps at 120 Hz), for the crew's play time
    // the books (README, Analytics): each page tells the room the result, and the room counts it only when the two
    // agree (so a player whose browser asks not to be tracked keeps the match off the books for both). Everything outside x comes from the final state both sims hold; x is this page's own count of the effects
    if (link && ls && analyticsOn) link.sendControl({ t: 'sys', ev: 'result', n, seed: matchSeed, mode: crewMode ? 'crew' : 'quick', chars: last.chars, wins, f: Math.max(0, ls.matchAt | 0), how: howEnded(sim),
      x: typeof game.matchDetail === 'function' ? game.matchDetail() : {} });
    document.documentElement.classList.remove('online');
    readout.show(false);
    mine.want = null; mine.focus = 'rematch';
    setState('post');
    startTimer();
    if (role === 'host') {
      link && link.sendControl({ t: 'result', n, tally, hash: last.hash, f: last.frame });
      if (!autoOff) setCd('auto', AUTO_MS);
    } else if (pendingResult) applyResult();
    emit('match-over', view());
    changed();
    if (pendingGo) { pendingGo = false; toSelect(); }
  }
  function adoptTally(t) {
    if (!t || typeof t !== 'object') return;
    const next = { host: t.host | 0, guest: t.guest | 0, draw: t.draw | 0, rounds: [(t.rounds && t.rounds[0]) | 0, (t.rounds && t.rounds[1]) | 0] };
    if (JSON.stringify(next) !== JSON.stringify(tally)) { if (n > 0 && (tally.host + tally.guest + tally.draw)) console.warn('[net] tally differs from the host\'s; using the host\'s', tally, next); tally = next; }
  }
  function applyResult() {
    const r = pendingResult; pendingResult = null;
    if (!r || r.n !== n) return;
    if (last && r.hash && last.hash !== r.hash && r.f === last.frame) console.warn(`[net] final state differs from the host's at frame ${r.f}`);
    adoptTally(r.tally);
  }
  function setCd(kind, ms) {
    const until = now() + ms;
    cd = cd && cd.until < until && kind === 'agree' && cd.kind === 'auto' ? { kind, until: cd.until } : { kind, until };
    sendCd();
  }
  function cancelCd() { if (!cd) return; cd = null; sendCd(); }
  function sendCd() { if (role === 'host' && link) link.sendControl({ t: 'cd', n, kind: cd ? cd.kind : null, ms: cd ? Math.max(0, Math.round(cd.until - now())) : 0 }); }
  function sendPost(poke = false) { if (link) link.sendControl({ t: 'post', n, want: mine.want, focus: mine.focus, poke }); }
  function sendPick() { if (link) link.sendControl({ t: 'pick', n, id: mine.id, ready: mine.ready }); }
  /** the session messages from the other side (start and ready are handled above) */
  function onSession(msg) {
    if (msg.t === 'alive' || (msg.n | 0) !== n) return;   // another match's (late), or a heartbeat
    if (msg.t === 'post') {
      rival.want = WANTS.has(msg.want) ? msg.want : null;
      rival.focus = typeof msg.focus === 'string' ? msg.focus : '';
      if (role === 'host') hostSees(!!msg.poke);
    } else if (msg.t === 'cd' && role === 'guest') {
      cd = msg.kind ? { kind: String(msg.kind), until: now() + Math.max(0, +msg.ms || 0) } : null;
    } else if (msg.t === 'go' && role === 'guest') {
      if (lockstep) pendingGo = true; else if (state === 'post' || (pickFirst && n === 0 && !between())) toSelect();   // still finishing the match: right after it
    } else if (msg.t === 'pick') {
      rival.id = typeof msg.id === 'string' ? msg.id.slice(0, 32) : rival.id;
      rival.ready = !!msg.ready; rival.at = now();
      remoteChar = rival.id;
      if (role === 'host') hostPicks();
    } else if (msg.t === 'result' && role === 'guest') {
      pendingResult = msg;
      if (between()) applyResult();
    }
    changed();
  }
  /** the host's rules for the guest's post-match choices */
  function hostSees(poke) {
    if (poke || (rival.want && rival.want !== 'rematch')) autoOff = true;
    if (!cd) return;
    if (cd.kind === 'auto' && (poke || (rival.want && rival.want !== 'rematch'))) cancelCd();
    else if (cd.kind === 'agree' && rival.want && rival.want !== 'rematch') { cancelCd(); mine.want = null; sendPost(); }
  }
  function hostPicks() {
    if (state !== 'select') return;
    if (mine.ready && rival.ready) { if (!cd) setCd('agree', AGREE_MS); }
    else cancelCd();
  }
  function toSelect() {
    if (lockstep) return;
    cd = null;
    mine.ready = false; mine.id = localChar;
    rival.ready = false; rival.at = now();
    setState('select');
    if (!timer) startTimer();   // a crew match opens here, before any match: the heartbeat starts now
    if (role === 'host' && link) link.sendControl({ t: 'go', n });
    sendPick();
    changed();
  }
  /** the host starts the next match: a new seed, the picks as they stand, the tally */
  function startNext() {
    if (role !== 'host' || !link || lockstep) return;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const chars = [localChar, remoteChar];
    const botch = typeof game.botchSetting === 'function' ? !!game.botchSetting() : true;
    const m = n + 1, rules = hostRules();
    link.sendControl({ t: 'start', seed, chars, botch, rules, n: m, tally });
    begin(seed, chars, botch, m, rules);
  }
  function startTimer() {
    stopTimer();
    heardAt = now(); aliveAt = 0;
    timer = window.setInterval(() => {
      if (!between()) { stopTimer(); return; }
      const t = now();
      if (drain) drain.keepalive();
      if (t - aliveAt > ALIVE_MS) { aliveAt = t; if (link) link.sendControl({ t: 'alive' }); }
      if (t - heardAt > SILENT_MS) { finish('lost'); return; }
      if (role === 'host' && cd && t >= cd.until) { cd = null; startNext(); }
    }, 100);
  }
  function stopTimer() { if (timer) { clearInterval(timer); timer = 0; } }
  const changed = () => emit('session', view());
  const canStart = () => role === 'host' && state === 'select' && mine.ready && (rival.ready || now() - rival.at > GRACE_MS);
  /** everything the menus show between matches, from this side's point of view */
  function view() {
    const me = role === 'host' ? 0 : 1;
    const you = me === 0 ? tally.host : tally.guest, them = me === 0 ? tally.guest : tally.host;
    return {
      phase: state, role, n, me,
      tally: { you, rival: them, draw: tally.draw, roundsYou: tally.rounds[me], roundsRival: tally.rounds[1 - me], games: tally.host + tally.guest + tally.draw },
      raw: { ...tally, rounds: [...tally.rounds] },
      last: last && { ...last, youWon: last.winner === me, draw: last.winner < 0 },
      mine: { ...mine }, rival: { ...rival, silentMs: now() - rival.at },
      cd: cd ? { kind: cd.kind, left: Math.max(0, cd.until - now()) } : null,
      autoOff, canStart: canStart(), allTime: crewMode ? null : rivalRecord(rivalPid),
      name: myName, rivalName, crew: crewMode,
    };
  }

  function finish(reason) {
    const was = !!lockstep || between();
    if (lockstep && (reason === 'peer-left' || reason === 'lost')) track('online_drop', [reason, crewMode ? 'crew' : 'quick', localChar, remoteChar]);   // a match that never got a result
    lockstep = null; drain = null; stopTimer(); cd = null;
    feed.abort(); feed.close();   // anyone watching sees the match end here too
    if (link) { const l = link; link = null; if (reason === 'lost' && was) { try { l.sendControl({ t: 'lost' }); } catch { /* gone */ } } l.close(); }
    document.documentElement.classList.remove('online');
    readout.show(false);
    clearRoomParam();
    if (reason === 'peer-left') emit('peer-left');
    n = 0; tally = freshTally(); last = null; pendingResult = null;   // the room session is over
    setState('idle');
    if (was) { game.endMatch(reason); emit('end', reason); if (reason !== 'left') lobby.message(reason === 'lost' ? 'CONNECTION LOST' : 'YOUR RIVAL LEFT'); }
  }
  /** in the room: the link that brought us here (room/<CODE> or ?room=) goes, so a reload doesn't rejoin a finished room */
  let fromLink = !!linkFromUrl('room');
  function clearRoomParam() {
    if (!fromLink) return;
    fromLink = false;
    params.delete('room');
    setLinkInBar('room', '');
  }

  const net = {
    forceRelay: false,
    /** this side's fighter (a character id): sent with ready, and where the pick screen opens */
    setCharacter(id) { localChar = String(id || 'temp'); },
    get character() { return localChar; },
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return net; },
    /** this side's display name, sent with ready (the rival's comes back as view().rivalName) */
    setName(s) { myName = String(s || '').slice(0, 12); },
    /** a new room as host: resolves once the room's socket is open. opts.code hosts a room that's
     *  already claimed (a crew opened it); opts.pickFirst opens on the pick screen; opts.crew keeps
     *  this browser's per-rival record out of it */
    async host(opts = {}) {
      net.leave();
      n = 0; tally = freshTally(); last = null; rivalName = '';
      pickFirst = !!opts.pickFirst; crewMode = !!opts.crew;
      role = 'host'; setState('creating');
      try { code = opts.code && CODE_RE.test(opts.code) ? opts.code : await (game.createRoom || createRoom)(); } catch (e) { setState('error', (e && e.reason) || 'unreachable'); throw e; }
      wire((game.createLink || createLink)({ code, role: 'host', forceRelay: forceRelay() }));
      setState('waiting');
      return { code, url: shareUrl(code), link };
    },
    /** join a room by its code */
    async join(c, opts = {}) {
      net.leave();
      n = 0; tally = freshTally(); last = null; rivalName = '';
      pickFirst = !!opts.pickFirst; crewMode = !!opts.crew;
      c = String(c || '').trim().toUpperCase();
      if (!CODE_RE.test(c)) { setState('error', 'bad-code'); throw new Error('bad room code'); }
      role = 'guest'; code = c;
      wire((game.createLink || createLink)({ code, role: 'guest', forceRelay: forceRelay() }));
      setState('joining');
      return { code, link };
    },
    leave() { if (lockstep || link) finish('left'); else if (state !== 'idle') setState('idle'); },
    roomFromUrl() { const r = (fromLink ? linkFromUrl('room') : '').toUpperCase(); return CODE_RE.test(r) ? r : ''; },
    /** while a match runs, main.js steps the sim here (ms already scaled for slow motion) */
    advance(ms) {
      if (!lockstep) return 0;
      const k = lockstep.advance(ms);
      feed.tick(game.sim);   // spectators: note what's confirmed, and send it on if anyone is watching
      // the link is gone, or can't carry this match any more: both sides end it, never two different fights
      if (lockstep && (lockstep.lost || lockstep.broken || lockstep.stalledMs > STALL_LOST_MS)) { finish('lost'); return k; }
      checkEnd();
      readout.tick();
      return k;
    },
    // ---- between matches (the flow's post-match and pick screens) ----
    /** everything the menus show between matches (also handed to 'session' and 'match-over') */
    view,
    /** the tally from this side: { you, rival, draw, roundsYou, roundsRival, games } (also for the fight HUD) */
    get tally() { return view().tally; },
    get match() { return n; },
    /** a post-match button: 'rematch' or 'chars'. The guest's is a request; the host's decides */
    postChoose(c) {
      if (state !== 'post' || (c !== 'rematch' && c !== 'chars')) return;
      mine.want = c; mine.focus = c;
      if (role === 'guest') { sendPost(); changed(); return; }
      autoOff = true;
      if (c === 'chars') { toSelect(); return; }
      if (cd && (cd.kind === 'host' || cd.kind === 'agree')) { cd = null; startNext(); return; }   // pressed again: go now
      setCd(rival.want === 'chars' || rival.want === 'wait' ? 'host' : 'agree', AGREE_MS);
      sendPost(); changed();
    },
    /** back on the post-match screen: the guest asks to wait (stops an 'auto' or 'agree' countdown);
     *  the host stops whatever countdown is running */
    postBack() {
      if (state !== 'post') return;
      autoOff = true;
      if (role === 'guest') { mine.want = 'wait'; sendPost(true); changed(); return; }
      mine.want = null; cancelCd(); sendPost(true); changed();
    },
    /** any other press on the post-match screen: stops the 'auto' countdown */
    postPoke() {
      if (state !== 'post' || autoOff) return;
      autoOff = true;
      if (role === 'guest') sendPost(true); else if (cd && cd.kind === 'auto') cancelCd();
      changed();
    },
    /** where this side's cursor is (shown to the other side) */
    postFocus(c) { if (state !== 'post' || mine.focus === c) return; mine.focus = c; sendPost(); },
    /** the pick screen: this side's card, and whether it's locked in */
    pick(id, ready) {
      if (state !== 'select') return;
      id = String(id || 'temp');
      if (mine.id === id && mine.ready === !!ready) return;
      localChar = id; mine.id = id; mine.ready = !!ready;
      sendPick();
      if (role === 'host') hostPicks();
      changed();
    },
    /** the host's START on the pick screen */
    startNow() { if (canStart()) { cd = null; startNext(); } },
    /** hotkeys during a match: true = swallowed. Escape or P (pad Start or Select, touch LEAVE) asks to
     *  leave: online has no pause, so the menu key opens the LEAVE / STAY confirm instead. */
    onKey(c) {
      if (!lockstep) return false;
      // (not while the panel is up or just closed: the Start that chose STAY mustn't reopen it)
      if (c === 'Escape' || c === 'KeyR' || c === 'KeyP') { if (!lobby.busy) lobby.confirmLeave(); return true; }
      return c !== 'KeyH' && c !== 'F1' && c !== 'Slash';   // hitboxes and the move list are local; nothing else runs
    },
    openLobby(mode = 'menu', c = '') { lobby.open(mode, c); },
    closeLobby() { lobby.close(); },
    /** the lobby panel is up (or just closed): the attract screen shouldn't start a game */
    get busy() { return lobby.busy; },
    get active() { return !!lockstep; },
    /** how many are watching this room (0 in a crew match: nobody can) */
    get watchers() { return feed.count; },
    /** the host's switch: may anyone watch my quick rooms. Kept in localStorage; takes effect at once */
    get watchable() { return feed.allowed; },
    setWatchable(v) { feed.setAllowed(!!v); try { localStorage.setItem(WATCH_KEY, v ? '1' : '0'); } catch { /* storage off: this page only */ } readout.render(); },
    get feed() { return feed; },
    /** between matches in a room (post-match or the pick screen): the link is up, no match running */
    get between() { return between(); },
    get state() { return state; },
    get statusDetail() { return detail; },
    get role() { return role; },
    get code() { return code; },
    get link() { return link; },
    get lockstep() { return lockstep; },   // the netcode (rollback); the old name stays for callers
    get netcode() { return lockstep; },
    shareUrl,
    stats() {
      const s = lockstep ? lockstep.stats() : null;
      return { state, role, code, mode: link ? link.mode : '', endWaitMs: endWait ? now() - endWait : 0, ...(s || {}) };
    },
    // tests: scripted local input, a common stop frame, and the state hash
    setLocalSource(fn) { localSource = fn; },
    haltAt(f) { if (lockstep) lockstep.haltAt = f; },
    hash() { return { frame: lockstep ? lockstep.frame : -1, hash: hashSim(game.sim) }; },
  };

  const readout = createReadout(net, game.stage || document.getElementById('stage'));
  const lobby = createLobby(net, game);
  /** @type {any} */ (window).__net = net;
  return net;
}

// ---- ?netsim=LATENCY,JITTER,LOSS: a bad network on purpose (tests) -----------------------------
// Wraps the link the netcode sends through. Packets and control messages go out LATENCY ms late
// (one way), give or take JITTER ms (so packets can arrive out of order, as they do over the
// unordered DataChannel); LOSS percent of packets never go out. Without the option, the link as is.
function netsimLink(link, spec) {
  if (!spec) return link;
  const [lat = 0, jit = 0, loss = 0] = String(spec).split(',').map((v) => Math.max(0, +v || 0));
  if (!lat && !jit && !loss) return link;
  console.info(`[net] netsim: +${lat} ms one way, ±${jit} ms jitter, ${loss}% packet loss`);
  const later = (fn) => setTimeout(fn, Math.max(0, lat + (Math.random() * 2 - 1) * jit));
  return {
    sendPacket(buf) { if (Math.random() * 100 < loss) return; later(() => link.sendPacket(buf)); },
    sendControl(msg) { later(() => link.sendControl(msg)); },
  };
}

// ---- the connection readout: bottom-left corner during a match --------------------------------
function createReadout(net, stage) {
  injectStyle();
  const el = document.createElement('div');
  el.className = 'nf-readout';
  el.hidden = true;
  el.innerHTML = '<span class="nf-mode"></span> <span class="nf-ping"></span><b class="nf-watch" hidden></b><b class="nf-resync" hidden>RESYNC</b><b class="nf-desync" hidden>DESYNC</b><b class="nf-wait" hidden>WAITING FOR RIVAL</b>';
  (stage || document.body).appendChild(el);
  const mode = el.querySelector('.nf-mode'), ping = el.querySelector('.nf-ping');
  const desync = /** @type {HTMLElement} */ (el.querySelector('.nf-desync')), wait = /** @type {HTMLElement} */ (el.querySelector('.nf-wait'));
  const resync = /** @type {HTMLElement} */ (el.querySelector('.nf-resync'));
  const watch = /** @type {HTMLElement} */ (el.querySelector('.nf-watch'));
  let last = 0;
  const r = {
    show(on) { el.hidden = !on; if (on) r.render(); },
    tick() { const t = performance.now(); if (t - last > 250) { last = t; r.render(); } },
    render() {
      const s = net.stats();
      if (!mode || !ping) return;
      mode.textContent = s.mode === 'p2p' ? 'P2P' : s.mode === 'relay' ? 'RELAY' : '...';
      el.classList.toggle('nf-relay', s.mode === 'relay');
      // the round trip, how many frames the last correction re-ran, and the input delay
      ping.textContent = `${Math.round(s.rtt || 0)} MS · RB ${s.lastDepth || 0} · DELAY ${s.delay || 0}`;
      // a resync just put this side back on the host's state: a brief note. DESYNC only for a mismatch nothing has
      // fixed in 3 s (a resync normally lands in a round trip)
      // the players can see they're being watched
      const w = net.watchers | 0;
      if (watch) { watch.hidden = !w; if (w) watch.textContent = `WATCHING ${w}`; }
      resync.hidden = !(s.sinceResync < 1500);
      desync.hidden = !(s.desync && performance.now() - (s.desync.at || 0) > 3000);
      wait.hidden = !(s.stalledMs > 300 || s.endWaitMs > 300);
    },
  };
  return r;
}

// ---- the lobby panel (optional: the flow's menus can drive net.host/join instead) -----------
function createLobby(net, game) {
  const root = document.createElement('div');
  root.className = 'nf-lobby';
  root.hidden = true;
  document.body.appendChild(root);
  let mode = 'closed', closedAt = -1e9, msg = '', joinCode = '', padPrev = [], padRaf = 0;

  const STATUS = {
    creating: 'OPENING A ROOM…', waiting: 'WAITING FOR A RIVAL…', joining: 'FINDING THE ROOM…', linking: 'CONNECTING…',
    'host-gone': 'THE HOST LEFT THE ROOM',
  };
  const ERRORS = { 'no-room': 'NO ROOM WITH THAT CODE', full: 'THAT ROOM IS FULL', 'bad-code': 'CODES ARE 4 LETTERS', unreachable: 'CAN\'T REACH THE ROOM SERVER', lost: 'CONNECTION LOST', version: 'YOUR GAMES DIFFER: RELOAD BOTH', closed: 'THE ROOM CLOSED', busy: 'SERVER BUSY: TRY AGAIN SHORTLY', flood: 'TOO MUCH TRAFFIC: ROOM CLOSED' };

  function html() {
    const s = net.state;
    if (mode === 'message') return `<h2>${msg}</h2><div class="nf-row"><button data-act="close" class="nf-btn">OK</button></div>`;
    if (mode === 'leave') return `<h2>LEAVE THE MATCH?</h2><div class="nf-row"><button data-act="leave" class="nf-btn nf-pink">LEAVE</button><button data-act="stay" class="nf-btn" data-default>STAY</button></div>`;
    if (mode === 'menu') return `<h2>PLAY ONLINE</h2><div class="nf-col"><button data-act="host" class="nf-btn">HOST A ROOM</button><button data-act="join" class="nf-btn">JOIN A ROOM</button><button data-act="close" class="nf-btn nf-dim">BACK</button></div>`;
    if (s === 'error') {
      return `<h2>${ERRORS[net.statusDetail] || 'SOMETHING WENT WRONG'}</h2><div class="nf-row"><button data-act="menu" class="nf-btn">BACK</button></div>`;
    }
    if (mode === 'join' && (s === 'idle')) {
      return `<h2>JOIN A ROOM</h2><input class="nf-code" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="CODE" value="${joinCode}" aria-label="Room code"><div class="nf-row"><button data-act="go" class="nf-btn">JOIN</button><button data-act="menu" class="nf-btn nf-dim">BACK</button></div>`;
    }
    const link = net.link;
    const how = link && link.mode !== 'connecting' ? (link.mode === 'p2p' ? 'DIRECT LINK' : 'RELAYED LINK') : '';
    const status = `<p class="nf-status">${STATUS[s] || ''}${how ? ' ' + how : ''}</p>`;
    if (net.role === 'host' && net.code) {
      const share = typeof navigator.share === 'function' ? '<button data-act="share" class="nf-btn">SHARE</button>' : '';
      return `<h2>YOUR ROOM</h2><div class="nf-roomcode">${net.code}</div><p class="nf-link">${net.shareUrl(net.code)}</p>${status}<div class="nf-row">${share}<button data-act="copy" class="nf-btn">COPY LINK</button><button data-act="cancel" class="nf-btn nf-dim">CANCEL</button></div>`;
    }
    return `<h2>ROOM ${net.code || ''}</h2>${status}<div class="nf-row"><button data-act="cancel" class="nf-btn nf-dim">CANCEL</button></div>`;
  }

  function render() {
    if (mode === 'closed') return;
    const focusAct = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement.dataset.act || 'code' : '';
    const input = /** @type {HTMLInputElement | null} */ (root.querySelector('.nf-code'));
    if (input) joinCode = input.value;
    root.innerHTML = `<div class="nf-panel" role="dialog" aria-modal="true">${html()}</div>`;
    // the footer legend (src/flow/controls.js): the same keys and buttons as every menu
    const panel = root.querySelector('.nf-panel');
    if (panel) panel.appendChild(legend(mode === 'leave' ? [['move'], ['confirm', 'SELECT'], ['back', 'STAY']] : [['move'], ['confirm', 'SELECT'], ['back', 'BACK']]));
    const again = focusAct === 'code' ? root.querySelector('.nf-code') : focusAct && root.querySelector(`[data-act="${focusAct}"]`);
    // the safe choice first (STAY on the leave confirm), else the first button
    const el = /** @type {HTMLElement | null} */ (again || root.querySelector('.nf-code') || root.querySelector('[data-default]') || root.querySelector('.nf-btn'));
    if (el) el.focus({ preventScroll: true });
  }

  async function act(a) {
    const input = /** @type {HTMLInputElement | null} */ (root.querySelector('.nf-code'));
    if (input) joinCode = input.value;
    if (a === 'close' || a === 'stay') { lobby.close(); return; }
    if (a === 'menu') { net.leave(); mode = 'menu'; render(); return; }
    if (a === 'cancel') { net.leave(); mode = 'menu'; render(); return; }
    if (a === 'leave') { lobby.close(); net.leave(); return; }
    if (a === 'host') { mode = 'host'; render(); net.host().catch(() => {}); return; }
    if (a === 'join') { mode = 'join'; render(); return; }
    if (a === 'go') { mode = 'join'; net.join(joinCode).catch(() => {}); render(); return; }
    if (a === 'copy') {
      try { await navigator.clipboard.writeText(net.shareUrl(net.code)); flash('COPIED'); } catch { flash('COPY FAILED'); }
      return;
    }
    if (a === 'share') {
      try { await navigator.share({ title: 'Neon Stick Fight', text: `Fight me online, room ${net.code}`, url: net.shareUrl(net.code) }); } catch { /* dismissed */ }
    }
  }
  function flash(text) {
    const b = root.querySelector('[data-act="copy"]');
    if (b) { b.textContent = text; setTimeout(() => { if (b.isConnected) b.textContent = 'COPY LINK'; }, 1200); }
  }

  root.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-act]') : null;
    if (b instanceof HTMLElement) act(b.dataset.act || '');
  });
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement) { const p = t.selectionStart; t.value = t.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); t.setSelectionRange(p, p); joinCode = t.value; }
  });
  // keyboard: arrows move between buttons, Enter or Space presses, Escape or Backspace backs out
  // (capture phase, so the game's own key handling never sees these while the panel is up). A held
  // key's repeats are ignored, so the Escape that opened the confirm can't also close it.
  window.addEventListener('keydown', (e) => {
    if (mode === 'closed') return;
    e.stopImmediatePropagation();
    if (e.repeat && !/^Arrow/.test(e.code)) { e.preventDefault(); return; }
    if (e.code === 'Escape' || (e.code === 'Backspace' && !(document.activeElement instanceof HTMLInputElement))) { e.preventDefault(); back(); }
    else if (e.code === 'Enter' && document.activeElement instanceof HTMLInputElement) { e.preventDefault(); act('go'); }
    else if (/^Arrow(Up|Down|Left|Right)$/.test(e.code) && !(document.activeElement instanceof HTMLInputElement && /Left|Right/.test(e.code))) { e.preventDefault(); move(/Up|Left/.test(e.code) ? -1 : 1); }
  }, true);
  window.addEventListener('keyup', (e) => { if (mode !== 'closed') e.stopImmediatePropagation(); }, true);
  // taps on the panel are the panel's: the attract screen behind it must not start a game
  for (const t of ['pointerdown', 'touchstart']) window.addEventListener(t, (e) => { if (lobby.busy) e.stopImmediatePropagation(); }, { capture: true, passive: true });

  function back() {
    if (mode === 'leave' || mode === 'message' || (mode === 'menu' && net.state === 'idle')) { lobby.close(); return; }
    act(mode === 'menu' || mode === 'join' && net.state === 'idle' ? 'close' : 'cancel');
  }
  function focusables() { return /** @type {HTMLElement[]} */ ([...root.querySelectorAll('.nf-code, .nf-btn')]); }
  function move(d) {
    const f = focusables(); if (!f.length) return;
    const i = f.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    f[(i + d + f.length) % f.length].focus();
  }
  // gamepad: D-pad or stick moves, A presses, B or Select backs out (STAY on the leave confirm), Start
  // is STAY there and A anywhere else; on the code box, up/down turn the letter
  const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let caret = 0, stickHeld = 0;
  function poll() {
    padRaf = requestAnimationFrame(poll);
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const g = pads.find(p => p && p.mapping === 'standard') || pads[0];
    if (!g) return;
    const down = g.buttons.map(b => b.pressed || b.value > 0.5);
    const ay = g.axes[1] || 0, ax = g.axes[0] || 0;
    const dir = down[12] || ay < -0.6 ? 'up' : down[13] || ay > 0.6 ? 'down' : down[14] || ax < -0.6 ? 'left' : down[15] || ax > 0.6 ? 'right' : '';
    const was = padPrev;   // the last poll's buttons (padPrev is overwritten below, so edge() can't read it)
    const edge = (i) => down[i] && !was[i];
    const stickEdge = dir && stickHeld === 0;
    stickHeld = dir ? stickHeld + 1 : 0;
    if (stickHeld > 18) stickHeld = 0;   // held: repeat
    padPrev = down;
    if (mode === 'closed') return;
    const input = document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
    const press = () => { if (input) act('go'); else if (document.activeElement instanceof HTMLElement && root.contains(document.activeElement)) document.activeElement.click(); };
    if (edge(0)) press();
    else if (edge(1) || edge(8)) back();
    else if (edge(9)) { if (mode === 'leave') lobby.close(); else press(); }
    else if (stickEdge) {
      if (input && (dir === 'up' || dir === 'down')) {
        const v = input.value.padEnd(caret + 1, 'A').split('');
        const k = ALPHA.indexOf(v[caret]);
        v[caret] = ALPHA[(k + (dir === 'up' ? 1 : -1) + ALPHA.length) % ALPHA.length];
        input.value = v.join('').slice(0, 4); joinCode = input.value; input.setSelectionRange(caret, caret + 1);
      } else if (input && (dir === 'left' || dir === 'right')) {
        if (dir === 'right' && caret >= 3) move(1);
        else { caret = Math.max(0, Math.min(3, caret + (dir === 'right' ? 1 : -1))); input.setSelectionRange(caret, caret + 1); }
      } else move(dir === 'up' || dir === 'left' ? -1 : 1);
    }
  }

  const lobby = {
    render,
    open(m = 'menu', c = '') {
      watchDevice();
      mode = m === 'host' ? 'host' : m === 'join' ? 'join' : m;
      root.hidden = false;
      if (c) joinCode = String(c).toUpperCase();
      render();
      if (!padRaf) {
        // what's held now (the Start or Select that opened it) waits to be let go before it counts
        const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
        const g = pads.find(p => p && p.mapping === 'standard') || pads[0];
        padPrev = g ? g.buttons.map(b => b.pressed || b.value > 0.5) : [];
        padRaf = requestAnimationFrame(poll);
      }
      if (mode === 'host' && net.state === 'idle') net.host().catch(() => {});
      if (mode === 'join' && c) net.join(c).catch(() => {});
    },
    close() {
      if (mode === 'closed') return;
      mode = 'closed'; root.hidden = true; root.innerHTML = ''; closedAt = performance.now();
      cancelAnimationFrame(padRaf); padRaf = 0;
      // back to the match (STAY): the A or Enter that chose it doesn't also throw a kick
      if (net.active) { try { game.input.swallowHeld(); } catch { /* old input */ } }
    },
    message(text) { msg = text; lobby.open('message'); },
    confirmLeave() { lobby.open('leave'); },
    get busy() { return mode !== 'closed' || performance.now() - closedAt < 300; },
  };
  return lobby;
}

let styled = false;
function injectStyle() {
  if (styled) return;
  styled = true;
  const css = `
  .nf-lobby { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center;
    background: rgba(7,2,15,0.55); font-family: 'Teko', 'Arial Narrow', system-ui, sans-serif;
    --pink: #ff2bd6; --cyan: #2ef2ff; --amber: #ffb02e; --violet: #a66bff; --ink: #fff4fd;
    /* everything in the panel is read (a question, a code, a status), so none of it glows: README, "The look" */
    --plain: ${PLAIN}; text-shadow: var(--plain); }
  .nf-lobby[hidden] { display: none; }
  .nf-panel { min-width: min(420px, 86vw); max-width: 92vw; max-height: 92vh; max-height: 92dvh; overflow: auto; box-sizing: border-box;
    padding: clamp(12px, 3vmin, 26px) clamp(16px, 4vmin, 34px); text-align: center; color: var(--ink);
    background: rgba(14,4,30,0.9); border: 2px solid var(--cyan); border-radius: 2px;
    box-shadow: 0 0 18px rgba(46,242,255,0.55), inset 0 0 22px rgba(46,242,255,0.12); }
  .nf-panel h2 { margin: 0 0 clamp(8px, 2vmin, 16px); font: 400 clamp(20px, 5vmin, 34px)/1.05 'Bungee', 'Arial Black', Impact, sans-serif;
    color: #ffc2f3; letter-spacing: 0.02em; }
  .nf-roomcode { font: 400 clamp(40px, 13vmin, 84px)/1 'Bungee', 'Arial Black', Impact, sans-serif; letter-spacing: 0.12em;
    color: #ffe0a8; margin: 0 0 4px; user-select: all; -webkit-user-select: all; }
  .nf-link { margin: 0 0 4px; font: 500 clamp(15px, 3.4vmin, 20px)/1.1 'Teko', sans-serif; color: rgba(214,190,255,0.85);
    letter-spacing: 0.04em; word-break: break-all; user-select: all; -webkit-user-select: all; }
  .nf-status { margin: 4px 0 clamp(8px, 2vmin, 14px); font: 600 clamp(18px, 4vmin, 24px)/1 'Teko', sans-serif; letter-spacing: 0.1em;
    color: #9df8ff; animation: nf-blink 1.1s steps(1) infinite; }
  @keyframes nf-blink { 70% { opacity: 0.35; } }
  .nf-panel { position: relative; padding-bottom: clamp(40px, 9vmin, 56px); }
  .nf-panel .lg-bar { --lg-size: clamp(13px, 2.6vmin, 18px); bottom: clamp(10px, 2.2vmin, 16px); gap: 1.2em; max-width: calc(100% - 16px); }   /* (at the legend's usual 2.4em gaps, LEAVE / STAY's three actions ran past both sides of the panel) */
  .nf-row, .nf-col { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
  .nf-col { flex-direction: column; align-items: stretch; }
  .nf-btn { --c: var(--cyan); appearance: none; cursor: pointer; min-height: 44px; padding: 6px 18px; border-radius: 2px;
    border: 2px solid var(--c); background: rgba(14,4,30,0.6); color: color-mix(in srgb, var(--c) 70%, #fff);
    font: 400 clamp(14px, 3.4vmin, 19px)/1 'Bungee', 'Arial Black', Impact, sans-serif; letter-spacing: 0.03em;
    text-shadow: var(--plain); box-shadow: 0 0 10px color-mix(in srgb, var(--c) 60%, transparent), inset 0 0 8px color-mix(in srgb, var(--c) 30%, transparent);
    touch-action: manipulation; }
  .nf-btn.nf-pink { --c: var(--pink); } .nf-btn.nf-dim { --c: var(--violet); }
  .nf-btn:hover, .nf-btn:focus-visible, .nf-btn:focus { outline: none; background: var(--c); color: #12041f; text-shadow: none;
    box-shadow: 0 0 20px var(--c), 0 0 40px color-mix(in srgb, var(--c) 45%, transparent); }
  .nf-code { display: block; box-sizing: border-box; width: 100%; max-width: 300px; margin: 0 auto clamp(10px, 2.4vmin, 16px); padding: 4px 0 0;
    text-align: center; font: 400 clamp(36px, 11vmin, 64px)/1.1 'Bungee', 'Arial Black', Impact, sans-serif; letter-spacing: 0.25em; text-indent: 0.25em;
    text-transform: uppercase; color: #ffe0a8; caret-color: var(--amber); background: rgba(7,2,15,0.7);
    border: 2px solid var(--amber); border-radius: 2px; box-shadow: 0 0 12px rgba(255,176,46,0.5); }
  .nf-code::placeholder { color: rgba(255,176,46,0.3); }
  .nf-code:focus { outline: none; box-shadow: 0 0 20px rgba(255,176,46,0.85); }
  .nf-readout { position: absolute; left: 2.4%; bottom: 2%; z-index: 5; pointer-events: none;
    font: 500 clamp(12px, 1.6vw, 18px)/1 'Teko', 'Arial Narrow', sans-serif; letter-spacing: 0.1em; color: #b9f9ff;
    text-shadow: ${PLAIN}; display: flex; gap: 0.6em; align-items: baseline; white-space: nowrap; }
  .nf-readout[hidden] { display: none; }
  .nf-readout.nf-relay { color: #ffe0a8; }
  .nf-readout b { font-weight: 600; }
  .nf-desync { color: #ffc2f3; }
  .nf-resync { color: #ffe0a8; }
  .nf-wait { color: #fff4fd; animation: nf-blink 1.1s steps(1) infinite; }
  .nf-watch { color: #ffe0a8; text-shadow: 0 0 2px #000; }   /* readable text never glows */
  html.touch-ui .nf-readout { bottom: auto; top: calc(var(--nf-top, 74px)); left: 50%; transform: translateX(-50%); }
  /* online: no horde toggle on the touch layer */
  html.online .tc-top [data-tap="KeyG"] { display: none; }`;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
}
