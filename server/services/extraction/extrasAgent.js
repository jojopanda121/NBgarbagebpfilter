// ============================================================
// server/services/extraction/extrasAgent.js
//
// 用户上传资料的"非财务/UE/客户"扩展信息抽取。
// 覆盖：cap_table / legal_compliance_signals / contracts_and_evidence /
//       claims_to_verify / red_flags。
//
// 设计原则：
// - 输入是用户上传资料文本（不是 BP 原文）。
// - 找不到 → null/空数组，禁止"未披露"字符串占位。
// - 每条结构化事实必须保留 source_quote (≤120 字短摘录)，
//   方便下游 _factPack 引用 + 让人工 review 时可定位。
// - 不允许把 MOU / pipeline / 意向客户当成"已签约付费客户"。
// - 不允许把 BP 自称收入当成审计真实收入（除非上传材料就是财务表/合同/发票/流水）。
// ============================================================

const CONFIDENCE_ENUM = ["high", "medium", "low", "missing", "n/a"];

const SYSTEM_PROMPT = `你是一级市场基金的尽调分析师，从**用户上传的尽调资料**（data room / 财务表 / 合同 / 发票 / 流水 / 访谈纪要 / 法务证书 / Cap Table 等）中**结构化抽取**底层证据。

【硬性约束】
1. 只输出 JSON 一个对象，不要 Markdown / 解释。
2. 找不到的字段 → null 或空数组；**禁止**"未披露/暂无/待核实"等自然语言占位。
3. 每条结构化事实必须带 source_quote：从原文短摘录 ≤120 字，让人工可以定位证据来源。
4. cap_table.entries.role 枚举：'founder' / 'co_founder' / 'employee_esop' / 'angel' / 'vc' / 'pe' / 'strategic' / 'other'。
5. contract_status 严格区分：'paid' (已付款) / 'signed_unpaid' (已签约未付款) / 'pilot' (试点/POC) / 'mou_loi' (MOU/LOI/意向) / 'pipeline' (线索)。
   **不要把 MOU/pipeline 包装成付费客户**。
6. legal_compliance_signals.categories 枚举：'data_compliance' / 'ip_patent' / 'litigation' / 'license_or_qualification' / 'medical_device' / 'open_source_license' / 'export_control' / 'tax_or_audit' / 'other'。
7. claims_to_verify 是"上传材料中读到、但需要外部搜索/访谈或第三方证据进一步验证"的声明。
8. red_flags 是"上传材料直接暴露的风险"，例如客户集中度过高、客户流失、合同违约、欠税、诉讼、专利失效等。
9. 不允许编造数字；不允许把 BP 自称数字（即便文件名像 BP）当成审计数字。
   仅当上传资料本身是审计报告 / 合同 / 银行流水 / 发票 / Cap Table / 律师函等"低层级证据"时，可视为已验证。`;

function _str(maxLen = 240) { return { type: ["string", "null"], maxLength: maxLen }; }
function _quote() { return { type: "string", maxLength: 240, description: "原文短摘录，≤120 字" }; }
function _conf() { return { type: "string", enum: CONFIDENCE_ENUM }; }

