// ============================================================
// server/services/pptService.js — 一页投资亮点 PPT 生成服务
//
// 流程：
//   1) 聚合 multi-agent 已产出的分析结果（extracted_data + verdict + deep_research）
//   2) 调 LLM（启用 MiniMax M2 web_search 工具）按 schema 抽取一份 onepager JSON
//   3) 严格 schema 校验 + 兜底"暂无"
//   4) 缓存到 tasks.onepager_cache
//   5) 渲染：调 doc-service POST /generate/onepager → 返回 .pptx 二进制流
// ============================================================

const { getDb } = require("../db");
const { callLLMWithSearch } = require("./llmService");
const { extractJson } = require("../utils/jsonParser");
const { ONEPAGER_EXTRACTION_PROMPT } = require("../utils/prompts");
const config = require("../config");
const logger = require("../utils/logger");

const REQUIRED_HIGHLIGHTS = 4;
const REQUIRED_RISKS = 2;
const REQUIRED_PRODUCTS = 3;
const REQUIRED_KPIS = 4;
const REQUIRED_DRIVERS = 3;
const PLACEHOLDER = "暂无";

// ── 工具：把 multi-agent 产出压缩成 LLM 输入 ──

function pickDimensionScores(verdict) {
  const dims = verdict?.dimensions || {};
  const out = {};
  for (const [k, v] of Object.entries(dims)) {
    if (!v) continue;
    out[k] = {
      score: v.score ?? null,
      finding: v.finding || "",
      score_rationale: v.score_rationale || "",
      positive_signals: v.positive_signals || [],
      risk_factors: v.risk_factors || [],
    };
  }
  return out;
}

function pickClaimVerdicts(verdict) {
  const cvs = verdict?.claim_verdicts || [];
  return cvs
    .filter(cv => ["夸大", "严重夸大", "信息不对称", "证伪", "存疑"].includes(cv.verdict))
    .slice(0, 12)
    .map(cv => ({
      verdict: cv.verdict,
      claim: cv.original_claim,
      diff: cv.diff || "",
      severity: cv.severity || "",
    }));
}

function buildLLMInput(task, result, userOverrides) {
  const e = result.extracted_data || {};
  const v = result.verdict || {};

  const ctx = {
    company_name: e.company_name || task.title || "（未知）",
    archive_no: task.archive_number || "",
    extracted_data: {
      industry: e.industry,
      product_name: e.product_name,
      Business_Model: e.Business_Model,
      Growth_Engine: e.Growth_Engine,
      TAM_Million_RMB: e.TAM_Million_RMB,
      CAGR: e.CAGR,
      TRL: e.TRL,
      BP_Valuation: e.BP_Valuation,
      BP_Revenue: e.BP_Revenue,
      project_location: e.project_location,
      founders: e.founders,
      team: e.team,
      customers: e.customers,
      milestones: e.milestones,
    },
    grade: v.grade || "",
    grade_label: v.grade_label || "",
    total_score: task.adjusted_score ?? v.total_score ?? null,
    strengths: v.strengths || [],
    risk_flags: v.risk_flags || [],
    valuation_comparison: v.valuation_comparison || null,
    dimension_scores: pickDimensionScores(v),
    claim_verdicts: pickClaimVerdicts(v),
  };

  // deep_research 全文（截断 8000 字以控 token）
  const dr = result.deep_research || "";
  ctx.deep_research_excerpt = dr.length > 8000 ? dr.slice(0, 8000) + "\n...（已截断）" : dr;

  if (userOverrides && typeof userOverrides === "object") {
    ctx.user_overrides = userOverrides;
  }

  return JSON.stringify(ctx, null, 2);
}

// ── Schema 校验 + 兜底 ──

function pad(arr, n, makeEmpty) {
  const out = Array.isArray(arr) ? arr.slice(0, n) : [];
  while (out.length < n) out.push(makeEmpty(out.length));
  return out;
}

