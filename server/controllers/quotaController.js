// ============================================================
// server/controllers/quotaController.js — 额度查询控制器
// ============================================================

const { getDb } = require("../db");

/** GET /api/quota — 查询当前用户额度 */
function getQuota(req, res) {
  const db = getDb();
  const quota = db.prepare(
    "SELECT free_quota, paid_quota FROM quotas WHERE user_id = ?"
  ).get(req.user.id);

  if (!quota) {
    return res.json({ free: 0, paid: 0, total: 0 });
  }

  res.json({
    free: quota.free_quota,
    paid: quota.paid_quota,
    total: quota.free_quota + quota.paid_quota,
  });
}

module.exports = { getQuota };
