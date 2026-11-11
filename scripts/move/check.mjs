// The move to neonstickfight.com (README, Hosting, The move to neonstickfight.com), checked against the
// real Worker on every host it answers:
//
//   npm run build && npm run test:move          [--port 8870] [--shots dir] [--skip-browser]
//
// It starts four `wrangler dev` instances over local https, one per host the Worker sees (wrangler dev
// hands the script the --local-upstream host, the way the zone hands it the real one):
//   site      neonstickfight.com
//   www       www.neonstickfight.com
//   serve     askscottpierce.com, OLD_PATH=serve (the old address still serving the game)
//   redirect  askscottpierce.com, OLD_PATH=redirect (the old address after moving day)
// each with its own local storage under .wrangler/move-check/, and .dev.vars' DEV_LOGIN_CODES=1 (sign-in
// codes come back in the answer). Then plain HTTP checks on each, and real Chromium with its resolver
// pointed at them (--host-resolver-rules), so the browser loads https://neonstickfight.com/ and
// https://askscottpierce.com/stick-fight/ by name and follows the redirects itself: a sign-in link from
// the old address keeps its #signin fragment and signs in on the new domain, a quick match connects peer
// to peer and through the relay, a crew match starts, and the links the game hands out name
// neonstickfight.com. TURN can't be checked here (no TURN key locally): /api/ice answers with STUN.
// Exit code 1 on any failure.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';   // wrangler dev's https is self-signed
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const PORT = +opt('--port', 8870);
const SHOTS = opt('--shots', '');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
if (!fs.existsSync(path.join(root, 'dist/play/index.html'))) { console.error('no build: run npm run build first'); process.exit(2); }
const vars = fs.existsSync(path.join(root, '.dev.vars')) ? fs.readFileSync(path.join(root, '.dev.vars'), 'utf8') : '';
if (!/^DEV_LOGIN_CODES=1$/m.test(vars)) { console.error('.dev.vars needs DEV_LOGIN_CODES=1 (README, Hosting)'); process.exit(2); }

// each run signs in fresh addresses and player ids: the local D1 persists, the per-email cap is 5 sends
// an hour, and a player id already linked to another address is refused
const RUN = Date.now().toString(36);
const mail = (who) => `${who}-${RUN}@example.com`;
const SITE = 'https://neonstickfight.com', OLD = 'https://askscottpierce.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const until = async (fn, ms = 30000, every = 200) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };

