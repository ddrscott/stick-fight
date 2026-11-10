// The game. Wires fighter (A), fx (B), arena (D) and the combat sim (C), routes combat
// events to effects and camera, draws the HUD, and exposes window.__gauntlet.
import './fullscreen.js';   // first, so its F11 handler sits ahead of every other key listener (F11, and the desktop corner button)
import { camera } from './camera.js';
import { createFighter, MOVES, MOVE_DATA, RIG_KIT } from './fighter/index.js';
import { fitToGround } from './fighter/ground.js';   // the floor guard: nothing drawn goes under the floor
import { createLife } from './fighter/life.js';   // the life layer: eyeline, springs and props, fatigue (drawn only; ?life=0 turns it off)
import { createFX } from './fx/index.js';
import { createStatusFX, hitWeight, blockWeight } from './fx/status.js';   // state read off the bodies: stun halo, guard glint, dizzy stars, breath
import { createPerfectFX } from './fx/perfect.js';   // the perfect round finisher, drawn: the body thrown into the camera
import { createArena, drawJoints } from './arena/index.js';
import { createWorldCache, viewRect } from './arena/cache.js';   // the building's still art as bitmaps (README, Performance)
import { createCombat } from './combat/sim.js';
import { createInput, EMPTY_INPUT } from './combat/input.js';
import { createHUD, HUD_TOP } from './combat/hud.js';
import { FRAME_DATA } from './combat/frameData.js';
import { mulberry32 } from './combat/rng.js';
import { gameAudio } from './audio/index.js';   // audio: all sound logic lives in src/audio/
import { createOnline } from './net/online.js';   // online play: rooms, lockstep, readout (src/net/)
import { createFlow } from './flow/index.js';     // the arcade flow: title, menus, ladder, continue, scores (src/flow/)
import { setNet, adaptOnline } from './flow/netApi.js';
import { roster, getCharacter, TEMP_ID } from './characters/index.js';   // registers every character before the sim is made
import { botchEnabled, discover, techniques } from './flow/techniques.js';
import { roundTime, bestOf, winsFor, DEFAULT_ROUND_TIME, DEFAULT_BEST_OF } from './flow/rules.js';   // the round time and best-of the player picked   // the botch switch and the happy accidents found (src/combat/botch.js)
import { ACCIDENTS } from './combat/botch.js';
import { perf, perfOverlay } from './perf.js';
import { track } from './analytics.js';   // the tier a session settles on (README, Analytics)   // frame timing, and the ?perf=1 overlay (README, Performance)

const W = 1280, H = 720;
const P1_COLOR = '#f0f0f0', P2_COLOR = '#E85D00';
const glCanvas = document.getElementById('game');
const hudCanvas = document.getElementById('hud');
// The HUD canvas is never bigger than the screen pixels the stage covers (held sideways, the way the game is
// played): a Pixel 7's stage is about 1920 device px wide, so a 2x HUD (2560) was drawn and then shrunk.
// Up to 2x on a big screen, never under 1x. (The GL canvas is always 1280x720: createFX sizes it.)
const stageCss = Math.min(Math.max(innerWidth, innerHeight), Math.min(innerWidth, innerHeight) * 16 / 9);
const dpr = Math.max(1, Math.min(2, Math.round(stageCss * (window.devicePixelRatio || 1) / W * 4) / 4));
glCanvas.width = W * dpr; glCanvas.height = H * dpr;
hudCanvas.width = W * dpr; hudCanvas.height = H * dpr;

const fx = createFX(glCanvas, { width: W, height: H, dpr, layerScaling: true });   // every layer is drawn through applyCamera (scale = layer.width / W)
const arena = createArena('building');
const groundY = arena.floors && arena.floors.length ? arena.floors[0].y : 480;
const spawns = arena.spawns && arena.spawns.length >= 2 ? arena.spawns : [{ x: 480, y: groundY, facing: 1 }, { x: 800, y: groundY, facing: -1 }];
const fighters = [
  createFighter({ color: P1_COLOR, x: spawns[0].x, y: spawns[0].y, facing: spawns[0].facing }),
  createFighter({ color: P2_COLOR, x: spawns[1].x, y: spawns[1].y, facing: spawns[1].facing }),
];
const input = createInput(window);
const hud = createHUD(hudCanvas, { width: W, height: H, dpr });
const statusFX = createStatusFX();
const perfectFX = createPerfectFX();   // the perfect round finisher, drawn (src/fx/perfect.js)

// ---- integration wiring ------------------------------------------------------------------
// The glue owns camera shake (hitstop has to hold the frame dead still), so the FX's own
// shake and punch are off. The pile is drawn on the figures layer with the live fighters,
// the arena's foreground goes to the FX foreground layer, and the FX learns the floors.
if (fx.options) fx.options.shake = false;
// (no foreground opacity here: the compositor thins the foreground over fighters and bodies itself, owner req 5)
if ('bodiesInBackground' in arena) arena.bodiesInBackground = false;
function syncArenaToFx() {
  if (fx.reflect) {
    if (typeof arena.reflectY === 'number') fx.reflect.y = arena.reflectY;
    if (arena.gloss && typeof arena.gloss.strength === 'number') fx.reflect.strength = arena.gloss.strength;
    // the mirror covers the floor plane only: its depth, between the walls, not over the stairwell
    if (arena.gloss && typeof arena.gloss.depth === 'number') fx.reflect.depth = arena.gloss.depth;
    if (arena.gloss && typeof arena.gloss.x0 === 'number') { fx.reflect.x0 = arena.gloss.x0; fx.reflect.x1 = arena.gloss.x1; }
    if (arena.gloss && arena.gloss.gaps) fx.reflect.gaps = arena.gloss.gaps.map(g => ({ ...g }));
  }
  if (arena.floors && arena.floors.length) {
    try { fx.floors = arena.floors; fx.ground = Math.max(...arena.floors.map(f => f.y)); } catch (e) { /* older fx */ }
  }
}
syncArenaToFx();
// The compositor's preset owns exposure, sky, fog, far plane, lift, toe, vignette and
// weather; the arena's fills are pitched for it. Nothing else here touches those.
if (typeof fx.preset === 'function') { try { fx.preset('night-rain'); } catch (e) { console.warn('[glue] fx.preset:', e.message); } }
else if (typeof fx.weather === 'function') fx.weather('rain', { rate: 160, wind: -0.3 });
// the rain comes through the smashed pane: confine it to the arena's region (the preset's
// rate and wind are kept; an FX that ignores `region` just keeps raining everywhere)
if (arena.rainRegion && typeof fx.weather === 'function') fx.weather('rain', { rate: 160, wind: -0.3, region: arena.rainRegion });

// ---- effects state owned by the glue -------------------------------------------------
const lights = [];                     // dynamic point lights with a ttl
const shake = { trauma: 0, kickX: 0, kickY: 0, zoomPunch: 0 };
let lastHitWeight = 2;   // hitWeight of the last hit (a counter a step heavier), for the shake on its release
let shakeRng = mulberry32(7);
const trailPrev = [null, null];
const blockSparks = [];                // hard glyphs at a blocked contact, drawn on the emissive layer
// the block's glue effects by blockWeight: the chevron's size, life and spark lines, the light, the shake
const BLOCK_FX = [
  { scale: 0.55, ttl: 0.07, lines: 2, light: [45, 0.22], shake: 0.015 },   // light: a jab, a light kick
  { scale: 0.75, ttl: 0.09, lines: 3, light: [65, 0.32], shake: 0.03 },    // medium: a cross, a sweep
  { scale: 1, ttl: 0.1, lines: 3, light: [90, 0.5], shake: 0.06 },          // heavy: an ender (and a parry, as before)
];
let debug = false, paused = false, driven = false, sceneName = 'play', help = false;
// The life layer (src/fighter/life.js): a puppeteer's touches on the drawn pose, never the sim's
const life = createLife(); life.setFrameData(FRAME_DATA);
let lifeStep = -1;
let toast = null;   // TECHNIQUE FOUND 3/8, for a couple of seconds after a happy accident
let attract = false;                   // the attract mode's demo bout is on (see ---- attract mode)
let flow = null;                       // the arcade flow (see ---- arcade flow); null until it's made, off for ?scene= URLs

function light(x, y, radius, color, intensity, ttl) { lights.push({ x, y, radius, color, intensity, ttl, max: ttl }); }
function onEvent(ev) {
  if (!attract) gameAudio.event(ev);   // audio: every event also goes to the sound router (src/audio/index.js); the attract demo is silent
  hud.event(ev); statusFX.event(ev);   // counter, armor, parry and accident flashes on the overhead tracks and the bodies
  switch (ev.type) {
    case 'hit':
      // the FX burst is small and sits on the striking limb; the camera does nothing until
      // release. A body hit sheds no crate chunks.
      // Effects scale with the hit's weight (hitWeight): a light hit (jab, low jab, a light kick) gets a
      // few sparks and the contact flash, a medium one (cross, body blow) a few more, and only a heavy
      // one (ender, launcher, knockdown, splat, KO) the amber shockwave ring. A counter reads a step heavier.
      {
        const w = hitWeight(ev), cw = Math.min(2, w + (ev.counter ? 1 : 0));
        lastHitWeight = cw;
        const fxs = ev.ko ? 1.0 : w === 2 ? (ev.counter ? 0.9 : 0.3 + 0.4 * ev.strength) : cw === 2 ? 0.55 : cw === 1 ? 0.42 : 0.28;
        fx.hit({ x: ev.x, y: ev.y, strength: fxs, dir: ev.dir, flashR: (ev.flashR || 36) * (ev.counter ? 1.15 : 1), debris: 'none', ring: w === 2,
          flashColor: (FRAME_DATA[ev.move] && FRAME_DATA[ev.move].flashColor) || undefined });   // a move's own flash color (CHEF's Flambé)
        // a counter hit gets its own cyan double ring (a signal, so it shows on any weight), sized by the hit
        if (ev.counter && typeof fx.counterFlash === 'function') fx.counterFlash({ x: ev.x, y: ev.y, scale: w === 2 ? 1 : w === 1 ? 0.7 : 0.5 });
        light(ev.x, ev.y, [90, 130, 120 + 140 * ev.strength][cw], ev.counter ? [1.0, 0.25, 0.75] : [1.0, 0.62, 0.3], [0.5, 0.75, 0.8 + 0.5 * ev.strength][cw], ev.ko ? 0.5 : 0.22);
      }
      if (ev.knockdown || ev.ko) fx.dust({ x: ev.defender.x, y: ev.defender.y, dir: ev.dir });
      break;
    case 'graze':
      // a strike that touches a body on the floor without hitting it (sim graze): a small spark on the touch, no ring, no shake
      fx.hit({ x: ev.x, y: ev.y, strength: 0.12, dir: ev.dir, flashR: 12, debris: 'none', ring: false });
      light(ev.x, ev.y, 70, [1.0, 0.62, 0.3], 0.35, 0.12);
      break;
    case 'release':
      // the freeze lets go: shake, a directional kick (with a real vertical component), and
      // a zoom punch all land on this frame
      // scaled by the weight of the hit it releases (lastHitWeight): a jab barely nudges the frame
      {
        const k = ev.ko ? 1 : [0.25, 0.55, 1][lastHitWeight];
        shake.trauma = Math.min(1, shake.trauma + (ev.ko ? 0.9 : (0.3 + 0.5 * ev.strength) * k * k));
        shake.kickX = ev.dir * (12 + 14 * ev.strength) * k; shake.kickY = -(13 + 10 * ev.strength) * k;
        shake.zoomPunch = (0.04 + 0.04 * ev.strength) * (0.4 + 0.6 * k);
      }
      break;
    case 'block':
      // An ordinary block is common, so it reads small and quick, scaled by the blocked strike
      // (blockWeight): a jab gets a small chevron, a few cool sparks and a faint light; an ender a bit
      // more. A parry (its own PARRY flash in status.js) and a broken throw keep the full glyph.
      {
        const w = ev.parry || ev.move === 'throw' ? 2 : blockWeight(ev), B = BLOCK_FX[w];
        blockSparks.push({ x: ev.x, y: ev.y, dir: ev.dir, ttl: B.ttl, max: B.ttl, scale: B.scale, lines: B.lines });
        if (!ev.parry && ev.move !== 'throw' && typeof fx.guardSpark === 'function') fx.guardSpark({ x: ev.x, y: ev.y, dir: -ev.dir, weight: w });
        light(ev.x, ev.y, B.light[0], [0.6, 0.75, 1.0], B.light[1], B.ttl);
        shake.trauma = Math.min(1, shake.trauma + B.shake);
      }
      break;
    case 'thud':
      fx.dust({ x: ev.x - 10, y: ev.y, dir: -1 }); fx.dust({ x: ev.x + 10, y: ev.y, dir: 1 });
      shake.trauma = Math.min(1, shake.trauma + 0.3);
      break;
    case 'wallImpact':
      // splats and bounces: the compositor's wall helper (camera jolt, dust), cyan light on the wall
      if (typeof fx.wallImpact === 'function') fx.wallImpact({ x: ev.x, y: ev.y, side: ev.side, strength: ev.strength });
      else fx.dust({ x: ev.x, y: ev.y + 60, dir: -ev.side });
      light(ev.x, ev.y, 160, [0.3, 0.9, 1.0], 0.6 * ev.strength + 0.2, 0.25);
      shake.trauma = Math.min(1, shake.trauma + 0.2 * ev.strength);
      break;
    case 'wall':
      // a body into the wall: dust, not chunks (crate chunks live 6 to 10s and litter the floor)
      fx.hit({ x: ev.x, y: ev.y, strength: ev.strength * 0.5, dir: ev.dir, flashR: 24, debris: 'none' });   // no grey chunks on the floor line
      fx.dust({ x: ev.x, y: ev.y + 60, dir: ev.dir });
      shake.trauma = Math.min(1, shake.trauma + 0.35);
      break;
    case 'relocate':
      relocateFX(ev);
      break;
    case 'perfectSplat':   // the perfect finisher: the body hits the glass (src/fx/perfect.js draws it)
      shake.trauma = Math.min(1, shake.trauma + 0.7); shake.zoomPunch = 0.06;
      break;
    case 'land': case 'body':
      fx.dust({ x: ev.x, y: ev.y, dir: ev.dir || 1 });
      break;
    case 'footstep':
      fx.dust({ x: ev.x, y: ev.y, dir: -ev.dir });
      break;
    case 'round':
      poseState.clear(); drawnJ.clear(); drawnOff.clear(); life.reset(); camCut = true;   // spawns face each other: no turnaround out of the last round's facing (and no stale drawn pose for the camera)
      if (look.floor) startOnFloor(look.floor);   // an arcade stage fought downstairs: every round starts there
      arena.liveColors = [sim.units[0].color || P1_COLOR, sim.units[1].color || P2_COLOR];
      syncArenaToFx();
      break;
    case 'goon':
      arena.liveColors = [sim.units[0].color || P1_COLOR, ...sim.units.slice(1).map(u => u.color)];
      if (ev.unit) fx.dust({ x: ev.unit.x, y: ev.unit.y, dir: ev.unit.facing });
      break;
    case 'botch':
      fx.dust({ x: ev.unit.x, y: ev.unit.y, dir: -ev.unit.facing });
      break;
    case 'accident': {
      // a technique found by a player on this machine goes in the book (the pause menu's list).
      // Its light comes from the glint statusFX draws over the head, not from here.
      const u = ev.unit, mine = u.kind === 'human' || (u.kind === 'net' && online.active && u.id === (online.role === 'host' ? 0 : 1));
      if (mine && !attract && discover(ev.id)) { const t = techniques(); toast = { text: `TECHNIQUE FOUND  ${t.filter(x => x.found).length}/${t.length}`, t: 2.2 }; }
      break;
    }
  }
  if (flow && flow.on) flow.event(ev);   // flow: scoring
}

// extra horde goons need their own rigs
const makeRig = (color) => { const g = sim.units[0]; return createFighter({ color, x: g.x, y: g.y, facing: -1 }); };
const sim = createCombat({ fighters, arena, input, onEvent, makeRig, moves: MOVES || [], moveData: MOVE_DATA || null });
gameAudio.attach(sim);   // audio
// online: net.host()/join(code)/openLobby(); a match runs as the 'online' scene, stepped by online.advance
// endMatch goes to the flow (its VERSUS ONLINE end screen) when the flow is running, and only
// falls back to the demo for a ?scene= page; online.js's own "rival left" panel is closed in favor of it
const online = createOnline({ sim, input, startMatch: (o) => setScene('online', o), botchSetting: () => botchEnabled(), rulesSetting: () => ({ roundTime: roundTime(), winsNeeded: winsFor(bestOf()) }),
  endMatch: (reason) => { if (flow && flow.on) { flow.netEnded(reason); setTimeout(() => online.closeLobby(), 0); } else setScene('attract'); } });

// ---- scenes ---------------------------------------------------------------------------
// A scripted controller: walks into range, then presses each move in turn as soon as the
// previous one connected (cancel) or finished.
function script(seq) {
  let stage = 0, pressUntil = 0, pressing = null, waitId = -1;
  return (me, opp, sim) => {
    if (sim.phase !== 'fight') return EMPTY_INPUT;
    const out = { ...EMPTY_INPUT };
    const step = sim.stepCount;
    const next = seq[stage];
    // press the next move only once the previous press has become an attack (attackId moved)
    if (next && step >= pressUntil && me.attackId !== waitId) {
      const dist = Math.abs(opp.x - me.x);
      const idle = me.state === 'idle' || me.state === 'walk';
      // keep walking in (also through recovery: the sim lets an attacker press a stumbling
      // victim), press when the next move reaches
      if (me.state === 'attack' && me.hitConfirmed) { pressing = next; pressUntil = step + 3; waitId = me.attackId; stage++; }   // cancel on hit, wherever he is
      else if (dist > sim.reach(next) - 12) out.dx = Math.sign(opp.x - me.x);
      else if (idle) { pressing = next; pressUntil = step + 3; waitId = me.attackId; stage++; }
    }
    if (step < pressUntil && pressing) out[pressing] = true;
    return out;
  };
}
function place(i, x, facing) { const u = sim.units[i]; u.x = x; u.facing = facing; u.rig.x = x; u.rig.facing = facing; u.rig.update(0); }
// a test script's press, dropped if it would botch (src/combat/botch.js): the scenes' punishers press
// every few steps, and the presses that land in their own strike were thrown away by the buffer anyway
const clean = (me, inp) => (sim.pressMistimed && sim.pressMistimed(me, { ...EMPTY_INPUT, ...inp }) ? {} : inp);

