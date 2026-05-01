// ============================================================
// server/agents/competitorAgent.js — 竞品分析 Agent
// 使用 callLLMWithSearch 获取最新竞品信息
// ============================================================

const { callLLMWithSearch } = require("../services/llmService");
const { extractJson } = require("../utils/jsonParser");
const { COMPETITOR_AGENT_PROMPT } = require("../utils/prompts");
const logger = require("../utils/logger");

/**
 * @param {string} bpText
 * @param {object} extractedData
 * @returns {object} 竞品分析结果
 */
async function competitorAgent(bpText, extractedData) {
  const industry = extractedData.industry || "未知赛道";
  const company = extractedData.company_name || "未知公司";
  const businessModel = extractedData.Business_Model || "";

  const userContent = [
    `【分析对象】公司：${company}，赛道：${industry}，商业模式：${businessModel}`,
    `\n\n【BP 产品竞争声明】\n${extractedData.bp_claims_product || "无"}`,
    `\n\n【BP 节选（前 8000 字）】\n${bpText.slice(0, 8000)}`,
  ].join("");

  let result;
  try {
    const { text, searchUsed } = await callLLMWithSearch(
      COMPETITOR_AGENT_PROMPT,
      userContent,
      { maxTokens: 8192 }
    );
    if (searchUsed) logger.info("[CompetitorAgent] 已使用 web_search 增强");
    result = extractJson(text);
  } catch (err) {
    logger.warn("[CompetitorAgent] callLLMWithSearch 失败，降级:", err.message);
  }

  // 降级：不使用搜索的普通调用
  if (!result) {
    const { callLLM } = require("../services/llmService");
    const raw = await callLLM(COMPETITOR_AGENT_PROMPT, userContent, 8192);
    result = extractJson(raw);
  }

  if (!result) throw new Error("CompetitorAgent JSON 解析失败");

  logger.info("[CompetitorAgent] 完成", { competitorCount: result.competitors?.length });
  return result;
}

module.exports = competitorAgent;
