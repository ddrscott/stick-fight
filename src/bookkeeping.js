// Match bookkeeping, the page's side (README, "Analytics"): counts what happens in one match from the
// sim's events and, when the match ends, sends it. No player id, name or email: fighters, modes and counts.
//
//   arcade   one `match` event per stage fought (player's fighter, the CPU's, rounds, length, how it ended)
//   horde    one `match` event per run
//   online   the result goes to the room over its WebSocket and counts only if both pages agree
//            (src/net/online.js matchOver, worker/stats.ts); this module only hands over the details
//   every mode: one `move` event per unique move the local player used (how often, and how often it landed)
//
// A match cut short still counts (cut: a restart, the menu, the demo or attract timeout, a new match, the tab
// closing), once, as it stands: a horde run exactly as if the hero had gone down (floors, hits, combo, length), an
// arcade stage with quit: 1 (its length and the rounds finished; the Worker leaves it out of the matchups, so a
// quit is never a loss), online only the move counts (the room times the match itself, worker/stats.ts). Less
// than MIN_FIGHT_SECS of fighting since the first FIGHT counts for nothing. A hidden tab keeps its match in
// localStorage (hide), which the next page load sends if the page was killed there (sendLeftovers); a page that
// comes back carries on, so nothing is sent twice. High scores don't go through here at all: a quit run never
// reaches the initials screen, so it never lands on a board.
//
// The career (README, Progression; src/career/store.js) hears every match that closes, finished or cut short, through
// opts.onClose: a summary of the local player's technique (parries, punishes, enders, happy accidents, perfect
// rounds), whether they won and how long they fought. Raw hits and presses aren't in it: they never pay. It goes
// whatever Do Not Track says, since it's the player's own progress, not analytics; it never leaves the page for a
// guest, and for a signed-in player goes only to their own account.
//
// It reads the sim and never writes it. Events re-fired by a rollback are already filtered by the netcode
// (README, Rollback, Effects); a stray one can leave the hit counts a hit off, which is why the online
// agreement doesn't include them.
import { trackAll, analyticsOn } from './analytics.js';
import { FRAME_DATA } from './combat/frameData.js';

const SIM_HZ = 120;
const MAX_MOVES = 10;
/** A match cut short with less fighting than this since the first FIGHT isn't reported */
export const MIN_FIGHT_SECS = 5;

/** How the match's last round ended, from the final state alone (so both online sims say the same):
 *  'time' the clock ran out, 'perfect' a KO by a winner at full health, 'ko' any other KO. */
export function howEnded(sim) {
  const w = sim.wins[0] > sim.wins[1] ? 0 : sim.wins[1] > sim.wins[0] ? 1 : -1;
  if (w < 0) return sim.units[0].health <= 0 || sim.units[1].health <= 0 ? 'ko' : 'time';
  const win = sim.units[w], lose = sim.units[1 - w];
  if (!(lose.health <= 0)) return 'time';
  return win.health >= (win.maxHealth || 100) ? 'perfect' : 'ko';
}

/** The page's own lock while it lives (navigator.locks), so another tab never sends a match this one still has on screen. */
const LOCK = 'stick-fight-book:';
/** localStorage keys of a match in progress on a hidden page (book.hide), sent by the next page load if this one never came back */
const KEEP = 'stick-fight-book-';
const KEEP_MS = 24 * 3600 * 1000;
function localStore() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }

/** Make the books for one sim. opts (tests): send (default trackAll), store (default localStorage), page (this page's token);
 *  onClose(summary) hears every match that closes (the career). */
