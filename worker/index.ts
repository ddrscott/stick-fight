// The Worker behind https://neonstickfight.com: online rooms, crew rooms and profiles under /api/*
// (see README, "Multiplayer"). Everything else is the static game, served by the assets binding
// (wrangler.jsonc: run_worker_first covers the API and the pages; crew/<slug> and room/<CODE> get the
// game page with the room's share tags, play/ and the homepage a 301 to that link when the query has an
// old ?crew= or ?room=, every other page goes straight back to the
// assets). www.neonstickfight.com is a 301 to the bare domain, and askscottpierce.com/stick-fight,
// the old address, is served or redirected by oldPath (README, Hosting).
//
//   POST /api/rooms              -> { code }   a new quick room, four characters
//   GET  /api/rooms/<code>/ws    -> WebSocket   ?role=host|guest
//   GET  /api/rooms/<code>/watch -> WebSocket   a spectator (quick rooms only; see Spectators below)
//   GET  /api/live               -> { live: [...] }   the quick matches on right now, cached 5 s
//   GET  /api/now                -> { matches, quick, crew, pairs }   every match on right now, no names, cached 5 s
//   GET  /api/ice                -> { iceServers, ttl, turn }   for RTCPeerConnection
//   POST /api/crews              -> { slug }   a new crew room ({ name }), worker/crew.ts
//   GET  /api/crews/<slug>/ws    -> WebSocket   the crew lobby
//   GET  /api/crews/<slug>/scores -> { name, arcade, horde }   the crew's high score tables
//   POST /api/crews/<slug>/scores -> { ok, rank } | { error }   a member's run ({ pid, run })
//   POST /api/e                  -> 204         analytics events from the page (README, Analytics)
//   GET  /api/stats              -> the all-time pick and matchup rollups, worker/stats.ts
//   GET  /api/og/crew/<slug>.jpg, og/room/<CODE>.jpg   share images, worker/og.ts
//   GET  /crew/<slug>, /room/<CODE>   the game page with the room's share tags, worker/og.ts
//   GET  /play/?crew=|?room=, /?crew=|?room=   301 to that clean link, rest of the query kept
//   POST /api/auth/start, auth/verify, auth/logout; GET and PUT /api/me
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
//
// Spectators (README, "Multiplayer", Spectators). The one thing the room reads: messages the host
// addresses to it, {"t":"watch",...} and the binary input batches of src/net/watchlog.js. They tell
// it a match started (the setup a spectator needs), the score, and, while anyone is watching, the
// inputs both machines have confirmed. The room keeps the match's log in memory only, hands spectator
// sockets only the frames stamped HOLD_MS before the newest (src/net/watchroom.js, shared with the
// Node proof), and lists the match in the Lobby object (api/live).
// A spectator's socket is tagged "spectator": nothing it sends is passed on or read (a "ping" is
// answered without waking the object). A room a crew claimed is private: no spectators, never listed.
import { DurableObject } from "cloudflare:workers";
import { type Env, type LiveEntry, API, OLD_PREFIX, SITE_HOST, siteOrigin, BUSY, json, notFound, allowed, refusedSocket, claimRoom, CODE_RE, cleanName, track } from "./env";
import { isBatch } from "../src/net/watchlog.js";
import { createWatchRoom } from "../src/net/watchroom.js";

import { Crew, SLUG_RE } from "./crew";
import { handleAuth } from "./auth";
import { cleanLink, linkPage, ogImage, oldLink, playPage } from "./og";
import { offlineMatch, recordMatch, recordPick, recordPlay, roomResult, statsResponse } from "./stats";
import { isFighter } from "./roster";

// the events the page may send (src/analytics.js); anything else is dropped. `match` and `pick` also
// update the D1 rollups, so they're checked field by field (worker/stats.ts) instead of passed through
const EVENT_NAMES = new Set(["visit", "mode", "stage", "arcade_end", "horde_end", "online_match", "online_drop", "install", "technique", "move", "perf"]);
const MAX_BATCH = 12;   // events in one POST (a match's end sends its result and its move counts together)
type PageEvent = { e?: unknown; l?: unknown; v?: unknown; d?: unknown; m?: unknown };

export { Crew };
export type { Env };