// v2 test scenes: a timeline of phases. Each phase resets the round, places the pair, holds
// P2's input (crouch, guard, down-back...) and presses P1's buttons at fixed steps, so heights,
// strings, enders and trick shots can be measured deterministically. setScene(name, { only: k })
// runs one phase; otherwise the phases cycle.
// The phases were written for the first building (1280 wide, its stairwell at 760..870); the building is
// twice as wide now, so every phase's spots are moved over by SCENE_SHIFT, which puts the old default pair
// (560, 650) just left of the middle with the left stairwell as far behind P1 as the old one was ahead.
// W0() and W1() take the shift back off, so a spot by a wall is still by that wall. Spots written against
// the new building (the stair and floor-break phases) say so with abs.
const SCENE_SHIFT = 500;
const W0 = () => sim.bounds.x0 - SCENE_SHIFT, W1 = () => sim.bounds.x1 - SCENE_SHIFT;
function timeline(phases, o = {}) {
  let k = o.only != null ? +o.only : 0, t = 0;
  sim.phaseName = '';
  const begin = () => {
    const ph = phases[k];
    sim.startRound(1, { skipIntro: true });
    const [a0, a1] = ph.at ? ph.at() : [560, 650], sh = ph.abs ? 0 : SCENE_SHIFT, x0 = a0 + sh, x1 = a1 + sh;
    place(0, x0, x0 < x1 ? 1 : -1); place(1, x1, x0 < x1 ? -1 : 1);
    if (ph.setup) ph.setup();
    sim.phaseName = ph.name; t = 0; sim.units.forEach(u => { u.reacted = 0; });
  };
  const p1 = (me, opp, s) => {
    if (s.phase !== 'fight') return EMPTY_INPUT;
    const ph = phases[k];
    if (t === 0 && !sim.phaseName) begin();
    const out = { ...EMPTY_INPUT, ...(ph.hold1 || {}) };
    if (ph.dash && t < ph.dash) Object.assign(out, { dx: me.facing, run: true });
    if (ph.react && !me.reacted) { const r = ph.react(me, opp, t); if (r) { me.reacted = t; Object.assign(out, r); } }
    if (ph.react && me.reacted && t - me.reacted < 3 && t > me.reacted) Object.assign(out, ph.react(me, opp, -1) || {});
    if (ph.walkIn && t < ph.walkIn) { if (Math.abs(opp.x - me.x) > 78) out.dx = me.facing; else if (!me.walkedIn) { me.walkedIn = true; Object.assign(out, { rk: true, down: true }); } }
    if (t === 0) me.walkedIn = false;
    // after the scripted part: walk up and jab (to show the fight goes on wherever they ended up). A
    // jab every 24 steps lands its 4th press in the 3rd jab's startup, a press the buffer used to drop;
    // it's skipped (clean) rather than botched, so the scene plays as it always did
    if (ph.chase && t >= ph.chase && me.state !== 'vault' && opp.state !== 'down' && opp.state !== 'getup') {
      const d = opp.x - me.x;
      if (Math.abs(d) > 82) out.dx = Math.sign(d); else if (t % 24 === 0) Object.assign(out, clean(me, { lp: true }));
    }
    for (const [at, inp] of ph.p1) if (t >= at && t < at + 3) Object.assign(out, typeof inp === 'function' ? inp(me) : inp);
    if (ph.p1f) { const r = ph.p1f(me, opp, t) || {}; Object.assign(out, r); if (r.back) out.dx = me.x > opp.rig.joints.hip.x ? 1 : -1; }   // a per-step script (the getup and ground scenes); back: away from his body
    if (++t > ph.dur) { if (o.only != null) { t = ph.dur; return EMPTY_INPUT; } k = (k + 1) % phases.length; sim.phaseName = ''; t = 0; }
    return out;
  };
  const p2 = (me, opp, s) => {
    const ph = phases[k];
    if (s.phase !== 'fight' || !ph || t < 2) return EMPTY_INPUT;
    const h = typeof ph.p2 === 'function' ? ph.p2(me, opp, t) : ph.p2 || {};
    // `back: true` is held away from P1, whichever side he is on
    return { ...EMPTY_INPUT, ...h, dx: h.back ? (me.x > opp.x ? 1 : -1) : (h.dx || 0) };
  };
  sim.setController(0, 'script', p1);
  sim.setController(1, 'script', p2);
  sim.resetMatch({ seed: 1, skipIntro: true });
  begin();
}
const B = (b, extra) => ({ [b]: true, ...(extra || {}) });
// faint-test: P1 faints on the spot; alternate(n): a fresh press every n steps from step 20, left then right, each held half the beat
const faintP1 = () => { const u = sim.units[0]; u.stamina = 0; sim.faintNow(u); };
const alternate = (n) => (me, o, t) => (t >= 20 && (t - 20) % n < (n >> 1) ? { dx: Math.floor((t - 20) / n) % 2 ? 1 : -1 } : {});
const D = (b) => ({ [b]: true, down: true });
const nearRight = () => [W1() - 150, W1() - 50];
// spots measured from stairwell k's near edge, toward it (k 1, the right one: x0 + a; k 0, the left one: mirrored)
const wellAt = (k, a, b) => { const w = sim.stairwells[k] || sim.stairwells[0]; return k === 0 ? [w.x1 - a, w.x1 - b] : [w.x0 + a, w.x0 + b]; };
// stair-test: put fighter i on flight k at x (or on a floor, k -1), facing the given way
function onFlight(i, k, x, facing) {
  const u = sim.units[i];
  place(i, x, facing);
  if (k >= 0) { u.stair = k; u.y = sim.stairY(k, x); u.floor = u.y < (sim.floors[0].y + sim.floors[1].y) / 2 ? 0 : 1; }
  else { u.stair = -1; u.floor = -k - 1; u.y = sim.floors[u.floor].y; }
  u.rig.y = u.y; u.rig.update(0); sim.rigUpd(u, 0);
}
const LOWER = -2;   // onFlight's k for the lower floor
// a fighter walks to x on whatever ground he's on, then stops
const walkTo = (x) => (me) => (Math.abs(me.x - x) > 6 ? { dx: Math.sign(x - me.x) } : {});
const stairX = (k, along) => { const st = sim.stairs[k]; return st.head + st.dir * along; };
// botch-test and accident-test: press inp on the step the strike `move` is k steps past its key (rel: 'start',
// 'active', 'recover', on the strike's own clock, sim.stepsSince), as the sim will see it when the press lands
const since = (rel, k, inp, move) => (me, o, t) => (t < 0 ? (typeof inp === 'function' ? inp(me) : inp)
  : me.state === 'attack' && me.move === move && sim.stepsSince(me, rel) === k ? (typeof inp === 'function' ? inp(me) : inp) : null);
const TOK_BTN = { 1: 'lp', 2: 'rp', 3: 'lk', 4: 'rk' };
const ACC_FROM = { scissorKick: B('lk'), supermanPunch: B('rk'), pivotBackfist: B('rk'), flashKick: D('rp'), helicopter: D('rk'),
  flyingTackle: (me) => ({ rp: true, dx: me.facing }), crossKnee: B('rp'), springUppercut: D('lk') };
