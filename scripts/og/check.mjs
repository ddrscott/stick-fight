// Shared crew and room links unfurl as that room (README, Site, Share image). Against the local Worker:
//
//   npm run build && npm run dev:worker      (the Worker serving dist/ and the API on :8787; .dev.vars with DEV_HOOKS=1)
//   node scripts/og/check.mjs [http://127.0.0.1:8787/stick-fight/] [--out dir]
//
// First the image's text layout, in Node: every crew name the rules allow fits in two lines clear of the
// fighters. Then through the Worker, as the unfurl bots see it (plain HTTP, no script): a crew link's
// tags, the same for every user agent; an unknown or expired crew, a bad room code and plain play/
// get the default tags; a room link gets its own; an old /?crew= link is a 301 to play/; the images are
// JPEGs of 1200x630, small enough for WhatsApp, and a made-up version is sent to the real one.
// --out saves each image. Exit code 1 on any failure.
import fs from 'node:fs';
import { fitName, textWidth, NAME_W } from '../../worker/og-layout.ts';

const argv = process.argv.slice(2);
const BASE = (argv.find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/stick-fight/').replace(/\/?$/, '/');
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
const local = (u) => u.replace(/^https:\/\/askscottpierce\.com\/stick-fight\//, BASE);
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
  check('plain play/: the default tags with og.jpg', def['og:title'] === 'Neon Stick Fight' && def['og:image'] === 'https://askscottpierce.com/stick-fight/og.jpg' && def['twitter:card'] === 'summary_large_image', def['og:image']);
  const plain = await (await get(`${BASE}play/`)).text();
  check('plain play/: the same bytes for a bot as for a browser', plain === await (await get(`${BASE}play/`, UAS.slack)).text());

  const slug = await crew('Rock n Roll 2');
  check('made a crew', !!slug, slug);
  await members(slug, 2);
  const seen = {};
  for (const [k, ua] of Object.entries(UAS)) seen[k] = JSON.stringify(await page(`?crew=${slug}`, ua));
  check('crew link: the same tags for every user agent', new Set(Object.values(seen)).size === 1, Object.keys(UAS).join(', '));
  const t = JSON.parse(seen.imessage);
  check('crew link: og:title names the crew', t['og:title'] === 'Join ROCK N ROLL 2 on Neon Stick Fight', t['og:title']);
  check('crew link: og:description has the member count and no member names', /2 fighters in the crew/.test(t['og:description']) && !/PLAYER/.test(JSON.stringify(t)), t['og:description']);
  check('crew link: og:url is the crew link', t['og:url'] === `https://askscottpierce.com/stick-fight/play/?crew=${slug}`, t['og:url']);
  check('crew link: og:image is its own image', new RegExp(`/api/og/crew/${slug}\\.jpg\\?v=[0-9a-f]{10}$`).test(t['og:image']), t['og:image']);
  check('crew link: og:image:alt names the crew', /ROCK N ROLL 2/.test(t['og:image:alt']), t['og:image:alt']);
  await image(t['og:image'], 'crew');
  const wrong = await get(local(t['og:image']).replace(/v=\w+/, 'v=0000000000'));
  check('crew image: a made-up version is sent to the real one', wrong.status === 302 && (wrong.headers.get('location') || '').endsWith(t['og:image'].replace(/^.*\/stick-fight\//, '')), wrong.headers.get('location'));
  const mixed = await page(`?crew=${slug.toUpperCase()}&utm_source=x`);
  check('crew link: a slug in capitals with more in the query still unfurls', mixed['og:title'] === t['og:title']);

  const none = await page('?crew=nobody-zzzzz', UAS.slack);
  check('unknown crew: the default tags', none['og:title'] === 'Neon Stick Fight' && /og\.jpg$/.test(none['og:image']));
  const junk = await page(`?crew=${encodeURIComponent('"><script>x</script>')}`, UAS.slack);
  check('a crew value that isn\'t a slug: the default tags', junk['og:title'] === 'Neon Stick Fight');
  const noimg = await get(`${BASE}api/og/crew/nobody-zzzzz.jpg`);
  check('unknown crew image: sent to og.jpg', noimg.status === 302 && /og\.jpg$/.test(noimg.headers.get('location') || ''), noimg.headers.get('location'));

  const gone = await crew('Gone Soon');
  const ex = await fetch(`${BASE}api/crews/${gone}/dev-expire`, { method: 'POST' }).then((r) => r.json()).catch(() => null);
  if (ex && ex.wiped) {
    const g = await page(`?crew=${gone}`, UAS.whatsapp);
    check('expired crew: the default tags', g['og:title'] === 'Neon Stick Fight');
  } else console.log('SKIP  expired crew (needs DEV_HOOKS=1 in .dev.vars)');

  const r = await page('?room=k7qm', UAS.discord);
  check('room link: its own title, url and image', r['og:title'] === 'Join room K7QM on Neon Stick Fight' && r['og:url'] === 'https://askscottpierce.com/stick-fight/play/?room=K7QM' && /\/api\/og\/room\/K7QM\.jpg$/.test(r['og:image']), r['og:title']);
  await image(r['og:image'], 'room');
  const badRoom = await page('?room=AB10', UAS.discord);
  check('bad room code: the default tags', badRoom['og:title'] === 'Neon Stick Fight');

  for (const q of [`?crew=${slug}`, '?room=K7QM']) {
    const old = await get(`${BASE}${q}`, UAS.slack);
    check(`old link /${q}: a 301 to play/`, old.status === 301 && old.headers.get('location') === `/stick-fight/play/${q}`, `${old.status} ${old.headers.get('location')}`);
  }
  const home = await get(BASE);
  check('homepage without a crew: the page, no redirect', home.status === 200 && /<title>Neon Stick Fight · /.test(await home.text()));
} catch (e) {
  check('ran against the Worker', false, e.message);
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} of ${results.length} pass`);
process.exit(failed ? 1 : 0);
