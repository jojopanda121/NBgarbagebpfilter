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
const LLM_TIMEOUT_MS = 180 * 1000;    // 单次请求超时 180s（3分钟）
const MAX_RETRIES = 3;                  // 最多重试 3 次（共 4 次尝试）
const BASE_DELAY_MS = 2000;             // 重试基础延迟 2s

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
  // 超时、网络错误、速率限制、5xx 可重试
  if (msg.includes("超时")) return true;
  if (msg.includes("timeout")) return true;
  if (msg.includes("ECONNRESET") || msg.includes("ENOTFOUND") || msg.includes("ETIMEDOUT")) return true;
  if (err?.status >= 500) return true;
  if (err?.status === 429) return true;
  return false;
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

      const resp = await withTimeout(
        anthropic.messages.create({
          model: MODEL,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: userContent }],
        }),
        LLM_TIMEOUT_MS,
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

  throw lastError;
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

        const resp = await withTimeout(
          anthropic.messages.create({
            model: MODEL,
            max_tokens: maxTokens,
            thinking: { type: "enabled", budget_tokens: thinkingBudget },
            system: systemPrompt,
            messages: [{ role: "user", content: userContent }],
          }),
          LLM_TIMEOUT_MS * 2, // thinking 模式给双倍超时
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