// where each technique lands: the backfist and the helicopter on a guard that held the first strike
const ACC_AT = { flyingTackle: [300, 430], flashKick: [580, 650], springUppercut: [580, 650], pivotBackfist: [570, 650] };
const ACC_P2 = { pivotBackfist: (me, o) => (o.move === 'roundhouse' ? { back: true } : {}), helicopter: { back: true, down: true } };
// getup-test: P1 sweeps P2 down, walks up to stand at his feet (as close as a standing body may), and P2
// picks a getup option; `over(...)` adds what P1 does once he's there
const hipOf = (u) => u.rig.joints.hip.x;
const over = (then) => (me, o, t) => {
  if (t >= 40 && t < 112 && o.state === 'down') return Math.abs(hipOf(o) - me.x) > 150 ? { dx: Math.sign(hipOf(o) - me.x) } : {};
  return t >= 112 && then ? then(me, o, t) : {};
};
const isWakeOf = (u) => u.state === 'attack' && sim.FRAME_DATA[u.move] && sim.FRAME_DATA[u.move].wake;
// punish a wake-up strike's stand-up: walk in, cross when it reaches
const punishRise = (guard) => (me, o) => {
  if (isWakeOf(o) && o.phase !== 'recovery') return guard;
  if ((isWakeOf(o) && o.phase === 'recovery') || (o.state === 'idle' && me.state === 'idle' && o.stoodAt == null)) {
    const d = Math.abs(o.x - me.x);
    return d > sim.reachOf(me, 'cross') - 12 ? { dx: Math.sign(o.x - me.x) } : clean(me, { rp: true });
  }
  return me.state === 'blockstun' ? guard : {};
};
const techAt = (k) => (me) => (me.state === 'knockdown' && me.launchStep != null && sim.stepCount - me.launchStep >= k && sim.stepCount - me.launchStep < k + 2 ? { lp: true } : {});
// parry-test: P2 strikes, P1 taps toward him (sim.toLive: steps until the strike can hit) and punishes a parry with the cross
const towardOf = (me, o) => Math.sign(o.x - me.x) || me.facing;
const tapAt = (k, low = false) => (me, o, t) => {
  if (o.state === 'hitstun' && sim.log.some(r => r.type === 'parry')) return Math.abs(o.x - me.x) > sim.reachOf(me, 'cross') - 8 ? { dx: towardOf(me, o) } : clean(me, { rp: true });   // the punish
  const live = sim.toLive(o);
  if (o.state === 'attack' && live <= k && live > k - 2) return { dx: towardOf(me, o), down: low };
  return low && o.state === 'attack' ? { down: true } : {};
};
// refund-test's follow-up: jab the juggled body twice, each once the last jab has connected, then walk over the body
// and stomp it once it's down
const refundCombo = () => (me, o, t) => {
  if (t === 0) { me.jj = 0; me.jjId = -1; }
  if (t < 80) return {};
  if (me.move === 'jab' && me.attackId !== me.jjId) { me.jj = (me.jj || 0) + 1; me.jjId = me.attackId; }   // a juggle jab came out
  if (o.state === 'knockdown' && o.juggle && (me.jj || 0) < 2 && !me.buffer && (me.state !== 'attack' || (me.hitConfirmed && me.phase !== 'startup')))
    return me.last && me.last.lp ? {} : clean(me, { lp: true });
  if (o.state === 'down' && !o.otgHit && me.state !== 'attack') {
    if (sim.stompOK && sim.stompOK(me)) return t % 2 ? { rk: true, down: true } : {};
    return { dx: Math.sign(hipOf(o) - me.x) };
  }
  return {};
};
const wakeAt = (inp, at = 120) => (me, o, t) => (me.state === 'down' && t >= at && t < at + 3 ? (typeof inp === 'function' ? inp(me, o) : inp) : {});
// a fresh press away from the opponent (-1) or toward him (1), by the side the body lies on (u.home)
const rollWay = (k) => (me, o) => ({ dx: k * -(me.home || Math.sign(hipOf(me) - o.x) || 1) });
// P1 keeps his distance from the body: walks to `d` px from its hip and stands there
const standOff = (d) => (me, o, t) => (t >= 40 && t < 112 && o.state === 'down' && Math.abs(Math.abs(hipOf(o) - me.x) - d) > 8 ? { dx: Math.sign(hipOf(o) - me.x) * (Math.abs(hipOf(o) - me.x) > d ? 1 : -1) } : {});
// ground-test: P1 sweeps him down, walks in until his low can reach the body (sim.segGap: the drawn limb against
// the drawn body, measured on the press's contact pose is too much to ask here, so a fixed spot over the shins),
// then presses `inp` twice; the first lands as the knockdown's ground hit, the second grazes
// the low jab's fist is at crouch height, over the shins from the feet, so its scene stands P1 on the head side: a
// body always lands feet toward whoever knocked it down, so he's placed there once it's down (a test setup, not a move)
const overTop = (inp) => (me, o, t) => {
  if (t === 100 && o.state === 'down') { const hx = hipOf(o), s = Math.sign(o.x - hx); place(0, hx - s * 46, s); me.home = -s; o.home = s; }
  return (t >= 140 && t < 143) || (t >= 175 && t < 178) ? (typeof inp === 'function' ? inp(me) : inp) : {};
};
const lowTwice = (inp, at2 = 170, d = 190) => (me, o, t) => {
  if (t >= 40 && t < 112) return standOff(d)(me, o, t);
  return (t >= 112 && t < 115) || (t >= at2 && t < at2 + 3) ? (typeof inp === 'function' ? inp(me) : inp) : {};
};
const PHASES = {
  // ground-test: each low on a floored body, the first one the ground hit (about half damage, counted in the combo),
  // the second a graze (a flick, no damage); a mid that touches grazes; the stomp still the biggest
  ground: [
    { name: 'LOW JAB from the head side: a ground hit, then a graze', p1: [[10, D('rk')]], p1f: overTop(D('lp')), dur: 260 },
    { name: 'LOW KICK (down+3) at the feet: a ground hit, then a graze', p1: [[10, D('rk')]], p1f: lowTwice(D('lk'), 170, 60), dur: 230 },
    { name: 'STOMP (down+4), then a low kick: the stomp is the ground hit, the kick grazes', p1: [[10, D('rk')], [124, D('rk')]], p1f: (me, o, t) => (t >= 40 && t < 112 && o.state === 'down' && Math.abs(hipOf(o) - me.x) > 150 ? { dx: Math.sign(hipOf(o) - me.x) } : t >= 222 && t < 225 ? D('lk') : {}), dur: 260 },
    { name: 'SWEEP from outside the stomp: it falls short of the feet, nothing', p1: [[10, D('rk')]], p1f: lowTwice(D('rk'), 300, 190), dur: 230 },
    { name: 'a mid that touches the body (the axe kick, forward+4): a graze', p1: [[10, D('rk')]], p1f: lowTwice((me) => ({ rk: true, dx: me.facing }), 300, 100), dur: 230 },
  ],
  getup: [
    { name: 'no input: he lies there, then stands up by himself after 1s', p1: [[10, D('rk')]], p1f: over(), dur: 300 },
    { name: 'up: he stands in place at once', p1: [[10, D('rk')]], p1f: over(), p2: wakeAt({ jump: true }), dur: 240 },
    { name: 'roll away with him over the body: back on his own side, facing him', p1: [[10, D('rk')]], p1f: over(), p2: wakeAt(rollWay(-1)), dur: 260 },
    { name: 'roll toward him standing over the body: crosses under him to his other side', p1: [[10, D('rk')]], p1f: over(), p2: wakeAt(rollWay(1)), dur: 260 },
    { name: 'roll toward him from across the room: a short roll that stops short, same side', p1: [[10, D('rk')]], p1f: standOff(330), p2: wakeAt(rollWay(1)), dur: 260 },
    { name: 'roll away with nobody near: the same roll back', p1: [[10, D('rk')]], p1f: standOff(330), p2: wakeAt(rollWay(-1)), dur: 260 },
    { name: 'roll away into the wall: a short roll in place, same side', at: () => [W1() - 230, W1() - 140], p1: [[10, D('rk')]], p1f: over(), p2: wakeAt(rollWay(-1)), dur: 260 },
    { name: 'roll toward him with his back to the wall: no room past him, he stays on his side', at: () => [W1() - 30, W1() - 110], p1: [[10, { lp: true, lk: true }]], p1f: (me, o, t) => (t > 40 && o.state === 'down' ? walkTo(W1() + SCENE_SHIFT)(me) : {}), p2: wakeAt(rollWay(1), 150), dur: 300 },
    { name: 'WAKE KICK (1 or 3) into him standing at the feet: knockdown', p1: [[10, D('rk')]], p1f: over(), p2: wakeAt({ lk: true }), dur: 260 },
    { name: 'WAKE SWEEP (2 or 4) along the floor: knockdown', p1: [[10, D('rk')]], p1f: over(), p2: wakeAt({ rk: true }), dur: 260 },
    { name: 'WAKE KICK blocked standing: the rise is punished', p1: [[10, D('rk')]], p1f: over(punishRise({ back: true })), p2: wakeAt({ lk: true }), dur: 300 },
    { name: 'WAKE SWEEP blocked down-back: the rise is punished', p1: [[10, D('rk')]], p1f: over(punishRise({ back: true, down: true })), p2: wakeAt({ rk: true }), dur: 300 },
  ],
  // stomp-test: the same knockdown, then P1 stomps (d+4) over the body; P2 stays down, rises through it, or waits it out
  stomp: [
    { name: 'STOMP d+4 on a body that stays down: 9 damage, pinned under the heel', p1: [[10, D('rk')], [124, D('rk')]], p1f: over(), dur: 320 },
    { name: 'a greedy STOMP: the wake kick rises through its startup and punishes it (counter)', p1: [[10, D('rk')], [124, D('rk')]], p1f: over(), p2: wakeAt({ lk: true }, 121), dur: 300 },
    { name: 'STOMP whiffs on a roll: open for the whole recovery', p1: [[10, D('rk')], [124, D('rk')]], p1f: over(), p2: wakeAt({ dx: 1 }, 118), dur: 300 },
    { name: 'STOMP lands, he wakes kicking at once: the stomper guards it', p1: [[10, D('rk')], [124, D('rk')]], p1f: over((me, o, t) => (t > 160 ? { back: true } : {})), p2: (me, o, t) => (me.state === 'down' && t > 150 && t % 3 === 0 ? { lk: true } : {}), dur: 320 },
    { name: "STOMP lands, the stomper doesn't guard: the wake kick punishes", p1: [[10, D('rk')], [124, D('rk')]], p1f: over(), p2: (me, o, t) => (me.state === 'down' && t > 150 && t % 3 === 0 ? { lk: true } : {}), dur: 320 },
    { name: 'one ground hit per knockdown: a second stomp only grazes him', p1: [[10, D('rk')], [124, D('rk')], [210, D('rk')]], p1f: over(), dur: 340 },
  ],
  // air-recovery-test: P1 launches P2 (d+2); P2 presses k steps after the last hit (techAt), or mashes. Then the
  // falling attacks: a second jab after a whiffed air attack, a press mid-swing tangling up, an attack off the vault
  airRecovery: [
    { name: 'launched, no press: he lands on his back', at: () => [580, 650], p1: [[10, D('rp')]], dur: 200 },
    { name: 'a press too early (12 frames in): locked out, he lands on his back', at: () => [580, 650], p1: [[10, D('rp')]], p2: techAt(24), dur: 200 },
    { name: 'a press as the window opens: he flips upright with a jab', at: () => [580, 650], p1: [[10, D('rp')]], p2: techAt(38), dur: 200 },
    { name: 'a later press: he flips upright and lands, no jab', at: () => [580, 650], p1: [[10, D('rp')]], p2: techAt(56), dur: 200 },
    { name: 'mashing never recovers (each early press keeps it locked)', at: () => [580, 650], p1: [[10, D('rp')]], p2: (me, o, t) => (me.state === 'knockdown' && t % 6 < 2 ? { lp: true } : {}), dur: 220 },
    { name: 'a real juggle still connects: the jab lands before the window opens', at: () => [580, 650], p1: [[10, D('rp')], [34, B('lp')]], p2: techAt(38), dur: 220 },
    { name: 'SECOND AIR ATTACK: a jump kick whiffs, he runs in under it, the jab on the way down hits', at: () => [470, 760], p1: [[2, (me) => ({ jump: true, dx: me.facing })], [6, B('lk')], [46, B('lp')]],
      p2: (me, o, t) => (t >= 5 && t < 50 ? { dx: Math.sign(o.x - me.x), run: true } : {}), dur: 200 },
    { name: 'a second press while the kick still swings: TANGLED', at: () => [400, 900], p1: [[2, (me) => ({ jump: true, dx: me.facing })], [10, B('lk')], [22, B('lp')]], dur: 260 },
    { name: 'FALL ATTACK: an air roundhouse out of the vault after a floor break (he is still down, so it lands short)', at: () => [500, 590], p1: [[10, B('rp')], [32, B('lp')], [50, B('rk')]],
      p1f: (me) => (me.state === 'vault' && me.vaultPhase === 'clip' && me.rig.current.t > 0.55 && me.rig.current.t < 0.6 ? { rk: true } : {}), dur: 420 },
  ],
  // parry-test: the universal parry, P1 against P2's strikes
  parry: [
    { name: 'PARRY: a tap forward just before his jab lands, then the cross punishes', p2: (me, o, t) => (t >= 20 && t < 23 ? { lp: true } : {}), p1: [], p1f: tapAt(3), dur: 160 },
    { name: 'PARRY a mid (snap kick) the same way', p2: (me, o, t) => (t >= 20 && t < 23 ? { lk: true } : {}), p1: [], p1f: tapAt(3), dur: 160 },
    { name: 'a tap 8 frames early: the window has closed, he is hit', p2: (me, o, t) => (t >= 20 && t < 23 ? { lp: true } : {}), p1: [[4, (me) => ({ dx: me.facing })]], dur: 140 },
    { name: 'holding forward is no tap: he is hit', p2: (me, o, t) => (t >= 20 && t < 23 ? { lp: true } : {}), p1: [], hold1: { dx: 1 }, dur: 140 },
    { name: 'a low (sweep) against a standing tap: hit', p2: (me, o, t) => (t >= 20 && t < 23 ? { rk: true, down: true } : {}), p1: [], p1f: tapAt(3), dur: 160 },
    { name: 'down-forward PARRIES the low sweep', p2: (me, o, t) => (t >= 20 && t < 23 ? { rk: true, down: true } : {}), p1: [], p1f: tapAt(3, true), dur: 180 },
    { name: 'a jump-in air attack, PARRIED standing', at: () => [560, 720], p2: (me, o, t) => (t >= 10 && t < 13 ? { jump: true, dx: -1 } : t >= 26 && t < 29 ? { lk: true } : {}), p1: [], p1f: tapAt(3), dur: 200 },
    { name: "a throw can't be parried", at: () => [560, 640], p2: (me, o, t) => (t >= 20 && t < 23 ? { lp: true, lk: true } : {}), p1: [[21, (me) => ({ dx: me.facing })]], dur: 160 },
    { name: 'mashing forward never parries (each tap keeps the lockout running)', p2: (me, o, t) => (t >= 30 && t < 33 ? { lp: true } : {}), p1: [], p1f: (me, o, t) => (t % 8 < 4 ? { dx: me.facing } : {}), dur: 160 },
  ],
  mixup: [
    { name: 'high vs crouch (ducks)', p2: { down: true }, p1: [[20, B('lp')]], dur: 90 },
    { name: 'low vs standing guard (hits)', p2: { back: true }, at: () => [578, 650], p1: [[20, D('lk')]], dur: 100 },
    { name: 'mid vs crouch (hits)', p2: { down: true, back: true }, p1: [[20, B('lk')]], dur: 100 },
    { name: 'low vs down-back (blocked)', p2: { down: true, back: true }, p1: [[20, D('lk')]], dur: 100 },
    { name: 'high vs standing guard (blocked)', p2: { back: true }, p1: [[20, B('rp')]], dur: 100 },
    { name: 'overhead vs crouch (hits)', p2: { down: true }, at: () => [540, 650], p1: [[20, (me) => ({ rk: true, dx: me.facing })]], dur: 120 },
  ],
  stamina: [
    { name: 'spam on a guard', p2: { block: true }, hold1: { dx: 1 }, at: () => [570, 650], dur: 600,
      p1: Array.from({ length: 70 }, (_, i) => [10 + i * 8, B(['lp', 'rp', 'lk', 'rk'][i % 4])]) },
  ],
  // stamina refunds (README, Stamina): a hit gives back half its price, a block a quarter, a whiff nothing, and
  // the press that empties the bar doesn't faint him if it hits. combo: after NEON TORNADO's launch, a jab each
  // time the juggle can take one (two of them), then over to the body and the stomp once it's down.
  refund: [
    { name: 'NEON TORNADO, two juggle jabs, STOMP from a full bar: refunds on every hit, no faint', at: () => [570, 650], dur: 420,
      p1: [[10, B('lp')], [26, B('rp')], [46, B('lk')], [70, B('rk')]], p1f: refundCombo() },
    { name: 'the same NEON TORNADO from out of range at 100: every press whiffs, no refund', at: () => [470, 650], dur: 300,
      p1: [[10, B('lp')], [26, B('rp')], [46, B('lk')], [70, B('rk')]] },
    { name: 'a cross at 12 stamina that hits: it empties the bar, connects, and he is left on 1 plus the refund (LOW, no faint)', at: () => [570, 650], dur: 220,
      setup: () => { sim.units[0].stamina = 12; sim.units[0].regenAt = 1e9; }, p1: [[10, B('rp')]] },
    { name: 'the same cross at 12 into a guard: blocked, so he faints', at: () => [570, 650], dur: 300,
      setup: () => { sim.units[0].stamina = 12; sim.units[0].regenAt = 1e9; }, p2: { back: true }, p1: [[10, B('rp')]] },
    { name: 'the same cross at 12 from out of range: it whiffs, so he faints as it recovers', at: () => [470, 650], dur: 300,
      setup: () => { sim.units[0].stamina = 12; sim.units[0].regenAt = 1e9; }, p1: [[10, B('rp')]] },
  ],
  // fainted (README, Faint): rooted, and alternating left/right presses shake it off faster. P1 faints on the
  // spot at the start of each phase; P2 stands there unless the phase says otherwise. Presses start 20 steps in.
  faint: [
    { name: 'fainted, no input: the full 1.5 s', at: () => [520, 680], setup: faintP1, p1: [], dur: 220 },
    { name: 'steady alternation at the best rate (a fresh press every 12 steps, 100 ms): about 0.9 s', at: () => [520, 680], setup: faintP1, p1: [], p1f: alternate(12), dur: 220 },
    { name: 'a calmer rhythm (a press every 20 steps, 6 a second): about 1 s', at: () => [520, 680], setup: faintP1, p1: [], p1f: alternate(20), dur: 220 },
    { name: 'holding a direction: rooted, no gain', at: () => [520, 680], setup: faintP1, p1: [], hold1: { dx: 1 }, dur: 220 },
    { name: 'mashing one direction (a press every 8 steps): no gain past the first', at: () => [520, 680], setup: faintP1, p1: [], p1f: (me, o, t) => (t >= 20 && t % 8 < 4 ? { dx: 1 } : {}), dur: 220 },
    { name: 'frantic alternation (a flip every 5 steps, 42 ms): slower than the steady rhythm', at: () => [520, 680], setup: faintP1, p1: [], p1f: (me, o, t) => (t >= 20 ? { dx: Math.floor((t - 20) / 5) % 2 ? 1 : -1 } : {}), dur: 220 },
    { name: 'shaking under a jab, 1, 1: the hits still knock him back', setup: faintP1, p1: [], p1f: alternate(12), p2: (me, o, t) => (t === 40 || t === 56 ? { lp: true } : {}), dur: 220 },
  ],
  strings: [
    { name: 'FLASH ROUNDHOUSE 1,1,2,4', p1: [[10, B('lp')], [26, B('lp')], [42, B('rp')], [62, B('rk')]], dur: 200 },
    { name: 'UPTOWN 1,2,3', p1: [[10, B('lp')], [26, B('rp')], [46, B('lk')]], dur: 150 },
    { name: 'NEON TORNADO 1,2,3,4', p1: [[10, B('lp')], [26, B('rp')], [46, B('lk')], [70, B('rk')], [150, B('rp')]], dur: 260 },
    { name: 'SPIN HEEL 2,1,4 (wall)', at: () => [W1() - 260, W1() - 170], p1: [[10, B('rp')], [32, B('lp')], [50, B('rk')]], dur: 220 },
    { name: 'CRESCENT 3,3,4', p1: [[10, B('lk')], [30, B('lk')], [52, B('rk')]], dur: 220 },
    { name: 'GROUND RUSH d3,d3,4', p1: [[10, D('lk')], [30, D('lk')], [52, B('rk')]], dur: 220 },
    { name: 'SKY SPIKE d2 then 1,2,4', at: () => [570, 640], p1: [[10, D('rp')], [64, B('lp')], [84, B('rp')], [108, B('rk')], [168, B('rp')]], dur: 280 },
    { name: 'COMET CROSS f,f+2 (wall)', at: () => [W1() - 420, W1() - 150], dash: 40, p1: [[40, (me) => ({ rp: true, dx: me.facing })]], dur: 220 },
    { name: 'WALL SPIN b+4 (wall)', at: () => nearRight(), p1: [[10, (me) => ({ rk: true, dx: -me.facing })]], dur: 220 },
    { name: 'WALL SLAM throw (wall)', at: () => [W1() - 140, W1() - 60], p1: [[10, { lp: true, lk: true }]], dur: 220 },
  ],
  wall: [
    { name: 'splat then one more', at: () => [W1() - 260, W1() - 170], p1: [[10, B('rp')], [32, B('lp')], [50, B('rk')], [150, (me) => ({ rp: true, dx: me.facing })]], dur: 260 },
  ],
  juggle: [
    { name: 'launch then mash 1', at: () => [570, 640], p1: [[10, D('rp')], ...Array.from({ length: 24 }, (_, i) => [60 + i * 8, B('lp')])], dur: 300 },
  ],
  trade: [
    { name: 'jab trade', at: () => [560, 646], p1: [[20, B('lp')]], p2: (me, o, t) => (t >= 21 && t < 24 ? { lp: true } : {}), dur: 100 },
    { name: 'counter hit', at: () => [560, 646], p1: [[22, B('lp')]], p2: (me, o, t) => (t >= 20 && t < 23 ? { rk: true } : {}), dur: 100 },
  ],
  // v3: knock him down a stairwell, the attacker vaults after him, and the fight goes on downstairs. The
  // spots are the old scene's, measured from the right stairwell (wellAt), then the same into the left one.
  floorBreak: [
    { name: 'SPIN HEEL into the right stairwell', abs: true, at: () => wellAt(1, -260, -170), p1: [[10, B('rp')], [32, B('lp')], [50, B('rk')]], chase: 420, dur: 760 },
    { name: 'throw toward the right stairwell', abs: true, at: () => wellAt(1, -160, -92), p1: [[10, { lp: true, lk: true }]], chase: 420, dur: 760 },
    { name: 'NEON TORNADO by the right stairwell', abs: true, at: () => wellAt(1, -120, -30), p1: [[10, B('lp')], [26, B('rp')], [46, B('lk')], [70, B('rk')]], chase: 420, dur: 760 },
    { name: 'SPIN HEEL into the left stairwell', abs: true, at: () => wellAt(0, -260, -170), p1: [[10, B('rp')], [32, B('lp')], [50, B('rk')]], chase: 420, dur: 760 },
    { name: 'throw toward the left stairwell', abs: true, at: () => wellAt(0, -160, -92), p1: [[10, { lp: true, lk: true }]], chase: 420, dur: 760 },
  ],
  // the stairs: walking up and down both flights, how a fighter on the main floor starts down (down + toward
  // the flight at its head), a fight on the steps (the higher man has the height), knockdowns lying along
  // them, a throw and a sweep there, and the trip back up after a floor break
  stairs: [
    { name: 'up the left flight from the lower floor (walk past the foot)', abs: true, setup: () => { onFlight(0, LOWER, 1000, -1); onFlight(1, -1, 200, 1); },
      p1: [], p1f: (me) => ((me.floor || 0) === 1 || me.stair >= 0 ? { dx: -1 } : {}), dur: 520 },
    { name: 'up the right flight too, running', abs: true, setup: () => { onFlight(0, LOWER, 1660, 1); onFlight(1, -1, 2380, -1); },
      p1: [], p1f: (me) => ((me.floor || 0) === 1 || me.stair >= 0 ? { dx: 1, run: true } : {}), dur: 300 },
    { name: 'down at the head: down + toward the flight steps onto it', abs: true, setup: () => { onFlight(0, -1, stairX(0, -70), 1); onFlight(1, LOWER, 1300, -1); },
      p1: [], p1f: (me, o, t) => (t < 30 ? walkTo(stairX(0, -15))(me) : me.stair >= 0 || (me.floor || 0) === 1 ? (Math.abs(me.x - 1000) > 8 ? { dx: 1 } : {}) : { dx: 1, down: true }), dur: 440 },
    { name: 'crouching at the head (no forward) stays upstairs', abs: true, setup: () => { onFlight(0, -1, stairX(0, 0), 1); onFlight(1, -1, stairX(0, 260), -1); },
      p1: [], hold1: { down: true }, dur: 120 },
    { name: 'on the steps: the higher man\'s 1,2,4 knocks him down the flight', abs: true, setup: () => { onFlight(0, 0, stairX(0, 110), 1); onFlight(1, 0, stairX(0, 190), -1); },
      p1: [[10, B('rp')], [32, B('lp')], [50, B('rk')]], dur: 320 },
    { name: 'on the steps: he guards a jab and a cross from above', abs: true, setup: () => { onFlight(0, 0, stairX(0, 120), 1); onFlight(1, 0, stairX(0, 196), -1); },
      p2: { back: true }, p1: [[10, B('lp')], [40, B('rp')]], dur: 160 },
    { name: 'from below: a sweep up the steps (the foot follows the treads)', abs: true, setup: () => { onFlight(0, 0, stairX(0, 300), -1); onFlight(1, 0, stairX(0, 228), 1); },
      p1: [[10, D('rk')]], dur: 260 },
    { name: 'a throw on the steps, then the stomp on the body lying along them', abs: true, setup: () => { onFlight(0, 1, stairX(1, 140), -1); onFlight(1, 1, stairX(1, 205), 1); },
      p1: [[10, { lp: true, lk: true }], [150, D('rk')]], p1f: (me, o, t) => (t > 120 && t < 150 && o.state === 'down' && Math.abs(o.rig.joints.hip.x - me.x) > 120 ? { dx: Math.sign(o.rig.joints.hip.x - me.x) } : {}), dur: 320 },
    { name: 'a jump on the steps lands on the tread under him', abs: true, setup: () => { onFlight(0, 1, stairX(1, 120), -1); onFlight(1, LOWER, 1500, 1); },
      p1: [[10, (me) => ({ jump: true, dx: me.facing })], [70, (me) => ({ jump: true, dx: me.facing })]], dur: 220 },
    { name: 'FLOOR BREAK over the left rail, then he climbs back up the flight', abs: true, at: () => wellAt(0, -160, -92), p1: [[10, { lp: true, lk: true }]],
      p1f: (me, o, t) => (t > 150 && me.state !== 'vault' && (me.stair >= 0 || me.floor === 1) ? walkTo(1300)(me) : {}),   // after the vault, out of his way
      p2: (me, o, t) => (t > 200 && me.state !== 'down' && me.state !== 'getup' && me.state !== 'knockdown' && !(me.stair < 0 && (me.floor || 0) === 0) ? { dx: -1, run: true } : {}), dur: 900 },
  ],
  // v3b: air and crouch attacks
  jumpIn: [
    { name: 'flying kick jump-in, then 1,1,2 on landing', at: () => [530, 650], p1: [[10, (me) => ({ jump: true, dx: me.facing })], [44, B('lk')], [74, B('lp')], [100, B('lp')], [124, B('rp')]], dur: 240 },
    { name: 'dive kick on a croucher', at: () => [540, 650], p2: { down: true }, p1: [[10, (me) => ({ jump: true, dx: me.facing })], [34, D('rk')]], dur: 200 },
    { name: 'air roundhouse vs standing guard (blocked)', at: () => [530, 650], p2: { back: true }, p1: [[10, (me) => ({ jump: true, dx: me.facing })], [42, B('rk')]], dur: 200 },
    { name: 'whiffed jump cross: landing lag', at: () => [400, 900], p1: [[10, (me) => ({ jump: true })], [22, B('rp')]], dur: 160 },
    { name: 'crouch string d+1,d+1,d+3 (LOW RUSH)', at: () => [560, 650], p1: [[4, { down: true }], [12, D('lp')], [30, D('lp')], [50, D('lk')]], hold1: { down: true }, dur: 200 },
    { name: 'crouch-walk in, then d+4', at: () => [470, 650], hold1: { down: true }, p1: [[2, (me) => ({ down: true, dx: me.facing })], [6, (me) => ({ down: true, dx: me.facing })]], walkIn: 240, dur: 320 },
  ],
  antiAir: [
    // P1 reacts to the jump: the uppercut as he comes in close and high, the jab as his kick starts
    { name: 'uppercut anti-airs a jump-in (counter, launch)', at: () => [560, 700], p2: (me, o, t) => (t >= 10 && t < 13 ? { jump: true, dx: me.x > o.x ? -1 : 1 } : t >= 42 && t < 45 ? { rk: true } : {}), p1: [],
      react: (me, o, t) => (t < 0 ? D('rp') : !o.grounded && o.vy > -260 && Math.abs(o.x - me.x) < 140 ? D('rp') : null), dur: 240 },
    { name: 'jab stuffs a late air attack', at: () => [560, 690], p2: (me, o, t) => (t >= 10 && t < 13 ? { jump: true, dx: me.x > o.x ? -1 : 1 } : t >= 62 && t < 65 ? { lk: true } : {}), p1: [],
      react: (me, o, t) => (t < 0 ? B('lp') : !o.grounded && o.vy > 160 && Math.abs(o.x - me.x) < 96 ? B('lp') : null), dur: 200 },
  ],
  // characters (src/characters/): each unique move landing as designed, the character as P1 against a TEMP
  courier: [
    { name: 'EXPRESS SLIDE f,f+3 under a standing guard (low, knockdown)', at: () => [430, 650], p2: { back: true }, dash: 30, p1: [[30, (me) => ({ lk: true, dx: me.facing })]], dur: 170 },
    { name: 'EXPRESS SLIDE ducks a jab (tc) and trips him', at: () => [430, 650], dash: 30, p1: [[30, (me) => ({ lk: true, dx: me.facing })]], p2: (me, o, t) => (t >= 40 && t < 43 ? { lp: true } : {}), dur: 170 },
    { name: 'DROP-OFF KNEE f,f+4 launches, jabs juggle', at: () => [420, 650], dash: 30, p1: [[30, (me) => ({ rk: true, dx: me.facing })], [76, B('lp')], [96, B('lp')], [116, B('lp')]], dur: 230 },
    { name: 'DROP-OFF KNEE hops his low kick (counter)', at: () => [420, 650], dash: 30, p1: [[30, (me) => ({ rk: true, dx: me.facing })]], p2: (me, o, t) => (t >= 34 && t < 37 ? { lk: true, down: true } : {}), dur: 200 },
    { name: 'SAME DAY 1,1,3 (ender: the slide)', p1: [[10, B('lp')], [26, B('lp')], [42, B('lk')]], dur: 200 },
  ],
  security: [
    { name: 'ESCORT f+1+3 into the wall (splat)', at: () => [W1() - 240, W1() - 130], p1: [[10, (me) => ({ lp: true, lk: true, dx: me.facing })]], dur: 220 },
    { name: "ESCORT can't be broken", at: () => [400, 490], p1: [[10, (me) => ({ lp: true, lk: true, dx: me.facing })]], p2: (me, o, t) => (me.state === 'grabbed' && t % 6 < 3 ? { lp: true, lk: true } : {}), dur: 200 },
    { name: 'ESCORT whiffs on a croucher', at: () => [560, 650], p2: { down: true }, p1: [[10, (me) => ({ lp: true, lk: true, dx: me.facing })]], dur: 160 },
    { name: 'SHOULDER CHECK b+2 armors his jab and knocks him down', at: () => [540, 650], p1: [[10, (me) => ({ rp: true, dx: -me.facing })]], p2: (me, o, t) => (t >= 5 && t < 8 ? { lp: true } : {}), dur: 200 },
    { name: 'SHOULDER CHECK near the wall (wall bounce)', at: () => [W1() - 220, W1() - 120], p1: [[10, (me) => ({ rp: true, dx: -me.facing })], [92, B('lp')]], dur: 220 },
    { name: 'LOCKDOWN 1,2,1 (overhead ender)', p1: [[10, B('lp')], [26, B('rp')], [46, B('lp')]], dur: 220 },
  ],
  // HELPDESK: the parry catches a high and a mid, loses to a low and a throw, and a whiffed stance is punished
  helpdesk: [
    { name: 'TICKET CLOSED b+1 catches a high (jab): the elbow answers', p1: [[6, (me) => ({ lp: true, dx: -me.facing })]], p2: (me, o, t) => (t >= 14 && t < 17 ? { lp: true } : {}), dur: 200 },
    { name: 'TICKET CLOSED catches a mid (snap kick)', p1: [[6, (me) => ({ lp: true, dx: -me.facing })]], p2: (me, o, t) => (t >= 12 && t < 15 ? { lk: true } : {}), dur: 200 },
    { name: 'TICKET CLOSED loses to a low (low kick)', p1: [[6, (me) => ({ lp: true, dx: -me.facing })]], p2: (me, o, t) => (t >= 12 && t < 15 ? D('lk') : {}), dur: 160 },
    { name: 'TICKET CLOSED loses to a throw', at: () => [560, 640], p1: [[6, (me) => ({ lp: true, dx: -me.facing })]], p2: (me, o, t) => (t >= 12 && t < 15 ? { lp: true, lk: true } : {}), dur: 180 },
    { name: 'TICKET CLOSED whiffed: the recovery is punished', p1: [[6, (me) => ({ lp: true, dx: -me.facing })]], p2: (me, o, t) => (o.state === 'attack' && o.phase === 'recovery' && t % 4 < 2 ? clean(me, { rp: true }) : {}), dur: 160 },
    { name: 'REBOOT b+2 carries him into the wall (splat)', at: () => [W1() - 360, W1() - 240], p1: [[10, (me) => ({ rp: true, dx: -me.facing })]], dur: 220 },
    { name: 'REBOOT in the open (knockdown, he follows)', at: () => [400, 520], p1: [[10, (me) => ({ rp: true, dx: -me.facing })]], dur: 200 },
    { name: 'CTRL ALT DEL 1,3,2 (launch), a jab juggles', p1: [[10, B('lp')], [26, B('lk')], [46, B('rp')], [110, B('lp')]], dur: 220 },
  ],
  // JANITOR: the long low sweep, the spin in front and behind (over a croucher a run-jump crosses up), the splat ender
  janitor: [
    { name: 'WET FLOOR f+3 from range under a back-holder (lows go under)', at: () => [530, 650], p2: { back: true }, p1: [[10, (me) => ({ lk: true, dx: me.facing })]], dur: 180 },
    { name: 'WET FLOOR blocked low: punished', at: () => [480, 650], p2: (me, o, t) => (o.state === 'attack' && o.phase === 'recovery' && me.state !== 'blockstun' && t % 4 < 2 ? clean(me, { rp: true }) : { back: true, down: true }), p1: [[10, (me) => ({ lk: true, dx: me.facing })]], dur: 200 },
    { name: 'MOP SPIN b+3 in front', p1: [[10, (me) => ({ lk: true, dx: -me.facing })]], dur: 200 },
    { name: 'MOP SPIN catches a cross-up behind him', p2: (me, o, t) => (t >= 4 && t < 8 ? { jump: true, run: true, dx: me.x > o.x ? -1 : 1 } : {}), p1: [...Array.from({ length: 15 }, (_, i) => [i * 3, { down: true }]), [48, (me) => ({ lk: true, dx: -me.facing })]], dur: 220 },
    { name: 'AISLE 3 3,3,3 (wall splat)', at: () => [W1() - 300, W1() - 210], p1: [[10, B('lk')], [30, B('lk')], [52, B('lk')]], dur: 220 },
  ],
  manager: [
    { name: 'PERFORMANCE REVIEW 1,2,2 (four-hit rush ender)', p1: [[10, B('lp')], [26, B('rp')], [46, B('rp')]], dur: 280 },
    { name: 'PERFORMANCE REVIEW blocked standing (every hook blocked)', p2: { back: true }, p1: [[10, B('lp')], [26, B('rp')], [46, B('rp')]], dur: 280 },
    { name: 'DOWNSIZING b+3 on a crouching guard (overhead hits)', at: () => [560, 655], p2: { down: true, back: true }, p1: [[10, (me) => ({ lk: true, dx: -me.facing })]], dur: 220 },
    { name: 'DOWNSIZING blocked standing', at: () => [575, 655], p2: { back: true }, p1: [[10, (me) => ({ lk: true, dx: -me.facing })]], dur: 220 },
    { name: 'TOP-DOWN 3,2,3 (axe kick ender)', p1: [[10, B('lk')], [30, B('rp')], [54, B('lk')]], dur: 260 },
  ],
  // the mixup: after a blocked Fine Print the guard picks a height (P2 reads it right or wrong per phase)
  accountant: [
    { name: 'FINE PRINT d+3 hits a standing guard (low)', p2: { back: true }, p1: [[10, D('lk')]], dur: 120 },
    { name: 'FINE PRINT blocked crouching (plus on block)', p2: { back: true, down: true }, p1: [[10, D('lk')]], dur: 120 },
    { name: 'BALANCE SHEET d+3,4: the overhead hits the crouching guard', p2: { back: true, down: true }, p1: [[10, D('lk')], [26, B('rk')]], dur: 200 },
    { name: 'BALANCE SHEET blocked standing (he stood for it)', p2: (me, o) => ({ back: true, down: o.move === 'finePrint' }), p1: [[10, D('lk')], [26, B('rk')]], dur: 200 },
    { name: 'd+3,3: the second low hits him standing', p2: (me, o) => ({ back: true, down: o.move === 'finePrint' }), p1: [[10, D('lk')], [26, B('lk')]], dur: 180 },
    { name: 'd+3,3: the second low blocked crouching', p2: { back: true, down: true }, p1: [[10, D('lk')], [26, B('lk')]], dur: 180 },
    { name: 'WRITE-OFF d+3,3,2 (ender)', p1: [[10, D('lk')], [26, B('lk')], [50, B('rp')]], dur: 240 },
  ],
  intern: [
    { name: 'COFFEE RUN f,f+1 from a dash, then 1,2 on the stumble', at: () => [420, 650], dash: 30, p1: [[30, (me) => ({ lp: true, dx: me.facing })], [80, B('lp')], [100, B('rp')]], dur: 200 },
    { name: 'COFFEE RUN blocked deep: he eats the punish', at: () => [420, 650], dash: 30, p2: (me, o, t) => (t < 70 ? { back: true } : t >= 70 && t < 73 ? { rp: true } : {}), p1: [[30, (me) => ({ lp: true, dx: me.facing })]], dur: 200 },
    { name: 'PAPER CUT d+1, d+1, 2 (low, low, mid finisher)', at: () => [560, 640], hold1: { down: true }, p1: [[4, { down: true }], [10, D('lp')], [26, D('lp')], [44, { rp: true }]], dur: 200 },
    { name: 'PAPER CUT lows go under a standing guard', at: () => [560, 640], p2: { back: true }, hold1: { down: true }, p1: [[4, { down: true }], [10, D('lp')], [26, D('lp')]], dur: 140 },
    { name: 'REPLY ALL 1,2,2 (ender: the haymaker)', at: () => [300, 390], p1: [[10, B('lp')], [26, B('rp')], [48, B('rp')]], dur: 220 },
  ],
  windowWasher: [
    { name: 'DOUBLE JUMP: jump, then up again at the top', at: () => [400, 900], p1: [[6, { jump: true }], [44, { jump: true }]], dur: 170 },
    { name: 'DOUBLE JUMP over him: a cross-up, he ends up behind', at: () => [540, 650], p1: [[6, (me) => ({ jump: true, dx: me.facing })], [12, (me) => ({ dx: me.facing })], [24, (me) => ({ dx: me.facing })], [36, (me) => ({ dx: me.facing })], [42, (me) => ({ jump: true, dx: me.facing })], [48, (me) => ({ dx: me.facing })], [60, (me) => ({ dx: me.facing })], [72, (me) => ({ dx: me.facing })]], dur: 200 },
    { name: 'WALL JUMP out of the corner, over him', at: () => [W0() + 40, W0() + 130], p1: [[6, (me) => ({ jump: true, dx: -me.facing })], [24, { jump: true }]], dur: 180 },
    { name: 'SQUEEGEE DIVE d+3 in the air on a croucher (overhead)', at: () => [520, 650], p2: { down: true }, p1: [[10, (me) => ({ jump: true, dx: me.facing })], [36, D('lk')]], dur: 200 },
    { name: 'SQUEEGEE DIVE off the double jump, then 2,3 on landing', at: () => [330, 490], p1: [[6, (me) => ({ jump: true, dx: me.facing })], [36, (me) => ({ jump: true, dx: me.facing })], [70, D('lk')], [108, B('rp')], [132, B('lk')]], dur: 240 },
    { name: 'SQUEEGEE DIVE vs a standing guard (blocked)', at: () => [520, 650], p2: { back: true }, p1: [[10, (me) => ({ jump: true, dx: me.facing })], [36, D('lk')]], dur: 200 },
    { name: 'UPDRAFT b+3 meets a jump-in and launches', at: () => [560, 720], p2: (me, o, t) => (t >= 10 && t < 13 ? { jump: true, dx: me.x > o.x ? -1 : 1 } : t >= 40 && t < 43 ? { lk: true } : {}), p1: [],
      react: (me, o, t) => (t < 0 ? { lk: true, dx: -me.facing } : !o.grounded && o.vy > -200 && Math.abs(o.x - me.x) < 150 ? { lk: true, dx: -me.facing } : null), dur: 220 },
    { name: 'UPDRAFT hops his low kick', at: () => [560, 650], p1: [[20, (me) => ({ lk: true, dx: -me.facing })]], p2: (me, o, t) => (t >= 24 && t < 27 ? { lk: true, down: true } : {}), dur: 200 },
    { name: 'STREAK FREE 1,3,4 (ender: dropkick)', at: () => [300, 390], p1: [[10, B('lp')], [26, B('lk')], [48, B('rk')]], dur: 220 },
    { name: 'STREAK FREE near the wall (wall splat)', at: () => [W1() - 230, W1() - 140], p1: [[10, B('lp')], [26, B('lk')], [48, B('rk')]], dur: 220 },
  ],
  // CHEF: the armored overhead chop (on a crouching guard, through a jab, blocked and punished), the launching flick, the splat ender
  chef: [
    { name: 'CLEAVER b+2 on a crouching guard (overhead hits)', at: () => [560, 655], p2: { down: true, back: true }, p1: [[10, (me) => ({ rp: true, dx: -me.facing })]], dur: 220 },
    { name: 'CLEAVER armors his jab and chops through it', at: () => [560, 650], p1: [[10, (me) => ({ rp: true, dx: -me.facing })]], p2: (me, o, t) => (t >= 22 && t < 25 ? { lp: true } : {}), dur: 220 },
    { name: 'CLEAVER blocked standing: punished', at: () => [560, 655], p2: (me, o, t) => (o.state === 'attack' && o.phase === 'recovery' && me.state !== 'blockstun' && t % 4 < 2 ? clean(me, { rp: true }) : { back: true }), p1: [[10, (me) => ({ rp: true, dx: -me.facing })]], dur: 220 },
    { name: 'FLAMBÉ b+1 launches (the flash), jabs juggle', at: () => [580, 650], p1: [[10, (me) => ({ lp: true, dx: -me.facing })], [74, B('lp')], [96, B('lp')]], dur: 220 },
    { name: 'EIGHTY-SIX 1,1,4 into the wall (splat)', at: () => [W1() - 260, W1() - 170], p1: [[10, B('lp')], [26, B('lp')], [44, B('rk')]], dur: 220 },
  ],
  // WELLNESS COACH: Tree Pose held into each of its buttons, tapped (it steps out on its own), the overhead ender
  wellness: [
    { name: 'TREE POSE b+1 held, then 4: CRANE KICK launches', at: () => [560, 660], p1: [[10, (me) => ({ lp: true, dx: -me.facing })], ...Array.from({ length: 16 }, (_, i) => [13 + i * 3, { lp: true }]), [52, { lp: true, rk: true }]], dur: 220 },
    { name: 'TREE POSE, then 3: ROOT SWEEP under a standing guard', at: () => [570, 655], p2: (me, o, t) => (t >= 50 ? { back: true } : {}), p1: [[10, (me) => ({ lp: true, dx: -me.facing })], ...Array.from({ length: 16 }, (_, i) => [13 + i * 3, { lp: true }]), [52, { lp: true, lk: true }]], dur: 200 },
    { name: 'CRANE KICK on a crouching guard (a mid: it hits)', at: () => [560, 660], p2: { down: true, back: true }, p1: [[10, (me) => ({ lp: true, dx: -me.facing })], ...Array.from({ length: 16 }, (_, i) => [13 + i * 3, { lp: true }]), [52, { lp: true, rk: true }]], dur: 220 },
    { name: 'TREE POSE held, then 2: steps out', at: () => [500, 680], p1: [[10, (me) => ({ lp: true, dx: -me.facing })], ...Array.from({ length: 20 }, (_, i) => [13 + i * 3, { lp: true }]), [70, { lp: true, rp: true }]], dur: 160 },
    { name: 'TREE POSE tapped: holds a beat and steps out by itself', at: () => [500, 680], p1: [[10, (me) => ({ lp: true, dx: -me.facing })]], dur: 160 },
    { name: 'TREE POSE caught by a jab in its startup (counter)', at: () => [575, 650], p1: [[10, (me) => ({ lp: true, dx: -me.facing })]], p2: (me, o, t) => (t >= 8 && t < 11 ? { lp: true } : {}), dur: 160 },
    { name: 'SUN SALUTATION 1,3,4 (overhead split kick)', at: () => [400, 490], p1: [[10, B('lp')], [26, B('lk')], [48, B('rk')]], dur: 240 },
  ],
  // ELECTRICIAN: the shock (and once per combo), the root (no walking away, but he guards), the ender
  electrician: [
    { name: 'LIVE WIRE f+1: SHOCKED, then 2, 3 land in the extra stun', at: () => [560, 655], p1: [[10, (me) => ({ lp: true, dx: me.facing })], [80, B('rp')], [100, B('lk')]], dur: 220 },
    { name: 'LIVE WIRE twice in one combo (named, as the CPU does): the second only stuns (once per combo)', at: () => [560, 655], p1: [[10, (me) => ({ lp: true, dx: me.facing })], [84, { electrician_liveWire: true }]], dur: 220 },
    { name: 'LIVE WIRE blocked standing', at: () => [560, 655], p2: { back: true }, p1: [[10, (me) => ({ lp: true, dx: me.facing })]], dur: 140 },
    { name: 'GROUND FAULT df+3 under a standing guard: ROOTED, he can\'t walk away', at: () => [570, 650], p2: (me, o, t) => (t >= 18 ? { back: true } : {}), p1: [[10, (me) => ({ lk: true, down: true, dx: me.facing })]], dur: 200 },
    { name: 'GROUND FAULT: rooted, he still guards the cross', at: () => [560, 650], p2: (me, o, t) => (t > 40 ? { back: true } : {}), p1: [[10, (me) => ({ lk: true, down: true, dx: me.facing })], [62, B('rp')]], dur: 200 },
    { name: 'SHORT CIRCUIT 2,1,2 (two-palm ender)', at: () => [400, 490], p1: [[10, B('rp')], [30, B('lp')], [48, B('rp')]], dur: 220 },
  ],
  // holding back walks back; the guard snaps on only for a strike that can reach (Tekken)
  guard: [
    { name: 'hold back, nothing coming: walks back', at: () => [400, 620], p2: { back: true }, p1: [], dur: 140 },
    { name: 'GUARD button, nothing coming: walks back too', at: () => [400, 620], p2: { block: true }, p1: [], dur: 140 },
    { name: 'cross (high) at a back-holder: guard snaps on in startup, blocked', at: () => [560, 650], p2: { back: true }, p1: [[4, B('rp')]], dur: 120 },
    { name: 'snap kick (mid) at a back-holder: blocked', at: () => [560, 650], p2: { back: true }, p1: [[4, B('lk')]], dur: 120 },
    { name: 'low kick at a standing back-holder: hits', at: () => [560, 650], p2: { back: true }, p1: [[4, D('lk')]], dur: 120 },
    { name: 'low kick at down-back: blocked', at: () => [560, 650], p2: { back: true, down: true }, p1: [[4, D('lk')]], dur: 120 },
    { name: 'throw at a back-holder: the throw wins', at: () => [560, 640], p2: { back: true }, p1: [[4, { lp: true, lk: true }]], dur: 150 },
    // the block effects by weight (README, Effects): a blocked jab, a sweep into down-back, a blocked ender
    { name: 'jab (high) at a back-holder: blocked, a small guard spark', at: () => [560, 650], p2: { back: true }, p1: [[4, B('lp')]], dur: 100 },
    { name: 'sweep (low) at down-back: blocked low', at: () => [560, 650], p2: { back: true, down: true }, p1: [[4, D('rk')]], dur: 120 },
    { name: 'FLASH ROUNDHOUSE 1,1,2,4 into a guard: the ender blocked', p2: { back: true }, p1: [[10, B('lp')], [26, B('lp')], [42, B('rp')], [62, B('rk')]], dur: 200 },
  ],
  throws: [
    { name: 'throw lands', at: () => [560, 632], p1: [[10, { lp: true, lk: true }]], dur: 150 },
    { name: 'throw broken', at: () => [560, 632], p1: [[10, { lp: true, lk: true }]], p2: (me, o, t) => (me.state === 'grabbed' && t % 6 < 3 ? { lp: true, lk: true } : {}), dur: 150 },
    { name: 'throw whiffs on crouch', at: () => [560, 632], p1: [[10, { lp: true, lk: true }]], p2: { down: true }, dur: 150 },
  ],
  // botches (src/combat/botch.js): a mistimed press in the middle of a strike, one phase per outcome
  // family. `since(rel, k, inp)` presses inp on the step the strike out now is k steps past that key.
  botch: [
    { name: 'OVERBALANCE: a second lunge on top of the first (f+2, then f+2 in its startup)', at: () => [430, 720], p1: [[10, (me) => ({ rp: true, dx: me.facing })]],
      react: since('start', 10, (me) => ({ rp: true, dx: me.facing }), 'lungeCross'), dur: 160 },
    { name: 'SPIN-OUT: a jab while the spin kick still turns (b+4, then 1)', at: () => [500, 720], p1: [[10, (me) => ({ rk: true, dx: -me.facing })]],
      react: since('active', 2, { lp: true }, 'spinKick'), dur: 170 },
    { name: 'SPIN-OUT punished from behind (counter)', at: () => [540, 690], p1: [[10, (me) => ({ rk: true, dx: -me.facing })]],
      react: since('active', 2, { lp: true }, 'spinKick'),
      p2: (me, o, t) => (o.state === 'botch' ? (Math.abs(o.x - me.x) > 84 ? { dx: Math.sign(o.x - me.x), run: true } : t % 6 < 3 ? clean(me, { rp: true }) : {}) : {}), dur: 170 },
    { name: 'TRIP: a second roundhouse with the leg still up (4, then 4)', at: () => [500, 720], p1: [[10, B('rk')]],
      react: since('start', 12, { rk: true }, 'roundhouse'), dur: 220 },
    { name: 'FLAIL: both arms (2, then 2 in its startup)', at: () => [500, 720], p1: [[10, B('rp')]],
      react: since('start', 8, { rp: true }, 'cross'), dur: 150 },
    { name: 'WHIFF: a kick late in the jab\'s recovery (1, then 3)', at: () => [500, 720], p1: [[10, B('lp')]],
      react: since('recover', 10, { lk: true }, 'jab'), dur: 150 },
    { name: 'TANGLED: a second air attack mid-swing (jump, 3, then 4)', at: () => [420, 760], p1: [[10, (me) => ({ jump: true, dx: me.facing })], [30, B('lk')]],
      react: since('start', 6, { rk: true }, 'flyingKick'), dur: 200 },
    { name: 'LOW ON STAMINA: the botch faints him (2, then 2)', at: () => [500, 720], setup: () => { sim.units[0].stamina = 40; }, p1: [[10, B('rp')]],
      react: since('start', 8, { rp: true }, 'cross'), dur: 260 },
  ],
  // happy accidents: each technique at its window (landing on him), then the same press a step early and
  // a step late with him out of reach (so the first strike whiffs: after a knockdown that connects, a late
  // press is a legal follow-up and only buffers)
  accident: ACCIDENTS.flatMap((a) => [['', a.at[0]], [' (a step early, out of reach: botch)', a.at[0] - 1], [' (a step late, out of reach: botch)', a.at[1]]].map(([tag, k]) => ({
    name: `${a.name}${tag}`, at: () => (tag ? [420, 720] : ACC_AT[a.id] || [560, 650]), p2: tag ? {} : ACC_P2[a.id] || {},
    p1: [[10, ACC_FROM[a.id]]], react: since(a.rel, k, a.tok === 'T' ? { lp: true, lk: true } : B(TOK_BTN[a.tok]), a.from[0]), dur: a.id === 'pivotBackfist' ? 260 : 200,
  }))),
};

