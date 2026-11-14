// A crew room (README, "Multiplayer", Crew rooms): a group of friends with a permanent link
// (https://neonstickfight.com/play/?crew=<slug>). One Durable Object per crew, named by its
// slug, keeping the crew in its own SQLite storage:
//
//   meta      the crew's name, slug, when it was made, when it expires
//   members   one row per player who has opened the link: a hash of the player id (never the id
//             itself), the display name, first and last seen, wins, losses, draws, rounds, last pick
//   plays     how many matches each member has played with each fighter (the favorite is the most)
//   h2h       head to head for every pair that has played: wins each, draws, rounds each
//   matches   every recorded match (the last 300), keyed by "<match id>:<n>" so a result counts once
//   live      the matches the room has started: which quick room, who hosts, who joins
//   mtime     each member's time played in the crew's matches (seconds, from the host's report)
//   fpairs    the crew's own matchup table: fighter against fighter, matches, wins each, draws, seconds
//   scores    the crew's high score tables, ARCADE and HORDE (the top 10 of each): initials, score,
//             fighter, the stage or floors reached, when, and which member posted it (never shown)
//   posts     when each member last posted a score (a day's worth), for the rate limit
//   goal      the crew's weekly goal (README, Crew rooms, Crew goals): the week, its kind and target, the
//             progress, and when it was met
//   gcontrib  who played toward each week's goal: their count, matches, solo matches today, and whether
//             the goal's bonus has been paid to them
//   monthly   crew wins per member per month, for Employee of the Month (the top only, never a bottom)
//
// The lobby is the room's WebSocket (hibernating): presence (who's here and whether they're idle,
// ready or playing), PLAY, and the standings. When two members are ready the room opens a quick room
// (worker/index.ts Room) for them and tells each its role; the match itself runs there as any
// online match does (WebRTC or the relay). The host's page reports each match's result here, once.
// If someone else is waiting when a match ends, the winner stays on: the room tells both players, the
// loser goes back to the lobby and the winner plays the one waiting.
//
// Messages (JSON). From the page: hello {pid, name, title?}, name {name}, play {on, stay?}, lobby {title?},
// result {match, n, winner (0 host, 1 guest, -1 draw), wins, chars}. From the room: welcome {you}, state
// {...}, match {id, code, role, rival}, rotate {match, stay, next}, goalpay {week, award, career?},
// error {reason}.
//
// Crew goals are paid here, server-side: when the week's goal is met, each member who played that week is
// paid GOAL_PAY once (gcontrib.paid). A signed-in member (the session cookie came with the socket) is paid
// on the account (worker/career.ts awardCrewGoal); a guest's page is told and adds it to its own career.
// Whoever isn't in the lobby then is paid the next time they open it (for OWED_WEEKS).
//
// A crew with no activity (nobody opening it, no result) for 90 days is deleted by the alarm.
import { DurableObject } from "cloudflare:workers";
import { type Env, claimRoom, sha256, PID_RE, cleanName, track } from "./env";
import { currentEmail } from "./auth";
import { awardCrewGoal } from "./career";
import { weekOf, weekEnds, goalFor, crewCounts, memberCounts, initialsOf, cleanTitle, monthOf, monthName, prevMonth, GOAL_PAY, ACTIVE_DAYS, SOLO_PER_DAY, OWED_WEEKS } from "../src/career/crewgoal.js";
import { isFighter } from "./roster";
import { scoreCap, MAX_STAGE, MAX_FLOORS } from "../src/flow/scorecap.js";
import { blockedName } from "../src/namefilter.js";
import { TITLES } from "../src/career/rules.js";

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CREW_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_MEMBERS = 50;
const MAX_SOCKETS = 80;
const RECENT = 20;
const KEEP_MATCHES = 300;
const MAX_MESSAGE = 4096;
const MSG_RATE = 10, MSG_BURST = 30, MSG_STRIKES = 200;
const LIVE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SECS = 3600;                     // the longest match length a result may report
// crew high scores (README, Crew rooms, High scores): the page reports a finished run; these keep it plausible
export const SCORE_KINDS = ["arcade", "horde"] as const;
export type ScoreKind = (typeof SCORE_KINDS)[number];
const BOARD = 10;                          // rows kept per table
const POST_GAP_MS = 20 * 1000;             // one score a member per 20 seconds (a run takes minutes)
const POSTS_PER_DAY = 30;                  // and 30 a day
const DAY_MS = 24 * 60 * 60 * 1000;
const INITIALS_RE = /^[A-Z0-9]{3}$/;
// title: the poster's job title when they posted it (README, Progression), '' for a row from before titles
// up: 1 when the run was played with stat upgrades (README, Progression, Stat upgrades), shown as an UP tag
export type ScoreRow = { initials: string; score: number; char: string; reach: number; clear: number; at: number; title: string; up: number };

type Status = "lobby" | "ready" | "match";
// email: the signed-in account behind this socket (from the session cookie at the upgrade), for the goal's pay
type Att = { mid: string; name: string; status: Status; readyAt: number; match: string; email?: string; pid?: string };
type Counts = { matches: number; rounds: number; wins: number };
type Goal = { week: string; kind: keyof Counts; target: number; progress: number; met_at: number };
type Live = { id: string; code: string; host: string; guest: string; at: number };

export class Crew extends DurableObject<Env> {
  private schema = false;
  private buckets = new WeakMap<WebSocket, { tokens: number; at: number; strikes: number }>();

