// ============================================================
// server/services/extraction/_schemas.js
//
// BP 深度解析 3 agent 共用的字段约定。
//
// 设计目标：让下游 skill (InvestmentDeck 的 Downside Case 页、
// IC Questions 的估值挑战段、DDChecklist 的财务稽核点、CompetitorMatrix
// 的资本效率对照) 都能从一个稳定结构里取数，不用各自再 prompt 一遍。
//
// 三类语义约束（运行时 normalize 阶段强制）：
//   - 数字字段缺失：填 null，**并**在同结构内的 confidence 字段写 "missing"
//   - LLM 判定数字不适用 (非 SaaS / 早期未盈利)：null + confidence: "n/a"
//   - 有数字但不确定：填数字 + confidence: "low|medium|high"
// Ajv 不允许 confidence 是 "未披露 / 暂无 / 待核实" 这种自然语言占位（与
// Fact Pack 的占位词区分开，下游 schema 才能稳定消费）。
// ============================================================

const CONFIDENCE_ENUM = ["high", "medium", "low", "missing", "n/a", "extraction_failed"];

// 一个"带置信度的数字"字段约定，所有 agent 通用
const NUMBER_FIELD = {
  type: "object",
  required: ["value", "confidence"],
  additionalProperties: false,
  properties: {
    value: { type: ["number", "null"] },
    unit: { type: "string", maxLength: 16 },
    period: { type: "string", maxLength: 24, description: "对应口径年份/季度，如 '2025Q4' / 'TTM 2026-03'" },
    source_ref: { type: "string", maxLength: 40, description: "BP 中页码 / 章节 / 表格名，没有写 ''" },
    confidence: { type: "string", enum: CONFIDENCE_ENUM },
  },
};

// 字符串字段也支持 confidence，方便下游用同一 isMissing() 判断
const STRING_FIELD = {
  type: "object",
  required: ["value", "confidence"],
  additionalProperties: false,
  properties: {
    value: { type: ["string", "null"], maxLength: 240 },
    source_ref: { type: "string", maxLength: 40 },
    confidence: { type: "string", enum: CONFIDENCE_ENUM },
  },
};

function missingNumber() {
  return { value: null, unit: "", period: "", source_ref: "", confidence: "missing" };
}
function missingString() {
  return { value: null, source_ref: "", confidence: "missing" };
}

// 校验 + normalize：如果 LLM 把 value 设成 "未披露" 字符串，强制改成 null + missing
function normalizeNumberField(obj) {
  const f = obj && typeof obj === "object" ? obj : {};
  let value = f.value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || /^(未披露|暂无|待核实|n\/a|null)$/i.test(trimmed)) value = null;
    else if (/^-?\d+(\.\d+)?$/.test(trimmed)) value = Number(trimmed);
    else value = null; // LLM 写了非纯数字字符串，强制 null
  }
  if (typeof value !== "number" && value !== null) value = null;
  return {
    value,
    unit: typeof f.unit === "string" ? f.unit.slice(0, 16) : "",
    period: typeof f.period === "string" ? f.period.slice(0, 24) : "",
    source_ref: typeof f.source_ref === "string" ? f.source_ref.slice(0, 40) : "",
    confidence: CONFIDENCE_ENUM.includes(f.confidence) ? f.confidence : (value === null ? "missing" : "low"),
  };
}

function normalizeStringField(obj) {
  const f = obj && typeof obj === "object" ? obj : {};
  let value = f.value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || /^(未披露|暂无|待核实|n\/a|null)$/i.test(trimmed)) value = null;
    else value = trimmed.slice(0, 240);
  } else if (value !== null) {
    value = null;
  }
  return {
    value,
    source_ref: typeof f.source_ref === "string" ? f.source_ref.slice(0, 40) : "",
    confidence: CONFIDENCE_ENUM.includes(f.confidence) ? f.confidence : (value === null ? "missing" : "low"),
  };
}

module.exports = {
  CONFIDENCE_ENUM,
  NUMBER_FIELD,
  STRING_FIELD,
  missingNumber,
  missingString,
  normalizeNumberField,
  normalizeStringField,
};
