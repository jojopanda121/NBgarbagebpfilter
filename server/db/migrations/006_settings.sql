-- ============================================================
-- 006_settings.sql — 系统设置表
-- ============================================================

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 默认设置
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('site_name', '垃圾BP过滤机'),
  ('free_quota', '3'),
  ('maintenance_mode', 'false');
