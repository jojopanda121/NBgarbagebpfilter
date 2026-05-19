// ============================================================
// server/services/extraction/financialStatementsAgent.js
//
// 从 BP 原文中抽取财务三表 (P&L / Balance Sheet / Cash Flow) 结构化数据。
// 输出严格 JSON schema，缺失字段统一 null + confidence: "missing"，
// **禁止**用自然语言占位（"未披露"/"待核实"），确保下游 deck/IC/DD
// skill 能直接消费。
// ============================================================

const {
  NUMBER_FIELD,
  STRING_FIELD,
  missingNumber,
  missingString,
  normalizeNumberField,
  normalizeStringField,
} = require("./_schemas");

const SYSTEM_PROMPT = `你是一级市场基金的财务尽调分析师，负责从 BP / 招股书 / 调研笔记中**结构化抽取**财务三表数据。
你不做任何分析或判断，只做**抽数 + 标注口径**。

【硬性约束】
- 只输出 JSON 一个对象，不要任何 Markdown / 解释。
- 所有数字字段是 {value: number|null, unit, period, source_ref, confidence} 五元组。
- 数字缺失时：value=null, unit="", period="", source_ref="", confidence="missing"。**禁止**写"未披露"/"待核实"/"暂无"等任何字符串占位到 value 字段。
- 指标在该业务模式下不适用（如 SaaS 没有"存货")：value=null, confidence="n/a"。
- 数字单位必须明确：万元 / 亿元 / 万美元 / 百万美元 / % / 个 / 月。统一不要 mix。
- period 必须明确口径：'2024 全年' / '2025 Q1-Q3' / 'TTM 2026-03' / '2026-04 单月'。模糊就标 'missing'。
- source_ref 写 BP 中页码 / 章节 / 表格名（如 'P15 财务摘要表'）；找不到精确出处填 ''。
- confidence: high (BP 中明确披露 + 单位口径自洽) / medium (能推断但有歧义) / low (单点数字无交叉验证) / missing / n/a / extraction_failed。
- 不要做估算/外推/猜测：BP 给了 2024 + 2025 Q3 但没给 2025 全年时，不要"年化"补全；保持 missing。
- runway_months 是从最近一期现金 / 月均经营性现金流 计算出来的，给数字 + period + confidence；BP 直接披露的优先用披露值。`;

// 完整 schema：每个数字字段都走 NUMBER_FIELD 五元组
function makeNumber() { return JSON.parse(JSON.stringify(NUMBER_FIELD)); }

const SCHEMA = {
  type: "object",
  required: ["pl", "bs", "cf", "fiscal_periods", "notes"],
  additionalProperties: false,
  properties: {
    pl: {
      type: "object",
      required: ["revenue", "cogs", "gross_profit", "opex", "ebitda", "net_income"],
      additionalProperties: false,
      properties: {
        revenue: makeNumber(),
        cogs: makeNumber(),
        gross_profit: makeNumber(),
        gross_margin_pct: makeNumber(),
        opex: makeNumber(),
        ebitda: makeNumber(),
        net_income: makeNumber(),
      },
    },
    bs: {
      type: "object",
      required: ["total_assets", "cash", "total_liabilities", "equity"],
      additionalProperties: false,
      properties: {
        total_assets: makeNumber(),
        cash: makeNumber(),
        ar: makeNumber(),
        inventory: makeNumber(),
        total_liabilities: makeNumber(),
        equity: makeNumber(),
      },
    },
    cf: {
      type: "object",
      required: ["operating_cf", "investing_cf", "financing_cf", "free_cash_flow", "runway_months"],
      additionalProperties: false,
      properties: {
        operating_cf: makeNumber(),
        investing_cf: makeNumber(),
        financing_cf: makeNumber(),
        free_cash_flow: makeNumber(),
        runway_months: makeNumber(),
      },
    },
    fiscal_periods: {
      type: "array",
      maxItems: 8,
      description: "BP 中涉及的所有口径期间（如 ['2023 全年','2024 全年','2025 Q1-Q3']），方便下游 deck 做横向 trend",
      items: { type: "string", maxLength: 24 },
    },
    notes: {
      type: "object",
      required: ["currency", "consistency", "warnings"],
      additionalProperties: false,
      properties: {
        currency: { ...STRING_FIELD, description: "主报告币种，如 'CNY' / 'USD'" },
        consistency: { ...STRING_FIELD, description: "三表自洽情况，如 '收入与回款一致' / '毛利与单位经济存在差异'" },
        warnings: {
          type: "array",
          maxItems: 5,
          items: { type: "string", maxLength: 200 },
          description: "抽取时发现的可疑点，如 '2024 收入与 2025 Q1-Q3 累计不可比'",
        },
      },
    },
  },
};

