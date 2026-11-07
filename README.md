Live at https://askscottpierce.com/stick-fight

# stick-fight

A browser fighting game. Stick figures animated at Xiao Xiao quality, lit like a modern 2D game.

## Run

```sh
npm install
npm run dev          # Vite on http://localhost:8077/ (also reachable through the dev tunnel)
npm run dev:worker   # the online-rooms Worker under wrangler dev on :8787 (Vite proxies ./api to it)
npm run typecheck    # tsc over src/, then over worker/
```

Online play needs both: `npm run dev` for the game and `npm run dev:worker` for the room server. Vite forwards `/api/*` (HTTP and WebSocket) to `http://127.0.0.1:8787/stick-fight/api/*`. To run the production layout instead, `npm run build` and then `npx wrangler dev` serves the game at `http://localhost:8787/stick-fight/` with the API beside it.

The game is plain ES modules with canvas 2D for drawing and WebGL for the lighting composite. Vite serves it in development and bundles it for deploys. New modules can be TypeScript (`.ts`) next to the JavaScript ones; `tsconfig.json` has `allowJs` on and `checkJs` off, so add `// @ts-check` to a JS file to type-check it. The demo pages (`demo/*.html`) and the capture tool work against the dev server as before.

## Hosting

The game is a Cloudflare Worker on two zone routes, `askscottpierce.com/stick-fight` and `askscottpierce.com/stick-fight/*`, on the Scott Personal Account. Every other path on askscottpierce.com stays with the main site. `/stick-fight` redirects to `/stick-fight/`, so the page's relative asset paths resolve.

Static files come from the assets binding (`dist/`). The Worker script (`worker/index.ts`) runs first only for `/stick-fight/api/*` (`run_worker_first`), where it serves online rooms through a Durable Object class `Room` (binding `ROOMS`, migration `v1` with `new_sqlite_classes: ["Room"]`). A request that reaches the script anywhere else gets a 404. The first deploy with the script creates the Durable Object class from that migration. There's no KV, D1 or cookies. Two Workers rate limiting bindings, `ROOM_LIMIT` (namespace `7101`) and `JOIN_LIMIT` (namespace `7102`), cap room creation and WebSocket joins per IP (see Multiplayer, Limits); they're free on every plan, and a namespace id must be unique on the account. `npm run types:worker` regenerates `worker/worker-configuration.d.ts` after a change to `wrangler.jsonc`.

```sh
npm run deploy       # vite build into dist/stick-fight/ (file path = URL path), then wrangler deploy
```

**Secrets.** The Worker has two, for Cloudflare Realtime TURN (see Multiplayer): `TURN_KEY_ID`, the id of the TURN key named `stick-fight` on the account, and `TURN_KEY_API_TOKEN`, that key's secret. `GET /stick-fight/api/ice` uses them to mint TURN credentials that expire after an hour. Without them the endpoint answers with public STUN only, which is what local dev gets unless `.dev.vars` (gitignored) holds the same two lines. Secrets persist across deploys. To rotate the key, create a new one and point the Worker at it, then delete the old one:

```sh
# a token with "Calls Write" on the account (the dashboard, or minted with CF_TOKEN_MANAGER)
curl -X POST -H "Authorization: Bearer $CALLS_TOKEN" -H "Content-Type: application/json" \
  https://api.cloudflare.com/client/v4/accounts/0223b96fe77599b23ff8ec7fcd32e2f1/calls/turn_keys \
  -d '{"name":"stick-fight"}' > key.json             # result.uid and result.secret
jq -r .result.uid key.json    | npx wrangler secret put TURN_KEY_ID
jq -r .result.secret key.json | npx wrangler secret put TURN_KEY_API_TOKEN
rm key.json
# then DELETE .../calls/turn_keys/<old uid>; credentials minted from it stop working
```

