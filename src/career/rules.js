// Career and sticks (README, Progression): every number to tune, and the pure math both the page and the Worker
// run, so a guest's own count and the server's count for a signed-in player always come out the same.
//
// A player earns XP, shown as a job title on a "performance review" bar (never a level number), and sticks, the
// currency that buys palettes (src/career/palettes.js). Sticks are only ever earned by playing: no real money, no
// loot boxes, nothing random, and no streak that punishes a missed day.
//
// The design pillar "mashing loses" holds here too: raw hits and how many buttons were pressed pay nothing.
// A finished match pays a base, a win pays more, and the rest comes from technique, read off the botch and
// technique system: parries, punishes (counter hits: a hit into the other's startup, an anti-air, a spin-out
// from behind), a string finished with its ender, a happy accident, a perfect round. Each is capped per match.
// Training and the dummy pay nothing. A match cut short (src/bookkeeping.js cut) pays the base at most, and only
// after CUT_MIN_SECS of fighting.
//
//   titleFor(xp)                        { i, title, floor, next, into, span }: the rung and the bar
//   payout(match, career, day)          { lines, xp, sticks, firstWin, firstOnline, capped }: what a match pays
//   applyAward(career, award, day)      the career after it (a new object)
//   blankCareer()                       a new player's
//
// Fighter mastery (src/career/mastery.js) sits on top of that: payWithMastery and applyWithMastery add the XP the
// fighter played earned (the match's own XP here, plus NEW HIRE) and whatever a new rank unlocked.
//
// Daily shifts (src/career/shifts.js) sit on top: shifts.js payMatch is payout plus any shift the match finished, and
// its award carries the new shift state, which applyAward stores as career.shifts.
//
// Plain JavaScript, no imports, so the Worker (worker/career.ts) uses this file as it is.

/** The ladder, lowest first. xp: the total it takes to reach the title. The first promotion comes in the first
 *  session (about 3 matches with a win); C-SUITE takes weeks of regular play (about 10 matches a day). */
export const LADDER = [
  { title: 'TEMP', xp: 0 },
  { title: 'INTERN', xp: 100 },
  { title: 'ASSOCIATE', xp: 450 },
  { title: 'SENIOR', xp: 1200 },
  { title: 'MANAGER', xp: 2700 },
  { title: 'DIRECTOR', xp: 5200 },
  { title: 'VP', xp: 9500 },
  { title: 'C-SUITE', xp: 16000 },
];
export const TITLES = LADDER.map((r) => r.title);

/** What a match pays. xp and sticks per item; cap: the most a match pays of it. */
export const PAY = {
  base: { label: 'BASE', xp: 10, sticks: 10 },                    // any finished match, win or lose
  win: { label: 'WIN', xp: 10, sticks: 10 },                      // arcade stage or online match won
  floors: { label: 'FLOORS', xp: 4, sticks: 4, cap: 15 },         // horde: each floor cleared (a run has no win)
  parries: { label: 'PARRIES', xp: 3, sticks: 2, cap: 10 },
  punishes: { label: 'PUNISHES', xp: 2, sticks: 2, cap: 10 },     // counter hits
  enders: { label: 'ENDERS', xp: 3, sticks: 2, cap: 8 },          // strings finished with their ender
  accidents: { label: 'HAPPY ACCIDENTS', xp: 3, sticks: 3, cap: 5 },
  perfects: { label: 'PERFECT ROUNDS', xp: 10, sticks: 10, cap: 3 },
};
/** The order the earnings lines show in */
export const PAY_ORDER = ['base', 'win', 'floors', 'parries', 'punishes', 'enders', 'accidents', 'perfects'];

/** Once a day (UTC): the first win (any mode that has wins), and the first online match, win or lose. */
export const DAILY = {
  firstWin: { label: 'FIRST WIN TODAY', xp: 50, sticks: 100 },
  firstOnline: { label: 'FIRST ONLINE MATCH TODAY', xp: 25, sticks: 40 },
};

/** Arcade and horde are reported by the page and can't be checked, so what they pay a day is capped (the
 *  daily bonuses aside, which come once a day anyway). Sticks only buy cosmetics: a forged result isn't worth more. */
export const OFFLINE_CAP = { xp: 1500, sticks: 1500 };
/** A match cut short pays the base only, and only after this much fighting */
export const CUT_MIN_SECS = 30;
/** Modes that pay */
export const PAID_MODES = ['arcade', 'horde', 'quick', 'crew'];
export const OFFLINE_MODES = ['arcade', 'horde'];
export const ONLINE_MODES = ['quick', 'crew'];

/** The save-your-sticks nudge for guests (the result screen): after the first promotion or this many sticks,
 *  and again only after `againXp` more XP or a new title. */
export const NUDGE = { sticks: 200, againXp: 400 };
/** A guest's progress merged into an account at sign-in is taken at most this far: about a month of play as a guest,
 *  short of VP, so a hand-edited localStorage can't hand an account the top of the ladder. */
export const MERGE_MAX = { xp: 9000, sticks: 8000 };

/** today's key: the UTC date */
export const utcDay = (/** @type {number} */ t = Date.now()) => new Date(t).toISOString().slice(0, 10);

/**
 * @typedef {{ xp: number, sticks: number, winDay: string, onlineDay: string, offDay: string, offXp: number, offSticks: number,
 *   owned: string[], equip: Record<string, string>, shifts: { day: string, swap: number, prog: number[], done: boolean[] },
 *   mastery: Record<string, { xp: number, n: number }> }} Career
 * @typedef {{ id: string, label: string, n: number, xp: number, sticks: number }} Line
 * @typedef {{ lines: Line[], xp: number, sticks: number, firstWin: boolean, firstOnline: boolean, capped: boolean,
 *   offline: boolean, match: { xp: number, sticks: number }, shifts?: Career['shifts'], moved?: boolean[] }} Award
 */

