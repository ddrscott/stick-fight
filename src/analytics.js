// Game analytics: small, cookieless events sent to the game's own Worker (POST ./api/e), which
// writes them to Cloudflare Workers Analytics Engine (README, Analytics). No player id, name or
// email ever goes out: just the event, a few short labels (a mode, a fighter id, a stage) and a
// number. Off on ?scene= test pages and on localhost, and when the browser asks not to be tracked.
// Every page sends its visit: the game (play/) and the site's pages, which name themselves with
// <html data-page="home" | "fighters" | "fighter:<id>">. The game inside the homepage's iframe names
// its visit "embed", so a homepage visit isn't counted twice as a game visit.
import { rootUrl, EMBEDDED } from './root.js';

const ok = typeof window !== 'undefined' && location.protocol === 'https:' && !/^(localhost|127\.)/.test(location.hostname)
  && !new URLSearchParams(location.search).has('scene') && navigator.doNotTrack !== '1' && !window.__noAnalytics;

export function track(event, labels = [], value = 0) {
  if (!ok) return;
  try {
    const body = JSON.stringify({ e: event, l: labels.map(String).slice(0, 6), v: Number(value) || 0 });
    if (!(navigator.sendBeacon && navigator.sendBeacon(rootUrl('api/e').href, new Blob([body], { type: 'application/json' })))) {
      fetch(rootUrl('api/e'), { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  } catch { /* analytics never breaks the game */ }
}

if (ok) {
  // one visit per page load: touch or not, installed or not, where from (the referrer's host only)
  const touch = matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
  const app = (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone) ? 'app' : 'web';
  let ref = '';
  try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch { ref = ''; }
  const entry = new URLSearchParams(location.search).has('crew') ? 'crew-link' : new URLSearchParams(location.search).has('room') ? 'room-link' : 'direct';
  const page = document.documentElement.dataset.page || (EMBEDDED ? 'embed' : 'play');
  track('visit', [touch, app, ref, entry, page]);
  window.addEventListener('appinstalled', () => track('install'));
}
