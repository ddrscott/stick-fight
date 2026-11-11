// @ts-check
// The most a run can score for how far it got: the ceiling on a crew high score (worker/crew.ts), which the
// page reports itself. It's a plausibility check, not security: a score above what the scoring rules allow
// for the stage or floor reached is junk, and anything under it is taken at the player's word. Shared by the
// page and the Worker (README, Crew rooms, High scores), so the two never disagree.
//
// One arcade stage, at the most generous rules (best of 5, so as many as 5 rounds, each with the full clock):
//   per round won   ROUND WIN 1,000 + the time bonus (at most 60 x 100) + PERFECT 5,000
//   per round       the damage (the biggest health bar is under 140, x 10) and the extras: combo hits,
//                   counters, enders, tricks, a floor break, throw breaks, a finish. Those are bounded by the
//                   health they take off, so 20,000 a round is far over anything played
//   per stage       STAGE CLEAR, 2,000 x the stage number
// => STAGE_MAX 150,000 a stage, plus the clear bonuses. Horde: a floor's wave of goons (300 each and their
// damage, combos and the rest) and FLOOR CLEAR 2,000, so FLOOR_MAX 60,000 a floor, counting the one the run
// ended on.
import { POINTS } from './scores.js';

export const STAGE_MAX = 150000;
export const FLOOR_MAX = 60000;
export const MAX_STAGE = 7;      // the ladder's six stages and the secret seventh (src/flow/ladder.js)
export const MAX_FLOORS = 9999;

/**
 * The highest score a run that got this far can have.
 * @param {'arcade' | 'horde'} kind
 * @param {number} reach  arcade: the stage reached (1..7); horde: the floors cleared (0..)
 */
export function scoreCap(kind, reach) {
  const r = Math.max(0, Math.floor(Number(reach) || 0));
  if (kind === 'horde') return (Math.min(r, MAX_FLOORS) + 1) * FLOOR_MAX;
  const n = Math.max(1, Math.min(MAX_STAGE, r));
  return n * STAGE_MAX + POINTS.stageClear * (n * (n + 1)) / 2;
}
