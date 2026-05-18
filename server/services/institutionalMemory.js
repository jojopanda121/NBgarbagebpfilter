// ============================================================
// server/services/institutionalMemory.js
//
// P3-3 机构记忆 / categorical RAG
//
// 用 SQLite 标签索引做"过去看过的类似项目"检索（不用向量库）。
// 设计意图：让 9 个 skill 在生成 artifact 时能引用机构历史决策，让投资人在
// 1-pager / IC questions / brief 里看到"过去我们为什么投了 / 没投同类项目"。
//
// 主入口：
//   recordDecision(deal)                       — 写入一条历史决策
//   retrieveSimilarDecisions(tags, opts)       — 按标签过滤 + 评分排序
//   formatDecisionsForPrompt(decisions)        — 输出为 K 前缀的 fact 列表
//
// 评分逻辑（categorical only，不用 embeddings）：
//   industry 完全匹配:              +4
//   sub_industry 完全匹配:          +3
//   business_model 完全匹配:        +2
//   stage 完全匹配 / 同 bucket:     +1
//   region 完全匹配:                +0.5
//   recency penalty:                -log2(years_old + 1) (越旧扣分越多, 但 <2 年不扣)
//   显式 decision 偏好（如调用方想优先看 'passed' 决策做反向参考）: ±2
// ============================================================

const { getDb } = require("../db");
const logger = require("../utils/logger");

function _safeJsonParse(text, fallback = null) {
  if (!text || typeof text !== "string") return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

function _yearsOldFrom(isoDate) {
  if (!isoDate) return 99;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 99;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365);
}

// stage 归一化到 3 个桶: early (天使/种子/Pre-A) / growth (A/B) / late (C+)
function _stageBucket(stage) {
  const s = String(stage || "").toLowerCase();
  if (/天使|种子|seed|angel|pre[\s_-]?a/.test(s)) return "early";
  if (/(^|[^a-z])a\b|a\s*轮|(^|[^a-z])b\b|b\s*轮/i.test(s)) return "growth";
  if (/c\s*轮|c\+|d\s*轮|pre[-_ ]?ipo/i.test(s)) return "late";
  return "unknown";
}

function _scoreDecision(row, tags) {
  let score = 0;
  if (tags.industry && row.industry && row.industry === tags.industry) score += 4;
  if (tags.sub_industry && row.sub_industry && row.sub_industry === tags.sub_industry) score += 3;
  if (tags.business_model && row.business_model && row.business_model === tags.business_model) score += 2;
  if (tags.stage && row.stage) {
    if (row.stage === tags.stage) score += 1;
    else if (_stageBucket(row.stage) === _stageBucket(tags.stage)) score += 0.5;
  }
  if (tags.region && row.region && row.region === tags.region) score += 0.5;

  const yearsOld = _yearsOldFrom(row.decision_date);
  if (yearsOld > 2) {
    score -= Math.log2(yearsOld + 1) - Math.log2(3); // 2 年内不扣，之后对数衰减
  }

  if (tags.prefer_decision && tags.prefer_decision === row.decision) score += 2;
  return Math.round(score * 100) / 100;
}

function recordDecision(deal) {
  if (!deal || !deal.company_name || !deal.industry || !deal.decision || !deal.decision_date) {
    throw new Error("recordDecision: 缺少必填字段 (company_name, industry, decision, decision_date)");
  }
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO institutional_memory
      (company_name, industry, sub_industry, business_model, stage, region,
       decision, thesis, kill_factors, precedent_outcome, decision_date,
       lead_partner, source_project_id, meta_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    deal.company_name,
    deal.industry,
    deal.sub_industry || null,
    deal.business_model || null,
    deal.stage || null,
    deal.region || null,
    deal.decision,
    deal.thesis || null,
    Array.isArray(deal.kill_factors) ? deal.kill_factors.join("\n") : (deal.kill_factors || null),
    deal.precedent_outcome || null,
    deal.decision_date,
    deal.lead_partner || null,
    deal.source_project_id || null,
    deal.meta ? JSON.stringify(deal.meta) : null,
  );
  return info.lastInsertRowid;
}

function retrieveSimilarDecisions(tags, opts = {}) {
  const db = getDb();
  const limit = Math.max(1, Math.min(20, opts.limit || 5));
  // 第一道过滤：industry / sub_industry / business_model 任一匹配的候选
  // 这样小机构 1000 条记录也能秒搜，不需要全表扫描
  const candidates = db.prepare(`
    SELECT id, company_name, industry, sub_industry, business_model, stage, region,
           decision, thesis, kill_factors, precedent_outcome, decision_date,
           lead_partner, source_project_id, meta_json, created_at
    FROM institutional_memory
    WHERE (
      (? IS NOT NULL AND industry = ?)
      OR (? IS NOT NULL AND sub_industry = ?)
      OR (? IS NOT NULL AND business_model = ?)
    )
    ORDER BY decision_date DESC
    LIMIT 200
  `).all(
    tags.industry || null, tags.industry || null,
    tags.sub_industry || null, tags.sub_industry || null,
    tags.business_model || null, tags.business_model || null,
  );

  const scored = candidates.map((row) => ({
    ...row,
    meta: _safeJsonParse(row.meta_json, null),
    similarity_score: _scoreDecision(row, tags),
  }));
  scored.sort((a, b) => b.similarity_score - a.similarity_score);
  // 阈值：相似度 < 1 的过滤掉，避免给 LLM 灌噪音
  return scored.filter((d) => d.similarity_score >= 1).slice(0, limit);
}

