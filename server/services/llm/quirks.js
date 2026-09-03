// ============================================================
// server/services/llm/quirks.js — 运行时"脾气"学习：让换任何模型都能跑完
//
// capabilities.js 是**事前**裁剪：我们知道的差异，请求发出前就抹平。
// 但用户可以填任意厂商的任意模型名（还有自建网关、代理、私有部署），
// 总有我们没见过的组合：不认 thinking、不认 response_format、
// max_tokens 上限比我们以为的低、必须用 max_completion_tokens、
// 甚至不接受 system 角色。事前表覆盖不到这些。
//
// 所以这里做**事后学习**：一次调用被上游以"参数不对"为由拒绝时，
// 从报错里认出是哪个字段的问题 → 去掉/改写这个字段 → 立刻重试，
// 并把这条"脾气"记在 (端点, 模型) 名下，之后的调用直接按学到的形状发。
//
// 代价上限是每个模型每种毛病一次失败请求；收益是用户换任何 API
// 都不会看到"分析失败"，最差也只是少用一点能力（如没有思考、没有 JSON 模式）。
//
// 只对"参数类"错误（HTTP 400/422 以及等价的业务码）动手。限流、余额、
// 鉴权、5xx 不是靠改请求体能解决的，一律原样抛给上层的重试/降级逻辑。
// ============================================================

const MIN_TOKENS_FLOOR = 1024;   // 再减半也不能低于这个数，否则正文写不完
const _quirks = new Map();       // key -> 学到的脾气
const QUIRK_CACHE_MAX = 256;

function quirkKey(endpoint, model) {
  return `${endpoint}|${model || ""}`;
}

function _record(key) {
  let q = _quirks.get(key);
  if (!q) {
    q = { drop: new Set(), thinkingValue: null, maxOutputTokens: null, tokenParam: null, mergeSystem: false, minimal: false };
    _quirks.set(key, q);
    while (_quirks.size > QUIRK_CACHE_MAX) _quirks.delete(_quirks.keys().next().value);
  }
  return q;
}

/** 把 system 消息并进第一条 user（有些端点不接受 system 角色） */
function mergeSystemIntoUser(messages = []) {
  const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  if (!sys) return rest;
  const firstUser = rest.findIndex((m) => m.role === "user");
  if (firstUser === -1) return [{ role: "user", content: sys }, ...rest];
  const merged = [...rest];
  merged[firstUser] = { ...merged[firstUser], content: `${sys}\n\n${merged[firstUser].content || ""}` };
  return merged;
}

/** 按已学到的脾气改写请求体（每次调用前都过一遍，避免重复踩同一个坑） */
function applyQuirks(key, body) {
  const q = _quirks.get(key);
  if (!q) return body;
  const out = { ...body };

  if (q.minimal) {
    // 最后的兜底形状：只留最小必要字段。能出字就行，能力全部让位于"能跑完"。
    const tokenParam = q.tokenParam || "max_tokens";
    const minimal = { model: out.model, messages: out.messages };
    const budget = out.max_tokens || out.max_completion_tokens;
    if (budget) minimal[tokenParam] = q.maxOutputTokens ? Math.min(budget, q.maxOutputTokens) : budget;
    if (out.stream) minimal.stream = true;
    if (q.mergeSystem) minimal.messages = mergeSystemIntoUser(minimal.messages);
    return minimal;
  }

  for (const field of q.drop) delete out[field];
  if (q.thinkingValue && out.thinking) out.thinking = { type: q.thinkingValue };
  if (q.tokenParam && q.tokenParam !== "max_tokens" && out.max_tokens !== undefined) {
    out[q.tokenParam] = out.max_tokens;
    delete out.max_tokens;
  }
  if (q.maxOutputTokens) {
    for (const p of ["max_tokens", "max_completion_tokens"]) {
      if (out[p] !== undefined) out[p] = Math.min(out[p], q.maxOutputTokens);
    }
  }
  if (q.mergeSystem) out.messages = mergeSystemIntoUser(out.messages);
  return out;
}

/** 这个错误是不是"改请求体就有救"的那一类 */
function isAdaptable(err) {
  const status = err?.status;
  if (status !== 400 && status !== 422) return false;
  return true;
}

/**
 * 认出这次是哪个字段的问题，改写请求体并记住。
 * @returns {{body: object, note: string}|null} null = 没招了，原样抛出去
 */
