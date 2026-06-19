const { resolveKimiChatEndpoint } = require("./kimiEndpoints");

class KimiAPIError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "KimiAPIError";
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

function buildKimiBody(body, opts = {}) {
  const kimiBody = {
    model: body.model,
    max_tokens: body.max_tokens,
    messages: normalizeMessages([
      ...(body.system ? [{ role: "system", content: body.system }] : []),
      ...(body.messages || []),
    ]),
  };
  const tools = normalizeTools(body.tools);
  if (tools.length) kimiBody.tools = tools;
  if (body.tool_choice) kimiBody.tool_choice = body.tool_choice;
  if (body.stream) kimiBody.stream = true;
  if (opts.includeThinkingParam === false) {
    return kimiBody;
  }
  if (body.thinking) {
    kimiBody.thinking = body.thinking.type === "enabled"
      ? { type: "enabled" }
      : { type: "disabled" };
  } else {
    kimiBody.thinking = { type: "disabled" };
  }
  return kimiBody;
}

async function parseError(resp) {
  const text = await resp.text().catch(() => "");
  let msg = text || resp.statusText || "Kimi API request failed";
  try {
    const json = JSON.parse(text);
    msg = json?.error?.message || json?.message || msg;
  } catch (_) { /* ignore */ }
  throw new KimiAPIError(`Kimi API 失败 (${resp.status}): ${msg}`, resp.status, text);
}

function createKimiCompatClient({ apiKey, baseURL, provider = "kimi" }) {
  const endpoint = resolveKimiChatEndpoint(baseURL);
  const includeThinkingParam = true;

  async function create(body) {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildKimiBody(body, { includeThinkingParam })),
    });
    if (!resp.ok) await parseError(resp);
    return toAnthropicLikeResponse(await resp.json());
  }

  function stream(body) {
    const abortController = new AbortController();
    const iterator = streamIterator(
      endpoint,
      apiKey,
      buildKimiBody({ ...body, stream: true }, { includeThinkingParam }),
      abortController
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

async function* streamIterator(endpoint, apiKey, body, abortController) {
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal: abortController.signal,
  });
  if (!resp.ok) await parseError(resp);

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
  KimiAPIError,
  createKimiCompatClient,
  buildKimiBody,
  normalizeMessages,
  normalizeTools,
  toAnthropicLikeResponse,
};
