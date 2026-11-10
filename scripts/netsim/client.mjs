// One phone: its own arena, rigs and sim, the real online session (src/net/online.js, which runs the real
// rollback netcode and codec), the frame loop main.js runs (advance with the KO slow-motion, then the draw:
// the life layer's joints swapped onto the rig, drawn, swapped back), the attract demo it shows before the
// match, and a CPU standing in for the player's thumbs. The CPU only reads the sim; what it presses goes in
// as this side's input through net.setLocalSource, exactly like the touch controls' snapshot.

import { sched, at, nullCtx } from './env.mjs';
import { createFighter, MOVES, MOVE_DATA } from '../../src/fighter/index.js';
import { createLife } from '../../src/fighter/life.js';
import { createArena } from '../../src/arena/index.js';
import { createCombat } from '../../src/combat/sim.js';
import { EMPTY_INPUT } from '../../src/combat/input.js';
import { FRAME_DATA } from '../../src/combat/frameData.js';
import { createAI } from '../../src/combat/ai.js';
import { mulberry32 } from '../../src/combat/rng.js';
import { roster } from '../../src/characters/index.js';
import { createOnline } from '../../src/net/online.js';
import { staticId } from '../../src/net/state.js';

const AI_FIELDS = ['aaJump', 'grabId', 'rollId'];

/**
 * @param {{ name: string, seed: number, network: any, frames: { fps?: number, uneven?: boolean }, rules: { roundTime: number, winsNeeded: number }, drawCheck?: boolean,
 *   inject?: { every: number, atEnd?: boolean } | null }} o
 *   inject: knock this phone's sim off by a hair now and then (a stand-in for a nondeterminism bug), and with
 *   atEnd also on the frame the match result shows, so the resync and the end-of-match agreement get exercised
 */
