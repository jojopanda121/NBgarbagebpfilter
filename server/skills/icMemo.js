// ============================================================
// skills/icMemo.js — 投委会备忘录(IC Memo)
//
// 一级市场 GP 写 IC memo 的标准段落（参考 Anthropic financial-services
// Apache-2.0 仓库 plugins/vertical-plugins/private-equity/skills/ic-memo
// 的章节骨架，按本仓库的 Fact Pack + grounding audit 范式重写）：
//   0) Executive Summary — 公司一句话 / 投资建议 / headline returns / Top 3 风险
//   1) Investment Thesis — 关键论点 / 关键押注
//   2) Company & Product
//   3) Market & Competition
//   4) Team
//   5) Financial Analysis — 历史业绩 / 盈利质量 / 营运资金 / 资本开支
//   6) Returns Scenarios — Downside / Base / Upside (MOIC + IRR + 关键假设)
//   7) Risks & Mitigants — 风险 ↔ 缓释配对
//   8) Value Creation Plan — 投后 100 天 / 价值创造杠杆
//   9) Recommendation & Terms — 投票建议 / 拟定条款 / Conditions Precedent
//
// 数据来源严格走 Fact Pack（F/C/K 编号），grounding audit 强制 source_refs
// 真实指向 Fact Pack，未披露字段必须明确标注。
// ============================================================

function _deps() {
  return {
    callLLMJson: require("../services/llmService").callLLMJson,
    buildEvidencePack: require("./_factPack").buildEvidencePack,
    formatFactPackForPrompt: require("./_factPack").formatFactPackForPrompt,
    assertGrounded: require("./_groundingAudit").assertGrounded,
    countMissingRefs: require("./_groundingAudit").countMissingRefs,
    summarizeFallback: require("./_groundingAudit").summarizeFallback,
  };
}

// 关键字段路径:这些字段缺 source_refs 不阻塞出结果,
// 只在 metadata.grounding_missing_refs_paths 中标记给前端/ops。
// returns_scenarios 的 source_refs 在缺退出依据时天然可空,故不纳入审计。
const _SOFT_REFS_PATHS = [
  "executive_summary",
  "thesis",
  "company",
  "market",
  "team",
  "financial_analysis",
  "risks_mitigants",
  "value_creation_plan",
];

const SYSTEM = `你是一家头部 VC 的合伙人,正在为下周的投资委员会撰写一份完整 IC Memo。
读者是基金 LP 和其他合伙人——他们见过太多 BP 改写,看到"颠覆/弯道超车/革命性"会自动减分。

【写作原则】
- thesis、Top 3 risks、recommendation 必须是你的判断,不是 BP 的复读。
- 任何数字、客户名、政策名、估值倍数必须 source_refs 引用 Fact Pack 的 F / C / K 编号。
- Fact Pack 中没有支撑时,字符串字段写"未披露/待核实/需补充材料",数字字段 null;**禁止**编造。
- risks_mitigants 每条风险必须配对缓释项,缓释项是机构能做的具体动作(尽调动作 / 投后陪跑 / 条款保护),不要写"加强沟通"。
- returns_scenarios 三档 (downside / base / upside):
  · 优先给数值化 MOIC + IRR;**但当 Fact Pack 中没有退出估值、持有期或投资金额依据时,允许 moic = null 与 irr_pct = null**。
  · 任何一档填了 null,都必须在 key_assumptions 写明"退出假设待补充(说明缺什么:估值依据 / 持有期 / 投资金额 ...)"。
  · 同时 executive_summary.headline_returns 写"退出假设待补充"而不是编造数字。
  · 三档都有数值时必须满足 downside.moic ≤ base.moic ≤ upside.moic;有 null 不强制排序。
  · **绝不**伪造退出倍数 / 可比公司退出对价。
- value_creation_plan 优先来自 Fact Pack 中可执行的运营杠杆(LTV/CAC、客户结构、地域扩张、品类增加、并购),不要写"加强营销"。
- recommendation.vote_call ∈ {strong_yes, yes, conditional_yes, pass, strong_pass}; conditional_yes 必须列出
  recommendation.conditions_precedent (CP),每条 CP 是"先 X 才进 IC/打款"的具体动作。
- 中文输出,语气克制专业,**禁止**任何宣传词:"革命性"/"独角兽潜质"/"颠覆"/"全球领先"/"弯道超车"。`;

