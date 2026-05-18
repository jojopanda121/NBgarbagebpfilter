// ============================================================
// server/services/extraction/uploadStructuredExtraction.js
//
// 用户上传资料 → 结构化抽取编排（替代旧的 BP 深度解析）。
//
// 设计原则：
// - 输入是 **用户 workspace 上传** 的 data room / 财务表 / 合同 / 客户清单 /
//   访谈纪要 / 合规证书 / Cap Table 等"底层证据"，**不是** BP 原文。
// - 这是证据优先级的最高一层：fact pack 注入时按 source_type=upload_structured
//   归类，凌驾于外部检索 / 旧 BP 分析 / BP 自报之上。
// - 抽取失败 → 落 status='error' + error 文本；不抛错、不阻塞上传成功。
// - 短文本（< 200 字）跳过 LLM，落 status='skipped'。
//
// 输出 JSON 结构：
//   {
//     financials,                  // financialStatementsAgent
//     unit_economics,              // unitEconomicsAgent
//     customers,                   // customerListAgent
//     cap_table,                   // extrasAgent
//     legal_compliance_signals,    // extrasAgent
//     contracts_and_evidence,      // extrasAgent
//     claims_to_verify,            // extrasAgent
//     red_flags,                   // extrasAgent
//     meta: { doc_type_guess, evidence_quality, agent_errors, generated_at }
//   }
//
// 持久化：写到 workspace_artifact_structured_extracts，唯一键 artifact_id。
// 读取：appendUploadStructuredFacts 在 buildEvidencePack 中按 conversation_id
//       查所有 success 状态的 row，平铺成 F 编号 fact (source_type=upload_structured)。
// ============================================================

const financialStatementsAgent = require("./financialStatementsAgent");
const unitEconomicsAgent = require("./unitEconomicsAgent");
const customerListAgent = require("./customerListAgent");
const extrasAgent = require("./extrasAgent");

const MIN_INPUT_CHARS = 200;

/**
 * 跑 4 个 agent 并行抽取一份上传材料。
 *
 * @param {string} uploadText  上传资料 sidecar 文本（不是 BP 原文！）
 * @param {object} opts
 * @param {string} [opts.filename]
 * @param {string} [opts.mimeType]
 * @param {object} [opts.agentOpts]
 * @returns {Promise<{ structured: object, errors: object, status: string }>}
 */
async function extractUploadStructured(uploadText, opts = {}) {
  const safeText = typeof uploadText === "string" ? uploadText : "";
  if (safeText.trim().length < MIN_INPUT_CHARS) {
    return {
      structured: _emptyStructured("input_too_short"),
      errors: {},
      status: "skipped",
      reason: "input_too_short",
    };
  }
  const agentOpts = { ...(opts.agentOpts || {}), filename: opts.filename };
  const [financials, unit_economics, customers, extras] = await Promise.all([
    financialStatementsAgent.extract(safeText, agentOpts),
    unitEconomicsAgent.extract(safeText, agentOpts),
    customerListAgent.extract(safeText, agentOpts),
    extrasAgent.extract(safeText, agentOpts),
  ]);
  const errors = {
    financials: financials.error || null,
    unit_economics: unit_economics.error || null,
    customers: customers.error || null,
    extras: extras.error || null,
  };
  const allFailed = Object.values(errors).every((e) => e);
  return {
    structured: {
      financials: financials.data,
      unit_economics: unit_economics.data,
      customers: customers.data,
      cap_table: extras.data.cap_table,
      legal_compliance_signals: extras.data.legal_compliance_signals,
      contracts_and_evidence: extras.data.contracts_and_evidence,
      claims_to_verify: extras.data.claims_to_verify,
      red_flags: extras.data.red_flags,
      meta: {
        doc_type_guess: extras.data.notes?.doc_type_guess || "unknown",
        evidence_quality: extras.data.notes?.evidence_quality || "unclear",
        filename: opts.filename || null,
        mime_type: opts.mimeType || null,
        agent_repairs: {
          financials: financials.repairs,
          unit_economics: unit_economics.repairs,
          customers: customers.repairs,
          extras: extras.repairs,
        },
        generated_at: new Date().toISOString(),
      },
    },
    errors,
    status: allFailed ? "error" : "success",
    reason: null,
  };
}

