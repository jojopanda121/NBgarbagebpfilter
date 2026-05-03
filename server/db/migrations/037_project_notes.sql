-- 037_project_notes.sql
-- Sprint 2: 笔记 + 时间线（统一表，由 entry_type 区分）

CREATE TABLE IF NOT EXISTS project_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,

  -- 'note' / 'project_created' / 'status_change' / 'version_uploaded' /
  -- 'agent_done' / 'file_added' / 'project_merged'
  entry_type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,                                  -- JSON

  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_notes_pid
  ON project_notes(project_id, created_at DESC);

-- 给 tasks 表添加 workspace project_id 关联（注意：与 020 的 project_* 字段不冲突）
ALTER TABLE tasks ADD COLUMN workspace_project_id INTEGER REFERENCES projects(id);
ALTER TABLE tasks ADD COLUMN workspace_version_number INTEGER;
ALTER TABLE tasks ADD COLUMN file_role TEXT DEFAULT 'bp';

CREATE INDEX IF NOT EXISTS idx_tasks_workspace_project
  ON tasks(workspace_project_id);
