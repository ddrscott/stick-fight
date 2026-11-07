# Gauntlet brief: stick-fight

## Goal (verbatim from Scott)

> i want a fighting game i can play in the browser with the same quality of animation, but with modern lighting and effects. simple figures with ambient lighting.

"The same quality of animation" means Xiao Xiao No. 3 (Zhu Zhiqiang, 2001), his favorite animation growing up.

## The bar (inspect these, never a description of them)

1. **Animation:** `gauntlet/reference/xiaoxiao/frame_*.png` (54 frames, every 6th frame of the GIF at 25fps) and `xiaoxiao3.gif`.
   What makes it great: every pose reads as a silhouette; weight shifts before a strike (anticipation); limbs overshoot and settle (follow-through); hits land with a held frame then a snap; falls are heavy; running is a lean, not a shuffle; the figure is simple (circle head, 2px-ish limbs, hands and feet as nothing more than line ends) and all of the quality is in timing and posing.
2. **Lighting and effects, primary:** `gauntlet/reference/lighting/scott_sample.png`. Scott sent this himself as "sample of lighting" (a Crystal Lighting Engine scene, pixel art, neon Tokyo at night). It is the owner's bar, so it outranks the Stick Fight shots.
   What makes it great: a deep blue-purple ambient that is dark but never black; many colored point lights (magenta, orange, cyan, green) each with a soft falloff that tints the geometry around it, so a wall near an orange window goes warm and the pavement under a pink sign goes pink; strong bloom with a wide soft halo on every emissive, and small sparkly emissives (window lights, rain drops catching light) that bloom into stars; a wet ground that reflects the lights as smeared vertical streaks; rain streaks and drifting particles in the air; blurred dark foreground silhouettes (leaves, a pole) for depth; cool shadows against warm lights; the character stays small, simple and perfectly readable in the middle of it all.
3. **Lighting and effects, secondary:** `gauntlet/reference/lighting/stickfight_*.jpg` (Stick Fight: The Game, Landfall). Use this for what the sample does not show: impact effects, debris with physics, screen shake, figures that read against a busy scene, vignette and grain used with restraint.

The bar is directional. It does not have to be reached, it has to be compared against, honestly, every round.

## Decomposition (lead's call, revisit if the critic says a piece won't separate)

| Piece | Owns | Demo page | Judged against |
|---|---|---|---|
| A. Fighter animation | `src/fighter/` | `demo/fighter.html` | Xiao Xiao frames |
| B. Lighting and FX | `src/fx/` | `demo/fx.html` | Stick Fight screenshots |
| C. Combat and feel | `src/combat/`, `src/main.js`, `index.html` | `index.html` | Playable: input response, hitstop, readability, AI |
| D. Arena | `src/arena/` | `demo/arena.html` | Xiao Xiao's building (line-art floors, stairs, doors) lit like Stick Fight |

## Shared contracts (keep these stable; change only with a note in the workbench)

Logical space: 1280x720, origin top-left, y down. The main floor's y comes from `arena.floors[0].y`; never hardcode it. (Round 1 said 640. The round 1 critic showed Xiao Xiao's composition has the main floor in the upper third with a full lower floor below, so from round 2 the building arena puts it near y=480. Combat and FX read it from the arena.)

### Camera
```js
// src/camera.js
export const camera = { x: 640, y: 360, zoom: 1, shakeX: 0, shakeY: 0 };
```

