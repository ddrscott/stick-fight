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
//   onlinePost      after an online match, the room still open: REMATCH, NEW CHARACTERS, LEAVE ROOM,
//                   MAIN MENU, the tally, the rival's choice live and the countdowns (online.js runs
//                   the agreement: the guest asks, the host decides)
//   onlineSelect    NEW CHARACTERS: both pick at once, each seeing the other's card; the host starts
//
// The 30 second idle return only runs where nothing is lost: the menus (mode select, the online
// menu and join screen, a finished online match) and training. Never mid-match: an arcade or
// horde run left alone plays itself out (the CPU or the goons win), then CONTINUE runs down, the
// score is offered to the table (entered as it stands after 30 more seconds), and the cabinet is
// back on the demo with the score kept. A paused game stays paused.
//
// Every screen that waits on the player has at least two buttons and a footer legend; the control
// scheme (one for every screen) is in controls.js. "MAIN MENU" always means modeSelect.

import { track } from '../analytics.js';   // cookieless game analytics (README, Analytics)
import { LADDER, buildLadder, secretStage } from './ladder.js';
import { openSelect } from './select.js';
import { roster, getCharacter, characterOr, TEMP_ID } from '../characters/index.js';
import * as S from './scores.js';
import { createMenuInput } from './menuInput.js';
import { createUI, el, button } from './ui.js';
import { techniques, botchEnabled, setBotchEnabled } from './techniques.js';
import { getNet, setNet, cleanCode, roomLink, CODE_ALPHABET, CODE_LEN } from './netApi.js';
import { controlsTable, FIGHT, MENUS, startName } from './controls.js';
import { profile, setName as saveName, cleanName, rememberCrew, syncProfile, startSignIn, verifySignIn, signOut } from '../net/profile.js';
import { createCrew, createCrewRoom, cleanSlug, crewLink } from '../net/crew.js';

