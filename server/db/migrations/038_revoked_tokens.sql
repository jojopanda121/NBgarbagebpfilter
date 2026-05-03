-- 024_revoked_tokens.sql — JWT 黑名单 / 索引强化
-- ============================================================

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti TEXT PRIMARY KEY,
  user_id INTEGER,
  revoked_at DATETIME NOT NULL DEFAULT (datetime('now')),
  expires_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at);

-- 性能：补齐关键路径上的索引（M7）
CREATE INDEX IF NOT EXISTS idx_tasks_user_created ON tasks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_file_hash ON tasks(file_hash);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_quotas_user ON quotas(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_verification_codes_contact ON verification_codes(contact);
CREATE INDEX IF NOT EXISTS idx_tokens_used_expires ON tokens(used_at, expires_at);
