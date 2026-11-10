// The Worker behind https://askscottpierce.com/stick-fight/api/*: online rooms, crew rooms and
// profiles (see README, "Multiplayer"). Everything else under /stick-fight is the static game,
// served by the assets binding before this script runs (wrangler.jsonc: run_worker_first covers
// only the API). A request that reaches the script outside the API is a 404.
//
//   POST /stick-fight/api/rooms              -> { code }   a new quick room, four characters
//   GET  /stick-fight/api/rooms/<code>/ws    -> WebSocket   ?role=host|guest
//   GET  /stick-fight/api/ice                -> { iceServers, ttl, turn }   for RTCPeerConnection
//   POST /stick-fight/api/crews              -> { slug }   a new crew room ({ name }), worker/crew.ts
//   GET  /stick-fight/api/crews/<slug>/ws    -> WebSocket   the crew lobby
//   POST /stick-fight/api/e                  -> 204         analytics events from the page (README, Analytics)
//   GET  /stick-fight/api/stats              -> the all-time pick and matchup rollups, worker/stats.ts
//   POST /stick-fight/api/auth/start, auth/verify, auth/logout; GET and PUT /stick-fight/api/me
//                                            profiles and email sign-in, worker/auth.ts
//
// /ice hands out Cloudflare TURN credentials (Realtime TURN, the key in the TURN_KEY_ID and
// TURN_KEY_API_TOKEN secrets) so two phones behind carrier NAT can still go peer to peer through
// a relay server instead of falling back to the room's WebSocket. Without the secrets (local dev
// with no .dev.vars) it answers with public STUN only.
//
// Abuse limits (README, "Multiplayer"): room and crew creation, WebSocket joins and profile calls
// are rate limited per IP with the Workers rate limiting bindings (wrangler.jsonc), and over the
// limit the answer says "busy" (a 429, or a {"t":"sys","ev":"error","reason":"busy"} notice for
// sockets). Inside a room each socket gets a size cap and a message-rate bucket.
//
// One Durable Object per quick room. It holds the two sockets and passes every message from one
// player to the other, untouched: the WebRTC offer, answer and ICE candidates while the
// players set up their peer-to-peer link, then the match's control messages, and the input
// packets themselves when the peer-to-peer link can't be made (the relay fallback). The only
// messages it writes itself are {"t":"sys",...} notices: welcome, peer joined or left, and
// errors. The one message it keeps for itself is a page's {"t":"sys","ev":"result"} when a match ends:
// the result goes on the books only when both players' pages report the same one (worker/stats.ts).
// Nothing stored but the time the room expires and a result waiting for the other side's. A crew room opens one of these for each
// match it starts.
import { DurableObject } from "cloudflare:workers";
import { type Env, API, BUSY, json, notFound, allowed, refusedSocket, claimRoom, CODE_RE, cleanName, track } from "./env";

import { Crew, SLUG_RE } from "./crew";
import { handleAuth } from "./auth";
import { offlineMatch, recordMatch, recordPick, roomResult, statsResponse } from "./stats";

// the events the page may send (src/analytics.js); anything else is dropped. `match` and `pick` also
// update the D1 rollups, so they're checked field by field (worker/stats.ts) instead of passed through
const EVENT_NAMES = new Set(["visit", "mode", "stage", "arcade_end", "horde_end", "online_match", "online_drop", "install", "technique", "move", "perf"]);
const MAX_BATCH = 12;   // events in one POST (a match's end sends its result and its move counts together)
type PageEvent = { e?: unknown; l?: unknown; v?: unknown; d?: unknown; m?: unknown };

export { Crew };
export type { Env };

