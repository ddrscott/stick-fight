// The books on the site (README, "Analytics", On the site): the homepage's pick rates, win rates and matchup
// chart, and a fighter page's record. site/site.js loads this only on a page with a [data-stats] section.
// The numbers are the all-time rollups from GET api/stats (worker/stats.ts), fetched once per page view; the
// edge caches the answer for ten minutes. If the fetch fails, the section keeps the static text it was built with.
//
// Two kinds of result are never mixed: VS CPU (reported by the player's page, not checked) and PLAYER VS PLAYER
// (online, counted only when both players' pages reported the same result).
// A win rate counts a draw as half a win. Small samples are held back: a fighter needs MIN_FIGHTER matches before
// it's ranked, a matchup MIN_CELL before its cell is filled in.
import { rootUrl } from '../src/root.js';

const MIN_FIGHTER = 20, MIN_CELL = 5, TOP = 8, SIDE = 3;
const CPU_PICKS = ['arcade', 'horde', 'training'], PVP_PICKS = ['quick', 'crew'];
const LABEL = { cpu: 'VS CPU', pvp: 'PLAYER VS PLAYER' };

const box = document.querySelector('[data-stats]');
const rosterEl = document.querySelector('[data-stats-roster]');
/** @type {{ id: string, name: string, color: string }[]} */
const roster = rosterEl ? JSON.parse(rosterEl.textContent || '[]') : [];
const byId = new Map(roster.map((f) => [f.id, f]));

const el = (tag, cls = '', text = '') => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
const pct = (x, digits = 0) => `${(x * 100).toFixed(digits)}%`;
const num = (n) => Number(n).toLocaleString('en-US');
const rate = (wins, draws, games) => (games > 0 ? (wins + draws / 2) / games : 0);
const secs = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${Math.round(s)} s`);
const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;
const fighterUrl = (id) => rootUrl(`fighters/${id}/`).href;

/** picks per fighter in a view, and the total */
function picksIn(data, vs) {
  const modes = vs === 'pvp' ? PVP_PICKS : CPU_PICKS, out = new Map();
  let total = 0;
  for (const f of roster) {
    const p = (data.fighters[f.id] && data.fighters[f.id].picks) || {};
    const n = modes.reduce((s, m) => s + (p[m] || 0), 0);
    out.set(f.id, n); total += n;
  }
  return { by: out, total };
}
/** the record of `a` against `b` in a view, from a's side: { games, wins, losses, draws, secs } or null.
 *  vs CPU a is the player's fighter; online the pair is stored once, so it's read from either side. */
function matchup(data, vs, a, b) {
  for (const [x, y, games, xw, yw, draws, s] of data.matchups[vs]) {
    if (x === a && y === b) return { games, wins: xw, losses: yw, draws, secs: s };
    if (vs === 'pvp' && x === b && y === a) return { games, wins: yw, losses: xw, draws, secs: s };
  }
  return null;
}
function recordLine(a, b, m, vs) {
  const A = byId.get(a).name, B = byId.get(b).name;
  if (!m || !m.games) return `${A} against ${vs === 'cpu' ? `the CPU's ${B}` : B}: no matches on the books yet.`;
  const games = `${num(m.games)} match${m.games === 1 ? '' : 'es'}`;
  if (vs === 'pvp' && a === b) return `${A} mirror: ${games}. A mirror says nothing about the fighter, so it isn't rated.`;
  const rec = `${num(m.wins)} won, ${num(m.losses)} lost${m.draws ? `, ${num(m.draws)} drawn` : ''}`;
  const tail = m.games < MIN_CELL ? ` Too few to rate (needs ${MIN_CELL}).` : ` ${A} wins ${pct(rate(m.wins, m.draws, m.games))}. Average match ${secs(m.secs / m.games)}.`;
  return `${A} against ${vs === 'cpu' ? `the CPU's ${B}` : B}: ${games}, ${rec}.${tail}`;
}

