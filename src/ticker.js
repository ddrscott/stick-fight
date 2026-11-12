// The title screen's ticker (README, "Analytics", The title's ticker): one slim line along the bottom of the
// title and its attract demo that turns over every few seconds with a game-wide stat, so a visitor sees people
// play this. It reads the same public, anonymous numbers as the homepage (GET api/stats, the all-time rollups,
// and GET api/now, the live count): fighters, moves and counts, never a player.
//
// The rule: a line only shows once its number makes the game look busy. Some lines carry no count at all
// (MOST PICKED, TOP FINISHER) and show at any size; a fact needs FACT_MIN; the totals and the live count have
// their own bars below. Nothing shows when nothing clears its bar, and a failed fetch shows nothing either:
// the title never waits on this and never breaks because of it.
//
// Plain DOM over the canvases, built once: a crossfade is an opacity transition on two spans, the live dot a
// CSS pulse. No per-frame work, nothing in the render loop.
import { characterOr, ROSTER_ORDER } from './characters/registry.js';
import { SHARED_INPUTS, nameOf } from './combat/moveinfo.js';
import { FRAME_DATA } from './combat/frameData.js';
import { PLAIN } from './plaintext.js';
import { rootUrl } from './root.js';

/** The bars. Tune here. */
export const TICKER = {
  MATCHES_MIN: 1000,    // "1,284 MATCHES FOUGHT": all-time finished matches
  HOURS_MIN: 100,       // "312 HOURS PLAYED": all-time play time, in hours
  DAYS_FROM: 100,       // ...shown in days ("104 DAYS PLAYED") once it's at least this many days
  TODAY_MIN: 100,       // "TODAY: 240 MATCHES": finished matches today (UTC)
  LIVE_MIN: 1,          // "6 FIGHTING NOW": matches on right now (two fighters each)
  FACT_MIN: 5,          // a fighter's fact ("COURIER HAS WON 12 MATCHES") needs at least this many
  FACTS: 8,             // the biggest facts kept in the rotation
  ROTATE_MS: 4500,      // each line's time on screen
  REFETCH_MS: 180000,   // fetch again while the title stays up (api/stats is cached ten minutes at the edge anyway)
};

const PICK_MODES = ['arcade', 'horde', 'training', 'quick', 'crew'];   // a fighter someone played as (not 'dummy')
const num = (n) => Math.round(n).toLocaleString('en-US');
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;

/** a move's name as the move list says it, and whose it is (null for a shared move); null if the game doesn't know the id */
export function moveLabel(id) {
  const shared = SHARED_INPUTS.find((x) => x.move === id);
  if (shared) return { name: shared.name, owner: null };
  const fd = FRAME_DATA[id];
  if (!fd || !fd.owner) return null;
  return { name: nameOf(characterOr(fd.owner), id), owner: fd.owner };
}

/**
 * @typedef {{ text: string, color?: string }} Part
 * @typedef {{ key: string, parts: Part[], live?: boolean, text: string }} Line
 */
/** @param {string} key @param {Part[]} parts @param {boolean} [live] @returns {Line} */
const line = (key, parts, live = false) => ({ key, parts, live, text: parts.map((p) => p.text).join(' ') });
const fighter = (id) => { const c = characterOr(id); return { text: c.name, color: c.color }; };

/**
 * Every line that clears its bar, in the order they turn over: the live count first, then the totals, then the
 * ones with no count, then the facts. Pure: the same numbers give the same lines.
 * @param {any} stats  GET api/stats, or null
 * @param {any} now    GET api/now, or null
 * @param {typeof TICKER} [T]
 * @returns {Line[]}
 */
