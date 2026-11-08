// Installing the game as an app, so it opens fullscreen in landscape like a native game.
//   Android / desktop Chrome and Edge: the browser's own install prompt (beforeinstallprompt), offered
//     from an INSTALL button on the title.
//   iPhone / iPad Safari: there's no prompt and no Fullscreen API; the only way to full screen is
//     Share > Add to Home Screen, so the title's INSTALL button opens a short how-to instead.
//   Already installed (standalone): <html> gets .standalone and nothing is offered.
// The service worker (public/sw.js) makes the installed app start fast and play offline.

const nav = typeof navigator !== 'undefined' ? navigator : {};
const standalone = typeof matchMedia === 'function' && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches) || nav.standalone === true;
const ua = nav.userAgent || '';
const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1);   // iPadOS reports as a Mac
const iOSSafari = iOS && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);   // other iOS browsers can't add to the home screen the same way

let deferred = null;
const listeners = new Set();
const changed = () => { for (const f of listeners) { try { f(); } catch (e) { /* ignore */ } } };

export const install = {
  get standalone() { return standalone; },
  /** 'prompt' (the browser can install), 'ios' (show the Add to Home Screen how-to) or null */
  get kind() { return standalone ? null : deferred ? 'prompt' : iOSSafari ? 'ios' : null; },
  async prompt() {
    if (!deferred) return false;
    const e = deferred; deferred = null; changed();
    try { e.prompt(); const r = await e.userChoice; return r && r.outcome === 'accepted'; } catch (err) { return false; }
  },
  onChange(f) { listeners.add(f); return () => listeners.delete(f); },
};

if (typeof window !== 'undefined') {
  if (standalone) document.documentElement.classList.add('standalone');
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; changed(); });
  window.addEventListener('appinstalled', () => { deferred = null; changed(); });
  // the service worker only on a real deploy or the dev tunnel, never in the test harness (?scene=)
  if ('serviceWorker' in nav && location.protocol === 'https:' && !new URLSearchParams(location.search).has('scene')) {
    window.addEventListener('load', () => { nav.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {}); });
  }
  window.__install = install;
}
