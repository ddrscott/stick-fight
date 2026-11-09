// The app's root URL (/stick-fight/ in production, / on the dev server). Pages live at different depths
// (the homepage at the root, the game at play/, fighter pages at fighters/<id>/), so each page says how to
// get back to the root with <html data-root="../">. Everything shared at the root goes through here: the
// API, the service worker, version.json and the vendored music bundle. No data-root means the page is at
// the root.
const doc = typeof document !== 'undefined' ? document : null;
export const ROOT = new URL((doc && doc.documentElement.dataset.root) || './', doc ? doc.baseURI : 'http://localhost/');
/** a URL under the app's root, e.g. rootUrl('api/e') */
export const rootUrl = (path) => new URL(path, ROOT);
