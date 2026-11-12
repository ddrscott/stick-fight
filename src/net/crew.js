// The crew room's lobby connection (worker/crew.ts): one WebSocket to the crew's Durable Object,
// open while the player is in the crew lobby or in a match the crew started. It carries presence,
// PLAY, the standings and the results; the match itself runs in a quick room (online.js) the crew
// opens for the two players.
//
//   const crew = createCrew()
//   crew.connect(slug, { pid, name, title })   open (or switch to) a crew; reconnects by itself if dropped
//                          (title: the player's job title, shown beside their initials on the crew goal)
//   crew.on('state' | 'match' | 'rotate' | 'goalpay' | 'error' | 'status', fn)
//                          goalpay: the crew's weekly goal was met and paid this player (src/career/store.js fromCrewGoal)
//   crew.play(on, stay?)   ready to fight whoever else is ready (stay: the winner staying on goes first)
//   crew.lobby(title?)     back in the lobby after a match (with the title, which a promotion may have changed)
//   crew.result(r)         the host reports a match: { match, n, winner, wins, chars }
//   crew.rename(name)
//   crew.close()
//   crew.state             the last state ({ crew, members, h2h, recent }), crew.you (this member's id)

import { apiUrl } from './link.js';
import { linkUrl } from '../links.js';

const RETRY_MS = [1000, 2000, 4000, 8000];
const FATAL = new Set(['no-crew', 'crew-full', 'bad-hello', 'full', 'deleted']);   // deleted: this profile was deleted (worker/crew.ts forget)

export function createCrew() {
  /** @type {Record<string, Function[]>} */
  const handlers = {};
  const emit = (ev, ...a) => { for (const f of handlers[ev] || []) { try { f(...a); } catch (e) { console.error(e); } } };
  /** @type {WebSocket | null} */ let ws = null;
  let slug = '', hello = null, want = false, tries = 0, timer = 0, status = 'closed';
  /** @type {any} */ let state = null;
  let you = '', ready = false, stay = false;

  function setStatus(s) { if (s !== status) { status = s; emit('status', s); } }
  function send(msg) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
  function open() {
    clearTimeout(timer);
    const url = apiUrl(`crews/${encodeURIComponent(slug)}/ws`, true);
    const sock = new WebSocket(url);
    ws = sock;
    setStatus(tries ? 'reconnecting' : 'connecting');
    sock.onopen = () => { if (ws !== sock) return; send({ t: 'hello', ...hello }); };
    sock.onmessage = (e) => {
      if (ws !== sock || typeof e.data !== 'string') return;
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'sys' && m.ev === 'error') m = { t: 'error', reason: m.reason };   // the Worker's refusal (busy)
      if (m.t === 'welcome') {
        you = String(m.you || ''); tries = 0; setStatus('open');
        if (ready) send({ t: 'play', on: true, stay });   // a reconnect keeps a pending PLAY
      } else if (m.t === 'state') { state = m; emit('state', m); }
      else if (m.t === 'match') { ready = false; stay = false; emit('match', m); }
      else if (m.t === 'rotate') emit('rotate', m);
      else if (m.t === 'goalpay') emit('goalpay', m);
      else if (m.t === 'error') {
        if (FATAL.has(m.reason)) want = false;
        emit('error', String(m.reason || 'error'));
      }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      if (!want) { setStatus('closed'); return; }
      setStatus('reconnecting');
      timer = window.setTimeout(open, RETRY_MS[Math.min(tries++, RETRY_MS.length - 1)]);
    };
  }

  const crew = {
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return () => { const l = handlers[ev]; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; },
    connect(s, who) {
      hello = { pid: who.pid, name: who.name, title: who.title || '' };
      if (s === slug && want && ws) { send({ t: 'name', name: who.name }); return; }
      crew.close();
      slug = s; want = true; tries = 0; state = null; you = '';
      open();
    },
    play(on, stayOn = false) { ready = !!on; stay = !!on && stayOn; send({ t: 'play', on: !!on, stay: !!stayOn }); },
    lobby(title) { ready = false; stay = false; if (hello && title) hello.title = title; send({ t: 'lobby', title: title || '' }); },
    result(r) { send({ t: 'result', ...r }); },
    rename(name) { if (hello) hello.name = name; send({ t: 'name', name }); },
    close() {
      want = false; clearTimeout(timer); ready = false; stay = false;
      if (ws) { const w = ws; ws = null; try { w.close(1000, 'bye'); } catch { /* gone */ } }
      slug = ''; state = null; you = ''; setStatus('closed');
    },
    get slug() { return slug; },
    get state() { return state; },
    get you() { return you; },
    get ready() { return ready; },
    get status() { return status; },
    get active() { return want; },
  };
  return crew;
}

/** a new crew room: { slug, name } or { error } ('bad-name', 'busy', 'unreachable') */
export async function createCrewRoom(name) {
  try {
    const res = await fetch(apiUrl('crews'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !body.slug) return { error: (body && body.error) || (res.status === 429 ? 'busy' : 'unreachable') };
    return { slug: String(body.slug), name: String(body.name || name) };
  } catch { return { error: 'unreachable' }; }
}

/** a crew slug from what was typed or pasted (the slug, a crew/<slug> link, or an old one with ?crew=), or '' */
export function cleanSlug(raw) {
  let s = String(raw || '').trim();
  const m = s.match(/\/crew\/([^/?&#\s]+)/) || s.match(/[?&]crew=([^&#\s]+)/);
  if (m) { try { s = decodeURIComponent(m[1]); } catch { s = m[1]; } }
  s = s.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length >= 3 && s.length <= 40 ? s : '';
}

/** the crew's permanent link: <root>crew/<slug> (src/links.js) */
export function crewLink(slug) {
  return linkUrl('crew', slug).href;
}