// A room nobody has joined yet (the host is still sharing the code) lives this long; once players
// have been in it and everyone has left, it's cleared after ROOM_EMPTY_MS (long enough to reload).
const ROOM_IDLE_MS = 30 * 60 * 1000;
const ROOM_EMPTY_MS = 5 * 60 * 1000;
// Per socket: the biggest message passed on (an SDP offer is a few KB), and a token bucket for
// the message rate. A match sends about 60 packets a second each way plus control messages, so
// the bucket allows 4x that with room for a burst of ICE candidates. Over it, messages are
// dropped; a socket that keeps flooding is closed.
const MAX_MESSAGE = 16 * 1024;
const MSG_RATE = 240;        // messages per second, sustained
const MSG_BURST = 480;       // bucket size
const MSG_STRIKES = 1000;    // dropped messages before the socket is closed

const STUN = ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"];
const ICE_TTL_S = 3600;               // TURN credentials last an hour
const ICE_CACHE_MS = 10 * 60 * 1000;  // one set per isolate for 10 minutes, so each lasts 50+ more

// Crew slugs: the crew's name in lower case with dashes, then five random characters (no 0/o,
// 1/i/l), e.g. tuesday-crew-7k2qm. The name makes the link readable; the suffix makes it unguessable
// enough for a friends' room (28 million per name, behind the join limit).
const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function newSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/, "") || "crew";
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `${base}-${[...bytes].map((b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join("")}`;
}

type IceServer = { urls: string | string[]; username?: string; credential?: string };
let iceCache: { servers: IceServer[]; until: number } | null = null;
let iceInFlight: Promise<IceServer[] | null> | null = null;

/** Fresh TURN credentials from Cloudflare Realtime, or null when there's no key or it fails. */
async function generateIce(env: Env): Promise<IceServer[] | null> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return null;
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ ttl: ICE_TTL_S }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) { console.error("turn credentials failed", res.status); return null; }
    const body = await res.json<{ iceServers?: IceServer[] }>();
    if (!Array.isArray(body.iceServers) || !body.iceServers.length) return null;
    // browsers block port 53, and a URL that can only time out slows ICE down
    return body.iceServers.map((s) => ({ ...s, urls: ([] as string[]).concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }));
  } catch (e) {
    console.error("turn credentials failed", e);
    return null;
  }
}

