// ============================================================
// server/services/extraction/unitEconomicsAgent.js
//
// 抽取单位经济模型 (LTV / CAC / Payback / Gross Margin / Churn / NRR / ARPA)
// 输出严格 JSON schema. 缺数据时 null + missing.
// ============================================================

const {
  NUMBER_FIELD,
  STRING_FIELD,
  missingNumber,
  missingString,
  normalizeNumberField,
  normalizeStringField,
} = require("./_schemas");

const SYSTEM_PROMPT = `你是一级市场基金的单位经济分析师。从 BP / 财务材料中**结构化抽取**单位经济模型核心指标。

【硬性约束】
- 只输出 JSON 一个对象。
- 数字字段五元组 {value, unit, period, source_ref, confidence}；缺失 value=null + confidence="missing"。
- 业务模式不适用（如硬件一次性销售没有 NRR）：value=null + confidence="n/a"。
- ltv_cac_ratio = LTV ÷ CAC，能算出来就给数字 + confidence="medium"; 算不出来 missing。
- payback_months 是回收 CAC 的月数，BP 直接披露优先；缺数据时根据 CAC / 月均毛利 推算给 medium 信心。
- cohort_evidence 是 LTV / churn / NRR 的底层 cohort 数据点，没有就给空数组（不要凑数）。
- gross_margin_pct 与 financialStatementsAgent 的 pl.gross_margin_pct 应该一致；不一致就在 notes.warnings 里说明。
- arpa = 单客户年化收入 (Average Revenue Per Account)。`;

function makeNumber() { return JSON.parse(JSON.stringify(NUMBER_FIELD)); }

const SCHEMA = {
  type: "object",
  required: ["ltv", "cac", "ltv_cac_ratio", "payback_months", "gross_margin_pct", "churn_monthly_pct", "nrr_pct", "arpa", "cohort_evidence", "notes"],
  additionalProperties: false,
  properties: {
    ltv: makeNumber(),
    cac: makeNumber(),
    ltv_cac_ratio: makeNumber(),
    payback_months: makeNumber(),
    gross_margin_pct: makeNumber(),
    churn_monthly_pct: makeNumber(),
    nrr_pct: makeNumber(),
    arpa: makeNumber(),
    cohort_evidence: {
      type: "array",
      maxItems: 12,
      description: "底层 cohort 数据点。LLM 找到具体表/页时填，否则空数组。",
      items: {
        type: "object",
        required: ["cohort_id", "month_offset", "metric", "value", "confidence"],
        additionalProperties: false,
        properties: {
          cohort_id: { type: "string", maxLength: 24, description: "如 '2024-Q1 cohort' / '客户分组 A'" },
          month_offset: { type: ["integer", "null"], description: "进入 cohort 后第 N 月，0 起算" },
          metric: { type: "string", enum: ["ltv", "retention", "arpa", "churn", "nrr", "other"] },
          value: { type: ["number", "string", "null"] },
          source_ref: { type: "string", maxLength: 40 },
          confidence: { type: "string", enum: ["high", "medium", "low", "missing"] },
        },
      },
    },
    notes: {
      type: "object",
      required: ["business_model_hint", "warnings"],
      additionalProperties: false,
      properties: {
        business_model_hint: { ...STRING_FIELD, description: "判断的业务模式，如 'B2B SaaS 订阅' / '硬件一次性销售'，影响哪些指标 n/a" },
        warnings: {
          type: "array",
          maxItems: 5,
          items: { type: "string", maxLength: 200 },
          description: "可疑点，如 'LTV/CAC 比值与 BP 披露的回本月数不自洽'",
        },
      },
    },
  },
};

function normalize(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const notes = data.notes || {};
  return {
    ltv: normalizeNumberField(data.ltv),
    cac: normalizeNumberField(data.cac),
    ltv_cac_ratio: normalizeNumberField(data.ltv_cac_ratio),
    payback_months: normalizeNumberField(data.payback_months),
    gross_margin_pct: normalizeNumberField(data.gross_margin_pct),
    churn_monthly_pct: normalizeNumberField(data.churn_monthly_pct),
    nrr_pct: normalizeNumberField(data.nrr_pct),
    arpa: normalizeNumberField(data.arpa),
    cohort_evidence: Array.isArray(data.cohort_evidence)
      ? data.cohort_evidence
          .filter((c) => c && typeof c === "object")
          .slice(0, 12)
          .map((c) => ({
            cohort_id: typeof c.cohort_id === "string" ? c.cohort_id.slice(0, 24) : "",
            month_offset: Number.isInteger(c.month_offset) ? c.month_offset : null,
            metric: ["ltv", "retention", "arpa", "churn", "nrr", "other"].includes(c.metric) ? c.metric : "other",
            value: typeof c.value === "number" || typeof c.value === "string" ? c.value : null,
            source_ref: typeof c.source_ref === "string" ? c.source_ref.slice(0, 40) : "",
            confidence: ["high", "medium", "low", "missing"].includes(c.confidence) ? c.confidence : "missing",
          }))
      : [],
    notes: {
      business_model_hint: normalizeStringField(notes.business_model_hint),
      warnings: Array.isArray(notes.warnings)
        ? notes.warnings.filter((w) => typeof w === "string").slice(0, 5)
        : [],
    },
  };
}

function buildExtractionFailedPayload(reason) {
  return {
    ltv: missingNumber(),
    cac: missingNumber(),
    ltv_cac_ratio: missingNumber(),
    payback_months: missingNumber(),
    gross_margin_pct: missingNumber(),
    churn_monthly_pct: missingNumber(),
    nrr_pct: missingNumber(),
    arpa: missingNumber(),
    cohort_evidence: [],
    notes: {
      business_model_hint: missingString(),
      warnings: [reason || "extraction_failed"],
    },
  };
}

async function extract(bpText, opts = {}) {
  if (!bpText || typeof bpText !== "string" || bpText.trim().length < 50) {
    return { data: buildExtractionFailedPayload("input_too_short"), repairs: 0 };
  }
  const { callLLMJson } = require("../llmService");
  try {
    const out = await callLLMJson(
      SYSTEM_PROMPT,
      `【BP 原文 / 商业模式 + 财务相关段落】\n${bpText}\n\n请按 schema 输出单位经济模型 JSON。`,
      SCHEMA,
      {
        maxTokens: opts.maxTokens || 4096,
        maxRepairs: opts.maxRepairs ?? 2,
        taskHint: "upload_structured_extraction",
        skillId: "unit_economics_agent",
      },
    );
    return { data: normalize(out.data), repairs: out.repairs };
  } catch (e) {
    return {
      data: buildExtractionFailedPayload(`llm_error: ${e.message?.slice(0, 80) || "unknown"}`),
      repairs: 3,
      error: e.message,
    };
  }
}

module.exports = { SCHEMA, SYSTEM_PROMPT, extract, normalize, buildExtractionFailedPayload };
