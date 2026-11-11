// Neon Stick Fight service worker: the installed app opens fast and plays offline.
// It sits at the app's root (/stick-fight/sw.js), so its scope covers every page: the homepage, the game
// at play/ (where the installed app starts) and the fighter pages.
// Hashed build files (assets/*) never change, so they're cache-first; pages and everything else are
// network-first with the cache as the fallback, so a deploy shows up on the next launch. Offline, a page
// that was never cached falls back to the game. The API (rooms, ICE) and other origins (fonts, analytics)
// are left to the network.
// A crew's or a room's own address (crew/<slug>, room/<CODE>) is inside the scope too: online it's the
// Worker's page (which carries <base href=".../play/">) and is cached under its address like any page.
// Offline and never cached, it falls back to the cached game with that <base> added, so its play/-relative
// paths resolve and the game reads the slug or code from the address.
const CACHE = 'stick-fight-v3';
const GAME = './play/';
const CORE = [GAME, './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('stick-fight-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.includes('/api/')) return;
  const scope = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scope)) return;
  if (url.pathname.startsWith(scope + 'assets/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })));
    return;
  }
  // version.json is how a running game learns a new build is out: never answer it from the cache
  if (url.pathname === scope + 'version.json') return;
  const link = req.mode === 'navigate' && /^(crew|room)\/[^/]+\/?$/.test(url.pathname.slice(scope.length));
  e.respondWith(fetch(req).then((res) => { if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
    .catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((hit) => hit || (link ? gameAt(scope) : req.mode === 'navigate' ? caches.match(GAME) : Response.error()))));
});

/** the cached game page with <base href="<scope>play/">, for a crew/ or room/ address opened offline */
async function gameAt(scope) {
  const hit = await caches.match(GAME);
  if (!hit) return Response.error();
  const html = (await hit.text()).replace(/<head>/i, `<head><base href="${scope}play/">`);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
