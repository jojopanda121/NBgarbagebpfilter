-- 033: project_fingerprints — 跨用户项目交叉识别（只存哈希，不泄露原始数据）
CREATE TABLE IF NOT EXISTS project_fingerprints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- PRIVACY: fingerprint_hash 为项目名+创始人+赛道+核心数据的组合哈希，不可逆还原原始数据
  fingerprint_hash TEXT UNIQUE NOT NULL,
  view_count INTEGER DEFAULT 1,
  avg_score REAL,
  last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创始人多次提交追踪（同一创始人提交多个项目）
CREATE TABLE IF NOT EXISTS founder_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- PRIVACY: founder_hash 为创始人标识哈希，不包含姓名等原文
  founder_hash TEXT NOT NULL,
  project_fingerprint TEXT NOT NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  score REAL
);

CREATE INDEX IF NOT EXISTS idx_project_fingerprints_hash ON project_fingerprints(fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_founder_submissions_hash ON founder_submissions(founder_hash);
