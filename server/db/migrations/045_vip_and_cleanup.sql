-- VIP 体系 + 文件过期清理
ALTER TABLE users ADD COLUMN is_vip INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN vip_expires_at TEXT DEFAULT NULL;
ALTER TABLE workspace_artifacts ADD COLUMN expires_at TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_ws_art_expires ON workspace_artifacts(expires_at);
UPDATE workspace_artifacts SET expires_at = datetime(created_at, '+7 days') WHERE expires_at IS NULL;