async function iceServers(env: Env): Promise<Response> {
  if (!iceCache || iceCache.until < Date.now()) {
    iceInFlight ??= generateIce(env).finally(() => { iceInFlight = null; });
    const servers = await iceInFlight;
    if (servers) iceCache = { servers, until: Date.now() + ICE_CACHE_MS };
  }
  if (iceCache && iceCache.until >= Date.now()) return json({ iceServers: iceCache.servers, ttl: ICE_TTL_S, turn: true });
  return json({ iceServers: [{ urls: STUN }], ttl: 0, turn: false });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(API)) return notFound();
    const parts = url.pathname.slice(API.length).split("/").filter(Boolean);

    if (parts.length === 1 && parts[0] === "rooms") {
      if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (!(await allowed(env.ROOM_LIMIT, req))) return json({ error: "busy", message: BUSY }, 429, { "retry-after": "60" });
      const code = await claimRoom(env);
      if (code) track(env, req, "room_create");
      return code ? json({ code }) : json({ error: "no free room code, try again" }, 503);
    }

    if (parts.length === 3 && parts[0] === "rooms" && parts[2] === "ws") {
      const code = parts[1].toUpperCase();
      if (!CODE_RE.test(code)) return json({ error: "bad room code" }, 400);
      if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({ error: "expected a WebSocket" }, 426);
      if (!(await allowed(env.JOIN_LIMIT, req))) return refusedSocket("busy");
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }

    // analytics events from the page (src/analytics.js); a fixed list, short labels, no ids
    if (parts.length === 1 && parts[0] === "e") {
      if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (!(await allowed(env.EVENT_LIMIT, req))) return new Response(null, { status: 204 });
      // one event, or a short list of them (one rate-limit count either way)
      const body = await req.json<PageEvent | PageEvent[]>().catch(() => ({} as PageEvent));
      for (const ev of (Array.isArray(body) ? body : [body]).slice(0, MAX_BATCH)) {
        if (!ev || typeof ev !== "object") continue;
        const e = typeof ev.e === "string" ? ev.e : "";
        const labels = Array.isArray(ev.l) ? ev.l.filter((x) => typeof x === "string" || typeof x === "number").map((x) => String(x).replace(/[^\w .:+-]/g, "").slice(0, 40)) : [];
        if (e === "match") {
          // a vs-CPU match or a horde run, as the page tells it (online results come through the room)
          const m = offlineMatch(ev.m);
          if (m) ctx.waitUntil(recordMatch(env, req, m));
        } else if (e === "pick") recordPick(env, req, ctx, labels);
        else if (EVENT_NAMES.has(e)) {
          const more = Array.isArray(ev.d) ? ev.d.filter((x) => typeof x === "number").slice(0, 8) : [];
          track(env, req, e, labels, typeof ev.v === "number" ? ev.v : 0, more);
        }
      }
      return new Response(null, { status: 204 });
    }

    if (parts.length === 1 && parts[0] === "stats") return statsResponse(req, env, ctx);

    if (parts.length === 1 && parts[0] === "ice") {
      if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
      return iceServers(env);
    }

    if (parts.length === 1 && parts[0] === "crews") {
      if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (!(req.headers.get("content-type") || "").includes("application/json")) return json({ error: "expected JSON" }, 415);
      if (!(await allowed(env.CREW_LIMIT, req))) return json({ error: "busy", message: BUSY }, 429, { "retry-after": "60" });
      const body = await req.json<{ name?: unknown }>().catch(() => ({} as { name?: unknown }));
      const name = cleanName(body.name, 3, 20);
      if (!name) return json({ error: "bad-name" }, 400);
      for (let i = 0; i < 6; i++) {
        const slug = newSlug(name);
        if (await env.CREWS.get(env.CREWS.idFromName(slug)).create(slug, name)) { track(env, req, "crew_create"); return json({ slug, name }); }
      }
      return json({ error: "try again" }, 503);
    }

    if (parts.length === 3 && parts[0] === "crews" && parts[2] === "ws") {
      const slug = parts[1].toLowerCase();
      if (!SLUG_RE.test(slug) || slug.length > 40) return json({ error: "bad crew" }, 400);
      if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({ error: "expected a WebSocket" }, 426);
      if (!(await allowed(env.JOIN_LIMIT, req))) return refusedSocket("busy");
      return env.CREWS.get(env.CREWS.idFromName(slug)).fetch(req);
    }

    // test hook, only with DEV_HOOKS=1 (.dev.vars): expire a crew room now, as 90 idle days would
    if (env.DEV_HOOKS === "1" && parts.length === 3 && parts[0] === "crews" && parts[2] === "dev-expire" && req.method === "POST") {
      return json({ wiped: await env.CREWS.get(env.CREWS.idFromName(parts[1].toLowerCase())).devExpire() });
    }

    const auth = await handleAuth(req, env, parts);
    if (auth) return auth;

    return notFound();
  },
} satisfies ExportedHandler<Env>;

type Role = "host" | "guest";
const other = (r: Role): Role => (r === "host" ? "guest" : "host");

export class Room extends DurableObject<Env> {
  // message-rate buckets, per socket; in memory only, so they reset if the room hibernates
  private buckets = new WeakMap<WebSocket, { tokens: number; at: number; strikes: number }>();

  /** The players' sockets (refused ones carry their own tag), leaving out one that's closing. */
  private players(except?: WebSocket): WebSocket[] {
    return [...this.ctx.getWebSockets("host"), ...this.ctx.getWebSockets("guest")].filter((w) => w !== except);
  }

  /** When the room ends if nobody is in it, or 0 for no room. */
  private async expires(): Promise<number> {
    const at = await this.ctx.storage.get<number>("expires");
    if (at) return at;
    const created = await this.ctx.storage.get<number>("created");   // rooms made before "expires"
    return created ? created + ROOM_IDLE_MS : 0;
  }

