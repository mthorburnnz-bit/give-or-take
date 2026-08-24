-- Daily reminder subscriptions.
--
-- 28 of the first 31 players played once and never returned, and the reason
-- was structural: nothing could bring them back. There was no notification, no
-- install prompt, no email — the only route in was remembering the URL. This
-- is the return path.
--
-- Keyed on the endpoint because that is what the Push API gives us as the
-- stable identity of a subscription. One device is one row; a player with a
-- phone and a laptop legitimately has two.
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  -- The subscription's own keys, used to encrypt each payload to that browser.
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  -- Minutes to ADD to UTC to get the subscriber's local time, so a reminder
  -- lands in their morning rather than ours. Captured at subscribe time and
  -- refreshed on every re-subscribe, which is the best a web app gets.
  utc_offset_minutes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  -- The last local date a reminder was sent, so an hourly sweep cannot send
  -- twice to the same person on the same day.
  last_sent_date TEXT
);

-- The sweep asks "who is due right now", which reads every row and filters on
-- the sent date; the index keeps that from degrading as subscriptions grow.
CREATE INDEX idx_push_last_sent ON push_subscriptions(last_sent_date);
