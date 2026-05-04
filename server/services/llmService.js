// ============================================================
// server/services/llmService.js — LLM 调用服务
// 封装 MiniMax via Anthropic SDK 的调用逻辑
// 含超时控制和重试机制
// ============================================================

const Anthropic = require("@anthropic-ai/sdk").default;
const config = require("../config");

const anthropic = new Anthropic({
  apiKey: config.minimaxApiKey,
  baseURL: "https://api.minimax.io/anthropic",
});

const MODEL = config.minimaxModel;

// 超时和重试配置
const LLM_TIMEOUT_MS = 300 * 1000;    // 单次请求超时 300s（5分钟），大 prompt 需要更多时间
const MAX_RETRIES = 3;                  // 最多重试 3 次（共 4 次尝试）
const BASE_DELAY_MS = 2000;             // 重试基础延迟 2s

/** 根据 maxTokens 动态计算超时时间 */
function calcTimeout(maxTokens) {
  // 基础 300s，每增加 4096 tokens 多给 60s，上限 600s
  const extra = Math.floor(maxTokens / 4096) * 60 * 1000;
  return Math.min(LLM_TIMEOUT_MS + extra, 600 * 1000);
}

/** 延迟工具函数 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 带超时的 Promise 包装 */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`LLM 请求超时 (${ms}ms): ${label}`)),
      ms
    );
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/** 判断是否可重试的错误 */
function isRetryable(err) {
  const msg = err?.message || "";
  const status = err?.status;
  // 永久错误：401/403/404/400 不重试，立刻冒泡
  if (status === 401 || status === 403 || status === 404 || status === 400) return false;
  // 超时、网络错误、速率限制、5xx 可重试
  if (msg.includes("超时")) return true;
  if (msg.includes("timeout")) return true;
  if (msg.includes("ECONNRESET") || msg.includes("ENOTFOUND") || msg.includes("ETIMEDOUT")) return true;
  if (status >= 500) return true;
  if (status === 429) return true;
  return false;
}

/** 将上游错误规范化为对调用方友好的中文异常 */
function normalizeLLMError(err) {
  const status = err?.status;
  if (status === 401 || status === 403) {
    const e = new Error("LLM 服务认证失败：请检查 MINIMAX_API_KEY 配置");
    e.permanent = true;
    return e;
  }
  if (status === 429) {
    return new Error("LLM 服务限流，请稍后重试");
  }
  return err;
}

