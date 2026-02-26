// ============================================================
// server/services/llmService.js — LLM 调用服务
// 封装 MiniMax via Anthropic SDK 的调用逻辑
// ============================================================

const Anthropic = require("@anthropic-ai/sdk").default;
const config = require("../config");

const anthropic = new Anthropic({
  apiKey: config.minimaxApiKey,
  baseURL: "https://api.minimax.io/anthropic",
});

const MODEL = config.minimaxModel;

/** 调用 MiniMax LLM（普通模式） */
async function callLLM(systemPrompt, userContent, maxTokens = 8192) {
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });
  return resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** 调用 MiniMax LLM（深度思考模式，不支持时自动降级） */
async function callLLMWithThinking(systemPrompt, userContent, maxTokens = 16000, thinkingBudget = 8000) {
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: "enabled", budget_tokens: thinkingBudget },
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });

    let thinking = "";
    let text = "";
    for (const block of resp.content) {
      if (block.type === "thinking") thinking += block.thinking;
      if (block.type === "text") text += block.text;
    }
    if (text) return { thinking, text };
  } catch (thinkErr) {
    console.warn("Thinking 模式不可用，降级为普通模式:", thinkErr.message);
  }

  const text = await callLLM(systemPrompt, userContent, maxTokens);
  return { thinking: "", text };
}

function getModelName() {
  return MODEL;
}

module.exports = { callLLM, callLLMWithThinking, getModelName };
