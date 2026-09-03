// ============================================================
// server/services/llm/capabilities.js — 模型能力矩阵
//
// 存在的理由：本仓库的流水线是**按 DeepSeek V4 的能力上限写的**
// （1M 上下文 / 384K 输出 / 思考开关 / 工具调用），而用户自带的模型
// 可能只有 8K 输出、32K 上下文、不认 thinking、不认 reasoning_effort。
// 把这些差异留给"发出去被 400 再 catch"处理是不行的：
//   - llmService 的 THINKING_MIN_TOKENS=12000 会把 max_tokens 抬到 12000，
//     打到输出上限 8192 的模型上是**每一次调用都失败**，重试三次全废；
//   - pipelineService 的 bpExtractionMaxChars=200000 字符（约 15 万 token）
//     打到 32K 上下文的模型上同样是必然失败。
// 所以差异必须在**请求发出之前**按能力裁剪掉，事后 catch 只作为第二道防线。
//
// 表里的数值是**保守下限，不是厂商标称上限**。写小了只损失一点余量，
// 写大了会让用户的分析整条跑不完——所以拿不准一律往小写，
// 再由 sanitizeRequest 的反应式降级（收到"超上限"类报错自动减半重试）兜住余下情况。
// 用户也可以在保存凭证时显式覆盖 maxOutputTokens。
// ============================================================

// 未知模型的兜底能力：假设它是个"很普通的 OpenAI 兼容模型"。
// 保守到几乎任何 2024 年后的模型都能满足，宁可少用能力也不要报错。
const FALLBACK = {
  maxOutputTokens: 4096,
  contextWindow: 32000,
  // 输出上限用哪个字段名：OpenAI 的推理模型（o 系 / gpt-5）只认
  // max_completion_tokens，继续发 max_tokens 会被直接拒绝。
  tokenParam: "max_tokens",
  thinkingStyle: "none",
  supportsReasoningEffort: false,
  supportsTools: true,
  supportsStreaming: true,
  supportsJsonMode: false,
  supportsTemperature: true,
};

// thinkingStyle 取值 —— 决定"开思考"这件事翻译成什么请求字段：
//   none       不支持，直接不发（并按需关闭强制思考）
//   deepseek   thinking: { type: "enabled" | "disabled" }
//   anthropic  thinking: { type: "enabled", budget_tokens: N }（budget 必须小于 max_tokens）
//   qwen       enable_thinking: true/false
//   minimax    thinking: { type: "adaptive" | "disabled" }（**没有 enabled**，
//              发 enabled 会被 2013 invalid params 拒绝，而且是 HTTP 200 的业务错误）
//   zhipu      thinking: { type: "enabled" | "disabled" }（形状同 deepseek）
//   effort     只认 reasoning_effort，没有独立的 thinking 字段（OpenAI o 系 / gpt-5）
//   always     模型永远在思考且不可关（如 o 系推理模型），发任何开关字段都会 400

