// Share previews for crew and room links (README, Site, Share image; Multiplayer, Crew rooms).
//
// A link pasted into iMessage, Slack, Discord, WhatsApp and the rest is fetched by a bot that reads the
// page's Open Graph tags and runs no script. play/index.html carries the plain set (the game's title,
// og.jpg). A crew's link is /crew/<slug> and a quick room's /room/<CODE>: the
// Worker runs first there (wrangler.jsonc, run_worker_first), answers with play/index.html from the
// assets (no redirect, the address stays clean), and swaps the tags for the room's own: "Join CREW NAME
// on Neon Stick Fight", a line saying what tapping does, and a picture of the room's name. Everyone gets
// the same tags, bot or not. The page's paths are relative to play/, so it also gets
// <base href="../play/"> as the first thing in its head. An unknown or expired crew gets the
// plain tags and still loads the game, which says there's no such crew.
//
// The old forms, play/?crew=, play/?room=, /?crew= and /?room=, are a 301 to the clean link with the
// rest of the query kept (?pick=, say), so a bot following an old link unfurls it as the room too.
//
//   GET /api/og/crew/<slug>.jpg?v=<v>   the crew's image, 1200x630
//   GET /api/og/room/<CODE>.jpg         a quick room's image
//
// The image is an SVG drawn here (public/og/bg.jpg behind it, Bungee and Teko from public/og/*.ttf) and
// rasterized by resvg, then encoded as a JPEG by mozjpeg (both WebAssembly; a PNG of the photo-like
// background is about 540 KB, past what WhatsApp will show, and the JPEG about 90 KB). A crew image depends only on the crew's name and member count, so
// its URL carries a hash of the two (v) and is cached at the edge for a week as immutable: a new member
// makes a new URL. A room image depends only on its four letters, so it caches the same way.
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import encodeJpeg, { init as initJpeg } from "@jsquash/jpeg/encode";
import jpegWasm from "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm";
import { type Env, API, CODE_RE, allowed, sha256, siteOrigin } from "./env";
import { SLUG_RE } from "./crew";
import { NAME_W, fitName, textWidth } from "./og-layout";

const ROOT = "/";
// crew/<slug> and room/<CODE> sit one level below the root, so ../play/ is the game's folder both here and
// at askscottpierce.com/stick-fight/ while the old address serves the game (worker/index.ts oldPath)
const BASE = "../play/";
const W = 1200, H = 630;
/** bump when the image's layout changes, so every cached crew image is drawn again */
const LOOK = 2;
const CARD_TTL_S = 300;          // a crew's name and member count, cached at the edge
const IMAGE_TTL_S = 7 * 86400;   // an image URL never changes what it shows
const SITE = "Neon Stick Fight";
const PITCH = "Tap to join: no sign-up, pick a fighter and fight.";

type Card = { name: string; members: number };
type Preview = { title: string; description: string; url: string; image: string; alt: string };

/** the origin a share tag points at: neonstickfight.com, even when the old address asked (env.ts siteOrigin) */
const publicOrigin = siteOrigin;
const cache = () => (caches as unknown as { default: Cache }).default;

// ---- the crew's name, from its Durable Object (cached) --------------------------------------------

/** The crew's name and member count, or null when there's no such crew or it expired. Cached at the
 *  edge for 5 minutes, so a crew link opened by a crowd asks the Durable Object once. */
export async function crewCard(env: Env, ctx: ExecutionContext, origin: string, slug: string): Promise<Card | null> {
  if (!SLUG_RE.test(slug) || slug.length > 40) return null;
  const key = new Request(`${origin}${API}og/card/${slug}`);
  try {
    const hit = await cache().match(key);
    if (hit) return (await hit.json<{ card: Card | null }>()).card;
  } catch { /* no cache here */ }
  let card: Card | null = null;
  try { card = await env.CREWS.get(env.CREWS.idFromName(slug)).card(); } catch { return null; }
  const res = new Response(JSON.stringify({ card }), { headers: { "content-type": "application/json", "cache-control": `max-age=${card ? CARD_TTL_S : 60}` } });
  try { ctx.waitUntil(cache().put(key, res)); } catch { /* no cache here */ }
  return card;
}

