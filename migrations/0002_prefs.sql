-- Settings that follow the account (worker/auth.ts, cleanPrefs): a small JSON object, known keys
-- only. Today: { "touch": { "scale": 1.13, "at": 1731200000000 } }, the size of the touch controls
-- and when the player last changed it (src/touchPrefs.js).
--
-- Only adds a column, with a default: CI applies this before the deploy, and the Worker that's
-- still running neither reads nor writes it.
ALTER TABLE accounts ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}';