function _emptyStructured(reason) {
  const fin = financialStatementsAgent.buildExtractionFailedPayload(reason);
  const ue = unitEconomicsAgent.buildExtractionFailedPayload
    ? unitEconomicsAgent.buildExtractionFailedPayload(reason)
    : null;
  const cust = customerListAgent.buildExtractionFailedPayload
    ? customerListAgent.buildExtractionFailedPayload(reason)
    : null;
  const extras = extrasAgent.buildEmptyPayload(reason);
  return {
    financials: fin,
    unit_economics: ue,
    customers: cust,
    cap_table: extras.cap_table,
    legal_compliance_signals: extras.legal_compliance_signals,
    contracts_and_evidence: extras.contracts_and_evidence,
    claims_to_verify: extras.claims_to_verify,
    red_flags: extras.red_flags,
    meta: {
      doc_type_guess: "unknown",
      evidence_quality: "unclear",
      filename: null,
      mime_type: null,
      agent_repairs: {},
      generated_at: new Date().toISOString(),
      reason,
    },
  };
}

// ──────────────────────────────────────────────────────────────
// 持久化
// ──────────────────────────────────────────────────────────────

function _hasTable(db) {
  try {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_artifact_structured_extracts'"
    ).get();
    return !!row;
  } catch (_) { return false; }
}

function _hasColumn(db, table, column) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  } catch (_) { return false; }
}

function upsertExtractionRow({ db, artifactId, conversationId, projectId, filename, docType, structured, status, error, factCount }) {
  if (!_hasTable(db)) return null;
  const existing = db.prepare(
    "SELECT id FROM workspace_artifact_structured_extracts WHERE artifact_id = ?"
  ).get(artifactId);
  const json = structured ? JSON.stringify(structured) : null;
  const hasProject = _hasColumn(db, "workspace_artifact_structured_extracts", "project_id");
  const hasLevel = _hasColumn(db, "workspace_artifact_structured_extracts", "evidence_level");
  if (existing) {
    const projectSet = hasProject ? "project_id = ?, " : "";
    const levelSet = hasLevel ? "evidence_level = 1, " : "";
    const args = [
      conversationId,
      ...(hasProject ? [projectId || null] : []),
      filename || null,
      docType || null,
      json,
      status,
      error || null,
      factCount || 0,
      artifactId,
    ];
    db.prepare(
      `UPDATE workspace_artifact_structured_extracts
       SET conversation_id = ?, ${projectSet}filename = ?, doc_type = ?, structured_json = ?,
           extraction_status = ?, error = ?, fact_count = ?, ${levelSet}updated_at = CURRENT_TIMESTAMP
       WHERE artifact_id = ?`
    ).run(...args);
    return existing.id;
  }
  const cols = [
    "artifact_id", "conversation_id",
    ...(hasProject ? ["project_id"] : []),
    "filename", "doc_type", "structured_json", "extraction_status", "error", "fact_count",
    ...(hasLevel ? ["evidence_level"] : []),
  ];
  const values = [
    artifactId, conversationId,
    ...(hasProject ? [projectId || null] : []),
    filename || null, docType || null, json, status, error || null, factCount || 0,
    ...(hasLevel ? [1] : []),
  ];
  const placeholders = cols.map(() => "?").join(", ");
  const info = db.prepare(
    `INSERT INTO workspace_artifact_structured_extracts (${cols.join(", ")})
     VALUES (${placeholders})`
  ).run(...values);
  return info.lastInsertRowid;
}

/**
 * 跑抽取并写入 workspace_artifact_structured_extracts。
 * **失败不抛错**，调用方拿不到 throw，只能从返回 .status 判断。
 *
 * @param {object} args
 * @param {object} args.db                   better-sqlite3 db 句柄
 * @param {string} args.artifactId
 * @param {string} args.conversationId
 * @param {string} args.filename
 * @param {string} args.uploadText           sidecar 全文
 * @param {string} [args.mimeType]
 * @param {object} [args.agentOpts]
 * @returns {Promise<{ status, structured, errors, error }>}
 */
