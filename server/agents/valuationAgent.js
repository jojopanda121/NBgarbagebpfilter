// ============================================================
// server/agents/valuationAgent.js — 估值合理性 Agent
// 对标 industry_benchmarks 表中同赛道同阶段历史数据
// ============================================================

const { callLLM } = require("../services/llmService");
const { extractJson } = require("../utils/jsonParser");
const { VALUATION_AGENT_PROMPT } = require("../utils/prompts");
const { getDb } = require("../db");
const logger = require("../utils/logger");

/** 从 industry_benchmarks 表读取同赛道参考数据 */
function getIndustryBenchmarks(industry, stage) {
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT metric_type, AVG(metric_value) as avg_value, COUNT(*) as sample_count
       FROM industry_benchmarks
       WHERE industry = ? AND (stage = ? OR stage IS NULL)
       GROUP BY metric_type
       LIMIT 20`
    ).all(industry || "", stage || "");
    return rows;
  } catch {
    return [];
  }
}

/**
 * @param {string} bpText
 * @param {object} extractedData
 * @returns {object} 估值分析结果
 */
async function valuationAgent(bpText, extractedData) {
  const industry = extractedData.industry || "";
  const stage = extractedData.funding_round || "";
  const benchmarks = getIndustryBenchmarks(industry, stage);

  const userContent = [
    `【分析对象】公司：${extractedData.company_name || "未知"}`,
    `赛道：${industry}，融资阶段：${stage}`,
    `\n\n【估值相关数据】`,
    `- BP声称估值：${extractedData.BP_Valuation || 0} 亿元`,
    `- BP声称收入/ARR：${extractedData.BP_Revenue || 0} 亿元`,
    `- TAM：${extractedData.TAM_Million_RMB || 0} 百万元`,
    `\n\n【历史行业 Benchmark 数据（来自平台数据库，${benchmarks.length} 条）】`,
    benchmarks.length > 0
      ? JSON.stringify(benchmarks, null, 2)
      : "暂无历史数据，请基于公开市场知识判断",
    `\n\n【BP节选（前 6000 字）】\n${bpText.slice(0, 6000)}`,
  ].join("\n");

  let raw;
  try {
    raw = await callLLM(VALUATION_AGENT_PROMPT, userContent, 6144);
  } catch (err) {
    logger.warn("[ValuationAgent] LLM 调用失败:", err.message);
    throw err;
  }

  let result = extractJson(raw);
  if (!result) {
    logger.warn("[ValuationAgent] JSON 解析失败，重试...");
    raw = await callLLM(
      VALUATION_AGENT_PROMPT + "\n\n【紧急提醒】只输出 JSON 对象，不要 markdown 代码块。",
      userContent,
      6144
    );
    result = extractJson(raw);
  }

  if (!result) throw new Error("ValuationAgent JSON 解析失败");

  logger.info("[ValuationAgent] 完成", { assessment: result.benchmark_analysis?.valuation_vs_benchmark });
  return result;
}

module.exports = valuationAgent;
