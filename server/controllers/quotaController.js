// ============================================================
// server/controllers/quotaController.js — 额度查询控制器
// ============================================================

const { getUserQuota } = require("../services/quotaService");

/** GET /api/quota — 查询当前用户额度 */
function getQuota(req, res) {
  const quota = getUserQuota(req.user.id);
  res.json(quota);
}

module.exports = { getQuota };
