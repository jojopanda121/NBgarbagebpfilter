// ============================================================
// server/routes/stats.js — 平台数据统计 API
//
// 模块5: 平台公共数据看板（2.1）
// 模块6: 赛道情报（2.2）
// 模块7: 个人工作台数据（2.3）
// ============================================================

const { Router } = require("express");
const { getDb } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = Router();

function escapeLike(str = "") {
  return String(str).replace(/[\\%_]/g, "\\$&");
}

// 平台早期数量展示倍数（所有数量类指标统一放大，保持数据间比例一致）
const DISPLAY_MULTIPLIER = 5;

// 平台统计缓存（避免每次都全表扫描）
let platformStatsCache = null;
let platformStatsCacheTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1小时

/**
 * GET /api/stats/platform — 平台公共数据（无需登录）
 * 包含：累计分析数、评级分布、赛道热度 Top 10、地域分布、月度新增趋势
 */
router.get("/platform", (req, res) => {
  const now = Date.now();
  if (platformStatsCache && (now - platformStatsCacheTime) < CACHE_TTL_MS) {
    return res.json(platformStatsCache);
  }

  try {
    const db = getDb();

    // 累计分析总数
    const totalRow = db.prepare(
      "SELECT COUNT(*) as cnt FROM tasks WHERE status = 'complete'"
    ).get();
    const totalCount = totalRow?.cnt || 0;

    // 本周新增（实际值）
    const weekStart = (() => {
      const d = new Date();
      const day = d.getDay();
      d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    })();
    const weeklyRow = db.prepare(
      "SELECT COUNT(*) as cnt FROM tasks WHERE status = 'complete' AND created_at >= ?"
    ).get(weekStart);
    const actualWeeklyCount = weeklyRow?.cnt || 0;

    // 评级分布
    const gradeRows = db.prepare(`
      SELECT
        CASE
          WHEN total_score >= 85 THEN 'A'
          WHEN total_score >= 70 THEN 'B'
          WHEN total_score >= 60 THEN 'C'
          ELSE 'D'
        END as grade,
        COUNT(*) as cnt
      FROM tasks
      WHERE status = 'complete' AND total_score IS NOT NULL
      GROUP BY grade
    `).all();
    const gradeDistribution = { A: 0, B: 0, C: 0, D: 0 };
    for (const r of gradeRows) {
      gradeDistribution[r.grade] = r.cnt;
    }

    // 赛道热度 Top 10（基于 industry_category，JSON 数组格式）
    // M6: 限制扫描行数，避免全表扫描在百万级数据下吃光内存
    const allTasks = db.prepare(
      "SELECT industry_category FROM tasks WHERE status = 'complete' AND industry_category IS NOT NULL ORDER BY created_at DESC LIMIT 50000"
    ).all();
    const sectorMap = {};
    for (const t of allTasks) {
      let cats = [];
      try { cats = JSON.parse(t.industry_category); } catch { cats = [t.industry_category]; }
      if (!Array.isArray(cats)) cats = [cats];
      for (const c of cats) {
        if (c) sectorMap[c] = (sectorMap[c] || 0) + 1;
      }
    }
    const sectorTop10 = Object.entries(sectorMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([sector, count]) => ({ sector, count }));

    // 地域分布 Top 10
    const locationRows = db.prepare(`
      SELECT project_location, COUNT(*) as cnt
      FROM tasks
      WHERE status = 'complete' AND project_location IS NOT NULL AND project_location != '未知'
      GROUP BY project_location
      ORDER BY cnt DESC
      LIMIT 10
    `).all();

    // 月度新增趋势（近6个月）
    const monthlyRows = db.prepare(`
      SELECT
        strftime('%Y-%m', created_at) as month,
        COUNT(*) as cnt
      FROM tasks
      WHERE status = 'complete'
        AND created_at >= datetime('now', '-6 months')
      GROUP BY month
      ORDER BY month ASC
    `).all();

    // 平均分和最高分
    const scoreRow = db.prepare(`
      SELECT AVG(total_score) as avg_score, MAX(total_score) as top_score
      FROM tasks
      WHERE status = 'complete' AND total_score IS NOT NULL
    `).get();

    // 所有数量类指标统一 ×DISPLAY_MULTIPLIER，保持数据间比例一致
    const M = DISPLAY_MULTIPLIER;
    const displayGradeDistribution = {};
    for (const [g, cnt] of Object.entries(gradeDistribution)) {
      displayGradeDistribution[g] = cnt * M;
    }

    const result = {
      total_count: totalCount * M,
      weekly_new_display: actualWeeklyCount * M,
      weekly_new_actual: actualWeeklyCount, // 仅内部使用
      avg_score: scoreRow?.avg_score ? Math.round(scoreRow.avg_score * 10) / 10 : null,
      top_score: scoreRow?.top_score ? Math.round(scoreRow.top_score) : null,
      grade_distribution: displayGradeDistribution,
      sector_top10: sectorTop10.map(s => ({ sector: s.sector, count: s.count * M })),
      location_top10: locationRows.map(r => ({
        location: r.project_location,
        count: r.cnt * M,
      })),
      monthly_trend: monthlyRows.map(r => ({
        month: r.month,
        count: r.cnt * M,
      })),
      cached_at: new Date().toISOString(),
    };

    platformStatsCache = result;
    platformStatsCacheTime = now;

    res.json(result);
  } catch (err) {
    console.error("[stats] platform stats error:", err.message);
    res.status(500).json({ error: "统计数据获取失败" });
  }
});

/**
 * GET /api/stats/sector — 赛道情报（各赛道详细数据）
 * 查询参数: ?sector=人工智能
 * 所有数量类指标统一 ×DISPLAY_MULTIPLIER
 */
