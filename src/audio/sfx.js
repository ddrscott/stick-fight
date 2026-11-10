// Sound effects for the fight, made on the spot from a second of white noise and a few
// oscillators: no sample files. Every effect is a small graph (a source or three, a filter,
// an envelope) that stops itself and is disconnected when its last source ends.
//
//   voice -> stereo pan -> bus -> compressor -> limiter -> volume -> soft clip -> speakers
//   impact voice -> stereo pan -> punch bus ---------^
//
// The compressor evens a horde fight out (with its makeup gain it also lifts the quiet
// effects: whooshes, steps, notes). Impacts (hits, the counter's ping, wall splats and
// bounces, the ground bounce) skip it on a bus of their own, staged so a jab sits well
// under a heavy and an ender: through the compressor they all came out at the same peak,
// a jab as loud as a KO. The limiter catches the peaks of both, and the soft clip after
// the volume is the last word: nothing leaves above 1.0. At most
// MAX_VOICES effects sound at once; a new one steals the oldest of the lowest priority,
// or is dropped if everything playing matters more (footsteps go first).
//
// It has its own AudioContext, made on the first sound, separate from the music's. The
// browser holds it suspended until the page has been touched (index.js unlocks it).
// createSfx({ context }) renders into any BaseAudioContext instead, which is how the
// effects are measured offline.

const MAX_VOICES = 16;
const PUNCH = 0.45;
// priorities: what gets dropped when the voices run out
const P = { step: 0, air: 1, land: 1, block: 2, combo: 2, hit: 3, body: 3, ui: 4, sting: 5 };

const vary = (v, by = 0.12) => v * (1 + (Math.random() * 2 - 1) * by);
const semis = (n) => 2 ** (n / 12);

