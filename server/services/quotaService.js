// ============================================================
// server/services/quotaService.js — 额度服务层
// 封装所有额度相关的数据库操作
// ============================================================

const { getDb } = require("../db");

/**
 * 获取用户额度信息
 * @param {number} userId
 * @returns {{ free: number, paid: number, total: number }}
 */
function getUserQuota(userId) {
  const db = getDb();
  const quota = db.prepare(
    "SELECT free_quota, paid_quota FROM quotas WHERE user_id = ?"
  ).get(userId);

  if (!quota) {
    return { free: 0, paid: 0, total: 0 };
  }

  return {
    free: quota.free_quota,
    paid: quota.paid_quota,
    total: quota.free_quota + quota.paid_quota,
  };
}

/**
 * 扣减用户额度（优先扣减免费额度）
 * @param {number} userId
 * @returns {boolean} 是否扣减成功
 */
function deductQuota(userId) {
  const db = getDb();

  return db.transaction(() => {
    const quota = db.prepare(
      "SELECT free_quota, paid_quota FROM quotas WHERE user_id = ?"
    ).get(userId);

    if (!quota) return false;

    // 优先扣减免费额度
    if (quota.free_quota > 0) {
      db.prepare(
        "UPDATE quotas SET free_quota = free_quota - 1 WHERE user_id = ?"
      ).run(userId);
    } else if (quota.paid_quota > 0) {
      db.prepare(
        "UPDATE quotas SET paid_quota = paid_quota - 1 WHERE user_id = ?"
      ).run(userId);
    } else {
      return false;
    }

    // 更新用户使用次数
    db.prepare(
      "UPDATE users SET usage_count = usage_count + 1 WHERE id = ?"
    ).run(userId);

    return true;
  })();
}

/**
 * 增加用户付费额度
 * @param {number} userId
 * @param {number} amount
 */
function addPaidQuota(userId, amount) {
  const db = getDb();
  db.prepare(
    "UPDATE quotas SET paid_quota = paid_quota + ? WHERE user_id = ?"
  ).run(amount, userId);
}

/**
 * 初始化用户额度
 * @param {number} userId
 * @param {number} freeQuota
 */
function initializeQuota(userId, freeQuota) {
  const db = getDb();
  db.prepare(
    "INSERT INTO quotas (user_id, free_quota, paid_quota) VALUES (?, ?, 0)"
  ).run(userId, freeQuota);
}

module.exports = {
  getUserQuota,
  deductQuota,
  addPaidQuota,
  initializeQuota,
};
