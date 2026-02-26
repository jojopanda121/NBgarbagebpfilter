-- ============================================================
-- 000_schema_migrations.sql — 迁移版本追踪表
-- 用于记录已执行的迁移，防止重复执行
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at DATETIME DEFAULT (datetime('now'))
);
