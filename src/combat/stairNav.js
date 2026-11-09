// The CPU and the stairs. When the opponent is on another level (the other floor, or far enough up or down
// a flight that the two can't touch: sim.sameLevel), the CPU takes the stairs to him: from the lower floor it
// walks to the foot of the flight that makes the shorter trip and on up it; from the main floor it walks to
// that flight's head and steps on with down + toward the flight (the same input a player uses); on a flight
// it keeps going up or down toward his level. Once the two can touch, the normal CPU (ai.js) takes over.
//
//   stairRoute(me, opp, sim) -> a held input, or null when there's nothing to route (same level, busy, no stairs)

import { EMPTY_INPUT } from './input.js';

const FREE = /^(idle|walk|run|crouch|block)$/;

export function stairRoute(me, opp, sim) {
  const S = sim.stairs;
  if (!S || !S.length || !sim.sameLevel || sim.phase !== 'fight' || !opp || opp.hidden) return null;
  if (sim.sameLevel(me, opp)) return null;
  if (!FREE.test(me.state) || !me.grounded || me.rag || me.followDown || me.faint > 0) return null;
  if (opp.falling) return null;   // he's on his way down a stairwell: the follow-down vault handles it
  const myY = sim.levelY(me), hisY = sim.levelY(opp), up = hisY < myY;
  const run = me.stamina > 30;
  if (sim.onStair(me)) {
    const st = S[me.stair];
    return { ...EMPTY_INPUT, dx: up ? -st.dir : st.dir, run };
  }
  // the flight that makes the shorter trip: to its near end, along it, then to him
  let best = -1, bd = Infinity;
  for (let k = 0; k < S.length; k++) {
    const st = S[k], from = up ? st.foot : st.head, to = up ? st.head : st.foot;
    const d = Math.abs(me.x - from) + Math.abs(st.foot - st.head) + Math.abs(to - opp.x);
    if (d < bd) { bd = d; best = k; }
  }
  const st = S[best];
  if (up) {
    // the lower floor: past the foot is the flight going up
    return { ...EMPTY_INPUT, dx: -st.dir, run };
  }
  // the main floor: to the head, then down + toward the flight steps on
  const along = (me.x - st.head) * st.dir;
  if (along < -16) return { ...EMPTY_INPUT, dx: st.dir, run: run && along < -90 };
  if (along > 30) return { ...EMPTY_INPUT, dx: -st.dir, run: run && along > 90 };
  return { ...EMPTY_INPUT, dx: st.dir, down: true };
}
