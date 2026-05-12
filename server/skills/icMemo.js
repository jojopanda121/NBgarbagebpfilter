// ============================================================
// skills/icMemo.js — 投委会备忘录(IC Memo)骨架生成
//
// 一级市场 GP 写 IC memo 的标准 7 段式:
//   1) Investment Thesis(为什么投/为什么不投 — thesis statement)
//   2) Company & Product
//   3) Market & Competition
//   4) Team
//   5) Financials & Unit Economics
//   6) Risks & Mitigants(配对,不只是列风险)
//   7) Deal Terms & Recommendation(条件 + 投票建议)
//
// 输出严格 JSON,前端可一键导出 .docx 或填入 IC 模板。
// ============================================================

function _deps() {
  return {
    callLLMJson: require("../services/llmService").callLLMJson,
    buildContext: require("./_projectContext").buildContext,
  };
}

const SYSTEM = `你是一家头部 VC 的合伙人,正在为下周的投资委员会撰写 IC Memo。
你的读者是基金 LP 和其他合伙人——他们见过太多 BP 改写,看到"颠覆/弯道超车"会自动减分。

【写作原则】
- thesis 必须是你的判断,不是 BP 的复读。包含温度("强烈推荐"/"建议小额观察"/"建议放弃但留 follow")。
- risks_mitigants 每条风险必须配对应缓释项,缓释项必须可验证(尽调里能拿到的具体动作),不要写"加强沟通"。
- 任何数字、客户名、政策名,必须出现在输入数据中,否则用"暂无可核实数据"或换成区间。
- 给出的 recommendation.vote_call ∈ {strong_yes, yes, conditional_yes, pass, strong_pass}, 必须有 1-2 句 rationale。
- 中文输出,语气克制专业,**禁止使用任何形容词性宣传词**("革命性"、"独角兽潜质"、"颠覆"、"全球领先"等)。`;

const SCHEMA = {
  type: "object",
  required: ["thesis", "company", "market", "team", "financials", "risks_mitigants", "recommendation"],
  additionalProperties: false,
  properties: {
    thesis: {
      type: "object",
      required: ["statement", "key_bets"],
      additionalProperties: false,
      properties: {
        statement: { type: "string", minLength: 30, maxLength: 500 },
        key_bets: { type: "array", minItems: 2, maxItems: 4, items: { type: "string", maxLength: 200 } },
      },
    },
    company: {
      type: "object",
      required: ["name", "one_liner", "product_summary", "stage", "moat"],
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        one_liner: { type: "string", maxLength: 200 },
        product_summary: { type: "string", maxLength: 800 },
        stage: { type: "string" },
        moat: { type: "string", maxLength: 400 },
      },
    },
    market: {
      type: "object",
      required: ["size_summary", "drivers", "competition"],
      additionalProperties: false,
      properties: {
        size_summary: { type: "string", maxLength: 400 },
        drivers: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", maxLength: 200 } },
        competition: { type: "string", maxLength: 600 },
      },
    },
    team: {
      type: "object",
      required: ["assessment", "key_people"],
      additionalProperties: false,
      properties: {
        assessment: { type: "string", maxLength: 500 },
        key_people: {
          type: "array", minItems: 1, maxItems: 6,
          items: {
            type: "object",
            required: ["name", "role"],
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              role: { type: "string" },
              note: { type: "string", maxLength: 200 },
            },
          },
        },
      },
    },
    financials: {
      type: "object",
      required: ["snapshot", "unit_economics", "valuation_view"],
      additionalProperties: false,
      properties: {
        snapshot: { type: "string", maxLength: 500 },
        unit_economics: { type: "string", maxLength: 400 },
        valuation_view: { type: "string", maxLength: 400 },
      },
    },
    risks_mitigants: {
      type: "array", minItems: 3, maxItems: 8,
      items: {
        type: "object",
        required: ["risk", "severity", "mitigant"],
        additionalProperties: false,
        properties: {
          risk: { type: "string", maxLength: 250 },
          severity: { type: "string", enum: ["低", "中", "高"] },
          mitigant: { type: "string", maxLength: 250 },
        },
      },
    },
    recommendation: {
      type: "object",
      required: ["vote_call", "rationale", "proposed_terms"],
      additionalProperties: false,
      properties: {
        vote_call: { type: "string", enum: ["strong_yes", "yes", "conditional_yes", "pass", "strong_pass"] },
        rationale: { type: "string", maxLength: 400 },
        proposed_terms: {
          type: "object",
          additionalProperties: true,
          properties: {
            check_size_rmb_mn: { type: ["number", "null"] },
            ownership_target_pct: { type: ["number", "null"] },
            board_seat: { type: ["boolean", "null"] },
            conditions_precedent: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },
};

module.exports = {
  id: "ic_memo",
  title: "投委会 Memo(IC Memo)",
  description: "生成结构化 IC Memo:thesis、市场、团队、财务、风险缓释配对、投票建议",
  category: "memo",
  outputArtifactKind: "json",
  inputSchema: {
    type: "object",
    properties: {
      vote_lean: {
        type: "string",
        enum: ["neutral", "lean_yes", "lean_no"],
        description: "可选,人工偏好 — 让 thesis 倾向化但不强行翻转",
      },
      check_size_rmb_mn: {
        type: ["number", "null"],
        description: "拟出资金额(百万人民币),null 让 LLM 推荐",
      },
    },
    additionalProperties: false,
  },

  async run({ project, params }) {
    if (!project) return { ok: false, error: "需要项目上下文" };
    const { callLLMJson, buildContext } = _deps();
    const projectCtx = buildContext(project);

    const userMsg = JSON.stringify({
      project_context: projectCtx,
      vote_lean: params.vote_lean || "neutral",
      target_check_size_rmb_mn: params.check_size_rmb_mn ?? null,
      instructions: "请按 schema 产出完整 IC Memo。所有数字必须可追溯到 project_context。",
    }, null, 2);

    const { data, repairs } = await callLLMJson(SYSTEM, userMsg, SCHEMA, { maxTokens: 6144, maxRepairs: 2 });

    return {
      ok: true,
      artifact: {
        kind: "json",
        summary: `IC Memo — ${data.recommendation.vote_call}`,
        payload: data,
      },
      metadata: { llm_repairs: repairs },
    };
  },
};
