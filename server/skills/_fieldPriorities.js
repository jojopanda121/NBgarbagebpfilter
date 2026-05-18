// ============================================================
// server/skills/_fieldPriorities.js
//
// 跨 skill 字段优先级中央表。
//
// 三档：
//   required  — 缺失则整个 artifact 不能生成（Ajv schema 已强制）
//   preferred — 缺失时填占位符 "未披露" / "待核实" / "N/A — <理由>"；
//               artifact 正常生成但渲染时标灰，让投资人一眼识别 data room 缺口
//   optional  — 缺失时整段省略，不阻塞、不留位
//
// 设计意图：
//  1) 在 prompt 端：把"哪些字段是缺了也能继续/必须显式标注未披露"明确告诉 LLM，
//     避免 LLM 看到缺数据就抛错或瞎编。
//  2) 在渲染端：可调用 isMissingValue(v) 判断单元格要不要灰色斜体。
//  3) 在审计端：未来 _groundingAudit 可对每个 skill 跑"preferred 字段缺失率"统计，
//     输出到 metadata，让 ops 知道哪些项目数据极度稀疏。
// ============================================================

const MISSING_PLACEHOLDERS = new Set(["未披露", "暂无", "待核实", "待补充", "—", "-"]);

function isMissingValue(value) {
  if (value == null) return true;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return true;
    if (MISSING_PLACEHOLDERS.has(trimmed)) return true;
    // 裸 "N/A" / "N/A." 算缺失；"N/A — 已盈利" 这种带理由的不算（属于显式披露指标不适用）
    if (/^N\/A\.?$/i.test(trimmed)) return true;
  }
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

// ── 字段优先级表 ────────────────────────────────────────────
//
// 注：required 一般不写入这张表（Ajv schema 已强制必填）；
// 这里只列 preferred / optional，便于 prompt 提示和渲染降级。

const PRIORITIES = {
  onepager_pptx: {
    preferred: [
      "deal_dynamics.round",
      "deal_dynamics.amount",
      "deal_dynamics.valuation",
      "deal_dynamics.lead_investor",
      "deal_dynamics.progress",
      "traction_snippet.arr",
      "traction_snippet.mom",
      "traction_snippet.ndr",
      "traction_snippet.burn_rate",
      "footer.founded",
      "footer.team_size",
      "footer.funding_total",
    ],
    optional: ["deal_breakers"],
  },
  investment_snapshot: {
    preferred: [],
    optional: ["deal_breakers"],
  },
  project_brief: {
    preferred: [],
    optional: ["deal_breakers"],
  },
  competitor_matrix_xlsx: {
    preferred: [
      "confirmed_competitors[].recent_moves_3m",
      "confirmed_competitors[].valuation_signal",
      "confirmed_competitors[].total_funding",
    ],
    optional: ["hypothesis_competitors[].recent_moves_3m"],
  },
  ic_questions_xlsx: {
    preferred: [
      "valuation_benchmark.comparable_set",
      "valuation_benchmark.industry_median",
      "valuation_benchmark.subject_implied",
      "exit_scenarios[].precedents",
    ],
    optional: [],
  },
  investment_deck_pptx: {
    preferred: [
      "slides[].chart",
      "slides[].table",
    ],
    optional: [],
  },
  highlight_visual: {
    preferred: [
      "value_chain.profit_pool_note",
      "ue_flywheel.ltv_cac",
      "ue_flywheel.payback_months",
    ],
    optional: ["template_fallback_reason"],
  },
};

function priorityHintForPrompt(skillId) {
  const p = PRIORITIES[skillId];
  if (!p) return "";
  const preferred = p.preferred || [];
  const optional = p.optional || [];
  const lines = ["【字段优先级 — fallback 规则】"];
  if (preferred.length) {
    lines.push(
      "preferred (缺数据时**必须显式**填占位符，让人识别缺口；禁止编造):",
    );
    for (const f of preferred) lines.push(`  · ${f} → 缺失填 "未披露" 或 "N/A — <理由>"`);
  }
  if (optional.length) {
    lines.push("optional (缺数据时整段省略即可):");
    for (const f of optional) lines.push(`  · ${f}`);
  }
  lines.push("required 字段（schema 强制）不在本表中；缺失会直接报错。");
  return lines.join("\n");
}

function getFieldPriorities(skillId) {
  return PRIORITIES[skillId] || { preferred: [], optional: [] };
}

module.exports = {
  PRIORITIES,
  MISSING_PLACEHOLDERS,
  isMissingValue,
  priorityHintForPrompt,
  getFieldPriorities,
};