// 每个 provider 的默认档 + 按模型名正则覆盖。
// 匹配顺序：models 数组从上到下，第一个命中的生效。
const PROVIDER_CAPABILITIES = {
  deepseek: {
    default: {
      maxOutputTokens: 8192,
      contextWindow: 128000,
      thinkingStyle: "deepseek",
      supportsReasoningEffort: false,
      supportsTools: true,
      supportsStreaming: true,
      supportsJsonMode: true,
      supportsTemperature: true,
    },
    models: [
      // 本仓库的主力模型。1M 上下文 / 384K 输出，能力最全。
      // 输出上限按实际编排需要取 64K（384K 是理论值，没有任务需要这么长）。
      {
        match: /^deepseek-v4/i,
        caps: {
          maxOutputTokens: 65536,
          contextWindow: 1000000,
          thinkingStyle: "deepseek",
          // flash 支持 low/high/max，pro 只支持 high/max（low 会 400，见 llmService._reasoningEffortFor）
          supportsReasoningEffort: true,
        },
      },
      // 官方 v3 系列
      { match: /^deepseek-reasoner/i, caps: { maxOutputTokens: 65536, contextWindow: 128000, thinkingStyle: "always" } },
      { match: /^deepseek-chat/i, caps: { maxOutputTokens: 8192, contextWindow: 128000, thinkingStyle: "none" } },
    ],
  },

  anthropic: {
    default: {
      maxOutputTokens: 8192,
      contextWindow: 200000,
      thinkingStyle: "anthropic",
      supportsReasoningEffort: false,
      supportsTools: true,
      supportsStreaming: true,
      // Anthropic 没有 response_format，JSON 靠提示词约束 + 本仓库的 extractJson 兜底
      supportsJsonMode: false,
      supportsTemperature: true,
    },
    models: [
      { match: /^claude-(opus|sonnet|haiku)-[45]/i, caps: { maxOutputTokens: 32000, contextWindow: 200000, thinkingStyle: "anthropic" } },
      { match: /^claude-3-7/i, caps: { maxOutputTokens: 32000, contextWindow: 200000, thinkingStyle: "anthropic" } },
      { match: /^claude-3-5/i, caps: { maxOutputTokens: 8192, contextWindow: 200000, thinkingStyle: "none" } },
      { match: /^claude-3/i, caps: { maxOutputTokens: 4096, contextWindow: 200000, thinkingStyle: "none" } },
    ],
  },

  openai: {
    default: {
      maxOutputTokens: 4096,
      contextWindow: 128000,
      thinkingStyle: "none",
      supportsReasoningEffort: false,
      supportsTools: true,
      supportsStreaming: true,
      supportsJsonMode: true,
      supportsTemperature: true,
    },
    models: [
      // 推理模型：思考不可关，且不接受 temperature ≠ 1
      {
        match: /^(o[1345](-|$)|gpt-5)/i,
        caps: {
          maxOutputTokens: 32000,
          contextWindow: 200000,
          thinkingStyle: "always",
          supportsReasoningEffort: true,
          supportsTemperature: false,
          tokenParam: "max_completion_tokens",
        },
      },
      { match: /^gpt-4\.1/i, caps: { maxOutputTokens: 32768, contextWindow: 1000000 } },
      { match: /^gpt-4o/i, caps: { maxOutputTokens: 16384, contextWindow: 128000 } },
      { match: /^gpt-4-turbo/i, caps: { maxOutputTokens: 4096, contextWindow: 128000 } },
    ],
  },

  gemini: {
    // 走 Gemini 的 OpenAI 兼容端点，不引 SDK
    default: {
      maxOutputTokens: 8192,
      contextWindow: 1000000,
      thinkingStyle: "none",
      supportsReasoningEffort: false,
      supportsTools: true,
      supportsStreaming: true,
      supportsJsonMode: true,
      supportsTemperature: true,
    },
    models: [
      { match: /^gemini-[23]\.5-pro/i, caps: { maxOutputTokens: 32768, contextWindow: 1000000, thinkingStyle: "effort", supportsReasoningEffort: true } },
      { match: /^gemini-[23]\.5-flash/i, caps: { maxOutputTokens: 32768, contextWindow: 1000000, thinkingStyle: "effort", supportsReasoningEffort: true } },
      { match: /^gemini-2\.0-flash/i, caps: { maxOutputTokens: 8192, contextWindow: 1000000 } },
    ],
  },

  minimax: {
    // 本项目上一代主力。保留完整适配，将来切回只改 env。
    default: {
      maxOutputTokens: 8192,
      contextWindow: 245000,
      // abab / Text-01 这代没有思考开关；M 系列有，但只认 adaptive/disabled
      thinkingStyle: "none",
      supportsReasoningEffort: false,
      supportsTools: true,
      supportsStreaming: true,
      supportsJsonMode: false,
      supportsTemperature: true,
    },
    models: [
      // M 系（M1/M2/M3）：thinking 只接受 adaptive / disabled。
      // 此前误标成 deepseek 风格（发 "enabled"），导致每一次开思考的调用
      // 都被 2013 拒绝，且因为是 HTTP 200 而被当成"空回答"静默重试。
      // M1 官方标称 1M 上下文；M2/M3 等后续型号拿不准，按本文件的规矩往小写
      // （写小只损失一点输入余量，写大是每次调用都失败）。
      { match: /^minimax-m1/i, caps: { maxOutputTokens: 32768, contextWindow: 1000000, thinkingStyle: "minimax" } },
      { match: /^minimax-m/i, caps: { maxOutputTokens: 32768, contextWindow: 192000, thinkingStyle: "minimax" } },
      { match: /^(abab|minimax-text)/i, caps: { maxOutputTokens: 8192, contextWindow: 245000 } },
    ],
  },

  moonshot: {
    // Kimi
    default: {
      maxOutputTokens: 4096,
      contextWindow: 128000,
      thinkingStyle: "none",
      supportsReasoningEffort: false,
      supportsTools: true,
      supportsStreaming: true,
      supportsJsonMode: true,
      supportsTemperature: true,
    },
    models: [
      { match: /^kimi-k2/i, caps: { maxOutputTokens: 16384, contextWindow: 256000 } },
      { match: /^kimi-thinking/i, caps: { maxOutputTokens: 16384, contextWindow: 128000, thinkingStyle: "always" } },
      { match: /^moonshot-v1-128k/i, caps: { maxOutputTokens: 8192, contextWindow: 128000 } },
      { match: /^moonshot-v1-32k/i, caps: { maxOutputTokens: 8192, contextWindow: 32000 } },
      { match: /^moonshot-v1-8k/i, caps: { maxOutputTokens: 4096, contextWindow: 8000 } },
    ],
  },

  qwen: {
    // 阿里云百炼 DashScope 的 OpenAI 兼容模式
    default: {
      maxOutputTokens: 8192,
      contextWindow: 128000,
      thinkingStyle: "none",
      supportsReasoningEffort: false,
      supportsTools: true,
      supportsStreaming: true,
      supportsJsonMode: true,
      supportsTemperature: true,
    },
    models: [
      // qwen3 系列的思考开关是 enable_thinking（不是 thinking 对象）
      { match: /^qwen3/i, caps: { maxOutputTokens: 16384, contextWindow: 128000, thinkingStyle: "qwen" } },
      { match: /^qwen-max/i, caps: { maxOutputTokens: 8192, contextWindow: 32000 } },
      { match: /^qwen-plus/i, caps: { maxOutputTokens: 8192, contextWindow: 128000, thinkingStyle: "qwen" } },
      { match: /^qwen-turbo/i, caps: { maxOutputTokens: 8192, contextWindow: 1000000, thinkingStyle: "qwen" } },
      { match: /^qwq|^qvq/i, caps: { maxOutputTokens: 16384, contextWindow: 128000, thinkingStyle: "always" } },
    ],
  },

  zhipu: {
    // 智谱 GLM
    default: {
      maxOutputTokens: 4096,
      contextWindow: 128000,
      thinkingStyle: "none",
      supportsReasoningEffort: false,
      supportsTools: true,
      supportsStreaming: true,
      supportsJsonMode: true,
      supportsTemperature: true,
    },
    models: [
      { match: /^glm-4\.[56789]/i, caps: { maxOutputTokens: 16384, contextWindow: 128000, thinkingStyle: "zhipu" } },
      { match: /^glm-z1/i, caps: { maxOutputTokens: 16384, contextWindow: 128000, thinkingStyle: "always" } },
      { match: /^glm-4/i, caps: { maxOutputTokens: 4096, contextWindow: 128000 } },
    ],
  },
};

