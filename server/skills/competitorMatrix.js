// ============================================================
// skills/competitorMatrix.js — 竞品对比矩阵 Excel
// 只允许“已确认竞品”和“待确认假设竞品”两类，避免把推测写成事实。
// ============================================================

function _deps() {
  return {
    callLLMJson: require("../services/llmService").callLLMJson,
    buildEvidencePack: require("./_factPack").buildEvidencePack,
    formatFactPackForPrompt: require("./_factPack").formatFactPackForPrompt,
    assertGrounded: require("./_groundingAudit").assertGrounded,
    summarizeFallback: require("./_groundingAudit").summarizeFallback,
    semanticGroundingAudit: require("./_groundingAudit").semanticGroundingAudit,
    exportXlsx: require("./_artifactExport").exportXlsx,
  };
}

const SYSTEM = `你是一级市场投资机构的竞品研究负责人，正在生成竞品对比矩阵。

硬性约束：
- 竞品分为 confirmed_competitors 和 hypothesis_competitors。材料明确提到的竞品才可放 confirmed。
- 任何营收、价格、客户、融资、规模数字，如果 Fact Pack 没有，必须写”未披露/待检索/需补充竞品材料”。
- hypothesis_competitors 只能作为”待确认假设竞品”，不得写成事实。
- 每个 confirmed_competitors 条目必须有 source_refs，引用 Fact Pack 的 F 编号。
- 不得虚构客户名、融资额、价格、市场份额。
- 投资人关心融资轮次、历史总融资金额、估值信号、GTM 策略、技术路线差异；Fact Pack 没有就写”待检索/未披露”。

【上传结构化证据 — upload_structured facts】
- source_type=upload_structured 的 F 编号来自用户上传底层资料（财务表 / 客户清单 / 合同 / Cap Table），confidence 字段反映抽取可信度。
- 用法：用目标公司的 upload_structured 数字与**外部检索（F 编号 source_type=external_search）**抓到的竞品融资 / 估值 / 客户规模做对照；竞品事实优先引用外部检索或确认竞品材料。
- 不要把目标公司的 BP 自报当成竞品事实；竞品行的数字必须来自外部检索或确认竞品材料。

【近 3 个月动态 — recent_moves_3m 字段硬约束】
- **每个 confirmed_competitors 必填 recent_moves_3m**，记录该竞品**最近 3 个月**（以当前日期为锚）的实际动作。
- 至少覆盖 3 类信号中的 1 类：(a) **融资/估值变动**（新一轮、领投方、估值倍数）、(b) **核心高管变动**（CEO/CTO/CFO/CRO 入离职、董事会重组）、(c) **重大产品/客户发布**（新品 GA、标杆客户签约、定价调整、并购）。
- 每条动态必须有 **日期（YYYY-MM 精度）** + **事件类型** + **一句话事实** + **source_refs**；日期不明确就归入 hypothesis_competitors 而非编造。
- **3 个月内确实无公开动态**时，写 1 条 \`{ “as_of”: “<当前 YYYY-MM>”, “move_type”: “无动态”, “summary”: “近 3 个月无公开重大动作”, “source_refs”: [] }\`，不要为了凑数编造。`;

const SOURCE_REFS = {
  type: "array",
  minItems: 0,
  maxItems: 5,
  items: { type: "string" },
};

const RECENT_MOVE = {
  type: "object",
  required: ["as_of", "move_type", "summary", "source_refs"],
  additionalProperties: false,
  properties: {
    as_of: { type: "string", minLength: 6, maxLength: 12 },
    move_type: {
      type: "string",
      enum: ["融资/估值", "核心高管变动", "产品/客户/并购", "无动态"],
    },
    summary: { type: "string", minLength: 4, maxLength: 220 },
    source_refs: SOURCE_REFS,
  },
};

const COMPETITOR = {
  type: "object",
  required: [
    "name", "competitor_type", "positioning", "target_customer", "core_product",
    "financing_stage", "total_funding", "valuation_signal", "gtm_strategy",
    "technology_route", "pricing_or_model", "scale_signal", "strength", "weakness",
    "difference_vs_target", "recent_moves_3m", "confidence", "source_refs",
  ],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 2, maxLength: 80 },
    competitor_type: { type: "string", enum: ["直接竞品", "间接竞品", "替代方案", "生态伙伴/潜在竞品", "待确认假设竞品"] },
    positioning: { type: "string", minLength: 2, maxLength: 180 },
    target_customer: { type: "string", maxLength: 160 },
    core_product: { type: "string", maxLength: 180 },
    financing_stage: { type: "string", maxLength: 120 },
    total_funding: { type: "string", maxLength: 120 },
    valuation_signal: { type: "string", maxLength: 160 },
    gtm_strategy: { type: "string", maxLength: 180 },
    technology_route: { type: "string", maxLength: 180 },
    pricing_or_model: { type: "string", maxLength: 160 },
    scale_signal: { type: "string", maxLength: 160 },
    strength: { type: "string", maxLength: 220 },
    weakness: { type: "string", maxLength: 220 },
    difference_vs_target: { type: "string", maxLength: 220 },
    // 近 3 个月动态：confirmed 类竞品要求 ≥1 条；hypothesis 可空数组
    recent_moves_3m: { type: "array", minItems: 0, maxItems: 5, items: RECENT_MOVE },
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

function formatRecentMoves(moves) {
  if (!Array.isArray(moves) || moves.length === 0) return "未补充";
  return moves
    .map((m) => {
      const refs = (m.source_refs || []).join(",");
      const refTail = refs ? ` (${refs})` : "";
      return `${m.as_of || "?"} [${m.move_type || "?"}] ${m.summary || ""}${refTail}`;
    })
    .join("\n");
}