  private async setExpiry(ms: number) {
    const at = Date.now() + ms;
    await this.ctx.storage.put("expires", at);
    await this.ctx.storage.setAlarm(at);
  }

  /** Called by the Worker when it hands out this room's code. False if the room is in use. */
  async claim(): Promise<boolean> {
    if ((await this.expires()) > Date.now() || this.players().length) return false;
    await this.ctx.storage.deleteAll();   // anything left from an expired room
    await this.setExpiry(ROOM_IDLE_MS);
    return true;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const role: Role = url.searchParams.get("role") === "host" ? "host" : "guest";
    const live = (await this.expires()) > Date.now() || this.players().length > 0;
    const mine = this.ctx.getWebSockets(role);
    const reason = !live ? "no-room" : role === "guest" && mine.length ? "full" : "";
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // refused sockets are accepted too, so the page can read why (a failed handshake has no
    // reason), but under their own tag: their close must not tell the room's players anything
    this.ctx.acceptWebSocket(server, [reason ? "refused" : role]);
    if (reason) {
      server.send(JSON.stringify({ t: "sys", ev: "error", reason }));
      server.close(4000, reason);
      return new Response(null, { status: 101, webSocket: client });
    }
    for (const w of mine) w.close(4001, "replaced");   // the host reconnecting from a new tab
    const peer = this.ctx.getWebSockets(other(role));
    server.send(JSON.stringify({ t: "sys", ev: "welcome", role, peer: peer.length > 0 }));
    for (const w of peer) w.send(JSON.stringify({ t: "sys", ev: "peer", present: true }));
    await this.setExpiry(ROOM_IDLE_MS);   // in use: the alarm re-arms while anyone is connected
    return new Response(null, { status: 101, webSocket: client });
  }

  /** False when this socket is over its message rate; closes it if it keeps going. */
  private take(ws: WebSocket): boolean {
    const now = Date.now();
    let b = this.buckets.get(ws);
    if (!b) this.buckets.set(ws, (b = { tokens: MSG_BURST, at: now, strikes: 0 }));
    b.tokens = Math.min(MSG_BURST, b.tokens + ((now - b.at) / 1000) * MSG_RATE);
    b.at = now;
    if (b.tokens >= 1) { b.tokens -= 1; return true; }
    if (++b.strikes >= MSG_STRIKES) {
      try { ws.send(JSON.stringify({ t: "sys", ev: "error", reason: "flood" })); ws.close(4008, "flood"); } catch { /* gone */ }
    }
    return false;
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const size = typeof message === "string" ? message.length : message.byteLength;
    if (size > MAX_MESSAGE) return;
    const role = this.ctx.getTags(ws)[0];
    if (role !== "host" && role !== "guest") return;
    if (!this.take(ws)) return;
    // a page's own word to the room (a match's result, worker/stats.ts); everything else goes to the other player
    if (typeof message === "string" && message.startsWith('{"t":"sys"')) { await roomResult(this.ctx.storage, this.env, role, message); return; }
    for (const w of this.ctx.getWebSockets(other(role))) {
      try { w.send(message); } catch { /* closing */ }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    await this.left(ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason); } catch { /* already closed */ }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.left(ws);
  }

  private async left(ws: WebSocket) {
    const role = this.ctx.getTags(ws)[0];
    if (role !== "host" && role !== "guest") return;
    for (const w of this.ctx.getWebSockets(other(role))) {
      try { w.send(JSON.stringify({ t: "sys", ev: "peer", present: false })); } catch { /* closing */ }
    }
    // the last one out starts the short clock: an empty room's code stops working in minutes
    await this.setExpiry(this.players(ws).length ? ROOM_IDLE_MS : ROOM_EMPTY_MS);
  }

  async alarm(): Promise<void> {
    if (this.players().length) { await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_MS); return; }
    const at = await this.expires();
    if (at > Date.now()) { await this.ctx.storage.setAlarm(at); return; }
    // gone: no storage and no alarm left behind, so the object costs nothing until a code reuses it
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}
