// ============================================================
// calibrationService.js — 诊断式校准/回测层（投资判断内核 v3，第9部分）
//
// 设计决策（与用户确认）：**不做自动参数反解**。几十个噪声样本上反解 ~20 个
// 权重/阈值/聚合系数必然过拟合，且把可解释的内核变成黑箱，违反产品哲学。
// 本层只做两件事：
//   1) 留痕：每次打分归档一份 judgment 快照（recordJudgment）。
//   2) 诊断：GP 标注真实标签后，算排序吻合度 / 系统性偏差 / 规则命中×结果 /
//      分布漂移（runDiagnostics）。参数仍手设可解释，标签只诊断、不回写。
//
// 纯诊断函数（rankingConcordance / systematicBias / ruleBacktest / driftReport）
// 不依赖 DB，可单测；持久化包装函数接受注入的 db（默认 getDb），与其他 service 一致。
// ============================================================

const logger = require("../utils/logger");

// —— GP 标签 → 偏好序数（越大=越想投）——
const LABEL_RANK = {
  投: 3, fast_track: 3, "强烈推荐": 3,
  dd: 2, "尽调": 2, "谨慎推荐": 2,
  观望: 1, watch: 1, "跟踪": 1,
  放弃: 0, pass: 0, reject: 0,
};
function labelToRank(label) {
  if (label == null) return null;
  const key = String(label).trim().toLowerCase();
  // 既支持中文键也支持英文键
  if (LABEL_RANK[label] != null) return LABEL_RANK[label];
  if (LABEL_RANK[key] != null) return LABEL_RANK[key];
  return null;
}

function _mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function _median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function _std(xs) {
  const m = _mean(xs);
  if (m == null) return null;
  return Math.sqrt(_mean(xs.map((x) => (x - m) ** 2)));
}
function _round(n, d = 2) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/**
 * 排序吻合度（Kendall τ 风格）：分数序是否吻合 GP 真实偏好序。
 * @param {Array<{score:number, rank:number}>} records
 */
function rankingConcordance(records) {
  const pts = records
    .map((r) => ({ score: Number(r.score), rank: Number(r.rank) }))
    .filter((r) => Number.isFinite(r.score) && Number.isFinite(r.rank));
  let concordant = 0, discordant = 0, ties = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const ds = pts[i].score - pts[j].score;
      const dr = pts[i].rank - pts[j].rank;
      if (ds === 0 || dr === 0) { ties++; continue; }
      if (Math.sign(ds) === Math.sign(dr)) concordant++;
      else discordant++;
    }
  }
  const denom = concordant + discordant;
  return {
    n: pts.length,
    concordant, discordant, ties,
    tau: denom ? _round((concordant - discordant) / denom) : null,
  };
}

/**
 * 系统性偏差：各标签的平均分；并检查"投>观望>放弃"的均分序是否正确。
 * @param {Array<{score:number, label:string}>} records
 */
function systematicBias(records) {
  const byLabel = {};
  for (const r of records) {
    const score = Number(r.score);
    if (!Number.isFinite(score) || r.label == null) continue;
    (byLabel[r.label] = byLabel[r.label] || []).push(score);
  }
  const summary = {};
  const ranked = [];
  for (const [label, scores] of Object.entries(byLabel)) {
    const mean = _round(_mean(scores));
    summary[label] = { n: scores.length, mean };
    const rank = labelToRank(label);
    if (rank != null && mean != null) ranked.push({ rank, mean });
  }
  // 均分应随偏好序数单调递增
  ranked.sort((a, b) => a.rank - b.rank);
  let orderingOk = true;
  for (let i = 1; i < ranked.length; i++) {
    if (ranked[i].mean < ranked[i - 1].mean) { orderingOk = false; break; }
  }
  return { by_label: summary, ordering_ok: orderingOk };
}

/**
 * 规则回测：每条触发过的规则 tag，其样本的平均偏好序数 vs 全样本均值 → lift。
 * lift>0 = 该规则倾向出现在 GP 想投的项目（alpha 候选）；lift<0 = 偏见候选。
 * @param {Array<{tags:string[], rank:number}>} records
 */
function ruleBacktest(records) {
  const pts = records
    .map((r) => ({ tags: Array.isArray(r.tags) ? r.tags : [], rank: Number(r.rank) }))
    .filter((r) => Number.isFinite(r.rank));
  const overall = _mean(pts.map((r) => r.rank));
  const tagStats = {};
  const allTags = new Set();
  for (const p of pts) for (const t of p.tags) allTags.add(t);
  for (const tag of allTags) {
    const withTag = pts.filter((p) => p.tags.includes(tag));
    const meanWith = _mean(withTag.map((p) => p.rank));
    const lift = meanWith != null && overall != null ? meanWith - overall : null;
    let verdict = "neutral";
    if (lift != null && lift >= 0.3) verdict = "alpha候选";
    else if (lift != null && lift <= -0.3) verdict = "偏见候选";
    tagStats[tag] = {
      triggered: withTag.length,
      mean_rank: _round(meanWith),
      lift: _round(lift),
      verdict,
    };
  }
  return { overall_mean_rank: _round(overall), n: pts.length, by_tag: tagStats };
}

/**
 * 漂移监测：当前分数分布相对基准分布的偏移（均值/中位/标准差差异）。
 * @param {number[]} current
 * @param {number[]} baseline
 */
