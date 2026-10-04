CREATE TABLE IF NOT EXISTS upload_account_rotation (
  name TEXT PRIMARY KEY,
  next_account INTEGER NOT NULL DEFAULT 0
);