function normalizeOnePager(raw, fallbackName) {
  const json = raw && typeof raw === "object" ? raw : {};

  const company_name = (json.company_name || fallbackName || PLACEHOLDER).toString();
  const headline = (json.headline || PLACEHOLDER).toString();

  const overview = json.company_overview || {};
  const company_overview = {
    summary: (overview.summary || PLACEHOLDER).toString(),
    products: pad(overview.products, REQUIRED_PRODUCTS, (i) => ({
      name: PLACEHOLDER,
      desc: PLACEHOLDER,
    })).map(p => ({
      name: (p?.name || PLACEHOLDER).toString(),
      desc: (p?.desc || PLACEHOLDER).toString(),
    })),
  };

  const market = json.market_opportunity || {};
  const defaultLabels = ["TAM", "CAGR", "渗透率", "增量空间"];
  const defaultDriverTypes = ["政策", "技术", "需求"];
  const market_opportunity = {
    kpis: pad(market.kpis, REQUIRED_KPIS, (i) => ({
      label: defaultLabels[i] || `KPI${i + 1}`,
      value: PLACEHOLDER,
    })).map((k, i) => ({
      label: (k?.label || defaultLabels[i] || `KPI${i + 1}`).toString(),
      value: (k?.value || PLACEHOLDER).toString(),
    })),
    drivers: pad(market.drivers, REQUIRED_DRIVERS, (i) => ({
      type: defaultDriverTypes[i] || `驱动${i + 1}`,
      text: PLACEHOLDER,
    })).map((d, i) => ({
      type: (d?.type || defaultDriverTypes[i] || `驱动${i + 1}`).toString(),
      text: (d?.text || PLACEHOLDER).toString(),
    })),
    competition: (market.competition || PLACEHOLDER).toString(),
  };

  const highlights = pad(json.highlights, REQUIRED_HIGHLIGHTS, () => ({
    title: PLACEHOLDER,
    desc: PLACEHOLDER,
  })).map(h => ({
    title: (h?.title || PLACEHOLDER).toString(),
    desc: (h?.desc || PLACEHOLDER).toString(),
  }));

  const risks = pad(json.risks, REQUIRED_RISKS, () => ({
    title: PLACEHOLDER,
    desc: PLACEHOLDER,
  })).map(r => ({
    title: (r?.title || PLACEHOLDER).toString(),
    desc: (r?.desc || PLACEHOLDER).toString(),
  }));

  const f = json.footer || {};
  const footer = {
    founded: (f.founded || PLACEHOLDER).toString(),
    team_size: (f.team_size || PLACEHOLDER).toString(),
    funding_total: (f.funding_total || PLACEHOLDER).toString(),
    ai_grade: (f.ai_grade || PLACEHOLDER).toString(),
  };

  return {
    company_name,
    headline,
    company_overview,
    market_opportunity,
    highlights,
    risks,
    footer,
  };
}

// ── 主流程 ──

/**
 * 抽取 + 校验 + 缓存 onepager JSON
 *
 * @param {string} taskId
 * @param {object} [userOverrides] 用户在前端可选微调字段
 * @param {boolean} [forceRegenerate]
 * @returns {Promise<{ json: object, generated_at: string, search_used: boolean }>}
 */
async function getOrGenerateOnePager(taskId, userOverrides = null, forceRegenerate = false) {
  const db = getDb();
  const row = db.prepare(
    "SELECT id, result, onepager_cache, title, archive_number, created_at, adjusted_score FROM tasks WHERE id = ?"
  ).get(taskId);
  if (!row) throw new Error("任务不存在");

  // 命中缓存（且未要求重新生成、且无新的覆盖字段）
  if (!forceRegenerate && !userOverrides && row.onepager_cache) {
    try {
      const cached = JSON.parse(row.onepager_cache);
      return cached;
    } catch (e) {
      logger.warn("[onepager] 缓存解析失败，重新生成:", e.message);
    }
  }

  const result = typeof row.result === "string" ? JSON.parse(row.result) : row.result;
  if (!result?.verdict) throw new Error("报告数据不完整，无法生成一页 PPT");

  const fallbackName = result?.extracted_data?.company_name || row.title || "（未知）";
  const llmInput = buildLLMInput(row, result, userOverrides);

  // 调 LLM（启用 web_search）
  const { text, searchUsed } = await callLLMWithSearch(
    ONEPAGER_EXTRACTION_PROMPT,
    llmInput,
    { maxTokens: 4096 }
  );

  let parsed;
  try {
    parsed = extractJson(text);
  } catch (e) {
    logger.error("[onepager] LLM 输出解析失败:", e.message, "原文前 400:", text.slice(0, 400));
    throw new Error("一页 PPT 生成失败：模型输出无法解析");
  }

  const normalized = normalizeOnePager(parsed, fallbackName);
  const cache = {
    json: normalized,
    generated_at: new Date().toISOString(),
    search_used: !!searchUsed,
  };

  db.prepare("UPDATE tasks SET onepager_cache = ? WHERE id = ?")
    .run(JSON.stringify(cache), taskId);

  return cache;
}

/** 强制重新生成（清缓存） */
async function regenerateOnePager(taskId, userOverrides = null) {
  const db = getDb();
  db.prepare("UPDATE tasks SET onepager_cache = NULL WHERE id = ?").run(taskId);
  return getOrGenerateOnePager(taskId, userOverrides, true);
}

/**
 * 渲染 .pptx：调 doc-service /generate/onepager
 * @returns {Promise<Buffer>}
 */
async function renderOnePagerPptx(onepagerJson) {
  if (!config.docServiceUrl) {
    throw new Error("doc-service 未配置（DOC_SERVICE_URL）");
  }
  const resp = await fetch(`${config.docServiceUrl}/generate/onepager`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(onepagerJson),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`doc-service 渲染失败 (${resp.status}): ${t}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

/** 文件名约定：投资要点速览_{公司名}_{YYYYMMDD}.pptx */
function buildPptxFilename(companyName) {
  const safe = (companyName || "未命名").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `投资要点速览_${safe}_${ymd}.pptx`;
}

module.exports = {
  getOrGenerateOnePager,
  regenerateOnePager,
  renderOnePagerPptx,
  buildPptxFilename,
};
