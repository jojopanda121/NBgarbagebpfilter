// ============================================================
// server/utils/jsonParser.js — JSON 提取与修复工具
// 从原 server/index.js 中提取，支持 7 级容错解析
// ============================================================

/** 移除字符串外部的注释（保留字符串内的 // 和 URL） */
function removeComments(str) {
  let result = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (esc) { result += ch; esc = false; continue; }
    if (ch === "\\" && inStr) { result += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; result += ch; continue; }
    if (inStr) { result += ch; continue; }
    // 跳过单行注释
    if (ch === "/" && str[i + 1] === "/") {
      const nl = str.indexOf("\n", i);
      i = nl === -1 ? str.length : nl - 1;
      continue;
    }
    // 跳过多行注释
    if (ch === "/" && str[i + 1] === "*") {
      const end = str.indexOf("*/", i + 2);
      i = end === -1 ? str.length : end + 1;
      continue;
    }
    result += ch;
  }
  return result;
}

/** 清理 LLM 输出中的非标准 JSON */
function sanitizeJsonString(str) {
  str = removeComments(str);
  str = str.replace(/,\s*([\]}])/g, "$1");
  return str.trim();
}

/** 尝试修复常见的 JSON 格式问题 */
function attemptJsonFix(str) {
  if (!str) return str;
  let fixed = str;
  fixed = fixed.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\uFEFF]/g, "");
  fixed = fixed.replace(/,(\s*[}\]])/g, "$1");
  fixed = removeComments(fixed);
  return fixed.trim();
}

/**
 * 修复被截断的 JSON 字符串：
 * 统计未闭合的 { [ "，按需补齐 ] } 使其成为合法 JSON。
 */
function repairTruncatedJson(str) {
  if (!str) return str;
  let braces = 0, brackets = 0, inStr = false, esc = false;
  for (const ch of str) {
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") braces++;
    else if (ch === "}") braces--;
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets--;
  }
  if (braces === 0 && brackets === 0 && !inStr) return str;
  let repaired = str.trimEnd();
  if (inStr) repaired += '"';
  repaired = repaired.replace(/,\s*$/, "");
  while (brackets > 0) { repaired += "]"; brackets--; }
  while (braces > 0) { repaired += "}"; braces--; }
  return repaired;
}

/**
 * 预处理 MiniMax DeepThink 输出：
 * 移除 <minimax:tool_call> 等 XML 工具调用标签。
 */
function preprocessMinimaxOutput(raw) {
  if (!raw || typeof raw !== "string") return raw;
  let processed = raw;
  processed = processed.replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/g, "");
  processed = processed.replace(/<minimax:tool_result>[\s\S]*?<\/minimax:tool_result>/g, "");
  processed = processed.replace(/<invoke[^>]*>[\s\S]*?<\/invoke>/g, "");
  processed = processed.replace(/<parameter[^>]*>[\s\S]*?<\/parameter>/g, "");
  return processed.trim();
}

/** 从 LLM 输出中提取 JSON（增强容错） */
function extractJson(raw) {
  if (!raw || typeof raw !== "string") {
    console.warn("[extractJson] 输入为空或非字符串");
    return null;
  }

  raw = preprocessMinimaxOutput(raw);

  const candidates = [];

  // 1) 尝试提取 ```json ... ``` 代码块
  const fencedPatterns = [/```json\s*([\s\S]*?)```/, /```\s*([\s\S]*?)```/];
  for (const pattern of fencedPatterns) {
    const match = raw.match(pattern);
    if (match && match[1]) candidates.push(match[1].trim());
  }

  // 2) 找到最外层 { ... }
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
    let braceCount = 0;
    for (let i = firstBrace; i < raw.length; i++) {
      if (raw[i] === "{") braceCount++;
      if (raw[i] === "}") braceCount--;
      if (braceCount === 0) {
        candidates.push(raw.slice(firstBrace, i + 1));
        break;
      }
    }
  }

  candidates.push(raw.trim());

  for (const candidate of candidates) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch {}
    try { return JSON.parse(sanitizeJsonString(candidate)); } catch {}
    try { return JSON.parse(attemptJsonFix(candidate)); } catch {}
    try { return JSON.parse(attemptJsonFix(sanitizeJsonString(candidate))); } catch {}
    try { return JSON.parse(repairTruncatedJson(candidate)); } catch {}
    try { return JSON.parse(repairTruncatedJson(sanitizeJsonString(candidate))); } catch {}
    try { return JSON.parse(repairTruncatedJson(attemptJsonFix(candidate))); } catch {}
  }

  console.error("[extractJson] 解析失败。原始输出前 500 字:", raw.slice(0, 500));
  return null;
}

