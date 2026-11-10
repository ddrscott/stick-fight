// The sim's whole state as text, for a resync: the host sends the guest its confirmed snapshot
// (sim.saveState, src/combat/snapshot.js) and the guest loads it in place of its own (src/net/rollback.js).
//
// A snapshot holds plain values plus references the receiving machine already has: its own units and rigs,
// each unit's controller, the character definitions and the rig's clips (MOVE_DEFS, their keys and poses),
// which the rig compares by identity (`move === MOVE_DEFS.jump`). Those go over as references:
//   {"#U": i} unit i, {"#R": i} unit i's rig, {"#s": k} the k-th static object (characters, clips, frame data,
//   walked in the same order on both machines, since both run the same build), {"#r": k} the k-th object
//   already written in this text (shared objects stay shared). Numbers JSON can't carry exactly come as
//   {"#": "-0" | "NaN" | "Inf" | "-Inf" | "u"} (u: undefined). Everything else is written by value; JSON keeps
//   every finite double exactly.

import { MOVES, MOVE_DATA, RIG_KIT } from '../fighter/index.js';
import { FRAME_DATA } from '../combat/frameData.js';
import { roster } from '../characters/index.js';

/** @type {Map<object, number> | null} */ let statics = null;
/** @type {object[]} */ let staticList = [];
function staticTable() {
  if (statics) return statics;
  statics = new Map(); staticList = [];
  const walk = (o, d) => {
    if (!o || typeof o !== 'object' || statics.has(o) || d > 24) return;
    statics.set(o, staticList.length); staticList.push(o);
    if (Array.isArray(o)) { for (const v of o) walk(v, d + 1); return; }
    for (const k of Object.keys(o)) walk(o[k], d + 1);
  };
  for (const n of MOVES) walk(RIG_KIT.base(n), 0);
  walk(RIG_KIT, 0); walk(FRAME_DATA, 0); walk(MOVE_DATA, 0);
  for (const c of roster()) walk(c, 0);
  return statics;
}

/** the static object's number, or -1 (tests hash the clips by reference) */
export function staticId(o) { const st = staticTable(); return st.has(o) ? /** @type {number} */ (st.get(o)) : -1; }

/** the snapshot `s` (from sim.saveState) as a string */
export function encodeState(sim, s) {
  const st = staticTable();
  const units = new Map(sim.units.map((u, i) => [u, i])), rigs = new Map(sim.units.map((u, i) => [u.rig, i]));
  const seen = new Map();
  const enc = (v) => {
    if (typeof v === 'number') {
      if (Number.isFinite(v)) return Object.is(v, -0) ? { '#': '-0' } : v;
      return { '#': Number.isNaN(v) ? 'NaN' : v > 0 ? 'Inf' : '-Inf' };
    }
    if (v === undefined) return { '#': 'u' };
    if (typeof v === 'function') return { '#': 'f' };
    if (v === null || typeof v !== 'object') return v;
    if (units.has(v)) return { '#U': units.get(v) };
    if (rigs.has(v)) return { '#R': rigs.get(v) };
    if (st.has(v)) return { '#s': st.get(v) };
    if (seen.has(v)) return { '#r': seen.get(v) };
    seen.set(v, seen.size);
    if (Array.isArray(v)) return v.map(enc);
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw new Error(`state: can't send a ${proto && proto.constructor && proto.constructor.name}`);
    const o = {};
    for (const k of Object.keys(v)) o[k] = enc(v[k]);
    return o;
  };
  const top = { ...s, rng: null };   // the rng object stays the receiver's own (its state travels as rngState)
  return JSON.stringify(enc(top));
}

/** the string from encodeState, as a snapshot this machine's sim.loadState takes */
export function decodeState(sim, text) {
  staticTable();
  const list = [];
  const dec = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) { const a = []; list.push(a); for (const x of v) a.push(dec(x)); return a; }
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0][0] === '#') {
      const k = keys[0], x = v[k];
      if (k === '#') return x === '-0' ? -0 : x === 'NaN' ? NaN : x === 'Inf' ? Infinity : x === '-Inf' ? -Infinity : x === 'f' ? null : undefined;
      if (k === '#U') return sim.units[x];
      if (k === '#R') return sim.units[x] && sim.units[x].rig;
      if (k === '#s') { const o = staticList[x]; if (!o) throw new Error(`state: no static ${x}`); return o; }
      if (k === '#r') return list[x];
    }
    const o = {}; list.push(o);
    for (const k of keys) o[k] = dec(v[k]);
    return o;
  };
  const s = dec(JSON.parse(text));
  s.rng = sim.rng;
  // the controllers are this machine's (online: each reads this machine's netcode)
  if (s.vals) s.vals.forEach((v, i) => { const u = sim.units[i]; if (u && v) { v.controller = u.controller; v.kind = u.kind; v.rig = u.rig; } });
  return s;
}
