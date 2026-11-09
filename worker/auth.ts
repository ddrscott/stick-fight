// Profiles and email sign-in (README, "Multiplayer", Profiles and sign-in). Nobody needs an
// account to play: the page makes a random player id and keeps it with the display name in
// localStorage. SAVE MY PROFILE links that id to an email, so signing in on another device
// restores the same id (and with it the name, the crew list and every crew record).
//
//   POST /stick-fight/api/auth/start   { email }                    -> { ok } (dev: + devCode, devLink)
//   POST /stick-fight/api/auth/verify  { email, code, pid, name }   -> { email, pid, name, crews, restored } + cookie
//   GET  /stick-fight/api/me                                        -> { email, pid, name, crews } | null
//   PUT  /stick-fight/api/me           { name?, crews? }            -> { ok }
//   POST /stick-fight/api/auth/logout                               -> { ok }, cookie cleared
//
// The code is 6 digits, lasts 10 minutes and takes 5 tries; the email also carries a link to the
// page with the code in the fragment, which the page submits from JavaScript, so a mail scanner
// that opens links can't use it up. Only hashes of codes and session tokens are stored. Sends are
// capped per email (one per 30 s, 5 an hour) and per IP (20 an hour), guesses per email (10 an
// hour, 20 a day) and per IP (30 an hour), on top of the AUTH_LIMIT binding (20 calls a minute
// per IP). The session is a 30-day HttpOnly cookie scoped to Path=/stick-fight, because the
// askscottpierce.com origin is shared with other apps. Emails never go to anyone but their owner.
//
// Google sign-in would plug in beside this: an OAuth callback that ends in the same
// linkAccount() + createSession() as a verified code (it needs a Google OAuth client the owner
// registers, so it isn't built).
import { type Env, json, allowed, BUSY, sha256, PID_RE, cleanName } from "./env";

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SENDS_PER_EMAIL_HOUR = 5;
const SENDS_PER_IP_HOUR = 20;
const GUESSES_PER_EMAIL_HOUR = 10;
const GUESSES_PER_EMAIL_DAY = 20;
const GUESSES_PER_IP_HOUR = 30;
const SESSION_TTL_S = 30 * 24 * 60 * 60;
const COOKIE = "sf_session";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_CREWS = 20;

