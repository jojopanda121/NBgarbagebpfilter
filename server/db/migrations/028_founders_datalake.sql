-- 028: founders_datalake — 创始人数据（PII 严格保护）
CREATE TABLE IF NOT EXISTS founders_datalake (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  -- PRIVACY: 手机号和邮箱均经 SHA256 + salt hash，不存明文
  name_hash TEXT,
  phone_hash TEXT,
  email_hash TEXT,
  -- PRIVACY: 姓名经 AES-256-GCM 加密，仅持有 ENCRYPTION_KEY 的授权方可解密
  full_name_encrypted TEXT,
  past_companies TEXT,
  past_projects TEXT,
  risk_flags TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_founders_datalake_name_hash ON founders_datalake(name_hash);
CREATE INDEX IF NOT EXISTS idx_founders_datalake_email_hash ON founders_datalake(email_hash);
