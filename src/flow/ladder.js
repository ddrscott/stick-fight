// The arcade ladder: six stages up the building, each a named opponent with a rising CPU
// difficulty, a personality (an opt-in AI style, src/combat/ai.js) and a look (an fx preset,
// the fighter's color, and which floor the fight starts on). The last one is the boss.
// The difficulties climb in even steps (0.2 0.32 0.44 0.55 0.66 0.8), and each continue eases the
// retried stage (retryDifficulty).

/**
 * @typedef {object} Stage
 * @property {number} n             1-based
 * @property {string} name          on the stage card, the HUD and the WINS banner
 * @property {string} tagline       one line under the name on the stage card
 * @property {number} difficulty    the CPU, 0..1
 * @property {string | null} style  ai.js style: null (the normal scrapper), turtle, rushdown, grappler, aerial, showcase
 * @property {string} color         the opponent's neon
 * @property {string} preset        fx preset: night, night-rain, neon, neon-rain
 * @property {number} floor         0 the main floor (with the stairwell), 1 the lower floor
 * @property {number} seed
 * @property {boolean} [boss]
 * @property {string} [char]       the character id this stage fights (src/characters/); TEMP stands in until it's registered
 */

/** @type {Stage[]} */
export const LADDER = [
  { n: 1, char: 'intern', name: 'INTERN', tagline: 'UNPAID, AND SWINGING LIKE IT', difficulty: 0.2, style: null, color: '#ffb02e', preset: 'night-rain', floor: 0, seed: 11 },
  { n: 2, char: 'helpdesk', name: 'HELPDESK', tagline: 'HAVE YOU TRIED BLOCKING?', difficulty: 0.32, style: 'turtle', color: '#2ef2ff', preset: 'night', floor: 0, seed: 23 },
  { n: 3, char: 'courier', name: 'COURIER', tagline: 'DELIVERS IN THIRTY SECONDS OR LESS', difficulty: 0.44, style: 'rushdown', color: '#ff2bd6', preset: 'neon', floor: 0, seed: 37 },
  { n: 4, char: 'security', name: 'SECURITY', tagline: 'WILL ESCORT YOU OUT. THROUGH THE RAILING', difficulty: 0.55, style: 'grappler', color: '#5dff8a', preset: 'night-rain', floor: 0, seed: 41 },
  { n: 5, char: 'janitor', name: 'JANITOR', tagline: 'WORKS THE LOWER FLOOR. MOPS WITH JUMP-INS', difficulty: 0.66, style: 'aerial', color: '#a66bff', preset: 'night', floor: 1, seed: 53 },
  { n: 6, char: 'manager', name: 'THE MANAGER', tagline: 'YOUR PERFORMANCE REVIEW IS NOW', difficulty: 0.8, style: 'showcase', color: '#ff3b3b', preset: 'neon-rain', floor: 0, seed: 67, boss: true },
];

