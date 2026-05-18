// ============================================================
// server/skills/_factPack.js
//
// Standardized artifact harness 的事实包层。
// Skill Agent 不直接吃一整坨项目上下文自由发挥，而是吃带编号的事实清单。
// 下游 JSON 中的 source_refs 必须引用这里的 fact_id (F/C/K)。
//
// 证据优先级（**冲突时高优先级胜出**）：
//   0. 证据冲突 alert (C 编号)              ← 最先注意
//   1. 用户上传资料-结构化 (F · upload_structured)
//   2. 用户上传资料-原文摘录/摘要 (F · upload)
//   3. 实时搜索 / 外部交叉验证 (F · external_search)
//   4. 旧 BP 分析 / 项目结构化数据 (F · project_context)
//   5. BP 原文 / BP 自报 (F · bp_self_report)            ← **最低**
//   6. 机构历史先例 (K · institutional_memory)            ← **仅参考，不是事实**
//
// 注：旧的 source_type "bp_deep_parsing" 已废弃，不再注入。
// ============================================================

const { buildContext } = require("./_projectContext");
const fs = require("fs");
const { getDb } = require("../db");
const evidenceStore = require("../services/evidenceStore");

const EMPTY_VALUES = new Set(["", "暂无", "未披露", "null", "undefined"]);

function isUsefulValue(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return !EMPTY_VALUES.has(String(value).trim());
}

function compactValue(value, max = 360) {
  if (value == null) return "";
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function pushFact(facts, { field, label, value, sourceType, sourceName, sourceRef, sourceUrl, confidence = "medium", artifactId, filename, evidenceLevel }) {
  if (!isUsefulValue(value)) return;
  // 临时 id；最终在 buildEvidencePack 末尾会被 _renumberFFacts 重排成 F001..FN。
  const id = `F${String(facts.length + 1).padStart(3, "0")}`;
  facts.push({
    id,
    field,
    label: label || field,
    value: compactValue(value),
    source_type: sourceType || "project_context",
    source_name: sourceName || "workspace",
    source_ref: sourceRef || "",
    source_url: sourceUrl || "",
    artifact_id: artifactId || null,
    filename: filename || null,
    confidence,
    evidence_level: evidenceLevel || evidenceStore.evidenceLevelForSource(sourceType || "project_context"),
  });
}

// 按数组当前顺序重排所有 F 前缀 fact → F001..FN（不动 C/K 前缀）。
function _renumberFFacts(facts) {
  let i = 1;
  for (const f of facts) {
    if (typeof f.id === "string" && f.id.startsWith("F")) {
      f.id = `F${String(i).padStart(3, "0")}`;
      i++;
    }
  }
}

function addObjectFacts(facts, prefix, obj, labelMap = {}, sourceName = "项目结构化字段", sourceType = "project_context") {
  if (!obj || typeof obj !== "object") return;
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value) || (value && typeof value === "object")) continue;
    pushFact(facts, {
      field: `${prefix}.${key}`,
      label: labelMap[key] || key,
      value,
      sourceType,
      sourceName,
      confidence: "high",
    });
  }
}