// the LIVE list: one answer per isolate for 3 seconds, and the same answer from the edge cache for 5
const LIVE_MEMO_MS = 3000, LIVE_MAX_AGE_S = 5;
let liveMemo: { body: string; until: number } | null = null;
async function liveList(env: Env): Promise<Response> {
  if (!liveMemo || liveMemo.until < Date.now()) {
    let live: LiveEntry[] = [];
    try { live = await env.LOBBY.get(env.LOBBY.idFromName("live")).list(); } catch (e) { console.error("live list failed", e); }
    liveMemo = { body: JSON.stringify({ live }), until: Date.now() + LIVE_MEMO_MS };
  }
  return new Response(liveMemo.body, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${LIVE_MAX_AGE_S}` } });
}

// the live count: one answer per isolate for 3 seconds, and the same from the edge cache for 5 (like the LIVE list)
let nowMemo: { body: string; until: number } | null = null;
async function nowCount(env: Env): Promise<Response> {
  if (!nowMemo || nowMemo.until < Date.now()) {
    let body: unknown;
    try { body = await env.LOBBY.get(env.LOBBY.idFromName("live")).count(); } catch (e) { console.error("live count failed", e); body = { error: "unavailable" }; }
    nowMemo = { body: JSON.stringify(body), until: Date.now() + LIVE_MEMO_MS };
  }
  return new Response(nowMemo.body, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${LIVE_MAX_AGE_S}` } });
}

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
const SPECTATOR_STRIKES = 20; // messages a spectator may send (none are read) before its socket is closed

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

// ---- the front door: which host and path asked -----------------------------------------------------

const moved = (location: string, cache = "public, max-age=3600") => new Response(null, { status: 301, headers: { location, "cache-control": cache } });

// What an old service worker at askscottpierce.com/stick-fight/sw.js is replaced with once the old path
// redirects: it clears this app's caches and unregisters itself, so an old install stops answering
// pages from its cache and its next visit follows the redirect. A redirect can't stand in for a
// service worker script (the browser refuses it and keeps the old one).
const RETIRED_SW = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(caches.keys()
  .then((keys) => Promise.all(keys.filter((k) => k.startsWith('stick-fight-')).map((k) => caches.delete(k))))
  .then(() => self.registration.unregister())));
`;

/** askscottpierce.com/stick-fight and everything under it, where the game lived until 2026-11-11.
 *  OLD_PATH "redirect": a 301 to the same page on neonstickfight.com, query and all (a fragment such as
 *  #signin=... rides along: the browser keeps it across a redirect). The API is still answered here,
 *  so a tab opened before the move finishes its match. "serve" (until the new domain is checked): the
 *  game itself, the request handed to the app with the prefix taken off and the answer's paths put
 *  back. */
async function oldPath(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const rest = url.pathname.slice(OLD_PREFIX.length) || "/";
  const api = rest.startsWith(API);
  if (env.OLD_PATH === "redirect" && !api) {
    if (rest === "/sw.js") return new Response(RETIRED_SW, { headers: { "content-type": "text/javascript", "cache-control": "no-cache" } });
    // an old ?crew= or ?room= link on the homepage or play/ goes straight to its clean link (crew/<slug>,
    // room/<CODE>) rather than through a second 301 there; crew/ and room/ links just change host
    const clean = ["/", "/index.html", "/play/", "/play/index.html"].includes(rest) ? cleanLink(url) : null;
    return moved(`${siteOrigin(url)}${clean || rest + url.search}`);
  }
  if (url.pathname === OLD_PREFIX) return moved(`${OLD_PREFIX}/${url.search}`, "no-store");   // the page's relative paths need the slash
  const inner = new URL(url);
  inner.pathname = rest;
  const res = await app(new Request(inner.toString(), req), env, ctx);
  if (res.webSocket) return res;
  const location = res.headers.get("location"), cookie = res.headers.get("set-cookie");
  if (!(location?.startsWith("/") && !location.startsWith("//")) && !cookie) return res;
  const out = new Response(res.body, res);
  if (location?.startsWith("/") && !location.startsWith("//")) out.headers.set("location", OLD_PREFIX + location);
  if (cookie) out.headers.set("set-cookie", cookie.replace(/; Path=\/(?=;|$)/, `; Path=${OLD_PREFIX}`));   // the origin there is shared with other apps
  return out;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.hostname === `www.${SITE_HOST}`) return moved(`https://${SITE_HOST}${url.pathname}${url.search}`, "public, max-age=86400");
    if (url.pathname === OLD_PREFIX || url.pathname.startsWith(OLD_PREFIX + "/")) {
      // on the new domain a stray /stick-fight/... path just loses its prefix
      if (url.hostname === SITE_HOST) return moved((url.pathname.slice(OLD_PREFIX.length) || "/") + url.search);
      return oldPath(req, env, ctx);
    }
    return app(req, env, ctx);
  },
} satisfies ExportedHandler<Env>;