async function runAndPersist({ db, artifactId, conversationId, projectId, filename, uploadText, mimeType, agentOpts }) {
  if (!artifactId || !conversationId) {
    return { status: "error", error: "missing_artifact_or_conversation_id", structured: null, errors: {} };
  }
  // 标记 pending → running，便于上游观测
  try {
    upsertExtractionRow({
      db, artifactId, conversationId, filename,
      projectId,
      docType: null, structured: null, status: "running", error: null, factCount: 0,
    });
  } catch (_) { /* ignore */ }

  let result;
  try {
    result = await extractUploadStructured(uploadText, { filename, mimeType, agentOpts });
  } catch (e) {
    const errMsg = e?.message || "unknown_error";
    try {
      upsertExtractionRow({
        db, artifactId, conversationId, filename,
        projectId,
        docType: null, structured: null, status: "error", error: errMsg, factCount: 0,
      });
    } catch (_) { /* ignore */ }
    return { status: "error", error: errMsg, structured: null, errors: {} };
  }

  const factCount = _countFlatFacts(result.structured);
  try {
    upsertExtractionRow({
      db, artifactId, conversationId, filename,
      projectId,
      docType: result.structured?.meta?.doc_type_guess || null,
      structured: result.structured,
      status: result.status,
      error: result.status === "error" ? JSON.stringify(result.errors) : null,
      factCount,
    });
    if (result.status === "success") {
      try {
        const evidenceStore = require("../evidenceStore");
        const persistedFacts = evidenceStore.replaceStructuredFactsForArtifact({
          db,
          artifactId,
          conversationId,
          projectId,
          flatFacts: flattenStructuredToFacts(result.structured, { artifactId, filename }),
        });
        const finalProjectId = persistedFacts.projectId || projectId;
        if (finalProjectId && process.env.CONFLICT_JUDGE_DISABLED !== "1") {
          const taskQueue = require("../taskQueue");
          taskQueue.fireAndForget(
            "conflict_judge",
            () => require("../conflictJudge").runConflictJudgeForProject({ projectId: finalProjectId, db }),
            { concurrency: Number(process.env.CONFLICT_JUDGE_CONCURRENCY || 1) },
          );
        }
      } catch (_) { /* optional evidence store may not be migrated yet */ }
    }
  } catch (e) {
    // 持久化失败不抛错；调用方还能拿到 in-memory 结果
    return { ...result, error: `persist_failed: ${e.message}` };
  }
  return result;
}

// ──────────────────────────────────────────────────────────────
// flattenToFacts: 把 structured payload 平铺成 fact pack 兼容数组
// （source_type=upload_structured, F 编号留待 _factPack renumber）
// ──────────────────────────────────────────────────────────────

function _pushNumberField(out, field, label, fieldObj, ctx) {
  if (!fieldObj || fieldObj.value == null) return;
  const unit = fieldObj.unit ? ` ${fieldObj.unit}` : "";
  const period = fieldObj.period ? ` (${fieldObj.period})` : "";
  out.push({
    field,
    label,
    value: `${fieldObj.value}${unit}${period}`,
    source_type: "upload_structured",
    source_name: `上传资料-${ctx.filename || "结构化抽取"}`,
    source_ref: fieldObj.source_ref || ctx.artifactId || "",
    artifact_id: ctx.artifactId || null,
    filename: ctx.filename || null,
    confidence: fieldObj.confidence === "high" ? "high"
      : fieldObj.confidence === "medium" ? "medium"
      : "low",
  });
}

