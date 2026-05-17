// ============================================================
// server/skills/_factPack.js
//
// Standardized artifact harness 的事实包层。
// Skill Agent 不直接吃一整坨项目上下文自由发挥，而是吃带编号的事实清单。
// 下游 JSON 中的 source_refs 必须引用这里的 fact_id，例如 ["F001"]。
// ============================================================

const { buildContext } = require("./_projectContext");

const EMPTY_VALUES = new Set(["", "暂无", "未披露", "null", "undefined"]);

function isUsefulValue(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return !EMPTY_VALUES.has(String(value).trim());
}

function compactValue(value, max = 360) {
  if (value == null) return "";
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function pushFact(facts, { field, label, value, sourceType, sourceName, confidence = "medium" }) {
  if (!isUsefulValue(value)) return;
  const id = `F${String(facts.length + 1).padStart(3, "0")}`;
  facts.push({
    id,
    field,
    label: label || field,
    value: compactValue(value),
    source_type: sourceType || "project_context",
    source_name: sourceName || "workspace",
    confidence,
  });
}

function addObjectFacts(facts, prefix, obj, labelMap = {}, sourceName = "项目结构化字段") {
  if (!obj || typeof obj !== "object") return;
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value) || (value && typeof value === "object")) continue;
    pushFact(facts, {
      field: `${prefix}.${key}`,
      label: labelMap[key] || key,
      value,
      sourceName,
      confidence: "high",
    });
  }
}

function buildFactPack(project, opts = {}) {
  const ctx = buildContext(project);
  const facts = [];

  addObjectFacts(facts, "project", ctx.project, {
    name: "公司名称",
    one_liner: "一句话定位",
    industry: "行业",
    sub_industry: "细分行业",
    business_model: "商业模式",
    stage: "项目阶段",
    region: "地区",
    latest_score: "最新评分",
  }, "项目主数据");

  addObjectFacts(facts, "latest_version", ctx.latest_version, {
    claimed_valuation: "BP 声称估值",
    claimed_revenue: "BP 声称收入",
    claimed_users: "BP 声称用户",
    funding_round: "融资轮次",
    funding_amount: "融资金额",
    total_score: "版本评分",
  }, "最新 BP 版本");

  addObjectFacts(facts, "extracted_data", ctx.extracted_data, {
    company_name: "材料识别公司名",
    industry: "材料识别行业",
    product_name: "产品名称",
    Business_Model: "商业模式",
    Growth_Engine: "增长引擎",
    TAM_Million_RMB: "TAM(百万人民币)",
    CAGR: "CAGR",
    TRL: "技术成熟度 TRL",
    BP_Valuation: "BP 估值",
    BP_Revenue: "BP 收入",
    Founder_Exp_Years: "创始人相关从业年限",
  }, "BP 提取字段");

  const verdict = ctx.verdict || {};
  pushFact(facts, {
    field: "verdict.total_score",
    label: "综合评分",
    value: verdict.total_score,
    sourceName: "多 Agent 评分",
    confidence: "high",
  });
  for (const s of verdict.strengths || []) {
    pushFact(facts, {
      field: "verdict.strengths",
      label: "优势信号",
      value: s,
      sourceName: "多 Agent 结论",
      confidence: "medium",
    });
  }
  for (const r of verdict.risk_flags || []) {
    pushFact(facts, {
      field: "verdict.risk_flags",
      label: "风险信号",
      value: r,
      sourceName: "多 Agent 结论",
      confidence: "medium",
    });
  }

  for (const [dim, val] of Object.entries(verdict.dimensions || {})) {
    pushFact(facts, {
      field: `verdict.dimensions.${dim}.score`,
      label: `${dim} 评分`,
      value: val?.score,
      sourceName: "维度评分",
      confidence: "high",
    });
    pushFact(facts, {
      field: `verdict.dimensions.${dim}.finding`,
      label: `${dim} 发现`,
      value: val?.finding,
      sourceName: "维度分析",
      confidence: "medium",
    });
    for (const risk of val?.risk_factors || []) {
      pushFact(facts, {
        field: `verdict.dimensions.${dim}.risk_factors`,
        label: `${dim} 风险`,
        value: risk,
        sourceName: "维度分析",
        confidence: "medium",
      });
    }
  }

  for (const claim of ctx.claim_verdicts || []) {
    pushFact(facts, {
      field: "claim_verdicts",
      label: `声明核查-${claim.verdict || "待核实"}`,
      value: [
        claim.category ? `类别:${claim.category}` : "",
        claim.claim ? `声明:${claim.claim}` : "",
        claim.diff ? `差异:${claim.diff}` : "",
        claim.severity ? `严重度:${claim.severity}` : "",
      ].filter(Boolean).join("；"),
      sourceName: "BP 声明核查",
      confidence: ["证伪", "严重夸大", "夸大"].includes(claim.verdict) ? "high" : "medium",
    });
  }

  if (ctx.deep_research_excerpt) {
    pushFact(facts, {
      field: "deep_research_excerpt",
      label: "深度研究摘录",
      value: ctx.deep_research_excerpt,
      sourceName: "深度研究",
      confidence: "medium",
    });
  }

  const factPack = {
    project_name: ctx.project?.name || ctx.extracted_data?.company_name || "未命名项目",
    generated_at: new Date().toISOString(),
    facts: facts.slice(0, opts.maxFacts || 80),
    missing_policy:
      "如果 facts 中没有支撑某字段的信息，必须写“未披露/待核实/需访谈确认”，不得编造。",
  };

  return { context: ctx, factPack };
}

function formatFactPackForPrompt(factPack) {
  const facts = (factPack?.facts || []).map((f) => (
    `${f.id} | ${f.label} | ${f.value} | 来源:${f.source_name} | 置信度:${f.confidence}`
  ));
  return [
    `# Fact Pack: ${factPack?.project_name || "未命名项目"}`,
    `# 规则: 输出 JSON 中凡是判断/问题/建议涉及具体事实，必须在 source_refs 引用 F 编号。`,
    facts.join("\n") || "（暂无可用事实）",
    "",
    factPack?.missing_policy || "",
  ].join("\n");
}

function factIds(factPack) {
  return new Set((factPack?.facts || []).map((f) => f.id));
}

module.exports = {
  buildFactPack,
  formatFactPackForPrompt,
  factIds,
};
