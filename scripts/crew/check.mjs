// Crew high scores, crew stats, play time and the live count (README, Crew rooms and Analytics), against the
// local Worker, as the pages talk to it (WebSockets and fetch, no browser):
//
//   npx wrangler d1 migrations apply stick-fight-auth --local && npm run build && npm run dev:worker
//   node scripts/crew/check.mjs [http://127.0.0.1:8787/]
//
//   1. play time: arcade and horde results and training heartbeats land in stats_time on today's row
//      (a heartbeat over the cap is cut to it), and api/stats reports them.
//   2. a crew match, end to end: two members press PLAY, the crew opens a quick room, the host's page says
//      the match is on (api/now counts it as crew, with the fighters and no names), both pages report the
//      same result to the room (stats_matchups pvp and stats_time crew go up by one match), the host
//      reports it to the crew (the standings, the crew's time, matches, picks and its own matchup table),
//      and api/now drops it.
//   3. crew high scores: a member's run is taken, a second within 20 s isn't (slow-down), a score over what
//      the rules allow for the stage is refused (too-high), junk is refused (bad-score) without using up the
//      rate limit, a stranger's run is refused (not-member), and so is an unknown crew; the board keeps the
//      top 10 and never shows who posted.
//   4. crew goals and Employee of the Month (README, Crew rooms, Crew goals): a new crew's goal is this week's,
//      sized by goalFor; crew matches move it (the crew's count, each member's part); meeting it pays everyone who
//      played this week once (a guest's page is told, a signed-in member is paid in D1, someone in the lobby who
//      didn't play gets nothing), a member away when it's met is paid when they come back, a resend or reconnect
//      pays nothing more; contributors and Employee of the Month carry initials and a title, never a name; a
//      signed-in member's solo arcade report counts toward their crew, at most SOLO_PER_DAY a day.
//      Needs DEV_HOOKS=1 (dev-goal makes the week's target small) and DEV_LOGIN_CODES=1 in .dev.vars.
// D1 is read with `wrangler d1 execute --local`, so it needs the same .wrangler/state as dev:worker.
// Exit code 1 on any failure.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { weekOf, goalFor, initialsOf, GOAL_PAY, SOLO_PER_DAY, monthName, monthOf } from '../../src/career/crewgoal.js';

const BASE = (process.argv.slice(2).find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8787/').replace(/\/?$/, '/');
const API = BASE + 'api/';
const WS = API.replace(/^http/, 'ws');
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = () => crypto.randomBytes(16).toString('hex');
const post = (path, body) => fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const getJson = async (path) => { const r = await fetch(API + path); return { status: r.status, body: await r.json().catch(() => null) }; };
const day = new Date().toISOString().slice(0, 10);

function d1(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'stick-fight-auth', '--local', '--json', '--command', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out)[0].results;
}
const timeRow = (mode) => d1(`SELECT secs, matches FROM stats_time WHERE day = '${day}' AND mode = '${mode}'`)[0] || { secs: 0, matches: 0 };
const pairRow = (a, b, vs) => d1(`SELECT games, a_wins, b_wins, secs FROM stats_matchups WHERE a = '${a}' AND b = '${b}' AND vs = '${vs}'`)[0] || { games: 0, a_wins: 0, b_wins: 0, secs: 0 };

/** a socket whose messages queue up, and next(pred) waits for one */
function sock(url, cookie = '') {
  const ws = cookie ? new WebSocket(url, { headers: { cookie } }) : new WebSocket(url), q = [], waiters = [];
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    q.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  };
  const open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return {
    ws, open, q,
    send: (o) => ws.send(JSON.stringify(o)),
    next(pred, ms = 6000) {
      const had = q.find(pred);
      if (had) { q.splice(q.indexOf(had), 1); return Promise.resolve(had); }
      return new Promise((res, rej) => { const w = { pred, res }; waiters.push(w); setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error('timeout')); } }, ms); });
    },
    last: (pred) => [...q].reverse().find(pred),
    close: () => { try { ws.close(); } catch { /* gone */ } },
  };
}
/** a member in a crew's lobby: hello, welcome */
async function member(slug, id, name, title = '', cookie = '') {
  const s = sock(`${WS}crews/${slug}/ws`, cookie);
  await s.open;
  s.send({ t: 'hello', pid: id, name, ...(title ? { title } : {}) });
  const w = await s.next((m) => m.t === 'welcome' || m.t === 'error');
  s.you = w.you;
  return s;
}
/** api/now, waiting out its 5 s cache until pred holds */
async function nowUntil(pred, ms = 12000) {
  const end = Date.now() + ms;
  let last = null;
  while (Date.now() < end) { last = (await getJson('now')).body; if (last && pred(last)) return last; await sleep(700); }
  return last;
}