// Seeds: ?seed=N on the URL overrides every scene's default; setScene(name, { seed })
// overrides that. 'ai-fight-2' / 'ai-fight-3' are the same fight under other seeds.
const params = new URLSearchParams(location.search);
const urlSeed = params.has('seed') ? (+params.get('seed') >>> 0) : null;
const seedOf = (opts, dflt) => (opts && opts.seed != null ? +opts.seed >>> 0 : urlSeed != null ? urlSeed : dflt);

// ---- mirror ------------------------------------------------------------------------------
// A debug view only: ?mirror=1 draws any scene mirrored left-right. It never turns on by itself;
// online, both screens show the host as P1 on the left and the guest as P2 on the right. Only the
// view flips, never the sim: the GL canvas gets a CSS scaleX(-1) (every layer, light, the floor
// reflection and the shake flip together), the HUD maps world x through camera.mirror and keeps its
// text and bars readable, input.mirror flips raw left/right at capture, and the audio pan follows.
const urlMirror = params.get('mirror') === '1';
function syncMirror() {
  const on = urlMirror;
  if (on === camera.mirror) return;
  camera.mirror = on; input.mirror = on;
  glCanvas.style.transform = on ? 'scaleX(-1)' : '';
  try { gameAudio.setMirror(on); } catch (e) { /* audio off */ }
}

