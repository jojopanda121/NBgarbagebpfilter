-- 023: 添加最后登录时间字段（用于管理员查看用户活跃度）
ALTER TABLE users ADD COLUMN last_login_at TEXT DEFAULT NULL;
