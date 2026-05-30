// ============================================================
// server/services/featureUsageAggregator.js
//
// Workspace 功能使用聚合（后台看板）。
// 从 workspace_feature_usage 跑 SQL GROUP BY，输出：
//   - aggregateFeatureUsage:       全站功能热度排行
//   - aggregateFeatureUsageByUser: 按用户下钻（可选按 feature 过滤）
//
// 用法（admin API）：
//   const summary = aggregateFeatureUsage({ days: 30 });
//   const drill   = aggregateFeatureUsageByUser({ days: 30, feature: "onepager_pptx" });
// ============================================================

const { getDb } = require("../db");

function _pct(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10; // 1 位小数
}

function _clampDays(days) {
  return Math.max(1, Math.min(365, parseInt(days, 10) || 30));
}

// 全站汇总：按 feature 分组，按总次数倒序
function aggregateFeatureUsage(opts = {}) {
  const days = _clampDays(opts.days);
  const db = getDb();
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT feature,
             COUNT(*)                                            AS total,
             SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
             SUM(CASE WHEN status = 'failed'  THEN 1 ELSE 0 END) AS failed,
             COUNT(DISTINCT user_id)                             AS unique_users,
             AVG(duration_ms)                                    AS avg_duration_ms
      FROM workspace_feature_usage
      WHERE created_at >= datetime('now', ?)
      GROUP BY feature
      ORDER BY total DESC
    `).all(`-${days} days`);
  } catch (e) {
    // 旧 schema 无表时降级为空
    rows = [];
  }

  const features = rows.map((r) => ({
    feature: r.feature,
    total: r.total,
    success: r.success,
    failed: r.failed,
    success_rate_pct: _pct(r.success, r.total),
    unique_users: r.unique_users,
    avg_duration_ms: Number.isFinite(r.avg_duration_ms) ? Math.round(r.avg_duration_ms) : null,
  }));

  return {
    window_days: days,
    total_events: features.reduce((s, f) => s + f.total, 0),
    generated_at: new Date().toISOString(),
    features,
  };
}

// 按用户下钻：每个用户的总调用次数 + 最常用的功能
function aggregateFeatureUsageByUser(opts = {}) {
  const days = _clampDays(opts.days);
  const limit = Math.max(1, Math.min(500, parseInt(opts.limit, 10) || 50));
  const feature = typeof opts.feature === "string" && opts.feature.trim() ? opts.feature.trim() : null;
  const db = getDb();

  const params = [`-${days} days`];
  let featureWhere = "";
  if (feature) {
    featureWhere = " AND wfu.feature = ?";
    params.push(feature);
  }

  let rows = [];
  try {
    rows = db.prepare(`
      SELECT wfu.user_id                                            AS user_id,
             u.username                                             AS username,
             COUNT(*)                                               AS total,
             SUM(CASE WHEN wfu.status = 'success' THEN 1 ELSE 0 END) AS success,
             SUM(CASE WHEN wfu.status = 'failed'  THEN 1 ELSE 0 END) AS failed,
             COUNT(DISTINCT wfu.feature)                            AS distinct_features
      FROM workspace_feature_usage wfu
      LEFT JOIN users u ON u.id = wfu.user_id
      WHERE wfu.created_at >= datetime('now', ?)${featureWhere}
      GROUP BY wfu.user_id
      ORDER BY total DESC
      LIMIT ?
    `).all(...params, limit);
  } catch (e) {
    rows = [];
  }

  // 为每个用户补一个 top_feature（该窗口内调用最多的功能）
  let topFeatureStmt = null;
  try {
    topFeatureStmt = db.prepare(`
      SELECT feature, COUNT(*) AS n
      FROM workspace_feature_usage
      WHERE user_id IS ? AND created_at >= datetime('now', ?)${feature ? " AND feature = ?" : ""}
      GROUP BY feature
      ORDER BY n DESC
      LIMIT 1
    `);
  } catch (_) {
    topFeatureStmt = null;
  }

  const users = rows.map((r) => {
    let topFeature = null;
    if (topFeatureStmt) {
      try {
        const tfParams = feature
          ? [r.user_id, `-${days} days`, feature]
          : [r.user_id, `-${days} days`];
        const tf = topFeatureStmt.get(...tfParams);
        if (tf) topFeature = { feature: tf.feature, count: tf.n };
      } catch (_) { /* ignore */ }
    }
    return {
      user_id: r.user_id,
      username: r.username || (r.user_id == null ? "(匿名)" : `#${r.user_id}`),
      total: r.total,
      success: r.success,
      failed: r.failed,
      distinct_features: r.distinct_features,
      top_feature: topFeature,
    };
  });

  return {
    window_days: days,
    feature: feature || null,
    generated_at: new Date().toISOString(),
    users,
  };
}

module.exports = { aggregateFeatureUsage, aggregateFeatureUsageByUser, _private: { _pct, _clampDays } };
