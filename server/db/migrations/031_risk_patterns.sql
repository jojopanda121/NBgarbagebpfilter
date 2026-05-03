-- 031: risk_patterns — 风险模式库（去重累积，形成红旗知识库）
CREATE TABLE IF NOT EXISTS risk_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  pattern_type TEXT,
  description TEXT,
  severity INTEGER DEFAULT 1,
  triggered_count INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_risk_patterns_type ON risk_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_risk_patterns_severity ON risk_patterns(severity);