/** The game at the root of its own host: the API, the two pages with share tags, and the assets. */
async function app(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  {
    const url = new URL(req.url);
    if (url.pathname === "/play/" || url.pathname === "/play/index.html") return playPage(req, env);
    const link = /^\/(crew|room)\/([^/]*)(\/?)$/.exec(url.pathname);
    if (link) {
      // crew/ alone has nothing to open, and crew/<slug>/ is the same link: one address each
      if (!link[2]) return moved("/play/");
      if (link[3]) return moved(`/${link[1]}/${link[2]}${url.search}`);
      return linkPage(req, env, ctx, link[1] as "crew" | "room", link[2]);
    }
    if (url.pathname === "/" || url.pathname === "/index.html") return oldLink(req, env);
    // run_worker_first also sends every page here (for the www redirect above): the rest is the assets'
    if (!url.pathname.startsWith(API)) return env.ASSETS.fetch(req);
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

    // a spectator's socket: quick rooms only (a crew's match room refuses it, and crews have no such route)
    if (parts.length === 3 && parts[0] === "rooms" && parts[2] === "watch") {
      const code = parts[1].toUpperCase();
      if (!CODE_RE.test(code)) return json({ error: "bad room code" }, 400);
      if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({ error: "expected a WebSocket" }, 426);
      if (!(await allowed(env.JOIN_LIMIT, req))) return refusedSocket("busy");
      track(env, req, "watch_join");
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }

    // the LIVE list: quick matches on right now that anyone may watch
    if (parts.length === 1 && parts[0] === "live") {
      if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
      const cache = (caches as unknown as { default: Cache }).default, key = new Request(new URL(API + "live", req.url).toString());
      try { const hit = await cache.match(key); if (hit) return hit; } catch { /* no cache here */ }
      const res = await liveList(env);
      try { ctx.waitUntil(cache.put(key, res.clone())); } catch { /* no cache here */ }
      return res;
    }

    // the live count: how many matches are on right now, quick and crew, and their fighter pairs; no names
    if (parts.length === 1 && parts[0] === "now") {
      if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
      const cache = (caches as unknown as { default: Cache }).default, key = new Request(new URL(API + "now", req.url).toString());
      try { const hit = await cache.match(key); if (hit) return hit; } catch { /* no cache here */ }
      const res = await nowCount(env);
      try { ctx.waitUntil(cache.put(key, res.clone())); } catch { /* no cache here */ }
      return res;
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
        } else if (e === "play") {
          // training's play time, a heartbeat a minute (worker/stats.ts recordPlay)
          const p = recordPlay(env, ev.m);
          if (p) ctx.waitUntil(p);
        } else if (e === "pick") recordPick(env, req, ctx, labels);
        else if (EVENT_NAMES.has(e)) {
          const more = Array.isArray(ev.d) ? ev.d.filter((x) => typeof x === "number").slice(0, 8) : [];
          track(env, req, e, labels, typeof ev.v === "number" ? ev.v : 0, more);
        }
      }
      return new Response(null, { status: 204 });
    }

    if (parts.length === 3 && parts[0] === "og") return ogImage(req, env, ctx, parts);

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

    // a crew's high score tables: read them (the attract loop, the initials screen), or post a member's run
    if (parts.length === 3 && parts[0] === "crews" && parts[2] === "scores") {
      const slug = parts[1].toLowerCase();
      if (!SLUG_RE.test(slug) || slug.length > 40) return json({ error: "bad crew" }, 400);
      const crew = env.CREWS.get(env.CREWS.idFromName(slug));
      if (req.method === "GET") {
        if (!(await allowed(env.STATS_LIMIT, req))) return json({ error: "busy", message: BUSY }, 429, { "retry-after": "60" });
        const board = await crew.scoreBoard();
        return board ? json(board) : json({ error: "no-crew" }, 404);
      }
      if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (!(req.headers.get("content-type") || "").includes("application/json")) return json({ error: "expected JSON" }, 415);
      if (!(await allowed(env.EVENT_LIMIT, req))) return json({ error: "busy", message: BUSY }, 429, { "retry-after": "60" });
      const body = await req.json<{ pid?: unknown; run?: unknown }>().catch(() => ({} as { pid?: unknown; run?: unknown }));
      // expected refusals answer 200 with { error }, like the profile calls, so the page's console stays clean
      return json(await crew.submitScore(typeof body.pid === "string" ? body.pid : "", body.run));
    }

    // test hook, only with DEV_HOOKS=1 (.dev.vars): expire a crew room now, as 90 idle days would
    if (env.DEV_HOOKS === "1" && parts.length === 3 && parts[0] === "crews" && parts[2] === "dev-expire" && req.method === "POST") {
      return json({ wiped: await env.CREWS.get(env.CREWS.idFromName(parts[1].toLowerCase())).devExpire() });
    }

    const auth = await handleAuth(req, env, parts);
    if (auth) return auth;

    return notFound();
  }
}