// ---- the homepage -------------------------------------------------------------------------------------------
function rankList(host, rows, empty) {
  host.replaceChildren();
  if (!rows.length) { host.appendChild(el('li', 's-rank-empty', empty)); return; }
  const top = Math.max(...rows.map((r) => r.value)) || 1;
  for (const r of rows) {
    const f = byId.get(r.id), li = el('li'), a = el('a', 's-rank-row');
    a.href = fighterUrl(f.id); a.style.setProperty('--c', f.color);
    const bar = el('span', 's-rank-bar'); bar.appendChild(el('i')).style.width = `${Math.max(2, (r.value / top) * 100)}%`;
    a.append(el('b', 's-rank-name', f.name), bar, el('span', 's-rank-val', r.label), el('small', 's-rank-sub', r.sub));
    li.appendChild(a); host.appendChild(li);
  }
}
function chart(host, detail, data, vs) {
  const t = el('table', 's-mu');
  t.appendChild(el('caption', '', vs === 'cpu' ? 'Win rate of the player\'s fighter (rows) against the CPU\'s fighter (columns)' : 'Win rate of the row\'s fighter against the column\'s, player against player'));
  const head = t.createTHead().insertRow();
  head.appendChild(el('th', 's-mu-corner', vs === 'cpu' ? 'PLAYER ↓  CPU →' : 'ROW BEAT COLUMN'));
  for (const b of roster) { const th = el('th', 's-mu-col'); th.scope = 'col'; th.appendChild(el('span', '', b.name)).style.color = b.color; head.appendChild(th); }
  const body = t.createTBody();
  for (const a of roster) {
    const tr = body.insertRow(), th = el('th', 's-mu-row'); th.scope = 'row';
    const link = th.appendChild(el('a', '', a.name)); link.href = fighterUrl(a.id); link.style.color = a.color;
    tr.appendChild(th);
    for (const b of roster) {
      const td = tr.insertCell(), m = matchup(data, vs, a.id, b.id);
      td.tabIndex = 0; td.dataset.a = a.id; td.dataset.b = b.id;
      const line = recordLine(a.id, b.id, m, vs); td.title = line; td.setAttribute('aria-label', line);
      if (vs === 'pvp' && a.id === b.id) { td.className = 's-mu-mirror'; continue; }
      if (!m || m.games < MIN_CELL) { td.className = 's-mu-thin'; if (m && m.games) td.textContent = '·'; continue; }
      // the cell takes the color of whoever wins the matchup, stronger the more one-sided it is
      const r = rate(m.wins, m.draws, m.games), edge = Math.min(1, Math.abs(r - 0.5) * 2);
      td.style.background = `color-mix(in srgb, ${(r >= 0.5 ? a : b).color} ${Math.round(10 + edge * 45)}%, #140829)`;
      td.textContent = String(Math.round(r * 100));
    }
  }
  host.replaceChildren(t);
  const show = (e) => {
    const td = e.target instanceof Element ? e.target.closest('td[data-a]') : null;
    if (!td) return;
    for (const on of t.querySelectorAll('.s-mu-on')) on.classList.remove('s-mu-on');
    td.classList.add('s-mu-on');
    detail.textContent = td.title;
  };
  t.addEventListener('pointerover', show); t.addEventListener('focusin', show); t.addEventListener('click', show);
}
function home(data) {
  const q = (s) => box.querySelector(s);
  const buttons = [...box.querySelectorAll('[data-vs]')];
  const paint = (vs) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.vs === vs));
    const tot = data.totals[vs], picks = picksIn(data, vs);
    q('[data-stats-note]').textContent = vs === 'cpu'
      ? `${num(tot.games)} arcade matches against the CPU so far${tot.games ? `, ${secs(tot.secs / tot.games)} on average` : ''}. The player's own game reports these, so nothing checks them.`
      : `${num(tot.games)} online matches so far${tot.games ? `, ${secs(tot.secs / tot.games)} on average` : ''}. A result only counts when both players' games report the same one.`;
    rankList(q('[data-stats-picks]'), roster.map((f) => ({ id: f.id, value: picks.by.get(f.id) })).filter((r) => r.value > 0).sort((x, y) => y.value - x.value).slice(0, TOP)
      .map((r) => ({ ...r, label: pct(r.value / picks.total, 1), sub: `${num(r.value)} pick${r.value === 1 ? '' : 's'}` })), 'Nobody has picked a fighter here yet.');
    rankList(q('[data-stats-wins]'), roster.map((f) => ({ id: f.id, s: data.fighters[f.id][vs] })).filter((r) => r.s.games >= MIN_FIGHTER)
      .map((r) => ({ id: r.id, value: rate(r.s.wins, r.s.draws, r.s.games), s: r.s })).sort((x, y) => y.value - x.value).slice(0, TOP)
      .map((r) => ({ ...r, label: pct(r.value), sub: `${num(r.s.wins)}–${num(r.s.losses)}${r.s.draws ? `–${num(r.s.draws)}` : ''}` })), `No fighter has ${MIN_FIGHTER} matches here yet.`);
    q('[data-stats-chart-note]').textContent = (vs === 'cpu'
      ? 'Rows are the player\'s fighter, columns the CPU\'s. Each number is how often the row won, in percent.'
      : 'Each number is how often the row\'s fighter beat the column\'s, in percent. Mirror matches are left out.')
      + ` The cell takes the winner's color. Blank means under ${MIN_CELL} matches.`;
    q('[data-stats-detail]').textContent = 'Hover or tap a cell for the record.';
    chart(q('[data-stats-chart]'), q('[data-stats-detail]'), data, vs);
  };
  for (const b of buttons) { b.disabled = false; b.addEventListener('click', () => paint(b.dataset.vs)); }
  paint(data.totals.pvp.games > data.totals.cpu.games ? 'pvp' : 'cpu');
  box.classList.add('s-books-live');
}

