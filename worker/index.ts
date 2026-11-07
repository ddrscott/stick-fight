// The Worker behind https://askscottpierce.com/stick-fight/api/*: online rooms (see README,
// "Multiplayer"). Everything else under /stick-fight is the static game, served by the assets
// binding before this script runs (wrangler.jsonc: run_worker_first covers only the API). A
// request that reaches the script outside the API is a 404.
//
//   POST /stick-fight/api/rooms              -> { code }   a new room, four characters
//   GET  /stick-fight/api/rooms/<code>/ws    -> WebSocket   ?role=host|guest
//
// One Durable Object per room. It holds the two sockets and passes every message from one
// player to the other, untouched: the WebRTC offer, answer and ICE candidates while the
// players set up their peer-to-peer link, then the match's control messages, and the input
// packets themselves when the peer-to-peer link can't be made (the relay fallback). The only
// messages it writes itself are {"t":"sys",...} notices: welcome, peer joined or left, and
// errors. No accounts, no cookies, nothing stored but the room's creation time.
import { DurableObject } from "cloudflare:workers";

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
}

const API = "/stick-fight/api/";
// No 0/O or 1/I/L: the code gets read out loud and typed on a phone.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 4;
const CODE_RE = new RegExp(`^[${ALPHABET}]{${CODE_LEN}}$`);
// A room nobody is connected to is cleared this long after it was made or last used.
const ROOM_IDLE_MS = 30 * 60 * 1000;
const MAX_MESSAGE = 64 * 1024;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });

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
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }

    return notFound();
  },
} satisfies ExportedHandler<Env>;

type Role = "host" | "guest";
const other = (r: Role): Role => (r === "host" ? "guest" : "host");

export class Room extends DurableObject<Env> {
  /** Called by the Worker when it hands out this room's code. False if the room is in use. */
  async claim(): Promise<boolean> {
    const created = await this.ctx.storage.get<number>("created");
    if (created && (Date.now() - created < ROOM_IDLE_MS || this.ctx.getWebSockets().length)) return false;
    await this.ctx.storage.put("created", Date.now());
    await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_MS);
    return true;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const role: Role = url.searchParams.get("role") === "host" ? "host" : "guest";
    const created = await this.ctx.storage.get<number>("created");
    const mine = this.ctx.getWebSockets(role);
    const reason = !created ? "no-room" : role === "guest" && mine.length ? "full" : "";
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
    await this.ctx.storage.put("created", Date.now());   // in use: push the idle clock back
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const size = typeof message === "string" ? message.length : message.byteLength;
    if (size > MAX_MESSAGE) return;
    const role = this.ctx.getTags(ws)[0];
    if (role !== "host" && role !== "guest") return;
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
    await this.ctx.storage.put("created", Date.now());
  }

  async alarm(): Promise<void> {
    const created = (await this.ctx.storage.get<number>("created")) || 0;
    if (this.ctx.getWebSockets().length || Date.now() - created < ROOM_IDLE_MS) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_MS);
      return;
    }
    await this.ctx.storage.deleteAll();
  }
}
