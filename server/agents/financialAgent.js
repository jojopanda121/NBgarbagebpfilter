// server/agents/financialAgent.js — v2 (BaseAgent)
const BaseAgent = require("./baseAgent");
const PROMPT = require("./prompts/financial.prompt");
const { extractJson } = require("../utils/jsonParser");

const MAX_BP_CHARS = 20000;

class FinancialAgent extends BaseAgent {
  constructor() {
    super({ name: "financial", systemPrompt: PROMPT, maxTokens: 6144 });
  }

  buildUserMessage({ bpFullText, extractedData }) {
    const truncated = bpFullText.length > MAX_BP_CHARS
      ? bpFullText.slice(0, MAX_BP_CHARS) + "\n...(已截断)"
      : bpFullText;
    const hints = extractedData
      ? `\n\n【辅助数据】声称收入：${extractedData.BP_Revenue || "未知"} 亿元，商业模式：${extractedData.Business_Model || "未知"}`
      : "";
    return `以下是一份 BP 全文，请重点分析财务数据并输出 JSON。${hints}\n\n<BP_FULL_TEXT>\n${truncated}\n</BP_FULL_TEXT>`;
  }

  parseResponse(rawText) {
    const parsed = extractJson(rawText);
    if (!parsed) throw new Error("FinancialAgent JSON 解析失败");
    return {
      userOutput: parsed,
      dataPayload: {
        anomalies: parsed.anomalies || [],
        overall_credibility: parsed.overall_credibility,
        industry: null, // 由 orchestrator 补充
      },
    };
  }
}

module.exports = FinancialAgent;
