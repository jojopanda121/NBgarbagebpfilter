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
  constructor(message, status, body) {
    super(message);
    this.name = "LLMAPIError";
    this.status = status;
    this.body = body;
  }
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
  throw new LLMAPIError(`${label} API 失败 (${resp.status}): ${msg}`, resp.status, text);
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
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify(buildLLMBody(body, caps)),
    });
    if (!resp.ok) await parseError(resp, label);
    return toAnthropicLikeResponse(await resp.json());
  }

  function stream(body) {
    const abortController = new AbortController();
    const iterator = streamIterator(
      endpoint,
      baseHeaders,
      buildLLMBody({ ...body, stream: true }, caps),
      abortController,
      label
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

async function* streamIterator(endpoint, headers, body, abortController, label) {
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { ...headers, Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal: abortController.signal,
  });
  if (!resp.ok) await parseError(resp, label);

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
  createOpenAICompatibleClient,
  buildLLMBody,
  normalizeMessages,
  normalizeTools,
  normalizeThinking,
  toAnthropicLikeResponse,
  finishReasonToStopReason,
};
