const DEFAULT_KIMI_API_ROOT = "https://api.moonshot.ai/v1";

function resolveKimiApiRoot(host) {
  const raw = String(host || DEFAULT_KIMI_API_ROOT).trim() || DEFAULT_KIMI_API_ROOT;
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

function resolveKimiChatEndpoint(host) {
  return `${resolveKimiApiRoot(host)}/chat/completions`;
}

module.exports = {
  DEFAULT_KIMI_API_ROOT,
  resolveKimiApiRoot,
  resolveKimiChatEndpoint,
};
