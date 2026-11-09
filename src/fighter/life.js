// The life layer (README, "The life layer"): what a puppeteer adds on top of the keyframes, drawn only.
// It reads the sim and the pose the rig produced this frame and returns a moved copy of the joints to draw;
// the sim, the rig's own state, the hitboxes and everything online play saves and hashes never see it.
// Its springs live here, keyed by unit, and step once per rendered frame on real time, so a rollback that
// re-runs sim steps never runs them twice. The parts:
//   - eyeline: the head pitches toward what the fighter is watching (the other fighter's chest, the limb of
//     a strike winding up at them, a body on the floor), and nods toward the target as their own strike or
//     step starts (think, then move);
//   - springs: the head lags the neck, the hands trail a little, a hit sends a wave up the body (hips,
//     chest, shoulders, head), and a prop (src/characters/: `prop`) swings on its own spring;
//   - fatigue: under 40% stamina the shoulders heave with a faster, deeper breath, the guard sags and the
//     head drops; the faint keeps its own dizzy clip;
//   - takes: reactions to the other fighter (a double take at a botch, watching a faint, a flinch when parried,
//     a settle after landing a parry, a held pose after a KO), read from unit fields frame to frame;
//   - signatures and habits: each character's `life` entry (src/characters/) tunes the springs, the eyeline,
//     the breath and an idle sway or bounce, and names idle habits (a glance, checking a watch...) that play
//     only after a couple of quiet seconds standing.
// Every overlay eases in and out; nothing steps, and nothing retriggers faster than a person could move.
// ?life=0 turns it off (for A/B); window.__game.life.on does the same live.

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

let on = true;
let extras = true;   // the takes, signatures and habits (window.__game.life.extras = false keeps only eyeline, springs and fatigue: for A/B)
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
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// a keyed curve in seconds, smoothstep between keys (so every key is a still point: no corners, no steps)
function curve(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) { const [t0, v0] = keys[i - 1]; return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0)); }
  }
  return keys[keys.length - 1][1];
}
// an envelope over [0, dur]: eases in over `a` seconds and out over the last `b`
const envelope = (t, dur, a, b) => (t <= 0 || t >= dur ? 0 : Math.min(smooth(t / a), smooth((dur - t) / b)));

// A character's movement signature (its `life` entry in src/characters/; every field optional):
//   spring, damp      multiply the head and hand springs' stiffness and damping (1 = the TEMP's)
//   eye               multiplies how fast the eyeline turns
//   breath            multiplies the breath's tempo (the fatigue heave and breathAmp below)
//   breathAmp         px of chest rise from an everyday breath while standing (0: the idle clip's own breath only)
//   sway, swayHz      px and Hz of an idle weight sway (the feet stay put)
//   bounce, bounceHz  px and Hz of a light bounce on the toes while standing
//   habits            idle habits to pick from (HABITS below); a name listed twice comes up twice as often
//   laugh             a little shoulder shake of a laugh in the double take at the other fighter's botch
//   ko                the held pose after a KO: 'tie', 'slump', or the generic stand-tall
const SIG0 = { spring: 1, damp: 1, eye: 1, breath: 1, breathAmp: 0, sway: 0, swayHz: 0.5, bounce: 0, bounceHz: 2, habits: [], laugh: false, ko: null };
const sigCache = new WeakMap();
function sigOf(u) {
  const c = u.char || (u.rig && u.rig.charDef);
  if (!c) return SIG0;
  let v = sigCache.get(c);
  if (!v) { v = c.life ? { ...SIG0, ...c.life } : SIG0; sigCache.set(c, v); }
  return v;
}
const TAKE_OK = new Set(['idle', 'walk', 'block', 'crouch', 'blockstun', 'landing']);   // a take plays over these; it fades out of anything else
const BODY = ['hip', 'chest', 'neck', 'head', 'lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lHand', 'rHand'];
const KNEES = ['lKnee', 'rKnee'];
const rnd = (a, b) => a + Math.random() * (b - a);   // drawn only: never the sim's rng

