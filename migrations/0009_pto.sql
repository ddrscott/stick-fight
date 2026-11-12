-- PTO (README, Progression, PTO; src/career/rules.js PTO, worker/career.ts). Time away banks double-XP matches for a
-- signed-in player instead of breaking a streak.
--
--   pto   JSON { day, bank }: the last UTC day a match paid ('' never), and the double-XP matches banked as of then.
--         The days away since are counted in when the next match pays (rules.js settlePto), so nothing runs daily.
--
-- Only adds a column with a default: CI applies this before the deploy, and a Worker still running ignores it.
ALTER TABLE accounts ADD COLUMN pto TEXT NOT NULL DEFAULT '{}';
