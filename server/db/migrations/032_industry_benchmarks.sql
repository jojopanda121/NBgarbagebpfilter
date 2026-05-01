-- 032: industry_benchmarks — 行业 benchmark（估值合理性对标数据）
CREATE TABLE IF NOT EXISTS industry_benchmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  industry TEXT NOT NULL,
  stage TEXT,
  metric_type TEXT NOT NULL,
  metric_value REAL,
  data_source TEXT DEFAULT 'agent_extracted',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_industry_benchmarks_industry ON industry_benchmarks(industry, stage);
CREATE INDEX IF NOT EXISTS idx_industry_benchmarks_metric ON industry_benchmarks(metric_type);
