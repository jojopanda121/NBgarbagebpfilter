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
 * 记录邀请关系（注册时调用，不立即发放奖励）
 * 防自刷：inviter_id !== invitee_id
 * 奖励在被邀请人绑定邮箱后才发放，见 rewardReferral()
 */
function processReferral(inviterId, inviteeId, source = "invite_link") {
  if (!inviterId || !inviteeId || inviterId === inviteeId) return false;

  const db = getDb();

  // 检查是否已存在邀请关系
  const existing = db.prepare("SELECT id FROM referrals WHERE invitee_id = ?").get(inviteeId);
  if (existing) return false;

  try {
    db.prepare(
      "INSERT INTO referrals (inviter_id, invitee_id, source, rewarded) VALUES (?, ?, ?, 0)"
    ).run(inviterId, inviteeId, source);
    return true;
  } catch (err) {
    console.warn("[ReferralService] processReferral failed:", err.message);
    return false;
  }
}

/**
 * 被邀请人绑定邮箱后，给邀请人发放 +2 免费额度
 * 仅对 rewarded = 0 的记录生效，防止重复发放
 */
function rewardReferral(inviteeId) {
  if (!inviteeId) return false;

  const db = getDb();

  const referral = db.prepare(
    "SELECT id, inviter_id FROM referrals WHERE invitee_id = ? AND rewarded = 0"
  ).get(inviteeId);
  if (!referral) return false;

  try {
    db.transaction(() => {
      db.prepare("UPDATE referrals SET rewarded = 1 WHERE id = ?").run(referral.id);
      db.prepare(
        "UPDATE quotas SET free_quota = free_quota + 2 WHERE user_id = ?"
      ).run(referral.inviter_id);
    })();
    return true;
  } catch (err) {
    console.warn("[ReferralService] rewardReferral failed:", err.message);
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
  rewardReferral,
  getReferralStats,
};
