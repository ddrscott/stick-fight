// Career and sticks on the account (README, Progression; migrations/0006_career.sql). The math is the page's own
// (src/career/rules.js, src/career/palettes.js, imported as they are), so a signed-in player's count matches what
// a guest's page works out. Once signed in, the account is the source of truth: the page shows what this answers.
//
//   GET  /api/career                                  -> { career } | { career: null } signed out
//   POST /api/career/match   { m }                    -> { award, career }   an arcade stage or horde run (the page's word)
//   POST /api/career/merge   { career }               -> { career }          a guest's local progress, at sign-in
//   POST /api/career/buy     { fighter, id }          -> { career } | { error: 'short' | 'owned' | 'unknown' }
//   PUT  /api/career/equip   { fighter, id }          -> { career } | { error }   id '' is the fighter's own look
//   POST /api/career/shifts/swap { slot }              -> { career } | { error: 'used' | 'done' | 'bad' }   one a day
//
// Daily shifts (src/career/shifts.js, migrations/0008_shifts.sql) ride every award: payMatch is payout plus any
// shift the match finished, worked out from the same match the award reads.
//
// Who awards what:
//   online (quick, crew)  the room, from the result both pages agree on (worker/stats.ts roomResult): awardOnline.
//                         The technique counts come from each page's own report, capped per match like the rest.
//   offline (arcade, horde) the page reports it here. Nothing can check it, so what offline play pays a day is
//                         capped (OFFLINE_CAP): sticks only buy cosmetics, so a forged result isn't worth more.
//   training, the dummy   nothing.
// The merge takes the larger of each number (never the sum, so signing in twice adds nothing), up to MERGE_MAX,
// and the union of owned palettes.
import { type Env, json, allowed, BUSY } from "./env";
import { currentEmail } from "./auth";
import { applyAward, blankCareer, utcDay, MERGE_MAX, OFFLINE_MODES, ONLINE_MODES, titleFor } from "../src/career/rules.js";
import { palette, itemKey, isItem } from "../src/career/palettes.js";
import { payMatch, cleanShifts, swapShift, mergeShifts, SHIFT_FIGHTERS } from "../src/career/shifts.js";

export type Career = ReturnType<typeof blankCareer>;
type Row = {
  career_xp: number; sticks: number; win_day: string; online_day: string; offline_day: string;
  offline_xp: number; offline_sticks: number; owned: string; equip: string; shifts: string;
};
const COLS = "career_xp, sticks, win_day, online_day, offline_day, offline_xp, offline_sticks, owned, equip, shifts";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_OWNED = 200;

const int = (v: unknown, hi = 1e9) => Math.max(0, Math.min(hi, Math.floor(Number(v) || 0)));
const day = (v: unknown) => (typeof v === "string" && DAY_RE.test(v) ? v : "");
function parseJson<T>(s: string | null | undefined, fallback: T): T { try { const v = JSON.parse(s || ""); return v ?? fallback; } catch { return fallback; } }
function cleanOwned(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((k) => isItem(k)) as string[])].slice(0, MAX_OWNED);
}
/** fighter -> palette id, only palettes that are owned */
function cleanEquip(raw: unknown, owned: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [f, id] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id === "string" && palette(f, id) && owned.includes(itemKey(f, id))) out[f] = id;
  }
  return out;
}
function toCareer(r: Row): Career {
  const owned = cleanOwned(parseJson(r.owned, []));
  return {
    xp: int(r.career_xp), sticks: int(r.sticks), winDay: day(r.win_day), onlineDay: day(r.online_day),
    offDay: day(r.offline_day), offXp: int(r.offline_xp), offSticks: int(r.offline_sticks), owned, equip: cleanEquip(parseJson(r.equip, {}), owned),
    shifts: cleanShifts(parseJson(r.shifts, {})),
  };
}
/** what the page gets: the career plus its title, worked out here so every page shows the same one */
export const view = (c: Career) => ({ ...c, title: titleFor(c.xp).title });

// the owned and shifts columns as they were read, so a write can check nobody changed them (compared as stored text)
const ownedText = new WeakMap<Career, string>();
const shiftsText = new WeakMap<Career, string>();
async function load(env: Env, email: string): Promise<Career | null> {
  const r = await env.DB.prepare(`SELECT ${COLS} FROM accounts WHERE email = ?`).bind(email).first<Row>();
  if (!r) return null;
  const c = toCareer(r);
  ownedText.set(c, r.owned);
  shiftsText.set(c, r.shifts);
  return c;
}

