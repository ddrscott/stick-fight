Live at https://askscottpierce.com/stick-fight

# stick-fight

A browser fighting game. Stick figures animated at Xiao Xiao quality, lit like a modern 2D game.

## Run

```sh
npm install
npm run dev          # Vite on http://localhost:8077/ (also reachable through the dev tunnel)
npm run typecheck    # tsc over src/
```

The game is plain ES modules with canvas 2D for drawing and WebGL for the lighting composite. Vite serves it in development and bundles it for deploys. New modules can be TypeScript (`.ts`) next to the JavaScript ones; `tsconfig.json` has `allowJs` on and `checkJs` off, so add `// @ts-check` to a JS file to type-check it. The demo pages (`demo/*.html`) and the capture tool work against the dev server as before.

## Hosting

The game is a static Cloudflare Worker (no Worker script, assets only) on two zone routes, `askscottpierce.com/stick-fight` and `askscottpierce.com/stick-fight/*`, on the Scott Personal Account. Every other path on askscottpierce.com stays with the main site. `/stick-fight` redirects to `/stick-fight/`, so the page's relative asset paths resolve.

```sh
npm run deploy       # vite build into dist/stick-fight/ (file path = URL path), then wrangler deploy
```

The places that hard-code the `stick-fight` path are `wrangler.jsonc` (routes) and `vite.config.ts` (`outDir`). Vite builds with `base: './'` and the game code uses only relative paths, so it runs the same at `/`, on the dev tunnel and at the subpath. The askscottpierce.com origin is shared by every app on it, so localStorage keys start with `stick-fight-`. The page carries the site's Plausible tag (`data-domain="askscottpierce.com"`), so visits count under the main site by path.

Serving the game publicly ships the vendored Strudel bundle, which is AGPL-3.0, so the game is AGPL-3.0 too (see License and credits).

## Attract mode

Like an arcade cabinet, the page opens on a demo: two CPU fighters play one round on the full arena under the title, a blinking PRESS START (TAP TO PLAY on a touch screen) and a DEMO tag. After the KO a new bout starts under a new seed, so it doesn't repeat. The demo is silent; at most the music keeps playing.

- **Any key, any gamepad button (Start included) or a tap/click starts a game** (the `play` scene: you against the CPU). The key or button that started it is ignored until you let go, so it doesn't throw a punch. Bare modifiers (Shift, Ctrl, Alt, Cmd) don't start it, and neither does the sound button. A first tap also turns the sound on.
- On a touch screen the touch controls stay hidden during the demo and come up when the game starts.
- **Back to the demo:** 30 seconds with no input during a game (play or horde), or when a match ends (after the WINS card).
- Only plain `index.html` does this. Any `?scene=` URL stays on its scene exactly as before (no demo, no timeout), and `?scene=attract` opens the demo on purpose.
- The demo fighters are the CPU at difficulty 10 in its **showcase** flavor (`sim.setAI(i, 1, { style: 'showcase' })`, `src/combat/ai.js`): it keeps spacing at the edge of reach, steps out of pokes and punishes the whiff, reads and guards highs, mids and lows, opens with string starters at all three heights instead of jabs, blocks rather than mashing out of hitstun, keeps its stamina up, jumps in and meets jump-ins with an uppercut or a standing guard, and saves the stairwell for later in the round. The CPU you fight in `play` doesn't use it.

## Controls

Tekken-style, one button per limb, from the fighter's own point of view:

| Key | Button | Limb |
|---|---|---|
| U | 1 | left punch (jab) |
| I | 2 | right punch (cross) |
| J | 3 | left kick |
| K | 4 | right kick (roundhouse) |