const scenes = {
  play(o) { sim.setHuman(0); sim.setAI(1, 0.6); sim.resetMatch({ seed: seedOf(o, 1) }); },
  idle(o) { sim.setController(0, 'none'); sim.setController(1, 'none'); sim.resetMatch({ seed: seedOf(o, 1), skipIntro: true }); },
  dummy(o) { sim.setHuman(0); sim.setController(1, 'none'); sim.resetMatch({ seed: seedOf(o, 1), skipIntro: true }); },
  'ai-fight'(o) { sim.setAI(0, 0.7); sim.setAI(1, 0.7); sim.resetMatch({ seed: seedOf(o, 42), skipIntro: true }); },
  'ai-fight-2'(o) { scenes['ai-fight']({ seed: seedOf(o, 7) }); },
  // the arcade attract mode: two expert CPUs (the showcase flavor, ai.js) fight one round under the
  // title, then a new bout under a new seed. Any key, pad button or touch starts 'play'.
  attract(o) {
    sim.setAI(0, 1.0, { style: 'showcase' }); sim.setAI(1, 1.0, { style: 'showcase' });
    if (arena.clearBodies) arena.clearBodies();   // the demo's pile doesn't grow forever
    sim.resetMatch({ seed: seedOf(o, (Math.random() * 4294967296) >>> 0), introTime: 1.2 });
    // the spawns are symmetric about the middle, a stairwell far behind each: the floor break comes out of
    // the fight instead of the first exchange
  },
  'ai-fight-3'(o) { scenes['ai-fight']({ seed: seedOf(o, 1234) }); },
  // an arcade ladder stage (src/flow/ladder.js): you against a named CPU with its own difficulty and
  // style; its look (preset, color, floor) is applied by setScene from opts.stage
  arcade(o) {
    const st = o.stage || {};
    if (arena.clearBodies) arena.clearBodies();
    sim.setHuman(0); sim.setAI(1, st.difficulty != null ? st.difficulty : 0.6, { style: st.style || undefined });
    sim.resetMatch({ seed: seedOf(o, st.seed || 1), fresh: true });
  },
  'scripted-combo'(o) {
    sim.setController(0, 'script', script(['jab', 'cross', 'roundhouse']));
    sim.setController(1, 'none');
    sim.resetMatch({ seed: seedOf(o, 1), skipIntro: true });
    place(0, sim.units[1].x - 70, 1);
  },
  // P1 presses real buttons on a standing dummy: 1,1,2 then (after a reset beat) 1,2,4. Each string
  // should come out as a true combo through the button table and the rig's cancel windows.
  'string-test'(o) {
    const presses = [[0, 'lp'], [20, 'lp'], [44, 'rp'], [190, 'lp'], [212, 'rp'], [250, 'rk']];
    let t0 = -1;
    sim.setController(0, 'script', (me, opp, s) => {
      if (s.phase !== 'fight') return EMPTY_INPUT;
      if (t0 < 0) t0 = s.stepCount + 6;
      const out = { ...EMPTY_INPUT, dx: Math.abs(opp.x - me.x) > 120 && me.state === 'idle' ? Math.sign(opp.x - me.x) : 0 }, t = s.stepCount - t0;
      for (const [at, b] of presses) if (t >= at && t < at + 4) out[b] = true;
      return out;
    });
    sim.setController(1, 'none');
    sim.resetMatch({ seed: seedOf(o, 1), skipIntro: true });
    place(0, sim.units[1].x - 90, 1);
  },
  // P1 mashes J, J, K, L in rhythm on a standing dummy: the string should come out as a 4-hit combo
  'combo-test'(o) {
    const presses = [[0, 'jab'], [20, 'jab'], [44, 'cross'], [80, 'roundhouse']];   // in 120Hz steps from the first press: a human mash
    let t0 = -1;
    sim.setController(0, 'script', (me, opp, s) => {
      if (s.phase !== 'fight') return EMPTY_INPUT;
      if (t0 < 0) t0 = s.stepCount + 6;
      const out = { ...EMPTY_INPUT }, t = s.stepCount - t0;
      for (const [at, m] of presses) if (t >= at && t < at + 4) out[m] = true;
      return out;
    });
    sim.setController(1, 'none');
    sim.resetMatch({ seed: seedOf(o, 1), skipIntro: true });
    place(0, sim.units[1].x - 90, 1);
  },
  // Horde: P1 against a stream of goons, each KO adds a body to the pile. 'horde' is
  // for Scott (G on the title line), 'horde-ai' is the deterministic one for captures.
  horde(o) { sim.setHuman(0); sim.setAI(1, 0.45); sim.resetMatch({ seed: seedOf(o, 5), horde: { goonHealth: 30, goonDifficulty: 0.45, heal: 10 } }); },
  // v3: horde floor by floor, a strong AI hero against light goons so floors clear inside a capture
  'horde-floors-ai'(o) { sim.setAI(0, 1.0); sim.setAI(1, 0.05); sim.resetMatch({ seed: seedOf(o, 9), skipIntro: true, horde: { goonHealth: 7, goonDifficulty: 0.02, heal: 40 } }); },
  'horde-ai'(o) { sim.setAI(0, 1.0); sim.setAI(1, 0.1); sim.resetMatch({ seed: seedOf(o, 5), skipIntro: true, horde: { goonHealth: 10, goonDifficulty: 0.05, heal: 45 } }); },
  // Two aggressive AIs on short health: each round ends in a few hits, so a full
  // best-of-3 and its body pile fit in a capture.
  'getup-test'(o) { timeline(PHASES.getup, o); },
  'stomp-test'(o) { timeline(PHASES.stomp, o); },
  'ground-test'(o) { timeline(PHASES.ground, o); },
  'air-recovery-test'(o) { timeline(PHASES.airRecovery, o); },
  'parry-test'(o) { timeline(PHASES.parry, o); },
  'mixup-test'(o) { timeline(PHASES.mixup, o); },
  'stamina-test'(o) { timeline(PHASES.stamina, o); },
  'refund-test'(o) { timeline(PHASES.refund, o); },
  'faint-test'(o) { timeline(PHASES.faint, o); },
  'string-ender-test'(o) { timeline(PHASES.strings, o); },
  'wall-test'(o) { timeline(PHASES.wall, o); },
  'juggle-test'(o) { timeline(PHASES.juggle, o); },
  'trade-test'(o) { timeline(PHASES.trade, o); },
  'throw-test'(o) { timeline(PHASES.throws, o); },
  'botch-test'(o) { timeline(PHASES.botch, o); },
  'accident-test'(o) { timeline(PHASES.accident, o); },
  'floor-break-test'(o) { timeline(PHASES.floorBreak, o); },
  'stair-test'(o) { timeline(PHASES.stairs, o); },
  'jump-in-test'(o) { timeline(PHASES.jumpIn, o); },
  'anti-air-test'(o) { timeline(PHASES.antiAir, o); },
  'courier-test'(o) { timeline(PHASES.courier, o); },
  'guard-test'(o) { timeline(PHASES.guard, o); },
  'security-test'(o) { timeline(PHASES.security, o); },
  'manager-test'(o) { timeline(PHASES.manager, o); },
  'accountant-test'(o) { timeline(PHASES.accountant, o); },
  'helpdesk-test'(o) { timeline(PHASES.helpdesk, o); },
  'janitor-test'(o) { timeline(PHASES.janitor, o); },
  'intern-test'(o) { timeline(PHASES.intern, o); },
  'windowwasher-test'(o) { timeline(PHASES.windowWasher, o); },
  'chef-test'(o) { timeline(PHASES.chef, o); },
  'wellness-test'(o) { timeline(PHASES.wellness, o); },
  'electrician-test'(o) { timeline(PHASES.electrician, o); },
  // an online match (src/net/online.js): each unit's controller reads the lockstep's input for the frame
  online(o) {
    if (!o.lockstep) { scenes.play(o); return; }
    if (arena.clearBodies) arena.clearBodies();
    sim.setController(0, 'net', o.lockstep.controller(0)); sim.setController(1, 'net', o.lockstep.controller(1));
    sim.perfectSkip = 'winner';   // the perfect finisher: only the winner's press skips it (the loser can't cut the show short)
    sim.resetMatch({ seed: o.seed >>> 0, fresh: true });   // fresh: nothing carried over from this machine's demo
  },
  // the perfect round finisher (README, Perfect rounds): P1 (?p1=, TEMP by default) walks up to a dummy that
  // never fights back and crosses it out of a low health bar, so every round is a perfect one and ends in P1's
  // throw at the camera. &hurt=1 takes a point off P1 at the start of each round: the same KO, no finisher.
  // &p2win=1 swaps the parts (the dummy is P1), for the winner on the right of the screen.
  'perfect-test'(o) {
    sim.botchOn = false;
    const hurt = params.get('hurt') === '1', swap = params.get('p2win') === '1', hit = swap ? 1 : 0;
    let t = 0;
    sim.setController(hit, 'script', (me, op, s) => {
      if (s.phase !== 'fight' || op.state === 'ko') { t = 0; return EMPTY_INPUT; }
      if (hurt && me.health === me.maxHealth) me.health -= 1;
      if (Math.abs(op.x - me.x) > 100) return { ...EMPTY_INPUT, dx: Math.sign(op.x - me.x) };
      return (t++ % 48) < 3 ? { ...EMPTY_INPUT, cross: true } : EMPTY_INPUT;
    });
    sim.setController(1 - hit, 'none');
    sim.resetMatch({ seed: seedOf(o, 11), skipIntro: true, startHealth: 18 });
  },
  ko(o) {
    sim.setAI(0, 0.8); sim.setAI(1, 0.8);
    sim.resetMatch({ seed: seedOf(o, 3), skipIntro: true, startHealth: 24, introTime: 0.8 });
    place(0, sim.units[1].x - 110, 1);
  },
};

// Characters (src/characters/): a scene fights the pair in opts.chars ([P1, P2] ids), else ?p1= and ?p2=
// on the URL, else TEMP vs TEMP (so every test scene is the baseline unless asked otherwise). The flow
// passes the player's pick; the attract demo draws a random pair from the roster.
const urlChars = [params.get('p1'), params.get('p2')];
const SCENE_CHARS = { 'courier-test': ['courier', TEMP_ID], 'security-test': ['security', TEMP_ID], 'manager-test': ['manager', TEMP_ID], 'accountant-test': ['accountant', TEMP_ID], 'helpdesk-test': ['helpdesk', TEMP_ID], 'janitor-test': ['janitor', TEMP_ID], 'intern-test': ['intern', TEMP_ID], 'windowwasher-test': ['windowWasher', TEMP_ID] };
// HR REP, SALES REP, BARISTA: each unique move landing as designed, the character as P1 against a TEMP. The
// status phases run past the timer (WRITTEN UP 3s, WIRED 2.5s) so the tag can be seen running out.
{
  const fwd = (b) => (me) => ({ [b]: true, dx: me.facing }), back = (b) => (me) => ({ [b]: true, dx: -me.facing });
  const walk = (a, b) => Array.from({ length: Math.ceil((b - a) / 3) }, (_, i) => [a + i * 3, (me) => ({ dx: me.facing })]);   // walk in over steps a..b
  const spend = (me, o, t) => (t === 60 || t === 100 || t === 140 ? { lp: true } : {});   // P2 burns stamina so his slow regen shows
  Object.assign(PHASES, {
    hrRep: [
      { name: 'WRITE-UP b+1: WRITTEN UP, half regen for 3s (he jabs the air and refills slowly)', p1: [[10, back('lp')]], p2: spend, dur: 480 },
      { name: 'the same jabs without a write-up (regen compare)', p1: [], p2: spend, dur: 240 },
      { name: 'WRITE-UP is a high: a croucher ducks it', p2: { down: true }, p1: [[10, back('lp')]], dur: 140 },
      { name: 'MANDATORY TRAINING b+2 from long range: he staggers back on his feet', at: () => [440, 600], p1: [[10, back('rp')]], dur: 200 },
      { name: 'MANDATORY TRAINING blocked (his back to the wall)', at: () => [W1() - 200, W1() - 40], p2: { back: true }, p1: [[10, back('rp')]], dur: 160 },
      { name: 'EXIT INTERVIEW 2,1,2: written up and shoved out, no knockdown', p1: [[10, B('rp')], [30, B('lp')], [48, B('rp')]], p2: (me, o, t) => (t === 200 || t === 240 ? { lp: true } : {}), dur: 460 },
    ],
    salesRep: [
      { name: 'COLD CALL f,f+1 lands', at: () => [380, 640], dash: 26, p1: [[26, fwd('lp')]], dur: 150 },
      { name: 'COLD CALL feints into THE PITCH (back+3 in startup) under a standing guard', at: () => [W1() - 230, W1() - 40], dash: 18, p2: { back: true }, p1: [[18, fwd('lp')], [25, back('lk')]], dur: 160 },
      { name: 'COLD CALL feints into CLOSE THE DEAL (a throw in startup) through a guard', at: () => [W1() - 230, W1() - 40], dash: 18, p2: { back: true }, p1: [[18, fwd('lp')], [25, { lp: true, lk: true }]], dur: 200 },
      { name: 'back+3 after the feint window: that one botches', at: () => [W1() - 230, W1() - 40], dash: 18, p2: { back: true }, p1: [[18, fwd('lp')], [36, back('lk')]], dur: 200 },
      { name: 'CLOSE THE DEAL f+1+3 (fast grab)', at: () => [560, 645], p1: [[10, (me) => ({ lp: true, lk: true, dx: me.facing })]], dur: 180 },
      { name: 'ALWAYS BE CLOSING 3,1,2 launches, a jab juggles', p1: [[10, B('lk')], [30, B('lp')], [46, B('rp')], [104, B('lp')]], dur: 220 },
    ],
    barista: [
      { name: 'ESPRESSO SHOT b+1: WIRED, then a jab comes out faster', at: () => [560, 700], p1: [[6, back('lp')], ...walk(96, 124), [130, B('lp')]], dur: 380 },
      { name: 'the same jab not wired (timing compare)', at: () => [560, 650], p1: [[130, B('lp')]], dur: 200 },
      { name: 'POUR OVER b+2: four hits, the palm knocks down', p1: [[10, back('rp')]], dur: 200 },
      { name: 'POUR OVER blocked standing (every hit blocked)', p2: { back: true }, p1: [[10, back('rp')]], dur: 180 },
      { name: 'LATTE ART 1,2,1 (whirling backfist ender)', p1: [[10, B('lp')], [26, B('rp')], [46, B('lp')]], dur: 200 },
      { name: 'WIRED LATTE ART: the shot, then 1,2,1 with faster startups', at: () => [560, 670], p1: [[6, back('lp')], ...walk(80, 104), [110, B('lp')], [124, B('rp')], [140, B('lp')]], dur: 300 },
    ],
  });
  Object.assign(scenes, { 'hrrep-test'(o) { timeline(PHASES.hrRep, o); }, 'salesrep-test'(o) { timeline(PHASES.salesRep, o); }, 'barista-test'(o) { timeline(PHASES.barista, o); } });
  Object.assign(SCENE_CHARS, { 'hrrep-test': ['hrRep', TEMP_ID], 'salesrep-test': ['salesRep', TEMP_ID], 'barista-test': ['barista', TEMP_ID] });
}
Object.assign(SCENE_CHARS, { 'chef-test': ['chef', TEMP_ID], 'wellness-test': ['wellness', TEMP_ID], 'electrician-test': ['electrician', TEMP_ID] });
// RECEPTIONIST, LAWYER, THE CEO: each unique move landing as designed (and what beats it), the character as P1.
// p2as(id): the phase's P2 (a TEMP unless it says so; LAWYER's ESCORT phase needs a SECURITY)
{
  const p2as = (id) => () => { if (sim.units[1].char.id !== id) sim.setCharacter(1, id); };
  const fwd = (b) => (me) => ({ [b]: true, dx: me.facing }), back = (b) => (me) => ({ [b]: true, dx: -me.facing });
  const tossBack = (me) => ({ lp: true, lk: true, dx: -me.facing });
  const pressIn = Array.from({ length: 10 }, (_, i) => [14 + i * 3, (me) => (me.state === 'attack' ? { dx: me.facing } : {})]);   // walking in through the recovery while he's in blockstun
  const punish = (me, o) => (o.state === 'attack' && o.phase === 'recovery' && Math.abs(o.x - me.x) < 130 ? clean(me, { rp: true }) : {});
  Object.assign(PHASES, {
    receptionist: [
      { name: 'PLEASE HOLD f+1 from long range (the end of the cord lands)', at: () => [470, 640], setup: p2as(TEMP_ID), p1: [[10, fwd('lp')]], dur: 170 },
      { name: 'PLEASE HOLD blocked at range', at: () => [470, 640], setup: p2as(TEMP_ID), p2: { back: true }, p1: [[10, fwd('lp')]], dur: 170 },
      { name: 'PLEASE HOLD hits a croucher (a mid)', at: () => [470, 640], setup: p2as(TEMP_ID), p2: { down: true }, p1: [[10, fwd('lp')]], dur: 170 },
      { name: 'PLEASE HOLD up close: the cord goes past him, the cross punishes', at: () => [560, 640], setup: p2as(TEMP_ID), p1: [[10, fwd('lp')]], p2: punish, dur: 190 },
      { name: 'TRANSFER b+1+3: up over her head, down on her other side', at: () => [560, 632], setup: p2as(TEMP_ID), p1: [[10, tossBack]], dur: 260 },
      { name: 'TRANSFER out of the corner (now he has the wall behind him)', at: () => [W0() + 170, W0() + 242], setup: p2as(TEMP_ID), p1: [[10, tossBack]], dur: 280 },
      { name: "TRANSFER can't be broken", at: () => [560, 632], setup: p2as(TEMP_ID), p1: [[10, tossBack]], p2: (me, o, t) => (me.state === 'grabbed' && t % 6 < 3 ? { lp: true, lk: true } : {}), dur: 260 },
      { name: 'TRANSFER with her back to the wall: no room, a plain toss forward', at: () => [W0() + 70, W0() + 142], setup: p2as(TEMP_ID), p1: [[10, tossBack]], dur: 220 },
      { name: 'HANG UP 3,1,1 (overhead ender)', setup: p2as(TEMP_ID), p1: [[10, B('lk')], [30, B('lp')], [50, B('lp')]], dur: 220 },
    ],
    lawyer: [
      { name: 'OBJECTION! b+1 catches a throw: SUSTAINED', at: () => [430, 502], setup: p2as(TEMP_ID), p1: [[6, back('lp')]], p2: (me, o, t) => (t >= 12 && t < 15 ? { lp: true, lk: true } : {}), dur: 200 },
      { name: "OBJECTION! catches SECURITY's ESCORT", at: () => [430, 515], setup: p2as('security'), p2: (me, o, t) => (t >= 8 && t < 11 ? { lp: true, lk: true, dx: Math.sign(o.x - me.x) } : {}), p1: [],
        react: (me, o, t) => (t < 0 ? back('lp')(me) : o.state === 'attack' && o.move === 'escort' ? back('lp')(me) : null), dur: 220 },
      { name: 'OBJECTION! loses to a strike (his jab: a counter hit)', setup: p2as(TEMP_ID), p1: [[6, back('lp')]], p2: (me, o, t) => (t >= 12 && t < 15 ? { lp: true } : {}), dur: 160 },
      { name: 'OBJECTION! whiffed: the recovery is punished', setup: p2as(TEMP_ID), p1: [[6, back('lp')]], p2: punish, dur: 180 },
      { name: 'CROSS-EXAMINATION f+1 blocked (plus, he steps in), then the throw beats his guard', at: () => [400, 480], setup: p2as(TEMP_ID), p2: (me, o) => (o.state === 'attack' || me.state === 'blockstun' ? { back: true } : {}), p1: [[10, fwd('lp')], ...pressIn],
        react: (me, o, t) => (t < 0 ? { lp: true, lk: true } : t > 12 && me.state === 'idle' && o.state === 'blockstun' ? { lp: true, lk: true } : null), dur: 200 },
      { name: 'CROSS-EXAMINATION blocked, he ducks the throw: the mid (snap kick) hits the croucher', at: () => [400, 480], setup: p2as(TEMP_ID),
        p2: (me, o, t) => (me.state === 'blockstun' || (o.state === 'attack' && o.move === 'lawyer_crossExam') ? { back: true } : t > 20 ? { back: true, down: true } : {}), p1: [[10, fwd('lp')], ...pressIn],
        react: (me, o, t) => (t < 0 ? B('lk') : t > 12 && me.state === 'idle' && o.crouch ? B('lk') : null), dur: 200 },
      { name: 'CROSS-EXAMINATION on hit: the cross links', setup: p2as(TEMP_ID), p1: [[10, fwd('lp')]], react: (me, o, t) => (t < 0 ? { cross: true } : me.state === 'attack' && me.hitConfirmed && o.state === 'hitstun' ? { cross: true } : null), dur: 180 },
      { name: 'CLOSING ARGUMENT 2,3,2 by the wall (splat)', at: () => [W1() - 300, W1() - 210], setup: p2as(TEMP_ID), p1: [[10, B('rp')], [32, B('lk')], [54, B('rp')]], dur: 240 },
    ],
    ceo: [
      { name: 'GOLDEN PARACHUTE b+1: his cross passes through', at: () => [560, 646], p2: (me, o, t) => (t >= 4 && t < 7 ? { rp: true } : {}), p1: [[23, back('lp')]], dur: 160 },
      { name: 'GOLDEN PARACHUTE: his throw passes through', at: () => [560, 632], p2: (me, o, t) => (t >= 12 && t < 15 ? { lp: true, lk: true } : {}), p1: [[12, back('lp')]], dur: 160 },
      { name: 'GOLDEN PARACHUTE: the landing is open (he follows it in, a cross catches it)', at: () => [560, 650], p1: [[6, back('lp')]],
        p2: (me, o, t) => (o.state === 'attack' && o.move === 'ceo_parachute' && sim.stepsSince(o, 'start') >= 28 ? clean(me, { rp: true }) : t > 8 && Math.abs(o.x - me.x) > 100 ? { dx: Math.sign(o.x - me.x), run: true } : {}), dur: 160 },
      { name: 'HOSTILE TAKEOVER d/f+2 launches, d/f+2 again in the air: the ender carries him into the wall', at: () => [W0() + 300, W0() + 220],
        p1: [[10, (me) => ({ rp: true, down: true, dx: me.facing })]],
        react: (me, o, t) => (t < 0 || (me.state === 'attack' && me.move === 'ceo_takeover' && me.hitConfirmed && o.state === 'knockdown' && o.juggle) ? { rp: true, down: true, dx: me.facing } : null), dur: 260 },
      { name: 'uppercut d+2 launches, HOSTILE TAKEOVER ends it', at: () => [400, 470], p1: [[10, D('rp')]],
        react: (me, o, t) => (t < 0 || (me.state === 'attack' && me.move === 'uppercut' && me.hitConfirmed && o.state === 'knockdown' && o.juggle) ? { rp: true, down: true, dx: me.facing } : null), dur: 260 },
      { name: 'HOSTILE TAKEOVER blocked: open, the cross punishes', p2: (me, o) => (me.state === 'blockstun' || o.phase !== 'recovery' ? { back: true } : punish(me, o)), p1: [[10, (me) => ({ rp: true, down: true, dx: me.facing })]], dur: 150 },
      { name: 'STOCK SPLIT 2,1,2 (two-hit ender)', at: () => [400, 490], p1: [[10, B('rp')], [30, B('lp')], [48, B('rp')]], dur: 220 },
    ],
  });
  Object.assign(scenes, { 'receptionist-test'(o) { timeline(PHASES.receptionist, o); }, 'lawyer-test'(o) { timeline(PHASES.lawyer, o); }, 'ceo-test'(o) { timeline(PHASES.ceo, o); } });
  Object.assign(SCENE_CHARS, { 'receptionist-test': ['receptionist', TEMP_ID], 'lawyer-test': ['lawyer', TEMP_ID], 'ceo-test': ['ceo', TEMP_ID] });
}
function pickChars(name, opts) {
  if (opts && opts.chars) return opts.chars;
  if (SCENE_CHARS[name] && !urlChars[0]) return SCENE_CHARS[name];
  if (name === 'attract') {
    const r = roster(), a = r[(Math.random() * r.length) | 0], b = r[(Math.random() * r.length) | 0];
    return [a.id, b.id];
  }
  return [urlChars[0] || TEMP_ID, urlChars[1] || TEMP_ID];
}
// the scenes the flow starts for a player's own fight: they run on the player's round time and best-of
const PICKED_RULES = new Set(['arcade', 'horde', 'dummy']);
function setScene(name, opts) {
  if (!scenes[name]) name = 'play';
  sceneName = name;
  sim.setCharacters(pickChars(name, opts));
  syncMirror();
  attract = name === 'attract'; attractKO = false; idleMs = 0; lastPhase = '';
  document.documentElement.classList.toggle('attract', attract && !(flow && flow.on));   // index.html hides the touch controls (the flow has its own classes)
  applyLook(name === 'arcade' && opts && opts.stage ? opts.stage : null);
  try { gameAudio.attach(attract ? null : sim); } catch (e) { /* audio: no whiff or pool watching during the demo */ }
  try { if (!(flow && flow.on)) gameAudio.setMusicPool(attract ? 'menu' : null); } catch (e) { /* audio: with the flow off, the demo plays the menu pool and scenes follow the sim */ }
  farDrawnW = 0; bodiesDrawn = true; // redraw the static layers once
  shakeRng = mulberry32(7);
  shake.trauma = 0; shake.kickX = shake.kickY = 0; shake.zoomPunch = 0;
  lights.length = 0; blockSparks.length = 0; paused = false; statusFX.reset(); perfectFX.reset();
  ghosts.length = 0; poseState.clear(); drawnJ.clear(); drawnOff.clear(); life.reset();   // the draw smoothing starts fresh (no turnaround out of the last scene's facing)
  camera.x = W / 2; camera.y = H / 2; camera.zoom = 1; camZoom = 1; camera.shakeX = camera.shakeY = 0;
  // botches on or off (the pause menu's switch, ?botch=0); online, the host's setting from the start message
  sim.botchOn = name === 'online' && opts && opts.lockstep ? opts.botch !== false : botchEnabled();
  // the round time and best-of: online the host's (the start message), in the flow's own fights the player's
  // (src/flow/rules.js, the pause menu), and everywhere else (the demo, ?scene= tests) the defaults
  const picked = PICKED_RULES.has(name) && flow && flow.on;
  const rules = name === 'online' && opts && opts.lockstep && opts.rules ? opts.rules
    : picked ? { roundTime: roundTime(), winsNeeded: winsFor(bestOf()) } : { roundTime: DEFAULT_ROUND_TIME, winsNeeded: winsFor(DEFAULT_BEST_OF) };
  sim.roundTime = rules.roundTime; sim.winsNeeded = rules.winsNeeded;
  sim.perfectOn = true; sim.perfectSkip = 'any';   // the perfect round finisher: on everywhere, any player's press skips (online: the scene says winner)
  scenes[name](opts || {});
  updateCamera(1, true);
}

