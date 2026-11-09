// The life layer (README, "The life layer"): what a puppeteer adds on top of the keyframes, drawn only.
// It reads the sim and the pose the rig produced this frame and returns a moved copy of the joints to draw;
// the sim, the rig's own state, the hitboxes and everything online play saves and hashes never see it.
// Its springs live here, keyed by unit, and step once per rendered frame on real time, so a rollback that
// re-runs sim steps never runs them twice. Three parts:
//   - eyeline: the head pitches toward what the fighter is watching (the other fighter's chest, the limb of
//     a strike winding up at them, a body on the floor), and nods toward the target as their own strike or
//     step starts (think, then move);
//   - springs: the head lags the neck, the hands trail a little, a hit sends a wave up the body (hips,
//     chest, shoulders, head), and a prop (src/characters/: `prop`) swings on its own spring;
//   - fatigue: under 40% stamina the shoulders heave with a faster, deeper breath, the guard sags and the
//     head drops; the faint keeps its own dizzy clip.
// ?life=0 turns it off (for A/B); window.__game.life.on does the same live.

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

let on = true;
try { if (new URLSearchParams(location.search).get('life') === '0') on = false; } catch { /* no location */ }

// how much of each part a state gets (the clips' own head keys stay in charge of the big moves)
const EYE_W = { idle: 1, walk: 1, run: 0.6, block: 1, blockstun: 0.8, crouch: 1, landing: 0.7, jump: 0.5, attack: 0.45 };
const CALM = new Set(['idle', 'walk', 'block', 'crouch', 'blockstun', 'landing']);
const RAW = (u) => u.rag || u.falling || u.state === 'grabbed' || u.state === 'splat' || u.state === 'vault' || u.state === 'thrown' ||
  ((u.state === 'knockdown' || u.state === 'ko') && !u.grounded);
const UPPER = ['chest', 'neck', 'head', 'lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lHand', 'rHand'];
const WAVE = [   // a hit's wave up the body: joint, delay (ms), share of the amplitude
  ['hip', 0, 0.45], ['lKnee', 0, 0.2], ['rKnee', 0, 0.2], ['chest', 30, 0.75],
  ['neck', 55, 1], ['lShoulder', 55, 1], ['rShoulder', 55, 1], ['lElbow', 65, 0.9], ['rElbow', 65, 0.9], ['lHand', 75, 0.8], ['rHand', 75, 0.8], ['head', 90, 1.25],
];
const WAVE_MS = 150, ZERO = { x: 0, y: 0 };

// a follower point on a spring: x'' = w^2 (target - x) + 2 z w (target' - x'), stepped at a fixed 240Hz so any frame
// rate looks the same. Damping against the target's own velocity means a steady walk leaves no lag: only a change
// of speed (a step starting, a strike, a stop) swings it.
function follow(s, tx, ty, dt, w, z) {
  if (!s.init || Math.abs(tx - s.x) + Math.abs(ty - s.y) > 120) {   // first frame, or a respawn or reset: no swing across the room
    s.x = tx; s.y = ty; s.vx = s.vy = 0; s.tx = tx; s.ty = ty; s.init = true; return;
  }
  if (dt <= 0) return;
  let tvx = (tx - s.tx) / dt, tvy = (ty - s.ty) / dt;
  s.tx = tx; s.ty = ty;
  const sp = Math.hypot(tvx, tvy);
  if (sp > 2500) { tvx *= 2500 / sp; tvy *= 2500 / sp; }
  const h = 1 / 240;
  for (let t = dt; t > 1e-6; t -= h) {
    const d = Math.min(h, t);
    s.vx += (w * w * (tx - s.x) + 2 * z * w * (tvx - s.vx)) * d; s.vy += (w * w * (ty - s.y) + 2 * z * w * (tvy - s.vy)) * d;
    s.x += s.vx * d; s.y += s.vy * d;
  }
}
// the eased value toward a target, frame-rate independent (tau in seconds)
const ease = (v, target, dt, tau) => v + (target - v) * (1 - Math.exp(-dt / tau));

