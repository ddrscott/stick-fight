// Match bookkeeping (README, "Analytics"): who was picked, who fought whom, and who won.
//
// Every finished match becomes one `match` data point in Analytics Engine (raw, three months) and one
// upsert into the D1 rollups (all time, migrations/0003_stats.sql), which GET /stick-fight/api/stats
// serves to the homepage and the fighter pages. Fighters and modes only: never a player id, a name
// or an email.
//
// Where a result comes from decides how far it's trusted:
//   vs CPU (arcade)   the page reports it (POST /api/e, event `match`). Nothing can check it, so it's
//                     kept apart as vs = 'cpu' and never mixed into player-vs-player numbers.
//   online            each page reports the result to its quick room over the room's WebSocket
//                     ({t:'sys', ev:'result', ...}; a crew match runs in a quick room too). The room
//                     counts it only when both reports say the same thing (roomResult below), as
//                     vs = 'pvp'. One page alone can't put a result on the books.
//   horde             one `match` data point per run, for its length and hit counts; a run has no
//                     opponent fighter and always ends in a loss, so it stays out of the matchups
//                     (its time still counts).
//
// Play time (migrations/0004_playtime.sql): every match above also adds its length to stats_time, one
// row per UTC day and mode, and training (which has no match) adds the page's heartbeats ({ e: 'play' }).
import { type Env, API, BUSY, json, allowed, track } from "./env";
import { FIGHTERS, isFighter } from "./roster";

export const PICK_MODES = new Set(["arcade", "horde", "training", "dummy", "quick", "crew"]);
const HOW = new Set(["ko", "time", "perfect"]);
const SIM_HZ = 120;                       // the sim's step rate: an online match reports its length in frames
const MAX_SECS = 3600;
const STATS_TTL_S = 600;                  // the edge keeps api/stats this long
const REPORT_TTL_MS = 5 * 60 * 1000;      // one side's report waits this long for the other's
export const TIME_MODES = ["arcade", "horde", "training", "quick", "crew"] as const;
type TimeMode = (typeof TIME_MODES)[number];
const CPU_MODES = new Set<string>(["arcade", "horde", "training"]);   // one player, against the CPU or the dummy
export const PLAY_BEAT_MAX = 90;          // training: the most one heartbeat may add (the page sends one a minute)

/** today's key in stats_time: the UTC date */
export const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

/** Seconds played (and matches finished) on today's row for a mode. Never throws: bookkeeping never breaks a match. */
export async function recordTime(env: Env, mode: TimeMode, secs: number, matches: number): Promise<void> {
  if (!(secs > 0 || matches > 0)) return;
  try {
    await env.DB.prepare(`INSERT INTO stats_time (day, mode, secs, matches, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(day, mode) DO UPDATE SET secs = secs + excluded.secs, matches = matches + excluded.matches, updated_at = excluded.updated_at`)
      .bind(utcDay(), mode, Math.max(0, Math.floor(secs)), matches, Date.now()).run();
  } catch (e) { console.error("stats: time rollup failed", e); }
}

/** A training heartbeat ({ e: 'play', m: { mode: 'training', secs } }): the seconds since the last one, capped.
 *  Returns the promise, or null when it isn't one we count. */
export function recordPlay(env: Env, raw: unknown): Promise<void> | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (m.mode !== "training") return null;   // every other mode's time comes with its match
  const secs = int(m.secs, 0, PLAY_BEAT_MAX);
  return secs > 0 ? recordTime(env, "training", secs, 0) : null;
}

const int = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));
const pair = (v: unknown, hi: number): [number, number] => (Array.isArray(v) ? [int(v[0], 0, hi), int(v[1], 0, hi)] : [0, 0]);
const moveId = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_]{1,32}$/.test(v) ? v : "");

export type Match = {
  mode: "arcade" | "horde" | "quick" | "crew";
  p1: string; p2: string;                 // fighter ids; P1 is the player (vs CPU) or the host (online)
  wins: [number, number];                 // rounds won
  secs: number;                           // match length
  how: string;                            // how the last round ended: ko, time, or perfect (a KO with no damage taken)
  move: string;                           // the move that landed the last KO, "" on a time-out
  level: number;                          // the CPU's difficulty 0..1 (0 online)
  hits: [number, number]; combo: [number, number]; perfects: [number, number];
  stage: number;                          // arcade: the stage; horde: floors cleared
};