// ---- 0. the goal's rules (src/career/crewgoal.js), no Worker needed ---------------------------------
{
  const mon = weekOf(Date.parse('2026-11-12T15:00:00Z')), sun = weekOf(Date.parse('2026-11-15T23:59:59Z')), next = weekOf(Date.parse('2026-11-16T00:00:00Z'));
  check('rules: a week starts on Monday (UTC): Thursday and Sunday are in the week of the 9th, the next Monday starts a new one', mon === '2026-11-09' && sun === '2026-11-09' && next === '2026-11-16', [mon, sun, next].join());
  const kinds = new Set([0, 1, 2].map((i) => goalFor(weekOf(Date.parse('2026-11-09T00:00:00Z') + i * 7 * 86400000), 4).kind));
  check('rules: the kind goes in turn, three weeks, three kinds', kinds.size === 3, [...kinds].join());
  const sizes = [1, 2, 5, 10, 50].map((n) => goalFor('2026-11-09', n).target);
  check('rules: the target grows with active members, from a floor (a crew of one is sized as two) to a ceiling', sizes[0] === sizes[1] && sizes[1] < sizes[2] && sizes[2] < sizes[3] && sizes[3] <= sizes[4] && goalFor('2026-11-09', 500).target === sizes[4], sizes.join());
  const ini = ['SCOTT PIERCE', 'SCOTT', 'GUEST 736', 'mary ann lee jones', '', '!!'].map(initialsOf);
  check('rules: initials: SP, SC, G7, MAL, ?? for nothing', ini.join() === 'SP,SC,G7,MAL,??,??', ini.join());
}

// ---- 1. play time -----------------------------------------------------------------------------------
{
  const before = { arcade: timeRow('arcade'), horde: timeRow('horde'), training: timeRow('training') };
  const cpu0 = pairRow('lawyer', 'chef', 'cpu');
  const r = await post('e', [
    { e: 'match', m: { mode: 'arcade', p1: 'lawyer', p2: 'chef', wins: [2, 1], secs: 61, how: 'ko', level: 0.3, stage: 2 } },
    { e: 'match', m: { mode: 'horde', p1: 'lawyer', secs: 90, stage: 3 } },
    { e: 'play', m: { mode: 'training', secs: 45 } },
    { e: 'play', m: { mode: 'training', secs: 500 } },    // over the cap: counts 90
    { e: 'play', m: { mode: 'arcade', secs: 50 } },       // arcade's time only comes with its match: ignored
    { e: 'play', m: { mode: 'training', secs: -3 } },     // junk: nothing
  ]);
  check('play time: the events post', r.status === 204, String(r.status));
  await sleep(800);
  const after = { arcade: timeRow('arcade'), horde: timeRow('horde'), training: timeRow('training') };
  check('play time: an arcade match adds its 61 s and one match to today\'s arcade row', after.arcade.secs - before.arcade.secs === 61 && after.arcade.matches - before.arcade.matches === 1, JSON.stringify([before.arcade, after.arcade]));
  check('play time: a horde run adds its 90 s and one match (horde stays out of the matchups)', after.horde.secs - before.horde.secs === 90 && after.horde.matches - before.horde.matches === 1, JSON.stringify([before.horde, after.horde]));
  check('play time: training heartbeats add 45 + 90 (capped) s and no match; arcade and junk heartbeats add nothing', after.training.secs - before.training.secs === 135 && after.training.matches === before.training.matches, JSON.stringify([before.training, after.training]));
  const cpu1 = pairRow('lawyer', 'chef', 'cpu');
  check('play time: the arcade match still counts in stats_matchups (cpu)', cpu1.games - cpu0.games === 1, JSON.stringify([cpu0, cpu1]));
  const st = await getJson('stats');
  const t = st.body && st.body.time;
  check('api/stats has time: all and today, by mode and by cpu / pvp', t && t.day === day && t.all && t.today && t.all.mode && t.all.mode.training && t.all.vs && t.all.vs.cpu && 'pvp' in t.all.vs && typeof t.all.secs === 'number', JSON.stringify(t).slice(0, 200));
  if (t) check('api/stats time adds up: all-time total = the modes, cpu = arcade + horde + training', t.all.secs === Object.values(t.all.mode).reduce((n, m) => n + m.secs, 0)
    && t.all.vs.cpu.secs === t.all.mode.arcade.secs + t.all.mode.horde.secs + t.all.mode.training.secs, JSON.stringify(t.all.vs));
}