/** a new player's career @returns {Career} */
export function blankCareer() {
  return { xp: 0, sticks: 0, winDay: '', onlineDay: '', offDay: '', offXp: 0, offSticks: 0, owned: [], equip: {}, shifts: { day: '', swap: -1, prog: [0, 0, 0], done: [false, false, false] }, mastery: {} };
}

/** the rung for this much XP, and how far along the bar to the next one */
/** @param {number} xp */
export function titleFor(xp) {
  const x = Math.max(0, Math.floor(Number(xp) || 0));
  let i = 0;
  while (i + 1 < LADDER.length && x >= LADDER[i + 1].xp) i++;
  const floor = LADDER[i].xp, next = i + 1 < LADDER.length ? LADDER[i + 1] : null;
  return { i, title: LADDER[i].title, floor, next: next ? next.title : null, into: x - floor, span: next ? next.xp - floor : 0 };
}

/** @param {unknown} v */
const n0 = (v, cap = 1e9) => Math.max(0, Math.min(cap, Math.floor(Number(v) || 0)));

/**
 * What a match pays. m: { mode, won, cut, fought (seconds), parries, punishes, enders, accidents, perfects, floors }.
 * Nothing else is read: hits, combos and presses never pay. career: the player's before it (for the daily bonuses
 * and the offline cap). day: today's UTC date.
 */
/** @param {any} m @param {Career | null | undefined} career @param {string} [day] @returns {Award} */
export function payout(m, career, day = utcDay()) {
  const c = career || blankCareer();
  /** @type {Award} */
  const out = { lines: [], xp: 0, sticks: 0, firstWin: false, firstOnline: false, capped: false, offline: false, match: { xp: 0, sticks: 0 } };
  if (!m || !PAID_MODES.includes(m.mode)) return out;
  const offline = OFFLINE_MODES.includes(m.mode), online = ONLINE_MODES.includes(m.mode);
  /** @param {string} id */
  const add = (id, n = 1, p = /** @type {any} */ (PAY)[id]) => { if (n > 0) out.lines.push({ id, label: p.label, n, xp: p.xp * n, sticks: p.sticks * n }); };
  if (m.cut) {
    if (!(Number(m.fought) >= CUT_MIN_SECS) || online) return out;
    add('base');
  } else {
    add('base');
    if (m.won && m.mode !== 'horde') add('win');
    if (m.mode === 'horde') add('floors', n0(m.floors, PAY.floors.cap));
    for (const id of ['parries', 'punishes', 'enders', 'accidents', 'perfects']) add(id, n0(m[id], /** @type {any} */ (PAY)[id].cap));
  }
  let xp = out.lines.reduce((s, l) => s + l.xp, 0), sticks = out.lines.reduce((s, l) => s + l.sticks, 0);
  if (offline) {
    const today = c.offDay === day;
    const roomXp = Math.max(0, OFFLINE_CAP.xp - (today ? n0(c.offXp) : 0)), roomSticks = Math.max(0, OFFLINE_CAP.sticks - (today ? n0(c.offSticks) : 0));
    if (xp > roomXp || sticks > roomSticks) {
      out.capped = true;
      out.lines.push({ id: 'cap', label: 'DAILY LIMIT', n: 1, xp: Math.min(roomXp, xp) - xp, sticks: Math.min(roomSticks, sticks) - sticks });
      xp = Math.min(roomXp, xp); sticks = Math.min(roomSticks, sticks);
    }
  }
  out.match = { xp, sticks };   // what counts toward the offline cap
  if (!m.cut && m.won && m.mode !== 'horde' && c.winDay !== day) { out.firstWin = true; out.lines.push({ id: 'firstWin', label: DAILY.firstWin.label, n: 1, xp: DAILY.firstWin.xp, sticks: DAILY.firstWin.sticks }); xp += DAILY.firstWin.xp; sticks += DAILY.firstWin.sticks; }
  if (!m.cut && online && c.onlineDay !== day) { out.firstOnline = true; out.lines.push({ id: 'firstOnline', label: DAILY.firstOnline.label, n: 1, xp: DAILY.firstOnline.xp, sticks: DAILY.firstOnline.sticks }); xp += DAILY.firstOnline.xp; sticks += DAILY.firstOnline.sticks; }
  out.xp = xp; out.sticks = sticks;
  out.offline = offline;
  return out;
}

/** The career after an award (a new object; the one passed in isn't changed).
 *  @param {Career | null | undefined} career @param {Award | null | undefined} award @param {string} [day] @returns {Career} */
export function applyAward(career, award, day = utcDay()) {
  const c = { ...blankCareer(), ...(career || {}) };
  if (!award) return c;
  c.xp = n0(c.xp) + n0(award.xp);
  c.sticks = n0(c.sticks) + n0(award.sticks);
  if (award.firstWin) c.winDay = day;
  if (award.firstOnline) c.onlineDay = day;
  if (award.shifts) c.shifts = award.shifts;   // daily shifts (src/career/shifts.js payMatch)
  if (award.offline && award.match) {
    if (c.offDay !== day) { c.offDay = day; c.offXp = 0; c.offSticks = 0; }
    c.offXp = n0(c.offXp) + n0(award.match.xp); c.offSticks = n0(c.offSticks) + n0(award.match.sticks);
  }
  return c;
}

/** Plain words for the result screen: "PARRIES ×3", with what it paid */
/** @param {Line} l */
export function lineText(l) {
  return `${l.label}${l.n > 1 ? ` ×${l.n}` : ''}`;
}