### Fighter (piece A)
```js
import { createFighter, MOVES } from './src/fighter/index.js';
const f = createFighter({ color: '#e8e8e8', x: 400, y: 640, facing: 1 });
f.play('punch');        // MOVES is an array of names. Replaying 'idle' from anything blends.
f.update(dt);           // dt in seconds. Advances the animation.
f.draw(ctx);            // 2D context, logical pixels, camera already applied by caller.
f.x; f.y; f.facing;     // writable; y is the foot/ground line.
f.joints;               // { head, neck, hip, lShoulder, rShoulder, lElbow, rElbow, lHand, rHand,
                        //   lKnee, rKnee, lFoot, rFoot } world-space {x,y}, updated by update().
f.current;              // { move, t, frame, done } t in [0,1], frame is the keyframe index.
f.events;               // array drained by caller: { type:'active'|'recover'|'footstep'|'land', move }
f.radius;               // head radius, for hurtboxes.
```
Minimum MOVES: idle, walk, run, jump, jab, cross, roundhouse, sweep, hitLight, hitHeavy, knockdown, getup, block, ko.
Fighters are ~130px tall at zoom 1.

### Arena (piece D)
```js
import { createArena } from './src/arena/index.js';
const a = createArena('building');
a.floors;          // [{ x0, x1, y }] walkable lines; floors[0] is the main fight floor
a.stairs;          // [{ x0, y0, x1, y1 }] walkable slopes (optional in round 1)
a.lights;          // [{ x, y, radius, color:[r,g,b], intensity }] static point lights
a.spawns;          // [{x,y,facing}]
a.drawBackground(ctx);  // behind fighters, unlit line art + fills
a.drawForeground(ctx);  // in front of fighters (optional)
a.update(dt);      // bodies pile, doors swing, whatever is animated
a.addBody(fighterSnapshot); // a KO'd fighter becomes part of the scene
```

### FX compositor (piece B)
```js
import { createFX } from './src/fx/index.js';
const fx = createFX(glCanvas, { width: 1280, height: 720 });
fx.layers.background;  // 2D canvas, draw the arena here
fx.layers.figures;     // 2D canvas, draw fighters here
fx.layers.emissive;    // 2D canvas, things that glow (lamp cores, sparks) in full color
fx.lights = [...];     // dynamic + static point lights this frame, same shape as arena.lights
fx.ambient = [r,g,b];  // 0..1
fx.hit({ x, y, strength, dir });   // sparks, flash, shake, debris
fx.dust({ x, y, dir });            // footstep / landing dust
fx.trail(jointsPrev, jointsNow, color); // motion trail for a fast limb
fx.update(dt);         // particles, shake decay
fx.render(camera);     // composites the layers to the GL canvas
```
Everything the fighters and arena draw goes through 2D canvases; the FX module owns all WebGL.

### Gauntlet hook (every demo page and index.html)
```js
window.__gauntlet = {
  scenes: ['idle', 'punch', ...],   // what capture can ask for
  setScene(name) {},                // deterministic: reset state, seed RNG
  step(ms) {},                      // advance simulation by ms with no real-time dependency
  ready: true,
};
```
`gauntlet/capture.mjs` uses this to produce frame sequences for the critic. If `step` is missing it falls back to wall clock, which makes captures noisy. Implement it.


## Owner requirements (Scott, after playing it; these outrank critic gaps)

1. **Figures are solid.** Hits must not pass through the other player. A strike's fist or foot stops at the defender's body on contact; torsos and limbs never overlap another fighter's body. Bodies push each other instead of sharing space.
2. **Walking is grounded, not floaty.** Feet plant and stay locked to the floor while they carry weight; the body's travel matches the stride so nothing skates; the step has weight (a dip on contact, a push on the trailing foot).

3. **Hits keep hitting: proper combos.** A landed hit leaves the opponent close enough and stunned long enough that the next strike connects. Strings like jab, jab, cross, roundhouse land as a true combo, with a hit counter that climbs, and the AI uses combos too.

4. **Tekken-style limb controls.** Four attack buttons, one per limb: 1 = left punch, 2 = right punch, 3 = left kick, 4 = right kick (keyboard U I J K, the Tekken PC layout; touch is a 2x2 diamond in the same arrangement). The limb that strikes on screen is the limb the button names, from the fighter's own point of view, so it works when facing either way. Directions modify (down+3 low kick or sweep, forward+2 lunge cross, back+4 spin kick) and strings come from button sequences (1,1,2 / 1,2,4 / 2,3).

