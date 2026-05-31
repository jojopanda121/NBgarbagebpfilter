// ============================================================
// server/services/fallbackLogger.js
//
// 写 runtime_fallback_log 表，并暴露简单 metrics 给监控页用。
// 由 agentRuntimeRouter 在每次路由决策完成后调用。
// ============================================================

const { getDb } = require("../db");

const REASONS = Object.freeze({
  HEALTHCHECK_FAILED: "healthcheck_failed",
  CONNECT_TIMEOUT: "connect_timeout",
  AUTH_FAILED: "auth_failed",
  HTTP_5XX: "http_5xx",
  HTTP_4XX: "http_4xx",
  STREAM_ABORTED: "stream_aborted",
  MANUAL_OVERRIDE: "manual_override",
  HERMES_DISABLED: "hermes_disabled",
});

const PHASES = Object.freeze({
  PRE_STREAM: "pre_stream",
  MID_STREAM: "mid_stream",
});

const TARGETS = Object.freeze({
  WORKSPACE_CONVERSATION: "workspace_conversation",
  BP_PIPELINE: "bp_pipeline",
});

function record({
  runtime,
  reason = null,
  phase = null,
  target,
  userId = null,
  conversationId = null,
  latencyMs = null,
  errorMessage = null,
}) {
  try {
    const db = getDb();
    const truncated = errorMessage ? String(errorMessage).slice(0, 500) : null;
    db.prepare(`
      INSERT INTO runtime_fallback_log
        (runtime, reason, phase, target, user_id, conversation_id, latency_ms, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(runtime, reason, phase, target, userId, conversationId, latencyMs, truncated);
  } catch (err) {
    // 监控失败绝不能阻塞主流程
    console.error("[fallbackLogger] failed to record:", err.message);
  }
}

function getRecentStats({ windowHours = 24 } = {}) {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT runtime, reason, COUNT(*) AS n, AVG(latency_ms) AS avg_latency
      FROM runtime_fallback_log
      WHERE created_at >= datetime('now', '-' || ? || ' hours')
      GROUP BY runtime, reason
      ORDER BY n DESC
    `).all(windowHours);
    return rows;
  } catch (err) {
    console.error("[fallbackLogger] getRecentStats failed:", err.message);
    return [];
  }
}

module.exports = {
  record,
  getRecentStats,
  REASONS,
  PHASES,
  TARGETS,
};
