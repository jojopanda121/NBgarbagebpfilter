-- 041_teaser_shares.sql
-- 加密 Teaser 分享:用于把脱敏后的项目要点发给潜在 LP / 共投方。
--
-- 安全模型:
--   - payload_ciphertext 是 AES-256-GCM 密文,密钥 = scrypt(password)
--   - password_hash 用 bcrypt,只用于"前端先校验密码再请后端解密",
--     不充当密钥 — 实际解密用 password 派生的密钥,服务器永不持久化明文密钥
--   - max_views / expires_at / revoked_at 多重失效闸
--   - 每次访问写 teaser_access_log,owner 能追溯

CREATE TABLE IF NOT EXISTS teaser_shares (
  id TEXT PRIMARY KEY,                         -- token,公开 URL 用
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,                    -- 创建者(owner)

  cipher_alg TEXT NOT NULL DEFAULT 'aes-256-gcm',
  kdf_alg TEXT NOT NULL DEFAULT 'scrypt',
  kdf_salt TEXT NOT NULL,                      -- hex
  cipher_iv TEXT NOT NULL,                     -- hex
  cipher_tag TEXT NOT NULL,                    -- hex (GCM auth tag)
  payload_ciphertext TEXT NOT NULL,            -- hex

  password_hash TEXT,                          -- bcrypt,可空(无密码模式)
  recipient_label TEXT,                        -- 给 owner 自己看的备注:"发给红杉张三"
  watermark_text TEXT,                         -- 可选水印,如收件人邮箱

  expires_at TEXT,
  max_views INTEGER,
  view_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT,

  created_at TEXT DEFAULT (datetime('now')),
  last_viewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_teaser_shares_project ON teaser_shares(project_id);
CREATE INDEX IF NOT EXISTS idx_teaser_shares_user ON teaser_shares(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS teaser_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  share_id TEXT NOT NULL REFERENCES teaser_shares(id) ON DELETE CASCADE,
  ip TEXT,
  user_agent TEXT,
  outcome TEXT NOT NULL,                       -- 'viewed' | 'wrong_password' | 'expired' | 'revoked' | 'limit_exceeded'
  viewed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_teaser_access_share ON teaser_access_log(share_id, viewed_at DESC);
