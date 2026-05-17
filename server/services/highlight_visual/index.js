const fs = require("fs");
const path = require("path");
const { callLLMJson } = require("../llmService");
const config = require("../../config");
const { resolveMinimaxImageEndpoint } = require("../../utils/minimaxEndpoints");
const { buildImagePrompt } = require("./buildImagePrompt");

const SCHEMA = require("./content_schema.json");
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, "AGENT_SYSTEM_PROMPT.md"), "utf-8");
const IMAGE_TIMEOUT_MS = 90 * 1000;

function withAbortTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, clear: () => clearTimeout(timer) };
}

function normalizeImageBase64(data) {
  const raw = data?.data?.image_base64 || data?.image_base64;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

function normalizeImageUrls(data) {
  const raw = data?.data?.image_urls || data?.image_urls || data?.data?.image_urls_external;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

async function fetchImageUrl(url) {
  const timeout = withAbortTimeout(IMAGE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: timeout.controller.signal });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`图片 URL 下载失败 (${resp.status}): ${text.slice(0, 160)}`);
    }
    return Buffer.from(await resp.arrayBuffer());
  } finally {
    timeout.clear();
  }
}

async function callMiniMaxImage(prompt, opts = {}) {
  const apiKey = config.minimaxApiKey;
  if (!apiKey) throw new Error("MINIMAX_API_KEY 未配置，无法调用 MiniMax Image API");

  const endpoint = resolveMinimaxImageEndpoint(config.minimaxApiHost);
  const body = {
    model: opts.model || config.minimaxImageModel || "image-01",
    prompt: String(prompt || "").slice(0, 1500),
    aspect_ratio: opts.aspectRatio || "16:9",
    response_format: "base64",
    n: 1,
    prompt_optimizer: true,
    aigc_watermark: false,
  };
  if (!body.prompt) throw new Error("MiniMax Image prompt 为空");

  const timeout = withAbortTimeout(opts.timeoutMs || IMAGE_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(endpoint, {
      method: "POST",
      signal: timeout.controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`MiniMax Image API 超时 (${opts.timeoutMs || IMAGE_TIMEOUT_MS}ms)`);
    }
    throw err;
  } finally {
    timeout.clear();
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`MiniMax Image API 错误 (${resp.status}): ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  const baseResp = data?.base_resp;
  if (baseResp && baseResp.status_code != null && baseResp.status_code !== 0) {
    throw new Error(`MiniMax Image API 错误 ${baseResp.status_code}: ${baseResp.status_msg || "unknown"}`);
  }

  const base64Images = normalizeImageBase64(data);
  if (base64Images.length > 0) return Buffer.from(base64Images[0], "base64");

  const urls = normalizeImageUrls(data);
  if (urls.length > 0) return fetchImageUrl(urls[0]);

  const failed = data?.metadata?.failed_count;
  throw new Error(`MiniMax Image API 未返回图片数据${failed ? `，失败数量: ${failed}` : ""}`);
}

async function generateHighlightVisual(materials, opts = {}) {
  if (!materials || typeof materials !== "string" || materials.trim().length < 20) {
    throw new Error("[highlight_visual] 公司材料不足，至少 20 字");
  }

  const result = await callLLMJson(SYSTEM_PROMPT, materials, SCHEMA, {
    maxTokens: opts.maxTokens || 4096,
    maxRepairs: 2,
    useSearch: opts.useSearch !== false,
  });
  const json = result.data;
  const imagePrompt = buildImagePrompt(json);
  const imageBuffer = await callMiniMaxImage(imagePrompt, opts.image || {});

  return {
    json,
    imagePrompt,
    imageBuffer,
    searchUsed: !!result.searchUsed,
    repairs: result.repairs || 0,
  };
}

function buildFilename(json) {
  const company = json?.brand?.company_name || json?.company_name || "未命名";
  const safe = String(company).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `亮点视觉图_${safe}_${ymd}.jpeg`;
}

module.exports = {
  SCHEMA,
  buildFilename,
  buildImagePrompt,
  callMiniMaxImage,
  generateHighlightVisual,
};