5. **Scenery never obscures the players.** No decorative object (foreground plants, vines, rail, lamppost, any foreground silhouette, signs, particles, rain, smoke, rings, banners) may ever cover a live fighter or hide a corpse in the pile. Guaranteed by the compositor: wherever the foreground or any effect overlaps a fighter, it fades out locally, so placement mistakes can't break it.

Every critic checks these first and reports interpenetration frames and foot skate in pixels.

## Measuring against the bar

The round 2 lighting critic found that `scott_sample.png` carried a gAMA 0.4545 tag, which made ImageMagick's `%[fx:mean]` and `-colorspace gray` report the frame about a stop brighter than its stored pixels (mean 161 instead of 67). The round 1 builder chased that wrong number. The tag is now stripped from the file. Rule from here: measure the reference and the candidate with the same command on 8-bit stored values (`-depth 8` histogram or a PGM dump), and state the command in the verdict. Same instrument, both sides. Known bar numbers for the sample, Rec709 luma on stored values: mean 67, sky (top 120px) 38, 39% of pixels under gray 40, p05 2, p95 222.

## Disk hygiene

On 2026-11-07 the critics' scratch captures reached about 15 GB and filled the disk, stalling every agent. Critics and builders delete their own scratch capture folders when they finish (keep only the verdict, the measurement scripts and at most a few cited crops), and capture the fewest frames that answer the question.

Rule for every agent, builders included: when you finish a round, delete your scratch capture folders. Keep the measurement scripts and a few cited crops, nothing else. Capture only the frames you need: step the scene and screenshot the listed frame indices, not a whole sequence.

## Rules of the loop

- Builders never grade their own work. A critic with fresh context inspects captured frames of the real artifact, blind-labelled A/B against the bar, and names the single biggest gap.
- No fixed round count. Scott stops the run.
- Each round: builder fixes the one named gap first, then anything else it sees. Commit with `gauntlet(<piece>) round N: <gap>`.
- Workbench at `gauntlet/workbench.md` is the live log. Each round's critic verdicts go in `gauntlet/rounds/`.

## v2 spec (Scott, 2026-11-07, after the gauntlet stopped)

Scott's five asks:
1. No terminal aesthetic anywhere. It's a neon stick fighter, not a hacker game. HUD, banners, touch controls and demo pages use a neon arcade look: a bold display face, glowing outlines, the arena's palette (magenta, cyan, amber). No monospace, no `//` or `$` markers. This overrides the global visual signature for this project.
2. Procedural animation so strikes, strings and reactions blend into each other naturally, especially when you get hit by the other person at the same time (trades).
3. A stamina meter so nobody can spam buttons the whole match.
4. High, mid and low attacks and blocks, for mixups.
5. Many more sequences that tie into more powerful moves and trick shots.

### Heights and guarding (Tekken rules)
- Every strike has `height`: 'high', 'mid' or 'low'. Throws are unblockable but break on 1+3 or 2+4 pressed in time.
- **Standing guard** (hold back, away from the opponent; or the touch BLOCK button) blocks high and mid. Lows hit it.
- **Crouching** (hold down) ducks under highs completely (they whiff over the head) and blocks lows when also holding back (down-back). Mids hit a croucher.
- Crouch has its own attacks (down+1 low jab, down+2 uppercut, down+3 low kick, down+4 sweep), and rising from crouch has whiles-rising moves (release down then 2 = rising uppercut, 4 = rising knee).
- Keyboard: A/D move (holding away blocks), S crouch, W jump, U I J K = 1 2 3 4, Shift run. Touch BLOCK = hold back.

