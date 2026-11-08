// The player's profile: a random player id and a display name, kept in localStorage
// (stick-fight-player), plus the crew rooms this player has been in. No account is needed to
// play. SAVE MY PROFILE links the id to an email through the Worker (worker/auth.ts), so signing
// in on another device restores the same id, name and crews. The id is the player's key: it goes
// only to our own server (crew rooms keep a hash of it), never to another player; the name is the
// only thing other players see. Every storage call is wrapped: a private window or blocked storage
// just means the profile lives for this page.
//
//   profile()                 { id, name, email, crews: [{ slug, name, at }] }
//   setName(name)             saves it (and to the account when signed in); false if it isn't a name
//   rememberCrew(slug, name)  puts a crew at the top of the list
//   syncProfile()             asks the server who's signed in here (the session cookie) and adopts it
//   startSignIn(email)        { ok, devCode?, devLink? } or { error }
//   verifySignIn(email, code) { ok, restored } or { error, left? }
//   signOut()                 ends the session and forgets this device's profile (a fresh id)

import { apiUrl } from './link.js';

const KEY = 'stick-fight-player';
const MAX_CREWS = 20;
let memory = null;   // when storage is off

function newId() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''); }
const ID_RE = /^[0-9a-f]{32}$/;

/** a display name: 3 to 12 letters, digits and single spaces, upper case; '' if it isn't one */
export function cleanName(raw, min = 3, max = 12) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  return s.length >= min && s.length <= max ? s : '';
}

function read() {
  let p = null;
  try { const raw = localStorage.getItem(KEY); if (raw) p = JSON.parse(raw); } catch { p = null; }
  if (!p && memory) p = memory;
  if (!p || typeof p !== 'object' || !ID_RE.test(p.id)) p = { id: newId(), name: '', email: '', crews: [] };
  p.name = cleanName(p.name) || '';
  p.email = typeof p.email === 'string' ? p.email : '';
  p.crews = Array.isArray(p.crews) ? p.crews.filter((c) => c && typeof c.slug === 'string' && typeof c.name === 'string').slice(0, MAX_CREWS) : [];
  return p;
}
function write(p) {
  memory = p;
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage off: this page only */ }
}

/** the profile (made and saved the first time it's asked for) */
export function profile() {
  const p = read();
  if (!memory) write(p);
  return p;
}

async function api(path, method = 'GET', body) {
  const res = await fetch(apiUrl(path), {
    method, credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) return { error: (data && data.error) || (res.status === 429 ? 'busy' : 'unreachable'), left: data && data.left, status: res.status };
  return data;
}

/** save the name here, and on the account when signed in. False if it isn't a name. */
export function setName(name) {
  const n = cleanName(name);
  if (!n) return false;
  const p = read(); p.name = n; write(p);
  if (p.email) api('me', 'PUT', { name: n }).catch(() => {});
  return true;
}

/** a crew at the top of the list (and on the account when signed in) */
export function rememberCrew(slug, name) {
  if (!slug) return;
  const p = read();
  const c = { slug, name: String(name || slug).toUpperCase().slice(0, 20), at: Date.now() };
  p.crews = [c, ...p.crews.filter((x) => x.slug !== slug)].slice(0, MAX_CREWS);
  write(p);
  if (p.email) api('me', 'PUT', { crews: [c] }).catch(() => {});
}

/** the account's profile over this device's: its id and name win, the crew lists merge */
function adopt(acct) {
  const p = read();
  const restored = acct.pid !== p.id;
  const crews = [...(acct.crews || []), ...p.crews];
  const merged = [];
  for (const c of crews.sort((a, b) => (b.at || 0) - (a.at || 0))) if (!merged.some((m) => m.slug === c.slug)) merged.push(c);
  write({ id: acct.pid, name: cleanName(acct.name) || p.name, email: acct.email, crews: merged.slice(0, MAX_CREWS) });
  // anything this device knew that the account didn't goes up too (and a name the account lacks)
  const extra = p.crews.filter((c) => !(acct.crews || []).some((a) => a.slug === c.slug));
  if (extra.length || (!cleanName(acct.name) && p.name)) api('me', 'PUT', { crews: extra, ...(!cleanName(acct.name) && p.name ? { name: p.name } : {}) }).catch(() => {});
  return restored;
}

let syncing = null;
/** who's signed in on this browser (the cookie): adopt the account's profile, or note the session ended */
export function syncProfile() {
  syncing ??= api('me').then((acct) => {
    if (acct && !acct.error && acct.pid) adopt(acct);
    else if (acct === null) { const p = read(); if (p.email) { p.email = ''; write(p); } }
    return profile();
  }).catch(() => profile()).finally(() => { setTimeout(() => { syncing = null; }, 5000); });
  return syncing;
}

export async function startSignIn(email) {
  try { return await api('auth/start', 'POST', { email, page: location.origin + location.pathname }); } catch { return { error: 'unreachable' }; }
}
export async function verifySignIn(email, code) {
  const p = read();
  let r;
  try { r = await api('auth/verify', 'POST', { email, code, pid: p.id, name: p.name }); } catch { return { error: 'unreachable' }; }
  if (!r || r.error) return r || { error: 'unreachable' };
  const restored = adopt(r);
  syncing = null;
  return { ok: true, restored, name: read().name };
}
export async function signOut() {
  try { await api('auth/logout', 'POST', {}); } catch { /* the cookie goes when it expires */ }
  write({ id: newId(), name: '', email: '', crews: [] });
}