function buildFactPack(project, opts = {}) {
  const ctx = buildContext(project);
  const facts = [];

  addObjectFacts(facts, "project", ctx.project, {
    name: "公司名称",
    one_liner: "一句话定位",
    industry: "行业",
    sub_industry: "细分行业",
    business_model: "商业模式",
    stage: "项目阶段",
    region: "地区",
    latest_score: "最新评分",
  }, "项目主数据", "project_context");

  // BP 声称类字段单独归入 bp_self_report（最低优先级）。
  addObjectFacts(facts, "latest_version", ctx.latest_version, {
    claimed_valuation: "BP 声称估值",
    claimed_revenue: "BP 声称收入",
    claimed_users: "BP 声称用户",
    funding_round: "融资轮次",
    funding_amount: "融资金额",
    total_score: "版本评分",
  }, "最新 BP 版本(自报)", "bp_self_report");

  // BP 抽取字段：商业模式、TAM、CAGR 这些虽然结构化，但底层还是 BP，
  // 留在 project_context 但 confidence 视为 medium。
  addObjectFacts(facts, "extracted_data", ctx.extracted_data, {
    company_name: "材料识别公司名",
    industry: "材料识别行业",
    product_name: "产品名称",
    Business_Model: "商业模式",
    Growth_Engine: "增长引擎",
    TAM_Million_RMB: "TAM(百万人民币)",
    CAGR: "CAGR",
    TRL: "技术成熟度 TRL",
    BP_Valuation: "BP 估值",
    BP_Revenue: "BP 收入",
    Founder_Exp_Years: "创始人相关从业年限",
  }, "BP 提取字段(旧 BP 分析)", "project_context");

  const verdict = ctx.verdict || {};
  pushFact(facts, {
    field: "verdict.total_score",
    label: "综合评分",
    value: verdict.total_score,
    sourceType: "project_context",
    sourceName: "多 Agent 评分",
    confidence: "high",
  });
  for (const s of verdict.strengths || []) {
    pushFact(facts, {
      field: "verdict.strengths",
      label: "优势信号",
      value: s,
      sourceType: "project_context",
      sourceName: "多 Agent 结论",
      confidence: "medium",
    });
  }
  for (const r of verdict.risk_flags || []) {
    pushFact(facts, {
      field: "verdict.risk_flags",
      label: "风险信号",
      value: r,
      sourceType: "project_context",
      sourceName: "多 Agent 结论",
      confidence: "medium",
    });
  }

  for (const [dim, val] of Object.entries(verdict.dimensions || {})) {
    pushFact(facts, {
      field: `verdict.dimensions.${dim}.score`,
      label: `${dim} 评分`,
      value: val?.score,
      sourceType: "project_context",
      sourceName: "维度评分",
      confidence: "high",
    });
    pushFact(facts, {
      field: `verdict.dimensions.${dim}.finding`,
      label: `${dim} 发现`,
      value: val?.finding,
      sourceType: "project_context",
      sourceName: "维度分析",
      confidence: "medium",
    });
    for (const risk of val?.risk_factors || []) {
      pushFact(facts, {
        field: `verdict.dimensions.${dim}.risk_factors`,
        label: `${dim} 风险`,
        value: risk,
        sourceType: "project_context",
        sourceName: "维度分析",
        confidence: "medium",
      });
    }
  }

  for (const claim of ctx.claim_verdicts || []) {
    pushFact(facts, {
      field: "claim_verdicts",
      label: `声明核查-${claim.verdict || "待核实"}`,
      value: [
        claim.category ? `类别:${claim.category}` : "",
        claim.claim ? `声明:${claim.claim}` : "",
        claim.diff ? `差异:${claim.diff}` : "",
        claim.severity ? `严重度:${claim.severity}` : "",
      ].filter(Boolean).join("；"),
      sourceType: "project_context",
      sourceName: "BP 声明核查",
      confidence: ["证伪", "严重夸大", "夸大"].includes(claim.verdict) ? "high" : "medium",
    });
  }

  if (ctx.deep_research_excerpt) {
    pushFact(facts, {
      field: "deep_research_excerpt",
      label: "深度研究摘录",
      value: ctx.deep_research_excerpt,
      sourceType: "project_context",
      sourceName: "深度研究",
      confidence: "medium",
    });
  }

  const factPack = {
    project_name: ctx.project?.name || ctx.extracted_data?.company_name || "未命名项目",
    generated_at: new Date().toISOString(),
    facts: facts.slice(0, opts.maxFacts || 80),
    missing_policy:
      "如果 facts 中没有支撑某字段的信息，必须写「未披露/待核实/需访谈确认」，不得编造。",
  };

  return { context: ctx, factPack };
}

function _readSidecar(storagePath, maxChars = 2400) {
  if (!storagePath) return "";
  const sidecar = `${storagePath}.extracted.txt`;
  if (!fs.existsSync(sidecar)) return "";
  try {
    const text = fs.readFileSync(sidecar, "utf-8").replace(/\s+/g, " ").trim();
    return text.length > maxChars ? `${text.slice(0, maxChars)}...（上传材料已截断）` : text;
  } catch (_) {
    return "";
  }
}