/** Write c over what was read as `was`, only if nobody changed it in between (two matches ending at once on two
 *  devices). False when someone did: read again and redo. */
async function save(env: Env, email: string, was: Career, c: Career): Promise<boolean> {
  const res = await env.DB.prepare(`UPDATE accounts SET career_xp = ?, sticks = ?, win_day = ?, online_day = ?, offline_day = ?, offline_xp = ?, offline_sticks = ?,
      owned = ?, equip = ?, shifts = ? WHERE email = ? AND career_xp = ? AND sticks = ? AND owned = ? AND shifts = ?`)
    .bind(c.xp, c.sticks, c.winDay, c.onlineDay, c.offDay, c.offXp, c.offSticks, JSON.stringify(c.owned), JSON.stringify(c.equip), JSON.stringify(c.shifts),
      email, was.xp, was.sticks, ownedText.get(was) ?? JSON.stringify(was.owned), shiftsText.get(was) ?? JSON.stringify(was.shifts)).run();
  return res.meta.changes === 1;
}
/** read, change, write, retried when another write got in first. null: no account. */
async function update<T>(env: Env, email: string, fn: (c: Career) => { next: Career | null; out: T }): Promise<{ career: Career; out: T } | null> {
  for (let k = 0; k < 4; k++) {
    const was = await load(env, email);
    if (!was) return null;
    const { next, out } = fn(was);
    if (!next) return { career: was, out };
    if (await save(env, email, was, next)) return { career: next, out };
  }
  throw new Error("career: busy");
}

/** The match a page reports, cleaned: only these fields, every count a small whole number. */
export function cleanMatch(raw: unknown, modes: readonly string[]) {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const mode = typeof m.mode === "string" && modes.includes(m.mode) ? m.mode : null;
  if (!mode) return null;
  return {
    mode, won: m.won === true, cut: m.cut === true, fought: int(m.fought, 3600),
    parries: int(m.parries, 99), punishes: int(m.punishes, 99), enders: int(m.enders, 99), accidents: int(m.accidents, 99),
    perfects: int(m.perfects, 9), floors: int(m.floors, 999),
    // for the daily shifts: the fighter played (one a shift can name, else none), rounds won, the arcade stage
    fighter: typeof m.fighter === "string" && Object.hasOwn(SHIFT_FIGHTERS, m.fighter) ? m.fighter : "", rounds: int(m.rounds, 9), stage: int(m.stage, 9),
  };
}

/** Award a match to a signed-in account. Never throws (an award never breaks a match): null on any failure. */
export async function awardMatch(env: Env, email: string, m: NonNullable<ReturnType<typeof cleanMatch>>) {
  try {
    const today = utcDay();
    const r = await update(env, email, (c) => {
      const award = payMatch(m, c, today);   // payout plus any daily shift it finished
      return { next: award.lines.length ? applyAward(c, award, today) : null, out: award };
    });
    return r ? { award: r.out, career: view(r.career) } : null;
  } catch (e) { console.error("career: award failed", e); return null; }
}

/** An online match both pages agreed on (worker/stats.ts roomResult): this side's award. side 0 is the host.
 *  fighter: this side's, from the agreed result (a shift that names a fighter reads it). */
export async function awardOnline(env: Env, email: string, mode: string, side: 0 | 1, wins: [number, number], tech: unknown, fighter = "") {
  const t = Array.isArray(tech) ? tech : [];
  const won = wins[side] > wins[1 - side];
  const m = cleanMatch({ mode, won, cut: false, fought: 0, parries: t[0], punishes: t[1], enders: t[2], accidents: t[3], perfects: t[4], fighter, rounds: wins[side] }, ONLINE_MODES);
  return m ? awardMatch(env, email, m) : null;
}

