const { getDb } = require("../db");

const DAILY_LIMIT = 10;

function workspaceRateLimit(req, res, next) {
  const db = getDb();
  const tableInfo = db.prepare("PRAGMA table_info(users)").all();
  const hasVip = tableInfo.some((col) => col.name === "is_vip");

  if (!hasVip) return next();

  const user = db.prepare("SELECT role, is_vip, vip_expires_at FROM users WHERE id = ?").get(req.user.id);
  if (!user) return next();
  if (user.role === "admin") return next();

  const isVip = user.is_vip && (!user.vip_expires_at || new Date(user.vip_expires_at) > new Date());
  if (isVip) return next();

  const today = new Date().toISOString().slice(0, 10);
  const { cnt } = db.prepare(`
    SELECT COUNT(*) as cnt FROM workspace_messages wm
    JOIN workspace_conversations wc ON wc.id = wm.conversation_id
    WHERE wc.user_id = ? AND wm.role = 'user' AND wm.created_at >= ?
  `).get(req.user.id, today + " 00:00:00");

  if (cnt >= DAILY_LIMIT) {
    return res.status(429).json({
      error: `每日对话次数已达上限（${DAILY_LIMIT} 次）。升级 VIP 可解锁无限对话。`,
      code: "WORKSPACE_RATE_LIMIT",
    });
  }
  next();
}

module.exports = { workspaceRateLimit };
