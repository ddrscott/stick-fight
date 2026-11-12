// The privacy notice and the house rules (README, "Privacy and terms"), generated beside the How to Play
// pages so they share the header and footer:
//   privacy/   what the game keeps, where, for how long, who sees it, and how to delete it
//   terms/     the house rules: trash talk yes, bullying no, how to report
// Written for a 12-year-old: short sentences, question headings, a short version at the top. Every claim
// here is what the code does (README, Analytics, Profiles and sign-in, Crew rooms, Spectators); change the
// page when the code changes, and the date with it.

import { head, topbar, footer, script } from './templates.mjs';

export const UPDATED = '2026-11-12';
export const CONTACT = 'hey@askscottpierce.com';
const mail = (subject) => `<a href="mailto:${CONTACT}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}">${CONTACT}</a>`;

function shell({ path, root, title, h1, kicker, description, short, body, other }) {
  return `${head({ root, title: `${title} · Neon Stick Fight`, description, path, page: path.replace(/\/$/, '') })}
<body class="s-page s-legal">
${topbar(root)}
<main class="s-main">
  <section class="s-section">
    <p class="s-kicker">${kicker}</p>
    <h1 class="s-h1">${h1}</h1>
    <p class="s-updated">Last updated <time datetime="${UPDATED}">${UPDATED}</time> · Questions: ${mail()}</p>
    <div class="s-short">
      <h2 class="s-short-h"><span aria-hidden="true">//</span> THE SHORT VERSION</h2>
      <ul>
        ${short.map((s) => `<li>${s}</li>`).join('\n        ')}
      </ul>
    </div>
  </section>
${body}
  <section class="s-section s-legal-end">
    <p>${other}</p>
  </section>
  <div class="s-cta s-cta-center"><a class="s-btn s-btn-play s-btn-big" href="${root}play/">BACK TO THE FIGHT</a></div>
</main>
${footer(root)}
${script(root)}
</body>
</html>
`;
}

/** one question and its answer */
const q = (id, question, html) => `  <section class="s-section s-q" aria-labelledby="${id}">
    <h2 class="s-h2" id="${id}">${question}</h2>
${html}
  </section>`;