/** The details a page adds to a result; the same fields for a vs-CPU match and an online one. */
function details(x: Record<string, unknown>) {
  return { move: moveId(x.move), hits: pair(x.hits, 999), combo: pair(x.combo, 99), perfects: pair(x.perfects, 9) };
}

/** A vs-CPU or horde match as the page reports it ({ e: 'match', m: {...} }), or null if it isn't one. */
export function offlineMatch(raw: unknown): Match | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const mode = m.mode === "arcade" || m.mode === "horde" ? m.mode : null;
  if (!mode || !isFighter(m.p1)) return null;
  const horde = mode === "horde";
  if (!horde && !isFighter(m.p2)) return null;
  const how = typeof m.how === "string" && HOW.has(m.how) ? m.how : "ko";
  return {
    mode, p1: m.p1, p2: horde ? "goons" : (m.p2 as string), wins: horde ? [0, 0] : pair(m.wins, 9), secs: int(m.secs, 0, MAX_SECS), how,
    level: Math.round(Math.max(0, Math.min(1, Number(m.level) || 0)) * 100) / 100, stage: int(m.stage, 0, 999), ...details(m),
  };
}

/** One finished match: the raw data point, and (not for horde) the rollup's upsert. */
export async function recordMatch(env: Env, req: Request | null, m: Match): Promise<void> {
  const horde = m.mode === "horde", pvp = m.mode === "quick" || m.mode === "crew";
  const winner = m.wins[0] > m.wins[1] ? 0 : m.wins[1] > m.wins[0] ? 1 : -1;
  const mirror = m.p1 === m.p2;
  // blobs: event, mode, P1's fighter, P2's fighter, result, cpu / pvp, how it ended, the finishing move (then the country)
  // doubles: seconds, P1's rounds, P2's rounds, CPU level, hits P1, hits P2, best combo P1, best combo P2,
  //          perfect rounds P1, perfect rounds P2, mirror (1 or 0), stage
  track(env, req, "match", [m.mode, m.p1, m.p2, horde ? "run" : winner < 0 ? "draw" : winner === 0 ? "p1" : "p2", pvp ? "pvp" : "cpu", m.how, m.move],
    m.secs, [m.wins[0], m.wins[1], m.level, m.hits[0], m.hits[1], m.combo[0], m.combo[1], m.perfects[0], m.perfects[1], mirror ? 1 : 0, m.stage]);
  await recordTime(env, m.mode, m.secs, 1);   // play time: every mode, horde included
  if (horde) return;
  // vs CPU the row reads player's fighter against the CPU's; online the pair is stored once, a <= b
  const flip = pvp && m.p1 > m.p2;
  const [a, b] = flip ? [m.p2, m.p1] : [m.p1, m.p2];
  const aWon = winner >= 0 && (winner === 0) !== flip, bWon = winner >= 0 && !aWon;
  const perfect = m.how === "perfect";
  try {
    await env.DB.prepare(`INSERT INTO stats_matchups (a, b, vs, games, a_wins, b_wins, draws, secs, a_rounds, b_rounds, a_perfects, b_perfects, timeouts, updated_at)
      VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
      ON CONFLICT(a, b, vs) DO UPDATE SET games = games + 1, a_wins = a_wins + excluded.a_wins, b_wins = b_wins + excluded.b_wins,
        draws = draws + excluded.draws, secs = secs + excluded.secs, a_rounds = a_rounds + excluded.a_rounds, b_rounds = b_rounds + excluded.b_rounds,
        a_perfects = a_perfects + excluded.a_perfects, b_perfects = b_perfects + excluded.b_perfects, timeouts = timeouts + excluded.timeouts,
        updated_at = excluded.updated_at`)
      .bind(a, b, pvp ? "pvp" : "cpu", aWon ? 1 : 0, bWon ? 1 : 0, winner < 0 ? 1 : 0, m.secs, flip ? m.wins[1] : m.wins[0], flip ? m.wins[0] : m.wins[1],
        perfect && aWon ? 1 : 0, perfect && bWon ? 1 : 0, m.how === "time" ? 1 : 0, Date.now())
      .run();
  } catch (e) { console.error("stats: match rollup failed", e); }   // bookkeeping never breaks a match
}