type Role = "host" | "guest";
const other = (r: Role): Role => (r === "host" ? "guest" : "host");

/** The matches anyone may watch right now (api/live). One object, named "live". Rooms put their match in
 *  when it starts, on every round, when the number watching changes and once a minute, and take it out when
 *  it ends.
 *
 *  An idle object is dropped from memory after 10 seconds, so the list is kept in storage, but cheaply. An
 *  entry is written when its match starts, again when a room's word finds the stored copy older than
 *  LIVE_REWRITE_MS (so every other minute of a long match), and deleted when it ends: three writes for a
 *  three-minute match. A change of round, score or number watching lands in memory only, and an alarm
 *  LIVE_FLUSH_MS later writes what changed if the object has gone quiet by then (it's about to be dropped);
 *  while requests keep coming, memory is safe and the alarm only sets itself again. So a busy list writes
 *  two or three rows a match, and a quiet one never serves a stale count after a nap.
 *  An entry nobody has refreshed in LIVE_TTL_MS is dropped, so a room that died quietly falls off the list;
 *  after a restart an entry's age is its stored copy's, which a room still playing keeps under the TTL. */
const LIVE_TTL_MS = 150 * 1000, LIVE_SHOWN = 40, LIVE_REWRITE_MS = 75 * 1000, LIVE_FLUSH_MS = 7000, LIVE_QUIET_MS = 6000;
type Listed = LiveEntry & { seen: number; stored: number };
const sameShown = (a: LiveEntry, b: LiveEntry) => a.round === b.round && a.watching === b.watching && a.wins[0] === b.wins[0] && a.wins[1] === b.wins[1];
/** The live count (api/now): every match being played right now, quick and crew alike, watchable or not. A
 *  room's host page says when a match starts ({t:'sys', ev:'live', chars}); the room puts it here and takes it
 *  out when the match's result comes in or a player leaves. One storage write at the start and one delete at
 *  the end, and nothing about the players: the room's code (the key, never shown), the two fighters, quick or
 *  crew, and when it started. An entry left behind by a room that died quietly falls off after BUSY_TTL_MS. */
const BUSY_TTL_MS = 20 * 60 * 1000, BUSY_PAIRS = 40;
type Busy = { chars: [string, string]; crew: boolean; at: number };
export type NowCount = { at: number; matches: number; quick: number; crew: number; pairs: string[][] };

