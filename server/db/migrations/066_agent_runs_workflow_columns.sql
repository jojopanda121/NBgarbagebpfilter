-- 066: agent_runs workflow summary columns
-- Keeps the legacy per-agent columns nullable-compatible while supporting
-- the current one-row-per-run workflow metadata used by agentRunService.
ALTER TABLE agent_runs ADD COLUMN user_id INTEGER;
ALTER TABLE agent_runs ADD COLUMN total_agents INTEGER DEFAULT 6;
ALTER TABLE agent_runs ADD COLUMN finished_agents INTEGER DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN failed_agents INTEGER DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN finished_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
