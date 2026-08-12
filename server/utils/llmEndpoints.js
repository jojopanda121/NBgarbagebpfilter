// ============================================================
// server/utils/llmEndpoints.js — 端点解析
//
// LLM：DeepSeek OpenAI 兼容接口，把配置里的 host 规范化为 .../v1，
//      派生 chat/completions。默认 https://api.deepseek.com/v1。
// 检索：DeepSeek API 不提供联网检索，公开信息检索独立走博查 Bocha
//      （https://api.bochaai.com/v1/web-search）。两者 key 相互独立。
// ============================================================
const DEFAULT_LLM_API_ROOT = "https://api.deepseek.com/v1";
const DEFAULT_SEARCH_API_ROOT = "https://api.bochaai.com/v1";

function normalizeV1Root(host, fallback) {
  const raw = String(host || fallback).trim() || fallback;
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

function resolveLLMApiRoot(host) {
  return normalizeV1Root(host, DEFAULT_LLM_API_ROOT);
}

function resolveLLMChatEndpoint(host) {
  return `${resolveLLMApiRoot(host)}/chat/completions`;
}

function resolveSearchApiRoot(host) {
  return normalizeV1Root(host, DEFAULT_SEARCH_API_ROOT);
}

function resolveSearchEndpoint(host) {
  return `${resolveSearchApiRoot(host)}/web-search`;
}

module.exports = {
  DEFAULT_LLM_API_ROOT,
  DEFAULT_SEARCH_API_ROOT,
  resolveLLMApiRoot,
  resolveLLMChatEndpoint,
  resolveSearchApiRoot,
  resolveSearchEndpoint,
};
