#!/usr/bin/env node
// Stat upgrades, the Worker's side (README, Progression, Stat upgrades; worker/career.ts POST career/buy with `upgrade`):
//
//   npx wrangler d1 migrations apply stick-fight-auth --local && npm run build && npm run dev:worker   (DEV_LOGIN_CODES=1)
//   npm run test:upgrades:worker [http://127.0.0.1:8787/]
//
// One signed-in account, its sticks set in D1, then: tier 2 before tier 1 is refused (order), tier 1 costs exactly
// 100 and lands in D1's owned, a second buy of it costs nothing (owned), tier 3 with too few sticks is short, a stat or
// fighter that doesn't exist is a 400, signed out is refused; a guest's upgrades merge (junk dropped), and GET career
// hands them back. Two sign-ins, so it fits AUTH_LIMIT with the other tests if run a minute apart.
import { execFileSync } from 'node:child_process';
import { PRICES, upKey, levelsOf } from '../../src/career/upgrades.js';

const BASE = (process.argv.slice(2).find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/').replace(/\/?$/, '/');
const API = BASE + 'api/';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
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
  const email = `upgrades-${tag}-${Date.now()}@example.com`;
  const s = await call('auth/start', 'POST', { email });
  const v = await call('auth/verify', 'POST', { email, code: s.body && s.body.devCode, pid: rid(), name: tag.toUpperCase().slice(0, 12) });
  return { email, cookie: v.cookie };
}
const row = (email) => { const r = d1(`SELECT sticks, owned FROM accounts WHERE email = '${email}'`)[0]; return { sticks: r.sticks, owned: JSON.parse(r.owned || '[]') }; };

{
  const out = await call('career/buy', 'POST', { fighter: 'chef', upgrade: 'health', tier: 1 });
  check('signed out: no buying', out.body && out.body.error === 'signed-out', JSON.stringify(out.body));
}
const A = await signIn('ann');
check('signed in', !!A.cookie);
d1(`UPDATE accounts SET sticks = 400 WHERE email = '${A.email}'`);
{
  const early = await call('career/buy', 'POST', { fighter: 'chef', upgrade: 'health', tier: 2 }, A.cookie);
  check('tier 2 before tier 1: refused (order), nothing spent', early.body.error === 'order' && row(A.email).sticks === 400, JSON.stringify(early.body && early.body.error));
  const one = await call('career/buy', 'POST', { fighter: 'chef', upgrade: 'health', tier: 1 }, A.cookie);
  const r1 = row(A.email);
  check(`tier 1: ${PRICES[0]} sticks, in D1's owned`, one.body.career && r1.sticks === 400 - PRICES[0] && r1.owned.includes(upKey('chef', 'health', 1)), JSON.stringify(r1));
  check('the answer is the career with it (the page adopts it)', one.body.career.sticks === 300 && levelsOf(one.body.career.owned, 'chef').health === 1);
  const again = await call('career/buy', 'POST', { fighter: 'chef', upgrade: 'health', tier: 1 }, A.cookie);
  check('tier 1 again: owned, nothing spent', again.body.error === 'owned' && row(A.email).sticks === 300);
  const two = await call('career/buy', 'POST', { fighter: 'chef', upgrade: 'health', tier: 2 }, A.cookie);
  check(`tier 2 after it: ${PRICES[1]} sticks`, two.body.career && row(A.email).sticks === 300 - PRICES[1] && levelsOf(row(A.email).owned, 'chef').health === 2);
  const short = await call('career/buy', 'POST', { fighter: 'chef', upgrade: 'health', tier: 3 }, A.cookie);
  check(`tier 3 for ${PRICES[2]} with ${300 - PRICES[1]}: short, nothing spent`, short.body.error === 'short' && row(A.email).sticks === 50);
  const luck = await call('career/buy', 'POST', { fighter: 'chef', upgrade: 'luck', tier: 1 }, A.cookie);
  const nobody = await call('career/buy', 'POST', { fighter: 'nobody', upgrade: 'power', tier: 1 }, A.cookie);
  const four = await call('career/buy', 'POST', { fighter: 'chef', upgrade: 'power', tier: 4 }, A.cookie);
  check('a stat, fighter or tier that doesn\'t exist: 400 unknown', luck.status === 400 && nobody.status === 400 && four.status === 400 && luck.body.error === 'unknown');
  const pal = await call('career/buy', 'POST', { fighter: 'chef', id: 'saffron' }, A.cookie);
  check('palettes still buy the old way beside it', pal.body.error === 'short');
  d1(`UPDATE accounts SET sticks = 1000 WHERE email = '${A.email}'`);
  const got = await call('career', 'GET', undefined, A.cookie);
  check('GET career hands the upgrades back', levelsOf(got.body.career.owned, 'chef').health === 2);
}
{
  const B = await signIn('bea');
  const guest = { xp: 50, sticks: 20, owned: [upKey('barista', 'speed', 1), upKey('barista', 'speed', 2), 'barista:up:luck:1', 'nobody:up:power:1', upKey('barista', 'power', 9)] };
  const m = await call('career/merge', 'POST', { career: guest }, B.cookie);
  const owned = m.body && m.body.career ? m.body.career.owned : [];
  check('a guest\'s upgrades merge at sign-in, junk dropped', JSON.stringify(owned) === JSON.stringify([upKey('barista', 'speed', 1), upKey('barista', 'speed', 2)]), JSON.stringify(owned));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
