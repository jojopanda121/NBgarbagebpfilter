// ============================================================
// server/agents/financialAgent.js — 财务核查 Agent
// 核查财务数据自洽性，识别异常数据点
// ============================================================

const { callLLM } = require("../services/llmService");
const { extractJson } = require("../utils/jsonParser");
const { FINANCIAL_AGENT_PROMPT } = require("../utils/prompts");
const logger = require("../utils/logger");

const MAX_BP_CHARS = 20000;

/**
 * @param {string} bpText
 * @param {object} extractedData
 * @returns {object} 财务分析结果
 */
async function financialAgent(bpText, extractedData) {
  const truncated = bpText.length > MAX_BP_CHARS
    ? bpText.slice(0, MAX_BP_CHARS) + "\n...(已截断)"
    : bpText;

  const userContent = [
    `【商业计划书全文节选】\n${truncated}`,
    `\n\n【已知结构化数据】\n${JSON.stringify({
      industry: extractedData.industry,
      company_name: extractedData.company_name,
      BP_Valuation: extractedData.BP_Valuation,
      BP_Revenue: extractedData.BP_Revenue,
      Business_Model: extractedData.Business_Model,
    }, null, 2)}`,
  ].join("");

  let raw;
  try {
    raw = await callLLM(FINANCIAL_AGENT_PROMPT, userContent, 6144);
  } catch (err) {
    logger.warn("[FinancialAgent] LLM 调用失败:", err.message);
    throw err;
  }

  let result = extractJson(raw);
  if (!result) {
    logger.warn("[FinancialAgent] JSON 解析失败，重试...");
    raw = await callLLM(
      FINANCIAL_AGENT_PROMPT + "\n\n【紧急提醒】只输出 JSON 对象，不要 markdown 代码块。",
      userContent,
      6144
    );
    result = extractJson(raw);
  }

  if (!result) throw new Error("FinancialAgent JSON 解析失败");

  logger.info("[FinancialAgent] 完成", { anomalyCount: result.anomalies?.length });
  return result;
}

module.exports = financialAgent;
