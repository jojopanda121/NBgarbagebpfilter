// ============================================================
// server/services/llm/providers/openaiCompatible.js
//
// OpenAI 兼容协议的通用客户端（DeepSeek / MiniMax / OpenAI / Gemini 兼容端点 /
// Kimi / 通义 / 智谱 都走这里）。
//
// 全代码库以 "Anthropic 风格" 调用（system / content blocks / thinking /
// tool_use），本模块负责双向翻译成 /v1/chat/completions，再把响应翻回
// Anthropic 形状。原 server/utils/llmClient.js 的实现整体迁入，
// 并增加一层**按能力裁剪**：能力矩阵说不支持的字段一律不发送，
// 而不是发出去等 400（见 ./capabilities.js 的说明）。
// ============================================================

const { FALLBACK } = require("../capabilities");
const { quirkKey, applyQuirks, adaptRequest } = require("../quirks");

// 事后适配的最多轮数。每一轮 = 一次被拒的请求 + 一次改写后的重试。
// 3 轮足够连着抹平"思考字段 + JSON 模式 + 输出上限"这类叠加问题，
// 又不至于在真正没救的错误上反复烧钱。
const MAX_ADAPT_ROUNDS = 3;

// 兼容老调用点：不传 caps 时按 DeepSeek V4 的能力放行全部字段，
// 行为与迁移前的 llmClient 完全一致。
const LEGACY_CAPS = {
  ...FALLBACK,
  maxOutputTokens: Infinity,
  contextWindow: Infinity,
  thinkingStyle: "deepseek",
  supportsReasoningEffort: true,
  supportsJsonMode: true,
  tokenParam: "max_tokens",
};

class LLMAPIError extends Error {
  constructor(message, status, body, retryAfterMs) {
    super(message);
    this.name = "LLMAPIError";
    this.status = status;
    this.body = body;
    // 上游明确告知的退避时长（Retry-After）。重试层优先听它的，
    // 而不是自己拍脑袋的指数退避——被限流时抢跑只会让限流更久。
    if (retryAfterMs) this.retryAfterMs = retryAfterMs;
  }
}

// ── HTTP 200 里的业务错误 ───────────────────────────────────
// MiniMax（以及部分国产厂商）不用 HTTP 状态码表达失败：限流、额度耗尽、
// 参数非法一律是 **HTTP 200 + base_resp.status_code**，choices 为 null。
// 只判 resp.ok 的话，这些错误会被翻译成"一次成功的空回答"，
// 上层拿到空字符串 → JSON 解析失败 → 报成"解析错误"，真正的原因
// （比如"Token Plan 用量已耗尽"）永远不会出现在日志和界面上。
//
// 上层的重试/文案判定（llmService 的 isRetryable / normalizeLLMError）只认
// HTTP 状态，所以这里必须把业务码翻译成等价状态码。
const BIZ_STATUS_TO_HTTP = {
  1000: 500, // 未知错误
  1001: 504, // 超时
  1002: 429, // 触发限流（RPM）
  1004: 401, // 鉴权失败
  1008: 402, // 余额不足
  1013: 500, // 服务内部错误
  1026: 400, // 输入内容不合规
  1027: 400, // 输出内容不合规
  1039: 429, // 触发限流（TPM）
  1042: 400, // 非法字符占比过高
  2013: 400, // 参数非法
  2049: 401, // API Key 非法
  2056: 402, // 订阅套餐用量已达上限
};

/**
 * 校验 HTTP 200 响应体里的业务状态，失败则抛出带等价 HTTP 状态的 LLMAPIError。
 * 未知业务码按 500（可重试）处理：宁可多试一次，也不要把上游的临时故障
 * 当成永久失败直接判死。
 */