export function createClient({ name, seed, network, frames, rules, drawCheck = false, inject = null }) {
  const rng = mulberry32(seed);
  const arena = createArena('building');
  const sp = arena.spawns;
  const fighters = [createFighter({ color: '#f0f0f0', x: sp[0].x, y: sp[0].y, facing: sp[0].facing }), createFighter({ color: '#E85D00', x: sp[1].x, y: sp[1].y, facing: sp[1].facing })];
  const input = { snapshot: () => EMPTY_INPUT, swallowHeld() {} };
  /** @type {any} */ let sim = null;
  const makeRig = (color) => { const g = sim.units[0]; return createFighter({ color, x: g.x, y: g.y, facing: -1 }); };
  sim = createCombat({ fighters, arena, input, onEvent: () => {}, makeRig, moves: MOVES, moveData: MOVE_DATA });
  const life = createLife(); life.setFrameData(FRAME_DATA);
  let lifeStep = -1;

  const client = {
    name, sim, arena, frozenUntil: 0, hiddenUntil: 0,
    /** @type {any} */ net: null,
    ended: /** @type {string|null} */ (null), endedAt: 0,
    results: /** @type {Record<number, { winner: number, wins: number[], hash: string, frame: number }>} */ ({}),
    confirmed: new Map(),          // `${match}:${frame}` -> hash, every confirmed hash frame
    desyncs: /** @type {any[]} */ ([]),
    resyncs: 0,
    drawLeaks: 0, drawChecks: 0, injected: 0,
    frames: 0, maxFrameMs: 0,
    demoRunning: false,
  };

  // ---- the attract demo behind the menus (different on each phone: its own seed and its own pairs) ----
  function demo() {
    const r = roster(), a = r[Math.floor(rng() * r.length)], b = r[Math.floor(rng() * r.length)];
    sim.setCharacters([a.id, b.id]);
    sim.setAI(0, 1.0, { style: 'showcase' }); sim.setAI(1, 1.0, { style: 'showcase' });
    arena.clearBodies();
    sim.resetMatch({ seed: Math.floor(rng() * 4294967296) >>> 0, introTime: 1.2 });
    sim.roundTime = 99; sim.winsNeeded = 2;
    client.demoRunning = true;
  }

  // ---- the player's thumbs: a CPU reading this phone's sim ----
  let ai = null, shadow = {}, li = 0;
  function newThumbs(localIndex, n) {
    li = localIndex; shadow = {};
    const r = mulberry32((seed * 7919 + n * 104729) >>> 0);
    ai = createAI({ rng: r, difficulty: 0.75, reach: (m) => sim.reachOf(sim.units[li], m), style: null });
  }
  function thumbs() {
    const me = sim.units[li], opp = sim.units[1 - li];
    if (!ai || !me || !opp) return EMPTY_INPUT;
    const keep = {}; for (const k of AI_FIELDS) keep[k] = shadow[k];
    for (const k in shadow) if (!(k in me)) delete shadow[k];
    Object.assign(shadow, me);
    for (const k of AI_FIELDS) shadow[k] = keep[k];
    const rs = sim.rng.state, out = ai(shadow, opp, sim) || EMPTY_INPUT;
    if (sim.rng.state !== rs) { client.rngTouches = (client.rngTouches || 0) + 1; sim.rng.state = rs; }   // a CPU helper that rolls the sim's dice: not the player's to roll
    return out;
  }

  const game = {
    sim, input, stage: null,
    botchSetting: () => true,
    rulesSetting: () => rules,
    createRoom: () => network.createRoom(),
    createLink: (o) => network.createLink({ ...o, owner: client }),
    // main.js setScene('online', o) for an online match
    startMatch(o) {
      client.demoRunning = false;
      sim.setCharacters(o.chars);
      sim.botchOn = o.botch !== false;
      sim.roundTime = o.rules.roundTime; sim.winsNeeded = o.rules.winsNeeded;
      arena.clearBodies();
      sim.setController(0, 'net', o.lockstep.controller(0)); sim.setController(1, 'net', o.lockstep.controller(1));
      sim.resetMatch({ seed: o.seed >>> 0, fresh: true });
      life.reset();
    },
    // the flow's VERSUS ONLINE end screen, with the demo behind it
    endMatch(reason) { client.ended = reason; client.endedAt = sched.t; demo(); },
  };
  const net = createOnline(/** @type {any} */ (game));
  client.net = net;
  net.setLocalSource(() => thumbs());
  net.on('start', (e) => newThumbs(e.localIndex, e.n));
  net.on('desync', (d) => client.desyncs.push({ t: sched.t, n: net.match, ...d }));
  net.on('resync', () => { client.resyncs++; });
  net.on('match-over', (v) => { if (v && v.last) client.results[v.n] = { winner: v.last.winner, wins: v.last.wins, hash: v.last.hash, frame: v.last.frame }; });

  // ---- the frame loop (requestAnimationFrame) ----
  let last = 0;
  const interval = () => {
    if (frames.uneven) {
      const k = rng();
      return k < 0.06 ? 40 + rng() * 90 : k < 0.2 ? 8 + rng() * 6 : 14 + rng() * 10;   // a busy phone: hitches, doubled frames
    }
    const base = 1000 / (frames.fps || 60);
    return base * (0.97 + rng() * 0.06);
  };
  function frame() {
    const t = sched.t, ms = Math.min(100, t - last); last = t;
    client.frames++; client.maxFrameMs = Math.max(client.maxFrameMs, t - (client._prev || t)); client._prev = t;
    if (net.active) {
      const slow = sim.koSlow > 0 ? (sim.finisher ? 0.25 : 0.5) : 1;
      net.advance(ms * slow);
      record();
      if (inject && net.active) nudge();
    } else if (client.demoRunning) {
      sim.step(ms);
      if (sim.round > 1 || sim.phase === 'match') demo();
    }
    draw(ms);
    at(sched.t + interval(), frame, client, 'frame');
  }
  let nextNudge = inject ? sched.t + inject.every * (0.5 + rng()) : Infinity, endNudged = -1;
  function nudge() {
    const atEnd = inject.atEnd && sim.phase === 'match' && endNudged !== net.match;
    if (sched.t < nextNudge && !atEnd) return;
    if (net.netcode && net.netcode.frame >= net.netcode.endAt) return;   // a halted sim never changes by itself (it waits on the other side's word)
    if (atEnd) endNudged = net.match; else nextNudge = sched.t + inject.every * (0.5 + rng());
    const u = sim.units[Math.floor(rng() * sim.units.length)], k = rng();
    if (k < 0.5) u.x += 0.25 + rng(); else if (k < 0.8) u.stamina = Math.max(0, u.stamina - 3); else sim.rng.state = (sim.rng.state + 1) >>> 0;
    client.injected++;
  }
  // every confirmed hash frame this side has, for comparing the two sides afterwards
  function record() {
    const ls = net.netcode;
    if (!ls) return;
    const top = ls.confirmed, n = net.match;
    for (const [f, h] of ls.hashes) if (f <= top) client.confirmed.set(`${n}:${f}`, h);   // the latest (a resync re-hashes frames from its point on)
  }
  // main.js render(): the life layer's moved copy swapped onto the rig, drawn, swapped back. With drawCheck,
  // a deep hash of the whole sim before and after proves the draw never touches it.
  function draw(ms) {
    const lifeDt = sim.stepCount !== lifeStep ? Math.min(0.05, ms / 1000) : 0; lifeStep = sim.stepCount;
    const check = drawCheck && net.active && client.frames % 50 === 0;
    const before = check ? deepHash(sim) : '';
    for (const u of sim.units) {
      if (u.hidden) continue;
      const joints = life.apply(u, u.rig.joints, sim, lifeDt);
      const realJ = u.rig.joints; u.rig.joints = joints;
      u.rig.draw(nullCtx);
      u.rig.joints = realJ; u.rig.sway = null;
    }
    if (check) { client.drawChecks++; if (deepHash(sim) !== before) client.drawLeaks++; }
  }

  client.start = (t0) => { last = t0; demo(); at(t0, frame, client, 'frame'); };
  client.thumbs = thumbs;
  return client;
}

