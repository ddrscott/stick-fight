// npm run test:names: the name filter (src/namefilter.js) against what it must block and what it
// must let through. No browser, no server: it's the one module the game and the Worker share.
import { blockedName, blockedInitials } from '../../src/namefilter.js';

const BLOCKED_NAMES = [
  // plain
  'FUCK', 'SHIT HEAD', 'BITCH', 'ASS', 'MY ASS', 'CUNT', 'DICK', 'SEXY GIRL', 'PORN', 'SLUT', 'RAPIST', 'RETARD', 'FAG', 'KYS', 'NAZI',
  'NIGGER', 'NIGGA', 'FAGGOT', 'KILL YOURSELF', 'HITLER',
  // inside other words, for the ANYWHERE list
  'BIGFUCKER', 'BULLSHIT', 'MOTHERFUCKER', 'ILOVE PORNO',
  // leetspeak
  'FUK', 'F4G', 'SH1T', 'N1GGA', 'A55', 'B1TCH', 'D1CK', '5LUT', 'PEN15', 'C0CK', 'H0E', 'R4P3', 'N4Z1', 'K1LL Y0URSELF',
  // repeats and spacing
  'FUUUUCK', 'ASSSSS', 'SHIIIT', 'F U C K', 'A S S', 'S H I T', 'AS S', 'FU CK',
  // crew names
  'THE ASS CREW', 'FUCK MATH', 'BITCHES CREW', 'SEX SQUAD',
];

const ALLOWED_NAMES = [
  // places and words that contain a blocked word
  'SCUNTHORPE', 'ESSEX', 'MIDDLESEX', 'SUSSEX', 'PENISTONE', 'CLASSIC', 'BASSIST', 'HANCOCK', 'PEACOCK', 'COCKBURN', 'DICKENS',
  'CUMMINGS', 'CUMBERLAND', 'TITUS', 'THERAPIST', 'GRAPE', 'CANAL', 'JANUS', 'ARSENAL', 'SPICY', 'RACCOON', 'SWANKY', 'NIGER',
  'NIGERIA', 'ASSASSIN', 'ANALYST', 'SEXTON', 'COCKATOO', 'SHOEHORN', 'MASSACHUSETTS', 'PASSWORD', 'BOBS', 'MATSUI', 'HOEFLER',
  'GLASS ACT', 'ASSEMBLY', 'BASS', 'CLASS', 'GRASS', 'HOMER', 'DICKSON', 'TITANIC', 'SHIP IT',
  // common names and nicknames
  'ASHLEY', 'MASON', 'AVA', 'JACKSON', 'SOPHIA', 'LIAM', 'NOAH', 'OLIVIA', 'DOMINIC', 'NICK', 'RICKY',
  'HARRY', 'CASSIDY', 'CASSIE', 'MOHAMMED', 'NGUYEN', 'GUEST 427', 'SCOTT', 'XX SLAYER XX', 'TUESDAY CREW', 'LUNCH CREW',
  'MATHLETES', 'BAND KIDS', 'TRASH TALKERS', 'SWEATY TRYHARDS', 'NOOB', 'EZ', 'GG EZ', 'GET REKT', 'YOUR MOM',
  // trash talk is fine
  'UR TRASH', 'GIT GUD', 'SALTY', 'BOT', 'CRYBABY', 'L PLUS RATIO',
];

const BLOCKED_INITIALS = ['ASS', 'A55', 'FUK', 'FUC', 'FCK', 'F4G', 'FAG', 'CUM', 'CUUM', 'SEX', '5EX', 'TIT', 'T1T', 'KKK', 'NIG', 'N1G', 'DIK', 'D1K', 'COK', 'C0K', 'KYS', 'CNT', 'SHT', 'HOE', 'H0E', 'VAG', 'JIZ', 'FAP', 'XXX', 'WTF', 'POS'];
const ALLOWED_INITIALS = ['AAA', 'ABC', 'ACE', 'ASH', 'BOB', 'DAN', 'SAM', 'JOE', 'TOM', 'KAT', 'ZZZ', 'MOM', 'DAD', 'GG1', 'CAS', 'ASK', 'SEA', 'TIM', 'NIK', 'DIG', 'CUB', 'FUN', 'KID', 'POW', 'WIN', 'SCO', 'AJP', 'RIP', 'LOL', 'BRB', '007', '123'];

let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.log(`  FAIL  ${what}`); } };
for (const n of BLOCKED_NAMES) check(blockedName(n), `name "${n}" should be blocked`);
for (const n of ALLOWED_NAMES) check(!blockedName(n), `name "${n}" should be allowed`);
for (const n of BLOCKED_INITIALS) check(blockedInitials(n), `initials "${n}" should be blocked`);
for (const n of ALLOWED_INITIALS) check(!blockedInitials(n), `initials "${n}" should be allowed`);
// the shapes the game and Worker hand it
check(!blockedName(''), 'an empty name is not this module\'s problem');
check(!blockedName(null), 'null is not blocked');
check(blockedName('fuck'), 'lower case is read as upper case');
const total = BLOCKED_NAMES.length + ALLOWED_NAMES.length + BLOCKED_INITIALS.length + ALLOWED_INITIALS.length + 3;
console.log(`name filter: ${total - fails} of ${total} checks pass (${BLOCKED_NAMES.length} blocked names, ${ALLOWED_NAMES.length} allowed, ${BLOCKED_INITIALS.length} blocked initials, ${ALLOWED_INITIALS.length} allowed)`);
process.exit(fails ? 1 : 0);