function assertBusinessOk(data, label = "LLM") {
  const biz = data && data.base_resp;
  const code = biz ? Number(biz.status_code) : 0;
  if (biz && Number.isFinite(code) && code !== 0) {
    const status = BIZ_STATUS_TO_HTTP[code] || 500;
    throw new LLMAPIError(
      `${label} API 失败 (HTTP 200 业务码 ${code}，按 HTTP ${status} 处理): ${biz.status_msg || "未知错误"}`,
      status,
      JSON.stringify(biz)
    );
  }
  // 另一种写法：HTTP 200 + { error: {...} } 且没有 choices
  if (data && data.error && !Array.isArray(data.choices)) {
    const status = Number(data.error.status) || Number(data.error.code) || 500;
    throw new LLMAPIError(
      `${label} API 失败 (HTTP 200 error 字段): ${data.error.message || JSON.stringify(data.error)}`,
      status,
      JSON.stringify(data.error)
    );
  }
  // 兜底：OpenAI 兼容协议里 choices 是必有字段。没有它却又没报错，
  // 说明上游返回了我们不认识的形状，同样不能当成"空回答"放过去。
  if (!data || !Array.isArray(data.choices) || data.choices.length === 0) {
    throw new LLMAPIError(
      `${label} API 返回体缺少 choices（上游未给出任何回答）`,
      502,
      JSON.stringify(data || null).slice(0, 500)
    );
  }
}

/** Retry-After: 秒数或 HTTP 日期，都换算成毫秒；解析不出来返回 0 */
function parseRetryAfter(headers) {
  const raw = headers && typeof headers.get === "function" ? headers.get("retry-after") : null;
  if (!raw) return 0;
  const secs = Number(String(raw).trim());
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 120000);
  const at = Date.parse(String(raw));
  if (Number.isFinite(at)) return Math.max(0, Math.min(at - Date.now(), 120000));
  return 0;
}

function textFromBlocks(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && (b.type === "text" || typeof b.text === "string"))
    .map((b) => b.text || "")
    .join("");
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return {};
  }
}

function splitInlineThinking(content) {
  const text = String(content || "");
  let thinking = "";
  const cleaned = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, inner) => {
    thinking += inner || "";
    return "";
  }).trim();
  return { thinking, text: cleaned };
}

function normalizeMessages(messages = []) {
  const out = [];
  for (const msg of messages || []) {
    if (!msg) continue;
    const role = msg.role;
    const content = msg.content;

    if (role === "assistant" && Array.isArray(content)) {
      const thinking = content.filter((b) => b.type === "thinking").map((b) => b.thinking || "").join("");
      const text = content.filter((b) => b.type === "text").map((b) => b.text || "").join("");
      const toolCalls = content.filter((b) => b.type === "tool_use").map((b, idx) => ({
        id: b.id || `tool-${Date.now()}-${idx}`,
        type: "function",
        function: {
          name: b.name,
          arguments: JSON.stringify(b.input || {}),
        },
      }));
      const converted = { role: "assistant", content: text || null };
      if (thinking) converted.reasoning_content = thinking;
      if (toolCalls.length) converted.tool_calls = toolCalls;
      out.push(converted);
      continue;
    }

    if (Array.isArray(content) && content.some((b) => b.type === "tool_result")) {
      for (const b of content) {
        if (b.type !== "tool_result") continue;
        out.push({
          role: "tool",
          tool_call_id: b.tool_use_id,
          content: typeof b.content === "string" ? b.content : JSON.stringify(b.content || {}),
        });
      }
      const rest = content.filter((b) => b.type !== "tool_result");
      if (rest.length) out.push({ role: role || "user", content: textFromBlocks(rest) });
      continue;
    }

    out.push({
      role: role || "user",
      content: textFromBlocks(content),
    });
  }
  return out;
}

function normalizeTools(tools = []) {
  return (tools || []).map((tool) => {
    if (!tool) return null;
    if (tool.type === "function" && tool.function) return tool;
    if (tool.type === "builtin_function") return tool;
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description || "",
        parameters: tool.input_schema || tool.parameters || { type: "object", properties: {} },
      },
    };
  }).filter(Boolean);
}

