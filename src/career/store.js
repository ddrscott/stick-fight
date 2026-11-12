// The player's career on this device (README, Progression): XP, sticks, owned palettes and the palette picked
// for each fighter. A guest's lives here, in localStorage (stick-fight-career). Signed in, the account is the
// source of truth (worker/career.ts) and this is its mirror: the page works out the same award the Worker will
// (src/career/rules.js) so the result screen shows it at once, then shows the Worker's answer when it comes.
//
//   career()               { ...Career, title }   the current numbers
//   onCareer(fn)           fn(career, last) on every change; returns an unsubscribe
//   reportMatch(m)         a match closed (src/bookkeeping.js onClose): pay it. m: { mode, won, cut, fought, parries,
//                          punishes, enders, accidents, perfects, floors }
//   fromRoom(msg)          the room's award for an online match ({ t:'sys', ev:'career', award, career })
//   last()                 the latest award: { award, before, after, promoted, at, mode, pending } or null
//   syncCareer()           match this device to whoever is signed in: a guest's progress merges into the account
//                          the first time (the larger of each number), a signed-out device starts fresh
//   buy(fighter, id)       { ok } | { error: 'short' | 'owned' | 'unreachable' | ... }
//   equip(fighter, id)     the palette to fight in ('' for the fighter's own look)
//   equipped(fighter)      that palette, or null
//   owns(fighter, id)
//   nudgeDue() / nudgeShown()   the save-your-sticks prompt for guests (NUDGE in rules.js)
//   resetCareer()          signing out or deleting the profile: this device starts fresh
//
// Every storage call is wrapped: blocked storage just means the career lives for this page.
import { payout, applyAward, blankCareer, titleFor, utcDay, NUDGE, PAID_MODES, ONLINE_MODES } from './rules.js';
import { palette, itemKey } from './palettes.js';
import { profile } from '../net/profile.js';
import { apiUrl } from '../net/link.js';

const KEY = 'stick-fight-career';
const ROOM_WAIT_MS = 8000;   // how long an online award waits for the room's word before asking the account
let memory = null;
/** @type {Set<(c: any, last: any) => void>} */
const subs = new Set();
let lastAward = null;

/** @returns {{ career: import('./rules.js').Career, email: string, nudge: { xp: number, title: number } }} */
function read() {
  let s = null;
  try { const raw = localStorage.getItem(KEY); if (raw) s = JSON.parse(raw); } catch { s = null; }
  if (!s && memory) s = memory;
  if (!s || typeof s !== 'object') s = {};
  const c = { ...blankCareer(), ...(s.career || {}) };
  c.owned = Array.isArray(c.owned) ? c.owned.filter((k) => typeof k === 'string') : [];
  c.equip = c.equip && typeof c.equip === 'object' && !Array.isArray(c.equip) ? c.equip : {};
  return { career: c, email: typeof s.email === 'string' ? s.email : '', nudge: s.nudge && typeof s.nudge === 'object' ? s.nudge : { xp: -1, title: -1 } };
}
function write(s) {
  memory = s;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage off: this page only */ }
}
const withTitle = (c) => ({ ...c, title: titleFor(c.xp).title });
function changed() { const c = career(); for (const fn of subs) { try { fn(c, lastAward); } catch (e) { console.error(e); } } }

export function career() { return withTitle(read().career); }
export function onCareer(fn) { subs.add(fn); return () => subs.delete(fn); }
export function last() { return lastAward; }

