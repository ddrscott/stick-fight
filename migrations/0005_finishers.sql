-- Finishing moves (worker/stats.ts, README "Analytics", Rollups; 2026-11-12): how many matches each move
-- finished, all time, so the title screen's ticker can say TOP FINISHER (src/ticker.js). A move id and a
-- counter: no player id, name, email or country, and no fighter (a character's own move ids are unique
-- across the roster, so the game knows whose it is).
--
--   move  the move id that landed the last KO of a finished arcade stage or agreed online match
--         (not a horde run, not a stage cut short, not a time-out, not a draw)
--   kos   how many matches it finished
CREATE TABLE stats_finishers (
  move TEXT NOT NULL PRIMARY KEY,
  kos INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
