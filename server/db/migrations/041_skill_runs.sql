-- 040_skill_runs.sql
-- Skill 执行日志:每次调用 skill 都落一行,便于审计和前端展示历史产物。

CREATE TABLE IF NOT EXISTS skill_runs (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  user_id INTEGER,
  project_id INTEGER,                 -- workspace project id(可空,某些 skill 不挂项目)
  params_json TEXT,                   -- 调用参数
  artifact_json TEXT,                 -- 产物元数据 JSON(payload / downloadUrl 等)
  status TEXT NOT NULL DEFAULT 'running', -- running | succeeded | failed
  error TEXT,
  duration_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_skill_runs_user ON skill_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_runs_project ON skill_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_runs_skill ON skill_runs(skill_id, created_at DESC);