export function createLife() {
  const st = new Map();
  function stateOf(u) {
    let s = st.get(u);
    if (!s) {
      s = { head: {}, lHand: {}, rHand: {}, prop: {}, look: { a: 0, v: 0 }, eyeW: 0, lead: 0, fat: 0, breath: 0, calm: 0,
        move: null, state: u.state, health: u.health, wave: null, pendingWave: null };
      st.set(u, s);
    }
    return s;
  }

  // what this fighter is watching: the other fighter's chest, the limb of a strike winding up, a body on the floor
  function focusOf(u, opp) {
    const J = opp.rig && opp.rig.joints;
    if (!J || !J.hip) return null;
    if (opp.state === 'attack' && opp.phase === 'startup' && opp.move) {
      const jn = jointOf(opp);
      if (jn && J[jn]) return J[jn];
    }
    if (opp.state === 'down' || opp.state === 'roll' || opp.state === 'ko' || (opp.state === 'knockdown' && opp.grounded)) return J.hip;
    return { x: (J.chest.x + J.neck.x) / 2, y: (J.chest.y + J.neck.y) / 2 };
  }
  let FD = null;   // FRAME_DATA, handed over by main.js (the striking joint of a move)
  const jointOf = (o) => { const fd = FD && FD[o.move]; return fd ? fd.joint || (fd.limb === 'foot' ? 'rFoot' : fd.limb === 'hand' ? 'rHand' : null) : null; };

  // the nearest other fighter on screen
  function oppOf(u, sim) {
    let best = null, bd = Infinity;
    for (const o of sim.units) {
      if (o === u || o.hidden || !o.rig) continue;
      const d = Math.abs(o.x - u.x);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  /**
   * The joints to draw this frame: J (the pose after the draw smoothing) with the life layer on top.
   * Never mutates J. dt in seconds of real time (0 while paused or frozen in a hit).
   */
  function apply(u, J, sim, dt) {
    const s = stateOf(u);
    // what happened since the last frame (read only)
    const hurt = u.health < s.health - 0.01;
    if (hurt) {
      const opp = oppOf(u, sim);
      const dir = opp ? Math.sign(u.x - opp.x) || -u.facing : -u.facing;
      s.pendingWave = { dir, amp: clamp(3.5 + (s.health - u.health) * 0.35, 3.5, 8) };
    }
    s.health = u.health;
    const own = u.state === 'attack' && u.phase === 'startup' && u.move !== s.move;
    const step = u.state === 'walk' && s.state !== 'walk';
    if (own) s.lead = 1; else if (step) s.lead = Math.max(s.lead, 0.45);
    s.move = u.state === 'attack' ? u.move : null; s.state = u.state;

    const sc = (u.rig && u.rig.scale) || 1;
    // the prop's spring runs whatever happens, so it's never stale when the body comes back
    const raw = RAW(u);
    if (!on) { u.rig.sway = null; return J; }
    if (raw || !J.head || !J.neck) { s.head.init = s.lHand.init = s.rHand.init = false; s.wave = null; s.pendingWave = null; propStep(u, s, J, dt, sc); return J; }
    if (s.pendingWave && !(u.hitstop > 0)) { s.wave = { ...s.pendingWave, t: 0 }; s.pendingWave = null; }

    const off = {};
    const add = (k, x, y) => { const o = off[k] || (off[k] = { x: 0, y: 0 }); o.x += x; o.y += y; };
    const f = u.facing || 1;

    // ---- fatigue: a deeper, faster breath and a sagging guard under 40% stamina
    const frac = u.staminaMax ? u.stamina / u.staminaMax : 1;
    const tired = u.faint > 0 ? 0 : clamp((0.4 - frac) / 0.3, 0, 1);
    s.fat = ease(s.fat, tired, dt, tired > s.fat ? 0.25 : 0.6);
    s.calm = ease(s.calm, CALM.has(u.state) ? 1 : 0, dt, 0.08);
    s.breath += dt * (1.6 + 1.6 * s.fat) * Math.PI * 2;   // 1.6 breaths a second, 3.2 at the bottom of the bar
    if (s.breath > 1e4) s.breath -= 1e4;
    const fw = s.fat * s.calm;
    if (fw > 0.01) {
      const heave = (Math.sin(s.breath) * 0.5 + 0.5) * 4.5 * sc * fw;   // the shoulders rise on the inhale
      for (const k of UPPER) add(k, 0, -heave * (k === 'chest' ? 0.4 : 1));
      // a slump: the shoulders round forward, the guard sags toward the belt, the head hangs
      for (const k of ['neck', 'head', 'lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lHand', 'rHand']) add(k, f * 2 * sc * fw, 1.5 * sc * fw);
      add('lHand', 0, 9 * sc * fw); add('rHand', 0, 9 * sc * fw); add('lElbow', 0, 4 * sc * fw); add('rElbow', 0, 4 * sc * fw);
      add('head', f * 1.5 * sc * fw, 3.5 * sc * fw);
    }

    // ---- the hit wave: hips first, the head last
    if (s.wave) {
      s.wave.t += dt * 1000;
      for (const [k, d, share] of WAVE) {
        const tau = s.wave.t - d;
        if (tau <= 0 || tau >= WAVE_MS) continue;
        const e = Math.sin(Math.PI * tau / WAVE_MS) * (1 - tau / WAVE_MS);
        add(k, s.wave.dir * s.wave.amp * share * e * sc, -0.25 * s.wave.amp * share * e * sc);
      }
      if (s.wave.t > WAVE_MS + 100) s.wave = null;
    }

    // the moved joints so far
    const M = {};
    for (const k in J) { const o = off[k]; M[k] = o ? { x: J[k].x + o.x, y: J[k].y + o.y } : J[k]; }

    // ---- springs: the head lags the neck, the hands trail (not while a strike is out or in a hit's freeze)
    const neckX = M.neck.x, neckY = M.neck.y;
    const frozen = u.hitstop > 0 || sim.hitstopActive > 0;
    if (!frozen) {
      follow(s.head, neckX, neckY, dt, 2 * Math.PI * 3.2, 0.45);
      follow(s.lHand, M.lHand.x, M.lHand.y, dt, 2 * Math.PI * 6, 0.7);
      follow(s.rHand, M.rHand.x, M.rHand.y, dt, 2 * Math.PI * 6, 0.7);
    }
    const lag = (sp, x, y, max) => { const dx = clamp(sp.x - x, -max, max), dy = clamp(sp.y - y, -max, max); return { x: dx, y: dy }; };
    const hl = s.head.init ? lag(s.head, neckX, neckY, 3.5 * sc) : ZERO;
    const striking = u.state === 'attack' && u.phase !== 'recovery';
    const handW = striking || frozen ? 0 : 1;
    for (const k of ['lHand', 'rHand']) {
      const sp = s[k];
      if (!sp.init || !handW) continue;
      const l = lag(sp, M[k].x, M[k].y, 2.5 * sc);
      M[k] = { x: M[k].x + l.x * handW, y: M[k].y + l.y * handW };
    }

    // ---- eyeline: pitch the head toward what this fighter is watching, eased, a few degrees each way
    const opp = oppOf(u, sim);
    const fp = opp ? focusOf(u, opp) : null;
    let want = 0;
    if (fp) {
      const dx = (fp.x - neckX) * f, dy = fp.y - neckY;   // dx > 0: in front of him
      if (dx > -10) {
        const elev = Math.atan2(-dy, Math.max(20, Math.abs(dx)));   // up is positive
        want = clamp(-elev * 0.45, -12 * DEG, 15 * DEG);              // looking down tips the head forward
      }
    }
    const eyeTarget = (EYE_W[u.state] || 0) * (u.state === 'attack' && u.phase === 'active' ? 0.4 : 1);
    s.eyeW = ease(s.eyeW, eyeTarget, dt, 0.09);
    if (!frozen) {
      // a critically damped turn of the head toward the wanted pitch (about 0.1s, never a snap)
      const w = 2 * Math.PI * 2.6;
      for (let t = dt, h = 1 / 240; t > 1e-6; t -= h) { const d = Math.min(h, t); s.look.v += (w * w * (want - s.look.a) - 2 * w * s.look.v) * d; s.look.a += s.look.v * d; }
      s.lead *= Math.exp(-dt / 0.09);
    }
    // think, then move: as his own strike or step starts, the head leads toward the target
    const lead = s.lead * (u.state === 'attack' || u.state === 'walk' ? 1 : 0);
    const theta = (s.look.a * s.eyeW + lead * 7 * DEG) * f;
    const hx = J.head.x + (off.head ? off.head.x : 0) + hl.x + lead * 2.2 * sc * f, hy = J.head.y + (off.head ? off.head.y : 0) + hl.y;
    const vx = hx - neckX, vy = hy - neckY, c = Math.cos(theta), sn = Math.sin(theta);
    M.head = { x: neckX + vx * c - vy * sn, y: neckY + vx * sn + vy * c };

    propStep(u, s, M, dt, sc);
    return M;
  }

  // the prop: a point on a spring hanging from the chest; the rig's draw shifts the prop's free end by u.rig.sway
  function propStep(u, s, J, dt, sc) {
    const pr = u.rig && u.rig.charDef && u.rig.charDef.prop;
    if (!pr || !on || !J.neck || !J.chest) { if (u.rig) u.rig.sway = null; return; }
    const dx = J.chest.x - J.neck.x, dy = J.chest.y - J.neck.y, L0 = Math.hypot(dx, dy) || 1;
    const len = (pr.len || 22) * sc;
    const ax = J.neck.x + dx * (pr.at || 0.15), ay = J.neck.y + dy * (pr.at || 0.15);
    const rx = ax + dx / L0 * len, ry = ay + dy / L0 * len;   // at rest it lies along the torso
    const p = s.prop;
    if (!(u.hitstop > 0)) follow(p, rx, ry, dt, 2 * Math.PI * (pr.hz || 2.2), pr.damping || 0.22);
    const max = len * 0.75;
    u.rig.sway = p.init ? { x: clamp(p.x - rx, -max, max), y: clamp(p.y - ry, -max * 0.5, max * 0.5) } : null;
  }

  return {
    apply,
    setFrameData(fd) { FD = fd; },
    reset() { st.clear(); },
    get on() { return on; },
    set on(v) { on = !!v; if (!on) st.clear(); },
  };
}