const SCHEMA = {
  type: "object",
  required: [
    "cap_table",
    "legal_compliance_signals",
    "contracts_and_evidence",
    "claims_to_verify",
    "red_flags",
    "notes",
  ],
  additionalProperties: false,
  properties: {
    cap_table: {
      type: "object",
      required: ["entries", "pre_money_valuation", "post_money_valuation", "esop_pct"],
      additionalProperties: false,
      properties: {
        entries: {
          type: "array",
          maxItems: 30,
          items: {
            type: "object",
            required: ["holder", "role", "share_pct", "source_quote", "confidence"],
            additionalProperties: false,
            properties: {
              holder: _str(120),
              role: { type: "string", enum: ["founder", "co_founder", "employee_esop", "angel", "vc", "pe", "strategic", "other"] },
              share_pct: { type: ["number", "null"] },
              shares: { type: ["number", "null"] },
              source_quote: _quote(),
              confidence: _conf(),
            },
          },
        },
        pre_money_valuation: {
          type: "object",
          required: ["value", "currency", "round", "source_quote", "confidence"],
          additionalProperties: false,
          properties: {
            value: { type: ["number", "null"] },
            currency: _str(8),
            round: _str(24),
            source_quote: _quote(),
            confidence: _conf(),
          },
        },
        post_money_valuation: {
          type: "object",
          required: ["value", "currency", "round", "source_quote", "confidence"],
          additionalProperties: false,
          properties: {
            value: { type: ["number", "null"] },
            currency: _str(8),
            round: _str(24),
            source_quote: _quote(),
            confidence: _conf(),
          },
        },
        esop_pct: { type: ["number", "null"] },
      },
    },
    legal_compliance_signals: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        required: ["category", "summary", "severity", "source_quote", "confidence"],
        additionalProperties: false,
        properties: {
          category: {
            type: "string",
            enum: [
              "data_compliance", "ip_patent", "litigation", "license_or_qualification",
              "medical_device", "open_source_license", "export_control", "tax_or_audit", "other",
            ],
          },
          summary: _str(360),
          severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
          source_quote: _quote(),
          confidence: _conf(),
        },
      },
    },
    contracts_and_evidence: {
      type: "array",
      maxItems: 30,
      description: "合同 / 发票 / 银行流水 / 订单 / LOI / 会议纪要 等底层证据条目",
      items: {
        type: "object",
        required: ["doc_kind", "counterparty", "amount", "currency", "contract_status", "source_quote", "confidence"],
        additionalProperties: false,
        properties: {
          doc_kind: { type: "string", enum: ["contract", "invoice", "bank_flow", "order", "loi_mou", "meeting_note", "other"] },
          counterparty: _str(120),
          amount: { type: ["number", "null"] },
          currency: _str(8),
          contract_status: { type: "string", enum: ["paid", "signed_unpaid", "pilot", "mou_loi", "pipeline", "unknown"] },
          signed_at: _str(24),
          notes: _str(360),
          source_quote: _quote(),
          confidence: _conf(),
        },
      },
    },
    claims_to_verify: {
      type: "array",
      maxItems: 20,
      description: "上传资料中读到的、但需要外部搜索/访谈/第三方证据进一步验证的声明",
      items: {
        type: "object",
        required: ["claim", "why_uncertain", "suggested_verification", "source_quote"],
        additionalProperties: false,
        properties: {
          claim: _str(360),
          why_uncertain: _str(360),
          suggested_verification: _str(240),
          source_quote: _quote(),
        },
      },
    },
    red_flags: {
      type: "array",
      maxItems: 20,
      description: "上传资料中直接暴露的风险（客户集中度过高 / 客户流失 / 欠税 / 诉讼 / 专利到期 / 关键人离职 …）",
      items: {
        type: "object",
        required: ["flag", "severity", "source_quote"],
        additionalProperties: false,
        properties: {
          flag: _str(360),
          severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
          source_quote: _quote(),
        },
      },
    },
    notes: {
      type: "object",
      required: ["doc_type_guess", "evidence_quality", "warnings"],
      additionalProperties: false,
      properties: {
        doc_type_guess: { type: "string", maxLength: 32, description: "猜文档类型: financials / contract / cap_table / data_room / interview_note / mixed / unknown" },
        evidence_quality: { type: "string", enum: ["audited", "third_party_verified", "self_reported", "mou_pipeline", "unclear"] },
        warnings: { type: "array", maxItems: 6, items: { type: "string", maxLength: 200 } },
      },
    },
  },
};

function _safeArr(arr) { return Array.isArray(arr) ? arr : []; }
function _safeNum(v) { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function _safeStr(v, max = 240) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || /^(未披露|暂无|待核实|n\/a|null)$/i.test(t)) return null;
  return t.slice(0, max);
}
function _safeEnum(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}

