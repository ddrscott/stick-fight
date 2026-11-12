#!/usr/bin/env node
// Career and sticks, the Worker's side (README, Progression; worker/career.ts), against the local Worker:
//
//   npx wrangler d1 migrations apply stick-fight-auth --local && npm run build && npm run dev:worker   (DEV_LOGIN_CODES=1)
//   npm run test:career:worker [http://127.0.0.1:8787/]
//
//   1. signed out, api/career is null and a match can't be reported
//   2. an arcade stage reported by the page pays what src/career/rules.js says, the first win of the day once
//   3. the mash case: hits and presses in the report change nothing; training isn't a mode that pays
//   4. the offline cap: arcade stops paying at OFFLINE_CAP a day, in D1 too
//   5. a guest's progress merges at sign-in: the larger of each number, never added twice, unknown items dropped,
//      capped at MERGE_MAX
//   6. buying a palette: short, bought (sticks spent, owned, equipped), owned already; equipping one you don't own fails
//   7. online: two signed-in players in a quick room agree on a result; the room awards both (the winner's WIN, both
//      FIRST ONLINE MATCH TODAY) and tells each page its own award; a report with dnt still awards but goes on no books
//   8. a resend of the same result doesn't pay twice
// Each run uses fresh emails, so it can run again (AUTH_LIMIT allows 20 sign-in calls a minute per IP: wait a minute
// between runs). D1 is read with `wrangler d1 execute --local`. Exit code 1 on any failure.
import { execFileSync } from 'node:child_process';
import { payout, blankCareer, OFFLINE_CAP, MERGE_MAX, PAY, DAILY, utcDay } from '../../src/career/rules.js';

