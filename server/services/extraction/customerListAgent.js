// ============================================================
// server/services/extraction/customerListAgent.js
//
// 抽取前十大客户清单 + 客户集中度. 输出严格 JSON. 缺数据 null + missing.
// ============================================================

const {
  NUMBER_FIELD,
  STRING_FIELD,
  missingNumber,
  missingString,
  normalizeNumberField,
  normalizeStringField,
} = require("./_schemas");

const SYSTEM_PROMPT = `你是一级市场基金的客户结构分析师。从 BP / 招股书 / 调研笔记中**结构化抽取**客户清单与集中度。

【硬性约束】
- 只输出 JSON 一个对象。
- top_customers 是有序数组（按 revenue_share_pct 降序），LLM 找不到具体客户名时给空数组，不要凑数。
- 单个客户没有具体名字（如 BP 写 "某头部互联网公司"）：name 用 BP 原文短描述，contract_status="待披露"，confidence="low"。
- BP 单方声称的客户（无合同/无回款证据）：confidence="low" + status="待核实"。
- concentration_top3_pct / concentration_top10_pct: 优先用 BP 直接披露; 算不出来 missing, 不要硬算。
- industry_breakdown 是按行业分类的收入占比；BP 没分行业列表时 → 空数组。
- 不要把"潜在客户" / "签了 MOU 但未付款" 当作 confirmed 客户；这些放到 notes.warnings。`;

function makeNumber() { return JSON.parse(JSON.stringify(NUMBER_FIELD)); }

const CUSTOMER_ITEM = {
  type: "object",
  required: ["name", "revenue_share_pct", "contract_status", "since", "source_ref", "confidence"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 2, maxLength: 80 },
    revenue_share_pct: { type: ["number", "null"] },
    contract_status: {
      type: "string",
      enum: ["已签约付款", "已签约未付款", "PoC 中", "MOU/意向", "待披露", "待核实", "已流失"],
    },
    since: { type: "string", maxLength: 16, description: "首单时点 / 合作开始年份" },
    source_ref: { type: "string", maxLength: 40 },
    confidence: { type: "string", enum: ["high", "medium", "low", "missing"] },
  },
};

const INDUSTRY_ITEM = {
  type: "object",
  required: ["industry", "share_pct"],
  additionalProperties: false,
  properties: {
    industry: { type: "string", minLength: 2, maxLength: 40 },
    share_pct: { type: ["number", "null"] },
    source_ref: { type: "string", maxLength: 40 },
    confidence: { type: "string", enum: ["high", "medium", "low", "missing"] },
  },
};

const SCHEMA = {
  type: "object",
  required: ["top_customers", "concentration_top3_pct", "concentration_top10_pct", "industry_breakdown", "notes"],
  additionalProperties: false,
  properties: {
    top_customers: { type: "array", maxItems: 12, items: CUSTOMER_ITEM },
    concentration_top3_pct: makeNumber(),
    concentration_top10_pct: makeNumber(),
    industry_breakdown: { type: "array", maxItems: 10, items: INDUSTRY_ITEM },
    notes: {
      type: "object",
      required: ["customer_disclosure_quality", "warnings"],
      additionalProperties: false,
      properties: {
        customer_disclosure_quality: { ...STRING_FIELD, description: "BP 客户披露质量评估：'公开 / 仅给行业类型 / 仅口头 / 完全未披露'" },
        warnings: {
          type: "array",
          maxItems: 6,
          items: { type: "string", maxLength: 200 },
          description: "如 'BP 列出 5 家客户但仅 1 家已签约付款' / 'TOP1 占比 78% 触发集中度红线'",
        },
      },
    },
  },
};

function _normalizeCustomer(c) {
  if (!c || typeof c !== "object") return null;
  const status = ["已签约付款", "已签约未付款", "PoC 中", "MOU/意向", "待披露", "待核实", "已流失"]
    .includes(c.contract_status) ? c.contract_status : "待核实";
  const conf = ["high", "medium", "low", "missing"].includes(c.confidence) ? c.confidence : "low";
  return {
    name: typeof c.name === "string" ? c.name.slice(0, 80) : "",
    revenue_share_pct: typeof c.revenue_share_pct === "number" ? c.revenue_share_pct : null,
    contract_status: status,
    since: typeof c.since === "string" ? c.since.slice(0, 16) : "",
    source_ref: typeof c.source_ref === "string" ? c.source_ref.slice(0, 40) : "",
    confidence: conf,
  };
}

function _normalizeIndustry(it) {
  if (!it || typeof it !== "object") return null;
  return {
    industry: typeof it.industry === "string" ? it.industry.slice(0, 40) : "",
    share_pct: typeof it.share_pct === "number" ? it.share_pct : null,
    source_ref: typeof it.source_ref === "string" ? it.source_ref.slice(0, 40) : "",
    confidence: ["high", "medium", "low", "missing"].includes(it.confidence) ? it.confidence : "low",
  };
}

function normalize(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const notes = data.notes || {};
  const customers = Array.isArray(data.top_customers)
    ? data.top_customers.map(_normalizeCustomer).filter((c) => c && c.name).slice(0, 12)
    : [];
  // 按 revenue_share_pct 降序（null 排末尾）
  customers.sort((a, b) => {
    const av = a.revenue_share_pct == null ? -1 : a.revenue_share_pct;
    const bv = b.revenue_share_pct == null ? -1 : b.revenue_share_pct;
    return bv - av;
  });
  return {
    top_customers: customers,
    concentration_top3_pct: normalizeNumberField(data.concentration_top3_pct),
    concentration_top10_pct: normalizeNumberField(data.concentration_top10_pct),
    industry_breakdown: Array.isArray(data.industry_breakdown)
      ? data.industry_breakdown.map(_normalizeIndustry).filter((i) => i && i.industry).slice(0, 10)
      : [],
    notes: {
      customer_disclosure_quality: normalizeStringField(notes.customer_disclosure_quality),
      warnings: Array.isArray(notes.warnings)
        ? notes.warnings.filter((w) => typeof w === "string").slice(0, 6)
        : [],
    },
  };
}

function buildExtractionFailedPayload(reason) {
  return {
    top_customers: [],
    concentration_top3_pct: missingNumber(),
    concentration_top10_pct: missingNumber(),
    industry_breakdown: [],
    notes: {
      customer_disclosure_quality: missingString(),
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
      `【BP 原文 / 客户 + 商业化相关段落】\n${bpText}\n\n请按 schema 输出客户清单 JSON。`,
      SCHEMA,
      {
        maxTokens: opts.maxTokens || 4096,
        maxRepairs: opts.maxRepairs ?? 2,
        taskHint: "upload_structured_extraction",
        skillId: "customer_list_agent",
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