// ---- 2. a crew match, end to end -------------------------------------------------------------------
const crew = await (await post('crews', { name: 'LUNCH CREW' })).json();
check('a crew room was made', crew && crew.slug, JSON.stringify(crew));
const slug = crew.slug;
const [pa, pb] = [pid(), pid()];
const A = await member(slug, pa, 'ALICE'), B = await member(slug, pb, 'BOB');
check('two members are in the lobby', A.you && B.you && A.you !== B.you);
{
  const crew0 = timeRow('crew'), pvp0 = pairRow('courier', 'intern', 'pvp');
  const now0 = (await getJson('now')).body;
  A.send({ t: 'play', on: true }); await sleep(100); B.send({ t: 'play', on: true });
  const ma = await A.next((m) => m.t === 'match'), mb = await B.next((m) => m.t === 'match');
  check('PLAY pairs them: the first ready hosts', ma.role === 'host' && mb.role === 'guest' && ma.code === mb.code, `${ma.role}/${mb.role} ${ma.code}`);
  const H = sock(`${WS}rooms/${ma.code}/ws?role=host`), G = sock(`${WS}rooms/${ma.code}/ws?role=guest`);
  await H.open; await G.open;
  await H.next((m) => m.ev === 'welcome'); await G.next((m) => m.ev === 'welcome');
  // the host's page: the match is on (src/net/online.js begin)
  H.send({ t: 'sys', ev: 'live', chars: ['courier', 'intern'] });
  const now1 = await nowUntil((n) => n.crew > (now0.crew || 0));
  check('api/now counts the crew match as live', now1 && now1.crew === (now0.crew || 0) + 1 && now1.matches === now1.quick + now1.crew, JSON.stringify(now1));
  check('api/now gives the fighter pair', now1 && now1.pairs.some((p) => p[0] === 'courier' && p[1] === 'intern'));
  const raw = JSON.stringify(now1 || {});
  check('api/now has no names, codes or ids in it', !/ALICE|BOB|LUNCH/.test(raw) && !raw.includes(ma.code) && !raw.includes(slug) && Object.keys(now1 || {}).sort().join() === 'at,crew,matches,pairs,quick', raw);
  // a guest can't put a match on the count
  G.send({ t: 'sys', ev: 'live', chars: ['ceo', 'ceo'] });
  await sleep(300);
  check('a sys message never reaches the other player', !H.q.some((m) => m.ev === 'live') && !G.q.some((m) => m.ev === 'live'));
  // both pages report the same result to the room (the books), the host reports it to the crew
  const report = { t: 'sys', ev: 'result', n: 1, seed: 4242, mode: 'crew', chars: ['courier', 'intern'], wins: [2, 1], f: 75 * 120, how: 'ko', x: { move: 'jab' } };
  H.send(report); G.send(report);
  A.send({ t: 'result', match: ma.id, n: 1, winner: 0, wins: [2, 1], chars: ['courier', 'intern'], secs: 75 });
  const st = await A.next((m) => m.t === 'state' && m.members.some((x) => x.w > 0));
  await sleep(800);
  const crew1 = timeRow('crew'), pvp1 = pairRow('courier', 'intern', 'pvp');
  check('the crew match counts in stats_matchups (pvp, COURIER v INTERN, the host\'s COURIER won)', pvp1.games - pvp0.games === 1 && pvp1.a_wins - pvp0.a_wins === 1 && pvp1.secs - pvp0.secs === 75, JSON.stringify([pvp0, pvp1]));
  check('the crew match counts in the time rollup as crew: 75 s, one match', crew1.secs - crew0.secs === 75 && crew1.matches - crew0.matches === 1, JSON.stringify([crew0, crew1]));
  const alice = st.members.find((m) => m.id === A.you), bob = st.members.find((m) => m.id === B.you);
  check('the crew match counts in the crew\'s own standings', alice.w === 1 && alice.l === 0 && bob.l === 1 && bob.w === 0 && st.members[0].id === A.you, JSON.stringify(st.members.map((m) => [m.name, m.w, m.l])));
  check('crew stats: time played, matches, most picked', st.stats && st.stats.secs === 75 && st.stats.matches === 1 && st.stats.picks.length === 2, JSON.stringify(st.stats));
  check('crew stats: the crew\'s matchup table (COURIER v INTERN, 1 match, COURIER 1 win, 75 s)', JSON.stringify(st.stats.pairs) === JSON.stringify([['courier', 'intern', 1, 1, 0, 0, 75]]), JSON.stringify(st.stats.pairs));
  check('crew stats: each member\'s time played and favorite', alice.secs === 75 && bob.secs === 75 && alice.fav === 'courier' && bob.fav === 'intern', JSON.stringify([alice.secs, alice.fav, bob.secs, bob.fav]));
  const now2 = await nowUntil((n) => n.crew === (now0.crew || 0));
  check('api/now drops the match once its result is in', now2 && now2.crew === (now0.crew || 0), JSON.stringify(now2));
  // a result resent counts nowhere twice
  H.send(report); G.send(report);
  A.send({ t: 'result', match: ma.id, n: 1, winner: 0, wins: [2, 1], chars: ['courier', 'intern'], secs: 75 });
  await sleep(800);
  const crew2 = timeRow('crew'), pvp2 = pairRow('courier', 'intern', 'pvp');
  check('a resent result counts no second time (rollups)', crew2.matches === crew1.matches && pvp2.games === pvp1.games);
  // a quick match goes on the count as quick, and a player leaving takes it off
  H.close(); G.close();
  const q = await (await post('rooms', {})).json();
  const QH = sock(`${WS}rooms/${q.code}/ws?role=host`), QG = sock(`${WS}rooms/${q.code}/ws?role=guest`);
  await QH.open; await QG.open; await QH.next((m) => m.ev === 'welcome');
  const quick0 = (await nowUntil(() => true)).quick;
  QH.send({ t: 'sys', ev: 'live', chars: ['ceo', 'barista'] });
  const nq = await nowUntil((n) => n.quick > quick0);
  check('a quick match counts as quick', nq && nq.quick === quick0 + 1, JSON.stringify(nq));
  QG.close();
  const nq2 = await nowUntil((n) => n.quick === quick0);
  check('a player leaving takes the match off the count', nq2 && nq2.quick === quick0, JSON.stringify(nq2));
  QH.close();
}