function finishReasonToStopReason(reason) {
  if (reason === "tool_calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  return "end_turn";
}

function toAnthropicLikeResponse(data) {
  const choice = data?.choices?.[0] || {};
  const message = choice.message || {};
  const content = [];
  const inline = splitInlineThinking(message.content || "");
  const reasoning = message.reasoning_content || inline.thinking;
  if (reasoning) {
    content.push({ type: "thinking", thinking: reasoning });
  }
  if (inline.text) {
    content.push({ type: "text", text: inline.text });
  }
  for (const call of message.tool_calls || []) {
    content.push({
      type: "tool_use",
      id: call.id,
      name: call.function?.name || call.name,
      input: parseJsonObject(call.function?.arguments),
    });
  }
  return {
    id: data?.id,
    content,
    stop_reason: finishReasonToStopReason(choice.finish_reason),
    usage: data?.usage ? {
      input_tokens: data.usage.prompt_tokens || 0,
      output_tokens: data.usage.completion_tokens || 0,
    } : undefined,
    raw: data,
  };
}

// Anthropic 的 thinking:{type:"enabled", budget_tokens:N} → {type:"enabled"}。
// budget_tokens 不是 OpenAI 兼容协议的参数，带上多数厂商会 400。
function normalizeThinking(thinking) {
  if (thinking === undefined || thinking === null) return undefined;
  if (typeof thinking === "boolean") return { type: thinking ? "enabled" : "disabled" };
  if (typeof thinking !== "object") return undefined;
  const type = thinking.type === "disabled" ? "disabled" : "enabled";
  return { type };
}

/** 调用方是否想开思考（三态：true/false/undefined=未声明） */
function _wantsThinking(thinking) {
  if (thinking === undefined || thinking === null) return undefined;
  if (typeof thinking === "boolean") return thinking;
  if (typeof thinking === "object") return thinking.type !== "disabled";
  return undefined;
}

// 按 thinkingStyle 把"开/关思考"翻译成各家自己的字段。
// 不支持（none）或不可关（always）时一律不发字段——发了就是 400。
function applyThinking(target, wants, caps) {
  if (wants === undefined) return;
  switch (caps.thinkingStyle) {
    case "deepseek":
    case "zhipu":
      target.thinking = { type: wants ? "enabled" : "disabled" };
      break;
    case "qwen":
      target.enable_thinking = !!wants;
      break;
    case "minimax":
      // MiniMax 只认 adaptive / disabled。发 "enabled" 会被 2013 拒绝
      // （invalid thinking.type），而且是 HTTP 200 的业务错误——
      // 不翻译的话每一次开思考的调用都在空转。
      target.thinking = { type: wants ? "adaptive" : "disabled" };
      break;
    case "effort":
      // 没有独立开关，思考深浅完全由 reasoning_effort 表达
      if (!wants) target.reasoning_effort = "none";
      break;
    case "anthropic":
      // OpenAI 兼容端点上不会出现 anthropic 风格，保险起见按 deepseek 形状发
      target.thinking = { type: wants ? "enabled" : "disabled" };
      break;
    case "always":
    case "none":
    default:
      break; // 不发送任何思考字段
  }
}

/**
 * Anthropic 风格 body → OpenAI 兼容 body，按 caps 裁剪。
 * @param {object} body
 * @param {object} [caps] 不传 = 老行为（全部字段放行）
 */
function buildLLMBody(body, caps = LEGACY_CAPS) {
  const c = { ...LEGACY_CAPS, ...(caps || {}) };
  const tokenParam = c.tokenParam || "max_tokens";

  const llmBody = {
    model: body.model,
    messages: normalizeMessages([
      ...(body.system ? [{ role: "system", content: body.system }] : []),
      ...(body.messages || []),
    ]),
  };

  // 输出上限按能力硬裁。这是最关键的一条：流水线按 DeepSeek 的 64K 预算写死了
  // 一些 max_tokens，直接打到 8K 上限的模型上会每次调用都 400。
  const requested = Number(body.max_tokens) || 0;
  if (requested > 0) {
    llmBody[tokenParam] = Math.min(requested, c.maxOutputTokens);
  }

  if (c.supportsTools) {
    const tools = normalizeTools(body.tools);
    if (tools.length) llmBody.tools = tools;
    if (body.tool_choice) llmBody.tool_choice = body.tool_choice;
  }
  if (body.stream && c.supportsStreaming) llmBody.stream = true;

  applyThinking(llmBody, _wantsThinking(body.thinking), c);

  // 推理档位：只有声明支持的模型才发（gpt-4o 之类收到会 400）
  if (body.reasoning_effort && c.supportsReasoningEffort) {
    llmBody.reasoning_effort = body.reasoning_effort;
  }
  // 采样参数：o 系推理模型不接受 temperature ≠ 1
  if (body.temperature !== undefined && c.supportsTemperature) llmBody.temperature = body.temperature;
  if (body.top_p !== undefined && c.supportsTemperature) llmBody.top_p = body.top_p;
  if (body.stop) llmBody.stop = body.stop;
  if (body.response_format && c.supportsJsonMode) llmBody.response_format = body.response_format;
  return llmBody;
}

async function parseError(resp, label = "LLM") {
  const text = await resp.text().catch(() => "");
  let msg = text || resp.statusText || "API request failed";
  try {
    const json = JSON.parse(text);
    msg = json?.error?.message || json?.message || msg;
  } catch (_) { /* ignore */ }
  throw new LLMAPIError(
    `${label} API 失败 (${resp.status}): ${msg}`,
    resp.status,
    text,
    parseRetryAfter(resp.headers)
  );
}

/**
 * @param {object} args
 * @param {string} args.apiKey
 * @param {string} args.endpoint  完整的 chat/completions URL
 * @param {object} [args.caps]
 * @param {string} [args.label]   报错文案里的厂商名
 * @param {object} [args.headers] 额外请求头
 */
function createOpenAICompatibleClient({ apiKey, endpoint, caps, label = "LLM", headers = {} }) {
  const baseHeaders = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...headers,
  };

  async function create(body) {
    // 换任何模型都要能跑完：事前按能力矩阵裁剪，事后按上游的拒绝理由学习改写
    // （见 ../quirks.js）。用户填了我们没见过的模型/网关时，最多多花一次
    // 被拒的请求，而不是让整份分析失败。
    const key = quirkKey(endpoint, body.model);
    let llmBody = applyQuirks(key, buildLLMBody(body, caps));

    for (let round = 0; ; round++) {
      let data;
      try {
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: baseHeaders,
          body: JSON.stringify(llmBody),
        });
        if (!resp.ok) await parseError(resp, label);
        data = await resp.json();
        assertBusinessOk(data, label); // HTTP 200 不等于成功，见 assertBusinessOk
      } catch (err) {
        const adapted = round < MAX_ADAPT_ROUNDS ? adaptRequest(key, err, llmBody) : null;
        if (!adapted) throw err;
        console.warn(`[LLM/${label}] 请求被拒(${err.status})，自动适配后重试：${adapted.note}`);
        llmBody = adapted.body;
        continue;
      }
      return toAnthropicLikeResponse(data);
    }
  }

  function stream(body) {
    const abortController = new AbortController();
    const key = quirkKey(endpoint, body.model);
    const iterator = streamIterator(
      endpoint,
      baseHeaders,
      applyQuirks(key, buildLLMBody({ ...body, stream: true }, caps)),
      abortController,
      label,
      key
    );
    return {
      controller: abortController,
      [Symbol.asyncIterator]() {
        return iterator;
      },
    };
  }

  return { messages: { create, stream } };
}