- **Move** A/D or arrows. **Hold back** (away from the opponent) to guard: standing guard stops highs and mids, lows go under it. B does the same as holding back.
- **Crouch** S or down. A crouch ducks highs completely; **down-back** guards lows. Mids hit a croucher.
- **Jump** W, **run** Shift (or double-tap forward). **Throw** 1+3 or 2+4; the same press during the grab breaks a throw. Throws can't be guarded, but they whiff on a croucher.
- **In the air:** jump with W (hold a direction for a forward or back jump; you can steer a little in the air), then 1 jump jab, 2 jump cross, 3 flying kick, 4 air roundhouse (knockdown), down+4 dive kick (cuts the jump short). One air attack per jump. Air attacks are overheads: they hit a croucher, so guard them standing. Land a jump-in hit and keep pressing for a ground string; whiff one and you land with a short lag. An uppercut (d+2, or rising 2) meeting a jump-in is a counter hit that launches; a jab stuffs a late one.
- **Crouching:** all four crouch attacks come out of a crouch or a crouch-walk (hold down and forward) without standing up, and you stay down after a low while down is held. d+1, d+1, d+3 is the Low Rush string. On touch, stick down plus a button.
- **Directions:** d+1 low jab, d+2 uppercut (launcher), d+3 low kick, d+4 sweep, f+1 body blow, f+2 lunge cross, f+4 overhead (mid, beats crouch), b+4 spin kick. Release down, then 2 = rising uppercut, 4 = rising knee (both launch).
- **Heights:** high = jab, cross, roundhouse, spin kick, spin heel. Low = low jab, low kick, sweep. Everything else is mid.
- **Stamina** (the thin bar under health): every strike, jump and run spends it; it comes back 0.6s after your last attack, slowly while guarding. Blocking a hit costs half its price. At zero you're **gassed** for 1.2s: slower startups, no run, no enders, 15% more damage taken.
- G toggles horde mode, F1 shows the move list, R resets, P pauses, H shows hitboxes.
- **Sound:** M turns the music on and off, N skips to the next track. The speaker button in the bottom-left corner (on a phone, the speaker button in the touch layer's top-right gutter, under HORDE) opens the sound panel: a SOUND switch for everything, a MUSIC switch, the track playing with NEXT, and MUSIC and EFFECTS volume sliders. The settings are remembered in localStorage (`stickfight-audio`). Browsers keep a page silent until it's touched, so the first tap or key starts the sound (the button pulses until then).
- Gamepad, USB or Bluetooth (any pad the browser reports with the standard mapping: Xbox, PlayStation, 8BitDo, most Android pads): X/Y/A/B = 1/2/3/4, D-pad or left stick moves, L1/L2 guard, R1 throw (1+3), R2 run, Start pause (the move list shows while paused), Select restart, R3 horde. Pressing any button hides the touch controls; touching the screen brings them back. Browsers don't count a pad press as a user gesture, so tap the screen once to turn the sound on.
- Touch devices get a floating stick (down crouches, away guards) and a 2x2 diamond of arcade buttons in the same 1 2 / 3 4 layout plus GUARD (src/touch.js).

### Strings and enders

Press the buttons in rhythm; each press goes in during the previous hit's cancel window, so a string that starts on a hit lands as a true combo.

| Input | Name | Payoff |
|---|---|---|
| 1,1,2 | One-Two | |
| 1,1,1 | Triple Jab | |
| 1,2,4 | One-Two Kick | knockdown |
| 2,3 | Cross Snap | |
| 1,1,2,4 | Flash Roundhouse | knockdown |
| 1,2,3 | Uptown | mid finish |
| 1,2,3,4 | Neon Tornado | launches into a juggle |
| 2,1,4 | Spin Heel | wall splat |
| 3,3,4 | Crescent | knockdown |
| d+1,d+1,d+3 | Low Rush | three lows from a crouch |
| d+3,d+3,4 | Ground Rush | low, low, mid knockdown |
| d+2, then 1,2 in the air, then 4 | Sky Spike | ground bounce, relaunch for one more hit |
| f,f+2 (from a run) | Comet Cross | wall splat near a wall |
| b+4 near a wall | Wall Spin | wall bounce into a juggle |
| throw near a wall | Wall Slam | wall splat |

Trick shots: a **wall splat** sticks the body to the wall for 0.4s, open for one more hit. A **wall bounce** and a **ground bounce** relaunch it. A **counter hit** (hitting someone during their startup) does 35% more damage and stun. If both strikes land on the same frame it's a **trade**: both react. Juggles get heavier with each airborne hit and end after four. A KO by an ender gets a slow-motion beat.

### Floors

- **The building** is a cutaway of two office floors (3 and 2 on the elevator's indicators) joined by a stairwell. Each floor's floor is a wet plane running from the back wall (the line fighters stand on) forward to the cut edge, then the concrete slab cut through, and the slab's underside is the ceiling of the floor below. The stairwell is a hole through the main floor's plane and slab; the guard rail is fixed to its far lip, with its end posts on the solid floor either side, and the first flight runs down through the hole to a landing that bears on the stair shaft's wall, then switches back to the lower floor. Everything in the rooms stands on a floor, hangs from a ceiling or is mounted on a wall, the floor's mirror stops at the walls and at the hole, and the only thing in front of the cut is the street lamp outside, whose pole runs down to the street.
- **Floor break:** an ender, a throw, a launcher or a heavy knockback that carries someone over the stairwell railing (the opening in the main floor, right of the vending machine) sends him tumbling down the stairs to the lower floor: a FLOOR BREAK callout and 10 extra damage on landing. The attacker vaults the rail after him and the fight goes on downstairs, with that floor's walls. Once per round; the lower floor has no way down. The next round starts upstairs.
- The tumble is a ragdoll, and now and then it jams: in the opening above the slab (the body is longer than the opening is wide) or resting on a stair tread. A jam in the opening gets a straight push down; a fall that stops making headway for 0.9s, or runs past 3s, is set down flat on the lower floor (and any ragdoll still up after 5s is set down on its floor). An attacker on the far side of the opening, pinned by the lower floor's walls before he reaches the rail, vaults from where he stands.
- **Horde, floor by floor:** each floor sends a wave of 5 to 8 goons through its doors (two at a time from the third). Clear it for FLOOR CLEAR, and the hero vaults down to the next floor; after the lowest floor the run loops back to the top. The bodies stay on the floor where they fell, and the HUD tracks the floor, the wave and the goons downed.

URL `?scene=NAME` picks a scene: attract (the demo, which plain `index.html` opens on), play, dummy, ai-fight, ai-fight-2, ai-fight-3, scripted-combo, combo-test, string-test, ko, horde, horde-ai, horde-floors-ai, plus the test timelines mixup-test, stamina-test, string-ender-test, wall-test, juggle-test, trade-test, throw-test, floor-break-test, jump-in-test, anti-air-test (`__gauntlet.setScene(name, { only: k })` runs one phase of a timeline).

## Layout

- `index.html`, `src/main.js` — the game. Wires the modules below.
- `src/fighter/` — stick figure rig, poses, animation. Draws to a 2D context.
- `src/fx/` — lighting and effects compositor (WebGL), particles, camera shake.
- `src/combat/` — input, state machine, frame data (heights, stamina costs, enders), the string table (`strings.js`), hitboxes, AI, the neon HUD, rounds.
- `src/touch.js` — mobile touch controls (synthetic key events, active only on coarse pointers).
- `src/arena/` — the stage: geometry, background art, static lights.
- `src/audio/` — sound effects and music (see Sound). `main.js` makes two calls into it: `gameAudio.attach(sim)` and `gameAudio.event(ev)` from its event router. During the attract demo it holds the events back and attaches `null` instead of the sim (so the whiff watcher is quiet too), then attaches the sim again when a game starts.
- `demo/*.html` — one page per module so each can be judged alone.
- `window.__game.advance(ms)` steps the game without drawing a frame (fast, for counting events over a long demo); `window.__gauntlet.step(ms)` steps and draws.
- `gauntlet/` — the quality loop: the brief (with the owner requirements), the capture tool and the workbench log. The reference images and per-round critic captures stay out of the public repo (see `.gitignore`); the reference images belong to their owners.

## Sound

Everything audio lives in `src/audio/`, and none of it uses sample files.

- `index.js` — the router: turns sim and fighter events into effects, pans each by the fighter's screen x, and watches for whiffs (a strike reaching recovery without contact) and for which pool the music belongs in. It also owns the unlock on the first touch or key, M and N, the settings, and the phone's media player (`navigator.mediaSession`: "Stick Fight · <track>" with play, pause, next and previous). `window.__audio` exposes it for tests.
- `sfx.js` — the effects, built on the spot from a second of white noise and a few oscillators, each with a little random variation: whooshes by limb (a jab short and high, kicks longer and lower, the spinning enders longest), hits, block, counter (the heaviest hit short of an ender, a second snap and a bright ping), footsteps, landings, the jump, a body fall with a slide, wall splat, wall bounce, ground bounce, the throw (a grab rustle, then a slam), whiff, the gassed exhale, ROUND and FIGHT, KO, the slow-motion ender KO (pitched down with a long tail of echoes), combo notes that climb with the hit count, the ender stinger, a horde goon down, the match end, and UI clicks. The multi-floor events have theirs too: a floor break (a crash, debris and a railing clanging), a knock per stair tread, a vault landing, and a floor-clear stinger. A hit is built in layers scaled by its weight (a jab light, a cross a bit more, a heavy, a counter, an ender or a KO the most): a crack of a few milliseconds for the contact, a punch falling through 300 to 120 Hz that a phone speaker can play, a sub thump into 40 to 55 Hz for headphones, a lowpassed tail, a crunch through a tanh shaper on the heavies, and on an ender or a KO a long low boom with a harmonic a phone can hear. A light hit stays about 0.15 s long so a fast string doesn't smear, and the combo note and the ender stinger come in 15 and 30 ms behind the crack, under it. Effects go through a compressor, a limiter and a soft clip, so a horde pile-up can't clip. Impacts (hits, wall splats and bounces, the ground bounce) skip the compressor on a bus of their own, because through it every hit came out at the same peak, a jab as loud as a KO. At most 16 sound at once (a new one steals the oldest of the lowest priority; footsteps go first). The effects have their own AudioContext.
- `music.js` + `tracks.js` — the soundtrack, written as [Strudel](https://strudel.cc) code and played through Strudel, after cf-quarry's player. Strudel is only imported the first time music turns on. A track plays its form twice, then the next track in the current pool starts. The pool follows the game: `fight` for a normal match, `horde` in horde mode (each cleared floor moves to the next horde track), `calm` in training (the dummy scene). The music ducks under the KO stingers, the slow-motion ender, the floor break and FIGHT, and gets a quick sidechain-style dip under a hit (`music.pump`): none for a jab, so a fast string doesn't wobble it, about 2.5 dB for a cross, 6 for a heavy, 8 for a counter or a throw, and 10.5 for an ender or a wall splat, down in 10 ms and back in 0.1 to 0.35 s. A silent looping `<audio>` plays beside it so a phone shows its media player.
- `ui.js` — the sound panel and the speaker button. Its sliders are drawn in the DOM and driven by pointer events, because `touch.js` cancels every touchmove on the page.

The tracks share one theme (`THEME`, a four-bar call, answer, fall and rest), one set of changes (i VI VII i, iv VI VII v), and one form (an intro, `a` with the drums, `b` with the theme, a `drop` without drums, and `c` with everything). They use only Strudel's built-in synths and noises, so nothing is fetched to play them, and any of them pasted into strudel.cc plays there.

| Track | Pool | BPM | Key | Feel |
|---|---|---|---|---|
| Overtime | fight | 128 | A minor | darksynth, a galloping bass and a sawtooth lead |
| Floor 37 | fight | 120 | E minor | synthwave, gated chords and an arpeggio |
| Freight Elevator | fight | 72 | D minor | heavy half-time, a distorted bass and a crushed snare |
| Hard Reboot | fight, horde | 136 | G minor | darksynth, an offbeat bass and stabs through a delay |
| Cubicle Riot | horde | 152 | C minor | industrial at a run, a sixteenth-note bass |
| Nightwatch | calm | 60 | F minor | pads, rain on the glass, the theme on a bell |

**The Strudel bundle.** `public/vendor/strudel.mjs` is the `@strudel/web` 1.3.0 bundle (850 KB), copied unmodified from cf-quarry, with its license text beside it in `public/vendor/LICENSE`. It lives in `public/` so Vite copies it into the build untouched; `music.js` imports it at runtime by URL, because the bundle resolves its own helper files relative to itself. Its source is at https://codeberg.org/uzu/strudel.

## License and credits

The game is free software under the GNU Affero General Public License v3.0 or later; see `LICENSE`. If you serve a modified version to players, the AGPL asks you to offer them its source.

- **Music engine:** [Strudel](https://strudel.cc) by the Strudel contributors, AGPL-3.0-or-later, source at https://codeberg.org/uzu/strudel. The six tracks in `src/audio/tracks.js` are written as Strudel patterns and played by it.
- **Fonts:** [Bungee](https://fonts.google.com/specimen/Bungee) by David Jonathan Ross and [Teko](https://fonts.google.com/specimen/Teko) by the Indian Type Foundry, both SIL Open Font License, loaded from Google Fonts.
- **Inspiration:** the animation bar is Xiao Xiao, Zhu Zhiqiang's stick-figure fight series. No art from it ships with the game.

The sound panel and the attract screen link back here.

## Practices

- No framework, no bundler, no npm deps at runtime. Playwright (global) only for `gauntlet/capture.mjs`.
- Logical resolution 1280x720, DPR-aware. Everything positions in logical pixels.
- Each module owns its folder and its demo page. Cross-module contracts live in `gauntlet/BRIEF.md`.
- Commit after every gauntlet round with the round number in the subject.
- Capture output is large (about 1.3 MB per frame). Delete capture folders when a round is done; `gauntlet/captures/` is gitignored.
