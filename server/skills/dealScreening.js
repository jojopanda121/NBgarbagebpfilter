// ============================================================
// skills/dealScreening.js — Deal Screening(项目快速筛选)
//
// 用途:在做 IC 之前几分钟级别地判断一份 BP/Teaser/CIM 是否值得继续投入
// 尽调资源。输出:10 维 Pass/Fail criteria 矩阵 + verdict (proceed /
// further_diligence / pass) + 简短 Bull/Bear case + 首轮通话需要问的问题。
//
// 设计参考:Anthropic financial-services Apache-2.0 仓库
//   plugins/vertical-plugins/private-equity/skills/deal-screening/SKILL.md
// 改写要点:
//   - 用本仓库 Fact Pack 取代"CIM 原文",fund_criteria 由用户输入,缺省给出
//     早期 VC 默认阈值。
//   - source_refs 强制指向 F/C/K 编号,Grounding audit 复用 _groundingAudit。
//   - 输出 JSON,前端直接渲染 — light-tier 模型,几秒钟返回。
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

// criteria_assessment / bull_case / bear_case 缺 source_refs 不阻塞,
// 仅在 metadata 标记。first_call_questions / data_gaps 天然无 source_refs。
const _SOFT_REFS_PATHS = ["criteria_assessment", "bull_case", "bear_case"];

// 早期 VC 通用缺省阈值(仅在 fund_criteria 缺失时使用),仅作为 baseline,
// LLM 必须在 fund_criteria_used 中显式回传它实际比对所用的阈值。
const DEFAULT_CRITERIA = {
  sector_focus: ["科技", "企业服务", "AI", "硬科技", "医疗健康", "新能源"],
  geography_focus: ["中国大陆", "亚太"],
  stage_focus: ["天使", "Pre-A", "A 轮", "B 轮"],
  revenue_min_rmb_mn: null,         // 早期项目可以无收入,null = 不卡
  revenue_growth_min_pct: 50,       // 早期 YoY 至少 50%
  gross_margin_min_pct: 30,         // 服务业可放宽
  customer_concentration_max_pct: 50, // TOP1 客户 ≤ 50%
  check_size_range_rmb_mn: [5, 100],
  valuation_cap_rmb_mn: null,
  founder_full_time: true,
  ip_or_moat_required: true,
};

const SYSTEM = `你是一级市场基金的 Deal Screener,负责在几分钟内决定一份 BP/Teaser 是否值得继续投入尽调资源。
读者是合伙人 — 他们只想知道:这个项目是否要进 IC,还是直接 pass。

【硬性约束】
- 仅基于 Fact Pack 中的事实判断;Fact Pack 没有的字段写"未披露",对应 status 设为"unknown",**禁止**自行外推或编造数字。
- criteria_assessment 必须覆盖 10 个标准维度,每条:目标阈值、实际值、状态(pass/fail/gray/unknown)、判断依据(引用 F/C 编号)。
- verdict.recommendation 严格三档:proceed(继续尽调)/ further_diligence(有保留地继续,需要补 X 数据)/ pass(放弃)。
- bull_case 与 bear_case 各 2-4 条,每条带 source_refs。
- first_call_questions 是首轮通话**必问**清单(不是访谈提纲),每个问题要能在 5-10 分钟通话内回答。
- 中文输出,语气克制专业,**禁止**任何宣传词或溢美之词。`;

const CRITERION_ITEM = {
  type: "object",
  required: ["dimension", "target", "actual", "status", "rationale", "source_refs"],
  additionalProperties: false,
  properties: {
    dimension: {
      type: "string",
      enum: [
        "sector_fit",
        "geography_fit",
        "stage_fit",
        "revenue_size",
        "revenue_growth",
        "gross_margin",
        "customer_concentration",
        "check_size_fit",
        "valuation_fit",
        "team_quality",
      ],
    },
    target: { type: "string", maxLength: 120 },
    actual: { type: "string", maxLength: 120 },
    status: { type: "string", enum: ["pass", "fail", "gray", "unknown"] },
    rationale: { type: "string", maxLength: 240 },
    source_refs: { type: "array", maxItems: 5, items: { type: "string" } },
  },
};

