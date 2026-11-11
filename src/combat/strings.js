// Strings: button sequences pressed inside the rig's cancel windows. Tokens are the limb
// buttons '1'..'4', with a 'd' prefix when down is held and an 'r' prefix when the button is pressed
// while rising (down just let go out of a crouch or a crouching attack: sim.js risingNow). After the
// first token, a plain token also matches its down and rising variants (holding down through a string,
// or letting it go, doesn't break it); a 'd' or 'r' token in the table matches only itself.
// (RISE AND SHINE, ↓1 then a rising 3, is added by src/combat/dash.js once its move exists.)
// Strings that share a prefix agree on the moves of that prefix, so the move for the next
// press is always unambiguous. The last move of an ender string is its ender (frameData.js).
export const STRINGS = [
  { name: 'ONE-TWO',          keys: ['1', '1', '2'],        moves: ['jab', 'jab', 'cross'] },
  { name: 'FLASH ROUNDHOUSE', keys: ['1', '1', '2', '4'],   moves: ['jab', 'jab', 'cross', 'flashRoundhouse'] },
  { name: 'TRIPLE JAB',       keys: ['1', '1', '1'],        moves: ['jab', 'jab', 'jab'] },
  { name: 'ONE-TWO KICK',     keys: ['1', '2', '4'],        moves: ['jab', 'cross', 'roundhouse'] },
  { name: 'UPTOWN',           keys: ['1', '2', '3'],        moves: ['jab', 'cross', 'uptown'] },
  { name: 'NEON TORNADO',     keys: ['1', '2', '3', '4'],   moves: ['jab', 'cross', 'uptown', 'neonTornado'] },
  { name: 'CROSS SNAP',       keys: ['2', '3'],             moves: ['cross', 'lkick'] },
  { name: 'SPIN HEEL',        keys: ['2', '1', '4'],        moves: ['cross', 'jab', 'spinHeel'] },
  { name: 'CRESCENT',         keys: ['3', '3', '4'],        moves: ['lkick', 'lkick', 'crescent'] },
  { name: 'LOW RUSH',         keys: ['d1', 'd1', 'd3'],     moves: ['lowJab', 'lowJab', 'lowKick'] },
  { name: 'GROUND RUSH',      keys: ['d3', 'd3', '4'],      moves: ['lowKick', 'lowKick', 'rushKnee'] },
  { name: 'SKY SPIKE',        keys: ['d2', '1', '2', '4'],  moves: ['uppercut', 'jab', 'cross', 'skySpike'] },
];

// the token a plain move would have come from (the AI names moves; this starts a string for it)
export const MOVE_TOKEN = { jab: '1', cross: '2', lkick: '3', roundhouse: '4', lowJab: 'd1', uppercut: 'd2', lowKick: 'd3', sweep: 'd4' };

const tokMatch = (want, got, i) => want === got || (i > 0 && (got === 'd' + want || got === 'r' + want));

// strings whose keys start with `seq`; `list` is a character's own table (src/characters/), the
// shared one by default
export function matchStrings(seq, list = STRINGS) {
  return list.filter(s => s.keys.length >= seq.length && seq.every((t, i) => tokMatch(s.keys[i], t, i)));
}

// A character's string table: the shared strings it keeps (all, minus `drop` by name) plus its own
// (`add`, each { name, keys, moves }). Returns the list and any prefix conflicts: two strings that
// share a prefix must agree on its moves, or the next press would be ambiguous.
export function buildStrings({ drop = [], add = [] } = {}) {
  const list = [...STRINGS.filter(s => !drop.includes(s.name)), ...add];
  const problems = [];
  for (const a of list) for (const b of list) {
    if (a === b) continue;
    const n = Math.min(a.keys.length, b.keys.length);
    for (let i = 0; i < n; i++) {
      if (!(tokMatch(a.keys[i], b.keys[i], i) || tokMatch(b.keys[i], a.keys[i], i))) break;
      if (a.moves[i] !== b.moves[i]) { problems.push(`${a.name} and ${b.name} disagree at press ${i + 1}`); break; }
    }
    if (a.keys.length === b.keys.length && a.keys.every((t, i) => tokMatch(t, b.keys[i], i) || tokMatch(b.keys[i], t, i)) && a.name < b.name) problems.push(`${a.name} and ${b.name} have the same input`);
  }
  return { list, problems };
}
