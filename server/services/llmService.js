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

function getModelName() {
  return MODEL;
}

module.exports = { callLLM, callLLMWithThinking, getModelName };