// ---- 3. crew high scores ---------------------------------------------------------------------------
{
  const run = (o) => ({ kind: 'arcade', initials: 'ABC', score: 50000, char: 'courier', reach: 3, ...o });
  const sub = async (id, r, s = slug) => (await (await post(`crews/${s}/scores`, { pid: id, run: r })).json());
  const a1 = await sub(pa, run());
  check('scores: a member\'s arcade run is taken, first place', a1.ok && a1.rank === 0, JSON.stringify(a1));
  const a2 = await sub(pa, run({ score: 60000 }));
  check('scores: the same member again within 20 s is refused (slow-down)', a2.error === 'slow-down', JSON.stringify(a2));
  const cap = await sub(pb, run({ score: 999999, reach: 1 }));
  check('scores: over what stage 1 allows is refused (too-high)', cap.error === 'too-high', JSON.stringify(cap));
  const junk = [run({ initials: 'AB' }), run({ initials: 'A<b' }), run({ char: 'bob' }), run({ score: -5 }), run({ score: 1.5 }), run({ score: '9000' }), run({ kind: 'versus' }), run({ reach: 9 }), run({ reach: 0 }), { kind: 'horde', initials: 'ABC', score: 100, char: 'temp', reach: -1 }, null, 'x'];
  const jr = [];
  for (const j of junk) jr.push((await sub(pb, j)).error);
  check(`scores: ${junk.length} kinds of junk are refused (bad-score)`, jr.every((e) => e === 'bad-score'), jr.join(','));
  const b1 = await sub(pb, { kind: 'horde', initials: 'bob', score: 12000, char: 'intern', reach: 2 });
  check('scores: junk didn\'t use up the rate limit; a horde run is taken (initials upper-cased)', b1.ok && b1.rank === 0, JSON.stringify(b1));
  const stranger = await sub(pid(), run());
  check('scores: a player who never opened the crew is refused (not-member)', stranger.error === 'not-member', JSON.stringify(stranger));
  const nope = await sub(pa, run(), 'no-such-crew-zzzzz');
  check('scores: an unknown crew is refused (no-crew)', nope.error === 'no-crew', JSON.stringify(nope));
  // the top 10: eleven more members post 1,000 to 11,000
  const extra = [];
  for (let i = 0; i < 11; i++) { const id = pid(); extra.push(await member(slug, id, `MEMBER ${i}`)); const r = await sub(id, run({ initials: `M${String(i).padStart(2, '0')}`, score: 1000 * (i + 1), reach: 1, char: 'temp', title: i === 10 ? 'MANAGER' : i === 9 ? 'GRAND POOBAH' : undefined })); if (!r.ok) console.log('  post failed', r); }
  const board = await getJson(`crews/${slug}/scores`);
  const ar = board.body && board.body.arcade;
  check('scores: GET gives the crew\'s name and both tables', board.status === 200 && board.body.name === 'LUNCH CREW' && Array.isArray(board.body.horde), JSON.stringify(board.body).slice(0, 120));
  check('scores: the arcade table keeps the top 10, best first', ar && ar.length === 10 && ar[0].score === 50000 && ar[0].initials === 'ABC' && ar[9].score === 3000 && ar.every((r, i) => !i || ar[i - 1].score >= r.score), ar && ar.map((r) => r.score).join(','));
  check('scores: a row has initials, score, fighter, stage, date, the poster\'s job title, and never who posted it', ar && Object.keys(ar[0]).sort().join() === 'at,char,clear,initials,reach,score,title', ar && Object.keys(ar[0]).join());
  const m10 = ar && ar.find((r) => r.initials === 'M10'), m09 = ar && ar.find((r) => r.initials === 'M09');
  check('scores: a run posted with a job title keeps it (MANAGER); one not on the ladder is dropped', m10 && m10.title === 'MANAGER' && m09 && m09.title === '', JSON.stringify([m10, m09]));
  const hz = board.body && board.body.horde;
  check('scores: the horde table', hz && hz.length === 1 && hz[0].initials === 'BOB' && hz[0].reach === 2, JSON.stringify(hz));
  const lobby = A.last((m) => m.t === 'state');
  check('scores: the lobby\'s state carries both tables (with the poster, for YOU)', lobby && lobby.scores && lobby.scores.arcade.length === 10 && lobby.scores.arcade[0].member === A.you, lobby && JSON.stringify(lobby.scores.arcade[0]));
  const unk = await getJson('crews/no-such-crew-zzzzz/scores');
  check('scores: an unknown crew\'s board is a 404', unk.status === 404, String(unk.status));
  for (const s of extra) s.close();
}
A.close(); B.close();

