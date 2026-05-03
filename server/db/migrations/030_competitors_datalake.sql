-- 030: competitors_datalake — 竞品信息库
CREATE TABLE IF NOT EXISTS competitors_datalake (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  subject_industry TEXT,
  competitor_name TEXT,
  funding_stage TEXT,
  valuation_usd REAL,
  team_size INTEGER,
  founded_year INTEGER,
  latest_news TEXT,
  data_source TEXT DEFAULT 'llm_knowledge',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_competitors_datalake_industry ON competitors_datalake(subject_industry);
