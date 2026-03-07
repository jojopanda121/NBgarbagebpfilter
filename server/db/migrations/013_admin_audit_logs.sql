-- 013_admin_audit_logs.sql — 管理员操作审计日志表
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  admin_username TEXT NOT NULL,
  action TEXT NOT NULL,           -- 操作类型: ban_user, update_package, update_settings, reply_feedback, delete_token 等
  method TEXT NOT NULL,            -- HTTP 方法: GET, POST, PUT, DELETE
  path TEXT NOT NULL,              -- 请求路径
  ip TEXT,                         -- 操作人 IP
  target_id TEXT,                  -- 操作目标 ID（用户ID、套餐ID等）
  before_value TEXT,               -- 变更前值 (JSON)
  after_value TEXT,                -- 变更后值 (JSON)
  created_at DATETIME DEFAULT (datetime('now')),
  FOREIGN KEY (admin_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_admin_id ON admin_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON admin_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON admin_audit_logs(action);
