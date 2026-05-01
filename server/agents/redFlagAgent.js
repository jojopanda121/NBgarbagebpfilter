// server/agents/redFlagAgent.js — v2 (BaseAgent, phase-2: depends on prior agents)
const BaseAgent = require("./baseAgent");
const PROMPT = require("./prompts/redFlag.prompt");
const { extractJson } = require("../utils/jsonParser");

const MAX_BP_CHARS = 20000;

class RedFlagAgent extends BaseAgent {
  constructor() {
    super({ name: "red_flag", systemPrompt: PROMPT, maxTokens: 8192 });
  }

  buildUserMessage({ bpFullText, extractedData, priorAgentOutputs = {} }) {
    const truncated = bpFullText.length > MAX_BP_CHARS
      ? bpFullText.slice(0, MAX_BP_CHARS) + "\n...(已截断)"
      : bpFullText;

    const priorSummary = this._summarizePrior(priorAgentOutputs);

    return [
      `<BP_FULL_TEXT>\n${truncated}\n</BP_FULL_TEXT>`,
      `\n\n<PRIOR_AGENT_OUTPUTS>\n${priorSummary}\n</PRIOR_AGENT_OUTPUTS>`,
    ].join("");
  }

  _summarizePrior(prior) {
    const parts = [];

    if (prior.project_summary?.userOutput) {
      const ps = prior.project_summary.userOutput;
      parts.push(`【项目摘要】${ps.one_liner || ""} 赛道：${ps.industry || ""} 阶段：${ps.stage || ""}`);
    }

    if (prior.founder?.userOutput) {
      const f = prior.founder.userOutput;
      const riskFlags = (f.risk_flags || []).slice(0, 3).join("；");
      parts.push(`【创始人调查】${f.team_assessment || ""} 风险：${riskFlags || "无"}`);
    }

    if (prior.financial?.userOutput) {
      const fin = prior.financial.userOutput;
      const anomalies = (fin.anomalies || []).slice(0, 3).map((a) => a.description || a).join("；");
      parts.push(`【财务核查】可信度：${fin.overall_credibility || ""} 异常：${anomalies || "无"}`);
    }

    if (prior.competitor?.userOutput) {
      const comp = prior.competitor.userOutput;
      parts.push(`【竞品分析】${comp.track_definition || ""} 竞品数：${comp.competitors?.length ?? "?"}`);
    }

    if (prior.valuation?.userOutput) {
      const val = prior.valuation.userOutput;
      const verdict = val.verdict || {};
      parts.push(`【估值分析】评级：${verdict.position || ""} 溢价：${verdict.premium_pct ?? ""}  ${verdict.summary || ""}`);
    }

    return parts.length > 0 ? parts.join("\n\n") : "（前置 Agent 输出不可用，仅依据 BP 全文判断）";
  }

  parseResponse(rawText) {
    const parsed = extractJson(rawText);
    if (!parsed || !parsed.red_flags) throw new Error("RedFlagAgent JSON 解析失败");
    return {
      userOutput: parsed,
      dataPayload: {
        red_flags: parsed.red_flags || [],
        deal_breaker_count: parsed.overall_recommendation?.deal_breaker_count ?? 0,
        verdict: parsed.overall_recommendation?.verdict || null,
      },
    };
  }
}

module.exports = RedFlagAgent;