const RETURNS_SCENARIO = {
  type: "object",
  required: ["scenario", "moic", "irr_pct", "exit_year", "key_assumptions", "source_refs"],
  additionalProperties: false,
  properties: {
    scenario: { type: "string", enum: ["downside", "base", "upside"] },
    moic: {
      type: ["number", "null"],
      description: "Multiple on Invested Capital, 0.x = 亏损;Fact Pack 缺退出依据时填 null",
    },
    irr_pct: {
      type: ["number", "null"],
      description: "年化内部收益率,负数表示亏损;Fact Pack 缺退出依据时填 null",
    },
    exit_year: { type: "string", description: "退出年份或区间,如 '2030' / '2029-2031'", maxLength: 24 },
    key_assumptions: {
      type: "array",
      minItems: 2,
      maxItems: 5,
      items: { type: "string", maxLength: 200 },
      description: "退出估值方式、收入 CAGR、退出倍数、杠杆假设 — 不能写'乐观情况'/'保守情况'空话",
    },
    source_refs: { type: "array", maxItems: 5, items: { type: "string" } },
  },
};

const SCHEMA = {
  type: "object",
  required: [
    "executive_summary",
    "thesis",
    "company",
    "market",
    "team",
    "financial_analysis",
    "returns_scenarios",
    "risks_mitigants",
    "value_creation_plan",
    "recommendation",
  ],
  additionalProperties: false,
  properties: {
    executive_summary: {
      type: "object",
      required: ["one_liner", "recommendation_headline", "headline_returns", "top_risks", "ask"],
      additionalProperties: false,
      properties: {
        one_liner: { type: "string", minLength: 10, maxLength: 200 },
        recommendation_headline: {
          type: "string",
          minLength: 8,
          maxLength: 200,
          description: "如 '建议跟投 3000 万,条件:核实 TOP1 客户合同'",
        },
        headline_returns: {
          type: "string",
          minLength: 6,
          maxLength: 200,
          description: "Base case MOIC / IRR 一句话陈述,如 'Base 3.5x / 28% IRR (5 年退出)';数据不足写 '退出假设待补充'",
        },
        top_risks: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: { type: "string", maxLength: 200 },
        },
        ask: {
          type: "string",
          maxLength: 200,
          description: "投委会需要批准什么 —— 出资金额 / 跟投权 / Board seat / 信息权",
        },
        source_refs: { type: "array", maxItems: 5, items: { type: "string" } },
      },
    },
    thesis: {
      type: "object",
      required: ["statement", "key_bets", "source_refs"],
      additionalProperties: false,
      properties: {
        statement: { type: "string", minLength: 30, maxLength: 500 },
        key_bets: { type: "array", minItems: 2, maxItems: 4, items: { type: "string", maxLength: 200 } },
        source_refs: { type: "array", maxItems: 5, items: { type: "string" } },
      },
    },
    company: {
      type: "object",
      required: ["name", "one_liner", "product_summary", "stage", "moat", "source_refs"],
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        one_liner: { type: "string", maxLength: 200 },
        product_summary: { type: "string", maxLength: 800 },
        stage: { type: "string" },
        moat: { type: "string", maxLength: 400 },
        source_refs: { type: "array", maxItems: 5, items: { type: "string" } },
      },
    },
    market: {
      type: "object",
      required: ["size_summary", "drivers", "competition", "source_refs"],
      additionalProperties: false,
      properties: {
        size_summary: { type: "string", maxLength: 400 },
        drivers: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", maxLength: 200 } },
        competition: { type: "string", maxLength: 600 },
        source_refs: { type: "array", maxItems: 5, items: { type: "string" } },
      },
    },
    team: {
      type: "object",
      required: ["assessment", "key_people", "source_refs"],
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
        source_refs: { type: "array", maxItems: 5, items: { type: "string" } },
      },
    },
    financial_analysis: {
      type: "object",
      required: [
        "historical_summary",
        "quality_of_earnings",
        "unit_economics",
        "working_capital_notes",
        "capex_intensity",
        "valuation_view",
        "source_refs",
      ],
      additionalProperties: false,
      properties: {
        historical_summary: {
          type: "string",
          maxLength: 500,
          description: "2-3 年收入 / 毛利 / EBITDA 概要,缺数据写'未披露'",
        },
        quality_of_earnings: {
          type: "string",
          maxLength: 400,
          description: "收入确认口径、recurring vs one-off、关联交易、客户集中度对盈利质量的影响",
        },
        unit_economics: { type: "string", maxLength: 400 },
        working_capital_notes: {
          type: "string",
          maxLength: 300,
          description: "应收账款、库存、应付账款周转;特殊行业可写'不适用'",
        },
        capex_intensity: {
          type: "string",
          maxLength: 300,
          description: "维持性 vs 扩张性资本开支强度,以及是否在 Fact Pack 中有支撑",
        },
        valuation_view: { type: "string", maxLength: 400 },
        source_refs: { type: "array", maxItems: 8, items: { type: "string" } },
      },
    },
    returns_scenarios: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: RETURNS_SCENARIO,
      description: "必须含三档 downside / base / upside,且 downside.moic ≤ base.moic ≤ upside.moic",
    },
    risks_mitigants: {
      type: "array", minItems: 3, maxItems: 8,
      items: {
        type: "object",
        required: ["risk", "severity", "mitigant", "source_refs"],
        additionalProperties: false,
        properties: {
          risk: { type: "string", maxLength: 250 },
          severity: { type: "string", enum: ["低", "中", "高"] },
          mitigant: { type: "string", maxLength: 250 },
          source_refs: { type: "array", maxItems: 5, items: { type: "string" } },
        },
      },
    },
    value_creation_plan: {
      type: "object",
      required: ["first_100_days", "value_levers", "source_refs"],
      additionalProperties: false,
      properties: {
        first_100_days: {
          type: "array",
          minItems: 3,
          maxItems: 6,
          items: { type: "string", maxLength: 200 },
          description: "进入项目后 100 天投后能立即推动的行动",
        },
        value_levers: {
          type: "array",
          minItems: 2,
          maxItems: 6,
          items: {
            type: "object",
            required: ["lever", "expected_impact"],
            additionalProperties: false,
            properties: {
              lever: { type: "string", maxLength: 120 },
              expected_impact: {
                type: "string",
                maxLength: 200,
                description: "对收入 / 毛利 / 估值倍数的预期撬动,定量优先",
              },
            },
          },
        },
        source_refs: { type: "array", maxItems: 5, items: { type: "string" } },
      },
    },
    recommendation: {
      type: "object",
      required: ["vote_call", "rationale", "proposed_terms", "conditions_precedent"],
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
            information_rights: { type: ["string", "null"], maxLength: 200 },
            anti_dilution: { type: ["string", "null"], maxLength: 120 },
          },
        },
        conditions_precedent: {
          type: "array",
          maxItems: 8,
          items: { type: "string", maxLength: 220 },
          description: "conditional_yes 时必须列具体先决条件,如'核实 2024 审计报告' / '签订竞业协议'",
        },
        source_refs: { type: "array", maxItems: 5, items: { type: "string" } },
      },
    },
  },
};