export function createSfx({ context = null, destination = null } = {}) {
  const state = { volume: 0.8, enabled: true };
  let ctx = null, bus = null, punch = null, master = null, analyser = null, noise = null, samples = null;
  const voices = [];

  function build(c) {
    ctx = c;
    bus = new GainNode(c, { gain: 1 });
    const comp = new DynamicsCompressorNode(c, { threshold: -20, knee: 8, ratio: 4, attack: 0.003, release: 0.15 });
    const limiter = new DynamicsCompressorNode(c, { threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.08 });
    // the impacts' trim: a jab peaks near -8 dBFS, a heavy near -5, enders and KOs at the limiter
    punch = new GainNode(c, { gain: PUNCH });
    master = new GainNode(c, { gain: state.volume * state.volume });
    // tanh past 0.7: transparent below, and a hard ceiling at 1.0 above
    const clip = new WaveShaperNode(c, { curve: softClip(), oversample: 'none' });
    bus.connect(comp).connect(limiter).connect(master).connect(clip).connect(destination || c.destination);
    punch.connect(limiter);
    analyser = new AnalyserNode(c, { fftSize: 1024 });
    samples = new Float32Array(analyser.fftSize);
    clip.connect(analyser);
    noise = new AudioBuffer({ length: c.sampleRate, sampleRate: c.sampleRate });
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function ensure() {
    if (!ctx) {
      if (context) build(context);
      else {
        const AC = typeof AudioContext !== 'undefined' ? AudioContext : typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null;   // eslint-disable-line no-undef
        if (!AC) return null;
        build(new AC({ latencyHint: 'interactive' }));
      }
    }
    return ctx;
  }
  const apply = () => { if (master) master.gain.setTargetAtTime(state.volume * state.volume, ctx.currentTime, 0.02); };

  // ---- voices ---------------------------------------------------------------------------
  function prune(now) {
    for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end <= now) voices.splice(i, 1);
  }
  function kill(v, now) {
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setTargetAtTime(0, now, 0.006);
    for (const s of v.srcs) { try { s.stop(now + 0.04); } catch (e) { /* already stopped */ } }
    v.end = now;
  }
  // A voice: a gain and a pan that its sources feed. pan -1 (left) to 1 (right). impact
  // puts it on the punch bus, past the compressor.
  function voice(pri, dur, pan = 0, gain = 1, impact = false) {
    if (!state.enabled || state.volume <= 0) return null;
    const c = ensure();
    if (!c || (c.state && c.state !== 'running' && !context)) return null;   // still locked: nothing to hear
    const now = c.currentTime;
    prune(now);
    if (voices.length >= MAX_VOICES) {
      let k = -1;
      for (let i = 0; i < voices.length; i++) {
        const v = voices[i];
        if (v.pri > pri) continue;
        if (k < 0 || v.pri < voices[k].pri || (v.pri === voices[k].pri && v.start < voices[k].start)) k = i;
      }
      if (k < 0) { stats.dropped++; return null; }
      kill(voices.splice(k, 1)[0], now);
      stats.stolen++;
    }
    const g = new GainNode(c, { gain });
    const p = new StereoPannerNode(c, { pan: Math.max(-1, Math.min(1, pan || 0)) });
    g.connect(p).connect(impact ? punch : bus);
    const v = { t: now + 0.005, start: now, end: now + dur + 0.08, pri, gain: g, pan: p, srcs: [], live: 0 };
    voices.push(v);
    stats.played++;
    return v;
  }
  function track(v, src) {
    v.srcs.push(src); v.live++;
    src.onended = () => { if (--v.live === 0) { v.gain.disconnect(); v.pan.disconnect(); v.srcs.length = 0; } };
  }

  // Filtered noise. filter: lowpass | bandpass | highpass; f [from, to] sweeps over the burst.
  // drive > 0 runs it through a tanh shaper (the crunch in a heavy hit).
  function hiss(v, { at = 0, dur = 0.08, filter = 'bandpass', f = 1000, q = 1, gain = 0.5, attack = 0.002, drive = 0 }) {
    const t = v.t + at;
    const src = new AudioBufferSourceNode(ctx, { buffer: noise, loop: true, playbackRate: vary(1, 0.05) });
    const [f0, f1] = Array.isArray(f) ? f : [f, f];
    const bq = new BiquadFilterNode(ctx, { type: filter, frequency: f0, Q: q });
    if (f1 !== f0) { bq.frequency.setValueAtTime(f0, t); bq.frequency.exponentialRampToValueAtTime(f1, t + dur); }
    const env = new GainNode(ctx, { gain: 0 });
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    let head = src.connect(bq);
    if (drive) head = head.connect(new WaveShaperNode(ctx, { curve: shaper(drive), oversample: '2x' }));
    head.connect(env).connect(v.gain);
    src.start(t, Math.random() * 0.8);
    src.stop(t + dur + 0.03);
    track(v, src);
  }
  // An oscillator gliding from f0 to f1: thumps, booms, pings, synth notes. A chord is
  // several. lp puts a lowpass on it (a number, or [from, to] to sweep it).
  function tone(v, { at = 0, dur = 0.1, type = 'sine', f = [200, 60], gain = 0.4, attack = 0.003, hold = 0, lp = 0, q = 0.8, detune = 0, glide = 'exp', drive = 0 }) {
    const t = v.t + at;
    const [f0, f1] = Array.isArray(f) ? f : [f, f];
    const osc = new OscillatorNode(ctx, { type, frequency: f0, detune });
    if (f1 !== f0) {
      osc.frequency.setValueAtTime(f0, t + hold);
      if (glide === 'exp') osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
      else osc.frequency.linearRampToValueAtTime(f1, t + dur);
    }
    const env = new GainNode(ctx, { gain: 0 });
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    if (hold) env.gain.setValueAtTime(gain, t + attack + hold);
    env.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    let head = osc;
    if (lp) {
      const [l0, l1] = Array.isArray(lp) ? lp : [lp, lp];
      const bq = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: l0, Q: q });
      if (l1 !== l0) { bq.frequency.setValueAtTime(l0, t); bq.frequency.exponentialRampToValueAtTime(l1, t + dur); }
      head = head.connect(bq);
    }
    if (drive) head = head.connect(new WaveShaperNode(ctx, { curve: shaper(drive), oversample: '2x' }));
    head.connect(env).connect(v.gain);
    osc.start(t);
    osc.stop(t + dur + 0.03);
    track(v, osc);
  }
  // a stab of detuned saws: the synth hits and stingers
  function stab(v, freqs, { at = 0, dur = 0.5, gain = 0.2, lp = [4000, 500], drop = 1, type = 'sawtooth', attack = 0.004, q = 2 }) {
    for (const fr of freqs) for (const dt of [-9, 9]) tone(v, { at, dur, type, f: [fr, fr * drop], gain: gain / freqs.length, attack, lp, q, detune: dt, glide: 'exp' });
  }

  // ---- the effects ----------------------------------------------------------------------
  // A strike leaving: air past the limb. Punches short and high, kicks longer and lower,
  // the big spinning enders longest. move is a FRAME_DATA name, limb 'hand' | 'foot'.
  function whoosh({ move = 'jab', limb = 'hand', pan = 0, gassed = false } = {}) {
    let d = 0.1, f0 = 1400, f1 = 2800, g = 0.2;
    if (move === 'jab' || move === 'lowJab') { d = 0.085; f0 = 1600; f1 = 3200; g = 0.16; }
    else if (limb === 'hand') { d = 0.13; f0 = 1100; f1 = 2400; g = 0.22; }
    if (move === 'uppercut' || move === 'risingUppercut') { d = 0.16; f0 = 800; f1 = 2600; g = 0.24; }
    if (limb === 'foot') { d = 0.19; f0 = 600; f1 = 1400; g = 0.26; }
    if (move === 'sweep' || move === 'lowKick') { d = 0.17; f0 = 450; f1 = 1000; g = 0.24; }
    if (/roundhouse|spin|crescent|tornado|Roundhouse|Heel|Spike|comet|Comet|overhead/.test(move)) { d = 0.25; f0 = 420; f1 = 1150; g = 0.3; }
    if (move === 'throw' || move === 'wallSlam') { d = 0.1; f0 = 900; f1 = 1600; g = 0.12; }
    if (gassed) { d *= 1.25; g *= 0.7; }
    d = vary(d, 0.1); f0 = vary(f0); f1 = vary(f1);
    const v = voice(P.air, d, pan * 0.8, 1.6);
    if (!v) return;
    hiss(v, { dur: d, filter: 'bandpass', f: [f0, f1], q: 1.4, gain: g, attack: d * 0.45 });
    hiss(v, { at: d * 0.3, dur: d * 0.7, filter: 'bandpass', f: [f1, f0 * 0.8], q: 2, gain: g * 0.6, attack: d * 0.15 });
  }
  // A hit, in layers, all scaled by its weight w (0 a flick, ~0.35 a jab, ~0.5 a cross,
  // ~0.85 a heavy, 0.95 a counter, 1 an ender or a KO):
  //   crack  a few ms of bright noise and a square blip: the contact, what makes it land
  //   punch  a triangle falling through 300 -> 120 Hz: the body a phone speaker can play,
  //          which implies the low end it can't
  //   sub    a sine falling into 40-55 Hz: the thump in the chest on headphones
  //   crunch heavies only: mid noise and a low square through a tanh shaper, the grit
  //   tail   lowpassed noise, longer as it gets heavier
  // boom adds a long low drop under it (enders, KOs). Light hits stay short (~0.15 s) so
  // a fast string doesn't smear.
  function hit({ heavy = false, strength = 0.5, pan = 0, limb = 'hand', weight = null, boom = false, snap = false } = {}) {
    const s = Math.max(0, Math.min(1, strength));
    const w = Math.max(0, Math.min(1, weight != null ? weight : heavy ? 0.72 + 0.18 * s : 0.15 + 0.45 * s));
    const foot = limb === 'foot';
    const d = 0.08 + 0.22 * w;
    const v = voice(P.hit, d + (boom ? 0.75 : 0.06), pan, 1.8, true);
    if (!v) return;
    // crack: the hand's is brighter, the foot's a little lower and thicker
    hiss(v, { dur: 0.01 + 0.02 * w, filter: 'highpass', f: vary(foot ? 2300 : 3200), q: 0.7, gain: 0.32 + 0.3 * w, attack: 0.0005 });
    tone(v, { dur: 0.012 + 0.012 * w, type: 'square', f: [vary(1700 - 500 * w), 280], gain: 0.07 + 0.09 * w, attack: 0.0005 });
    // punch
    tone(v, { dur: 0.05 + 0.11 * w, type: 'triangle', f: [vary(320 - 70 * w), 150 - 35 * w], gain: 0.16 + 0.42 * w, attack: 0.001 });
    // sub
    tone(v, { dur: d, f: [vary(165 - 75 * w), 56 - 14 * w], gain: 0.5 + 0.45 * w, attack: 0.002 });
    // tail
    hiss(v, { dur: 0.05 + 0.13 * w, filter: 'lowpass', f: [vary(2800 - 700 * w), 240], q: 0.9, gain: 0.3 + 0.25 * w });
    if (w > 0.6) {
      const g = (w - 0.55) * 0.9;
      hiss(v, { at: 0.002, dur: 0.04 + 0.06 * w, filter: 'bandpass', f: [vary(1500), 700], q: 1.2, gain: g, drive: 4 });
      tone(v, { dur: 0.05 + 0.06 * w, type: 'square', f: [vary(190), 85], gain: g * 0.35, lp: 1600, drive: 3 });
    }
    // snap: a second crack right behind the first (the counter's: caught mid-swing)
    if (snap) hiss(v, { at: 0.016, dur: 0.022, filter: 'bandpass', f: vary(4200, 0.06), q: 1.5, gain: 0.5, attack: 0.0005, drive: 3 });
    if (boom) {
      tone(v, { at: 0.006, dur: 0.7, f: [vary(64, 0.04), 26], gain: 0.75, attack: 0.004 });
      // its harmonic, so a phone hears the drop too
      tone(v, { at: 0.006, dur: 0.32, type: 'triangle', f: [vary(150, 0.04), 62], gain: 0.3, attack: 0.004, lp: 900 });
      hiss(v, { at: 0.01, dur: 0.5, filter: 'lowpass', f: [1400, 90], q: 0.8, gain: 0.3, attack: 0.006 });
    }
  }
  // A blocked strike: a dull guarded thud and a short clack, nothing bright.
  function block({ strength = 0.5, pan = 0 } = {}) {
    const s = Math.max(0.3, Math.min(1, strength));
    const v = voice(P.block, 0.12, pan, 2.2);
    if (!v) return;
    hiss(v, { dur: 0.09, filter: 'lowpass', f: vary(520), q: 0.8, gain: 0.5 * s });
    tone(v, { dur: 0.075, type: 'triangle', f: [vary(220), 120], gain: 0.4 * s });
    hiss(v, { at: 0.004, dur: 0.028, filter: 'bandpass', f: vary(3200, 0.08), q: 9, gain: 0.55 * s });
    hiss(v, { at: 0.016, dur: 0.022, filter: 'bandpass', f: vary(2100, 0.08), q: 9, gain: 0.25 * s });
  }
  // A counter hit: the heaviest hit short of an ender, a second snap right behind the
  // first crack (caught mid-swing), and a bright ping over it.
  function counter({ pan = 0, limb = 'hand' } = {}) {
    hit({ weight: 0.95, snap: true, pan, limb });
    const v = voice(P.hit, 0.45, pan * 0.5, 1.4);
    if (!v) return;
    const f = vary(1568, 0.03);
    tone(v, { at: 0.01, dur: 0.38, f, gain: 0.2, attack: 0.002 });
    tone(v, { at: 0.01, dur: 0.26, f: f * 1.5, gain: 0.1, attack: 0.002 });
    tone(v, { at: 0.01, dur: 0.12, type: 'square', f: f * 2, gain: 0.04, lp: 6000 });
    hiss(v, { dur: 0.05, filter: 'highpass', f: 6500, q: 0.7, gain: 0.25 });
  }
  // feet: weight 0 to 1
  // stair: a step on a concrete tread with a steel nosing: a harder, higher knock with a short ring
  function footstep({ weight = 0.4, pan = 0, stair = false } = {}) {
    const v = voice(P.step, stair ? 0.1 : 0.07, pan, 2.2);
    if (!v) return;
    hiss(v, { dur: vary(0.045), filter: 'lowpass', f: vary(stair ? 1500 : 800, 0.25), q: 0.7, gain: 0.07 + 0.1 * weight });
    tone(v, { dur: 0.05, f: [vary(stair ? 170 : 110), stair ? 80 : 55], gain: 0.05 + 0.08 * weight });
    if (stair) tone(v, { dur: 0.08, f: [vary(620, 0.08), 560], gain: 0.025 + 0.03 * weight });
  }
  function land({ weight = 0.4, pan = 0 } = {}) {
    const v = voice(P.land, 0.14, pan, 1.4);
    if (!v) return;
    tone(v, { dur: 0.12, f: [vary(140), 45], gain: 0.25 + 0.4 * weight });
    hiss(v, { dur: 0.1, filter: 'lowpass', f: [vary(1000), 200], q: 0.7, gain: 0.18 + 0.25 * weight });
  }
  function jump({ pan = 0 } = {}) {
    const v = voice(P.step, 0.12, pan, 1.6);
    if (!v) return;
    hiss(v, { dur: 0.05, filter: 'lowpass', f: vary(700), q: 0.7, gain: 0.15 });
    hiss(v, { at: 0.02, dur: 0.1, filter: 'bandpass', f: [500, 1100], q: 1, gain: 0.08, attack: 0.04 });
  }
  // A body hitting the floor: a heavy thud and a short slide along it.
  function bodyFall({ strength = 0.8, pan = 0 } = {}) {
    const s = Math.max(0.3, Math.min(1, strength));
    const v = voice(P.body, 0.45, pan, 1.3);
    if (!v) return;
    tone(v, { dur: 0.32, f: [vary(95), 32], gain: 0.9 * s });
    hiss(v, { dur: 0.26, filter: 'lowpass', f: [vary(900), 120], q: 0.8, gain: 0.55 * s });
    hiss(v, { at: 0.06, dur: vary(0.3), filter: 'bandpass', f: [vary(1000), 450], q: 0.8, gain: 0.16 * s, attack: 0.03 });
  }
  // Wall splat: a slam into the wall and a low boom that hangs. Wall bounce: shorter, with
  // the body coming back off it.
  function wallSplat({ pan = 0 } = {}) {
    const v = voice(P.body, 0.8, pan, 1, true);
    if (!v) return;
    hiss(v, { dur: 0.34, filter: 'lowpass', f: [vary(3400), 180], q: 0.8, gain: 0.8 });
    hiss(v, { dur: 0.05, filter: 'bandpass', f: vary(1800), q: 2, gain: 0.45, attack: 0.001 });
    tone(v, { dur: 0.75, f: [vary(68, 0.05), 27], gain: 0.95 });
    tone(v, { dur: 0.22, type: 'triangle', f: [vary(260), 95], gain: 0.55, attack: 0.001, drive: 2 });   // the slam, in the band a phone plays
    hiss(v, { at: 0.03, dur: 0.4, filter: 'bandpass', f: [2400, 900], q: 3, gain: 0.08, attack: 0.01 });   // the panel rattling
  }
  function wallBounce({ pan = 0 } = {}) {
    const v = voice(P.body, 0.5, pan, 1, true);
    if (!v) return;
    hiss(v, { dur: 0.2, filter: 'lowpass', f: [vary(3000), 220], q: 0.8, gain: 0.7 });
    tone(v, { dur: 0.45, f: [vary(78, 0.05), 34], gain: 0.8 });
    tone(v, { dur: 0.14, type: 'triangle', f: [vary(240), 100], gain: 0.4, attack: 0.001 });
    tone(v, { at: 0.06, dur: 0.14, type: 'triangle', f: [260, 620], gain: 0.12, glide: 'lin' });
  }
  // a light knock of a body against the wall that isn't a trick shot
  function wallKnock({ strength = 0.5, pan = 0 } = {}) {
    const s = Math.max(0.3, Math.min(1, strength));
    const v = voice(P.body, 0.3, pan, 1.5);
    if (!v) return;
    hiss(v, { dur: 0.14, filter: 'lowpass', f: [2400, 200], q: 0.8, gain: 0.5 * s });
    tone(v, { dur: 0.25, f: [vary(85), 38], gain: 0.6 * s });
  }
  function groundBounce({ pan = 0 } = {}) {
    const v = voice(P.body, 0.42, pan, 1, true);
    if (!v) return;
    tone(v, { dur: 0.2, f: [vary(115), 40], gain: 0.85 });
    hiss(v, { dur: 0.14, filter: 'lowpass', f: [vary(1800), 180], q: 0.8, gain: 0.55 });
    tone(v, { at: 0.13, dur: 0.16, f: [vary(130), 50], gain: 0.4 });
    hiss(v, { at: 0.13, dur: 0.08, filter: 'lowpass', f: 1200, q: 0.8, gain: 0.25 });
  }
  // A throw: the grab is a rustle of cloth and a grip; the slam comes when it lands.
  function throwGrab({ pan = 0 } = {}) {
    const v = voice(P.hit, 0.16, pan, 1.6);
    if (!v) return;
    hiss(v, { dur: 0.06, filter: 'bandpass', f: vary(1700), q: 0.7, gain: 0.3, attack: 0.008 });
    hiss(v, { at: 0.05, dur: 0.08, filter: 'bandpass', f: vary(1200), q: 0.7, gain: 0.26, attack: 0.01 });
    tone(v, { dur: 0.06, type: 'triangle', f: [vary(170), 90], gain: 0.3 });
  }
  function throwSlam({ pan = 0 } = {}) {
    hit({ heavy: true, strength: 0.8, pan });
    bodyFall({ strength: 1, pan });
  }
  // A strike that met nothing: thin air falling away.
  function whiff({ pan = 0 } = {}) {
    const v = voice(P.air, 0.16, pan * 0.8, 1.6);
    if (!v) return;
    hiss(v, { dur: vary(0.14), filter: 'bandpass', f: [vary(2600), 900], q: 1.2, gain: 0.08, attack: 0.02 });
  }
  // Gassed: a breathy exhale.
  function gassed({ pan = 0 } = {}) {
    const v = voice(P.combo, 0.6, pan * 0.6);
    if (!v) return;
    hiss(v, { dur: vary(0.55), filter: 'bandpass', f: [1300, 550], q: 1.4, gain: 0.32, attack: 0.07 });
    hiss(v, { dur: 0.45, filter: 'lowpass', f: 600, q: 0.7, gain: 0.14, attack: 0.05 });
    tone(v, { dur: 0.4, type: 'sawtooth', f: [vary(150), 105], gain: 0.05, attack: 0.06, lp: 750, q: 3 });
  }

  // Shaking it off (a fainted fighter's head shake): a quick double flick of air, the head going one way
  // and back, over a small wobbling "brr" that rises a little with each shake of the faint (n).
  function shake({ pan = 0, n = 1 } = {}) {
    const v = voice(P.air, 0.22, pan * 0.7, 1.2);
    if (!v) return;
    hiss(v, { dur: 0.05, filter: 'bandpass', f: [vary(1800), 900], q: 1.6, gain: 0.12, attack: 0.012 });
    hiss(v, { at: 0.07, dur: 0.05, filter: 'bandpass', f: [vary(1500), 800], q: 1.6, gain: 0.1, attack: 0.012 });
    const f0 = 230 * semis(Math.min(7, n - 1));
    tone(v, { dur: 0.16, type: 'triangle', f: [vary(f0, 0.05), f0 * 0.7], gain: 0.07, attack: 0.004, lp: 1400 });
  }

  // ---- stingers: short synth hits ---------------------------------------------------------
  // ROUND n: two low hits, a step higher each round. FIGHT: a bright stab and a crash.
  function round({ n = 1 } = {}) {
    const v = voice(P.sting, 0.9, 0);
    if (!v) return;
    const r = 110 * semis(2 * Math.max(0, Math.min(4, n - 1)));
    stab(v, [r, r * 1.5, r * 2], { dur: 0.32, gain: 0.32, lp: [2600, 400] });
    stab(v, [r, r * 1.5, r * 2], { at: 0.18, dur: 0.55, gain: 0.3, lp: [3000, 300] });
    tone(v, { dur: 0.4, f: [120, 40], gain: 0.6 });
  }
  function fight() {
    const v = voice(P.sting, 1, 0);
    if (!v) return;
    const r = 220;
    stab(v, [r, r * semis(3), r * semis(7), r * 2], { dur: 0.8, gain: 0.42, lp: [6000, 700], q: 3 });
    tone(v, { dur: 0.45, f: [160, 38], gain: 0.85 });
    hiss(v, { dur: 0.7, filter: 'highpass', f: 5000, q: 0.5, gain: 0.25, attack: 0.002 });
    hiss(v, { dur: 0.25, filter: 'lowpass', f: [3000, 300], q: 0.7, gain: 0.35 });
  }
  // KO: a falling minor stab over a boom.
  function ko({ pan = 0 } = {}) {
    hit({ weight: 1, boom: true, pan });
    const v = voice(P.sting, 1.3, 0);
    if (!v) return;
    const r = 110;
    stab(v, [r, r * semis(3), r * semis(7)], { at: 0.03, dur: 1.1, gain: 0.4, lp: [3200, 220], drop: semis(-5) });
    tone(v, { dur: 1.2, f: [82, 28], gain: 0.9 });
    hiss(v, { dur: 1.0, filter: 'lowpass', f: [4500, 250], q: 0.7, gain: 0.35 });
  }
  // The slow-motion ender KO: the same boom pitched down, with a long tail of echoes.
  function slowmoKO({ pan = 0 } = {}) {
    const v = voice(P.sting, 2.9, pan * 0.4);
    if (!v) return;
    const r = 110;
    tone(v, { dur: 0.06, type: 'square', f: [900, 200], gain: 0.15 });
    tone(v, { dur: 2.6, f: [62, 20], gain: 1.0, attack: 0.004 });
    hiss(v, { dur: 2.2, filter: 'lowpass', f: [2600, 70], q: 0.9, gain: 0.55, attack: 0.004 });
    stab(v, [r, r * semis(3), r * semis(7), r / 2], { at: 0.02, dur: 2.4, gain: 0.42, lp: [2400, 120], drop: 0.5 });
    // the tail: the boom coming back off the building, quieter each time
    for (const [at, g] of [[0.42, 0.35], [0.84, 0.18], [1.26, 0.09]]) {
      tone(v, { at, dur: 0.9, f: [50, 22], gain: g });
      hiss(v, { at, dur: 0.6, filter: 'lowpass', f: [900, 90], q: 0.8, gain: g * 0.5 });
    }
  }
  // A combo hit past the first: a short note that climbs with the count (minor pentatonic).
  const PENT = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
  const pent = (k) => 330 * semis(PENT[Math.max(0, Math.min(PENT.length - 1, k))]);
  function combo({ count = 2, pan = 0 } = {}) {
    const v = voice(P.combo, 0.16, pan * 0.4, 3.2);
    if (!v) return;
    const f = pent(count - 2);
    // 15 ms behind the hit and under it, so the crack leads and the note rides after
    tone(v, { at: 0.015, dur: 0.1, type: 'square', f, gain: 0.025, lp: 3200, attack: 0.002 });
    tone(v, { at: 0.015, dur: 0.12, type: 'sawtooth', f: f * 2, gain: 0.014, lp: 4000, detune: 7 });
  }
  // An ender: the rising note, bigger, with its fifth landing on top. It comes in 30 ms
  // after the hit's crack and sits under the impact (index.js plays the hit with a boom).
  function ender({ count = 3, pan = 0 } = {}) {
    const v = voice(P.sting, 0.65, pan * 0.4);
    if (!v) return;
    const f = pent(Math.max(0, count - 1));
    stab(v, [f], { at: 0.03, dur: 0.22, gain: 0.11, lp: [5000, 1200], q: 2 });
    stab(v, [f * semis(7), f * 2], { at: 0.12, dur: 0.45, gain: 0.14, lp: [6000, 900], q: 2 });
    hiss(v, { at: 0.12, dur: 0.35, filter: 'highpass', f: 7000, q: 0.5, gain: 0.08, attack: 0.01 });
  }
  // A horde goon down: a falling bloop and a thud, smaller than a KO.
  function goonDown({ pan = 0 } = {}) {
    hit({ heavy: true, strength: 0.9, pan });
    const v = voice(P.combo, 0.32, pan, 1.3);
    if (!v) return;
    tone(v, { dur: 0.26, type: 'square', f: [vary(660, 0.06), 110], gain: 0.07, lp: 2400 });
    tone(v, { at: 0.02, dur: 0.24, f: [vary(120), 38], gain: 0.5 });
  }
  // match over: a minor arpeggio up, the last note held
  function match({ won = true } = {}) {
    const v = voice(P.sting, 1.3, 0);
    if (!v) return;
    const notes = won ? [0, 3, 7, 12] : [12, 7, 3, 0];
    notes.forEach((n, i) => stab(v, [220 * semis(n)], { at: i * 0.11, dur: i === 3 ? 0.9 : 0.16, gain: 0.24, lp: [4500, 900] }));
  }
  // ---- multi-floor --------------------------------------------------------------------------
  // A floor giving way: a crash of slab and glass, a boom under it, and a railing clanging.
  function floorBreak({ pan = 0, strength = 1 } = {}) {
    const s = Math.max(0.5, Math.min(1, strength));
    const v = voice(P.sting, 1.6, pan * 0.6);
    if (!v) return;
    tone(v, { dur: 1.2, f: [vary(58, 0.05), 22], gain: 1.0 * s });
    hiss(v, { dur: 0.9, filter: 'lowpass', f: [vary(4000), 150], q: 0.7, gain: 0.8 * s });
    // debris: a scatter of short cracks
    for (let i = 0; i < 6; i++) hiss(v, { at: 0.03 + Math.random() * 0.5, dur: vary(0.05, 0.4), filter: 'bandpass', f: vary(1800, 0.5), q: 2, gain: 0.25 * s, attack: 0.001 });
    hiss(v, { at: 0.02, dur: 0.6, filter: 'highpass', f: 5500, q: 0.6, gain: 0.18 * s });   // glass
    // the railing: two inharmonic metal partials, ringing
    const m = vary(420, 0.08);
    for (const [k, g] of [[1, 0.13], [2.76, 0.08], [5.4, 0.04]]) tone(v, { at: 0.08, dur: 1.3, type: 'triangle', f: m * k, gain: g * s, attack: 0.001 });
    tone(v, { at: 0.3, dur: 0.9, type: 'triangle', f: m * 1.19, gain: 0.07 * s, attack: 0.001 });
  }
  // One step of a body tumbling down the stairs: a knock per tread, a little lower each time.
  function tread({ pan = 0, strength = 0.6, n = 0 } = {}) {
    const s = Math.max(0.3, Math.min(1, strength));
    const v = voice(P.body, 0.16, pan, 1.6);
    if (!v) return;
    tone(v, { dur: 0.12, f: [vary(150 * semis(-Math.min(6, n))), 50], gain: 0.55 * s });
    hiss(v, { dur: 0.07, filter: 'lowpass', f: [vary(1600), 250], q: 0.8, gain: 0.35 * s });
    hiss(v, { dur: 0.02, filter: 'bandpass', f: vary(2600), q: 4, gain: 0.18 * s, attack: 0.001 });   // the step's edge
  }
  // a vault over the rail: a push off, then a landing thump
  function vault({ pan = 0 } = {}) {
    const v = voice(P.land, 0.22, pan, 1.3);
    if (!v) return;
    tone(v, { dur: 0.16, f: [vary(120), 40], gain: 0.7 });
    hiss(v, { dur: 0.13, filter: 'lowpass', f: [vary(1400), 200], q: 0.8, gain: 0.4 });
    hiss(v, { dur: 0.03, filter: 'bandpass', f: vary(900), q: 2, gain: 0.2 });
  }
  // a floor cleared: a rising major-ish lift over the minor home, brighter than the KO
  function floorClear() {
    const v = voice(P.sting, 1.2, 0);
    if (!v) return;
    [0, 5, 7, 12].forEach((n, i) => stab(v, [262 * semis(n), 262 * semis(n + 7)], { at: i * 0.09, dur: i === 3 ? 0.8 : 0.14, gain: 0.24, lp: [6000, 1200] }));
    hiss(v, { at: 0.27, dur: 0.6, filter: 'highpass', f: 6000, q: 0.5, gain: 0.12, attack: 0.01 });
    tone(v, { at: 0.27, dur: 0.4, f: [140, 45], gain: 0.5 });
  }
  // the settings panel and the touch layer's small buttons
  function ui(kind = 'click') {
    const v = voice(P.ui, 0.06, 0, 2.5);
    if (!v) return;
    const f = kind === 'on' ? 2400 : kind === 'off' ? 1500 : 2000;
    hiss(v, { dur: 0.028, filter: 'bandpass', f, q: 8, gain: 0.35 });
    tone(v, { dur: 0.035, f: f * 0.9, gain: 0.08 });
  }

  const stats = { played: 0, stolen: 0, dropped: 0 };
  const sfx = {
    state, stats,
    get context() { return ctx; },
    get voices() { prune(ctx ? ctx.currentTime : 0); return voices.length; },
    ensure,
    // resume inside a gesture; resolves true once running (never waits on a stuck device)
    resume() {
      const c = ensure();
      if (!c || !c.resume || c.state === 'running') return Promise.resolve(!!c);
      return Promise.race([c.resume().then(() => true, () => false), new Promise(r => setTimeout(() => r(false), 800))]);
    },
    suspend() { if (ctx && ctx.suspend && ctx.state === 'running') ctx.suspend().catch(() => {}); },
    setVolume(v) { state.volume = Math.max(0, Math.min(1, v)); apply(); },
    setEnabled(on) { state.enabled = !!on; if (!on && ctx) for (const v of voices.splice(0)) kill(v, ctx.currentTime); },
    // the output right now: peak and rms of the last 1024 samples, after the clip
    meter() {
      if (!analyser) return { peak: 0, rms: 0 };
      analyser.getFloatTimeDomainData(samples);
      let peak = 0, sum = 0;
      for (const s of samples) { const a = Math.abs(s); if (a > peak) peak = a; sum += s * s; }
      return { peak, rms: Math.sqrt(sum / samples.length) };
    },
    whoosh, hit, block, counter, footstep, land, jump, bodyFall, wallSplat, wallBounce, wallKnock, groundBounce,
    throwGrab, throwSlam, whiff, gassed, shake, round, fight, ko, slowmoKO, combo, ender, goonDown, match, ui,
    floorBreak, tread, vault, floorClear,
  };
  return sfx;
}

// tanh(drive * x), normalized to peak 1: a little grit at 2, a growl at 5. Cached by drive.
const shapers = new Map();
function shaper(drive) {
  if (!shapers.has(drive)) {
    const n = 1024, curve = new Float32Array(n), k = Math.tanh(drive);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(drive * x) / k; }
    shapers.set(drive, curve);
  }
  return shapers.get(drive);
}

function softClip() {
  const n = 2048, curve = new Float32Array(n), knee = 0.7;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    curve[i] = a <= knee ? x : Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
  }
  return curve;
}
