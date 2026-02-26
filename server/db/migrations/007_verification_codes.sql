-- ============================================================
-- 007_verification_codes.sql — 验证码持久化存储
-- 替代内存 Map，支持多实例部署和进程重启
-- ============================================================

CREATE TABLE IF NOT EXISTS verification_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contact     TEXT    NOT NULL,              -- 手机号或邮箱
  code        TEXT    NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,    -- 失败次数
  expires_at  TEXT    NOT NULL,              -- ISO 时间戳
  created_at  TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_verification_codes_contact ON verification_codes(contact);
CREATE INDEX IF NOT EXISTS idx_verification_codes_expires ON verification_codes(expires_at);
