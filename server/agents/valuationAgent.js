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
    super({ name: "valuation", systemPrompt: PROMPT, maxTokens: 14000, useSearch: true });
  }

  buildSearchQueries({ extractedData }) {
    const company = extractedData?.company_name || "";
    const industry = extractedData?.industry || "";
    const stage = extractedData?.funding_round || "";
    const revenue = extractedData?.BP_Revenue || "";
    return [
      `${industry} 上市公司 估值 PS PE EV EBITDA 市值 收入 同花顺`,
      `${industry} 可比公司 2024 2025 财报 收入 毛利率 市值 PS`,
      `${industry} ${stage} 融资 估值 同赛道 可比案例`,
      revenue ? `${industry} ARR revenue multiple PS 估值 倍数` : "",
      company ? `${company} 融资 估值 收入 ARR` : "",
    ].filter(Boolean);
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
      `\n\n【MiniMax 估值温度计 Harness】`,
      `请优先尝试使用 MiniMax 可用的同花顺/iFinD、上市公司财报、交易所公告、融资新闻和公开网页能力，寻找同赛道上市公司或可比交易的 PS、PE、EV/EBITDA、收入、市值/估值。`,
      `如果 BP 披露估值和收入，必须计算本项目隐含 PS/ARR multiple，并与同行中位数对比。`,
      `如果 BP 披露估值但没有收入，必须用融资阶段 + 同赛道可比融资案例给区间，不要硬算 PS。`,
      `如果 BP 没披露估值，必须输出同行业估值区间和建议估值锚点，temperature 填 "信息不足" 或基于可比公司给参考判断。`,
      `如果专业数据不可用，必须在 source_boundary 里说明，不得编造同花顺/财报数据。`,
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
        valuation_temperature: parsed.valuation_temperature || null,
        peer_public_companies: parsed.peer_public_companies || [],
      },
    };
  }
}

module.exports = ValuationAgent;
