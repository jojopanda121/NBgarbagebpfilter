// ============================================================
// server/services/llm/providers/index.js — Provider 注册表
//
// 一个 provider = 协议种类(kind) + 端点 + 认证方式 + 默认模型 + 域名白名单。
// 换主力厂商（比如将来从 DeepSeek 切回 MiniMax）只改 env 的 LLM_PROVIDER，
// 不改任何调用点代码。
//
// defaultModels 只是**起手值**，不是硬绑定：用户可以填任意模型名，
// 认不出来的模型会拿到 capabilities.js 里的保守兜底能力，宁可少用能力
// 也不让流水线报错。
// ============================================================

const { createOpenAICompatibleClient } = require("./openaiCompatible");
const { createAnthropicClient } = require("./anthropic");
const { resolveCapabilities } = require("../capabilities");

const PROVIDERS = {
  deepseek: {
    id: "deepseek",
    label: "DeepSeek 深度求索",
    kind: "openai",
    defaultHost: "https://api.deepseek.com/v1",
    chatPath: "/v1/chat/completions",
    allowedHostSuffixes: ["api.deepseek.com"],
    defaultModels: { default: "deepseek-v4-flash", heavy: "deepseek-v4-pro", light: "deepseek-v4-flash" },
    suggestedModels: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
    consoleUrl: "https://platform.deepseek.com/api_keys",
  },

  anthropic: {
    id: "anthropic",
    label: "Claude (Anthropic)",
    kind: "anthropic",
    defaultHost: "https://api.anthropic.com",
    chatPath: "/v1/messages",
    allowedHostSuffixes: ["api.anthropic.com"],
    defaultModels: { default: "claude-sonnet-5", heavy: "claude-opus-5", light: "claude-haiku-4-5-20251001" },
    suggestedModels: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001"],
    consoleUrl: "https://console.anthropic.com/settings/keys",
  },

  openai: {
    id: "openai",
    label: "OpenAI ChatGPT",
    kind: "openai",
    defaultHost: "https://api.openai.com/v1",
    chatPath: "/v1/chat/completions",
    allowedHostSuffixes: ["api.openai.com"],
    defaultModels: { default: "gpt-4o", heavy: "gpt-4.1", light: "gpt-4o-mini" },
    suggestedModels: ["gpt-4o", "gpt-4.1", "gpt-4o-mini", "o3", "o4-mini"],
    consoleUrl: "https://platform.openai.com/api-keys",
  },

  gemini: {
    id: "gemini",
    label: "Google Gemini",
    kind: "openai", // 走 Gemini 官方的 OpenAI 兼容端点，不引 SDK
    defaultHost: "https://generativelanguage.googleapis.com",
    chatPath: "/v1beta/openai/chat/completions",
    allowedHostSuffixes: ["generativelanguage.googleapis.com"],
    defaultModels: { default: "gemini-2.5-flash", heavy: "gemini-2.5-pro", light: "gemini-2.5-flash" },
    suggestedModels: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    consoleUrl: "https://aistudio.google.com/apikey",
  },

  minimax: {
    id: "minimax",
    label: "MiniMax 稀宇",
    kind: "openai",
    defaultHost: "https://api.minimax.chat/v1",
    chatPath: "/v1/text/chatcompletion_v2",
    allowedHostSuffixes: ["api.minimax.chat", "api.minimaxi.com"],
    defaultModels: { default: "MiniMax-Text-01", heavy: "MiniMax-Text-01", light: "abab6.5s-chat" },
    suggestedModels: ["MiniMax-Text-01", "MiniMax-M1", "abab6.5s-chat"],
    consoleUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
  },

  moonshot: {
    id: "moonshot",
    label: "月之暗面 Kimi",
    kind: "openai",
    defaultHost: "https://api.moonshot.cn/v1",
    chatPath: "/v1/chat/completions",
    allowedHostSuffixes: ["api.moonshot.cn", "api.moonshot.ai"],
    defaultModels: { default: "moonshot-v1-128k", heavy: "moonshot-v1-128k", light: "moonshot-v1-32k" },
    suggestedModels: ["moonshot-v1-128k", "moonshot-v1-32k", "kimi-k2-0905-preview"],
    consoleUrl: "https://platform.moonshot.cn/console/api-keys",
  },

  qwen: {
    id: "qwen",
    label: "通义千问（阿里云百炼）",
    kind: "openai",
    defaultHost: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    chatPath: "/v1/chat/completions",
    allowedHostSuffixes: ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"],
    defaultModels: { default: "qwen-plus", heavy: "qwen-max", light: "qwen-turbo" },
    suggestedModels: ["qwen-plus", "qwen-max", "qwen-turbo", "qwen3-max"],
    consoleUrl: "https://bailian.console.aliyun.com/?apiKey=1",
  },

  zhipu: {
    id: "zhipu",
    label: "智谱 GLM",
    kind: "openai",
    defaultHost: "https://open.bigmodel.cn/api/paas/v4",
    chatPath: "/chat/completions",
    allowedHostSuffixes: ["open.bigmodel.cn"],
    defaultModels: { default: "glm-4-plus", heavy: "glm-4-plus", light: "glm-4-air" },
    suggestedModels: ["glm-4-plus", "glm-4.5", "glm-4.6", "glm-4-air"],
    consoleUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
};

/**
 * 拼端点。host 可能已经带了部分路径（历史配置 DEEPSEEK_API_HOST 就带 /v1），
 * 所以要把与 chatPath 开头重复的片段去掉再拼，避免出现 /v1/v1/chat/completions。
 */
function buildEndpoint(host, chatPath) {
  let h = String(host || "").trim().replace(/\/+$/, "");
  if (!h) return chatPath;
  if (/\/chat\/completions$/i.test(h) || /\/v1\/messages$/i.test(h) || /chatcompletion_v2$/i.test(h)) {
    return h; // 用户直接填了完整端点
  }
  const segs = chatPath.split("/").filter(Boolean);
  for (let i = segs.length; i > 0; i--) {
    const suffix = `/${segs.slice(0, i).join("/")}`;
    if (h.toLowerCase().endsWith(suffix.toLowerCase())) {
      h = h.slice(0, h.length - suffix.length);
      break;
    }
  }
  return h + chatPath;
}

function getProvider(id) {
  return PROVIDERS[String(id || "").toLowerCase()] || null;
}

function listProviders() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    label: p.label,
    defaultModels: p.defaultModels,
    suggestedModels: p.suggestedModels,
    consoleUrl: p.consoleUrl,
  }));
}

