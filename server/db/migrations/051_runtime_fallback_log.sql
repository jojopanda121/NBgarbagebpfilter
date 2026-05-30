-- ============================================================
-- 051_runtime_fallback_log.sql
--
-- Hermes-first Runtime with Legacy Backup —— fallback 审计表。
--
-- agentRuntimeRouter 每次决定走主路径 (hermes) 还是 fallback (legacy)
-- 都会写入这张表。用来：
--   1. 监控新加坡 Hermes / Tailscale 健康度趋势
--   2. 排查"为什么我的对话突然变成 legacy 风格"
--   3. CI 每日 fallback 演练通过率
--
-- 字段说明：
--   runtime ∈ {'hermes', 'legacy'}  —— 实际执行的路径
--   reason —— 走 legacy 时的原因 ('healthcheck_failed' | 'connect_timeout'
--             | 'auth_failed' | 'http_5xx' | 'manual_override' | NULL)
--   phase ∈ {'pre_stream', 'mid_stream'}
--             pre_stream 才允许自动切；mid_stream 失败只记录不切
--   target ∈ {'workspace_conversation', 'bp_pipeline'}
--   user_id / conversation_id —— 关联上下文，便于回溯
--   latency_ms —— 主路径尝试耗时（含失败的）；纯 legacy 路径填 legacy 总耗时
--   error_message —— 截断的错误信息（max 500 字符）
-- ============================================================

CREATE TABLE IF NOT EXISTS runtime_fallback_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  runtime         TEXT    NOT NULL CHECK (runtime IN ('hermes', 'legacy')),
  reason          TEXT,
  phase           TEXT    CHECK (phase IN ('pre_stream', 'mid_stream')),
  target          TEXT    NOT NULL,
  user_id         INTEGER,
  conversation_id TEXT,
  latency_ms      INTEGER,
  error_message   TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_runtime_fallback_log_created
  ON runtime_fallback_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_fallback_log_runtime_reason
  ON runtime_fallback_log(runtime, reason, created_at DESC);