function adaptRequest(key, err, body) {
  if (!isAdaptable(err)) return null;
  const msg = String(err?.message || "") + " " + String(err?.body || "");
  const q = _record(key);
  const has = (re) => re.test(msg);

  // 1) thinking：先试报错里给出的合法取值（MiniMax 会明说 allowed: adaptive, disabled），
  //    没有就整个字段丢掉，让模型用自己的默认。
  if (body.thinking !== undefined && has(/think/i)) {
    const allowed = msg.match(/allowed:\s*([a-zA-Z0-9_,\s"']+)\)/);
    const first = allowed
      ? allowed[1].split(",").map((v) => v.replace(/["'\s]/g, "")).filter((v) => v && v !== "disabled")[0]
      : null;
    if (first && q.thinkingValue !== first) {
      q.thinkingValue = first;
      return { body: { ...body, thinking: { type: first } }, note: `thinking.type → "${first}"` };
    }
    q.drop.add("thinking");
    const next = { ...body };
    delete next.thinking;
    return { body: next, note: "去掉 thinking 字段（该模型不认思考开关）" };
  }

  // 2) enable_thinking / reasoning_effort / response_format / temperature / top_p：
  //    都是"锦上添花"的字段，谁被点名就丢谁。
  for (const [field, re] of [
    ["enable_thinking", /enable_thinking/i],
    ["reasoning_effort", /reasoning_effort|reasoning\.effort/i],
    ["response_format", /response_format|json_object|json_schema/i],
    ["temperature", /temperature/i],
    ["top_p", /top_p/i],
    ["stop", /\bstop\b/i],
  ]) {
    if (body[field] !== undefined && has(re) && !q.drop.has(field)) {
      q.drop.add(field);
      const next = { ...body };
      delete next[field];
      return { body: next, note: `去掉 ${field} 字段（该模型不支持）` };
    }
  }

  // 3) 工具调用不支持 → 去掉 tools，让上层退回纯文本回答
  if (body.tools && has(/tool|function[_ ]?call/i) && !q.drop.has("tools")) {
    q.drop.add("tools");
    q.drop.add("tool_choice");
    const next = { ...body };
    delete next.tools;
    delete next.tool_choice;
    return { body: next, note: "去掉 tools（该模型不支持工具调用）" };
  }

  // 4) token 字段名不对（OpenAI o 系 / gpt-5 只认 max_completion_tokens）
  if (has(/max_completion_tokens/i) && body.max_tokens !== undefined) {
    q.tokenParam = "max_completion_tokens";
    const next = { ...body, max_completion_tokens: body.max_tokens };
    delete next.max_tokens;
    return { body: next, note: "max_tokens → max_completion_tokens" };
  }

  // 5) 输出预算超上限 / 上下文放不下 → 贴报错里给的上限，没有就减半
  const budgetField = body.max_tokens !== undefined ? "max_tokens"
    : body.max_completion_tokens !== undefined ? "max_completion_tokens" : null;
  if (budgetField && has(/max[_ ]?tokens|context|too (long|large)|exceed|上限|超出|length/i)) {
    const stated = msg.match(/(\d{3,7})/g);
    const current = body[budgetField];
    let next = Math.floor(current / 2);
    if (stated) {
      // 取报错里比当前预算小的最大数字，多半就是模型的真实上限
      const cands = stated.map(Number).filter((n) => n >= MIN_TOKENS_FLOOR && n < current);
      if (cands.length) next = Math.max(...cands);
    }
    next = Math.max(next, MIN_TOKENS_FLOOR);
    if (next < current) {
      q.maxOutputTokens = q.maxOutputTokens ? Math.min(q.maxOutputTokens, next) : next;
      return { body: { ...body, [budgetField]: next }, note: `${budgetField} ${current} → ${next}` };
    }
  }

  // 6) 不接受 system 角色
  if (!q.mergeSystem && has(/system/i) && (body.messages || []).some((m) => m.role === "system")) {
    q.mergeSystem = true;
    return { body: { ...body, messages: mergeSystemIntoUser(body.messages) }, note: "system 消息并入 user（该端点不接受 system 角色）" };
  }

  // 7) 认不出来的参数错 → 最后一搏：退到最小请求体（只有 model/messages/预算）。
  //    宁可少用能力，也不要让用户拿到一份"分析失败"。
  if (!q.minimal) {
    q.minimal = true;
    return { body: applyQuirks(key, body), note: "退回最小请求体重试（只保留 model/messages/max_tokens）" };
  }

  return null;
}

/** 可观测：这个进程到目前为止学到了哪些模型的哪些脾气 */
function describeQuirks() {
  return [..._quirks.entries()].map(([key, q]) => ({
    target: key,
    dropped: [...q.drop],
    thinking_value: q.thinkingValue,
    max_output_tokens: q.maxOutputTokens,
    token_param: q.tokenParam,
    merge_system: q.mergeSystem,
    minimal: q.minimal,
  }));
}

/** 测试用：清空学习结果 */
function _resetQuirks() { _quirks.clear(); }

module.exports = { quirkKey, applyQuirks, adaptRequest, describeQuirks, mergeSystemIntoUser, _resetQuirks };
