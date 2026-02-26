-- 兑换码表
CREATE TABLE IF NOT EXISTS tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token       TEXT    NOT NULL UNIQUE,
  quota_amount INTEGER NOT NULL,
  expires_at  TEXT    NOT NULL,
  used_at     TEXT    DEFAULT NULL,
  used_by     INTEGER DEFAULT NULL,
  created_at  TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tokens_token ON tokens(token);
CREATE INDEX IF NOT EXISTS idx_tokens_used_by ON tokens(used_by);
