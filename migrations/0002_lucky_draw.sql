CREATE TABLE IF NOT EXISTS lucky_draw_entries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  order_id TEXT NOT NULL UNIQUE,
  created TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lucky_draw_entries_campaign ON lucky_draw_entries(campaign_id, created DESC);