### Move heights
| Move | Height | Note |
|---|---|---|
| jab (1) | high | fast poke |
| cross (2) | high | |
| lkick (3) | mid | |
| roundhouse (4) | high | knockdown |
| lowJab (d+1) | low | small, safe |
| uppercut (d+2) | mid | launcher |
| lowKick (d+3) | low | |
| sweep (d+4) | low | knockdown |
| lungeCross (f+2) | mid | |
| spinKick (b+4) | high | wall splat |
| bodyBlow (f+1) | mid | |
| risingKnee (rise 4) | mid | launcher |
| overhead (f+3+4 or f+4) | mid, jumping axe kick | beats crouch |

### Stamina
- Max 100. Regenerates 22/s after 0.6s with no attack; 8/s while blocking.
- Costs: jab 6, low jab 6, cross 9, body blow 9, kicks 12, launchers 16, enders 20, throws 15, run 10/s, jump 6.
- Blocking a hit costs the blocker half the attack's cost.
- At 0 the fighter is **gassed** for 1.2s: attacks start 40% slower, no run, no enders, a visible slump in the idle and a dimmed meter. A gassed fighter who gets hit takes 15% more damage.
- HUD: a thin stamina bar under each health bar.

### Sequences, enders and trick shots
Strings flow through the rig's cancel windows. Each string ends in an ender that pays off:
| Input | Name | Pays off |
|---|---|---|
| 1,1,2 | One-two | |
| 1,1,2,4 | Flash Roundhouse | knockdown |
| 1,2,3 | Uptown | mid finish |
| 1,2,3,4 | Neon Tornado | spinning 360 kick, launches into a juggle |
| 2,1,4 | Spin Heel | wall splat |
| 3,3,4 | Double Snap to Crescent | crescent kick knockdown |
| d+3,d+3,4 | Ground Rush | low, low, mid knockdown |
| d+2 (launch) then 1,2 in the air then 4 | Sky Spike | ground bounce, relaunch for one more hit |
| f,f+2 (dash) | Comet Cross | wall splat if near a wall |
| b+4 near a wall | Wall Spin | wall bounce, juggle |
| throw near a wall | Wall Slam | throw into the wall, wall splat |

Trick shots:
- **Wall splat**: the victim hits the wall and sticks for about 0.4s, open for one more hit.
- **Wall bounce**: the victim rebounds off the wall into a juggle.
- **Ground bounce**: a downward hit on an airborne victim bounces them for a relaunch.
- **Counter hit**: hitting someone during their attack startup does extra damage and extra stun, with a distinct flash and a COUNTER callout.
- **Trades**: if both connect in the same frames, both take their reactions blended over their attacks (the procedural layer), no one wins outright.
- **Juggle limit**: gravity scaling so juggles end after about 4 airborne hits.
- **Finisher**: landing a KO with an ender triggers a short slow-motion beat.

Callouts appear for enders, counters and trick shots in the neon style, placed so they never cover a fighter (requirement 5).

### Procedural animation (rig)
- Hit reactions are **additive layers** on top of whatever the body is doing, so getting hit mid-attack bends the attack instead of snapping to a canned pose. Trades look like two people hitting each other.
- **Spring-driven secondary motion**: head, hands and feet carry momentum and settle with springs, so transitions between any two moves look continuous.
- **Pose-matched transitions**: starting a move blends from the current pose and velocity, not from guard.
- **Ragdoll-ish airborne bodies**: launched, juggled, wall-splatted and bounced bodies are driven by a constrained point simulation of the joints, blended back into keyframed getups.
- The keyframed moves stay the art direction; the procedural layer makes them connect.

## v3 spec: multi-floor fights (Scott, 2026-11-07)

Scott chose: (1) knock opponents down the stairwell to the lower floor and continue the fight there; (2) horde mode floor by floor. Walkable stairs come later, if at all. Fighting stays on flat floors.