export function tickerLines(stats, now, T = TICKER) {
  const out = [];
  const live = now && Number(now.matches) || 0;
  if (live >= T.LIVE_MIN) out.push(line('live', [{ text: `${num(live * 2)} FIGHTING NOW` }], true));
  if (!stats || typeof stats !== 'object') return out;
  const time = stats.time || {}, all = time.all || {}, today = time.today || {};
  if ((all.matches || 0) >= T.MATCHES_MIN) out.push(line('matches', [{ text: `${num(all.matches)} MATCHES FOUGHT` }]));
  const hours = (all.secs || 0) / 3600;
  if (hours >= T.HOURS_MIN) {
    const days = hours / 24;
    out.push(line('hours', [{ text: days >= T.DAYS_FROM ? `${num(Math.floor(days))} DAYS PLAYED` : `${num(Math.floor(hours))} HOURS PLAYED` }]));
  }
  if ((today.matches || 0) >= T.TODAY_MIN) out.push(line('today', [{ text: 'TODAY:' }, { text: `${num(today.matches)} MATCHES` }]));

  const fighters = stats.fighters || {};
  const ids = ROSTER_ORDER.filter((id) => fighters[id]);
  // MOST PICKED: every mode a person picked a fighter to play (the training dummy isn't one); ties go to roster order
  let best = null, bestN = 0;
  for (const id of ids) {
    const p = fighters[id].picks || {};
    const n = PICK_MODES.reduce((s, m) => s + (Number(p[m]) || 0), 0);
    if (n > bestN) { best = id; bestN = n; }
  }
  if (best) out.push(line('picked', [{ text: 'MOST PICKED:' }, fighter(best)]));
  // TOP FINISHER: the move that ended the most matches (one the game knows)
  for (const [id, kos] of Array.isArray(stats.finishers) ? stats.finishers : []) {
    const m = kos > 0 && moveLabel(id);
    if (!m) continue;
    out.push(line('finisher', [{ text: 'TOP FINISHER:' }, { text: m.name, color: m.owner ? characterOr(m.owner).color : undefined },
      ...(m.owner ? [{ text: `· ${characterOr(m.owner).name}`, color: characterOr(m.owner).color }] : [])]));
    break;
  }
  // facts: a fighter's records, the biggest numbers first, each only once it's FACT_MIN or more
  const facts = [];
  for (const id of ids) {
    const f = fighters[id], cpu = f.cpu || {}, pvp = f.pvp || {};
    const wins = (cpu.wins || 0) + (pvp.wins || 0), perfects = (cpu.perfects || 0) + (pvp.perfects || 0);
    if (wins >= T.FACT_MIN) facts.push({ n: wins, l: line(`wins:${id}`, [fighter(id), { text: `HAS WON ${num(wins)} MATCHES` }]) });
    if (perfects >= T.FACT_MIN) facts.push({ n: perfects * 4, l: line(`perfects:${id}`, [fighter(id), { text: `HAS ${num(perfects)} PERFECT FINISHES` }]) });   // rarer, so it ranks higher
    if ((pvp.wins || 0) >= T.FACT_MIN) facts.push({ n: pvp.wins * 2, l: line(`online:${id}`, [fighter(id), { text: `HAS ${num(pvp.wins)} ONLINE WINS` }]) });
  }
  // the most played pairing, vs CPU or online
  let pair = null;
  for (const vs of ['pvp', 'cpu']) {
    for (const row of (stats.matchups && stats.matchups[vs]) || []) {
      const [a, b, games] = row;
      if (a !== b && fighters[a] && fighters[b] && games >= T.FACT_MIN && (!pair || games > pair.games)) pair = { a, b, games };
    }
  }
  if (pair) facts.push({ n: pair.games, l: line('pair', [fighter(pair.a), { text: 'VS' }, fighter(pair.b), { text: `· ${plural(pair.games, 'MATCH', 'MATCHES')}` }]) });
  // the biggest of each kind first (wins, perfect finishes, online wins, the pairing), then the rest, so the rotation varies
  facts.sort((x, y) => y.n - x.n);
  const kind = (f) => f.l.key.split(':')[0], seen = new Set();
  const lead = facts.filter((f) => !seen.has(kind(f)) && seen.add(kind(f)));
  for (const f of [...lead, ...facts.filter((f) => !lead.includes(f))].slice(0, T.FACTS)) out.push(f.l);
  return out;
}

/**
 * The order lines go on screen: the lines with no count and the totals every round, and one fact a round (the
 * next one each time), so a long list of facts doesn't bury the rest.
 * @param {Line[]} lines @param {number} round
 */
export function roundOf(lines, round) {
  const facts = lines.filter((l) => /^(wins|perfects|online|pair)/.test(l.key)), rest = lines.filter((l) => !facts.includes(l));
  return facts.length ? [...rest, facts[round % facts.length]] : rest;
}

