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

const PptxGenJS = require("pptxgenjs");
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
    products: pad(overview.products, REQUIRED_PRODUCTS, () => ({
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
 * 渲染 .pptx：优先调 doc-service /generate/onepager；不可用时降级为 Node 本地 pptxgenjs 渲染。
 * 这样在 PM2 等未起 doc-service 的部署下也能下载 PPT。
 * @returns {Promise<Buffer>}
 */
async function renderOnePagerPptx(onepagerJson) {
  if (config.docServiceUrl) {
    try {
      const resp = await fetch(`${config.docServiceUrl}/generate/onepager`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(onepagerJson),
      });
      if (resp.ok) return Buffer.from(await resp.arrayBuffer());
      const t = await resp.text().catch(() => "");
      logger.warn(`[onepager] doc-service 渲染失败 (${resp.status})，降级为本地 pptxgenjs：${t.slice(0, 200)}`);
    } catch (e) {
      logger.warn("[onepager] doc-service 不可达，降级为本地 pptxgenjs:", e.message);
    }
  }
  return renderOnePagerPptxLocal(onepagerJson);
}

/**
 * Node 本地 pptxgenjs 渲染：版式贴近 Python 版（米白底 + 红底标语 + 双栏 + 4 亮点 + 2 风险 + 页脚）。
 * 单位：英寸。Slide: 13.333 x 7.5 (16:9)
 */
function renderOnePagerPptxLocal(j) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
  pptx.defineLayout({ name: "WIDE_169", width: 13.333, height: 7.5 });
  pptx.layout = "WIDE_169";

  const FONT = "Microsoft YaHei";
  const BG = "FAF7F2";
  const GOLD = "8B6F3F";
  const GOLD_LINE = "C9A96E";
  const RED = "A8292A";
  const RED_LABEL = "C23B3B";
  const BLACK = "1A1A1A";
  const GRAY = "555555";
  const LIGHT = "F1E9DB";
  const GRAY_BG = "EEEAE2";

  const slide = pptx.addSlide();
  slide.background = { color: BG };

  // 标题
  slide.addText(`投资要点速览——${j.company_name || "（未知）"}`, {
    x: 0.55, y: 0.32, w: 12.2, h: 0.6,
    fontFace: FONT, fontSize: 26, bold: true, color: GOLD,
  });
  // 金线
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.55, y: 0.95, w: 12.2, h: 0.025,
    fill: { color: GOLD_LINE }, line: { type: "none" },
  });

  // 红底标语
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.55, y: 1.10, w: 12.2, h: 0.55,
    fill: { color: RED }, line: { type: "none" },
  });
  slide.addText(j.headline || "暂无", {
    x: 0.7, y: 1.10, w: 11.9, h: 0.55,
    fontFace: FONT, fontSize: 16, bold: true, color: "FFFFFF",
    valign: "middle", align: "left",
  });

  // section label helper
  const sectionLabel = (x, y, w, text) => {
    slide.addShape(pptx.ShapeType.rect, {
      x, y, w, h: 0.34, fill: { color: LIGHT }, line: { type: "none" },
    });
    slide.addText(text, {
      x: x + 0.1, y, w: w - 0.2, h: 0.34,
      fontFace: FONT, fontSize: 14, bold: true, color: RED_LABEL, valign: "middle",
    });
  };

  // 左：公司概况
  const LX = 0.55, LW = 5.9, BLOCK_TOP = 1.85;
  sectionLabel(LX, BLOCK_TOP, LW, "公司概况");
  const ovTop = 2.22, ovH = 2.85;
  const ov = j.company_overview || {};
  slide.addText(ov.summary || "暂无", {
    x: LX, y: ovTop, w: LW, h: 1.2,
    fontFace: FONT, fontSize: 11, color: BLACK,
    line: { color: GOLD_LINE, width: 0.5 }, fill: { color: BG },
    margin: 6, valign: "top",
  });
  const products = (ov.products || []).slice(0, 3);
  const pH = (ovH - 1.25) / Math.max(products.length, 1);
  products.forEach((p, i) => {
    slide.addText([
      { text: `${p.name || "暂无"}：`, options: { bold: true, color: RED_LABEL } },
      { text: p.desc || "暂无", options: { color: BLACK } },
    ], {
      x: LX, y: ovTop + 1.25 + pH * i, w: LW, h: pH,
      fontFace: FONT, fontSize: 11, valign: "top", margin: 4,
    });
  });

  // 右：市场机会
  const RX = 6.65, RW = 6.10;
  sectionLabel(RX, BLOCK_TOP, RW, "市场机会与行业速览");
  const mTop = 2.22;
  const m = j.market_opportunity || {};
  const kpis = (m.kpis || []).slice(0, 4);
  const kW = RW / 4;
  kpis.forEach((k, i) => {
    const x = RX + kW * i;
    slide.addText(k.label || "", {
      x, y: mTop + 0.05, w: kW, h: 0.28,
      fontFace: FONT, fontSize: 10, bold: true, color: GRAY, align: "center", valign: "middle",
    });
    slide.addText(k.value || "暂无", {
      x, y: mTop + 0.30, w: kW, h: 0.40,
      fontFace: FONT, fontSize: 13, bold: true, color: RED_LABEL, align: "center", valign: "middle",
    });
  });
  const drvs = (m.drivers || []).slice(0, 3);
  const drvTop = mTop + 0.85, drvH = 0.45;
  drvs.forEach((d, i) => {
    slide.addText([
      { text: `〔${d.type || ""}〕 `, options: { bold: true, color: RED_LABEL } },
      { text: d.text || "暂无", options: { color: BLACK } },
    ], {
      x: RX + 0.1, y: drvTop + drvH * i, w: RW - 0.2, h: drvH,
      fontFace: FONT, fontSize: 10, valign: "top", margin: 2,
    });
  });
  slide.addText([
    { text: "〔竞争格局〕 ", options: { bold: true, color: RED_LABEL } },
    { text: m.competition || "暂无", options: { color: BLACK } },
  ], {
    x: RX + 0.1, y: drvTop + drvH * 3 + 0.05, w: RW - 0.2, h: 0.55,
    fontFace: FONT, fontSize: 10, valign: "top", margin: 2,
  });

  // 投资亮点 4 条 2x2
  const HL_TOP = 5.18;
  sectionLabel(LX, HL_TOP, 12.2, "投资亮点");
  const cellsTop = HL_TOP + 0.40;
  const cellW = (12.2 - 0.30) / 2;
  const cellH = (1.55 - 0.40) / 2;
  (j.highlights || []).slice(0, 4).forEach((h, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = LX + (cellW + 0.30) * col;
    const y = cellsTop + cellH * row;
    slide.addText(`· ${h.title || "暂无"}`, {
      x, y, w: cellW, h: 0.35,
      fontFace: FONT, fontSize: 12, bold: true, color: RED_LABEL, valign: "middle",
    });
    slide.addText(h.desc || "暂无", {
      x: x + 0.18, y: y + 0.32, w: cellW - 0.18, h: cellH - 0.32,
      fontFace: FONT, fontSize: 10, color: BLACK, valign: "top",
    });
  });

  // 风险灰底
  const RISK_TOP = 6.78, RISK_H = 0.55;
  slide.addShape(pptx.ShapeType.rect, {
    x: LX, y: RISK_TOP, w: 12.2, h: RISK_H,
    fill: { color: GRAY_BG }, line: { type: "none" },
  });
  slide.addText("投资风险", {
    x: LX + 0.1, y: RISK_TOP, w: 1.2, h: RISK_H,
    fontFace: FONT, fontSize: 12, bold: true, color: RED_LABEL, valign: "middle",
  });
  const risks = (j.risks || []).slice(0, 2);
  const rAreaX = LX + 1.35;
  const rAreaW = 12.2 - 1.35;
  const rW = rAreaW / Math.max(risks.length, 1);
  risks.forEach((r, i) => {
    slide.addText([
      { text: `${r.title || "暂无"}： `, options: { bold: true, color: RED_LABEL } },
      { text: r.desc || "暂无", options: { color: BLACK } },
    ], {
      x: rAreaX + rW * i, y: RISK_TOP, w: rW, h: RISK_H,
      fontFace: FONT, fontSize: 10, valign: "middle", margin: 4,
    });
  });

  // 页脚
  const f = j.footer || {};
  const footText = `成立年份 ${f.founded || "暂无"}　·　团队规模 ${f.team_size || "暂无"}　·　累计融资 ${f.funding_total || "暂无"}　·　${f.ai_grade || "暂无"}`;
  slide.addText(footText, {
    x: LX, y: 7.05, w: 12.2, h: 0.35,
    fontFace: FONT, fontSize: 9, color: GRAY, valign: "middle",
  });

  return pptx.write({ outputType: "nodebuffer" });
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