// ---- the four Workers ---------------------------------------------------------------------------------
const INSTANCES = [
  { name: 'site', host: 'neonstickfight.com', old: 'serve' },
  { name: 'www', host: 'www.neonstickfight.com', old: 'serve' },
  { name: 'serve', host: 'askscottpierce.com', old: 'serve' },
  { name: 'redirect', host: 'askscottpierce.com', old: 'redirect' },
].map((x, i) => ({ ...x, port: PORT + i, persist: path.join(root, '.wrangler/move-check', x.name) }));
const W = Object.fromEntries(INSTANCES.map((x) => [x.name, x]));
const procs = [];
const wrangler = path.join(root, 'node_modules/.bin/wrangler');
async function start(x) {
  execFileSync(wrangler, ['d1', 'migrations', 'apply', 'stick-fight-auth', '--local', '--persist-to', x.persist], { cwd: root, stdio: 'ignore', env: { ...process.env, CI: '1' } });
  const p = spawn(wrangler, ['dev', '--port', String(x.port), '--inspector-port', String(x.port + 1000), '--local-protocol', 'https', '--local-upstream', x.host,
    '--persist-to', x.persist, '--var', `OLD_PATH:${x.old}`, '--show-interactive-dev-session=false'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  procs.push(p);
  const ok = await until(async () => /Ready on/.test(log), 60000, 250);
  if (!ok) throw new Error(`wrangler dev for ${x.name} didn't start:\n${log.slice(-2000)}`);
}
const stopAll = () => { for (const p of procs) try { p.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stopAll);

/** a request to one instance by the URL the world would use: the instance's port, the Host it stands in for */
function at(x, pathAndQuery, init = {}) {
  return fetch(`https://127.0.0.1:${x.port}${pathAndQuery}`, { redirect: 'manual', ...init });
}
const loc = (r) => r.headers.get('location') || '';
const tag = (html, prop) => (new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`).exec(html) || [])[1] || '';

try {
  await Promise.all(INSTANCES.map(start));
  console.log(`      (four Workers up on ${PORT}-${PORT + 3})`);

  // ---- neonstickfight.com ------------------------------------------------------------------------------
  const s = W.site;
  for (const [p, what] of [['/', 'the homepage'], ['/play/', 'the game'], ['/fighters/', 'the fighter pages'], ['/fighters/temp/', 'a fighter page'], ['/how-to-play/strategy/', 'a guide page']]) {
    const r = await at(s, p);
    check(`site: ${p} is ${what}`, r.status === 200 && /text\/html/.test(r.headers.get('content-type') || ''), String(r.status));
  }
  const home = await (await at(s, '/')).text();
  check('site: the homepage\'s canonical, og:url and Plausible domain are neonstickfight.com',
    home.includes('<link rel="canonical" href="https://neonstickfight.com/">') && tag(home, 'og:url') === `${SITE}/` && tag(home, 'og:image') === `${SITE}/og.jpg` && home.includes('data-domain="neonstickfight.com"') && !home.includes('askscottpierce.com/stick-fight'));
  const fighter = await (await at(s, '/fighters/temp/')).text();
  check('site: a fighter page\'s canonical is on neonstickfight.com', fighter.includes(`<link rel="canonical" href="${SITE}/fighters/temp/">`) && fighter.includes('data-domain="neonstickfight.com"'));
  check('site: /play redirects to /play/ (the page\'s relative paths need it)', [301, 307, 308].includes((await at(s, '/play')).status));
  const ice = await at(s, '/api/ice');
  const iceBody = ice.status === 200 ? await ice.json() : {};
  check('site: /api/ice answers (STUN here; TURN needs the key in production)', Array.isArray(iceBody.iceServers) && iceBody.iceServers.length > 0, JSON.stringify(iceBody).slice(0, 90));
  const room = await at(s, '/api/rooms', { method: 'POST' });
  check('site: POST /api/rooms opens a quick room', room.status === 200 && /^[A-Z0-9]{4}$/.test((await room.json()).code || ''));
  let r = await at(s, '/?crew=lunch-crew-abcde');
  check('site: /?crew= is a 301 to play/', r.status === 301 && loc(r) === '/play/?crew=lunch-crew-abcde', `${r.status} ${loc(r)}`);
  const unfurl = await (await at(s, '/play/?room=K7QM')).text();
  check('site: a room link unfurls with its neonstickfight.com url and picture', tag(unfurl, 'og:url') === `${SITE}/play/?room=K7QM` && tag(unfurl, 'og:image') === `${SITE}/api/og/room/K7QM.jpg`, tag(unfurl, 'og:url'));
  const manifest = await (await at(s, '/manifest.webmanifest')).json();
  check('site: the manifest starts the app at play/ with the whole site in scope', manifest.start_url === './play/' && manifest.scope === './' && manifest.id === './', JSON.stringify({ s: manifest.start_url, sc: manifest.scope, id: manifest.id }));
  r = await at(s, '/sw.js');
  check('site: sw.js is the real service worker', r.status === 200 && /javascript/.test(r.headers.get('content-type') || '') && (await r.text()).includes("const GAME = './play/'"));
  const version = await (await at(s, '/version.json')).json();
  check('site: version.json carries the build id', typeof version.build === 'string' && version.build.length > 4, version.build);
  const sitemap = await (await at(s, '/sitemap.xml')).text(), robots = await (await at(s, '/robots.txt')).text();
  check('site: sitemap.xml lists the pages on neonstickfight.com, robots.txt points at it',
    sitemap.includes(`<loc>${SITE}/</loc>`) && sitemap.includes(`<loc>${SITE}/play/</loc>`) && sitemap.includes(`<loc>${SITE}/fighters/temp/</loc>`) && !sitemap.includes('askscottpierce') && robots.includes(`Sitemap: ${SITE}/sitemap.xml`));
  r = await at(s, '/stick-fight/play/?room=K7QM');
  check('site: a stray /stick-fight/ path on the new domain loses its prefix', r.status === 301 && loc(r) === '/play/?room=K7QM', loc(r));

  // sign-in: the link, the cookie
  async function signIn(x, prefix, email) {
    const st = await (await at(x, `${prefix}/api/auth/start`, { method: 'POST', body: JSON.stringify({ email }), headers: { 'content-type': 'application/json' } })).json();
    const v = await at(x, `${prefix}/api/auth/verify`, { method: 'POST', body: JSON.stringify({ email, code: st.devCode, pid: randomBytes(16).toString('hex'), name: 'MOVER' }), headers: { 'content-type': 'application/json' } });
    const cookie = v.headers.get('set-cookie') || '';
    const me = await (await at(x, `${prefix}/api/me`, { headers: { cookie: cookie.split(';')[0] } })).json().catch(() => null);
    return { link: st.devLink || '', code: st.devCode, cookie, me, start: st };
  }
  const si = await signIn(s, '', mail('mover'));
  check('site: the sign-in link points at neonstickfight.com/play/', si.link.startsWith(`${SITE}/play/#signin=${encodeURIComponent(mail('mover'))}&code=`), (si.link || JSON.stringify(si.start)).replace(/code=\d+/, 'code=…'));
  check('site: the session cookie is Path=/, HttpOnly, Secure, for this host', /^sf_session=[^;]+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=\d+; Secure$/.test(si.cookie) && !/Domain=/i.test(si.cookie), si.cookie.replace(/=[^;]+;/, '=…;'));
  check('site: the cookie signs /api/me in', si.me && si.me.email === mail('mover'), JSON.stringify(si.me));

  // ---- www.neonstickfight.com --------------------------------------------------------------------------
  for (const p of ['/', '/play/?room=K7QM', '/fighters/temp/', '/how-to-play/']) {
    r = await at(W.www, p);
    check(`www: ${p} is a 301 to the bare domain`, r.status === 301 && loc(r) === `${SITE}${p}`, `${r.status} ${loc(r)}`);
  }

  // ---- askscottpierce.com/stick-fight, still serving -----------------------------------------------------
  const v = W.serve;
  r = await at(v, '/stick-fight');
  check('serve: /stick-fight gets its slash', r.status === 301 && loc(r) === '/stick-fight/', loc(r));
  r = await at(v, '/stick-fight?crew=lunch-crew-abcde');
  check('serve: /stick-fight?crew= keeps its query on the way to the slash', r.status === 301 && loc(r) === '/stick-fight/?crew=lunch-crew-abcde', loc(r));
  for (const p of ['/stick-fight/', '/stick-fight/play/', '/stick-fight/fighters/temp/']) {
    r = await at(v, p);
    check(`serve: ${p} is still the page`, r.status === 200 && /text\/html/.test(r.headers.get('content-type') || ''), String(r.status));
  }
  r = await at(v, '/stick-fight/play');
  check('serve: /stick-fight/play redirects to /stick-fight/play/', [301, 307, 308].includes(r.status) && new URL(loc(r), OLD).pathname === '/stick-fight/play/', loc(r));
  r = await at(v, '/stick-fight/?room=K7QM');
  check('serve: the oldest room link is a 301 to /stick-fight/play/', r.status === 301 && loc(r) === '/stick-fight/play/?room=K7QM', loc(r));
  const unfurlOld = await (await at(v, '/stick-fight/play/?room=K7QM')).text();
  check('serve: a room link there unfurls pointing at neonstickfight.com', tag(unfurlOld, 'og:url') === `${SITE}/play/?room=K7QM`, tag(unfurlOld, 'og:url'));
  r = await at(v, '/stick-fight/sw.js');
  check('serve: sw.js there is still the real one', (await r.text()).includes("const GAME = './play/'"));
  const siOld = await signIn(v, '/stick-fight', mail('old'));
  check('serve: a sign-in started there emails a neonstickfight.com link', siOld.link.startsWith(`${SITE}/play/#signin=`), siOld.link.replace(/code=\d+/, 'code=…'));
  check('serve: its cookie stays scoped to /stick-fight (that origin is shared)', /; Path=\/stick-fight;/.test(siOld.cookie), siOld.cookie.replace(/=[^;]+;/, '=…;'));
  check('serve: and signs /stick-fight/api/me in', siOld.me && siOld.me.email === mail('old'));

  // ---- askscottpierce.com/stick-fight, redirecting -------------------------------------------------------
  const d = W.redirect;
  for (const [from, to] of [
    ['/stick-fight', '/'], ['/stick-fight/', '/'], ['/stick-fight/play/', '/play/'],
    ['/stick-fight/play/?room=K7QX', '/play/?room=K7QX'], ['/stick-fight/play/?crew=lunch-crew-abcde', '/play/?crew=lunch-crew-abcde'],
    ['/stick-fight/?crew=lunch-crew-abcde', '/play/?crew=lunch-crew-abcde'], ['/stick-fight/?room=K7QX', '/play/?room=K7QX'],
    ['/stick-fight/play/?room=K7QX&relay=1', '/play/?room=K7QX&relay=1'], ['/stick-fight/play', '/play'],
    ['/stick-fight/fighters/', '/fighters/'], ['/stick-fight/fighters/temp/', '/fighters/temp/'], ['/stick-fight/how-to-play/strategy/', '/how-to-play/strategy/'],
    ['/stick-fight/manifest.webmanifest', '/manifest.webmanifest'], ['/stick-fight/og.jpg', '/og.jpg'],
  ]) {
    r = await at(d, from);
    check(`redirect: ${from} -> ${to}`, r.status === 301 && loc(r) === `${SITE}${to}`, `${r.status} ${loc(r)}`);
  }
  r = await at(d, '/stick-fight/sw.js');
  const retired = await r.text();
  check('redirect: /stick-fight/sw.js is a service worker that clears its caches and unregisters', r.status === 200 && /javascript/.test(r.headers.get('content-type') || '') && retired.includes('unregister()') && retired.includes("startsWith('stick-fight-')"));
  r = await at(d, '/stick-fight/api/ice');
  check('redirect: the old API still answers (a tab opened before the move finishes its match)', r.status === 200);

  // ---- real browsers, by name -----------------------------------------------------------------------------
  if (!argv.includes('--skip-browser')) {
    const { chromium, executablePath } = await import('../../gauntlet/browser.mjs');
    const launch = (oldTo) => chromium.launch({ executablePath, args: [
      `--host-resolver-rules=MAP neonstickfight.com:443 127.0.0.1:${s.port}, MAP www.neonstickfight.com:443 127.0.0.1:${W.www.port}, MAP askscottpierce.com:443 127.0.0.1:${oldTo.port}`,
      // mDNS-hidden local addresses don't resolve between two headless browsers, so peer to peer would fall to the relay
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      '--ignore-certificate-errors', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
    const browsers = [];
    const pageIn = async (b, url, init = {}, waitUntil = 'domcontentloaded') => {
      const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 960, height: 540 } });
      await ctx.addInitScript((kv) => { for (const k in kv) if (localStorage.getItem(k) === null) localStorage.setItem(k, kv[k]); }, init);
      const p = await ctx.newPage();
      p.errors = [];
      p.on('pageerror', (e) => p.errors.push(String(e)));
      await p.goto(url, { waitUntil, timeout: 60000 });
      return p;
    };
    const game = async (p) => {
      await p.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 90000 });
      await p.evaluate(() => { let last = performance.now(), k = 0; window.__pump = setInterval(() => { const now = performance.now(), ms = Math.min(100, now - last); last = now; if (++k % 12 === 0) window.__gauntlet.step(ms); else window.__game.advance(ms); }, 8); });
      return p;
    };
    /** where a link lands: the URL once the redirects are done, then the page is closed */
    const lands = async (b, url) => { const p = await pageIn(b, url, {}, 'commit'); const u = p.url(), title = await p.title().catch(() => ''); await p.context().close(); return { u, title }; };
    const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {}); };

    // after moving day: old links in a browser
    const B = await launch(d); browsers.push(B);
    let l = await lands(B, `${OLD}/stick-fight/play/?room=K7QX`);
    check('browser: an old room link lands on neonstickfight.com/play/?room=K7QX', l.u === `${SITE}/play/?room=K7QX`, l.u);
    l = await lands(B, `${OLD}/stick-fight/?crew=lunch-crew-abcde`);
    check('browser: the oldest crew link lands on neonstickfight.com/play/?crew=', l.u === `${SITE}/play/?crew=lunch-crew-abcde`, l.u);
    l = await lands(B, `${OLD}/stick-fight/fighters/courier/`);
    check('browser: an old fighter page lands on its new address', l.u === `${SITE}/fighters/courier/`, l.u);
    l = await lands(B, `https://www.neonstickfight.com/play/?room=K7QX`);
    check('browser: www lands on the bare domain', l.u === `${SITE}/play/?room=K7QX`, l.u);

    // a sign-in email from before the move: /stick-fight/play/#signin=...&code=...
    const st = await (await at(s, '/api/auth/start', { method: 'POST', body: JSON.stringify({ email: mail('link') }), headers: { 'content-type': 'application/json' } })).json();
    let p = await pageIn(B, `${OLD}/stick-fight/play/#signin=${encodeURIComponent(mail('link'))}&code=${st.devCode}`);
    check('browser: an old sign-in link keeps its #signin fragment through the redirect', p.url().startsWith(`${SITE}/play/#signin=${encodeURIComponent(mail('link'))}&code=`) || p.url() === `${SITE}/play/`, p.url().replace(/code=\d+/, 'code=…'));
    await game(p);
    const me = await until(() => p.evaluate(() => fetch('../api/me').then((r) => r.json())).then((m) => (m && m.email ? m : null)), 30000, 500);
    check('browser: ...and signs in on neonstickfight.com', me && me.email === mail('link'), JSON.stringify(me));
    const cookies = (await p.context().cookies()).filter((c) => c.name === 'sf_session');
    check('browser: the session cookie is neonstickfight.com, Path=/', cookies.length === 1 && cookies[0].domain === 'neonstickfight.com' && cookies[0].path === '/' && cookies[0].httpOnly && cookies[0].secure, JSON.stringify(cookies.map((c) => ({ d: c.domain, p: c.path }))));
    const sw = await until(() => p.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => (r && r.active ? r.scope : null))), 20000, 500);
    check('browser: the service worker installs with the whole site in scope', sw === `${SITE}/`, String(sw));
    await p.context().close();
    // each player from here on gets a browser of its own (software GL in one process starves the others)
    const own = async (url, init) => { const b = await launch(d); browsers.push(b); return game(await pageIn(b, url, init)); };

    // a quick match on the new domain, peer to peer and then through the relay
    const RULES = { 'stick-fight-round-time': '30', 'stick-fight-best-of': '1' };
    async function quick(relay) {
      const q = relay ? '&relay=1' : '';
      const H = await own(`${SITE}/play/?scene=attract&tier=1${q}`, RULES);
      const G = await own(`${SITE}/play/?scene=attract&tier=1${q}`, RULES);
      for (const [pg, nm] of [[H, 'ALICE'], [G, 'BOB']]) await pg.evaluate((n) => window.__net.setName(n), nm);
      const hosted = await H.evaluate(() => window.__net.host().then((o) => ({ code: o.code, url: o.url })));
      await G.evaluate((c) => window.__net.join(c), hosted.code);
      const on = (await until(() => H.evaluate(() => window.__net.active))) && (await until(() => G.evaluate(() => window.__net.active)));
      const mode = await until(() => H.evaluate(() => { const m = window.__net.stats().mode; return m && m !== 'connecting' ? m : null; }), 20000);
      return { H, G, hosted, on, mode };
    }
    const p2p = await quick(false);
    check('browser: net.host() hands out a neonstickfight.com room link', p2p.hosted.url === `${SITE}/play/?scene=attract&tier=1&room=${p2p.hosted.code}` || p2p.hosted.url === `${SITE}/play/?room=${p2p.hosted.code}`, p2p.hosted.url);
    check('browser: a quick match starts on neonstickfight.com, peer to peer', p2p.on && p2p.mode === 'p2p', String(p2p.mode));
    await shot(p2p.H, 'quick-p2p');
    for (const pg of [p2p.H, p2p.G]) await pg.context().browser().close();
    const rel = await quick(true);
    check('browser: a quick match with ?relay=1 runs through the room', rel.on && rel.mode === 'relay', String(rel.mode));
    await shot(rel.H, 'quick-relay');
    for (const pg of [rel.H, rel.G]) await pg.context().browser().close();

    // a crew match: two players open the crew link and press PLAY
    const made = await (await at(s, '/api/crews', { method: 'POST', body: JSON.stringify({ name: 'MOVING DAY' }), headers: { 'content-type': 'application/json' } })).json();
    const crewPage = (nm, c) => own(`${SITE}/play/?crew=${made.slug}`, { ...RULES, 'stick-fight-player': JSON.stringify({ id: c.repeat(32), name: nm, email: '', crews: [] }) });
    const C1 = await crewPage('CAROL', 'c'), C2 = await crewPage('DAVE', 'd');
    const inLobby = await until(async () => (await C1.evaluate(() => window.__flow.state)) === 'crewLobby' && (await C2.evaluate(() => window.__flow.state)) === 'crewLobby');
    const linkText = await C1.evaluate(() => (document.querySelector('.fl-link') || {}).textContent || '');
    check('browser: the crew lobby shows its neonstickfight.com link', !!inLobby && linkText === `${SITE}/play/?crew=${made.slug}`, linkText);
    await shot(C1, 'crew-lobby');
    for (const pg of [C1, C2]) await until(() => pg.evaluate(() => { const b = document.querySelector('.fl-playbtn'); if (!b) return false; b.click(); return true; }));
    // the crew room opens a match room for the two of them and both go to the pick screen
    const st2 = (pg) => pg.evaluate(() => ({ flow: window.__flow.state, code: window.__net && window.__net.code, mode: window.__net && window.__net.stats().mode }));
    const trace = []; const crewOn = await until(async () => { const a = await st2(C1), b = await st2(C2); const t = `${a.flow}/${a.mode} ${b.flow}/${b.mode}`; if (trace.at(-1) !== t) trace.push(t); return ['onlineSelect', 'onlineFighting'].includes(a.flow) && a.flow === b.flow && a.code && a.code === b.code && a.mode && a.mode !== 'connecting' ? a : null; }, 60000, 500);
    check('browser: a crew match opens its room and both players pick on neonstickfight.com', !!crewOn, JSON.stringify({ crewOn, trace }));
    await shot(C1, 'crew-match');
    for (const pg of [C1, C2]) await pg.context().browser().close();

    // before moving day: the old address still plays
    const S = await launch(v); browsers.push(S);
    p = await game(await pageIn(S, `${OLD}/stick-fight/play/`));
    check('browser: while serving, askscottpierce.com/stick-fight/play/ is still the game', p.url() === `${OLD}/stick-fight/play/` && p.errors.length === 0, p.errors.join(' | ').slice(0, 120));
    const okApi = await p.evaluate(() => fetch('../api/ice').then((r) => r.ok));
    check('browser: ...with its API beside it', okApi);
    for (const b of browsers) await b.close().catch(() => {});
  }
} catch (e) {
  check('the run finished', false, String(e && e.stack || e).slice(0, 600));
} finally {
  stopAll();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} of ${results.length} passed`);
process.exit(failed ? 1 : 0);
