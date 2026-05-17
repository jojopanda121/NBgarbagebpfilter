const DEFAULT_MINIMAX_API_ROOT = "https://api.minimaxi.com";

function resolveMinimaxApiRoot(host) {
  const raw = String(host || DEFAULT_MINIMAX_API_ROOT).trim() || DEFAULT_MINIMAX_API_ROOT;
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/, "");
    url.pathname = path.replace(/\/anthropic$/i, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch (_) {
    return raw.replace(/\/+$/, "").replace(/\/anthropic$/i, "") || DEFAULT_MINIMAX_API_ROOT;
  }
}

function resolveAnthropicBaseURL(host) {
  return `${resolveMinimaxApiRoot(host)}/anthropic`;
}

function resolveMinimaxSearchEndpoint(host) {
  return `${resolveMinimaxApiRoot(host)}/v1/coding_plan/search`;
}

function resolveMinimaxImageEndpoint(host) {
  return `${resolveMinimaxApiRoot(host)}/v1/image_generation`;
}

module.exports = {
  DEFAULT_MINIMAX_API_ROOT,
  resolveMinimaxApiRoot,
  resolveAnthropicBaseURL,
  resolveMinimaxSearchEndpoint,
  resolveMinimaxImageEndpoint,
};
