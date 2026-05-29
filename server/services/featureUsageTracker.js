// ============================================================
// server/services/featureUsageTracker.js
//
// Workspace 功能使用埋点（fire-and-forget）。
// 每次用户调用一个 AI 工具/技能时写一行 workspace_feature_usage，
// 供 featureUsageAggregator 跑后台"功能热度排行 + 按用户下钻"。
//
// 设计原则：
//   - 绝不影响主流程：所有异常吞掉并 logger.warn（旧 schema 无表时静默降级）。
//   - 懒加载 getDb()，与 metricsAggregator 一致。
// ============================================================

const logger = require("../utils/logger");

/**
 * 记录一次功能使用。失败不抛错。
 *
 * @param {object} args
 * @param {number|string} [args.userId]
 * @param {string} args.feature           工具/技能标识（如 onepager_pptx / web_search）
 * @param {'host_tool'|'skill_button'} [args.source='host_tool']
 * @param {'success'|'failed'} [args.status='success']
 * @param {number} [args.durationMs]
 * @param {number|string} [args.projectId]
 */
function recordFeatureUsage({ userId, feature, source = "host_tool", status = "success", durationMs = null, projectId = null } = {}) {
  if (!feature || typeof feature !== "string") return;
  try {
    const { getDb } = require("../db");
    const db = getDb();
    db.prepare(
      `INSERT INTO workspace_feature_usage (user_id, feature, source, status, duration_ms, project_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      userId != null ? Number(userId) || null : null,
      feature,
      source,
      status === "failed" ? "failed" : "success",
      Number.isFinite(durationMs) ? durationMs : null,
      projectId != null ? Number(projectId) || null : null
    );
  } catch (e) {
    logger.warn(`[featureUsage] 记录失败(已忽略): ${e.message}`);
  }
}

module.exports = { recordFeatureUsage };