async function* streamIterator(endpoint, headers, body, abortController, label, key) {
  // 流式同样要能自适应：建流阶段被拒时按拒绝理由改写请求体再建一次，
  // 否则用户换个不认某字段的模型，对话框就是一片空白。
  let llmBody = body;
  let resp;
  for (let round = 0; ; round++) {
    try {
      resp = await fetch(endpoint, {
        method: "POST",
        headers: { ...headers, Accept: "text/event-stream" },
        body: JSON.stringify(llmBody),
        signal: abortController.signal,
      });
      if (!resp.ok) await parseError(resp, label);
      break;
    } catch (err) {
      const adapted = key && round < MAX_ADAPT_ROUNDS ? adaptRequest(key, err, llmBody) : null;
      if (!adapted) throw err;
      console.warn(`[LLM/${label}] 流式请求被拒(${err.status})，自动适配后重试：${adapted.note}`);
      llmBody = { ...adapted.body, stream: true };
    }
  }
  // 上游把错误当普通 JSON（HTTP 200）返回时，body 不是 SSE：
  // 不在这里拦下来，用户看到的就是"流里一个字都没有"的静默失败。
  // 只在 content-type 明确是 JSON 时读取，避免误吞没有正确标注类型的真 SSE 流。
  if (/application\/json/i.test(String(resp.headers.get("content-type") || ""))) {
    const text = await resp.text().catch(() => "");
    let data = null;
    try { data = JSON.parse(text); } catch (_) { /* ignore */ }
    if (data) assertBusinessOk(data, label);
    throw new LLMAPIError(`${label} API 流式响应异常（非 SSE 响应体）`, 502, text.slice(0, 500));
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let textStarted = false;
  let thinkingStarted = false;
  let nextBlockIndex = 0;
  let textIndex = null;
  let thinkingIndex = null;
  const toolIndexes = new Map();

  const ensureThinking = function* () {
    if (thinkingStarted) return;
    thinkingStarted = true;
    thinkingIndex = nextBlockIndex++;
    yield { type: "content_block_start", index: thinkingIndex, content_block: { type: "thinking" } };
  };
  const ensureText = function* () {
    if (textStarted) return;
    textStarted = true;
    textIndex = nextBlockIndex++;
    yield { type: "content_block_start", index: textIndex, content_block: { type: "text" } };
  };
  const ensureTool = function* (toolDelta) {
    const key = String(toolDelta.index ?? toolIndexes.size);
    if (toolIndexes.has(key)) return;
    const idx = nextBlockIndex++;
    toolIndexes.set(key, idx);
    yield {
      type: "content_block_start",
      index: idx,
      content_block: {
        type: "tool_use",
        id: toolDelta.id,
        name: toolDelta.function?.name,
      },
    };
  };

  async function* processLine(line) {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch (_) {
      return;
    }
    // 业务错误也可能出现在流的某个分片里（正常结束时 status_code 为 0）
    if (chunk.base_resp && Number(chunk.base_resp.status_code)) {
      assertBusinessOk(chunk, label);
    }
    const choice = chunk.choices?.[0] || {};
    const delta = choice.delta || {};

    const reasoning = delta.reasoning_content || delta.reasoning || "";
    if (reasoning) {
      yield* ensureThinking();
      yield { type: "content_block_delta", index: thinkingIndex, delta: { type: "thinking_delta", thinking: reasoning } };
    }

    if (delta.content) {
      yield* ensureText();
      yield { type: "content_block_delta", index: textIndex, delta: { type: "text_delta", text: delta.content } };
    }

    for (const tc of delta.tool_calls || []) {
      yield* ensureTool(tc);
      const key = String(tc.index ?? 0);
      const idx = toolIndexes.get(key);
      if (tc.id || tc.function?.name) {
        yield {
          type: "content_block_delta",
          index: idx,
          delta: { type: "input_json_delta", partial_json: "" },
        };
      }
      if (tc.function?.arguments) {
        yield {
          type: "content_block_delta",
          index: idx,
          delta: { type: "input_json_delta", partial_json: tc.function.arguments },
        };
      }
    }

    if (choice.finish_reason) {
      if (thinkingStarted) yield { type: "content_block_stop", index: thinkingIndex };
      if (textStarted) yield { type: "content_block_stop", index: textIndex };
      for (const idx of toolIndexes.values()) yield { type: "content_block_stop", index: idx };
      yield {
        type: "message_delta",
        delta: { stop_reason: finishReasonToStopReason(choice.finish_reason) },
      };
    }
  }

  for await (const chunk of resp.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      yield* processLine(line.trim());
    }
  }
  if (buffer.trim()) {
    yield* processLine(buffer.trim());
  }
}

module.exports = {
  LLMAPIError,
  LEGACY_CAPS,
  assertBusinessOk,
  parseRetryAfter,
  BIZ_STATUS_TO_HTTP,
  createOpenAICompatibleClient,
  buildLLMBody,
  normalizeMessages,
  normalizeTools,
  normalizeThinking,
  toAnthropicLikeResponse,
  finishReasonToStopReason,
};
