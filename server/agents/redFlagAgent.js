// ============================================================
// server/agents/redFlagAgent.js — 红旗扫描 Agent
// 综合 BP 全文和其他 agent 输出，识别风险信号
// ============================================================

const { callLLM } = require("../services/llmService");
const { extractJson } = require("../utils/jsonParser");
const { RED_FLAG_AGENT_PROMPT } = require("../utils/prompts");
const logger = require("../utils/logger");

const MAX_BP_CHARS = 20000;

/**
 * @param {string} bpText
 * @param {object} extractedData
 * @returns {object} 红旗扫描结果
 */
async function redFlagAgent(bpText, extractedData) {
  const truncated = bpText.length > MAX_BP_CHARS
    ? bpText.slice(0, MAX_BP_CHARS) + "\n...(已截断)"
    : bpText;

  const userContent = [
    `【商业计划书全文节选】\n${truncated}`,
    `\n\n【已提取结构化数据】\n${JSON.stringify({
      company_name: extractedData.company_name,
      industry: extractedData.industry,
      BP_Valuation: extractedData.BP_Valuation,
      BP_Revenue: extractedData.BP_Revenue,
      Founder_Exp_Years: extractedData.Founder_Exp_Years,
      Business_Model: extractedData.Business_Model,
      Growth_Engine: extractedData.Growth_Engine,
      Network_Effect: extractedData.Network_Effect,
    }, null, 2)}`,
    `\n\n【关键声明列表（供核查）】\n${JSON.stringify(
      (extractedData.key_claims || []).slice(0, 15), null, 2
    )}`,
  ].join("");

  let raw;
  try {
    raw = await callLLM(RED_FLAG_AGENT_PROMPT, userContent, 8192);
  } catch (err) {
    logger.warn("[RedFlagAgent] LLM 调用失败:", err.message);
    throw err;
  }

  let result = extractJson(raw);
  if (!result || !result.red_flags) {
    logger.warn("[RedFlagAgent] JSON 解析失败，重试...");
    raw = await callLLM(
      RED_FLAG_AGENT_PROMPT + "\n\n【紧急提醒】只输出 JSON 对象，不要 markdown 代码块。",
      userContent,
      8192
    );
    result = extractJson(raw);
  }

  if (!result) throw new Error("RedFlagAgent JSON 解析失败");

  logger.info("[RedFlagAgent] 完成", {
    flagCount: result.red_flags?.length,
    riskLevel: result.overall_risk_level,
  });
  return result;
}

module.exports = redFlagAgent;