function normalize(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const ct = r.cap_table || {};
  const notes = r.notes || {};
  return {
    cap_table: {
      entries: _safeArr(ct.entries).slice(0, 30).map((e) => ({
        holder: _safeStr(e?.holder, 120),
        role: _safeEnum(e?.role, ["founder", "co_founder", "employee_esop", "angel", "vc", "pe", "strategic", "other"], "other"),
        share_pct: _safeNum(e?.share_pct),
        shares: _safeNum(e?.shares),
        source_quote: _safeStr(e?.source_quote, 240) || "",
        confidence: _safeEnum(e?.confidence, CONFIDENCE_ENUM, "missing"),
      })).filter((e) => e.holder),
      pre_money_valuation: {
        value: _safeNum(ct.pre_money_valuation?.value),
        currency: _safeStr(ct.pre_money_valuation?.currency, 8),
        round: _safeStr(ct.pre_money_valuation?.round, 24),
        source_quote: _safeStr(ct.pre_money_valuation?.source_quote, 240) || "",
        confidence: _safeEnum(ct.pre_money_valuation?.confidence, CONFIDENCE_ENUM, "missing"),
      },
      post_money_valuation: {
        value: _safeNum(ct.post_money_valuation?.value),
        currency: _safeStr(ct.post_money_valuation?.currency, 8),
        round: _safeStr(ct.post_money_valuation?.round, 24),
        source_quote: _safeStr(ct.post_money_valuation?.source_quote, 240) || "",
        confidence: _safeEnum(ct.post_money_valuation?.confidence, CONFIDENCE_ENUM, "missing"),
      },
      esop_pct: _safeNum(ct.esop_pct),
    },
    legal_compliance_signals: _safeArr(r.legal_compliance_signals).slice(0, 20).map((x) => ({
      category: _safeEnum(x?.category, [
        "data_compliance", "ip_patent", "litigation", "license_or_qualification",
        "medical_device", "open_source_license", "export_control", "tax_or_audit", "other",
      ], "other"),
      summary: _safeStr(x?.summary, 360),
      severity: _safeEnum(x?.severity, ["low", "medium", "high", "critical"], "low"),
      source_quote: _safeStr(x?.source_quote, 240) || "",
      confidence: _safeEnum(x?.confidence, CONFIDENCE_ENUM, "missing"),
    })).filter((x) => x.summary),
    contracts_and_evidence: _safeArr(r.contracts_and_evidence).slice(0, 30).map((x) => ({
      doc_kind: _safeEnum(x?.doc_kind, ["contract", "invoice", "bank_flow", "order", "loi_mou", "meeting_note", "other"], "other"),
      counterparty: _safeStr(x?.counterparty, 120),
      amount: _safeNum(x?.amount),
      currency: _safeStr(x?.currency, 8),
      contract_status: _safeEnum(x?.contract_status, ["paid", "signed_unpaid", "pilot", "mou_loi", "pipeline", "unknown"], "unknown"),
      signed_at: _safeStr(x?.signed_at, 24),
      notes: _safeStr(x?.notes, 360),
      source_quote: _safeStr(x?.source_quote, 240) || "",
      confidence: _safeEnum(x?.confidence, CONFIDENCE_ENUM, "missing"),
    })).filter((x) => x.counterparty || x.amount != null),
    claims_to_verify: _safeArr(r.claims_to_verify).slice(0, 20).map((x) => ({
      claim: _safeStr(x?.claim, 360),
      why_uncertain: _safeStr(x?.why_uncertain, 360),
      suggested_verification: _safeStr(x?.suggested_verification, 240),
      source_quote: _safeStr(x?.source_quote, 240) || "",
    })).filter((x) => x.claim),
    red_flags: _safeArr(r.red_flags).slice(0, 20).map((x) => ({
      flag: _safeStr(x?.flag, 360),
      severity: _safeEnum(x?.severity, ["low", "medium", "high", "critical"], "low"),
      source_quote: _safeStr(x?.source_quote, 240) || "",
    })).filter((x) => x.flag),
    notes: {
      doc_type_guess: _safeStr(notes.doc_type_guess, 32) || "unknown",
      evidence_quality: _safeEnum(notes.evidence_quality, ["audited", "third_party_verified", "self_reported", "mou_pipeline", "unclear"], "unclear"),
      warnings: _safeArr(notes.warnings).filter((w) => typeof w === "string").slice(0, 6),
    },
  };
}

function buildEmptyPayload(reason) {
  return {
    cap_table: {
      entries: [],
      pre_money_valuation: { value: null, currency: null, round: null, source_quote: "", confidence: "missing" },
      post_money_valuation: { value: null, currency: null, round: null, source_quote: "", confidence: "missing" },
      esop_pct: null,
    },
    legal_compliance_signals: [],
    contracts_and_evidence: [],
    claims_to_verify: [],
    red_flags: [],
    notes: {
      doc_type_guess: "unknown",
      evidence_quality: "unclear",
      warnings: reason ? [reason] : [],
    },
  };
}

async function extract(uploadText, opts = {}) {
  if (!uploadText || typeof uploadText !== "string" || uploadText.trim().length < 50) {
    return { data: buildEmptyPayload("input_too_short"), repairs: 0 };
  }
  const { callLLMJson } = require("../llmService");
  try {
    const filenameHint = opts.filename ? `\n【文件名】${opts.filename}` : "";
    const out = await callLLMJson(
      SYSTEM_PROMPT,
      `【用户上传资料正文 / 节选】${filenameHint}\n${uploadText}\n\n请按 schema 输出底层证据 JSON。`,
      SCHEMA,
      {
        maxTokens: opts.maxTokens || 6144,
        maxRepairs: opts.maxRepairs ?? 2,
        taskHint: "upload_structured_extraction",
        skillId: "upload_extras_agent",
      },
    );
    return { data: normalize(out.data), repairs: out.repairs };
  } catch (e) {
    return {
      data: buildEmptyPayload(`llm_error: ${e.message?.slice(0, 80) || "unknown"}`),
      repairs: 3,
      error: e.message,
    };
  }
}

module.exports = { SCHEMA, SYSTEM_PROMPT, extract, normalize, buildEmptyPayload };