function flattenStructuredToFacts(structured, ctx = {}) {
  if (!structured) return [];
  const out = [];
  const f = structured.financials;
  if (f) {
    _pushNumberField(out, "upload.financials.revenue", "上传资料-营业收入", f.pl?.revenue, ctx);
    _pushNumberField(out, "upload.financials.gross_margin_pct", "上传资料-毛利率 %", f.pl?.gross_margin_pct, ctx);
    _pushNumberField(out, "upload.financials.ebitda", "上传资料-EBITDA", f.pl?.ebitda, ctx);
    _pushNumberField(out, "upload.financials.net_income", "上传资料-净利润", f.pl?.net_income, ctx);
    _pushNumberField(out, "upload.financials.cash", "上传资料-现金", f.bs?.cash, ctx);
    _pushNumberField(out, "upload.financials.ar", "上传资料-应收账款", f.bs?.ar, ctx);
    _pushNumberField(out, "upload.financials.operating_cf", "上传资料-经营现金流", f.cf?.operating_cf, ctx);
    _pushNumberField(out, "upload.financials.runway_months", "上传资料-跑道(月)", f.cf?.runway_months, ctx);
  }
  const u = structured.unit_economics;
  if (u) {
    _pushNumberField(out, "upload.unit_economics.ltv", "上传资料-LTV", u.ltv, ctx);
    _pushNumberField(out, "upload.unit_economics.cac", "上传资料-CAC", u.cac, ctx);
    _pushNumberField(out, "upload.unit_economics.ltv_cac_ratio", "上传资料-LTV/CAC", u.ltv_cac_ratio, ctx);
    _pushNumberField(out, "upload.unit_economics.payback_months", "上传资料-回本月数", u.payback_months, ctx);
    _pushNumberField(out, "upload.unit_economics.nrr_pct", "上传资料-NRR %", u.nrr_pct, ctx);
    _pushNumberField(out, "upload.unit_economics.churn_monthly_pct", "上传资料-月 churn %", u.churn_monthly_pct, ctx);
    _pushNumberField(out, "upload.unit_economics.arpa", "上传资料-ARPA", u.arpa, ctx);
  }
  const c = structured.customers;
  if (c) {
    _pushNumberField(out, "upload.customers.concentration_top3_pct", "上传资料-前 3 大客户占比 %", c.concentration_top3_pct, ctx);
    _pushNumberField(out, "upload.customers.concentration_top10_pct", "上传资料-前 10 大客户占比 %", c.concentration_top10_pct, ctx);
    if (Array.isArray(c.top_customers)) {
      c.top_customers.slice(0, 5).forEach((cust, i) => {
        if (!cust.name) return;
        out.push({
          field: `upload.customers.top_${i + 1}`,
          label: `上传资料-Top ${i + 1} 客户`,
          value: `${cust.name}${cust.revenue_share_pct != null ? ` (${cust.revenue_share_pct}% 收入占比)` : ""} · ${cust.contract_status}`,
          source_type: "upload_structured",
          source_name: `上传资料-${ctx.filename || "客户清单"}`,
          source_ref: cust.source_ref || ctx.artifactId || "",
          artifact_id: ctx.artifactId || null,
          filename: ctx.filename || null,
          confidence: cust.confidence === "high" ? "high" : cust.confidence === "medium" ? "medium" : "low",
        });
      });
    }
  }
  const ct = structured.cap_table;
  if (ct) {
    if (ct.pre_money_valuation?.value != null) {
      out.push({
        field: "upload.cap_table.pre_money",
        label: "上传资料-投前估值",
        value: `${ct.pre_money_valuation.value}${ct.pre_money_valuation.currency ? " " + ct.pre_money_valuation.currency : ""}${ct.pre_money_valuation.round ? " (" + ct.pre_money_valuation.round + ")" : ""}`,
        source_type: "upload_structured",
        source_name: `上传资料-${ctx.filename || "Cap Table"}`,
        source_ref: ct.pre_money_valuation.source_quote || ctx.artifactId || "",
        artifact_id: ctx.artifactId || null,
        filename: ctx.filename || null,
        confidence: ct.pre_money_valuation.confidence === "high" ? "high" : "medium",
      });
    }
    if (ct.post_money_valuation?.value != null) {
      out.push({
        field: "upload.cap_table.post_money",
        label: "上传资料-投后估值",
        value: `${ct.post_money_valuation.value}${ct.post_money_valuation.currency ? " " + ct.post_money_valuation.currency : ""}${ct.post_money_valuation.round ? " (" + ct.post_money_valuation.round + ")" : ""}`,
        source_type: "upload_structured",
        source_name: `上传资料-${ctx.filename || "Cap Table"}`,
        source_ref: ct.post_money_valuation.source_quote || ctx.artifactId || "",
        artifact_id: ctx.artifactId || null,
        filename: ctx.filename || null,
        confidence: ct.post_money_valuation.confidence === "high" ? "high" : "medium",
      });
    }
    (ct.entries || []).slice(0, 5).forEach((e, i) => {
      if (!e.holder) return;
      out.push({
        field: `upload.cap_table.holder_${i + 1}`,
        label: `上传资料-${e.role || "持股人"}`,
        value: `${e.holder}${e.share_pct != null ? ` ${e.share_pct}%` : ""}`,
        source_type: "upload_structured",
        source_name: `上传资料-${ctx.filename || "Cap Table"}`,
        source_ref: e.source_quote || ctx.artifactId || "",
        artifact_id: ctx.artifactId || null,
        filename: ctx.filename || null,
        confidence: e.confidence === "high" ? "high" : "medium",
      });
    });
  }
  (structured.legal_compliance_signals || []).slice(0, 8).forEach((s) => {
    out.push({
      field: `upload.legal.${s.category}`,
      label: `上传资料-合规信号(${s.severity})`,
      value: s.summary,
      source_type: "upload_structured",
      source_name: `上传资料-${ctx.filename || "合规材料"}`,
      source_ref: s.source_quote || ctx.artifactId || "",
      artifact_id: ctx.artifactId || null,
      filename: ctx.filename || null,
      confidence: s.confidence === "high" ? "high" : "medium",
    });
  });
  (structured.contracts_and_evidence || []).slice(0, 10).forEach((c2, i) => {
    out.push({
      field: `upload.contracts.${i + 1}`,
      label: `上传资料-${c2.doc_kind}(${c2.contract_status})`,
      value: `${c2.counterparty || "?"}${c2.amount != null ? ` · ${c2.amount}${c2.currency ? " " + c2.currency : ""}` : ""}${c2.notes ? " · " + c2.notes : ""}`,
      source_type: "upload_structured",
      source_name: `上传资料-${ctx.filename || "合同/证据"}`,
      source_ref: c2.source_quote || ctx.artifactId || "",
      artifact_id: ctx.artifactId || null,
      filename: ctx.filename || null,
      confidence: c2.confidence === "high" ? "high" : "medium",
    });
  });
  (structured.red_flags || []).slice(0, 8).forEach((r, i) => {
    out.push({
      field: `upload.red_flags.${i + 1}`,
      label: `上传资料-风险(${r.severity})`,
      value: r.flag,
      source_type: "upload_structured",
      source_name: `上传资料-${ctx.filename || "风险点"}`,
      source_ref: r.source_quote || ctx.artifactId || "",
      artifact_id: ctx.artifactId || null,
      filename: ctx.filename || null,
      confidence: "high",
    });
  });
  (structured.claims_to_verify || []).slice(0, 8).forEach((c3, i) => {
    out.push({
      field: `upload.claims_to_verify.${i + 1}`,
      label: "上传资料-待外部验证声明",
      value: `${c3.claim}${c3.why_uncertain ? " (待验证: " + c3.why_uncertain + ")" : ""}`,
      source_type: "upload_structured",
      source_name: `上传资料-${ctx.filename || "声明"}`,
      source_ref: c3.source_quote || ctx.artifactId || "",
      artifact_id: ctx.artifactId || null,
      filename: ctx.filename || null,
      confidence: "low",
    });
  });
  return out;
}