export class Lobby extends DurableObject<Env> {
  private busy: Map<string, Busy> | null = null;
  private async loadBusy(): Promise<Map<string, Busy>> {
    if (this.busy) return this.busy;
    const rows = await this.ctx.storage.list<Busy>({ prefix: "b:" });
    const m = new Map<string, Busy>();
    for (const [k, v] of rows) if (v && Array.isArray(v.chars)) m.set(k.slice(2), v);
    return (this.busy ??= m);
  }
  /** a match started in room `code` (its previous match, if any, is over) */
  async begin(code: string, chars: [string, string], crew: boolean): Promise<void> {
    const busy = await this.loadBusy(), e: Busy = { chars, crew, at: Date.now() };
    busy.set(code, e);
    await this.ctx.storage.put(`b:${code}`, e);
  }
  /** room `code` has no match on (a result, a player gone, the room closed) */
  async end(code: string): Promise<void> {
    const busy = await this.loadBusy();
    if (busy.delete(code)) await this.ctx.storage.delete(`b:${code}`);
  }
  /** how many matches are on right now, quick and crew, and the fighter pairs (the newest first). No names. */
  async count(): Promise<NowCount> {
    const busy = await this.loadBusy(), old = Date.now() - BUSY_TTL_MS, gone: string[] = [];
    for (const [k, v] of busy) if (v.at < old) { busy.delete(k); gone.push(`b:${k}`); }
    if (gone.length) await this.ctx.storage.delete(gone.slice(0, 128));
    const list = [...busy.values()].sort((a, b) => b.at - a.at);
    const crew = list.filter((e) => e.crew).length;
    return { at: Date.now(), matches: list.length, quick: list.length - crew, crew, pairs: list.slice(0, BUSY_PAIRS).map((e) => e.chars) };
  }

  private live: Map<string, Listed> | null = null;
  private dirty = new Set<string>();   // entries whose stored copy is behind what's in memory
  private asked = 0;                   // the last request
  private armed = false;
  private async load(): Promise<Map<string, Listed>> {
    this.asked = Date.now();
    if (this.live) return this.live;
    const rows = await this.ctx.storage.list<LiveEntry & { stored?: number }>({ prefix: "m:" });
    const live = new Map<string, Listed>();
    for (const e of rows.values()) if (e && typeof e.code === "string") live.set(e.code, { ...e, seen: e.stored || 0, stored: e.stored || 0 });
    return (this.live ??= live);
  }
  private async prune(live: Map<string, Listed>) {
    const old = Date.now() - LIVE_TTL_MS, gone: string[] = [];
    for (const [k, v] of live) if (v.seen < old) { live.delete(k); this.dirty.delete(k); gone.push(`m:${k}`); }
    if (gone.length) await this.ctx.storage.delete(gone.slice(0, 128));
  }
  private async arm() {
    if (this.armed) return;
    this.armed = true;
    await this.ctx.storage.setAlarm(Date.now() + LIVE_FLUSH_MS);
  }
  async put(e: LiveEntry): Promise<void> {
    const live = await this.load(), now = Date.now(), was = live.get(e.code);
    const fresh = !was || was.n !== e.n || now - was.stored > LIVE_REWRITE_MS;
    live.set(e.code, { ...e, seen: now, stored: fresh ? now : was.stored });
    if (fresh) { this.dirty.delete(e.code); await this.ctx.storage.put(`m:${e.code}`, { ...e, stored: now }); }
    else if (!sameShown(was, e)) { this.dirty.add(e.code); await this.arm(); }
    if (live.size > 2000) await this.prune(live);
  }
  async drop(code: string): Promise<void> {
    const live = await this.load();
    this.dirty.delete(code);
    if (live.delete(code)) await this.ctx.storage.delete(`m:${code}`);
  }
  /** the most watched first, then the newest */
  async list(): Promise<LiveEntry[]> {
    const live = await this.load();
    await this.prune(live);
    return [...live.values()].sort((a, b) => b.watching - a.watching || b.at - a.at).slice(0, LIVE_SHOWN).map(({ seen: _seen, stored: _stored, ...e }) => e);
  }
  /** what changed in memory goes to storage once the object has gone quiet (before it's dropped) */
  async alarm(): Promise<void> {
    this.armed = false;
    const live = this.live;
    if (!live || !this.dirty.size) return;
    const now = Date.now();
    if (now - this.asked < LIVE_QUIET_MS) { await this.arm(); return; }   // still busy: memory is safe, look again later
    const rows: Record<string, LiveEntry & { stored: number }> = {};
    for (const code of [...this.dirty].slice(0, 128)) {
      this.dirty.delete(code);
      const v = live.get(code);
      if (!v) continue;
      v.stored = now;
      const { seen: _seen, ...e } = v;
      rows[`m:${code}`] = e;
    }
    if (Object.keys(rows).length) await this.ctx.storage.put(rows);
    if (this.dirty.size) await this.arm();
  }
}

type Flags = { priv: boolean; off: boolean; code: string };

