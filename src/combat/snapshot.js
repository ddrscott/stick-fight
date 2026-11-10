// Save and restore the whole sim, for online rollback (src/net/rollback.js). A snapshot holds
// everything that feeds the next sim.tick(): the sim's own fields (phase, timers, rounds, the rng),
// every unit (all of its fields, by value), both rigs (their closure state, via rig.getState), the
// reach table the sim learns from hits, the horde and its ragdolls, and the arena state tick()
// mutates (its clock, door swings, and the body pile). Restoring writes into the same unit and rig
// objects, so anything holding a reference to them (events, the HUD, the camera) stays valid.
//
//   const s = saveSim(sim, arena, reuse?)   reuse: an older snapshot to overwrite (no garbage)
//   loadSim(sim, arena, s)                  a snapshot can be loaded any number of times
//
// The measurement log (sim.log) is copied by reference per entry (entries never change). Not part of
// a snapshot: what the controllers keep (the scene sets them; online they read the netcode's
// inputs) and everything outside the sim (particles, lights, camera, sound).

const SIM_SCALARS = ['phase', 'phaseTimer', 'stepCount', 'round', 'timer', 'winner', 'banner', 'bannerT', 'difficulty', 'botchOn',
  'accumulator', 'hitstopActive', 'koSlow', 'finisher', 'startHealth', 'introTime', 'seed', 'floor', 'floorBroken', 'combo', 'hordeCfg',
  'roundTime', 'winsNeeded', 'roundClock'];

function copyPoints(src, dst) {
  if (!src) return null;
  dst = dst || {};
  for (const k in src) { const p = dst[k] || (dst[k] = { x: 0, y: 0 }); p.x = src[k].x; p.y = src[k].y; }
  return dst;
}
const clone = (v) => (v == null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v)));

// The reach table (~190 entries) changes a few times a match, but copying it was half of every save. It carries
// a version (__v, not enumerable, so hashes, keys and copies never see it) that touchReach() sets from one
// sequence each time a value really changes; every snapshot of the same version shares one frozen copy.
// Versions are never reused, so after a load puts an older one back, the next change gets a new number.
let reachSeq = 0;
const reachCopies = new WeakMap();
const snapReach = new WeakMap();   // snapshot -> the reach version it holds (kept off the snapshot, so its content alone is the state)
/** the reach table changed: give it a new version @param {any} reach */
export function touchReach(reach) {
  if (!Object.prototype.hasOwnProperty.call(reach, '__v')) Object.defineProperty(reach, '__v', { value: 0, writable: true, enumerable: false });
  reach.__v = ++reachSeq;
}

/** @param {any} sim @param {any} arena @param {any} [into] */
export function saveSim(sim, arena, into) {
  const s = into || { units: [], vals: [], rigs: [], prev: [] };
  for (const k of SIM_SCALARS) s[k] = sim[k];
  s.wins0 = sim.wins[0]; s.wins1 = sim.wins[1];
  s.card = sim.card ? { text: sim.card.text, t: sim.card.t } : null;
  s.lastCombo = sim.lastCombo ? { ...sim.lastCombo } : null;
  s.callouts = sim.callouts.map((c) => ({ ...c }));
  s.horde = sim.horde ? clone(sim.horde) : null;
  s.ragdolls = sim.ragdolls.length ? sim.ragdolls.map((r) => ({ ...r })) : null;
  s.log = sim.log.slice();
  const rs = sim.reachSeen;
  if (!(rs.__v > 0)) touchReach(rs);
  let rc = reachCopies.get(rs);
  if (!rc || rc.v !== rs.__v) { rc = { v: rs.__v, obj: Object.freeze({ ...rs }) }; reachCopies.set(rs, rc); }
  s.reach = rc.obj; snapReach.set(s, rc.v);
  s.bx0 = sim.bounds.x0; s.bx1 = sim.bounds.x1;
  s.rng = sim.rng; s.rngState = sim.rng.state;
  // units: every field by value (prevJoints is mutated in place by the sim, so its points are copied)
  const n = sim.units.length;
  s.units.length = n; s.vals.length = n; s.rigs.length = n; s.prev.length = n;
  for (let i = 0; i < n; i++) {
    const u = sim.units[i];
    s.units[i] = u;
    const v = s.vals[i] || (s.vals[i] = {});
    for (const k in v) if (!(k in u)) delete v[k];
    for (const k in u) v[k] = u[k];
    s.prev[i] = copyPoints(u.prevJoints, s.prev[i]);
    s.rigs[i] = u.rig.getState(s.rigs[i]);
  }
  // the arena: its clock, door swings, and how much of the pile exists (and how settled each body is)
  s.aTime = arena.time;
  s.doors = {};
  for (const k in arena.doorState) s.doors[k] = { t: arena.doorState[k].t, dur: arena.doorState[k].dur };
  s.bodies = arena.bodies ? arena.bodies.slice() : null;
  s.bodyT = arena.bodies ? arena.bodies.map((b) => b.t) : null;
  s.bodyAge = arena.bodies ? arena.bodies.map((b) => b.age || 0) : null;
  return s;
}

/** @param {any} sim @param {any} arena @param {any} s */
export function loadSim(sim, arena, s) {
  for (const k of SIM_SCALARS) sim[k] = s[k];
  sim.wins[0] = s.wins0; sim.wins[1] = s.wins1;
  sim.card = s.card ? { text: s.card.text, t: s.card.t } : null;
  sim.lastCombo = s.lastCombo ? { ...s.lastCombo } : null;
  sim.callouts.length = 0; for (const c of s.callouts) sim.callouts.push({ ...c });
  sim.horde = s.horde ? clone(s.horde) : null;
  sim.ragdolls.length = 0; if (s.ragdolls) for (const r of s.ragdolls) sim.ragdolls.push({ ...r });
  sim.log.length = 0; for (const e of s.log) sim.log.push(e);
  const reach = sim.reachSeen;
  const sv = snapReach.get(s);
  if (!(sv > 0) || reach.__v !== sv) {
    for (const k in reach) if (!(k in s.reach)) delete reach[k];
    Object.assign(reach, s.reach);
    if (sv > 0) { reach.__v = sv; reachCopies.set(reach, { v: sv, obj: s.reach }); }
    else touchReach(reach);   // a state from elsewhere (a resync's text): a version of its own
  }
  sim.bounds.x0 = s.bx0; sim.bounds.x1 = s.bx1;
  sim.rng = s.rng; sim.rng.state = s.rngState;
  const n = s.units.length;
  sim.units.length = n;
  for (let i = 0; i < n; i++) {
    const u = s.units[i], v = s.vals[i];
    sim.units[i] = u;
    for (const k in u) if (!(k in v)) u[k] = undefined;   // fields set after the save read as unset (no delete: keeps the unit's shape)
    for (const k in v) u[k] = v[k];
    u.prevJoints = s.prev[i] ? copyPoints(s.prev[i], u.prevJoints && u.prevJoints !== s.prev[i] ? u.prevJoints : {}) : null;
    u.rig.setState(s.rigs[i]);
  }
  arena.time = s.aTime;
  for (const k in arena.doorState) delete arena.doorState[k];
  for (const k in s.doors) arena.doorState[k] = { t: s.doors[k].t, dur: s.doors[k].dur };
  if (s.bodies) {
    arena.bodies.length = 0;
    for (let i = 0; i < s.bodies.length; i++) { const b = s.bodies[i]; b.t = s.bodyT[i]; b.age = s.bodyAge ? s.bodyAge[i] : 0; arena.bodies.push(b); }
  }
}