/** a guest's progress over the account's: the larger of each, the union of what's owned */
function merge(c: Career, raw: unknown): Career {
  const g = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const owned = cleanOwned([...c.owned, ...cleanOwned(g.owned)]);
  const later = (a: string, b: string) => (b > a ? b : a);
  const gOff = day(g.offDay);
  const out: Career = {
    xp: Math.max(c.xp, int(g.xp, MERGE_MAX.xp)), sticks: Math.max(c.sticks, int(g.sticks, MERGE_MAX.sticks)),
    winDay: later(c.winDay, day(g.winDay)), onlineDay: later(c.onlineDay, day(g.onlineDay)),
    offDay: later(c.offDay, gOff), offXp: c.offXp, offSticks: c.offSticks, owned, equip: {},
    shifts: mergeShifts(c.shifts, g.shifts),   // today's shifts: the larger progress, done on either side is done
  };
  if (gOff && gOff === out.offDay) {
    if (c.offDay === gOff) { out.offXp = Math.max(c.offXp, int(g.offXp)); out.offSticks = Math.max(c.offSticks, int(g.offSticks)); }
    else { out.offXp = int(g.offXp); out.offSticks = int(g.offSticks); }
  }
  out.equip = { ...cleanEquip(g.equip, owned), ...c.equip };   // the account's picks win; the device's fill in the rest
  return out;
}

async function route(req: Request, env: Env, path: string): Promise<Response> {
  const email = await currentEmail(req, env);
  if (path === "GET career") {
    const c = email ? await load(env, email) : null;
    return json({ career: c ? view(c) : null });
  }
  if (!email) return json({ error: "signed-out" });
  const body = await req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  if (path === "POST career/match") {
    const m = cleanMatch(body.m, OFFLINE_MODES);
    if (!m) return json({ error: "bad-match" }, 400);
    const r = await awardMatch(env, email, m);
    return r ? json(r) : json({ error: "unavailable" }, 503);
  }
  if (path === "POST career/merge") {
    const r = await update(env, email, (c) => ({ next: merge(c, body.career), out: null }));
    return r ? json({ career: view(r.career) }) : json({ error: "signed-out" });
  }
  if (path === "POST career/buy") {
    const fighter = String(body.fighter || ""), id = String(body.id || ""), p = palette(fighter, id);
    if (!p) return json({ error: "unknown" }, 400);
    const key = itemKey(fighter, id);
    const r = await update<string>(env, email, (c) => {
      if (c.owned.includes(key)) return { next: null, out: "owned" };
      if (c.sticks < p.price) return { next: null, out: "short" };
      return { next: { ...c, sticks: c.sticks - p.price, owned: [...c.owned, key], equip: { ...c.equip, [fighter]: id } }, out: "ok" };
    });
    if (!r) return json({ error: "signed-out" });
    return r.out === "ok" ? json({ career: view(r.career) }) : json({ error: r.out, career: view(r.career) });
  }
  if (path === "POST career/shifts/swap") {
    const slot = Number(body.slot);
    const r = await update<string>(env, email, (c) => {
      const s = swapShift(c.shifts, slot);
      return s.error ? { next: null, out: s.error } : { next: { ...c, shifts: s.state! }, out: "ok" };
    });
    if (!r) return json({ error: "signed-out" });
    return r.out === "ok" ? json({ career: view(r.career) }) : json({ error: r.out, career: view(r.career) });
  }
  if (path === "PUT career/equip") {
    const fighter = String(body.fighter || ""), id = String(body.id || "");
    if (id && !palette(fighter, id)) return json({ error: "unknown" }, 400);
    const r = await update<string>(env, email, (c) => {
      if (id && !c.owned.includes(itemKey(fighter, id))) return { next: null, out: "not-owned" };
      const equip = { ...c.equip };
      if (id) equip[fighter] = id; else delete equip[fighter];
      return { next: { ...c, equip }, out: "ok" };
    });
    if (!r) return json({ error: "signed-out" });
    return r.out === "ok" ? json({ career: view(r.career) }) : json({ error: r.out, career: view(r.career) });
  }
  return json({ error: "not found" }, 404);
}

/** The career routes (parts after /api/), or null when it isn't one. */
export async function handleCareer(req: Request, env: Env, parts: string[]): Promise<Response | null> {
  if (parts[0] !== "career") return null;
  const path = `${req.method} ${parts.join("/")}`;
  if (!["GET career", "POST career/match", "POST career/merge", "POST career/buy", "PUT career/equip", "POST career/shifts/swap"].includes(path)) return json({ error: "not found" }, 404);
  // a body that changes something must be JSON: a cross-site form can't send that without a preflight
  if (req.method !== "GET" && !(req.headers.get("content-type") || "").includes("application/json")) return json({ error: "expected JSON" }, 415);
  if (!(await allowed(env.CAREER_LIMIT, req))) return json({ error: "busy", message: BUSY }, 429, { "retry-after": "60" });
  try { return await route(req, env, path); } catch (e) { console.error("career:", e); return json({ error: "unavailable" }, 503); }
}
