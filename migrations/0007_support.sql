-- The support desk (worker/support.ts, README Privacy and terms, Support desk). One row per ticket:
-- the GitHub issue on ddrscott/stick-fight (ticket NSF-<issue>), the player who opened it, and the
-- Message-ID of their email (threading, and so a retried delivery doesn't post twice). No email address:
-- the reply goes to the account's address, looked up by player id. DELETE MY PROFILE deletes the rows.
CREATE TABLE support_tickets (
  issue INTEGER PRIMARY KEY,
  player_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  message_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX support_tickets_player ON support_tickets (player_id);
CREATE INDEX support_tickets_message ON support_tickets (message_id);