/**
 * 校验自定义 baseURL —— 防 SSRF。
 * 用户能填的 host 必须是 https 且落在该 provider 的官方域名白名单里，
 * 否则本服务器就成了任人驱使的请求跳板（内网探测、云元数据接口等）。
 * 需要私有网关/代理的场景由部署方用 ALLOW_CUSTOM_LLM_ENDPOINT=1 显式开。
 */
function validateHost(providerId, host, { allowCustom = false } = {}) {
  if (!host) return { ok: true };
  let url;
  try {
    url = new URL(String(host).trim());
  } catch (_) {
    return { ok: false, reason: "接口地址不是合法的 URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "接口地址必须是 https" };
  }
  if (allowCustom) return { ok: true };

  const provider = getProvider(providerId);
  if (!provider) return { ok: false, reason: "未知的模型厂商" };
  const hostname = url.hostname.toLowerCase();
  const allowed = provider.allowedHostSuffixes.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
  );
  if (!allowed) {
    return {
      ok: false,
      reason: `该厂商只允许官方域名（${provider.allowedHostSuffixes.join(" / ")}）。如需自建网关，请让管理员开启 ALLOW_CUSTOM_LLM_ENDPOINT`,
    };
  }
  return { ok: true };
}

/**
 * 造一个客户端。返回 { messages: { create, stream } }，
 * 形状与迁移前的 llmClient 一致，llmService 无感。
 *
 * @param {object} args
 * @param {string} args.providerId
 * @param {string} args.apiKey
 * @param {string} [args.baseURL]
 * @param {string} args.model      用于解析能力
 * @param {object} [args.capabilityOverrides]
 */
function createClient({ providerId, apiKey, baseURL, model, capabilityOverrides }) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`未知的模型厂商: ${providerId}`);

  const caps = resolveCapabilities(provider.id, model, capabilityOverrides);
  const endpoint = buildEndpoint(baseURL || provider.defaultHost, provider.chatPath);

  if (provider.kind === "anthropic") {
    return { client: createAnthropicClient({ apiKey, endpoint, caps }), caps, provider, endpoint };
  }
  return {
    client: createOpenAICompatibleClient({ apiKey, endpoint, caps, label: provider.label }),
    caps,
    provider,
    endpoint,
  };
}

module.exports = {
  PROVIDERS,
  getProvider,
  listProviders,
  buildEndpoint,
  validateHost,
  createClient,
};
