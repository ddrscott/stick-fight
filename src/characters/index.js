// Registers every character. Each file default-exports a definition, or null while it isn't built yet
// (the phase 2 files), so adding a character means replacing its own file and nothing else. Import this
// before the sim is created (main.js does): registering merges the characters' moves into the shared
// tables the sim reads when it starts.
import { registerCharacter } from './registry.js';
import { registerBotchMoves } from '../combat/botch.js';
import temp from './temp.js';
import intern from './intern.js';
import helpdesk from './helpdesk.js';
import courier from './courier.js';
import security from './security.js';
import janitor from './janitor.js';
import manager from './manager.js';
import accountant from './accountant.js';
import windowWasher from './windowWasher.js';

for (const def of [temp, intern, helpdesk, courier, security, janitor, manager, accountant, windowWasher]) {
  if (!def) continue;
  try { registerCharacter(def); } catch (e) { console.error(`[characters] ${def.id || '?'} didn't register: ${e.message}`); }
}
// the botch flail and the happy-accident techniques (src/combat/botch.js): shared by everyone, added after
// the characters so they land at the end of the move tables
registerBotchMoves();

export * from './registry.js';
