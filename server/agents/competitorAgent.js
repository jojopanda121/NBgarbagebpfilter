// server/agents/competitorAgent.js — v2 (BaseAgent, useSearch=true)
const BaseAgent = require("./baseAgent");
const PROMPT = require("./prompts/competitor.prompt");
const { extractJson } = require("../utils/jsonParser");

class CompetitorAgent extends BaseAgent {
  constructor() {
    // useSearch=true 触发 callLLMWithSearch，获取最新竞品信息
    super({ name: "competitor", systemPrompt: PROMPT, maxTokens: 8192, useSearch: true });
  }

  buildUserMessage({ bpFullText, extractedData }) {
    const industry = extractedData?.industry || "未知赛道";
    const company = extractedData?.company_name || "未知公司";
    const bpClaims = extractedData?.bp_claims_product || "";
    return [
      `【分析对象】公司：${company}，赛道：${industry}`,
      bpClaims ? `\n【BP 竞品声明】${bpClaims}` : "",
      `\n\n<BP_FULL_TEXT>\n${bpFullText.slice(0, 10000)}\n</BP_FULL_TEXT>`,
    ].join("");
  }

  parseResponse(rawText) {
    const parsed = extractJson(rawText);
    if (!parsed) throw new Error("CompetitorAgent JSON 解析失败");
    return {
      userOutput: parsed,
      dataPayload: { competitors: parsed.competitors || [], track_definition: parsed.track_definition },
    };
  }
}

module.exports = CompetitorAgent;
