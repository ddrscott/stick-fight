// TEMP: the baseline. The original fighter, unchanged: every shared move and every shared string, no
// unique moves, no stats off 1, no body changes. TEMP vs TEMP plays exactly as the game did before
// characters existed (the regression scenes in the README give the same results). It's also what a
// ladder stage falls back to when its character isn't in the game yet.
// a lanyard with a visitor badge: the cord from the back of the neck down the front of the shirt, the badge in
// the accent with a dark edge. It's his prop, so the life layer swings the badge (o.sway); at rest it hangs on
// the chest. The first day, in one object.
function lanyard(ctx, J, o) {
  const n = J.neck, c = J.chest, s = o.scale, sw = o.sway;
  let dx = c.x - n.x, dy = c.y - n.y; const L0 = Math.hypot(dx, dy) || 1; dx /= L0; dy /= L0;
  const fx = dy * o.facing, fy = -dx * o.facing;   // toward his front
  const ax = n.x + fx * 4.5 * s, ay = n.y + fy * 4.5 * s;             // where the cord leaves the collar
  const bx = n.x + dx * o.len + fx * 6 * s + sw.x, by = n.y + dy * o.len + fy * 6 * s + sw.y;   // the badge clip
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1a0f00'; ctx.lineWidth = 2.6 * s;
  ctx.beginPath(); ctx.moveTo(n.x - fx * 3 * s, n.y - fy * 3 * s); ctx.quadraticCurveTo(ax, ay, bx, by); ctx.stroke();
  ctx.strokeStyle = o.accent; ctx.lineWidth = 1.5 * s;
  ctx.beginPath(); ctx.moveTo(n.x - fx * 3 * s, n.y - fy * 3 * s); ctx.quadraticCurveTo(ax, ay, bx, by); ctx.stroke();
  // the badge hangs from the clip along the cord's last stretch
  let ux = bx - ax, uy = by - ay; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
  const w = 6.5 * s, h = 8.5 * s;
  ctx.save(); ctx.translate(bx, by); ctx.rotate(Math.atan2(uy, ux) - Math.PI / 2);
  ctx.fillStyle = '#1a0f00'; ctx.fillRect(-w / 2 - 1.1 * s, -1.1 * s, w + 2.2 * s, h + 2.2 * s);
  ctx.fillStyle = o.accent; ctx.fillRect(-w / 2, 0, w, h);
  ctx.fillStyle = '#1a0f00'; ctx.fillRect(-w / 2 + 1.4 * s, 2 * s, w - 2.8 * s, 1.3 * s);   // the name line nobody filled in
  ctx.restore();
}

export default {
  id: 'temp',
  name: 'TEMP',
  tagline: 'FIRST DAY. KNOWS THE BASICS',
  color: '#f0f0f0',
  altColor: '#E85D00',
  accent: '#ffb02e',
  stats: {},
  body: null,
  // drawn over the chest, swung by the life layer (src/fighter/life.js); body stays null, so the rig is the baseline
  prop: { draw: lanyard, at: 0.15, len: 24, hz: 2.2, damping: 0.2 },
  moves: {},
  commands: [],
  strings: {},
  ai: {},
  moveList: [
    { name: 'NEON TORNADO', input: '1, 2, 3, 4', note: 'launches into a juggle' },
    { name: 'COMET CROSS', input: '→→ 2', note: 'wall splat' },
    { name: 'SKY SPIKE', input: '↓2, 1, 2, 4', note: 'ground bounce' },
  ],
};
