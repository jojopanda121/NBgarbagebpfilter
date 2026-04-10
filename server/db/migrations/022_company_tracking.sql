-- Migration 022: Company entity tracking, BP corpus, and prediction validation
-- Designed for future model fine-tuning and performance analysis

-- Table 1: Company entities - One row per company
CREATE TABLE IF NOT EXISTS company_entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  company_short_names TEXT,
  credit_code TEXT,
  founder_names TEXT,
  city TEXT,
  founded_year INTEGER,
  industry_tags TEXT,
  first_task_id TEXT,
  current_status TEXT DEFAULT 'unknown',
  status_updated_at TEXT,
  total_bp_count INTEGER DEFAULT 1,
  tracking_enabled INTEGER DEFAULT 1,
  qcc_raw_registration TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_entities_credit_code
  ON company_entities(credit_code) WHERE credit_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_company_entities_company_name
  ON company_entities(company_name);

-- Table 2: BP-Company links - Links BP analysis tasks to company entities
CREATE TABLE IF NOT EXISTS bp_company_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  company_id INTEGER NOT NULL,
  bp_round TEXT,
  analysis_date TEXT,
  ai_total_score REAL,
  ai_dimension_scores TEXT,
  human_adjusted_score REAL,
  raw_bp_text_hash TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (company_id) REFERENCES company_entities(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bp_company_links_task_company
  ON bp_company_links(task_id, company_id);

-- Table 3: Company snapshots - Quarterly tracking snapshots
CREATE TABLE IF NOT EXISTS company_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  snapshot_date TEXT NOT NULL,
  operating_status TEXT,
  latest_funding_round TEXT,
  latest_funding_amount TEXT,
  latest_valuation TEXT,
  news_sentiment TEXT,
  major_events TEXT,
  risk_flags TEXT,
  patent_count INTEGER,
  lawsuit_summary TEXT,
  employee_trend TEXT,
  data_sources TEXT,
  qcc_raw_data TEXT,
  confidence REAL,
  model_version TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES company_entities(id)
);

CREATE INDEX IF NOT EXISTS idx_company_snapshots_company_date
  ON company_snapshots(company_id, snapshot_date);

-- Table 4: Prediction validations - Aligns predictions with outcomes
CREATE TABLE IF NOT EXISTS prediction_validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  company_id INTEGER NOT NULL,
  prediction_score REAL,
  prediction_grade TEXT,
  prediction_dimensions TEXT,
  months_elapsed INTEGER,
  outcome_status TEXT,
  outcome_score REAL,
  score_error REAL,
  validation_date TEXT,
  snapshot_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (company_id) REFERENCES company_entities(id),
  FOREIGN KEY (snapshot_id) REFERENCES company_snapshots(id)
);

CREATE INDEX IF NOT EXISTS idx_prediction_validations_company_months
  ON prediction_validations(company_id, months_elapsed);

-- Table 5: Training BP corpus - Standardized BP text for training
CREATE TABLE IF NOT EXISTS training_bp_corpus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_hash TEXT UNIQUE NOT NULL,
  raw_text TEXT NOT NULL,
  char_count INTEGER,
  language TEXT DEFAULT 'zh',
  industry_tags TEXT,
  company_id INTEGER,
  upload_count INTEGER DEFAULT 1,
  first_seen_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES company_entities(id)
);

-- Table 6: Model evaluation metrics - Model performance tracking
CREATE TABLE IF NOT EXISTS model_eval_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eval_date TEXT,
  total_companies INTEGER,
  months_window INTEGER,
  rank_correlation REAL,
  calibration_error REAL,
  precision_at_top20 REAL,
  recall_of_winners REAL,
  dimension_correlations TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
