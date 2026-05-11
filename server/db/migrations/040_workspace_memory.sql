-- Migration 040: Structured memory for multi-agent workspace

CREATE TABLE IF NOT EXISTS workspace_memory_shared (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'project',
  category TEXT NOT NULL,
  claim_key TEXT NOT NULL,
  claim TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '[]',
  implication TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0.5,
  freshness TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  supersedes TEXT,
  owner_agent TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  usage_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_mem_shared_key
  ON workspace_memory_shared(task_id, category, claim_key);
CREATE INDEX IF NOT EXISTS idx_ws_mem_shared_lookup
  ON workspace_memory_shared(task_id, category, status, updated_at);

CREATE TABLE IF NOT EXISTS workspace_memory_longterm (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  trigger TEXT NOT NULL,
  rule TEXT NOT NULL,
  action TEXT NOT NULL,
  examples TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'active',
  usage_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  decay_score REAL NOT NULL DEFAULT 1.0,
  last_used_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_mem_longterm_key
  ON workspace_memory_longterm(user_id, type, trigger, rule);
CREATE INDEX IF NOT EXISTS idx_ws_mem_longterm_lookup
  ON workspace_memory_longterm(user_id, type, status, updated_at);

CREATE TABLE IF NOT EXISTS workspace_agent_working_memory (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT '',
  hypotheses TEXT NOT NULL DEFAULT '[]',
  evidence_refs TEXT NOT NULL DEFAULT '[]',
  intermediate_findings TEXT NOT NULL DEFAULT '[]',
  open_questions TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ws_working_run_agent
  ON workspace_agent_working_memory(run_id, agent_name);
CREATE INDEX IF NOT EXISTS idx_ws_working_expiry
  ON workspace_agent_working_memory(expires_at);

CREATE TABLE IF NOT EXISTS workspace_memory_usage (
  id TEXT PRIMARY KEY,
  memory_layer TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  task_id TEXT,
  user_id INTEGER,
  agent_name TEXT,
  outcome TEXT NOT NULL DEFAULT 'used',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ws_memory_usage_lookup
  ON workspace_memory_usage(memory_layer, memory_id, outcome, created_at);

CREATE TABLE IF NOT EXISTS workspace_skills (
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  user_scope TEXT NOT NULL DEFAULT 'global',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  trigger TEXT NOT NULL DEFAULT '{}',
  required_inputs TEXT NOT NULL DEFAULT '[]',
  steps TEXT NOT NULL DEFAULT '[]',
  success_criteria TEXT NOT NULL DEFAULT '[]',
  failure_modes TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  usage_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_from_run_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_skills_name_user
  ON workspace_skills(user_scope, name);
CREATE INDEX IF NOT EXISTS idx_ws_skills_lookup
  ON workspace_skills(status, updated_at);