export class Room extends DurableObject<Env> {
  // message-rate buckets, per socket; in memory only, so they reset if the room hibernates
  private buckets = new WeakMap<WebSocket, { tokens: number; at: number; strikes: number }>();
  // spectators (src/net/watchroom.js; memory only: the host sends the match again if the room forgets it)
  private desk = createWatchRoom({
    players: (text) => { for (const w of this.players()) { try { w.send(text); } catch { /* closing */ } } },
    spectators: (except) => this.spectators(except as WebSocket | undefined),
    kick: (reason) => { for (const w of this.ctx.getWebSockets("spectator")) { try { w.close(4002, reason); } catch { /* gone */ } } },
    list: (e) => { const code = this.flags && this.flags.code; if (code) this.ctx.waitUntil(this.lobby().put({ ...e, code }).catch(() => {})); },
    unlist: () => { const code = this.flags && this.flags.code; if (code) this.ctx.waitUntil(this.lobby().drop(code).catch(() => {})); },
  });
  private flags: Flags | null = null;
  private noise = new WeakMap<WebSocket, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // a spectator's heartbeat is answered here, without waking the room
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** The players' sockets (refused ones carry their own tag), leaving out one that's closing. */
  private players(except?: WebSocket): WebSocket[] {
    return [...this.ctx.getWebSockets("host"), ...this.ctx.getWebSockets("guest")].filter((w) => w !== except);
  }
  private spectators(except?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets("spectator").filter((w) => w !== except && w.readyState === 1);
  }
  /** what the room was claimed as: its code, private (a crew's match), and the host's off switch */
  private async getFlags(): Promise<Flags> {
    if (!this.flags) {
      const s = await this.ctx.storage.get<string | boolean>(["code", "priv", "watchOff"]);
      this.flags = { code: String(s.get("code") || ""), priv: s.get("priv") === true, off: s.get("watchOff") === true };
      this.desk.priv = this.flags.priv; this.desk.off = this.flags.off;
    }
    return this.flags;
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

  /** Called by the Worker when it hands out this room's code. False if the room is in use.
   *  priv: a crew's match room, which nobody may watch and the LIVE list never shows. */
  async claim(code = "", priv = false): Promise<boolean> {
    if ((await this.expires()) > Date.now() || this.players().length) return false;
    await this.ctx.storage.deleteAll();   // anything left from an expired room
    this.desk.stop("left", true);
    await this.ctx.storage.put(priv ? { code, priv: true } : { code });
    this.flags = { code, priv, off: false };
    this.desk.priv = priv; this.desk.off = false;
    await this.setExpiry(ROOM_IDLE_MS);
    return true;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/watch")) return this.watch(url);
    const role: Role = url.searchParams.get("role") === "host" ? "host" : "guest";
    const live = (await this.expires()) > Date.now() || this.players().length > 0;
    const mine = this.ctx.getWebSockets(role);
    const peer = this.ctx.getWebSockets(other(role));
    // a second host is the same player in a new tab, and takes the seat, but only while the room is
    // waiting: once both seats are taken the code may be public (the LIVE list), and nobody takes one
    const reason = !live ? "no-room" : mine.length && (role === "guest" || peer.length) ? "full" : "";
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
    server.send(JSON.stringify({ t: "sys", ev: "welcome", role, peer: peer.length > 0 }));
    for (const w of peer) w.send(JSON.stringify({ t: "sys", ev: "peer", present: true }));
    const fl = await this.getFlags();
    if (!fl.code) { const c = url.pathname.split("/").at(-2) || ""; if (CODE_RE.test(c)) { fl.code = c; await this.ctx.storage.put("code", c); } }   // a room claimed by an older build
    const n = this.spectators().length;
    if (n) server.send(this.desk.note(n));
    await this.setExpiry(ROOM_IDLE_MS);   // in use: the alarm re-arms while anyone is connected
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- spectators ------------------------------------------------------------------------------
  /** A spectator's socket. Refused: no such room (a crew's match room answers the same, so its code
   *  says nothing), the host turned spectating off, or the room has MAX_SPECTATORS already. */
  private async watch(_url: URL): Promise<Response> {
    await this.getFlags();
    const live = (await this.expires()) > Date.now() || this.players().length > 0;
    const reason = !live ? "no-room" : this.desk.refusal(this.spectators().length);
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [reason ? "refused" : "spectator"]);
    if (reason) {
      server.send(JSON.stringify({ t: "sys", ev: "error", reason }));
      server.close(4000, reason);
    } else this.desk.join(server);   // the welcome, the match so far, and the new count to everyone
    return new Response(null, { status: 101, webSocket: client });
  }
  private lobby() { return this.env.LOBBY.get(this.env.LOBBY.idFromName("live")); }

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
    const role = this.ctx.getTags(ws)[0];
    if (role === "spectator") {
      // a spectator only watches: nothing it sends goes anywhere, and one that keeps sending is closed
      const k = (this.noise.get(ws) || 0) + 1;
      this.noise.set(ws, k);
      if (k > SPECTATOR_STRIKES) { try { ws.close(4008, "flood"); } catch { /* gone */ } }
      return;
    }
    if (size > MAX_MESSAGE) return;
    if (role !== "host" && role !== "guest") return;
    if (!this.take(ws)) return;
    // a page's own word to the room (a match's result, worker/stats.ts); everything else goes to the other player
    if (typeof message === "string" && message.startsWith('{"t":"sys"')) { await this.sys(role, message); return; }
    // the host's messages to the room itself (spectators); everything else passes through untouched
    if (typeof message !== "string") {
      if (isBatch(message)) { if (role === "host") this.desk.onBatch(message); return; }
    } else if (message.startsWith('{"t":"watch"')) {
      if (role === "host") {
        await this.getFlags();
        const change = this.desk.onWatch(message);
        // the host's off switch is the one thing kept: it has to outlive a restart of the room
        if (change && this.flags) { this.flags.off = change.off; if (change.off) await this.ctx.storage.put("watchOff", true); else await this.ctx.storage.delete("watchOff"); }
      }
      return;
    } else if (this.desk.match && role === "host" && message.startsWith('{"t":"sync"')) this.desk.onSync(message);
    for (const w of this.ctx.getWebSockets(other(role))) {
      try { w.send(message); } catch { /* closing */ }
    }
  }

