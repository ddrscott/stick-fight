// npm run test:admin: the Worker's side of the house rules (README, Privacy and terms), against wrangler dev.
//   npm run build && npm run dev:worker      (.dev.vars with ADMIN_TOKEN=<16+ characters>, DEV_LOGIN_CODES=1)
//   node scripts/admin/check.mjs [http://127.0.0.1:8787/stick-fight/] [--token <ADMIN_TOKEN>]
// The token defaults to ADMIN_TOKEN in .dev.vars.
//
// It checks: the name filter on crew names, crew member names and profile names; the admin route's
// locks (no token, a wrong one); showing a crew, renaming it, renaming a member (and that the new name
// holds when their page reconnects with the old one, and gives way when they pick a new one); closing
// it (the lobby is told NO CREW, the crew's gone, its preview goes back to the defaults).
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const BASE = (argv.find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/stick-fight/').replace(/\/?$/, '/');
let TOKEN = argv.includes('--token') ? argv[argv.indexOf('--token') + 1] : '';
if (!TOKEN) { try { TOKEN = (readFileSync('.dev.vars', 'utf8').match(/^ADMIN_TOKEN=(.*)$/m) || [])[1] || ''; } catch { /* none */ } }
const API = BASE + 'api/';
const WS = API.replace(/^http/, 'ws');

let pass = 0, fail = 0;
const check = (ok, what, extra = '') => { if (ok) { pass++; console.log(`  ok    ${what}`); } else { fail++; console.log(`  FAIL  ${what} ${extra}`); } };
const post = (path, body, headers = {}) => fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const admin = (slug, body) => fetch(API + `admin/crews/${slug}`, body ? { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) } : { headers: { authorization: `Bearer ${TOKEN}` } });
const pid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** a member in a crew's lobby: every message it gets, and helpers to wait for one */
function member(slug, id, name) {
  const ws = new WebSocket(`${WS}crews/${slug}/ws`);
  const got = [];
  let closed = null;
  ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', pid: id, name })));
  ws.addEventListener('message', (e) => got.push(JSON.parse(String(e.data))));
  ws.addEventListener('close', (e) => { closed = e.code; });
  return {
    ws, got, get closed() { return closed; },
    async wait(test, ms = 4000) { const end = Date.now() + ms; while (Date.now() < end) { const m = got.find(test); if (m) return m; await sleep(30); } return null; },
    last(t) { return [...got].reverse().find((m) => m.t === t) || null; },
    send(m) { ws.send(JSON.stringify(m)); },
    close() { try { ws.close(); } catch { /* gone */ } },
  };
}

if (!TOKEN) { console.log('no ADMIN_TOKEN: put one in .dev.vars (16+ characters) or pass --token'); process.exit(1); }
console.log(`admin and name filter checks against ${BASE}`);

// ---- the name filter, on the Worker
{
  const r = await post('crews', { name: 'FUCK MATH' });
  const b = await r.json().catch(() => ({}));
  check(r.status === 400 && b.error === 'blocked-name', 'a crew named with a blocked word is turned away (blocked-name)', `${r.status} ${JSON.stringify(b)}`);
  const ok = await post('crews', { name: 'SCUNTHORPE UNITED' });
  check(ok.ok && (await ok.json()).slug, 'SCUNTHORPE UNITED makes a crew (no false positive)');
}
const made = await (await post('crews', { name: 'LUNCH CREW' })).json();
const slug = made.slug;
check(!!slug, `a crew to work on: ${slug}`, JSON.stringify(made));
if (!slug) { console.log('no crew made: CREW_LIMIT allows 5 a minute per IP, so a second run inside a minute is refused. Wait a minute.'); process.exit(1); }
{
  const bad = member(slug, pid(), 'SH1THEAD');
  const err = await bad.wait((m) => m.t === 'error');
  check(err && err.reason === 'blocked-name', 'a member whose name is blocked (leetspeak) is refused with blocked-name', JSON.stringify(err));
  await sleep(200);
  check(bad.closed === 4000, 'and their socket is closed', String(bad.closed));
}
const aliceId = pid(), bobId = pid();
const alice = member(slug, aliceId, 'ALICE');
const bob = member(slug, bobId, 'BADNAME BOB');
check(!!(await alice.wait((m) => m.t === 'welcome')) && !!(await bob.wait((m) => m.t === 'welcome')), 'two members in the lobby');
{
  alice.send({ t: 'name', name: 'A55 KICKER' });
  const err = await alice.wait((m) => m.t === 'error' && m.reason === 'blocked-name');
  check(!!err, 'renaming yourself to a blocked name in the lobby is refused');
  await sleep(200);
  const st = alice.last('state');
  check(st && st.members.some((m) => m.name === 'ALICE') && !st.members.some((m) => m.name === 'A55 KICKER'), 'and the old name stays');
}
// profile names (worker/auth.ts): sign in with the dev code, then try a blocked name
{
  const email = `filter-${Date.now()}@example.com`;
  const s = await (await post('auth/start', { email })).json();
  if (!s.devCode) check(false, 'profile names: needs DEV_LOGIN_CODES=1 in .dev.vars', JSON.stringify(s));
  else {
    const v = await post('auth/verify', { email, code: s.devCode, pid: pid(), name: 'BITCH' });
    const vb = await v.json();
    const cookie = (v.headers.get('set-cookie') || '').split(';')[0];
    check(vb.email === email && vb.name === '', 'signing in with a blocked name saves the profile without the name', JSON.stringify(vb));
    const put = await fetch(API + 'me', { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'FAG' }) });
    check(put.status === 400 && (await put.json()).error === 'blocked-name', 'changing a saved profile\'s name to a blocked one is refused');
    const put2 = await fetch(API + 'me', { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'CASSIDY' }) });
    check(put2.ok && (await put2.json()).name === 'CASSIDY', 'and a normal name (CASSIDY) goes through');
  }
}