function rows(items, group) {
  return (items || []).map((c) => [
    group,
    c.name,
    c.competitor_type,
    c.positioning,
    c.financing_stage,
    c.total_funding,
    c.valuation_signal,
    c.target_customer,
    c.gtm_strategy,
    c.core_product,
    c.technology_route,
    c.pricing_or_model,
    c.scale_signal,
    c.strength,
    c.weakness,
    c.difference_vs_target,
    formatRecentMoves(c.recent_moves_3m),
    c.confidence,
    (c.source_refs || []).join(", "),
  ]);
}

function buildSheets(payload) {
  const headers = [
    "分组", "公司", "竞品类型", "定位", "融资轮次", "历史总融资金额",
    "估值水平/估值信号", "主要客户群", "GTM 策略", "核心产品",
    "核心技术路线差异", "价格/商业模式", "规模/融资/客户信号", "优势", "劣势",
    "与目标公司差异", "近 3 个月动态", "置信度", "事实来源",
  ];
  // 近 3 个月动态单独抽出来再做一张速览表，方便周会扫读
  const recentMovesRows = [];
  for (const group of [
    { items: payload.confirmed_competitors, label: "已确认竞品" },
    { items: payload.hypothesis_competitors, label: "待确认假设竞品" },
  ]) {
    for (const c of group.items || []) {
      const moves = Array.isArray(c.recent_moves_3m) ? c.recent_moves_3m : [];
      if (moves.length === 0) {
        recentMovesRows.push([group.label, c.name, "—", "未补充", "—", ""]);
        continue;
      }
      for (const m of moves) {
        recentMovesRows.push([
          group.label,
          c.name,
          m.as_of || "",
          m.move_type || "",
          m.summary || "",
          (m.source_refs || []).join(", "),
        ]);
      }
    }
  }
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
      name: "近 3 个月动态速览",
      headers: ["分组", "公司", "as_of", "动态类型", "事实摘要", "事实来源"],
      rows: recentMovesRows,
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
      enable_semantic_audit: {
        type: "boolean",
        description: "可选。开启后，对随机 30% 断言反向问 LLM 做语义抽样校验 (会增加约 1-2s 延时和少量 token)。默认走 env ENABLE_SEMANTIC_AUDIT。",
      },
      enable_bp_deep_parsing: {
        type: "boolean",
        description: "可选。兼容旧参数；上传结构化证据会以 upload_structured F 编号注入 Fact Pack。",
      },
    },
    additionalProperties: false,
  },

  async run({ project, params = {}, ctx = {}, userId }) {
    if (!project) return { ok: false, error: "需要项目上下文" };
    const { callLLMJson, buildEvidencePack, formatFactPackForPrompt, assertGrounded, summarizeFallback, semanticGroundingAudit, exportXlsx } = _deps();
    const { factPack, searchUsed, uploadCount, uploadStructuredUsed, uploadStructuredFactCount } = await buildEvidencePack(project, {
      ctx,
      skillId: "competitor_matrix_xlsx",
      useSearch: true,
      materialsHint: params.focus_dimension || "",
      enableBpDeepParsing: params.enable_bp_deep_parsing,
    });

    const userMsg = [
      formatFactPackForPrompt(factPack),
      "",
      `【是否允许假设竞品】${params.include_hypothesis === false ? "否；若无确认竞品也不要硬凑" : "是；但必须标为待确认假设竞品"}`,
      `【重点维度】${params.focus_dimension || "综合对比"}`,
      "",
      "请按 schema 输出竞品矩阵 JSON。",
    ].join("\n");

    const { data, repairs } = await callLLMJson(SYSTEM, userMsg, SCHEMA, {
      maxTokens: 6144, maxRepairs: 3,
      skillId: "competitor_matrix_xlsx",
    });
    let audit;
    try {
      audit = assertGrounded(data, factPack, { requiredPaths: ["confirmed_competitors"] });
    } catch (groundingErr) {
      audit = {
        ok: false,
        errors: groundingErr.audit?.errors || [],
        warnings: ["部分竞品的事实引用(source_refs)缺失或指向不存在的编号，建议人工核实"],
        referenced_count: groundingErr.audit?.referenced_count || 0,
      };
    }
    const artifact = await exportXlsx({
      title: "竞品对比矩阵",
      sheets: buildSheets(data),
      ctx,
      userId,
      artifactTitle: "竞品矩阵",
    });

    const fallback = summarizeFallback(data, "competitor_matrix_xlsx");
    // 语义抽样校验 (opt-in)：param > env > 默认 false
    const enableSemantic = params.enable_semantic_audit === true
      || (params.enable_semantic_audit !== false && process.env.ENABLE_SEMANTIC_AUDIT === "1");
    let semanticAudit = null;
    if (enableSemantic) {
      semanticAudit = await semanticGroundingAudit(data, factPack, {
        sampleRate: 0.3,
        maxSamples: 12,
        skillId: "competitor_matrix_xlsx",
      });
    }
    return {
      ok: true,
      artifact: artifact || { kind: "json", summary: "竞品对比矩阵", payload: data },
      metadata: {
        llm_repairs: repairs,
        grounding: audit,
        fallback,
        semantic_audit: semanticAudit,
        evidence_search_used: searchUsed,
        upload_facts_used: uploadCount,
        upload_structured_used: !!uploadStructuredUsed,
        upload_structured_fact_count: uploadStructuredFactCount || 0,
      },
    };
  },
  _private: { SCHEMA, buildSheets },
};
