-- ============================================================
-- 005_packages.sql — 套餐配置表
-- ============================================================

CREATE TABLE IF NOT EXISTS packages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  quota_amount INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  is_active   INTEGER DEFAULT 1,
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- 默认套餐数据
INSERT INTO packages (name, quota_amount, price_cents, sort_order) VALUES
  ('基础版', 5, 9000, 1),
  ('标准版', 15, 24000, 2),
  ('专业版', 50, 70000, 3),
  ('企业版', 200, 250000, 4);
