-- 043_merge_suggestions.sql
-- 替换 orchestrator.js 里的 silent auto-merge:
-- 0.5 ≤ score < 0.92 时,新建项目 + 记录一条 merge_suggestion 让用户决定。

CREATE TABLE IF NOT EXISTS project_merge_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  new_project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,    -- 本次新建的项目
  candidate_project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, -- 系统怀疑跟它是同一个
  match_score REAL NOT NULL,
  match_signals TEXT,                                                           -- JSON: { name_sim, founder_sim, ... }

  -- 'pending' / 'accepted' / 'dismissed'
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_at TEXT,
  resolved_by INTEGER,                  -- user_id

  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_merge_sugg_user_pending
  ON project_merge_suggestions(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_merge_sugg_new_project
  ON project_merge_suggestions(new_project_id);