/** A fighter chosen at a character select ({ e: 'pick', l: [mode, fighter] }). False if it isn't a pick we count. */
export function recordPick(env: Env, req: Request, ctx: ExecutionContext, labels: string[]): boolean {
  const [mode, fighter] = labels;
  if (!PICK_MODES.has(mode) || !isFighter(fighter)) return false;
  track(env, req, "pick", [mode, fighter]);
  ctx.waitUntil(env.DB.prepare(`INSERT INTO stats_picks (fighter, mode, picks, updated_at) VALUES (?1, ?2, 1, ?3)
      ON CONFLICT(fighter, mode) DO UPDATE SET picks = picks + 1, updated_at = excluded.updated_at`).bind(fighter, mode, Date.now()).run()
    .catch((e) => console.error("stats: pick rollup failed", e)));
  return true;
}

// ---- online results: counted only when both players' pages agree -----------------------------------------
// The two sims already end a match on the same confirmed frame with the same state hash (src/net/online.js),
// so both pages hold the same result. Each sends it to the room; the room keeps the first one and, when the
// second arrives for the same match, compares what both must agree on: the match number and seed, the mode,
// both fighters, the rounds each won, the length in frames and how the last round ended. The same on both:
// it's recorded, once. Different: nothing is recorded but a `match_reject` data point. The extra details (the
// finishing move, hit counts) come from each page's own effects, which rollback can leave a hit apart, so
// they're taken from the host's report and aren't part of the agreement.
type Report = { key: string; core: string; match: Match; at: number };

function onlineReport(m: Record<string, unknown>): Report | null {
  const mode = m.mode === "crew" ? "crew" : m.mode === "quick" ? "quick" : null;
  const chars = Array.isArray(m.chars) ? m.chars : [];
  if (!mode || !isFighter(chars[0]) || !isFighter(chars[1])) return null;
  const n = int(m.n, 1, 9999), seed = Number(m.seed) >>> 0, frames = int(m.f, 0, MAX_SECS * SIM_HZ), wins = pair(m.wins, 9);
  const how = typeof m.how === "string" && HOW.has(m.how) ? m.how : "ko";
  const x = m.x && typeof m.x === "object" ? (m.x as Record<string, unknown>) : {};
  return {
    key: `${n}:${seed}`, core: [n, seed, mode, chars[0], chars[1], wins[0], wins[1], frames, how].join("|"), at: Date.now(),
    match: { mode, p1: chars[0], p2: chars[1], wins, secs: Math.round(frames / SIM_HZ), how, level: 0, stage: 0, ...details(x) },
  };
}

/** A {t:'sys', ev:'result'} message from one player's page (worker/index.ts Room). Never passed on to the other. */
export async function roomResult(storage: DurableObjectStorage, env: Env, role: "host" | "guest", raw: string): Promise<void> {
  let msg: Record<string, unknown>;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || msg.ev !== "result") return;
  const mine = onlineReport(msg);
  if (!mine) return;
  if ((await storage.get<string>("res:done")) === mine.key) return;   // already on the books: a resend
  const peer = role === "host" ? "guest" : "host";
  const theirs = await storage.get<Report>(`res:${peer}`);
  if (!theirs || theirs.key !== mine.key || Date.now() - theirs.at > REPORT_TTL_MS) { await storage.put(`res:${role}`, mine); return; }
  await storage.delete(["res:host", "res:guest"]);
  if (theirs.core !== mine.core) { track(env, null, "match_reject", [mine.match.mode, mine.match.p1, mine.match.p2]); return; }
  await storage.put("res:done", mine.key);
  await recordMatch(env, null, role === "host" ? mine.match : theirs.match);
}

// ---- GET /stick-fight/api/stats -------------------------------------------------------------------------
type Side = { games: number; wins: number; losses: number; draws: number; secs: number; perfects: number; mirrors: number };
type Row = { a: string; b: string; vs: string; games: number; a_wins: number; b_wins: number; draws: number; secs: number; a_perfects: number; b_perfects: number; timeouts: number };
const side = (): Side => ({ games: 0, wins: 0, losses: 0, draws: 0, secs: 0, perfects: 0, mirrors: 0 });