// ---- camera ------------------------------------------------------------------------------
// Tekken-style framing. At close range the view is sized from the taller fighter's own body: 4 head
// heights (a head is 2 x rig.radius) of air over his standing head and 1 under his feet, so two fighters
// in each other's face fill the frame. As they separate it eases out so both bodies plus a leg's reach
// stay in frame, down to the wide framing (zoom 1) at full-screen distance. Whatever the zoom, every
// live body (its real joints) stays inside the frame and under the HUD strip: a jump or a launch pans
// up first and eases out when the pan isn't enough. Everything comes from the bodies, sim.bounds and
// the floors' data, never from a fixed stage width. Frozen while either fighter is in hitstop: the
// contact pose has to hold on screen.
const CAM = {
  headroom: 4, footroom: 1,   // head heights over the taller standing head and under the feet, at close range
  wide: 1.0,                  // the far end: full-screen apart
  reachK: 0.95,               // a leg's reach past each root, as a share of standing height (kicks run 80-120 px)
  engage: 420,                // horde: another goon this close to the hero joins the frame
  padX: 28, padBot: 10, padTop: HUD_TOP + 12,   // screen px a body keeps from the edges (the top clears the bars, names and hints)
  soft: 48,                   // screen px more that the eased target keeps, so the camera starts moving before the hard fit has to
  zoomIn: 3, zoomOut: 9,      // easing rates: push in slowly, pull out quickly
};
let camZoom = 1;   // the framing's zoom; camera.zoom is this times the zoom punch
let camCut = false;   // the next update cuts instead of easing (a round starts: the fighters are back on their spawns)
const standCache = new WeakMap();
// a rig's standing height (floor to the top of the head, idle stance) and head height, per body
function standOf(rig) {
  let c = standCache.get(rig);
  if (!c || c.body !== rig.body || c.scale !== rig.scale) {
    const j = rig._solve(RIG_KIT.STANCE);
    c = { body: rig.body, scale: rig.scale, h: rig.y - (j.head.y - rig.radius), head: 2 * rig.radius };
    standCache.set(rig, c);
  }
  return c;
}
// where a body will be drawn this frame, head and limb ends included. The drawing (frameDraw: last frame's pose
// with the turnaround, snap fade and smoothing offset applied) can lag the real pose: the snap fade lands between
// where it was drawn (moved with the root) and the real pose, and an air move's catch-up (drawOffset) moves at most
// HEAD_STEP px a frame toward it. During that catch-up the real pose is left out, because it runs ahead on fast moves
// (the vault's drop, an air jab from far out) and following it lurches the camera ahead of the body.
const camRoot = new WeakMap();
function extentOf(u) {
  const r = u.rig.radius, raw = u.rig.joints, o = drawnOff.get(u) || NO_OFF, ds = drawState.get(u);
  // the snap fade is kept relative to the root, so while one runs the drawing also moves with the root
  const lastRoot = camRoot.get(u), ps = poseState.get(u), fading = !!(ps && ps.fadeT > 0 && lastRoot);
  let sx = fading ? u.rig.x - lastRoot.x : 0, sy = fading ? u.rig.y - lastRoot.y : 0;
  if (Math.hypot(sx, sy) > SNAP_MAX) sx = sy = 0;   // a change of floor, not a move
  camRoot.set(u, { x: u.rig.x, y: u.rig.y });
  let dj = drawnJ.get(u);
  // a drawing farther off than the snap fade ever spans is stale (a goon respawned at a door, a body set down elsewhere)
  if (dj && dj.hip && raw.hip && Math.hypot(dj.hip.x + o.x - raw.hip.x, dj.hip.y + o.y - raw.hip.y) > SNAP_MAX + 40) dj = null;
  const catchUp = !!(dj && ds && ds.on);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const k in raw) {
    const p = raw[k], d = dj && dj[k];
    if (!catchUp || !d) add(p.x, p.y);
    if (!d) continue;
    const dx = d.x + o.x, dy = d.y + o.y;
    add(dx, dy); add(dx + sx, dy + sy);
    if (catchUp) add(dx + Math.max(-HEAD_STEP, Math.min(HEAD_STEP, p.x - dx)), dy + Math.max(-HEAD_STEP, Math.min(HEAD_STEP, p.y - dy)));
  }
  if (!(x1 >= x0)) return { x0: u.x - 40, x1: u.x + 40, y0: u.y - 140, y1: u.y };
  return { x0: x0 - r, x1: x1 + r, y0: y0 - r, y1: y1 + 0.5 * r };
}
const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
// the bodies the camera frames: the hero and the goon he is on, plus (horde) any other goon close enough to matter
function camLive() {
  const a = sim.units[0], b = sim.focus;
  const live = [a, b].filter(u => u && !u.hidden);
  for (const u of sim.units) if (u !== a && u !== b && !u.hidden && Math.abs(u.x - a.x) < CAM.engage) live.push(u);
  return live;
}
// How far the touch controls (the stick on the left, the button cluster on the right) reach into the stage, in
// canvas px. On a phone held sideways the gutters beside the 16:9 stage are narrow and the controls sit over it,
// so the camera keeps the bodies between them. Zero wherever the controls aren't over the stage (desktop, a pad,
// portrait, where they sit under it). Read from the layout twice a second, never every frame.
let insetAt = -1e9, insetL = 0, insetR = 0;
function touchInsets() {
  const now = performance.now();
  if (now - insetAt < 500) return;
  insetAt = now; insetL = insetR = 0;
  if (!touchUI()) return;
  const st = document.getElementById('stage'), cl = document.querySelector('.tc-cluster'), base = document.querySelector('.tc-base');
  if (!st) return;
  const S = st.getBoundingClientRect(), k = W / Math.max(1, S.width);
  const over = (r) => r.width > 0 && r.height > 0 && r.top < S.bottom && r.bottom > S.top;
  if (cl) { const r = cl.getBoundingClientRect(); if (over(r)) insetR = Math.min(W * 0.25, Math.max(0, S.right - r.left) * k); }
  if (base) { const r = base.getBoundingClientRect(); if (over(r)) insetL = Math.min(W * 0.25, Math.max(0, r.right - S.left) * k); }
}
// The last word, once frameDraw has placed this frame's drawing: whatever the prediction in updateCamera missed
// (a contact snap, a fade that outran it), the drawn bodies stay inside the frame and under the HUD strip.
function fitCameraToDrawn() {
  if (sim.hitstopActive > 0) return;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const u of camLive()) {
    const j = drawnJ.get(u) || u.rig.joints, o = drawnOff.get(u) || NO_OFF, r = u.rig.radius;
    for (const k in j) { const px = j[k].x + o.x, py = j[k].y + o.y; if (px - r < x0) x0 = px - r; if (px + r > x1) x1 = px + r; if (py - r < y0) y0 = py - r; if (py + 0.5 * r > y1) y1 = py + 0.5 * r; }
  }
  if (!(x1 >= x0)) return;
  const sx0 = CAM.padX + insetL, sx1 = W - CAM.padX - insetR;   // the screen span bodies keep to
  const zf = Math.min((H - CAM.padTop - CAM.padBot) / Math.max(1, y1 - y0), (sx1 - sx0) / Math.max(1, x1 - x0));
  if (camera.zoom > zf && zf >= 0.85) { camZoom = Math.min(camZoom, zf); camera.zoom = zf; }
  const z = camera.zoom, hh = H / 2 / z;
  camera.x = clamp(camera.x, x1 - (sx1 - W / 2) / z, x0 - (sx0 - W / 2) / z);
  camera.y = clamp(camera.y, y1 + CAM.padBot / z - hh, y0 - CAM.padTop / z + hh);
}
function updateCamera(dt, snap = false) {
  if (sim.hitstopActive > 0) { camera.shakeX = 0; camera.shakeY = 0; return; }
  if (camCut) { snap = true; camCut = false; }
  const live = camLive();
  touchInsets();
  const sx0 = CAM.padX + insetL, sx1 = W - CAM.padX - insetR;   // the screen span bodies keep to (the touch controls narrow it)
  // where each body is on the floor: a tumbling (point-simulated) or vaulting body is wherever its hip
  // is, not its floor line (a body falling down the stairwell already belongs to the floor below)
  const at = (u) => {
    const h = u.rig && u.rig.joints && u.rig.joints.hip;
    return (u.rag || u.state === 'vault') && h ? { x: h.x, y: h.y + 58 } : { x: u.x, y: u.y };
  };
  const P = live.map(at);
  if (!P.length) return;
  const dy = P.length > 1 ? Math.abs(P[0].y - P[1].y) : 0;
  let xa = Infinity, xb = -Infinity, ex0 = Infinity, ex1 = -Infinity, ey0 = Infinity, ey1 = -Infinity, tall = null;
  for (const p of P) { xa = Math.min(xa, p.x); xb = Math.max(xb, p.x); }
  for (const u of live) {
    const e = extentOf(u); ex0 = Math.min(ex0, e.x0); ex1 = Math.max(ex1, e.x1); ey0 = Math.min(ey0, e.y0); ey1 = Math.max(ey1, e.y1);
    const st = standOf(u.rig); if (!tall || st.h > tall.h) tall = st;
  }
  const head = tall.head, standH = tall.h;
  // close range: the taller body plus 4 heads over it and 1 under, filling the frame's height
  const zClose = H / (standH + (CAM.headroom + CAM.footroom) * head);
  // apart: both roots plus a leg's reach each side, and every drawn limb, across the frame's width
  const needW = Math.max(xb - xa + 2 * CAM.reachK * standH, ex1 - ex0);
  let zt = Math.min(zClose, Math.max(CAM.wide, (sx1 - sx0) / needW));
  // every live body fits (a launch, a jump, two floors apart), with a soft margin so the zoom eases out before
  // fitCameraToDrawn has to force it; below the wide framing only when it must
  const fitZ = (s) => Math.min((H - CAM.padTop - CAM.padBot - 2 * s) / Math.max(1, ey1 - ey0), (sx1 - sx0 - 2 * s) / Math.max(1, ex1 - ex0));
  const zFit = fitZ(0);
  zt = Math.min(zt, Math.max(fitZ(CAM.soft), Math.min(zFit, CAM.wide)));
  if (dy > 120 || zFit < CAM.wide) zt = Math.max(0.85, zt);   // two floors apart (a floor break, the follow-down)
  else zt = Math.max(CAM.wide, zt);
  // the KO slow-mo leans in (as a share, so it reads the same at any zoom), never so far it crops
  if (sim.koSlow > 0) zt = Math.max(zt, Math.min(zt * (sim.finisher ? 1.12 : 1.065), zFit));
  camZoom = snap ? zt : camZoom + (zt - camZoom) * (1 - Math.exp(-dt * (zt < camZoom ? CAM.zoomOut : CAM.zoomIn)));
  // the zoom punch on a heavy hit's release lands on top, as a share of the framing (never past the fit)
  shake.zoomPunch *= Math.exp(-dt * 14);
  if (shake.zoomPunch < 0.002) shake.zoomPunch = 0;
  camera.zoom = Math.min(camZoom * (1 + shake.zoomPunch), Math.max(camZoom, zFit));
  // the framing goes by camZoom; the hard fit by the zoom actually on screen, punch included
  const z = camZoom, hw = W / 2 / z, hh = H / 2 / z, ze = camera.zoom, hhe = H / 2 / ze;
  // horizontal: centered on the bodies; the view may run 120px past either wall (the exterior is painted),
  // so a body thrown into the corner lands on screen
  const vb = sim.viewBounds || sim.bounds;   // the whole building: a fight can spread over both floors and the stairs
  const wx0 = vb.x0 - 120 + hw, wx1 = vb.x1 + 120 - hw;
  const fitX = (v, s = 0) => clamp(v, ex1 - (sx1 - s - W / 2) / ze, ex0 - (sx0 + s - W / 2) / ze);
  const mid = (xa + xb) / 2 - ((sx0 + sx1) / 2 - W / 2) / z;   // the pair's middle on the middle of that span
  const tx = fitX(wx1 > wx0 ? Math.max(wx0, Math.min(wx1, mid)) : (wx0 + wx1) / 2, CAM.soft);
  // vertical: close in, the feet sit 1 head over the bottom edge; at the wide framing the old center
  // (the floor line less 120); in between, a blend by zoom. Never past the lowest floor (plus a little
  // ground) or far above the highest one, and never cropping a body or putting a head under the HUD.
  const yF = Math.max(...P.map(p => p.y)), yMid = P.reduce((s, p) => s + p.y, 0) / P.length;
  const k = Math.max(0, Math.min(1, (z - CAM.wide) / Math.max(0.01, zClose - CAM.wide)));
  const fl = sim.floors;
  const yMax = Math.max(...fl.map(f => f.y)) + 80, yMin = Math.min(...fl.map(f => f.y)) - 440;
  const fitY = (v, s = 0) => clamp(v, ey1 + (CAM.padBot + s) / ze - hhe, ey0 - (CAM.padTop + s) / ze + hhe);
  let ty = (yMid - 120) * (1 - k) + (yF + CAM.footroom * head - hh) * k;
  ty = fitY(yMax - hh < yMin + hh ? yMax - hh : Math.max(yMin + hh, Math.min(yMax - hh, ty)), CAM.soft);
  // a flying body is followed hard; otherwise the camera eases. These are targets from the predicted drawing;
  // fitCameraToDrawn makes the guarantee on the real one, so a pose that jumps ahead of its drawing never pops the frame
  const flying = sim.units.some(u => !u.hidden && !u.grounded && (u.state === 'knockdown' || u.state === 'ko'));
  const falling = sim.units.some(u => !u.hidden && (u.falling || u.state === 'vault'));
  const followX = flying ? 22 : 8, followY = falling ? 10 : 6;
  camera.x = snap ? tx : camera.x + (tx - camera.x) * (1 - Math.exp(-dt * followX));
  camera.y = snap ? ty : camera.y + (ty - camera.y) * (1 - Math.exp(-dt * followY));
  shake.trauma = Math.max(0, shake.trauma - dt * 2.4);
  // the kick snaps back to center (it was leaving a lurch); trauma jitters around zero
  const kk = Math.exp(-dt * 32);
  shake.kickX *= kk; shake.kickY *= kk;
  if (Math.abs(shake.kickX) < 0.5) shake.kickX = 0;
  if (Math.abs(shake.kickY) < 0.5) shake.kickY = 0;
  // shake is in world px: scale it with the zoom so it reads the same size on screen as it did at the old framing
  const amp = shake.trauma * shake.trauma * 20, sk = 1.3 / Math.max(1, z);
  camera.shakeX = (shake.kickX + (amp ? (shakeRng() * 2 - 1) * amp : 0)) * sk;
  camera.shakeY = (shake.kickY + (amp ? (shakeRng() * 2 - 1) * amp * 0.8 : 0)) * sk;
}

