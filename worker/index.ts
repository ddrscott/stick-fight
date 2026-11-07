// The Worker behind https://askscottpierce.com/stick-fight/api/*: online rooms (see README,
// "Multiplayer"). Everything else under /stick-fight is the static game, served by the assets
// binding before this script runs (wrangler.jsonc: run_worker_first covers only the API). A
// request that reaches the script outside the API is a 404.
//
//   POST /stick-fight/api/rooms              -> { code }   a new room, four characters
//   GET  /stick-fight/api/rooms/<code>/ws    -> WebSocket   ?role=host|guest
//   GET  /stick-fight/api/ice                -> { iceServers, ttl, turn }   for RTCPeerConnection
//
// /ice hands out Cloudflare TURN credentials (Realtime TURN, the key in the TURN_KEY_ID and
// TURN_KEY_API_TOKEN secrets) so two phones behind carrier NAT can still go peer to peer through
// a relay server instead of falling back to the room's WebSocket. Without the secrets (local dev
// with no .dev.vars) it answers with public STUN only.
//
// Abuse limits (README, "Multiplayer"): room creation and WebSocket joins are rate limited per IP
// with the Workers rate limiting bindings (wrangler.jsonc), and over the limit the answer says
// "busy" (a 429 for rooms, a {"t":"sys","ev":"error","reason":"busy"} notice for sockets). Inside
// a room each socket gets a size cap and a message-rate bucket.
//
// One Durable Object per room. It holds the two sockets and passes every message from one
// player to the other, untouched: the WebRTC offer, answer and ICE candidates while the
// players set up their peer-to-peer link, then the match's control messages, and the input
// packets themselves when the peer-to-peer link can't be made (the relay fallback). The only
// messages it writes itself are {"t":"sys",...} notices: welcome, peer joined or left, and
// errors. No accounts, no cookies, nothing stored but the time the room expires.
import { DurableObject } from "cloudflare:workers";

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ROOM_LIMIT?: RateLimit;   // room creations per IP (wrangler.jsonc ratelimits)
  JOIN_LIMIT?: RateLimit;   // WebSocket joins per IP
  TURN_KEY_ID?: string;     // secrets; absent in local dev unless .dev.vars has them
  TURN_KEY_API_TOKEN?: string;
}

const API = "/stick-fight/api/";
// No 0/O or 1/I/L: the code gets read out loud and typed on a phone.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 4;
const CODE_RE = new RegExp(`^[${ALPHABET}]{${CODE_LEN}}$`);
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

const BUSY = "Too many tries from your network. Try again shortly.";
const STUN = ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"];
const ICE_TTL_S = 3600;               // TURN credentials last an hour
const ICE_CACHE_MS = 10 * 60 * 1000;  // one set per isolate for 10 minutes, so each lasts 50+ more

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });

/** Who to rate limit: the client IP, with IPv6 cut to its /64 (one household or phone). */
function clientKey(req: Request): string {
  const ip = req.headers.get("CF-Connecting-IP") || "local";
  return ip.includes(":") ? ip.split(":").slice(0, 4).join(":") + "::/64" : ip;
}
async function allowed(limit: RateLimit | undefined, req: Request): Promise<boolean> {
  if (!limit) return true;
  try { return (await limit.limit({ key: clientKey(req) })).success; } catch { return true; }   // fail open
}

/** A socket that only says why it was refused, so the page can show it (a failed handshake can't). */
function refusedSocket(reason: string): Response {
  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];
  server.accept();
  server.send(JSON.stringify({ t: "sys", ev: "error", reason }));
  server.close(4029, reason);
  return new Response(null, { status: 101, webSocket: client });
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

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(API)) return notFound();
    const parts = url.pathname.slice(API.length).split("/").filter(Boolean);

    if (parts.length === 1 && parts[0] === "rooms") {
      if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (!(await allowed(env.ROOM_LIMIT, req))) return json({ error: "busy", message: BUSY }, 429, { "retry-after": "60" });
      // a fresh code; on the rare collision with a live room, draw again
      for (let i = 0; i < 8; i++) {
        const code = newCode();
        if (await env.ROOMS.get(env.ROOMS.idFromName(code)).claim()) return json({ code });
      }
      return json({ error: "no free room code, try again" }, 503);
    }

    if (parts.length === 3 && parts[0] === "rooms" && parts[2] === "ws") {
      const code = parts[1].toUpperCase();
      if (!CODE_RE.test(code)) return json({ error: "bad room code" }, 400);
      if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({ error: "expected a WebSocket" }, 426);
      if (!(await allowed(env.JOIN_LIMIT, req))) return refusedSocket("busy");
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }

    if (parts.length === 1 && parts[0] === "ice") {
      if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
      return iceServers(env);
    }

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
