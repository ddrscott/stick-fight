// Per-step invariants for the combat sim (README, Fundamentals, States and the flags they own; README, Run,
// netsim:invariants). Dev and test only: src/combat/sim.js never imports this, so a production build doesn't carry
// it. scripts/netsim/invariants.mjs checks after every tick of thousands of CPU-vs-CPU steps; in the browser,
// ?invariants on the dev server hooks it to sim.afterTick (src/main.js) and logs the first thing it finds.
//
//   const check = createInvariants(sim)   then, after each sim.tick():   const bad = check()   // null, or the first violation
//
// A violation is { rule, unit, state, detail }. The checker keeps how long each unit has been in its state in a
// WeakMap of its own, never on the unit, so snapshots stay plain data. A rollback (loadState) puts units back in
// time without telling it, so the stuck counts are only approximate under rollback; nothing else depends on history.

// How long a unit may stay in one state before it counts as stuck, in steps (120 a second). Each is several times
// the longest seen in CPU play (scripts/netsim/invariants.mjs --durations), so only a unit that will never leave trips it.
// idle, walk, run, block and crouch are the player's choice and have no limit; a hidden unit is off the floor.
export const STUCK_STEPS = {
  attack: 900,     // the longest strike, with its freezes and a stance's minimum, is about 3 s; a CPU never holds a stance longer
  hitstun: 600,    // stun is frame data (under a second) and ends once the slide slows; a combo restarts the state, not the count
  blockstun: 240,  // a block's stun and a throw break's 14 frames; about half a second at most
  grabbed: 360,    // a throw's hold (BREAK_STEPS, or a command grab's own hold) is under a second
  knockdown: 900,  // a fall down the stairs: unwedge() sets down any ragdoll still up after 5 s (600 steps)
  splat: 240,      // SPLAT_STEPS (48) on the wall, then it slides off
  down: 600,       // DOWN_MAX (120) stands him up; stomp pins and freezes add a little
  getup: 360,      // the getup clip is about 0.3 s at GETUP_SPEED
  roll: 240,       // ROLL steps (40, or 48 crossing under)
  landing: 240,    // landing lag is at most 26 steps, or the jump clip's own squash
  jump: 600,       // the longest jump with a double jump off the top floor lands in about 1 s
  botch: 600,      // a botch clip is under a second
  dash: 240,       // a dash is under 30 steps of burst and braking
  vault: 600,      // the run to the rail gives up after 180 steps; the vault clip is about 1 s
  perfect: 1200,   // the perfect round: the run (PF_RUN), the clip and the body on the glass (PF_CUT 2.6 s, then PERFECT.after)
  taunt: 240,      // a fighter mastery taunt plays under the ROUND card (INTRO_TIME 1.4 s, 168 steps) and is cut at FIGHT
  celebrate: 600,  // the WINS card (MATCH_HOLD 1.8 s), then the next match spawns him idle
  ko: 1800,        // the KO hold, a perfect round and the WINS card, then the next round spawns him
};

const RIDE_STATES = new Set(['idle', 'walk', 'run']);
const PHASES = new Set(['startup', 'active', 'recovery']);