// ---- the privacy notice ---------------------------------------------------------------------------------
export function privacyPage() {
  const root = '../';
  return shell({
    path: 'privacy/', root, title: 'Privacy', kicker: 'WHAT WE KEEP', h1: 'PRIVACY',
    description: 'What Neon Stick Fight keeps about you, written so anyone can read it: anonymous game counts, nicknames, an email only if you save your profile, and how to delete it all.',
    short: [
      'You can play everything without telling us anything about you. No account needed.',
      'We count things like which fighters get picked. Those counts never have your name, email or player id on them.',
      'The name other players see is a nickname you pick. <b>Use a nickname, not your real name.</b>',
      'If you save your profile, we keep your email so we can send you sign-in codes. Nobody else sees it. No newsletter, ever.',
      'Under 13? We don\'t ask for your email at all. Your profile stays on your device.',
      `No ads. We don't sell anything about you. Saved a profile? <b>DELETE MY PROFILE</b> on the PROFILE screen deletes it. Anything else, email ${mail('Delete my data')}.`,
    ],
    other: `The other half of this is the <a href="${root}terms/">house rules</a>: trash talk is fine, bullying isn't.`,
    body: [
      q('who', 'Who runs this?', `    <p>Neon Stick Fight is a free game made by Scott Pierce as a side project. It lives at <a href="${root}">neonstickfight.com</a> (it used to be at askscottpierce.com/stick-fight). If you have a question about anything on this page, email ${mail()}.</p>`),

      q('account', 'Do I need an account?', `    <p>No. Arcade, horde, training, quick online matches, crews and watching other matches all work without one. When you play online, the game hands you a nickname (like GUEST 427) or lets you pick one. That nickname and a random player id are kept on your device, not on our server.</p>
    <p><b>Saving your profile</b> with an email is optional. It lets you sign in on another phone or computer and keep the same name, crews and records.</p>`),

      q('collect', 'What do we collect?', `    <h3 class="s-h3">Game counts (everyone)</h3>
    <p>While you play, the game sends small notes to our server, like "someone picked COURIER in arcade" or "a match ended by KO after 64 seconds." They're how we know which fighters are too strong and which modes people play. Each note says:</p>
    <ul>
      <li>what happened (a pick, a match, a move used, a stage reached), the fighters, and numbers like hits and match length;</li>
      <li>how smoothly the game runs on your device, once a visit: the frame times, the graphics level it settled on, and a rough sort of device. That's only broad groups: the kind of system (like Chromebook, Android or Windows), the maker family of the graphics chip (like Intel or Mali, or "software" when there's no graphics chip), whether it has 2, 4 or 6+ processor cores, and whether it has 4 GB of memory or less. Never the exact model, and nothing that could pick your device out from others like it;</li>
      <li>whether you're on a phone or a computer, and which website sent you here (just the site's name);</li>
      <li>the country you're in, which Cloudflare (the company that runs our servers) works out from your connection.</li>
    </ul>
    <p>They <b>never</b> carry your name, email, player id or internet address. The game doesn't send them at all if your browser has <b>Do Not Track</b> or <b>Global Privacy Control</b> turned on. The notes are deleted after three months. We also keep running totals (how many times each fighter was picked, who wins which matchup, which moves finish matches). Those are just numbers with no player in them, so they stay. They're what the stats on the homepage and the game's title screen show.</p>

    <h3 class="s-h3">Page views (everyone)</h3>
    <p>The site uses a page counter called Plausible (at plausible.ljs.app). It counts visits to each page without cookies and without keeping your internet address.</p>

    <h3 class="s-h3">Your saved profile (only if you save it)</h3>
    <ul>
      <li><b>Your email address</b>, so we can send you a 6-digit sign-in code. We don't use it for anything else.</li>
      <li>Your random player id, your nickname, the crews you've been in (up to 20), and the size you picked for the touch controls.</li>
      <li>When you first saved it and when you last signed in.</li>
      <li>While you're signing in: the code, stored scrambled (a hash) so not even we can read it. It expires in 10 minutes.</li>
      <li>One cookie, <code>sf_session</code>, which keeps you signed in for 30 days. Its server copy is scrambled too.</li>
      <li>To stop people guessing codes, we count sign-in tries per email and per internet address. Those counters are cleared out after about a day.</li>
    </ul>

    <h3 class="s-h3">Crews</h3>
    <p>A crew is a room with a link you share with friends. The crew keeps its name and, for each member: their nickname, a scrambled member id (not their player id), when they first and last showed up, wins, losses, draws, rounds, favorite fighter and last pick, how they've done against each other member, and the last 300 matches (who played who, with which fighters, and the score). Everyone who has the link and opens it can see all of that.</p>
    <p><b>Crew high scores.</b> Each crew has its own arcade and horde tables, the top 10 of each. A finished run is sent to the crews on your device's recent list, and a crew keeps it only if you're a member. A row shows the three initials you entered, the score, the fighter, how far the run got and the date. The server remembers which member sent each row, so it can limit how often you post and mark your own rows in your lobby, but the table never shows other people who sent it.</p>
    <p><b>Crew stats.</b> The crew also adds up time played, matches, the fighters picked most, and each member's time played and favorite fighter. Everyone with the crew link sees these.</p>
    <p><b>Game-wide time and the live count.</b> Every match, even one you quit or leave partway (and time spent in training), adds to totals of time played per mode per day, and the server counts how many matches are going on right now. Both are just numbers with no player in them.</p>

    <h3 class="s-h3">Quick matches</h3>
    <p>A quick room (a four-letter code) lives in our server's memory while it's open. Nothing about it is saved, except the match result while both players' games agree on it and when the match started (so the time played still counts if someone leaves), and the room is gone within 30 minutes of everyone leaving.</p>`),

      q('names', 'Who can see my name?', `    <ul>
      <li><b>Your rival</b> in an online match sees your nickname.</li>
      <li><b>Spectators.</b> A quick match can show up under LIVE NOW on the homepage and under WATCH in the game, with both nicknames, for anyone to watch. The host can switch SPECTATORS off on the HOST A GAME screen, and then nobody can watch. Crew matches can never be watched.</li>
      <li><b>Your crew.</b> Everyone with the crew link sees each member's nickname, record and time played, and the crew's high score tables with the initials on them.</li>
      <li><b>Link previews.</b> When someone pastes a crew link into a chat app, the preview shows the crew's name and how many members it has. Anyone who gets that link can see this. It never shows members' names.</li>
      <li><b>High scores.</b> The initials you put on the arcade and horde tables stay on your device, unless you're in a crew: then the crew's tables show them to everyone with that crew's link.</li>
      <li><b>Your email:</b> nobody but you. Other players never see it.</li>
    </ul>
    <p>That's why we say: <b>use a nickname, not your real name</b>, and don't put anyone else's real name in a crew name either.</p>`),

      q('ip', 'What about my internet address?', `    <p>Every device on the internet has an address (an IP address). Online matches connect the two players' devices straight to each other so the fight feels fast, the way video calls do. That means <b>the other player's device can see your internet address</b> while you play. If a direct connection can't be made, the match goes through Cloudflare's relay instead.</p>
    <p>We don't store internet addresses, except in the sign-in counters above (about a day) and Cloudflare's own short limits that stop one network from flooding the server. A good rule for online games: play online with people you know.</p>`),

      q('device', 'What gets saved on my device?', `    <p>The game saves these in your browser's storage, on your device only:</p>
    <ul>
      <li>your profile: the random player id, your nickname, and your recent crews;</li>
      <li>your arcade and horde high scores, and the last fighter you picked;</li>
      <li>your settings: sound, music, round time, rounds per match, botches on or off, touch-control size, the graphics setting (and the graphics level the game settled on, so the next visit starts there), and whether spectators may watch your rooms;</li>
      <li>the happy accidents you've found, your record against each online rival (by a random id), and whether you've seen the "add to home screen" tip;</li>
      <li>your answer to the age question, if you said under 13;</li>
      <li>while the game is in the background, the numbers from the fight on screen (fighters, floors, hits, how long), so they still count if your phone closes the game there. They're sent or deleted the next time the game opens;</li>
      <li>a copy of the game's files, so it can load fast and play offline.</li>
    </ul>`),

      q('others', 'Who else is involved?', `    <ul>
      <li><b>Cloudflare</b> runs our servers, stores the profiles and crews, sends the sign-in emails, keeps the game counts and runs the relay for online matches.</li>
      <li><b>Plausible</b> counts page views, as above.</li>
      <li>If Cloudflare's relay can't be reached, the game asks a public Cloudflare or Google server to help two devices find each other. That server sees your internet address for a moment.</li>
      <li>The fonts and everything else the pages need come from our own site.</li>
    </ul>
    <p>No ad companies, no trackers from social networks, and nothing about you is sold or traded. The game's code is open: you can read every line on <a href="https://github.com/ddrscott/stick-fight">GitHub</a>.</p>`),

      q('keep', 'How long do we keep things?', `    <div class="s-table-wrap"><table class="s-table s-keep">
      <thead><tr><th>What</th><th>How long</th></tr></thead>
      <tbody>
        <tr><th scope="row">Game counts (no names)</th><td>3 months</td></tr>
        <tr><th scope="row">Running totals (just numbers)</th><td>For good</td></tr>
        <tr><th scope="row">Saved profile and email</th><td>Until you delete it (DELETE MY PROFILE) or ask us to</td></tr>
        <tr><th scope="row">Sign-in code</th><td>10 minutes, or until it's used</td></tr>
        <tr><th scope="row">Signed-in cookie</th><td>30 days, or until you sign out</td></tr>
        <tr><th scope="row">Sign-in try counters</th><td>About a day</td></tr>
        <tr><th scope="row">A crew and everything in it</th><td>Deleted after 90 days with nobody opening it or playing in it</td></tr>
        <tr><th scope="row">A quick room</th><td>While it's open, then gone within 30 minutes</td></tr>
        <tr><th scope="row">What's on your device</th><td>Until you clear it</td></tr>
      </tbody>
    </table></div>`),

      q('delete', 'How do I delete my stuff?', `    <ul>
      <li><b>On your device:</b> clear the site data for neonstickfight.com (and askscottpierce.com, if you played there before the move) in your browser's settings. That removes your profile, high scores and settings from that device. Signing out also wipes the profile from that device.</li>
      <li><b>A saved profile:</b> sign in, go to <b>VERSUS ONLINE</b>, then <b>PROFILE</b>, and press <b>DELETE MY PROFILE</b> twice. That deletes your email, your saved profile, every sign-in (on all your devices), any sign-in code waiting for you, and the sign-in try counters for your email, right away. The device you did it on starts fresh, like after signing out. If you sign in with the same email later, you get a brand-new profile.</li>
      <li><b>Your crews:</b> the same button takes you out of every crew your profile knows about: your nickname, your wins and losses, your favorite fighter, your time played, and the matches you played there. High scores you put on a crew's table stay, but only as the three initials you typed, with nothing linking them to you. A crew your profile doesn't know about (one you only opened on another device that wasn't signed in), email us the crew link and your nickname and we'll take your name off. A crew nobody opens for 90 days deletes itself.</li>
      <li><b>Can't sign in any more?</b> Email ${mail('Delete my profile')} from the email address you saved, and we'll delete it for you.</li>
      <li><b>Game counts:</b> they have nothing that ties them to you, so there's nothing of yours in them to find.</li>
    </ul>`),

      q('parents', 'For parents', `    <p>Neon Stick Fight is made for middle schoolers and up, and for fighting game fans of any age. Here's what a child's play leaves behind:</p>
    <ul>
      <li><b>Nothing tied to who they are, unless they saved a profile with an email.</b> The game counts are anonymous. Their nickname and match records show up only to the people they play with, in the crews they join, and to spectators of public quick matches.</li>
      <li><b>Under 13, no email.</b> Before the game ever asks for an email, it asks the player's age. A player who answers under 13 isn't asked for an email: their profile stays on their device, and everything in the game still works.</li>
      <li><b>Nicknames.</b> The game tells players to use a nickname, not their real name, and blocks some words in names. Talk with your child about not sharing their real name, school or other details in names or crew names.</li>
      <li><b>Online play</b> connects two devices directly, so the other player's device can see your internet address, as in most online games. Playing online with friends they know is a good habit.</li>
    </ul>
    <p>To ask us to delete anything, or if you think your child under 13 gave us an email, write to ${mail('Parent request')} with the email address or the crew link. We'll delete it and let you know. We may ask a question first to make sure the request really comes from you.</p>`),

      q('changes', 'What if this page changes?', `    <p>If we change what the game keeps, we'll change this page first and put the new date at the top.</p>`),
    ].join('\n'),
  });
}

