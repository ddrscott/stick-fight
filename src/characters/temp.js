// TEMP: the baseline. The original fighter, unchanged: every shared move and every shared string, no
// unique moves, no stats off 1, no body changes. TEMP vs TEMP plays exactly as the game did before
// characters existed (the regression scenes in the README give the same results). It's also what a
// ladder stage falls back to when its character isn't in the game yet.
export default {
  id: 'temp',
  name: 'TEMP',
  tagline: 'FIRST DAY. KNOWS THE BASICS',
  color: '#f0f0f0',
  altColor: '#E85D00',
  accent: '#ffb02e',
  stats: {},
  body: null,
  moves: {},
  commands: [],
  strings: {},
  ai: {},
  moveList: [
    { name: 'NEON TORNADO', input: '1, 2, 3, 4', note: 'launches into a juggle' },
    { name: 'COMET CROSS', input: '→→ 2', note: 'wall splat' },
    { name: 'SKY SPIKE', input: '↓2, 1, 2, 4', note: 'ground bounce' },
  ],
};
