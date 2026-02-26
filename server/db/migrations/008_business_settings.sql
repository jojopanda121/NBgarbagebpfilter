-- ============================================================
-- 008_business_settings.sql — 业务配置默认值
-- 将硬编码的业务逻辑参数移到数据库
-- ============================================================

-- 插入默认业务配置（如果不存在）
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('price_per_quota', '990'),
  ('contact_binding_threshold', '3'),
  ('verification_max_attempts', '3'),
  ('default_free_quota', '3');
