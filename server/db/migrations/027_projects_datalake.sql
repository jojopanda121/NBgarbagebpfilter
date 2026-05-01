-- 027: projects_datalake — 结构化项目数据沉淀（数据飞轮）
CREATE TABLE IF NOT EXISTS projects_datalake (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_hash TEXT,
  user_id INTEGER REFERENCES users(id),
  company_name TEXT,
  industry TEXT,
  sub_industry TEXT,
  business_model TEXT,
  stage TEXT,
  region TEXT,
  claimed_valuation REAL,
  claimed_revenue REAL,
  claimed_users INTEGER,
  funding_round TEXT,
  funding_amount REAL,
  score REAL,
  -- PRIVACY: is_anonymized 默认为 1，用户可关闭匿名化参与数据池
  is_anonymized INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_projects_datalake_industry ON projects_datalake(industry);
CREATE INDEX IF NOT EXISTS idx_projects_datalake_stage ON projects_datalake(stage);
CREATE INDEX IF NOT EXISTS idx_projects_datalake_project_hash ON projects_datalake(project_hash);
