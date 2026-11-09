// Hitboxes come from the striking limb's joints; hurtboxes are a head circle plus
// capsules along the spine and limbs. Everything is in world space from rig.joints.
import { FRAME_DATA } from './frameData.js';

const HAND_R = 15, FOOT_R = 18;

export function buildHitboxes(rig, move, facing) {
  const j = rig.joints, fd = FRAME_DATA[move];
  if (!j || !j.lHand) return [];
  // the limb the move names (the rig's MOVE_DATA limb, set on FRAME_DATA as joint); the old
  // "most forward hand/foot" guess measured some jabs off the guard hand
  const PARENT = { lHand: 'lElbow', rHand: 'rElbow', lFoot: 'lKnee', rFoot: 'rKnee', lKnee: 'hip', rKnee: 'hip', lElbow: 'lShoulder', rElbow: 'rShoulder' };
  let chain;
  if (fd.joint && PARENT[fd.joint]) chain = [PARENT[fd.joint], fd.joint];
  else {
    const chains = fd.limb === 'hand' ? [['lElbow', 'lHand'], ['rElbow', 'rHand']] : [['lKnee', 'lFoot'], ['rKnee', 'rFoot']];
    const fwd = (name) => (j[name].x - rig.x) * facing;
    chain = fwd(chains[0][1]) >= fwd(chains[1][1]) ? chains[0] : chains[1];
  }
  const mid = j[chain[0]], end = j[chain[1]];
  const r = (fd.limb === 'hand' ? HAND_R : FOOT_R) * (rig.shape ? rig.shape.limb : 1);   // a character's thicker limbs hit wider
  // a held object flung past the hand (the pose's ext, THE RECEPTIONIST's phone on its cord): only its thin far end
  // strikes, out along the forearm, so up close the hand itself hits nothing
  const ext = rig.pose && rig.pose.ext > 4 ? rig.pose.ext * (rig.scale || 1) : 0;
  if (ext) {
    const dx = end.x - mid.x, dy = end.y - mid.y, L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L;
    return [1, 0.75].map((k) => ({ x: end.x + ux * ext * k, y: end.y + uy * ext * k, r: r * (k === 1 ? 0.55 : 0.45) }));
  }
  // the whole striking segment, fist/foot first: at point-blank range the fist is past
  // the opponent's torso and it is the forearm or shin that lands
  const out = [{ x: end.x, y: end.y, r }];
  // just behind the tip only: solid bodies keep a fist from passing the torso, and a forearm
  // circle further back registered hits with the fist nowhere near the body
  out.push({ x: mid.x + (end.x - mid.x) * 0.75, y: mid.y + (end.y - mid.y) * 0.75, r: r * 0.7 });
  return out;
}

export function buildHurtboxes(rig) {
  const j = rig.joints;
  if (!j || !j.hip) return { circles: [], capsules: [] };
  const sh = rig.shape, t = sh ? 9 * sh.torso : 9, l = sh ? 6 * sh.limb : 6, a = sh ? 5 * sh.limb : 5;   // a character's body is wider or narrower
  return {
    circles: [{ x: j.head.x, y: j.head.y, r: (rig.radius || 11) + 3 }],
    capsules: [
      [j.neck, j.hip, t],
      [j.hip, j.lKnee, l], [j.lKnee, j.lFoot, l],
      [j.hip, j.rKnee, l], [j.rKnee, j.rFoot, l],
      [j.lShoulder, j.lElbow, a], [j.lElbow, j.lHand, a],
      [j.rShoulder, j.rElbow, a], [j.rElbow, j.rHand, a],
    ],
  };
}

function segDist2(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = p.x - (a.x + abx * t), dy = p.y - (a.y + aby * t);
  return dx * dx + dy * dy;
}

// Returns the contact point of the first overlapping pair, or null.
export function testHit(hits, hurt) {
  for (const h of hits) {
    for (const c of hurt.circles) {
      const d = h.r + c.r, dx = h.x - c.x, dy = h.y - c.y;
      if (dx * dx + dy * dy <= d * d) return { x: h.x, y: h.y };   // at the fist/foot, not the head
    }
    for (const [a, b, r] of hurt.capsules) {
      const d = h.r + r;
      if (segDist2(h, a, b) <= d * d) return { x: h.x, y: h.y };
    }
  }
  return null;
}

// Debug overlay for the HUD.
export function drawBoxes(ctx, hits, hurt) {
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(46,242,255,0.8)';
  for (const c of hurt.circles) { ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.lineCap = 'round';
  for (const [a, b, r] of hurt.capsules) { ctx.lineWidth = r * 2; ctx.strokeStyle = 'rgba(46,242,255,0.18)'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  ctx.lineWidth = 2; ctx.strokeStyle = '#ff2bd6';
  for (const h of hits) { ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
}
