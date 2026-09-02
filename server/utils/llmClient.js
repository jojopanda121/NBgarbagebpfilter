// ============================================================
// server/utils/llmClient.js — LLM 客户端工厂（兼容门面）
//
// 实现已迁往 server/services/llm/providers/（按厂商拆分 + 能力矩阵裁剪）。
// 这一层保留原有的导出名和调用签名，让老调用点和既有测试无需改动：
//   createLLMClient({ apiKey, baseURL })            → 默认 DeepSeek
//   createLLMClient({ apiKey, baseURL, providerId }) → 任意已注册厂商
//
// buildLLMBody / normalizeThinking / toAnthropicLikeResponse 等翻译函数
// 直接透传 OpenAI 兼容实现（不传 caps 时保持迁移前的放行行为）。
// ============================================================

const providers = require("../services/llm/providers");
const openaiCompatible = require("../services/llm/providers/openaiCompatible");

/**
 * @param {object} args
 * @param {string} args.apiKey
 * @param {string} [args.baseURL]
 * @param {string} [args.providerId="deepseek"]
 * @param {string} [args.model]                用于解析能力矩阵
 * @param {object} [args.capabilityOverrides]
 */
function createLLMClient({ apiKey, baseURL, providerId = "deepseek", model, capabilityOverrides } = {}) {
  const { client } = providers.createClient({ providerId, apiKey, baseURL, model, capabilityOverrides });
  return client;
}

module.exports = {
  LLMAPIError: openaiCompatible.LLMAPIError,
  createLLMClient,
  buildLLMBody: openaiCompatible.buildLLMBody,
  normalizeMessages: openaiCompatible.normalizeMessages,
  normalizeTools: openaiCompatible.normalizeTools,
  normalizeThinking: openaiCompatible.normalizeThinking,
  toAnthropicLikeResponse: openaiCompatible.toAnthropicLikeResponse,
};
