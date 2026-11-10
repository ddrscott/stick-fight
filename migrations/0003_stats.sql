-- Match bookkeeping (worker/stats.ts, README "Analytics", Rollups): all-time totals behind
-- GET /stick-fight/api/stats, so the homepage's numbers outlive Analytics Engine's three months.
-- Fighters and modes only: no player id, name, email or country. (0002 is the profile prefs
-- migration from the touch controls task; the two don't touch each other.)

-- how often each fighter was picked at a character select, per mode:
-- arcade, horde, training (your own fighter), dummy (the training dummy), quick, crew
CREATE TABLE stats_picks (
  fighter TEXT NOT NULL,
  mode TEXT NOT NULL,
  picks INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (fighter, mode)
) WITHOUT ROWID;

-- one row per pairing, one upsert per finished match.
--   vs = 'cpu': a is the player's fighter and b the CPU's (reported by the page, not verified)
--   vs = 'pvp': two players online, counted only when both pages reported the same result;
--               the pair is stored once with a <= b
-- a = b is a mirror match. Per-fighter wins and losses are sums over these rows.
CREATE TABLE stats_matchups (
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  vs TEXT NOT NULL,
  games INTEGER NOT NULL DEFAULT 0,
  a_wins INTEGER NOT NULL DEFAULT 0,
  b_wins INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  secs INTEGER NOT NULL DEFAULT 0,          -- total match length, for the average
  a_rounds INTEGER NOT NULL DEFAULT 0,
  b_rounds INTEGER NOT NULL DEFAULT 0,
  a_perfects INTEGER NOT NULL DEFAULT 0,    -- matches a closed with a perfect round
  b_perfects INTEGER NOT NULL DEFAULT 0,
  timeouts INTEGER NOT NULL DEFAULT 0,      -- matches whose last round ran out the clock
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (a, b, vs)
) WITHOUT ROWID;
