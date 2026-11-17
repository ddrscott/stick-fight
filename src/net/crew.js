// The crew room's lobby connection (worker/crew.ts): one WebSocket to the crew's Durable Object,
// open while the player is in the crew lobby or in a match the crew started. It carries presence,
// PLAY, the standings and the results; the match itself runs in a quick room (online.js) the crew
// opens for the two players.
//
//   const crew = createCrew()
//   crew.connect(slug, { pid, name, title })   open (or switch to) a crew; reconnects by itself if dropped
//                          (title: the player's job title, shown beside their initials on the crew goal)
//   crew.on('state' | 'match' | 'rotate' | 'watch' | 'goalpay' | 'error' | 'status', fn)
//                          goalpay: the crew's weekly goal was met and paid this player (src/career/store.js fromCrewGoal)
//                          watch: { match, code, ticket } while this member is in line and a match is on the court
//                          (the ticket lets src/net/watch.js into that match room), null when not
//   crew.play(on)          PLAY: the end of the line (README, Crew rooms, Champ of the Court); off: LEAVE LINE
//   crew.lobby(title?)     back in the lobby after a match (with the title, which a promotion may have changed)
//   crew.result(r)         the host reports a match: { match, n, winner, wins, chars }
//   crew.rename(name)
//   crew.close()
//   crew.state             the last state ({ crew, members, h2h, recent, court, champ, line }), crew.you (this member's id)
//   crew.watching          the last watch ticket ({ match, code, ticket }) or null
//   crew.spot              this member's place in line: -1 not in it, 0 up now, 1, 2, 3...

import { apiUrl } from './link.js';
import { linkUrl } from '../links.js';

const RETRY_MS = [1000, 2000, 4000, 8000];
const PING_EVERY_MS = 2000;   // the lobby meter's ping
const FATAL = new Set(['no-crew', 'crew-full', 'bad-hello', 'full', 'deleted']);   // deleted: this profile was deleted (worker/crew.ts forget)

export function createCrew() {
  /** @type {Record<string, Function[]>} */
  const handlers = {};
  const emit = (ev, ...a) => { for (const f of handlers[ev] || []) { try { f(...a); } catch (e) { console.error(e); } } };
  /** @type {WebSocket | null} */ let ws = null;
  let slug = '', hello = null, want = false, tries = 0, timer = 0, status = 'closed';
  /** @type {any} */ let state = null;
  let you = '', ready = false;
  /** @type {null | { match: string, code: string, ticket: string }} */ let watching = null;

  function setStatus(s) { if (s !== status) { status = s; emit('status', s); } }
  function send(msg) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
  // the lobby's connection meter (src/net/meter.js): a ping every PING_EVERY_MS, which the crew room answers 'pong'
  // itself without waking (worker/crew.ts); the round trip and its jitter
  let pingOut = 0, qRtt = 0, qJit = 0, qN = 0, pinger = 0;
  function pingNow() { if (ws && ws.readyState === WebSocket.OPEN && !pingOut) { pingOut = performance.now(); try { ws.send('ping'); } catch { /* */ } } else if (pingOut && performance.now() - pingOut > 5000) pingOut = 0; }
  function open() {
    clearTimeout(timer);
    const url = apiUrl(`crews/${encodeURIComponent(slug)}/ws`, true);
    const sock = new WebSocket(url);
    ws = sock;
    setStatus(tries ? 'reconnecting' : 'connecting');
    sock.onopen = () => { if (ws !== sock) return; send({ t: 'hello', ...hello }); };
    sock.onmessage = (e) => {
      if (ws !== sock || typeof e.data !== 'string') return;
      if (e.data === 'pong') {
        if (pingOut) { const ms = performance.now() - pingOut; pingOut = 0; if (!qN) { qRtt = ms; qJit = 0; } else { qJit += (Math.abs(ms - qRtt) - qJit) * 0.25; qRtt += (ms - qRtt) * 0.25; } qN++; }
        return;
      }
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'sys' && m.ev === 'error') m = { t: 'error', reason: m.reason };   // the Worker's refusal (busy)
      if (m.t === 'welcome') {
        you = String(m.you || ''); tries = 0; setStatus('open');
        pingOut = 0; pingNow(); clearInterval(pinger); pinger = window.setInterval(pingNow, PING_EVERY_MS);
        if (ready) send({ t: 'play', on: true });   // a reconnect keeps a pending PLAY (the room keeps the place a while)
      } else if (m.t === 'state') {
        state = m;
        // the room's word on the line wins: a rotation put this member back in it, or they're out of it
        if (you && Array.isArray(m.line)) ready = m.line.some((x) => x && x.id === you);
        emit('state', m);
      } else if (m.t === 'match') { ready = false; watching = null; emit('match', m); }
      else if (m.t === 'rotate') emit('rotate', m);
      else if (m.t === 'watch') {
        watching = m.match && typeof m.code === 'string' && typeof m.ticket === 'string' ? { match: String(m.match), code: m.code, ticket: m.ticket } : null;
        emit('watch', watching);
      }
      else if (m.t === 'goalpay') emit('goalpay', m);
      else if (m.t === 'error') {
        if (FATAL.has(m.reason)) want = false;
        emit('error', String(m.reason || 'error'));
      }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null; clearInterval(pinger); pingOut = 0; qN = 0;
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
    play(on) { ready = !!on; if (!on) watching = null; send({ t: 'play', on: !!on }); },
    /** back in the lobby (or on to watch) after a match: the room keeps a rotation's place in line */
    lobby(title) { if (hello && title) hello.title = title; send({ t: 'lobby', title: title || '' }); },
    result(r) { send({ t: 'result', ...r }); },
    rename(name) { if (hello) hello.name = name; send({ t: 'name', name }); },
    close() {
      want = false; clearTimeout(timer); clearInterval(pinger); pingOut = 0; qN = 0; ready = false; watching = null;
      if (ws) { const w = ws; ws = null; try { w.close(1000, 'bye'); } catch { /* gone */ } }
      slug = ''; state = null; you = ''; setStatus('closed');
    },
    get slug() { return slug; },
    /** this page's connection to the crew room, for the lobby's meter: { rtt, jitter, samples } (0 samples: no reading) */
    get quality() { return { rtt: qRtt, jitter: qJit, loss: 0, samples: status === 'open' ? qN : 0 }; },
    get state() { return state; },
    get you() { return you; },
    get ready() { return ready; },
    get watching() { return watching; },
    get spot() { const l = state && Array.isArray(state.line) ? state.line.find((x) => x && x.id === you) : null; return l ? l.spot | 0 : -1; },
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
