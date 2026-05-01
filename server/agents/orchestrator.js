// ============================================================
// server/agents/orchestrator.js — Multiagent 总调度
// 并行触发 6 个 AI Agent，追踪每个 agent 状态到 agent_runs 表
// ============================================================

const { getDb } = require("../db");
const logger = require("../utils/logger");
const projectSummaryAgent = require("./projectSummaryAgent");
const founderAgent = require("./founderAgent");
const financialAgent = require("./financialAgent");
const competitorAgent = require("./competitorAgent");
const redFlagAgent = require("./redFlagAgent");
const valuationAgent = require("./valuationAgent");

const AGENT_DEFS = [
  { name: "project_summary", fn: projectSummaryAgent },
  { name: "founder",         fn: founderAgent },
  { name: "financial",       fn: financialAgent },
  { name: "competitor",      fn: competitorAgent },
  { name: "red_flag",        fn: redFlagAgent },
  { name: "valuation",       fn: valuationAgent },
];

/** 初始化 agent_runs 记录（pending 状态） */
function initAgentRuns(taskId) {
  try {
    const db = getDb();
    const insert = db.prepare(
      "INSERT OR IGNORE INTO agent_runs (task_id, agent_name, status) VALUES (?, ?, 'pending')"
    );
    for (const { name } of AGENT_DEFS) {
      insert.run(taskId, name);
    }
  } catch (err) {
    logger.warn("[Orchestrator] initAgentRuns 失败:", err.message);
  }
}

/** 更新单个 agent 状态 */
function updateAgentRun(taskId, agentName, updates) {
  try {
    const db = getDb();
    const fields = [];
    const values = [];
    if (updates.status !== undefined) { fields.push("status = ?"); values.push(updates.status); }
    if (updates.result !== undefined) { fields.push("result = ?"); values.push(typeof updates.result === "string" ? updates.result : JSON.stringify(updates.result)); }
    if (updates.error !== undefined) { fields.push("error = ?"); values.push(updates.error); }
    if (updates.started_at !== undefined) { fields.push("started_at = ?"); values.push(updates.started_at); }
    if (updates.completed_at !== undefined) { fields.push("completed_at = ?"); values.push(updates.completed_at); }
    if (fields.length === 0) return;
    values.push(taskId, agentName);
    db.prepare(`UPDATE agent_runs SET ${fields.join(", ")} WHERE task_id = ? AND agent_name = ?`).run(...values);
  } catch (err) {
    logger.warn(`[Orchestrator] updateAgentRun(${agentName}) 失败:`, err.message);
  }
}

/** 执行单个 agent，带状态追踪 */
async function runWithTracking(taskId, agentName, fn) {
  updateAgentRun(taskId, agentName, { status: "running", started_at: new Date().toISOString() });
  try {
    const result = await fn();
    updateAgentRun(taskId, agentName, {
      status: "complete",
      result,
      completed_at: new Date().toISOString(),
    });
    return { success: true, result };
  } catch (err) {
    logger.warn(`[Orchestrator] agent(${agentName}) 失败:`, err.message);
    updateAgentRun(taskId, agentName, {
      status: "error",
      error: err.message,
      completed_at: new Date().toISOString(),
    });
    return { success: false, error: err.message, result: null };
  }
}

/**
 * 并行运行所有 6 个 Agent
 * @param {string} bpText — BP 全文
 * @param {object} extractedData — Agent A 已提取的结构化数据
 * @param {string} taskId — 关联的任务 ID
 * @returns {object} multiagent 报告对象
 */
async function runAllAgents(bpText, extractedData, taskId) {
  if (!taskId) {
    logger.warn("[Orchestrator] 未传入 taskId，跳过状态追踪");
  } else {
    initAgentRuns(taskId);
  }

  logger.info("[Orchestrator] 并行启动 6 个 Agent", { taskId });

  const outcomes = await Promise.allSettled(
    AGENT_DEFS.map(({ name, fn }) =>
      runWithTracking(taskId, name, () => fn(bpText, extractedData))
    )
  );

  const result = {};
  const keyMap = {
    project_summary: "project_summary",
    founder:         "founder_profile",
    financial:       "financial_analysis",
    competitor:      "competitor_analysis",
    red_flag:        "red_flags",
    valuation:       "valuation_analysis",
  };

  AGENT_DEFS.forEach(({ name }, i) => {
    const outcome = outcomes[i];
    const key = keyMap[name];
    if (outcome.status === "fulfilled" && outcome.value.success) {
      result[key] = outcome.value.result;
    } else {
      result[key] = { error: outcome.reason?.message || outcome.value?.error || "Agent 执行失败", partial: true };
    }
  });

  logger.info("[Orchestrator] 所有 Agent 执行完毕", { taskId });
  return result;
}

/**
 * 查询某个任务的所有 agent 状态（用于前端进度轮询）
 */
function getAgentRunStatus(taskId) {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT agent_name, status, error, started_at, completed_at FROM agent_runs WHERE task_id = ?"
    ).all(taskId);
    return rows;
  } catch (err) {
    logger.warn("[Orchestrator] getAgentRunStatus 失败:", err.message);
    return [];
  }
}

module.exports = { runAllAgents, getAgentRunStatus, initAgentRuns };
