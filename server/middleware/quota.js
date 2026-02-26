// ============================================================
// server/middleware/quota.js — 额度检查 & 业务拦截中间件
//
// 业务拦截器 (Interceptor)：
//   - 当用户使用次数 >= 4 且未绑定联系方式时，返回 4031
//   - 前端统一拦截 4031 状态码，弹出绑定引导框
// ============================================================

const { getDb } = require("../db");

/**
 * 检查额度是否充足（不扣减）
 * 需要先经过 requireAuth 中间件
 */
function checkQuota(req, res, next) {
  const db = getDb();
  const userId = req.user.id;

  // 查询用户完整信息（含 role、has_redeemed）
  const user = db.prepare("SELECT usage_count, contact_bound, role, has_redeemed FROM users WHERE id = ?").get(userId);
  if (!user) {
    return res.status(401).json({ error: "用户不存在" });
  }

  // 管理员无限制：跳过所有额度和绑定检查
  if (user.role === "admin") {
    return next();
  }

  // 从数据库读取联系方式绑定阈值（可动态调整）
  const thresholdSetting = db.prepare("SELECT value FROM settings WHERE key = 'contact_binding_threshold'").get();
  const bindingThreshold = thresholdSetting ? parseInt(thresholdSetting.value, 10) : 3;

  // 查询用户额度
  const quota = db.prepare("SELECT free_quota, paid_quota FROM quotas WHERE user_id = ?").get(userId);

  // 业务拦截：达到阈值 AND 未绑定 AND 未兑换过 Token AND 没有剩余额度（买的或兑换的）
  // 只要账号里有额度（不管来源），都不强制绑定
  const hasQuota = quota && (quota.free_quota > 0 || quota.paid_quota > 0);
  if (user.usage_count >= bindingThreshold && !user.contact_bound && !user.has_redeemed && !hasQuota) {
    return res.status(403).json({
      error: "请先绑定手机或邮箱",
      code: 4031,
      require_contact: true,
    });
  }

  // 检查是否有剩余额度
  if (!quota || (quota.free_quota <= 0 && quota.paid_quota <= 0)) {
    return res.status(403).json({
      error: "额度不足，请充值",
      code: 4032,
      require_payment: true,
      remaining: { free: 0, paid: 0 },
    });
  }

  req.quota = quota;
  next();
}

/**
 * 原子扣减额度（使用数据库级乐观锁）
 * 优先扣减免费额度，免费额度不足时扣减付费额度
 * 严禁在应用层"先查后扣"的非原子操作
 */
function deductQuota(userId) {
  const db = getDb();

  // 事务保证原子性
  const result = db.transaction(() => {
    // 尝试扣减免费额度（WHERE free_quota > 0 实现乐观锁）
    const freeResult = db.prepare(
      "UPDATE quotas SET free_quota = free_quota - 1, updated_at = datetime('now') WHERE user_id = ? AND free_quota > 0"
    ).run(userId);

    if (freeResult.changes > 0) {
      // 成功扣减免费额度
      db.prepare(
        "UPDATE users SET usage_count = usage_count + 1, updated_at = datetime('now') WHERE id = ?"
      ).run(userId);
      return { success: true, type: "free" };
    }

    // 免费额度不足，尝试扣减付费额度
    const paidResult = db.prepare(
      "UPDATE quotas SET paid_quota = paid_quota - 1, updated_at = datetime('now') WHERE user_id = ? AND paid_quota > 0"
    ).run(userId);

    if (paidResult.changes > 0) {
      db.prepare(
        "UPDATE users SET usage_count = usage_count + 1, updated_at = datetime('now') WHERE id = ?"
      ).run(userId);
      return { success: true, type: "paid" };
    }

    // 额度全部用尽
    return { success: false };
  })();

  return result;
}

/**
 * 退还额度（分析失败时调用）
 * 优先退还免费额度
 */
function refundQuota(userId) {
  const db = getDb();
  try {
    db.prepare(
      "UPDATE quotas SET free_quota = free_quota + 1, updated_at = datetime('now') WHERE user_id = ?"
    ).run(userId);
    return { success: true };
  } catch (err) {
    console.error("[Quota] 退还额度失败:", err.message);
    return { success: false };
  }
}

module.exports = { checkQuota, deductQuota, refundQuota };