function normalize(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const pl = data.pl || {};
  const bs = data.bs || {};
  const cf = data.cf || {};
  const notes = data.notes || {};
  return {
    pl: {
      revenue: normalizeNumberField(pl.revenue),
      cogs: normalizeNumberField(pl.cogs),
      gross_profit: normalizeNumberField(pl.gross_profit),
      gross_margin_pct: normalizeNumberField(pl.gross_margin_pct),
      opex: normalizeNumberField(pl.opex),
      ebitda: normalizeNumberField(pl.ebitda),
      net_income: normalizeNumberField(pl.net_income),
    },
    bs: {
      total_assets: normalizeNumberField(bs.total_assets),
      cash: normalizeNumberField(bs.cash),
      ar: normalizeNumberField(bs.ar),
      inventory: normalizeNumberField(bs.inventory),
      total_liabilities: normalizeNumberField(bs.total_liabilities),
      equity: normalizeNumberField(bs.equity),
    },
    cf: {
      operating_cf: normalizeNumberField(cf.operating_cf),
      investing_cf: normalizeNumberField(cf.investing_cf),
      financing_cf: normalizeNumberField(cf.financing_cf),
      free_cash_flow: normalizeNumberField(cf.free_cash_flow),
      runway_months: normalizeNumberField(cf.runway_months),
    },
    fiscal_periods: Array.isArray(data.fiscal_periods)
      ? data.fiscal_periods.filter((p) => typeof p === "string").slice(0, 8)
      : [],
    notes: {
      currency: normalizeStringField(notes.currency),
      consistency: normalizeStringField(notes.consistency),
      warnings: Array.isArray(notes.warnings)
        ? notes.warnings.filter((w) => typeof w === "string").slice(0, 5)
        : [],
    },
  };
}

function buildExtractionFailedPayload(reason) {
  return {
    pl: {
      revenue: missingNumber(),
      cogs: missingNumber(),
      gross_profit: missingNumber(),
      gross_margin_pct: missingNumber(),
      opex: missingNumber(),
      ebitda: missingNumber(),
      net_income: missingNumber(),
    },
    bs: {
      total_assets: missingNumber(),
      cash: missingNumber(),
      ar: missingNumber(),
      inventory: missingNumber(),
      total_liabilities: missingNumber(),
      equity: missingNumber(),
    },
    cf: {
      operating_cf: missingNumber(),
      investing_cf: missingNumber(),
      financing_cf: missingNumber(),
      free_cash_flow: missingNumber(),
      runway_months: missingNumber(),
    },
    fiscal_periods: [],
    notes: {
      currency: missingString(),
      consistency: missingString(),
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
      `【BP 原文 / 财务相关段落】\n${bpText}\n\n请按 schema 输出财务三表 JSON。`,
      SCHEMA,
      {
        maxTokens: opts.maxTokens || 6144,
        maxRepairs: opts.maxRepairs ?? 2,
        taskHint: "upload_structured_extraction",
        skillId: "financial_statements_agent",
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
