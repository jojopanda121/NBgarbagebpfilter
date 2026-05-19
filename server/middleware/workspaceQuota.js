const { getDb } = require("../db");
const { getUserPlan } = require("../utils/userPlan");

const DAILY_LIMIT = Number(process.env.WORKSPACE_DAILY_CHAT_LIMIT) || 3;

function getWorkspaceUsage(userId) {
  const db = getDb();
  const plan = getUserPlan(db, userId);
  const isAdmin = plan.role === "admin";
  const isVip = plan.isVip;
  const unlimited = isAdmin || isVip;

  const today = new Date().toISOString().slice(0, 10);
  const { cnt } = db.prepare(`
    SELECT COUNT(*) as cnt FROM workspace_messages wm
    JOIN workspace_conversations wc ON wc.id = wm.conversation_id
    WHERE wc.user_id = ? AND wm.role = 'user' AND wm.created_at >= ?
  `).get(userId, today + " 00:00:00");

  return {
    daily_limit: DAILY_LIMIT,
    used_today: cnt || 0,
    remaining: unlimited ? null : Math.max(0, DAILY_LIMIT - (cnt || 0)),
    unlimited,
    is_vip: isVip,
    is_admin: isAdmin,
  };
}

function workspaceRateLimit(req, res, next) {
  const usage = getWorkspaceUsage(req.user.id);
  if (usage.unlimited) return next();
  if ((usage.remaining ?? 0) <= 0) {
    return res.status(429).json({
      error: `每日对话次数已达上限（${DAILY_LIMIT} 次）。升级 VIP 可解锁无限对话。`,
      code: "WORKSPACE_RATE_LIMIT",
    });
  }
  next();
}

module.exports = { workspaceRateLimit, getWorkspaceUsage, DAILY_LIMIT };
