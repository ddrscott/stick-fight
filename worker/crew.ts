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
//
// The lobby is the room's WebSocket (hibernating): presence (who's here and whether they're idle,
// ready or playing), PLAY, and the standings. When two members are ready the room opens a quick room
// (worker/index.ts Room) for them and tells each its role; the match itself runs there as any
// online match does (WebRTC or the relay). The host's page reports each match's result here, once.
// If someone else is waiting when a match ends, the winner stays on: the room tells both players, the
// loser goes back to the lobby and the winner plays the one waiting.
//
// Messages (JSON). From the page: hello {pid, name}, name {name}, play {on, stay?}, lobby, result
// {match, n, winner (0 host, 1 guest, -1 draw), wins, chars}. From the room: welcome {you}, state
// {...}, match {id, code, role, rival}, rotate {match, stay, next}, error {reason}.
//
// A crew with no activity (nobody opening it, no result) for 90 days is deleted by the alarm.
import { DurableObject } from "cloudflare:workers";
import { type Env, claimRoom, sha256, PID_RE, cleanName, track } from "./env";
import { isFighter } from "./roster";
import { scoreCap, MAX_STAGE, MAX_FLOORS } from "../src/flow/scorecap.js";

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
export type ScoreRow = { initials: string; score: number; char: string; reach: number; clear: number; at: number };

type Status = "lobby" | "ready" | "match";
type Att = { mid: string; name: string; status: Status; readyAt: number; match: string };
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
    `);
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
    } else server.serializeAttachment({ mid: "", name: "", status: "lobby", readyAt: 0, match: "" } satisfies Att);
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
      const name = cleanName(m.name);
      if (!name) return;
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
      this.broadcast();
    } else if (m.t === "result") {
      await this.result(ws, a, m);
    }
  }

  private async hello(ws: WebSocket, a: Att, m: Record<string, unknown>) {
    const pid = typeof m.pid === "string" ? m.pid : "";
    const name = cleanName(m.name);
    if (!PID_RE.test(pid) || !name) { this.send(ws, { t: "error", reason: "bad-hello" }); try { ws.close(4000, "bad-hello"); } catch { /* gone */ } return; }
    // the member id: a hash of the player id, salted with the slug (the id itself is the player's key)
    const mid = (await sha256(`crew:${this.meta("slug")}:${pid}`)).slice(0, 16);
    const now = Date.now();
    const known = this.sql("SELECT 1 FROM members WHERE id = ?", mid).length > 0;
    if (!known && this.sql<{ n: number }>("SELECT COUNT(*) AS n FROM members")[0].n >= MAX_MEMBERS) {
      this.send(ws, { t: "error", reason: "crew-full" }); try { ws.close(4000, "crew-full"); } catch { /* gone */ } return;
    }
    if (known) this.ctx.storage.sql.exec("UPDATE members SET name = ?, last_seen = ? WHERE id = ?", name, now, mid);
    else this.ctx.storage.sql.exec("INSERT INTO members (id, name, first_seen, last_seen) VALUES (?, ?, ?, ?)", mid, name, now, now);
    this.setAtt(ws, { mid, name, status: "lobby", readyAt: 0, match: "" });
    await this.touch();
    this.send(ws, { t: "welcome", you: mid });
    this.broadcast();
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
      return true;
    });
    if (!recorded) return;
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

  /** everything the lobby shows, the same for every member (each knows its own id from welcome) */
  private state(): string {
    const online = new Map<string, Status>();
    const rank: Record<Status, number> = { lobby: 1, ready: 2, match: 3 };
    for (const w of this.sockets()) { const a = this.att(w); if (a.mid && (rank[a.status] || 0) > (rank[online.get(a.mid) as Status] || 0)) online.set(a.mid, a.status); }
    const fav = new Map<string, string>();
    for (const r of this.sql<{ member: string; char: string }>("SELECT member, char FROM plays ORDER BY n ASC")) fav.set(r.member, r.char);   // the last written is the most played
    const time = new Map<string, number>();
    for (const r of this.sql<{ member: string; secs: number }>("SELECT member, secs FROM mtime")) time.set(r.member, r.secs);
    const members = this.sql<{ id: string; name: string; first_seen: number; last_seen: number; w: number; l: number; d: number; rw: number; rl: number; last_char: string }>(
      "SELECT id, name, first_seen, last_seen, w, l, d, rw, rl, last_char FROM members ORDER BY w DESC, (w - l) DESC, (w + l + d) DESC, last_seen DESC")
      .map((r) => ({ id: r.id, name: r.name, w: r.w, l: r.l, d: r.d, rw: r.rw, rl: r.rl, fav: fav.get(r.id) || "", last: r.last_char, first: r.first_seen, seen: r.last_seen, on: online.get(r.id) || "", secs: time.get(r.id) || 0 }));
    return JSON.stringify({
      t: "state",
      crew: { name: this.meta("name"), slug: this.meta("slug"), created: Number(this.meta("created") || 0), expires: Number(this.meta("expires") || 0) },
      members,
      h2h: this.sql("SELECT a, b, aw, bw, d, ar, br FROM h2h"),
      recent: this.sql(`SELECT at, host, guest, winner, hw, gw, hc, gc FROM matches ORDER BY at DESC LIMIT ${RECENT}`),
      stats: this.stats(members),
      scores: this.boards(true),
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
      `SELECT initials, score, char, reach, clear, at, member FROM scores WHERE kind = ? ORDER BY score DESC, at ASC LIMIT ${BOARD}`, kind)
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
    if (score > scoreCap(kind, reach)) return { error: "too-high" };
    const now = Date.now();
    this.ctx.storage.sql.exec("DELETE FROM posts WHERE at < ?", now - DAY_MS);
    const mine = this.sql<{ at: number }>("SELECT at FROM posts WHERE member = ? ORDER BY at DESC", mid);
    if (mine.length >= POSTS_PER_DAY || (mine.length && now - mine[0].at < POST_GAP_MS)) return { error: "slow-down" };
    const rank = this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("INSERT INTO posts (member, at) VALUES (?, ?)", mid, now);
      const id = this.sql<{ id: number }>("INSERT INTO scores (kind, at, member, initials, score, char, reach, clear) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
        kind, now, mid, initials, score, r.char, reach, clear)[0].id;
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
