// server/agents/redFlagAgent.js — v2 (BaseAgent, phase-2: depends on prior agents)
const BaseAgent = require("./baseAgent");
const PROMPT = require("./prompts/redFlag.prompt");
const { extractJson } = require("../utils/jsonParser");

const MAX_BP_CHARS = 20000;

// 前置 Agent 的若干字段按各自 prompt 的定义本来就是对象/对象数组
// （founder.team_assessment、founder.risk_flags[]、competitor.track_definition、
// financial.anomalies[]）。早期实现直接做字符串插值，喂给本 Agent 的是
// "[object Object]"——而本 Agent 会把这段文本当证据写进用户可见的红旗报告。
// 这里统一摊平：能挑到可读文本字段就用它，挑不到再退回紧凑 JSON。
const LABEL_KEYS = ["flag_type", "anomaly_type", "title", "name", "category"];
const TEXT_KEYS = ["summary", "narrow_track", "description", "evidence", "detail", "content", "text"];
const MAX_FIELD_CHARS = 300;

function flattenText(value, maxLen = MAX_FIELD_CHARS) {
  if (value == null) return "";
  if (typeof value !== "object") return String(value).trim();
  if (Array.isArray(value)) {
    return value.map((item) => flattenText(item, maxLen)).filter(Boolean).join("；");
  }
  const pick = (keys) => keys.map((k) => value[k]).find((v) => typeof v === "string" && v.trim());
  const label = pick(LABEL_KEYS);
  const body = pick(TEXT_KEYS);
  let text;
  if (label && body) text = `${label}：${body}`;
  else if (body || label) text = body || label;
  else {
    try { text = JSON.stringify(value); } catch (_) { text = ""; }
  }
  return text.trim().slice(0, maxLen);
}

class RedFlagAgent extends BaseAgent {
  constructor() {
    super({ name: "red_flag", systemPrompt: PROMPT, maxTokens: 12000 });
  }

  buildUserMessage({ bpFullText, extractedData: _extractedData, priorAgentOutputs = {} }) {
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
      const riskFlags = flattenText((f.risk_flags || []).slice(0, 3));
      parts.push(`【创始人调查】${flattenText(f.team_assessment)} 风险：${riskFlags || "无"}`);
    }

    if (prior.financial?.userOutput) {
      const fin = prior.financial.userOutput;
      const anomalies = flattenText((fin.anomalies || []).slice(0, 3));
      parts.push(`【财务核查】可信度：${fin.overall_credibility ?? ""} 异常：${anomalies || "无"}`);
    }

    if (prior.competitor?.userOutput) {
      const comp = prior.competitor.userOutput;
      parts.push(`【竞品分析】${flattenText(comp.track_definition)} 竞品数：${comp.competitors?.length ?? "?"}`);
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
// 摊平逻辑是防"[object Object] 进用户可见报告"的回归点，单独导出供测试
module.exports.flattenPriorForTest = (prior) =>
  new RedFlagAgent()._summarizePrior(prior);
