// ============================================================
// server/services/hermesClient.js
//
// 北京 → 新加坡 Hermes 的 HTTP 客户端。
//
// Hermes 暴露 OpenAI 兼容协议：
//   POST /v1/responses   带 conversation 参数 → 服务端 stateful 多轮
//   GET  /health         健康检查
// 详见 https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/
//
// 设计要点：
//   1. SSE 流式：拿到 response 流后解析 OpenAI Responses 事件
//      (response.created / response.output_text.delta / response.completed / function_call ...)
//   2. 区分 pre-stream 失败（建连/认证/5xx）和 mid-stream 失败（流中断），
//      让上游 router 决定是否 fallback
//   3. conversation 命名规则：nb_${userId}_${conversationId}  —— 利用 Hermes
//      server-side 会话状态，避免每次重发 history
//   4. 工具调用 (function_call) 由 Hermes 主动反向 HTTP 调北京
//      /api/hermes/tools/call —— 不在这里处理，这里只透传事件
//
// 不在本文件做：脱敏（redactor）、上下文拼装（contextBuilder）、
// fallback 决策（agentRuntimeRouter）
// ============================================================

const { flags } = require("../config/featureFlags");

class HermesPreStreamError extends Error {
  constructor(reason, message, cause) {
    super(message);
    this.name = "HermesPreStreamError";
    this.reason = reason;
    this.cause = cause;
  }
}

class HermesMidStreamError extends Error {
  constructor(reason, message, cause) {
    super(message);
    this.name = "HermesMidStreamError";
    this.reason = reason;
    this.cause = cause;
  }
}

function buildHeaders() {
  const h = { "Content-Type": "application/json" };
  if (flags.hermesApiKey) h["Authorization"] = `Bearer ${flags.hermesApiKey}`;
  return h;
}

function conversationName(userId, conversationId) {
  return `nb_${userId}_${conversationId}`;
}

/**
 * 轻量 healthcheck — 不流式，建连超时 3s。
 * 返回 { ok: true, latencyMs } 或 { ok: false, reason, error }。
 */