// Each take and habit: dur (s), hold (s: where a held take waits), and fx(t, c) adding offsets through c.add
// in the fighter's own frame (x forward, px at rig scale 1), c.theta for a head tilt (radians, + nods forward)
// and c.to(k, x, y, w) pulling a joint toward a point.
const TAKES = {
  // a botch over there: a beat, a look, back, a second smaller look; some laugh
  doubleTake: { dur: 0.9, fx(t, c) {
    const k = curve([[0, 0], [0.12, 0], [0.25, 1], [0.42, 0.2], [0.58, 0.6], [0.9, 0]], t);
    c.add('head', 7 * k, -2.5 * k); c.add('neck', 2.5 * k, -1 * k); c.add('chest', 1 * k, 0); c.theta(-9 * DEG * k);
    if (c.sig.laugh) {
      const e = envelope(t - 0.3, 0.6, 0.12, 0.2), y = 1.6 * Math.sin(2 * Math.PI * 6.5 * t) * e;
      for (const j of ['chest', 'neck', 'head', 'lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lHand', 'rHand']) c.add(j, 0, y * (j === 'chest' ? 0.5 : 1));
    }
  } },
  // he fainted: lean back, the guard lowers a little, the head tilts, watching (held while he's out)
  watchFaint: { dur: 0.75, hold: 0.32, fx(t, c) {
    const k = curve([[0, 0], [0.32, 1], [0.75, 0]], t);
    for (const [j, w] of [['hip', 0.3], ['chest', 0.55], ['neck', 0.8], ['lShoulder', 0.8], ['rShoulder', 0.8], ['head', 1]]) c.add(j, -5.5 * w * k, 0);
    c.add('lHand', -2.5 * k, 10 * k); c.add('rHand', -2.5 * k, 10 * k); c.add('lElbow', -1.5 * k, 5 * k); c.add('rElbow', -1.5 * k, 5 * k);
    c.add('head', 0, 1.5 * k); c.theta(10 * DEG * k);
  } },
  // parried: "oh!": the head pulls back, the shoulders come up (over the reel clip, at part weight)
  flinch: { dur: 0.5, fx(t, c) {
    const k = curve([[0, 0], [0.08, 1], [0.22, 0.7], [0.5, 0]], t);
    c.add('head', -6.5 * k, -3 * k); c.add('neck', -2.5 * k, -3 * k);
    c.add('lShoulder', 0, -5 * k); c.add('rShoulder', 0, -5 * k); c.add('lElbow', 0, -2.5 * k); c.add('rElbow', 0, -2.5 * k);
    c.theta(-8 * DEG * k);
  } },
  // landed a parry: a small satisfied settle down into the legs, a nod
  settle: { dur: 0.55, fx(t, c) {
    const k = curve([[0, 0], [0.16, 1], [0.55, 0]], t);
    for (const j of BODY) c.add(j, 0, 3.5 * k);
    for (const j of KNEES) c.add(j, 0, 1.8 * k);
    c.theta(7 * DEG * curve([[0, 0], [0.22, 1], [0.55, 0]], t));
  } },
  // won the round: a held, readable silhouette (the kabuki mie, Bunraku's frozen climax) before anything else
  ko: { dur: 0.75, hold: 0.3, fx(t, c) {
    const k = curve([[0, 0], [0.3, 1], [0.75, 0]], t);
    if (c.sig.ko === 'slump') {   // the TEMP: it's over, somehow; an exhausted, relieved slump
      for (const [j, w] of [['chest', 0.4], ['neck', 0.9], ['lShoulder', 1], ['rShoulder', 1], ['head', 1.2]]) c.add(j, 3 * w * k, 5.5 * w * k);
      c.add('lHand', 1 * k, 22 * k); c.add('rHand', 1 * k, 22 * k); c.add('lElbow', 0.5 * k, 11 * k); c.add('rElbow', 0.5 * k, 11 * k);
      const heave = (Math.sin(2 * Math.PI * 2.2 * c.held) * 0.5 + 0.5) * 2 * k;
      for (const j of ['neck', 'head', 'lShoulder', 'rShoulder']) c.add(j, 0, -heave);
      c.theta(8 * DEG * k);
      return;
    }
    // stand tall: the chest up, the chin up, the guard lowered (the fight's over)
    for (const [j, w] of [['chest', 0.6], ['neck', 1], ['lShoulder', 1], ['rShoulder', 1], ['head', 1]]) c.add(j, -1.5 * w * k, -4 * w * k);
    c.add('lHand', -2 * k, 12 * k); c.add('lElbow', -1 * k, 6 * k);
    if (c.sig.ko === 'tie') {   // THE MANAGER straightens his tie: the near hand to the knot, the head tips down to it
      const N = c.M.neck;
      c.to('rHand', N.x + c.f * 5 * c.sc, N.y + 9 * c.sc, k); c.to('rElbow', N.x + c.f * 1 * c.sc, N.y + 24 * c.sc, k * 0.6);
      c.theta(7 * DEG * k);
    } else { c.add('rHand', -2 * k, 12 * k); c.add('rElbow', -1 * k, 6 * k); c.theta(-9 * DEG * k); }
  } },
};
const HABITS = {
  // nervous glances back over the shoulder, twice: the head turns back and up, the guard drifts while he looks
  glance: { dur: 1.4, fx(t, c) {
    const k = curve([[0, 0], [0.2, 1], [0.45, 0.15], [0.65, 0.8], [0.95, 0], [1.4, 0]], t);
    c.add('head', -7 * k, -2.5 * k); c.add('neck', -2.5 * k, -0.8 * k); c.add('chest', -1 * k, 0);
    c.add('lShoulder', -1.5 * k, 0); c.add('rShoulder', -1.5 * k, 0); c.add('lHand', -2 * k, 3 * k); c.add('rHand', -2 * k, 3 * k);
    c.theta(-12 * DEG * k);
  } },
  // weight from foot to foot and a quick look around
  fidget: { dur: 1.7, fx(t, c) {
    const e = envelope(t, 1.7, 0.3, 0.35), x = 4.5 * Math.sin(2 * Math.PI * 1.2 * t) * e;
    for (const j of BODY) c.add(j, x, Math.abs(x) * 0.3);
    for (const j of KNEES) c.add(j, x * 0.5, 0);
    const look = curve([[0, 0], [0.5, 0], [0.75, 1], [1.1, 0]], t);
    c.add('head', -2 * look, -2 * look); c.theta(-12 * DEG * look);
  } },
  // up straight, precisely: tall, a tug down on the jacket's hem with both hands, back up to guard
  straighten: { dur: 1.6, fx(t, c) {
    const k = curve([[0, 0], [0.3, 1], [1.15, 1], [1.6, 0]], t), tug = curve([[0, 0], [0.3, 0], [0.55, 1], [0.75, 1], [1.05, 0]], t);
    for (const [j, w] of [['chest', 0.6], ['neck', 1], ['lShoulder', 1], ['rShoulder', 1], ['head', 1]]) c.add(j, -2.2 * w * k, -5 * w * k);
    c.add('lHand', -3 * k - 3 * tug, -1 * k + 16 * tug); c.add('rHand', -3 * k - 3 * tug, -1 * k + 16 * tug);
    c.add('lElbow', -1 * k, 7 * tug); c.add('rElbow', -1 * k, 7 * tug);
    c.theta(-5 * DEG * k + 8 * DEG * tug);
  } },
  // a look at the watch: the lead forearm comes down and across in front of the belly, wrist up, out of the guard,
  // and the head drops to read it
  watch: { dur: 2.1, fx(t, c) {
    const k = curve([[0, 0], [0.45, 1], [1.5, 1], [2.1, 0]], t), C = c.M.chest, H = c.M.hip;
    const by = (C.y + H.y) / 2;
    c.to('lHand', C.x + c.f * 20 * c.sc, by - 2 * c.sc, k); c.to('lElbow', C.x + c.f * 2 * c.sc, by + 6 * c.sc, k * 0.85);
    c.add('rHand', -1 * k, 4 * k);
    c.add('head', 3 * k, 2.5 * k); c.add('neck', 1 * k, 1 * k); c.theta(18 * DEG * k);
  } },
  // a slow roll of the neck
  neckRoll: { dur: 1.7, fx(t, c) {
    const e = envelope(t, 1.7, 0.35, 0.35), a = 2 * Math.PI * t / 1.7;
    c.add('head', 4.5 * Math.sin(a) * e, (3 - 3 * Math.cos(a)) * e); c.add('neck', 1.2 * Math.sin(a) * e, 0); c.theta(11 * DEG * Math.sin(a) * e);
  } },
  // one long breath in and out
  deepBreath: { dur: 2.6, fx(t, c) {
    const k = curve([[0, 0], [1.1, 1], [1.4, 1], [2.6, 0]], t);
    for (const [j, w] of [['hip', 0.2], ['chest', 0.6], ['neck', 1], ['lShoulder', 1], ['rShoulder', 1], ['head', 1], ['lHand', 0.6], ['rHand', 0.6], ['lElbow', 0.8], ['rElbow', 0.8]]) c.add(j, 0, -7 * w * k);
    c.add('lElbow', -2 * k, 0); c.add('rElbow', -2 * k, 0); c.theta(-8 * DEG * k);
  } },
  // a shrug
  shrug: { dur: 1, fx(t, c) {
    const k = curve([[0, 0], [0.25, 1], [0.45, 1], [1, 0]], t);
    for (const [j, w] of [['lShoulder', 1], ['rShoulder', 1], ['neck', 0.4], ['head', 0.3], ['lElbow', 0.8], ['rElbow', 0.8], ['lHand', 0.9], ['rHand', 0.9]]) c.add(j, 0, -7 * w * k);
    c.add('lHand', 2 * k, 0); c.add('rHand', -3 * k, 0); c.theta(-6 * DEG * k);
  } },
  // shaking the hands out, the guard dropping a touch
  shakeOut: { dur: 1.3, fx(t, c) {
    const e = envelope(t, 1.3, 0.3, 0.35), x = 3 * Math.sin(2 * Math.PI * 5 * t) * e;
    c.add('lHand', x - 2 * e, 8 * e); c.add('rHand', -x - 2 * e, 8 * e); c.add('lElbow', x * 0.4, 4 * e); c.add('rElbow', -x * 0.4, 4 * e);
  } },
};
export const LIFE_HABITS = Object.keys(HABITS);