// ---- frame ----------------------------------------------------------------------------------
function advance(ms) {
  // an online match: only the netcode moves the sim, whatever screen the flow is on (its demo screens hold a KO
  // card longer and start a new bout after one round, which on one phone only would split the two fights)
  const netMatch = online.active, flowRuns = flow && flow.on && (!netMatch || flow.state === 'onlineFighting');
  if (flowRuns) { if (!flow.update(ms)) return; }   // flow: menus, stage cards, pause and results hold the sim
  else if (!netMatch) { if (paused) return; if (attractFlow(ms)) return; }
  // the finisher beat: a KO by an ender runs at quarter speed
  const slow = sim.koSlow > 0 ? (sim.finisher ? 0.25 : 0.5) : 1;
  if (netMatch) online.advance(ms * slow); else sim.step(ms * slow);   // online: the netcode owns the stepping
  if (flowRuns) { if (flow.afterStep()) return; }   // flow: demo bouts, round and match ends
  else if (attract && (sim.round > 1 || sim.phase === 'match')) { setScene('attract'); return; }   // one round per demo bout
  const dt = ms / 1000;
  for (let i = lights.length - 1; i >= 0; i--) { lights[i].ttl -= dt; if (lights[i].ttl <= 0) lights.splice(i, 1); }
  for (let i = blockSparks.length - 1; i >= 0; i--) { blockSparks[i].ttl -= dt * slow; if (blockSparks[i].ttl <= 0) blockSparks.splice(i, 1); }
  for (const u of sim.units) {
    if (u.state === 'attack' && u.phase === 'active' && trailPrev[u.id] && u.hitstop === 0) fx.trail(trailPrev[u.id], u.rig.joints, u.color);
    trailPrev[u.id] = copyJoints(u.rig.joints, trailPrev[u.id]);
  }
  fx.update(dt * slow);
  updateCamera(dt);
}

const flashCanvas = document.createElement('canvas');
// parallax > 1 makes a layer follow the camera harder (the foreground: the street lamp outside)
function applyCamera(ctx, layer, parallax = 1) {
  const s = layer.width / W, z = camera.zoom * parallax;
  ctx.setTransform(s * z, 0, 0, s * z, s * (W / 2 - (camera.x + camera.shakeX) * z), s * (H / 2 - (camera.y + camera.shakeY) * z));
}
function drawFlash(u, figCtx, color = '#fff', alpha = 0.3) {
  const L = fx.layers.figures;
  if (flashCanvas.width !== L.width || flashCanvas.height !== L.height) { flashCanvas.width = L.width; flashCanvas.height = L.height; }
  const c = flashCanvas.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, L.width, L.height);
  applyCamera(c, flashCanvas);
  u.rig.draw(c);
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-in';
  c.fillStyle = color; c.fillRect(0, 0, L.width, L.height);
  // a tint, not a replacement: the body's own color has to stay readable through it
  figCtx.save(); figCtx.setTransform(1, 0, 0, 1, 0, 0); figCtx.globalAlpha = alpha; figCtx.drawImage(flashCanvas, 0, 0); figCtx.restore();
}
// The rig's block pose is close to its idle guard, so the glue draws a guard mark:
// a double bar in front of the chest, in the fighter's color.
function drawGuard(u, ctx) {
  // standing guard covers the head and chest; a crouching guard sits low, at the shins
  const low = !!u.crouch;
  const x = u.x + u.facing * 24, top = u.y - (low ? 62 : 112), bot = u.y - (low ? 14 : 58);
  ctx.save();
  ctx.strokeStyle = u.color; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.globalAlpha = 0.95;
  ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + u.facing * 4, bot); ctx.stroke();
  ctx.lineWidth = 2.5; ctx.globalAlpha = 0.7;
  ctx.beginPath(); ctx.moveTo(x + u.facing * 9, top + 8); ctx.lineTo(x + u.facing * 13, bot - 6); ctx.stroke();
  ctx.restore();
}
// Block read: a hard chevron at the forearms pointing back at the attacker plus three
// short static spark lines. No burst, no ring: it should not look like a hit.
function drawBlockSpark(s, ctx) {
  const k = s.ttl / s.max, d = s.dir, z = s.scale || 1;
  ctx.save();
  ctx.translate(s.x, s.y); ctx.scale(z, z); ctx.translate(-s.x, -s.y);   // sized by the blocked strike (BLOCK_FX)
  ctx.globalAlpha = Math.min(1, k * 1.6);
  ctx.strokeStyle = '#e6f2ff'; ctx.lineWidth = 3.5; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  ctx.beginPath(); ctx.moveTo(s.x - d * 12, s.y - 16); ctx.lineTo(s.x + d * 2, s.y); ctx.lineTo(s.x - d * 12, s.y + 16); ctx.stroke();
  ctx.lineWidth = 2;
  for (const [ax, ay, len] of [[-0.9, -0.5, 16], [-1, 0.1, 20], [-0.8, 0.6, 14]].slice(0, s.lines || 3)) {
    ctx.beginPath(); ctx.moveTo(s.x - d * 14 + d * ax * 4, s.y + ay * 4); ctx.lineTo(s.x - d * 14 + d * ax * (4 + len), s.y + ay * (4 + len)); ctx.stroke();
  }
  ctx.restore();
}
// Layer uploads are the costliest per-frame step on phones, so layers that did not change are not
// redrawn and the FX is told to skip their upload: the far skyline is static (redrawn when the FX
// resizes its layers for a quality tier, or on a scene change), and an empty body layer stays empty.
let farDrawnW = 0, bodiesDrawn = true;
const FAR_STEP = 64, farBase = { x: 0, y: 0 };
// The building's still art (both floors) and the still part of its glow live in world bitmaps (src/arena/cache.js),
// redrawn only when the camera leaves them or zooms to another step. The background goes straight to the
// compositor as a texture (fx.bgSource, no per-frame upload); the glow is one drawImage into the emissive
// layer, with the city's lights and the flickering tubes drawn live over it. A door swinging open (horde)
// draws the background live for that second. ?cache=0 turns both off, for comparisons.
const SCENERY = { x0: -260, y0: -260, x1: 2820, y1: 980 };
const bgCache = createWorldCache(SCENERY), emiCache = createWorldCache(SCENERY);
const useCache = params.get('cache') !== '0';
const bgMap = [1, 1, 0, 0], viewNow = { x0: 0, y0: 0, x1: 0, y1: 0 };
const bgSource = { canvas: bgCache.canvas, version: 0, map: bgMap };
function doorsMoving() { for (const k in arena.doorState) if (arena.doorState[k].t > 0) return true; return false; }
const drawnOff = new Map(), NO_OFF = { x: 0, y: 0 };   // this frame's draw-smoothing offsets, for the status effects
const drawOffsetNow = (u) => drawnOff.get(u) || NO_OFF;

function render() {
  syncMirror();   // the guest's view flips on when his match starts and off when it ends, however it ends
  // this frame's drawing first (the turnaround, snap fade and air catch-up), so the camera can make sure it's all in frame
  const drawnNow = new Map();
  for (const u of sim.units) if (!u.hidden) drawnNow.set(u, frameDraw(u));
  fitCameraToDrawn();
  const ctxs = {};
  const haveBodies = !arena.bodiesInBackground && arena.bodies && arena.bodies.length > 0;
  if (fx.skip) { fx.skip.far = false; fx.skip.bodies = !haveBodies && !bodiesDrawn; }
  // the still scenery from its caches, when they can hold this view (both at the layers' resolution times the zoom)
  const sceneScale = camera.zoom * (fx.layers.background.width / W), sceneKey = (camera.mirror ? 'm' : '') + arena.style;
  viewRect(camera, W, H, viewNow);
  const bgCached = useCache && !doorsMoving() && bgCache.ensure(viewNow, sceneScale, sceneKey, (c) => arena.drawBackground(c, camera));
  if (bgCached) { bgSource.version = bgCache.version; bgCache.map(camera, W, H, bgMap); fx.bgSource = bgSource; }
  else fx.bgSource = null;
  if (fx.skip) fx.skip.background = bgCached;
  const emiCached = useCache && !!arena.drawEmissive && emiCache.ensure(viewNow, sceneScale, sceneKey, (c) => arena.drawEmissive(c, camera, 'static'));
  for (const k of ['far', 'background', 'bodies', 'figures', 'emissive', 'foreground']) {
    const L = fx.layers[k];
    if (!L) continue;
    if (k === 'far') {
      // the skyline moves at the far parallax; across the wide building that's more than one screen of it, so
      // it's redrawn shifted by a whole step (FAR_STEP px) when the camera has moved that far, and the
      // compositor moves it the rest of the way (fx.far.base)
      const par = (fx.far && fx.far.parallax) || arena.farParallax || 0.35, fbx = Math.round((camera.x - W / 2) * par / FAR_STEP) * FAR_STEP;
      if (fbx !== farBase.x) { farBase.x = fbx; farDrawnW = 0; }
      if (fx.far) fx.far.base = farBase;
    }
    if (fx.skip && k === 'far' && farDrawnW === L.width) { fx.skip.far = true; continue; }
    if (fx.skip && k === 'bodies' && fx.skip.bodies) continue;
    if (k === 'background' && bgCached) continue;
    const ctx = L.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, L.width, L.height);
    // far: identity camera, the FX applies its own parallax and haze; foreground: harder follow
    if (k === 'far') ctx.setTransform(L.width / W, 0, 0, L.height / H, 0, 0);
    else applyCamera(ctx, L, k === 'foreground' ? (arena.foregroundParallax || 1) : 1);
    ctxs[k] = ctx;
  }
  // far first: the background leaves its window openings transparent so the skyline shows through
  if (ctxs.far && arena.drawFar) { arena.drawFar(ctxs.far, { ...camera, farBase }); farDrawnW = fx.layers.far.width; }
  bodiesDrawn = haveBodies;
  if (!bgCached) arena.drawBackground(ctxs.background, camera);
  if (emiCached) { emiCache.blit(ctxs.emissive); arena.drawEmissive(ctxs.emissive, camera, 'live'); }
  else if (arena.drawEmissive) arena.drawEmissive(ctxs.emissive, camera);
  // the pile goes on the FX bodies layer (lit like the room, so corpses take the scene's color),
  // under the live fighters; older FX without that layer get it on the figures layer
  if (!arena.bodiesInBackground && arena.drawBodies && !(fx.skip && fx.skip.bodies)) arena.drawBodies(ctxs.bodies || ctxs.figures);
  // the life layer runs on real time, and not at all while the sim stands still (paused, a menu over the fight)
  const lifeDt = sim.stepCount !== lifeStep ? Math.min(0.05, lastFrameMs / 1000) : 0; lifeStep = sim.stepCount;
  const figs = figureJoints(drawnNow, lifeDt);
  const order = [...sim.units].sort((p, q) => (p.state === 'attack') - (q.state === 'attack') || q.id - p.id);
  for (const u of order) {
    if (u.hidden) continue;
    const { off, joints } = figs.get(u);
    const realJ = u.rig.joints; u.rig.joints = joints;   // the turnaround and snap fade, drawn only (put back below)
    ctxs.figures.save(); ctxs.figures.translate(off.x, off.y);
    try {
      u.rig.draw(ctxs.figures);
      if (u.state === 'block' || u.state === 'blockstun' || (u.state === 'crouch' && u.backHeld)) drawGuard(u, ctxs.figures);
      if (u.flash > 0) drawFlash(u, ctxs.figures, '#fff', statusFX.counterOn(u) ? 0.65 : 0.3);   // a counter hit flashes harder
      // a knocked-down body reads as down: 30% darker while it is on the floor
      else if (u.state === 'down' || u.state === 'roll' || u.state === 'ko') drawFlash(u, ctxs.figures, '#000', 0.3);
    } finally {
      // the real joints go back whatever happened: the rig's joints feed the hitboxes and the online hash
      ctxs.figures.restore();
      u.rig.joints = realJ; u.rig.cloth = null;
    }
  }
  perfectFX.drawWorld(ctxs.figures, sim, lastFrameMs / 1000);   // the perfect finisher: the body in the winner's hand
  drawGhosts(ctxs.figures, ctxs.emissive);
  // ragdolls: KO'd horde goons still in the air after their unit respawned
  for (const r of sim.ragdolls || []) {
    let j = {}; for (const k in r.joints) j[k] = { x: r.x + r.joints[k].x, y: r.y + r.joints[k].y };
    const rad = {}; for (const k in j) rad[k] = k === 'head' ? r.radius : 2.5;
    j = fitToGround(j, rad, () => r.floorY, { side: r.facing });   // the floor guard: a goon flying off doesn't skim through the floor
    if (typeof drawJoints === 'function') drawJoints(ctxs.figures, j, r.color, 5, r.radius);
  }
  for (const s of blockSparks) drawBlockSpark(s, ctxs.emissive);
  // status effects go on the emissive layer, which the compositor hides over the fighters (owner req 5)
  const statusLights = statusFX.draw(ctxs.emissive, sim, { dt: lastFrameMs / 1000, tier: fx.tier || 3, offset: drawOffsetNow });
  if (arena.drawForeground) arena.drawForeground(ctxs.foreground || ctxs.figures);
  fx.lights = [...(arena.lights || []), ...lights.map(l => ({ x: l.x, y: l.y, radius: l.radius, color: l.color, intensity: l.intensity * (l.ttl / l.max) })), ...statusLights];
  perf.mark('draw');
  fx.render(camera);
  perf.mark('gl');
  const fl = flow && flow.on ? flow.hud() : null;   // flow: score, names, no HUD under a menu, the title card only on the title
  if (toast) { toast.t -= lastFrameMs / 1000; if (toast.t <= 0) toast = null; }
  const layout = hud.draw({ sim, camera, dt: lastFrameMs / 1000, debug, scene: sceneName, paused: fl ? false : paused, help, toast, found: help ? techniques().filter(t => t.found) : null,
    attract: attract && (!fl || fl.card) ? { touch: touchUI(), domPrompt: !!fl } : null, flow: fl,
    under: perfectFX.active || sim.perfectT >= 0 ? (c) => perfectFX.drawScreen(c, sim, camera, lastFrameMs / 1000) : null, bannerUp: sim.perfectT >= 0 && sim.perfectRel >= 0 });
  if (fl) flow.frame(layout);
  perf.mark('hud');
}
// the joints each body is drawn with this frame: the draw smoothing (frameDraw, already in drawnNow), then the life
// layer on top, then the floor guard, drawn only
function figureJoints(drawnNow, lifeDt) {
  const out = new Map();
  for (const u of sim.units) {
    if (u.hidden) continue;
    const { off, joints: smoothJ } = drawnNow.get(u);
    const floor = floorFor(u, off);
    out.set(u, { off, joints: floor.fit(life.apply(u, smoothJ, sim, lifeDt, floor)) });
  }
  return out;
}
// ---- the floor guard (README, Floors: bodies never sink into the floor) -----------------------------------------
// The sim keeps its own joints on top of the floor (the ground snap and the point simulation use each joint's
// drawn radius, a pose on a flight is fitted to its treads). Some layers move the drawing after that: the
// turnaround's squash (on a flight it mirrors a pose fitted to the steps), the snap fade, the air catch-up, the life
// layer's springs, takes and hit wave. The last word before a body is drawn: no joint's drawn edge goes below the
// surface under it (fitToGround in src/fighter/ground.js: the limb turns up off the floor, a planted foot is set on
// it, the body lifts as a whole if it has to). The surface is the one the sim uses for that body: its floor (the
// main floor's walking strip runs behind the rails, over the holes), a flight's real tread tops, and for a body
// falling through a stairwell the slab outside the holes, the treads and the floor below.
const LYING_DRAW = new Set(['knockdown', 'ko', 'down', 'getup', 'roll', 'grabbed', 'thrown', 'splat', 'vault']);
function groundOf(u) {
  const fl = sim.floors, main = fl[0].y, low = fl[1] ? fl[1].y : main, S = sim.stairs || [], wells = sim.stairwells || [];
  const tread = (k, x) => { const st = S[k]; return x < Math.min(st.back0, st.foot) || x > Math.max(st.back0, st.foot) ? null : arena.treadY(k, x); };
  // the topmost surface at or under a joint (its centre may already be sunk up to 40px into it)
  const top = (x, y, first) => {
    let b = first != null && first >= y - 40 ? first : null;
    for (let k = 0; k < S.length; k++) { const t = tread(k, x); if (t != null && t >= y - 40 && (b == null || t < b)) b = t; }
    return low >= y - 40 && (b == null || low < b) ? low : b;
  };
  if (u.falling || u.state === 'vault') return (x, y) => top(x, y, wells.some(w => x > w.x0 && x < w.x1) ? null : main);
  if (u.rag) {
    if (u.rig.slopes || (u.rig.treads && u.rig.treads.length)) return (x, y) => top(x, y, null);
    const fy = u.ragFloor; return () => fy;
  }
  if (u.stair != null && u.stair >= 0 && S[u.stair]) { const k = u.stair; return (x) => arena.treadY(k, x); }
  if ((u.floor || 0) === 0) return () => main;
  return (x, y) => top(x, y, null);
}
function floorFor(u, off) {
  const g = groundOf(u), ox = off.x, oy = off.y;
  // the higher of the surfaces half a px either side: a joint right on a riser's line counts the upper tread
  const ground = (x, y) => { const a = g(x + ox - 0.5, y + oy), b = g(x + ox + 0.5, y + oy), v = a == null ? b : b == null ? a : Math.min(a, b); return v == null ? null : v - oy; };
  const rad = u.rig.drawnRadii || u.rig.radii || {};
  const wake = u.state === 'attack' && FRAME_DATA[u.move] && FRAME_DATA[u.move].wake && u.wakeUp === 1;
  const opt = { planted: !(u.rag || LYING_DRAW.has(u.state) || wake), side: u.facing };
  return { ground, fit: (M) => fitToGround(M, rad, ground, opt) };
}
// ---- draw smoothing: a visual-only catch-up for air moves ---------------------------------------
// Some air attacks have to cover 50-90px between the press and the contact pose in two or three
// frames, and a jumper landing on the defender gets pushed apart in one. The sim and the rig keep
// those positions (hit detection, contact accuracy and the netcode's state all use them); only the
// drawing is held to HEAD_STEP px per 60fps frame and catches up at that pace, which it finishes in
// the hit freeze, so a contact still draws touching. Launches, throws and ragdolls draw raw.
const HEAD_STEP = 20, AIR_TAIL_MS = 220;
const SMOOTH_STATES = new Set(['jump', 'attack', 'landing', 'idle', 'walk', 'crouch', 'block', 'blockstun', 'vault']);
const drawState = new Map();
function drawOffset(u) {
  const h = u.rig && u.rig.joints && u.rig.joints.head;
  let st = drawState.get(u);
  if (!h) return { x: 0, y: 0 };
  if (!st) { st = { x: 0, y: 0, px: h.x, py: h.y, airAt: -1e9, t: 0 }; drawState.set(u, st); }
  const dt = Math.max(1, lastFrameMs);
  st.t += dt;
  // only the fighter's own jump, air attacks and the landing after them; a launched or juggled body draws raw
  // (the stairwell vault is the fighter's own move too: its leap and its handoff to standing get the catch-up)
  const ownAir = u.state === 'jump' || u.state === 'vault' || (u.state === 'attack' && FRAME_DATA[u.move] && FRAME_DATA[u.move].air);
  if (ownAir) st.airAt = st.t;
  const calm = SMOOTH_STATES.has(u.state) && !u.rag;
  const smoothing = calm && st.t - st.airAt < AIR_TAIL_MS;
  st.on = smoothing;
  const jump = Math.hypot(h.x - st.px, h.y - st.py);
  // a strike that connects draws touching (owner requirement): the catch-up ends on the contact frame,
  // under the impact flash
  if (u.hitstop > 0 || (st.on && sim.hitstopActive > 0 && u.state === 'attack')) { st.x = st.y = 0; st.px = h.x; st.py = h.y; return st; }
  if (!smoothing || jump > 240) {
    // raw drawing; an offset left over from an air move fades out quickly instead of popping
    st.x *= 0.5; st.y *= 0.5; if (Math.abs(st.x) + Math.abs(st.y) < 0.5) st.x = st.y = 0;
    if (jump > 240) st.x = st.y = 0;   // a reset or a respawn: no catching up across the room
  } else {
    const cap = HEAD_STEP * dt / (1000 / 60);
    const dx = h.x - st.px, dy = h.y - st.py, d = Math.hypot(dx, dy);
    const k = d > cap ? cap / d : 1;
    const nx = st.px + dx * k, ny = st.py + dy * k;
    st.x = nx - h.x; st.y = ny - h.y;
  }
  st.px = h.x + st.x; st.py = h.y + st.y;
  return st;
}
function copyJoints(src, dst) {
  if (!src) return dst;
  dst = dst || {};
  for (const k in src) { const p = dst[k] || (dst[k] = { x: 0, y: 0 }); p.x = src[k].x; p.y = src[k].y; }
  return dst;
}
// where the head and hip are drawn this frame (the turnaround, the snap fade and the smoothing offset applied), for measurements
function drawnPoints(u) {
  const j = drawnJ.get(u) || (u.rig && u.rig.joints), off = drawnOff.get(u) || NO_OFF;
  if (!j || !j.head) return null;
  const at = (p) => ({ x: p.x + off.x, y: p.y + off.y });
  const all = {}; for (const k in j) all[k] = at(j[k]);
  return { head: at(j.head), hip: at(j.hip), all };
}

