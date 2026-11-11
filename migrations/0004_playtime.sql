-- Play time (worker/stats.ts, README "Analytics", Rollups): seconds played per mode per UTC day, so the
-- site can show total minutes, hours and days played, all time and today. No player id, name, email
-- or country: a day, a mode and two counters.
--
--   mode     arcade, horde, training (vs the CPU or the dummy), quick, crew (two players online)
--   secs     seconds played: a match's length (online only when both pages agreed on the result),
--            or for training the time spent in it, sent by the page in short heartbeats
--   matches  finished matches (an arcade stage, a horde run, an online match); training adds none
CREATE TABLE stats_time (
  day TEXT NOT NULL,                      -- YYYY-MM-DD, UTC
  mode TEXT NOT NULL,
  secs INTEGER NOT NULL DEFAULT 0,
  matches INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, mode)
) WITHOUT ROWID;
