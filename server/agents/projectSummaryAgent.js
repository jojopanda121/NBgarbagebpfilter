// server/agents/projectSummaryAgent.js — v2 (BaseAgent)
const BaseAgent = require("./baseAgent");
const PROMPT = require("./prompts/projectSummary.prompt");

const MAX_BP_CHARS = 25000;

class ProjectSummaryAgent extends BaseAgent {
  constructor() {
    super({ name: "project_summary", systemPrompt: PROMPT, maxTokens: 4096 });
  }

  buildUserMessage({ bpFullText, extractedData }) {
    const truncated = bpFullText.length > MAX_BP_CHARS
      ? bpFullText.slice(0, MAX_BP_CHARS) + "\n...(已截断)"
      : bpFullText;

    const hint = extractedData
      ? `\n\n【已知辅助信息（Agent A 提取）】\n公司名：${extractedData.company_name || "未知"}，赛道：${extractedData.industry || "未知"}，地区：${extractedData.project_location || "未知"}`
      : "";

    return `以下是一份创业公司商业计划书（BP）的全文，请按照要求输出 JSON。\n\n<BP_FULL_TEXT>\n${truncated}\n</BP_FULL_TEXT>${hint}`;
  }

  parseResponse(rawText) {
    const { extractJson } = require("../utils/jsonParser");
    const parsed = extractJson(rawText);
    if (!parsed) throw new Error("ProjectSummaryAgent JSON 解析失败");
    return {
      userOutput: {
        one_liner: parsed.one_liner,
        project_name: parsed.project_name,
        industry: parsed.industry,
        sub_industry: parsed.sub_industry,
        business_model: parsed.business_model,
        stage: parsed.stage,
        region: parsed.region,
        core_metrics: parsed.core_metrics || [],
      },
      dataPayload: {
        industry: parsed.industry,
        sub_industry: parsed.sub_industry,
        business_model: parsed.business_model,
        stage: parsed.stage,
        region: parsed.region,
        claimed_valuation: parsed.claimed_valuation,
        claimed_revenue: parsed.claimed_revenue,
        claimed_users: parsed.claimed_users,
        funding_round: parsed.funding_round,
        funding_amount: parsed.funding_amount,
      },
    };
  }
}

module.exports = ProjectSummaryAgent;