async function pingHealth({ timeoutMs = 3000 } = {}) {
  const start = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${flags.hermesBaseUrl}/health`, {
      method: "GET",
      headers: buildHeaders(),
      signal: ac.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "auth_failed", status: res.status };
    }
    if (!res.ok) {
      return { ok: false, reason: "http_5xx", status: res.status };
    }
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    const reason = err.name === "AbortError" ? "connect_timeout" : "connect_timeout";
    return { ok: false, reason, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 流式发起一次会话调用。
 *
 * @param {Object} opts
 * @param {number} opts.userId
 * @param {string} opts.conversationId
 * @param {string} opts.input          —— 已脱敏的用户消息（含上下文）
 * @param {string} [opts.instructions] —— host SOUL / system instructions（一般留空，Hermes profile 已带）
 * @param {AbortSignal} [opts.signal]
 * @param {Function} opts.onEvent      —— (event) => void 接收解析后的事件
 *     事件形态: { type, ...payload }
 *       type='delta',         payload={ text }
 *       type='tool_call',     payload={ call_id, name, arguments }
 *       type='tool_result',   payload={ call_id, output }  （透传，便于审计）
 *       type='completed',     payload={ response_id }
 *       type='error',         payload={ reason, message }
 *
 * @returns {Promise<{ responseId: string }>} 完成后返回 response id（便于 previous_response_id 链式）
 *
 * @throws {HermesPreStreamError}  流开始前失败（建连/认证/5xx）—— router 可 fallback
 * @throws {HermesMidStreamError}  流开始后失败 —— router 不切，仅记录
 */
async function streamResponse({
  userId,
  conversationId,
  input,
  instructions,
  signal,
  onEvent,
}) {
  if (!flags.hermesEnabled) {
    throw new HermesPreStreamError("hermes_disabled", "Hermes is disabled via feature flag");
  }

  const body = {
    model: flags.hermesModel,
    input,
    stream: true,
    store: true,
    conversation: conversationName(userId, conversationId),
  };
  if (instructions) body.instructions = instructions;

  let res;
  try {
    res = await fetch(`${flags.hermesBaseUrl}/v1/responses`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    const reason = err.name === "AbortError" ? "stream_aborted" : "connect_timeout";
    throw new HermesPreStreamError(reason, `Hermes connect failed: ${err.message}`, err);
  }

  // pre-stream 状态判断
  if (res.status === 401 || res.status === 403) {
    throw new HermesPreStreamError("auth_failed", `Hermes auth failed (${res.status})`);
  }
  if (res.status >= 500) {
    throw new HermesPreStreamError("http_5xx", `Hermes returned ${res.status}`);
  }
  if (res.status >= 400) {
    const text = await res.text().catch(() => "");
    throw new HermesPreStreamError("http_4xx", `Hermes 4xx: ${res.status} ${text.slice(0, 200)}`);
  }
  if (!res.body) {
    throw new HermesPreStreamError("http_5xx", "Hermes response has no body");
  }

  // 进入 mid-stream：任何错误都不再 fallback
  let responseId = null;
  try {
    const decoder = new TextDecoder();
    let buffer = "";
    const reader = res.body.getReader();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE 帧以 \n\n 分隔
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const evt = parseSseFrame(raw);
        if (!evt) continue;

        const mapped = mapHermesEvent(evt);
        if (!mapped) continue;
        if (mapped.type === "completed" && mapped.response_id) {
          responseId = mapped.response_id;
        }
        try { onEvent && onEvent(mapped); } catch (_) { /* 上游回调异常不影响流 */ }
      }
    }
  } catch (err) {
    throw new HermesMidStreamError("stream_aborted", `Hermes stream aborted: ${err.message}`, err);
  }

  return { responseId };
}

function parseSseFrame(raw) {
  const lines = raw.split("\n");
  let event = "message";
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  const data = dataLines.join("\n");
  if (!data || data === "[DONE]") return { event, done: data === "[DONE]" };
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return { event, data };
  }
}

/**
 * 把 Hermes 原生 SSE 事件归一为内部事件。
 * Hermes 文档里 Responses API 用 OpenAI Responses 规范：
 *   response.created / response.output_text.delta / response.output_item.added
 *   response.output_item.done / response.completed
 *   function_call (在 output_item 里) / function_call_output
 */
function mapHermesEvent(frame) {
  if (!frame || frame.done) return null;
  const { event, data } = frame;
  if (!data || typeof data !== "object") return null;

  switch (event) {
    case "response.created":
      return { type: "created", response_id: data?.response?.id || data?.id || null };
    case "response.output_text.delta":
      return { type: "delta", text: data?.delta ?? data?.text ?? "" };
    case "response.output_item.added":
    case "response.output_item.done": {
      const item = data?.item;
      if (item?.type === "function_call") {
        return {
          type: "tool_call",
          call_id: item.call_id || item.id,
          name: item.name,
          arguments: item.arguments,
          done: event === "response.output_item.done",
        };
      }
      if (item?.type === "function_call_output") {
        return {
          type: "tool_result",
          call_id: item.call_id,
          output: item.output,
        };
      }
      return null;
    }
    case "response.completed":
      return { type: "completed", response_id: data?.response?.id || data?.id || null };
    case "response.error":
    case "error":
      return { type: "error", reason: "stream_error", message: data?.error?.message || data?.message };
    case "hermes.tool.progress":
      // 工具进度（非持久化），透传供前端展示
      return { type: "tool_progress", data };
    default:
      return null;
  }
}

/**
 * 非流式一次性调用，适合 BP pipeline 需要完整 JSON 的场景。
 *
 * @param {Object} opts
 * @param {string} opts.input
 * @param {string} [opts.instructions]
 * @param {string} [opts.conversation]   —— 可选会话隔离名
 * @param {Object} [opts.responseFormat] —— OpenAI response_format（json_schema 等）
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ text: string, responseId: string|null, raw: object }>}
 *
 * @throws {HermesPreStreamError}
 */
async function completeResponse({ input, instructions, conversation, responseFormat, signal }) {
  if (!flags.hermesEnabled) {
    throw new HermesPreStreamError("hermes_disabled", "Hermes is disabled via feature flag");
  }
  const body = {
    model: flags.hermesModel,
    input,
    stream: false,
    store: false,
  };
  if (instructions) body.instructions = instructions;
  if (conversation) body.conversation = conversation;
  if (responseFormat) body.response_format = responseFormat;

  let res;
  try {
    res = await fetch(`${flags.hermesBaseUrl}/v1/responses`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    const reason = err.name === "AbortError" ? "stream_aborted" : "connect_timeout";
    throw new HermesPreStreamError(reason, `Hermes connect failed: ${err.message}`, err);
  }

  if (res.status === 401 || res.status === 403) {
    throw new HermesPreStreamError("auth_failed", `Hermes auth failed (${res.status})`);
  }
  if (res.status >= 500) {
    throw new HermesPreStreamError("http_5xx", `Hermes returned ${res.status}`);
  }
  if (res.status >= 400) {
    const text = await res.text().catch(() => "");
    throw new HermesPreStreamError("http_4xx", `Hermes 4xx: ${res.status} ${text.slice(0, 200)}`);
  }

  const json = await res.json().catch(() => null);
  if (!json) throw new HermesPreStreamError("http_5xx", "Hermes returned non-JSON body");

  // Responses API: 文本在 output[].content[].text 里聚合
  let text = "";
  if (Array.isArray(json.output)) {
    for (const item of json.output) {
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (typeof c.text === "string") text += c.text;
        }
      }
    }
  }
  if (!text && typeof json.output_text === "string") text = json.output_text;

  return { text, responseId: json.id || null, raw: json };
}

module.exports = {
  pingHealth,
  streamResponse,
  completeResponse,
  conversationName,
  HermesPreStreamError,
  HermesMidStreamError,
};
