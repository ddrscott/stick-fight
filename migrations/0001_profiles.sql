-- Profiles kept by email (worker/auth.ts). A player plays without an account: a random player id
-- and a display name in localStorage. Saving the profile links that player id to an email, so
-- signing in on another device restores the same id, name and crew list.

-- one row per email that has signed in; player_id is the id the game plays as (a secret: it is
-- only ever sent to the signed-in owner)
CREATE TABLE accounts (
  email TEXT PRIMARY KEY,
  player_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  crews TEXT NOT NULL DEFAULT '[]',   -- JSON: [{ slug, name, at }], the crew rooms this player has been in
  created_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL
);

-- the code waiting to be typed, one per email; only its hash is kept
CREATE TABLE login_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL
);

-- 30-day sessions; the cookie holds the token, the table its hash
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_email ON sessions (email);

-- fixed-window counters: code sends and guesses per email and per IP
CREATE TABLE limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE INDEX limits_window ON limits (window_start);
