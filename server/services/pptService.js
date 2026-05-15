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
const { COLOR, FONT } = require("./brandTokens");

const REQUIRED_HIGHLIGHTS = 4;
const REQUIRED_RISKS = 2;
const REQUIRED_PRODUCTS = 3;
const REQUIRED_KPIS = 4;
const REQUIRED_DRIVERS = 3;
const PLACEHOLDER = "暂无";

// ── 行业 × 阶段 自适应模板（onepager 路由） ──
// 命中规则：按 keywords 在 industry 字符串中做大小写不敏感的 includes 匹配，
// 首个命中即用；都不命中走 default。
const INDUSTRY_TEMPLATES = {
  saas: {
    name: "SaaS / 软件",
    keywords: ["saas", "软件", "paas", "中间件", "数据库"],
    kpi_labels:   ["TAM", "ARR", "NDR", "毛利率"],
    driver_types: ["政策", "技术", "需求"],
    highlights_focus:
      "团队商业化能力 / 产品-市场契合度（已验证客户）/ 单位经济（CAC、LTV、毛利）/ 续费 & 扩张（NDR）",
  },
  hardtech: {
    name: "硬科技 / 半导体 / 新能源",
    keywords: ["半导体", "芯片", "硬科技", "新能源", "电池", "光伏", "汽车", "材料", "机器人", "航空"],
    kpi_labels:   ["TAM", "TRL", "量产时点", "客户验证"],
    driver_types: ["政策", "技术", "需求"],
    highlights_focus:
      "团队工程能力 / 技术原创性 & 专利护城河 / 客户导入与量产节奏 / 政策与国产替代窗口",
  },
  consumer: {
    name: "消费 / 品牌 / 零售",
    keywords: ["消费", "品牌", "零售", "餐饮", "服饰", "美妆", "酒水", "食品"],
    kpi_labels:   ["TAM", "复购率", "客单价", "渠道占比"],
    driver_types: ["政策", "技术", "需求"],
    highlights_focus:
      "创始团队渠道资源 / 品牌资产与复购 / 客单价与门店模型 / 渠道扩张与流量结构",
  },
  medical: {
    name: "医疗 / 生物 / 器械",
    keywords: ["医疗", "生物", "医药", "创新药", "药物", "制药", "器械", "诊断", "疫苗", "细胞", "基因", "肿瘤", "medical", "biotech", "pharma"],
    kpi_labels:   ["TAM", "临床阶段", "IND-NDA", "医保身位"],
    driver_types: ["政策", "技术", "需求"],
    highlights_focus:
      "学术 / 临床团队 / 管线进度与里程碑 / 同类竞品对照（FIC/BIC）/ 医保 & 集采身位",
  },
  fintech: {
    name: "金融科技 / 数据",
    keywords: ["金融", "支付", "保险", "信贷", "fintech", "数据服务", "风控"],
    kpi_labels:   ["TAM", "AUM/GMV", "Take Rate", "坏账率"],
    driver_types: ["政策", "技术", "需求"],
    highlights_focus:
      "合规牌照 & 风控团队 / 资产质量与坏账 / 客户机构集中度 / 监管周期顺逆风",
  },
  default: {
    name: "通用",
    keywords: [],
    kpi_labels:   ["TAM", "CAGR", "渗透率", "增量空间"],
    driver_types: ["政策", "技术", "需求"],
    highlights_focus:
      "团队 / 产品技术壁垒（已验证部分）/ 商业验证（已落地客户/收入）/ 市场时机或政策",
  },
};

function pickIndustryTemplate(industryStr) {
  const s = String(industryStr || "").toLowerCase();
  for (const [k, t] of Object.entries(INDUSTRY_TEMPLATES)) {
    if (k === "default") continue;
    if (t.keywords.some(kw => s.includes(kw.toLowerCase()))) return { key: k, ...t };
  }
  return { key: "default", ...INDUSTRY_TEMPLATES.default };
}

// 阶段桶：早期 / 成长 / 后期，用于影响 highlights 取舍
const STAGE_BUCKETS = {
  early:  { label: "早期（天使 / 种子 / Pre-A）",  weights: { team: "高", tech: "高", commercial: "低", market: "中" } },
  growth: { label: "成长（A / B）",               weights: { team: "中", tech: "中", commercial: "高", market: "高" } },
  late:   { label: "后期（C / Pre-IPO）",         weights: { team: "中", tech: "中", commercial: "高", market: "高" } },
};

