// The soundtrack: Strudel programs for a neon night office, played by music.js. They use
// only Strudel's built-in synths (sine, square, sawtooth, triangle, supersaw, the noises,
// and its sbd kick), so nothing is fetched to play them and they sound the same offline.
// The structure is borrowed from cf-quarry's tracks.js.
//
// Each `code` is REPL code: strudel.cc runs any of them pasted as-is, and that's the place
// to work on one. setcpm sets the tempo in cycles a minute, four beats to a cycle, so
// 128 bpm is setcpm(128/4). A track's postgain sets it against the others; the music
// slider sits after it.
//
// What they share. Every track is in a minor key of its own, moves through the same eight
// changes (ROOTS, CHORDS: i VI VII i, iv VI VII v), and carries the game's theme (THEME)
// somewhere: a sawtooth lead in one, a square in another, an FM bell in the calm one. The
// fast tracks play the theme and the changes at half speed so the tune stays readable.
//
// How they're long. Each track has a form, sections in order as [name, cycles]: an intro
// (`in`) of texture, `a` with the drums and bass, `b` where the theme comes in, a `drop`
// with no drums, and `c` with everything. A layer plays only in the sections its mask is
// on for (on("a b c") writes out a mask like "<0!8 1!40 0!8 1!16>"), so the pasted code is
// the whole piece. music.js plays a track's form twice, then the next in its pool.
//
// Pools: `fight` for a normal match, `horde` for horde mode, `calm` for training (a dummy
// that doesn't fight back), `menu` for the title, the menus, the attract demo, the high
// score tables, game over and the ending (the arcade flow picks it, see index.js). A track can sit in more than one ("fight horde"). In horde mode
// each cleared floor moves to the next track in the pool. N walks the whole list.

// The theme, in scale degrees: a call that punches twice, an answer that reaches higher,
// a fall home, and a bar of rest. Four cycles.
export const THEME = `"<[0 ~ 0 ~ 3 ~ 0 ~ ~ 5 ~ 4 ~ 3 ~ ~] [0 ~ 0 ~ 3 ~ 0 ~ ~ 7 ~ 6 ~ 5 4 ~] [4 ~ 3 ~ 2 ~ 0 ~ ~ -1 ~ 0 ~ ~ ~ ~] ~>"`;
// The changes, one a cycle: i VI VII i, then iv VI VII v. ROOTS for the bass, CHORDS the
// triads built on them.
export const ROOTS = `"<0 5 6 0 3 5 6 4>"`;
export const CHORDS = `"<[0,2,4] [5,7,9] [6,8,10] [0,2,4] [3,5,7] [5,7,9] [6,8,10] [4,6,8]>"`;