// ---- the admin route's locks
{
  const none = await fetch(API + `admin/crews/${slug}`);
  check(none.status === 401, 'no token: 401', String(none.status));
  const wrong = await fetch(API + `admin/crews/${slug}`, { headers: { authorization: 'Bearer not-the-token-at-all' } });
  check(wrong.status === 401, 'a wrong token: 401', String(wrong.status));
  const wrongClose = await fetch(API + `admin/crews/${slug}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer nope' }, body: '{"action":"close"}' });
  check(wrongClose.status === 401, 'a wrong token can\'t close a crew', String(wrongClose.status));
}

// ---- show, rename, rename a member, close
{
  const r = await admin(slug);
  const c = await r.json();
  check(r.ok && c.name === 'LUNCH CREW' && c.members.length === 2, 'GET shows the crew: its name and both members', JSON.stringify(c));
  const bobRow = c.members.find((m) => m.name === 'BADNAME BOB');
  check(!!bobRow && /^[0-9a-f]{16}$/.test(bobRow.id), 'each member by member id (a hash, never the player id)');

  const rn = await (await admin(slug, { action: 'rename', name: 'THE LUNCH BUNCH' })).json();
  check(rn.ok && rn.name === 'THE LUNCH BUNCH', 'rename the crew', JSON.stringify(rn));
  const seen = await alice.wait((m) => m.t === 'state' && m.crew.name === 'THE LUNCH BUNCH');
  check(!!seen, 'the lobby sees the new crew name at once');

  const rm = await (await admin(slug, { action: 'rename-member', member: 'BADNAME BOB' })).json();
  check(rm.ok && rm.to === 'PLAYER' && rm.from === 'BADNAME BOB', 'rename a member by the name they show, to PLAYER by default', JSON.stringify(rm));
  const seen2 = await alice.wait((m) => m.t === 'state' && m.members.some((x) => x.name === 'PLAYER') && !m.members.some((x) => x.name === 'BADNAME BOB'));
  check(!!seen2, 'the lobby sees PLAYER, and BADNAME BOB is gone');
  // bob's page still has the old name and reconnects with it
  bob.close(); await sleep(300);
  const bob2 = member(slug, bobId, 'BADNAME BOB');
  await bob2.wait((m) => m.t === 'welcome');
  await sleep(200);
  const st = bob2.last('state');
  check(st && st.members.some((x) => x.name === 'PLAYER') && !st.members.some((x) => x.name === 'BADNAME BOB'), 'reconnecting with the old name keeps PLAYER');
  bob2.send({ t: 'name', name: 'ROBERTO' });
  const st2 = await bob2.wait((m) => m.t === 'state' && m.members.some((x) => x.name === 'ROBERTO'));
  check(!!st2, 'picking a new name replaces it (ROBERTO)');
  const byId = await (await admin(slug, { action: 'rename-member', member: bobRow.id, name: 'MEMBER 2' })).json();
  check(byId.ok && byId.to === 'MEMBER 2', 'rename a member by member id, to a name you give', JSON.stringify(byId));

  const cl = await (await admin(slug, { action: 'close' })).json();
  check(cl.ok && cl.closed === slug, 'close the crew', JSON.stringify(cl));
  const told = await alice.wait((m) => m.t === 'error' && m.reason === 'no-crew');
  check(!!told, 'the lobby is told no-crew (the game shows NO CREW AT THAT LINK)');
  await sleep(300);
  check(alice.closed === 4000 && bob2.closed === 4000, 'and every socket is closed', `${alice.closed} ${bob2.closed}`);
  const gone = await admin(slug);
  check(gone.status === 404, 'GET answers 404 for the closed crew', String(gone.status));
  const again = member(slug, pid(), 'LATECOMER');
  const e2 = await again.wait((m) => m.t === 'error');
  check(e2 && e2.reason === 'no-crew', 'opening the link now says no-crew', JSON.stringify(e2));
  again.close();
  const page = await fetch(BASE + `crew/${slug}`).then((x) => x.text());
  check(page.includes('<base') && page.includes('id="game"') && !page.includes('THE LUNCH BUNCH'), 'the crew link still loads the game, with the default share tags');
  const bad = await (await admin(slug, { action: 'close' })).json();
  check(bad.error === 'no-crew', 'closing it again: no-crew');
  const junk = await (await admin('not a slug!', { action: 'close' })).json().catch(() => ({ error: 'bad crew' }));
  check(!!junk.error, 'a junk slug is refused');
}
console.log(`\nadmin and name filter: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
