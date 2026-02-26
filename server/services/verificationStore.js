// ============================================================
// server/services/verificationStore.js — 验证码持久化存储（SQLite）
// 统一供 smsService 和 emailService 使用
// ============================================================

const { getDb } = require("../db");

/**
 * 获取最大尝试次数配置
 */
function getMaxAttempts() {
  const db = getDb();
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'verification_max_attempts'").get();
  return setting ? parseInt(setting.value, 10) : 3;
}

/**
 * 保存验证码
 * @param {string} contact - 手机号或邮箱
 * @param {string} code - 6位验证码
 * @param {number} expireMs - 过期毫秒数
 */
function saveCode(contact, code, expireMs) {
  const db = getDb();
  const expiresAt = new Date(Date.now() + expireMs).toISOString();

  // 删除该联系方式的旧验证码
  db.prepare("DELETE FROM verification_codes WHERE contact = ?").run(contact);

  // 插入新验证码
  db.prepare(
    "INSERT INTO verification_codes (contact, code, attempts, expires_at) VALUES (?, ?, 0, ?)"
  ).run(contact, code, expiresAt);
}

/**
 * 验证验证码
 * @param {string} contact - 手机号或邮箱
 * @param {string} code - 用户输入的验证码
 * @returns {boolean}
 */
function verifyCode(contact, code) {
  const db = getDb();
  const record = db.prepare(
    "SELECT id, code, attempts, expires_at FROM verification_codes WHERE contact = ?"
  ).get(contact);

  if (!record) return false;

  // 检查过期
  if (new Date(record.expires_at) < new Date()) {
    db.prepare("DELETE FROM verification_codes WHERE id = ?").run(record.id);
    return false;
  }

  // 匹配成功
  if (record.code === code) {
    db.prepare("DELETE FROM verification_codes WHERE id = ?").run(record.id);
    return true;
  }

  // 失败次数 +1
  const newAttempts = record.attempts + 1;
  const maxAttempts = getMaxAttempts();

  if (newAttempts >= maxAttempts) {
    db.prepare("DELETE FROM verification_codes WHERE id = ?").run(record.id);
  } else {
    db.prepare("UPDATE verification_codes SET attempts = ? WHERE id = ?").run(newAttempts, record.id);
  }

  return false;
}

/**
 * 检查是否可以发送（冷却期 60s）
 * @param {string} contact
 * @returns {boolean}
 */
function canSend(contact) {
  const db = getDb();
  const record = db.prepare(
    "SELECT created_at FROM verification_codes WHERE contact = ? ORDER BY created_at DESC LIMIT 1"
  ).get(contact);

  if (!record) return true;

  const elapsed = Date.now() - new Date(record.created_at).getTime();
  return elapsed >= 60 * 1000;
}

/**
 * 清理过期验证码（可选定时任务调用）
 */
function cleanExpired() {
  const db = getDb();
  db.prepare("DELETE FROM verification_codes WHERE expires_at < datetime('now')").run();
}

module.exports = { saveCode, verifyCode, canSend, cleanExpired };
