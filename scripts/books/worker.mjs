#!/usr/bin/env node
// A run or a match cut short, the Worker's side (README, Analytics, Match bookkeeping), against the local Worker:
//
//   npx wrangler d1 migrations apply stick-fight-auth --local && npm run build && npm run dev:worker
//   node scripts/books/worker.mjs [http://127.0.0.1:8787/]
//
//   1. an arcade stage quit mid-stage ({ quit: 1 }): today's arcade play time goes up by its seconds with no match
//      finished, and the pair's stats_matchups row doesn't change (a quit isn't a loss to that CPU)
//   2. a horde run cut short is just a run: time and one match
//   3. online, no agreed result: both pages say the match started, then the guest leaves; the room adds the seconds it
//      saw (not a page's number) to today's quick row, no match
//   4. online, only the host said it started (the guest's page has Do Not Track on): nothing counts
//   5. online, an agreed result: the match's own length and one match, and nothing more from the room's clock when a
//      player leaves after it
//   6. online, a fragment under ROOM_MIN_SECS: nothing
// D1 is read with `wrangler d1 execute --local`, so it needs the same .wrangler/state as dev:worker. Exit code 1 on any failure.
import { execFileSync } from 'node:child_process';

const BASE = (process.argv.slice(2).find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/').replace(/\/?$/, '/');
const API = BASE + 'api/', WS = API.replace(/^http/, 'ws');
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (path, body) => fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const day = new Date().toISOString().slice(0, 10);
function d1(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'stick-fight-auth', '--local', '--json', '--command', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out)[0].results;
}
const timeRow = (mode) => d1(`SELECT secs, matches FROM stats_time WHERE day = '${day}' AND mode = '${mode}'`)[0] || { secs: 0, matches: 0 };
const pairRow = (a, b, vs) => d1(`SELECT games, a_wins, b_wins, draws, secs FROM stats_matchups WHERE a = '${a}' AND b = '${b}' AND vs = '${vs}'`)[0] || { games: 0, a_wins: 0, b_wins: 0, draws: 0, secs: 0 };
function sock(url) {
  const ws = new WebSocket(url), q = [];
  ws.onmessage = (e) => { try { q.push(JSON.parse(e.data)); } catch { /* */ } };
  const open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return { ws, open, q, send: (o) => ws.send(JSON.stringify(o)), close: () => { try { ws.close(); } catch { /* */ } } };
}
async function room() {
  const { code } = await (await post('rooms', {})).json();
  const H = sock(`${WS}rooms/${code}/ws?role=host`), G = sock(`${WS}rooms/${code}/ws?role=guest`);
  await H.open; await G.open; await sleep(300);
  return { H, G };
}

// 1. arcade quit
{
  const t0 = timeRow('arcade'), p0 = pairRow('intern', 'barista', 'cpu');
  const r = await post('e', [{ e: 'match', m: { mode: 'arcade', p1: 'intern', p2: 'barista', wins: [1, 0], secs: 47, how: 'time', move: 'jab', level: 0.3, stage: 2, quit: 1 } }]);
  await sleep(800);
  const t1 = timeRow('arcade'), p1 = pairRow('intern', 'barista', 'cpu');
  check('arcade quit: the event posts', r.status === 204, String(r.status));
  check('arcade quit: today\'s arcade time goes up 47 s, no match finished', t1.secs - t0.secs === 47 && t1.matches === t0.matches, JSON.stringify([t0, t1]));
  check('arcade quit: no change to the INTERN v BARISTA cpu matchup row', JSON.stringify(p0) === JSON.stringify(p1), JSON.stringify([p0, p1]));
  // anti-tamper caps still hold: a quit can't claim more than an hour
  const t2a = timeRow('arcade');
  await post('e', [{ e: 'match', m: { mode: 'arcade', p1: 'intern', p2: 'barista', wins: [9, 9], secs: 999999, level: 0.3, stage: 2, quit: 1 } }]);
  await sleep(800);
  const t2 = timeRow('arcade'), p2 = pairRow('intern', 'barista', 'cpu');
  check('arcade quit: secs is capped at 3600, still no matchup change', t2.secs - t2a.secs === 3600 && JSON.stringify(p2) === JSON.stringify(p0), JSON.stringify([t2a, t2]));
}
// 2. horde cut short
{
  const t0 = timeRow('horde');
  await post('e', [{ e: 'match', m: { mode: 'horde', p1: 'intern', secs: 300, stage: 2, quit: 1 } }]);
  await sleep(800);
  const t1 = timeRow('horde');
  check('horde cut short: 300 s and one run, like a run that ended', t1.secs - t0.secs === 300 && t1.matches - t0.matches === 1, JSON.stringify([t0, t1]));
}
// 3. online, a rival who left
{
  const q0 = timeRow('quick'), { H, G } = await room();
  H.send({ t: 'sys', ev: 'live', n: 1, chars: ['ceo', 'barista'] }); G.send({ t: 'sys', ev: 'live', n: 1, chars: ['ceo', 'barista'] });
  await sleep(10000);
  G.close(); await sleep(1200);
  const q1 = timeRow('quick');
  const add = q1.secs - q0.secs;
  check('online, rival left: the room adds the ~10 s it saw to quick, no match', add >= 9 && add <= 12 && q1.matches === q0.matches, `+${add} s, ${JSON.stringify([q0, q1])}`);
  H.close();
}
// 4. online, guest said nothing (Do Not Track)
{
  const q0 = timeRow('quick'), { H, G } = await room();
  H.send({ t: 'sys', ev: 'live', n: 1, chars: ['ceo', 'barista'] });
  await sleep(9000);
  G.close(); await sleep(1200);
  const q1 = timeRow('quick');
  check('online, only the host said it started: nothing counts', q1.secs === q0.secs && q1.matches === q0.matches, JSON.stringify([q0, q1]));
  H.close();
}
// 5. online, an agreed result
{
  const q0 = timeRow('quick'), { H, G } = await room();
  H.send({ t: 'sys', ev: 'live', n: 1, chars: ['ceo', 'barista'] }); G.send({ t: 'sys', ev: 'live', n: 1, chars: ['ceo', 'barista'] });
  await sleep(9000);
  const report = { t: 'sys', ev: 'result', n: 1, seed: 777, mode: 'quick', chars: ['ceo', 'barista'], wins: [2, 0], f: 50 * 120, how: 'ko', x: {} };
  H.send(report); G.send(report); await sleep(800);
  G.close(); await sleep(1200);
  const q1 = timeRow('quick');
  check('online, agreed result: the match\'s own 50 s and one match, nothing from the room\'s clock', q1.secs - q0.secs === 50 && q1.matches - q0.matches === 1, JSON.stringify([q0, q1]));
  H.close();
}
// 6. online, a fragment
{
  const q0 = timeRow('quick'), { H, G } = await room();
  H.send({ t: 'sys', ev: 'live', n: 1, chars: ['ceo', 'barista'] }); G.send({ t: 'sys', ev: 'live', n: 1, chars: ['ceo', 'barista'] });
  await sleep(3000);
  H.close(); await sleep(1200);
  const q1 = timeRow('quick');
  check('online, 3 s and gone: nothing', q1.secs === q0.secs, JSON.stringify([q0, q1]));
  G.close();
}
const fail = results.filter((r) => !r).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
