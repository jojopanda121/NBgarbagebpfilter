-- 036_project_versions.sql
-- Sprint 2: BP 版本表 — 每次上传都是新版本，永不覆盖

CREATE TABLE IF NOT EXISTS project_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,                      -- 冗余，用于权限校验加速

  version_number INTEGER NOT NULL,               -- 1, 2, 3, ...
  task_id TEXT,                                  -- 关联 tasks.id（一个 BP 文件的分析任务）
  agent_run_id TEXT,                             -- 关联 agent_runs.run_id

  -- 版本快照（从 ProjectSummaryAgent 抓取）
  claimed_valuation REAL,
  claimed_revenue REAL,
  claimed_users INTEGER,
  funding_round TEXT,
  funding_amount REAL,
  total_score REAL,
  core_metrics TEXT,                             -- JSON：完整快照，用于版本对比

  uploaded_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_project_num
  ON project_versions(project_id, version_number);
CREATE INDEX IF NOT EXISTS idx_versions_task ON project_versions(task_id);
