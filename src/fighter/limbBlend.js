// Experiment (branch limb-blend): two moves, one body.
//
// A botch today picks a template (whiff, over, spin) and tunes it with the forces the sim measured.
// With ?blend=1 the whiff, overbalance and spin-out are mixed per limb instead:
//   - the body keeps doing what it was doing: for a whiff, the rest of the interrupted move's clip;
//     for an overbalance or spin-out, that template's stumble (the sim measures its travel)
//   - the limb the new press wanted plays the new move's own keys from the pose the body is in now,
//     but only part of the way (55-85% by severity), its far segment trailing the near one, so an elbow
//     or knee is still bent when it should have been straight
//   - the torso and shoulders get dragged a little toward the new move
//   - then the limb fades back into the body's motion and everything settles to guard
// So a jab botched off a roundhouse looks like a roundhouse with a half-jab in it, not a canned whiff.
//
// It's a pure function of the clip state and the botch numbers, so it replays bit for bit under
// rollback. The flag comes from the URL, so both players in an online match would need the same one:
// keep it to local play.

export const LIMB_BLEND = (() => {
  try { return typeof location !== 'undefined' && new URLSearchParams(location.search).get('blend') === '1'; }
  catch { return false; }
})();

import * as dm from '../combat/dmath.js';   // bit-identical trig, so a mixed botch replays the same on every engine

const STEP = 20;   // ms between the resampled keys
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = t => 0.5 - 0.5 * dm.cos(Math.PI * clamp(t, 0, 1));
const easeOut = t => { const u = clamp(t, 0, 1); return 1 - (1 - u) * (1 - u); };
const total = ks => ks.reduce((s, k) => s + k.d, 0);
const limbKey = limb => (!limb ? 'ra' : limb === 'lHand' ? 'la' : limb === 'rHand' ? 'ra' : limb[0] === 'l' ? 'll' : 'rl');
const KEEP_EV = new Set(['footstep', 'land']);   // never carry the old strike's 'active' or 'recover'

// b: the botch numbers from the sim ({ kind, sev, alt, limb, ... }).
// h: { now (the pose this frame), sample (keys, t) -> pose, nd (the new move's def),
//      tmpl (the template clip for over/spin, or null), cur: { keys, el } (the clip being interrupted) }
export function mixBotch(b, h) {
  const sev = clamp(b.sev || 1, 1, 3), alt = b.alt || 0, lk = limbKey(b.limb);
  const { now, sample, nd } = h;

  // the body's track, and where in it we are
  let bodyKeys, t0;
  if (h.tmpl) { bodyKeys = [{ p: now, d: h.tmpl.blend || 40, ease: h.tmpl.blendEase || 'out', ev: null }, ...h.tmpl.keys]; t0 = 0; }
  else { bodyKeys = h.cur.keys; t0 = h.cur.el; }
  const bodyLen = Math.max(0, total(bodyKeys) - t0);
  const evAt = [];
  for (let i = 0, t = 0; i < bodyKeys.length; t += bodyKeys[i].d, i++) if (KEEP_EV.has(bodyKeys[i].ev) && t > t0) evAt.push({ t: t - t0, ev: bodyKeys[i].ev });

  // the new move's track, from the pose the body is in now
  const nk = [{ p: now, d: nd.blend || 40, ease: nd.blendEase || 'out', ev: null }, ...nd.keys];
  const ai = nk.findIndex(k => k.ev === 'active');
  const tc = ai > 0 ? total(nk.slice(0, ai)) : 120;   // time to the new move's contact pose
  const late = 50 + 15 * alt;                          // the far segment trails by this much
  const peak = 0.55 + 0.1 * sev;                       // how far the limb gets toward the new move
  const hold = 80 + 30 * sev, fade = 220;
  const limbEnd = tc + hold + fade;
  const T = Math.max(bodyLen, limbEnd);

  // play() normalizes a leftover spin to [0, 360) before blending; match it so nothing whips round
  const s0 = sample(bodyKeys, t0).spin || 0, spinOff = s0 - (((s0 % 360) + 360) % 360);

  const out = [];
  let ei = 0;
  for (let t = STEP; t <= T + STEP - 1; t += STEP) {
    const tt = Math.min(t, T);
    const bp = sample(bodyKeys, t0 + tt);
    const w = tt < tc ? peak * easeOut(tt / tc) : tt < tc + hold ? peak : tt < limbEnd ? peak * (1 - smooth((tt - tc - hold) / fade)) : 0;
    const np = sample(nk, Math.min(tt, tc + hold)), nl = sample(nk, Math.max(0, Math.min(tt, tc + hold) - late));
    const p = { ...bp, la: [...bp.la], ra: [...bp.ra], ll: [...bp.ll], rl: [...bp.rl], spin: (bp.spin || 0) - spinOff };
    p[lk] = [lerp(bp[lk][0], np[lk][0], w), lerp(bp[lk][1], nl[lk][1], w * 0.85)];
    const drag = w * 0.4;
    p.torso = lerp(bp.torso, np.torso, drag);
    p.tw = lerp(bp.tw || 0, np.tw || 0, drag);
    p.head = lerp(bp.head, np.head, drag * 0.5);
    let ev = null;
    while (ei < evAt.length && evAt[ei].t <= tt) { ev = evAt[ei].ev; ei++; }
    out.push({ p, d: STEP, ease: 'linear', ev });
  }
  // settle onto the body's own last pose (guard at its spot), spin squared to a whole turn
  const last = bodyKeys[bodyKeys.length - 1].p;
  const endSpin = Math.round(((last.spin || 0) - spinOff) / 360) * 360;
  if (out.length) out[out.length - 1] = { ...out[out.length - 1], d: 140, ease: 'out' };
  out.push({ p: { ...last, spin: endSpin }, d: 0, ease: 'sine', ev: null });

  return { blend: STEP, blendEase: 'out', shift: h.tmpl ? h.tmpl.shift || 0 : 0, mixed: true, keys: out };
}