/** 调用 MiniMax LLM（普通模式），含超时和重试 */
async function callLLM(systemPrompt, userContent, maxTokens = 8192) {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[LLM] 第 ${attempt + 1} 次尝试（延迟 ${delay}ms）...`);
        await sleep(delay);
      }

      const timeout = calcTimeout(maxTokens);
      const resp = await withTimeout(
        anthropic.messages.create({
          model: MODEL,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: userContent }],
        }),
        timeout,
        `callLLM(maxTokens=${maxTokens})`
      );

      return resp.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES && isRetryable(err)) {
        console.warn(`[LLM] 请求失败 (attempt ${attempt + 1}): ${err.message}`);
        continue;
      }
      break;
    }
  }

  throw normalizeLLMError(lastError);
}

/** 调用 MiniMax LLM（深度思考模式，不支持时自动降级），含超时和重试 */
async function callLLMWithThinking(systemPrompt, userContent, maxTokens = 16000, thinkingBudget = 8000) {
  try {
    let lastError;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.warn(`[LLM/Thinking] 第 ${attempt + 1} 次尝试（延迟 ${delay}ms）...`);
          await sleep(delay);
        }

        const timeout = calcTimeout(maxTokens) * 2; // thinking 模式给双倍超时
        const resp = await withTimeout(
          anthropic.messages.create({
            model: MODEL,
            max_tokens: maxTokens,
            thinking: { type: "enabled", budget_tokens: thinkingBudget },
            system: systemPrompt,
            messages: [{ role: "user", content: userContent }],
          }),
          timeout,
          `callLLMWithThinking(maxTokens=${maxTokens})`
        );

        let thinking = "";
        let text = "";
        for (const block of resp.content) {
          if (block.type === "thinking") thinking += block.thinking;
          if (block.type === "text") text += block.text;
        }
        if (text) return { thinking, text };
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES && isRetryable(err)) {
          console.warn(`[LLM/Thinking] 请求失败 (attempt ${attempt + 1}): ${err.message}`);
          continue;
        }
        break;
      }
    }

    // Thinking 模式完全失败，抛出以便降级
    throw lastError;
  } catch (thinkErr) {
    console.warn("[LLM] Thinking 模式不可用，降级为普通模式:", thinkErr.message);
  }

  const text = await callLLM(systemPrompt, userContent, maxTokens);
  return { thinking: "", text };
}

/**
 * 调用 LLM，支持自定义多轮 messages 和流式回调。
 * @param {string} systemPrompt
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 * @param {object} opts
 * @param {number} [opts.maxTokens=4096]
 * @param {(delta:string)=>void} [opts.onDelta] 每次 token 增量回调（设置后启用流式）
 * @param {AbortSignal} [opts.signal] 调用方取消信号（用于客户端断开）
 * @returns {Promise<string>} 完整文本
 */
async function callLLMChat(systemPrompt, messages, opts = {}) {
  const { maxTokens = 4096, onDelta, signal } = opts;
  if (!config.minimaxApiKey) {
    throw new Error("LLM 未配置：服务端缺少 MINIMAX_API_KEY，请在 .env 中设置后重启 PM2 进程");
  }
  let lastError;
  let streamUnsupported = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[LLM/Chat] 第 ${attempt + 1} 次尝试（延迟 ${delay}ms）...`);
        await sleep(delay);
      }

      if (signal?.aborted) throw new Error("客户端取消");

      const timeout = calcTimeout(maxTokens);

      if (onDelta && !streamUnsupported) {
        // H8: 流式模式 — 即便 stream 创建本身失败，也保证 timeout/abort 监听器被清理
        let stream;
        let onAbort;
        let timeoutTimer;
        try {
          // 显式 timeout 包裹 stream 创建
          stream = await new Promise((resolve, reject) => {
            timeoutTimer = setTimeout(
              () => reject(new Error(`LLM 请求超时 (${timeout}ms): callLLMChat(stream)`)),
              timeout
            );
            try {
              const s = anthropic.messages.stream({
                model: MODEL,
                max_tokens: maxTokens,
                system: systemPrompt,
                messages,
              });
              clearTimeout(timeoutTimer);
              resolve(s);
            } catch (e) {
              clearTimeout(timeoutTimer);
              reject(e);
            }
          });

          let full = "";
          onAbort = () => { try { stream.controller?.abort?.(); } catch (_) { /* ignore */ } };
          if (signal) signal.addEventListener("abort", onAbort);

          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              const piece = event.delta.text || "";
              if (piece) {
                full += piece;
                onDelta(piece);
              }
            }
          }
          return full;
        } finally {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          if (signal && onAbort) signal.removeEventListener("abort", onAbort);
          try { stream && stream.controller?.abort?.(); } catch (_) { /* ignore */ }
        }
      }

      // 非流式
      const resp = await withTimeout(
        anthropic.messages.create({
          model: MODEL,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages,
        }),
        timeout,
        `callLLMChat(maxTokens=${maxTokens})`
      );
      const fullText = resp.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      // 如果调用方期望流式但上游不支持，至少把完整文本作为一个 delta 推给前端，
      // 否则 SSE 端会出现"主持人开口但说不出话"的视觉假死。
      if (onDelta && fullText) onDelta(fullText);
      return fullText;
    } catch (err) {
      lastError = err;
      // 客户端取消不重试
      if (err?.message === "客户端取消" || signal?.aborted) break;

      // 流式不被上游支持（MiniMax 兼容端点常见）→ 改走非流式，下一轮直接降级
      const msg = err?.message || "";
      if (
        onDelta && !streamUnsupported &&
        (err?.status === 400 || err?.status === 404 ||
         msg.includes("stream") || msg.includes("SSE") ||
         msg.includes("not supported") || msg.includes("unsupported"))
      ) {
        console.warn("[LLM/Chat] 流式不被支持，降级为非流式:", msg);
        streamUnsupported = true;
        continue;
      }

      if (attempt < MAX_RETRIES && isRetryable(err)) {
        console.warn(`[LLM/Chat] 请求失败 (attempt ${attempt + 1}): ${err.message}`);
        continue;
      }
      break;
    }
  }
  throw normalizeLLMError(lastError);
}

