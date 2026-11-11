// Share previews for crew and room links (README, Site, Share image; Multiplayer, Crew rooms).
//
// A link pasted into iMessage, Slack, Discord, WhatsApp and the rest is fetched by a bot that reads the
// page's Open Graph tags and runs no script. play/index.html carries the plain set (the game's title,
// og.jpg). For play/?crew=<slug> and play/?room=<CODE> the Worker runs first (wrangler.jsonc,
// run_worker_first) and swaps those tags for the room's own: "Join CREW NAME on Neon Stick Fight", a
// line saying what tapping does, and a picture of the room's name. Everyone gets the same tags, bot or
// not; the page is otherwise byte for byte the asset. An unknown or expired crew gets the plain page.
//
//   GET /stick-fight/api/og/crew/<slug>.jpg?v=<v>   the crew's image, 1200x630
//   GET /stick-fight/api/og/room/<CODE>.jpg         a quick room's image
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
import { type Env, API, CODE_RE, allowed, sha256 } from "./env";
import { SLUG_RE } from "./crew";
import { NAME_W, fitName, textWidth } from "./og-layout";

const ROOT = "/stick-fight/";
const W = 1200, H = 630;
/** bump when the image's layout changes, so every cached crew image is drawn again */
const LOOK = 2;
const CARD_TTL_S = 300;          // a crew's name and member count, cached at the edge
const IMAGE_TTL_S = 7 * 86400;   // an image URL never changes what it shows
const SITE = "Neon Stick Fight";
const PITCH = "Tap to join: no sign-up, pick a fighter and fight.";

type Card = { name: string; members: number };
type Preview = { title: string; description: string; url: string; image: string; alt: string };

/** the origin a share tag points at: https on the public host (wrangler dev hands the script http) */
const publicOrigin = (u: URL) => (u.hostname === "localhost" || u.hostname === "127.0.0.1" ? u.origin : `https://${u.host}`);
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

/** What a crew or room link should unfurl as, or null for the plain page. */
async function preview(req: Request, env: Env, ctx: ExecutionContext): Promise<Preview | null> {
  const url = new URL(req.url), q = url.searchParams, origin = publicOrigin(url);
  const play = `${origin}${ROOT}play/`;
  const slug = (q.get("crew") || "").toLowerCase();
  if (slug) {
    const card = await crewCard(env, ctx, url.origin, slug);
    if (!card) return null;
    const many = card.members === 1 ? "1 fighter in the crew" : card.members > 1 ? `${card.members} fighters in the crew` : "";
    return {
      title: `Join ${card.name} on ${SITE}`,
      description: `Your crew's room on ${SITE}${many ? `, ${many}` : ""}. ${PITCH}`,
      url: `${play}?crew=${encodeURIComponent(slug)}`,
      image: `${origin}${API}og/crew/${slug}.jpg?v=${await crewVersion(card)}`,
      alt: `${card.name}: crew room on ${SITE}. Tap to join.`,
    };
  }
  const code = (q.get("room") || "").toUpperCase();
  if (CODE_RE.test(code)) {
    return {
      title: `Join room ${code} on ${SITE}`,
      description: `A quick match is waiting in room ${code}. ${PITCH}`,
      url: `${play}?room=${code}`,
      image: `${origin}${API}og/room/${code}.jpg`,
      alt: `Room ${code}: quick match on ${SITE}. Tap to join.`,
    };
  }
  return null;
}

/** GET /stick-fight/play/ (and play/index.html). No crew or room in the query: the asset, untouched. */
export async function playPage(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const q = new URL(req.url).searchParams;
  if (req.method !== "GET" || (!q.has("crew") && !q.has("room"))) return env.ASSETS.fetch(req);
  // the tags differ from the asset's, so no 304 against its ETag: ask for the whole file
  const plain = new Request(req.url, { method: "GET", headers: [...req.headers].filter(([k]) => !/^if-/i.test(k)) });
  const [res, p] = await Promise.all([env.ASSETS.fetch(plain), preview(req, env, ctx).catch(() => null)]);
  if (!p || res.status !== 200 || !(res.headers.get("content-type") || "").includes("text/html")) return res;
  const set = (v: string) => ({ element(el: Element) { el.setAttribute("content", v); } });
  const out = new HTMLRewriter()
    .on('meta[property="og:title"]', set(p.title))
    .on('meta[property="og:description"]', set(p.description))
    .on('meta[property="og:url"]', set(p.url))
    .on('meta[property="og:image"]', set(p.image))
    .on('meta[property="og:image:alt"]', set(p.alt))
    .on('meta[name="twitter:title"]', set(p.title))
    .on('meta[name="twitter:description"]', set(p.description))
    .on('meta[name="twitter:image"]', set(p.image))
    .on('meta[name="twitter:image:alt"]', set(p.alt))
    .transform(res);
  const headers = new Headers(out.headers);
  headers.delete("etag");
  headers.set("cache-control", "public, max-age=0, must-revalidate");
  return new Response(out.body, { status: 200, headers });
}

/** /stick-fight/ with ?crew= or ?room=: a link from before the game moved to play/. The page's script
 *  forwards people, but unfurl bots run no script, so the Worker answers with a real redirect. */
export function oldLink(req: Request, env: Env): Promise<Response> | Response {
  const url = new URL(req.url);
  if (!url.searchParams.has("crew") && !url.searchParams.has("room")) return env.ASSETS.fetch(req);
  return new Response(null, { status: 301, headers: { location: `${ROOT}play/${url.search}` } });
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
