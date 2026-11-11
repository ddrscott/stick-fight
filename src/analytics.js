// Game analytics: small, cookieless events sent to the game's own Worker (POST ./api/e), which
// writes them to Cloudflare Workers Analytics Engine (README, Analytics). No player id, name or
// email ever goes out: just the event, a few short labels (a mode, a fighter id, a stage) and a
// number or a few (a match's result is the biggest: src/bookkeeping.js). Off on ?scene= test pages and on localhost, and when the browser asks not to be tracked.
// Every page sends its visit: the game (play/) and the site's pages, which name themselves with
// <html data-page="home" | "fighters" | "fighter:<id>">. The game inside the homepage's iframe names
// its visit "embed", so a homepage visit isn't counted twice as a game visit.
import { rootUrl, EMBEDDED } from './root.js';
import { linkFromUrl } from './links.js';

// For testing against a local Worker (npm run dev + npm run dev:worker): on localhost only,
// localStorage['stick-fight-track'] = '1' turns the events on (README, Analytics, Checking it locally).
const local = typeof window !== 'undefined' && /^(localhost|127\.)/.test(location.hostname);
const forced = local && (() => { try { return localStorage.getItem('stick-fight-track') === '1'; } catch { return false; } })();
const ok = typeof window !== 'undefined' && !new URLSearchParams(location.search).has('scene') && !window.__noAnalytics
  // Do Not Track, or Global Privacy Control (the newer signal, navigator.globalPrivacyControl), turns them off (the privacy page says so)
  && (forced || (location.protocol === 'https:' && !local && navigator.doNotTrack !== '1' && !(/** @type {any} */ (navigator).globalPrivacyControl)));

/** Are events going out from this page? The online result a page reports to its room follows it too. */
export const analyticsOn = ok;

function post(payload) {
  try {
    const body = JSON.stringify(payload);
    if (!(navigator.sendBeacon && navigator.sendBeacon(rootUrl('api/e').href, new Blob([body], { type: 'application/json' })))) {
      fetch(rootUrl('api/e'), { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  } catch { /* analytics never breaks the game */ }
}

export function track(event, labels = [], value = 0) {
  if (!ok) return;
  post({ e: event, l: labels.map(String).slice(0, 6), v: Number(value) || 0 });
}
/** Several events in one request (a match's end: its result and its move counts), at most 12.
 *  Each is { e, l?, v?, d? (more numbers), m? (a match, src/bookkeeping.js) }. */
export function trackAll(events) {
  if (!ok || !events.length) return;
  post(events.slice(0, 12));
}

if (ok) {
  // one visit per page load: touch or not, installed or not, where from (the referrer's host only)
  const touch = matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
  const app = (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone) ? 'app' : 'web';
  let ref = '';
  try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch { ref = ''; }
  // crew/<slug> and room/<CODE> (src/links.js); the old ?crew= and ?room= forms reach the page by a 301 to those
  const entry = linkFromUrl('crew') ? 'crew-link' : linkFromUrl('room') ? 'room-link' : 'direct';
  const page = document.documentElement.dataset.page || (EMBEDDED ? 'embed' : 'play');
  track('visit', [touch, app, ref, entry, page]);
  window.addEventListener('appinstalled', () => track('install'));
}
