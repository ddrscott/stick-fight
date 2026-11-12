-- Daily shifts (README, Progression, Daily shifts; src/career/shifts.js, worker/career.ts). A signed-in player's
-- progress on today's three shifts. The shifts themselves aren't stored: they come from the date (and the slot
-- swapped), so they're the same for everyone that day.
--
--   shifts   JSON { day, swap, prog: [3], done: [3] }: the UTC day it counts for, the slot swapped today (-1 none),
--            the progress and which are done. A state from another day reads as a fresh one.
--
-- Only adds a column with a default: CI applies this before the deploy, and a Worker still running ignores it.
ALTER TABLE accounts ADD COLUMN shifts TEXT NOT NULL DEFAULT '{}';
