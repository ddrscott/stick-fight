// Page side of the floor logger (scripts/floorlog/run.mjs injects this into play/index.html).
// Every 60fps frame it takes each body as it will be drawn and measures how far the outer edge of any drawn
// joint (its position plus its drawn radius: the head's circle, a limb's width at that joint, the torso's) sits
// below the surface under it. Stages: the sim's own joints (rig), after the draw smoothing (smooth: the
// turnaround, the snap fade, the air catch-up), and as drawn (drawn: the life layer and the floor guard on top),
// plus the cloth's points, the horde's flying ragdolls and the pile of bodies. Surfaces come from the sim's own
// data: the floor the body stands on, a flight's real tread tops (arena.treadY), the main floor's slab outside the
// stairwells for a body falling through one.
/* global window */
(() => {
  const G = window.__game, sim = G.sim, arena = G.arena;
  const BASE = { headR: 15, limbW: 12, limbTip: 9, torsoW: 15, hipW: 11 };   // RIG in src/fighter/index.js
  const radCache = new WeakMap();
  let fit = null;   // the floor guard render() runs on the horde's flying ragdolls (absent before it existed)
  window.__floorlogReady = import('/src/fighter/ground.js').then(m => { fit = m.fitToGround; }).catch(() => {});
  function radii(rig) {
    let c = radCache.get(rig);
    if (c && c.body === rig.body && c.scale === rig.scale) return c.r;
    const b = rig.body || {}, R = {}; for (const k in BASE) R[k] = typeof b[k] === 'number' ? b[k] : BASE[k];
    const s = rig.scale || 1, limb = R.limbW / 2 * s, mid = (R.limbW + R.limbTip) / 4 * s, tip = R.limbTip / 2 * s;
    const r = { head: R.headR * s, neck: R.torsoW / 2 * s, chest: (R.hipW + R.torsoW) / 4 * s, hip: Math.max(R.hipW, R.limbW) / 2 * s,
      lShoulder: limb, rShoulder: limb, lElbow: mid, rElbow: mid, lKnee: mid, rKnee: mid, lHand: tip, rHand: tip, lFoot: tip, rFoot: tip };
    radCache.set(rig, { body: rig.body, scale: rig.scale, r });
    return r;
  }
  const floors = () => sim.floors, stairs = () => sim.stairs || [], wells = () => sim.stairwells || [];
  // flight k's tread top under x, or null off the flight (its first tread's back edge to its foot)
  function tread(k, x) {
    const st = stairs()[k]; if (!st) return null;
    const a = Math.min(st.back0, st.foot), b = Math.max(st.back0, st.foot);
    if (x < a || x > b) return null;
    return arena.treadY(k, x);
  }
  const inWell = (x) => wells().some(w => x > w.x0 && x < w.x1);
  // the surfaces under x a body can rest on, by what it is doing
  function surfaces(ctx, x) {
    const out = [], fl = floors(), main = fl[0].y, low = fl[1] ? fl[1].y : main;
    if (ctx.kind === 'main') out.push(main);   // the main floor's walking strip runs behind the rails, over the holes
    else if (ctx.kind === 'flat') out.push(ctx.y);
    else {
      if (ctx.kind === 'fall' && !inWell(x)) out.push(main);
      for (let k = 0; k < stairs().length; k++) { const t = tread(k, x); if (t != null) out.push(t); }
      if (ctx.kind === 'stair') { const st = stairs()[ctx.k]; if (st && (x - st.head) * st.dir < 0) out.push(st.top); }
      out.push(low);
    }
    return out;
  }
  // the surface a joint centred at y belongs to: the topmost one at or under it (a centre sunk up to 40px still counts)
  function surfaceUnder(ctx, x, y) {
    let best = null;
    for (const s of surfaces(ctx, x)) if (s >= y - 40 && (best == null || s < best)) best = s;
    return best;
  }
  function ctxOf(u) {
    const S = stairs();
    if (u.falling || u.state === 'vault') return { kind: 'fall' };   // through a stairwell: no main floor over the hole
    if (u.rag) {
      if (u.rig.slopes || (u.rig.treads && u.rig.treads.length)) return { kind: 'low' };
      return Math.abs(u.ragFloor - floors()[0].y) < 1 ? { kind: 'main' } : { kind: 'flat', y: u.ragFloor };
    }
    if (u.stair != null && u.stair >= 0 && S[u.stair]) return { kind: 'stair', k: u.stair };
    if ((u.floor || 0) === 0) return { kind: 'main' };
    return { kind: 'low' };
  }
  // deepest drawn edge below its surface over a joint set, offset by (ox, oy)
  function depth(ctx, J, rad, ox, oy, defR) {
    let worst = -Infinity, at = null, where = null;
    for (const k in J) {
      const p = J[k]; if (!p || !(p.x === p.x)) continue;
      const r = rad ? (rad[k] != null ? rad[k] : defR) : defR, x = p.x + ox, y = p.y + oy;
      const s = surfaceUnder(ctx, x, y); if (s == null) continue;
      const d = y + r - s;
      if (d > worst) { worst = d; at = k; where = { x: +x.toFixed(1), y: +y.toFixed(1), r: +r.toFixed(1), s }; }
    }
    return { d: worst, at, where };
  }

  let label = '', frameN = 0, rows = null;
  const keyOf = (u) => `${u.state}/${u.rig.current && u.rig.current.move}`;
  const TH = [1, 3, 6, 10];
  function bump(tab, key, d) {
    let e = tab[key]; if (!e) e = tab[key] = { n: 0, over: [0, 0, 0, 0], max: 0 };
    e.n++; for (let i = 0; i < TH.length; i++) if (d > TH[i]) e.over[i]++;
    if (d > e.max) e.max = d;
  }
  function reset() { rows = { frames: 0, stages: {}, byKey: {}, byCtx: {}, byKeyCtx: {}, worst: [], pile: {}, ragdolls: {} }; }
  reset();
  function note(stage, key, d) { bump(rows.stages, stage, d); if (stage === 'drawn') bump(rows.byKey, key, d); }
  function offender(o) {
    const K = rows.worstByKey || (rows.worstByKey = {});
    if (!K[o.key] || o.d > K[o.key].d) K[o.key] = o;
    const W = rows.worst;
    if (W.length < 40 || o.d > W[W.length - 1].d) { W.push(o); W.sort((a, b) => b.d - a.d); if (W.length > 40) W.length = 40; }
  }

  function frame(figs) {
    rows.frames++; frameN++;
    for (const u of sim.units) {
      if (u.hidden || !u.rig || !u.rig.joints || !u.rig.joints.head) continue;
      const ctx = ctxOf(u), rad = radii(u.rig), key = keyOf(u);
      const rig = depth(ctx, u.rig.joints, rad, 0, 0, 6);
      note('rig', key, rig.d);
      const ds = G.drawn(u);   // after frameDraw: the turnaround, the snap fade, the catch-up offset
      const sm = ds ? depth(ctx, ds.all, rad, 0, 0, 6) : rig;
      note('smooth', key, sm.d);
      const f = figs && figs.get(u);
      const dr = f ? depth(ctx, f.joints, rad, f.off.x, f.off.y, 6) : sm;
      note('drawn', key, dr.d);
      bump(rows.byCtx, 'rig ' + ctx.kind, rig.d); bump(rows.byCtx, 'drawn ' + ctx.kind, dr.d);
      bump(rows.byKeyCtx, ctx.kind + ' ' + key, dr.d); bump(rows.byKeyCtx, 'rig:' + ctx.kind + ' ' + key, rig.d);
      let cl = { d: -Infinity, at: null };
      if (u.rig.cloth && f) for (const P of u.rig.cloth) {
        if (!P) continue;
        const o = {}; P.forEach((p, i) => { o['c' + i] = p; });
        const c = depth(ctx, o, null, f.off.x, f.off.y, 1.5 * (u.rig.scale || 1));
        if (c.d > cl.d) cl = c;
      }
      if (cl.at) note('cloth', key, cl.d);
      if (cl.at) bump(rows.byKeyCtx, 'cloth:' + ctx.kind + ' ' + key, cl.d);
      const d = Math.max(dr.d, cl.d, rig.d);   // the worst lists keep the sim's own dips too (the drawing may already hide them)
      if (d > 1) offender({ d: +d.toFixed(2), scene: label, frame: frameN, unit: u.id, char: u.char && u.char.id, key, joint: rig.d > dr.d && rig.d > cl.d ? 'rig:' + rig.at : dr.d >= cl.d ? dr.at : 'cloth:' + cl.at,
        rig: +rig.d.toFixed(2), smooth: +sm.d.toFixed(2), drawn: +dr.d.toFixed(2), cloth: cl.at ? +cl.d.toFixed(2) : null, ctx: ctx.kind, juggle: !!u.juggle, grounded: !!u.grounded,
        where: dr.d >= rig.d ? dr.where : rig.where, ux: +u.x.toFixed(1), uy: +u.y.toFixed(1), stair: u.stair, floor: u.floor, hip: { x: +u.rig.joints.hip.x.toFixed(1), y: +u.rig.joints.hip.y.toFixed(1) } });
    }
    // the horde's ragdolls in flight, drawn as joints offset from (r.x, r.y)
    for (const r of sim.ragdolls || []) {
      const J = {}; for (const k in r.joints) J[k] = { x: r.x + r.joints[k].x, y: r.y + r.joints[k].y };
      const rad = {}; for (const k in J) rad[k] = k === 'head' ? r.radius : 2.5;
      // as drawn: render() puts each in-flight goon through the floor guard
      const D = fit ? fit(J, rad, () => r.floorY, { side: r.facing }) : J;
      const dd = depth({ kind: 'flat', y: r.floorY }, D, rad, 0, 0, 2.5);
      bump(rows.ragdolls, 'flying', dd.d);
      if (dd.d > 1) offender({ d: +dd.d.toFixed(2), scene: label, frame: frameN, unit: 'ragdoll', key: 'ragdoll/flying', joint: dd.at });
    }
    // the pile: each body's tween (drawBodies' easeOut), the rim pass one px wider
    for (const b of arena.bodies || []) {
      const k = 1 - Math.pow(1 - b.t, 3), J = {};
      for (const n in b.to) J[n] = { x: b.from[n].x + (b.to[n].x - b.from[n].x) * k, y: b.from[n].y + (b.to[n].y - b.from[n].y) * k };
      const rad = {}; for (const n in J) rad[n] = n === 'head' ? b.radius + 1 : b.lineWidth / 2 + 1;
      const ctx = b.stair != null && b.stair >= 0 ? { kind: 'stair', k: b.stair } : { kind: 'flat', y: b.floor ? b.floor.y : floors()[0].y };
      const dd = depth(ctx, J, rad, 0, 0, 3.5);
      bump(rows.pile, b.t < 1 ? 'settling' : 'lying', dd.d);
      if (dd.d > 1) offender({ d: +dd.d.toFixed(2), scene: label, frame: frameN, unit: 'pile', key: b.t < 1 ? 'pile/settling' : 'pile/lying', joint: dd.at });
    }
  }
  window.__floorlog = {
    begin(l) { label = l; frameN = 0; },
    step(ms) { G.stepPosed(ms, frame); },
    // the surface under x for unit u at its hip's level (the strip tool draws it)
    surfaceAt(u, x) { const ref = u.rig.joints.hip ? u.rig.joints.hip.y : u.y; return surfaceUnder(ctxOf(u), x, ref + 20); },
    report() { const r = rows; r.worstByKey = Object.values(r.worstByKey || {}); reset(); return r; },
  };
})();
