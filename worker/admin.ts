// The admin route (README, Privacy and terms, Admin): acting on a report about a crew. Behind the
// ADMIN_TOKEN secret (`npx wrangler secret put ADMIN_TOKEN`); without it every admin path is a 404,
// as if it weren't there. Nothing here is linked from a page.
//
//   GET  /stick-fight/api/admin/crews/<slug>                          -> the crew: name, members (id, name, last seen)
//   POST /stick-fight/api/admin/crews/<slug>  { action: "rename", name }               -> the crew's new name
//   POST /stick-fight/api/admin/crews/<slug>  { action: "rename-member", member, name? } -> a member's new name (PLAYER by default)
//   POST /stick-fight/api/admin/crews/<slug>  { action: "close" }                       -> the crew is gone, now
//
// Every call needs `Authorization: Bearer <ADMIN_TOKEN>`. `member` is a member id (from the GET) or
// the name they show. Renaming a crew keeps its link, which has the old name's words in it; when the
// link itself is the problem, close the crew. The share preview caches a crew's card for 5 minutes.
import { type Env, json, notFound, sha256 } from "./env";
import { SLUG_RE } from "./crew";

async function authorized(req: Request, env: Env): Promise<boolean> {
  const want = env.ADMIN_TOKEN || "";
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (want.length < 16 || !got) return false;
  // compare hashes, so the time it takes says nothing about the token
  return (await sha256(`admin:${got}`)) === (await sha256(`admin:${want}`));
}

/** The admin routes (parts after /stick-fight/api/), or null when it isn't one of them. */
export async function handleAdmin(req: Request, env: Env, parts: string[]): Promise<Response | null> {
  if (parts[0] !== "admin") return null;
  if (!env.ADMIN_TOKEN) return notFound();
  if (!(await authorized(req, env))) return json({ error: "unauthorized" }, 401);
  if (parts.length !== 3 || parts[1] !== "crews") return json({ error: "not found" }, 404);
  const slug = parts[2].toLowerCase();
  if (!SLUG_RE.test(slug) || slug.length > 40) return json({ error: "bad crew" }, 400);
  const crew = env.CREWS.get(env.CREWS.idFromName(slug));
  if (req.method === "GET") {
    const c = await crew.adminShow();
    return c ? json(c) : json({ error: "no-crew" }, 404);
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const body = await req.json<{ action?: unknown; name?: unknown; member?: unknown }>().catch(() => ({} as { action?: unknown; name?: unknown; member?: unknown }));
  const action = String(body.action || "");
  if (action === "rename") {
    const name = await crew.adminRename(String(body.name || ""));
    return name ? json({ ok: true, name }) : json({ error: "no-crew or bad-name" }, 400);
  }
  if (action === "rename-member") {
    const r = await crew.adminRenameMember(String(body.member || ""), String(body.name || ""));
    return r ? json({ ok: true, ...r }) : json({ error: "no-crew, no such member, or bad-name" }, 400);
  }
  if (action === "close") {
    const closed = await crew.adminClose();
    return closed ? json({ ok: true, closed: slug }) : json({ error: "no-crew" }, 404);
  }
  return json({ error: "unknown action" }, 400);
}