// 把决策列表格式化成 Fact Pack 兼容的 K 前缀 fact 数组
function formatDecisionsAsFacts(decisions, startSeq = 1) {
  if (!Array.isArray(decisions) || decisions.length === 0) return [];
  return decisions.map((d, i) => {
    const id = `K${String(startSeq + i).padStart(3, "0")}`;
    const yearsOld = _yearsOldFrom(d.decision_date).toFixed(1);
    const killSummary = d.kill_factors ? d.kill_factors.split("\n")[0] : "";
    const value = [
      `${d.company_name} (${d.industry}${d.sub_industry ? ` · ${d.sub_industry}` : ""})`,
      `决策: ${d.decision} @ ${d.decision_date} (${yearsOld} 年前)`,
      d.thesis ? `Thesis: ${d.thesis.slice(0, 120)}` : "",
      killSummary ? `主要 kill factor: ${killSummary.slice(0, 120)}` : "",
      d.precedent_outcome ? `后续结果: ${d.precedent_outcome.slice(0, 80)}` : "",
    ].filter(Boolean).join(" | ");
    return {
      id,
      field: "institutional_memory.precedent",
      label: `机构历史决策 (${d.decision})`,
      value,
      source_type: "institutional_memory",
      source_name: "机构知识库",
      source_ref: String(d.id),
      confidence: "medium", // 历史决策做参考用，不做断言依据
    };
  });
}

// 把检索到的决策格式化成 prompt 可读的"机构先例"段，供 skill 直接拼到 user message
function formatDecisionsForPrompt(decisions) {
  if (!Array.isArray(decisions) || decisions.length === 0) {
    return "【机构历史先例】无匹配先例（同行业 / 同业务模式 / 同阶段）。";
  }
  const lines = [
    `【机构历史先例】我们过去看过 ${decisions.length} 个相似项目（按匹配度排序）：`,
  ];
  decisions.forEach((d, i) => {
    const tag = d.decision === "invested" ? "✅ 投了"
      : d.decision === "passed" ? "❌ 没投"
      : d.decision === "watchlist" ? "👀 观察"
      : "📝 已记录";
    lines.push(
      `  ${i + 1}. ${tag} · ${d.company_name} (${d.industry}, ${d.stage || "stage 未填"}) — ${d.decision_date}`,
    );
    if (d.thesis) lines.push(`     thesis: ${d.thesis.slice(0, 160)}`);
    if (d.kill_factors) lines.push(`     kill factors: ${d.kill_factors.split("\n")[0].slice(0, 160)}`);
    if (d.precedent_outcome) lines.push(`     后续结果: ${d.precedent_outcome.slice(0, 100)}`);
  });
  lines.push("");
  lines.push("使用规则：这些是机构内部先例，仅作为思考参考，**不是**当前项目的事实依据。引用时用 K 编号且明确写'参考机构先例 KXXX'。");
  return lines.join("\n");
}

// 从 projects + tasks 表的现有数据反向 seed 机构记忆（用于初始化）。
// 这是个 admin 操作，不在 skill 流程里跑。
function seedFromExistingProjects(opts = {}) {
  const db = getDb();
  const limit = opts.limit || 200;
  // 只迁移 archive_number 已分配的项目（视为已"决策记录"的项目）
  const rows = db.prepare(`
    SELECT
      p.id AS source_project_id,
      p.name AS company_name,
      p.industry,
      p.sub_industry,
      p.business_model,
      p.stage,
      p.region,
      t.adjusted_score,
      t.created_at AS decision_date,
      t.archive_number
    FROM projects p
    LEFT JOIN tasks t ON t.id = p.latest_task_id
    WHERE p.archive_number IS NOT NULL OR p.latest_score IS NOT NULL
    ORDER BY p.id DESC
    LIMIT ?
  `).all(limit);

  let inserted = 0;
  for (const row of rows) {
    const existing = db.prepare(
      "SELECT id FROM institutional_memory WHERE source_project_id = ?",
    ).get(row.source_project_id);
    if (existing) continue;
    // 评分 ≥ 75 视为 invested（机构通过），50-75 视为 watchlist，< 50 视为 passed
    const score = Number(row.adjusted_score) || 0;
    const decision = score >= 75 ? "invested" : score >= 50 ? "watchlist" : "passed";
    try {
      recordDecision({
        company_name: row.company_name,
        industry: row.industry || "未分类",
        sub_industry: row.sub_industry,
        business_model: row.business_model,
        stage: row.stage,
        region: row.region,
        decision,
        thesis: `seeded · adjusted_score=${score}`,
        decision_date: (row.decision_date || new Date().toISOString()).slice(0, 10),
        source_project_id: row.source_project_id,
        meta: { archive_number: row.archive_number, adjusted_score: score, source: "seed_from_projects" },
      });
      inserted++;
    } catch (e) {
      logger.warn(`[institutionalMemory] seed 跳过 project ${row.source_project_id}: ${e.message}`);
    }
  }
  return { scanned: rows.length, inserted };
}

module.exports = {
  recordDecision,
  retrieveSimilarDecisions,
  formatDecisionsAsFacts,
  formatDecisionsForPrompt,
  seedFromExistingProjects,
  // private exposed for tests
  _private: { _scoreDecision, _stageBucket, _yearsOldFrom },
};
