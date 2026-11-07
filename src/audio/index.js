// The game's sound: effects (sfx.js), music (music.js, tracks.js) and the settings panel
// (ui.js). main.js makes three calls into it and nothing else:
//
//   gameAudio.attach(sim)   once, after the sim exists
//   gameAudio.event(ev)     from main.js's onEvent, for every fighter and sim event
//
// Everything else is here: the event-to-sound table, the stereo pan from the fighter's
// screen x, the whiff and pool watchers (a light requestAnimationFrame loop), the unlock
// on the first touch or key, M and N, the settings in localStorage, and the phone's media
// session.
import { camera } from '../camera.js';
import { FRAME_DATA } from '../combat/frameData.js';
import { createSfx } from './sfx.js';
import { createMusic } from './music.js';
import { createSoundUI } from './ui.js';

const W = 1280;
const KEY = 'stick-fight-audio';   // askscottpierce.com shares one origin across apps, so keys carry the app's slug
const DEFAULTS = { sound: true, music: true, musicVolume: 0.55, sfxVolume: 0.8, track: 0 };

function loadSettings() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) }; } catch (e) { return { ...DEFAULTS }; }
}

function createGameAudio() {
  const settings = loadSettings();
  const sfx = createSfx();
  const music = createMusic();
  music.state.track = Math.max(0, Math.min(music.tracks.length - 1, settings.track | 0));
  sfx.setVolume(settings.sfxVolume);
  sfx.setEnabled(settings.sound);
  music.setVolume(settings.musicVolume);
  let sim = null, unlocked = false;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* private mode */ } };

  // ---- settings -------------------------------------------------------------------------
  function musicShouldPlay() { return settings.sound && settings.music && unlocked; }
  function syncMusic() {
    if (musicShouldPlay()) { if (!music.state.playing && !music.state.loading) music.play(); }
    else if (music.state.playing || music.state.loading) music.stop();
  }
  const actions = {
    setSound(on) {
      settings.sound = !!on; save();
      sfx.setEnabled(settings.sound);
      if (settings.sound) { gesture(); sfx.ui('on'); }
      syncMusic(); ui.update();
    },
    setMusic(on) {
      settings.music = !!on;
      if (on && !settings.sound) { settings.sound = true; sfx.setEnabled(true); }
      save(); gesture(); syncMusic(); ui.update();
    },
    next() {
      if (!settings.music || !settings.sound) { settings.music = settings.sound = true; sfx.setEnabled(true); save(); }
      gesture();
      if (unlocked) music.next(); else music.state.track = (music.state.track + 1) % music.tracks.length;
      ui.update();
    },
    prev() { gesture(); if (unlocked && settings.music) music.prev(); },
    setMusicVolume(v) { settings.musicVolume = v; music.setVolume(v); save(); ui.update(); },
    setSfxVolume(v) { settings.sfxVolume = v; sfx.setVolume(v); save(); },
    sfxPreview() { sfx.hit({ heavy: true, strength: 0.8 }); },
    click(kind) { sfx.ui(kind); },
  };

  // ---- unlock: the browser keeps audio off until the page is touched ---------------------
  // touchend, pointerup, mousedown, keydown and click carry the user activation; a touch's
  // pointerdown doesn't, so a gesture is only acted on while navigator.userActivation says
  // it's live. It runs on every gesture until the context is running, then just pokes.
  function gesture() {
    if (!settings.sound) return;
    sfx.resume().then(() => {
      const was = unlocked;
      unlocked = !!sfx.context && sfx.context.state === 'running';
      if (unlocked !== was) ui.update();
      if (unlocked) syncMusic();
    });
    // play() starts the silent media element synchronously, inside this gesture (Safari)
    if (settings.music) { if (!music.state.playing && !music.state.loading) music.play(); else music.poke(); }
  }
  function onGesture(e) {
    if (!e.isTrusted) return;   // touch.js's synthetic keys don't count
    const ua = navigator.userActivation;
    if (ua && !ua.isActive) return;
    if (unlocked && sfx.context && sfx.context.state === 'running' && (!musicShouldPlay() || music.state.playing)) return;
    gesture();
  }
  for (const t of ['touchend', 'pointerup', 'mousedown', 'keydown', 'click']) window.addEventListener(t, onGesture, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) sfx.suspend();
    else if (unlocked && settings.sound) sfx.resume();
  });

  // ---- keys: M music on/off, N next track --------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '')) return;
    if (e.code === 'KeyM') actions.setMusic(!(settings.music && settings.sound));
    else if (e.code === 'KeyN') actions.next();
    else if (e.code === 'Escape') ui.close();
  });

  // ---- the phone's player ---------------------------------------------------------------------
  const ms = typeof navigator !== 'undefined' && navigator.mediaSession;
  if (ms) {
    const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch (e) { /* unsupported action */ } };
    set('play', () => actions.setMusic(true));
    set('pause', () => actions.setMusic(false));
    set('stop', () => actions.setMusic(false));
    set('nexttrack', () => actions.next());
    set('previoustrack', () => actions.prev());
  }
  music.onRemote = () => actions.setMusic(false);
  music.onChange = (st) => {
    if (settings.track !== st.track) { settings.track = st.track; save(); }
    if (ms) {
      const t = music.tracks[st.track];
      try {
        if (typeof MediaMetadata !== 'undefined' && t) ms.metadata = new MediaMetadata({ title: `Stick Fight · ${t.name}`, artist: 'Neon Stick Fight', album: t.mood });
        ms.playbackState = st.playing ? 'playing' : 'paused';
      } catch (e) { /* old browser */ }
    }
    ui.update();
  };

  const ui = createSoundUI({ settings, music, actions, isUnlocked: () => unlocked });

  // ---- events to sounds ---------------------------------------------------------------------
  const pan = (x) => {
    if (typeof x !== 'number') return 0;
    const sx = (x - camera.x) * camera.zoom;
    return Math.max(-1, Math.min(1, sx / (W / 2))) * 0.75;
  };
  const unitX = (id) => { const u = sim && sim.units[id]; return u ? u.x : camera.x; };
  let enderStep = -1;
  const treads = new Map();   // unit -> treads hit on this tumble, so each knocks a little lower

  function event(ev) {
    if (!ev || !settings.sound) return;
    try { route(ev); } catch (e) { console.warn('[audio]', ev.type, e.message); }
  }
  function route(ev) {
    const p = pan(ev.x);
    switch (ev.type) {
      case 'attack': {
        const u = ev.unit, fd = FRAME_DATA[ev.move] || {};
        sfx.whoosh({ move: ev.move, limb: fd.limb, pan: pan(u && u.x), gassed: !!(u && u.gassed > 0) });
        break;
      }
      case 'hit': {
        const def = ev.defender;
        if (ev.ko) {
          if (sim && sim.horde && def && def.id >= 1) sfx.goonDown({ pan: p });
          else if (sim && sim.finisher) { sfx.hit({ weight: 1, pan: p, limb: ev.limb }); sfx.slowmoKO({ pan: p }); music.duck(0.2, 2.6); }
          else { sfx.ko({ pan: p }); music.duck(0.3, 1.1); }
          break;
        }
        // the ender's callout comes in the same step, just before its hit
        const ender = !!sim && sim.stepCount === enderStep;
        const heavy = !!ev.knockdown || ev.strength >= 0.75;
        if (ev.move === 'throw' || ev.move === 'wallSlam') { sfx.throwSlam({ pan: p }); music.pump(0.4, 0.06, 0.3); }
        else if (ender) { sfx.hit({ weight: 1, boom: true, pan: p, limb: ev.limb }); music.pump(0.3, 0.08, 0.35); }
        else if (ev.counter) { sfx.counter({ pan: p, limb: ev.limb }); music.pump(0.4, 0.06, 0.3); }
        else {
          sfx.hit({ heavy, strength: ev.strength, pan: p, limb: ev.limb });
          // a jab doesn't move the music (a fast string would wobble it); a cross nudges it
          if (heavy) music.pump(0.5, 0.05, 0.25);
          else if (ev.strength >= 0.6) music.pump(0.75, 0.03, 0.18);
        }
        const count = (sim && sim.combo && sim.combo.count) || (def && def.combo) || 0;
        if (count >= 2 && (!sim || sim.stepCount !== enderStep)) sfx.combo({ count, pan: p });
        break;
      }
      case 'block':
        sfx.block({ strength: ev.move === 'throw' ? 1 : ev.strength, pan: p });
        break;
      case 'grab': sfx.throwGrab({ pan: p }); break;
      case 'thud': sfx.bodyFall({ strength: ev.strength, pan: p }); break;
      case 'wallImpact':
        if (ev.strength >= 1) { sfx.wallSplat({ pan: p }); music.pump(0.3, 0.08, 0.35); }
        else if (ev.strength >= 0.7) { sfx.wallBounce({ pan: p }); music.pump(0.5, 0.05, 0.25); }
        else sfx.wallKnock({ strength: 0.4, pan: p });
        break;
      case 'wall': sfx.wallKnock({ strength: ev.strength, pan: p }); break;
      case 'land': sfx.land({ weight: ev.strength || 0.3, pan: p }); break;
      case 'footstep': sfx.footstep({ weight: 0.4, pan: p }); break;
      case 'dust': sfx.jump({ pan: p }); break;   // the sim's jump takeoff
      case 'callout':
        if (ev.kind === 'gassed') sfx.gassed({ pan: pan(unitX(ev.by)) });
        else if (ev.kind === 'ender') {
          enderStep = sim ? sim.stepCount : -1;
          sfx.ender({ count: Math.max(2, (sim && sim.combo && sim.combo.count) || 2), pan: pan(unitX(ev.by)) });
        } else if (ev.text === 'GROUND BOUNCE') { sfx.groundBounce({ pan: pan(unitX(sim && sim.combo ? sim.combo.on : ev.by)) }); music.pump(0.5, 0.05, 0.25); }
        break;
      case 'round': sfx.round({ n: ev.round || 1 }); break;
      case 'fight': sfx.fight(); music.duck(0.6, 0.5); break;
      case 'match': sfx.match({ won: ev.winner !== 1 }); break;
      // multi-floor (combat builder): names and fields read defensively
      case 'floorBreak': sfx.floorBreak({ pan: p, strength: ev.strength == null ? 1 : ev.strength }); music.duck(0.4, 1.2); break;
      case 'vault': sfx.vault({ pan: p }); break;
      case 'stairTumble': {
        const u = ev.unit || ev.defender;
        if (u) treads.set(u, 0);
        sfx.bodyFall({ strength: 0.5, pan: p });
        break;
      }
      case 'tread': {
        const u = ev.unit || ev.defender;
        const n = u ? (treads.get(u) || 0) : 0;
        if (u) treads.set(u, n + 1);
        sfx.tread({ pan: p, strength: ev.strength == null ? 0.6 : ev.strength, n });
        break;
      }
      case 'floorClear':
        sfx.floorClear(); music.duck(0.5, 0.9);
        // in horde mode each floor gets the next track of the horde pool
        if (sim && sim.horde) setTimeout(() => music.setPool('horde', { restart: true }), 900);
        break;
    }
  }

  // ---- watchers: whiffs, and which pool the music should be in --------------------------------
  const seenWhiff = new Map();
  let poolAt = 0;
  const monitor = { on: false, sfxPeak: 0, musicPeak: 0, frames: 0 };
  function watch(now) {
    requestAnimationFrame(watch);
    if (!sim) return;
    if (settings.sound && unlocked) {
      for (const u of sim.units) {
        if (u.hidden || u.state !== 'attack' || u.phase !== 'recovery' || u.hitConfirmed) continue;
        if (seenWhiff.get(u.id) === u.attackId) continue;
        seenWhiff.set(u.id, u.attackId);
        sfx.whiff({ pan: pan(u.x) });
      }
    }
    if (now - poolAt > 250) {
      poolAt = now;
      const pool = sim.horde ? 'horde' : (sim.units[1] && sim.units[1].kind === 'none') ? 'calm' : 'fight';
      music.setPool(pool);
    }
    if (monitor.on) {
      monitor.frames++;
      monitor.sfxPeak = Math.max(monitor.sfxPeak, sfx.meter().peak);
      monitor.musicPeak = Math.max(monitor.musicPeak, music.meter().peak);
    }
  }
  requestAnimationFrame(watch);

  const api = {
    sfx, music, settings, actions, monitor,
    attach(s) { sim = s; },
    event,
    // tests (and a page with autoplay allowed) can start sound without a gesture
    unlock() { gesture(); },
    get unlocked() { return unlocked; },
  };
  if (typeof window !== 'undefined') window.__audio = api;
  return api;
}

const noop = { attach() {}, event() {} };
let made = noop;
try { made = createGameAudio(); } catch (e) { console.warn('[audio] off:', e.message); }
export const gameAudio = made;
