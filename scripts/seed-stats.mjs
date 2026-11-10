#!/usr/bin/env node
// Made-up numbers for the stats rollups, as SQL on stdout, so the homepage's chart isn't empty in
// local dev or a screenshot (README, Analytics, Checking it locally). It replaces whatever is in
// the two tables. Local only: never pipe this at the production database.
//
//   node scripts/seed-stats.mjs > /tmp/seed.sql
//   npx wrangler d1 execute stick-fight-auth --local --file /tmp/seed.sql
//
// The same seed gives the same numbers: `node scripts/seed-stats.mjs 7` for another set.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker', 'roster.ts'), 'utf8');
const ids = src.slice(src.indexOf('FIGHTERS = [')).match(/\[([^\]]*)\]/)[1].match(/"([^"]+)"/g).map((x) => x.slice(1, -1));

let state = (Number(process.argv[2]) || 1) >>> 0;
const rnd = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const binom = (n, p) => { let k = 0; for (let i = 0; i < n; i++) if (rnd() < p) k++; return k; };

// each fighter: how strong it is and how popular; a few pairings get a lopsided twist
const power = Object.fromEntries(ids.map((id) => [id, (rnd() - 0.5) * 0.9]));
const fame = Object.fromEntries(ids.map((id, i) => [id, 0.25 + rnd() * rnd() * 3 + (i === 0 ? 2.5 : 0)]));   // everyone starts as the TEMP
const now = Date.now(), out = ['DELETE FROM stats_matchups;', 'DELETE FROM stats_picks;'];
const row = (a, b, vs, games, pA) => {
  if (!games) return;
  const draws = binom(games, 0.03), aWins = binom(games - draws, pA), bWins = games - draws - aWins;
  const secs = Math.round(games * (38 + rnd() * 40)), rounds = (w, l) => w * 2 + binom(l, 0.45);
  out.push(`INSERT INTO stats_matchups (a, b, vs, games, a_wins, b_wins, draws, secs, a_rounds, b_rounds, a_perfects, b_perfects, timeouts, updated_at) VALUES ('${a}', '${b}', '${vs}', ${games}, ${aWins}, ${bWins}, ${draws}, ${secs}, ${rounds(aWins, bWins)}, ${rounds(bWins, aWins)}, ${binom(aWins, 0.06)}, ${binom(bWins, 0.06)}, ${binom(games, 0.08)}, ${now});`);
};
const odds = (a, b, tilt = 0) => 1 / (1 + Math.exp(-(power[a] - power[b] + tilt) * 2.2));
for (const a of ids) for (const b of ids) {
  // vs CPU: the ladder's regulars get fought far more than the rest, and the player usually wins
  const ladder = ['intern', 'helpdesk', 'courier', 'security', 'janitor', 'manager'].indexOf(b);
  const cpuGames = Math.round(fame[a] * (ladder >= 0 ? 60 - ladder * 8 : rnd() < 0.5 ? 9 : 2) * (0.5 + rnd()));
  row(a, b, 'cpu', cpuGames, odds(a, b, 0.35 - Math.max(0, ladder) * 0.09));
  if (a <= b) row(a, b, 'pvp', rnd() < 0.12 ? Math.round(rnd() * 4) : Math.round(fame[a] * fame[b] * 9 * (0.4 + rnd())), a === b ? 0.5 : odds(a, b, (rnd() - 0.5) * 0.5));
}
for (const id of ids) for (const [mode, k] of [['arcade', 220], ['horde', 60], ['training', 45], ['dummy', 30], ['quick', 70], ['crew', 40]]) {
  out.push(`INSERT INTO stats_picks (fighter, mode, picks, updated_at) VALUES ('${id}', '${mode}', ${Math.round(fame[id] * k * (0.6 + rnd() * 0.8))}, ${now});`);
}
process.stdout.write(out.join('\n') + '\n');
