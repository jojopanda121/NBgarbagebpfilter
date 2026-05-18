const fs = require("fs");
const path = require("path");
const { callLLMJson } = require("../llmService");
const { buildImagePrompt } = require("./buildImagePrompt");
const { renderHighlightPng } = require("./render");

const SCHEMA = require("./content_schema.json");
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, "AGENT_SYSTEM_PROMPT.md"), "utf-8");

async function generateHighlightVisual(materials, opts = {}) {
  if (!materials || typeof materials !== "string" || materials.trim().length < 20) {
    throw new Error("[highlight_visual] 公司材料不足，至少 20 字");
  }

  const result = await callLLMJson(SYSTEM_PROMPT, materials, SCHEMA, {
    maxTokens: opts.maxTokens || 4096,
    maxRepairs: 2,
    useSearch: opts.useSearch !== false,
    preSearchQueries: opts.searchQueries || [],
  });
  const json = result.data;
  // 软校验：template_used 与对应 block 必须配对，否则把 template_used 改为 generic_kpi 并记 reason
  // 渲染层 MiddleSpotlight 已有 fallback，但显式 normalize 让下游 (artifact payload) 状态一致。
  const wanted = json?.template_used;
  if (wanted && wanted !== "generic_kpi" && !json?.[wanted]) {
    json.template_fallback_reason =
      `LLM 选定 template_used=${wanted} 但未提供对应数据块，已降级为 generic_kpi` +
      (json.template_fallback_reason ? ` (原 reason: ${json.template_fallback_reason})` : "");
    json.template_used = "generic_kpi";
  }
  const imagePrompt = buildImagePrompt(json); // 仅作调试回显，不再用于绘图
  const imageBuffer = await renderHighlightPng(json);

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
  return `亮点视觉图_${safe}_${ymd}.png`;
}

module.exports = {
  SCHEMA,
  buildFilename,
  buildImagePrompt,
  generateHighlightVisual,
  renderHighlightPng,
};
