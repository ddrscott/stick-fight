// The music player, after cf-quarry's: one track at a time through Strudel. Strudel is an
// 850 KB bundle (vendor/strudel.mjs, @strudel/web 1.3.0, AGPL-3.0, unmodified), so it's
// imported the first time music is turned on and never otherwise.
//
// A track plays its form PLAYS times, then the next one in the current pool starts (the
// pool follows the game: fight, horde, calm). The volume is a gain on the node Strudel
// sums everything into, squared so the slider feels even; duck() dips it under the KO
// stingers, pump() gives it a quick sidechain-style dip under a hit so the hit isn't
// fighting the music for the same moment. level() reads a meter on the same node.
//
// While a track plays, a silent <audio> loops beside it so a phone shows its media player
// (navigator.mediaSession, set up in index.js): Strudel's Web Audio alone doesn't count,
// and Chrome ignores anything under five seconds as a blip.
import { TRACKS, poolOf } from './tracks.js';

// Strudel ships as a prebuilt ESM bundle in public/vendor/, copied verbatim into the build, and
// is imported at runtime by URL so Vite leaves it (and its own relative asset URLs) alone.
const BUNDLE = new URL('vendor/strudel.mjs', document.baseURI).href;
export const PLAYS = 2;

export function createMusic({ tracks = TRACKS } = {}) {
  const state = {
    playing: false, loading: false, loaded: false,
    track: 0, volume: 0.55, pool: 'fight',
    error: null, started: 0,
  };
  let strudel = null, repl = null, loading = null;
  let analyser = null, samples = null, tapped = null;
  let generation = 0, onward = null;
  let media = null, pausing = false;
  let duckUntil = 0, duckTimer = null;
  const changed = () => player.onChange && player.onChange(state);

  async function load() {
    if (strudel) return strudel;
    if (!loading) {
      state.loading = true; changed();
      loading = (async () => {
        const mod = await import(/* @vite-ignore */ BUNDLE);
        repl = await mod.initStrudel({ onEvalError: (err) => fail(err) });
        // initStrudel waits for a click to load its worklets (supersaw, distort live there),
        // and the click that fetched it is spent: ask now.
        await mod.initAudio();
        strudel = mod; state.loaded = true;
        return mod;
      })().finally(() => { state.loading = false; loading = null; });
    }
    return loading;
  }
  function fail(err) {
    state.error = String((err && err.message) || err);
    state.playing = false; quiet(); changed();
    console.warn('[music]', state.error);
  }

  const out = () => strudel && strudel.getSuperdoughAudioController().output.destinationGain;
  const level0 = () => state.volume * state.volume;
  // stop whatever the gain is doing and hold it where it is (Firefox lacks cancelAndHold)
  function hold(p, now) {
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(now);
    else { const v = p.value; p.cancelScheduledValues(now); p.setValueAtTime(v, now); }
  }
  function apply() {
    const node = out();
    if (!node) return;
    const c = strudel.getAudioContext(), now = c.currentTime;
    hold(node.gain, now);
    node.gain.setTargetAtTime(now < duckUntil ? level0() * 0.3 : level0(), now, 0.03);
    if (tapped !== node) {
      analyser = analyser || new AnalyserNode(c, { fftSize: 1024 });
      samples = samples || new Float32Array(analyser.fftSize);
      node.connect(analyser); tapped = node;
    }
  }
  // dip the music to `depth` of its level for `seconds`, then bring it back
  function duck(depth = 0.35, seconds = 0.8) {
    const node = out();
    if (!node || !state.playing) return;
    const c = strudel.getAudioContext(), now = c.currentTime;
    duckUntil = Math.max(duckUntil, now + seconds);
    hold(node.gain, now);
    node.gain.setTargetAtTime(level0() * depth, now, 0.02);
    node.gain.setTargetAtTime(level0(), duckUntil, 0.25);
    clearTimeout(duckTimer);
    duckTimer = setTimeout(() => { duckUntil = 0; }, (duckUntil - now) * 1000 + 50);
  }
  // A hit's dip: down to `depth` of the level in 10 ms, held for `holdFor` seconds, then back
  // over about `release` seconds (95% there). A deeper dip already under way isn't made
  // shallower, and a duck (the KO's) wins outright.
  function pump(depth = 0.6, holdFor = 0.04, release = 0.25) {
    const node = out();
    if (!node || !state.playing) return;
    const c = strudel.getAudioContext(), now = c.currentTime;
    if (now < duckUntil) return;
    const p = node.gain, base = level0(), to = Math.min(p.value, base * depth);
    hold(p, now);
    p.linearRampToValueAtTime(to, now + 0.01);
    p.setTargetAtTime(base, now + 0.01 + holdFor, release / 3);
  }

  function holdMedia() {
    if (typeof Audio === 'undefined') return;
    if (!media) {
      media = new Audio(silence(10));
      media.loop = true;
      media.setAttribute('playsinline', '');
      media.addEventListener('pause', () => {
        if (pausing) { pausing = false; return; }
        if (state.playing) (player.onRemote ? player.onRemote('pause') : stop());
      });
    }
    if (media.paused) media.play().catch(() => {});
  }
  function quiet() { if (!media || media.paused) return; pausing = true; media.pause(); }

  const wrap = (i) => ((i % tracks.length) + tracks.length) % tracks.length;
  function nextInPool(from) {
    const pool = poolOf(state.pool);
    if (!pool.length) return wrap(from + 1);
    const k = pool.indexOf(from);
    return pool[(k + 1) % pool.length];
  }

  async function play(index = state.track) {
    const mine = ++generation;
    clearTimeout(onward);
    holdMedia();   // now, inside the gesture: Safari won't start it after an await
    state.track = wrap(index); state.error = null; changed();
    try {
      const mod = await load();
      if (mine !== generation) return;
      // no sound device (headless) never settles this promise, so don't wait forever
      await Promise.race([mod.getAudioContext().resume(), new Promise(r => setTimeout(r, 1000))]);
      mod.hush();   // the clock back to cycle 0: the track starts at the top of its form
      const pattern = await mod.evaluate(tracks[state.track].code);
      if (mine !== generation) return;
      if (!pattern) { quiet(); return; }
      state.playing = true; apply(); state.started++;
      const seconds = tracks[state.track].seconds;
      if (seconds) onward = setTimeout(() => { if (mine === generation) play(nextInPool(state.track)); }, seconds * PLAYS * 1000);
      changed();
    } catch (err) { if (mine === generation) fail(err); }
  }
  function stop() {
    generation++; clearTimeout(onward);
    if (strudel) strudel.hush();
    state.playing = false; quiet(); changed();
  }

  const player = {
    state, tracks,
    onChange: null,   // (state) => void
    onRemote: null,   // ('pause') => void: the phone paused the silent element
    media: () => media,
    play, stop, duck, pump,
    toggle: () => (state.playing || state.loading ? stop() : play()),
    next: () => play(state.track + 1),
    prev: () => play(state.track - 1),
    // the pool for what the game is doing; a track outside it gives way to the pool's first
    setPool(pool, { restart = false } = {}) {
      if (pool === state.pool && !restart) return;
      state.pool = pool;
      const list = poolOf(pool);
      if (!list.length) return;
      const target = restart ? nextInPool(state.track) : list.includes(state.track) ? state.track : list[0];
      if (target === state.track && !restart) return;
      if (state.playing || state.loading) play(target); else { state.track = target; changed(); }
    },
    // inside a later gesture: wake a context the first one couldn't, and the silent element
    poke() {
      if (strudel) { const c = strudel.getAudioContext(); if (c.state !== 'running') c.resume().catch(() => {}); }
      if (state.playing || state.loading) holdMedia();
    },
    setVolume(v) { state.volume = Math.max(0, Math.min(1, v)); apply(); changed(); },
    cycle: () => (state.playing && repl ? repl.scheduler.now() : 0),
    // loudness now, 0 to 1 (rms * 3) for the meter; peak and rms raw for measuring
    level() { const m = player.meter(); return Math.min(1, m.rms * 3); },
    meter() {
      if (!analyser || !state.playing) return { peak: 0, rms: 0 };
      analyser.getFloatTimeDomainData(samples);
      let peak = 0, sum = 0;
      for (const s of samples) { const a = Math.abs(s); if (a > peak) peak = a; sum += s * s; }
      return { peak, rms: Math.sqrt(sum / samples.length) };
    },
  };
  return player;
}

// ten seconds of silence as a WAV blob URL: 8 kHz, 8 bits, mono
function silence(seconds) {
  const n = 8000 * seconds;
  const wav = new DataView(new ArrayBuffer(44 + n));
  const text = (at, s) => [...s].forEach((c, i) => wav.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); wav.setUint32(4, 36 + n, true); text(8, 'WAVEfmt ');
  wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
  wav.setUint32(24, 8000, true); wav.setUint32(28, 8000, true); wav.setUint16(32, 1, true); wav.setUint16(34, 8, true);
  text(36, 'data'); wav.setUint32(40, n, true);
  for (let i = 0; i < n; i++) wav.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
}
