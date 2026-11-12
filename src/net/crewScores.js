// Crew high scores (README, Crew rooms, High scores): each crew keeps an ARCADE and a HORDE table, the top 10,
// on its Durable Object (worker/crew.ts). The rule for which runs count: a finished arcade or horde run, once
// its initials are in, posts to every crew on this device's recent list (the three the online menu shows)
// that the player is a member of. The server says no to the rest (not-member), so the page doesn't have to
// know. A run with no crew posts nowhere new; the local tables (src/flow/scores.js) work as before.
//
//   recentCrews()             [{ slug, name }] the crews a run posts to
//   loadBoards(force?)        fetch those crews' tables (cached a minute); resolves to the boards
//   boards()                  what's loaded: [{ slug, name, arcade: Row[], horde: Row[] }]
//   placeFor(kind, score)     the best place this score would take on a loaded crew board: { slug, name, rank } or null
//   postRun(run)              post a run to every recent crew: resolves to [{ slug, name, rank } | { slug, error }]
//   rowNote(kind, row)        'STAGE 4', 'ALL CLEAR', '3 FLOORS'
// A Row is { initials, score, char, reach, clear, at, title } (and member, from the lobby's own state); title is the
// poster's job title when they posted it (README, Progression), shown as AAA · MANAGER.

import { apiUrl } from './link.js';
import { profile } from './profile.js';
import { scoreCap } from '../flow/scorecap.js';

export const RECENT = 3;     // the crews the online menu shows, and a run posts to
export const BOARD = 10;
const FRESH_MS = 60 * 1000;
/** @type {Map<string, { slug: string, name: string, arcade: any[], horde: any[], at: number }>} */
const cache = new Map();

export function recentCrews() { return profile().crews.slice(0, RECENT).map((c) => ({ slug: c.slug, name: c.name })); }

/** one crew's tables, or null (no such crew, offline) */
async function fetchBoard(slug) {
  try {
    const res = await fetch(apiUrl(`crews/${encodeURIComponent(slug)}/scores`));
    if (!res.ok) return null;
    const b = await res.json();
    if (!b || !Array.isArray(b.arcade) || !Array.isArray(b.horde)) return null;
    return { slug, name: String(b.name || ''), arcade: b.arcade, horde: b.horde, at: Date.now() };
  } catch { return null; }
}
export async function loadBoards(force = false) {
  const list = recentCrews();
  await Promise.all(list.map(async (c) => {
    const had = cache.get(c.slug);
    if (!force && had && Date.now() - had.at < FRESH_MS) return;
    const b = await fetchBoard(c.slug);
    if (b) cache.set(c.slug, { ...b, name: b.name || c.name });
  }));
  return boards();
}
export function boards() {
  return recentCrews().map((c) => cache.get(c.slug)).filter(Boolean);
}
/** a board straight from the lobby's state (it's fresher than a fetch) */
export function noteBoard(slug, name, scores) {
  if (scores && Array.isArray(scores.arcade) && Array.isArray(scores.horde)) cache.set(slug, { slug, name, arcade: scores.arcade, horde: scores.horde, at: Date.now() });
}
/** the place (0..9) a score would take on a table, or -1 */
export function rankOn(rows, score) {
  if (!(score > 0)) return -1;
  const i = rows.findIndex((r) => score > r.score);
  return i >= 0 ? i : rows.length < BOARD ? rows.length : -1;
}
export function placeFor(kind, score) {
  let best = null;
  for (const b of boards()) {
    const rank = rankOn(b[kind], score);
    if (rank >= 0 && (!best || rank < best.rank)) best = { slug: b.slug, name: b.name, rank };
  }
  return best;
}
/**
 * @param {{ kind: 'arcade' | 'horde', initials: string, score: number, char: string, reach: number, clear?: boolean, title?: string }} run  title: the poster's job title
 */
export async function postRun(run) {
  const list = recentCrews();
  if (!list.length || !(run.score > 0) || run.score > scoreCap(run.kind, run.reach)) return [];
  const pid = profile().id;
  return Promise.all(list.map(async (c) => {
    try {
      const res = await fetch(apiUrl(`crews/${encodeURIComponent(c.slug)}/scores`), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pid, run: { ...run, clear: !!run.clear } }),
      });
      const body = await res.json().catch(() => null);
      if (body && body.ok) { cache.delete(c.slug); return { slug: c.slug, name: c.name, rank: Number(body.rank) }; }
      return { slug: c.slug, error: String((body && body.error) || res.status) };
    } catch { return { slug: c.slug, error: 'unreachable' }; }
  }));
}
export function rowNote(kind, r) {
  if (kind === 'horde') return `${r.reach} FLOOR${r.reach === 1 ? '' : 'S'}`;
  return r.clear ? 'ALL CLEAR' : `STAGE ${r.reach}`;
}