type Account = { email: string; player_id: string; name: string; crews: string };
type CrewRef = { slug: string; name: string; at: number };

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
function randomCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function newPid(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function cookieValue(req: Request, name: string): string | null {
  for (const part of (req.headers.get("Cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
function sessionCookie(req: Request, token: string, maxAge: number): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/stick-fight; Max-Age=${maxAge}${secure}`;
}
/** the crew list as stored: at most MAX_CREWS well-formed entries, newest first */
function cleanCrews(raw: unknown): CrewRef[] {
  if (!Array.isArray(raw)) return [];
  const out: CrewRef[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const slug = String((c as CrewRef).slug || "");
    const name = cleanName((c as CrewRef).name, 1, 20);
    if (!SLUG_RE.test(slug) || slug.length > 40 || !name || out.some((o) => o.slug === slug)) continue;
    out.push({ slug, name, at: Math.max(0, Math.floor(Number((c as CrewRef).at) || 0)) });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, MAX_CREWS);
}
const parseCrews = (s: string): CrewRef[] => { try { return cleanCrews(JSON.parse(s)); } catch { return []; } };

/**
 * Count one event against `key` in a fixed window and say whether it's within `max`. One atomic
 * statement, so parallel requests can't all read the same count.
 */
async function spend(env: Env, key: string, max: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO limits (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END
     RETURNING count`,
  ).bind(key, now, now - windowMs).first<{ count: number }>();
  return !!row && row.count <= max;
}

async function currentEmail(req: Request, env: Env): Promise<string | null> {
  const token = cookieValue(req, COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare("SELECT email FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await sha256(token), Date.now()).first<{ email: string }>();
  return row ? row.email : null;
}
async function account(env: Env, email: string): Promise<Account | null> {
  return env.DB.prepare("SELECT email, player_id, name, crews FROM accounts WHERE email = ?").bind(email).first<Account>();
}
const profileOf = (a: Account) => ({ email: a.email, pid: a.player_id, name: a.name, crews: parseCrews(a.crews) });

async function start(req: Request, env: Env): Promise<Response> {
  const body = await req.json<{ email?: unknown; page?: unknown }>().catch(() => ({} as { email?: unknown; page?: unknown }));
  const email = normalizeEmail(body.email);
  // expected refusals answer 200 with { error }: a 4xx would put a red line in the player's console
  if (!email) return json({ error: "bad-email" });
  const prev = await env.DB.prepare("SELECT sent_at FROM login_codes WHERE email = ?").bind(email).first<{ sent_at: number }>();
  if (prev && Date.now() - prev.sent_at < RESEND_COOLDOWN_MS) return json({ error: "cooldown" }, 200, { "retry-after": "30" });
  const ip = req.headers.get("CF-Connecting-IP") ?? "local";
  if (!(await spend(env, `send-ip:${ip}`, SENDS_PER_IP_HOUR, HOUR_MS)) || !(await spend(env, `send-email:${email}`, SENDS_PER_EMAIL_HOUR, HOUR_MS))) {
    return json({ error: "too-many" }, 200, { "retry-after": "3600" });
  }
  const code = randomCode(), now = Date.now();
  await env.DB.prepare(
    `INSERT INTO login_codes (email, code_hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
       attempts = 0, sent_at = excluded.sent_at`,
  ).bind(email, await sha256(`${email}:${code}`), now + CODE_TTL_MS, now).run();

  // The link opens the game, which reads the fragment and submits the code from JavaScript (a
  // fragment never reaches a server log, and a GET that signed you in would be used up by mail
  // scanners that open links).
  const url = new URL(req.url);
  const fragment = `#signin=${encodeURIComponent(email)}&code=${code}`;
  if (env.DEV_LOGIN_CODES === "1") {
    // dev: the page shows the code; the link points at the page that asked (Vite serves the game at /play/)
    let page = `${url.origin}/stick-fight/play/`;
    try { const p = new URL(String(body.page || "")); if (p.protocol === "http:" || p.protocol === "https:") page = p.origin + p.pathname; } catch { /* default */ }
    console.log(`[dev] sign-in code for ${email}: ${code}`);
    return json({ ok: true, devCode: code, devLink: page + fragment });
  }
  const link = `${url.origin}/stick-fight/play/${fragment}`;   // the game; the homepage forwards an old #signin link there too
  try {
    await env.EMAIL.send({
      from: { email: env.EMAIL_FROM, name: "Neon Stick Fight" },
      to: email,
      subject: `${code} is your Neon Stick Fight code`,
      text: `Your code is ${code}\n\nOr open this link on the device you're signing in on:\n${link}\n\nIt expires in 10 minutes. If you didn't ask for it, ignore this email: nothing happens without the code.`,
      html: emailHtml(code, link),
    });
  } catch (e) {
    console.error("sign-in email failed", (e as { code?: string }).code, (e as Error).message);
    return json({ error: "send-failed" }, 502);
  }
  return json({ ok: true });
}

/** null when the code is right (and now used up), else the reason */
async function check(req: Request, env: Env, email: string, code: string): Promise<string | null> {
  const ip = req.headers.get("CF-Connecting-IP") ?? "local";
  // every guess spends from the IP's and the email's budgets before it's checked
  const within = (await spend(env, `guess-ip:${ip}`, GUESSES_PER_IP_HOUR, HOUR_MS))
    && (await spend(env, `guess-email:${email}`, GUESSES_PER_EMAIL_HOUR, HOUR_MS))
    && (await spend(env, `guess-email-day:${email}`, GUESSES_PER_EMAIL_DAY, DAY_MS));
  if (!within) return "too-many";
  // claim one attempt on this code atomically; an expired or used-up code claims nothing
  const row = await env.DB.prepare(
    `UPDATE login_codes SET attempts = attempts + 1 WHERE email = ? AND expires_at > ? AND attempts < ?
     RETURNING code_hash, attempts`,
  ).bind(email, Date.now(), MAX_ATTEMPTS).first<{ code_hash: string; attempts: number }>();
  if (!row) {
    const c = await env.DB.prepare("SELECT expires_at FROM login_codes WHERE email = ?").bind(email).first<{ expires_at: number }>();
    return !c || c.expires_at < Date.now() ? "expired" : "used-up";
  }
  if ((await sha256(`${email}:${code}`)) !== row.code_hash) return MAX_ATTEMPTS - row.attempts > 0 ? `wrong:${MAX_ATTEMPTS - row.attempts}` : "used-up";
  // single use: only the request that deletes the row gets in
  const used = await env.DB.prepare("DELETE FROM login_codes WHERE email = ? AND code_hash = ?").bind(email, row.code_hash).run();
  if (used.meta.changes !== 1) return "used-up";
  await env.DB.prepare("DELETE FROM limits WHERE key IN (?, ?)").bind(`guess-email:${email}`, `guess-email-day:${email}`).run();
  return null;
}

/**
 * The account for a verified email: the existing one (its player id wins), or a new one for this
 * device's id. null when this device's id is already saved under another email (that player should
 * sign in with that one; making a fresh id here would cut the device off from its own records).
 */
async function linkAccount(env: Env, email: string, pid: unknown, name: unknown): Promise<{ acct: Account; restored: boolean } | null> {
  const have = await account(env, email);
  const now = Date.now();
  if (have) {
    await env.DB.prepare("UPDATE accounts SET seen_at = ? WHERE email = ?").bind(now, email).run();
    return { acct: have, restored: have.player_id !== pid };
  }
  const id = typeof pid === "string" && PID_RE.test(pid) ? pid : newPid();
  if (await env.DB.prepare("SELECT 1 FROM accounts WHERE player_id = ?").bind(id).first()) return null;
  const acct: Account = { email, player_id: id, name: cleanName(name) || "", crews: "[]" };
  await env.DB.prepare("INSERT INTO accounts (email, player_id, name, crews, created_at, seen_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(acct.email, acct.player_id, acct.name, acct.crews, now, now).run();
  return { acct, restored: id !== pid };
}

async function createSession(req: Request, env: Env, email: string): Promise<string> {
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sessions (token_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256(token), email, Date.now() + SESSION_TTL_S * 1000, Date.now()),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Date.now()),
    env.DB.prepare("DELETE FROM limits WHERE window_start < ?").bind(Date.now() - DAY_MS),
    env.DB.prepare("DELETE FROM login_codes WHERE expires_at < ?").bind(Date.now() - DAY_MS),
  ]);
  return sessionCookie(req, token, SESSION_TTL_S);
}

async function verify(req: Request, env: Env): Promise<Response> {
  const body = await req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const email = normalizeEmail(body.email), code = String(body.code ?? "").trim();
  if (!email) return json({ error: "bad-email" });
  if (!/^\d{6}$/.test(code)) return json({ error: "bad-code" });
  const why = await check(req, env, email, code);
  if (why) {
    const [error, left] = why.split(":");
    return json({ error, left: left ? +left : undefined });
  }
  const linked = await linkAccount(env, email, body.pid, body.name);
  if (!linked) return json({ error: "other-email" });
  return json({ ...profileOf(linked.acct), restored: linked.restored }, 200, { "set-cookie": await createSession(req, env, email) });
}

async function me(req: Request, env: Env): Promise<Response> {
  const email = await currentEmail(req, env);
  const acct = email ? await account(env, email) : null;
  // "not signed in" is an answer, not an error: a 200 with null
  return json(acct ? profileOf(acct) : null);
}

async function saveMe(req: Request, env: Env): Promise<Response> {
  const email = await currentEmail(req, env);
  if (!email) return json({ error: "signed-out" });
  const body = await req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const acct = await account(env, email);
  if (!acct) return json({ error: "signed-out" });
  const name = body.name === undefined ? acct.name : cleanName(body.name);
  if (name === null) return json({ error: "bad-name" }, 400);
  // the crew list merges: what this device knows plus what the account had, newest first
  const crews = body.crews === undefined ? parseCrews(acct.crews) : cleanCrews([...cleanCrews(body.crews), ...parseCrews(acct.crews)]);
  await env.DB.prepare("UPDATE accounts SET name = ?, crews = ?, seen_at = ? WHERE email = ?")
    .bind(name, JSON.stringify(crews), Date.now(), email).run();
  return json({ ok: true, name, crews });
}

async function logout(req: Request, env: Env): Promise<Response> {
  const token = cookieValue(req, COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(req, "", 0) });
}

/** The profile routes (parts after /stick-fight/api/), or null when it isn't one of them. */
export async function handleAuth(req: Request, env: Env, parts: string[]): Promise<Response | null> {
  const route = `${req.method} ${parts.join("/")}`;
  const routes: Record<string, (req: Request, env: Env) => Promise<Response>> = {
    "POST auth/start": start, "POST auth/verify": verify, "POST auth/logout": logout, "GET me": me, "PUT me": saveMe,
  };
  const fn = routes[route];
  if (!fn) return parts[0] === "auth" || parts[0] === "me" ? json({ error: "not found" }, 404) : null;
  // a body that changes something must be JSON: a cross-site form can't send that without a preflight
  if (req.method !== "GET" && !(req.headers.get("content-type") || "").includes("application/json")) return json({ error: "expected JSON" }, 415);
  if (!(await allowed(env.AUTH_LIMIT, req))) return json({ error: "busy", message: BUSY }, 429, { "retry-after": "60" });
  return fn(req, env);
}

function emailHtml(code: string, link: string): string {
  return `<!doctype html><html><body style="margin:0;background:#0a0414;font-family:-apple-system,Segoe UI,sans-serif;color:#fff4fd">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table width="100%" style="max-width:440px;background:#14062a;border:2px solid #2ef2ff" cellpadding="0" cellspacing="0"><tr><td style="padding:32px">
<div style="font-size:22px;font-weight:800;letter-spacing:1px;margin-bottom:24px;color:#ffd6f6">NEON STICK FIGHT</div>
<div style="font-size:15px;color:#d6beff;margin-bottom:8px">Your sign-in code</div>
<div style="font-family:Menlo,monospace;font-size:36px;letter-spacing:8px;font-weight:700;margin-bottom:24px;color:#ffe0a8">${code}</div>
<a href="${link}" style="display:inline-block;background:#ff2bd6;color:#12041f;text-decoration:none;font-weight:700;padding:12px 20px">Sign in on this device</a>
<p style="font-size:13px;color:#b9a6d9;margin:24px 0 0">The code expires in 10 minutes. If you didn't ask for it, ignore this email: nothing happens without the code.</p>
</td></tr></table></td></tr></table></body></html>`;
}
