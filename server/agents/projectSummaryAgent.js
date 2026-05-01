// ============================================================
// server/agents/projectSummaryAgent.js — 项目摘要 Agent
// 提取赛道/商业模式/融资等核心结构化字段
// ============================================================

const { callLLM } = require("../services/llmService");
const { extractJson } = require("../utils/jsonParser");
const { PROJECT_SUMMARY_AGENT_PROMPT } = require("../utils/prompts");
const logger = require("../utils/logger");

const MAX_BP_CHARS = 20000;

/**
 * @param {string} bpText — BP 全文
 * @param {object} extractedData — Agent A 提取的结构化数据（作为补充上下文）
 * @returns {object} 项目摘要结构化数据
 */
async function projectSummaryAgent(bpText, extractedData) {
  const truncated = bpText.length > MAX_BP_CHARS
    ? bpText.slice(0, MAX_BP_CHARS) + "\n...(已截断)"
    : bpText;

  const userContent = [
    `【商业计划书全文节选（${truncated.length} 字符）】\n${truncated}`,
    `\n\n【Agent A 已提取数据（参考）】\n${JSON.stringify({
      company_name: extractedData.company_name,
      industry: extractedData.industry,
      BP_Valuation: extractedData.BP_Valuation,
      BP_Revenue: extractedData.BP_Revenue,
      Business_Model: extractedData.Business_Model,
      project_location: extractedData.project_location,
    }, null, 2)}`,
  ].join("");

  let raw;
  try {
    raw = await callLLM(PROJECT_SUMMARY_AGENT_PROMPT, userContent, 4096);
  } catch (err) {
    logger.warn("[ProjectSummaryAgent] LLM 调用失败:", err.message);
    throw err;
  }

  let result = extractJson(raw);
  if (!result || !result.company_name) {
    // 重试一次
    logger.warn("[ProjectSummaryAgent] JSON 解析失败，重试...");
    raw = await callLLM(
      PROJECT_SUMMARY_AGENT_PROMPT + "\n\n【紧急提醒】只输出 JSON 对象，不要 markdown 代码块。",
      userContent,
      4096
    );
    result = extractJson(raw);
  }

  if (!result) throw new Error("ProjectSummaryAgent JSON 解析失败");

  logger.info("[ProjectSummaryAgent] 完成", { company: result.company_name });
  return result;
}

module.exports = projectSummaryAgent;