/** @param {any} sim */
export function createInvariants(sim, { stuck = STUCK_STEPS } = {}) {
  const owns = sim.STATE_OWNS, rest = sim.FLAG_REST;
  // flag -> the states that own it (src/combat/sim.js STATE_OWNS)
  const owners = {};
  for (const s in owns) for (const k of owns[s]) (owners[k] || (owners[k] = new Set())).add(s);
  const held = new WeakMap();   // unit -> { state, n }: steps in its current state
  const same = (a, b) => a === undefined || a === b || (a == null && b == null);   // a field never set yet is at rest
  return function check() {
    const units = sim.units;
    for (const u of units) {
      const bad = (rule, detail) => ({ rule, unit: u.id, state: u.state, detail });
      for (const k of ['x', 'y', 'vx', 'vy', 'health']) if (typeof u[k] !== 'number' || !isFinite(u[k])) return bad('finite', `${k} is ${u[k]}`);
      // how long in this state (a hidden unit isn't on the floor, so it isn't counted)
      const h = held.get(u);
      if (u.hidden || !h || h.state !== u.state) held.set(u, { state: u.state, n: 0 });
      else if (++h.n > (stuck[u.state] || Infinity)) return bad('stuck', `in ${u.state} for ${h.n} steps (limit ${stuck[u.state]})`);
      if (u.hidden) {
        // a goon off the floor (offFloor) stands idle; a KO'd body that joined the pile or went into the camera stays ko
        if (u.state !== 'idle' && u.state !== 'ko') return bad('hidden', `hidden in ${u.state}`);
        continue;
      }
      // KOs: resolveKOs has run by the end of every step, so nobody stands at 0 and nobody lies KO'd with health left
      if (u.health <= 0 && u.state !== 'ko') return bad('koAtZero', `health ${u.health} outside ko`);
      if (u.state === 'ko' && u.health > 0) return bad('koWithHealth', `ko with health ${u.health}`);
      if (u.health > (u.maxHealth || 100) + 1e-9) return bad('health', `health ${u.health} over max ${u.maxHealth}`);
      // an attack is a known move in a known phase
      if (u.state === 'attack' && (!sim.FRAME_DATA[u.move] || !PHASES.has(u.phase))) return bad('attack', `move ${u.move} phase ${u.phase}`);
      // grabs: held only while grabbed, by a unit on the floor that's holding him (in its throw, frozen for the hold)
      // or was knocked out of it this hold (horde: a second goon hits the hero mid-grab; the victim drops when grabT runs out)
      if (u.state === 'grabbed') {
        const g = units[u.grabbedBy];
        if (!g || g === u) return bad('grab', `grabbedBy ${u.grabbedBy}`);
        if (g.hidden) return bad('grab', `held by unit ${g.id}, which is hidden`);
        const holding = g.state === 'attack' && g.hitstop > 0, knocked = g.state === 'hitstun' || g.state === 'knockdown' || g.state === 'ko' || g.state === 'blockstun';
        if (!holding && !knocked) return bad('grab', `held by unit ${g.id}, which is in ${g.state}${g.move ? ' ' + g.move : ''}, hitstop ${g.hitstop}`);
      }
      // glide: a strike's travel or step-in belongs to the strike; the launcher's follow-through (no `from`) rides on into
      // idle, walk or run after a launch cancel (src/combat/sim.js STATE_OWNS)
      if (u.glide && u.state !== 'attack' && !(RIDE_STATES.has(u.state) && u.glide.from == null)) return bad('glide', `glide ${JSON.stringify(u.glide)} in ${u.state}`);
      // every transient flag is at rest outside the states that own it
      for (const k in owners) if (!owners[k].has(u.state) && !same(u[k], rest[k])) return bad('flag', `${k} = ${JSON.stringify(u[k])} outside ${[...owners[k]].join('/')}`);
    }
    // the outcome: over exactly while the KO card or the WINS card is up; a horde run only ever ends with the hero down
    const r = sim.result;
    if (r) {
      const showing = sim.phase === 'ko' || sim.phase === 'match';
      if (!!r.over !== showing) return { rule: 'result', unit: -1, state: sim.phase, detail: `result.over ${r.over} in phase ${sim.phase}` };
      if (r.over && sim.horde && r.reason !== 'heroDown') return { rule: 'hordeReason', unit: -1, state: sim.phase, detail: `horde ended with reason '${r.reason}'` };
      if (r.over && !sim.horde && r.reason !== 'ko' && r.reason !== 'time') return { rule: 'reason', unit: -1, state: sim.phase, detail: `reason '${r.reason}'` };
    }
    return null;
  };
}
