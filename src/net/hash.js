// State hashing for netplay: both peers hash the sim every few steps and compare. The hash
// covers what decides the fight (positions, velocities, states, health, stamina, timers), every
// rig joint, since the joints feed the hitboxes, the rng's state, and the reach table the sim
// steps strings in by (src/combat/sim.js reachOf; its keys are hashed in any order, since two
// machines learn them in different orders). Floats are hashed by their exact bits, so a
// difference in the last bit shows up.

const UNIT_FIELDS = [
  'x', 'y', 'vx', 'vy', 'facing', 'grounded', 'state', 'move', 'phase', 'health', 'stamina', 'faint',
  'hitstop', 'stun', 'downTimer', 'combo', 'floor', 'stair', 'attackId', 'hidden', 'rag', 'falling', 'airHits',
];

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

function mix(h, v) {
  h ^= v;
  return Math.imul(h, 0x01000193) >>> 0;
}
function mixValue(h, v) {
  if (typeof v === 'number') { f64[0] = v; return mix(mix(h, u32[0]), u32[1]); }
  if (typeof v === 'boolean') return mix(h, v ? 0x9e3779b1 : 0x7f4a7c15);
  if (v == null) return mix(h, 0x1234567);
  const s = String(v);
  for (let i = 0; i < s.length; i++) h = mix(h, s.charCodeAt(i));
  return mix(h, s.length);
}

// the reach table's entries the fight reads: TEMP's (no prefix) and the two fighters' ('id:move'). Each machine
// also keeps the measurements of every character it has shown in its demo, which no fight here reads.
function reachKeys(sim) {
  const ids = new Set(sim.units.map((u) => u.char && u.char.id));
  return Object.keys(sim.reachSeen || {}).filter((k) => { const i = k.indexOf(':'); return i < 0 || ids.has(k.slice(0, i)); });
}
// whatever order the keys went in: each entry hashed alone, the results summed
function reachHash(sim) {
  let sum = 0;
  for (const k of reachKeys(sim)) sum = (sum + mixValue(mixValue(0x811c9dc5, k), sim.reachSeen[k])) >>> 0;
  return sum;
}

/** A 32-bit FNV-1a style hash of the sim state, as 8 hex digits. */
export function hashSim(sim) {
  let h = 0x811c9dc5;
  for (const v of [sim.stepCount, sim.phase, sim.round, sim.timer, sim.phaseTimer, sim.wins[0], sim.wins[1], sim.floor, sim.floorBroken, sim.koSlow, sim.roundClock, sim.roundTime, sim.winsNeeded]) h = mixValue(h, v);
  h = mix(h, sim.rng ? sim.rng.state >>> 0 : 0);
  h = mix(h, reachHash(sim));
  for (const u of sim.units) {
    for (const k of UNIT_FIELDS) h = mixValue(h, u[k]);
    const j = u.rig.joints;
    for (const name in j) { h = mixValue(h, j[name].x); h = mixValue(h, j[name].y); }
    h = mixValue(h, u.rig.current && u.rig.current.t);
  }
  return h.toString(16).padStart(8, '0');
}

/** The same values as hashSim, by name, for logging what differed after a mismatch. Floats are
 *  written with full precision (and their bit pattern), so a last-bit difference is visible. */
export function dumpSim(sim) {
  const out = {};
  const put = (k, v) => {
    if (typeof v === 'number') { f64[0] = v; out[k] = `${v} (${u32[1].toString(16)}${u32[0].toString(16).padStart(8, '0')})`; }
    else out[k] = String(v);
  };
  put('stepCount', sim.stepCount); put('phase', sim.phase); put('round', sim.round); put('timer', sim.timer);
  put('phaseTimer', sim.phaseTimer); put('wins', sim.wins.join('-')); put('floor', sim.floor); put('koSlow', sim.koSlow); put('roundClock', sim.roundClock); put('rules', `${sim.roundTime}s/${sim.winsNeeded}`);
  put('rng', sim.rng ? sim.rng.state >>> 0 : 0);
  for (const k of reachKeys(sim).sort()) put(`reach.${k}`, sim.reachSeen[k]);
  sim.units.forEach((u, i) => {
    for (const k of UNIT_FIELDS) put(`u${i}.${k}`, u[k]);
    const j = u.rig.joints;
    for (const name in j) { put(`u${i}.j.${name}.x`, j[name].x); put(`u${i}.j.${name}.y`, j[name].y); }
    put(`u${i}.rig.t`, u.rig.current && u.rig.current.t);
  });
  return out;
}

/** The fields that differ between two dumps (at most `max`). */
export function diffDumps(a, b, max = 20) {
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[k] !== b[k]) out.push(`${k}: ${a[k]} vs ${b[k]}`);
    if (out.length >= max) break;
  }
  return out;
}