function appendUploadFacts(facts, conversationId, opts = {}) {
  if (!conversationId) return { uploadCount: 0 };
  const projectId = opts.projectId || opts.ctx?.projectId || null;
  const query = [opts.materialsHint, opts.companyHint, opts.industryHint].filter(Boolean).join(" ");
  try {
    const db = getDb();
    const chunks = evidenceStore.searchUploadExcerpts({
      db,
      projectId,
      conversationId,
      query,
      limit: opts.maxUploadChunks || 8,
    });
    if (chunks.length) {
      for (const c of chunks) {
        pushFact(facts, {
          field: "upload.excerpt",
          label: `上传材料摘录-${c.source_ref || c.artifact_id || "chunk"}`,
          value: c.chunk_text,
          sourceType: "upload",
          sourceName: c.source_ref || "上传材料",
          sourceRef: c.chunk_id || c.artifact_id,
          artifactId: c.artifact_id,
          confidence: "high",
          evidenceLevel: 2,
        });
      }
      return { uploadCount: chunks.length };
    }
  } catch (_) {
    // Fall through to legacy sidecar reads.
  }
  const maxUploads = opts.maxUploads || 8;
  const db = getDb();
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT id, filename, summary, storage_path, created_at
       FROM workspace_artifacts
       WHERE conversation_id = ? AND kind = 'upload'
       ORDER BY created_at DESC LIMIT ?`
    ).all(conversationId, maxUploads);
  } catch (_) {
    rows = [];
  }
  for (const row of rows) {
    pushFact(facts, {
      field: "upload.summary",
      label: `用户上传材料-${row.filename}`,
      value: row.summary || _readSidecar(row.storage_path, 900),
      sourceType: "upload",
      sourceName: row.filename,
      sourceRef: row.id,
      artifactId: row.id,
      filename: row.filename,
      confidence: "high",
    });
    const excerpt = _readSidecar(row.storage_path, opts.uploadExcerptChars || 2600);
    if (excerpt) {
      pushFact(facts, {
        field: "upload.excerpt",
        label: `上传材料正文-${row.filename}`,
        value: excerpt,
        sourceType: "upload",
        sourceName: row.filename,
        sourceRef: row.id,
        artifactId: row.id,
        filename: row.filename,
        confidence: "high",
      });
    }
  }
  return { uploadCount: rows.length };
}

// ──────────────────────────────────────────────────────────────
// 用户上传资料-结构化抽取 facts（最高优先级，旧 bp_deep_parsing 的替代）
// ──────────────────────────────────────────────────────────────
function appendUploadStructuredFacts(facts, conversationId, opts = {}) {
  if (!conversationId) return { used: false, factCount: 0, artifactCount: 0, errorCount: 0 };
  const projectId = opts.projectId || opts.ctx?.projectId || null;
  try {
    const db = getDb();
    const rows = evidenceStore.listStructuredFactsForEvidencePack({
      db,
      projectId,
      conversationId,
      limit: opts.maxStructuredFacts || 120,
    });
    if (rows.length) {
      for (const f of rows) {
        facts.push({
          id: `F${String(facts.length + 1).padStart(3, "0")}`,
          field: f.field,
          label: f.label,
          value: compactValue(f.value),
          source_type: f.source_type,
          source_name: f.source_name,
          source_ref: f.source_ref || "",
          source_url: f.source_url || "",
          artifact_id: f.artifact_id || null,
          filename: f.filename || null,
          confidence: f.confidence || "medium",
          evidence_level: 1,
        });
      }
      return { used: true, factCount: rows.length, artifactCount: new Set(rows.map((r) => r.artifact_id).filter(Boolean)).size, errorCount: 0 };
    }
  } catch (_) {
    // Fall through to legacy extraction table.
  }
  let rows = [];
  let errorRows = 0;
  try {
    const db = getDb();
    const upload = require("../services/extraction/uploadStructuredExtraction");
    rows = upload.listStructuredExtractsForConversation(db, conversationId, { limit: opts.maxStructured || 12 });
    // 顺便数一下 error / pending 行用于 metadata
    try {
      const errs = db.prepare(
        `SELECT COUNT(1) AS c FROM workspace_artifact_structured_extracts
         WHERE conversation_id = ? AND extraction_status IN ('error', 'pending', 'running')`
      ).get(conversationId);
      errorRows = errs?.c || 0;
    } catch (_) { /* table may not exist */ }
  } catch (_) {
    rows = [];
  }
  if (!rows.length) {
    return { used: false, factCount: 0, artifactCount: 0, errorCount: errorRows };
  }
  const { flattenStructuredToFacts } = require("../services/extraction/uploadStructuredExtraction");
  let total = 0;
  for (const r of rows) {
    const flat = flattenStructuredToFacts(r.structured, { artifactId: r.artifactId, filename: r.filename });
    for (const f of flat) {
      const id = `F${String(facts.length + 1).padStart(3, "0")}`;
      facts.push({
        id,
        field: f.field,
        label: f.label,
        value: compactValue(f.value),
        source_type: f.source_type,
        source_name: f.source_name,
        source_ref: f.source_ref || "",
        source_url: "",
        artifact_id: f.artifact_id || null,
        filename: f.filename || null,
        confidence: f.confidence,
        evidence_level: 1,
      });
      total++;
    }
  }
  return { used: total > 0, factCount: total, artifactCount: rows.length, errorCount: errorRows };
}

// ──────────────────────────────────────────────────────────────
// 冲突检测：upload_structured 与 project_context (旧 BP 分析) 字段冲突
//   → 生成 C 编号 evidence_conflict fact，优先级最高，强提醒。
//
// 当前覆盖的字段：
//   - 收入 (revenue / BP_Revenue / claimed_revenue)
//   - 估值 (valuation / BP_Valuation / claimed_valuation)
//   - 客户集中度 (concentration_top3_pct)
//   - 现金 / runway
// 都是只看上传 vs 旧 BP/BP 自报的不同；如果两边都没有就静默。
// ──────────────────────────────────────────────────────────────
function _factsByPrefix(facts, prefix) {
  return facts.filter((f) => (f.field || "").startsWith(prefix));
}
function _firstNumber(text) {
  if (typeof text !== "string") return null;
  // 抓第一个带小数的 number；忽略前缀单位、忽略 % 后缀
  const m = text.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function _hasConflict(uploadVal, otherVal, relTol = 0.2) {
  if (uploadVal == null || otherVal == null) return false;
  if (uploadVal === 0 && otherVal === 0) return false;
  const denom = Math.max(Math.abs(uploadVal), Math.abs(otherVal), 1);
  return Math.abs(uploadVal - otherVal) / denom > relTol;
}

const CONFLICT_RULES = [
  {
    key: "revenue",
    label: "收入",
    uploadFieldRegex: /^upload\.financials\.revenue$/,
    otherFieldRegex: /(extracted_data\.BP_Revenue|latest_version\.claimed_revenue)/,
  },
  {
    key: "valuation",
    label: "估值",
    uploadFieldRegex: /^upload\.cap_table\.(pre_money|post_money)$/,
    otherFieldRegex: /(extracted_data\.BP_Valuation|latest_version\.claimed_valuation)/,
  },
  {
    key: "concentration_top3_pct",
    label: "前 3 大客户占比",
    uploadFieldRegex: /^upload\.customers\.concentration_top3_pct$/,
    otherFieldRegex: /(verdict\..*top3|customers\.concentration_top3)/,
  },
  {
    key: "cash",
    label: "现金余额",
    uploadFieldRegex: /^upload\.financials\.cash$/,
    otherFieldRegex: /(extracted_data\.Cash|project\.cash)/,
  },
];

function appendConflictFacts(facts) {
  const conflicts = [];
  for (const rule of CONFLICT_RULES) {
    const uploads = facts.filter((f) => rule.uploadFieldRegex.test(f.field || ""));
    if (!uploads.length) continue;
    const others = facts.filter((f) => rule.otherFieldRegex.test(f.field || ""));
    if (!others.length) continue;
    for (const u of uploads) {
      const uNum = _firstNumber(u.value);
      if (uNum == null) continue;
      for (const o of others) {
        const oNum = _firstNumber(o.value);
        if (oNum == null) continue;
        if (_hasConflict(uNum, oNum)) {
          conflicts.push({
            rule,
            upload: u,
            other: o,
            uploadVal: uNum,
            otherVal: oNum,
          });
        }
      }
    }
  }
  // 写入 C 编号 facts，放到 facts 数组开头（最先被 LLM 读到）
  const conflictFacts = [];
  let seq = 1;
  for (const c of conflicts) {
    const id = `C${String(seq).padStart(3, "0")}`;
    seq++;
    conflictFacts.push({
      id,
      field: `conflict.${c.rule.key}`,
      label: `证据冲突-${c.rule.label}`,
      value: `上传资料: ${c.upload.value} (${c.upload.source_name})；旧 BP 分析/BP 自报: ${c.other.value} (${c.other.source_name})。优先级：上传资料胜出 (${c.rule.key})。`,
      source_type: "evidence_conflict",
      source_name: "证据冲突检测",
      source_ref: `${c.upload.id}↔${c.other.id}`,
      source_url: "",
      confidence: "high",
      evidence_level: 0,
      upload_fact_id: c.upload.id,
      other_fact_id: c.other.id,
      winner: "upload_structured",
    });
  }
  // 倒插：保证 C 编号在 facts 数组最前面
  for (let i = conflictFacts.length - 1; i >= 0; i--) facts.unshift(conflictFacts[i]);
  return { conflictFactCount: conflictFacts.length, conflicts: conflictFacts };
}

function appendPersistedConflictFacts(facts, projectId, opts = {}) {
  if (!projectId) return { conflictFactCount: 0, conflicts: [] };
  try {
    const db = getDb();
    if (!evidenceStore.tableExists(db, "conflicts")) return { conflictFactCount: 0, conflicts: [] };
    const rows = db.prepare(
      `SELECT conflict_id, field, sources, severity, status, conflict_json, updated_at
       FROM conflicts
       WHERE project_id = ? AND status IN ('open', 'needs_review')
       ORDER BY CASE severity
          WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          updated_at DESC
       LIMIT ?`
    ).all(projectId, opts.maxPersistedConflicts || 12);
    const start = facts.filter((f) => f.id?.startsWith("C")).length + 1;
    const out = rows.map((r, idx) => {
      let parsed = {};
      let sources = [];
      try { parsed = JSON.parse(r.conflict_json || "{}"); } catch (_) {}
      try { sources = JSON.parse(r.sources || "[]"); } catch (_) {}
      return {
        id: `C${String(start + idx).padStart(3, "0")}`,
        field: `conflict.${r.field || "ai_judge"}`,
        label: `AI Judge 冲突/红旗-${r.severity}`,
        value: parsed.summary || `${r.field}: ${sources.join("；")}`,
        source_type: "evidence_conflict",
        source_name: "AI Judge 冲突检测",
        source_ref: sources.join(", ") || r.conflict_id,
        source_url: "",
        confidence: r.severity === "critical" || r.severity === "high" ? "high" : "medium",
        evidence_level: 0,
        conflict_id: r.conflict_id,
        severity: r.severity,
      };
    });
    for (let i = out.length - 1; i >= 0; i--) facts.unshift(out[i]);
    return { conflictFactCount: out.length, conflicts: out };
  } catch (_) {
    return { conflictFactCount: 0, conflicts: [] };
  }
}

function _factValue(factPack, fieldRegex, labelRegex) {
  const facts = factPack?.facts || [];
  const f = facts.find((x) => (
    (fieldRegex && fieldRegex.test(x.field || "")) ||
    (labelRegex && labelRegex.test(x.label || ""))
  ));
  return f?.value || "";
}

function _cleanQuery(q = "") {
  return String(q)
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 120);
}

function buildSearchPlan(factPack, opts = {}) {
  const skillId = opts.skillId || "";
  const company =
    opts.companyHint ||
    _factValue(factPack, /company_name|project\.name/i, /公司|目标公司|材料识别公司名/) ||
    "";
  const industry =
    opts.industryHint ||
    _factValue(factPack, /industry|sub_industry/i, /行业|赛道/) ||
    "";
  const base = [company, industry].filter(Boolean).join(" ");
  const fallback = opts.materialsHint ? String(opts.materialsHint).slice(0, 80) : "";
  const seed = base || fallback;
  if (!seed) return [];

  const common = [
    `${seed} 市场规模 CAGR 竞争格局 最新`,
    `${seed} 融资 估值 竞品 客户`,
  ];
  const map = {
    onepager_pptx: [`${seed} TAM 政策 竞品 融资`, `${seed} 行业 报告 市场规模 2026`],
    investment_snapshot: [`${seed} 融资 估值 市场 竞品`, `${seed} 风险 监管 诉讼 新闻`],
    project_brief: [`${seed} 公司 融资 竞品 客户`, `${seed} 行业 政策 市场规模`],
    investment_deck_pptx: [`${seed} 行业研究 市场规模 竞争格局`, `${seed} 估值 融资 并购 IPO`],
    highlight_visual: [`${seed} 产业链 上游 下游 竞争格局`, `${seed} 单位经济 毛利率 CAC LTV`],
    dd_checklist_xlsx: [`${seed} 风险 诉讼 监管 处罚`, `${seed} 客户 合同 财务 数据 存疑`],
    dd_questions: [`${seed} 风险 诉讼 监管 处罚`, `${seed} 客户 合同 财务 数据 存疑`],
    founder_interview_docx: [`${company || seed} 创始人 履历 采访 背景`, `${company || seed} 诉讼 负面 新闻`],
    competitor_matrix_xlsx: [`${seed} 竞品 融资 估值 客户`, `${industry || seed} 头部公司 替代方案`],
    ic_questions_xlsx: [`${seed} 竞品 风险 市场规模 估值`, `${seed} 政策 监管 诉讼 负面`],
  };
  return [...new Set([...(map[skillId] || common), ...common].map(_cleanQuery).filter(Boolean))].slice(0, 3);
}

async function appendSearchFacts(facts, factPack, opts = {}) {
  const queries = opts.searchQueries && opts.searchQueries.length
    ? opts.searchQueries
    : buildSearchPlan(factPack, opts);
  if (!queries.length || opts.useSearch === false) {
    return { searchUsed: false, searchResults: [], searchQueries: queries };
  }
  const { runWebSearch } = require("../services/webSearchService");
  const results = await runWebSearch(queries);
  for (const item of results) {
    const value = [
      item.title ? `标题:${item.title}` : "",
      item.snippet ? `摘要:${item.snippet}` : "",
      item.date ? `日期:${item.date}` : "",
    ].filter(Boolean).join("；");
    pushFact(facts, {
      field: "external_search",
      label: `外部检索-${item.query}`,
      value,
      sourceType: "external_search",
      sourceName: item.title || item.query,
      sourceUrl: item.url,
      sourceRef: item.url || item.query,
      confidence: "medium",
      evidenceLevel: 3,
    });
  }
  return {
    searchUsed: results.length > 0,
    searchResults: results,
    searchQueries: queries,
  };
}

// 机构记忆 (K 编号, 仅作参考)
function _shouldRunInstitutionalMemory(opts) {
  if (opts && opts.enableInstitutionalMemory === true) return true;
  if (opts && opts.enableInstitutionalMemory === false) return false;
  return process.env.ENABLE_INSTITUTIONAL_MEMORY === "1";
}

function appendInstitutionalMemoryFacts(facts, project, opts = {}) {
  if (!_shouldRunInstitutionalMemory(opts)) return { used: false, decisions: [] };
  try {
    const im = require("../services/institutionalMemory");
    const tags = {
      industry: project?.industry || opts.industryHint || null,
      sub_industry: project?.sub_industry || null,
      business_model: project?.business_model || null,
      stage: project?.stage || null,
      region: project?.region || null,
    };
    if (!tags.industry && !tags.business_model) return { used: false, decisions: [] };
    const decisions = im.retrieveSimilarDecisions(tags, { limit: opts.imLimit || 5 });
    if (decisions.length === 0) return { used: true, decisions: [], count: 0 };
    const startSeq = facts.filter((f) => f.id?.startsWith("K")).length + 1;
    const kFacts = im.formatDecisionsAsFacts(decisions, startSeq);
    for (const f of kFacts) facts.push(f);
    return { used: true, decisions, count: kFacts.length };
  } catch (e) {
    return { used: false, decisions: [], error: e.message };
  }
}

async function buildEvidencePack(project, opts = {}) {
  const projectId = opts.projectId || opts.ctx?.projectId || project?.id || null;
  opts = { ...opts, projectId };
  // Step 1: 项目结构化字段（旧 BP 分析 + BP 自报），暂存到 baseFacts
  const { context, factPack } = buildFactPack(project, opts);
  const baseFacts = factPack.facts.slice();
  factPack.facts = [];

  // Step 2: 用户上传材料-结构化（最高优先级 fact 层，替代旧 bp_deep_parsing）
  const uploadStructuredFacts = [];
  const uploadStructuredMeta = appendUploadStructuredFacts(
    uploadStructuredFacts,
    opts.conversationId || opts.ctx?.conversationId,
    opts,
  );

  // Step 3: 用户上传材料-原文摘要/摘录
  const uploadFacts = [];
  const uploadMeta = appendUploadFacts(uploadFacts, opts.conversationId || opts.ctx?.conversationId, opts);

  // Step 4: 外部检索交叉验证
  const searchFacts = [];
  factPack.facts = baseFacts;
  const searchMeta = await appendSearchFacts(searchFacts, factPack, opts);

  // Step 5: 拼装最终 facts，按"上传结构化 > 上传摘录 > 外部检索 > 旧 BP 分析/项目结构化 > BP 自报"
  factPack.facts = [];
  for (const f of uploadStructuredFacts) factPack.facts.push(f);
  for (const f of uploadFacts) factPack.facts.push(f);
  for (const f of searchFacts) factPack.facts.push(f);
  for (const f of baseFacts) factPack.facts.push(f);

  // Step 6: 机构历史先例（参考通道，K 编号，放最后）
  const imMeta = appendInstitutionalMemoryFacts(factPack.facts, project, opts);

  // Step 7: F 前缀整体 renumber
  _renumberFFacts(factPack.facts);

  // Step 8: 冲突检测（必须在 renumber 之后，引用 F 编号）。
  //         产生的 C 编号 fact 插到 facts 数组最前。
  const conflictMeta = appendConflictFacts(factPack.facts);
  const persistedConflictMeta = appendPersistedConflictFacts(factPack.facts, projectId, opts);

  factPack.facts = factPack.facts.slice(0, opts.maxFacts || 140);

  factPack.evidence_policy = [
    "证据优先级（冲突时高优先级胜出）: 用户上传资料-结构化 > 用户上传资料-原文摘录 > 外部检索/实时搜索交叉验证 > 上一轮 BP 分析/项目结构化数据 > BP 原文/BP 自报。",
    "  0. source_type=evidence_conflict (C 编号)：**证据冲突 alert**，上传结构化与旧 BP 分析/BP 自报字段不一致；**必须优先在产物中暴露此冲突**，并以 upload_structured 为准。",
    "  1. source_type=upload_structured：用户上传资料的**结构化抽取结果**（财务表 / 客户清单 / Cap Table / 合同 / 合规材料），**最高优先级**，视作已验证事实，引用时写「上传资料显示...」。",
    "  2. source_type=upload：用户上传资料的原文摘录/摘要（PDF / DOCX / XLSX 全文），**次高优先级**。",
    "  3. source_type=external_search：第三方公开信息（行业研究 / 监管 / 媒体 / 竞品公告 / 诉讼负面）。**用于穿透 BP 粉饰**，与 BP 冲突时优先采用搜索结果。",
    "  4. source_type=project_context：系统上一轮 BP 分析结果（多 Agent 评分 / verdict / claim_verdicts / 提取字段），比 BP 原文经过更多审查，但**底层来源仍是 BP**，引用时措辞「据上一轮 BP 分析」。",
    "  5. source_type=bp_self_report：**BP 原文 / BP 自报**（claimed_revenue / claimed_valuation / claimed_users）。**最低优先级**，引用时必须写「BP 披露 / 公司自报 / 待验证」，不要当成已验证事实。",
    "  6. source_type=institutional_memory (K 编号)：机构内部历史决策先例，**仅作为思考参考**，**不是**当前项目的事实依据；引用时明确写「参考机构先例 KXXX，仅供对照」。",
    "BP 本身是被审查对象，不是可信事实源。凡来自 BP 或 BP 自报的数据，必须在 prompt 中以「BP 披露 / 公司自报 / 待核实」措辞引用。",
    "任何具体数字、人名、竞品、融资、客户、政策、诉讼信息，必须 source_refs 引用 F / C 编号；机构先例引用 K 编号且标注「仅参考」。",
    "若有 C 编号冲突 fact，必须在产物中以「风险/待核实」标注暴露差异；不要 silently 选边。",
    "当上述任一级别都无支撑时，必须写「未披露 / 待核实 / 需补充材料」，不得自行补全。",
  ].join("\n");
  factPack.generated_at = new Date().toISOString();
  return {
    context,
    factPack,
    uploadCount: uploadMeta.uploadCount,
    uploadStructuredUsed: uploadStructuredMeta.used,
    uploadStructuredFactCount: uploadStructuredMeta.factCount,
    uploadStructuredArtifactCount: uploadStructuredMeta.artifactCount,
    uploadStructuredErrorCount: uploadStructuredMeta.errorCount,
    // Backward-compatible aliases for older skills; new code should use
    // uploadStructured* names.
    bpDeepUsed: uploadStructuredMeta.used,
    bpDeepCount: uploadStructuredMeta.factCount,
    bpDeepReason: uploadStructuredMeta.used ? null : "no_upload_structured_facts",
    conflictFactCount: conflictMeta.conflictFactCount + persistedConflictMeta.conflictFactCount,
    conflictFacts: [...conflictMeta.conflicts, ...persistedConflictMeta.conflicts],
    searchUsed: searchMeta.searchUsed,
    searchQueries: searchMeta.searchQueries,
    searchResults: searchMeta.searchResults,
    institutionalMemoryUsed: imMeta.used,
    institutionalMemoryCount: imMeta.count || 0,
    institutionalMemoryDecisions: imMeta.decisions || [],
  };
}

// 按证据优先级分组渲染 facts。
// 顺序与 evidence_policy 完全一致。
const _SOURCE_GROUPS = [
  { key: "evidence_conflict",      label: "证据冲突 (C 编号 · 必须优先处理, 以上传资料为准)" },
  { key: "upload_structured",      label: "用户上传资料-结构化 (最高优先级 · 视作已验证)" },
  { key: "upload",                 label: "用户上传资料-原文摘录/摘要 (次高优先级)" },
  { key: "external_search",        label: "外部搜索交叉验证 (用于穿透 BP 粉饰; 与 BP 冲突时以此为准)" },
  { key: "project_context",        label: "上一轮 BP 分析 / 项目结构化数据 (来源仍为 BP, 引用时措辞 '据上一轮 BP 分析')" },
  { key: "bp_self_report",         label: "BP 原文 / BP 自报 (最低优先级 · 引用时必须标注 'BP 披露 / 待核实')" },
  { key: "institutional_memory",   label: "机构历史先例 (K 编号 · 仅供参考, 不能作为当前项目事实断言)" },
];

function _factLine(f) {
  const provenance = [
    f.filename ? `文件:${f.filename}` : "",
    f.artifact_id ? `artifact_id:${f.artifact_id}` : "",
  ].filter(Boolean).join(" ");
  return `${f.id} | ${f.label} | ${f.value} | 来源:${f.source_name}${f.source_url ? ` (${f.source_url})` : ""} | 类型:${f.source_type || "project_context"}${provenance ? " | " + provenance : ""} | 置信度:${f.confidence}`;
}

function formatFactPackForPrompt(factPack) {
  const allFacts = factPack?.facts || [];
  const buckets = new Map(_SOURCE_GROUPS.map((g) => [g.key, []]));
  const fallback = [];
  for (const f of allFacts) {
    const st = f.source_type || "project_context";
    if (buckets.has(st)) buckets.get(st).push(f);
    else fallback.push(f);
  }
  const sections = [];
  for (const g of _SOURCE_GROUPS) {
    const arr = buckets.get(g.key) || [];
    if (!arr.length) continue;
    sections.push(`## 【${g.label}】`);
    sections.push(...arr.map(_factLine));
    sections.push("");
  }
  if (fallback.length) {
    sections.push("## 【其他】");
    sections.push(...fallback.map(_factLine));
    sections.push("");
  }
  if (!sections.length) sections.push("（暂无可用事实）");

  return [
    `# Fact Pack: ${factPack?.project_name || "未命名项目"}`,
    `# 引用规则: 输出 JSON 中凡是判断/问题/建议涉及具体事实，必须在 source_refs 引用 F / C / K 编号。`,
    `#           F = 上传结构化 / 上传摘录 / 外部搜索 / 项目结构化 / BP 自报；C = 证据冲突 alert；K = 机构历史先例（仅参考，不能支撑当前项目事实断言）。`,
    factPack?.evidence_policy ? `# Evidence Policy\n${factPack.evidence_policy}` : "",
    "",
    sections.join("\n"),
    factPack?.missing_policy || "",
  ].filter(Boolean).join("\n");
}

function factIds(factPack) {
  return new Set((factPack?.facts || []).map((f) => f.id));
}

module.exports = {
  buildFactPack,
  buildEvidencePack,
  buildSearchPlan,
  formatFactPackForPrompt,
  factIds,
  // 暴露内部 helper 给测试用
  _private: {
    _renumberFFacts,
    _SOURCE_GROUPS,
    appendUploadStructuredFacts,
    appendConflictFacts,
    appendPersistedConflictFacts,
    CONFLICT_RULES,
  },
};