/**
 * 调用 MiniMax LLM 并启用 web_search 工具（M2 系列内置）
 * 让模型自主决定何时检索公开资料，服务端无需自行执行检索。
 *
 * 回退：若服务端不识别工具，自动降级为普通 callLLM。
 *
 * @param {string} systemPrompt
 * @param {string} userContent
 * @param {object} [opts]
 * @param {number} [opts.maxTokens=8192]
 * @param {number} [opts.maxToolRounds=6]
 * @returns {Promise<{ text: string, searchUsed: boolean }>}
 */
async function callLLMWithSearch(systemPrompt, userContent, opts = {}) {
  const { maxTokens = 8192, maxToolRounds = 6 } = opts;

  // MiniMax M2 内置 web_search：通过 Anthropic 兼容端点声明 type:"web_search"
  const tools = [{ type: "web_search", name: "web_search" }];

  let searchUsed = false;
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[LLM/Search] 第 ${attempt + 1} 次尝试（延迟 ${delay}ms）...`);
        await sleep(delay);
      }

      const convo = [{ role: "user", content: userContent }];
      let finalText = "";

      // 工具调用循环（兼容客户端 tool_use 格式）
      for (let round = 0; round < maxToolRounds; round++) {
        const timeout = calcTimeout(maxTokens);
        const resp = await withTimeout(
          anthropic.messages.create({
            model: MODEL,
            max_tokens: maxTokens,
            system: systemPrompt,
            tools,
            messages: convo,
          }),
          timeout,
          `callLLMWithSearch(round=${round})`
        );

        const text = resp.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");
        if (text) finalText = text;

        const toolUses = resp.content.filter((b) => b.type === "tool_use");
        if (toolUses.length === 0 || resp.stop_reason === "end_turn") break;

        // MiniMax 服务端模式：服务端会自动执行 web_search 并把结果嵌入下一条消息；
        // 客户端模式：返回兜底 tool_result 让模型基于已有上下文继续输出，避免循环卡住。
        searchUsed = true;
        convo.push({ role: "assistant", content: resp.content });
        convo.push({
          role: "user",
          content: toolUses.map((tu) => ({
            type: "tool_result",
            tool_use_id: tu.id,
            content: "（已由服务端检索处理，请基于已有上下文继续输出最终 JSON）",
          })),
        });
      }

      return { text: finalText, searchUsed };
    } catch (err) {
      lastError = err;
      const msg = err?.message || "";
      // 服务端不识别 web_search 工具 → 降级
      if (
        err?.status === 400 ||
        msg.includes("tool") ||
        msg.includes("web_search") ||
        msg.includes("unsupported")
      ) {
        console.warn("[LLM/Search] web_search 不可用，降级为普通模式:", msg);
        const text = await callLLM(systemPrompt, userContent, maxTokens);
        return { text, searchUsed: false };
      }
      if (attempt < MAX_RETRIES && isRetryable(err)) continue;
      break;
    }
  }

  // 重试用尽 → 最后再兜底降级
  console.warn("[LLM/Search] 全部重试失败，降级为普通模式:", lastError?.message);
  const text = await callLLM(systemPrompt, userContent, maxTokens);
  return { text, searchUsed: false };
}

function getModelName() {
  return MODEL;
}

module.exports = {
  callLLM,
  callLLMWithThinking,
  callLLMChat,
  callLLMWithSearch,
  getModelName,
};
