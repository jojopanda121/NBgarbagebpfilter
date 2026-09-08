// ============================================================
// server/services/llm/providers/anthropic.js — Claude 原生协议
//
// 本仓库全部调用点本来就是 Anthropic 形状（system 顶层参数 / content blocks /
// thinking / tool_use / tool_result），所以这个 provider 几乎是直通：
// 不需要翻译消息结构，只需要按能力裁参数、补认证头、把 SSE 事件流原样转出。
// Anthropic 的流式事件名（content_block_start / content_block_delta /
// content_block_stop / message_delta）与 llmService 消费的事件名完全一致。
//
// 需要特别处理的三件事：
//   1. thinking 的 budget_tokens 必须严格小于 max_tokens，且有 1024 下限；
//   2. 开 thinking 时不接受 temperature ≠ 1；
//   3. 历史 assistant 消息里的 thinking block 回传需要带 signature，
//      而流式路径没有保留 signature —— 无签名的 thinking block 一律剔除，
//      否则整轮请求会被拒。剔除只损失一点上下文，不影响结论正确性。
// ============================================================

const { LLMAPIError, parseRetryAfter } = require("./openaiCompatible");

const ANTHROPIC_VERSION = "2023-06-01";
const MIN_THINKING_BUDGET = 1024;

function _wantsThinking(thinking) {
  if (thinking === undefined || thinking === null) return undefined;
  if (typeof thinking === "boolean") return thinking;
  if (typeof thinking === "object") return thinking.type !== "disabled";
  return undefined;
}

/** 剔除无签名 thinking block；其余 content 原样保留 */
function sanitizeMessages(messages = []) {
  const out = [];
  for (const msg of messages || []) {
    if (!msg) continue;
    if (Array.isArray(msg.content)) {
      const blocks = msg.content.filter((b) => {
        if (!b) return false;
        if (b.type === "thinking") return !!b.signature;
        return true;
      });
      // 全被剔空的 assistant 轮次直接丢弃，Anthropic 不接受空 content
      if (blocks.length === 0) continue;
      out.push({ ...msg, content: blocks });
      continue;
    }
    if (typeof msg.content === "string" && !msg.content.trim()) continue;
    out.push(msg);
  }
  return mergeConsecutive(out);
}

// Anthropic 要求 user / assistant 交替出现，连续同角色必须合并。
// 本仓库的工具循环本身是交替的，但调用方（工作区多轮对话）传进来的历史
// 不保证，合并掉比让整轮 400 强。
function mergeConsecutive(messages) {
  const out = [];
  for (const msg of messages) {
    const prev = out[out.length - 1];
    if (prev && prev.role === msg.role) {
      const toBlocks = (c) => (Array.isArray(c) ? c : [{ type: "text", text: String(c || "") }]);
      prev.content = [...toBlocks(prev.content), ...toBlocks(msg.content)];
      continue;
    }
    out.push({ ...msg });
  }
  return out;
}

/** Anthropic 风格 body → Anthropic 请求体，按 caps 裁剪 */
function buildAnthropicBody(body, caps) {
  const c = caps || {};
  const maxTokens = Math.min(Number(body.max_tokens) || 4096, c.maxOutputTokens || 4096);

  const out = {
    model: body.model,
    max_tokens: maxTokens,
    messages: sanitizeMessages(body.messages),
  };
  if (body.system) {
    out.system = typeof body.system === "string" ? body.system : body.system;
  }
  if (body.stream && c.supportsStreaming !== false) out.stream = true;
  if (c.supportsTools !== false && Array.isArray(body.tools) && body.tools.length) {
    out.tools = body.tools.map((t) =>
      t.input_schema
        ? t
        : { name: t.name || t.function?.name, description: t.description || t.function?.description || "", input_schema: t.parameters || t.function?.parameters || { type: "object", properties: {} } }
    );
    if (body.tool_choice) out.tool_choice = body.tool_choice;
  }

  const wants = _wantsThinking(body.thinking);
  if (wants && c.thinkingStyle === "anthropic") {
    // budget 必须 < max_tokens；给正文至少留一半预算，否则思考写满就没答案了
    const asked = Number(body.thinking?.budget_tokens) || Math.floor(maxTokens / 2);
    const budget = Math.max(MIN_THINKING_BUDGET, Math.min(asked, Math.floor(maxTokens / 2)));
    if (budget < maxTokens) {
      out.thinking = { type: "enabled", budget_tokens: budget };
    }
  }
  // 开思考时 temperature 必须为默认值，直接不发
  if (!out.thinking && body.temperature !== undefined && c.supportsTemperature !== false) {
    out.temperature = body.temperature;
  }
  if (body.top_p !== undefined && !out.thinking) out.top_p = body.top_p;
  if (body.stop) out.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  return out;
}

async function parseError(resp) {
  const text = await resp.text().catch(() => "");
  let msg = text || resp.statusText || "Anthropic API request failed";
  try {
    const json = JSON.parse(text);
    msg = json?.error?.message || json?.message || msg;
  } catch (_) { /* ignore */ }
  // Retry-After 同样要带上：被限流时听上游的退避时长，别自己拍脑袋
  throw new LLMAPIError(
    `Anthropic API 失败 (${resp.status}): ${msg}`,
    resp.status,
    text,
    parseRetryAfter(resp.headers)
  );
}

function createAnthropicClient({ apiKey, endpoint, caps }) {
  const headers = {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "Content-Type": "application/json",
  };

  async function create(body) {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(buildAnthropicBody(body, caps)),
    });
    if (!resp.ok) await parseError(resp);
    const data = await resp.json();
    // 原生响应已经是目标形状，只补一个 raw 方便排查
    return {
      id: data.id,
      content: data.content || [],
      stop_reason: data.stop_reason === "tool_use" ? "tool_use" : (data.stop_reason === "max_tokens" ? "max_tokens" : "end_turn"),
      usage: data.usage
        ? { input_tokens: data.usage.input_tokens || 0, output_tokens: data.usage.output_tokens || 0 }
        : undefined,
      raw: data,
    };
  }

  function stream(body) {
    const abortController = new AbortController();
    const iterator = streamIterator(endpoint, headers, buildAnthropicBody({ ...body, stream: true }, caps), abortController);
    return {
      controller: abortController,
      [Symbol.asyncIterator]() {
        return iterator;
      },
    };
  }

  return { messages: { create, stream } };
}

async function* streamIterator(endpoint, headers, body, abortController) {
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { ...headers, Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal: abortController.signal,
  });
  if (!resp.ok) await parseError(resp);

  const decoder = new TextDecoder();
  let buffer = "";

  function* emit(line) {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let ev;
    try {
      ev = JSON.parse(payload);
    } catch (_) {
      return;
    }
    // Anthropic 的事件名与消费端一致，直接透传；
    // signature_delta / message_stop 等消费端不认识的事件会被忽略，无害。
    if (ev && ev.type) yield ev;
  }

  for await (const chunk of resp.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) yield* emit(line.trim());
  }
  if (buffer.trim()) yield* emit(buffer.trim());
}

module.exports = {
  createAnthropicClient,
  buildAnthropicBody,
  sanitizeMessages,
  ANTHROPIC_VERSION,
};
