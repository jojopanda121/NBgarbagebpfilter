// ============================================================
// server/utils/llmEndpoints.js — MiniMax 端点解析
// 把配置里的 host 规范化为 .../v1，并派生具体端点：
//   - chat/completions   : OpenAI 兼容对话（M3 推理/生成）
//   - coding_plan/search : Token Plan 自带的联网检索
// 国内站默认 https://api.minimaxi.com/v1（注意域名是 minimaxi）。
// ============================================================
const DEFAULT_LLM_API_ROOT = "https://api.minimaxi.com/v1";

function resolveLLMApiRoot(host) {
  const raw = String(host || DEFAULT_LLM_API_ROOT).trim() || DEFAULT_LLM_API_ROOT;
  try {
    const url = new URL(raw);
    let path = url.pathname.replace(/\/+$/, "");
    if (!path || path === "/") path = "/v1";
    if (!/\/v1$/i.test(path)) path = `${path}/v1`;
    url.pathname = path;
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch (_) {
    const cleaned = raw.replace(/\/+$/, "");
    return /\/v1$/i.test(cleaned) ? cleaned : `${cleaned}/v1`;
  }
}

function resolveLLMChatEndpoint(host) {
  return `${resolveLLMApiRoot(host)}/chat/completions`;
}

function resolveLLMSearchEndpoint(host) {
  return `${resolveLLMApiRoot(host)}/coding_plan/search`;
}

module.exports = {
  DEFAULT_LLM_API_ROOT,
  resolveLLMApiRoot,
  resolveLLMChatEndpoint,
  resolveLLMSearchEndpoint,
};