// ---- 4. crew goals and Employee of the Month --------------------------------------------------------
{
  const call = async (path, method = 'GET', body, cookie = '') => {
    const res = await fetch(API + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  const g0 = await (await post('crews', { name: 'GOAL CREW' })).json();
  const gs = g0.slug;
  // Bea is signed in (her account's player id is the one she says hello with); Al and Cy are guests
  const email = `crew-goal-${Date.now()}@example.com`, pbea = pid();
  const st0 = await call('auth/start', 'POST', { email });
  const v = await call('auth/verify', 'POST', { email, code: st0.body && st0.body.devCode, pid: pbea, name: 'BEA KAY' });
  check('goals: a signed-in member (dev code)', !!v.cookie, JSON.stringify(st0.body).slice(0, 80));
  const [pal, pcy] = [pid(), pid()];
  let Al = await member(gs, pal, 'AL GORE', 'INTERN'), Bea = await member(gs, pbea, 'BEA KAY', 'TEMP', v.cookie), Cy = await member(gs, pcy, 'CYRUS', 'MANAGER');
  const first = await Al.next((m) => m.t === 'state' && m.members.length === 3);
  const g = first.goal, want = goalFor(weekOf(), 1);
  check('goals: a new crew\'s goal is this week\'s, sized when it was first opened (one member, so the smallest) and kept for the week', g && g.week === weekOf() && g.kind === want.kind && g.target === want.target && g.progress === 0 && !g.met && g.ends === Date.parse(`${weekOf()}T00:00:00Z`) + 7 * 86400000, JSON.stringify(g));
  const fresh = await call(`crews/${gs}/dev-goal`, 'POST', { fresh: true });
  const want3 = goalFor(weekOf(), 3);
  check(`goals: a week's goal made with 3 active members is sized for them (${want3.text})`, fresh.body && fresh.body.goal && fresh.body.goal.target === want3.target && fresh.body.goal.kind === want3.kind, JSON.stringify(fresh.body));
  check('goals: the lobby\'s members carry initials and a title from the ladder', first.members.every((m) => m.ini === initialsOf(m.name)) && first.members.find((m) => m.id === Cy.you).title === 'MANAGER' && first.members.find((m) => m.id === Cy.you).ini === 'CY', JSON.stringify(first.members.map((m) => [m.ini, m.title])));
  check('goals: nothing has played yet, so nobody is listed and there\'s no Employee of the Month', g.who.length === 0 && first.eotm === null, JSON.stringify([g.who, first.eotm]));
  // a small target for the test: 4 rounds won by anyone
  const dg = await call(`crews/${gs}/dev-goal`, 'POST', { target: 4, kind: 'rounds' });
  check('goals: the dev hook makes this week\'s target 4 rounds', dg.body && dg.body.goal && dg.body.goal.target === 4 && dg.body.goal.kind === 'rounds', JSON.stringify(dg.body));
  const sticks0 = d1(`SELECT sticks, career_xp FROM accounts WHERE email = '${email}'`)[0];
  /** two members play a crew match the host reports; resolves to the state after it */
  async function crewMatch(H, G, winner, wins) {
    const before = ((H.last((m) => m.t === 'state') || {}).stats || { matches: 0 }).matches;
    H.send({ t: 'play', on: true }); await sleep(80); G.send({ t: 'play', on: true });
    const mh = await H.next((m) => m.t === 'match'); await G.next((m) => m.t === 'match');
    H.send({ t: 'result', match: mh.id, n: 1, winner, wins, chars: ['courier', 'intern'], secs: 60 });
    const s = await H.next((m) => m.t === 'state' && m.stats.matches > before);
    H.send({ t: 'lobby' }); G.send({ t: 'lobby' });
    return s;
  }
  // match 1: Al beats Bea 2-1, three rounds: not met yet
  const s1 = await crewMatch(Al, Bea, 0, [2, 1]);
  check('goals: a crew match moves the goal by every round won (2 + 1 of 4)', s1.goal.progress === 3 && !s1.goal.met, JSON.stringify(s1.goal));
  check('goals: who played is listed by initials and title only, in the order they joined in', JSON.stringify(s1.goal.who.map((w) => [w.ini, w.title]).sort()) === JSON.stringify([['AG', 'INTERN'], ['BK', 'TEMP']]) && s1.goal.who.every((w) => Object.keys(w).sort().join() === 'id,ini,title'), JSON.stringify(s1.goal.who));
  check('goals: no counts beside anyone (nobody reads as the least)', !JSON.stringify(s1.goal.who).match(/"n"|count|rank/), JSON.stringify(s1.goal.who));
  check('eotm: Employee of the Month is the one with the most crew wins this month, by initials and title', s1.eotm && s1.eotm.ini === 'AG' && s1.eotm.title === 'INTERN' && s1.eotm.w === 1 && s1.eotm.current && s1.eotm.month === monthOf() && s1.eotm.name === monthName(monthOf()) && !('name' in s1.eotm && s1.eotm.name === 'AL GORE'), JSON.stringify(s1.eotm));
  check('goals: nobody is paid before it\'s met', ![Al, Bea, Cy].some((x) => x.q.some((m) => m.t === 'goalpay')));
  // Bea leaves; match 2: Cy beats Al 2-0, five rounds of four: met
  Bea.close(); await sleep(300);
  const s2 = await crewMatch(Cy, Al, 0, [2, 0]);
  check('goals: met at 5 of 4 (the bar shows it full)', s2.goal.met && s2.goal.progress === 4, JSON.stringify(s2.goal));
  check('goals: whoever joins in later is listed after the first ones (CY third)', s2.goal.who.length === 3 && s2.goal.who[2].ini === 'CY', JSON.stringify(s2.goal.who));
  const pa1 = await Al.next((m) => m.t === 'goalpay').catch(() => null), pc1 = await Cy.next((m) => m.t === 'goalpay').catch(() => null);
  check('goals: met, a guest in the lobby who played is told the bonus (no account numbers)', pa1 && pa1.award.xp === GOAL_PAY.xp && pa1.award.sticks === GOAL_PAY.sticks && pa1.week === weekOf() && pa1.crew === gs && !pa1.career, JSON.stringify(pa1));
  check('goals: and so is the other player in the match that met it', pc1 && pc1.award.sticks === GOAL_PAY.sticks, JSON.stringify(pc1));
  check('eotm: a tie at one win goes to whoever got there first (AG before CY)', s2.eotm && s2.eotm.ini === 'AG', JSON.stringify(s2.eotm));
  // Bea, away when it was met, is paid on her account when she comes back
  Bea = await member(gs, pbea, 'BEA KAY', 'TEMP', v.cookie);
  const pb1 = await Bea.next((m) => m.t === 'goalpay').catch(() => null);
  const sticks1 = d1(`SELECT sticks, career_xp FROM accounts WHERE email = '${email}'`)[0];
  check('goals: a signed-in member away when it was met is paid when they come back, with their account\'s numbers', pb1 && pb1.career && pb1.career.sticks === sticks0.sticks + GOAL_PAY.sticks, JSON.stringify(pb1 && pb1.career && [pb1.career.sticks, sticks0.sticks]));
  check('goals: in D1, +100 XP and +150 sticks', sticks1.sticks - sticks0.sticks === GOAL_PAY.sticks && sticks1.career_xp - sticks0.career_xp === GOAL_PAY.xp, JSON.stringify([sticks0, sticks1]));
  // nobody twice: a reconnect and another match pay nothing more; someone who never played is never paid
  const D = await member(gs, pid(), 'DEE WATCHER');
  Al.close(); Al = await member(gs, pal, 'AL GORE', 'INTERN');
  Bea.close(); Bea = await member(gs, pbea, 'BEA KAY', 'TEMP', v.cookie);
  await crewMatch(Al, Cy, 1, [0, 2]);
  await sleep(600);
  const sticks2 = d1(`SELECT sticks FROM accounts WHERE email = '${email}'`)[0];
  check('goals: a reconnect or another match after it\'s met pays nobody again', ![Al, Bea, Cy].some((x) => x.q.some((m) => m.t === 'goalpay')) && sticks2.sticks === sticks1.sticks, JSON.stringify([sticks1.sticks, sticks2.sticks]));
  check('goals: someone in the lobby who didn\'t play this week is never paid', !D.q.some((m) => m.t === 'goalpay'));
  const s3 = Cy.last((m) => m.t === 'state');
  check('eotm: CY passes AG with 2 wins', s3.eotm && s3.eotm.ini === 'CY' && s3.eotm.w === 2 && s3.eotm.title === 'MANAGER', JSON.stringify(s3.eotm));
  check('eotm: the state names no "worst": no bottom, loser or last field anywhere', !/worst|bottom|loser|"last place"/i.test(JSON.stringify({ g: s3.goal, e: s3.eotm })));
  // solo: Bea, signed in with this crew on her account, plays arcade alone; it counts, SOLO_PER_DAY a day
  const put = await call('me', 'PUT', { crews: [{ slug: gs, name: 'GOAL CREW', at: Date.now() }] }, v.cookie);
  check('goals: the crew is on Bea\'s account', put.status === 200, JSON.stringify(put.body).slice(0, 80));
  await call(`crews/${gs}/dev-goal`, 'POST', { target: 999, kind: 'matches' });
  const m0 = (await Bea.next((m) => m.t === 'state' && m.goal.target === 999)).goal.progress;
  const solo = { mode: 'arcade', won: true, cut: false, fought: 80, parries: 0, punishes: 0, enders: 0, accidents: 0, perfects: 0, floors: 0, fighter: 'intern', rounds: 2, stage: 1 };
  for (let i = 0; i < SOLO_PER_DAY + 2; i++) await call('career/match', 'POST', { m: solo }, v.cookie);
  await sleep(800);
  const s4 = Bea.last((m) => m.t === 'state');
  check(`goals: a signed-in member's solo arcade stages count toward the crew, ${SOLO_PER_DAY} a day (of ${SOLO_PER_DAY + 2} played)`, s4.goal.progress - m0 === SOLO_PER_DAY, `${m0} -> ${s4.goal.progress}`);
  // a guest's solo play can't count: the career route needs the session
  const anon = await call('career/match', 'POST', { m: solo });
  check('goals: a guest\'s report counts nowhere (signed-out)', anon.body && anon.body.error === 'signed-out');
  for (const x of [Al, Bea, Cy, D]) x.close();
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} of ${results.length} passed`);
process.exit(failed ? 1 : 0);
