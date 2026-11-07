// The arcade ladder: six stages up the building, each a named opponent with a rising CPU
// difficulty, a personality (an opt-in AI style, src/combat/ai.js) and a look (an fx preset,
// the fighter's color, and which floor the fight starts on). The last one is the boss.

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
 */

/** @type {Stage[]} */
export const LADDER = [
  { n: 1, name: 'INTERN', tagline: 'UNPAID, AND SWINGING LIKE IT', difficulty: 0.2, style: null, color: '#ffb02e', preset: 'night-rain', floor: 0, seed: 11 },
  { n: 2, name: 'HELPDESK', tagline: 'HAVE YOU TRIED BLOCKING?', difficulty: 0.4, style: 'turtle', color: '#2ef2ff', preset: 'night', floor: 0, seed: 23 },
  { n: 3, name: 'COURIER', tagline: 'DELIVERS IN THIRTY SECONDS OR LESS', difficulty: 0.55, style: 'rushdown', color: '#ff2bd6', preset: 'neon', floor: 0, seed: 37 },
  { n: 4, name: 'SECURITY', tagline: 'WILL ESCORT YOU OUT. THROUGH THE RAILING', difficulty: 0.7, style: 'grappler', color: '#5dff8a', preset: 'night-rain', floor: 0, seed: 41 },
  { n: 5, name: 'JANITOR', tagline: 'WORKS THE LOWER FLOOR. MOPS WITH JUMP-INS', difficulty: 0.85, style: 'aerial', color: '#a66bff', preset: 'night', floor: 1, seed: 53 },
  { n: 6, name: 'THE MANAGER', tagline: 'YOUR PERFORMANCE REVIEW IS NOW', difficulty: 1.0, style: 'showcase', color: '#ff3b3b', preset: 'neon-rain', floor: 0, seed: 67, boss: true },
];
