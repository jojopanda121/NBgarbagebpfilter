-- 034: agent_results — 每个 Agent 的详细执行记录（比 agent_runs 更细粒度）
CREATE TABLE IF NOT EXISTS agent_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  user_output TEXT,          -- JSON: 给前端展示的结构化输出
  data_payload TEXT,         -- JSON: Sprint 3 数据飞轮用，先建字段
  llm_tokens_used INTEGER,
  duration_ms INTEGER,
  error_message TEXT,
  started_at DATETIME,
  finished_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 同时给 agent_runs 表加 run_id 文本主键（前端友好）
-- 注意：agent_runs.id 已是整数主键，这里新增 run_id 唯一列
ALTER TABLE agent_runs ADD COLUMN run_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_run_id ON agent_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_results_run ON agent_results(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_results_status ON agent_results(run_id, status);
