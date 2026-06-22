// ============================================================
// server/services/multiagentService.js
//
// 深度尽调（multiagent 6 Agent）按需生成。
//
// 背景：原先 6 个 Agent（项目摘要 / 创始人 / 财务 / 竞品 / 红旗 / 估值）在
// BP 分析流水线里强制并发执行并自动展示。改版后分析阶段不再自动跑，改为
// 用户在工作区点按钮按需生成；首次生成后缓存到 tasks.multiagent_cache，
// 后续直接返回。范式对齐 iMemoService。
// ============================================================

const { getDb } = require("../db");
const agentRuntime = require("./agentRuntime");
const logger = require("../utils/logger");

/**
 * 获取或生成深度尽调报告（幂等，有缓存直接返回）。
 *
 * @param {string} taskId
 * @param {number} userId
 * @returns {Promise<{ multiagent: object, generated_at: string }>}
 */
async function getOrGenerateMultiagent(taskId, userId) {
  const db = getDb();
  const row = db.prepare(
    "SELECT id, status, result, multiagent_cache, bp_text FROM tasks WHERE id = ?"
  ).get(taskId);

  if (!row) throw new Error("任务不存在");

  // 有缓存直接返回
  if (row.multiagent_cache) {
    return JSON.parse(row.multiagent_cache);
  }

  if (row.status !== "complete") {
    throw new Error("报告未完成，无法生成深度尽调");
  }

  const result = typeof row.result === "string" ? JSON.parse(row.result) : row.result;
  const extractedData = result?.extracted_data;
  const bpText = row.bp_text;

  // bp_text 自本版本起才持久化；旧任务无原文，6 个 Agent 依赖 bpFullText，无法重跑
  if (!bpText) {
    throw new Error("该项目分析于旧版本，未保存 BP 原文，无法生成深度尽调报告。请重新上传 BP 分析。");
  }
  if (!extractedData) {
    throw new Error("报告数据不完整，无法生成深度尽调");
  }

  logger.info("[Multiagent] on-demand 生成开始", { taskId });
  const { multiagent } = await agentRuntime.runBpPipeline({
    bpText, extractedData, taskId, userId,
  });

  if (!multiagent || multiagent.error) {
    throw new Error(multiagent?.error || "深度尽调生成失败，请稍后重试");
  }

  const payload = { multiagent, generated_at: new Date().toISOString() };
  db.prepare("UPDATE tasks SET multiagent_cache = ? WHERE id = ?")
    .run(JSON.stringify(payload), taskId);

  logger.info("[Multiagent] on-demand 生成完成并缓存", { taskId });
  return payload;
}

/**
 * 强制重新生成（清除缓存）。
 */
async function regenerateMultiagent(taskId, userId) {
  const db = getDb();
  db.prepare("UPDATE tasks SET multiagent_cache = NULL WHERE id = ?").run(taskId);
  return getOrGenerateMultiagent(taskId, userId);
}

module.exports = { getOrGenerateMultiagent, regenerateMultiagent };