/** the part of a crew image's URL that changes when its picture would */
async function crewVersion(card: Card): Promise<string> {
  return (await sha256(`${LOOK}|${card.name}|${card.members}`)).slice(0, 10);
}

// ---- the page: play/ with its tags swapped -----------------------------------------------------------

/** What a crew or room link should unfurl as, or null for the plain tags. */
async function preview(req: Request, env: Env, ctx: ExecutionContext, link: Link): Promise<Preview | null> {
  const url = new URL(req.url), origin = publicOrigin(url);
  if (link.kind === "crew") {
    const slug = link.id;
    const card = await crewCard(env, ctx, url.origin, slug);
    if (!card) return null;
    const many = card.members === 1 ? "1 fighter in the crew" : card.members > 1 ? `${card.members} fighters in the crew` : "";
    return {
      title: `Join ${card.name} on ${SITE}`,
      description: `Your crew's room on ${SITE}${many ? `, ${many}` : ""}. ${PITCH}`,
      url: `${origin}${ROOT}crew/${slug}`,
      image: `${origin}${API}og/crew/${slug}.jpg?v=${await crewVersion(card)}`,
      alt: `${card.name}: crew room on ${SITE}. Tap to join.`,
    };
  }
  const code = link.id;
  if (CODE_RE.test(code)) {
    return {
      title: `Join room ${code} on ${SITE}`,
      description: `A quick match is waiting in room ${code}. ${PITCH}`,
      url: `${origin}${ROOT}room/${code}`,
      image: `${origin}${API}og/room/${code}.jpg`,
      alt: `Room ${code}: quick match on ${SITE}. Tap to join.`,
    };
  }
  return null;
}

type Link = { kind: "crew" | "room"; id: string };

/** The clean link an old ?crew= or ?room= query stands for, with the rest of the query, or null. A crew
 *  wins over a room (the game reads them in that order). A value that can't be a slug or a whole code
 *  isn't moved: play/ shows the game's own answer to it, as before. */
export function cleanLink(url: URL): string | null {
  const q = new URLSearchParams(url.search);
  const slug = (q.get("crew") || "").toLowerCase(), code = (q.get("room") || "").toUpperCase();
  let path: string;
  if (q.has("crew") && SLUG_RE.test(slug) && slug.length <= 40) { path = `crew/${slug}`; q.delete("crew"); }
  else if (!q.has("crew") && q.has("room") && CODE_RE.test(code)) { path = `room/${code}`; q.delete("room"); }
  else return null;
  const rest = q.toString();
  return `${ROOT}${path}${rest ? `?${rest}` : ""}`;
}

const moved = (location: string) => new Response(null, { status: 301, headers: { location } });

/** GET /play/ (and play/index.html): the asset, untouched, unless the query is an old crew
 *  or room link, which is a 301 to its clean address. */
export async function playPage(req: Request, env: Env): Promise<Response> {
  const to = req.method === "GET" || req.method === "HEAD" ? cleanLink(new URL(req.url)) : null;
  return to ? moved(to) : env.ASSETS.fetch(req);
}

/** GET /crew/<slug> and /room/<CODE>: the game page under the room's own address,
 *  with the room's share tags and a <base> so its play/-relative paths still resolve. */
