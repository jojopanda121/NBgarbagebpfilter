// ============================================================
// server/services/tokenService.js — Token 兑换码服务
// ============================================================

const crypto = require("crypto");
const { getDb } = require("../db");

/**
 * 生成兑换码
 * @param {number} quotaAmount - 额度数量
 * @param {number} expireDays - 过期天数，默认 30 天
 * @returns {string} 兑换码
 */
function generateToken(quotaAmount, expireDays = 30) {
  const token = crypto.randomBytes(8).toString("hex").toUpperCase();
  const db = getDb();

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expireDays);

  db.prepare(`
    INSERT INTO tokens (token, quota_amount, expires_at)
    VALUES (?, ?, ?)
  `).run(token, quotaAmount, expiresAt.toISOString());

  return {
    token,
    quotaAmount,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * 批量生成兑换码
 * @param {number} count - 数量
 * @param {number} quotaAmount - 每个额度
 * @param {number} expireDays - 过期天数
 * @returns {array} 生成的兑换码列表
 */
function generateTokens(count, quotaAmount, expireDays = 30) {
  const db = getDb();
  const tokens = [];
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expireDays);

  const insert = db.prepare(`
    INSERT INTO tokens (token, quota_amount, expires_at)
    VALUES (?, ?, ?)
  `);

  const generateOne = () => {
    const token = crypto.randomBytes(8).toString("hex").toUpperCase();
    insert.run(token, quotaAmount, expiresAt.toISOString());
    return { token, quotaAmount, expiresAt: expiresAt.toISOString() };
  };

  for (let i = 0; i < count; i++) {
    tokens.push(generateOne());
  }

  return tokens;
}

/**
 * 使用兑换码（使用条件更新保证原子性，避免 SQLite 不支持 FOR UPDATE）
 * @param {string} token - 兑换码
 * @param {number} userId - 用户 ID
 * @returns {object} 结果
 */
function redeemToken(token, userId) {
  const db = getDb();
  const tokenUpper = token.toUpperCase();

  try {
    // 使用事务 + 条件更新实现原子性
    const result = db.transaction(() => {
      // 1. 先查询兑换码状态
      const tokenInfo = db.prepare(`
        SELECT * FROM tokens WHERE token = ? AND used_at IS NULL
      `).get(tokenUpper);

      if (!tokenInfo) {
        throw new Error("兑换码无效或已被使用");
      }

      // 2. 检查是否过期
      if (new Date(tokenInfo.expires_at) < new Date()) {
        throw new Error("兑换码已过期");
      }

      // 3. 使用条件更新确保原子性（只有未使用的才更新）
      const updateResult = db.prepare(`
        UPDATE tokens SET used_at = datetime('now'), used_by = ?
        WHERE token = ? AND used_at IS NULL
      `).run(userId, tokenUpper);

      if (updateResult.changes === 0) {
        throw new Error("兑换码已被使用");
      }

      // 4. 为用户增加免费额度（Token 兑换属于免费额度）
      db.prepare(`
        UPDATE quotas SET free_quota = free_quota + ?, updated_at = datetime('now')
        WHERE user_id = ?
      `).run(tokenInfo.quota_amount, userId);

      // 5. 标记用户已兑换过 Token（兑换后无需绑定联系方式）
      db.prepare(`
        UPDATE users SET has_redeemed = 1, updated_at = datetime('now') WHERE id = ?
      `).run(userId);

      // 5. 记录到订单流水
      const orderNo = `REDEEM-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      db.prepare(`
        INSERT INTO orders (order_no, user_id, amount_cents, quota_amount, payment_channel, status, paid_at, created_at, updated_at)
        VALUES (?, ?, 0, ?, 'REDEEM', 'PAID', datetime('now'), datetime('now'), datetime('now'))
      `).run(orderNo, userId, tokenInfo.quota_amount);

      return {
        success: true,
        quotaAmount: tokenInfo.quota_amount,
        orderNo,
      };
    })();

    return result;
  } catch (err) {
    console.error("[Token] 兑换失败:", err.message);
    return { success: false, error: err.message || "兑换失败，请稍后重试" };
  }
}

/**
 * 获取兑换码列表（管理员）
 */
function getTokenList(limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT token, quota_amount, expires_at, used_at, used_by, created_at
    FROM tokens
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

/**
 * 获取未使用的兑换码数量
 */
function getAvailableTokenCount() {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM tokens WHERE used_at IS NULL AND expires_at > datetime('now')
  `).get();
  return row?.count || 0;
}

/**
 * 获取用户已使用的兑换码
 */
function getUserRedeemedTokens(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT token, quota_amount, used_at
    FROM tokens
    WHERE used_by = ?
    ORDER BY used_at DESC
  `).all(userId);
}

/**
 * 删除兑换码（管理员）
 */
function deleteToken(token) {
  const db = getDb();
  const result = db.prepare("DELETE FROM tokens WHERE token = ?").run(token.toUpperCase());
  return result.changes > 0;
}

/**
 * 获取兑换码详情
 */
function getTokenByToken(token) {
  const db = getDb();
  return db.prepare("SELECT * FROM tokens WHERE token = ?").get(token.toUpperCase());
}

module.exports = {
  generateToken,
  generateTokens,
  redeemToken,
  getTokenList,
  getAvailableTokenCount,
  getUserRedeemedTokens,
  deleteToken,
  getTokenByToken,
};
