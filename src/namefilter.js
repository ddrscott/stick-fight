// The name filter (README, Privacy and terms, Name filter): a small blocklist for the text players
// show each other. Player names (3 to 12), crew names (3 to 20) and arcade initials (3) are only
// A to Z, digits and spaces, so this only has to read those. Do no harm, lightweight: slurs and the
// obvious sexual or abusive words, the way arcade cabinets blocked initials, and nothing heavier.
// Trash talk is part of fighting games; a name that's a slur or a threat isn't.
//
// One module, plain JavaScript, so the game (name entry, crew create, initials) and the Worker
// (crew names, crew member names, profile names, the LIVE list) run the same check.
// `npm run test:names` (scripts/names/check.mjs) holds the list to its blocked and allowed examples.
//
//   blockedName(text)       true when a name or crew name shouldn't be shown to anyone
//   blockedInitials(text)   true when three initials are on the cabinet list (or are a blocked word)
//
// How it reads text:
//   - leetspeak folds first: 0 O, 1 I (and 1 L, both tried), 3 E, 4 A, 5 S, 7 T, 8 B, 9 G, and $ @ ! too;
//   - every letter may repeat (FUUUCK, A55SS), but a doubled letter in a word must stay doubled, so
//     BOBS isn't BOOBS;
//   - ANYWHERE words are blocked inside any name, spaces and all ("F U C K", "BIGFUCKER"). Only words
//     that never turn up inside an innocent one go here;
//   - WORDS are blocked only as a whole word (a token between spaces), as a run of single letters
//     ("A S S"), or as the whole name with its spaces taken out. That's what keeps Scunthorpe, Essex,
//     Hancock, Cummings, therapist and grape playable;
//   - INITIALS are three-letter combinations blocked as initials, and as words in a name.
//
// It will miss things. That's what the report path (the terms page) and the admin route are for.

const ANYWHERE = [
  'FUCK', 'SHIT', 'NIGGER', 'NIGGA', 'FAGGOT', 'BITCH', 'WHORE', 'ASSHOLE', 'COCKSUCK', 'DICKHEAD',
  'MOTHERF', 'BLOWJOB', 'DILDO', 'JIZZ', 'HITLER', 'KILLYOURSELF', 'KILLURSELF', 'WETBACK', 'TRANNY',
  'PEDOPHILE', 'PAEDO', 'CUMSHOT', 'HANDJOB', 'SUCKMYD',
];
const WORDS = [
  'ASS', 'ASSES', 'ARSE', 'CUNT', 'CUNTS', 'COCK', 'COCKS', 'DICK', 'DICKS', 'PENIS', 'VAGINA', 'PUSSY', 'TITS', 'TITTY', 'TITTIES',
  'BOOB', 'BOOBS', 'CUM', 'SEX', 'SEXY', 'PORN', 'PORNO', 'NUDE', 'NUDES', 'HORNY', 'ORGY', 'ANAL', 'ANUS', 'CLIT', 'TWAT', 'WANK',
  'WANKER', 'SLUT', 'SLUTS', 'HOE', 'HOES', 'SKANK', 'RAPE', 'RAPED', 'RAPIST', 'RETARD', 'RETARDS', 'FAG', 'FAGS', 'DYKE', 'HOMO',
  'SPIC', 'KIKE', 'CHINK', 'GOOK', 'COON', 'BEANER', 'NAZI', 'NAZIS', 'PEDO', 'KYS', 'KMS', 'MOLEST', 'PISS', 'PRICK', 'BASTARD',
];
// the cabinet list: three letters that spell something on a high score table
const INITIALS = [
  'ASS', 'FUK', 'FUC', 'FCK', 'FKU', 'FUX', 'FAG', 'FGT', 'CUM', 'SEX', 'TIT', 'KKK', 'NIG', 'NGR', 'DIK', 'DIC', 'COK', 'KYS',
  'CNT', 'SHT', 'HOE', 'VAG', 'JIZ', 'FAP', 'XXX', 'SUK', 'PUS', 'WTF', 'STFU', 'GFY', 'POS',
].filter((w) => w.length === 3);

const LEET = { 0: 'O', 3: 'E', 4: 'A', 5: 'S', 7: 'T', 8: 'B', 9: 'G', $: 'S', '@': 'A', '!': 'I', '|': 'I' };

/** each letter of a word, one or more times: FUCK is F+U+C+K+, ASS is A+S+S+ (so it needs two S) */
const pattern = (w) => w.split('').map((c) => `${c}+`).join('');
const anywhere = new RegExp(`(?:${ANYWHERE.map(pattern).join('|')})`);
const whole = new RegExp(`^(?:${[...WORDS, ...INITIALS].map(pattern).join('|')})$`);
const cabinet = new RegExp(`^(?:${[...INITIALS, ...WORDS.filter((w) => w.length <= 3)].map(pattern).join('|')})$`);

/** the text as the filter reads it, once with 1 as I and once with 1 as L: upper case, leet folded, spaces single */
function readings(text) {
  const up = String(text == null ? '' : text).toUpperCase();
  const fold = (one) => up.replace(/[0-9$@!|]/g, (c) => (c === '1' ? one : LEET[c] || c)).replace(/[^A-Z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const a = fold('I'), b = fold('L');
  return a === b ? [a] : [a, b];
}

/** the whole-word checks: each word, each run of single letters joined (A S S), and the name without spaces */
function wordsOf(s) {
  const tokens = s.split(' ').filter(Boolean), out = [...tokens, tokens.join('')];
  let run = '';
  for (const t of [...tokens, '']) {
    if (t.length === 1) run += t;
    else { if (run.length > 1) out.push(run); run = ''; }
  }
  return out;
}

/** true when a player name or a crew name shouldn't be shown to other players */
export function blockedName(text) {
  return readings(text).some((s) => anywhere.test(s.replace(/ /g, '')) || wordsOf(s).some((w) => whole.test(w)));
}

/** true when three high score initials spell something off the cabinet list */
export function blockedInitials(text) {
  return readings(text).some((s) => cabinet.test(s.replace(/ /g, '')) || blockedName(s));
}

/** what the game says when a name is turned away */
export const PICK_ANOTHER = 'PICK ANOTHER NAME';