export async function linkPage(req: Request, env: Env, ctx: ExecutionContext, kind: "crew" | "room", raw: string): Promise<Response> {
  const url = new URL(req.url);
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  let id = raw;
  try { id = decodeURIComponent(raw); } catch { /* left as it came */ }
  const norm = kind === "crew" ? id.toLowerCase() : id.toUpperCase();
  // one address per room: a slug in capitals or a code in lower case is sent to the real one
  if (norm !== raw && (kind === "crew" ? SLUG_RE.test(norm) : CODE_RE.test(norm))) return moved(`${ROOT}${kind}/${norm}${url.search}`);
  // the tags differ from the asset's, so no 304 against its ETag: ask for the whole file
  const plain = new Request(new URL(`${ROOT}play/`, url), { method: "GET", headers: [...req.headers].filter(([k]) => !/^if-/i.test(k)) });
  const [res, p] = await Promise.all([env.ASSETS.fetch(plain), preview(req, env, ctx, { kind, id: norm }).catch(() => null)]);
  if (res.status !== 200 || !(res.headers.get("content-type") || "").includes("text/html")) return res;
  let rw = new HTMLRewriter().on("head", { element(el: Element) { el.prepend(`<base href="${BASE}">`, { html: true }); } });
  if (p) {
    const set = (v: string) => ({ element(el: Element) { el.setAttribute("content", v); } });
    rw = rw
      .on('meta[property="og:title"]', set(p.title))
      .on('meta[property="og:description"]', set(p.description))
      .on('meta[property="og:url"]', set(p.url))
      .on('meta[property="og:image"]', set(p.image))
      .on('meta[property="og:image:alt"]', set(p.alt))
      .on('meta[name="twitter:title"]', set(p.title))
      .on('meta[name="twitter:description"]', set(p.description))
      .on('meta[name="twitter:image"]', set(p.image))
      .on('meta[name="twitter:image:alt"]', set(p.alt));
  }
  const out = rw.transform(res);
  const headers = new Headers(out.headers);
  headers.delete("etag");
  headers.delete("content-length");
  headers.set("cache-control", "public, max-age=0, must-revalidate");
  return new Response(req.method === "HEAD" ? null : out.body, { status: 200, headers });
}

/** The homepage with ?crew= or ?room=: a link from before the game moved to play/. The page's script
 *  forwards people, but unfurl bots run no script, so the Worker answers with a real redirect. */
export function oldLink(req: Request, env: Env): Promise<Response> | Response {
  const url = new URL(req.url);
  if (!url.searchParams.has("crew") && !url.searchParams.has("room")) return env.ASSETS.fetch(req);
  return moved(cleanLink(url) || `${ROOT}play/${url.search}`);
}

// ---- the image -----------------------------------------------------------------------------------

/** GET api/og/crew/<slug>.jpg and api/og/room/<CODE>.jpg (parts: after api/). */
export async function ogImage(req: Request, env: Env, ctx: ExecutionContext, parts: string[]): Promise<Response> {
  const url = new URL(req.url);
  const fallback = (s = 300) => new Response(null, { status: 302, headers: { location: `${ROOT}og.jpg`, "cache-control": `public, max-age=${s}` } });
  const m = /^(.+)\.jpg$/.exec(parts[2] || "");
  if (req.method !== "GET" || !m) return new Response("Not found", { status: 404 });
  const key = new Request(url.toString());
  try { const hit = await cache().match(key); if (hit) return hit; } catch { /* no cache here */ }

  let svg: string;
  if (parts[1] === "crew") {
    const slug = m[1].toLowerCase();
    const card = await crewCard(env, ctx, url.origin, slug);
    if (!card) return fallback();
    const v = await crewVersion(card);
    // only the current picture is drawn: any other v is sent to it (so a made-up v can't force a render)
    if (url.searchParams.get("v") !== v || url.search !== `?v=${v}`) return new Response(null, { status: 302, headers: { location: `${API}og/crew/${slug}.jpg?v=${v}`, "cache-control": "public, max-age=60" } });
    const many = card.members === 1 ? "1 FIGHTER IN THE CREW" : card.members > 1 ? `${card.members} FIGHTERS IN THE CREW` : "";
    svg = await artwork(env, url.origin, "CREW ROOM", card.name, many);
  } else if (parts[1] === "room") {
    const code = m[1].toUpperCase();
    if (!CODE_RE.test(code) || m[1] !== code || url.search) return fallback();
    svg = await artwork(env, url.origin, "QUICK MATCH", `ROOM ${code}`, "");
  } else return new Response("Not found", { status: 404 });

  // a render is the one costly thing here: per IP, over the limit gets the plain picture
  if (!(await allowed(env.OG_LIMIT, req))) return fallback(60);
  let jpg: ArrayBuffer;
  try { jpg = await render(env, url.origin, svg); } catch (e) { console.error("og render failed", e); return fallback(60); }
  const res = new Response(jpg, { headers: { "content-type": "image/jpeg", "cache-control": `public, max-age=${IMAGE_TTL_S}, immutable` } });
  try { ctx.waitUntil(cache().put(key, res.clone())); } catch { /* no cache here */ }
  return res;
}