  private sql<T extends Record<string, SqlStorageValue>>(q: string, ...b: unknown[]): T[] {
    return this.ctx.storage.sql.exec<T>(q, ...b).toArray();
  }
  private ensure() {
    if (this.schema) return;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
        w INTEGER NOT NULL DEFAULT 0, l INTEGER NOT NULL DEFAULT 0, d INTEGER NOT NULL DEFAULT 0,
        rw INTEGER NOT NULL DEFAULT 0, rl INTEGER NOT NULL DEFAULT 0, last_char TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS plays (member TEXT NOT NULL, char TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (member, char));
      CREATE TABLE IF NOT EXISTS h2h (a TEXT NOT NULL, b TEXT NOT NULL, aw INTEGER NOT NULL DEFAULT 0, bw INTEGER NOT NULL DEFAULT 0,
        d INTEGER NOT NULL DEFAULT 0, ar INTEGER NOT NULL DEFAULT 0, br INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (a, b));
      CREATE TABLE IF NOT EXISTS matches (key TEXT PRIMARY KEY, at INTEGER NOT NULL, host TEXT NOT NULL, guest TEXT NOT NULL,
        winner INTEGER NOT NULL, hw INTEGER NOT NULL, gw INTEGER NOT NULL, hc TEXT NOT NULL, gc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS live (id TEXT PRIMARY KEY, code TEXT NOT NULL, host TEXT NOT NULL, guest TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mtime (member TEXT PRIMARY KEY, secs INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS fpairs (a TEXT NOT NULL, b TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, aw INTEGER NOT NULL DEFAULT 0,
        bw INTEGER NOT NULL DEFAULT 0, d INTEGER NOT NULL DEFAULT 0, secs INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (a, b));
      CREATE TABLE IF NOT EXISTS scores (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, at INTEGER NOT NULL, member TEXT NOT NULL,
        initials TEXT NOT NULL, score INTEGER NOT NULL, char TEXT NOT NULL, reach INTEGER NOT NULL, clear INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS scores_kind ON scores (kind, score DESC);
      CREATE TABLE IF NOT EXISTS posts (member TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS goal (week TEXT PRIMARY KEY, kind TEXT NOT NULL, target INTEGER NOT NULL, progress INTEGER NOT NULL DEFAULT 0, met_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS gcontrib (week TEXT NOT NULL, member TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, matches INTEGER NOT NULL DEFAULT 0,
        first INTEGER NOT NULL DEFAULT 0, solo_day TEXT NOT NULL DEFAULT '', solo_n INTEGER NOT NULL DEFAULT 0, paid INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (week, member));
      CREATE TABLE IF NOT EXISTS monthly (month TEXT NOT NULL, member TEXT NOT NULL, w INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (month, member));
    `);
    // each member's job title (README, Progression), for the goal's contributors and Employee of the Month: added to an older crew
    try { this.ctx.storage.sql.exec("ALTER TABLE members ADD COLUMN title TEXT NOT NULL DEFAULT ''"); } catch { /* already there */ }
    // the poster's job title beside the initials (README, Progression; 2026-11-12): added to a crew made before it
    try { this.ctx.storage.sql.exec("ALTER TABLE scores ADD COLUMN title TEXT NOT NULL DEFAULT ''"); } catch { /* already there */ }
    // whether the run had stat upgrades (README, Progression, Stat upgrades; 2026-11-14): added to a crew made before them
    try { this.ctx.storage.sql.exec("ALTER TABLE scores ADD COLUMN up INTEGER NOT NULL DEFAULT 0"); } catch { /* already there */ }
    this.schema = true;
    // a crew from before the matchup table: fill it once from the matches it still keeps (the last 300)
    if (this.meta("name") !== null && this.meta("fpairs") === null) {
      this.ctx.storage.sql.exec(`INSERT OR IGNORE INTO fpairs (a, b, n, aw, bw, d)
        SELECT CASE WHEN hc <= gc THEN hc ELSE gc END, CASE WHEN hc <= gc THEN gc ELSE hc END, COUNT(*),
          SUM(CASE WHEN winner < 0 THEN 0 WHEN (winner = 0) = (hc <= gc) THEN 1 ELSE 0 END),
          SUM(CASE WHEN winner < 0 THEN 0 WHEN (winner = 0) = (hc <= gc) THEN 0 ELSE 1 END),
          SUM(CASE WHEN winner < 0 THEN 1 ELSE 0 END)
        FROM matches WHERE hc <> '' AND gc <> '' GROUP BY 1, 2`);
      this.setMeta("fpairs", 1);
    }
  }
  private meta(k: string): string | null {
    const r = this.sql<{ v: string }>("SELECT v FROM meta WHERE k = ?", k);
    return r.length ? r[0].v : null;
  }
  private setMeta(k: string, v: string | number) {
    this.ctx.storage.sql.exec("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, String(v));
  }
  /** activity: the crew lives another 90 days */
  private async touch() {
    const at = Date.now() + CREW_TTL_MS;
    this.setMeta("expires", at);
    await this.ctx.storage.setAlarm(at);
  }
  private exists(): boolean { this.ensure(); return this.meta("name") !== null && Number(this.meta("expires") || 0) > Date.now(); }

  /** Called by the Worker for POST /crews. False if the slug is taken. */
  async create(slug: string, name: string): Promise<boolean> {
    this.ensure();
    if (this.meta("name") !== null) {
      if (Number(this.meta("expires") || 0) > Date.now()) return false;
      await this.wipe();   // an expired crew whose alarm hasn't run yet
      this.ensure();
    }
    this.setMeta("name", name); this.setMeta("slug", slug); this.setMeta("created", Date.now());
    await this.touch();
    return true;
  }

  /** For a share preview (worker/og.ts): the crew's name and how many members it has, or null when
   *  there's no such crew or it expired. Reads only: a slug nobody made gets no storage. Never a
   *  member's name or record (the preview is public). */
  async card(): Promise<{ name: string; members: number } | null> {
    if (!this.schema && !this.sql("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").length) return null;
    const name = this.meta("name");
    if (name === null || Number(this.meta("expires") || 0) <= Date.now()) return null;
    const has = this.schema || this.sql("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'members'").length > 0;
    return { name, members: has ? this.sql<{ n: number }>("SELECT COUNT(*) AS n FROM members")[0].n : 0 };
  }

  /** The lobby's WebSocket (the Worker checked the slug and the join limit). */
  async fetch(req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // a crew room has members, never spectators: its matches are the crew's own (README, Spectators)
    const role = new URL(req.url).searchParams.get("role") || "";
    const reason = role === "spectator" || role === "watch" ? "no-spectators" : !this.exists() ? "no-crew" : this.ctx.getWebSockets().length >= MAX_SOCKETS ? "full" : "";
    this.ctx.acceptWebSocket(server, [reason ? "refused" : "crew"]);
    if (reason) {
      server.send(JSON.stringify({ t: "error", reason }));
      server.close(4000, reason);
    } else {
      // signed in: the crew goal's bonus goes to the account (kept on the socket, so it outlives hibernation)
      let email = "";
      try { email = (await currentEmail(req, this.env)) || ""; } catch { /* a guest, as far as the goal knows */ }
      server.serializeAttachment({ mid: "", name: "", status: "lobby", readyAt: 0, match: "", email } satisfies Att);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /** the lobby's open sockets (one that's closing is left out, so presence drops it at once) */
  private sockets(): WebSocket[] { return this.ctx.getWebSockets("crew").filter((w) => w.readyState === 1); }
  private att(ws: WebSocket): Att { return (ws.deserializeAttachment() as Att) || { mid: "", name: "", status: "lobby", readyAt: 0, match: "" }; }
  private setAtt(ws: WebSocket, a: Att) { ws.serializeAttachment(a); }
  private send(ws: WebSocket, msg: unknown) { try { ws.send(typeof msg === "string" ? msg : JSON.stringify(msg)); } catch { /* closing */ } }

  private take(ws: WebSocket): boolean {
    const now = Date.now();
    let b = this.buckets.get(ws);
    if (!b) this.buckets.set(ws, (b = { tokens: MSG_BURST, at: now, strikes: 0 }));
    b.tokens = Math.min(MSG_BURST, b.tokens + ((now - b.at) / 1000) * MSG_RATE);
    b.at = now;
    if (b.tokens >= 1) { b.tokens -= 1; return true; }
    if (++b.strikes >= MSG_STRIKES) { this.send(ws, { t: "error", reason: "flood" }); try { ws.close(4008, "flood"); } catch { /* gone */ } }
    return false;
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > MAX_MESSAGE || !this.take(ws)) return;
    if (this.ctx.getTags(ws)[0] !== "crew") return;
    let m: Record<string, unknown>;
    try { m = JSON.parse(message); } catch { return; }
    if (!m || typeof m !== "object") return;
    this.ensure();
    if (!this.exists()) { this.send(ws, { t: "error", reason: "no-crew" }); try { ws.close(4000, "no-crew"); } catch { /* gone */ } return; }
    const a = this.att(ws);
    if (m.t === "hello") return this.hello(ws, a, m);
    if (!a.mid) return;   // nothing before hello
    if (m.t === "name") {
      const sent = cleanName(m.name);
      if (!sent) return;
      if (blockedName(sent)) { this.send(ws, { t: "error", reason: "blocked-name" }); return; }   // the name filter: the old name stays
      const name = this.heldName(a.mid, sent);
      this.ctx.storage.sql.exec("UPDATE members SET name = ? WHERE id = ?", name, a.mid);
      for (const w of this.sockets()) { const b = this.att(w); if (b.mid === a.mid) this.setAtt(w, { ...b, name }); }
      this.broadcast();
    } else if (m.t === "play") {
      if (a.status === "match") return;
      this.setAtt(ws, { ...a, status: m.on ? "ready" : "lobby", readyAt: m.on ? (m.stay ? 1 : Date.now()) : 0 });
      await this.pair();
      this.broadcast();
    } else if (m.t === "lobby") {
      this.setAtt(ws, { ...a, status: "lobby", readyAt: 0, match: "" });
      this.setTitle(a.mid, m.title);   // a promotion during the match shows by the time they're back
      this.broadcast();
    } else if (m.t === "result") {
      await this.result(ws, a, m);
    }
  }

  private async hello(ws: WebSocket, a: Att, m: Record<string, unknown>) {
    const pid = typeof m.pid === "string" ? m.pid : "";
    const sent = cleanName(m.name);
    if (!PID_RE.test(pid) || !sent) { this.send(ws, { t: "error", reason: "bad-hello" }); try { ws.close(4000, "bad-hello"); } catch { /* gone */ } return; }
    // a name off the filter's list (src/namefilter.js) doesn't come into the crew: the page asks for another
    if (blockedName(sent)) { this.send(ws, { t: "error", reason: "blocked-name" }); try { ws.close(4000, "blocked-name"); } catch { /* gone */ } return; }
    // the member id: a hash of the player id, salted with the slug (the id itself is the player's key)
    const mid = (await sha256(`crew:${this.meta("slug")}:${pid}`)).slice(0, 16);
    const name = this.heldName(mid, sent);
    const now = Date.now();
    const known = this.sql("SELECT 1 FROM members WHERE id = ?", mid).length > 0;
    if (!known && this.sql<{ n: number }>("SELECT COUNT(*) AS n FROM members")[0].n >= MAX_MEMBERS) {
      this.send(ws, { t: "error", reason: "crew-full" }); try { ws.close(4000, "crew-full"); } catch { /* gone */ } return;
    }
    if (known) this.ctx.storage.sql.exec("UPDATE members SET name = ?, last_seen = ? WHERE id = ?", name, now, mid);
    else this.ctx.storage.sql.exec("INSERT INTO members (id, name, first_seen, last_seen) VALUES (?, ?, ?, ?)", mid, name, now, now);
    this.setTitle(mid, m.title);
    const att: Att = { mid, name, status: "lobby", readyAt: 0, match: "", email: a.email || "", pid };
    this.setAtt(ws, att);
    await this.touch();
    this.send(ws, { t: "welcome", you: mid });
    this.broadcast();
    await this.payOwed(att);   // a goal met while they were away: paid now
  }

  /** two ready members (the longest waiting first; a winner staying on goes to the front) play */
  private async pair() {
    const ready = this.sockets().map((w) => ({ w, a: this.att(w) })).filter((x) => x.a.mid && x.a.status === "ready").sort((x, y) => x.a.readyAt - y.a.readyAt);
    const first = ready[0], second = first && ready.find((x) => x.a.mid !== first.a.mid);
    if (!first || !second) return;
    const code = await claimRoom(this.env, true);   // private: a crew match is never open to spectators
    if (!code) return;   // no free code: they stay ready, the next press tries again
    const id = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
    const now = Date.now();
    this.ctx.storage.sql.exec("DELETE FROM live WHERE at < ?", now - LIVE_TTL_MS);
    this.ctx.storage.sql.exec("INSERT INTO live (id, code, host, guest, at) VALUES (?, ?, ?, ?, ?)", id, code, first.a.mid, second.a.mid, now);
    this.setAtt(first.w, { ...first.a, status: "match", readyAt: 0, match: id });
    this.setAtt(second.w, { ...second.a, status: "match", readyAt: 0, match: id });
    this.send(first.w, { t: "match", id, code, role: "host", rival: { id: second.a.mid, name: second.a.name } });
    this.send(second.w, { t: "match", id, code, role: "guest", rival: { id: first.a.mid, name: first.a.name } });
  }

  private async result(ws: WebSocket, a: Att, m: Record<string, unknown>) {
    const id = String(m.match || ""), n = Math.floor(Number(m.n));
    const live = this.sql<Live>("SELECT id, code, host, guest, at FROM live WHERE id = ?", id)[0];
    // the host's page is the one that counts (as in every online match)
    if (!live || live.host !== a.mid || !(n >= 1 && n < 10000)) return;
    const winner = Number(m.winner) === 0 ? 0 : Number(m.winner) === 1 ? 1 : -1;
    const wins = Array.isArray(m.wins) ? m.wins.map((v) => Math.max(0, Math.min(9, Math.floor(Number(v) || 0)))) : [0, 0];
    const chars = Array.isArray(m.chars) ? m.chars.map((c) => (isFighter(c) ? c : "")) : ["", ""];
    const [hw, gw] = [wins[0] | 0, wins[1] | 0], [hc, gc] = [chars[0] || "", chars[1] || ""];
    const secs = Math.max(0, Math.min(MAX_SECS, Math.floor(Number(m.secs) || 0)));   // the match's length (older pages send none)
    const key = `${id}:${n}`, now = Date.now();
    const recorded = this.ctx.storage.transactionSync(() => {
      const ins = this.sql("INSERT INTO matches (key, at, host, guest, winner, hw, gw, hc, gc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO NOTHING RETURNING key",
        key, now, live.host, live.guest, winner, hw, gw, hc, gc);
      if (!ins.length) return false;   // already counted
      const res = (mid: string, won: boolean, lost: boolean, rw: number, rl: number, ch: string) => {
        this.ctx.storage.sql.exec("UPDATE members SET w = w + ?, l = l + ?, d = d + ?, rw = rw + ?, rl = rl + ?, last_char = CASE WHEN ? = '' THEN last_char ELSE ? END WHERE id = ?",
          won ? 1 : 0, lost ? 1 : 0, !won && !lost ? 1 : 0, rw, rl, ch, ch, mid);
        if (ch) this.ctx.storage.sql.exec("INSERT INTO plays (member, char, n) VALUES (?, ?, 1) ON CONFLICT(member, char) DO UPDATE SET n = n + 1", mid, ch);
      };
      res(live.host, winner === 0, winner === 1, hw, gw, hc);
      res(live.guest, winner === 1, winner === 0, gw, hw, gc);
      // head to head, stored once per pair with a < b
      const hostIsA = live.host < live.guest;
      const [x, y] = hostIsA ? [live.host, live.guest] : [live.guest, live.host];
      const aw = winner < 0 ? 0 : (winner === 0) === hostIsA ? 1 : 0, bw = winner < 0 ? 0 : 1 - aw;
      this.ctx.storage.sql.exec(`INSERT INTO h2h (a, b, aw, bw, d, ar, br) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(a, b) DO UPDATE SET aw = aw + excluded.aw, bw = bw + excluded.bw, d = d + excluded.d, ar = ar + excluded.ar, br = br + excluded.br`,
        x, y, aw, bw, winner < 0 ? 1 : 0, hostIsA ? hw : gw, hostIsA ? gw : hw);
      this.ctx.storage.sql.exec("DELETE FROM matches WHERE key IN (SELECT key FROM matches ORDER BY at DESC LIMIT -1 OFFSET ?)", KEEP_MATCHES);
      // time played: the crew's total, and each member's
      if (secs) {
        this.setMeta("secs", Number(this.meta("secs") || 0) + secs);
        for (const mid of [live.host, live.guest]) this.ctx.storage.sql.exec("INSERT INTO mtime (member, secs) VALUES (?, ?) ON CONFLICT(member) DO UPDATE SET secs = secs + excluded.secs", mid, secs);
      }
      // the crew's own matchup table, each pair of fighters once with a <= b (a = b is a mirror)
      if (hc && gc) {
        const hcIsA = hc <= gc, [fa, fb] = hcIsA ? [hc, gc] : [gc, hc];
        const faw = winner < 0 ? 0 : (winner === 0) === hcIsA ? 1 : 0, fbw = winner < 0 ? 0 : 1 - faw;
        this.ctx.storage.sql.exec(`INSERT INTO fpairs (a, b, n, aw, bw, d, secs) VALUES (?, ?, 1, ?, ?, ?, ?)
          ON CONFLICT(a, b) DO UPDATE SET n = n + 1, aw = aw + excluded.aw, bw = bw + excluded.bw, d = d + excluded.d, secs = secs + excluded.secs`,
          fa, fb, faw, fbw, winner < 0 ? 1 : 0, secs);
      }
      // Employee of the Month: the winner's crew wins this month (at: when they reached it, so the first there wins a tie)
      if (winner >= 0) this.ctx.storage.sql.exec(`INSERT INTO monthly (month, member, w, at) VALUES (?, ?, 1, ?)
        ON CONFLICT(month, member) DO UPDATE SET w = w + 1, at = excluded.at`, monthOf(now), winner === 0 ? live.host : live.guest, now);
      // the week's crew goal: the match counts once for the crew, and each side's part for each of them
      const r = { winner, hw, gw };
      return this.contribute(crewCounts(r), [[live.host, memberCounts(r, 0)], [live.guest, memberCounts(r, 1)]], now);
    });
    if (recorded === false) return;
    if (recorded === "met") await this.payMet();
    track(this.env, null, "crew_match", [hc, gc, winner < 0 ? "draw" : "win"]);   // analytics: fighters, no ids
    await this.touch();
    this.broadcast();
    // winner stays on: someone else is waiting, so the loser makes room
    if (winner < 0) return;
    const waiting = this.sockets().map((w) => this.att(w)).filter((b) => b.mid && b.status === "ready" && b.mid !== live.host && b.mid !== live.guest).sort((p, q) => p.readyAt - q.readyAt)[0];
    if (!waiting) return;
    const stay = winner === 0 ? live.host : live.guest;
    for (const w of this.sockets()) if (this.att(w).match === id) this.send(w, { t: "rotate", match: id, stay, next: waiting.name });
  }

  // ---- crew goals (README, Crew rooms, Crew goals) and Employee of the Month ----

  /** a member's job title, from the ladder only ('' keeps what's there: an older page sends none) */
  private setTitle(mid: string, raw: unknown) {
    const title = cleanTitle(raw);
    if (title) this.ctx.storage.sql.exec("UPDATE members SET title = ? WHERE id = ?", title, mid);
  }

  /** this week's goal, made the first time the week is asked about: its kind goes in turn, its size is set by the
   *  members active then (opened the crew in the last ACTIVE_DAYS) and stays put for the week. Old weeks past what
   *  could still be owed are dropped. */
  private goal(now = Date.now()): Goal {
    const week = weekOf(now);
    const have = this.sql<Goal>("SELECT week, kind, target, progress, met_at FROM goal WHERE week = ?", week)[0];
    if (have) return have;
    const active = this.sql<{ n: number }>("SELECT COUNT(*) AS n FROM members WHERE last_seen > ?", now - ACTIVE_DAYS * DAY_MS)[0].n;
    const g = goalFor(week, active);
    this.ctx.storage.sql.exec("INSERT INTO goal (week, kind, target) VALUES (?, ?, ?) ON CONFLICT(week) DO NOTHING", week, g.kind, g.target);
    const oldest = weekOf(now - OWED_WEEKS * 7 * DAY_MS);
    this.ctx.storage.sql.exec("DELETE FROM goal WHERE week < ?", oldest);
    this.ctx.storage.sql.exec("DELETE FROM gcontrib WHERE week < ?", oldest);
    return { week, kind: g.kind as keyof Counts, target: g.target, progress: 0, met_at: 0 };
  }

  /** add to this week's goal: `crew` to its progress, and each member's part to theirs. "met" when this is what
   *  met it (the caller pays), else "counted". Runs inside the caller's transaction. */
  private contribute(crew: Counts, parts: [string, Counts][], now: number): "met" | "counted" {
    const g = this.goal(now);
    const k = g.kind;
    this.ctx.storage.sql.exec("UPDATE goal SET progress = progress + ? WHERE week = ?", crew[k], g.week);
    for (const [mid, c] of parts) {
      this.ctx.storage.sql.exec(`INSERT INTO gcontrib (week, member, n, matches, first) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(week, member) DO UPDATE SET n = n + excluded.n, matches = matches + excluded.matches`, g.week, mid, c[k], c.matches, now);
    }
    if (!g.met_at && g.progress + crew[k] >= g.target) {
      this.ctx.storage.sql.exec("UPDATE goal SET met_at = ? WHERE week = ?", now, g.week);
      return "met";
    }
    return "counted";
  }

  /** the goal was just met: pay everyone who played this week and is in the lobby now (the rest when they come back) */
  private async payMet() {
    // one per member, a signed-in socket first (so the account is paid rather than one page)
    const who = new Map<string, Att>();
    for (const w of this.sockets()) { const a = this.att(w); if (a.mid && (!who.has(a.mid) || (a.email && !who.get(a.mid)!.email))) who.set(a.mid, a); }
    for (const a of who.values()) await this.payOwed(a);
  }

  /** pay this member every met goal they played toward and haven't been paid for, once each. A signed-in member
   *  is paid on the account; a guest's page is told and adds it to its own career. Every socket they have open
   *  hears it (one carries the award to apply; the page dedupes by crew and week). */
  private async payOwed(a: Att) {
    if (!a.mid) return;
    const owed = this.sql<{ week: string }>(`SELECT c.week AS week FROM gcontrib c JOIN goal g ON g.week = c.week
      WHERE c.member = ? AND c.paid = 0 AND c.matches > 0 AND g.met_at > 0 ORDER BY c.week`, a.mid);
    for (const { week } of owed) {
      // claim it first, so two sockets (or a hello racing a result) can't pay it twice
      const claimed = this.sql("UPDATE gcontrib SET paid = 1 WHERE week = ? AND member = ? AND paid = 0 RETURNING week", week, a.mid).length > 0;
      if (!claimed) continue;
      const award = { lines: [{ id: "crewGoal", label: GOAL_PAY.label, n: 1, xp: GOAL_PAY.xp, sticks: GOAL_PAY.sticks }], xp: GOAL_PAY.xp, sticks: GOAL_PAY.sticks };
      let career: unknown = null;
      if (a.email && a.pid) {
        const r = await awardCrewGoal(this.env, a.email, a.pid);
        if (r === null) { this.ctx.storage.sql.exec("UPDATE gcontrib SET paid = 0 WHERE week = ? AND member = ?", week, a.mid); continue; }   // D1 trouble: next time
        if (r !== "mismatch") career = r.career;   // (a session for an account that isn't this player id: paid as a guest)
      }
      const msg = JSON.stringify({ t: "goalpay", crew: this.meta("slug"), week, award, career });
      for (const w of this.sockets()) if (this.att(w).mid === a.mid) this.send(w, msg);
    }
  }

  /** A signed-in member's solo match (an arcade stage or horde run the account paid; worker/career.ts): it counts
   *  toward this week's goal, at most SOLO_PER_DAY a day. False when they aren't a member or are over the day's count. */
  async solo(pid: string, c: Counts): Promise<boolean> {
    if (!PID_RE.test(pid) || !this.exists() || !(c.matches > 0)) return false;
    const mid = (await sha256(`crew:${this.meta("slug")}:${pid}`)).slice(0, 16);
    if (!this.sql("SELECT 1 FROM members WHERE id = ?", mid).length) return false;
    const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
    const res = this.ctx.storage.transactionSync(() => {
      const g = this.goal(now);
      const row = this.sql<{ solo_day: string; solo_n: number }>("SELECT solo_day, solo_n FROM gcontrib WHERE week = ? AND member = ?", g.week, mid)[0];
      const today = row && row.solo_day === day ? row.solo_n : 0;
      if (today >= SOLO_PER_DAY) return false;
      const clean = { matches: 1, rounds: Math.max(0, Math.min(9, Math.floor(c.rounds) || 0)), wins: c.wins ? 1 : 0 };
      const out = this.contribute(clean, [[mid, clean]], now);
      this.ctx.storage.sql.exec("UPDATE gcontrib SET solo_day = ?, solo_n = ? WHERE week = ? AND member = ?", day, today + 1, g.week, mid);
      return out;
    });
    if (res === false) return false;
    if (res === "met") await this.payMet();
    this.broadcast();
    return true;
  }

  /** the goal as the lobby shows it: what, how far, when it ends, and who has played toward it (by initials and
   *  title, in the order they joined in; no counts, so nobody reads as the least) */
  private goalState() {
    const g = this.goal();
    const who = this.sql<{ id: string; name: string; title: string }>(`SELECT m.id AS id, m.name AS name, m.title AS title FROM gcontrib c JOIN members m ON m.id = c.member
      WHERE c.week = ? AND c.matches > 0 ORDER BY c.first, m.id`, g.week).map((r) => ({ id: r.id, ini: initialsOf(r.name), title: r.title }));
    return { week: g.week, kind: g.kind, target: g.target, progress: Math.min(g.progress, g.target), met: g.met_at > 0, ends: weekEnds(g.week), pay: { xp: GOAL_PAY.xp, sticks: GOAL_PAY.sticks }, who };
  }

  /** Employee of the Month: the member with the most crew wins this month (the first to get there wins a tie), by
   *  initials and title. Early in a month with no wins yet, last month's. null when neither month has a win. */
  private eotm() {
    const now = monthOf();
    for (const month of [now, prevMonth(now)]) {
      const r = this.sql<{ id: string; name: string; title: string; w: number }>(`SELECT m.id AS id, m.name AS name, m.title AS title, x.w AS w FROM monthly x JOIN members m ON m.id = x.member
        WHERE x.month = ? AND x.w > 0 ORDER BY x.w DESC, x.at ASC LIMIT 1`, month)[0];
      if (r) return { month, name: monthName(month), current: month === now, id: r.id, ini: initialsOf(r.name), title: r.title, w: r.w };
    }
    return null;
  }

  /** everything the lobby shows, the same for every member (each knows its own id from welcome) */
  private state(): string {
    const online = new Map<string, Status>();
    const rank: Record<Status, number> = { lobby: 1, ready: 2, match: 3 };
    for (const w of this.sockets()) { const a = this.att(w); if (a.mid && (rank[a.status] || 0) > (rank[online.get(a.mid) as Status] || 0)) online.set(a.mid, a.status); }
    const fav = new Map<string, string>();
    for (const r of this.sql<{ member: string; char: string }>("SELECT member, char FROM plays ORDER BY n ASC")) fav.set(r.member, r.char);   // the last written is the most played
    const time = new Map<string, number>();
    for (const r of this.sql<{ member: string; secs: number }>("SELECT member, secs FROM mtime")) time.set(r.member, r.secs);
    const members = this.sql<{ id: string; name: string; first_seen: number; last_seen: number; w: number; l: number; d: number; rw: number; rl: number; last_char: string; title: string }>(
      "SELECT id, name, first_seen, last_seen, w, l, d, rw, rl, last_char, title FROM members ORDER BY w DESC, (w - l) DESC, (w + l + d) DESC, last_seen DESC")
      .map((r) => ({ id: r.id, name: r.name, w: r.w, l: r.l, d: r.d, rw: r.rw, rl: r.rl, fav: fav.get(r.id) || "", last: r.last_char, first: r.first_seen, seen: r.last_seen, on: online.get(r.id) || "", secs: time.get(r.id) || 0, ini: initialsOf(r.name), title: r.title }));
    return JSON.stringify({
      t: "state",
      crew: { name: this.meta("name"), slug: this.meta("slug"), created: Number(this.meta("created") || 0), expires: Number(this.meta("expires") || 0) },
      members,
      h2h: this.sql("SELECT a, b, aw, bw, d, ar, br FROM h2h"),
      recent: this.sql(`SELECT at, host, guest, winner, hw, gw, hc, gc FROM matches ORDER BY at DESC LIMIT ${RECENT}`),
      stats: this.stats(members),
      scores: this.boards(true),
      goal: this.goalState(),
      eotm: this.eotm(),
    });
  }
  /** the crew's stats (README, Crew rooms, Stats): time played, matches, the most-picked fighters, its matchup table */
  private stats(members: { w: number; l: number; d: number }[]) {
    // every match adds one result to each of its two members, so the matches are half the results
    const matches = Math.round(members.reduce((n, m) => n + m.w + m.l + m.d, 0) / 2);
    return {
      secs: Number(this.meta("secs") || 0), matches,
      picks: this.sql<{ char: string; n: number }>("SELECT char, SUM(n) AS n FROM plays GROUP BY char ORDER BY n DESC, char LIMIT 5").map((r) => [r.char, r.n]),
      pairs: this.sql<{ a: string; b: string; n: number; aw: number; bw: number; d: number; secs: number }>("SELECT a, b, n, aw, bw, d, secs FROM fpairs ORDER BY n DESC, a, b LIMIT 60")
        .map((r) => [r.a, r.b, r.n, r.aw, r.bw, r.d, r.secs]),
    };
  }
  /** the two high score tables, best first (with: which member posted each row, for the lobby's YOU) */
  private boards(withMember = false): Record<ScoreKind, (ScoreRow & { member?: string })[]> {
    const read = (kind: ScoreKind) => this.sql<ScoreRow & { member: string }>(
      `SELECT initials, score, char, reach, clear, at, title, up, member FROM scores WHERE kind = ? ORDER BY score DESC, at ASC LIMIT ${BOARD}`, kind)
      .map(({ member, ...r }) => (withMember ? { ...r, member } : r));
    return { arcade: read("arcade"), horde: read("horde") };
  }

  /** GET api/crews/<slug>/scores: the crew's name and its two tables, for the attract loop and the initials
   *  screen (anyone with the link; initials only, never a member). null when there's no such crew. Reads only. */
  async scoreBoard(): Promise<{ name: string; arcade: ScoreRow[]; horde: ScoreRow[] } | null> {
    if (!this.schema && !this.sql("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").length) return null;
    this.ensure();
    if (!this.exists()) return null;
    return { name: this.meta("name") || "", ...this.boards() };
  }

  /** POST api/crews/<slug>/scores: a member's finished run. { ok, rank } (rank 0..9 on the table, -1 off it) or
   *  { error }: no-crew, not-member, bad-score (junk), too-high (over what the rules allow), slow-down (rate). */
  async submitScore(pid: string, raw: unknown): Promise<{ ok: true; rank: number } | { error: string }> {
    if (!this.schema && !this.sql("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").length) return { error: "no-crew" };
    this.ensure();
    if (!this.exists()) return { error: "no-crew" };
    if (!PID_RE.test(pid)) return { error: "not-member" };
    const mid = (await sha256(`crew:${this.meta("slug")}:${pid}`)).slice(0, 16);
    if (!this.sql("SELECT 1 FROM members WHERE id = ?", mid).length) return { error: "not-member" };
    const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const kind = SCORE_KINDS.find((k) => k === r.kind);
    const initials = typeof r.initials === "string" ? r.initials.toUpperCase() : "";
    const score = typeof r.score === "number" ? r.score : NaN, reach = typeof r.reach === "number" ? r.reach : NaN;   // numbers, never strings
    if (!kind || !INITIALS_RE.test(initials) || !isFighter(r.char) || !Number.isInteger(score) || score <= 0 || !Number.isInteger(reach)) return { error: "bad-score" };
    if (kind === "arcade" ? reach < 1 || reach > MAX_STAGE : reach < 0 || reach > MAX_FLOORS) return { error: "bad-score" };
    const clear = kind === "arcade" && r.clear === true && reach >= 6 ? 1 : 0;   // ALL CLEAR: past the boss
    const title = typeof r.title === "string" && (TITLES as string[]).includes(r.title) ? r.title : "";   // a title from the ladder, or none
    const up = r.up === true ? 1 : 0;   // set with stat upgrades: the table marks it UP
    if (score > scoreCap(kind, reach)) return { error: "too-high" };
    const now = Date.now();
    this.ctx.storage.sql.exec("DELETE FROM posts WHERE at < ?", now - DAY_MS);
    const mine = this.sql<{ at: number }>("SELECT at FROM posts WHERE member = ? ORDER BY at DESC", mid);
    if (mine.length >= POSTS_PER_DAY || (mine.length && now - mine[0].at < POST_GAP_MS)) return { error: "slow-down" };
    const rank = this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("INSERT INTO posts (member, at) VALUES (?, ?)", mid, now);
      const id = this.sql<{ id: number }>("INSERT INTO scores (kind, at, member, initials, score, char, reach, clear, title, up) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
        kind, now, mid, initials, score, r.char, reach, clear, title, up)[0].id;
      // the table keeps its top 10 (an earlier score wins a tie)
      this.ctx.storage.sql.exec(`DELETE FROM scores WHERE kind = ? AND id NOT IN (SELECT id FROM scores WHERE kind = ? ORDER BY score DESC, at ASC, id ASC LIMIT ${BOARD})`, kind, kind);
      return this.sql<{ id: number }>(`SELECT id FROM scores WHERE kind = ? ORDER BY score DESC, at ASC, id ASC LIMIT ${BOARD}`, kind).findIndex((x) => x.id === id);
    });
    await this.touch();   // a run posted is a visit: the crew lives another 90 days
    this.broadcast();     // the lobby's HIGH SCORES, for anyone in it
    return { ok: true, rank };
  }

  private broadcast() {
    const s = this.state();
    for (const w of this.sockets()) if (this.att(w).mid) this.send(w, s);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason); } catch { /* already closed */ }
    if (this.ctx.getTags(ws)[0] === "crew") { this.ensure(); if (this.exists()) this.broadcast(); }   // presence: one fewer
  }
  async webSocketError(ws: WebSocket): Promise<void> {
    try { ws.close(1011, "error"); } catch { /* already closed */ }
    if (this.ctx.getTags(ws)[0] === "crew") { this.ensure(); if (this.exists()) this.broadcast(); }
  }

  async alarm(): Promise<void> {
    this.ensure();
    const at = Number(this.meta("expires") || 0);
    if (at > Date.now()) { await this.ctx.storage.setAlarm(at); return; }
    if (this.sockets().length) { await this.touch(); return; }   // someone has it open right now
    await this.wipe();
  }
  /** gone: no storage and no alarm left behind */
  private async wipe() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.schema = false;
  }

  // ---- the admin route (worker/admin.ts): acting on a report (README, Privacy and terms, Admin) ----

  /**
   * A member the admin renamed keeps that name while their page still sends the old one (every
   * hello and rename carries the page's own name). A new name the player picks replaces it.
   */
  private heldName(mid: string, sent: string): string {
    const raw = this.meta(`held:${mid}`);
    if (raw === null) return sent;
    try {
      const h = JSON.parse(raw) as { from: string; to: string };
      if (h.from === sent) return h.to;
    } catch { /* bad row: drop it */ }
    this.ctx.storage.sql.exec("DELETE FROM meta WHERE k = ?", `held:${mid}`);
    return sent;
  }

  /** the crew as the admin sees it: its name and every member's id and name, or null when there's no such crew */
  async adminShow(): Promise<{ name: string; slug: string; created: number; expires: number; members: { id: string; name: string; seen: number }[] } | null> {
    if (!this.exists()) return null;
    return {
      name: this.meta("name") || "", slug: this.meta("slug") || "", created: Number(this.meta("created") || 0), expires: Number(this.meta("expires") || 0),
      members: this.sql<{ id: string; name: string; last_seen: number }>("SELECT id, name, last_seen FROM members ORDER BY last_seen DESC").map((r) => ({ id: r.id, name: r.name, seen: r.last_seen })),
    };
  }

  /** a new name for the crew (its link keeps the old words: close the crew when the link is the problem) */
  async adminRename(raw: string): Promise<string | null> {
    if (!this.exists()) return null;
    const name = cleanName(raw, 3, 20);
    if (!name) return null;
    this.setMeta("name", name);
    this.broadcast();
    return name;
  }

  /** a new name for one member, found by id or by the name they show; PLAYER when none is given */
  async adminRenameMember(who: string, raw: string): Promise<{ id: string; from: string; to: string } | null> {
    if (!this.exists()) return null;
    const to = cleanName(raw || "PLAYER");
    const key = String(who || "").trim();
    const row = this.sql<{ id: string; name: string }>("SELECT id, name FROM members WHERE id = ? OR name = ? ORDER BY last_seen DESC LIMIT 1", key.toLowerCase(), cleanName(key) || "")[0];
    if (!to || !row) return null;
    this.ctx.storage.sql.exec("UPDATE members SET name = ? WHERE id = ?", to, row.id);
    this.setMeta(`held:${row.id}`, JSON.stringify({ from: row.name, to }));
    for (const w of this.sockets()) { const b = this.att(w); if (b.mid === row.id) this.setAtt(w, { ...b, name: to }); }
    this.broadcast();
    return { id: row.id, from: row.name, to };
  }

  /** close the crew now: everyone in the lobby is told NO CREW AT THAT LINK, and nothing is left in storage */
  async adminClose(): Promise<boolean> {
    this.ensure();
    if (this.meta("name") === null) return false;
    for (const w of this.ctx.getWebSockets()) { this.send(w, { t: "error", reason: "no-crew" }); try { w.close(4000, "no-crew"); } catch { /* gone */ } }
    await this.wipe();
    return true;
  }

  /**
   * DELETE MY PROFILE (worker/auth.ts deleteMe): take this player out of the crew. Their member row,
   * picks, time, post times, head to head rows and the matches they played go; their high score rows
   * stay as initials with nobody behind them (`member` emptied). A lobby open as them elsewhere is
   * told `deleted` and closed, so it doesn't reconnect and come back as a new member. True when the
   * crew had them.
   */
  async forget(pid: string): Promise<boolean> {
    if (!PID_RE.test(pid) || !this.exists()) return false;
    const mid = (await sha256(`crew:${this.meta("slug")}:${pid}`)).slice(0, 16);
    if (!this.sql("SELECT 1 FROM members WHERE id = ?", mid).length) return false;
    for (const w of this.sockets()) {
      if (this.att(w).mid !== mid) continue;
      this.send(w, { t: "error", reason: "deleted" });
      try { w.close(4000, "deleted"); } catch { /* gone */ }
    }
    const x = (q: string, ...b: unknown[]) => this.ctx.storage.sql.exec(q, ...b);
    x("DELETE FROM members WHERE id = ?", mid);
    x("DELETE FROM plays WHERE member = ?", mid);
    x("DELETE FROM mtime WHERE member = ?", mid);
    x("DELETE FROM posts WHERE member = ?", mid);
    x("DELETE FROM h2h WHERE a = ? OR b = ?", mid, mid);
    x("DELETE FROM matches WHERE host = ? OR guest = ?", mid, mid);
    x("DELETE FROM live WHERE host = ? OR guest = ?", mid, mid);
    x("UPDATE scores SET member = '' WHERE member = ?", mid);
    x("DELETE FROM gcontrib WHERE member = ?", mid);   // the crew's progress keeps the count; who did it goes
    x("DELETE FROM monthly WHERE member = ?", mid);
    x("DELETE FROM meta WHERE k = ?", `held:${mid}`);
    this.broadcast();
    return true;
  }

  /** test hook (DEV_HOOKS=1 only, worker/index.ts): this week's goal with a small target (and kind), so a test can
   *  meet it in a match or two; or with fresh, made again from the members active now, as a new week's would be.
   *  { goal } as the lobby sees it, or null with no crew. */
  async devGoal(target: number, kind?: string, fresh = false): Promise<unknown> {
    if (!this.exists()) return null;
    if (fresh) { this.ctx.storage.sql.exec("DELETE FROM goal WHERE week = ?", weekOf()); this.broadcast(); return this.goalState(); }   // made again, as a new week would be
    const g = this.goal();
    const k = kind === "matches" || kind === "rounds" || kind === "wins" ? kind : g.kind;
    this.ctx.storage.sql.exec("UPDATE goal SET target = ?, kind = ? WHERE week = ?", Math.max(1, Math.floor(target) || 1), k, g.week);
    this.broadcast();
    return this.goalState();
  }

  /** test hook (DEV_HOOKS=1 only, worker/index.ts): expire the crew now and run the alarm */
  async devExpire(): Promise<boolean> {
    this.ensure();
    if (this.meta("name") === null) return false;
    this.setMeta("expires", Date.now() - 1);
    for (const w of this.sockets()) { try { w.close(4000, "expired"); } catch { /* gone */ } }
    await this.alarm();
    return !this.schema;   // the alarm wiped it
  }
}
