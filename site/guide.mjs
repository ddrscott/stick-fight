// The How to Play pages (README, "Site"), generated beside the fighter pages so they share the header,
// footer and the controls tables:
//   how-to-play/              the buttons, the rules and the controls tables (src/flow/controls.js)
//   how-to-play/philosophy/   the design pillars (README, "Design pillars"), written for players
//   how-to-play/strategy/     what beats what, stamina, punishing, the floor and the air, the ladder
// Every number here is the game's (README, "Controls" and "Fundamentals"); change both together. The secret
// boss and the happy accidents stay hinted, never named.

import { head, topbar, footer, script, controlsTable } from './templates.mjs';

const PAGES = [
  { key: '', label: 'THE RULES', title: 'How to play' },
  { key: 'philosophy', label: 'THE PHILOSOPHY', title: 'The philosophy' },
  { key: 'strategy', label: 'STRATEGY', title: 'Strategy' },
];

function guideNav(here, root) {
  const base = `${root}how-to-play/`;
  return `<nav class="s-guide-nav" aria-label="How to play">
    ${PAGES.map((p) => `<a href="${base}${p.key ? p.key + '/' : ''}"${p.key === here ? ' aria-current="page"' : ''}>${p.label}</a>`).join('\n    ')}
  </nav>`;
}

function shell({ key, root, h1, kicker, description, body }) {
  const p = PAGES.find((x) => x.key === key);
  return `${head({ root, title: `${p.title} · Neon Stick Fight`, description, path: `how-to-play/${key ? key + '/' : ''}`, page: key ? `how-to-play:${key}` : 'how-to-play' })}
<body class="s-page s-guide">
${topbar(root)}
<main class="s-main">
  ${guideNav(key, root)}
  <section class="s-section">
    <p class="s-kicker">${kicker}</p>
    <h1 class="s-h1">${h1}</h1>
${body}
  </section>
  <div class="s-cta s-cta-center"><a class="s-btn s-btn-play s-btn-big" href="${root}play/">CLOCK IN</a></div>
</main>
${footer(root)}
${script(root)}
</body>
</html>
`;
}