The same key list is in the dashboard under Realtime, TURN Server. TURN bills $0.05 per GB sent out past the free allowance (the account's first 1,000 GB of Realtime a month, as of 2026-11), and a match's input packets are tiny. Only matches whose phones can't reach each other directly use it.

The places that hard-code the `stick-fight` path are `wrangler.jsonc` (routes, `run_worker_first`), `worker/index.ts` (the API prefix), and `vite.config.ts` (`outDir`, and the dev proxy's rewrite). Vite builds with `base: './'` and the game code uses only relative paths, so it runs the same at `/`, on the dev tunnel and at the subpath. The askscottpierce.com origin is shared by every app on it, so localStorage keys start with `stick-fight-`. The page carries the site's Plausible tag (`data-domain="askscottpierce.com"`), so visits count under the main site by path.

Serving the game publicly ships the vendored Strudel bundle, which is AGPL-3.0, so the game is AGPL-3.0 too (see License and credits).

## Arcade flow

Plain `index.html` runs like a cabinet. Everything around a fight is one state machine in `src/flow/index.js`; every move between screens goes through one `go()` that refuses any move not in its transition table, so a double press can't skip a screen.

**Title (attract).** Two CPU fighters play one round under the title, with a START button and a DEMO tag. Between demo bouts a high score table shows for 7 seconds, like a cabinet's attract loop; the arcade and horde tables take turns. The demo is silent; at most the music keeps playing.

- **Only START starts.** Tap or click the START button, press Enter or Space, or press Start or A on a gamepad. A tap or click anywhere else, and every game key, only wakes the sound (browsers keep a page silent until it's touched). The sound button, its panel and the SOURCE & CREDITS link don't start anything either.
- The START button sits where the title card's prompt is and fades the same way when a fighter is under it.

**Mode select.** ARCADE, VERSUS ONLINE, HORDE, TRAINING. Arrows, WASD, the D-pad or the stick move; Enter, Space, A or Start pick; Esc, Backspace or B go back. The mouse hovers and clicks, and a tap picks.

**Arcade.** Six stages up the building, best of 3 rounds each, against a named CPU that gets harder and plays its own way (opt-in AI styles in `src/combat/ai.js`):

| Stage | Opponent | CPU | Style | Look |
|---|---|---|---|---|
| 1 | INTERN, "unpaid, and swinging like it" | 2 | the normal scrapper | night with rain, orange-amber |
| 2 | HELPDESK, "have you tried blocking?" | 4 | turtle: guards more, waits at range, punishes whiffs | dry night, cyan |
| 3 | COURIER, "delivers in thirty seconds or less" | 5.5 | rushdown: runs in, swings more, never backs off | the bright neon street, pink |
| 4 | SECURITY, "will escort you out. through the railing" | 7 | grappler: throws up close, hunts the wall and the stairwell | night with rain, green |
| 5 | JANITOR, "works the lower floor" | 8.5 | aerial: jumps in from further out, much more often | the lower floor, violet |
| 6 | THE MANAGER (boss) | 10 | showcase, the expert the demo uses | neon street with rain, red |

The ladder lives in `src/flow/ladder.js`. Each stage opens on a card (STAGE 3, YOU VS COURIER, the tagline, the ladder's pips); START or a tap skips it. A won match says YOU WIN, then STAGE CLEAR with the stage bonus; the boss says BOSS DOWN, then the credits roll and the score goes to the table. A lost (or drawn) match says YOU LOSE, then **CONTINUE?** with a 10 second countdown: YES retries the stage with the score set back to what it was when the stage started, NO or the countdown running out is GAME OVER.

**Score** (shown in the HUD beside PLAYER 1, with the last bonus next to it):

| For | Points |
|---|---|
| damage you deal | 10 per point of health |
| a hit in a combo | 30 times its place past the first (2nd +30, 3rd +60, ...) |
| counter hit | 200 |
| ender | 500 |
| wall splat, wall bounce, ground bounce | 300 |
| floor break | 1,000 |
| breaking a throw | 300 |
| KO by an ender (FINISH) | 1,000 |
| round won | 1,000, plus 100 per second left on the clock |
| perfect round (no damage taken) | 5,000 more |
| stage clear | 2,000 times the stage number |
| horde: goon down / floor clear | 300 / 2,000 |

**High scores.** A top-5 table for arcade and one for horde, kept in localStorage as `stick-fight-scores` (the origin is shared with the rest of askscottpierce.com). A score that makes the table gets three initials: type them, or use up and down to turn a letter and left and right to move, then ENTER; on touch, tap the arrows. Left alone for 30 seconds the initials go in as they stand.

**Horde** is the floor-by-floor mode, scored the same way; it ends when the hero goes down, then GAME OVER, initials and the horde table. **Training** is the dummy scene, no score.

**Pause** (P, Esc, pad Start, or the small pause button in the top-left corner on a touch screen) in arcade, horde and training: RESUME, RESTART STAGE (RESTART RUN in horde, RESET in training), QUIT TO TITLE. P, Esc or Start again resumes. Nothing runs while paused, the round clock included.

**Idle.** 30 seconds with no input goes back to the title only where nothing is lost: mode select, the online menu and join screen, the end of an online match, and training. Never mid-match: an arcade or horde run left alone plays itself out (the CPU or the goons win), CONTINUE runs down, a table score is entered as it stands, and the cabinet is back on the demo. A paused game stays paused. An online match never times out.

**Versus online.** HOST A GAME shows the room code, the link (COPY LINK, and SHARE where the phone has a share sheet) and WAITING FOR A FRIEND; JOIN A GAME takes the code from the keyboard or an on-screen keypad (tap, mouse, or D-pad and A). A `?room=CODE` link opens JOIN with the code filled in. When the match starts the menus go away; Esc, pad Select or the touch LEAVE button asks to leave (that's `online.js`'s confirm, not the pause menu). When either side leaves, the other gets YOUR RIVAL LEFT (or CONNECTION LOST) and goes back to the online menu. See Multiplayer for the network side.

**Touch.** The stick and the buttons show only while fighting; menus are tapped directly. The sound button stays in the top-right gutter on every screen.

**Swallowed presses.** The key or button that confirmed a menu, skipped a stage card or resumed from pause is ignored until it's let go, so it doesn't throw a punch.

**`?scene=` URLs skip all of this** and behave as before: the scene they name, no menus, no timeout, and the old hotkeys (G horde, R reset, P pause). `?scene=attract` is the old demo, where any key starts `play`. `__gauntlet.setScene` and `__game.setScene` also turn the flow off, so the capture tool works on plain `index.html` too.

The demo fighters are the CPU at difficulty 10 in its **showcase** flavor (`sim.setAI(i, 1, { style: 'showcase' })`, `src/combat/ai.js`): it keeps spacing at the edge of reach, steps out of pokes and punishes the whiff, reads and guards highs, mids and lows, opens with string starters at all three heights instead of jabs, blocks rather than mashing out of hitstun, keeps its stamina up (it never presses the strike that would faint it), jumps in and meets jump-ins with an uppercut or a standing guard, and saves the stairwell for later in the round. THE MANAGER fights the same way.

**Anti-airs.** Every CPU decides at your takeoff whether it read the jump: 12% at difficulty 0.3 or below (INTERN mostly gets jumped on, but not always), then rising with difficulty to 80% (0.85 for showcase, +15% for the aerial style). A read drops whatever it was doing, stands its ground until you come into the uppercut's reach about when it would go live, and presses d+2 (a jab instead if you're already on top of it with a strike out); a jump that will land short is let land. A CPU that doesn't read it still has the old once-per-jump uppercut reflex.

**Stamina and faints.** No CPU presses the strike that would empty its bar, except that the bottom of the ladder slips now and then ((1 - difficulty) x 40% of the times it would, never the showcase), so INTERN and HELPDESK faint a round or so and THE MANAGER doesn't. A CPU under about 30 stamina backs off or guards while it refills, and only starts a string's ender when the rest of the string fits in the bar. When you faint it runs in and opens a string on you: 35% plus 65% of its difficulty of the time, every time for the showcase.

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
- **In the air:** jump with W (hold a direction for a forward or back jump; you can steer a little in the air), then 1 jump jab, 2 jump cross, 3 flying kick, 4 air roundhouse (knockdown), down+4 dive kick (cuts the jump short). One air attack per jump. Air attacks are overheads: they hit a croucher, so guard them standing. Land a jump-in hit and keep pressing for a ground string; whiff one and you land with a short lag. An uppercut (d+2, or rising 2) meeting a jump-in is a counter hit that launches; a jab stuffs a late one. In the rig an air attack eases its hip onto the jump's arc over its startup (and a dive kick never climbs the arc, it drops from where it was). Its homing lunge (up to 70px toward the defender) and torso swing don't land in the 50ms pre-roll the sim skips: the head travels in a straight line, evenly over the frames from the press to the moment the strike can hit, and the hips carry the difference; from then on, and at contact, the body is exactly where it was before. The jump's push-off is drawn with softer eases than the arc air attacks ride, so takeoff has no big frame. Leaving the air for anything grounded lowers the hip over 160ms (220 after a dive) instead of in one frame; a strike thrown on landing finishes that descent by its contact key, so it lands at standing height. Where the head still has to travel farther than 20px in one frame to make contact (a jump jab or dive kick from far out, a landing push-apart, the stairwell vault and its handoff to standing), `drawOffset()` in `src/main.js` holds the drawing to 20px per 60fps frame and lets it catch up. It's visual only: hit detection, contact and the netcode state use the real positions. A connecting strike snaps the drawing to the real pose on the contact frame, under the impact flash, so hits always draw touching. Launched, thrown and juggled bodies draw raw.
- **Crouching:** all four crouch attacks come out of a crouch or a crouch-walk (hold down and forward) without standing up, and you stay down after a low while down is held. d+1, d+1, d+3 is the Low Rush string. On touch, stick down plus a button.
- **Directions:** d+1 low jab, d+2 uppercut (launcher), d+3 low kick, d+4 sweep, f+1 body blow, f+2 lunge cross, f+4 overhead (mid, beats crouch), b+4 spin kick. Release down, then 2 = rising uppercut, 4 = rising knee (both launch).
- **Heights:** high = jab, cross, roundhouse, spin kick, spin heel. Low = low jab, low kick, sweep. Everything else is mid.
- **Stamina** (the thin bar under health, out of 100) is your attack budget. Jab 17, low jab 15, cross 21, body blow 19, lunge cross 22, low kick 18, the other kicks 22, launchers 24, throws 22, any ender 30; air attacks 12 to 18, a jump 8, running 14 a second (running stops at the last point, it never faints you). Mashing jab empties it on the 6th press, crosses and kicks on the 5th. A full four-hit string fits from full but leaves you low (1,1,2,4 costs 85, 1,2,3,4 costs 90, Sky Spike 92). It comes back at 50 a second once you've gone 0.4s without spending (none while attacking or running), and at 20 a second while guarding, so it refills in about two seconds of walking. Blocking a hit costs a third of its price and never takes the last point. Under 35 the bar turns pink and flashes LOW.
- **Faint:** spend the last point and you faint. The strike that emptied the bar still comes out, but nothing cancels out of it; once you're back on your feet you're out on them for 1.5s (the dizzy sway, a FAINT callout and a violet bar refilling): no attacks, no guard, no crouch, no jump, and you stagger at a third of walking speed. You come to with 30 stamina. A knockdown, a launch or a throw wakes you early, and so does taking 20 damage while fainted, so it's a free string for the other guy, not a free round. Every hit on a fainted body counts in the same combo, so the decay below keeps running through it.
- **Combo decay:** nothing loops. A button press cancels only as the next hit of a string from the table below, so mashing one button gives you that button's string and then you wait out the recovery (1,1,1 is three jabs; a fourth jab can't cancel out of the third). A move cancels into itself at most once in a row outside a string. Hitstun shrinks from the 3rd hit of a combo (100, 100, 85, 65, 45, then 30%), so a long chain drops and the defender can guard. Damage is full for the first three hits, then 80, 65 and 50%, and once one combo has done 30 damage the rest counts a quarter. Juggles keep their own scaling and the four-hit cap, whichever is lower. Counter hits still do 35% more damage and stun.
- P or Esc pauses (the pause menu, see Arcade flow), F1 shows the move list, H shows hitboxes. On a `?scene=` page G toggles horde mode, R resets and P just pauses.
- **Online match:** Esc (pad Select, touch LEAVE in the top-right gutter, where HORDE usually sits) asks whether to leave. Pause, reset, horde and the difficulty keys do nothing in an online match; H and F1 still work, since they only change your own screen.
- **Sound:** M turns the music on and off, N skips to the next track. The speaker button in the bottom-left corner (on a phone, the speaker button in the touch layer's top-right gutter) opens the sound panel: a SOUND switch for everything, a MUSIC switch, the track playing with NEXT, and MUSIC and EFFECTS volume sliders. The settings are remembered in localStorage (`stickfight-audio`). Browsers keep a page silent until it's touched, so the first tap or key starts the sound (the button pulses until then).
- Gamepad, USB or Bluetooth (any pad the browser reports with the standard mapping: Xbox, PlayStation, 8BitDo, most Android pads): X/Y/A/B = 1/2/3/4, D-pad or left stick moves, L1/L2 guard, R1 throw (1+3), R2 run, Start pause. In menus the D-pad or stick moves, A or Start picks, B goes back. On a `?scene=` page Select restarts and R3 toggles horde. Pressing any button hides the touch controls; touching the screen brings them back. Browsers don't count a pad press as a user gesture, so tap the screen once to turn the sound on.
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
- **Horde, floor by floor:** each floor sends a wave of 5 to 8 goons through its doors (two at a time from the third). Clear it for FLOOR CLEAR, and the hero vaults down to the next floor; after the lowest floor the run loops back to the top. The bodies stay on the floor where they fell, except that none rests over the stairwell's opening: one that would lie across the hole slides off to the nearer lip as it settles (`arena.addBody`). The HUD tracks the floor, the wave and the goons downed.

URL `?scene=NAME` picks a scene: attract (the demo, which plain `index.html` opens on), play, dummy, ai-fight, ai-fight-2, ai-fight-3, scripted-combo, combo-test, string-test, ko, horde, horde-ai, horde-floors-ai, plus the test timelines mixup-test, stamina-test, string-ender-test, wall-test, juggle-test, trade-test, throw-test, floor-break-test, jump-in-test, anti-air-test (`__gauntlet.setScene(name, { only: k })` runs one phase of a timeline). Add `&mirror=1` to see any scene the way the online guest sees a match (Multiplayer, Mirrored view); the capture tool takes it in the page argument, e.g. `node gauntlet/capture.mjs "index.html?mirror=1" play out/`.

## Multiplayer

Two players, each on their own phone or computer, fight online. One hosts a room and gets a four-character code and a share link (`https://askscottpierce.com/stick-fight/?room=K7QX`); the other opens the link or types the code. Codes skip 0, O, 1, I and L so they survive being read aloud.

**How it fits together.**

- `worker/index.ts`: `POST /stick-fight/api/rooms` makes a room and returns its code; `GET /stick-fight/api/rooms/<code>/ws?role=host|guest` opens the room's WebSocket. Each room is one Durable Object (hibernating WebSockets). It passes every message from one player to the other unchanged, and writes only its own `{"t":"sys"}` notices: welcome, peer joined or left, and errors (`no-room`, `full`, `busy`, `flood`). `GET /stick-fight/api/ice` returns `{ iceServers, ttl, turn }`: Cloudflare STUN plus TURN credentials good for an hour (see Hosting, Secrets), or public STUN only with `turn: false` when the Worker has no TURN key or Cloudflare doesn't answer. Each Worker isolate reuses one set of credentials for 10 minutes, so every set handed out has at least 50 minutes left.
- `src/net/link.js`: fetches `api/ice` as the link opens (2.5 seconds at most, else public STUN), then the WebSocket carries the WebRTC offer, answer and ICE candidates; game packets then go peer to peer over a DataChannel (unordered, no retransmits). With TURN, two phones on carrier NAT that can't reach each other directly still get a DataChannel, through Cloudflare's TURN servers. If the DataChannel isn't open within 5 seconds, packets go through the room's WebSocket instead (the relay); a DataChannel that opens later takes over. `link.candidate` says which path it took (`host` on the same network, `srflx` through a NAT, `relay` through TURN). `?relay=1` on the URL forces the WebSocket relay, and `?ice=relay` allows TURN candidates only, both for testing.
- **Limits** (`worker/index.ts`, `wrangler.jsonc`): per client IP (an IPv6 address counts by its /64), 10 new rooms a minute and 30 WebSocket joins a minute, counted per Cloudflare location. Over the limit, `POST /rooms` answers 429 `{"error":"busy","message":"Too many tries from your network. Try again shortly."}` with `Retry-After: 60`, and a join gets a socket that sends `{"t":"sys","ev":"error","reason":"busy"}` and closes, so the page can say why; the menus show SERVER BUSY: TRY AGAIN SHORTLY. In a room, a message over 16 KB is dropped, and each socket gets a bucket of 480 messages refilling at 240 a second (about 4x a match's traffic); past it, messages are dropped, and after 1,000 drops the socket gets `reason: "flood"` and is closed. A room nobody has joined lasts 30 minutes; once its players have all left, its code stops working after 5 minutes (time to reload a page), and the alarm then deletes its storage and itself, leaving nothing behind.
- `src/net/rollback.js`: rollback netcode, GGPO style (see Rollback below). Both machines run the whole sim. Each runs its own input after a 2-frame delay (17 ms at 120 Hz), guesses the other player's input by repeating the last one it got, and keeps going; when the real input arrives and differs from the guess, it loads the state saved before that frame and re-runs the sim to the present, silently. Each side sends its input with every input the other side hasn't acknowledged, so a lost packet is covered by the next one. Every 30 frames, once a frame is confirmed (both real inputs in), each side hashes the sim (`src/net/hash.js`: positions, velocities, states, health, stamina, timers and every rig joint, by exact bits) and sends the hash; on a mismatch both show DESYNC and log the fields that differ to the console.
- `src/net/codec.js`: an input is 11 bits (direction, jump, guard, crouch, run, the four limbs, and whether it came from the touch stick, which turns off double-tap run). An input packet is 14 bytes plus 2 per frame.
- `src/net/online.js`: the session (host, join, start, leave), the connection readout (bottom-left; centered under the timer on a touch screen: `P2P 13 MS · RB 3 · DELAY 2`, the round trip, how many frames the last correction re-ran, and the input delay; amber when relayed, plus DESYNC or WAITING FOR RIVAL), and a lobby panel. The host is P1 (white, left), the guest P2 (orange); the HUD names them YOU and RIVAL. Each player gets the classic own-side view (see Mirrored view below), so on the guest's screen his orange fighter starts on the left. When both are linked the host picks the seed and both start the `online` scene from frame 0. Rematches follow by themselves: after the WINS card the sim reseeds from the match seed the same way on both machines. If the other player leaves, or nothing arrives for 10 seconds, the match ends; with the arcade flow running that's its VERSUS ONLINE end screen (YOUR RIVAL LEFT, CONNECTION LOST), and on a `?scene=` page it's a notice and the demo.

**Starting a match.** The game's menus call the API on `window.__net` (also returned by `createOnline` in `main.js`): `net.host()` resolves to `{ code, url }`, `net.join(code)`, `net.leave()`, `net.roomFromUrl()` reads `?room=`, and `net.on('status' | 'connected' | 'start' | 'peer-left' | 'end' | 'desync', fn)`. `net.openLobby('menu' | 'host' | 'join', code?)` opens the built-in panel (keyboard, gamepad and touch: arrows or D-pad move, Enter or A presses, Esc or B backs out, and on the code box up and down turn the letter like arcade initials). `net.busy` is true while that panel is up, so the title screen shouldn't start a game then. The menu flow (`src/flow/`) owns the VERSUS ONLINE entry, its own HOST and JOIN screens and the `?room=` hand-off; it talks to `online.js` only through `src/flow/netApi.js` (`adaptOnline`), ignores its own input while `net.busy`, and gets the end of a match through the `endMatch` hook in `main.js` (which closes the lobby's notice in favor of the flow's screen).

**Mirrored view.** The guest's screen shows the whole match flipped left-right; the sim on both machines is identical and never knows. `main.js`'s `syncMirror()` turns it on while an online match runs as the guest (or always with `?mirror=1`, which mirrors any scene for eyeballing and captures) and off when the match ends, however it ends. What it flips:

- **The world:** the WebGL canvas gets a CSS `scaleX(-1)`, so every layer, the compositor's lights, the floor reflection, particles, sparks and the camera shake flip together and can't drift apart. The arena's sign lettering (EXIT, the elevator's floor numbers) is counter-flipped in `src/arena/building.js` (`signText`) so it still reads, and the lower floor's arrow turns to point at the door.
- **The HUD** (its own canvas, never flipped) reads `camera.mirror`: the bars swap, so the guest's own bar (YOU, pink) is on the left and the rival's on the right, the hit counter and callouts go to the attacker's side of the screen, the arcade score follows P1's bar, the fighter boxes the callouts step around are mapped through the mirror, and the H hitbox overlay flips with the world while its labels read normally. Text, banners, menus, the touch controls and the sound panel are untouched.
- **Input:** `src/combat/input.js` `snapshot()` negates `dx` when `input.mirror` is set, after keyboard, D-pad, stick and the touch stick (synthetic A/D keys) are merged. That's the edge where the local input enters the net layer (`online.js`'s `sampleLocal` calls `game.input.snapshot()`), so the netcode sends and records world directions and both machines simulate the same thing. Forward and back were already relative to facing in the sim. A test's `net.setLocalSource()` input is world-space and isn't flipped.
- **Sound:** `gameAudio.setMirror(on)` flips the sign of the stereo pan.

**Determinism.** Netplay that runs the sim on both machines only works if both compute the same sim to the last bit. Run the same recorded input log through the sim in Chromium, Firefox and WebKit, with the builtin `Math.sin`, `cos`, `atan2`, `acos`, `hypot` and `pow`, and the rig's joints differ in the last bit by step 6 to 40 in every engine pair (the outcome still matched over 100 seconds, but every hash check would fail and the drift can flip a close hit). The sim and the rig now use `src/combat/dmath.js` instead: fdlibm's polynomials written with only + - * / and `Math.sqrt`, which IEEE 754 makes identical on every engine. With it, all three engines produce identical hashes on every step over 6000 steps, for a scripted bout and for a CPU-vs-CPU match. A match also starts with `sim.resetMatch({ fresh: true })`, which clears every leftover of earlier play (unit fields, the rig's jump arc and fall surfaces, the reach table the sim learns from hits): without it, each player's attract demo leaked in and the first hash check already failed.

**Rollback.** `src/net/rollback.js` keeps every frame's real inputs for both players in a 1024-frame history and moves the sim only through `simulate(frame)`.

- **Guessing.** A remote input that hasn't arrived is guessed as the newest one held. Before a frame runs on a guess, the whole sim is saved (`sim.saveState()`) into a ring of reused snapshots; frames run on real inputs need no snapshot. When a real input arrives and differs from the guess used for its frame, the next `advance()` loads the snapshot from before that frame and re-runs `simulate()` up to the present.
- **Depth.** At most 12 frames (100 ms) ever run on guesses (`MAX_ROLLBACK`); past that the sim waits for the other side (a stall: WAITING FOR RIVAL after 300 ms). Time spent stalled is given up, not banked, so a side doesn't burst ahead and stall again. The side that's ahead of the other (from the frame number in each packet and half the ping) runs 10% slow, 30% past 6 frames.
- **Delay.** The local input runs 2 frames late (17 ms). When half the ping plus the jitter is longer than the rollback window covers, the delay grows one frame a second (up to 10), and a second with stalls while not ahead adds one; it comes back down with headroom.
- **Save and restore.** `src/combat/snapshot.js` (`sim.saveState(reuse?)` / `sim.loadState(s)`) captures everything that feeds the next tick: the sim's fields (phase, timers, round, wins, card, callouts, combo, the horde and its ragdolls, the measurement log), the rng's state (`mulberry32` exposes `rng.state`), the reach table the sim learns from hits, the bounds, every unit field by value (its `prevJoints` points copied), each rig through `rig.getState()` / `rig.setState()`, and the arena state `tick()` mutates (its clock, door swings, the body pile and how settled each body is). The rig's state is its closure: the move and key list, the clock inside it, the pose and its velocity, the reaction layer, the springs, the point simulation (every point), the crossfade, the jump arc and landing ease, the fall surfaces and walls. What the rig mutates in place is copied both ways; poses, keys and move defs never change, so they're shared. A restore writes into the same unit and rig objects, so events, the HUD and the camera keep valid references. Saving takes about 20 µs, loading about 20 µs.
- **Effects.** The sim's events go through `sim.eventFilter` while the netcode runs it. The first simulation of a frame fires all its events and records them by identity (type, the units involved, move, callout text; position only for events with no unit, coarsely). A re-run of that frame fires only events beyond what already fired for it, counted, so two footsteps stay two: a hit the guess missed sparks and sounds up to 100 ms late, and nothing fires twice. An effect from a wrong guess isn't taken back (a stray spark or whoosh now and then). Sound, particles, lights, shake, callouts and the flow's scoring all hang off these events, so they all follow this policy; the HUD draws the current state, so a correction shows at once.
- **Hashes.** Only confirmed frames are hashed and compared: a frame is confirmed once both real inputs are in and no correction is waiting to re-run it. Every 30th frame's hash goes out then.
- **Proof of the save and restore.** A recorded CPU-vs-CPU bout (two showcase CPUs, their inputs and rng recorded, 14,000 steps each over six seeds, including round and match ends) was replayed with about 5,500 rollbacks: at random frames and, more often, at frames in hitstop, throws, wall splats, juggles, ragdolls, KOs, floor breaks, the stair tumble, the follow-down vault, getups and match ends, save, run 1 to 16 steps, restore, run again, restore, run again. A deep hash of every sim field, every unit field and the rig's whole `getState()` matched the reference run on all 132,000 checked steps; leaving out the rig, the rng or the arena clock from the restore fails it at once. The stamina faint and combo decay (sim behavior, so `NET_VERSION` is 3) keep their state in plain unit fields (`faint`, `faintDmg`, `faintAt`, `comboDmg`, `selfChain`, `lastHitAt`), which the snapshot copies with every other unit field; a save, run 480 to 900 steps, restore and replay of the recorded inputs (and the CPU's rng state after each of its calls) matched the full snapshot on every step, saved mid-faint, mid-combo and before either, and knocking one step off the restored faint clock made it differ on the first step.
- **Cost.** The worst case, every rendered frame restoring the state from 8 frames back and re-running 8 frames (saving each), over a 12,000-step bout on an M-series Mac: Chromium 0.35 ms per rendered frame on average (p99 0.9 ms, one 5.7 ms garbage-collection spike), WebKit 0.18 ms, Firefox 0.23 ms, Node 0.34 ms (max 1.5 ms). At 12 frames, Chromium 0.41 ms average, 1.4 ms max. A plain step is 16 to 36 µs. In the network tests below the netcode's whole `advance()` averaged 0.2 to 0.4 ms per frame, and the longest single correction took 2 ms.
- **Network tests.** Two browsers of different engines played 3,600 frames (30 s) of scripted, human-paced input through the local Worker with `?netsim=` on both pages, peer to peer (Chromium and Firefox) and through the forced relay (`?relay=1`, Chromium and WebKit). Every confirmed hash (120 checks a side) and the final hash matched on both sides in all eight runs. Rollbacks are per side over the 30 s; depth in frames of 8.3 ms.

  | Added RTT, jitter, loss | Path | Measured RTT | Delay | Rollbacks | Avg / max depth | Stalls |
  |---|---|---|---|---|---|---|
  | 0 | P2P | 11–20 ms | 2 | 1, 6 | 1.0–1.3 / 2 | 0 |
  | 0 | relay | 21–26 ms | 2 | 24, 0 | 1.1 / 2 | 0 |
  | 60 ms, ±8, 2% | P2P | 127–143 ms | 3 | 110, 316 | 5.5, 4.6 / 12 | 43, 0 |
  | 60 ms, ±8, 2% | relay | 91–106 ms | 2 | 307, 230 | 3.9, 1.9 / 11 | 0 |
  | 120 ms, ±15, 3% | P2P | 165–181 ms | 5–10 | 101, 309 | 5.9, 5.6 / 12 | 57, 8 |
  | 120 ms, ±15, 3% | relay | 149–160 ms | 2 | 314, 320 | 6.1, 5.4 / 12 | 2, 0 |
  | 200 ms, ±25, 5% | P2P | 281 ms | 10 | 118, 313 | 6.9, 7.8 / 12 | 73, 35 |
  | 200 ms, ±25, 5% | relay | 226–230 ms | 6–7 | 302, 324 | 6.1 / 12 | 14, 1 |

  The P2P runs measure 60 to 80 ms more round trip than was added, with 30 to 45 ms of jitter: headless Firefox's DataChannel delivery, not the netcode (the relay runs, through the same Worker, measure close to what was added). Past about 200 ms of round trip the guesses can't cover the trip and the delay and some stalls take over, as designed.
- **Testing it yourself.** `?netsim=LATENCY,JITTER,LOSS` on the URL delays everything this side sends by LATENCY ms (one way), give or take JITTER, and drops LOSS percent of game packets; put it on both pages (`?netsim=30,5,2` on each is about 60 ms of round trip). `net.setLocalSource(fn)`, `net.haltAt(frame)`, `net.stats()` (rollbacks, depths, costs, held and late events, confirmed frame) and `net.netcode.hashes` drive and check a scripted match.

## Layout

- `index.html`, `src/main.js` — the game. Wires the modules below.
- `src/fighter/` — stick figure rig, poses, animation. Draws to a 2D context.
- `src/fx/` — lighting and effects compositor (WebGL), particles, camera shake.
- `src/combat/` — input, state machine, frame data (heights, stamina costs, enders), the string table (`strings.js`), hitboxes, AI, the neon HUD, rounds.
- `src/flow/` — the arcade flow (see Arcade flow): `index.js` the state machine and its screens, `ui.js` the DOM overlay (neon, hard corners, scales with the stage), `menuInput.js` keys and pad for menus, `ladder.js` the six stages, `scores.js` score rules and the high score tables, `netApi.js` the seam to `src/net/online.js`.
- `src/net/` — online play (see Multiplayer): `online.js` session, readout and lobby; `link.js` WebSocket and WebRTC; `rollback.js` netcode; `codec.js` wire format; `hash.js` state hash. The sim's save and restore for rollback is `src/combat/snapshot.js` (plus `getState()`/`setState()` on the rig in `src/fighter/index.js`).
- `worker/` — the Worker script and its room Durable Object (`index.ts`), with its own `tsconfig.json`.
- `src/combat/dmath.js` — bit-identical trig for the sim and the rig on every browser engine (see Multiplayer, Determinism).
- `src/touch.js` — mobile touch controls (synthetic key events, active only on coarse pointers).
- `src/arena/` — the stage: geometry, background art, static lights.
- `src/audio/` — sound effects and music (see Sound). `main.js` makes two calls into it: `gameAudio.attach(sim)` and `gameAudio.event(ev)` from its event router. During the attract demo (and the menus over it) it holds the events back and attaches `null` instead of the sim (so the whiff watcher is quiet too), then attaches the sim again when a game starts.
- `demo/*.html` — one page per module so each can be judged alone.
- `window.__game.advance(ms)` steps the game without drawing a frame (fast, for counting events over a long demo); `window.__gauntlet.step(ms)` steps and draws.
- `gauntlet/` — the quality loop: the brief (with the owner requirements), the capture tool and the workbench log. The reference images and per-round critic captures stay out of the public repo (see `.gitignore`); the reference images belong to their owners.

## Sound

Everything audio lives in `src/audio/`, and none of it uses sample files.

- `index.js` — the router: turns sim and fighter events into effects, pans each by the fighter's screen x (flipped by `gameAudio.setMirror(true)` in a mirrored view), and watches for whiffs (a strike reaching recovery without contact) and for which pool the music belongs in. It also owns the unlock on the first touch or key, M and N, the settings, and the phone's media player (`navigator.mediaSession`: "Stick Fight · <track>" with play, pause, next and previous). `window.__audio` exposes it for tests.
- `sfx.js` — the effects, built on the spot from a second of white noise and a few oscillators, each with a little random variation: whooshes by limb (a jab short and high, kicks longer and lower, the spinning enders longest), hits, block, counter (the heaviest hit short of an ender, a second snap and a bright ping), footsteps, landings, the jump, a body fall with a slide, wall splat, wall bounce, ground bounce, the throw (a grab rustle, then a slam), whiff, the exhale of a faint, ROUND and FIGHT, KO, the slow-motion ender KO (pitched down with a long tail of echoes), combo notes that climb with the hit count, the ender stinger, a horde goon down, the match end, and UI clicks. The multi-floor events have theirs too: a floor break (a crash, debris and a railing clanging), a knock per stair tread, a vault landing, and a floor-clear stinger. A hit is built in layers scaled by its weight (a jab light, a cross a bit more, a heavy, a counter, an ender or a KO the most): a crack of a few milliseconds for the contact, a punch falling through 300 to 120 Hz that a phone speaker can play, a sub thump into 40 to 55 Hz for headphones, a lowpassed tail, a crunch through a tanh shaper on the heavies, and on an ender or a KO a long low boom with a harmonic a phone can hear. A light hit stays about 0.15 s long so a fast string doesn't smear, and the combo note and the ender stinger come in 15 and 30 ms behind the crack, under it. Effects go through a compressor, a limiter and a soft clip, so a horde pile-up can't clip. Impacts (hits, wall splats and bounces, the ground bounce) skip the compressor on a bus of their own, because through it every hit came out at the same peak, a jab as loud as a KO. At most 16 sound at once (a new one steals the oldest of the lowest priority; footsteps go first). The effects have their own AudioContext.
- `music.js` + `tracks.js` — the soundtrack, written as [Strudel](https://strudel.cc) code and played through Strudel, after cf-quarry's player. Strudel is only imported the first time music turns on. A track plays its form twice, then the next track in the current pool starts. The pool follows the game: `menu` on the title and its attract demo, the mode select, the online menus, the high score tables, game over, initials and the ending; `fight` for a normal match, `horde` in horde mode (each cleared floor moves to the next horde track), `calm` in training (the dummy scene). The arcade flow names the pool for each screen through `gameAudio.setMusicPool(pool)` (null hands it back); without the flow (a `?scene=` page) the audio module guesses it from the sim four times a second, and `?scene=attract` plays `menu`. The music ducks under the KO stingers, the slow-motion ender, the floor break and FIGHT, and gets a quick sidechain-style dip under a hit (`music.pump`): none for a jab, so a fast string doesn't wobble it, about 2.5 dB for a cross, 6 for a heavy, 8 for a counter or a throw, and 10.5 for an ender or a wall splat, down in 10 ms and back in 0.1 to 0.35 s. A silent looping `<audio>` plays beside it so a phone shows its media player.
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
| Insert Coin | menu | 116 | B minor | the cabinet in the lobby: bit-crushed square arpeggios, a triangle bass, the theme on a pulse lead |

**The Strudel bundle.** `public/vendor/strudel.mjs` is the `@strudel/web` 1.3.0 bundle (850 KB), copied unmodified from cf-quarry, with its license text beside it in `public/vendor/LICENSE`. It lives in `public/` so Vite copies it into the build untouched; `music.js` imports it at runtime by URL, because the bundle resolves its own helper files relative to itself. Its source is at https://codeberg.org/uzu/strudel.

## License and credits

The game is free software under the GNU Affero General Public License v3.0 or later; see `LICENSE`. If you serve a modified version to players, the AGPL asks you to offer them its source.

- **Music engine:** [Strudel](https://strudel.cc) by the Strudel contributors, AGPL-3.0-or-later, source at https://codeberg.org/uzu/strudel. The seven tracks in `src/audio/tracks.js` are written as Strudel patterns and played by it.
- **Fonts:** [Bungee](https://fonts.google.com/specimen/Bungee) by David Jonathan Ross and [Teko](https://fonts.google.com/specimen/Teko) by the Indian Type Foundry, both SIL Open Font License, loaded from Google Fonts.
- **Inspiration:** the animation bar is Xiao Xiao, Zhu Zhiqiang's stick-figure fight series. No art from it ships with the game.

The sound panel and the attract screen link back here.

## Practices

- No framework, no npm deps at runtime. Game modules stay plain `.js` (not `.ts`) so the capture tool's raw file server can load them; the Worker is TypeScript, built by wrangler. Playwright (global) only for `gauntlet/capture.mjs`.
- Logical resolution 1280x720, DPR-aware. Everything positions in logical pixels.
- Each module owns its folder and its demo page. Cross-module contracts live in `gauntlet/BRIEF.md`.
- Commit after every gauntlet round with the round number in the subject.
- The capture tool serves files raw, without Vite, so anything `main.js` imports has to be plain JavaScript; that's why `src/flow/` is JS with JSDoc types rather than TypeScript.
- Capture output is large (about 1.3 MB per frame). Delete capture folders when a round is done; `gauntlet/captures/` is gitignored.