// The roster's two characters that aren't on the default ladder step in for the player's own pick (you
// don't fight yourself), in this order; their names, lines and colors for when they aren't built yet.
export const EXTRAS = [
  { char: 'accountant', name: 'ACCOUNTANT', tagline: 'READ THE FINE PRINT. THEN THE OVERHEAD', color: '#ffe066', style: 'turtle' },
  { char: 'windowWasher', name: 'WINDOW WASHER', tagline: 'THIRTY FLOORS UP AND NO HARNESS', color: '#7ad7ff', style: 'aerial' },
];
// THE MANAGER is the boss; a player who picked him fights this one at the top instead
export const SUB_BOSS = { char: 'security', name: 'HEAD OF SECURITY', tagline: 'NOBODY GETS PAST THE FRONT DESK', color: '#5dff8a', style: 'grappler' };
// THE CEO: a secret seventh stage, only for a run that beat the boss without a continue (and didn't pick him)
export const SECRET_BOSS = { n: 7, char: 'ceo', name: 'THE CEO', tagline: 'THE BOARD HAS DECIDED YOU’RE A COST', difficulty: 0.9, style: 'showcase', color: '#ffd84f', preset: 'neon-rain', floor: 0, seed: 79, boss: true, secret: true };
// Each continue on a stage takes 0.1 off its CPU, stacking, never under 0.15; the next stage starts fresh.
export const CONTINUE_EASE = 0.1, EASE_FLOOR = 0.15;
// Stat upgrades (README, Progression, Stat upgrades) would make the first stages a walk, so a player who has some
// meets a slightly sharper CPU: up to UPGRADE_LIFT more difficulty at every tier, in proportion to the tiers owned
// (measured with npm run test:upgrades -- --balance). It's the CPU's existing dial, nothing new.
export const UPGRADE_LIFT = 0.1;
/** @param {number} difficulty @param {number} tiers  the player's fighter's upgrade tiers (0..12) */
export function upgradeLift(difficulty, tiers) {
  const t = Math.max(0, Math.min(12, Number(tiers) || 0));
  return t ? Math.min(1, Math.round((difficulty + UPGRADE_LIFT * t / 12) * 100) / 100) : difficulty;
}
/** @param {number} difficulty @param {number} continues  continues used on this stage */
export function retryDifficulty(difficulty, continues) {
  return continues > 0 ? Math.max(EASE_FLOOR, Math.round((difficulty - CONTINUE_EASE * continues) * 100) / 100) : difficulty;
}

/**
 * The stage after the last one, or null: THE CEO when the run used no continues, he's built, and the player isn't him.
 * @param {Stage[]} ladder @param {number} continues @param {string} playerId @param {(id: string) => any} getChar
 * @returns {Stage | null}
 */
export function secretStage(ladder, continues, playerId, getChar) {
  if (continues || playerId === SECRET_BOSS.char || ladder.some((s) => s.secret)) return null;
  const c = getChar(SECRET_BOSS.char);
  return c && c.id === SECRET_BOSS.char ? { ...SECRET_BOSS, wants: SECRET_BOSS.char } : null;
}

/**
 * The ladder for a run: the six stages with the player's own character swapped out where possible.
 * Each stage keeps its slot (number, difficulty, look, floor, seed); a stage whose character is
 * registered takes that character's name, line and neon, and one that isn't fights a TEMP (char 'temp')
 * under the stage's own name and color, so the ladder works before every character is built.
 * @param {string} playerId
 * @param {(id: string) => any} getChar   the registry's getCharacter
 * @returns {Stage[]}
 */
export function buildLadder(playerId, getChar) {
  const extras = EXTRAS.filter((e) => e.char !== playerId);
  const out = LADDER.map((st) => {
    let look = st;
    if (st.boss && st.char === playerId) look = { ...SUB_BOSS, sub: true };
    else if (st.char === playerId && extras.length) look = extras.shift();
    const c = getChar(look.char);
    const reg = !!c && c.id === look.char;
    // the boss's own title stays (THE MANAGER, HEAD OF SECURITY); a built character's name otherwise
    const name = reg && !look.boss && !look.sub ? c.name : look.name;
    return { ...st, char: reg ? look.char : 'temp', wants: look.char, name, tagline: (reg && look === st ? c.tagline : look.tagline) || st.tagline,
      color: reg ? c.color : look.color, style: look.style !== undefined ? look.style : st.style };
  });
  // the boss swap freed SECURITY's own stage: an extra fights there instead
  if (out[out.length - 1].wants === SUB_BOSS.char) {
    const i = out.findIndex((st, k) => k < out.length - 1 && st.wants === SUB_BOSS.char);
    if (i >= 0 && extras.length) {
      const e = extras.shift(), c = getChar(e.char), reg = !!c && c.id === e.char;
      out[i] = { ...out[i], char: reg ? e.char : 'temp', wants: e.char, name: reg ? c.name : e.name, tagline: reg ? c.tagline : e.tagline, color: reg ? c.color : e.color, style: e.style };
    }
  }
  return out;
}