function _countFlatFacts(structured) {
  return flattenStructuredToFacts(structured, {}).length;
}

// ──────────────────────────────────────────────────────────────
// 读取：拉某个 conversation 下所有 success 状态的结构化抽取
// ──────────────────────────────────────────────────────────────
function listStructuredExtractsForConversation(db, conversationId, opts = {}) {
  if (!_hasTable(db)) return [];
  try {
    const rows = db.prepare(
      `SELECT artifact_id, conversation_id, filename, doc_type, structured_json, extraction_status, error, fact_count, updated_at
       FROM workspace_artifact_structured_extracts
       WHERE conversation_id = ? AND extraction_status = 'success'
       ORDER BY updated_at DESC LIMIT ?`
    ).all(conversationId, opts.limit || 16);
    return rows.map((r) => ({
      artifactId: r.artifact_id,
      conversationId: r.conversation_id,
      filename: r.filename,
      docType: r.doc_type,
      factCount: r.fact_count,
      structured: r.structured_json ? _safeJson(r.structured_json) : null,
    })).filter((r) => r.structured);
  } catch (_) {
    return [];
  }
}

function _safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

module.exports = {
  extractUploadStructured,
  runAndPersist,
  flattenStructuredToFacts,
  listStructuredExtractsForConversation,
  upsertExtractionRow,
  MIN_INPUT_CHARS,
};
