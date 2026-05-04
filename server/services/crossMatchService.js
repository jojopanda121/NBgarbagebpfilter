// ============================================================
// server/services/crossMatchService.js — 项目交叉识别服务
// PRIVACY: 只操作哈希指纹，绝不读取其他用户原始 BP
// ============================================================

const crypto = require("crypto");
const { getDb } = require("../db");
const logger = require("../utils/logger");

/**
 * 生成项目指纹哈希（基于公司名+创始人信息+赛道+估值量级组合）
 * PRIVACY: 只存哈希，无法从哈希还原原始数据
 */
function buildProjectFingerprint(projectSummary, founderProfile) {
  const parts = [
    (projectSummary?.company_name || "").toLowerCase().trim(),
    (projectSummary?.industry || "").toLowerCase().trim(),
    // 估值量级（取整数量级，避免小变化造成指纹不同）
    String(Math.round((projectSummary?.claimed_valuation_rmb || 0) / 10) * 10),
  ];

  // 若有创始人信息，加入第一个创始人的加密名作为额外指纹
  const firstFounder = founderProfile?.founders?.[0];
  if (firstFounder?.full_name_encrypted) {
    parts.push(firstFounder.full_name_encrypted.slice(0, 32));
  }

  const fingerprint = parts.filter(Boolean).join("|");
  if (!fingerprint || fingerprint === "||0") return null;

  return crypto.createHash("sha256").update(fingerprint).digest("hex");
}

/**
 * 生成创始人哈希（基于加密名+第一个邮箱hash）
 * PRIVACY: 双重哈希，不可逆
 */
function buildFounderHash(founderProfile) {
  const founders = founderProfile?.founders || [];
  if (founders.length === 0) return null;
  const f = founders[0];
  const parts = [
    f.full_name_encrypted?.slice(0, 32) || "",
    f.email_hashes?.[0] || "",
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

/**
 * 登记项目指纹，更新计数；若已存在则 view_count++
 * 返回交叉识别结果（供报告展示）
 * PRIVACY: 只更新计数和均分，不关联用户身份
 */
function upsertProjectFingerprint(fingerprintHash, score) {
  if (!fingerprintHash) return null;
  try {
    const db = getDb();
    const existing = db.prepare(
      "SELECT id, view_count, avg_score FROM project_fingerprints WHERE fingerprint_hash = ?"
    ).get(fingerprintHash);

    if (existing) {
      const newCount = existing.view_count + 1;
      const newAvgScore = existing.avg_score
        ? ((existing.avg_score * existing.view_count) + (score || 0)) / newCount
        : (score || null);
      db.prepare(
        "UPDATE project_fingerprints SET view_count = ?, avg_score = ?, last_seen_at = CURRENT_TIMESTAMP WHERE fingerprint_hash = ?"
      ).run(newCount, newAvgScore, fingerprintHash);
      return { view_count: newCount, avg_score: newAvgScore };
    } else {
      db.prepare(
        "INSERT INTO project_fingerprints (fingerprint_hash, view_count, avg_score) VALUES (?, 1, ?)"
      ).run(fingerprintHash, score || null);
      return { view_count: 1, avg_score: score || null };
    }
  } catch (err) {
    logger.warn("[CrossMatch] upsertProjectFingerprint 失败:", err.message);
    return null;
  }
}

/**
 * 登记创始人提交记录
 */
function recordFounderSubmission(founderHash, fingerprintHash, taskId, score) {
  if (!founderHash) return;
  try {
    const db = getDb();
    db.prepare(
      "INSERT INTO founder_submissions (founder_hash, project_fingerprint, task_id, score) VALUES (?, ?, ?, ?)"
    ).run(founderHash, fingerprintHash || "", taskId, score || null);
  } catch (err) {
    logger.warn("[CrossMatch] recordFounderSubmission 失败:", err.message);
  }
}

/**
 * 查询创始人历史提交（用于报告展示）
 * PRIVACY: 只返回汇总统计，不返回其他用户的任务 ID 或评分明细
 */
function getFounderHistory(founderHash) {
  if (!founderHash) return null;
  try {
    const db = getDb();
    const result = db.prepare(`
      SELECT COUNT(*) as submission_count, AVG(score) as avg_score,
             MAX(submitted_at) as last_seen
      FROM founder_submissions
      WHERE founder_hash = ?
    `).get(founderHash);
    if (!result || result.submission_count <= 1) return null;
    return {
      submission_count: result.submission_count,
      avg_score: result.avg_score ? Math.round(result.avg_score * 10) / 10 : null,
    };
  } catch (err) {
    logger.warn("[CrossMatch] getFounderHistory 失败:", err.message);
    return null;
  }
}

/**
 * 主函数：执行交叉识别并返回可展示的跨机构洞察
 * PRIVACY: 返回数据不包含任何其他用户的身份信息
 */
function runCrossMatch({ taskId, multiagent, score }) {
  if (!multiagent) return null;

  const fingerprintHash = buildProjectFingerprint(
    multiagent.project_summary,
    multiagent.founder_profile
  );
  const founderHash = buildFounderHash(multiagent.founder_profile);

  const fpResult = upsertProjectFingerprint(fingerprintHash, score);
  recordFounderSubmission(founderHash, fingerprintHash, taskId, score);
  const founderHistory = getFounderHistory(founderHash);

  // 只有 view_count > 1 时才返回有意义的提示
  const crossMatchInsights = {};

  if (fpResult && fpResult.view_count > 1) {
    crossMatchInsights.project_seen_count = fpResult.view_count;
    if (fpResult.avg_score) {
      crossMatchInsights.project_avg_score = Math.round(fpResult.avg_score * 10) / 10;
    }
  }

  if (founderHistory) {
    crossMatchInsights.founder_submission_count = founderHistory.submission_count;
    crossMatchInsights.founder_avg_score = founderHistory.avg_score;
  }

  return Object.keys(crossMatchInsights).length > 0 ? crossMatchInsights : null;
}

module.exports = { runCrossMatch, buildProjectFingerprint, buildFounderHash };