// ---- the rules ------------------------------------------------------------------------------------------
export function rulesPage({ FIGHT, MENUS, FACE, PILL }) {
  const root = '../';
  return shell({
    key: '', root, kicker: 'HOW TO PLAY', h1: 'THE RULES',
    description: 'How to play Neon Stick Fight: one button per limb, guard, throws, stamina, the parry, getting up, and the controls for keyboard, gamepad and touch.',
    body: `    <p class="s-lede">One button per limb, like Tekken, from your fighter's own point of view, plus a direction. There are no motion inputs to memorize. Everything else is reading the person across from you.</p>
  </section>

  <section class="s-section s-howto" aria-labelledby="buttons-h">
    <h2 class="s-h2" id="buttons-h">THE BUTTONS</h2>
    <div class="s-how-cols">
      <div>
        <div class="s-pad" role="img" aria-label="The four limb buttons: 1 left punch, 2 right punch, 3 left kick, 4 right kick">
          <div><b>1</b><span>LEFT PUNCH</span><small>jab · key U</small></div>
          <div><b>2</b><span>RIGHT PUNCH</span><small>cross · key I</small></div>
          <div><b>3</b><span>LEFT KICK</span><small>snap kick · key J</small></div>
          <div><b>4</b><span>RIGHT KICK</span><small>roundhouse · key K</small></div>
        </div>
        <p class="s-note s-pad-note">Add a direction for more: down and a button for the low attacks and the uppercut, toward and a button for the body blow, the lunge and the overhead. Every fighter's own moves are on their page.</p>
      </div>
      <dl class="s-rules">
        <div><dt>GUARD</dt><dd>Hold back, away from the other fighter. You walk back, and your guard snaps up on its own when an attack is coming that can reach you. Standing guard stops highs and mids. Lows go under it, so hold down and back for those.</dd></div>
        <div><dt>PARRY</dt><dd>Tap toward the other fighter just before a hit lands, down-forward for a low. Nothing gets through and they reel long enough to eat a jab. It has to be a fresh tap: holding forward, dashing or mashing never parries, and a tap that guesses wrong leaves you walking into the hit.</dd></div>
        <div><dt>THROWS</dt><dd>1+3 or 2+4 up close. A throw beats a guard but whiffs on someone crouching. Press the same two buttons while you're grabbed to break it.</dd></div>
        <div><dt>STAMINA</dt><dd>The thin bar under your health is your attack budget. Every swing spends some, a hit gives half of it back (a blocked one a quarter, a whiff nothing), and it refills fast once you stop swinging.</dd></div>
        <div><dt>FAINT</dt><dd>Spend the last point and you faint: out on your feet for a beat, rooted to the spot, no guard, wide open. Press left and right in turn on a steady beat to shake your head clear sooner; holding or mashing one way does nothing. If the swing that emptied the bar lands, you're left on fumes instead. Getting knocked down fills the bar back up.</dd></div>
        <div><dt>KNOCKED DOWN</dt><dd>You stay down until you choose. Up stands in place, away rolls back on your side, toward rolls under them to their other side if they're standing close, and a button strikes from the floor: 1 or 3 is a mid kick, 2 or 4 a low sweep. They can't be hit until they swing, but they're easy to punish if blocked. Do nothing and you stand after a second.</dd></div>
        <div><dt>STOMP</dt><dd>Down and 4 over a fighter on the floor stomps them for real damage. A low that visibly touches them (down and 3, down and 1) is a lighter ground hit, once per knockdown. Land it and you have time to guard their wake-up strike. Whiff it, when they roll or strike up through it, and you're the one wide open.</dd></div>
        <div><dt>AIR RECOVERY</dt><dd>Juggled or launched, press a button once the hits stop and you flip upright and land on your feet. Press right as the window opens and you come out with a jab. Press too early and you're locked out, so mashing never saves you.</dd></div>
        <div><dt>STRINGS</dt><dd>Press in rhythm, as the last hit finishes, and the hits chain: 1, 2, 3, 4 is the Neon Tornado. Mashing doesn't chain. Every fighter's strings are on their page.</dd></div>
        <div><dt>ROUNDS AND TIME</dt><dd>A match is best of three rounds of 99 seconds. Change either one from the mode select or the pause menu: best of 1, 3 or 5, and 30, 60 or 99 seconds or no limit. In the last 10 seconds the clock turns pink and pulses. When time runs out, whoever has more health left takes the round.</dd></div>
        <div><dt>SOUND</dt><dd>Browsers keep a page quiet until you touch it, so the first click, tap or key turns the sound on. M turns the music off and on, N skips a track.</dd></div>
      </dl>
    </div>
  </section>

  <section class="s-section" aria-labelledby="controls-h">
    <h2 class="s-h2" id="controls-h">THE CONTROLS</h2>
    <p class="s-note">Keyboard, any standard gamepad (Xbox, PlayStation, 8BitDo) or the touch screen. The game switches its button hints to whatever you pick up. Pause and pick MOVE LIST (or press F1, or Y on a pad) for your fighter's full move list, with every string and a preview of each move; the character select has one for every fighter.</p>
    <div class="s-controls-wrap">
      ${controlsTable(FIGHT, MENUS, FACE, PILL)}
    </div>
  </section>

  <section class="s-section">
    <div class="s-guide-next">
      <a href="philosophy/"><b>THE PHILOSOPHY ›</b><span>Why timing beats speed, and why mashing loses.</span></a>
      <a href="strategy/"><b>STRATEGY ›</b><span>What beats what, and how to fight each coworker on the ladder.</span></a>
    </div>`,
  });
}