// ---- on the page ------------------------------------------------------------------------------------------
const CSS = `
  #ticker { position: absolute; left: 2.2%; bottom: 2.6%; z-index: 6; pointer-events: none; display: none; align-items: center;
    width: 62%; height: 1.5em; font: 500 clamp(15px, 1.65vw, 26px)/1 'Teko', 'Arial Narrow', sans-serif; letter-spacing: 0.08em;
    color: #e9dcff; text-shadow: ${PLAIN}; opacity: 0; transition: opacity 400ms; white-space: nowrap; }
  html.fl-attract #ticker.on { display: flex; }
  #ticker.in { opacity: 1; }
  /* a key or a pad: the legend sits at the bottom middle, so the ticker keeps to the left of it */
  html.dev-key #ticker, html.dev-pad #ticker { width: 31%; }
  #ticker .tk-box { position: relative; flex: 1 1 auto; min-width: 0; height: 100%; overflow: hidden; }
  #ticker .tk-line { position: absolute; left: 0; top: 0; height: 100%; display: flex; align-items: center; gap: 0.32em;
    opacity: 0; transition: opacity 500ms; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  #ticker .tk-line.on { opacity: 1; }
  #ticker .tk-line b { font-weight: 600; color: color-mix(in srgb, var(--c) 55%, #fff); }
  #ticker .tk-line i { font-style: normal; color: #b9a3e6; }
  /* the marker: a small square in the title's amber, or the live dot (green, pulsing) when the line is the live count */
  #ticker .tk-dot { flex: none; width: 0.36em; height: 0.36em; background: #ffb02e; margin: 0 0.2em 0.12em 0; }
  #ticker .tk-line.live .tk-dot { background: #3dff8b; border-radius: 50%; animation: tk-pulse 1.4s ease-in-out infinite; }
  @keyframes tk-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.7); } }
  @media (prefers-reduced-motion: reduce) { #ticker .tk-line.live .tk-dot { animation: none; } }
  /* held upright: under the view, where the title has nothing (the touch controls are off on the title) */
  @media (orientation: portrait) {
    html.sq #ticker { left: 0; right: 0; bottom: auto; top: calc((1 + var(--sq-over, 0)) * 100% + 14px); width: auto; justify-content: center; font-size: 19px; }
    html.sq #ticker .tk-box { flex: 0 1 auto; width: 100%; }
    html.sq #ticker .tk-line { left: 50%; transform: translateX(-50%); }
  }
`;

/**
 * Builds the ticker inside #stage (once) and returns show(on): the flow calls it with true on the title and
 * false everywhere else. Showing fetches (at most every REFETCH_MS) and turns lines over; hiding stops both.
 * @param {{ fetch?: typeof fetch, stage?: HTMLElement | null }} [opts]
 */
export function createTicker(opts = {}) {
  const doc = typeof document !== 'undefined' ? document : null;
  const stage = opts.stage !== undefined ? opts.stage : doc && typeof doc.getElementById === 'function' ? doc.getElementById('stage') : null;
  if (!doc || !stage) return { show() {}, state: { lines: [] } };
  const get = opts.fetch || ((u, o) => fetch(u, o));
  const style = doc.createElement('style'); style.textContent = CSS; doc.head.appendChild(style);
  const root = doc.createElement('div'); root.id = 'ticker'; root.setAttribute('aria-live', 'off');
  const box = doc.createElement('span'); box.className = 'tk-box';
  const slots = [doc.createElement('span'), doc.createElement('span')];
  for (const s of slots) { s.className = 'tk-line'; box.appendChild(s); }
  root.appendChild(box); stage.appendChild(root);

  const state = { lines: /** @type {Line[]} */ ([]), stats: null, now: null, at: 0, on: false, round: 0, i: 0, slot: 0 };
  let rotTimer = 0, fetchTimer = 0, busy = false;
  const json = (path) => get(rootUrl(path).href, { headers: { accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  async function load() {
    if (busy) return;
    busy = true;
    try {
      const [stats, now] = await Promise.all([json('api/stats'), json('api/now')]);
      state.stats = stats && stats.fighters ? stats : null; state.now = now && typeof now.matches === 'number' ? now : null; state.at = Date.now();
      state.lines = tickerLines(state.stats, state.now);
    } catch { state.lines = []; }   // anything odd in the answer: no ticker
    busy = false;
    if (state.on) start();
  }
  function paint(l) {
    const s = slots[state.slot = 1 - state.slot];
    s.replaceChildren();
    const dot = doc.createElement('span'); dot.className = 'tk-dot'; s.appendChild(dot);
    s.classList.toggle('live', !!l.live);
    for (const p of l.parts) {
      const n = doc.createElement(p.color ? 'b' : (/:$/.test(p.text) ? 'i' : 'span'));
      n.textContent = p.text;
      if (p.color) n.style.setProperty('--c', p.color);
      s.appendChild(n);
    }
    slots[1 - state.slot].classList.remove('on');
    s.classList.add('on');
  }
  function step() {
    let seq = roundOf(state.lines, state.round);
    if (state.i >= seq.length) { state.i = 0; state.round++; seq = roundOf(state.lines, state.round); }
    if (!seq.length) { stop(); return; }
    paint(seq[state.i++]);
  }
  function start() {
    if (rotTimer || !state.lines.length) { if (!state.lines.length) stop(); return; }
    root.classList.add('on');
    step();
    requestAnimationFrame(() => root.classList.add('in'));
    rotTimer = window.setInterval(step, TICKER.ROTATE_MS);
  }
  function stop() {
    clearInterval(rotTimer); rotTimer = 0;
    root.classList.remove('in', 'on');
  }
  function show(on) {
    if (on === state.on) return;
    state.on = on;
    if (!on) { stop(); clearInterval(fetchTimer); fetchTimer = 0; return; }
    if (!state.at || Date.now() - state.at > TICKER.REFETCH_MS) load(); else start();
    fetchTimer = window.setInterval(load, TICKER.REFETCH_MS);
  }
  return { show, state };
}