  /** A page's word to the room: the match started (the live count) or ended (the books, worker/stats.ts). */
  private async sys(role: Role, message: string) {
    let ev = "";
    try { ev = String((JSON.parse(message) as { ev?: unknown }).ev || ""); } catch { return; }
    if (ev === "result") {
      await this.notBusy();   // either side's word that it's over takes it off the count
      await roomResult(this.ctx.storage, this.env, role, message);
    } else if (ev === "live" && role === "host") {
      // the host's word that a match started: its two fighters, for the live count (api/now)
      let chars: unknown;
      try { chars = (JSON.parse(message) as { chars?: unknown }).chars; } catch { return; }
      if (!Array.isArray(chars) || !isFighter(chars[0]) || !isFighter(chars[1])) return;
      const fl = await this.getFlags();
      if (!fl.code) return;
      await this.lobby().begin(fl.code, [chars[0], chars[1]], fl.priv).catch(() => {});
    }
  }
  private async notBusy() {
    const fl = await this.getFlags();
    if (!fl.code) return;
    await this.lobby().end(fl.code).catch(() => {});
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
    if (role === "spectator") { await this.getFlags(); this.desk.count(ws); return; }
    if (role !== "host" && role !== "guest") return;
    for (const w of this.ctx.getWebSockets(other(role))) {
      try { w.send(JSON.stringify({ t: "sys", ev: "peer", present: false })); } catch { /* closing */ }
    }
    // a player gone ends the match for anyone watching, as it does for the other player; an empty room
    // sends its spectators away
    await this.getFlags();
    await this.notBusy();   // and for the live count
    const rest = this.players(ws).length;
    this.desk.stop("left", rest === 0, true);   // (off the LIVE list even if the room had forgotten its match)
    // the last one out starts the short clock: an empty room's code stops working in minutes
    await this.setExpiry(rest ? ROOM_IDLE_MS : ROOM_EMPTY_MS);
  }

  async alarm(): Promise<void> {
    if (this.players().length) { await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_MS); return; }
    const at = await this.expires();
    if (at > Date.now()) { await this.ctx.storage.setAlarm(at); return; }
    // gone: no storage and no alarm left behind, so the object costs nothing until a code reuses it
    await this.getFlags();
    this.desk.stop("left", true);
    this.flags = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}
