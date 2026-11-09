// "A newer version is out": every build writes version.json with its build id (vite.config.ts) and
// bakes the same id into the page as __BUILD_ID__. This checks version.json shortly after load,
// every few minutes, and whenever the tab or app comes back; when it differs, an update is offered:
// an UPDATE button on the title (window.__update, read by src/flow/index.js) and a small pill on
// menu screens. It's never offered mid-fight or in an online session, where a reload would drop the
// room. Updating asks the service worker for the new version and reloads.

/* global __BUILD_ID__ */
import { rootUrl } from './root.js';

const BUILD = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
const CHECK_MS = 5 * 60 * 1000;
const listeners = new Set();
let latest = null;   // the newer build id, once seen

export const update = {
  get build() { return BUILD; },
  get available() { return !!latest; },
  onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  async apply() {
    try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) await reg.update(); } catch { /* no service worker */ }
    location.reload();
  },
  check,
};

async function check() {
  if (BUILD === 'dev' || latest) return;
  try {
    const r = await fetch(rootUrl(`version.json?t=${Date.now()}`), { cache: 'no-store' });
    if (!r.ok) return;
    const v = await r.json();
    if (v && typeof v.build === 'string' && v.build !== BUILD) { latest = v.build; for (const f of listeners) { try { f(); } catch { /* ignore */ } } paint(); }
  } catch { /* offline: try again later */ }
}

// the pill: menus only (not while fighting, not in an online session), tap or click to update;
// controller players get the UPDATE button on the title screen
let pill = null;
function busy() {
  const c = document.documentElement.classList;
  return c.contains('fl-play') || c.contains('online') || !!(window.__net && window.__net.busy);
}
function paint() {
  if (!latest || typeof document === 'undefined') return;
  if (!pill) {
    pill = document.createElement('button');
    pill.type = 'button'; pill.className = 'up-pill';
    pill.innerHTML = '<b>NEW VERSION</b><span>UPDATE</span>';
    pill.addEventListener('click', (e) => { e.stopPropagation(); update.apply(); });
    for (const t of ['pointerdown', 'touchstart']) pill.addEventListener(t, (e) => e.stopPropagation());
    const st = document.createElement('style');
    st.textContent = `.up-pill { position: fixed; z-index: 30; right: max(16px, env(safe-area-inset-right)); bottom: calc(max(10px, env(safe-area-inset-bottom)) + 15vh);
      display: flex; gap: 0.6em; align-items: center; padding: 6px 14px 4px; border: 2px solid #ffb02e; border-radius: 0; background: rgba(14,4,30,0.88);
      color: #fff0cf; font: 600 18px/1 'Teko', 'Arial Narrow', sans-serif; letter-spacing: 0.12em; cursor: pointer; box-shadow: 0 0 12px rgba(255,176,46,0.5); }
      .up-pill span { color: #0a0414; background: #ffb02e; padding: 3px 8px 1px; }
      .up-pill[hidden] { display: none; }`;
    document.head.appendChild(st); document.body.appendChild(pill);
  }
  pill.hidden = busy();
}

if (typeof window !== 'undefined' && BUILD !== 'dev' && !new URLSearchParams(location.search).has('scene')) {
  setTimeout(check, 20000);
  setInterval(check, CHECK_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('focus', check);
  // keep the pill out of fights and online sessions as screens change
  new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  window.__update = update;
}