// A pattern above at a k-th of its speed, for the faster tracks: "<...>/2".
export const per = (pat, k) => (k === 1 ? pat : pat.replace(/"$/, `/${k}"`));

function track({ name, mood, bpm, pool, form, body }) {
  const on = (names) => {
    const want = names.split(' ');
    const runs = [];
    for (const [section, cycles] of form) {
      const bit = want.includes(section) ? 1 : 0;
      if (runs.length && runs[runs.length - 1][0] === bit) runs[runs.length - 1][1] += cycles;
      else runs.push([bit, cycles]);
    }
    return `"<${runs.map(([bit, n]) => (n === 1 ? `${bit}` : `${bit}!${n}`)).join(' ')}>"`;
  };
  const cycles = form.reduce((sum, [, n]) => sum + n, 0);
  const sections = form.map(([s, n]) => `${s} ${n}`).join(', ');
  return {
    name, mood, bpm, pool, form,
    seconds: (cycles * 4 * 60) / bpm,   // one pass through the form
    code: `// ${name}: ${mood}. ${bpm} bpm; the form is ${sections}.
setcpm(${bpm}/4)
${body(on)}`,
  };
}

export const TRACKS = [
  track({
    name: 'Overtime',
    mood: 'darksynth, a galloping bass and a sawtooth lead',
    bpm: 128,
    pool: 'fight',
    form: [['in', 8], ['a', 16], ['b', 16], ['drop', 8], ['c', 16]],
    body: (on) => `stack(
  s("sbd*4").decay(.35).penv(28).distort("0.5:.85").gain(.95).mask(${on('a b c')}),
  s("white").struct("~ x ~ x").decay(.18).sustain(0).bpf(1800).bpq(.7).distort("0.4:.85").gain(.38).room(.3).mask(${on('a b c')}),
  s("white").struct("[~ x]*4").decay(.09).sustain(0).hpf(7000).gain(.22).mask(${on('in a b c')}),
  s("white*16").decay(.02).sustain(0).hpf(10000).gain("[.1 .05]*8").mask(${on('b c')}),
  n(${per(ROOTS, 2)}).scale("A1:minor").s("sawtooth").struct("[~ x x x]*4")
    .decay(.11).sustain(0).lpf(sine.range(300, 1400).slow(8)).lpq(7).lpenv(2).lpdecay(.08)
    .distort("1.1:.6").gain(.4).mask(${on('in a b c')}),
  n(${per(ROOTS, 2)}).scale("A1:minor").s("sine").struct("x*4").decay(.25).sustain(0).gain(.4).mask(${on('a b c')}),
  n(${per(CHORDS, 2)}).scale("A3:minor").s("supersaw").unison(5).spread(.7).detune(.2)
    .struct("x ~ ~ x ~ ~ x ~ ~ ~ x ~ ~ x ~ ~").decay(.22).sustain(.1).release(.15).lpf(2400)
    .gain(.2).room(.35).orbit(2).mask(${on('a b c')}),
  n(${per(CHORDS, 2)}).scale("A2:minor").s("supersaw").unison(3).detune(.25)
    .attack(1).release(2).lpf(900).gain(.15).room(.7).roomsize(6).orbit(2).mask(${on('in drop')}),
  n(${per(THEME, 2)}).scale("A4:minor").s("sawtooth")
    .attack(.01).decay(.3).sustain(.35).release(.25).lpf(2600).lpq(3)
    .delay(.35).delaytime(.3516).delayfeedback(.4).gain(.2).room(.4).orbit(2).mask(${on('b drop c')})
).postgain(0.72)`,
  }),
  track({
    name: 'Floor 37',
    mood: 'synthwave, gated chords and an arpeggio under the city lights',
    bpm: 120,
    pool: 'fight',
    form: [['in', 8], ['a', 16], ['b', 16], ['drop', 8], ['c', 16]],
    body: (on) => `stack(
  s("sbd*4").decay(.3).penv(24).gain(.9).mask(${on('a b c')}),
  s("white").struct("~ x ~ x").decay(.25).sustain(0).bpf(1500).bpq(.6).gain(.4).room(.6).roomsize(5).mask(${on('a b c')}),
  s("white").struct("[~ x]*4").decay(.07).sustain(0).hpf(8000).gain(.2).mask(${on('a b c')}),
  n(${per(ROOTS, 2)}).scale("E1:minor").s("sawtooth").struct("x*8")
    .decay(.15).sustain(.1).lpf(700).lpenv(1.5).lpdecay(.1).gain(.45).mask(${on('a b c')}),
  n("0 2 4 7 4 2 4 7".fast(2).add(${per(ROOTS, 2)})).scale("E4:minor").s("square")
    .decay(.08).sustain(0).lpf(sine.range(1200, 3200).slow(16)).delay(.3).delaytime(.375).delayfeedback(.35)
    .gain(.12).pan(sine.range(.3, .7).slow(4)).orbit(2).mask(${on('in a c')}),
  n(${per(CHORDS, 2)}).scale("E3:minor").s("supersaw").unison(5).spread(.8).detune(.2)
    .struct("[x ~]*8").decay(.1).sustain(.3).release(.1).lpf(1800).gain(.16).room(.4).orbit(2).mask(${on('b c')}),
  n(${per(CHORDS, 2)}).scale("E3:minor").s("sawtooth").attack(.8).release(1.6).lpf(1100)
    .gain(.14).room(.7).roomsize(6).orbit(2),
  n(${per(THEME, 2)}).scale("E5:minor").s("sine").fm(2).fmh(2.01).decay(.5).sustain(0).release(.4)
    .delay(.4).delaytime(.375).delayfeedback(.45).room(.6).gain(.24).orbit(2).mask(${on('b drop')}),
  n(${per(THEME, 2)}).scale("E4:minor").s("sawtooth").attack(.02).decay(.4).sustain(.3).release(.3)
    .lpf(2000).lpq(2).delay(.35).delaytime(.375).delayfeedback(.4).gain(.2).room(.4).orbit(2).mask(${on('c')})
).postgain(0.75)`,
  }),
  track({
    name: 'Freight Elevator',
    mood: 'half-time, a distorted bass and a crushed snare',
    bpm: 72,
    pool: 'fight',
    form: [['in', 4], ['a', 8], ['b', 8], ['drop', 4], ['c', 8]],
    body: (on) => `stack(
  s("sbd ~ ~ ~ ~ ~ sbd ~ ~ ~ sbd ~ ~ ~ ~ ~").decay(.6).penv(40).distort("0.8:.75").gain(.95).mask(${on('a b c')}),
  s("white").struct("~ ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~").decay(.3).sustain(0).bpf(900).bpq(.4)
    .distort("1:.7").gain(.5).room(.5).roomsize(4).mask(${on('a b c')}),
  s("white*16").decay(.03).sustain(0).hpf(8500).gain("[.16 .06 .1 .06]*4").mask(${on('in a b c')}),
  n(${ROOTS}).scale("D1:minor").s("sawtooth").struct("x ~ ~ x ~ ~ x ~ x ~ ~ ~ x ~ x ~")
    .decay(.4).sustain(.3).release(.1).lpf(sine.range(180, 1000).slow(8)).lpq(7)
    .distort("1.4:.55").gain(.4).mask(${on('a b c')}),
  n(${ROOTS}).scale("D1:minor").s("sine").struct("x ~ ~ ~ ~ ~ x ~ ~ ~ x ~ ~ ~ ~ ~").release(.4).gain(.5).mask(${on('a b c')}),
  n(${CHORDS}).scale("D3:minor").s("sawtooth").attack(.6).release(1.4).lpf(800)
    .gain(.14).room(.7).roomsize(7).orbit(2),
  n(${THEME}).scale("D3:minor").s("sawtooth")
    .attack(.03).decay(.4).sustain(.3).release(.4).lpf(1200).lpq(3).distort("0.6:.8")
    .delay(.4).delaytime(.625).delayfeedback(.45).gain(.2).room(.4).orbit(2).mask(${on('b c')}),
  n(${THEME}).scale("D5:minor").s("sine").fm(3).fmh(3.01).decay(.5).sustain(0)
    .room(.8).roomsize(7).delay(.5).delaytime(.625).delayfeedback(.55).gain(.18).orbit(2).mask(${on('in drop')})
).postgain(0.77)`,
  }),
  track({
    name: 'Hard Reboot',
    mood: 'darksynth, an offbeat bass and stabs through a delay',
    bpm: 136,
    pool: 'fight horde',
    form: [['in', 8], ['a', 16], ['b', 16], ['drop', 8], ['c', 16]],
    body: (on) => `stack(
  s("sbd*4").decay(.4).penv(32).distort("0.7:.8").gain(.95).mask(${on('a b c')}),
  s("white").struct("~ x ~ x").decay(.16).sustain(0).bpf(1600).bpq(.9).distort("0.6:.8").gain(.34).room(.25).mask(${on('a b c')}),
  s("white").struct("[~ x]*4").decay(.12).sustain(0).hpf(6000).gain(.24).mask(${on('a b c')}),
  s("white*16").decay(.025).sustain(0).hpf(9500).gain("[.07 .13]*8").mask(${on('in b c')}),
  n(${per(ROOTS, 2)}).scale("G1:minor").s("sawtooth").struct("[~ x]*4")
    .decay(.15).sustain(0).lpf(perlin.range(300, 1500).slow(4)).lpq(8).distort("1.2:.6").gain(.45).mask(${on('in a b c')}),
  n(${per(ROOTS, 2)}).scale("G1:minor").s("sine").struct("x*4").decay(.2).sustain(0).gain(.35).mask(${on('a b c')}),
  n(${per(CHORDS, 2)}).scale("G3:minor").s("sawtooth").struct("~ ~ x ~ ~ ~ x ~ ~ ~ x ~ ~ ~ ~ x")
    .decay(.18).sustain(0).lpf(1700).lpq(3).delay(.45).delaytime(.33).delayfeedback(.5)
    .gain(.22).orbit(2).room(.3).mask(${on('a b c')}),
  n(${per(CHORDS, 2)}).scale("G2:minor").s("supersaw").unison(3).detune(.3)
    .attack(1).release(2).lpf(850).gain(.15).room(.7).roomsize(7).orbit(2).mask(${on('drop')}),
  n(${per(THEME, 2)}).scale("G4:minor").s("square")
    .attack(.01).decay(.2).sustain(.25).release(.2).lpf(2400)
    .delay(.4).delaytime(.33).delayfeedback(.45).gain(.16).room(.4).orbit(2).mask(${on('b drop c')})
).postgain(0.74)`,
  }),
  track({
    name: 'Cubicle Riot',
    mood: 'horde mode: industrial at a run, a sixteenth-note bass',
    bpm: 152,
    pool: 'horde',
    form: [['in', 8], ['a', 16], ['b', 16], ['drop', 8], ['c', 24]],
    body: (on) => `stack(
  s("sbd*4").decay(.3).penv(30).distort("0.6:.85").gain(.95).mask(${on('a b c')}),
  s("white").struct("~ x ~ [x ~ ~ x]").decay(.14).sustain(0).bpf(1900).bpq(.8).distort("0.5:.8").gain(.36).mask(${on('a b c')}),
  s("white*16").decay(.02).sustain(0).hpf(9500).gain("[.12 .05 .08 .05]*4").mask(${on('in a b c')}),
  n(${per(ROOTS, 2)}).scale("C2:minor").s("sawtooth").struct("x*16")
    .decay(.1).sustain(0).lpf(perlin.range(300, 1800).slow(4)).lpq(9).lpenv(2.5).lpdecay(.07)
    .distort("1.3:.55").gain(.4).mask(${on('in a b c')}),
  n("0 2 4 7 9 7 4 2".fast(2).add(${per(ROOTS, 2)})).scale("C4:minor").s("square")
    .decay(.07).sustain(0).lpf(3000).delay(.3).delaytime(.296).delayfeedback(.35)
    .gain(.11).pan(sine.range(.25, .75).slow(2)).orbit(2).mask(${on('a c')}),
  n(${per(CHORDS, 2)}).scale("C3:minor").s("supersaw").unison(5).spread(.8).detune(.2)
    .struct("[x ~]*8").decay(.08).sustain(.3).release(.08).lpf(2200).gain(.16).room(.35).orbit(2).mask(${on('b c')}),
  n(${per(CHORDS, 2)}).scale("C3:minor").s("supersaw").unison(5).spread(.8).detune(.2)
    .attack(1).release(2).lpf(1000).gain(.15).room(.7).orbit(2).mask(${on('drop')}),
  n(${per(THEME, 2)}).scale("C5:minor").s("sawtooth")
    .attack(.01).decay(.25).sustain(.3).release(.2).lpf(2600).lpq(2)
    .delay(.35).delaytime(.296).delayfeedback(.4).gain(.18).room(.4).orbit(2).mask(${on('b drop c')})
).postgain(0.72)`,
  }),
  track({
    name: 'Nightwatch',
    mood: 'calm: pads, rain on the glass and the theme on a bell',
    bpm: 60,
    pool: 'calm',
    form: [['in', 4], ['a', 8], ['b', 8], ['drop', 4], ['c', 8]],
    body: (on) => `stack(
  n(${CHORDS}).scale("F3:minor").s("sawtooth")
    .attack(1.5).release(3).lpf(sine.range(300, 1200).slow(32)).lpq(2).room(.8).roomsize(6).gain(.22),
  n(${CHORDS}).scale("F2:minor").s("supersaw").unison(3).detune(.2)
    .attack(2).release(3).lpf(600).gain(.1).room(.8).orbit(2).mask(${on('b c')}),
  n(${ROOTS}).scale("F1:minor").s("sine").attack(.6).release(2).gain(.35).mask(${on('a b c')}),
  n(${THEME}).scale("F5:minor").s("sine").fm(2).fmh(2.01).decay(.7).sustain(0).release(.6)
    .delay(.5).delaytime(.75).delayfeedback(.55).room(.9).roomsize(8).gain(.2).pan(.6).orbit(2).mask(${on('b c')}),
  n("<0 ~ 4 ~ 2 ~ 6 ~>".add(${ROOTS})).scale("F4:minor").s("triangle")
    .attack(.1).release(1.2).delay(.5).delaytime(.75).delayfeedback(.5)
    .degradeBy(.3).pan(perlin.range(.2, .8)).gain(.2).orbit(2).room(.6).mask(${on('a drop c')}),
  s("white").lpf(2500).hpf(500).attack(4).release(4).gain(.06).slow(4),
  s("brown").lpf(160).attack(2).release(2).gain(.1).slow(4)
).postgain(1.5)`,
  }),
  track({
    name: 'Insert Coin',
    mood: 'title: a cabinet in the lobby, square-wave arpeggios and the theme on a pulse lead',
    bpm: 116,
    pool: 'menu',
    form: [['in', 4], ['a', 8], ['b', 16], ['drop', 4], ['c', 16]],
    body: (on) => `stack(
  s("sbd ~ ~ ~ ~ ~ sbd ~ sbd ~ ~ ~ ~ ~ ~ ~").decay(.25).penv(20).gain(.85).mask(${on('a b c')}),
  s("white").struct("~ x ~ x").decay(.08).sustain(0).bpf(2600).bpq(1.2).crush(5).gain(.3).mask(${on('a b c')}),
  s("white*8").decay(.03).sustain(0).hpf(9000).crush(6).gain("[.12 .06]*4").mask(${on('in a b c')}),
  n(${per(ROOTS, 2)}).scale("B1:minor").s("triangle").struct("x ~ x x ~ x x ~")
    .decay(.18).sustain(.2).release(.05).gain(.55).mask(${on('a b c')}),
  n("0 2 4 7 9 7 4 2".fast(2).add(${per(ROOTS, 2)})).scale("B4:minor").s("square")
    .decay(.06).sustain(0).lpf(3600).crush(8).gain(.1).pan(sine.range(.3, .7).slow(2)).orbit(2).mask(${on('in a b c')}),
  n(${per(CHORDS, 2)}).scale("B3:minor").s("square").struct("x ~ ~ x ~ ~ x ~")
    .decay(.12).sustain(0).lpf(2200).gain(.1).room(.3).orbit(2).mask(${on('b c')}),
  n(${per(CHORDS, 2)}).scale("B2:minor").s("sawtooth").attack(.8).release(1.6).lpf(900)
    .gain(.12).room(.7).roomsize(6).orbit(2).mask(${on('in drop')}),
  n(${per(THEME, 2)}).scale("B4:minor").s("square")
    .attack(.005).decay(.15).sustain(.4).release(.1).lpf(3200).vib(5).vibmod(.12)
    .delay(.25).delaytime(.3879).delayfeedback(.3).gain(.15).room(.3).orbit(2).mask(${on('b c')}),
  n(${per(THEME, 2)}).scale("B5:minor").s("sine").fm(2).fmh(2.01).decay(.4).sustain(0)
    .delay(.4).delaytime(.3879).delayfeedback(.45).room(.6).gain(.16).orbit(2).mask(${on('drop')})
).postgain(0.78)`,
  }),
];

export const poolOf = (pool) => TRACKS.map((t, i) => (t.pool.split(' ').includes(pool) ? i : -1)).filter(i => i >= 0);
