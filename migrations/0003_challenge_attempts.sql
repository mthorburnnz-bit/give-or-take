-- Records who took a shared challenge, and whether they beat it.
--
-- A challenge was fire-and-forget: you sent a link and never learned what
-- happened. This is the return path, so the home screen can tell you that
-- three people took yours and one of them beat you.
--
-- Keyed on (token, player_id) rather than an autoincrement id: one attempt per
-- person per challenge, so a replayed submission updates their result instead
-- of inflating the count.
CREATE TABLE challenge_attempts (
  token TEXT NOT NULL REFERENCES challenges(token),
  player_id TEXT NOT NULL REFERENCES players(id),
  score INTEGER NOT NULL,     -- the taker's score for their own day
  beat INTEGER NOT NULL,      -- 0/1, did it beat the score the link advertised
  created_at INTEGER NOT NULL,
  PRIMARY KEY (token, player_id)
);

-- The home screen asks "how did my challenges do", which resolves to every
-- attempt against the tokens one player owns.
CREATE INDEX idx_challenge_attempts_token ON challenge_attempts(token);
