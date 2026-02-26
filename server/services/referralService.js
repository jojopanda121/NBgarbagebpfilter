// ============================================================
// server/services/referralService.js — 邀请拉新服务
// ============================================================

const crypto = require("crypto");
const { getDb } = require("../db");

/**
 * 获取或创建用户邀请码（8位随机字符）
 */
function getOrCreateInviteCode(userId) {
  const db = getDb();
  const user = db.prepare("SELECT invite_code FROM users WHERE id = ?").get(userId);
  if (user && user.invite_code) return user.invite_code;

  const code = crypto.randomBytes(4).toString("hex"); // 8位
  db.prepare("UPDATE users SET invite_code = ? WHERE id = ?").run(code, userId);
  return code;
}

/**
 * 根据邀请码查找邀请人
 */
function getUserByInviteCode(inviteCode) {
  if (!inviteCode) return null;
  const db = getDb();
  return db.prepare("SELECT id, username FROM users WHERE invite_code = ?").get(inviteCode);
}

/**
 * 处理邀请关系：记录 + 奖励邀请人 +2 free_quota
 * 防自刷：inviter_id !== invitee_id
 */
function processReferral(inviterId, inviteeId, source = "invite_link") {
  if (!inviterId || !inviteeId || inviterId === inviteeId) return false;

  const db = getDb();

  // 检查是否已存在邀请关系
  const existing = db.prepare("SELECT id FROM referrals WHERE invitee_id = ?").get(inviteeId);
  if (existing) return false;

  try {
    db.transaction(() => {
      db.prepare(
        "INSERT INTO referrals (inviter_id, invitee_id, source, rewarded) VALUES (?, ?, ?, 1)"
      ).run(inviterId, inviteeId, source);

      // 给邀请人 +2 免费额度
      db.prepare(
        "UPDATE quotas SET free_quota = free_quota + 2 WHERE user_id = ?"
      ).run(inviterId);
    })();
    return true;
  } catch (err) {
    console.warn("[ReferralService] processReferral failed:", err.message);
    return false;
  }
}

/**
 * 获取邀请统计
 */
function getReferralStats(userId) {
  const db = getDb();
  const row = db.prepare(
    "SELECT COUNT(*) as count, SUM(CASE WHEN rewarded = 1 THEN 2 ELSE 0 END) as earned_quota FROM referrals WHERE inviter_id = ?"
  ).get(userId);
  return {
    invited_count: row?.count || 0,
    earned_quota: row?.earned_quota || 0,
  };
}

module.exports = {
  getOrCreateInviteCode,
  getUserByInviteCode,
  processReferral,
  getReferralStats,
};
