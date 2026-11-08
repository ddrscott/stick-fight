// The arcade flow: one state machine for everything around a fight. main.js steps it once per
// frame (update, before the sim; afterStep, after it), feeds it the sim's events (event), and
// draws what it asks for (hud). Every state change goes through go(), which refuses any move
// that isn't in TRANSITIONS, so a stray double press can't skip a screen or land in a state that
// makes no sense. history keeps the last moves for tests (window.__flow.history).
//
//   off             a ?scene= URL or __gauntlet.setScene: the flow stays out of the way
//   attract         the CPU demo under the title: START, HIGH SCORES, CONTROLS. Only the START
//                   button (or Enter/Space/A on it, or pad Start) starts. A tap anywhere else only
//                   wakes the sound
//   highScores      the top-5 table between demo bouts, after a game, or from the title
//   controls        the fight and menu controls, keyboard and gamepad (from the title)
//   modeSelect      ARCADE, VERSUS ONLINE, HORDE, TRAINING: the MAIN MENU every screen offers
//   charSelect      pick a fighter (select.js) for the mode picked; training then picks the dummy
//   stageIntro      the stage card (sim held), then fighting
//   fighting        a round on; roundEnd while the sim shows KO/TIME; back to fighting next round
//   result          the match is over: YOU WIN / YOU LOSE holds while the winner walks
//   stageClear      the tally, then the next stageIntro (or the ending after the boss)
//   continue        10 second countdown: retry the stage or gameOver
//   gameOver        the final score, then enterInitials (a top-5 score) or highScores
//   enterInitials   three letters for the table
//   ending          the credits after the ladder
//   paused          RESUME / RESTART / BOTCHES / CONTROLS / MAIN MENU over the held scene (single-player modes)
//   onlineMenu, onlineHost, onlineJoin, onlineConnecting, onlineFighting, onlineEnd   (netApi.js)
//
// The 30 second idle return only runs where nothing is lost: the menus (mode select, the online
// menu and join screen, a finished online match) and training. Never mid-match: an arcade or
// horde run left alone plays itself out (the CPU or the goons win), then CONTINUE runs down, the
// score is offered to the table (entered as it stands after 30 more seconds), and the cabinet is
// back on the demo with the score kept. A paused game stays paused.
//
// Every screen that waits on the player has at least two buttons and a footer legend; the control
// scheme (one for every screen) is in controls.js. "MAIN MENU" always means modeSelect.

import { LADDER, buildLadder } from './ladder.js';
import { openSelect } from './select.js';
import { roster, getCharacter, characterOr, TEMP_ID } from '../characters/index.js';
import * as S from './scores.js';
import { createMenuInput } from './menuInput.js';
import { createUI, el, button } from './ui.js';
import { techniques, botchEnabled, setBotchEnabled } from './techniques.js';
import { getNet, setNet, cleanCode, roomLink, CODE_ALPHABET, CODE_LEN } from './netApi.js';
import { controlsTable, FIGHT, MENUS, startName } from './controls.js';

// every legal move ('off' is always allowed: the gauntlet hooks can take over at any time)
const TRANSITIONS = {
  off: ['attract', 'onlineJoin', 'charSelect'],
  attract: ['modeSelect', 'highScores', 'controls', 'install'],
  highScores: ['attract', 'modeSelect'],
  controls: ['attract', 'modeSelect'],
  install: ['attract', 'modeSelect'],
  modeSelect: ['attract', 'stageIntro', 'fighting', 'onlineMenu', 'charSelect'],
  charSelect: ['modeSelect', 'stageIntro', 'fighting', 'onlineMenu', 'onlineJoin', 'attract'],
  stageIntro: ['fighting', 'modeSelect'],
  fighting: ['roundEnd', 'result', 'paused', 'attract'],
  roundEnd: ['fighting', 'result', 'paused'],
  result: ['stageClear', 'continue', 'gameOver'],
  stageClear: ['stageIntro', 'ending', 'modeSelect'],
  continue: ['stageIntro', 'gameOver'],
  gameOver: ['enterInitials', 'highScores', 'modeSelect'],
  enterInitials: ['highScores'],
  ending: ['enterInitials', 'highScores', 'modeSelect'],
  paused: ['fighting', 'roundEnd', 'stageIntro', 'attract', 'modeSelect'],
  onlineMenu: ['modeSelect', 'charSelect', 'onlineHost', 'onlineJoin', 'onlineEnd', 'attract'],
  onlineHost: ['onlineMenu', 'onlineFighting', 'onlineEnd', 'modeSelect'],
  onlineJoin: ['onlineMenu', 'onlineConnecting', 'attract'],
  onlineConnecting: ['onlineJoin', 'onlineFighting', 'onlineEnd', 'modeSelect'],
  onlineFighting: ['onlineEnd'],
  onlineEnd: ['onlineMenu', 'onlineHost', 'onlineConnecting', 'modeSelect', 'attract'],
};
// the demo runs (silent) behind these; highScores holds a fresh bout still behind the table
const DEMO = new Set(['attract', 'controls', 'install', 'modeSelect', 'charSelect', 'onlineMenu', 'onlineHost', 'onlineJoin', 'onlineConnecting', 'onlineEnd']);
// the sim steps in these (plus onlineFighting, unless the net module steps it)
const STEPS = new Set([...DEMO, 'fighting', 'roundEnd', 'result']);
// the HUD draws in these; everything else is a menu over a dimmed scene, HUD off
const HUD_ON = new Set(['attract', 'fighting', 'roundEnd', 'result', 'paused', 'onlineFighting']);
// the player is fighting: touch controls up, menu keys off except pause
const PLAY = new Set(['fighting', 'roundEnd', 'result', 'onlineFighting']);
const IDLE_MS = 30000;
const ONLINE = new Set(['onlineMenu', 'onlineHost', 'onlineJoin', 'onlineConnecting', 'onlineFighting', 'onlineEnd']);

/**
 * What main.js hands the flow.
 * @typedef {object} FlowCtx
 * @property {any} sim
 * @property {{ swallowHeld(): void }} input
 * @property {(name: string, opts?: any) => void} scene   main.js setScene: 'attract', 'arcade' ({ stage }), 'horde', 'dummy'
 * @property {() => string} sceneName
 * @property {() => boolean} touchUI
 * @property {() => boolean} padUI
 * @property {(kind?: string) => void} [click]            a menu click (src/audio/'s public actions.click)
 * @property {() => boolean} [netBusy]                    online.js's own panel (leave confirm, messages) is up: it owns the keys and the pad
 * @property {(pool: string|null) => void} [music]       pin the music pool (src/audio/'s setMusicPool): 'menu', 'fight', 'horde', 'calm', or null to follow the sim
 */

// the music pool for each screen: menus get the title track, a match gets its mode's pool
const MENU_MUSIC = new Set(['attract', 'highScores', 'controls', 'install', 'modeSelect', 'charSelect', 'gameOver', 'enterInitials', 'ending', 'onlineMenu', 'onlineHost', 'onlineJoin', 'onlineConnecting', 'onlineEnd']);