function driftReport(current, baseline) {
  const cur = current.map(Number).filter(Number.isFinite);
  const base = baseline.map(Number).filter(Number.isFinite);
  return {
    n_current: cur.length, n_baseline: base.length,
    mean_shift: _round((_mean(cur) ?? 0) - (_mean(base) ?? 0)),
    median_shift: _round((_median(cur) ?? 0) - (_median(base) ?? 0)),
    std_current: _round(_std(cur)),
    std_baseline: _round(_std(base)),
  };
}

/** 把一组归档记录跑全套诊断 */
function summarizeDiagnostics(records) {
  const labeled = records.filter((r) => r.label != null && labelToRank(r.label) != null)
    .map((r) => ({ ...r, rank: labelToRank(r.label) }));
  return {
    total_records: records.length,
    labeled_records: labeled.length,
    ranking_concordance: rankingConcordance(labeled),
    systematic_bias: systematicBias(labeled),
    rule_backtest: ruleBacktest(labeled),
    note: "诊断式校准：仅排序/偏差/规则回测，不自动反解内核参数（参数手设可解释）",
  };
}

// ============================================================
// 持久化包装（接受注入 db，默认 getDb；DB 不可用时静默降级不阻塞主流程）
// ============================================================
function _getDb() {
  try { return require("../db").getDb(); } catch (_) { return null; }
}

/** 从一次评分结果归档 judgment 快照（不阻塞主流程，失败仅 warn） */
function recordJudgment({ db, taskId = null, projectName = null, industryCategory = null,
  pipelineVersion = null, verdict = {}, scoringResult = {} } = {}) {
  const database = db || _getDb();
  if (!database) return null;
  try {
    const dims = verdict.dimensions || scoringResult.dimensions || {};
    const dimScore = (k) => (dims[k] && typeof dims[k] === "object" ? dims[k].score : dims[k]) ?? null;
    const agg = scoringResult.scoring_agg_shadow || null;
    const policy = scoringResult.policy_fit || agg?.policy_fit || null;
    const tags = (scoringResult.triggered_rules || agg?.triggered_rules || []).map((r) => r.tag).filter(Boolean);
    const cov = agg?.coverages || null;
    const stmt = database.prepare(`
      INSERT INTO scoring_calibration
        (task_id, project_name, industry_category, pipeline_version, scoring_agg_basis,
         total_score, grade, confidence, dims_json, coverages_json, policy_tier, policy_readout,
         triggered_tags_json, integrity_veto, agg_shadow_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    stmt.run(
      taskId, projectName, industryCategory, pipelineVersion,
      scoringResult.scoring_agg_basis || "legacy",
      verdict.total_score ?? scoringResult.total_score ?? null,
      verdict.grade ?? scoringResult.grade ?? null,
      (verdict.total_distribution?.confidence) || agg?.confidence || null,
      JSON.stringify({ s1: dimScore("timing_ceiling"), s2: dimScore("product_moat"),
        s3: dimScore("business_validation"), s4: dimScore("team"), s5: dimScore("external_risk") }),
      cov ? JSON.stringify(cov) : null,
      policy?.tier || null,
      policy?.readout_score ?? null,
      JSON.stringify(tags),
      (verdict.integrity_veto?.triggered || scoringResult.integrity_veto?.triggered) ? 1 : 0,
      agg ? JSON.stringify(agg) : null
    );
    return true;
  } catch (err) {
    logger.warn("[calibration] recordJudgment 失败（忽略）:", err.message);
    return null;
  }
}

/** GP 事后标注真实标签 */
function setGpLabel({ db, id = null, taskId = null, label, outcome = null } = {}) {
  const database = db || _getDb();
  if (!database || (id == null && taskId == null)) return false;
  try {
    const where = id != null ? "id = ?" : "task_id = ?";
    const arg = id != null ? id : taskId;
    database.prepare(
      `UPDATE scoring_calibration SET gp_label = ?, gp_label_at = datetime('now'), outcome_json = ? WHERE ${where}`
    ).run(label, outcome ? JSON.stringify(outcome) : null, arg);
    return true;
  } catch (err) {
    logger.warn("[calibration] setGpLabel 失败:", err.message);
    return false;
  }
}

/** 读出归档记录（映射为诊断输入形态） */
function loadRecords({ db, pipelineVersion = null } = {}) {
  const database = db || _getDb();
  if (!database) return [];
  try {
    const rows = pipelineVersion
      ? database.prepare("SELECT * FROM scoring_calibration WHERE pipeline_version = ?").all(pipelineVersion)
      : database.prepare("SELECT * FROM scoring_calibration").all();
    return rows.map((r) => ({
      id: r.id, score: r.total_score, label: r.gp_label,
      tags: _safeParse(r.triggered_tags_json, []),
      grade: r.grade, policy_readout: r.policy_readout,
    }));
  } catch (err) {
    logger.warn("[calibration] loadRecords 失败:", err.message);
    return [];
  }
}

function _safeParse(s, fallback) {
  try { return JSON.parse(s); } catch (_) { return fallback; }
}

/** 跑全套诊断（读库 → 诊断） */
function runDiagnostics({ db, pipelineVersion = null } = {}) {
  return summarizeDiagnostics(loadRecords({ db, pipelineVersion }));
}

module.exports = {
  // 纯诊断（可单测）
  labelToRank,
  rankingConcordance,
  systematicBias,
  ruleBacktest,
  driftReport,
  summarizeDiagnostics,
  // 持久化
  recordJudgment,
  setGpLabel,
  loadRecords,
  runDiagnostics,
};
