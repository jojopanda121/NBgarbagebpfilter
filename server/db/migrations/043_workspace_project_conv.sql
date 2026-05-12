-- 042_workspace_project_conv.sql
-- 把会话从 task 级提升到 workspace project 级。
-- 目标:同一个项目的多版 BP 共享一条对话上下文。
--
-- 同时把 task_id 改为可空(原 024 schema 把 task_id 设为 NOT NULL,
-- 阻止了"项目级对话还没绑定到 task"的合法场景)。
-- SQLite 不支持 DROP NOT NULL,所以走 rebuild-and-swap 标准做法。

PRAGMA foreign_keys = OFF;

CREATE TABLE workspace_conversations_new (
  id TEXT PRIMARY KEY,
  task_id TEXT,                                              -- 改为 nullable
  project_id INTEGER REFERENCES projects(id),                -- 新列
  user_id INTEGER NOT NULL,
  title TEXT DEFAULT '默认会话',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- backfill: project_id 来自 tasks.workspace_project_id;task_id 保留
INSERT INTO workspace_conversations_new (id, task_id, project_id, user_id, title, created_at, updated_at)
SELECT
  c.id,
  c.task_id,
  (SELECT t.workspace_project_id FROM tasks t WHERE t.id = c.task_id),
  c.user_id,
  c.title,
  c.created_at,
  c.updated_at
FROM workspace_conversations c;

DROP TABLE workspace_conversations;
ALTER TABLE workspace_conversations_new RENAME TO workspace_conversations;

CREATE INDEX IF NOT EXISTS idx_ws_conv_task ON workspace_conversations(task_id);
CREATE INDEX IF NOT EXISTS idx_ws_conv_user ON workspace_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_ws_conv_project ON workspace_conversations(project_id, user_id, created_at);

PRAGMA foreign_keys = ON;