async function api(path, method = 'GET', body) {
  try {
    const res = await fetch(apiUrl(path), { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) return { error: (data && data.error) || (res.status === 429 ? 'busy' : 'unreachable') };
    return data || { error: 'unreachable' };
  } catch { return { error: 'unreachable' }; }
}

/** the account's numbers over this device's mirror */
function adopt(acct, email) {
  if (!acct || typeof acct !== 'object') return;
  const s = read();
  const c = { ...blankCareer(), ...acct };
  delete c.title;
  write({ ...s, career: c, email });
}

/** a new award: kept as `last` for the result screen, a promotion marked */
function setLast(before, after, award, mode, pending) {
  const b = titleFor(before.xp), a = titleFor(after.xp);
  lastAward = { award, before: withTitle(before), after: withTitle(after), promoted: a.i > b.i ? a.title : null, at: Date.now(), mode, pending };
}

/** A match closed: pay it. Returns the award (an estimate while a signed-in player waits for the server). */
export function reportMatch(m) {
  if (!m || !PAID_MODES.includes(m.mode)) return null;
  const s = read(), p = profile(), day = utcDay();
  const signed = !!p.email && s.email === p.email;
  const award = payout(m, s.career, day);
  if (!award.lines.length) return null;
  const after = applyAward(s.career, award, day);
  setLast(s.career, after, award, m.mode, signed);
  if (!signed) {
    write({ ...s, career: after });
    changed();
    return award;
  }
  // signed in: show the estimate now, then whatever the account says
  const email = p.email, at = lastAward.at, before = s.career;
  const settle = (r) => {
    if (!lastAward || lastAward.at !== at) { if (r && r.career) { adopt(r.career, email); changed(); } return; }
    if (r && r.career && r.award) { adopt(r.career, email); setLast(before, read().career, r.award, m.mode, false); }
    else if (r && r.career) { adopt(r.career, email); lastAward.pending = false; }
    else lastAward.pending = false;
    changed();
  };
  if (ONLINE_MODES.includes(m.mode)) {
    // the room awards it from the result both pages agreed on (fromRoom); if its word never comes, ask the account
    lastAward.wait = setTimeout(() => { if (lastAward && lastAward.at === at && lastAward.pending) api('career').then((r) => settle(r && r.career ? { career: r.career } : null)); }, ROOM_WAIT_MS);
  } else {
    api('career/match', 'POST', { m }).then((r) => settle(r && !r.error ? r : null));
  }
  changed();
  return award;
}

/** The room's award for this player's online match */
export function fromRoom(msg) {
  if (!msg || !msg.career) return;
  const email = profile().email;
  if (!email) return;
  const before = read().career;
  adopt(msg.career, email);
  if (lastAward && lastAward.pending && ONLINE_MODES.includes(lastAward.mode)) {
    clearTimeout(lastAward.wait);
    const prior = { ...lastAward.before };
    delete prior.title;
    setLast(prior, read().career, msg.award || lastAward.award, lastAward.mode, false);
  } else if (msg.award) setLast(before, read().career, msg.award, 'quick', false);
  changed();
}

let syncing = null;
/** Match this device to whoever is signed in. A guest's progress goes up to the account the first time. */
export function syncCareer() {
  syncing ??= (async () => {
    const p = profile(), s = read();
    if (!p.email) {
      if (s.email) { write({ career: blankCareer(), email: '', nudge: { xp: -1, title: -1 } }); changed(); }   // signed out elsewhere: start fresh
      return career();
    }
    if (s.email !== p.email) {
      // a guest (or another account's mirror, which the server ignores past the larger numbers) signing in: merge
      const guest = s.email ? blankCareer() : s.career;
      const r = await api('career/merge', 'POST', { career: guest });
      if (r && r.career) { adopt(r.career, p.email); changed(); }
    } else {
      const r = await api('career');
      if (r && r.career) { adopt(r.career, p.email); changed(); }
    }
    return career();
  })().finally(() => { syncing = null; });
  return syncing;
}

/** signing out or deleting the profile: this device starts fresh (the account keeps what it had) */
export function resetCareer() {
  write({ career: blankCareer(), email: '', nudge: { xp: -1, title: -1 } });
  lastAward = null;
  changed();
}

export function owns(fighter, id) { return !id || read().career.owned.includes(itemKey(fighter, id)); }
/** the palette picked for this fighter, or null for its own look */
export function equipped(fighter) {
  const c = read().career, id = c.equip[fighter];
  return id && c.owned.includes(itemKey(fighter, id)) ? palette(fighter, id) : null;
}

export async function buy(fighter, id) {
  const pal = palette(fighter, id);
  if (!pal) return { error: 'unknown' };
  const s = read(), p = profile();
  if (s.career.owned.includes(itemKey(fighter, id))) return { error: 'owned' };
  if (s.career.sticks < pal.price) return { error: 'short' };
  if (p.email && s.email === p.email) {
    const r = await api('career/buy', 'POST', { fighter, id });
    if (r && r.career) adopt(r.career, p.email);
    changed();
    return r && !r.error ? { ok: true } : { error: (r && r.error) || 'unreachable' };
  }
  write({ ...s, career: { ...s.career, sticks: s.career.sticks - pal.price, owned: [...s.career.owned, itemKey(fighter, id)], equip: { ...s.career.equip, [fighter]: id } } });
  changed();
  return { ok: true };
}

export function equip(fighter, id) {
  const s = read(), p = profile();
  if (id && !s.career.owned.includes(itemKey(fighter, id))) return false;
  const eq = { ...s.career.equip };
  if (id) eq[fighter] = id; else delete eq[fighter];
  write({ ...s, career: { ...s.career, equip: eq } });
  if (p.email && s.email === p.email) api('career/equip', 'PUT', { fighter, id: id || '' });
  changed();
  return true;
}

/** A guest with something to lose: after the first promotion or NUDGE.sticks, then only after more progress. */
export function nudgeDue() {
  const s = read(), p = profile();
  if (p.email) return false;
  const t = titleFor(s.career.xp);
  if (!(t.i >= 1 || s.career.sticks >= NUDGE.sticks)) return false;
  if (s.nudge.xp < 0) return true;
  return t.i > s.nudge.title || s.career.xp >= s.nudge.xp + NUDGE.againXp;
}
export function nudgeShown() {
  const s = read();
  write({ ...s, nudge: { xp: s.career.xp, title: titleFor(s.career.xp).i } });
}
