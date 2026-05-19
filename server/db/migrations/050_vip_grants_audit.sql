-- ============================================================
-- 050_vip_grants_audit.sql
--
-- VIP 授予/取消的审计表。
-- 为什么现在加：当前每次 admin 点「设 VIP」或「取消 VIP」只是
-- UPDATE users SET is_vip=?，没有任何历史痕迹。等以后接入支付要做
-- VIP 收入 / 续费率 / 转化漏斗时，没有这张表就完全没有数据可统计。
-- 也方便售后排查「这个用户是谁开的 VIP / 啥时候开的」。
--
-- 字段说明：
--   action ∈ {'grant', 'cancel'}
--   expires_at_at_action — 当时设置的过期时间（NULL=永久 VIP）；
--     这个值是 snapshot，users.vip_expires_at 后续被改写也不影响历史。
--   granted_by_admin_id — 操作的 admin user_id；自助续费时 = user_id。
--   source — 'admin_grant' 现在唯一来源；预留 'payment' / 'trial' / 'refund' 等。
--   price_rmb — 为以后接入支付保留；现在 admin 手动开 VIP 一律 null。
--   notes — 操作备注，admin 可选填。
-- ============================================================

CREATE TABLE IF NOT EXISTS vip_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('grant', 'cancel')),
  expires_at_at_action TEXT,
  granted_by_admin_id INTEGER,
  source TEXT NOT NULL DEFAULT 'admin_grant',
  price_rmb REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_vip_grants_user ON vip_grants(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_vip_grants_created ON vip_grants(created_at);
CREATE INDEX IF NOT EXISTS idx_vip_grants_action ON vip_grants(action, created_at);