const BASE = (process.argv.slice(2).find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/').replace(/\/?$/, '/');
const API = BASE + 'api/', WS = API.replace(/^http/, 'ws');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = utcDay();
function d1(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'stick-fight-auth', '--local', '--json', '--command', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out)[0].results;
}
const call = async (path, method = 'GET', body, cookie = '') => {
  const res = await fetch(API + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
};
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
async function signIn(tag) {
  const email = `career-${tag}-${Date.now()}@example.com`;
  const s = await call('auth/start', 'POST', { email });
  const v = await call('auth/verify', 'POST', { email, code: s.body && s.body.devCode, pid: rid(), name: tag.toUpperCase().slice(0, 12) });
  return { email, cookie: v.cookie };
}
const row = (email) => d1(`SELECT career_xp, sticks, win_day, online_day, offline_day, offline_xp, offline_sticks, owned, equip FROM accounts WHERE email = '${email}'`)[0];
const match = (o) => ({ mode: 'arcade', won: false, cut: false, fought: 80, parries: 0, punishes: 0, enders: 0, accidents: 0, perfects: 0, floors: 0, ...o });

// 1. signed out
{
  const g = await call('career');
  check('signed out: GET career is { career: null }', g.status === 200 && g.body && g.body.career === null, JSON.stringify(g.body));
  const p = await call('career/match', 'POST', { m: match({ won: true }) });
  check('signed out: a match can\'t be reported', p.body && p.body.error === 'signed-out', JSON.stringify(p.body));
  const f = await fetch(API + 'career/match', { method: 'POST', body: 'm=1' });
  check('a form post (not JSON) is refused', f.status === 415);
}

const A = await signIn('alice');
check('signed in (dev code)', !!A.cookie, A.email);

// 2. an arcade stage
{
  const g = await call('career', 'GET', null, A.cookie);
  check('a new account starts at TEMP with 0 sticks', g.body && g.body.career && g.body.career.xp === 0 && g.body.career.sticks === 0 && g.body.career.title === 'TEMP', JSON.stringify(g.body));
  const m = match({ won: true, parries: 2, enders: 1 });
  const want = payout(m, blankCareer(), today);
  const r = await call('career/match', 'POST', { m }, A.cookie);
  check('a won stage pays what rules.js says, FIRST WIN TODAY included', r.body && r.body.award && r.body.award.sticks === want.sticks && r.body.award.firstWin && r.body.career.sticks === want.sticks, JSON.stringify(r.body && r.body.award));
  const db = row(A.email);
  check('D1 has it: career_xp, sticks, win_day', db.career_xp === want.xp && db.sticks === want.sticks && db.win_day === today, JSON.stringify(db));
  const r2 = await call('career/match', 'POST', { m }, A.cookie);
  check('the second win today: no FIRST WIN TODAY', r2.body && r2.body.award && !r2.body.award.firstWin && r2.body.award.sticks === want.sticks - DAILY.firstWin.sticks);
}

// 3. the mash case
{
  const before = row(A.email);
  const r = await call('career/match', 'POST', { m: { ...match({}), hits: 999, presses: 9000, combo: 60, xp: 1e6, sticks: 1e6 } }, A.cookie);
  const after = row(A.email);
  check('the mash case: 999 hits and 9,000 presses pay the base and nothing more', r.body && r.body.award && r.body.award.sticks === PAY.base.sticks && after.sticks - before.sticks === PAY.base.sticks, JSON.stringify(r.body && r.body.award && r.body.award.lines));
  const t = await call('career/match', 'POST', { m: match({ mode: 'training', won: true }) }, A.cookie);
  check('training isn\'t a mode the page can report', t.status === 400 && row(A.email).sticks === after.sticks);
  const q = await call('career/match', 'POST', { m: match({ mode: 'quick', won: true }) }, A.cookie);
  check('nor is an online match (the room awards those)', q.status === 400);
}

// 4. the offline cap
{
  const big = match({ won: true, parries: 99, punishes: 99, enders: 99, accidents: 99, perfects: 9 });
  let last = null;
  for (let k = 0; k < 25; k++) { last = await call('career/match', 'POST', { m: big }, A.cookie); if (last.body && last.body.award && last.body.award.capped && !last.body.award.sticks) break; }
  const db = row(A.email);
  check(`the offline cap: arcade stops at ${OFFLINE_CAP.sticks} sticks today`, db.offline_sticks === OFFLINE_CAP.sticks && db.offline_xp <= OFFLINE_CAP.xp && last.body.award.sticks === 0 && last.body.award.capped, JSON.stringify({ off: db.offline_sticks, award: last.body.award.sticks }));
  const again = await call('career/match', 'POST', { m: big }, A.cookie);
  check('another one pays 0 and says DAILY LIMIT', again.body.award.sticks === 0 && again.body.award.lines.some((l) => l.id === 'cap') && row(A.email).sticks === db.sticks);
}

// 5. merge at sign-in
const B = await signIn('bob');
{
  const guest = { xp: 300, sticks: 250, owned: ['courier:express', 'nope:fake', 'courier:express'], equip: { courier: 'express', temp: 'nightShift' }, winDay: today, offDay: today, offXp: 40, offSticks: 40 };
  const r = await call('career/merge', 'POST', { career: guest }, B.cookie);
  const c = r.body && r.body.career;
  check('merge: the guest\'s numbers come over (300 XP: INTERN)', c && c.xp === 300 && c.sticks === 250 && c.title === 'INTERN', JSON.stringify(c));
  check('merge: owned is real palettes only, once', c && JSON.stringify(c.owned) === '["courier:express"]' && c.equip.courier === 'express' && !c.equip.temp, JSON.stringify(c && [c.owned, c.equip]));
  check('merge: the daily dates and today\'s offline count come with it', c && c.winDay === today && c.offSticks === 40);
  const r2 = await call('career/merge', 'POST', { career: guest }, B.cookie);
  check('merge again with the same guest: nothing added twice', r2.body.career.xp === 300 && r2.body.career.sticks === 250);
  const r3 = await call('career/merge', 'POST', { career: { xp: 10, sticks: 5 } }, B.cookie);
  check('merge with smaller numbers: the account keeps the larger', r3.body.career.xp === 300 && r3.body.career.sticks === 250);
  const C = await signIn('carol');
  const r4 = await call('career/merge', 'POST', { career: { xp: 1e9, sticks: 1e9 } }, C.cookie);
  check(`merge of a hand-edited guest: capped at ${MERGE_MAX.xp} XP and ${MERGE_MAX.sticks} sticks, short of VP`, r4.body.career.xp === MERGE_MAX.xp && r4.body.career.sticks === MERGE_MAX.sticks && !['VP', 'C-SUITE'].includes(r4.body.career.title), JSON.stringify(r4.body.career));
}

// 6. buying
{
  const short = await call('career/buy', 'POST', { fighter: 'courier', id: 'overnight' }, B.cookie);
  check('buy: 600 sticks with 250 is short, nothing spent', short.body.error === 'short' && row(B.email).sticks === 250);
  const ok = await call('career/buy', 'POST', { fighter: 'temp', id: 'casualFriday' }, B.cookie);
  check('buy: CASUAL FRIDAY for 150 (spent, owned, in use)', ok.body.career && ok.body.career.sticks === 100 && ok.body.career.owned.includes('temp:casualFriday') && ok.body.career.equip.temp === 'casualFriday', JSON.stringify(ok.body));
  const twice = await call('career/buy', 'POST', { fighter: 'temp', id: 'casualFriday' }, B.cookie);
  check('buy: owned already costs nothing', twice.body.error === 'owned' && row(B.email).sticks === 100);
  const bogus = await call('career/buy', 'POST', { fighter: 'temp', id: 'goldPlated' }, B.cookie);
  check('buy: a palette that doesn\'t exist', bogus.status === 400 && bogus.body.error === 'unknown');
  const eq = await call('career/equip', 'PUT', { fighter: 'courier', id: 'rainRoute' }, B.cookie);
  check('equip: one you don\'t own is refused', eq.body.error === 'not-owned');
  const off = await call('career/equip', 'PUT', { fighter: 'temp', id: '' }, B.cookie);
  check('equip: back to MAIN', off.body.career && !off.body.career.equip.temp && JSON.parse(row(B.email).equip).temp === undefined);
}

// 7. online: the room awards both from the agreed result
function sock(url, cookie) {
  const ws = new WebSocket(url, { headers: { cookie } }), q = [];
  ws.onmessage = (e) => { try { q.push(JSON.parse(e.data)); } catch { /* binary */ } };
  const open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return { ws, open, q, send: (o) => ws.send(JSON.stringify(o)), close: () => { try { ws.close(); } catch { /* */ } } };
}
{
  const { code } = (await call('rooms', 'POST', {})).body;
  const H = sock(`${WS}rooms/${code}/ws?role=host`, A.cookie), G = sock(`${WS}rooms/${code}/ws?role=guest`, B.cookie);
  await H.open; await G.open; await sleep(300);
  const a0 = row(A.email), b0 = row(B.email);
  const pair = () => d1(`SELECT games FROM stats_matchups WHERE a = 'barista' AND b = 'chef' AND vs = 'pvp'`)[0] || { games: 0 };
  const g0 = pair();
  const tech = [[3, 1, 0, 0, 1], [1, 0, 2, 0, 0]];   // host: 3 parries, a punish, a perfect round; guest: a parry, two enders
  const rep = (n, extra = {}) => ({ t: 'sys', ev: 'result', n, seed: 4242 + n, mode: 'quick', chars: ['barista', 'chef'], wins: [2, 1], f: 9000, how: 'ko', x: { move: 'jab', hits: [10, 8], combo: [3, 2], perfects: [1, 0], tech }, ...extra });
  H.send(rep(1)); G.send(rep(1));
  const got = async (s) => { for (let k = 0; k < 50; k++) { const m = s.q.find((x) => x.t === 'sys' && x.ev === 'career'); if (m) return m; await sleep(100); } return null; };
  const ha = await got(H), ga = await got(G);
  const a1 = row(A.email), b1 = row(B.email);
  check('online: the host\'s page hears its own award', ha && ha.award && ha.award.lines.some((l) => l.id === 'win') && ha.award.lines.some((l) => l.id === 'parries' && l.n === 3), JSON.stringify(ha && ha.award && ha.award.lines.map((l) => l.id + l.n)));
  check('online: the guest\'s hears its own (no WIN, its two enders)', ga && ga.award && !ga.award.lines.some((l) => l.id === 'win') && ga.award.lines.some((l) => l.id === 'enders' && l.n === 2));
  check('online: both get FIRST ONLINE MATCH TODAY', ha && ha.award.firstOnline && ga && ga.award.firstOnline);
  check('online: D1 has both awards, online_day set', a1.sticks - a0.sticks === ha.award.sticks && b1.sticks - b0.sticks === ga.award.sticks && a1.online_day === today && b1.online_day === today, JSON.stringify([a0.sticks, a1.sticks, b0.sticks, b1.sticks]));
  check('online: each page gets only its own award', H.q.filter((x) => x.ev === 'career').length === 1 && G.q.filter((x) => x.ev === 'career').length === 1);
  check('online: the agreed match went on the books', pair().games === g0.games + 1);
  // 8. a resend doesn't pay twice
  H.send(rep(1)); G.send(rep(1)); await sleep(1200);
  check('a resend of the same result pays nothing more', row(A.email).sticks === a1.sticks && row(B.email).sticks === b1.sticks);
  // the guest has Do Not Track: still awarded, but no books
  H.q.length = 0; G.q.length = 0;
  H.send(rep(2)); G.send(rep(2, { dnt: 1 }));
  const hb = await got(H), gb = await got(G);
  check('a report with dnt: both still awarded (no first-online bonus the second time)', hb && gb && !hb.award.firstOnline && !gb.award.firstOnline && row(B.email).sticks > b1.sticks);
  check('... and nothing on the books', pair().games === g0.games + 1);
  // a disagreement pays nobody
  H.q.length = 0; G.q.length = 0;
  const a2 = row(A.email).sticks;
  H.send(rep(3)); G.send(rep(3, { wins: [1, 2] })); await sleep(1500);
  check('reports that disagree pay nobody', !H.q.some((x) => x.ev === 'career') && row(A.email).sticks === a2);
  H.close(); G.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
