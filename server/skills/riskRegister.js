// ============================================================
// skills/riskRegister.js — 结构化风险登记册(severity × likelihood 矩阵)
//
// 早期 VC 内部用来跟踪一个项目从立项到 portfolio monitoring 的风险表。
// 输出严格 JSON,方便前端画 5×5 风险矩阵。
// ============================================================

function _deps() {
  return {
    callLLMJson: require("../services/llmService").callLLMJson,
    buildContext: require("./_projectContext").buildContext,
  };
}

const SYSTEM = `你是 VC 风控合伙人,正在为这个项目立一张可持续追踪的 Risk Register。
风险登记册不是"罗列恐惧",而是给团队一张可执行的风险地图——每条风险必须能被人具体追踪、定期复核。

【硬性要求】
- 每条风险必须给出 likelihood(1-5)和 impact(1-5),score = likelihood × impact。
- category 限定为 7 类之一,不要发明新类别。
- mitigation 是"我们机构能做什么"(尽调动作 / 投后陪跑 / 条款保护),不是"建议公司做什么"。
- owner 写"投资经理"/"风控"/"投后",不要写人名。
- review_cadence 写"每季度"/"每月"/"投决前一次性"等可枚举节奏。
- 优先从 claim_verdicts(夸大/证伪)、red_flags、低分维度反推风险,不要凭空生造。`;

const SCHEMA = {
  type: "object",
  required: ["risks", "summary"],
  additionalProperties: false,
  properties: {
    summary: {
      type: "object",
      required: ["overall_level", "headline"],
      additionalProperties: false,
      properties: {
        overall_level: { type: "string", enum: ["低", "中", "高", "极高"] },
        headline: { type: "string", maxLength: 200 },
        top_risk_count: { type: "integer", minimum: 0 },
      },
    },
    risks: {
      type: "array",
      minItems: 5,
      maxItems: 15,
      items: {
        type: "object",
        required: ["id", "category", "title", "description", "likelihood", "impact", "score", "mitigation", "owner", "review_cadence"],
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          category: {
            type: "string",
            enum: ["市场/赛道", "技术/产品", "团队", "财务/单位经济", "竞争/格局", "监管/合规", "估值/退出"],
          },
          title: { type: "string", minLength: 4, maxLength: 60 },
          description: { type: "string", maxLength: 300 },
          likelihood: { type: "integer", minimum: 1, maximum: 5 },
          impact: { type: "integer", minimum: 1, maximum: 5 },
          score: { type: "integer", minimum: 1, maximum: 25 },
          mitigation: { type: "string", maxLength: 300 },
          owner: { type: "string", enum: ["投资经理", "风控", "投后", "合伙人"] },
          review_cadence: { type: "string", enum: ["投决前一次性", "每月", "每季度", "每半年"] },
          related_evidence: { type: "string", maxLength: 200 },
        },
      },
    },
  },
};

module.exports = {
  id: "risk_register",
  title: "风险登记册",
  description: "5×5 风险矩阵,按可能性×影响打分,每条配缓释动作 + 责任人 + 复核节奏",
  category: "memo",
  outputArtifactKind: "json",
  inputSchema: {
    type: "object",
    properties: {
      include_categories: {
        type: "array",
        items: { type: "string" },
        description: "可选,只生成指定类目;空表示自动判断",
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
      include_categories: params.include_categories || null,
      instructions: "请按 schema 产出风险登记册,score = likelihood × impact 必须算对。",
    }, null, 2);

    const { data, repairs } = await callLLMJson(SYSTEM, userMsg, SCHEMA, { maxTokens: 5120, maxRepairs: 2 });

    // 服务端兜底校正 score(防 LLM 算错)
    for (const r of data.risks) {
      r.score = r.likelihood * r.impact;
    }
    data.summary.top_risk_count = data.risks.filter((r) => r.score >= 12).length;

    return {
      ok: true,
      artifact: {
        kind: "json",
        summary: `风险登记册 — ${data.risks.length} 条 (top: ${data.summary.top_risk_count})`,
        payload: data,
      },
      metadata: { llm_repairs: repairs },
    };
  },
};