export function createLife() {
  const st = new Map();
  function stateOf(u) {
    let s = st.get(u);
    if (!s) {
      s = { head: {}, lHand: {}, rHand: {}, prop: {}, look: { a: 0, v: 0 }, eyeW: 0, lead: 0, fat: 0, breath: 0, calm: 0,
        move: null, state: u.state, health: u.health, wave: null, pendingWave: null,
        T: Math.random() * 10, seen: null, prevState: u.state, prevHealth: u.health, koPending: false,
        take: null, takeW: 0, takeAt: -9, habit: null, habitW: 0, idleFor: 0, nextHabit: rnd(1.8, 3.6), habitReadyAt: 0, lastHabit: null, sigW: 0, last: null };
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
    if (!on) { u.rig.sway = null; s.last = J; return J; }
    if (raw || !J.head || !J.neck) {
      // launched, thrown or falling: drawn raw; a take or habit in progress ends (nothing of it is drawn now), and
      // what was seen is forgotten so nothing that happened meanwhile is reacted to late
      s.head.init = s.lHand.init = s.rHand.init = false; s.wave = null; s.pendingWave = null;
      s.take = null; s.takeW = 0; s.habit = null; s.habitW = 0; s.idleFor = 0; s.seen = null; s.koPending = false;
      propStep(u, s, J, dt, sc); s.last = J; return J;
    }
    if (s.pendingWave && !(u.hitstop > 0)) { s.wave = { ...s.pendingWave, t: 0 }; s.pendingWave = null; }

    const off = {};
    const add = (k, x, y) => { const o = off[k] || (off[k] = { x: 0, y: 0 }); o.x += x; o.y += y; };
    const f = u.facing || 1;
    const sig = extras ? sigOf(u) : SIG0;

    // ---- fatigue: a deeper, faster breath and a sagging guard under 40% stamina
    const frac = u.staminaMax ? u.stamina / u.staminaMax : 1;
    const tired = u.faint > 0 ? 0 : clamp((0.4 - frac) / 0.3, 0, 1);
    s.fat = ease(s.fat, tired, dt, tired > s.fat ? 0.25 : 0.6);
    s.calm = ease(s.calm, CALM.has(u.state) ? 1 : 0, dt, 0.08);
    s.breath += dt * (1.6 + 1.6 * s.fat) * sig.breath * Math.PI * 2;   // 1.6 breaths a second, 3.2 at the bottom of the bar (times the signature's tempo)
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

    // ---- signature, takes and habits (each an eased overlay; see TAKES and HABITS)
    let extraTheta = 0;
    const pulls = [];   // c.to(): joints pulled toward a point, applied after the other offsets
    const cx = {
      sig, f, sc, M: J, w: 1, held: 0,
      add: (k, x, y) => add(k, x * f * sc * cx.w, y * sc * cx.w),
      theta: (a) => { extraTheta += a * cx.w; },
      to: (k, x, y, w) => { pulls.push([k, x, y, w * cx.w]); },
    };
    const opp0 = oppOf(u, sim);
    s.T += dt;
    // the everyday signature, standing only: an idle sway, a bounce on the toes, a breath
    s.sigW = ease(s.sigW, extras && u.state === 'idle' && !(u.faint > 0) ? 1 : 0, dt, 0.25);
    if (s.sigW > 0.01) {
      cx.w = s.sigW;
      if (sig.sway) { const x = sig.sway * Math.sin(2 * Math.PI * sig.swayHz * s.T); for (const j of BODY) cx.add(j, x, 0); for (const j of KNEES) cx.add(j, x * 0.5, 0); }
      if (sig.bounce) { const y = sig.bounce * (0.5 - 0.5 * Math.cos(2 * Math.PI * sig.bounceHz * s.T)); for (const j of BODY) cx.add(j, 0, -y); for (const j of KNEES) cx.add(j, 0, -y * 0.5); }
      if (sig.breathAmp) { const y = sig.breathAmp * (Math.sin(s.breath) * 0.5 + 0.5); for (const [j, w] of [['chest', 0.5], ['neck', 1], ['head', 1], ['lShoulder', 1], ['rShoulder', 1], ['lHand', 0.5], ['rHand', 0.5]]) cx.add(j, 0, -y * w); }
    }
    if (extras) { takes(u, s, opp0, sim, dt, cx); habits(u, s, opp0, sim, dt, cx); }

    // the moved joints so far
    const M = {};
    for (const k in J) { const o = off[k]; M[k] = o ? { x: J[k].x + o.x, y: J[k].y + o.y } : J[k]; }
    for (const [k, x, y, w] of pulls) if (M[k]) M[k] = { x: M[k].x + (x - M[k].x) * w, y: M[k].y + (y - M[k].y) * w };

    // ---- springs: the head lags the neck, the hands trail (not while a strike is out or in a hit's freeze)
    const neckX = M.neck.x, neckY = M.neck.y;
    const frozen = u.hitstop > 0 || sim.hitstopActive > 0;
    if (!frozen) {
      follow(s.head, neckX, neckY, dt, 2 * Math.PI * 3.2 * sig.spring, 0.45 * sig.damp);
      follow(s.lHand, M.lHand.x, M.lHand.y, dt, 2 * Math.PI * 6 * sig.spring, 0.7 * sig.damp);
      follow(s.rHand, M.rHand.x, M.rHand.y, dt, 2 * Math.PI * 6 * sig.spring, 0.7 * sig.damp);
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
      const w = 2 * Math.PI * 2.6 * sig.eye;
      for (let t = dt, h = 1 / 240; t > 1e-6; t -= h) { const d = Math.min(h, t); s.look.v += (w * w * (want - s.look.a) - 2 * w * s.look.v) * d; s.look.a += s.look.v * d; }
      s.lead *= Math.exp(-dt / 0.09);
    }
    // think, then move: as his own strike or step starts, the head leads toward the target
    const lead = s.lead * (u.state === 'attack' || u.state === 'walk' ? 1 : 0);
    const theta = (s.look.a * s.eyeW + lead * 7 * DEG + extraTheta) * f;
    const hx = J.head.x + (off.head ? off.head.x : 0) + hl.x + lead * 2.2 * sc * f, hy = J.head.y + (off.head ? off.head.y : 0) + hl.y;
    const vx = hx - neckX, vy = hy - neckY, c = Math.cos(theta), sn = Math.sin(theta);
    M.head = { x: neckX + vx * c - vy * sn, y: neckY + vx * sn + vy * c };

    propStep(u, s, M, dt, sc);
    s.last = M;
    return M;
  }

  // ---- takes: reactions to the other fighter, read from unit fields frame to frame (the sim emits nothing new)
  function takes(u, s, opp, sim, dt, cx) {
    const seen = s.seen;
    const snap = { opp, oppBotch: opp ? opp.botchAt : -1, oppFaint: opp ? opp.faintAt : -1, oppState: opp ? opp.state : null, oppHealth: opp ? opp.health : 0 };
    s.seen = snap;
    const prevState = s.prevState, prevHealth = s.prevHealth;
    s.prevState = u.state; s.prevHealth = u.health;
    if (!seen || seen.opp !== opp) return;   // the first frame (or a new opponent): nothing to react to yet
    let want = null;
    const reeled = (p, c, h0, h1) => p === 'attack' && c === 'hitstun' && h1 >= h0 - 0.01;   // into the reel with no damage: parried
    // once per KO (the layer's state is reset at every round's spawn, so koDone is per round)
    if (sim.phase === 'ko' && sim.winner === u.id && !s.koDone) { s.koPending = true; s.koDone = true; }
    if (reeled(prevState, u.state, prevHealth, u.health)) want = 'flinch';
    else if (opp && reeled(seen.oppState, opp.state, seen.oppHealth, opp.health)) want = 'settle';
    else if (opp && opp.faint > 0 && opp.faintAt !== seen.oppFaint) want = 'watchFaint';
    else if (opp && opp.botchKind && opp.botchAt >= 0 && opp.botchAt !== seen.oppBotch) want = 'doubleTake';
    // the KO pose waits for the winner to be standing (his strike recovering is his own business); the rest start only
    // when no take is playing and the last one started 0.6s ago or more (nothing retriggers faster than a person reacts)
    if (sim.phase !== 'ko' && sim.phase !== 'match') s.koPending = false;
    if (s.koPending && !s.take && TAKE_OK.has(u.state)) { s.koPending = false; s.take = { kind: 'ko', t: 0, held: 0 }; s.takeAt = s.T; }
    else if (want && !s.take && s.T - s.takeAt > 0.6) { s.take = { kind: want, t: 0, held: 0 }; s.takeAt = s.T; }
    const tk = s.take;
    // the weight: full over calm states, part weight over the reel for a flinch, fading out of anything else (never a step)
    const allowed = !tk || u.faint > 0 ? 0 : tk.kind === 'flinch' ? (u.state === 'hitstun' || TAKE_OK.has(u.state) ? 0.6 : 0) : TAKE_OK.has(u.state) ? 1 : 0;
    s.takeW = ease(s.takeW, allowed, dt, 0.07);
    if (!tk) return;
    const def = TAKES[tk.kind];
    // a held take waits at its hold point: watching the faint while he's out, the KO pose for up to 0.8s
    const holding = def.hold != null && tk.t >= def.hold &&
      (tk.kind === 'watchFaint' ? !!(opp && opp.faint > 0) : tk.kind === 'ko' ? tk.held < 0.8 && (sim.phase === 'ko' || sim.phase === 'match') : false);
    if (holding) { tk.held += dt; tk.t = def.hold; } else tk.t += dt;
    cx.w = s.takeW; cx.held = tk.held;
    if (cx.w > 0.005) def.fx(Math.min(tk.t, def.dur), cx);
    if (tk.t >= def.dur || (!allowed && s.takeW < 0.02)) s.take = null;
  }

  // ---- habits: idle business after a couple of quiet seconds standing, eased out the moment anything happens
  function habits(u, s, opp, sim, dt, cx) {
    const sig = cx.sig;
    const quiet = u.state === 'idle' && !(u.faint > 0) && !s.take && s.fat < 0.5 && (sim.phase == null || sim.phase === 'fight') &&
      (!opp || (opp.state !== 'attack' && opp.state !== 'jump' && Math.abs(opp.x - u.x) > 130));
    s.idleFor = quiet ? s.idleFor + dt : 0;
    if (quiet && !s.habit && sig.habits.length && s.idleFor > s.nextHabit && s.T >= s.habitReadyAt) {
      let pick = sig.habits[Math.floor(Math.random() * sig.habits.length)];
      if (pick === s.lastHabit) pick = sig.habits.find((h) => h !== pick) || pick;
      if (HABITS[pick]) { s.habit = { kind: pick, t: 0 }; s.lastHabit = pick; }
    }
    s.habitW = ease(s.habitW, s.habit && quiet ? 1 : 0, dt, s.habit && quiet ? 0.12 : 0.08);
    const hb = s.habit;
    if (!hb) return;
    const def = HABITS[hb.kind];
    hb.t += dt;
    cx.w = s.habitW;
    if (cx.w > 0.005) def.fx(Math.min(hb.t, def.dur), cx);
    if (hb.t >= def.dur || (!quiet && s.habitW < 0.02)) {   // done, or cancelled and faded out
      s.habit = null; s.idleFor = 0; s.nextHabit = rnd(1.8, 3.6); s.habitReadyAt = s.T + rnd(3.5, 6.5);   // never twice in a row too soon
    }
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
    /** the joints the layer last drew for a unit (for measurements), or null */
    last(u) { const s = st.get(u); return s ? s.last : null; },
    /** what take or habit a unit is in the middle of, or '' (the fighter pages wait for a habit to finish) */
    busy(u) { const s = st.get(u); return s ? (s.habit && s.habit.kind) || (s.take && s.take.kind) || '' : ''; },
    get on() { return on; },
    set on(v) { on = !!v; if (!on) st.clear(); },
    get extras() { return extras; },
    set extras(v) { extras = !!v; },
  };
}