// ---- draw smoothing on the ground: the turnaround and the snap fade (visual only) ----------------
// Both only read the sim and the rig and change what is drawn this frame; hit detection, contact and
// the netcode's state keep the real pose. Classic 2D fighters never mirror a sprite in place: facing
// flips play a turn. Here a grounded fighter whose facing flips is drawn pivoting on his feet over
// TURN_MS: the drawing is squashed horizontally about the root from the old facing (-1) through zero to
// the new (+1). Anything else that would still move the drawn body more than SNAP_PX in one frame (a
// lying body re-posed for a roll, a knockdown clip snapped to its landing, a pose cut short) is
// cross-faded from where it was drawn over FADE_MS instead. A launched, thrown, falling or ragdoll
// body draws raw, the jump and air moves keep drawOffset's catch-up, and a strike that connects draws
// touching: both end on the contact frame, under the impact flash.
const TURN_MS = 100, FADE_MS = 110, SNAP_PX = 18, SNAP_HEAD = 1e9, SNAP_MAX = 260;
const UPRIGHT = new Set(['idle', 'walk', 'run', 'block', 'blockstun', 'crouch', 'attack', 'landing', 'hitstun', 'botch', 'getup']);   // getup: the turn to face him as a roll comes up (sim rollStep)
const poseState = new Map(), drawnJ = new Map();
const cloneJ = (j) => { const o = {}; for (const k in j) o[k] = { x: j[k].x, y: j[k].y }; return o; };
function frameDraw(u) {
  const off = drawOffset(u); drawnOff.set(u, off);
  const real = u.rig.joints;
  let ps = poseState.get(u);
  if (!ps) { ps = { facing: u.facing, turnT: 0, fadeT: 0, from: null, last: null }; poseState.set(u, ps); }
  const dt = Math.max(1, lastFrameMs);
  const raw = u.rag || u.falling || u.state === 'grabbed' || u.state === 'splat' || u.state === 'vault' || (u.state === 'knockdown' && !u.grounded) || (u.state === 'ko' && !u.grounded);
  const contact = u.hitstop > 0 || (sim.hitstopActive > 0 && u.state === 'attack');
  const air = !!(drawState.get(u) && drawState.get(u).on);   // drawOffset is already catching this body up
  // the turnaround: a grounded, upright fighter's facing flipped since the last frame
  if (u.facing !== ps.facing) {
    ps.turnT = !raw && !contact && u.grounded && UPRIGHT.has(u.state) ? TURN_MS : 0;
    ps.facing = u.facing;
  }
  if (raw || contact) { ps.turnT = 0; ps.fadeT = 0; }
  let J = real;
  if (ps.turnT > 0) {
    const k = 1 - ps.turnT / TURN_MS, sx = -Math.cos(Math.PI * k), px = u.rig.x;   // -1 (the old facing) .. 0 .. 1
    J = {};
    for (const n in real) J[n] = { x: px + (real[n].x - px) * sx, y: real[n].y };
    ps.turnT = Math.max(0, ps.turnT - dt);
  }
  // the snap fade: a jump from where this body was drawn last frame
  // (a discontinuity: far more than the body moved the frame before, so fast motion that is really
  // motion, a glide, a stagger, a run, is never filtered)
  const L = ps.last, rh = real.hip, mv = ps.rh ? Math.hypot(rh.x - ps.rh.x, rh.y - ps.rh.y) : 0;
  if (L && L.hip && !raw && !contact && !air && mv > 1.8 * (ps.mv || 0) + 6) {
    const dh = Math.hypot(J.hip.x - L.hip.x, J.hip.y - L.hip.y), dd = Math.hypot(J.head.x - L.head.x, J.head.y - L.head.y);
    if ((dh > SNAP_PX || dd > SNAP_HEAD) && dh < SNAP_MAX && dd < SNAP_MAX) {
      // kept relative to the root, so the root's own motion from here on (a roll, a slide) passes straight through
      ps.from = {}; for (const n in L) ps.from[n] = { x: L[n].x - u.rig.x, y: L[n].y - u.rig.y };
      ps.fadeT = FADE_MS;
    }
  }
  ps.rh = { x: rh.x, y: rh.y }; ps.mv = mv;
  if (ps.fadeT > 0 && ps.from) {
    const w = ps.fadeT / FADE_MS, e = w * w * (3 - 2 * w), F = ps.from, src = J, rx = u.rig.x, ry = u.rig.y;   // smoothstep: leaves the old pose softly
    J = {};
    for (const n in src) J[n] = F[n] ? { x: src[n].x + (F[n].x + rx - src[n].x) * e, y: src[n].y + (F[n].y + ry - src[n].y) * e } : src[n];
    ps.fadeT = Math.max(0, ps.fadeT - dt);
  }
  ps.last = J === real ? cloneJ(real) : J;
  drawnJ.set(u, J);
  return { off, joints: J };
}

// ---- instant relocations get a mark ----------------------------------------------------------
// The sim's one remaining teleport (a body jammed in the stairwell set down on the floor, 'relocate')
// leaves an afterimage where the body was and a flash at both spots, so it reads as an event.
const ghosts = [];
function relocateFX(ev) {
  const u = ev.unit, j = drawnJ.get(u) || u.rig.joints;
  if (j && j.head) ghosts.push({ joints: cloneJ(j), color: u.color, radius: (u.rig.radius || 11), ttl: 0.4, max: 0.4 });
  for (const p of [ev.from, ev.to]) {
    light(p.x, p.y, 160, [0.75, 0.9, 1.0], 1.0, 0.3);
    fx.hit({ x: p.x, y: p.y, strength: 0.5, dir: 1, flashR: 46, debris: 'none' });
  }
}
function drawGhosts(ctx, glow) {
  for (let i = ghosts.length - 1; i >= 0; i--) {
    const g = ghosts[i];
    g.ttl -= lastFrameMs / 1000;
    if (g.ttl <= 0) { ghosts.splice(i, 1); continue; }
    const k = g.ttl / g.max;
    for (const [c, a] of [[ctx, 0.45 * k], [glow, 0.8 * k]]) {
      if (!c) continue;
      c.save(); c.globalAlpha = a;
      drawJoints(c, g.joints, g.color, 5, g.radius);
      c.restore();
    }
  }
}

// ---- attract mode ------------------------------------------------------------------------------
// index.html with no ?scene= opens on the demo (attract) and comes back to it: after 30s with no
// input during a game, and when a match ends. A ?scene= URL never leaves the scene it asked for.
const attractHome = !params.has('scene');
const IDLE_MS = 30000;
let idleMs = 0, lastPhase = '', attractKO = false;
const touchUI = () => { const c = document.documentElement.classList; return c.contains('touch-ui') && !c.contains('pad-ui'); };
function startFromAttract() {
  if (!attract) return;
  input.swallowHeld();   // the key or button that started it doesn't also throw a punch
  if (arena.clearBodies) arena.clearBodies();
  setScene('play');
}
// before each step: the demo's KO card holds a beat longer; a game left alone goes back to the demo
function attractFlow(ms) {
  if (attract) {
    if (sim.phase === 'ko' && !attractKO) { attractKO = true; sim.phaseTimer = 1.6; }   // hold the KO after the body rests
    return false;
  }
  if (!attractHome || (sceneName !== 'play' && sceneName !== 'horde')) return false;
  const s = input.snapshot();
  if (s.dx || s.jump || s.down || s.block || s.run || s.lp || s.rp || s.lk || s.rk) idleMs = 0;
  else idleMs += ms;
  const matchOver = lastPhase === 'match' && sim.phase !== 'match';   // the sim just reset after the WINS card
  lastPhase = sim.phase;
  if (idleMs > IDLE_MS || matchOver) { setScene('attract'); return true; }
  return false;
}
// any key (but a bare modifier or a shortcut), any pad button, any touch or click starts a game
window.addEventListener('keydown', (e) => {
  idleMs = 0;
  if (!attract || (flow && flow.on) || e.repeat || /^(Meta|Control|Alt|Shift|OS|CapsLock)/.test(e.code) || e.metaKey || e.ctrlKey || e.altKey) return;
  startFromAttract();
});
input.onPad(() => { idleMs = 0; if (!(flow && flow.on)) startFromAttract(); });
for (const t of ['pointerdown', 'touchstart']) {
  window.addEventListener(t, (e) => {
    idleMs = 0;
    if (!attract || (flow && flow.on)) return;   // with the flow on, a tap only wakes the sound (src/audio/); START is a button
    const el = e.target instanceof Element ? e.target : null;
    if (el && el.closest('[class^="sf-"], [class*=" sf-"], #credits')) return;   // the menu button, its panel and the credits link are left alone
    startFromAttract();
  }, { capture: true, passive: true });
}

// ---- arcade flow ---------------------------------------------------------------------------------
// Plain index.html runs the flow (src/flow/): title and demo, mode select, the arcade ladder,
// continue, game over, initials and the high score table, pause, and the online menus. It holds
// or steps the sim through advance() above, and picks scenes through setScene. A ?scene= URL or
// __gauntlet.setScene turns it off, and the code above behaves as it always has.
const DEFAULT_LOOK = { preset: 'night-rain', color: P2_COLOR, floor: 0 };
let look = DEFAULT_LOOK, lookPreset = 'night-rain';
function applyLook(l) {
  look = l || DEFAULT_LOOK;
  if (look.preset !== lookPreset && typeof fx.preset === 'function') {
    lookPreset = look.preset;
    try { fx.preset(look.preset); } catch (e) { console.warn('[glue] fx.preset:', e.message); }
    if (/-rain$/.test(look.preset) && arena.rainRegion && typeof fx.weather === 'function') fx.weather('rain', { rate: 160, wind: -0.3, region: arena.rainRegion });
  }
  // an arcade stage's opponent wears the stage's neon (its character's, or the stage's own for a TEMP
  // standing in for a character that isn't built yet); other scenes keep the characters' colors
  const u = sim.units[1];
  if (l && u && u.rig) { u.rig.color = look.color || P2_COLOR; u.color = u.rig.color; }
}
// a fight that starts on another floor (the stairs go back up, so the round's floor break is still there
// once someone takes the fight upstairs)
function startOnFloor(f) {
  const info = sim.floorInfo(f);
  if (!info) return;
  sim.floor = f; sim.floorBroken = false;
  sim.units.forEach((u, i) => {
    const sp = info.spawns[Math.min(i, info.spawns.length - 1)];
    u.floor = f; u.stair = -1; u.x = sp.x; u.y = sp.y; u.facing = sp.facing;
    u.rig.x = sp.x; u.rig.y = sp.y; u.rig.facing = sp.facing; u.rig.update(0);
  });
}
const padUI = () => document.documentElement.classList.contains('pad-ui');
setNet(adaptOnline(online));
flow = createFlow({
  sim, input,
  scene: (name, opts) => setScene(name, opts),
  sceneName: () => sceneName,
  touchUI, padUI,
  click: (kind) => { try { gameAudio.actions && gameAudio.actions.click(kind); } catch (e) { /* audio off */ } },   // audio: menu clicks through the public API
  music: (pool) => gameAudio.setMusicPool(pool),   // audio: the flow pins the music pool per screen
  netBusy: () => !!online.busy,
});
window.__flow = flow;

// ---- hotkeys -----------------------------------------------------------------------------------
input.onKey((code) => {
  if (online.onKey(code)) return;   // online: no pause, reset or horde mid-match; Esc / Select asks to leave
  if (flow && flow.on) { if (!flow.allowHotkey(code)) return; }   // flow: P, R and G belong to its pause menu
  else if (attract) return;   // in the demo every key (pad Start included) starts a game instead, above
  if (code === 'KeyH') debug = !debug;
  else if (code === 'F1' || code === 'Slash') help = !help;
  else if (code === 'KeyP') paused = !paused;
  else if (code === 'KeyR') setScene(sceneName);
  else if (code === 'KeyG') setScene(sceneName === 'horde' ? 'play' : 'horde');
  else if (code === 'Minus') sim.setDifficulty(sim.difficulty - 0.1);
  else if (code === 'Equal') sim.setDifficulty(sim.difficulty + 0.1);
});

// ---- loop + gauntlet hook ---------------------------------------------------------------------------
let lastFrameMs = 16;
let last = performance.now();
if (attractHome) flow.start({ room: online.roomFromUrl() });   // plain index.html: the arcade flow (?room=CODE opens JOIN with the code)
else setScene(params.get('scene'));
window.__gauntlet = {
  scenes: Object.keys(scenes),
  setScene(name, opts) { driven = true; flow.off(); setScene(name, opts); render(); },   // a scene on demand: the flow steps aside
  step(ms) { driven = true; lastFrameMs = ms; advance(ms); render(); },
  ready: false,   // true once fonts are in and the first frame has rendered
};
window.__game = { caches: { bg: bgCache, emi: emiCache }, drawState, sim, camera, fx, perfectFX, arena, fighters, roster, getCharacter, setScene(name, opts) { flow.off(); setScene(name, opts); }, advance, flow, get attract() { return attract; }, get sceneName() { return sceneName; },
  // measurement hooks: a frame stepped without drawing (the draw smoothing still runs), and where a body is drawn
  stepQuiet(ms) { driven = true; lastFrameMs = ms; advance(ms); for (const u of sim.units) if (!u.hidden) frameDraw(u); fitCameraToDrawn(); },
  drawn: (u) => drawnPoints(u), poseState, life,
  // a frame stepped and posed exactly as render() poses it (draw smoothing, life layer, cloth), without painting:
  // fn(figs) sees each unit's { off, joints } and u.rig.cloth before the cloth is cleared (scripts/floorlog)
  stepPosed(ms, fn) {
    driven = true; lastFrameMs = ms; advance(ms);
    const drawnNow = new Map();
    for (const u of sim.units) if (!u.hidden) drawnNow.set(u, frameDraw(u));
    fitCameraToDrawn();
    const lifeDt = sim.stepCount !== lifeStep ? Math.min(0.05, lastFrameMs / 1000) : 0; lifeStep = sim.stepCount;
    const figs = figureJoints(drawnNow, lifeDt);
    try { if (fn) fn(figs); } finally { for (const u of sim.units) if (u.rig) u.rig.cloth = null; }
  } };
// The first frame doesn't wait for the web fonts (it used to, for up to 2.5 s): the game draws at once, and the
// HUD's canvas text, cached as bitmaps, is redrawn in the real faces when they arrive (hud.js empties its text
// cache on the fonts' loadingdone). Captures still get no load race: __gauntlet.ready turns true only once the
// two faces are in (or a short wait passed, offline) and a frame has rendered with them.
render();
try { performance.mark('sf:first-frame'); } catch (e) { /* old browser */ }   // the load harness times this (scripts/perf/run.mjs --load)
// Embedded in the homepage (an iframe), the page tells the game when its frame scrolls off screen
// ({ type: 'sf:visible', visible }); while it's hidden, the demo and menus stop simulating and drawing
// so the page around it scrolls smoothly. A match (and anything online) never pauses this way.
let embedHidden = false;
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || e.data.type !== 'sf:visible') return;
  embedHidden = !e.data.visible;
});
function frame(now) {
  const ms = Math.max(0, Math.min(100, now - last)); last = now;   // rAF's timestamp can be a little before the performance.now() it follows
  const idle = embedHidden && !online.active && flow && flow.on && flow.demo;
  perf.begin(now);
  if (!driven && !idle) { lastFrameMs = ms; advance(ms); perf.mark('sim'); render(); }
  perf.end();
  requestAnimationFrame(frame);
}
last = performance.now();
requestAnimationFrame(frame);
// the HUD asks for its two faces by name (an unused web font never loads on its own)
try {
  if (document.fonts && document.fonts.load) await Promise.race([Promise.all(['40px Bungee', '600 20px Teko', '500 20px Teko'].map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 2500))]);
  await document.fonts.ready;
} catch (e) { /* no font API */ }
await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
window.__gauntlet.ready = true;
// what the profiler reports alongside the times: the tier, the DPR and the size the GL canvas draws at
const perfInfo = () => perf.setInfo({ tier: fx.tier, adaptive: fx.adaptive, dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100, hud: dpr, w: glCanvas.width, h: glCanvas.height });
perfInfo(); setInterval(perfInfo, 1000);
// What real players get (README, Analytics, 'perf'): once a session, after 30 s on the page with the tier unchanged for
// the last 15 s, the tier it settled on, the one it started on, touch or mouse, the frame time p95 (ms, as a label)
// and the p50 as the number. A tab that's hidden or closed sooner sends what it had after 10 s.
{
  const t0 = performance.now(), startTier = fx.tier;
  let tierNow = fx.tier, tierSince = t0, sent = false;
  const send = () => {
    if (sent || performance.now() - t0 < 10000) return;
    sent = true;
    const s = perf.summary();
    track('perf', [`t${fx.tier}`, `start t${startTier}`, matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse', `p95 ${Math.round(s.iv.p95)}`], Math.round(s.iv.p50 * 10) / 10);
  };
  const tick = setInterval(() => {
    const now = performance.now();
    if (fx.tier !== tierNow) { tierNow = fx.tier; tierSince = now; }
    if (now - t0 > 30000 && now - tierSince > 15000 && !document.hidden) { send(); clearInterval(tick); }
  }, 1000);
  addEventListener('pagehide', send);
  document.addEventListener('visibilitychange', () => { if (document.hidden) send(); });
}
if (params.get('perf') === '1') perfOverlay(document.getElementById('stage'));
