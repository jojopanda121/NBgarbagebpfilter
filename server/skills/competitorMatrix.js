// ============================================================
// skills/competitorMatrix.js — 竞品对比矩阵 Excel
// 只允许“已确认竞品”和“待确认假设竞品”两类，避免把推测写成事实。
// ============================================================

function _deps() {
  return {
    callLLMJson: require("../services/llmService").callLLMJson,
    buildFactPack: require("./_factPack").buildFactPack,
    formatFactPackForPrompt: require("./_factPack").formatFactPackForPrompt,
    assertGrounded: require("./_groundingAudit").assertGrounded,
    exportXlsx: require("./_artifactExport").exportXlsx,
  };
}

const SYSTEM = `你是一级市场投资机构的竞品研究负责人，正在生成竞品对比矩阵。

硬性约束：
- 竞品分为 confirmed_competitors 和 hypothesis_competitors。材料明确提到的竞品才可放 confirmed。
- 任何营收、价格、客户、融资、规模数字，如果 Fact Pack 没有，必须写“未披露/待检索/需补充竞品材料”。
- hypothesis_competitors 只能作为“待确认假设竞品”，不得写成事实。
- 每个 confirmed_competitors 条目必须有 source_refs，引用 Fact Pack 的 F 编号。
- 不得虚构客户名、融资额、价格、市场份额。`;

const SOURCE_REFS = {
  type: "array",
  minItems: 0,
  maxItems: 5,
  items: { type: "string" },
};

const COMPETITOR = {
  type: "object",
  required: [
    "name", "competitor_type", "positioning", "target_customer", "core_product",
    "pricing_or_model", "scale_signal", "strength", "weakness",
    "difference_vs_target", "confidence", "source_refs",
  ],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 2, maxLength: 80 },
    competitor_type: { type: "string", enum: ["直接竞品", "间接竞品", "替代方案", "生态伙伴/潜在竞品", "待确认假设竞品"] },
    positioning: { type: "string", minLength: 2, maxLength: 180 },
    target_customer: { type: "string", maxLength: 160 },
    core_product: { type: "string", maxLength: 180 },
    pricing_or_model: { type: "string", maxLength: 160 },
    scale_signal: { type: "string", maxLength: 160 },
    strength: { type: "string", maxLength: 220 },
    weakness: { type: "string", maxLength: 220 },
    difference_vs_target: { type: "string", maxLength: 220 },
    confidence: { type: "string", enum: ["高", "中", "低", "待确认"] },
    source_refs: SOURCE_REFS,
  },
};

const SCHEMA = {
  type: "object",
  required: ["target_company", "matrix_summary", "confirmed_competitors", "hypothesis_competitors", "verification_backlog"],
  additionalProperties: false,
  properties: {
    target_company: {
      type: "object",
      required: ["name", "positioning", "core_product", "source_refs"],
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 80 },
        positioning: { type: "string", maxLength: 180 },
        core_product: { type: "string", maxLength: 180 },
        source_refs: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } },
      },
    },
    matrix_summary: { type: "string", minLength: 20, maxLength: 400 },
    confirmed_competitors: { type: "array", minItems: 0, maxItems: 12, items: COMPETITOR },
    hypothesis_competitors: { type: "array", minItems: 0, maxItems: 8, items: COMPETITOR },
    verification_backlog: {
      type: "array",
      minItems: 0,
      maxItems: 12,
      items: {
        type: "object",
        required: ["item", "why_needed", "suggested_source"],
        additionalProperties: false,
        properties: {
          item: { type: "string", maxLength: 120 },
          why_needed: { type: "string", maxLength: 180 },
          suggested_source: { type: "string", maxLength: 120 },
        },
      },
    },
  },
};

function rows(items, group) {
  return (items || []).map((c) => [
    group,
    c.name,
    c.competitor_type,
    c.positioning,
    c.target_customer,
    c.core_product,
    c.pricing_or_model,
    c.scale_signal,
    c.strength,
    c.weakness,
    c.difference_vs_target,
    c.confidence,
    (c.source_refs || []).join(", "),
  ]);
}

function buildSheets(payload) {
  const headers = [
    "分组", "公司", "竞品类型", "定位", "目标客户", "核心产品",
    "价格/商业模式", "规模/融资/客户信号", "优势", "劣势",
    "与目标公司差异", "置信度", "事实来源",
  ];
  return [
    {
      name: "竞品总览矩阵",
      headers,
      rows: [
        ...rows(payload.confirmed_competitors, "已确认竞品"),
        ...rows(payload.hypothesis_competitors, "待确认假设竞品"),
      ],
    },
    {
      name: "目标公司",
      headers: ["字段", "内容"],
      rows: [
        ["公司", payload.target_company.name],
        ["定位", payload.target_company.positioning],
        ["核心产品", payload.target_company.core_product],
        ["事实来源", payload.target_company.source_refs.join(", ")],
        ["矩阵摘要", payload.matrix_summary],
      ],
    },
    {
      name: "待核实信息",
      headers: ["待核实项", "为什么需要", "建议来源"],
      rows: payload.verification_backlog.map((x) => [x.item, x.why_needed, x.suggested_source]),
    },
  ];
}

module.exports = {
  id: "competitor_matrix_xlsx",
  title: "竞品对比矩阵 Excel",
  description: "生成竞品对比矩阵，明确区分已确认竞品与待确认假设竞品，缺失数据不编造",
  category: "research",
  outputArtifactKind: "xlsx",
  inputSchema: {
    type: "object",
    properties: {
      include_hypothesis: { type: "boolean", description: "是否生成待确认假设竞品，默认 true" },
      focus_dimension: { type: "string", description: "可选，如 产品能力/商业模式/客户渠道/价格" },
    },
    additionalProperties: false,
  },

  async run({ project, params = {}, ctx = {}, userId }) {
    if (!project) return { ok: false, error: "需要项目上下文" };
    const { callLLMJson, buildFactPack, formatFactPackForPrompt, assertGrounded, exportXlsx } = _deps();
    const { factPack } = buildFactPack(project);

    const userMsg = [
      formatFactPackForPrompt(factPack),
      "",
      `【是否允许假设竞品】${params.include_hypothesis === false ? "否；若无确认竞品也不要硬凑" : "是；但必须标为待确认假设竞品"}`,
      `【重点维度】${params.focus_dimension || "综合对比"}`,
      "",
      "请按 schema 输出竞品矩阵 JSON。",
    ].join("\n");

    const { data, repairs } = await callLLMJson(SYSTEM, userMsg, SCHEMA, { maxTokens: 6144, maxRepairs: 2 });
    let audit;
    try {
      audit = assertGrounded(data, factPack, { requiredPaths: ["confirmed_competitors"] });
    } catch (groundingErr) {
      return {
        ok: false,
        error: `事实溯源审计失败：${groundingErr.audit?.errors?.join("；") || groundingErr.message}`,
        metadata: { grounding: groundingErr.audit },
      };
    }
    const artifact = await exportXlsx({
      title: "竞品对比矩阵",
      sheets: buildSheets(data),
      ctx,
      userId,
      artifactTitle: "竞品矩阵",
    });

    return {
      ok: true,
      artifact: artifact || { kind: "json", summary: "竞品对比矩阵", payload: data },
      metadata: { llm_repairs: repairs, grounding: audit },
    };
  },
  _private: { SCHEMA, buildSheets },
};
