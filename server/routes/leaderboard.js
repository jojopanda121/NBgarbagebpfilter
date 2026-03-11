const { Router } = require("express");
const { getDb } = require("../db");

const router = Router();

/** 计算周期的起止时间 */
function getPeriodRange(period) {
  const now = new Date();
  let start, end;

  if (period === "weekly") {
    // 本周一 00:00 到下周一 00:00
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    start = new Date(now);
    start.setDate(now.getDate() - diffToMonday);
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setDate(start.getDate() + 7);
  } else {
    // 本月 1 号 00:00 到下月 1 号 00:00
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

// GET /api/leaderboard?period=weekly|monthly
router.get("/", (req, res) => {
  const period = req.query.period === "monthly" ? "monthly" : "weekly";

  try {
    const db = getDb();
    const { start, end } = getPeriodRange(period);

    // 分析数量榜 — Top 5
    const countBoard = db.prepare(`
      SELECT u.username, COUNT(*) as count
      FROM tasks t
      JOIN users u ON t.user_id = u.id
      WHERE t.status = 'complete'
        AND t.created_at >= ? AND t.created_at < ?
      GROUP BY t.user_id
      ORDER BY count DESC
      LIMIT 5
    `).all(start, end);

    // 最高分数榜 — Top 5（每个用户取最高分）
    const scoreBoard = db.prepare(`
      SELECT u.username, MAX(t.total_score) as max_score
      FROM tasks t
      JOIN users u ON t.user_id = u.id
      WHERE t.status = 'complete'
        AND t.total_score IS NOT NULL
        AND t.created_at >= ? AND t.created_at < ?
      GROUP BY t.user_id
      ORDER BY max_score DESC
      LIMIT 5
    `).all(start, end);

    res.json({
      period,
      period_start: start,
      period_end: end,
      count_board: countBoard.map((r, i) => ({
        rank: i + 1,
        username: r.username,
        count: r.count,
      })),
      score_board: scoreBoard.map((r, i) => ({
        rank: i + 1,
        username: r.username,
        max_score: Math.round(r.max_score),
      })),
    });
  } catch (err) {
    console.error("排行榜查询失败:", err.message);
    res.json({ period, count_board: [], score_board: [] });
  }
});

module.exports = router;