// MOIC 三档自洽校验:downside ≤ base ≤ upside,LLM 写反就排序,而不是整段丢弃。
// 任何一档 moic 为 null(Fact Pack 缺退出依据)时**不重排**,只补全 scenario 标签,
// 保留 LLM 的原始顺序与 key_assumptions(里面应已注明"待补充")。
function _normalizeReturnsScenarios(scenarios) {
  if (!Array.isArray(scenarios) || scenarios.length !== 3) return scenarios;
  const allNumeric = scenarios.every((s) => s && typeof s.moic === "number" && Number.isFinite(s.moic));
  if (!allNumeric) {
    // 仅补 scenario 标签(若 LLM 没标),不重排。
    const labels = ["downside", "base", "upside"];
    return scenarios.map((s, i) => ({
      ...s,
      scenario: ["downside", "base", "upside"].includes(s?.scenario) ? s.scenario : labels[i],
    }));
  }
  const sorted = [...scenarios].sort((a, b) => Number(a.moic) - Number(b.moic));
  sorted[0].scenario = "downside";
  sorted[1].scenario = "base";
  sorted[2].scenario = "upside";
  return sorted;
}

module.exports = {
  id: "ic_memo",
  title: "投委会 Memo(IC Memo)",
  description:
    "完整 IC Memo:Executive Summary + Thesis + 财务分析(含盈利质量/营运资金/资本开支) + Returns Scenarios(Downside/Base/Upside MOIC+IRR) + 风险缓释配对 + 投后 100 天 + 投票建议与先决条件",
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
      hold_years: {
        type: ["number", "null"],
        description: "持有年限,用于 IRR 推导;默认 5",
      },
    },
    additionalProperties: false,
  },

  async run({ project, params, ctx }) {
    if (!project) return { ok: false, error: "需要项目上下文" };
    const { callLLMJson, buildEvidencePack, formatFactPackForPrompt, assertGrounded, countMissingRefs, summarizeFallback } = _deps();

    const { factPack, searchUsed, uploadCount, uploadStructuredUsed, uploadStructuredFactCount } =
      await buildEvidencePack(project, {
        ctx,
        skillId: "ic_memo",
        useSearch: true,
      });
    const factsPrompt = formatFactPackForPrompt(factPack);

    const userMsg = [
      factsPrompt,
      "",
      `【IC 决策参数】`,
      `vote_lean: ${params.vote_lean || "neutral"}`,
      `target_check_size_rmb_mn: ${params.check_size_rmb_mn ?? "由你推荐"}`,
      `hold_years: ${params.hold_years ?? 5}`,
      "",
      "请严格按 schema 输出完整 IC Memo JSON。所有具体数字 / 客户 / 估值 / 倍数 / 政策必须 source_refs 引用 F/C/K 编号。",
    ].join("\n");

    const { data, repairs } = await callLLMJson(SYSTEM, userMsg, SCHEMA, {
      maxTokens: 8192,
      maxRepairs: 3,
      skillId: "ic_memo",
    });

    // 后处理:三档收益自洽
    data.returns_scenarios = _normalizeReturnsScenarios(data.returns_scenarios);

    // grounding audit:只校验"出现的 source_refs 是否真实存在",
    // 不要求所有关键字段必须非空 — 缺数据时让结果照常返回,
    // 在 metadata 标记 grounding_missing_refs_count/paths 给前端做"待核实"提示。
    let audit;
    try {
      audit = assertGrounded(data, factPack, {});
    } catch (groundingErr) {
      audit = {
        ok: false,
        errors: groundingErr.audit?.errors || [],
        warnings: ["部分 IC Memo 字段的事实引用(source_refs)指向不存在的编号，建议人工核实"],
        referenced_count: groundingErr.audit?.referenced_count || 0,
      };
    }

    const missingRefs = countMissingRefs(data, _SOFT_REFS_PATHS);

    return {
      ok: true,
      artifact: {
        kind: "json",
        summary: `IC Memo — ${data.recommendation.vote_call}`,
        payload: data,
      },
      metadata: {
        llm_repairs: repairs,
        grounding: audit,
        grounding_missing_refs_count: missingRefs.count,
        grounding_missing_refs_paths: missingRefs.paths,
        fallback: summarizeFallback(data, "ic_memo"),
        evidence_search_used: searchUsed,
        upload_facts_used: uploadCount,
        upload_structured_used: !!uploadStructuredUsed,
        upload_structured_fact_count: uploadStructuredFactCount || 0,
      },
    };
  },

  // 暴露给测试用
  _private: { SCHEMA, _normalizeReturnsScenarios, _SOFT_REFS_PATHS },
};
