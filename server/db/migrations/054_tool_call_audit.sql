-- ============================================================
-- 054_tool_call_audit.sql
--
-- Hermes 通过 POST /api/hermes/tools/call 反向调用北京工具的审计表。
--
-- 每次调用一行，不论成功失败。用于：
--   1. 排查"为什么某次对话没生成 PPT"
--   2. 越权调用红队取证
--   3. 后期共享学习时分析工具调用模式
--
-- 字段：
--   call_id        Hermes 自报的 function call id (响应内 idempotency)
--   tool           工具名 (web_search / onepager_pptx ...)
--   caller         Hermes 自报角色 (host / market_deal / ...)
--   user_id        当前 session 归属用户
--   conversation_id workspace 对话
--   args_summary   截断后的 args (JSON 字符串，max 1000 字符)
--   outcome        'ok' | 'denied' | 'error'
--   reason         denied/error 的原因（短码）
--   latency_ms     工具执行耗时
--   error_message  错误详情截断
-- ============================================================

CREATE TABLE IF NOT EXISTS tool_call_audit (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id         TEXT,
  tool            TEXT    NOT NULL,
  caller          TEXT,
  user_id         INTEGER,
  conversation_id TEXT,
  args_summary    TEXT,
  outcome         TEXT    NOT NULL CHECK (outcome IN ('ok', 'denied', 'error')),
  reason          TEXT,
  latency_ms      INTEGER,
  error_message   TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tool_call_audit_created
  ON tool_call_audit(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_call_audit_user_tool
  ON tool_call_audit(user_id, tool, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_call_audit_outcome
  ON tool_call_audit(outcome, reason, created_at DESC);