// ---- a fighter's page -----------------------------------------------------------------------------------------
function fighter(data, id) {
  const me = data.fighters[id], host = box.querySelector('[data-stats-record]');
  if (!me || !byId.has(id)) return;
  host.replaceChildren();
  for (const vs of ['cpu', 'pvp']) {
    const s = me[vs], picks = picksIn(data, vs), mine = picks.by.get(id) || 0;
    const rank = 1 + roster.filter((f) => picks.by.get(f.id) > mine).length;
    const card = el('article', 's-rec');
    card.append(el('h3', 's-h3', LABEL[vs]), el('p', 's-rec-how', vs === 'cpu' ? 'Arcade matches, as the player\'s fighter. Reported by the player\'s game.' : 'Online matches. Counted only when both players\' games agree.'));
    const dl = el('dl', 's-rec-kv');
    const kv = (k, v, sub = '') => { const d = el('div'); d.append(el('dt', '', k), el('dd', '', v)); if (sub) d.appendChild(el('small', '', sub)); dl.appendChild(d); };
    kv('PICK RATE', picks.total && mine ? pct(mine / picks.total, 1) : '—', mine ? `${num(mine)} pick${mine === 1 ? '' : 's'}, ${ordinal(rank)} of ${roster.length}` : 'not picked yet');
    kv('WIN RATE', s.games >= MIN_FIGHTER ? pct(rate(s.wins, s.draws, s.games)) : '—',
      s.games >= MIN_FIGHTER ? `${num(s.wins)} won, ${num(s.losses)} lost${s.draws ? `, ${num(s.draws)} drawn` : ''}` : `${num(s.games)} of the ${MIN_FIGHTER} matches it takes to rate`);
    kv('AVERAGE MATCH', s.games ? secs(s.secs / s.games) : '—', s.games ? `over ${num(s.games)} match${s.games === 1 ? '' : 'es'}` : '');
    kv('PERFECT FINISHES', s.games ? num(s.perfects) : '—', s.games ? 'matches closed with a perfect round' : '');
    card.appendChild(dl);
    // best and worst: every opponent with enough matches, by this fighter's win rate
    const rated = roster.filter((f) => vs === 'cpu' || f.id !== id).map((f) => ({ f, m: matchup(data, vs, id, f.id) })).filter((x) => x.m && x.m.games >= MIN_CELL)
      .map((x) => ({ ...x, r: rate(x.m.wins, x.m.draws, x.m.games) })).sort((x, y) => y.r - x.r);
    const list = (title, rows) => {
      const w = el('div', 's-rec-mu'); w.appendChild(el('h4', '', title));
      const ul = el('ul');
      for (const x of rows) {
        const li = el('li'), a = el('a', '', x.f.name); a.href = fighterUrl(x.f.id); a.style.color = x.f.color;
        li.append(a, el('b', '', pct(x.r)), el('small', '', `${num(x.m.wins)}–${num(x.m.losses)}${x.m.draws ? `–${num(x.m.draws)}` : ''}`));
        ul.appendChild(li);
      }
      if (!rows.length) ul.appendChild(el('li', 's-rank-empty', `No matchup has ${MIN_CELL} matches yet.`));
      w.appendChild(ul); card.appendChild(w);
    };
    const best = rated.slice(0, SIDE), worst = rated.slice(Math.max(SIDE, rated.length - SIDE)).reverse();
    list(vs === 'cpu' ? 'BEST AGAINST THE CPU\'S' : 'BEST MATCHUPS', best);
    if (worst.length) list(vs === 'cpu' ? 'WORST AGAINST THE CPU\'S' : 'WORST MATCHUPS', worst);
    host.appendChild(card);
  }
  const note = box.querySelector('[data-stats-note]');
  if (note) note.textContent = 'All time, from every finished match. A win rate counts a draw as half a win.';
  box.classList.add('s-books-live');
}

if (box && roster.length) {
  fetch(rootUrl('api/stats'), { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((data) => {
      if (!data || !data.fighters || !data.matchups) throw new Error('bad stats');
      if (box.dataset.stats === 'home') home(data); else fighter(data, box.dataset.fighter);
    })
    .catch(() => { /* the static section stays as built */ });
}
