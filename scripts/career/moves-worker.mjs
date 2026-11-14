#!/usr/bin/env node
// The custom employee, the Worker's side (README, Characters, Custom employee; worker/career.ts POST career/buy with
// `move`, PUT career/equip with kind 'slot'):
//
//   npx wrangler d1 migrations apply stick-fight-auth --local && npm run build && npm run dev:worker   (DEV_LOGIN_CODES=1)
//   npm run test:moves:worker [http://127.0.0.1:8787/]
//
// One signed-in account, its sticks set in D1, then: a move costs exactly MOVE_PRICE and lands in D1's owned (and in
// the slot asked for), a second buy costs nothing (owned), too few sticks is short, a move that isn't for sale is a 400;
// slotting: an owned move into a slot, the same move into the other slot moves over, the fighter's own move refused,
// an unowned move refused, emptying a slot; GET career hands the loadout back; a guest's moves and slots merge at
// sign-in with junk dropped. Signed out is refused. Two sign-ins, so it fits AUTH_LIMIT run a minute from the others.
import { execFileSync } from 'node:child_process';
import { MOVE_PRICE, moveKey, slotKey, loadoutOf } from '../../src/career/moves.js';

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
  const email = `moves-${tag}-${Date.now()}@example.com`;
  const s = await call('auth/start', 'POST', { email });
  const v = await call('auth/verify', 'POST', { email, code: s.body && s.body.devCode, pid: rid(), name: tag.toUpperCase().slice(0, 12) });
  return { email, cookie: v.cookie };
}
const row = (email) => { const r = d1(`SELECT sticks, owned, equip FROM accounts WHERE email = '${email}'`)[0]; return { sticks: r.sticks, owned: JSON.parse(r.owned || '[]'), equip: JSON.parse(r.equip || '{}') }; };

