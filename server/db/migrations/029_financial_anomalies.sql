-- 029: financial_anomalies — 财务异常模式库
CREATE TABLE IF NOT EXISTS financial_anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  anomaly_type TEXT,
  description TEXT,
  severity INTEGER DEFAULT 1,
  industry TEXT,
  stage TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_financial_anomalies_industry ON financial_anomalies(industry);
CREATE INDEX IF NOT EXISTS idx_financial_anomalies_type ON financial_anomalies(anomaly_type);
