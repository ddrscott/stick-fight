// Score rules and the high score tables. Two top-5 tables (arcade and horde), kept in
// localStorage under one key. The key starts with stick-fight- from when the origin was shared
// with every app on askscottpierce.com (kept, so nothing resets), and every storage call is
// wrapped: a private window or blocked storage just means the table lives for this page only.

export const POINTS = {
  damage: 10,   // per point of health you take off
  comboHit: 30,   // per hit past the first in a combo, times its place (2nd +30, 3rd +60, ...)
  counter: 200,
  ender: 500,
  trick: 300,   // wall splat, wall bounce, ground bounce
  floorBreak: 1000,
  throwBreak: 300,
  finish: 1000,   // a KO by an ender
  roundWin: 1000,
  timeBonus: 100,   // per whole second left on the clock when you win a round
  perfect: 5000,   // won a round without taking a hit
  stageClear: 2000,   // times the stage number
  goonDown: 300,   // horde
  floorClear: 2000,   // horde
};

/** @typedef {'arcade' | 'horde'} Mode */
/** @typedef {{ name: string, score: number, note: string, title?: string }} Row  title: the player's job title when they signed it (README, Progression) */
import { TITLES } from '../career/rules.js';

const KEY = 'stick-fight-scores';
const DEFAULTS = {
  arcade: [
    { name: 'SCO', score: 60000, note: 'STAGE 6' },
    { name: 'NEO', score: 40000, note: 'STAGE 4' },
    { name: 'ZAP', score: 25000, note: 'STAGE 3' },
    { name: 'KIX', score: 12000, note: 'STAGE 2' },
    { name: 'JAB', score: 5000, note: 'STAGE 1' },
  ],
  horde: [
    { name: 'SCO', score: 30000, note: '4 FLOORS' },
    { name: 'NEO', score: 20000, note: '3 FLOORS' },
    { name: 'ZAP', score: 12000, note: '2 FLOORS' },
    { name: 'KIX', score: 6000, note: '1 FLOOR' },
    { name: 'JAB', score: 2500, note: '0 FLOORS' },
  ],
};
let memory = null;   // when storage is off

function readAll() {
  let all = null;
  try { const raw = localStorage.getItem(KEY); if (raw) all = JSON.parse(raw); } catch { all = null; }
  if (!all && memory) all = memory;
  const clean = (rows, mode)=> (Array.isArray(rows) ? rows : DEFAULTS[mode])
    .filter((r) => r && typeof r.score === 'number')
    .map((r) => ({ name: String(r.name || '???').slice(0, 3).toUpperCase(), score: Math.max(0, Math.floor(r.score)), note: String(r.note || ''), ...(TITLES.includes(r.title) ? { title: r.title } : {}) }))
    .sort((a, b) => b.score - a.score).slice(0, 5);
  return { arcade: clean(all && all.arcade, 'arcade'), horde: clean(all && all.horde, 'horde') };
}
function writeAll(all) {
  memory = all;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage off: the table lives in memory */ }
}

export function table(mode) { return readAll()[mode]; }
/** The place (0..4) this score would take, or -1. */
export function rankFor(mode, score) {
  if (score <= 0) return -1;
  const rows = table(mode);
  const i = rows.findIndex(r => score > r.score);
  return i >= 0 ? i : rows.length < 5 ? rows.length : -1;
}
/** Insert a row; returns its place (0..4) or -1. */
export function addScore(mode, row) {
  const all = readAll();
  const rows = all[mode];
  let i = rows.findIndex(r => row.score > r.score);
  if (i < 0) i = rows.length;
  if (i >= 5) return -1;
  rows.splice(i, 0, row);
  all[mode] = rows.slice(0, 5);
  writeAll(all);
  return i;
}
export function fmt(n) { return Math.max(0, Math.floor(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
