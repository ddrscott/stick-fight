// Shared crew and room links unfurl as that room (README, Site, Share image). Against the local Worker:
//
//   npm run build && npm run dev:worker      (the Worker serving dist/ and the API on :8787; .dev.vars with DEV_HOOKS=1)
//   node scripts/og/check.mjs [http://127.0.0.1:8787/] [--out dir]
//
// First the image's text layout, in Node: every crew name the rules allow fits in two lines clear of the
// fighters. Then through the Worker, as the unfurl bots see it (plain HTTP, no script): a crew link
// (crew/<slug>) is a 200 with the game page and the crew's tags, the same for every user agent, and a
// <base> that makes every path in the page resolve; an unknown or expired crew, a bad room code and plain
// play/ get the default tags; a room link (room/<CODE>) gets its own; the old forms play/?crew=, /?crew=,
// play/?room= and /?room= are a 301 to the clean link with the rest of the query kept; the images are
// JPEGs of 1200x630, small enough for WhatsApp, and a made-up version is sent to the real one.
// --out saves each image. Exit code 1 on any failure.
import fs from 'node:fs';
import { fitName, textWidth, NAME_W } from '../../worker/og-layout.ts';

const argv = process.argv.slice(2);
const BASE = (argv.find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/').replace(/\/?$/, '/');
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : '';
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

// ---- layout -----------------------------------------------------------------------------------------
// names are A-Z, 0-9 and single spaces, 3 to 20 long (worker/env.ts cleanName)
const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
let seed = 7;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const names = ['ABC', 'WWWWWWWWWWWWWWWWWWWW', 'MMMMMMMMMM MMMMMMMMM', 'W W W W W W W W W W', 'THE MIDNIGHT LUNCHER', 'I I'];
for (let i = 0; i < 20000; i++) {
  const len = 3 + rnd(18);
  let s = '';
  while (s.length < len) s += rnd(5) === 0 && s && !s.endsWith(' ') && s.length < len - 1 ? ' ' : AZ[rnd(AZ.length)];
  names.push(s.trim());
}
let worst = { w: 0, name: '' }, smallest = { size: 999, name: '' }, bad = [];
for (const n of names) {
  const { size, lines } = fitName(n);
  const w = Math.max(...lines.map((l) => textWidth(l, 'bungee', size)));
  if (lines.length > 2 || w > NAME_W || lines.join(' ') !== n.replace(/\s+/g, ' ')) bad.push(n);
  if (w > worst.w) worst = { w, name: n };
  if (size < smallest.size) smallest = { size, name: n };
}
check(`layout: ${names.length} names fit in two lines under ${NAME_W} px, nothing dropped`, !bad.length, bad.length ? bad.slice(0, 3).join(' | ') : `widest ${Math.round(worst.w)} px, smallest ${smallest.size} px for ${smallest.name}`);
check('layout: a 20-letter word still gets 40 px or more', fitName('WWWWWWWWWWWWWWWWWWWW').size >= 40);

// ---- through the Worker ----------------------------------------------------------------------------
const UAS = {
  imessage: 'facebookexternalhit/1.1 Facebot Twitterbot/1.0',
  facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  twitter: 'Twitterbot/1.0',
  discord: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  linkedin: 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  whatsapp: 'WhatsApp/2.23.20.0',
  chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
};
const get = (url, ua = UAS.chrome) => fetch(url, { headers: { 'user-agent': ua }, redirect: 'manual' });
const tags = (html) => Object.fromEntries([...html.matchAll(/<meta (?:property|name)="((?:og|twitter):[^"]+)" content="([^"]*)">/g)].map((m) => [m[1], m[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")]));
const page = async (q, ua) => tags(await (await get(`${BASE}play/${q}`, ua)).text());
/** a clean link's page: crew/<slug> or room/<CODE>, which must answer 200 itself (no redirect) */
const clean = async (path, ua) => { const res = await get(`${BASE}${path}`, ua); return { status: res.status, html: await res.text() }; };
/** every relative URL in a page (src, href, the @font-face urls), resolved against its <base>, must load */
async function resolves(html, name, at) {
  const base = /<base href="([^"]+)">/.exec(html);
  const root = new URL(base ? base[1] : 'play/', new URL(at, BASE));
  const refs = new Set([...html.matchAll(/(?:src|href)="([^"]+)"|url\(([^)]+)\)/g)].map((m) => (m[1] || m[2]).replace(/^['"]|['"]$/g, '')).filter((u) => !/^(https?:|data:|#|mailto:)/.test(u)));
  const bad = [];
  for (const u of refs) { const res = await fetch(new URL(u, root)); if (res.status !== 200) bad.push(`${u} ${res.status}`); }
  check(`${name}: the <base> is first in <head> and all ${refs.size} of its relative paths load`, base && /<head><base /.test(html) && !bad.length, bad.slice(0, 4).join(', ') || base?.[1]);
}
/** a JPEG's size from its frame header */
function jpegSize(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (m >= 0xc0 && m <= 0xc2) return { w: (b[i + 7] << 8) | b[i + 8], h: (b[i + 5] << 8) | b[i + 6] };
    i += 2 + len;
  }
  return null;
}
const local = (u) => u.replace(/^https:\/\/neonstickfight\.com\//, BASE);
async function image(url, name) {
  const res = await get(local(url));
  const buf = new Uint8Array(await res.arrayBuffer());
  const dim = jpegSize(buf);
  check(`${name}: image is a 1200x630 JPEG under 300 KB`, res.status === 200 && res.headers.get('content-type') === 'image/jpeg' && dim && dim.w === 1200 && dim.h === 630 && buf.length < 300 * 1024,
    `${res.status} ${res.headers.get('content-type')} ${dim ? `${dim.w}x${dim.h}` : '?'} ${Math.round(buf.length / 1024)} KB`);
  check(`${name}: image caches as immutable`, /immutable/.test(res.headers.get('cache-control') || ''), res.headers.get('cache-control'));
  if (OUT) fs.writeFileSync(`${OUT}/${name}.jpg`, buf);
}
const crew = async (name) => {
  const res = await fetch(BASE + 'api/crews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  return (await res.json()).slug;
};
async function members(slug, n) {
  for (let i = 0; i < n; i++) {
    const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}api/crews/${slug}/ws`);
    await new Promise((r) => { ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', pid: (0xc0ffee00 + i).toString(16).padStart(32, '0'), name: `PLAYER ${i}` })); setTimeout(() => { ws.close(); r(); }, 300); }; ws.onerror = r; });
  }
}

try {
  const def = await page('');
  check('plain play/: the default tags with og.jpg', def['og:title'] === 'Neon Stick Fight' && def['og:image'] === 'https://neonstickfight.com/og.jpg' && def['twitter:card'] === 'summary_large_image', def['og:image']);
  const plain = await (await get(`${BASE}play/`)).text();
  check('plain play/: the same bytes for a bot as for a browser', plain === await (await get(`${BASE}play/`, UAS.slack)).text());

  const slug = await crew('Rock n Roll 2');
  check('made a crew', !!slug, slug);
  await members(slug, 2);
  const seen = {};
  for (const [k, ua] of Object.entries(UAS)) { const c = await clean(`crew/${slug}`, ua); seen[k] = JSON.stringify([c.status, tags(c.html)]); }
  const first = await clean(`crew/${slug}`);
  check('crew/<slug>: a 200 with the game page, no redirect', first.status === 200 && /<canvas|id="stage"/.test(first.html), String(first.status));
  await resolves(first.html, 'crew/<slug>', `crew/${slug}`);
  check('crew link: the same tags for every user agent', new Set(Object.values(seen)).size === 1, Object.keys(UAS).join(', '));
  const t = JSON.parse(seen.imessage)[1];
  check('crew link: og:title names the crew', t['og:title'] === 'Join ROCK N ROLL 2 on Neon Stick Fight', t['og:title']);
  check('crew link: og:description has the member count and no member names', /2 fighters in the crew/.test(t['og:description']) && !/PLAYER/.test(JSON.stringify(t)), t['og:description']);
  check('crew link: og:url is the clean crew link', t['og:url'] === `https://neonstickfight.com/crew/${slug}`, t['og:url']);
  check('crew link: og:image is its own image', new RegExp(`/api/og/crew/${slug}\\.jpg\\?v=[0-9a-f]{10}$`).test(t['og:image']), t['og:image']);
  check('crew link: og:image:alt names the crew', /ROCK N ROLL 2/.test(t['og:image:alt']), t['og:image:alt']);
  await image(t['og:image'], 'crew');
  const wrong = await get(local(t['og:image']).replace(/v=\w+/, 'v=0000000000'));
  check('crew image: a made-up version is sent to the real one', wrong.status === 302 && (wrong.headers.get('location') || '').endsWith(t['og:image'].replace(/^https:\/\/neonstickfight\.com\//, '')), wrong.headers.get('location'));
  const caps = await get(`${BASE}crew/${slug.toUpperCase()}?utm_source=x`);
  check('crew/<SLUG> in capitals: a 301 to the lower-case link, query kept', caps.status === 301 && caps.headers.get('location') === `/crew/${slug}?utm_source=x`, `${caps.status} ${caps.headers.get('location')}`);
  const slash = await get(`${BASE}crew/${slug}/`);
  check('crew/<slug>/ with a slash: a 301 to the link without one', slash.status === 301 && slash.headers.get('location') === `/crew/${slug}`, `${slash.status} ${slash.headers.get('location')}`);

  // the old forms: a 301 to the clean link, any other query kept, and a bot following it unfurls the crew
  for (const [from, q] of [['play/', `?crew=${slug}&pick=intern`], ['', `?crew=${slug}&pick=intern`], ['play/', `?pick=intern&crew=${slug.toUpperCase()}`]]) {
    const old = await get(`${BASE}${from}${q}`, UAS.slack);
    check(`old link /${from}${q}: a 301 to crew/<slug>?pick=intern`, old.status === 301 && old.headers.get('location') === `/crew/${slug}?pick=intern`, `${old.status} ${old.headers.get('location')}`);
  }
  const followed = await fetch(`${BASE}play/?crew=${slug}`, { headers: { 'user-agent': UAS.facebook } });
  check('old link followed like a bot: lands on crew/<slug> with the crew\'s tags', followed.url.endsWith(`/crew/${slug}`) && tags(await followed.text())['og:title'] === t['og:title'], followed.url);

  const none = await clean('crew/nobody-zzzzz', UAS.slack), nt = tags(none.html);
  check('unknown crew at crew/<slug>: 200, the default tags, the game page', none.status === 200 && nt['og:title'] === 'Neon Stick Fight' && /og\.jpg$/.test(nt['og:image']) && /<base href="\.\.\/play\/">/.test(none.html), String(none.status));
  const junk = await clean(`crew/${encodeURIComponent('"><script>x</script>')}`, UAS.slack);
  check('a crew/ value that isn\'t a slug: the default tags, nothing of it in the page', junk.status === 200 && tags(junk.html)['og:title'] === 'Neon Stick Fight' && !/<script>x/.test(junk.html), String(junk.status));
  const oldJunk = await get(`${BASE}play/?crew=${encodeURIComponent('"><script>x</script>')}`, UAS.slack);
  check('an old ?crew= that isn\'t a slug: no redirect, the plain page', oldJunk.status === 200 && tags(await oldJunk.text())['og:title'] === 'Neon Stick Fight', String(oldJunk.status));
  const noimg = await get(`${BASE}api/og/crew/nobody-zzzzz.jpg`);
  check('unknown crew image: sent to og.jpg', noimg.status === 302 && /og\.jpg$/.test(noimg.headers.get('location') || ''), noimg.headers.get('location'));

  const gone = await crew('Gone Soon');
  const ex = await fetch(`${BASE}api/crews/${gone}/dev-expire`, { method: 'POST' }).then((r) => r.json()).catch(() => null);
  if (ex && ex.wiped) {
    const g = tags((await clean(`crew/${gone}`, UAS.whatsapp)).html);
    check('expired crew: the default tags', g['og:title'] === 'Neon Stick Fight');
  } else console.log('SKIP  expired crew (needs DEV_HOOKS=1 in .dev.vars)');

  const rc = await clean('room/K7QM', UAS.discord), r = tags(rc.html);
  check('room/<CODE>: a 200 with its own title, url and image', rc.status === 200 && r['og:title'] === 'Join room K7QM on Neon Stick Fight' && r['og:url'] === 'https://neonstickfight.com/room/K7QM' && /\/api\/og\/room\/K7QM\.jpg$/.test(r['og:image']), r['og:title']);
  await resolves(rc.html, 'room/<CODE>', 'room/K7QM');
  await image(r['og:image'], 'room');
  const lower = await get(`${BASE}room/k7qm`);
  check('room/<code> in lower case: a 301 to capitals', lower.status === 301 && lower.headers.get('location') === '/room/K7QM', `${lower.status} ${lower.headers.get('location')}`);
  const badRoom = await clean('room/AB10', UAS.discord);
  check('room/ with a bad code: 200, the default tags', badRoom.status === 200 && tags(badRoom.html)['og:title'] === 'Neon Stick Fight');
  const oldBad = await get(`${BASE}play/?room=AB`);
  check('an old ?room= that isn\'t a whole code: no redirect (the game opens JOIN to finish it)', oldBad.status === 200);
  for (const from of ['play/', '']) {
    const old = await get(`${BASE}${from}?room=k7qm&relay=1`, UAS.slack);
    check(`old link /${from}?room=k7qm&relay=1: a 301 to room/K7QM?relay=1`, old.status === 301 && old.headers.get('location') === '/room/K7QM?relay=1', `${old.status} ${old.headers.get('location')}`);
  }
  const home = await get(BASE);
  check('homepage without a crew: the page, no redirect', home.status === 200 && /<title>Neon Stick Fight · /.test(await home.text()));
} catch (e) {
  check('ran against the Worker', false, e.message);
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} of ${results.length} pass`);
process.exit(failed ? 1 : 0);