// every legal move ('off' is always allowed: the gauntlet hooks can take over at any time)
const TRANSITIONS = {
  off: ['attract', 'onlineJoin', 'charSelect', 'nameEntry', 'crewLobby', 'signInCode'],
  attract: ['modeSelect', 'highScores', 'controls', 'install'],
  highScores: ['attract', 'modeSelect'],
  controls: ['attract', 'modeSelect'],
  install: ['attract', 'modeSelect'],
  modeSelect: ['attract', 'stageIntro', 'fighting', 'onlineMenu', 'charSelect', 'nameEntry'],
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
  onlineMenu: ['modeSelect', 'charSelect', 'onlineHost', 'onlineJoin', 'onlineEnd', 'attract', 'profile', 'crewCreate', 'crewJoin', 'crewLobby', 'nameEntry'],
  onlineHost: ['onlineMenu', 'onlineFighting', 'onlineEnd', 'modeSelect'],
  onlineJoin: ['onlineMenu', 'onlineConnecting', 'attract'],
  onlineConnecting: ['onlineJoin', 'onlineFighting', 'onlineEnd', 'modeSelect'],
  onlineFighting: ['onlineEnd', 'onlinePost'],
  onlinePost: ['onlineFighting', 'onlineSelect', 'onlineEnd', 'onlineMenu', 'modeSelect', 'crewLobby'],
  onlineSelect: ['onlineFighting', 'onlineEnd', 'onlineMenu', 'modeSelect', 'crewLobby'],
  onlineEnd: ['onlineMenu', 'onlineHost', 'onlineConnecting', 'modeSelect', 'attract', 'crewLobby'],
  // profiles and crew rooms (src/net/profile.js, src/net/crew.js)
  nameEntry: ['charSelect', 'crewLobby', 'onlineMenu', 'profile', 'modeSelect', 'attract', 'signInEmail'],
  profile: ['nameEntry', 'signInEmail', 'onlineMenu', 'modeSelect', 'attract'],
  signInEmail: ['signInCode', 'profile', 'modeSelect', 'nameEntry'],
  signInCode: ['profile', 'signInEmail', 'modeSelect', 'nameEntry', 'charSelect', 'crewLobby'],
  crewCreate: ['crewLobby', 'onlineMenu', 'modeSelect'],
  crewJoin: ['crewLobby', 'onlineMenu', 'modeSelect'],
  crewLobby: ['crewLinking', 'onlineMenu', 'modeSelect'],
  crewLinking: ['onlineSelect', 'onlineFighting', 'crewLobby', 'onlineEnd', 'modeSelect'],
};
// the screens that take typing (src/flow/index.js textScreen): letters type, Backspace deletes, Enter submits
const TEXT = new Set(['nameEntry', 'signInEmail', 'signInCode', 'crewCreate', 'crewJoin']);
// the crew's lobby connection stays open in these (the lobby, and a match the crew started)
const CREW_KEEP = new Set(['crewLobby', 'crewLinking', 'onlineFighting', 'onlinePost', 'onlineSelect', 'onlineEnd']);
// the demo runs (silent) behind these; highScores holds a fresh bout still behind the table
const DEMO = new Set(['attract', 'controls', 'install', 'modeSelect', 'charSelect', 'onlineMenu', 'onlineHost', 'onlineJoin', 'onlineConnecting', 'onlineEnd', ...TEXT, 'profile', 'crewLobby', 'crewLinking']);
// the sim steps in these (plus onlineFighting, unless the net module steps it)
const STEPS = new Set([...DEMO, 'fighting', 'roundEnd', 'result']);
// the HUD draws in these; everything else is a menu over a dimmed scene, HUD off
const HUD_ON = new Set(['attract', 'fighting', 'roundEnd', 'result', 'paused', 'onlineFighting']);
// the player is fighting: touch controls up, menu keys off except pause
const PLAY = new Set(['fighting', 'roundEnd', 'result', 'onlineFighting']);
const IDLE_MS = 30000;
const ONLINE = new Set(['onlineMenu', 'onlineHost', 'onlineJoin', 'onlineConnecting', 'onlineFighting', 'onlineEnd', 'onlinePost', 'onlineSelect', 'crewLobby', 'crewLinking']);
// between online matches: the room is open, the scene behind is the last match's final frame (held)
const BETWEEN = new Set(['onlinePost', 'onlineSelect']);

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
const MENU_MUSIC = new Set(['attract', 'highScores', 'controls', 'install', 'modeSelect', 'charSelect', 'gameOver', 'enterInitials', 'ending', 'onlineMenu', 'onlineHost', 'onlineJoin', 'onlineConnecting', 'onlineEnd', 'onlinePost', 'onlineSelect', ...TEXT, 'profile', 'crewLobby', 'crewLinking']);

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
  // ?pick=<id> (PLAY AS on a fighter's page, README "Site"): the select screen opens on that fighter
  try { const want = new URLSearchParams(location.search).get('pick'); if (want && roster().some((c) => c.id === want)) sel.player = want; } catch { /* no location */ }
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
    if (prev === 'onlineFighting' && next !== 'onlinePost') netReset();   // an abandoned match hangs up (leave() is a no-op if it already did); a finished one keeps the room
    if (BETWEEN.has(prev) && next === 'onlineMenu') netReset();   // LEAVE ROOM
    if (next === 'crewLobby') netReset();   // back in the crew lobby: the match room (if any) hangs up
    if (crewCli && (crewCli.active || prev === 'crewLobby') && !CREW_KEEP.has(next)) crewClose();   // out of the crew: its lobby connection closes
    if (TEXT.has(prev)) te = null;
    if (prev === 'crewLinking') clearTimeout(linkTimer);
    if (prev === 'charSelect' || prev === 'onlineSelect') selCtl = null;
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
      case 'onlinePost':
        if (rotating) {   // winner stays on landed during the last frames: hold the rematch countdown now
          rotating.until = Math.max(rotating.until, performance.now() + 3000);
          try { const n = getNet(), v = view(); if (v && v.role === 'host') n.postBack?.(); else n.postPoke?.(); } catch { /* stub */ }
        }
        return screenPost();
      case 'onlineSelect': return screenOnlineSelect();
      case 'nameEntry': ensureDemo(); return screenName();
      case 'profile': ensureDemo(); return screenProfile();
      case 'signInEmail': ensureDemo(); return screenSignInEmail();
      case 'signInCode': ensureDemo(); return screenSignInCode();
      case 'crewCreate': ensureDemo(); return screenCrewCreate();
      case 'crewJoin': ensureDemo(); return screenCrewJoin();
      case 'crewLobby': mode = null; ensureDemo(); crewEnter(); return screenCrewLobby();
      case 'crewLinking': ensureDemo(); return screenCrewLinking();
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
      // (never the crew lobby, the typing screens or sign-in: friends wait there, and a code takes a trip to the inbox)
      if (idle > IDLE_MS && (state === 'controls' || state === 'install' || state === 'modeSelect' || state === 'charSelect' || state === 'onlineMenu' || state === 'onlineJoin' || (state === 'onlineEnd' && !crewMatch) || state === 'profile')) go('attract');
    }
    if ((state === 'charSelect' || state === 'onlineSelect') && selCtl) selCtl.tick(dt);
    if (BETWEEN.has(state)) paintBetween();   // the countdowns tick
    if (rotating && BETWEEN.has(state) && performance.now() >= rotating.until) go('crewLobby');   // winner stays on: off to the lobby
    if (state === 'crewLobby' && lob && lob.noteUntil && performance.now() > lob.noteUntil) { lob.noteUntil = 0; crewNote = ''; paintLobby(); }
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
      track('horde_end', [sel.player], run.floors);
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
    // the boss down without a continue: THE CEO is waiting upstairs (a secret seventh stage, src/flow/ladder.js)
    const secret = run.stage >= ladder().length - 1 && mode === 'arcade' && secretStage(ladder(), run.continues, sel.player, getCharacter);
    if (secret) run.ladder = [...ladder(), secret];
    if (run.stage >= ladder().length - 1) { entry = { mode: 'arcade', score: run.score, note: 'ALL CLEAR' }; track('arcade_end', [sel.player, 'clear'], ladder().length); go('ending'); return; }
    track('stage', [sel.player], run.stage + 2);   // reached the next stage
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
  function startArcade() { newRun('arcade'); run.ladder = buildLadder(sel.player, getCharacter); track('mode', ['arcade', sel.player]); go('stageIntro'); }
  function startHorde() { newRun('horde'); track('mode', ['horde', sel.player]); ctx.scene('horde', { chars: [sel.player, TEMP_ID] }); go('fighting'); }
  function startTraining() { newRun('training'); track('mode', ['training', sel.player]); ctx.scene('dummy', { chars: [sel.player, sel.dummy] }); go('fighting'); }
  // ---- character select --------------------------------------------------------------------------------
  function toSelect(m) {
    // the first time online, a name first (other players see it); it's remembered after that
    if (m === 'online' && !profile().name) { askName(() => toSelect('online'), () => go('modeSelect')); return; }
    sel.mode = m; sel.step = 'player'; sel.join = false; go('charSelect');
  }
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
      if (BETWEEN.has(state)) navAt = t;
      // post-match: any press but a confirm stops the auto rematch (a confirm presses a button, which says what it wants)
      if (state === 'onlinePost' && k !== 'confirm' && k !== 'start') { try { getNet().postPoke?.(); } catch { /* stub */ } }
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
        default: if (TEXT.has(state) && k === 'del') { teType('DEL'); return; } break;
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
      if (TEXT.has(state) && te) {
        if (e.code === 'Backspace') { teType('DEL'); return true; }
        if (e.code === 'Enter' || e.code === 'NumpadEnter') { if (!e.repeat) teSubmit(); return true; }
        const ch = e.key && e.key.length === 1 ? (te.lower ? e.key.toLowerCase() : e.key.toUpperCase()) : '';
        if (!ch) return false;   // arrows move across the on-screen keyboard
        if (te.accept(ch, te.value)) { teType(ch); return true; }
        return ch !== ' ';   // other characters are swallowed (no music keys); a Space nobody types presses the focused key
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
  let titleUpdWatch = null;
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
      // UPDATE: a newer deploy is out (src/update.js); reloads into it
      const upd = (typeof window !== 'undefined' && window.__update) || null;
      let updBtn = null;
      if (upd && upd.available) { updBtn = button('UPDATE', () => upd.apply(), 'fl-mini fl-pink'); row.appendChild(updBtn.el); }
      if (upd && !titleUpdWatch) titleUpdWatch = upd.onChange(() => { if (state === 'attract') screenTitle(); });
      group.append(b.el, row);
      root.appendChild(group);
      startBtn = group;
      group.style.left = '50%'; group.style.top = '39%';
      return { items: [b, scores, how, instBtn, updBtn].filter(Boolean), legend: [MOVE, SELECT, ['start', 'START']] };
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
      right.append(controlsTable(MENUS, 'MENUS'), el('div', 'fl-small fl-ctlnote', 'ON A TOUCH SCREEN THE LEFT THUMB STEERS, THE BUTTONS STRIKE AND GUARD, AND MENUS ARE TAPPED. F1 SHOWS THE MOVE LIST IN A FIGHT.'),
        el('div', 'fl-small fl-ctlnote', 'PARRY: TAP TOWARD HIM JUST BEFORE A HIT LANDS (DOWN-FORWARD FOR A LOW). KNOCKED DOWN: UP STANDS, LEFT OR RIGHT ROLLS, A BUTTON STRIKES FROM THE FLOOR. OVER HIM ON THE FLOOR: DOWN + KICK STOMPS. JUGGLED: A BUTTON AT THE RIGHT MOMENT LANDS YOU ON YOUR FEET.'));
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
    if (mode === 'arcade') { entry = { mode: 'arcade', score: run.score, note: `STAGE ${ladder()[run.stage].n}` }; track('arcade_end', [sel.player, 'over'], ladder()[run.stage].n); }
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
      if (r === KB_ROWS.length - 1) for (const x of extras) { const k = button(x.label, x.act, `fl-key ${x.narrow ? '' : 'fl-wide'} ${x.cls || ''}`); line.appendChild(k.el); items.push(k); }
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
    endMsg = crewMatch && msg === 'YOUR RIVAL LEFT' ? `${crewMatch.rival.name} WENT BACK TO THE CREW` : msg;
    // a host whose rival left between matches can open a fresh room with one press
    retryTo = state === 'onlineHost' || state === 'onlineConnecting' ? state : BETWEEN.has(state) && betweenRole === 'host' ? 'onlineHost' : null;
    if (crewMatch) {
      retryTo = null;   // a crew match: the way back is the crew lobby
      if (rotating) { go('crewLobby'); return; }   // winner stays on: the other side left first, as planned
    }
    if (TRANSITIONS[state].includes('onlineEnd')) go('onlineEnd');
  }
  function listen(session) {
    const net = getNet();
    try { net.setName?.(profile().name); } catch { /* stub */ }   // the name rides the ready message
    const guard = (fn) => (e) => { if (session === netSession) fn(e); };
    netOff.push(
      net.on('connected', guard(() => { if (state === 'onlineHost' || state === 'onlineConnecting' || state === 'crewLinking' || BETWEEN.has(state)) go('onlineFighting'); })),
      net.on('match-over', guard((v) => {
        // a crew match: the host's page reports the result to the crew room (it counts once, by match id and number)
        if (crewMatch && v && v.role === 'host' && v.last) crewC().result({ match: crewMatch.id, n: v.n, winner: v.last.winner, wins: v.last.wins, chars: v.last.chars });
        if (state === 'onlineFighting') go('onlinePost');
      })),
      net.on('session', guard((v) => {
        if ((state === 'onlinePost' || state === 'crewLinking') && v && v.phase === 'select') go('onlineSelect');
        else if (BETWEEN.has(state)) paintBetween(v);
      })),
      net.on('peer-left', guard(() => netFail('YOUR RIVAL LEFT'))),
      net.on('error', guard((e) => netFail(String((e && e.message) || 'CONNECTION LOST').toUpperCase()))),
      net.on('status', guard((e) => { if (statusEl && e && e.text) statusEl.textContent = e.text; })),
    );
  }
  let statusEl = null;
  /** the net module ended the match (main.js endMatch hook): 'peer-left', 'lost' or 'left' */
  function netEnded(reason) {
    if (BETWEEN.has(state)) {
      if (reason === 'left') return;   // LEAVE ROOM or MAIN MENU: the flow is already on its way
      if (crewMatch && rotating) { go('crewLobby'); return; }   // winner stays on: the other side went first
      endMsg = reason === 'lost' ? 'CONNECTION LOST' : crewMatch ? `${crewMatch.rival.name} WENT BACK TO THE CREW` : 'YOUR RIVAL LEFT';
      retryTo = betweenRole === 'host' && !crewMatch ? 'onlineHost' : null;
      go('onlineEnd');
      return;
    }
    if (state !== 'onlineFighting') return;
    endMsg = reason === 'left' ? 'YOU LEFT THE MATCH' : reason === 'lost' ? 'CONNECTION LOST' : 'YOUR RIVAL LEFT';
    retryTo = null;   // the room is gone with the match
    go('onlineEnd');
  }
  // the online menu: crew rooms on the left (the recent ones, CREATE, JOIN), quick matches on the right
  // (HOST and JOIN with a four-letter code), and the profile under them
  function screenOnline() {
    const p = profile();
    const backToPick = () => { sel.mode = 'online'; sel.step = 'player'; sel.join = false; go('charSelect'); };
    ui.show('fl-online', (root) => {
      const who = el('div', 'fl-label', `PLAYING AS ${p.name || '???'}${p.email ? '  ·  PROFILE SAVED' : ''}`);
      root.append(el('h1', 'fl-h2', 'VERSUS ONLINE'), who);
      if (profileMsg) { root.appendChild(el('div', 'fl-label fl-newhi', profileMsg)); profileMsg = ''; }   // just signed in on the way here
      const cols = el('div', 'fl-row fl-onlinecols');
      const left = el('div', 'fl-list fl-ocol'), right = el('div', 'fl-list fl-ocol');
      left.appendChild(el('div', 'fl-colhead', 'CREW ROOMS'));
      right.appendChild(el('div', 'fl-colhead', 'QUICK MATCH'));
      const mk = (col, label, sub, act, cls = '') => { const b = button(label, act, `fl-slim ${cls}`); b.el.appendChild(el('small', '', sub)); col.appendChild(b.el); return b; };
      const crews = p.crews.slice(0, 3).map((c) => mk(left, c.name, 'BACK TO YOUR CREW', () => openCrew(c.slug), 'fl-amber'));
      const create = mk(left, 'CREATE CREW ROOM', 'A LINK YOUR FRIENDS KEEP', () => go('crewCreate'), crews.length ? '' : 'fl-amber');
      const joinCrew = mk(left, 'JOIN A CREW', 'BY LINK OR CODE', () => go('crewJoin'));
      const host = mk(right, 'HOST A GAME', 'A ONE-OFF ROOM CODE', () => { if (!getNet().available) { endMsg = 'ONLINE PLAY IS NOT READY YET'; retryTo = null; go('onlineEnd'); } else go('onlineHost'); }, 'fl-pink');
      const join = mk(right, 'JOIN A GAME', 'WITH A 4-LETTER CODE', () => { joinCode = ''; go('onlineJoin'); });
      cols.append(left, right);
      root.appendChild(cols);
      const prof = button('PROFILE', () => go('profile'), 'fl-mini');
      const back = button('BACK', backToPick, 'fl-violet fl-mini');
      const main = button('MAIN MENU', () => go('modeSelect'), 'fl-violet fl-mini');
      const row = el('div', 'fl-row fl-orow'); row.append(prof.el, back.el, main.el); root.appendChild(row);
      const items = [...crews, create, joinCrew, host, join, prof, back, main];
      // a crew to go back to is the likeliest press; otherwise HOST A GAME, as before
      return { items, focus: crews.length ? 0 : items.indexOf(host), back: backToPick };
    });
    // who's signed in on this browser (a session from another visit, or one that ended): repaint if it changed
    const shown = ui.screen;
    syncProfile().then(() => {
      const q = profile();
      if (state === 'onlineMenu' && ui.screen === shown && (q.name !== p.name || q.email !== p.email || q.crews.length !== p.crews.length)) screenOnline();
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
  // ---- between online matches ------------------------------------------------------------------------------
  // The post-match screen and the pick screen read online.js's view() (the same picture on both
  // machines, from each one's side) and paint it; the agreement rules live in online.js.
  let navAt = -1e9, guardUntil = 0, post = null, lastWant = null, betweenRole = '';
  const CHOICE = { rematch: 'REMATCH', chars: 'NEW CHARACTERS' };
  const view = () => { try { const n = getNet(); return n.view ? n.view() : null; } catch { return null; } };
  const nameOf = (id) => characterOr(id).name;
  function leaveRoom() { if (BETWEEN.has(state)) go(crewMatch ? 'crewLobby' : 'onlineMenu'); }
  const rivalLabel = (v) => (v && v.rivalName) || (crewMatch && crewMatch.rival && crewMatch.rival.name) || 'RIVAL';
  function scoreLine(root, v) {
    const set = el('div', 'fl-set');
    const me = el('span', 'fl-me'), them = el('span', 'fl-them');
    me.append(el('span', 'fl-sl', 'YOU '), el('span', 'fl-sn', String(v.tally.you)));
    them.append(el('span', 'fl-sn', String(v.tally.rival)), el('span', 'fl-sl', ` ${rivalLabel(v)}`));
    set.append(me, el('span', 'fl-dash', '–'), them);
    root.appendChild(set);
    return set;
  }
  function screenPost() {
    const v = view();
    if (!v) { go('onlineEnd'); return; }
    const host = v.role === 'host';
    betweenRole = v.role;
    post = { host, cdEl: null, rivalEl: null, btns: {}, stop: null, setEl: null, subEl: null };
    lastWant = v.rival.want;
    guardUntil = 0; navAt = -1e9;
    ui.show('fl-post', (root) => {
      const L = v.last || { youWon: false, draw: true, wins: [0, 0], chars: ['', ''] };
      root.append(el('h1', 'fl-h1', L.draw ? 'DRAW' : L.youWon ? 'YOU WIN' : 'YOU LOSE'));
      root.appendChild(el('div', 'fl-label', `MATCH ${v.n}  ·  ${nameOf(L.chars[v.me])} VS ${nameOf(L.chars[1 - v.me])}  ·  ROUNDS ${L.wins[v.me]}–${L.wins[1 - v.me]}`));
      post.setEl = scoreLine(root, v);
      post.subEl = el('div', 'fl-small', '');
      root.appendChild(post.subEl);
      post.cdEl = el('div', 'fl-cd');
      post.rivalEl = el('div', 'fl-rivalline');
      const cdRow = el('div', 'fl-row fl-cdrow');
      cdRow.appendChild(post.cdEl);
      root.append(cdRow, post.rivalEl);
      const mk = (c, sub, cls) => {
        const b = button(CHOICE[c], () => { if (t < 0.4 || t < guardUntil || state !== 'onlinePost') return; getNet().postChoose?.(c); paintBetween(); }, cls);
        b.el.appendChild(el('small', '', sub));
        b.choice = c;
        post.btns[c] = b;
        return b;
      };
      const re = mk('rematch', 'SAME FIGHTERS', 'fl-pink'), ch = mk('chars', 'BOTH PICK AGAIN', 'fl-amber');
      // STOP (WAIT for the guest): holds a countdown; dim, and skipped by the focus, while there's none you can stop
      const stop = button(host ? 'STOP' : 'WAIT', () => { if (t >= 0.4) { getNet().postBack?.(); paintBetween(); } }, 'fl-violet fl-mini');
      stop.disabled = () => { const w = view(); return !w || !w.cd || (!host && w.cd.kind === 'host') || (!host && w.mine.want === 'wait'); };
      post.stop = stop;
      const leave = button(crewMatch ? 'BACK TO CREW' : 'LEAVE ROOM', () => { if (t >= 0.4) leaveRoom(); }, 'fl-violet');
      const main = mainMenuBtn(0.4);
      cdRow.appendChild(stop.el);   // beside the countdown it stops
      btnRow(root, [re, ch], '26cqw');
      btnRow(root, [leave, main], '26cqw');
      const items = [re, ch, leave, main, stop];
      return {
        items, focus: 0,
        back: () => { if (t >= 0.25) { getNet().postBack?.(); paintBetween(); } },
        onFocus: (k, it) => { if (it && it.choice) { try { getNet().postFocus?.(it.choice); } catch { /* stub */ } } },
        legend: [MOVE, SELECT, ['back', host ? 'STOP' : 'WAIT']],
      };
    });
    paintBetween(v);
  }
  /** repaint the post-match or pick screen from the session (cheap: only text and classes change) */
  function paintBetween(v = view()) {
    if (!v) return;
    if (state === 'onlinePost' && post) paintPost(v);
    else if (state === 'onlineSelect' && pickUi) paintPick(v);
  }
  const setText = (n, s) => { if (n && n.textContent !== s) n.textContent = s; };
  function paintPost(v) {
    const host = v.role === 'host', secs = v.cd ? Math.max(1, Math.ceil(v.cd.left / 1000)) : 0;
    // the countdown line
    let big = '', small = '';
    if (rotating) {   // winner stays on (a crew match with someone waiting): both head back to the lobby
      const s = Math.max(1, Math.ceil((rotating.until - performance.now()) / 1000));
      big = rotating.stay === crewC().you ? `YOU STAY ON  ·  ${s}` : `BACK TO THE CREW IN ${s}`;
      small = `WINNER STAYS ON  ·  ${rotating.next} IS NEXT`;
    } else if (v.cd) {
      if (v.cd.kind === 'auto') { big = `REMATCH IN ${secs}`; small = 'ANY BUTTON STOPS IT'; }
      else if (v.cd.kind === 'agree') { big = `REMATCH IN ${secs}`; small = host ? 'PRESS REMATCH AGAIN TO GO NOW  ·  STOP HOLDS IT' : 'WAIT HOLDS IT'; }
      else { big = host ? `REMATCH IN ${secs}` : `HOST'S CALL: REMATCH IN ${secs}`; small = host ? 'YOUR CALL  ·  PRESS AGAIN TO GO NOW  ·  STOP HOLDS IT' : 'THE HOST HAS THE FINAL CALL'; }
    } else small = host ? 'YOU HAVE THE FINAL CALL' : 'YOUR PICK IS A REQUEST  ·  THE HOST HAS THE FINAL CALL';
    if (post.cdEl) {
      const key = big + '|' + small;
      if (post.cdEl.dataset.k !== key) { post.cdEl.dataset.k = key; post.cdEl.textContent = big; post.cdEl.appendChild(el('small', '', small)); }
    }
    // the tally under the score
    // the all-time record: the crew's (on the server) in a crew match, else this browser's against this rival
    const cr = crewMatch ? crewRecord(crewMatch.rival.id) : null;
    const at = cr ? `  ·  CREW RECORD VS ${rivalLabel(v)} ${cr.w}–${cr.l}${cr.d ? `–${cr.d}` : ''}`
      : v.allTime && (v.allTime.w + v.allTime.l + v.allTime.d) > v.tally.games ? `  ·  ALL TIME VS THIS RIVAL ${v.allTime.w}–${v.allTime.l}` : '';
    setText(post.subEl, `ROUNDS ${v.tally.roundsYou}–${v.tally.roundsRival}${v.tally.draw ? `  ·  DRAWS ${v.tally.draw}` : ''}${at}`);
    // the rival's choice
    const rw = v.rival.want, rf = v.rival.focus;
    let line = '';
    const rn = rivalLabel(v);
    if (rotating) line = '';
    else if (host) line = rw === 'wait' ? `${rn} ASKED FOR A MOMENT` : rw ? `${rn} WANTS: ${CHOICE[rw]}` : rf && CHOICE[rf] ? `${rn} IS ON: ${CHOICE[rf]}` : `${rn} IS DECIDING`;
    else {
      const mine = v.mine.want === 'wait' ? 'YOU ASKED FOR A MOMENT' : v.mine.want ? `YOU ASKED FOR: ${CHOICE[v.mine.want]}` : '';
      const theirs = rf && CHOICE[rf] ? `HOST IS ON: ${CHOICE[rf]}` : 'HOST IS DECIDING';
      line = mine ? `${theirs}  ·  ${mine}` : theirs;
    }
    if (post.rivalEl && post.rivalEl.dataset.k !== line) {
      post.rivalEl.dataset.k = line; post.rivalEl.textContent = '';
      const i = line.indexOf(': ');
      if (i > 0 && !line.includes('  ·  ')) post.rivalEl.append(document.createTextNode(line.slice(0, i + 2)), el('b', '', line.slice(i + 2)));
      else post.rivalEl.textContent = line;
    }
    // the buttons: the rival's request (the host sees it highlighted), and what this side asked for
    for (const c of ['rematch', 'chars']) {
      const b = post.btns[c]; if (!b) continue;
      const want = host ? rw === c : v.rival.focus === c;
      b.el.classList.toggle('fl-want', want);
      const sub = host ? (rw === c ? 'RIVAL WANTS THIS' : c === 'rematch' ? 'SAME FIGHTERS' : 'BOTH PICK AGAIN')
        : v.mine.want === c ? 'ASKED  ·  HOST DECIDES' : rf === c ? 'HOST IS HERE' : c === 'rematch' ? 'SAME FIGHTERS' : 'BOTH PICK AGAIN';
      const sm = b.el.querySelector('small'); setText(sm, sub);
    }
    // the guest asks for something: the host's cursor goes there, so one press accepts it (not while
    // the host is moving it, and a press right after the jump doesn't count)
    if (host && rw !== lastWant) {
      lastWant = rw;
      const b = rw && post.btns[rw];
      if (b && t - navAt > 1) { const i = ui.items.indexOf(b); if (i >= 0 && i !== ui.focus) { ui.setFocus(i); guardUntil = t + 0.3; } }
    }
    ui.refresh();
  }

  // the pick screen: both pick at once, each seeing the other's card; the host starts
  let pickUi = null;
  function screenOnlineSelect() {
    const v = view();
    if (!v) { go('onlineEnd'); return; }
    const host = v.role === 'host';
    betweenRole = v.role;
    const status = el('div', 'fl-selstatus');
    const youEl = el('span'), rivalEl = el('span');
    status.append(youEl, rivalEl);
    let startBtn = null;
    if (host) {
      startBtn = button('START', () => { if (t >= 0.3) getNet().startNow?.(); }, 'fl-amber');
      startBtn.disabled = () => { const w = view(); return !w || !w.canStart; };
    }
    pickUi = { host, youEl, rivalEl, startBtn };
    const tl = v.tally;
    selCtl = openSelect(ui, {
      title: v.n === 0 ? `VS ${rivalLabel(v)}` : 'NEW CHARACTERS', sub: `MATCH ${v.n + 1}  ·  YOU ${tl.you} – ${tl.rival} ${rivalLabel(v)}  ·  ${host ? 'YOU START THE MATCH' : 'THE HOST STARTS THE MATCH'}`,
      roster: roster(), initial: sel.player, touch: ctx.touchUI(), pad: ctx.padUI(), status, cls: 'fl-netpick',
      backLabel: crewMatch ? 'BACK TO CREW' : 'LEAVE ROOM', extra: startBtn ? [startBtn] : [],
      onPick: (id) => { if (state !== 'onlineSelect' || t < 0.15) return; sel.player = id; getNet().pick?.(id, true); paintBetween(); },
      onBack: () => { if (t >= 0.3) leaveRoom(); },
      // the back key un-readies (CHANGE); it never leaves the room by accident
      onBackKey: () => { const w = view(); if (w && w.mine.ready) { getNet().pick?.(w.mine.id, false); paintBetween(); } },
      onHover: (id) => { const w = view(); if (w && !w.mine.ready) getNet().pick?.(id, false); },
      legend: [['move'], ['confirm', 'PICK'], ['back', 'CHANGE']],
    });
    paintBetween(v);
  }
  function paintPick(v) {
    const p = pickUi, secs = v.cd ? Math.max(1, Math.ceil(v.cd.left / 1000)) : 0;
    const me = v.mine, them = v.rival;
    let you = me.ready ? `YOU: READY · ${nameOf(me.id)}` : 'YOU: PICKING';
    if (me.ready && !p.host) you += v.cd ? `  ·  STARTING IN ${secs}` : '  ·  WAITING FOR HOST';
    if (p.host && v.cd) you += `  ·  STARTING IN ${secs}`;
    else if (p.host && me.ready && them.ready) you += '  ·  PRESS START';
    const rn = rivalLabel(v);
    const riv = them.ready ? `${rn} READY: ${nameOf(them.id)}` : `${rn} IS PICKING… ${nameOf(them.id)}`;
    const k = you + '|' + riv;
    if (p.youEl.dataset.k !== k) {
      p.youEl.dataset.k = k;
      p.youEl.textContent = ''; p.youEl.appendChild(el('b', me.ready ? 'fl-ok' : '', you));
      p.rivalEl.textContent = ''; p.rivalEl.appendChild(el('b', them.ready ? 'fl-ok' : '', riv));
    }
    if (p.startBtn) {
      const label = v.canStart && !them.ready ? `START · ${rn}: ${nameOf(them.id)}` : 'START';
      if (p.startBtn.el.textContent !== label) p.startBtn.el.textContent = label;
    }
    if (selCtl && selCtl.mark) selCtl.mark(them.id, them.ready ? 'RIVAL READY' : 'RIVAL', them.ready ? 'fl-rivalready' : '');
    ui.refresh();
  }

  function screenOnlineEnd() {
    ui.show('fl-onlineend', (root) => {
      root.append(el('h1', 'fl-h2', 'VERSUS ONLINE'), el('div', 'fl-h3', endMsg || 'DISCONNECTED'));
      const items = [];
      // a crew match: back to the crew lobby first
      if (crewMatch && crewCli && crewCli.active) {
        items.push(button('BACK TO CREW', () => go('crewLobby'), 'fl-pink'), mainMenuBtn());
        btnRow(root, items, '18cqw');
        return { items, back: () => go('crewLobby'), legend: [MOVE, SELECT, ['back', 'BACK TO CREW']] };
      }
      // RETRY only where the same thing can work a second time: a room that didn't open, a join that didn't connect
      if (retryTo) items.push(button(retryTo === 'onlineHost' ? 'HOST AGAIN' : 'TRY AGAIN', () => { const to = retryTo; retryTo = null; if (to) go(to); }, 'fl-pink'));
      items.push(button('ONLINE MENU', () => go('onlineMenu'), retryTo ? '' : 'fl-pink'), mainMenuBtn());
      btnRow(root, items, '18cqw');
      return { items, back: () => go('onlineMenu') };
    });
  }

  // ---- typing screens: a name, a crew name, a crew link, an email, a code ---------------------------------
  // One builder: a field, a message line, the on-screen keyboard (tap, mouse, or D-pad and A; pad X is
  // DEL), and OK / BACK. A physical keyboard types into it (onText above), and a paste goes in too.
  let te = null;
  function textScreen(cls, o) {
    te = { value: o.value || '', max: o.max, lower: !!o.lower, accept: o.accept, valid: o.valid, submit: o.submit, paste: o.paste || null, busy: false, fieldEl: null, msgEl: null, okBtn: null };
    const me = te;
    ui.show(`fl-text ${cls}`, (root) => {
      root.append(el('h1', 'fl-h2', o.title));
      if (o.label) root.appendChild(el('div', 'fl-label', o.label));
      me.fieldEl = el('div', `fl-field${me.lower ? ' fl-lower' : ''}`);
      me.msgEl = el('div', 'fl-small fl-temsg', o.msg || '');
      root.append(me.fieldEl, me.msgEl);
      const extras = (o.extraKeys || []).map((ch) => ({ label: ch === ' ' ? 'SPACE' : ch, act: () => teType(ch), narrow: ch !== ' ' }));
      const kb = keyboard(o.keys, (ch) => teType(me.lower ? ch.toLowerCase() : ch), [...extras, { label: 'DEL', act: () => teType('DEL'), cls: 'fl-violet' }]);
      root.appendChild(kb.el);
      const ok = button(o.okLabel || 'OK', teSubmit, 'fl-pink');
      ok.disabled = () => me.busy || !me.valid(me.value);
      me.okBtn = ok;
      const back = button(o.backLabel || 'BACK', o.back, 'fl-violet');
      const row = [ok, ...(o.more || []), back];
      btnRow(root, row, '19cqw');
      const items = [...kb.items, ...row];
      // OK when the field already holds something that works (a name being changed), else A (or the first key)
      const a = kb.items.findIndex((k) => k.el.textContent === 'A');
      return { items, focus: me.valid(me.value) ? items.indexOf(ok) : Math.max(0, a), back: o.back, legend: [['type', 'TYPE'], MOVE, SELECT, ['del', 'DEL'], ['back', 'BACK']] };
    });
    tePaint();
  }
  function tePaint() {
    if (!te || !te.fieldEl) return;
    te.fieldEl.textContent = te.value;
    te.fieldEl.appendChild(el('i', 'fl-caret', ''));
    ui.refresh();
  }
  function teType(ch) {
    if (!TEXT.has(state) || !te || te.busy) return;
    if (ch === 'DEL') te.value = te.value.slice(0, -1);
    else if (te.value.length < te.max && te.accept(ch, te.value)) te.value += ch;
    else return;
    if (ctx.click) ctx.click();
    tePaint();
  }
  function teSay(msg, warn = true) { if (te && te.msgEl) { te.msgEl.textContent = msg; te.msgEl.classList.toggle('fl-warn', warn); } }
  function teSubmit() {
    const me = te;
    if (!TEXT.has(state) || !me || me.busy || !me.valid(me.value)) return;
    me.busy = true; ui.refresh();
    Promise.resolve(me.submit(me.value)).catch(() => teSay("CAN'T REACH THE SERVER")).finally(() => { me.busy = false; if (te === me) ui.refresh(); });
  }
  // the sign-in link opened in this same tab (only the fragment changed, so the page didn't reload):
  // from any menu, start over on the code screen
  if (typeof window !== 'undefined') window.addEventListener('hashchange', () => {
    if (/[#&]signin=/.test(location.hash) && state !== 'off' && !PLAY.has(state) && !BETWEEN.has(state) && state !== 'paused') { go('off'); start(); }
  });
  if (typeof window !== 'undefined') window.addEventListener('paste', (e) => {
    if (!TEXT.has(state) || !te || !e.clipboardData) return;
    const s = e.clipboardData.getData('text') || '';
    e.preventDefault();
    if (te.paste) { te.value = te.paste(s).slice(0, te.max); tePaint(); return; }
    for (const raw of s) { const ch = te.lower ? raw.toLowerCase() : raw.toUpperCase(); if (te.value.length < te.max && te.accept(ch, te.value)) te.value += ch; }
    tePaint();
  });

  // the display name: asked for the first time a player goes online, changed from the profile screen
  let nameThen = null, nameBack = null;
  function askName(then, back) { nameThen = then; nameBack = back; go('nameEntry'); }
  function screenName() {
    const p = profile();
    textScreen('fl-name', {
      title: p.name ? 'CHANGE YOUR NAME' : 'WHAT DO WE CALL YOU?',
      label: 'YOUR NAME ONLINE  ·  3 TO 12 LETTERS OR NUMBERS',
      msg: 'OTHER PLAYERS SEE THIS NAME, AND NOTHING ELSE ABOUT YOU',
      value: p.name, max: 12,
      keys: (ch) => /[A-Z0-9]/.test(ch), extraKeys: [' '],
      accept: (ch, v) => /^[A-Z0-9]$/.test(ch) || (ch === ' ' && v.length > 0 && !v.endsWith(' ')),
      valid: (v) => !!cleanName(v),
      okLabel: 'OK',
      // a returning player on a new device signs in instead (the name comes back with the profile)
      more: p.name || p.email ? [] : [button('SIGN IN', () => { signInReturn = { then: nameThen, back: nameBack }; nameThen = null; nameBack = null; go('signInEmail'); }, 'fl-amber')],
      submit: (v) => {
        saveName(v);
        const name = profile().name;
        try { getNet().setName?.(name); } catch { /* stub */ }
        if (crewCli && crewCli.active) crewCli.rename(name);
        const then = nameThen; nameThen = null; nameBack = null;
        if (then) then(); else go('profile');
      },
      back: () => { const b = nameBack; nameThen = null; nameBack = null; if (b) b(); else go(profile().name ? 'profile' : 'onlineMenu'); },
    });
  }

  // the profile: the name, and SAVE MY PROFILE (an email keeps it on any device) or SIGN OUT
  let profileMsg = '', signOutArmed = false;
  function screenProfile() {
    const p = profile();
    signOutArmed = false;
    ui.show('fl-profile', (root) => {
      root.append(el('h1', 'fl-h2', 'PROFILE'), el('div', 'fl-label', 'YOUR NAME ONLINE'), el('div', 'fl-h1 fl-pname', p.name || '???'));
      root.appendChild(el('div', 'fl-label fl-pemail', p.email ? `SAVED TO ${p.email}` : 'KEPT ON THIS DEVICE ONLY'));
      if (profileMsg) root.appendChild(el('div', 'fl-label fl-newhi', profileMsg));
      root.appendChild(el('div', 'fl-small', p.email
        ? 'SIGN IN WITH THIS EMAIL ON ANOTHER DEVICE TO PLAY AS YOU THERE'
        : 'SAVE IT WITH YOUR EMAIL TO KEEP YOUR NAME, CREWS AND RECORDS ON ANY DEVICE. THE EMAIL IS ONLY FOR SIGN-IN CODES, AND NOBODY ELSE SEES IT'));
      const name = button('CHANGE NAME', () => askName(null, () => go('profile')), 'fl-pink');
      const acct = p.email
        ? button('SIGN OUT', () => {
          if (!signOutArmed) { signOutArmed = true; acct.el.textContent = 'SIGN OUT? PRESS AGAIN'; return; }
          signOut().then(() => { profileMsg = 'SIGNED OUT: THIS DEVICE STARTS FRESH'; if (state === 'profile') { askName(() => go('profile'), () => go('onlineMenu')); } });
        }, 'fl-amber')
        : button('SAVE MY PROFILE', () => go('signInEmail'), 'fl-amber');
      const back = button('BACK', () => go('onlineMenu'), 'fl-violet');
      const items = btnRow(root, [name, acct, back, mainMenuBtn()], '17cqw');
      return { items, focus: p.email ? 0 : 1, back: () => go('onlineMenu') };
    });
    profileMsg = '';
  }

  // sign-in: the email, then the code (or the email's link, which lands on the code screen filled in)
  let signIn = { email: '', dev: '', code: '', auto: false };
  let signInReturn = null;   // signing in from the first name screen: where to go after (and back to)
  const signInBack = () => { if (signInReturn) { const r = signInReturn; signInReturn = null; askName(r.then, r.back); } else go('profile'); };
  const SIGNIN_ERRORS = {
    'bad-email': "THAT DOESN'T LOOK LIKE AN EMAIL", cooldown: 'A CODE WAS JUST SENT: WAIT 30 SECONDS FOR ANOTHER',
    'too-many': 'TOO MANY TRIES: WAIT AN HOUR AND TRY AGAIN', busy: 'SERVER BUSY: TRY AGAIN SHORTLY', 'send-failed': "COULDN'T SEND THE EMAIL: TRY AGAIN IN A MINUTE",
    unreachable: "CAN'T REACH THE SERVER", 'other-email': 'THIS PROFILE IS SAVED TO ANOTHER EMAIL: SIGN IN WITH THAT ONE', expired: 'THAT CODE EXPIRED: SEND A NEW ONE', 'used-up': 'TOO MANY WRONG CODES: SEND A NEW ONE', 'bad-code': 'THE CODE IS 6 DIGITS',
  };
  function screenSignInEmail() {
    textScreen('fl-email', {
      title: 'SAVE MY PROFILE', label: 'YOUR EMAIL  ·  WE SEND YOU A 6-DIGIT CODE',
      msg: 'ONLY YOU SEE IT. NO PASSWORD, NO NEWSLETTER',
      value: signIn.email, max: 64, lower: true,
      keys: (ch) => /[A-Z0-9]/.test(ch), extraKeys: ['@', '.', '-', '_'],
      accept: (ch) => /^[a-z0-9@._+-]$/.test(ch),
      valid: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      okLabel: 'SEND CODE',
      submit: async (v) => {
        teSay('SENDING…', false);
        const r = await startSignIn(v);
        if (state !== 'signInEmail') return;
        if (!r || r.error) { teSay(SIGNIN_ERRORS[r && r.error] || 'SOMETHING WENT WRONG'); return; }
        signIn = { email: v, dev: r.devCode || '', code: '', auto: false };
        go('signInCode');
      },
      back: signInBack,
    });
  }
  function screenSignInCode() {
    const resend = button('SEND AGAIN', async () => {
      if (!te || te.busy) return;
      const r = await startSignIn(signIn.email);
      if (state !== 'signInCode') return;
      if (!r || r.error) teSay(SIGNIN_ERRORS[r && r.error] || 'SOMETHING WENT WRONG');
      else { signIn.dev = r.devCode || ''; teSay(signIn.dev ? `NEW CODE SENT  ·  DEV MODE: ${signIn.dev}` : 'NEW CODE SENT', false); }
    });
    const auto = signIn.auto;
    textScreen('fl-code6', {
      title: 'ENTER THE CODE', label: signIn.email ? `SENT TO ${signIn.email}` : 'FROM YOUR EMAIL',
      msg: signIn.dev ? `DEV MODE: YOUR CODE IS ${signIn.dev}` : auto ? 'CHECKING THE CODE FROM YOUR EMAIL…' : 'CHECK YOUR EMAIL. THE CODE LASTS 10 MINUTES',
      value: signIn.code || '', max: 6,
      keys: (ch) => /[0-9]/.test(ch),
      accept: (ch) => /^[0-9]$/.test(ch),
      valid: (v) => /^\d{6}$/.test(v),
      paste: (s) => (String(s).match(/\d{6}/) || [String(s).replace(/\D/g, '')])[0],
      okLabel: 'VERIFY', more: [resend],
      submit: async (v) => {
        teSay('CHECKING…', false);
        const r = await verifySignIn(signIn.email, v);
        if (state !== 'signInCode') return;
        if (!r || r.error) {
          const left = r && r.left;
          teSay(r && r.error === 'wrong' ? `THAT CODE ISN'T RIGHT: ${left} ${left === 1 ? 'TRY' : 'TRIES'} LEFT` : SIGNIN_ERRORS[r && r.error] || 'SOMETHING WENT WRONG');
          return;
        }
        const p = profile();
        try { getNet().setName?.(p.name); } catch { /* stub */ }
        profileMsg = r.restored ? `WELCOME BACK${p.name ? `, ${p.name}` : ''}: PROFILE RESTORED` : 'PROFILE SAVED';
        signIn = { email: '', dev: '', code: '', auto: false };
        const r2 = signInReturn; signInReturn = null;
        if (!p.name) askName(r2 ? r2.then : () => go('profile'), r2 ? r2.back : () => go('profile'));
        else if (r2 && r2.then) r2.then();   // back on the way (a crew link, the online menu)
        else go('profile');
      },
      back: signInBack,
    });
    signIn.auto = false;
    if (auto && te && te.valid(te.value)) teSubmit();   // the email's link: one press already made
  }

  // ---- crew rooms ---------------------------------------------------------------------------------------------
  // A crew room is a permanent link (?crew=<slug>) to a lobby (src/net/crew.js, worker/crew.ts): who's here,
  // the standings, each member's favorite fighter, and PLAY. Two members ready go to the pick screen of a
  // match the crew opens (a quick room underneath), and the host's page reports each result to the crew.
  let crewCli = null, crewSlug = '', crewMatch = null, rotating = null, crewNote = '', crewFail = '', linkTimer = 0;
  let lob = null;
  function crewC() {
    if (crewCli) return crewCli;
    const c = createCrew();
    crewCli = c;
    c.on('state', (s) => {
      if (s && s.crew && s.crew.slug === crewSlug && s.crew.name) rememberCrew(crewSlug, s.crew.name);
      if (state === 'crewLobby') paintLobby();
      else if (state === 'onlinePost') paintBetween();   // the crew record under the score
    });
    c.on('status', () => { if (state === 'crewLobby') paintLobby(); });
    c.on('match', (m) => { if (state === 'crewLobby') startCrewMatch(m); else c.lobby(); });
    c.on('rotate', (m) => {
      // (the guest may still be confirming the match's last frames when this lands: it waits for the post-match screen)
      if (!crewMatch || m.match !== crewMatch.id || !(BETWEEN.has(state) || state === 'onlineFighting')) return;
      rotating = { stay: String(m.stay || ''), next: String(m.next || 'SOMEONE'), until: performance.now() + 4000 };
      try { const n = getNet(), v = view(); if (v && v.role === 'host') n.postBack?.(); else n.postPoke?.(); } catch { /* stub */ }   // hold any rematch countdown
      paintBetween();
    });
    c.on('error', (reason) => {
      const msg = { 'no-crew': 'NO CREW AT THAT LINK', 'crew-full': 'THIS CREW IS FULL (50 MEMBERS)', full: 'THIS CREW ROOM IS FULL RIGHT NOW', 'bad-hello': 'SET A NAME FIRST', busy: 'SERVER BUSY: TRYING AGAIN', flood: 'TOO MUCH TRAFFIC: RECONNECTING' }[reason] || 'SOMETHING WENT WRONG';
      if (!c.active) { crewFail = msg; if (state === 'crewLobby') screenCrewLobby(); }
      else { crewNote = msg; if (lob) lob.noteUntil = performance.now() + 4000; if (state === 'crewLobby') paintLobby(); }
    });
    return c;
  }
  function openCrew(slug) {
    crewSlug = slug; crewFail = '';
    const from = state;
    if (!profile().name) { askName(() => go('crewLobby'), () => go(from === 'off' ? 'attract' : 'onlineMenu')); return; }
    go('crewLobby');
  }
  function setCrewParam(slug) {
    try {
      const u = new URL(location.href);
      if (slug) u.searchParams.set('crew', slug); else u.searchParams.delete('crew');
      if (u.href !== location.href) window.history.replaceState(null, '', u.toString());
    } catch { /* sandboxed */ }
  }
  /** entering the lobby: connect (or say we're back from a match), and a winner staying on is ready at once */
  function crewEnter() {
    const p = profile(), c = crewC();
    if (!c.active || c.slug !== crewSlug) { crewFail = ''; c.connect(crewSlug, { pid: p.id, name: p.name }); }
    else c.lobby();
    if (rotating && rotating.stay && rotating.stay === c.you) c.play(true, true);
    rotating = null; crewMatch = null;
    setCrewParam(crewSlug);   // the address bar holds the crew's link while you're in it: bookmark it
  }
  function crewClose() {
    if (crewCli) crewCli.close();
    crewMatch = null; rotating = null; crewNote = '';
    setCrewParam('');
  }
  const members = () => (crewCli && crewCli.state && crewCli.state.members) || [];
  const member = (id) => members().find((m) => m.id === id) || null;
  /** this member's record against another, from the crew's head to head */
  function crewRecord(other) {
    const s = crewCli && crewCli.state, me = crewCli && crewCli.you;
    if (!s || !me || !other) return null;
    const [a, b] = me < other ? [me, other] : [other, me];
    const r = (s.h2h || []).find((x) => x.a === a && x.b === b);
    if (!r) return { w: 0, l: 0, d: 0 };
    return me === a ? { w: r.aw, l: r.bw, d: r.d } : { w: r.bw, l: r.aw, d: r.d };
  }
  function startCrewMatch(m) {
    crewMatch = { id: String(m.id), code: String(m.code), role: m.role === 'host' ? 'host' : 'guest', rival: { id: String((m.rival && m.rival.id) || ''), name: String((m.rival && m.rival.name) || 'RIVAL') } };
    // the pick screen opens on your last pick in this crew (or your favorite), else the last one on this device
    const me = member(crewCli.you), want = me && (me.last || me.fav);
    if (want && roster().some((c) => c.id === want)) sel.player = want;
    try { const n = getNet(); n.setCharacter?.(sel.player); n.setName?.(profile().name); } catch { /* stub */ }
    go('crewLinking');
  }
  function screenCrewLinking() {
    const session = ++netSession;
    const cm = crewMatch;
    if (!cm) { go('crewLobby'); return; }
    let msg;
    ui.show('fl-connecting', (root) => {
      root.append(el('h1', 'fl-h2', 'CREW MATCH'), el('div', 'fl-h1', `VS ${cm.rival.name}`));
      msg = el('div', 'fl-label fl-dots', 'CONNECTING');
      statusEl = msg;
      root.appendChild(msg);
      const items = btnRow(root, [button('CANCEL', () => go('crewLobby'), 'fl-violet'), mainMenuBtn()]);
      return { items, back: () => go('crewLobby') };
    });
    listen(session);
    const net = getNet(), opts = { pickFirst: true, crew: true };
    (cm.role === 'host' ? net.host({ ...opts, code: cm.code }) : net.join(cm.code, opts))
      .catch((e) => { if (session === netSession) netFail(String((e && e.message) || e).toUpperCase()); });
    // a rival who never shows (closed the tab, lost the signal) doesn't hold you here
    clearTimeout(linkTimer);
    linkTimer = window.setTimeout(() => { if (state === 'crewLinking' && session === netSession) { crewNote = `${cm.rival.name} DIDN'T CONNECT`; go('crewLobby'); if (lob) lob.noteUntil = performance.now() + 5000; } }, 20000);
  }
  function screenCrewCreate() {
    textScreen('fl-crewname', {
      title: 'NEW CREW ROOM', label: 'NAME YOUR CREW  ·  3 TO 20 LETTERS OR NUMBERS',
      msg: 'YOU GET A LINK TO SHARE AND BOOKMARK. ANYONE WITH IT CAN JOIN',
      value: '', max: 20,
      keys: (ch) => /[A-Z0-9]/.test(ch), extraKeys: [' '],
      accept: (ch, v) => /^[A-Z0-9]$/.test(ch) || (ch === ' ' && v.length > 0 && !v.endsWith(' ')),
      valid: (v) => !!cleanName(v, 3, 20),
      okLabel: 'CREATE',
      submit: async (v) => {
        teSay('OPENING THE ROOM…', false);
        const r = await createCrewRoom(cleanName(v, 3, 20));
        if (state !== 'crewCreate') return;
        if (r.error) { teSay(r.error === 'busy' ? 'SERVER BUSY: TRY AGAIN SHORTLY' : r.error === 'bad-name' ? 'THAT NAME WON\'T WORK' : "CAN'T REACH THE SERVER"); return; }
        rememberCrew(r.slug, r.name);
        openCrew(r.slug);
      },
      back: () => go('onlineMenu'),
    });
  }
  function screenCrewJoin() {
    textScreen('fl-crewjoin', {
      title: 'JOIN A CREW', label: 'PASTE THE CREW LINK, OR TYPE ITS CODE (LIKE TUESDAY-CREW-7K2QM)',
      msg: 'OPEN THE LINK YOUR FRIEND SENT, OR TYPE THE PART AFTER CREW=',
      value: '', max: 40, lower: true,
      keys: (ch) => /[A-Z0-9]/.test(ch), extraKeys: ['-'],
      accept: (ch) => /^[a-z0-9-]$/.test(ch),
      valid: (v) => !!cleanSlug(v),
      paste: (s) => cleanSlug(s) || String(s).toLowerCase().replace(/[^a-z0-9-]/g, ''),
      okLabel: 'JOIN',
      submit: (v) => openCrew(cleanSlug(v)),
      back: () => go('onlineMenu'),
    });
  }

  function screenCrewLobby() {
    lob = null;
    const slug = crewSlug, link = crewLink(slug);
    if (crewFail) {   // the crew isn't there (or won't have us): say so, with the ways out
      ui.show('fl-crew fl-crewfail', (root) => {
        root.append(el('h1', 'fl-h2', 'CREW ROOM'), el('div', 'fl-h3', crewFail), el('div', 'fl-small', 'CREW ROOMS CLOSE AFTER 90 DAYS WITHOUT A VISIT'));
        const items = btnRow(root, [button('ONLINE MENU', () => go('onlineMenu'), 'fl-pink'), mainMenuBtn()], '18cqw');
        return { items, back: () => go('onlineMenu') };
      });
      return;
    }
    const known = profile().crews.find((c) => c.slug === slug);
    ui.show('fl-crew', (root) => {
      const title = el('h1', 'fl-h2 fl-crewname', (crewCli && crewCli.state && crewCli.state.crew.name) || (known && known.name) || 'CREW ROOM');
      const sub = el('div', 'fl-label', 'CREW ROOM  ·  BOOKMARK THIS PAGE TO COME BACK');
      const linkEl = el('div', 'fl-link', link);
      root.append(title, sub, linkEl);
      const body = el('div', 'fl-row fl-crewbody');
      const left = el('div', 'fl-crewleft'), right = el('div', 'fl-crewright');
      const table = el('div', 'fl-standings'), recent = el('div', 'fl-recent');
      left.append(table, recent);
      const status = el('div', 'fl-crewstatus');
      // (a press while still connecting counts: crew.js sends it once the room says welcome)
      const play = button('PLAY', () => { const c = crewC(); c.play(!c.ready); paintLobby(); }, 'fl-pink fl-playbtn');
      play.el.textContent = ''; play.el.append(el('span', 'fl-pl', 'PLAY'), el('small', '', ''));
      const copy = button('COPY LINK', () => {
        Promise.resolve().then(() => navigator.clipboard.writeText(link))
          .then(() => { copy.el.textContent = 'COPIED'; }, () => { copy.el.textContent = 'COPY FAILED'; })
          .then(() => setTimeout(() => { copy.el.textContent = 'COPY LINK'; }, 1400));
      }, 'fl-mini');
      const items = [play, copy];
      const btns = el('div', 'fl-list fl-crewbtns');
      btns.append(status, play.el);
      const pair = el('div', 'fl-row fl-crewpair'); pair.appendChild(copy.el);
      if (typeof navigator.share === 'function') {
        const share = button('SHARE', () => { navigator.share({ title: 'Neon Stick Fight', text: `Our crew room: ${title.textContent}`, url: link }).catch(() => {}); }, 'fl-mini');
        pair.appendChild(share.el); items.push(share);
      }
      const leave = button('ONLINE MENU', () => go('onlineMenu'), 'fl-violet fl-mini');
      const main = button('MAIN MENU', () => go('modeSelect'), 'fl-violet fl-mini');
      const pair2 = el('div', 'fl-row fl-crewpair'); pair2.append(leave.el, main.el);
      btns.append(pair, pair2);
      items.push(leave, main);
      right.appendChild(btns);
      body.append(left, right);
      root.appendChild(body);
      lob = { title, table, recent, status, play, noteUntil: crewNote ? performance.now() + 5000 : 0 };
      return { items, focus: 0, back: () => go('onlineMenu'), legend: [MOVE, SELECT, ['back', 'ONLINE MENU']] };
    });
    paintLobby();
  }
  const ON = { lobby: ['HERE', 'fl-on-here'], ready: ['READY', 'fl-on-ready'], match: ['PLAYING', 'fl-on-match'] };
  function paintLobby() {
    if (state !== 'crewLobby' || !lob) return;
    const c = crewC(), s = c.state, you = c.you;
    if (s && s.crew && s.crew.name && lob.title.textContent !== s.crew.name) lob.title.textContent = s.crew.name;
    // the standings: everyone who has opened the link, the most wins first
    const t = lob.table;
    t.textContent = '';
    for (const h of ['', 'NAME', 'W', 'L', 'D', 'VS YOU', 'FAVORITE']) t.appendChild(el('span', `fl-sth${'WLDVS YOU'.includes(h) && h ? ' fl-snum' : ''}`, h));
    const list = members();
    const shown = list.slice(0, 7);
    shown.forEach((m, i) => {
      const mine = m.id === you;
      const cls = mine ? ' fl-me' : '';
      t.appendChild(el('span', 'fl-srank' + cls, String(i + 1)));
      const nm = el('span', 'fl-sname' + cls);
      const dot = el('i', `fl-dot ${m.on ? ON[m.on][1] : ''}`);
      nm.append(dot, document.createTextNode(m.name + (mine ? ' (YOU)' : '')));
      if (m.on === 'ready' || m.on === 'match') nm.appendChild(el('b', `fl-chip ${ON[m.on][1]}`, ON[m.on][0]));
      t.appendChild(nm);
      t.append(el('span', 'fl-snum' + cls, String(m.w)), el('span', 'fl-snum' + cls, String(m.l)), el('span', 'fl-snum' + cls, String(m.d)));
      const r = mine ? null : crewRecord(m.id);
      t.appendChild(el('span', 'fl-snum fl-svs' + cls, mine ? '·' : r && r.w + r.l + r.d ? `${r.w}–${r.l}` : '–'));
      const fav = m.fav || m.last;
      const f = el('span', 'fl-sfav' + cls, fav ? characterOr(fav).name : '–');
      if (fav) f.style.setProperty('--fc', characterOr(fav).color);
      t.appendChild(f);
    });
    if (list.length > shown.length) { const more = el('span', 'fl-smore', `AND ${list.length - shown.length} MORE`); t.appendChild(more); }
    if (!s) { const w = el('span', 'fl-smore', c.status === 'reconnecting' ? 'RECONNECTING…' : 'CONNECTING…'); t.appendChild(w); }
    // the last few matches
    lob.recent.textContent = '';
    const nameOfM = (id) => (member(id) || { name: '?' }).name;
    for (const r of ((s && s.recent) || []).slice(0, 3)) {
      const line = r.winner < 0 ? `${nameOfM(r.host)} AND ${nameOfM(r.guest)} DREW ${r.hw}–${r.gw}`
        : `${nameOfM(r.winner === 0 ? r.host : r.guest)} BEAT ${nameOfM(r.winner === 0 ? r.guest : r.host)} ${Math.max(r.hw, r.gw)}–${Math.min(r.hw, r.gw)}`;
      const chars = r.hc && r.gc ? `  ·  ${characterOr(r.hc).name} VS ${characterOr(r.gc).name}` : '';
      lob.recent.appendChild(el('div', '', line + chars));
    }
    if (!(s && s.recent && s.recent.length)) lob.recent.appendChild(el('div', '', s ? 'NO MATCHES YET. TWO OF YOU PRESS PLAY' : ''));
    // the status line and the PLAY button
    const here = list.filter((m) => m.on), others = here.filter((m) => m.id !== you);
    const readyOthers = others.filter((m) => m.on === 'ready'), playing = others.filter((m) => m.on === 'match');
    let line = '';
    if (c.status === 'connecting') line = 'CONNECTING TO THE CREW…';
    else if (c.status === 'reconnecting') line = 'RECONNECTING…';
    else if (crewNote) line = crewNote;
    else if (c.ready) line = readyOthers.length ? 'MATCHING YOU UP…' : playing.length ? 'READY  ·  YOU PLAY THE WINNER' : others.length ? 'READY  ·  WAITING FOR A RIVAL' : 'READY  ·  NOBODY ELSE IS HERE YET';
    else if (readyOthers.length) line = `${readyOthers[0].name} IS READY: PRESS PLAY`;
    else if (playing.length) line = `${playing.map((m) => m.name).join(' VS ')} PLAYING  ·  PRESS PLAY TO GO NEXT`;
    else line = others.length ? `${here.length} HERE  ·  PRESS PLAY WHEN YOU'RE SET` : 'NOBODY ELSE IS HERE YET  ·  SEND THE LINK';
    setText(lob.status, line);
    lob.status.classList.toggle('fl-warn', !!crewNote);
    const pl = lob.play.el.querySelector('.fl-pl'), sm = lob.play.el.querySelector('small');
    setText(pl, c.ready ? 'CANCEL' : 'PLAY');
    setText(sm, c.ready ? (playing.length ? 'NEXT UP: THE WINNER' : 'WAITING FOR A RIVAL') : readyOthers.length ? `${readyOthers[0].name} IS WAITING` : playing.length ? 'PLAY THE WINNER' : 'FIGHT WHOEVER IS READY');
    lob.play.el.classList.toggle('fl-amber', c.ready);
    ui.refresh();
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
      // the room's running tally for the fight HUD (src/combat/hud.js may draw it): from this side,
      // { you, rival, draw, roundsYou, roundsRival, games, n } where n is this match's number
      tally: state === 'onlineFighting' ? onlineTally() : null,
      hint: touch ? '' : state === 'onlineFighting' ? (pad ? `${startName()}  LEAVE` : 'F1  MOVES     ESC  LEAVE') : pad ? `${startName()}  PAUSE` : 'F1  MOVES     ESC  PAUSE',
    };
  }
  function onlineTally() { const v = view(); return v && v.n ? { ...v.tally, n: v.n } : null; }
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
    const q = new URLSearchParams(location.search), h = new URLSearchParams(location.hash.slice(1));
    const crew = cleanSlug(opts.crew || q.get('crew'));
    // the sign-in email's link: #signin=<email>&code=<code>, submitted from here (never by a plain GET)
    if (h.get('signin') && /^\d{6}$/.test(h.get('code') || '')) {
      try { window.history.replaceState(null, '', location.pathname + location.search); } catch { /* sandboxed */ }
      demo(); signIn = { email: String(h.get('signin')).toLowerCase(), dev: '', code: String(h.get('code')), auto: true };
      go('signInCode');
    } else if (crew) { demo(); openCrew(crew); }   // a crew link: the lobby (a name first, the first time)
    else if (code) {
      demo(); joinCode = code;
      const pick = () => { sel.mode = 'online'; sel.step = 'player'; sel.join = true; go('charSelect'); };   // pick a fighter, then JOIN with the code filled in
      if (!profile().name) askName(pick, () => go('attract')); else pick();
    } else go('attract');
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