/** 从 LLM 输出中提取 JSON 数组 */
function extractJsonArray(raw) {
  if (!raw || typeof raw !== "string") return null;

  raw = preprocessMinimaxOutput(raw);

  const candidates = [];

  const fencedPatterns = [/```json\s*([\s\S]*?)```/, /```\s*([\s\S]*?)```/];
  for (const pattern of fencedPatterns) {
    const match = raw.match(pattern);
    if (match && match[1]) candidates.push(match[1].trim());
  }

  // 处理未闭合的 fenced code block（LLM 输出被截断时常见）
  if (candidates.length === 0) {
    const openFence = raw.match(/```json\s*([\s\S]*)$/);
    if (openFence && openFence[1]) candidates.push(openFence[1].trim());
  }

  const firstBracket = raw.indexOf("[");
  if (firstBracket !== -1) {
    let bracketCount = 0;
    let endIdx = -1;
    for (let i = firstBracket; i < raw.length; i++) {
      if (raw[i] === "[") bracketCount++;
      else if (raw[i] === "]") bracketCount--;
      if (bracketCount === 0) { endIdx = i; break; }
    }
    candidates.push(endIdx !== -1
      ? raw.slice(firstBracket, endIdx + 1)
      : raw.slice(firstBracket));
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch {}
    try { return JSON.parse(sanitizeJsonString(candidate)); } catch {}
    try { return JSON.parse(attemptJsonFix(candidate)); } catch {}
    try { return JSON.parse(attemptJsonFix(sanitizeJsonString(candidate))); } catch {}
    try { return JSON.parse(repairTruncatedJson(candidate)); } catch {}
    try { return JSON.parse(repairTruncatedJson(sanitizeJsonString(candidate))); } catch {}
    try { return JSON.parse(repairTruncatedJson(attemptJsonFix(candidate))); } catch {}
  }

  console.error("[extractJsonArray] 解析失败，原始输出前500字:", raw.slice(0, 500));
  return null;
}

/**
 * Coerce every element of `arr` to a string.
 * LLM sometimes returns objects where strings are expected;
 * this prevents React error #31 ("Objects are not valid as a React child").
 */
function ensureStringArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(item => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      if (typeof item.description === 'string') return item.description;
      const firstStr = Object.values(item).find(v => typeof v === 'string');
      if (firstStr) return firstStr;
      return JSON.stringify(item);
    }
    return String(item ?? '');
  });
}

/**
 * 从截断的 LLM JSON 输出中定向提取指定 key 的子对象。
 * 典型场景：LLM 输出了完整的 validated_data 但 dimension_analysis 被截断，
 * 导致整体 JSON 不合法。此函数可以从残缺 JSON 中抢救已完成的子对象。
 *
 * @param {string} raw - LLM 原始输出
 * @param {string} key - 要提取的 JSON key（如 "validated_data"）
 * @returns {object|null} 提取到的子对象，或 null
 */
function extractNestedJson(raw, key) {
  if (!raw || typeof raw !== "string" || !key) return null;

  raw = preprocessMinimaxOutput(raw);

  // 在原始文本中定位 "key": { 或 "key":{ 的位置
  const pattern = new RegExp(`"${key}"\\s*:\\s*\\{`);
  const match = raw.match(pattern);
  if (!match) return null;

  const startIdx = raw.indexOf("{", match.index + match[0].length - 1);
  if (startIdx === -1) return null;

  // 从起始 { 开始，追踪括号平衡找到闭合 }
  let braceCount = 0;
  let inStr = false;
  let esc = false;
  let endIdx = -1;

  for (let i = startIdx; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") braceCount++;
    else if (ch === "}") braceCount--;
    if (braceCount === 0) { endIdx = i; break; }
  }

  if (endIdx === -1) {
    // 括号未闭合 — 尝试修复截断
    const fragment = raw.slice(startIdx);
    const repaired = repairTruncatedJson(sanitizeJsonString(fragment));
    try { return JSON.parse(repaired); } catch {}
    return null;
  }

  const candidate = raw.slice(startIdx, endIdx + 1);
  try { return JSON.parse(candidate); } catch {}
  try { return JSON.parse(sanitizeJsonString(candidate)); } catch {}
  try { return JSON.parse(attemptJsonFix(candidate)); } catch {}
  return null;
}

/**
 * 从截断/残缺的 LLM 结构化评分输出中抢救尽可能多的数据。
 * 当 extractJson 整体解析失败时使用，逐段提取各个子对象。
 *
 * @param {string} raw - LLM 原始输出
 * @returns {object|null} 重组的结果对象（至少含 validated_data 才算成功）
 */
function extractPartialResult(raw) {
  if (!raw || typeof raw !== "string") return null;

  // 核心：提取 validated_data（评分必需）
  const validatedData = extractNestedJson(raw, "validated_data");
  if (!validatedData) return null; // validated_data 都没有就无法抢救

  // 尽力提取其他字段
  const dimensionAnalysis = extractNestedJson(raw, "dimension_analysis");
  const valuationComparison = extractNestedJson(raw, "valuation_comparison");

  // 提取简单字符串字段
  let oneLine = null;
  const summaryMatch = raw.match(/"one_line_summary"\s*:\s*"([^"]*?)"/);
  if (summaryMatch) oneLine = summaryMatch[1];

  // 提取数组字段
  const extractArray = (key) => {
    const arrMatch = raw.match(new RegExp(`"${key}"\\s*:\\s*\\[`));
    if (!arrMatch) return [];
    const arrStart = raw.indexOf("[", arrMatch.index);
    if (arrStart === -1) return [];
    let bracketCount = 0;
    for (let i = arrStart; i < raw.length; i++) {
      if (raw[i] === "[") bracketCount++;
      else if (raw[i] === "]") bracketCount--;
      if (bracketCount === 0) {
        try { return JSON.parse(raw.slice(arrStart, i + 1)); } catch {}
        break;
      }
    }
    return [];
  };

  const result = {
    one_line_summary: oneLine || "",
    validated_data: validatedData,
    dimension_analysis: dimensionAnalysis || {},
    risk_flags: extractArray("risk_flags"),
    strengths: extractArray("strengths"),
    conflicts: extractArray("conflicts"),
  };
  if (valuationComparison) result.valuation_comparison = valuationComparison;

  console.warn("[extractPartialResult] 从截断输出中抢救成功，已提取 validated_data" +
    (dimensionAnalysis ? " + dimension_analysis" : "") +
    (valuationComparison ? " + valuation_comparison" : ""));

  return result;
}

module.exports = {
  sanitizeJsonString,
  attemptJsonFix,
  repairTruncatedJson,
  preprocessMinimaxOutput,
  extractJson,
  extractJsonArray,
  extractNestedJson,
  extractPartialResult,
  ensureStringArray,
};