router.get("/sector", (req, res) => {
  const { sector } = req.query;
  if (!sector) return res.status(400).json({ error: "请指定赛道名称" });

  try {
    const db = getDb();
    const weekStart = (() => {
      const d = new Date();
      const day = d.getDay();
      d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    })();

    const safeSector = `%${escapeLike(sector)}%`;

    // 本赛道总数
    const allRows = db.prepare(
      "SELECT id FROM tasks WHERE status = 'complete' AND industry_category LIKE ? ESCAPE '\\'"
    ).all(safeSector);

    // 本周新增（实际值）
    const weeklyRows = db.prepare(
      "SELECT COUNT(*) as cnt FROM tasks WHERE status = 'complete' AND industry_category LIKE ? ESCAPE '\\' AND created_at >= ?"
    ).get(safeSector, weekStart);
    const actualWeekly = weeklyRows?.cnt || 0;

    // 评分统计
    const scoreRow = db.prepare(`
      SELECT AVG(total_score) as avg_score, MAX(total_score) as top_score
      FROM tasks
      WHERE status = 'complete' AND industry_category LIKE ? ESCAPE '\\' AND total_score IS NOT NULL
    `).get(safeSector);

    // 评级分布
    const gradeRows = db.prepare(`
      SELECT
        CASE
          WHEN total_score >= 85 THEN 'A'
          WHEN total_score >= 70 THEN 'B'
          WHEN total_score >= 60 THEN 'C'
          ELSE 'D'
        END as grade,
        COUNT(*) as cnt
      FROM tasks
      WHERE status = 'complete' AND industry_category LIKE ? ESCAPE '\\' AND total_score IS NOT NULL
      GROUP BY grade
    `).all(safeSector);
    const gradeDistribution = { A: 0, B: 0, C: 0, D: 0 };
    for (const r of gradeRows) gradeDistribution[r.grade] = r.cnt;

    // 统一 ×DISPLAY_MULTIPLIER
    const M = DISPLAY_MULTIPLIER;
    const displayGrade = {};
    for (const [g, cnt] of Object.entries(gradeDistribution)) {
      displayGrade[g] = cnt * M;
    }

    res.json({
      sector,
      total_count: allRows.length * M,
      weekly_new_display: actualWeekly * M,
      avg_score: scoreRow?.avg_score ? Math.round(scoreRow.avg_score * 10) / 10 : null,
      top_score: scoreRow?.top_score ? Math.round(scoreRow.top_score) : null,
      grade_distribution: displayGrade,
    });
  } catch (err) {
    console.error("[stats] sector stats error:", err.message);
    res.status(500).json({ error: "赛道数据获取失败" });
  }
});

/**
 * GET /api/stats/personal — 个人工作台数据（需登录）
 */
router.get("/personal", requireAuth, (req, res) => {
  const userId = req.user.id;
  try {
    const db = getDb();

    const now = new Date();
    // 本月1号
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    // 本季度1号
    const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
    const quarterStart = new Date(now.getFullYear(), quarterMonth, 1).toISOString();

    // 本月分析数
    const monthRow = db.prepare(
      "SELECT COUNT(*) as cnt FROM tasks WHERE user_id = ? AND status = 'complete' AND created_at >= ?"
    ).get(userId, monthStart);

    // 本季度分析数
    const quarterRow = db.prepare(
      "SELECT COUNT(*) as cnt FROM tasks WHERE user_id = ? AND status = 'complete' AND created_at >= ?"
    ).get(userId, quarterStart);

    // 平均分和最高分（全部历史）
    const scoreRow = db.prepare(`
      SELECT AVG(COALESCE(adjusted_score, total_score)) as avg_score,
             MAX(COALESCE(adjusted_score, total_score)) as top_score
      FROM tasks
      WHERE user_id = ? AND status = 'complete'
        AND (adjusted_score IS NOT NULL OR total_score IS NOT NULL)
    `).get(userId);

    // 项目管道统计（按投资阶段分组）
    const stageRows = db.prepare(`
      SELECT project_stage, COUNT(*) as cnt
      FROM tasks
      WHERE user_id = ? AND status = 'complete'
      GROUP BY project_stage
    `).all(userId);
    const stageCounts = {};
    for (const r of stageRows) stageCounts[r.project_stage || "new"] = r.cnt;

    // 即将到期的跟进（最近7天内）
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const followupRows = db.prepare(`
      SELECT id, title, next_followup_date, project_stage
      FROM tasks
      WHERE user_id = ? AND status = 'complete'
        AND next_followup_date IS NOT NULL
        AND next_followup_date <= ?
      ORDER BY next_followup_date ASC
      LIMIT 5
    `).all(userId, nextWeek);

    res.json({
      month_count: monthRow?.cnt || 0,
      quarter_count: quarterRow?.cnt || 0,
      avg_score: scoreRow?.avg_score ? Math.round(scoreRow.avg_score * 10) / 10 : null,
      top_score: scoreRow?.top_score ? Math.round(scoreRow.top_score) : null,
      pipeline: {
        new: stageCounts["new"] || 0,
        reviewed: stageCounts["reviewed"] || 0,
        dd_pending: stageCounts["dd_pending"] || 0,
        dd_in_progress: stageCounts["dd_in_progress"] || 0,
        dd_done: stageCounts["dd_done"] || 0,
        decided: stageCounts["decided"] || 0,
        passed: stageCounts["passed"] || 0,
      },
      upcoming_followups: followupRows.map(r => ({
        id: r.id,
        title: r.title || "BP项目",
        date: r.next_followup_date,
        stage: r.project_stage,
      })),
    });
  } catch (err) {
    console.error("[stats] personal stats error:", err.message);
    res.status(500).json({ error: "个人统计数据获取失败" });
  }
});

module.exports = router;
