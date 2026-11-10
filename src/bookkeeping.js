// Match bookkeeping, the page's side (README, "Analytics"): counts what happens in one match from the
// sim's events and, when the match ends, sends it. No player id, name or email: fighters, modes and counts.
//
//   arcade   one `match` event per stage fought (player's fighter, the CPU's, rounds, length, how it ended)
//   horde    one `match` event per run
//   online   the result goes to the room over its WebSocket and counts only if both pages agree
//            (src/net/online.js matchOver, worker/stats.ts); this module only hands over the details
//   every mode: one `move` event per unique move the local player used (how often, and how often it landed)
//
// It reads the sim and never writes it. Events re-fired by a rollback are already filtered by the netcode
// (README, Rollback, Effects); a stray one can leave the hit counts a hit off, which is why the online
// agreement doesn't include them.
import { trackAll } from './analytics.js';
import { FRAME_DATA } from './combat/frameData.js';

const SIM_HZ = 120;
const MAX_MOVES = 10;

/** How the match's last round ended, from the final state alone (so both online sims say the same):
 *  'time' the clock ran out, 'perfect' a KO by a winner at full health, 'ko' any other KO. */
export function howEnded(sim) {
  const w = sim.wins[0] > sim.wins[1] ? 0 : sim.wins[1] > sim.wins[0] ? 1 : -1;
  if (w < 0) return sim.units[0].health <= 0 || sim.units[1].health <= 0 ? 'ko' : 'time';
  const win = sim.units[w], lose = sim.units[1 - w];
  if (!(lose.health <= 0)) return 'time';
  return win.health >= (win.maxHealth || 100) ? 'perfect' : 'ko';
}

export function createBook(sim) {
  /** @type {null | { mode: string, level: number, stage: number, local: number }} */
  let on = null;
  let hits = [0, 0], combo = [0, 0], perfects = [0, 0], lastHit = ['', ''], koMove = '';
  /** @type {Map<string, { used: number, landed: number }>} */ const moves = new Map();
  /** @type {(string|null)[]} */ let swing = [null, null];   // the unique move each side has in the air, until it lands once
  const sideOf = (u) => (u.id === 0 ? 0 : 1);   // horde: every goon is side 1

  function reset() { hits = [0, 0]; combo = [0, 0]; perfects = [0, 0]; lastHit = ['', '']; koMove = ''; moves.clear(); swing = [null, null]; }
  /** a match starts: mode 'arcade' | 'horde' | 'quick' | 'crew', the CPU's level, the stage, and which side is this player */
  function begin(meta) { on = { mode: meta.mode, level: meta.level || 0, stage: meta.stage || 0, local: meta.local || 0 }; reset(); }
  function cancel() { on = null; }

  /** every sim event (main.js onEvent) */
  function event(ev) {
    if (!on) return;
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
      if (a.id <= 1 && swing[a.id] === ev.move) { const m = moves.get(ev.move); if (m) m.landed++; swing[a.id] = null; }   // a multi-hit lands once
      if (ev.ko && !sim.horde) { koMove = ev.move || ''; if (a.health >= (a.maxHealth || 100)) perfects[s]++; }
    }
  }

  /** the details a result carries beyond who won: the finishing move and each side's hits, best combo and perfect rounds */
  function detail() {
    const w = sim.wins[0] > sim.wins[1] ? 0 : sim.wins[1] > sim.wins[0] ? 1 : -1;
    const move = howEnded(sim) === 'time' ? '' : koMove || (w >= 0 ? lastHit[w] : '');
    return { move, hits: [...hits], combo: [...combo], perfects: [...perfects] };
  }

  /** the match is over: send it (a vs-CPU match or a horde run; an online result went through the room) and the move counts */
  function end() {
    if (!on) return;
    const o = on; on = null;
    const p1 = (sim.units[0].char && sim.units[0].char.id) || '', p2 = (sim.units[1] && sim.units[1].char && sim.units[1].char.id) || '';
    const events = [];
    if (o.mode === 'arcade' || o.mode === 'horde') {
      const horde = o.mode === 'horde';
      events.push({ e: 'match', m: { mode: o.mode, p1, p2: horde ? '' : p2, wins: horde ? [0, 0] : [sim.wins[0] | 0, sim.wins[1] | 0], secs: Math.round(sim.stepCount / SIM_HZ),
        how: horde ? 'ko' : howEnded(sim), level: o.level, stage: horde ? (sim.horde && sim.horde.floorsCleared) || 0 : o.stage, ...detail() } });
    }
    const mine = o.local === 0 ? p1 : p2;
    for (const [move, m] of moves) events.push({ e: 'move', l: [mine, move, o.mode], v: m.used, d: [m.landed] });
    trackAll(events);
  }

  return { begin, cancel, event, detail, end, get active() { return !!on; } };
}
