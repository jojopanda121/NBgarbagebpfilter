// ============================================================
// server/utils/jsonParser.js — JSON 提取与修复工具
// 从原 server/index.js 中提取，支持 7 级容错解析
// ============================================================

/** 清理 LLM 输出中的非标准 JSON */
function sanitizeJsonString(str) {
  str = str.replace(/\/\/[^\n]*/g, "");
  str = str.replace(/\/\*[\s\S]*?\*\//g, "");
  str = str.replace(/,\s*([\]}])/g, "$1");
  return str.trim();
}

/** 尝试修复常见的 JSON 格式问题 */
function attemptJsonFix(str) {
  if (!str) return str;
  let fixed = str;
  fixed = fixed.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\uFEFF]/g, "");
  fixed = fixed.replace(/,(\s*[}\]])/g, "$1");
  fixed = fixed.replace(/\/\/.*$/gm, "");
  fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, "");
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

  const fencedPatterns = [/```json\s*([\s\S]*?)```/, /```\s*([\s\S]*?)```/];
  for (const pattern of fencedPatterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim();
      try { return JSON.parse(candidate); } catch {}
      try { return JSON.parse(sanitizeJsonString(candidate)); } catch {}
      try { return JSON.parse(attemptJsonFix(candidate)); } catch {}
    }
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
    const fullCandidate = endIdx !== -1
      ? raw.slice(firstBracket, endIdx + 1)
      : raw.slice(firstBracket);
    try { return JSON.parse(fullCandidate); } catch {}
    try { return JSON.parse(sanitizeJsonString(fullCandidate)); } catch {}
    try { return JSON.parse(attemptJsonFix(fullCandidate)); } catch {}
    try { return JSON.parse(repairTruncatedJson(fullCandidate)); } catch {}
    try { return JSON.parse(repairTruncatedJson(sanitizeJsonString(fullCandidate))); } catch {}
  }

  console.error("[extractJsonArray] 解析失败，原始输出前500字:", raw.slice(0, 500));
  return null;
}

module.exports = {
  sanitizeJsonString,
  attemptJsonFix,
  repairTruncatedJson,
  preprocessMinimaxOutput,
  extractJson,
  extractJsonArray,
};
