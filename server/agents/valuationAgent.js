// server/agents/valuationAgent.js — v2 (BaseAgent)
const BaseAgent = require("./baseAgent");
const PROMPT = require("./prompts/valuation.prompt");
const { extractJson } = require("../utils/jsonParser");
const { getDb } = require("../db");

function getIndustryBenchmarks(industry, stage) {
  try {
    const db = getDb();
    return db.prepare(
      `SELECT metric_type, AVG(metric_value) as avg_value, COUNT(*) as sample_count
       FROM industry_benchmarks
       WHERE industry = ? AND (stage = ? OR stage IS NULL)
       GROUP BY metric_type
       LIMIT 20`
    ).all(industry || "", stage || "");
  } catch {
    return [];
  }
}

class ValuationAgent extends BaseAgent {
  constructor() {
    super({ name: "valuation", systemPrompt: PROMPT, maxTokens: 6144 });
  }

  buildUserMessage({ bpFullText, extractedData }) {
    const industry = extractedData?.industry || "";
    const stage = extractedData?.funding_round || "";
    const benchmarks = getIndustryBenchmarks(industry, stage);

    return [
      `【分析对象】公司：${extractedData?.company_name || "未知"}`,
      `赛道：${industry}，融资阶段：${stage}`,
      `\n\n【估值相关数据】`,
      `- BP 声称估值：${extractedData?.BP_Valuation || 0} 亿元`,
      `- BP 声称收入/ARR：${extractedData?.BP_Revenue || 0} 亿元`,
      `- TAM：${extractedData?.TAM_Million_RMB || 0} 百万元`,
      `\n\n【行业 Benchmark 数据（平台历史数据，${benchmarks.length} 条）】`,
      benchmarks.length > 0
        ? JSON.stringify(benchmarks, null, 2)
        : "暂无历史数据，请基于公开市场知识判断",
      `\n\n<BP_FULL_TEXT>\n${bpFullText.slice(0, 6000)}\n</BP_FULL_TEXT>`,
    ].join("\n");
  }

  parseResponse(rawText) {
    const parsed = extractJson(rawText);
    if (!parsed) throw new Error("ValuationAgent JSON 解析失败");
    return {
      userOutput: parsed,
      dataPayload: {
        claimed_valuation: parsed.claimed_valuation,
        implied_dilution: parsed.implied_dilution,
        consensus_range: parsed.consensus_range || null,
        verdict_position: parsed.verdict?.position || null,
      },
    };
  }
}

module.exports = ValuationAgent;