// ---- the philosophy --------------------------------------------------------------------------------------
export function philosophyPage() {
  const root = '../../';
  const pillar = (n, h, body) => `      <article><p class="s-pillar-n">${n}</p><h2 class="s-h3">${h}</h2>${body}</article>`;
  return shell({
    key: 'philosophy', root, kicker: 'HOW TO PLAY', h1: 'THE PHILOSOPHY',
    description: 'The ideas behind Neon Stick Fight: timing, not speed; give and take, like tai chi and aikido; mashing loses; simple bodies, deep systems.',
    body: `    <p class="s-lede">A few ideas decide how this game plays. Every mechanic was built against them, so knowing them tells you how to win. They also happen to be a decent way to survive an office.</p>
    <div class="s-pillars">
${pillar('01', 'TIMING, NOT SPEED', `<p>Skill here is pressing one thing at the right moment because you saw what the other player committed to. It's never how many buttons you can hit in a second. Nobody wins on fast, simple input, and nothing in the game asks for a reflex younger than you are.</p>`)}
${pillar('02', 'GIVE AND TAKE', `<p>Like tai chi and aikido: wait for the other player to commit, then use their own force. The harder someone swings, the harder they fall when you read it. Every option has an answer, and every answer costs something when it's guessed wrong.</p><p class="s-note">It's the meeting where you let the loudest person talk themselves into a corner.</p>`)}
${pillar('03', 'MASHING LOSES', `<p>A press thrown where it doesn't belong botches: you overbalance, spin out or trip over your own feet. Every swing costs stamina, and the last point leaves you fainted and open. No defense comes out of a held direction or a repeated button, and nothing lets you mash your way out of trouble.</p><p class="s-note">Reply-all in a panic and everyone sees it.</p>`)}
${pillar('04', 'SIMPLE BODIES, DEEP SYSTEMS', `<p>The fighters are stick figures and the controls are a direction plus one button. Strings have a rhythm, not a speed. The depth is in how the bodies move: the same physics that tangles a mistimed press rewards one timed exactly right. A few mistakes, made at just the right moment, turn into something much better.</p>`)}
${pillar('05', 'WINDOWS YOU CAN LEARN', `<p>A timing window can be generous when missing it costs you. The parry gives you about a tenth of a second, but a tap that guesses wrong walks you straight into the hit. A tight window that's free to try is a reflex test. A wider one that commits you is a read.</p>`)}
    </div>
  </section>

  <section class="s-section">
    <div class="s-guide-next">
      <a href="../"><b>‹ THE RULES</b><span>The buttons, guard, throws, stamina and the controls.</span></a>
      <a href="../strategy/"><b>STRATEGY ›</b><span>Putting it to work, floor by floor.</span></a>
    </div>`,
  });
}

// ---- strategy --------------------------------------------------------------------------------------------
export function strategyPage() {
  const root = '../../';
  const tip = (h, body) => `      <article><h2 class="s-h3">${h}</h2>${body}</article>`;
  return shell({
    key: 'strategy', root, kicker: 'HOW TO PLAY', h1: 'STRATEGY',
    description: 'Strategy for Neon Stick Fight: what beats what, spending stamina, punishing, the parry, anti-airs, the wake-up game, juggles, and how to beat each opponent on the arcade ladder.',
    body: `    <p class="s-lede">Nobody makes it out of temp work by swinging at everything. Here's how to read the room, spend your energy, and make people pay for overcommitting.</p>
  </section>

  <section class="s-section" aria-labelledby="rps-h">
    <h2 class="s-h2" id="rps-h">WHAT BEATS WHAT</h2>
    <p class="s-note">Nothing is safe to sit in. Every defense has a hole, and the game is guessing which one they'll use.</p>
    <div class="s-table-wrap"><table class="s-table s-beats">
      <thead><tr><th>IF THEY…</th><th>IT STOPS</th><th>IT LOSES TO</th></tr></thead>
      <tbody>
        <tr><th scope="row">guard standing (hold back)</th><td>highs, mids, overheads, air attacks</td><td>lows, throws</td></tr>
        <tr><th scope="row">guard low (down-back)</th><td>lows; a crouch ducks highs and throws</td><td>mids, overheads (→4), air attacks</td></tr>
        <tr><th scope="row">throw (1+3 or 2+4)</th><td>any guard</td><td>a crouch, a strike first, the same buttons to break it</td></tr>
        <tr><th scope="row">parry (tap toward)</th><td>the one strike it read</td><td>throws, the wrong height, a feint, a delay</td></tr>
        <tr><th scope="row">swing</th><td>someone walking in or starting a move (a counter hit)</td><td>a guard, then the punish</td></tr>
      </tbody>
    </table></div>
  </section>

  <section class="s-section">
    <div class="s-tips">
${tip('SPEND STAMINA LIKE A BUDGET', `<p>The bar is out of 100. A jab costs 17, a cross 21, a kick 22, a string ender 30. Mash jab and you're empty on the sixth press; a full four-hit string takes 85 to 92. It refills at 90 a second once you've gone a third of a second without spending, so one beat of walking buys most of it back. Landing hits keeps you going: a hit gives back half its cost and a blocked hit a quarter, so a combo that connects costs about half what it says. A whiff gives back nothing, and the same move landing again right away gives back half as much each time.</p><p>Leave enough to finish what you start. If the swing that empties the bar hits, you stay on your feet with almost nothing left; if it whiffs or gets blocked, you faint. Under 35 the bar flashes LOW, and an empty bar faints you for a second and a half, rooted and with no guard. Shaking it off with left and right on a steady beat gets you out in a little under a second at best, which still leaves them time to punish. Blocking only costs a third of the hit and never takes your last point. Getting knocked down fills the bar, so the fighter on the floor is never the tired one.</p>`)}
${tip('PUNISH WHAT THEY COMMIT TO', `<p>A whiffed or blocked move has recovery, and that's your turn. The jab is your fastest answer. Hit someone during the startup of their move and it's a counter hit: 35% more damage and more stun. A botch is an invitation, and one that spins them round leaves their back to you, where every hit counts as a counter.</p><p>Every fighter's page lists how many frames each move is minus on block. Red numbers are your turn.</p>`)}
${tip('THE PARRY IS A READ', `<p>Tap toward them about a tenth of a second before the hit lands, or down-forward for a low. Nothing gets through and they reel for 16 frames, long enough for a jab or a cross. One tap catches one strike, and each tap locks out the next for a moment, so you can't tap twice.</p><p>Save it for the move they always end on. A tap that guesses wrong walks you forward into the hit, and it never stops a throw. Higher up the ladder, the CPU parries too.</p>`)}
${tip('STRINGS, NOT CHAINS', `<p>Press in rhythm as each hit finishes. Start a string with a jab that lands, and it's a true combo. Nothing loops: hits after the third do less damage and stun less, and once one combo has done 30 damage the rest counts a quarter. Don't chase a long combo. Take the knockdown and make them guess on the way up.</p>`)}
${tip('STOP THE JUMP-INS', `<p>Air attacks are overheads, so guard them standing. Better: an uppercut (down and 2, or let go of down and press 2) that meets a jump-in is a counter hit that launches. A jab stuffs a late one, and a standing tap parries one.</p>`)}
${tip('ON THE FLOOR, YOU CHOOSE', `<p>Knocked down, you lie there until you pick: up stands, away rolls back and keeps your side, toward rolls under someone standing close and comes up on their far side, 1 or 3 is the Wake Kick (mid), 2 or 4 the Wake Sweep (low). The strikes can't be hit until they swing, but they're 17 to 24 frames minus if blocked, so throwing one into a guard gets you punished on the rise.</p><p>Standing over someone, you're the one guessing. A standing guard stops the kick and walks you back out of the sweep's reach; a crouching guard stops the sweep and eats the kick.</p>`)}
${tip('STOMP, THEN GUARD', `<p>Down and 4 over a body on the floor stomps it for 9 (a low kick or low jab that touches it does about half its damage instead). On a hit it pins them long enough for you to raise your guard before their fastest wake-up strike lands, so guard and punish the rise. Keep pressing buttons and the wake-up strike lands on you. Whiff it, on a roll or a strike rising through it, and you're open for about 25 frames. Every knockdown allows one ground hit, so nothing loops on a body that's down.</p>`)}
${tip('JUGGLED? COUNT, THEN PRESS', `<p>Wait for the hits to stop, count the beat, and press once: you flip upright and land on your feet. Press in the first moment of the window and you come out with a jab. Press too early and you're locked out, and every press while you're locked keeps you locked.</p>`)}
${tip('NO PANIC BUTTONS', `<p>A press during your own strike botches unless it's the next hit of a string. Wait for the move to finish, or press right at the end of it, and the next one comes out clean. Botching with under 30 stamina faints you on the spot.</p>`)}
${tip('MIND THE WALLS', `<p>A wall splat sticks you to the wall for a free hit, and a wall bounce relaunches you into a juggle. Spin Heel (2, 1, 4), the Comet Cross out of a run, and a throw near the wall all splat. Fight in the middle of the floor and put them in the corner.</p>`)}
    </div>
  </section>

  <section class="s-section" aria-labelledby="ladder-h">
    <h2 class="s-h2" id="ladder-h">WORKING THE LADDER</h2>
    <p class="s-note">The arcade climbs the building one coworker at a time, and each CPU fights its own way. If you pick one of them, someone else takes that floor.</p>
    <dl class="s-rules">
      <div><dt>INTERN</dt><dd>Swings at everything and botches a lot. Guard, let them run out of stamina, and punish the stumble.</dd></div>
      <div><dt>HELPDESK</dt><dd>A turtle: guards, waits at range and punishes your whiffs. Ticket Closed (back and 1) parries any high or mid, so open them up with lows and throws.</dd></div>
      <div><dt>COURIER</dt><dd>Rushdown: runs in and never backs off. Guard first, then punish. Express Slide goes low under highs, so don't just stand there blocking.</dd></div>
      <div><dt>SECURITY</dt><dd>A grappler. Escort is a command grab that can't be broken, and Shoulder Check is an armored charge that shrugs off a jab. Stay out of reach and make them swing first.</dd></div>
      <div><dt>JANITOR</dt><dd>Fights from the air with jump-ins on the lower floor. Have the uppercut ready, and guard standing.</dd></div>
      <div><dt>THE MANAGER</dt><dd>Your performance review. Never botches, parries, and Downsizing is an axe-kick overhead that hits a crouch. Mix your heights and don't get greedy.</dd></div>
    </dl>
    <p class="s-note">Make it to the top without a continue and someone else will want a word.</p>
  </section>

  <section class="s-section">
    <div class="s-guide-next">
      <a href="../philosophy/"><b>‹ THE PHILOSOPHY</b><span>The ideas behind all of this.</span></a>
      <a href="../../fighters/"><b>THE CAST ›</b><span>Every fighter's moves, strings and frame data.</span></a>
    </div>`,
  });
}
