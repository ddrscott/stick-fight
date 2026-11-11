// What the Worker's modules share: the bindings, JSON answers, the per-IP rate limit helper, and
// the four-letter quick room codes (crew rooms open one for each match they start).
import type { Room, Lobby } from "./index";
import type { Crew } from "./crew";

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  CREWS: DurableObjectNamespace<Crew>;
  LOBBY: DurableObjectNamespace<Lobby>;   // the LIVE list of watchable quick matches (worker/index.ts Lobby)
  ASSETS: Fetcher;           // the static files (dist/): play/ for the share previews, and og/ for their images (worker/og.ts)
  DB: D1Database;            // profiles and sign-in (worker/auth.ts, migrations/)
  EMAIL: SendEmail;          // sign-in codes, from EMAIL_FROM
  EMAIL_FROM: string;
  ROOM_LIMIT?: RateLimit;    // quick room creations per IP (wrangler.jsonc ratelimits)
  JOIN_LIMIT?: RateLimit;    // WebSocket joins per IP: quick rooms, crew rooms and spectators
  CREW_LIMIT?: RateLimit;    // crew room creations per IP
  AUTH_LIMIT?: RateLimit;    // profile and sign-in calls per IP
  EVENT_LIMIT?: RateLimit;   // analytics events per IP
  STATS_LIMIT?: RateLimit;   // GET /api/stats per IP (worker/stats.ts)
  OG_LIMIT?: RateLimit;      // share images drawn per IP (worker/og.ts; a cached one doesn't count)
  EVENTS?: AnalyticsEngineDataset;   // game analytics (worker/index.ts track, README Analytics)
  TURN_KEY_ID?: string;      // secrets; absent in local dev unless .dev.vars has them
  TURN_KEY_API_TOKEN?: string;
  DEV_LOGIN_CODES?: string;  // "1" only in .dev.vars: no email is sent, the code comes back in the answer
  DEV_HOOKS?: string;        // "1" only in .dev.vars: test routes (expire a crew room now)
}

/** One match in the LIVE list (GET api/live): a quick room with a match on that anyone may watch. */
export type LiveEntry = {
  code: string; n: number; chars: string[]; names: string[]; round: number; wins: number[];
  tally: { host: number; guest: number; draw: number }; watching: number; at: number;
};

export const API = "/stick-fight/api/";
export const BUSY = "Too many tries from your network. Try again shortly.";

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
export const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });

/** Who to rate limit: the client IP, with IPv6 cut to its /64 (one household or phone). */
export function clientKey(req: Request): string {
  const ip = req.headers.get("CF-Connecting-IP") || "local";
  return ip.includes(":") ? ip.split(":").slice(0, 4).join(":") + "::/64" : ip;
}
export async function allowed(limit: RateLimit | undefined, req: Request): Promise<boolean> {
  if (!limit) return true;
  try { return (await limit.limit({ key: clientKey(req) })).success; } catch { return true; }   // fail open
}

/** A socket that only says why it was refused, so the page can show it (a failed handshake can't). */
export function refusedSocket(reason: string): Response {
  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];
  server.accept();
  server.send(JSON.stringify({ t: "sys", ev: "error", reason }));
  server.close(4029, reason);
  return new Response(null, { status: 101, webSocket: client });
}

const enc = new TextEncoder();
export async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Quick room codes. No 0/O or 1/I/L: the code gets read out loud and typed on a phone.
export const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LEN = 4;
export const CODE_RE = new RegExp(`^[${ALPHABET}]{${CODE_LEN}}$`);
export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}
/** A fresh quick room, claimed; on the rare collision with a live room, draw again. "" if none.
 *  priv: a crew's match room, closed to spectators and kept off the LIVE list. */
export async function claimRoom(env: Env, priv = false): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = newCode();
    if (await env.ROOMS.get(env.ROOMS.idFromName(code)).claim(code, priv)) return code;
  }
  return "";
}

// A player's id: 128 random bits as 32 hex characters, made by the page and kept in its
// localStorage. It's the player's key, so it never goes to another player; crew rooms keep a
// hash of it.
export const PID_RE = /^[0-9a-f]{32}$/;

/** A display name: 3 to 12 letters, digits and single spaces, upper case. null if it isn't one. */
export function cleanName(raw: unknown, min = 3, max = 12): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  return s.length >= min && s.length <= max ? s : null;
}

/** Game analytics: one Analytics Engine data point. blob1 is the event, then up to 8 short labels and
 *  the visitor's country last; double1 a number (a stage, a score), then any more the event carries
 *  (README, Analytics, has each event's layout). Never a player id, name or email. */
export function track(env: Env, req: Request | null, event: string, labels: string[] = [], value = 0, more: number[] = []) {
  // local dev has no Analytics Engine to query, so with DEV_HOOKS=1 (.dev.vars) each data point is logged instead
  if (env.DEV_HOOKS === "1") console.log("[event]", event, JSON.stringify(labels), value, JSON.stringify(more));
  if (!env.EVENTS) return;
  const cf = (req && (req as unknown as { cf?: { country?: string } }).cf) || {};
  try {
    env.EVENTS.writeDataPoint({ indexes: [event.slice(0, 32)], blobs: [event.slice(0, 32), ...labels.slice(0, 8).map((l) => String(l).slice(0, 40)), String(cf.country || '')],
      doubles: [Number(value) || 0, ...more.slice(0, 15).map((n) => Number(n) || 0)] });
  } catch { /* analytics never breaks the game */ }
}
