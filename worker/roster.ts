// The fighter ids the bookkeeping accepts (worker/stats.ts): a pick or a match naming anything else
// is dropped, so nobody can fill the rollup tables with made-up names. It has to match the game's
// roster (ROSTER_ORDER in src/characters/registry.js); site/generate.mjs fails the build when the
// two differ, so a new character can't ship without its line here.
export const FIGHTERS = [
  "temp", "intern", "helpdesk", "courier", "security", "janitor", "manager", "accountant", "windowWasher",
  "hrRep", "salesRep", "barista", "chef", "wellness", "electrician", "receptionist", "lawyer", "ceo",
] as const;
export const isFighter = (id: unknown): id is string => typeof id === "string" && (FIGHTERS as readonly string[]).includes(id);
