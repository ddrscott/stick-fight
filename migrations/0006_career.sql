-- Career and sticks (README, Progression; worker/career.ts). A signed-in player's progress lives on the account;
-- a guest's lives in localStorage until SAVE MY PROFILE, when it merges in (the larger of each number, never added
-- twice). Game progress only: nothing here is personal data beyond what the account already holds.
--
--   career_xp       total XP (the job title is worked out from it: src/career/rules.js LADDER)
--   sticks          the currency, spent on palettes
--   win_day         the UTC date of the last first-win-of-the-day bonus ('' never)
--   online_day      the UTC date of the last first-online-match-of-the-day bonus
--   offline_day     the UTC date offline_xp and offline_sticks count for: what arcade and horde paid that day,
--   offline_xp      held to the daily cap (OFFLINE_CAP), since the Worker can't check a result the page reports
--   offline_sticks
--   fighter_xp      JSON {fighter: xp}: room for fighter mastery (not used yet)
--   owned           JSON ["courier:nightShift", ...]: palettes bought (room for other cosmetics)
--   equip           JSON {fighter: palette id}: the palette picked for each fighter
--
-- Only adds columns, each with a default: CI applies this before the deploy, and the Worker that's still running
-- neither reads nor writes them.
ALTER TABLE accounts ADD COLUMN career_xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN sticks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN win_day TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN online_day TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN offline_day TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN offline_xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN offline_sticks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN fighter_xp TEXT NOT NULL DEFAULT '{}';
ALTER TABLE accounts ADD COLUMN owned TEXT NOT NULL DEFAULT '[]';
ALTER TABLE accounts ADD COLUMN equip TEXT NOT NULL DEFAULT '{}';