function pickStageBucket(stageStr) {
  const s = String(stageStr || "");
  if (/天使|种子|seed|angel|pre[-_ ]?a/i.test(s)) return { key: "early", ...STAGE_BUCKETS.early };
  if (/(^|[^a-z])a[轮 ]|(^|[^a-z])b[轮 ]|A轮|B轮/.test(s)) return { key: "growth", ...STAGE_BUCKETS.growth };
  if (/c[轮 ]|c\+|d[轮 ]|pre[-_ ]?ipo|c轮|c\+/i.test(s)) return { key: "late", ...STAGE_BUCKETS.late };
  return { key: "early", ...STAGE_BUCKETS.early }; // 未知时按一级市场默认偏早期
}

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

  // 行业 / 阶段 模板路由（一级市场专属）
  const stageRaw = e.stage || e.Funding_Round || e.funding_round || (userOverrides && userOverrides.funding_round) || "";
  const industryRaw = e.industry || e.Industry || "";
  const tmpl = pickIndustryTemplate(industryRaw);
  const stageBucket = pickStageBucket(stageRaw);

  const ctx = {
    template_hint: {
      industry_template: tmpl.name,
      kpi_labels: tmpl.kpi_labels,            // 必须按此顺序填 4 个 KPI label
      driver_types: tmpl.driver_types,        // 必须按此顺序填 3 个 driver type
      highlights_focus: tmpl.highlights_focus,
      stage_bucket: stageBucket.label,
      stage_weights: stageBucket.weights,     // 影响 highlights 分布的权重提示
    },
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

function normalizeOnePager(raw, fallbackName, template) {
  const json = raw && typeof raw === "object" ? raw : {};
  const tmpl = template || INDUSTRY_TEMPLATES.default;

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
  const defaultLabels = tmpl.kpi_labels;
  const defaultDriverTypes = tmpl.driver_types;
  const market_opportunity = {
    // 强制 KPI label 走模板：模型若返回不一致的 label，按位覆盖回模板的 label，保留 value
    kpis: pad(market.kpis, REQUIRED_KPIS, (i) => ({
      label: defaultLabels[i] || `KPI${i + 1}`,
      value: PLACEHOLDER,
    })).map((k, i) => ({
      label: (defaultLabels[i] || k?.label || `KPI${i + 1}`).toString(),
      value: (k?.value || PLACEHOLDER).toString(),
    })),
    drivers: pad(market.drivers, REQUIRED_DRIVERS, (i) => ({
      type: defaultDriverTypes[i] || `驱动${i + 1}`,
      text: PLACEHOLDER,
    })).map((d, i) => ({
      type: (defaultDriverTypes[i] || d?.type || `驱动${i + 1}`).toString(),
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
  const e = result.extracted_data || {};
  const tmpl = pickIndustryTemplate(e.industry || e.Industry);
  const stageBucket = pickStageBucket(
    e.stage || e.Funding_Round || e.funding_round || (userOverrides && userOverrides.funding_round)
  );
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

  const normalized = normalizeOnePager(parsed, fallbackName, tmpl);
  const cache = {
    json: normalized,
    generated_at: new Date().toISOString(),
    search_used: !!searchUsed,
    template: { industry_key: tmpl.key, industry: tmpl.name, stage_key: stageBucket.key, stage: stageBucket.label },
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
 * 直接基于用户提供的文本材料抽取 onepager JSON.
 * 不依赖 latest_task_id, 不写 DB 缓存. 用于 OnePager 的 "materials" 双模式.
 *
 * @param {string} materials       公司原始材料 (BP / 招股书 / 调研笔记原文)
 * @param {object} [opts]
 * @param {string} [opts.companyHint]   公司名提示, 写入 LLM 输入起首
 * @param {object} [opts.userOverrides] 同 getOrGenerateOnePager 的人工微调字段
 * @returns {Promise<{ json: object, generated_at: string, search_used: boolean }>}
 */
async function generateOnePagerFromMaterials(materials, opts = {}) {
  const { companyHint = "", userOverrides = null } = opts;
  if (!materials || typeof materials !== "string" || materials.trim().length < 20) {
    throw new Error("公司材料不足, 至少 20 字");
  }

  // 用 industry/stage 模板兜底 (无 task 时只能走 default)
  const tmpl = pickIndustryTemplate("");
  const stageBucket = pickStageBucket(userOverrides?.funding_round || "");

  // 组装 LLM 输入: 模拟 buildLLMInput 的格式, 但用纯文本材料代替 task row.
  const parts = [];
  if (companyHint) parts.push(`【目标公司】${companyHint}`);
  if (userOverrides && Object.keys(userOverrides).length > 0) {
    parts.push(`【人工微调字段】${JSON.stringify(userOverrides, null, 2)}`);
  }
  parts.push("【公司原始材料】", materials);
  const llmInput = parts.join("\n\n");

  const { text, searchUsed } = await callLLMWithSearch(
    ONEPAGER_EXTRACTION_PROMPT,
    llmInput,
    { maxTokens: 4096 }
  );

  let parsed;
  try {
    parsed = extractJson(text);
  } catch (e) {
    logger.error("[onepager-materials] LLM 输出解析失败:", e.message, "原文前 400:", text.slice(0, 400));
    throw new Error("一页 PPT 生成失败：模型输出无法解析");
  }

  const fallbackName = companyHint || parsed?.company_name || "（未知）";
  const normalized = normalizeOnePager(parsed, fallbackName, tmpl);
  return {
    json: normalized,
    generated_at: new Date().toISOString(),
    search_used: !!searchUsed,
    template: { industry_key: tmpl.key, industry: tmpl.name, stage_key: stageBucket.key, stage: stageBucket.label },
  };
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

  // 颜色 / 字体一律走 brandTokens, 与网页 :root 同源
  const FONT_FACE = FONT.cnSans;     // 正文 (PingFang SC, 回退到 DM Sans for latin)
  const BG = COLOR.bg;               // 页底浅灰
  const TITLE_FG = COLOR.navy;       // 标题色 (深海军蓝)
  const RULE = COLOR.accent;         // 标题下细线 (品牌蓝)
  const BANNER = COLOR.navy;         // 主横幅 (深海军蓝)
  const LABEL_FG = COLOR.accent;     // 板块标签 + 内联强调 (品牌蓝)
  const BLACK = COLOR.ink;           // 主文字
  const GRAY = COLOR.mid;            // 次级文字 (页脚 / KPI 标签)
  const LIGHT = COLOR.bg3;           // 板块标签胶囊底 (浅蓝灰)
  const RISK_BG = COLOR.redBg;       // 风险板块底 (语义浅红)
  const RISK_FG = COLOR.red;         // 风险板块文字 (语义红)

  const slide = pptx.addSlide();
  slide.background = { color: BG };

  // 标题
  slide.addText(`投资要点速览——${j.company_name || "（未知）"}`, {
    x: 0.55, y: 0.32, w: 12.2, h: 0.6,
    fontFace: FONT_FACE, fontSize: 26, bold: true, color: TITLE_FG,
  });
  // 金线
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.55, y: 0.95, w: 12.2, h: 0.025,
    fill: { color: RULE }, line: { type: "none" },
  });

  // 红底标语
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.55, y: 1.10, w: 12.2, h: 0.55,
    fill: { color: BANNER }, line: { type: "none" },
  });
  slide.addText(j.headline || "暂无", {
    x: 0.7, y: 1.10, w: 11.9, h: 0.55,
    fontFace: FONT_FACE, fontSize: 16, bold: true, color: "FFFFFF",
    valign: "middle", align: "left",
  });

  // section label helper
  const sectionLabel = (x, y, w, text) => {
    slide.addShape(pptx.ShapeType.rect, {
      x, y, w, h: 0.34, fill: { color: LIGHT }, line: { type: "none" },
    });
    slide.addText(text, {
      x: x + 0.1, y, w: w - 0.2, h: 0.34,
      fontFace: FONT_FACE, fontSize: 14, bold: true, color: LABEL_FG, valign: "middle",
    });
  };

  // 左：公司概况
  const LX = 0.55, LW = 5.9, BLOCK_TOP = 1.85;
  sectionLabel(LX, BLOCK_TOP, LW, "公司概况");
  const ovTop = 2.22, ovH = 2.85;
  const ov = j.company_overview || {};
  slide.addText(ov.summary || "暂无", {
    x: LX, y: ovTop, w: LW, h: 1.2,
    fontFace: FONT_FACE, fontSize: 11, color: BLACK,
    line: { color: RULE, width: 0.5 }, fill: { color: BG },
    margin: 6, valign: "top",
  });
  const products = (ov.products || []).slice(0, 3);
  const pH = (ovH - 1.25) / Math.max(products.length, 1);
  products.forEach((p, i) => {
    slide.addText([
      { text: `${p.name || "暂无"}：`, options: { bold: true, color: LABEL_FG } },
      { text: p.desc || "暂无", options: { color: BLACK } },
    ], {
      x: LX, y: ovTop + 1.25 + pH * i, w: LW, h: pH,
      fontFace: FONT_FACE, fontSize: 11, valign: "top", margin: 4,
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
      fontFace: FONT_FACE, fontSize: 10, bold: true, color: GRAY, align: "center", valign: "middle",
    });
    slide.addText(k.value || "暂无", {
      x, y: mTop + 0.30, w: kW, h: 0.40,
      fontFace: FONT_FACE, fontSize: 13, bold: true, color: LABEL_FG, align: "center", valign: "middle",
    });
  });
  const drvs = (m.drivers || []).slice(0, 3);
  const drvTop = mTop + 0.85, drvH = 0.45;
  drvs.forEach((d, i) => {
    slide.addText([
      { text: `〔${d.type || ""}〕 `, options: { bold: true, color: LABEL_FG } },
      { text: d.text || "暂无", options: { color: BLACK } },
    ], {
      x: RX + 0.1, y: drvTop + drvH * i, w: RW - 0.2, h: drvH,
      fontFace: FONT_FACE, fontSize: 10, valign: "top", margin: 2,
    });
  });
  slide.addText([
    { text: "〔竞争格局〕 ", options: { bold: true, color: LABEL_FG } },
    { text: m.competition || "暂无", options: { color: BLACK } },
  ], {
    x: RX + 0.1, y: drvTop + drvH * 3 + 0.05, w: RW - 0.2, h: 0.55,
    fontFace: FONT_FACE, fontSize: 10, valign: "top", margin: 2,
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
      fontFace: FONT_FACE, fontSize: 12, bold: true, color: LABEL_FG, valign: "middle",
    });
    slide.addText(h.desc || "暂无", {
      x: x + 0.18, y: y + 0.32, w: cellW - 0.18, h: cellH - 0.32,
      fontFace: FONT_FACE, fontSize: 10, color: BLACK, valign: "top",
    });
  });

  // 风险板块 (语义红浅底 + 语义红文字)
  const RISK_TOP = 6.78, RISK_H = 0.55;
  slide.addShape(pptx.ShapeType.rect, {
    x: LX, y: RISK_TOP, w: 12.2, h: RISK_H,
    fill: { color: RISK_BG }, line: { type: "none" },
  });
  slide.addText("投资风险", {
    x: LX + 0.1, y: RISK_TOP, w: 1.2, h: RISK_H,
    fontFace: FONT_FACE, fontSize: 12, bold: true, color: RISK_FG, valign: "middle",
  });
  const risks = (j.risks || []).slice(0, 2);
  const rAreaX = LX + 1.35;
  const rAreaW = 12.2 - 1.35;
  const rW = rAreaW / Math.max(risks.length, 1);
  risks.forEach((r, i) => {
    slide.addText([
      { text: `${r.title || "暂无"}： `, options: { bold: true, color: RISK_FG } },
      { text: r.desc || "暂无", options: { color: BLACK } },
    ], {
      x: rAreaX + rW * i, y: RISK_TOP, w: rW, h: RISK_H,
      fontFace: FONT_FACE, fontSize: 10, valign: "middle", margin: 4,
    });
  });

  // 页脚
  const f = j.footer || {};
  const footText = `成立年份 ${f.founded || "暂无"}　·　团队规模 ${f.team_size || "暂无"}　·　累计融资 ${f.funding_total || "暂无"}　·　${f.ai_grade || "暂无"}`;
  slide.addText(footText, {
    x: LX, y: 7.05, w: 12.2, h: 0.35,
    fontFace: FONT_FACE, fontSize: 9, color: GRAY, valign: "middle",
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
  generateOnePagerFromMaterials,
  renderOnePagerPptx,
  buildPptxFilename,
  normalizeOnePager,
};
