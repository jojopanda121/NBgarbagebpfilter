// ============================================================
// server/services/agentRunService.js — agent_runs / agent_results CRUD
// ============================================================

const { getDb } = require("../db");
const logger = require("../utils/logger");

const AGENT_NAMES = [
  "project_summary",
  "founder",
  "financial",
  "competitor",
  "red_flag",
  "valuation",
];

/**
 * 创建一次 Agent 工作流记录
 */
function createRun({ runId, taskId, userId }) {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO agent_runs
       (run_id, task_id, user_id, status, total_agents, finished_agents, failed_agents)
     VALUES (?, ?, ?, 'pending', 6, 0, 0)`
  ).run(runId, taskId || null, userId || null);

  // 预建 agent_results 行（pending 状态）
  const ins = db.prepare(
    `INSERT OR IGNORE INTO agent_results (run_id, agent_name, status) VALUES (?, ?, 'pending')`
  );
  for (const name of AGENT_NAMES) {
    ins.run(runId, name);
  }

  logger.info("[AgentRunService] createRun", { runId, taskId });
  return runId;
}

/**
 * 标记单个 Agent 开始运行
 */
function markAgentStarted(runId, agentName) {
  const db = getDb();
  db.prepare(
    `UPDATE agent_results SET status='running', started_at=CURRENT_TIMESTAMP
     WHERE run_id=? AND agent_name=?`
  ).run(runId, agentName);
  // 同步更新 agent_runs 为 running（如果还是 pending）
  db.prepare(
    `UPDATE agent_runs SET status='running' WHERE run_id=? AND status='pending'`
  ).run(runId);
}

/**
 * 标记单个 Agent 完成
 */
function markAgentDone(runId, agentName, { userOutput, dataPayload, tokens, durationMs }) {
  const db = getDb();
  db.prepare(
    `UPDATE agent_results
     SET status='done', user_output=?, data_payload=?,
         llm_tokens_used=?, duration_ms=?, finished_at=CURRENT_TIMESTAMP
     WHERE run_id=? AND agent_name=?`
  ).run(
    userOutput ? JSON.stringify(userOutput) : null,
    dataPayload ? JSON.stringify(dataPayload) : null,
    tokens || 0,
    durationMs || 0,
    runId,
    agentName
  );
  // 递增完成计数
  db.prepare(
    `UPDATE agent_runs SET finished_agents = finished_agents + 1 WHERE run_id=?`
  ).run(runId);
}

/**
 * 标记单个 Agent 失败
 */
function markAgentFailed(runId, agentName, { error, durationMs }) {
  const db = getDb();
  db.prepare(
    `UPDATE agent_results
     SET status='failed', error_message=?, duration_ms=?, finished_at=CURRENT_TIMESTAMP
     WHERE run_id=? AND agent_name=?`
  ).run(error || "unknown error", durationMs || 0, runId, agentName);
  db.prepare(
    `UPDATE agent_runs SET failed_agents = failed_agents + 1 WHERE run_id=?`
  ).run(runId);
}

/**
 * 标记整个工作流完成
 */
function markRunFinished(runId) {
  const db = getDb();
  const row = db.prepare(
    `SELECT failed_agents FROM agent_runs WHERE run_id=?`
  ).get(runId);
  const finalStatus = (row && row.failed_agents > 0) ? "done_with_errors" : "done";
  db.prepare(
    `UPDATE agent_runs SET status=?, finished_at=CURRENT_TIMESTAMP WHERE run_id=?`
  ).run(finalStatus, runId);
}

/**
 * 查询工作流状态 + 各 Agent 状态摘要（轻量版，用于进度轮询）
 */
function getRunStatus(runId, userId) {
  const db = getDb();
  const run = db.prepare(
    `SELECT run_id, task_id, status, total_agents, finished_agents, failed_agents,
            started_at, finished_at
     FROM agent_runs WHERE run_id=? AND (user_id=? OR ?=0)`
  ).get(runId, userId || 0, userId || 0);
  if (!run) return null;

  const agents = db.prepare(
    `SELECT agent_name, status, error_message, duration_ms, started_at, finished_at
     FROM agent_results WHERE run_id=? ORDER BY id`
  ).all(runId);

  return { ...run, agents };
}

/**
 * 查询完整报告（含 user_output JSON）
 */
function getFullReport(runId, userId) {
  const db = getDb();
  const run = db.prepare(
    `SELECT run_id, task_id, status, finished_at FROM agent_runs
     WHERE run_id=? AND (user_id=? OR ?=0)`
  ).get(runId, userId || 0, userId || 0);
  if (!run) return null;

  const agents = db.prepare(
    `SELECT agent_name, status, user_output, error_message, duration_ms
     FROM agent_results WHERE run_id=? ORDER BY id`
  ).all(runId);

  const report = {};
  for (const a of agents) {
    try {
      report[a.agent_name] = {
        status: a.status,
        error: a.error_message || null,
        duration_ms: a.duration_ms,
        data: a.user_output ? JSON.parse(a.user_output) : null,
      };
    } catch {
      report[a.agent_name] = { status: a.status, data: null };
    }
  }

  return { ...run, report };
}

/**
 * PRIVACY: 校验 runId 是否属于当前用户（防止越权订阅 SSE）
 */
function runBelongsToUser(runId, userId) {
  const db = getDb();
  const row = db.prepare(
    `SELECT id FROM agent_runs WHERE run_id=? AND user_id=?`
  ).get(runId, userId);
  return !!row;
}

module.exports = {
  createRun,
  markAgentStarted,
  markAgentDone,
  markAgentFailed,
  markRunFinished,
  getRunStatus,
  getFullReport,
  runBelongsToUser,
};