const CASE_ITEM = {
  type: "object",
  required: ["point", "source_refs"],
  additionalProperties: false,
  properties: {
    point: { type: "string", minLength: 8, maxLength: 220 },
    source_refs: { type: "array", maxItems: 5, items: { type: "string" } },
  },
};

const SCHEMA = {
  type: "object",
  required: [
    "deal_facts",
    "fund_criteria_used",
    "criteria_assessment",
    "verdict",
    "bull_case",
    "bear_case",
    "first_call_questions",
    "data_gaps",
  ],
  additionalProperties: false,
  properties: {
    deal_facts: {
      type: "object",
      required: ["company_name", "one_liner", "stage", "sector", "geography"],
      additionalProperties: true,
      properties: {
        company_name: { type: "string", maxLength: 80 },
        one_liner: { type: "string", maxLength: 200 },
        stage: { type: "string", maxLength: 40 },
        sector: { type: "string", maxLength: 80 },
        geography: { type: "string", maxLength: 80 },
        revenue_snapshot: { type: "string", maxLength: 200 },
        funding_round: { type: "string", maxLength: 80 },
        source_refs: { type: "array", maxItems: 5, items: { type: "string" } },
      },
    },
    fund_criteria_used: {
      type: "object",
      description: "回传 LLM 实际用于打分的阈值(应等于入参 fund_criteria 或 DEFAULT_CRITERIA)",
      additionalProperties: true,
    },
    criteria_assessment: {
      type: "array",
      minItems: 10,
      maxItems: 10,
      items: CRITERION_ITEM,
    },
    verdict: {
      type: "object",
      required: ["recommendation", "headline", "rationale", "fail_count", "gray_count"],
      additionalProperties: false,
      properties: {
        recommendation: { type: "string", enum: ["proceed", "further_diligence", "pass"] },
        headline: { type: "string", minLength: 4, maxLength: 200 },
        rationale: { type: "string", minLength: 10, maxLength: 400 },
        fail_count: { type: "integer", minimum: 0, maximum: 10 },
        gray_count: { type: "integer", minimum: 0, maximum: 10 },
        source_refs: { type: "array", maxItems: 5, items: { type: "string" } },
      },
    },
    bull_case: { type: "array", minItems: 2, maxItems: 4, items: CASE_ITEM },
    bear_case: { type: "array", minItems: 2, maxItems: 4, items: CASE_ITEM },
    first_call_questions: {
      type: "array",
      minItems: 4,
      maxItems: 8,
      items: { type: "string", minLength: 8, maxLength: 220 },
    },
    data_gaps: {
      type: "array",
      maxItems: 8,
      items: { type: "string", minLength: 4, maxLength: 200 },
      description: "进入下一轮尽调前必须补的数据/材料清单",
    },
  },
};

// verdict 与 criteria_assessment 自洽 — 服务端复算 fail/gray,
// 并只在 LLM 给出明显矛盾时下调判定;**不抛错、不返回 ok:false**,
// 让用户至少拿到结果,在 headline/rationale 加系统提示。
//
// 规则:
//   fail >= 3 + recommendation=proceed → 下调为 further_diligence,headline 加 [自动下调]
//   fail in {1,2} + recommendation=proceed → **保留 proceed**,但 headline 标 "(需补充尽调)",
//     rationale 加系统注 — 避免过度拦截,优先让用户拿到判断。
//   fail == 0 → 完全尊重 LLM。
function _enforceVerdictConsistency(payload) {
  const list = Array.isArray(payload.criteria_assessment) ? payload.criteria_assessment : [];
  const fail = list.filter((c) => c.status === "fail").length;
  const gray = list.filter((c) => c.status === "gray").length;
  payload.verdict = payload.verdict || {};
  payload.verdict.fail_count = fail;
  payload.verdict.gray_count = gray;
  const isProceed = payload.verdict.recommendation === "proceed";
  if (fail >= 3 && isProceed) {
    payload.verdict.recommendation = "further_diligence";
    payload.verdict.headline = `[自动下调] ${payload.verdict.headline || ""}`.slice(0, 200);
    payload.verdict.rationale = `${payload.verdict.rationale || ""}\n[系统注]:失败维度=${fail},超出 proceed 容忍,自动下调到 further_diligence。`.slice(0, 400);
  } else if (fail >= 1 && fail <= 2 && isProceed) {
    if (!String(payload.verdict.headline || "").includes("需补充尽调")) {
      payload.verdict.headline = `${payload.verdict.headline || ""}(需补充尽调)`.slice(0, 200);
    }
    payload.verdict.rationale = `${payload.verdict.rationale || ""}\n[系统注]:有 ${fail} 个失败维度,建议在下一轮尽调优先核实。`.slice(0, 400);
  }
  return payload;
}