// ---- the house rules -----------------------------------------------------------------------------------
export function termsPage() {
  const root = '../';
  return shell({
    path: 'terms/', root, title: 'House rules', kicker: 'TERMS OF PLAY', h1: 'HOUSE RULES',
    description: 'The house rules for Neon Stick Fight: trash talk in the game is part of fighting games; bullying, threats and going after real people are not. How to report a crew or a name.',
    short: [
      'This is a fun place to compete. Have fun, and don\'t make fun of others.',
      'Trash talk inside the game is part of fighting games. Bullying outside it is not.',
      'No slurs, threats, grown-up stuff, or real people\'s names in player names, initials or crew names.',
      'Don\'t cheat the scoreboards or attack the servers.',
      'The game is free and comes as-is. We can rename or close anything that breaks these rules.',
      `See something? Email ${mail('Report')} with the crew link.`,
    ],
    other: `What the game keeps about you is on the <a href="${root}privacy/">privacy page</a>.`,
    body: [
      q('trash', 'Is trash talk allowed?', `    <p>Yes, inside the game. A perfect round, a taunt after a KO, "GG EZ", a crew name that dares the other crew to show up: that's fighting games, and it always has been. Win loud, lose loud, run it back.</p>`),

      q('not', 'What isn\'t allowed?', `    <p>Bullying, threats, harassment, or going after real people outside the game. That includes:</p>
    <ul>
      <li>player names, initials or crew names that are slurs, threats, grown-up stuff, or make fun of a real person;</li>
      <li>using someone else's real name, or anyone's address, phone number or school;</li>
      <li>making a crew to gang up on someone, or to mock someone who isn't in on the joke;</li>
      <li>hate against people for who they are: their race, religion, gender, who they like, a disability, or where they're from;</li>
      <li>pretending to be someone else to get them in trouble.</li>
    </ul>
    <p>The line is simple: beat their fighter, not the person. This is a fun place to compete, so have fun, and don't make fun of others.</p>`),

      q('names', 'Why won\'t it take my name?', `    <p>The game checks player names, crew names and high score initials against a short list of words that aren't allowed, like arcade machines always have. If yours gets turned down, pick another. The list can't catch everything, and sometimes it'll block something innocent. If you think it got one wrong, tell us.</p>`),

      q('cheat', 'What about cheating?', `    <p>Don't fake match results, flood rooms, try to get into anyone's profile, or attack the servers. The game counts a result only when both players' games agree on it, and it limits how fast anyone can make rooms or sign in, so most of this doesn't work anyway. Please don't make us add more locks.</p>`),

      q('happens', 'What happens if someone breaks the rules?', `    <p>We can rename a player or a crew, take a name off a crew, or close a crew for good, without warning. There's no appeal board: it's one person running a free game. If you think we got it wrong, email us and we'll take another look.</p>`),

      q('report', 'How do I report something?', `    <p>Email ${mail('Report')} with:</p>
    <ul>
      <li>the crew link (in the crew room, press COPY LINK) or the room code;</li>
      <li>the name that's the problem, and what happened;</li>
      <li>a screenshot, if you have one.</li>
    </ul>
    <p>You don't have to say who you are. <b>If someone threatens to hurt you or anyone else, tell a parent, a teacher or another adult you trust right away</b>, and call the police if anyone is in danger.</p>`),

      q('asis', 'Is it really free?', `    <p>Yes. No ads, nothing to buy. It's also <b>as-is</b>: it's a side project, so it might break, servers can go down, high scores and stats can be reset, and a crew nobody opens for 90 days is deleted. We don't promise it'll be here forever.</p>
    <p>The game is open source under the <a href="https://www.gnu.org/licenses/agpl-3.0.html">GNU AGPL v3</a>. You can read the code, change it, and run your own copy, as long as you share your changes the same way.</p>`),

      q('age', 'Who can play?', `    <p>Anyone. It's made for middle schoolers and up, and for fighting game fans of any age. Players under 13 can play everything without an email. The <a href="${root}privacy/#parents">privacy page</a> has a section for parents.</p>`),

      q('changes', 'Can these rules change?', `    <p>Yes. When they do, we'll update this page and the date at the top. Playing after that means you're OK with the new version.</p>`),
    ].join('\n'),
  });
}
