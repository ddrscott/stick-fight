// npm run test:delete: DELETE MY PROFILE on the Worker (README, Privacy and terms, Deleting a profile), against wrangler dev.
//   npm run build && npm run dev:worker      (.dev.vars with DEV_LOGIN_CODES=1; local D1 migrated)
//   node scripts/delete/check.mjs [http://127.0.0.1:8787/]
//
// It signs a player in twice (two sessions), puts them in a crew with a friend, posts a high score, leaves
// a second lobby open as them, sends a fresh code and spends some limits; then deletes the profile and
// checks: GET me is null for both sessions, the D1 rows for the email are gone (read with
// `wrangler d1 execute --local`), the crew no longer has them (their record, head to head and matches),
// their high score row stays as initials with nobody behind it, the other lobby was told `deleted` and
// closed, and signing in again with the same email makes a new account with this device's new id.
import { execFileSync } from 'node:child_process';

const BASE = (process.argv.slice(2).find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/').replace(/\/?$/, '/');
const API = BASE + 'api/';
const WS = API.replace(/^http/, 'ws');

let pass = 0, fail = 0;
const check = (ok, what, extra = '') => { if (ok) { pass++; console.log(`  ok    ${what}`); } else { fail++; console.log(`  FAIL  ${what} ${extra}`); } };
const call = (path, method, body, cookie) => fetch(API + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
const post = (path, body, cookie) => call(path, 'POST', body, cookie);
const pid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const d1 = (sql) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'stick-fight-auth', '--local', '--json', '--command', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0].results;

function member(slug, id, name) {
  const ws = new WebSocket(`${WS}crews/${slug}/ws`);
  const got = [];
  let closed = null;
  ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', pid: id, name })));
  ws.addEventListener('message', (e) => got.push(JSON.parse(String(e.data))));
  ws.addEventListener('close', (e) => { closed = e.code; });
  return {
    got, get closed() { return closed; },
    async wait(test, ms = 4000) { const end = Date.now() + ms; while (Date.now() < end) { const m = got.find(test); if (m) return m; await sleep(30); } return null; },
    last(t) { return [...got].reverse().find((m) => m.t === t) || null; },
    send(m) { ws.send(JSON.stringify(m)); },
    close() { try { ws.close(); } catch { /* gone */ } },
  };
}
async function signIn(email, id, name) {
  const s = await (await post('auth/start', { email })).json();
  if (!s.devCode) { console.log('needs DEV_LOGIN_CODES=1 in .dev.vars', JSON.stringify(s)); process.exit(1); }
  const v = await post('auth/verify', { email, code: s.devCode, pid: id, name });
  return { body: await v.json(), cookie: (v.headers.get('set-cookie') || '').split(';')[0] };
}

console.log(`delete-my-profile checks against ${BASE}`);
const email = `delete-${Date.now()}@example.com`;
const alicePid = pid(), bobPid = pid();

// ---- a signed-in player with a crew, a score and a second session
const made = await (await post('crews', { name: 'DELETE CREW' })).json();
const slug = made.slug;
if (!slug) { console.log('no crew made: CREW_LIMIT allows 5 a minute per IP. Wait a minute.', JSON.stringify(made)); process.exit(1); }
const one = await signIn(email, alicePid, 'ALICE');
check(one.body.email === email && one.body.pid === alicePid, 'signed in: the account takes this device\'s id', JSON.stringify(one.body));
const put = await call('me', 'PUT', { crews: [{ slug, name: 'DELETE CREW', at: Date.now() }] }, one.cookie);
check(put.ok, 'the crew is on the account');

const alice = member(slug, alicePid, 'ALICE'), bob = member(slug, bobPid, 'BOB');
const aliceMid = (await alice.wait((m) => m.t === 'welcome'))?.you;
check(!!aliceMid && !!(await bob.wait((m) => m.t === 'welcome')), 'ALICE and BOB in the crew lobby');
const sc = await (await post(`crews/${slug}/scores`, { pid: alicePid, run: { kind: 'arcade', initials: 'ALI', score: 1200, char: 'temp', reach: 1 } })).json();
check(sc.ok, 'ALICE posts an arcade score to the crew', JSON.stringify(sc));
// a crew match between them, so there's a head to head row and a match row naming her
alice.send({ t: 'play', on: true }); bob.send({ t: 'play', on: true });
const am = await alice.wait((m) => m.t === 'match'), bm = await bob.wait((m) => m.t === 'match');
if (am && bm) (am.role === 'host' ? alice : bob).send({ t: 'result', match: am.id, n: 1, winner: 0, wins: [2, 1], chars: ['temp', 'intern'], secs: 60 });
await sleep(400);
let st = bob.last('state');
check(st && st.members.some((m) => m.id === aliceMid) && st.scores.arcade.some((r) => r.member === aliceMid), 'the crew has ALICE as a member and her score row', JSON.stringify(st && st.members));
check(st && st.h2h.some((h) => h.a === aliceMid || h.b === aliceMid) && st.recent.some((m) => m.host === aliceMid || m.guest === aliceMid), 'and a crew match: a head to head row and a match row with her', JSON.stringify(st && st.h2h));

// a second device signed in as her (another session), with the crew lobby open
const two = await signIn(email, pid(), 'ALICE');
check(two.body.pid === alicePid && two.cookie && two.cookie !== one.cookie, 'a second sign-in: a second session, same account');
const alice2 = member(slug, alicePid, 'ALICE');
await alice2.wait((m) => m.t === 'welcome');
alice.close();
// a code waiting and counters spent, so there's something in login_codes and limits to delete
await sleep(31000);   // the resend cooldown
const again = await (await post('auth/start', { email })).json();
check(!!again.devCode, 'a fresh sign-in code waits for the email');
const before = {
  accounts: d1(`SELECT COUNT(*) AS n FROM accounts WHERE email = '${email}'`)[0].n,
  sessions: d1(`SELECT COUNT(*) AS n FROM sessions WHERE email = '${email}'`)[0].n,
  codes: d1(`SELECT COUNT(*) AS n FROM login_codes WHERE email = '${email}'`)[0].n,
  limits: d1(`SELECT COUNT(*) AS n FROM limits WHERE key LIKE '%:${email}'`)[0].n,
};
check(before.accounts === 1 && before.sessions === 2 && before.codes === 1 && before.limits >= 1, 'before: 1 account, 2 sessions, 1 code and the limits rows in D1', JSON.stringify(before));

// ---- refusals
{
  const r = await call('me', 'DELETE', {});
  check((await r.json()).error === 'signed-out', 'DELETE me with no session: signed-out, nothing deleted');
  const f = await fetch(API + 'me', { method: 'DELETE', headers: { cookie: one.cookie } });
  check(f.status === 415, 'DELETE me without a JSON body (a cross-site form): 415', String(f.status));
  check(d1(`SELECT COUNT(*) AS n FROM accounts WHERE email = '${email}'`)[0].n === 1, 'and the account is still there');
}

// ---- delete
const del = await call('me', 'DELETE', { crews: [] }, one.cookie);
const delBody = await del.json();
check(del.ok && delBody.ok && delBody.crews === 1, 'DELETE me: ok, taken out of 1 crew', JSON.stringify(delBody));
check(/sf_session=;.*Max-Age=0/.test(del.headers.get('set-cookie') || ''), 'and the cookie is cleared', del.headers.get('set-cookie'));
check((await (await call('me', 'GET', null, one.cookie)).json()) === null, 'GET me with the old cookie: null');
check((await (await call('me', 'GET', null, two.cookie)).json()) === null, 'GET me with the other device\'s session: null');
check((await (await call('me', 'PUT', { name: 'ZOMBIE' }, two.cookie)).json()).error === 'signed-out', 'PUT me with the other session: signed-out');
const after = {
  accounts: d1(`SELECT COUNT(*) AS n FROM accounts WHERE email = '${email}' OR player_id = '${alicePid}'`)[0].n,
  sessions: d1(`SELECT COUNT(*) AS n FROM sessions WHERE email = '${email}'`)[0].n,
  codes: d1(`SELECT COUNT(*) AS n FROM login_codes WHERE email = '${email}'`)[0].n,
  limits: d1(`SELECT COUNT(*) AS n FROM limits WHERE key LIKE '%${email}%'`)[0].n,
};
check(Object.values(after).every((n) => n === 0), 'D1 has nothing for the email: accounts, sessions, login_codes, limits', JSON.stringify(after));

// ---- the crew
{
  const told = await alice2.wait((m) => m.t === 'error' && m.reason === 'deleted');
  await sleep(300);
  check(!!told && alice2.closed === 4000, 'her lobby open on the other device is told `deleted` and closed', `${JSON.stringify(told)} ${alice2.closed}`);
  st = bob.last('state');
  check(st && !st.members.some((m) => m.id === aliceMid) && st.members.length === 1, 'the crew no longer lists her (BOB is still there)', JSON.stringify(st && st.members));
  const row = st && st.scores.arcade.find((r) => r.initials === 'ALI');
  check(row && row.member === '', 'her high score stays on the table as ALI, with nobody behind it', JSON.stringify(row));
  check(st && !st.h2h.some((h) => h.a === aliceMid || h.b === aliceMid) && !st.recent.some((m) => m.host === aliceMid || m.guest === aliceMid), 'no head to head or match row names her');
  const sc2 = await (await post(`crews/${slug}/scores`, { pid: alicePid, run: { kind: 'arcade', initials: 'ALI', score: 1300, char: 'temp', reach: 1 } })).json();
  check(sc2.error === 'not-member', 'her old id can\'t post to the crew any more', JSON.stringify(sc2));
}

// ---- sign in again: a new account
{
  const fresh = pid();
  const back = await signIn(email, fresh, 'NEWBIE');
  check(back.body.email === email && back.body.pid === fresh && back.body.restored === false, 'signing in with the same email makes a new account with this device\'s new id', JSON.stringify(back.body));
  check(back.body.name === 'NEWBIE' && back.body.crews.length === 0, 'with the new name and no crews');
  check((await (await call('me', 'GET', null, back.cookie)).json())?.pid === fresh, 'GET me answers the new account');
  check((await (await call('me', 'GET', null, one.cookie)).json()) === null, 'the old cookie still gets null');
}

bob.close(); alice2.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