// ---- a deep hash of everything that feeds the next tick (sim.saveState, walked by value) -------------------
// Shared objects are hashed wherever they appear (a restore may share what the original kept apart), the clips
// and character definitions by reference (they never change), and the units' live references are skipped
// (their fields are in vals, their rigs in rigs).
const SKIP = new Set(['rig', 'controller', 'char', 'charDef', 'rng', 'units']);
export function deepHash(sim) {
  const s = sim.saveState();
  let h = 0x811c9dc5;
  const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
  const mix = (v) => { h ^= v; h = Math.imul(h, 0x01000193) >>> 0; };
  const stack = new Set();
  const walk = (v) => {
    if (typeof v === 'number') { f64[0] = v; mix(u32[0]); mix(u32[1]); return; }
    if (typeof v === 'string') { for (let i = 0; i < v.length; i++) mix(v.charCodeAt(i)); mix(v.length); return; }
    if (typeof v === 'boolean') { mix(v ? 1 : 2); return; }
    if (v === undefined) { mix(4); return; }
    if (v === null) { mix(3); return; }
    if (typeof v !== 'object') return;
    const sid = staticId(v);
    if (sid >= 0) { mix(0x5717c); mix(sid); return; }
    if (stack.has(v)) { mix(5); return; }
    stack.add(v);
    if (Array.isArray(v)) { mix(v.length); for (const x of v) walk(x); }
    else for (const k of Object.keys(v).sort()) { if (SKIP.has(k) || typeof v[k] === 'function' || v[k] === undefined) continue; walk(k); walk(v[k]); }   // unset reads the same as missing (a restore unsets fields set after the save)
    stack.delete(v);
  };
  walk(s);
  return h.toString(16);
}