### Arena contract (src/arena)
- **Stairwell opening** in the main floor slab above the stair top: `arena.stairwell = { x0, x1, y, rail: { x0, x1, h }, toFloor: 1 }`. A waist-high railing guards it. Walking and standing fighters never fall in (floors[0] stays continuous for walking); only an airborne body (launched, juggled, thrown, or knocked back hard) that crosses the railing's top inside x0..x1 drops through.
- **Stair treads as collision for falling bodies**: `arena.treads = [{ x0, x1, y }]` (each step's top surface, both flights and the landing), plus `arena.stairRail` segments if useful. Bodies tumble down them.
- **Floors**: floors[0] main (y 360), floors[1] lower (y 700), each with `fightBand = { x0, x1 }` (where a fight can happen on that floor), `walls = { left, right }` per floor, and `spawns` per floor (`arena.spawnsByFloor[i]`). The lower floor needs a clear fight band: no prop or foreground element over it at gameplay zoom (owner requirement 5), and its lights must light fighters there.
- **Horde doors**: `arena.doors[i] = [{ x, y, side }]` where goons enter on each floor (the lower floor's lit doorway and far door; the main floor's double doors and elevator).

### Rig contract (src/fighter)
- The point simulation collides with `f.treads` (array of tread surfaces) and `f.walls` per floor, so a launched body clatters down the steps, bounces off treads and the landing, and comes to rest on the floor below, then the normal knockdown and getup.
- A `vault` move: a fighter hops the stairwell railing and drops to the floor below, landing in a crouch (for the attacker following the victim down, and for the horde hero moving to the next floor). Optionally `descend`: a quick walk-run down the treads if it reads better than the vault.

### Combat contract (src/combat, main.js)
- **Floor-break rule**: an ender or throw whose launch or knockback carries the victim over the stairwell railing triggers the fall. Launchers and splat enders near the stairwell (Neon Tornado, Spin Heel, Comet Cross, a throw toward it, a heavy knockback) are the main triggers. A FLOOR BREAK callout and extra damage on landing.
- **Follow-down**: the attacker vaults after the victim; the camera follows down; the fight continues on floors[1] with that floor's walls and spawns. A floor-break can happen only once per round per direction (no ping-pong); the lower floor has no stairwell down.
- **Camera**: frames whichever floor the fighters are on, panning vertically during the fall with the tumbling body in frame; nothing covers a fighter (requirement 5); the HUD stays in its strip.
- **Horde floors**: waves of goons per floor (about 5 to 8, scaling), entering from that floor's doors; on clearing a floor the hero vaults down the stairwell to the next; the pile stays on each floor; a FLOOR CLEAR callout; the run tracks floors cleared and goons downed. After the lowest floor, the next wave loops back to the main floor (or the floors cycle).
- Audio hooks: emit 'floorBreak', 'vault', 'floorClear', 'stairTumble' through onEvent so the audio builder can attach sounds.

## v3b: air and crouch attacks (Scott, 2026-11-07)

"Attacks while in the air and crouching should be allowed."
- **Air attacks**: any of 1 2 3 4 during a jump: jumpJab (1, quick), jumpCross (2), flyingKick (3, straight leg, long reach), airRoundhouse (4, big, knockdown on a grounded hit), and down+4 in the air = diveKick (angled stomp down-forward, ends the jump early). One air attack per jump (two if the first whiffs early). Air attacks are **overheads**: they hit crouchers and must be guarded standing. A jump-in that lands can chain into a ground string on landing (jump-in combo). Landing during an air attack's recovery has a short landing lag.
- **Air control**: a little steering during the jump (forward or back jumps by direction at takeoff, small mid-air drift).
- **Anti-air**: the uppercut and rising uppercut beat jump-ins (counter hit on an airborne attacker, launches); a standing jab can stuff a late air attack.
- **Crouch attacks**: d+1 d+2 d+3 d+4 work from crouch and crouch-walk, and the fighter stays crouched after a low (no stand-up pop between crouch attacks); crouch attacks can chain (d+1, d+1, d+3).
- AI: uses jump-ins and dive kicks against crouchers, anti-airs jumps, and mixes crouch strings.