/**
 * 解析某个 provider + model 的能力。
 * 未知 provider / 未知 model 都会拿到保守兜底值，不会抛错——
 * 用户填了个我们没见过的模型名时，宁可少用能力也要让流水线跑完。
 *
 * @param {string} providerId
 * @param {string} model
 * @param {object} [overrides] 用户显式覆盖（如自己知道模型能出 64K）
 */
function resolveCapabilities(providerId, model, overrides = {}) {
  const table = PROVIDER_CAPABILITIES[providerId];
  if (!table) return { ...FALLBACK, ...sanitizeOverrides(overrides) };

  let caps = { ...FALLBACK, ...table.default };
  const name = String(model || "");
  for (const entry of table.models || []) {
    if (entry.match.test(name)) {
      caps = { ...caps, ...entry.caps };
      break;
    }
  }
  return { ...caps, ...sanitizeOverrides(overrides) };
}

// 用户覆盖只接受正整数的两个容量字段；能力布尔位不开放给用户改
// （用户把 supportsTools 打开并不能让模型真的支持工具，只会换来 400）。
function sanitizeOverrides(overrides = {}) {
  const out = {};
  const maxOut = Number(overrides.maxOutputTokens);
  if (Number.isFinite(maxOut) && maxOut >= 256) out.maxOutputTokens = Math.floor(maxOut);
  const ctx = Number(overrides.contextWindow);
  if (Number.isFinite(ctx) && ctx >= 4000) out.contextWindow = Math.floor(ctx);
  return out;
}

/**
 * 上下文预算：一次请求里留给**输入文本**的字符数上限。
 *
 * 换算按中文最坏情况 1 token ≈ 1 字符（英文更省，所以这是保守方向），
 * 再从上下文窗口里扣掉输出预算和 15% 的安全余量（system prompt、
 * 工具声明、多轮 tool_result 回灌都要占位）。
 */
function inputCharBudget(caps, plannedMaxTokens) {
  const reserve = Math.max(plannedMaxTokens || 0, caps.maxOutputTokens);
  const usable = Math.floor((caps.contextWindow - reserve) * 0.85);
  return Math.max(usable, 4000); // 再小的模型也至少给 4000 字，否则没法分析
}

module.exports = {
  FALLBACK,
  PROVIDER_CAPABILITIES,
  resolveCapabilities,
  inputCharBudget,
};
