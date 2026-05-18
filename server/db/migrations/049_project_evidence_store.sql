-- ============================================================
-- 049_project_evidence_store.sql
--
-- Lightweight project-scoped evidence store.
-- - SQLite + FTS5, no vector DB.
-- - Uploads from non-VIP users expire after 3 days.
-- - VIP uploads are kept while VIP is active; if VIP lapses, cleanup uses
--   vip_expires_at + 3 days as the new expiry.
-- ============================================================

ALTER TABLE workspace_artifact_structured_extracts ADD COLUMN project_id INTEGER;
ALTER TABLE workspace_artifact_structured_extracts ADD COLUMN evidence_level INTEGER DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_wase_project
  ON workspace_artifact_structured_extracts(project_id, extraction_status, updated_at);

CREATE TABLE IF NOT EXISTS workspace_documents (
  document_id TEXT PRIMARY KEY,
  project_id INTEGER,
  conversation_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL UNIQUE,
  user_id INTEGER,
  file_name TEXT,
  raw_text TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  source_type TEXT NOT NULL DEFAULT 'upload',
  evidence_level INTEGER NOT NULL DEFAULT 2,
  industry_tags TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ws_docs_project
  ON workspace_documents(project_id, evidence_level, updated_at);
CREATE INDEX IF NOT EXISTS idx_ws_docs_artifact
  ON workspace_documents(artifact_id);
CREATE INDEX IF NOT EXISTS idx_ws_docs_expires
  ON workspace_documents(expires_at);

CREATE VIRTUAL TABLE IF NOT EXISTS workspace_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  document_id UNINDEXED,
  project_id UNINDEXED,
  artifact_id UNINDEXED,
  chunk_text,
  source_ref UNINDEXED,
  tokenize = 'unicode61'
);

CREATE TABLE IF NOT EXISTS structured_facts (
  fact_id TEXT PRIMARY KEY,
  project_id INTEGER,
  document_id TEXT,
  artifact_id TEXT,
  fact_type TEXT NOT NULL,
  field TEXT,
  label TEXT,
  value TEXT,
  fact_json TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  evidence_level INTEGER NOT NULL,
  confidence TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(document_id) REFERENCES workspace_documents(document_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_structured_facts_project
  ON structured_facts(project_id, evidence_level, fact_type, updated_at);
CREATE INDEX IF NOT EXISTS idx_structured_facts_artifact
  ON structured_facts(artifact_id);

CREATE TABLE IF NOT EXISTS conflicts (
  conflict_id TEXT PRIMARY KEY,
  project_id INTEGER,
  field TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]',
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  conflict_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conflicts_project
  ON conflicts(project_id, status, severity, updated_at);

-- Retention policy correction: free/non-active-VIP uploads are 3-day
-- materials. Active VIP uploads remain permanent until VIP lapses.
UPDATE workspace_artifacts
SET expires_at = NULL
WHERE kind = 'upload'
  AND conversation_id IN (
    SELECT c.id
    FROM workspace_conversations c
    JOIN users u ON u.id = c.user_id
    WHERE u.is_vip = 1
      AND (u.vip_expires_at IS NULL OR u.vip_expires_at > datetime('now'))
  );

UPDATE workspace_artifacts
SET expires_at = datetime(
  COALESCE((
    SELECT u.vip_expires_at
    FROM workspace_conversations c
    JOIN users u ON u.id = c.user_id
    WHERE c.id = workspace_artifacts.conversation_id
      AND u.is_vip = 1
      AND u.vip_expires_at IS NOT NULL
      AND u.vip_expires_at <= datetime('now')
  ), created_at),
  '+3 days'
)
WHERE kind = 'upload'
  AND conversation_id IN (
    SELECT c.id
    FROM workspace_conversations c
    JOIN users u ON u.id = c.user_id
    WHERE COALESCE(u.is_vip, 0) = 0
       OR (u.vip_expires_at IS NOT NULL AND u.vip_expires_at <= datetime('now'))
  );
