// ============================================================
// server/middleware/redactor.js
//
// 分级脱敏 —— Hermes-first plan §7。
//
// 强制脱敏（PIPL 红线）：
//   手机号 / 邮箱 / 身份证 / 银行卡 / 微信号 / 住址
//
// 谨慎处理（投研判断价值高，但属个人信息）：
//   创始人完整姓名 → [FOUNDER_N]（启发式：仅当文本里出现 "创始人/CEO/founder X" 这种上下文时识别）
//
// 默认保留（投研核心）：
//   公司名、行业、轮次、ARR、收入、估值、毛利率、客户名称
//
// 出口：redact(text, sessionId) -> { redacted, mappings }
//   mappings 落入 redaction_maps 表，unredactor 反向查表还原。
// ============================================================

const { getDb } = require("../db");

// 强制脱敏正则（PII 红线）
// ⚠️ 顺序敏感：长/更特异的模式必须放前面，避免被短模式提前消费。
//    例如身份证号 18 位必须在手机号 11 位之前匹配。
const HARD_PII_PATTERNS = [
  // 身份证（18 位，最后一位可为 X）—— 必须最先
  { kind: "id_card", regex: /(?<!\d)[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g },
  // 银行卡（16-19 位连续数字，常见信用卡/借记卡长度，加边界避免吃 ID 内嵌段）
  { kind: "bank_card", regex: /(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)/g },
  // 邮箱
  { kind: "email", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // 国际格式手机
  { kind: "phone", regex: /\+\d{1,3}[-\s]?1[3-9]\d{9}/g },
  // 手机号（中国大陆 11 位，前后必须非数字）
  { kind: "phone", regex: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  // 微信号（字母开头，6-20 位字母数字下划线减号）
  { kind: "wechat", regex: /(?:微信[:：]?\s*|wechat[:：]?\s*|wx[:：]?\s*)([A-Za-z][A-Za-z0-9_-]{5,19})/gi },
  // 街道地址（启发式：包含"省/市/区/路/号/弄"等的连续片段）
  { kind: "address", regex: /[一-龥]{2,}(?:省|自治区|特别行政区)?[一-龥]{0,8}市[一-龥]{0,8}(?:区|县)[一-龥]{0,8}(?:路|街|道|弄|巷)\s*\d+\s*号(?:[一-龥\d]{0,20})?/g },
];

// "谨慎处理" 创始人姓名启发式
//   匹配 "创始人 张三" / "CEO 李四" / "联合创始人 Wang Wu" 等
const FOUNDER_NAME_PATTERN = /(?:创始人|联合创始人|CEO|CTO|CFO|COO|founder|co-founder|总裁)\s*[:：]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}|[一-龥]{2,4})/g;

class Redactor {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.counters = {};
    this.local = new Map(); // placeholder -> original (本次调用内一致)
    this.reverse = new Map(); // original -> placeholder (同值复用)
  }

  _nextPlaceholder(kind) {
    this.counters[kind] = (this.counters[kind] || 0) + 1;
    return `[${kind.toUpperCase()}_${this.counters[kind]}]`;
  }

  _replace(kind, value) {
    if (this.reverse.has(value)) return this.reverse.get(value);
    const ph = this._nextPlaceholder(kind);
    this.local.set(ph, value);
    this.reverse.set(value, ph);
    return ph;
  }

  redactText(text) {
    if (!text || typeof text !== "string") return text;
    let out = text;

    // 强 PII
    for (const { kind, regex } of HARD_PII_PATTERNS) {
      out = out.replace(regex, (match, captured) => {
        const value = captured && kind === "wechat" ? captured : match;
        const ph = this._replace(kind, value);
        // 微信号正则带前缀，需保留前缀
        return kind === "wechat" ? match.replace(value, ph) : ph;
      });
    }

    // 创始人姓名（谨慎）
    out = out.replace(FOUNDER_NAME_PATTERN, (match, name) => {
      const ph = this._replace("founder_name", name);
      return match.replace(name, ph);
    });

    return out;
  }

  flush() {
    if (this.local.size === 0) return [];
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO redaction_maps (session_id, placeholder, original, kind)
      VALUES (?, ?, ?, ?)
    `);
    const insertMany = db.transaction((rows) => {
      for (const r of rows) stmt.run(r.session_id, r.placeholder, r.original, r.kind);
    });
    const rows = [];
    for (const [ph, original] of this.local.entries()) {
      // 从 placeholder 反推 kind
      const m = ph.match(/^\[([A-Z_]+)_\d+\]$/);
      const kindUpper = m ? m[1] : "UNKNOWN";
      const kind = kindUpper.toLowerCase();
      rows.push({ session_id: this.sessionId, placeholder: ph, original, kind });
    }
    insertMany(rows);
    return rows;
  }
}

/**
 * 一次性脱敏（适合短文本）。如要在多段文本里复用 counter，请直接 new Redactor。
 *
 * @param {string} text
 * @param {string} sessionId   —— 用于 redaction_maps 隔离；workspace 用 conversation_id；BP pipeline 用 bp:${bpId}
 * @returns {{ redacted: string, mappingCount: number }}
 */
function redact(text, sessionId) {
  const r = new Redactor(sessionId);
  const redacted = r.redactText(text);
  const rows = r.flush();
  return { redacted, mappingCount: rows.length };
}

/**
 * 多段文本批量脱敏，counter 跨段一致。
 * @param {string[]} parts
 * @param {string} sessionId
 */
function redactBatch(parts, sessionId) {
  const r = new Redactor(sessionId);
  const out = parts.map((p) => r.redactText(p));
  const rows = r.flush();
  return { redacted: out, mappingCount: rows.length };
}

module.exports = {
  Redactor,
  redact,
  redactBatch,
  HARD_PII_PATTERNS,
};