type TimeRow = { mode: string; secs: number; matches: number };
type Spent = { secs: number; matches: number };
/** Play time from stats_time: all time and today (UTC), by mode and by one player (cpu) or two (pvp). */
export function playTime(day: string, all: TimeRow[], today: TimeRow[]) {
  const sum = (rows: TimeRow[]) => {
    const mode = Object.fromEntries(TIME_MODES.map((m) => [m, { secs: 0, matches: 0 }])) as Record<TimeMode, Spent>;
    const vs = { cpu: { secs: 0, matches: 0 }, pvp: { secs: 0, matches: 0 } }, total = { secs: 0, matches: 0 };
    for (const row of rows) {
      const m = mode[row.mode as TimeMode];
      if (!m) continue;
      const secs = Number(row.secs) || 0, matches = Number(row.matches) || 0, v = CPU_MODES.has(row.mode) ? vs.cpu : vs.pvp;
      m.secs += secs; m.matches += matches; v.secs += secs; v.matches += matches; total.secs += secs; total.matches += matches;
    }
    return { ...total, mode, vs };
  };
  return { day, all: sum(all), today: sum(today) };
}

/** The rollups as the pages read them. */
async function buildStats(env: Env) {
  const day = utcDay();
  const [p, r, ta, td] = await env.DB.batch([
    env.DB.prepare("SELECT fighter, mode, picks FROM stats_picks"),
    env.DB.prepare("SELECT a, b, vs, games, a_wins, b_wins, draws, secs, a_perfects, b_perfects, timeouts FROM stats_matchups"),
    env.DB.prepare("SELECT mode, SUM(secs) AS secs, SUM(matches) AS matches FROM stats_time GROUP BY mode"),
    env.DB.prepare("SELECT mode, secs, matches FROM stats_time WHERE day = ?1").bind(day),
  ]);
  const fighters: Record<string, { picks: Record<string, number>; cpu: Side; pvp: Side }> = {};
  for (const id of FIGHTERS) fighters[id] = { picks: {}, cpu: side(), pvp: side() };
  for (const row of p.results as { fighter: string; mode: string; picks: number }[]) {
    if (fighters[row.fighter] && PICK_MODES.has(row.mode)) fighters[row.fighter].picks[row.mode] = row.picks;
  }
  const totals = { cpu: { games: 0, secs: 0, timeouts: 0 }, pvp: { games: 0, secs: 0, timeouts: 0 } };
  const matchups: Record<"cpu" | "pvp", (string | number)[][]> = { cpu: [], pvp: [] };
  const add = (s: Side, row: Row, wins: number, losses: number, perfects: number) => {
    s.games += row.games; s.wins += wins; s.losses += losses; s.draws += row.draws; s.secs += row.secs; s.perfects += perfects;
  };
  for (const row of r.results as Row[]) {
    const vs = row.vs === "pvp" ? "pvp" : row.vs === "cpu" ? "cpu" : null;
    if (!vs || !fighters[row.a] || !fighters[row.b]) continue;
    totals[vs].games += row.games; totals[vs].secs += row.secs; totals[vs].timeouts += row.timeouts;
    matchups[vs].push([row.a, row.b, row.games, row.a_wins, row.b_wins, row.draws, row.secs]);
    if (vs === "cpu") add(fighters[row.a].cpu, row, row.a_wins, row.b_wins, row.a_perfects);   // the player's fighter only; a mirror counts (a person against the CPU)
    else if (row.a === row.b) fighters[row.a].pvp.mirrors += row.games;                        // a mirror says nothing about the fighter
    else { add(fighters[row.a].pvp, row, row.a_wins, row.b_wins, row.a_perfects); add(fighters[row.b].pvp, row, row.b_wins, row.a_wins, row.b_perfects); }
  }
  return { at: Date.now(), ttl: STATS_TTL_S, totals, fighters, matchups, time: playTime(day, ta.results as TimeRow[], td.results as TimeRow[]) };
}

/** Public and the same for everyone, so the edge keeps one copy per location for ten minutes (the Cache API). */
export async function statsResponse(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
  if (!(await allowed(env.STATS_LIMIT, req))) return json({ error: "busy", message: BUSY }, 429, { "retry-after": "60" });
  const key = new Request(new URL(`${API}stats`, req.url).toString());   // no query string: one entry, whatever is tacked on
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) return hit;
  try {
    const res = json(await buildStats(env), 200, { "cache-control": `public, max-age=60, s-maxage=${STATS_TTL_S}` });
    ctx.waitUntil(cache.put(key, res.clone()).catch(() => {}));
    return res;
  } catch (e) {
    console.error("stats: read failed", e);   // the tables aren't there yet, or D1 is down: the pages keep their static fallback
    return json({ error: "unavailable" }, 503);
  }
}
