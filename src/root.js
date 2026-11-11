// The app's root URL (/ on neonstickfight.com and the dev server; /stick-fight/ while the old address serves the game). Pages live at different depths
// (the homepage at the root, the game at play/, fighter pages at fighters/<id>/), so each page says how to
// get back to the root with <html data-root="../">. Everything shared at the root goes through here: the
// API, the service worker, version.json and the vendored music bundle. No data-root means the page is at
// the root.
const doc = typeof document !== 'undefined' ? document : null;
export const ROOT = new URL((doc && doc.documentElement.dataset.root) || './', doc ? doc.baseURI : 'http://localhost/');
/** a URL under the app's root, e.g. rootUrl('api/e') */
export const rootUrl = (path) => new URL(path, ROOT);

// Running inside another page's iframe (the homepage embeds the game, README "Site"). Reading
// window.top can throw for a cross-origin parent, which also means embedded.
let embedded = false;
try { embedded = typeof window !== 'undefined' && window.top !== window; } catch { embedded = true; }
export const EMBEDDED = embedded;

// The game also answers at a crew's or a room's own address (crew/<slug>, room/<CODE>; src/links.js), and
// moves the address bar between those and play/ with history.replaceState. A replaceState changes what a
// relative URL means unless the page has a <base>, so the page pins its base to where it loaded (the Worker
// already puts <base href=".../play/"> on crew/ and room/ pages, and that one stays).
if (doc && doc.head && !doc.querySelector('base')) {
  const b = doc.createElement('base');
  b.href = new URL('.', doc.baseURI).href;
  doc.head.prepend(b);
}