export function createBook(sim, opts = {}) {
  const send = opts.send || trackAll;
  const store = opts.store !== undefined ? opts.store : analyticsOn ? localStore() : null;   // nothing kept when nothing would be sent
  const page = opts.page || Math.random().toString(36).slice(2, 10);
  if (!opts.page && typeof navigator !== 'undefined' && navigator.locks) { try { navigator.locks.request(LOCK + page, () => new Promise(() => {})).catch(() => {}); } catch { /* no locks */ } }
  /** @type {null | { mode: string, level: number, stage: number, local: number }} */
  let on = null;
  let fightAt = -1;   // the step the first FIGHT showed on, or -1 before it
  let hits = [0, 0], combo = [0, 0], perfects = [0, 0], lastHit = ['', ''], koMove = '';
  // technique, per side, for the career: [parries, punishes (counter hits), enders, happy accidents]
  let tech = [[0, 0, 0, 0], [0, 0, 0, 0]];
  /** @type {Map<string, { used: number, landed: number }>} */ const moves = new Map();
  /** @type {(string|null)[]} */ let swing = [null, null];   // the unique move each side has in the air, until it lands once
  const sideOf = (u) => (u.id === 0 ? 0 : 1);   // horde: every goon is side 1

  function reset() { hits = [0, 0]; combo = [0, 0]; perfects = [0, 0]; lastHit = ['', '']; koMove = ''; tech = [[0, 0, 0, 0], [0, 0, 0, 0]]; moves.clear(); swing = [null, null]; fightAt = -1; }
  /** a match starts: mode 'arcade' | 'horde' | 'quick' | 'crew', the CPU's level, the stage, and which side is this player.
   *  One still open is cut short first (cut). */
  function begin(meta) { cut(); on = { mode: meta.mode, level: meta.level || 0, stage: meta.stage || 0, local: meta.local || 0 }; reset(); if (sim.phase && sim.phase !== 'intro') fightAt = sim.stepCount; }   // a scene that skips its intro is already fighting
  /** seconds fought since the first FIGHT, 0 before it */
  const fought = () => (fightAt < 0 ? 0 : Math.max(0, sim.stepCount - fightAt) / SIM_HZ);

  /** every sim event (main.js onEvent) */
  function event(ev) {
    if (!on) return;
    if (ev.type === 'fight') { if (fightAt < 0) fightAt = sim.stepCount; return; }
    // technique (the career): a parry, an ender or a happy accident called out, a counter hit landed
    if (ev.type === 'block' && ev.parry && ev.defender && ev.attacker && sideOf(ev.defender) !== sideOf(ev.attacker)) { tech[sideOf(ev.defender)][0]++; return; }
    if (ev.type === 'callout' && typeof ev.by === 'number' && ev.by >= 0) {
      const s = ev.by === 0 ? 0 : 1;
      if (ev.kind === 'ender') tech[s][2]++;
      else if (ev.kind === 'accident') tech[s][3]++;
      return;
    }
    if (ev.type === 'attack' && ev.unit && ev.unit.id <= 1) {
      const u = ev.unit, fd = FRAME_DATA[ev.move];
      swing[u.id] = null;
      if (u.id !== on.local || !fd || !u.char || fd.owner !== u.char.id) return;   // the local player's own unique moves
      let m = moves.get(ev.move);
      if (!m) { if (moves.size >= MAX_MOVES) return; moves.set(ev.move, (m = { used: 0, landed: 0 })); }
      m.used++; swing[u.id] = ev.move;
    } else if (ev.type === 'hit' && ev.attacker && ev.defender) {
      const a = ev.attacker, d = ev.defender, s = sideOf(a);
      if (sideOf(d) === s) return;
      hits[s]++; combo[s] = Math.max(combo[s], d.combo || 0); lastHit[s] = ev.move || '';
      if (ev.counter) tech[s][1]++;
      if (a.id <= 1 && swing[a.id] === ev.move) { const m = moves.get(ev.move); if (m) m.landed++; swing[a.id] = null; }   // a multi-hit lands once
      if (ev.ko && !sim.horde) { koMove = ev.move || ''; if (a.health >= (a.maxHealth || 100)) perfects[s]++; }
    }
  }

  /** the details a result carries beyond who won: the finishing move and each side's hits, best combo and perfect rounds */
  function detail() {
    const w = sim.wins[0] > sim.wins[1] ? 0 : sim.wins[1] > sim.wins[0] ? 1 : -1;
    const move = howEnded(sim) === 'time' ? '' : koMove || (w >= 0 ? lastHit[w] : '');
    return { move, hits: [...hits], combo: [...combo], perfects: [...perfects], tech: [[...tech[0], perfects[0]], [...tech[1], perfects[1]]] };
  }

  /** What the career reads from match o: the local player's technique and the outcome. No hits, no presses. */
  function summary(o, quit) {
    const me = o.local === 0 ? 0 : 1, t = tech[me];
    const won = o.mode !== 'horde' && (sim.wins[me] | 0) > (sim.wins[1 - me] | 0);
    return { mode: o.mode, won: !quit && won, cut: !!quit, fought: Math.round(fought()), parries: t[0], punishes: t[1], enders: t[2], accidents: t[3],
      perfects: perfects[me], floors: o.mode === 'horde' ? (sim.horde && sim.horde.floorsCleared) || 0 : 0 };
  }
  function closed(o, quit) {
    if (!opts.onClose) return;
    try { opts.onClose(summary(o, quit)); } catch (e) { console.error('career:', e); }
  }

  /** What goes out for match o: the `match` event (arcade and horde; online results go through the room) and the
   *  move counts. quit: the match was cut short. A horde run cut short is the same as one that ended (a run has no
   *  win or loss, so a quit run is as good as a death); an arcade stage cut short carries quit: 1, which the Worker
   *  counts as play time only, never as a win or a loss (worker/stats.ts). */
  function events(o, quit) {
    const p1 = (sim.units[0].char && sim.units[0].char.id) || '', p2 = (sim.units[1] && sim.units[1].char && sim.units[1].char.id) || '';
    const out = [];
    if (o.mode === 'arcade' || o.mode === 'horde') {
      const horde = o.mode === 'horde', q = quit && !horde;
      const d = detail();
      out.push({ e: 'match', m: { mode: o.mode, p1, p2: horde ? '' : p2, wins: horde ? [0, 0] : [sim.wins[0] | 0, sim.wins[1] | 0], secs: Math.round(sim.stepCount / SIM_HZ),
        how: horde || q ? 'ko' : howEnded(sim), level: o.level, stage: horde ? (sim.horde && sim.horde.floorsCleared) || 0 : o.stage, ...d, ...(q ? { move: '', quit: 1 } : {}) } });
    }
    const mine = o.local === 0 ? p1 : p2;
    for (const [move, m] of moves) out.push({ e: 'move', l: [mine, move, o.mode], v: m.used, d: [m.landed] });
    return out;
  }
  const keepKey = KEEP + page;
  function unkeep() { try { if (store) store.removeItem(keepKey); } catch { /* full or blocked */ } }

  /** the match is over: send it (a vs-CPU match or a horde run; an online result went through the room) and the move counts */
  function end() {
    if (!on) return;
    const o = on; on = null; unkeep();
    send(events(o, false));
    closed(o, false);
  }

  /** The match is cut short (a restart, the menu, the demo, the tab closing: main.js setScene and pagehide): send it as
   *  it stands, once. Under MIN_FIGHT_SECS of fighting since the first FIGHT counts for nothing, so bouncing
   *  through the menus adds no noise. Online sends only the move counts: the room keeps the play time itself. */
  function cut() {
    if (!on) return;
    const o = on; on = null; unkeep();
    if (fought() < MIN_FIGHT_SECS) return;
    send(events(o, true));
    closed(o, true);
  }

  /** The tab is hidden (mobile Safari may kill it there without a pagehide): keep the match as it stands in
   *  localStorage, for the next page load to send if this page never comes back (sendLeftovers). Nothing is sent now,
   *  so a page that does come back carries on and sends its match once, as usual. */
  function hide() {
    if (!on || !store || fought() < MIN_FIGHT_SECS) return;
    try { store.setItem(keepKey, JSON.stringify({ page, at: Date.now(), events: events(on, true) })); } catch { /* full or blocked */ }
  }
  /** visible again: the match carries on, so the kept copy goes */
  function show() { unkeep(); }

  return { begin, cut, cancel: cut, event, detail, summary: () => (on ? summary(on, false) : null), end, hide, show, fought, get active() { return !!on; } };
}

/** On page load: send what a page killed while hidden left behind (book.hide), once, and only for a page that's gone
 *  (its lock is free). A day old is too stale and is dropped. */
export async function sendLeftovers(opts = {}) {
  const send = opts.send || trackAll, store = opts.store !== undefined ? opts.store : analyticsOn ? localStore() : null;
  if (!store) return 0;
  let held = new Set();
  try {
    if (opts.held) held = new Set(opts.held);
    else if (typeof navigator !== 'undefined' && navigator.locks) held = new Set(((await navigator.locks.query()).held || []).map((l) => l.name));
  } catch { /* no locks: every leftover's page is taken as gone */ }
  let n = 0;
  const keys = [];
  try { for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k && k.startsWith(KEEP)) keys.push(k); } } catch { return 0; }
  for (const k of keys) {
    let kept = null;
    try { kept = JSON.parse(store.getItem(k) || 'null'); } catch { kept = null; }
    if (kept && held.has(LOCK + kept.page)) continue;   // that page is still open, only hidden
    try { store.removeItem(k); } catch { /* blocked */ }
    if (!kept || !Array.isArray(kept.events) || !(Date.now() - kept.at < KEEP_MS)) continue;
    send(kept.events); n++;
  }
  return n;
}