module.exports = {
  id: "deal_screening",
  title: "Deal Screening(项目筛选)",
  description:
    "对 BP/Teaser/CIM 做 10 维 Pass/Fail 矩阵筛选,输出 proceed / further_diligence / pass 判定 + Bull/Bear + 首轮通话必问问题,适合在 IC 前快速过滤",
  category: "memo",
  outputArtifactKind: "json",
  inputSchema: {
    type: "object",
    properties: {
      fund_criteria: {
        type: "object",
        description:
          "可选,基金筛选阈值。缺省时用 DEFAULT_CRITERIA(早期 VC baseline)。" +
          "字段名建议与 DEFAULT_CRITERIA 一致,允许自定义键以适配不同基金。",
        additionalProperties: true,
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
        skillId: "deal_screening",
        useSearch: false, // 快速筛选阶段不外搜,纯 Fact Pack
      });
    const factsPrompt = formatFactPackForPrompt(factPack);
    const criteria = { ...DEFAULT_CRITERIA, ...(params.fund_criteria || {}) };

    const userMsg = [
      factsPrompt,
      "",
      "【基金筛选阈值 fund_criteria】",
      JSON.stringify(criteria, null, 2),
      "",
      "请严格按 schema 输出 10 维矩阵 + verdict + Bull/Bear + 首轮通话必问问题 + 数据缺口清单。",
      "criteria_assessment 必须严格包含 10 个 dimension,缺少哪一项视为 schema 失败。",
    ].join("\n");

    const { data, repairs } = await callLLMJson(SYSTEM, userMsg, SCHEMA, {
      maxTokens: 4096,
      maxRepairs: 2,
      skillId: "deal_screening",
    });

    _enforceVerdictConsistency(data);

    let audit;
    try {
      // 不要求 first_call_questions / data_gaps 必须有 source_refs(它们本就是缺口/未知)。
      // 仅校验所有出现的 source_refs 都真实指向 Fact Pack 编号。
      audit = assertGrounded(data, factPack, {});
    } catch (groundingErr) {
      audit = {
        ok: false,
        errors: groundingErr.audit?.errors || [],
        warnings: ["部分事实引用(source_refs)指向不存在的编号，建议人工核实"],
        referenced_count: groundingErr.audit?.referenced_count || 0,
      };
    }

    const missingRefs = countMissingRefs(data, _SOFT_REFS_PATHS);

    return {
      ok: true,
      artifact: {
        kind: "json",
        summary: `Deal Screening — ${data.verdict.recommendation} (fail=${data.verdict.fail_count}, gray=${data.verdict.gray_count})`,
        payload: data,
      },
      metadata: {
        llm_repairs: repairs,
        grounding: audit,
        grounding_missing_refs_count: missingRefs.count,
        grounding_missing_refs_paths: missingRefs.paths,
        fallback: summarizeFallback(data, "deal_screening"),
        evidence_search_used: searchUsed,
        upload_facts_used: uploadCount,
        upload_structured_used: !!uploadStructuredUsed,
        upload_structured_fact_count: uploadStructuredFactCount || 0,
      },
    };
  },

  // 暴露给测试
  _private: { SCHEMA, DEFAULT_CRITERIA, _enforceVerdictConsistency, _SOFT_REFS_PATHS },
};
