// HUD on its own 2D overlay canvas, in the arena's neon: hot pink, cyan, amber, violet. A soft
// fade at the very top holds two slanted health bars with glowing frames, a thin stamina bar under
// each, round pips and a ringed timer. Banners, the hit counter and the callouts (enders, counters,
// trick shots) are laid out against the fighters' screen boxes so they never cover a fighter
// (owner requirement 5): each picks the first free slot, and falls back into the top strip.
import { drawBoxes } from './hitboxes.js';

export const NEON = { pink: '#ff2bd6', cyan: '#2ef2ff', amber: '#ffb02e', violet: '#a66bff', white: '#fff4fd', ink: '#0a0414' };
const DISPLAY = "'Bungee', 'Arial Black', Impact, system-ui, sans-serif";
const LABEL = "'Teko', 'Arial Narrow', 'Helvetica Neue', system-ui, sans-serif";
const BAR_W = 420, BAR_H = 18, BAR_Y = 16, SKEW = 12, STRIP_H = 70, ST_H = 5;
const SIDE = [NEON.cyan, NEON.pink];
const KIND_COLOR = { ender: null, counter: NEON.amber, trick: NEON.violet, trade: NEON.white, break: NEON.cyan, faint: NEON.pink, finish: NEON.amber };

export function createHUD(canvas, { width = 1280, height = 720, dpr = 1 } = {}) {
  const ctx = canvas.getContext('2d');
  const ghost = [100, 100], seen = [100, 100], tick = [0, 0];
  let lastBanner = '', bannerAge = 0, clock = 0;
  let names = null;          // the flow's fighter names (the arcade ladder), else the labels below
  let charNames = null;
  const labelW = [0, 0];     // how wide each side's name label drew, so the score starts after it      // the flow's character names per slot (an arcade stage's name), else each unit's character
  let layout = {};           // what draw() returns: where the title's prompt sits (src/flow/ puts its START button there)

  // neon text: a dark outline for contrast, a colored glow stroke, then a hot white-tinted core
  function neonText(text, x, y, size, color, { font = DISPLAY, align = 'center', glow = 1, core = true, weight = '' } = {}) {
    ctx.save();
    ctx.font = `${weight} ${size}px ${font}`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size * 0.16); ctx.strokeStyle = 'rgba(8,2,18,0.85)'; ctx.strokeText(text, x, y);
    ctx.shadowColor = color; ctx.shadowBlur = size * 0.5 * glow;
    ctx.lineWidth = Math.max(1.5, size * 0.07); ctx.strokeStyle = color; ctx.strokeText(text, x, y);
    ctx.fillStyle = core ? mix(color, '#ffffff', 0.55) : color; ctx.fillText(text, x, y);
    ctx.shadowBlur = 0; ctx.restore();
    return ctx.measureText ? measure(text, size, font, weight) : size * text.length * 0.6;
  }
  function measure(text, size, font = DISPLAY, weight = '') { ctx.save(); ctx.font = `${weight} ${size}px ${font}`; const w = ctx.measureText(text).width; ctx.restore(); return w; }
  function para(x, y, w, h, side) {
    // a parallelogram leaning outward: left bar's outer (left) end sits lower-left
    const k = SKEW * (h / BAR_H);
    ctx.beginPath();
    if (side === 0) { ctx.moveTo(x + k, y); ctx.lineTo(x + w + k, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); }
    else { ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - k, y + h); ctx.lineTo(x - k, y + h); }
    ctx.closePath();
  }

  // who: the player (0 = P1) the bar belongs to, for its color, name, pips and drain state; side: the
  // screen side it's drawn on (0 = left). They differ only in a mirrored view, where P2 is on the left.
  function bar(u, who, side, sim, dt) {
    const i = who, color = SIDE[who];
    const max = u.maxHealth || sim.startHealth || 100;   // a character's own health (src/characters/)
    if (u.health < seen[i]) tick[i] = 0.35;
    seen[i] = u.health;
    tick[i] = Math.max(0, tick[i] - dt);
    if (u.health < ghost[i]) { if (tick[i] <= 0) ghost[i] = Math.max(u.health, ghost[i] - 60 * dt); }
    else ghost[i] = u.health;

    const x = side === 0 ? 44 : width - 44 - BAR_W, y = BAR_Y;
    // well
    para(x, y, BAR_W, BAR_H, side); ctx.fillStyle = 'rgba(14,4,30,0.72)'; ctx.fill();
    // fills drain toward the outer end
    const fill = (hp, style) => {
      const w = BAR_W * Math.max(0, Math.min(1, hp / max));
      if (w <= 0) return;
      ctx.save(); para(x, y, BAR_W, BAR_H, side); ctx.clip();
      ctx.fillStyle = style; ctx.fillRect(side === 0 ? x + BAR_W - w : x - SKEW, y, w + SKEW, BAR_H);
      ctx.restore();
    };
    fill(ghost[i], tick[i] > 0 ? NEON.white : 'rgba(255,176,46,0.75)');
    fill(u.health, color);
    // hot core line along the fill
    const w = BAR_W * Math.max(0, Math.min(1, u.health / max));
    if (w > 0) { ctx.save(); para(x, y, BAR_W, BAR_H, side); ctx.clip(); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(side === 0 ? x + BAR_W - w : x - SKEW, y + 4, w + SKEW, 3); ctx.restore(); }
    // glowing frame
    ctx.save(); para(x - 2, y - 2, BAR_W + 4, BAR_H + 4, side);
    ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.lineWidth = 2.5; ctx.strokeStyle = color; ctx.stroke();
    ctx.shadowBlur = 0; ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.stroke(); ctx.restore();

    // stamina: a thin amber bar under the health bar. Under 35 (two jabs from fainting) it turns
    // pink and flashes, and its track pulses; fainted, it dims to a violet refill and a FAINT tag flickers
    const sy = y + BAR_H + 6, st = Math.max(0, Math.min(1, (u.stamina == null ? 100 : u.stamina) / (u.staminaMax || 100)));
    const faint = u.faint > 0, low = !faint && st < 0.35, blink = Math.floor(clock * 7) % 2 === 0;
    para(x + (side === 0 ? 30 : 0), sy, BAR_W - 30, ST_H, side);
    ctx.fillStyle = low && blink ? 'rgba(255,43,214,0.28)' : 'rgba(14,4,30,0.7)'; ctx.fill();
    if (low) { ctx.save(); ctx.shadowColor = NEON.pink; ctx.shadowBlur = blink ? 10 : 4; ctx.lineWidth = 1; ctx.strokeStyle = blink ? NEON.pink : 'rgba(255,43,214,0.45)'; ctx.stroke(); ctx.restore(); }
    const sw = (BAR_W - 30) * st;
    if (sw > 0) {
      ctx.save(); para(x + (side === 0 ? 30 : 0), sy, BAR_W - 30, ST_H, side); ctx.clip();
      const c = faint ? NEON.violet : low ? (blink ? NEON.white : NEON.pink) : NEON.amber;
      ctx.globalAlpha = faint ? 0.6 : 1;
      ctx.shadowColor = faint ? NEON.violet : low ? NEON.pink : NEON.amber; ctx.shadowBlur = faint ? 4 : low ? 12 : 8; ctx.fillStyle = c;
      ctx.fillRect(side === 0 ? x + 30 + (BAR_W - 30) - sw : x - SKEW, sy, sw + SKEW, ST_H);
      ctx.restore();
    }
    if (faint && Math.floor(clock * 8) % 2 === 0) neonText('FAINT', side === 0 ? x + 6 : x + BAR_W - 6, sy + 3, 13, NEON.pink, { font: LABEL, align: side === 0 ? 'left' : 'right', weight: 600, glow: 0.6 });
    else if (low && blink) neonText('LOW', side === 0 ? x + 6 : x + BAR_W - 6, sy + 3, 13, NEON.pink, { font: LABEL, align: side === 0 ? 'left' : 'right', weight: 600, glow: 0.6 });

    // name and pips
    const ly = sy + ST_H + 12;
    const diff = u.kind === 'ai' && u.controller && u.controller.getDifficulty ? u.controller.getDifficulty() : sim.difficulty;
    const role = names && names[who] ? names[who] : u.controller && u.controller.label ? u.controller.label : u.kind === 'ai' ? (sim.horde && who === 1 ? 'GOON' : `CPU ${Math.round(diff * 10)}`) : u.kind === 'human' ? 'PLAYER 1' : u.kind === 'script' ? 'TRAINER' : 'DUMMY';
    // the character's name leads, in the fighter's own neon, then who's playing it (a goon is just a goon)
    const cn = (charNames && charNames[who]) || (u.char && u.char.name) || '';
    const cname = cn && !(sim.horde && who === 1) && role !== cn ? cn : '';
    if (cname) {
      const cw = measure(cname, 22, LABEL, 600) + 10;
      neonText(cname, side === 0 ? x : x + BAR_W, ly, 22, u.color || color, { font: LABEL, align: side === 0 ? 'left' : 'right', weight: 600, glow: 0.8, core: true });
      neonText(role, side === 0 ? x + cw : x + BAR_W - cw, ly + 1, 17, color, { font: LABEL, align: side === 0 ? 'left' : 'right', weight: 500, glow: 0.5, core: false });
      labelW[side] = cw + measure(role, 17, LABEL, 500);
    } else labelW[side] = measure(role, 22, LABEL, 600), neonText(role, side === 0 ? x : x + BAR_W, ly, 22, color, { font: LABEL, align: side === 0 ? 'left' : 'right', weight: 600, glow: 0.7, core: false });
    if (sim.horde) {
      const H = sim.horde, wv = H.wave || { downed: 0, size: 0 };
      neonText(who === 0 ? `FLOOR ${H.floorsCleared + 1}   ${H.count} DOWN` : `WAVE ${wv.downed}/${wv.size}`, side === 0 ? x + BAR_W : x, ly, 20, NEON.amber, { font: LABEL, align: side === 0 ? 'right' : 'left', weight: 600, glow: 0.7 });
    } else {
      for (let k = 0; k < 2; k++) {
        const px = side === 0 ? x + BAR_W - 8 - k * 20 : x + 8 + k * 20, py = ly;
        ctx.save(); ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2);
        const won = sim.wins[i] > k;
        ctx.shadowColor = won ? NEON.amber : color; ctx.shadowBlur = won ? 12 : 4;
        if (won) { ctx.fillStyle = NEON.amber; ctx.fill(); }
        ctx.lineWidth = 2; ctx.strokeStyle = won ? '#fff1c9' : color; ctx.globalAlpha = won ? 1 : 0.7; ctx.stroke(); ctx.restore();
      }
    }
  }

  function timer(sim) {
    const cx = width / 2, cy = 34, r = 26;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(14,4,30,0.75)'; ctx.fill();
    ctx.shadowColor = NEON.violet; ctx.shadowBlur = 16; ctx.lineWidth = 3; ctx.strokeStyle = NEON.violet; ctx.stroke();
    // the ring drains with the clock
    const f = Math.max(0, Math.min(1, sim.timer / 60));
    ctx.shadowBlur = 8; ctx.lineWidth = 2; ctx.strokeStyle = sim.timer < 10 ? NEON.pink : '#e6d6ff';
    ctx.beginPath(); ctx.arc(cx, cy, r - 5, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); ctx.stroke();
    ctx.restore();
    neonText(String(Math.ceil(sim.timer)).padStart(2, '0'), cx, cy + 1, 24, sim.timer < 10 ? NEON.pink : NEON.white, { glow: 0.6 });
    neonText(`ROUND ${sim.round}`, cx, cy + r + 9, 16, NEON.violet, { font: LABEL, weight: 600, glow: 0.6, core: false });
  }

  // screen boxes of the live fighters (and the fresh pile isn't covered either: it lies on the floor, below every slot)
  function fighterBoxes(sim, camera) {
    const z = camera.zoom, out = [];
    for (const u of sim.units) {
      if (u.hidden || !u.rig || !u.rig.joints || !u.rig.joints.head) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const k in u.rig.joints) { const p = u.rig.joints[k]; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      const pad = 22;
      const m = camera.mirror ? -1 : 1;   // a mirrored view: world x runs right to left on screen
      const sx = (wx) => m * (wx - camera.x - camera.shakeX) * z + width / 2, sy = (wy) => (wy - camera.y - camera.shakeY) * z + height / 2;
      const ax = sx(x0), bx = sx(x1);
      out.push({ x0: Math.min(ax, bx) - pad, x1: Math.max(ax, bx) + pad, y0: sy(y0) - pad, y1: sy(y1) + pad });
    }
    return out;
  }
  const overlaps = (r, boxes) => boxes.some(b => r.x0 < b.x1 && r.x1 > b.x0 && r.y0 < b.y1 && r.y1 > b.y0);

  // place a block of w x h centred on one of the candidate points; the last resort is the top strip
  function placeFree(w, h, cands, boxes, taken) {
    for (const [cx, cy] of cands) {
      const r = { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
      if (!overlaps(r, boxes) && !overlaps(r, taken)) { taken.push(r); return { x: cx, y: cy, s: 1 }; }
    }
    return null;
  }

  function banner(text, age, boxes, taken) {
    const ko = text === 'KO', fight = text === 'FIGHT';
    const size = ko ? 110 : 64, color = ko ? NEON.amber : fight ? NEON.pink : NEON.cyan;
    const pop = 1 + Math.max(0, 0.35 - age * 2.5);
    const w = measure(text, size) * pop + 30, h = size * 1.1 * pop;
    const spot = placeFree(w, h, [[width / 2, height * 0.24], [width / 2, height * 0.2], [width / 2, STRIP_H + h / 2 + 6]], boxes, taken);
    ctx.save();
    if (spot) { ctx.translate(spot.x, spot.y); ctx.scale(pop, pop); neonText(text, 0, 0, size, color, { glow: 1.2 }); }
    else neonText(text, width / 2, STRIP_H + 2, 40, color, { glow: 1 });   // squeezed into the strip, under the timer
    ctx.restore();
  }

  // The attract mode's cabinet card: the title, a blinking PRESS START (TAP TO PLAY on a touch
  // screen) and a DEMO tag. The title holds a slot (top, else bottom) while it stays clear of the
  // fighters and the banner, moves to the other one when it's covered (fading in there, never
  // sliding across the fighters), and goes back to the top once that has been clear for a moment.
  // Covered with nowhere to go, it fades right down (owner requirement 5: nothing over a fighter).
  const card = { slot: 0, y: null, topFree: 0, alpha: 1, promptAlpha: 1 };
  function attractCard(at, boxes, taken, dt) {
    const titleW = measure('STICK FIGHT', 70) + 40, titleH = 118;
    const slots = [168, height - 106];
    const rect = (y, w, h) => ({ x0: width / 2 - w / 2, x1: width / 2 + w / 2, y0: y - h / 2, y1: y + h / 2 });
    const free = slots.map(y => !overlaps(rect(y, titleW, titleH), boxes) && !overlaps(rect(y, titleW, titleH), taken));
    const was = card.slot;
    if (!free[card.slot]) { const k = free.indexOf(true); if (k >= 0) card.slot = k; }
    card.topFree = card.slot !== 0 && free[0] ? card.topFree + dt : 0;
    if (card.topFree > 1.5) { card.slot = 0; card.topFree = 0; }
    if (card.slot !== was) { card.alpha = 0; card.promptAlpha = 0; }   // a cut and a fade in, not a slide
    const spot = { x: width / 2, y: slots[card.slot] };
    const r = rect(spot.y, titleW, titleH);
    const want = overlaps(r, boxes) ? 0.16 : overlaps(r, taken) ? 0.1 : 1;   // under a fighter, or under the banner (KO reads first)
    card.alpha += (want - card.alpha) * (1 - Math.exp(-dt * (want < card.alpha ? 20 : 8)));
    taken.push(r);
    ctx.save(); ctx.globalAlpha = card.alpha;
    // NEON on a pair of rules, STICK FIGHT under it, a thin underline that breathes
    const breathe = 0.75 + 0.25 * Math.sin(clock * 2.4);
    const ny = spot.y - 38, nw = measure('N E O N', 26, LABEL, 600);
    neonText('N E O N', spot.x, ny, 26, NEON.cyan, { font: LABEL, weight: 600, glow: 0.9 });
    ctx.save(); ctx.strokeStyle = NEON.cyan; ctx.shadowColor = NEON.cyan; ctx.shadowBlur = 10; ctx.lineWidth = 2;
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(spot.x + d * (nw / 2 + 14), ny); ctx.lineTo(spot.x + d * (nw / 2 + 120), ny); ctx.stroke(); }
    ctx.restore();
    neonText('STICK FIGHT', spot.x, spot.y + 12, 70, NEON.pink, { glow: 1.1 + 0.3 * breathe });
    ctx.save(); ctx.globalAlpha *= 0.55 + 0.45 * breathe; ctx.strokeStyle = NEON.amber; ctx.shadowColor = NEON.amber; ctx.shadowBlur = 12; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(spot.x - titleW / 2 + 40, spot.y + 54); ctx.lineTo(spot.x + titleW / 2 - 40, spot.y + 54); ctx.stroke();
    ctx.restore();
    ctx.restore();

    // PRESS START blinks like a cabinet: under the title at the top; with the title at the bottom
    // (the fighters' feet are just above it) it goes up top on its own
    // at.domPrompt: the flow draws a real START button there instead (it's told where, and how faded)
    const prompt = at.touch ? 'TAP TO PLAY' : 'PRESS START', pw = measure(prompt, 30) + 30, ph = at.domPrompt ? 56 : 40;
    const py = card.slot === 0 ? spot.y + titleH / 2 + (at.domPrompt ? 40 : 30) : 150;
    const pr = { x0: width / 2 - pw / 2, x1: width / 2 + pw / 2, y0: py - ph / 2, y1: py + ph / 2 };
    card.promptAlpha += ((overlaps(pr, boxes) ? 0.16 : overlaps(pr, taken) ? 0 : 1) - card.promptAlpha) * (1 - Math.exp(-dt * 12));
    taken.push(pr);
    layout.prompt = { x: width / 2, y: py, w: pw, h: ph, alpha: card.alpha * card.promptAlpha };
    if (!at.domPrompt && (clock % 1.1) < 0.7) { ctx.save(); ctx.globalAlpha = card.alpha * card.promptAlpha; neonText(prompt, width / 2, py, 30, NEON.amber, { glow: 1.1 }); ctx.restore(); }

    // DEMO: a small boxed tag in the bottom-right corner, where the key hint usually sits
    const dw = measure('DEMO', 22, LABEL, 600) + 22, dh = 28, dx = width - 30 - dw / 2, dy = height - 26;
    const covered = overlaps({ x0: dx - dw / 2, x1: dx + dw / 2, y0: dy - dh / 2, y1: dy + dh / 2 }, boxes);
    ctx.save(); ctx.globalAlpha = covered ? 0.15 : 0.9;
    ctx.strokeStyle = NEON.violet; ctx.shadowColor = NEON.violet; ctx.shadowBlur = 10; ctx.lineWidth = 2;
    ctx.strokeRect(dx - dw / 2, dy - dh / 2, dw, dh);
    ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(14,4,30,0.55)'; ctx.fillRect(dx - dw / 2 + 1, dy - dh / 2 + 1, dw - 2, dh - 2);
    neonText('DEMO', dx, dy + 2, 22, NEON.violet, { font: LABEL, weight: 600, glow: 0.7 });
    ctx.restore();
  }

  // flow (src/flow/, null for a ?scene= URL): { bare, score, bonus, names, hint }. bare = a menu is
  // up over a dimmed scene, so no HUD at all. Returns { prompt } on the title (see attractCard).
  function draw({ sim, camera, dt = 0, debug = false, scene = '', paused = false, help = false, attract = null, flow = null }) {
    clock += dt;
    layout = {};
    names = flow && flow.names ? flow.names : null;
    charNames = flow && flow.charNames ? flow.charNames : null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (flow && flow.bare) return layout;
    // a soft violet fade behind the strip so the bars read over the bright sign row
    const g = ctx.createLinearGradient(0, 0, 0, STRIP_H + 18);
    g.addColorStop(0, 'rgba(10,2,24,0.62)'); g.addColorStop(0.75, 'rgba(10,2,24,0.3)'); g.addColorStop(1, 'rgba(10,2,24,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, width, STRIP_H + 18);
    // a mirrored view (camera.mirror: the online guest) swaps the bars, so P2's is on the left like his fighter
    const flip = camera.mirror ? 1 : 0;
    bar(sim.units[0], 0, flip, sim, dt); bar(sim.focus || sim.units[1], 1, 1 - flip, sim, dt);
    timer(sim);
    if (flow && flow.score != null) score(flow, flip);

    const boxes = fighterBoxes(sim, camera), taken = [];
    if (sim.banner !== lastBanner) { lastBanner = sim.banner; bannerAge = 0; } else bannerAge += dt;
    if (sim.banner) banner(sim.banner, bannerAge, boxes, taken);
    if (attract) attractCard(attract, boxes, taken, dt);   // before the callouts, so they step around it

    // hit counter and callouts: stacked on the attacker's side under the strip, else the other side,
    // else the middle; never over a fighter
    const items = [];
    const cb = sim.combo || sim.lastCombo;
    if (cb && cb.count >= 2) items.push({ text: `${cb.count} HITS`, by: cb.by, color: cb.by === 0 ? NEON.cyan : NEON.pink, size: 26, alpha: sim.combo ? 1 : Math.min(1, (cb.t || 0) / 0.3), age: 1 });
    for (const c of (sim.callouts || []).slice().reverse()) {
      const color = KIND_COLOR[c.kind] || (c.by === 0 ? NEON.cyan : c.by === 1 || c.by > 1 ? NEON.pink : NEON.white);
      const age = c.max - c.t;
      items.push({ text: c.kind === 'counter' && c.text === 'COUNTER' ? 'COUNTER!' : c.text, by: c.by, color, size: c.kind === 'finish' ? 40 : c.kind === 'ender' ? 30 : 24, alpha: Math.min(1, c.t / 0.25), age, kind: c.kind });
    }
    const rows = [STRIP_H + 22, STRIP_H + 56, STRIP_H + 90, STRIP_H + 124];
    let row = [0, 0, 0];
    for (const it of items) {
      const pop = 1 + Math.max(0, 0.3 - it.age * 2);
      const w = measure(it.text, it.size) * pop + 16, h = it.size * 1.15;
      let side = it.by === 1 || it.by > 1 ? 1 : it.by === 0 ? 0 : 2;
      if (flip && side < 2) side = 1 - side;   // mirrored: on the attacker's side of the screen
      const xs = [44 + w / 2, width - 44 - w / 2, width / 2];
      const order = side === 2 ? [2, 0, 1] : [side, 1 - side, 2];
      let spot = null;
      for (const s of order) {
        const cands = rows.slice(row[s]).map(y => [xs[s], y]);
        spot = placeFree(w, h, cands, boxes, taken);
        if (spot) { row[s] = Math.min(rows.length, rows.indexOf(spot.y) + 1); break; }
      }
      if (!spot) {
        // no free slot under the strip: a small tag inside the strip beside the timer
        const sx = side === 1 ? width / 2 + 70 : width / 2 - 70;
        ctx.save(); ctx.globalAlpha = it.alpha;
        neonText(it.text, sx, STRIP_H - 8, 16, it.color, { align: side === 1 ? 'left' : 'right', glow: 0.8 });
        ctx.restore(); continue;
      }
      ctx.save(); ctx.globalAlpha = it.alpha; ctx.translate(spot.x, spot.y); ctx.scale(pop, pop);
      neonText(it.text, 0, 0, it.size, it.color, { glow: it.kind === 'finish' ? 1.4 : 1 });
      ctx.restore();
    }

    // horde count card
    if (sim.card) {
      const k = Math.min(1, sim.card.t / 0.2), s = 1 + 0.25 * Math.max(0, sim.card.t - 0.7) / 0.2;
      const spot = placeFree(measure(sim.card.text, 30) * s + 20, 40, [[width / 2, STRIP_H + 26], [width / 2, STRIP_H + 60]], boxes, taken);
      if (spot) { ctx.save(); ctx.globalAlpha = k; ctx.translate(spot.x, spot.y); ctx.scale(s, s); neonText(sim.card.text, 0, 0, 30, NEON.amber); ctx.restore(); }
    }
    if (attract) { if (debug) drawDebug(sim, camera, scene); return layout; }
    if (paused) neonText('PAUSED', width / 2, STRIP_H + 40, 34, NEON.violet);
    const cls = typeof document !== 'undefined' ? document.documentElement.classList : null;
    const padUI = !!cls && cls.contains('pad-ui');
    const touchUI = !!cls && cls.contains('touch-ui') && !padUI;   // a pad hides the touch buttons, so the hints come back
    if (!touchUI && !help) {
      // the hint sits in the bottom corner, and steps aside for a fighter
      const hint = { x0: width - 230, x1: width - 20, y0: height - 26, y1: height - 4 };
      ctx.save(); ctx.globalAlpha = overlaps(hint, boxes) ? 0.15 : 0.85;
      const hintText = flow ? flow.hint : padUI ? 'R3  HORDE     START  PAUSE' : 'F1  MOVES     G  HORDE';
      if (hintText) neonText(hintText, width - 24, height - 14, 16, NEON.violet, { font: LABEL, align: 'right', weight: 500, glow: 0.4, core: false });
      ctx.restore();
    }
    if ((help || (padUI && paused)) && !touchUI) legend(boxes, padUI);
    if (debug) drawDebug(sim, camera, scene);
    return layout;
  }

  // the run's score, in the strip between P1's name and his round pips, with the last bonus beside it
  // (side 1: P1's bar is on the right in a mirrored view, so the score goes there, read inward from its edge)
  function score(flow, side = 0) {
    const off = Math.max(118, (labelW[side] || 0) + 16), y = BAR_Y + BAR_H + 6 + ST_H + 12, x = side ? width - 44 - off : 44 + off;
    const txt = String(Math.max(0, Math.floor(flow.score))).padStart(7, '0');
    const align = side ? 'right' : 'left', dir = side ? -1 : 1;
    const w = neonText(txt, x, y, 22, NEON.amber, { font: LABEL, align, weight: 600, glow: 0.7 });
    if (flow.bonus) neonText(flow.bonus, x + dir * (w + 10), y, 18, NEON.white, { font: LABEL, align, weight: 600, glow: 0.6, core: false });
  }

  // the move list, two lines at the bottom; it fades out wherever a fighter is under it
  function legend(boxes, padUI = false) {
    const h = 44, y0 = height - h;
    const covered = overlaps({ x0: 0, x1: width, y0, y1: height }, boxes);
    ctx.save(); ctx.globalAlpha = covered ? 0.18 : 1;
    const g = ctx.createLinearGradient(0, y0 - 10, 0, height);
    g.addColorStop(0, 'rgba(10,2,24,0)'); g.addColorStop(0.4, 'rgba(10,2,24,0.6)'); g.addColorStop(1, 'rgba(10,2,24,0.75)');
    ctx.fillStyle = g; ctx.fillRect(0, y0 - 10, width, h + 10);
    const line1 = padUI
      ? 'X Y A B = 1 2 3 4 (LEFT/RIGHT PUNCH, LEFT/RIGHT KICK)   STICK MOVES, BACK OR L1 WALKS BACK AND GUARDS A STRIKE THAT\'S COMING   DOWN CROUCH, DOWN-BACK GUARDS LOWS   UP JUMP   R1 THROW   R2 RUN'
      : 'U I J K = 1 2 3 4 (LEFT/RIGHT PUNCH, LEFT/RIGHT KICK)   A D MOVE, HOLD BACK TO STEP BACK (IT GUARDS A STRIKE THAT\'S COMING)   S CROUCH (DOWN-FORWARD CREEPS, DOWN-BACK GUARDS LOWS)   W JUMP   SHIFT RUN';
    const line2 = 'AIR 1 2 3 4, d+4 DIVE   d1 d1 d3 LOW RUSH   1124 FLASH ROUNDHOUSE   1234 NEON TORNADO   214 SPIN HEEL   334 CRESCENT   d3 d3 4 GROUND RUSH   d2 1 2 4 SKY SPIKE   f,f+2 COMET   1+3 / 2+4 THROW';
    neonText(line1, width / 2, y0 + 12, 17, NEON.cyan, { font: LABEL, weight: 500, glow: 0.4, core: false });
    neonText(line2, width / 2, y0 + 31, 17, NEON.pink, { font: LABEL, weight: 500, glow: 0.4, core: false });
    ctx.restore();
  }

  function drawDebug(sim, camera, scene) {
    const z = camera.zoom;
    ctx.save();
    const m = camera.mirror ? -1 : 1;   // mirrored view: the boxes flip with the world, the labels don't
    ctx.setTransform(m * dpr * z, 0, 0, dpr * z, dpr * (width / 2 - m * (camera.x + camera.shakeX) * z), dpr * (height / 2 - (camera.y + camera.shakeY) * z));
    for (const u of sim.units) {
      if (u.hidden) continue;
      const { hits, hurt } = sim.debugBoxes(u);
      drawBoxes(ctx, hits, hurt);
      ctx.font = `500 15px ${LABEL}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = NEON.white;
      const txt = `${u.state}${u.move ? ' ' + u.move : ''}${u.phase ? ' ' + u.phase : ''}${u.hitstop ? ' hs' + u.hitstop : ''}${u.stun ? ' st' + u.stun : ''}${u.buffer ? ' [' + u.buffer + ']' : ''} ${Math.round(u.stamina)}`;
      ctx.save(); ctx.translate(u.x, u.y - 150); ctx.scale(m, 1); ctx.fillText(txt, 0, 0); ctx.restore();
      ctx.fillStyle = NEON.pink; ctx.fillRect(u.x - 1, u.y - 3, 2, 6);
    }
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = `500 15px ${LABEL}`; ctx.fillStyle = NEON.violet;
    ctx.fillText(`${scene}  seed ${sim.seed}  step ${sim.stepCount}  ${sim.phase}${sim.phaseName ? '  ' + sim.phaseName : ''}`, 44, height - 22);
  }

  return { draw };
}

function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
