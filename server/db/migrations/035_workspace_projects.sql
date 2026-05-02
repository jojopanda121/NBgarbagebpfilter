-- 035_workspace_projects.sql
-- Sprint 2: 项目工作台 — 真正的项目容器（聚合多个 BP 版本）
-- 命名注意：这与 020_project_fields.sql 在 tasks 表上的 project_* 字段共存。
-- 一个 workspace project 包含多个 task（每个 task = 一个 BP 版本）。

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),

  -- 基础信息（来自 ProjectSummaryAgent / FounderAgent 输出，自动填充）
  name TEXT NOT NULL,
  one_liner TEXT,
  industry TEXT,
  sub_industry TEXT,
  business_model TEXT,
  stage TEXT,
  region TEXT,
  founder_names TEXT,                -- JSON 数组，用于匹配

  -- 状态机：screening / met / shortlisted / dd / ic / ts / invested / passed
  status TEXT NOT NULL DEFAULT 'screening',
  status_changed_at TEXT DEFAULT (datetime('now')),

  -- 评分快照（取最新版本 BP 的评分）
  latest_score REAL,
  latest_run_id TEXT,                -- 最新一版的 agent_runs.run_id
  latest_task_id TEXT,               -- 最新一版的 tasks.id

  -- 跟进
  next_action TEXT,
  remind_at TEXT,
  is_archived INTEGER DEFAULT 0,

  -- 元数据
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workspace_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_projects_status ON projects(user_id, status);
CREATE INDEX IF NOT EXISTS idx_workspace_projects_industry ON projects(user_id, industry);
