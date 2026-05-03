-- Migration 024: Multi-Agent Workspace
-- Per-project conversational workspace with messages and artifacts

CREATE TABLE IF NOT EXISTS workspace_conversations (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  title TEXT DEFAULT '默认会话',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_ws_conv_task ON workspace_conversations(task_id);
CREATE INDEX IF NOT EXISTS idx_ws_conv_user ON workspace_conversations(user_id);

CREATE TABLE IF NOT EXISTS workspace_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,                -- 'user' | 'agent' | 'system' | 'tool'
  agent_name TEXT,                   -- 'host'/'market'/'finance'/'tech'/'risk'
  content TEXT NOT NULL,
  metadata TEXT,                     -- JSON: routing, tool_calls, attachments
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES workspace_conversations(id)
);
CREATE INDEX IF NOT EXISTS idx_ws_msg_conv ON workspace_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS workspace_artifacts (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT,
  kind TEXT NOT NULL,                -- 'upload' | 'generated_pptx' | 'generated_md'
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  summary TEXT,                      -- LLM 摘要，用于注入后续 prompt
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES workspace_conversations(id)
);
CREATE INDEX IF NOT EXISTS idx_ws_art_conv ON workspace_artifacts(conversation_id);