/** @param {FlowCtx} ctx */
export function createFlow(ctx) {
  const sim = ctx.sim;
  let state = 'off';
  let t = 0;   // seconds in this state (flow time: advances with the game's frames)
  let idle = 0;   // ms since the last key, touch, click or pad input
  let mode = null;
  const run = { stage: 0, score: 0, stageStart: 0, continues: 0, floors: 0, goons: 0 };
  let bonus = { text: '', t: 0 };
  let resumeTo = 'fighting';
  let demoKO = false;
  let hs = { mode: 'arcade', highlight: -1, postGame: false, loop: 0, manual: false };
  let menu = null;   // createMenuInput's handle (swallow), made below
  let retryTo = null;   // onlineEnd's RETRY: the screen that failed before a match started (onlineHost, onlineConnecting)
  let pauseView = 'tech';   // the pause menu's right panel: 'tech' (the happy accidents) or 'controls'
  let entry = null;
  let resultWin = false, clearBonus = 0;
  let endMsg = '', joinCode = '', netSession = 0;
  let netOff = [];
  const hp = new WeakMap ();
  // the character select: which mode it's for, whether it's picking the player or (training) the dummy,
  // the picks (kept between runs, so the cursor starts on your last fighter), and the live screen
  const sel = { mode: null, step: 'player', player: TEMP_ID, dummy: TEMP_ID, join: false };
  let selCtl = null;
  const ladder = () => run.ladder || LADDER;
  const history = [];
  const ui = createUI((k) => { if (ctx.click) ctx.click(k); });
  ui.pauseBtn.addEventListener('click', () => { if (state === 'fighting' || state === 'roundEnd') pause(); });

  // ---- transitions ----------------------------------------------------------------------------
  function go(next) {
    if (next === state) return false;
    if (next !== 'off' && !TRANSITIONS[state].includes(next)) { console.warn(`[flow] refused ${state} -> ${next}`); return false; }
    const prev = state;
    leave(prev, next);
    state = next; t = 0; idle = 0;
    history.push(`${prev}>${next}`); if (history.length > 300) history.shift();
    // the press that changed screens stays out of the next one: menus ignore it, and so does the
    // fighter, until it's let go (a round rolling over mid-fight isn't a screen change: a held guard stays held)
    if (!(PLAY.has(prev) && PLAY.has(next))) { if (menu) menu.swallow(); try { ctx.input.swallowHeld(); } catch { /* old input */ } }
    classes();
    enter(next, prev);
    music();
    return true;
  }
  function music() {
    if (!ctx.music) return;
    const pool = state === 'off' ? null
      : MENU_MUSIC.has(state) ? 'menu'
      : mode === 'horde' ? 'horde' : mode === 'training' ? 'calm' : 'fight';
    try { ctx.music(pool); } catch (e) { /* audio off */ }
  }
  function classes() {
    const c = document.documentElement.classList;
    for (const k of [...c]) if (k.startsWith('fl-')) c.remove(k);
    c.toggle('flow-on', state !== 'off');
    if (state === 'off') return;
    c.add(`fl-${state}`);
    if (PLAY.has(state)) c.add('fl-play');
  }
  function leave(prev, next) {
    if (ONLINE.has(prev) && !ONLINE.has(next)) netReset();
    if (prev === 'onlineFighting') netReset();   // a finished or abandoned match hangs up (leave() is a no-op if it already did)
    if (prev === 'charSelect') selCtl = null;
  }
  function enter(s, prev) {
    switch (s) {
      case 'off': ui.clear(); netReset(); mode = null; return;
      case 'attract': mode = null; if (ctx.sceneName() !== 'attract') demo(); return screenTitle();
      case 'highScores': demo(); return screenScores();
      case 'controls': ensureDemo(); return screenControls();
      case 'install': ensureDemo(); return screenInstall();
      case 'modeSelect': mode = null; ensureDemo(); return screenModes();
      case 'charSelect': ensureDemo(); return screenSelect();
      case 'stageIntro': return screenStage();
      case 'fighting': ui.clear(); return;   // go() swallowed the press that got us here, so it doesn't throw a punch
      case 'roundEnd': return roundBonus();
      case 'result': return screenResult();
      case 'stageClear': return screenClear();
      case 'continue': return screenContinue();
      case 'gameOver': return screenGameOver();
      case 'enterInitials': return screenInitials();
      case 'ending': return screenEnding();
      case 'paused': return screenPause();
      case 'onlineMenu': mode = null; ensureDemo(); return screenOnline();
      case 'onlineHost': ensureDemo(); return screenHost();
      case 'onlineJoin': ensureDemo(); return screenJoin();
      case 'onlineConnecting': return screenConnecting();
      case 'onlineFighting':
        mode = 'online'; ctx.input.swallowHeld(); ui.clear();
        try { getNet().startMatch(); } catch (e) { endMsg = String(e && e.message || e); go('onlineEnd'); }
        return;
      case 'onlineEnd': mode = null; ensureDemo(); return screenOnlineEnd();
    }
  }

  // ---- the scene behind --------------------------------------------------------------------------
  function demo() { demoKO = false; ctx.scene('attract'); }
  function ensureDemo() { if (ctx.sceneName() !== 'attract') demo(); }
  function newRun(m) { mode = m; run.stage = 0; run.score = 0; run.stageStart = 0; run.continues = 0; run.floors = 0; run.goons = 0; bonus = { text: '', t: 0 }; }
  function add(points, label = '') {
    if (!points) return;
    run.score += Math.round(points);
    if (label) bonus = { text: label, t: 2 };
  }

  // ---- per frame ------------------------------------------------------------------------------------
  /** before the sim steps; returns whether main.js should step the sim this frame */
  function update(ms) {
    if (state === 'off') return true;
    const dt = ms / 1000;
    t += dt; idle += ms;
    if (bonus.t > 0) bonus.t -= dt;
    if (DEMO.has(state)) {
      // the demo's KO card holds a beat longer
      if (sim.phase === 'ko' && !demoKO) { demoKO = true; sim.phaseTimer = 1.6; }
      if (idle > IDLE_MS && (state === 'controls' || state === 'install' || state === 'modeSelect' || state === 'charSelect' || state === 'onlineMenu' || state === 'onlineJoin' || state === 'onlineEnd')) go('attract');
    }
    if (state === 'charSelect' && selCtl) selCtl.tick(dt);
    switch (state) {
      case 'highScores': if (hs.postGame || hs.manual ? idle > IDLE_MS : t > 7) go('attract'); break;   // the attract loop's table turns over; one the player is reading waits
      case 'stageIntro': if (t > 3.4) go('fighting'); break;
      case 'fighting': if (mode === 'training' && idle > IDLE_MS) go('attract'); break;
      case 'result': if (t > 2.6) decide(); break;
      case 'stageClear': if (t > 5) nextStage(); break;
      case 'continue': if (t >= 10) go('gameOver'); else tickContinue(); break;
      case 'gameOver': if (t > 6) afterGame(); break;
      case 'ending': if (t > 17) afterGame(); break;
      case 'enterInitials': if (idle > IDLE_MS) submitInitials(); break;
    }
    if (state === 'onlineFighting') {
      const net = getNet();
      if (net.step) { net.step(ms); return false; }
      return true;
    }
    return STEPS.has(state);
  }
  /** after the sim stepped; true if the flow changed the scene (main.js skips the rest of the frame) */
  function afterStep() {
    if (state === 'off') return false;
    if (DEMO.has(state)) {
      if (sim.round > 1 || sim.phase === 'match') {   // one round per demo bout
        if (state === 'attract') { hs = { mode: hs.loop % 2 ? 'horde' : 'arcade', highlight: -1, postGame: false, loop: hs.loop + 1 }; go('highScores'); }   // the two tables take turns
        else demo();
        return true;
      }
      return false;
    }
    if (mode !== 'arcade' && mode !== 'horde') return false;
    trackDamage();
    if (state === 'fighting' && sim.phase === 'ko') go('roundEnd');
    else if (state === 'roundEnd' && (sim.phase === 'intro' || sim.phase === 'fight')) go('fighting');
    if ((state === 'fighting' || state === 'roundEnd') && sim.phase === 'match') go('result');
    return false;
  }
  function trackDamage() {
    for (let i = 1; i < sim.units.length; i++) {
      const u = sim.units[i], was = hp.get(u);
      if (was != null && u.health < was) add((was - u.health) * S.POINTS.damage);
      hp.set(u, u.health);
    }
  }
  /** the sim's events (main.js onEvent): scoring */
  function event(ev) {
    if ((mode !== 'arcade' && mode !== 'horde') || !(state === 'fighting' || state === 'roundEnd')) return;
    const P = S.POINTS;
    if (ev.type === 'hit' && ev.attacker && ev.attacker.id === 0) {
      const combo = (ev.defender && ev.defender.combo) || 0;
      if (combo >= 2) add(P.comboHit * (combo - 1));
      if (ev.counter) add(P.counter);
      if (sim.horde && ev.ko && ev.defender && ev.defender.id >= 1) { add(P.goonDown); run.goons++; }
    } else if (ev.type === 'callout') {
      if (ev.kind === 'ender' && ev.by === 0) add(P.ender);
      else if (ev.kind === 'finish' && ev.by === 0) add(P.finish, 'FINISH');
      else if (ev.kind === 'trick' && ev.by === 0) {
        if (ev.text === 'FLOOR BREAK') add(P.floorBreak, 'FLOOR BREAK');
        else if (ev.text !== 'FLOOR CLEAR') add(P.trick);
      } else if (ev.kind === 'break' && ev.by === 0) add(P.throwBreak);
    } else if (ev.type === 'floorClear') {
      run.floors = ev.floorsCleared || run.floors + 1;
      add(P.floorClear, 'FLOOR CLEAR');
    }
  }
  function roundBonus() {
    if (mode !== 'arcade' || sim.winner !== 0) return;
    const secs = Math.floor(sim.timer), perfect = sim.units[0].health >= sim.startHealth;
    const pts = S.POINTS.roundWin + secs * S.POINTS.timeBonus + (perfect ? S.POINTS.perfect : 0);
    add(pts, perfect ? 'PERFECT' : 'ROUND');
  }
  function decide() {
    if (mode === 'horde') {
      entry = { mode: 'horde', score: run.score, note: `${run.floors} FLOOR${run.floors === 1 ? '' : 'S'}` };
      go('gameOver');
    } else if (resultWin) {
      const st = ladder()[run.stage];
      clearBonus = S.POINTS.stageClear * st.n;
      add(clearBonus);
      go('stageClear');
    } else go('continue');
  }
  function nextStage() {
    if (state !== 'stageClear') return;   // a second press in the same frame must not skip a stage
    if (run.stage >= ladder().length - 1) { entry = { mode: 'arcade', score: run.score, note: 'ALL CLEAR' }; go('ending'); return; }
    run.stage++;
    go('stageIntro');
  }
  function afterGame() {
    if (state !== 'gameOver' && state !== 'ending') return;
    if (entry && S.rankFor(entry.mode, entry.score) >= 0) { go('enterInitials'); return; }
    hs = { mode: entry ? entry.mode : 'arcade', highlight: -1, postGame: true, loop: hs.loop };
    go('highScores');
  }
  function pause() {
    if (state === 'fighting' || state === 'roundEnd') { resumeTo = state; go('paused'); }
  }
  function resume() { if (state === 'paused') go(resumeTo); }
  function mainMenu() { if (mode === 'online') netReset(); mode = null; go('modeSelect'); }
  function startArcade() { newRun('arcade'); run.ladder = buildLadder(sel.player, getCharacter); go('stageIntro'); }
  function startHorde() { newRun('horde'); ctx.scene('horde', { chars: [sel.player, TEMP_ID] }); go('fighting'); }
  function startTraining() { newRun('training'); ctx.scene('dummy', { chars: [sel.player, sel.dummy] }); go('fighting'); }
  // ---- character select --------------------------------------------------------------------------------
  function toSelect(m) { sel.mode = m; sel.step = 'player'; sel.join = false; go('charSelect'); }
  function screenSelect() {
    const dummy = sel.step === 'dummy';
    const sub = { arcade: `ARCADE  ·  ${LADDER.length} STAGES UP THE BUILDING`, online: 'VERSUS ONLINE  ·  YOUR RIVAL PICKS TOO', horde: 'HORDE  ·  FLOOR BY FLOOR', training: 'TRAINING  ·  STEP 1 OF 2' }[sel.mode] || '';
    selCtl = openSelect(ui, { title: dummy ? 'PICK YOUR DUMMY' : 'SELECT FIGHTER', sub: dummy ? 'TRAINING  ·  STEP 2 OF 2  ·  WHO TAKES THE HITS' : sub,
      roster: roster(), initial: dummy ? sel.dummy : sel.player, touch: ctx.touchUI(), pad: ctx.padUI(), onPick: pickChar, onBack: selBack });
  }
  function pickChar(id) {
    if (state !== 'charSelect' || t < 0.15) return;
    if (sel.step === 'dummy') { sel.dummy = id; startTraining(); return; }
    sel.player = id;
    if (sel.mode === 'arcade') startArcade();
    else if (sel.mode === 'horde') startHorde();
    else if (sel.mode === 'training') { sel.step = 'dummy'; t = 0; screenSelect(); }
    else if (sel.mode === 'online') {
      try { const n = getNet(); if (n.setCharacter) n.setCharacter(id); } catch { /* stub */ }
      go(sel.join ? 'onlineJoin' : 'onlineMenu');
    }
  }
  function selBack() {
    if (state !== 'charSelect') return;
    if (sel.step === 'dummy') { sel.step = 'player'; screenSelect(); }
    else go(sel.join ? 'attract' : 'modeSelect');
  }
  function pressStart() { if (state === 'attract') go('modeSelect'); }
  function openScores() { hs = { mode: 'arcade', highlight: -1, postGame: false, loop: hs.loop, manual: true }; go('highScores'); }

  // ---- input ------------------------------------------------------------------------------------------
  // One scheme for every screen (controls.js): directions move the focus, confirm (Enter, Space, A)
  // presses the focused button, back (Esc, Backspace, B, Select) runs the screen's back if it has
  // one, Start is confirm except on the title (it starts) and in the pause menu (it resumes), and
  // del (pad X) is DEL on the two keyboard screens. In a fight, P, Esc, Start or Select pause.
  menu = createMenuInput({
    onActivity() { idle = 0; },
    onKey(k) {
      if (state === 'off' || state === 'onlineFighting') return;   // online: the net module's LEAVE confirm owns Esc / Start / Select
      if (ctx.netBusy && ctx.netBusy()) return;   // its panel is up; it can't block the pad, so we ignore it here
      if (PLAY.has(state)) {
        if (state !== 'result' && (k === 'pause' || k === 'escape' || k === 'start' || k === 'select')) pause();
        return;
      }
      if (k === 'up' || k === 'down' || k === 'left' || k === 'right') { ui.move(k); return; }
      switch (state) {
        case 'attract': if (k === 'start') { pressStart(); return; } break;
        case 'paused': if (k === 'pause' || k === 'start' || k === 'escape' || k === 'back' || k === 'select') { resume(); return; } break;
        case 'enterInitials': if (k === 'del') { cursorTo(slot - 1); return; } break;
        case 'onlineJoin': if (k === 'del') { typeCode('DEL'); return; } break;
      }
      if (k === 'confirm' || k === 'start') ui.activate();
      else if (k === 'back' || k === 'escape' || k === 'select') ui.back();
    },
    onText(e) {
      if (ctx.netBusy && ctx.netBusy()) return false;
      if (state === 'enterInitials') {
        if (/^Key[A-Z]$/.test(e.code)) { setLetter(e.code.slice(3)); cursorTo(slot + 1); return true; }
        if (/^(Digit|Numpad)[0-9]$/.test(e.code)) { setLetter(e.code.slice(-1)); cursorTo(slot + 1); return true; }
        if (e.code === 'Backspace') { cursorTo(slot - 1); return true; }
        if (e.code === 'Enter' || e.code === 'NumpadEnter') { if (!e.repeat) submitInitials(); return true; }
        return false;   // arrows move across the on-screen keyboard
      }
      if (state === 'onlineJoin') {
        const ch = e.key && e.key.length === 1 ? e.key.toUpperCase() : '';
        if (ch && CODE_ALPHABET.includes(ch)) { typeCode(ch); return true; }
        if (e.code === 'Backspace') { typeCode('DEL'); return true; }
        if ((e.code === 'Enter' || e.code === 'NumpadEnter') && joinCode.length === CODE_LEN) { if (!e.repeat) tryJoin(); return true; }
        return false;
      }
      return false;
    },
  });

  // ---- screens --------------------------------------------------------------------------------------------
  // Each returns its items (the primary action first unless focus says otherwise), its back (only
  // where there's somewhere to go back to), and its legend when the default (move, select, back)
  // doesn't say it right. MAIN MENU is always modeSelect.
  const MOVE = ['move'], SELECT = ['confirm', 'SELECT'];
  /** a row of buttons, the same width */
  function btnRow(root, items, width = '20cqw') {
    const row = el('div', 'fl-row');
    for (const it of items) { it.el.style.minWidth = width; row.appendChild(it.el); }
    root.appendChild(row);
    return items;
  }
  const mainMenuBtn = (guard = 0) => button('MAIN MENU', () => { if (t >= guard) mainMenu(); }, 'fl-violet');
  let startBtn = null;
  function screenTitle() {
    ui.show('fl-title', (root) => {
      // START sits on the title card's prompt (frame() moves the group); HIGH SCORES and CONTROLS under it
      const group = el('div', 'fl-titlegroup');
      const b = button('', pressStart, 'fl-start');
      // touch.js marks <html> after this first screen is built, so the label is picked by CSS
      b.el.append(el('span', 'fl-keys', 'PRESS START'), el('span', 'fl-touch', 'START'));
      const row = el('div', 'fl-row fl-titlerow');
      const scores = button('HIGH SCORES', openScores, 'fl-mini');
      const how = button('CONTROLS', () => go('controls'), 'fl-mini fl-violet');
      row.append(scores.el, how.el);
      // INSTALL: the browser's own prompt, or on iPhone/iPad Safari the Add to Home Screen how-to
      const inst = (typeof window !== 'undefined' && window.__install) || null;
      let instBtn = null;
      if (inst && inst.kind) {
        instBtn = button('INSTALL', () => { if (inst.kind === 'prompt') inst.prompt().then(() => { if (state === 'attract') screenTitle(); }); else go('install'); }, 'fl-mini fl-amber');
        row.appendChild(instBtn.el);
      }
      group.append(b.el, row);
      root.appendChild(group);
      startBtn = group;
      group.style.left = '50%'; group.style.top = '39%';
      return { items: instBtn ? [b, scores, how, instBtn] : [b, scores, how], legend: [MOVE, SELECT, ['start', 'START']] };
    }, { veil: false });
  }
  function screenScores(focus = 0) {
    const rows = S.table(hs.mode);
    ui.show('fl-scores', (root) => {
      root.append(el('h1', 'fl-h2', 'HIGH SCORES'), el('div', 'fl-label', hs.mode === 'arcade' ? 'ARCADE' : 'HORDE'), el('div', 'fl-rule'));
      const tb = el('div', 'fl-table');
      rows.forEach((r, i) => {
        const cls = i === hs.highlight ? ' fl-new' : '';
        tb.append(el('span', 'fl-rank' + cls, `${i + 1}`), el('span', cls, r.name), el('span', 'fl-score' + cls, S.fmt(r.score)), el('span', 'fl-note' + cls, r.note));
      });
      root.appendChild(tb);
      // after a game CONTINUE goes back to the title, as the cabinet always did; from the attract loop or
      // the title the table is a detour, so MAIN MENU leads
      const items = hs.postGame
        ? [button('CONTINUE', () => go('attract'), 'fl-amber'), button('MAIN MENU', () => go('modeSelect'), 'fl-violet')]
        : [button('MAIN MENU', () => go('modeSelect'), 'fl-amber'), button('TITLE', () => go('attract'), 'fl-violet')];
      items.push(button(hs.mode === 'arcade' ? 'HORDE TABLE' : 'ARCADE TABLE', () => {
        hs.mode = hs.mode === 'arcade' ? 'horde' : 'arcade'; hs.highlight = -1; hs.manual = true; screenScores(2);
      }));
      btnRow(root, items, '17cqw');
      return { items, focus, back: () => go('attract'), legend: [MOVE, SELECT, ['back', 'TITLE']] };
    });
  }
  // iPhone/iPad Safari has no install prompt and no Fullscreen API: Add to Home Screen is the way
  function screenInstall() {
    ui.show('fl-install', (root) => {
      root.append(el('h1', 'fl-h2', 'PLAY FULL SCREEN'));
      const steps = el('div', 'fl-steps');
      const share = '<svg viewBox="0 0 20 20" width="1em" height="1em" aria-hidden="true" style="vertical-align:-0.12em"><path d="M10 2v11M6 6l4-4 4 4M4 10v7h12v-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      for (const [n, html] of [['1', `TAP SHARE ${share} IN SAFARI'S TOOLBAR`], ['2', 'CHOOSE <b>ADD TO HOME SCREEN</b>'], ['3', 'OPEN STICK FIGHT FROM YOUR HOME SCREEN AND TURN THE PHONE SIDEWAYS']]) {
        const p = el('p', 'fl-step'); p.innerHTML = `<i>${n}</i><span>${html}</span>`; steps.appendChild(p);
      }
      root.appendChild(steps);
      root.appendChild(el('div', 'fl-small', 'IT RUNS FULL SCREEN, WITHOUT SAFARI\'S BARS, AND WORKS OFFLINE'));
      const items = btnRow(root, [button('BACK', () => go('attract'), 'fl-pink'), button('MAIN MENU', () => go('modeSelect'), 'fl-violet')]);
      return { items, back: () => go('attract') };
    });
  }
  function screenControls() {
    ui.show('fl-controls', (root) => {
      root.append(el('h1', 'fl-h2', 'CONTROLS'));
      const row = el('div', 'fl-row fl-ctlrow');
      const right = el('div', 'fl-ctlcol');
      right.append(controlsTable(MENUS, 'MENUS'), el('div', 'fl-small fl-ctlnote', 'ON A TOUCH SCREEN THE LEFT THUMB STEERS, THE BUTTONS STRIKE AND GUARD, AND MENUS ARE TAPPED. F1 SHOWS THE MOVE LIST IN A FIGHT.'));
      row.append(controlsTable(FIGHT, 'FIGHT'), right);
      root.appendChild(row);
      const items = btnRow(root, [button('MAIN MENU', () => go('modeSelect'), 'fl-pink'), button('BACK', () => go('attract'), 'fl-violet')]);
      return { items, back: () => go('attract') };
    });
  }
  function screenModes() {
    ui.show('fl-modes', (root) => {
      root.append(el('h1', 'fl-h2', 'SELECT MODE'));
      const list = el('div', 'fl-list');
      const mk = (label, sub, act, cls = '') => { const b = button(label, act, cls); b.el.appendChild(el('small', '', sub)); list.appendChild(b.el); return b; };
      const items = [
        mk('ARCADE', `${LADDER.length} STAGES UP THE BUILDING`, () => toSelect('arcade'), 'fl-pink'),
        mk('VERSUS ONLINE', 'PLAY A FRIEND', () => toSelect('online')),
        mk('HORDE', 'FLOOR BY FLOOR, AS MANY AS YOU CAN', () => toSelect('horde'), 'fl-amber'),
        mk('TRAINING', 'A DUMMY THAT NEVER HITS BACK', () => toSelect('training'), 'fl-violet'),
      ];
      const back = button('BACK', () => go('attract'), 'fl-violet fl-slim');
      list.appendChild(back.el); items.push(back);
      root.appendChild(list);
      return { items, back: () => go('attract') };
    });
  }
  function pips(root, st) {
    const p = el('div', 'fl-pips');
    ladder().forEach((s, i) => {
      const k = el('i', i < run.stage ? 'fl-done' : i === run.stage ? 'fl-now' : '', s.boss ? 'BOSS' : String(s.n));
      if (s.boss) k.classList.add('fl-boss');
      if (i === run.stage) k.style.setProperty('--c', st.color);
      p.appendChild(k);
    });
    root.appendChild(p);
  }
  function screenStage() {
    const st = ladder()[run.stage];
    run.stageStart = run.score;
    for (const u of sim.units) hp.delete(u);
    ctx.scene('arcade', { stage: st, chars: [sel.player, st.char || TEMP_ID] });
    ui.show('fl-stage', (root) => {
      root.append(el('div', 'fl-label', st.boss ? 'FINAL STAGE' : `STAGE ${st.n} OF ${ladder().length}`));
      const vs = el('div', 'fl-vs');
      const name = el('b', '', st.name); name.style.color = '#fff'; name.style.textShadow = `0 0 0.8cqw ${st.color}, 0 0 2cqw ${st.color}`;
      const me = characterOr(sel.player), you = el('b', 'fl-you', me.name);
      you.style.textShadow = `0 0 0.8cqw ${me.color}, 0 0 2cqw ${me.color}`;
      vs.append(you, el('b', 'fl-x', 'VS'), name);
      root.append(el('h1', 'fl-h1', `STAGE ${st.n}`), vs, el('div', 'fl-label', st.tagline));
      pips(root, st);
      if (run.continues) root.appendChild(el('div', 'fl-small', `CONTINUES ${run.continues}`));
      // no back here: B is a kick, and a player mashing through the card mustn't quit the run
      const items = btnRow(root, [button('FIGHT', () => { if (t > 0.3) go('fighting'); }, 'fl-pink'), mainMenuBtn(0.3)]);
      return { items, legend: [MOVE, SELECT] };
    });
    // a tap on the card itself (not a button) skips it too
    const s = ui.screen; if (s) s.addEventListener('click', (e) => { if (e.target instanceof Element && e.target.closest('.fl-btn')) return; if (state === 'stageIntro' && t > 0.6) go('fighting'); });
  }
  function screenResult() {
    resultWin = sim.wins[0] > sim.wins[1];
    sim.phaseTimer = 1e9;   // the sim would reset the match after its WINS card; the flow decides what's next
    if (mode === 'arcade') sim.banner = resultWin ? 'YOU WIN' : sim.wins[0] === sim.wins[1] ? 'DRAW' : 'YOU LOSE';
    ui.clear();
  }
  function screenClear() {
    const st = ladder()[run.stage];
    ui.show('fl-clear', (root) => {
      root.append(el('h1', 'fl-h1', st.boss ? 'BOSS DOWN' : 'STAGE CLEAR'), el('div', 'fl-label', `${st.name} IS DONE`));
      const tl = el('div', 'fl-tally');
      tl.append(el('span', '', `STAGE ${st.n} BONUS`), el('span', '', S.fmt(clearBonus)), el('span', '', 'SCORE'), el('span', '', S.fmt(run.score)));
      root.appendChild(tl);
      const last = run.stage >= ladder().length - 1;
      root.appendChild(el('div', 'fl-label', last ? 'THE BUILDING IS YOURS' : `NEXT  ${ladder()[run.stage + 1].name}`));
      const items = btnRow(root, [button(last ? 'CONTINUE' : 'NEXT STAGE', () => { if (t > 0.5) nextStage(); }, 'fl-amber'), mainMenuBtn(0.5)]);
      return { items, legend: [MOVE, SELECT] };
    });
  }
  let countEl = null;
  function screenContinue() {
    ui.show('fl-continue', (root) => {
      root.append(el('h1', 'fl-h1', 'CONTINUE?'));
      countEl = el('div', 'fl-count', '10');
      root.appendChild(countEl);
      root.appendChild(el('div', 'fl-label', `RETRY STAGE ${ladder()[run.stage].n}  ·  ${ladder()[run.stage].name}`));
      const yes = button('YES', () => { if (t < 0.4 || state !== 'continue') return; run.score = run.stageStart; run.continues++; go('stageIntro'); }, 'fl-pink');
      const no = button('NO', () => { if (t < 0.4) return; go('gameOver'); });
      // no back: NO is a choice, not a way out, and B is the kick a player who just lost is mashing
      return { items: btnRow(root, [yes, no], '18cqw'), legend: [MOVE, SELECT] };
    });
  }
  function tickContinue() { if (countEl) { const n = String(Math.max(0, Math.ceil(10 - t - 0.0001))); if (countEl.textContent !== n) countEl.textContent = n; } }
  function screenGameOver() {
    if (mode === 'arcade') entry = { mode: 'arcade', score: run.score, note: `STAGE ${ladder()[run.stage].n}` };
    ui.show('fl-gameover', (root) => {
      root.append(el('h1', 'fl-h1', 'GAME OVER'));
      const tl = el('div', 'fl-tally');
      if (mode === 'horde') tl.append(el('span', '', 'FLOORS CLEARED'), el('span', '', String(run.floors)), el('span', '', 'GOONS DOWN'), el('span', '', String(run.goons)));
      else tl.append(el('span', '', 'REACHED'), el('span', '', `STAGE ${ladder()[run.stage].n}`));
      tl.append(el('span', '', 'FINAL SCORE'), el('span', '', S.fmt(run.score)));
      root.appendChild(tl);
      if (entry && S.rankFor(entry.mode, entry.score) >= 0) root.appendChild(el('div', 'fl-label fl-newhi', 'NEW HIGH SCORE  ·  CONTINUE TO SIGN IT'));
      const items = btnRow(root, [button('CONTINUE', () => { if (t > 0.8) afterGame(); }, 'fl-amber'), mainMenuBtn(0.8)]);
      return { items, legend: [MOVE, SELECT] };
    });
  }
  // The on-screen keyboard: a standard layout, the number row on top, then QWERTY. Keys a screen
  // doesn't take (room codes skip 0/O and 1/I/L) stay in place, drawn dim, and the D-pad skips them.
  const KB_ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
  function keyboard(allowed, type, extras = []) {
    const kb = el('div', 'fl-kb'), items = [];
    KB_ROWS.forEach((row, r) => {
      const line = el('div', 'fl-kbrow');
      for (const ch of row) {
        if (allowed(ch)) { const k = button(ch, () => type(ch), 'fl-key'); line.appendChild(k.el); items.push(k); }
        else line.appendChild(el('div', 'fl-btn fl-key fl-off', ch));
      }
      if (r === KB_ROWS.length - 1) for (const x of extras) { const k = button(x.label, x.act, `fl-key fl-wide ${x.cls || ''}`); line.appendChild(k.el); items.push(k); }
      kb.appendChild(line);
    });
    return { el: kb, items };
  }
  // initials: three slots filled from the keyboard (or typed); DEL steps back, ENTER saves
  let initials = ['A', 'A', 'A'], slot = 0, slotEls = [];
  function screenInitials() {
    initials = ['A', 'A', 'A']; slot = 0;
    const rank = entry ? S.rankFor(entry.mode, entry.score) : 0;
    ui.show('fl-initials', (root) => {
      root.append(el('h1', 'fl-h2', 'NEW HIGH SCORE'), el('div', 'fl-label', `${['1ST', '2ND', '3RD', '4TH', '5TH'][rank] || ''} PLACE  ·  ${S.fmt(entry ? entry.score : 0)}`));
      const slots = el('div', 'fl-slots');
      slotEls = [];
      for (let i = 0; i < 3; i++) {
        const sl = el('div', 'fl-slot');
        const b = el('b', '', initials[i]);
        b.addEventListener('click', () => cursorTo(i));
        sl.append(b); slots.appendChild(sl); slotEls.push(sl);
      }
      root.appendChild(slots);
      const kb = keyboard((ch) => /[A-Z0-9]/.test(ch), (ch) => { setLetter(ch); cursorTo(slot + 1); },
        [{ label: 'DEL', act: () => cursorTo(slot - 1), cls: 'fl-violet' }, { label: 'ENTER', act: submitInitials, cls: 'fl-pink' }]);
      root.appendChild(kb.el);
      const items = kb.items;
      root.appendChild(el('div', 'fl-small fl-touchonly', 'TAP YOUR INITIALS, THEN ENTER'));
      // no back: there's nothing behind this screen (left alone, the initials go in as they stand)
      return { items, focus: items.findIndex((k) => k.el.textContent === 'A'), legend: [['type', 'TYPE'], MOVE, SELECT, ['del', 'DEL']] };
    });
    paintSlots();
  }
  function paintSlots() { slotEls.forEach((s, i) => { s.classList.toggle('fl-cur', i === slot); (s.querySelector('b')).textContent = initials[i]; }); }
  function cursorTo(i) { slot = Math.max(0, Math.min(2, i)); paintSlots(); }
  function setLetter(ch) { initials[slot] = ch; paintSlots(); if (ctx.click) ctx.click(); }
  function submitInitials() {
    if (state !== 'enterInitials' || !entry) return;
    const rank = S.addScore(entry.mode, { name: initials.join(''), score: entry.score, note: entry.note });
    hs = { mode: entry.mode, highlight: rank, postGame: true, loop: hs.loop, manual: false };
    entry = null;
    go('highScores');
  }
  function screenEnding() {
    ui.show('fl-ending', (root) => {
      const boss = ladder()[ladder().length - 1];
      root.append(el('h1', 'fl-h1', 'CHAMPION'), el('div', 'fl-label', `${boss.name} IS DOWN. FINAL SCORE ${S.fmt(run.score)}`));
      const roll = el('div', 'fl-roll'), inner = el('div');
      const lines = [
        ['NEON STICK FIGHT', 'A GAME BY SCOTT PIERCE'],
        ['ANIMATION BAR', 'XIAO XIAO, BY ZHU ZHIQIANG'],
        ['MUSIC ENGINE', 'STRUDEL, BY THE STRUDEL CONTRIBUTORS'],
        ['FONTS', 'BUNGEE BY DAVID JONATHAN ROSS · TEKO BY THE INDIAN TYPE FOUNDRY'],
        ['YOUR OPPONENTS', ladder().map(s => s.name).join(' · ')],
        ['CONTINUES USED', String(run.continues)],
        ['SOURCE', 'GITHUB.COM/DDRSCOTT/STICK-FIGHT · AGPL-3.0'],
        ['THANK YOU FOR PLAYING', 'NOW GO HOME. IT IS 3 AM'],
      ];
      for (const [h, p] of lines) { const q = el('p'); q.append(el('b', '', h), document.createTextNode(p)); inner.appendChild(q); }
      roll.appendChild(inner); root.appendChild(roll);
      const items = btnRow(root, [button('CONTINUE', () => { if (t > 1.2) afterGame(); }, 'fl-amber'), mainMenuBtn(1.2)]);
      return { items, legend: [MOVE, SELECT] };
    });
  }
  function screenPause() {
    ui.show('fl-pause', (root) => {
      root.append(el('h1', 'fl-h2', 'PAUSED'));
      if (mode === 'arcade') root.appendChild(el('div', 'fl-label', `STAGE ${ladder()[run.stage].n}  ·  ${ladder()[run.stage].name}  ·  ${S.fmt(run.score)}`));
      const list = el('div', 'fl-list');
      const items = [button('RESUME', resume, 'fl-pink')];
      if (mode === 'arcade') items.push(button('RESTART STAGE', () => { run.score = run.stageStart; go('stageIntro'); }));
      if (mode === 'horde') items.push(button('RESTART RUN', () => { newRun('horde'); ctx.scene('horde', { chars: [sel.player, TEMP_ID] }); go('fighting'); }));
      if (mode === 'training') items.push(button('RESET', () => { ctx.scene('dummy', { chars: [sel.player, sel.dummy] }); go('fighting'); }));
      // botches on or off (src/combat/botch.js): remembered, and it takes effect from the next fight (online
      // the host's setting rides the start message; online never pauses anyway)
      const label = () => `BOTCHES: ${botchEnabled() ? 'ON' : 'OFF'}`;
      const sw = button(label(), () => { setBotchEnabled(!botchEnabled()); sw.el.firstChild.textContent = label(); }, 'fl-amber');
      sw.el.appendChild(el('small', '', 'FROM THE NEXT FIGHT'));
      items.push(sw);
      // the right panel: the book of happy accidents, or the controls (keyboard and gamepad)
      const panel = el('div', 'fl-tech');
      const view = button('', () => { pauseView = pauseView === 'tech' ? 'controls' : 'tech'; paint(); });
      const paint = () => {
        view.el.textContent = pauseView === 'tech' ? 'SHOW CONTROLS' : 'SHOW TECHNIQUES';
        panel.textContent = '';
        panel.classList.toggle('fl-ctlpanel', pauseView === 'controls');
        if (pauseView === 'controls') { panel.appendChild(controlsTable(FIGHT, 'FIGHT')); return; }
        // the happy accidents: found ones by name, the rest as ???, each with a hint (never the timing)
        const tech = techniques();
        panel.appendChild(el('div', 'fl-techhead', `TECHNIQUES FOUND ${tech.filter(x => x.found).length}/${tech.length}`));
        for (const x of tech) { const p = el('p', x.found ? 'fl-got' : ''); p.append(el('b', '', x.found ? `${x.name}  ${x.input}` : '???'), el('small', '', x.hint)); panel.appendChild(p); }
      };
      items.push(view, button('MAIN MENU', mainMenu, 'fl-violet'));
      items.forEach(i => list.appendChild(i.el));
      paint();
      const row = el('div', 'fl-row fl-pauserow'); row.append(list, panel);
      root.appendChild(row);
      return { items, back: resume, legend: [MOVE, SELECT, ['back', 'RESUME'], ['start', 'RESUME']] };
    });
  }

  // ---- online (the screens; the networking is behind netApi.js) --------------------------------------------------
  function netReset() {
    netSession++;
    for (const f of netOff) { try { f(); } catch { /* ignore */ } }
    netOff = [];
    try { getNet().leave(); } catch { /* stub */ }
  }
  /** a failure before or between matches: the message, and RETRY goes back to the screen that failed */
  function netFail(msg) {
    endMsg = msg;
    retryTo = state === 'onlineHost' || state === 'onlineConnecting' ? state : null;
    if (TRANSITIONS[state].includes('onlineEnd')) go('onlineEnd');
  }
  function listen(session) {
    const net = getNet();
    const guard = (fn) => (e) => { if (session === netSession) fn(e); };
    netOff.push(
      net.on('connected', guard(() => { if (state === 'onlineHost' || state === 'onlineConnecting') go('onlineFighting'); })),
      net.on('peer-left', guard(() => netFail('YOUR RIVAL LEFT'))),
      net.on('error', guard((e) => netFail(String((e && e.message) || 'CONNECTION LOST').toUpperCase()))),
      net.on('status', guard((e) => { if (statusEl && e && e.text) statusEl.textContent = e.text; })),
    );
  }
  let statusEl = null;
  /** the net module ended the match (main.js endMatch hook): 'peer-left', 'lost' or 'left' */
  function netEnded(reason) {
    if (state !== 'onlineFighting') return;
    endMsg = reason === 'left' ? 'YOU LEFT THE MATCH' : reason === 'lost' ? 'CONNECTION LOST' : 'YOUR RIVAL LEFT';
    retryTo = null;   // the room is gone with the match
    go('onlineEnd');
  }
  function screenOnline() {
    ui.show('fl-online', (root) => {
      root.append(el('h1', 'fl-h2', 'VERSUS ONLINE'), el('div', 'fl-label', 'ONE OF YOU HOSTS, THE OTHER JOINS WITH THE CODE'));
      const list = el('div', 'fl-list');
      const items = [
        button('HOST A GAME', () => { if (!getNet().available) { endMsg = 'ONLINE PLAY IS NOT READY YET'; retryTo = null; go('onlineEnd'); } else go('onlineHost'); }, 'fl-pink'),
        button('JOIN A GAME', () => { joinCode = ''; go('onlineJoin'); }),
        button('BACK', () => go('charSelect'), 'fl-violet'),
        button('MAIN MENU', () => go('modeSelect'), 'fl-violet fl-slim'),
      ];
      items.forEach(i => list.appendChild(i.el));
      root.appendChild(list);
      return { items, back: () => go('charSelect') };
    });
  }
  function screenHost() {
    const session = ++netSession;
    let codeEl, linkEl, waitEl;
    ui.show('fl-host', (root) => {
      root.append(el('h1', 'fl-h2', 'HOST A GAME'), el('div', 'fl-label', 'YOUR ROOM CODE'));
      codeEl = el('div', 'fl-h1', '····');
      linkEl = el('div', 'fl-link', '');
      waitEl = el('div', 'fl-label fl-dots', 'OPENING A ROOM');
      statusEl = waitEl;
      root.append(codeEl, linkEl, waitEl);
      const items = [];
      // send the link: the phone's share sheet where there is one, and the clipboard everywhere (both
      // wait for the room: dim, and skipped by the focus, until there's a link)
      const noLink = () => !linkEl.textContent;
      const copy = button('COPY LINK', () => {
        const link = linkEl.textContent || '';
        if (!link) return;
        Promise.resolve().then(() => navigator.clipboard.writeText(link))
          .then(() => { copy.el.textContent = 'COPIED'; }, () => { copy.el.textContent = 'COPY FAILED'; })
          .then(() => setTimeout(() => { copy.el.textContent = 'COPY LINK'; }, 1400));
      }, 'fl-pink');
      copy.disabled = noLink;
      items.push(copy);
      if (typeof navigator.share === 'function') {
        const share = button('SHARE', () => {
          const url = linkEl.textContent || '';
          if (url) navigator.share({ title: 'Neon Stick Fight', text: `Fight me online, room ${codeEl.textContent}`, url }).catch(() => {});
        });
        share.disabled = noLink;
        items.push(share);
      }
      items.push(button('CANCEL', () => go('onlineMenu'), 'fl-violet'), mainMenuBtn());
      btnRow(root, items, '17cqw');
      return { items, back: () => go('onlineMenu') };
    });
    const fallback = ui.focus;   // COPY LINK is dim until the room opens, so the focus starts on CANCEL
    listen(session);
    getNet().host().then(({ code, link }) => {
      if (session !== netSession) return;
      codeEl.textContent = code;
      linkEl.textContent = link || roomLink(code);
      if (/OPENING/.test(waitEl.textContent || '')) waitEl.textContent = 'WAITING FOR A FRIEND';
      ui.refresh();
      if (ui.focus === fallback) ui.setFocus(0);   // the player hasn't moved: COPY LINK, now it works
    }).catch((e) => { if (session !== netSession) return; netFail(String((e && e.message) || e).toUpperCase()); });
  }
  let codeSlots = [], joinBtn = null;
  function screenJoin() {
    ui.show('fl-join', (root) => {
      root.append(el('h1', 'fl-h3', 'JOIN A GAME'));
      const slots = el('div', 'fl-slots fl-code');
      codeSlots = [];
      for (let i = 0; i < CODE_LEN; i++) { const s = el('div', 'fl-slot'); s.appendChild(el('b', '', '')); slots.appendChild(s); codeSlots.push(s); }
      root.appendChild(slots);
      const items = [];
      const kb = keyboard((ch) => CODE_ALPHABET.includes(ch), typeCode, [{ label: 'DEL', act: () => typeCode('DEL'), cls: 'fl-violet' }]);
      root.appendChild(kb.el); items.push(...kb.items);
      const join = button('JOIN', tryJoin, 'fl-pink'), back = button('BACK', () => go('onlineMenu'), 'fl-violet');
      join.disabled = () => joinCode.length !== CODE_LEN;   // dim, and the focus skips it, until the code is whole
      btnRow(root, [join, back]);
      items.push(join, back);
      joinBtn = join.el;
      return { items, focus: joinCode.length === CODE_LEN ? items.length - 2 : 0, back: () => go('onlineMenu'), legend: [['type', 'TYPE'], MOVE, SELECT, ['del', 'DEL'], ['back', 'BACK']] };
    });
    paintCode();
  }
  function paintCode() {
    codeSlots.forEach((s, i) => { (s.querySelector('b')).textContent = joinCode[i] || ''; s.classList.toggle('fl-cur', i === Math.min(joinCode.length, CODE_LEN - 1)); });
    if (state === 'onlineJoin') ui.refresh();
  }
  function typeCode(ch) {
    if (state !== 'onlineJoin') return;
    if (ch === 'DEL') joinCode = joinCode.slice(0, -1);
    else if (joinCode.length < CODE_LEN) joinCode += ch;
    if (ctx.click) ctx.click();
    paintCode();
    if (ch !== 'DEL' && joinCode.length === CODE_LEN) { const i = ui.items.findIndex(it => it.el === joinBtn); if (i >= 0) ui.setFocus(i); }
  }
  function tryJoin() { if (state === 'onlineJoin' && joinCode.length === CODE_LEN) go('onlineConnecting'); }
  function screenConnecting() {
    const session = ++netSession;
    let msg;
    ui.show('fl-connecting', (root) => {
      root.append(el('h1', 'fl-h2', 'JOINING'), el('div', 'fl-h1', joinCode));
      msg = el('div', 'fl-label fl-dots', 'CONNECTING');
      statusEl = msg;
      root.appendChild(msg);
      const items = btnRow(root, [button('CANCEL', () => go('onlineJoin'), 'fl-violet'), mainMenuBtn()]);
      return { items, back: () => go('onlineJoin') };
    });
    listen(session);
    getNet().join(joinCode).then(() => { if (session === netSession && /^CONNECTING/.test(msg.textContent || '')) msg.textContent = 'FINDING THE ROOM'; })
      .catch((e) => { if (session !== netSession) return; netFail(String((e && e.message) || e).toUpperCase()); });
  }
  function screenOnlineEnd() {
    ui.show('fl-onlineend', (root) => {
      root.append(el('h1', 'fl-h2', 'VERSUS ONLINE'), el('div', 'fl-h3', endMsg || 'DISCONNECTED'));
      const items = [];
      // RETRY only where the same thing can work a second time: a room that didn't open, a join that didn't connect
      if (retryTo) items.push(button(retryTo === 'onlineHost' ? 'HOST AGAIN' : 'TRY AGAIN', () => { const to = retryTo; retryTo = null; if (to) go(to); }, 'fl-pink'));
      items.push(button('ONLINE MENU', () => go('onlineMenu'), retryTo ? '' : 'fl-pink'), mainMenuBtn());
      btnRow(root, items, '18cqw');
      return { items, back: () => go('onlineMenu') };
    });
  }

  // ---- what main.js asks for ------------------------------------------------------------------------------
  /** HUD options for this frame (null when off) */
  function hud() {
    if (state === 'off') return null;
    const scored = mode === 'arcade' || mode === 'horde';
    const st = ladder()[run.stage];
    const pad = ctx.padUI(), touch = ctx.touchUI();
    return {
      bare: !HUD_ON.has(state),
      card: state === 'attract',
      score: scored ? run.score : null,
      bonus: bonus.t > 0 ? bonus.text : '',
      names: mode === 'arcade' ? ['PLAYER 1', st.boss ? 'BOSS' : `STAGE ${st.n}`] : null,
      charNames: mode === 'arcade' ? [null, st.name] : null,   // the stage's name (a TEMP stands in for a character that isn't built yet)
      // in a fight the only hint is the way to the menu (and the move list on a keyboard); a pad's is
      // in the pause menu's SHOW CONTROLS
      hint: touch ? '' : state === 'onlineFighting' ? (pad ? `${startName()}  LEAVE` : 'F1  MOVES     ESC  LEAVE') : pad ? `${startName()}  PAUSE` : 'F1  MOVES     ESC  PAUSE',
    };
  }
  /** after the HUD drew: the START button follows the title card's prompt slot, and fades the same way */
  function frame(layout) {
    if (state !== 'attract' || !startBtn || !layout || !layout.prompt) return;
    const p = layout.prompt;
    startBtn.style.left = `${(p.x / 1280) * 100}%`;
    startBtn.style.top = `${(p.y / 720) * 100}%`;
    startBtn.style.opacity = String(Math.max(0.16, p.alpha));
  }
  /** hotkeys main.js may still act on while the flow runs */
  function allowHotkey(code) {
    if (state === 'off') return true;
    if (code === 'KeyH') return PLAY.has(state) || state === 'paused';
    if (code === 'F1' || code === 'Slash') return PLAY.has(state) || state === 'paused';
    if (code === 'Minus' || code === 'Equal') return mode === 'training';
    return false;   // R, G and P belong to the pause menu now
  }
  function start(opts = {}) {
    const code = cleanCode(opts.room);
    if (code) { demo(); joinCode = code; sel.mode = 'online'; sel.step = 'player'; sel.join = true; go('charSelect'); }   // pick a fighter, then JOIN with the code filled in
    else go('attract');
  }

  // ---- test hooks -------------------------------------------------------------------------------------------
  /** a real KO for `winner` this step (the sim's own KO, round and match path runs from here) */
  function debugKO(winner) {
    if (sim.phase !== 'fight') return false;
    const loser = sim.units[1 - winner];
    loser.health = 0; loser.state = 'ko'; loser.koDone = true;
    sim.phase = 'ko'; sim.phaseTimer = 0.35; sim.winner = winner; sim.banner = 'KO';
    return true;
  }

  return {
    start, update, afterStep, event, hud, frame, allowHotkey, netEnded,
    off: () => go('off'),
    get state() { return state; },
    get on() { return state !== 'off'; },
    /** the sim's demo audio gate: the demo runs behind these states */
    get demo() { return DEMO.has(state) || state === 'highScores'; },
    debug: { history, run, sel, go, debugKO, ui, setNet, getNet, LADDER, pickChar, get mode() { return mode; }, get t() { return t; }, scores: S },
  };
}

