// The connection meter (README, Multiplayer, The connection meter): four bars from the round trip, its jitter, the
// share of probes lost and which path the packets take, a plain label, and WEAK CONNECTION: EXPECT LAG when it's
// bad. Shown before a match, the way fighting games do (the crew lobby and the host screen: your own connection to
// the room; the online pick screen: the link to your rival), and in the fight's corner readout when it drops.
//
//   bars(q, { leg })      0..4 (0: no reading yet). q: { rtt, jitter, loss, samples, path, down? }; leg: q measures only
//                         this page to the room (half the trip), so it's held to tighter numbers
//   createMeter(o)        { el, update(q) }: the bars, the label and the warning, styled here
//
// The look (README, The look): neon bars that may glow a little (they aren't text), square corners, and every word
// in plain ink with the dark outline, never a glow.

import { PLAIN } from '../plaintext.js';

/** at or under this many bars the warning shows */
export const WEAK_AT = 2;
const PATH_WORD = { direct: 'DIRECT', turn: 'TURN', relay: 'RELAY' };

/** how many bars: 4 less the worst of the round trip, jitter and loss penalties, less one on the relay (TCP) */
export function bars(q, { leg = false } = {}) {
  if (!q || !(q.samples > 0) || !(q.rtt > 0)) return 0;
  const rt = leg ? [50, 90, 140] : [100, 170, 260], jt = leg ? [10, 25] : [20, 45];
  const rttP = q.rtt <= rt[0] ? 0 : q.rtt <= rt[1] ? 1 : q.rtt <= rt[2] ? 2 : 3;
  const j = q.jitter || 0, jitP = j <= jt[0] ? 0 : j <= jt[1] ? 1 : 2;
  const l = q.loss || 0, lossP = l <= 0.02 ? 0 : l <= 0.06 ? 1 : 2;
  const relayP = !leg && q.path === 'relay' ? 1 : 0;
  return Math.max(1, Math.min(4, 4 - Math.max(rttP, jitP, lossP) - relayP));
}

/** the meter's words for a reading */
export function label(q, b, { leg = false } = {}) {
  // a socket that's being dialed again isn't something to check: say what's happening (q.down, src/net/crew.js quality)
  if (q && q.down === 'reconnecting') return 'RECONNECTING';
  if (q && q.down === 'connecting') return 'CONNECTING';
  if (!b) return leg ? 'CHECKING YOUR CONNECTION' : 'CHECKING THE LINK';
  const ms = `${Math.round(q.rtt)} MS`;
  if (leg) return `YOUR CONNECTION · ${ms}`;
  return `${PATH_WORD[q.path] || 'LINK'} · ${ms}`;
}

/**
 * @param {{ leg?: boolean, cls?: string, warn?: boolean }} [o] leg: this page to the room; warn: show the warning
 *   when weak (the fight's readout says it its own way)
 */
export function createMeter({ leg = false, cls = '', warn = true } = {}) {
  injectStyle();
  const el = document.createElement('span');
  el.className = `nm nm-q0 ${cls}`.trim();
  el.setAttribute?.('role', 'status');
  const barsEl = document.createElement('span');
  barsEl.className = 'nm-bars';
  barsEl.setAttribute?.('aria-hidden', 'true');
  for (let i = 0; i < 4; i++) barsEl.appendChild(document.createElement('i'));
  const t = document.createElement('span'); t.className = 'nm-t';
  const w = document.createElement('b'); w.className = 'nm-w'; w.textContent = 'WEAK CONNECTION: EXPECT LAG'; w.hidden = true;
  el.append(barsEl, t, w);
  let key = '';
  return {
    el,
    /** @param {any} q */
    update(q) {
      const b = bars(q, { leg }), text = label(q, b, { leg }), weak = warn && b > 0 && b <= WEAK_AT;
      const k = `${b}|${text}|${weak}`;
      if (k === key) return b;
      key = k;
      el.className = `nm nm-q${b} ${cls}`.trim();
      t.textContent = text;
      w.hidden = !weak;
      el.setAttribute?.('aria-label', b ? `${text}, ${b} of 4 bars${weak ? ', weak connection: expect lag' : ''}` : text);
      return b;
    },
  };
}

let styled = false;
function injectStyle() {
  if (styled || typeof document === 'undefined' || !document.head) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `
  .nm { display: inline-flex; align-items: center; gap: 0.45em; flex-wrap: wrap; justify-content: center; white-space: nowrap;
    font-family: 'Teko', 'Arial Narrow', system-ui, sans-serif; font-weight: 500; letter-spacing: 0.08em; line-height: 1;
    color: #fff4fd; text-shadow: ${PLAIN}; --nm: rgba(214,190,255,0.5); }
  .nm-bars { display: inline-flex; align-items: flex-end; gap: 0.14em; height: 0.95em; }
  .nm-bars i { display: block; width: 0.3em; border-radius: 0; background: rgba(214,190,255,0.22); }
  .nm-bars i:nth-child(1) { height: 32%; } .nm-bars i:nth-child(2) { height: 54%; }
  .nm-bars i:nth-child(3) { height: 77%; } .nm-bars i:nth-child(4) { height: 100%; }
  .nm-q4, .nm-q3 { --nm: #2ef2ff; } .nm-q2 { --nm: #ffb02e; } .nm-q1 { --nm: #E85D00; }
  .nm-q1 .nm-bars i:nth-child(-n+1), .nm-q2 .nm-bars i:nth-child(-n+2), .nm-q3 .nm-bars i:nth-child(-n+3), .nm-q4 .nm-bars i {
    background: var(--nm); box-shadow: 0 0 4px color-mix(in srgb, var(--nm) 70%, transparent); }
  .nm-q0 .nm-t { opacity: 0.75; }
  .nm .nm-w { color: var(--nm); font-weight: 600; letter-spacing: 0.06em; }
  .nm-w[hidden] { display: none; }`;
  document.head.appendChild(s);
}