{
  const out = await call('career/buy', 'POST', { move: 'reboot' });
  check('signed out: no buying', out.body && out.body.error === 'signed-out', JSON.stringify(out.body));
  const eq = await call('career/equip', 'PUT', { fighter: 'temp', kind: 'slot', slot: 1, id: 'reboot' });
  check('signed out: no slotting', eq.body && eq.body.error === 'signed-out');
}
const A = await signIn('ann');
check('signed in', !!A.cookie);
d1(`UPDATE accounts SET sticks = 700 WHERE email = '${A.email}'`);
{
  const one = await call('career/buy', 'POST', { move: 'reboot', fighter: 'courier', slot: 1 }, A.cookie);
  let r = row(A.email);
  check(`a move: ${MOVE_PRICE} sticks, move:reboot in D1's owned`, one.body.career && r.sticks === 700 - MOVE_PRICE && r.owned.includes(moveKey('reboot')), JSON.stringify(r));
  check('...and in the slot it was bought for (courier:slot1)', r.equip[slotKey('courier', 1)] === 'reboot' && loadoutOf(one.body.career, 'courier').join() === 'reboot,');
  const again = await call('career/buy', 'POST', { move: 'reboot' }, A.cookie);
  check('the same move again: owned, nothing spent', again.body.error === 'owned' && row(A.email).sticks === 400);
  const two = await call('career/buy', 'POST', { move: 'mopSpin' }, A.cookie);
  r = row(A.email);
  check('a second move, no slot asked: owned, not slotted', two.body.career && r.sticks === 100 && r.owned.includes(moveKey('mopSpin')) && !Object.values(r.equip).includes('mopSpin'));
  const short = await call('career/buy', 'POST', { move: 'updraft' }, A.cookie);
  check(`too few sticks (100 of ${MOVE_PRICE}): short, nothing spent`, short.body.error === 'short' && row(A.email).sticks === 100);
  const nope = await call('career/buy', 'POST', { move: 'ba_espresso' }, A.cookie), junk = await call('career/buy', 'POST', { move: 'nothing' }, A.cookie);
  check('a move that isn\'t for sale (Espresso Shot) or doesn\'t exist: 400 unknown', nope.status === 400 && junk.status === 400 && nope.body.error === 'unknown');

  // slotting
  const s2 = await call('career/equip', 'PUT', { fighter: 'courier', kind: 'slot', slot: 2, id: 'mopSpin' }, A.cookie);
  check('an owned move into slot B', s2.body.career && row(A.email).equip[slotKey('courier', 2)] === 'mopSpin' && loadoutOf(s2.body.career, 'courier').join() === 'reboot,mopSpin');
  const over = await call('career/equip', 'PUT', { fighter: 'courier', kind: 'slot', slot: 1, id: 'mopSpin' }, A.cookie);
  r = row(A.email);
  check('the same move into the other slot moves it over (no move twice)', over.body.career && r.equip[slotKey('courier', 1)] === 'mopSpin' && !r.equip[slotKey('courier', 2)], JSON.stringify(r.equip));
  const own = await call('career/equip', 'PUT', { fighter: 'helpdesk', kind: 'slot', slot: 1, id: 'reboot' }, A.cookie);
  check('a fighter\'s own move is refused (HELPDESK and Reboot)', own.body.error === 'own' && !row(A.email).equip[slotKey('helpdesk', 1)]);
  const unowned = await call('career/equip', 'PUT', { fighter: 'temp', kind: 'slot', slot: 1, id: 'updraft' }, A.cookie);
  check('a move not owned is refused', unowned.body.error === 'not-owned');
  const bad = await call('career/equip', 'PUT', { fighter: 'temp', kind: 'slot', slot: 3, id: 'reboot' }, A.cookie), nobody = await call('career/equip', 'PUT', { fighter: 'nobody', kind: 'slot', slot: 1, id: 'reboot' }, A.cookie);
  check('a slot or fighter that doesn\'t exist: 400', bad.status === 400 && nobody.status === 400);
  const other = await call('career/equip', 'PUT', { fighter: 'chef', kind: 'slot', slot: 1, id: 'reboot' }, A.cookie);
  check('one move, owned once, slots into any other fighter too (CHEF)', other.body.career && loadoutOf(other.body.career, 'chef').join() === 'reboot,');
  const empty = await call('career/equip', 'PUT', { fighter: 'courier', kind: 'slot', slot: 1, id: '' }, A.cookie);
  check('emptying a slot', empty.body.career && !row(A.email).equip[slotKey('courier', 1)] && loadoutOf(empty.body.career, 'courier').join() === ',');
  const pal = await call('career/equip', 'PUT', { fighter: 'chef', id: '' }, A.cookie);
  check('a palette equip beside it leaves the slots alone', pal.body.career && row(A.email).equip[slotKey('chef', 1)] === 'reboot');
  const got = await call('career', 'GET', undefined, A.cookie);
  check('GET career hands the moves and the loadout back', got.body.career.owned.includes(moveKey('mopSpin')) && loadoutOf(got.body.career, 'chef').join() === 'reboot,');
}
{
  const B = await signIn('bea');
  const guest = { xp: 50, sticks: 20, owned: [moveKey('updraft'), moveKey('reboot'), 'move:ba_espresso', 'move:nothing'],
    equip: { 'temp:slot1': 'updraft', 'temp:slot2': 'ba_espresso', 'helpdesk:slot1': 'reboot', 'janitor:slot2': 'reboot', 'nobody:slot1': 'reboot' } };
  const m = await call('career/merge', 'POST', { career: guest }, B.cookie);
  const c = m.body && m.body.career;
  check('a guest\'s moves merge at sign-in, junk dropped', c && JSON.stringify(c.owned.filter((k) => k.startsWith('move:')).sort()) === JSON.stringify([moveKey('reboot'), moveKey('updraft')]), JSON.stringify(c && c.owned));
  check('...and the slots, only owned moves a fighter can take', c && loadoutOf(c, 'temp').join() === 'updraft,' && loadoutOf(c, 'janitor').join() === ',reboot' && !c.equip['helpdesk:slot1'] && !c.equip['temp:slot2'] && !c.equip['nobody:slot1'], JSON.stringify(c && c.equip));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