// ---- drawing -------------------------------------------------------------------------------------

const C = { bg: "#07020f", ink: "#fff4fd", dim: "#cdbdf0", amber: "#ffb02e", cyan: "#2ef2ff", pink: "#ff2bd6", deep: "#0a0414" };
const X = 64;           // left margin
const xml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The picture as SVG: the game's title, what kind of room, its name big, and TAP TO JOIN. Square
 *  corners, solid letters (readable text never glows, README "The look"). */
async function artwork(env: Env, origin: string, kind: string, name: string, sub: string): Promise<string> {
  const bg = await asset(env, origin, "og/bg.jpg");
  const { size, lines } = fitName(name);
  // the name's block sits between the label (bottom at y 150) and the line under it
  const lh = Math.round(size * 1.02), cap = size * 0.74;
  const top = 178, bottom = sub ? 412 : 456;
  const blockH = cap + lh * (lines.length - 1);
  const y0 = Math.round(top + (bottom - top - blockH) / 2 + cap);
  const nameSvg = lines.map((l, i) => `<text x="${X - Math.round(size * 0.03)}" y="${y0 + i * lh}" font-family="Bungee" font-size="${size}" fill="${C.ink}">${xml(l)}</text>`).join("");
  const btn = "TAP TO JOIN", btnSize = 52, btnSp = 2, btnPad = 28;
  const btnW = Math.round(textWidth(btn, "teko", btnSize, btnSp) - btnSp + btnPad * 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${C.bg}"/>
<image width="${W}" height="${H}" xlink:href="data:image/jpeg;base64,${b64(bg)}"/>
<text x="${X}" y="86" font-family="Bungee" font-size="34" fill="${C.cyan}">NEON STICK FIGHT</text>
<text x="${X}" y="146" font-family="Teko SemiBold" font-size="50" letter-spacing="3" fill="${C.amber}">// ${xml(kind)}</text>
${nameSvg}
${sub ? `<text x="${X}" y="${bottom + 50}" font-family="Teko SemiBold" font-size="44" letter-spacing="2" fill="${C.dim}">${xml(sub)}</text>` : ""}
<rect x="${X}" y="484" width="${btnW}" height="76" fill="${C.pink}"/>
<text x="${X + btnPad}" y="541" font-family="Teko SemiBold" font-size="${btnSize}" letter-spacing="${btnSp}" fill="${C.deep}">${btn}</text>
</svg>`;
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const files = new Map<string, Promise<Uint8Array>>();
/** a file from the static assets (the background and the fonts), kept for the isolate's life */
function asset(env: Env, origin: string, path: string): Promise<Uint8Array> {
  let p = files.get(path);
  if (!p) {
    p = env.ASSETS.fetch(new Request(`${origin}${ROOT}${path}`)).then(async (r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    });
    p.catch(() => files.delete(path));
    files.set(path, p);
  }
  return p;
}

let ready: Promise<void> | null = null;
async function render(env: Env, origin: string, svg: string): Promise<ArrayBuffer> {
  ready ??= Promise.all([initWasm(resvgWasm), initJpeg(jpegWasm)]).then(() => {}, (e) => { ready = null; throw e; });
  const [, bungee, teko] = await Promise.all([ready, asset(env, origin, "og/bungee-latin.ttf"), asset(env, origin, "og/teko-600-latin.ttf")]);
  const r = new Resvg(svg, { fitTo: { mode: "original" }, font: { fontBuffers: [bungee, teko], loadSystemFonts: false, defaultFontFamily: "Teko SemiBold" } });
  const img = r.render();
  const px = img.pixels;   // RGBA, a copy out of the wasm memory
  const rgba = { data: new Uint8ClampedArray(px.buffer, px.byteOffset, px.byteLength), width: img.width, height: img.height, colorSpace: "srgb" };
  img.free(); r.free();
  return encodeJpeg(rgba as unknown as Parameters<typeof encodeJpeg>[0], { quality: 85 });
}
