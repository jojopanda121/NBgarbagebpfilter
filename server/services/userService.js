// ============================================================
// server/services/userService.js — 用户服务层
// 封装所有用户相关的数据库操作
// ============================================================

const bcrypt = require("bcryptjs");
const { getDb } = require("../db");

/**
 * 根据 ID 获取用户信息
 * @param {number} userId
 * @returns {object|null}
 */
function getUserById(userId) {
  const db = getDb();
  return db.prepare(
    "SELECT id, username, email, phone, contact_bound, usage_count, role, created_at FROM users WHERE id = ?"
  ).get(userId);
}

/**
 * 根据用户名获取用户（包含密码哈希）
 * @param {string} username
 * @returns {object|null}
 */
function getUserByUsername(username) {
  const db = getDb();
  return db.prepare(
    "SELECT id, username, password_hash, email, contact_bound, usage_count, role FROM users WHERE username = ?"
  ).get(username);
}

/**
 * 检查邮箱是否已被其他用户使用
 * @param {string} email
 * @param {number} excludeUserId
 * @returns {boolean}
 */
function isEmailTaken(email, excludeUserId = null) {
  const db = getDb();
  const query = excludeUserId
    ? db.prepare("SELECT id FROM users WHERE email = ? AND id != ?")
    : db.prepare("SELECT id FROM users WHERE email = ?");

  const result = excludeUserId ? query.get(email, excludeUserId) : query.get(email);
  return !!result;
}

/**
 * 检查手机号是否已被其他用户使用
 * @param {string} phone
 * @param {number} excludeUserId
 * @returns {boolean}
 */
function isPhoneTaken(phone, excludeUserId = null) {
  const db = getDb();
  const query = excludeUserId
    ? db.prepare("SELECT id FROM users WHERE phone = ? AND id != ?")
    : db.prepare("SELECT id FROM users WHERE phone = ?");

  const result = excludeUserId ? query.get(phone, excludeUserId) : query.get(phone);
  return !!result;
}

/**
 * 更新用户资料
 * @param {number} userId
 * @param {object} updates - { email?, phone?, nickname? }
 */
function updateUserProfile(userId, updates) {
  const db = getDb();
  const fields = [];
  const values = [];

  if (updates.email !== undefined) {
    fields.push("email = ?");
    values.push(updates.email);
  }
  if (updates.phone !== undefined) {
    fields.push("phone = ?");
    values.push(updates.phone);
  }
  if (updates.nickname !== undefined) {
    fields.push("nickname = ?");
    values.push(updates.nickname);
  }

  if (fields.length === 0) return;

  values.push(userId);
  db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

/**
 * 修改用户密码
 * @param {number} userId
 * @param {string} newPasswordHash
 */
function updateUserPassword(userId, newPasswordHash) {
  const db = getDb();
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newPasswordHash, userId);
}

/**
 * 绑定联系方式
 * @param {number} userId
 * @param {object} contact - { email?, phone? }
 */
function bindUserContact(userId, contact) {
  const db = getDb();
  const updates = { contact_bound: 1 };

  if (contact.email) updates.email = contact.email;
  if (contact.phone) updates.phone = contact.phone;

  const fields = Object.keys(updates).map(k => `${k} = ?`);
  const values = [...Object.values(updates), userId];

  db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

/**
 * 创建新用户
 * @param {string} username
 * @param {string} passwordHash
 * @returns {number} userId
 */
function createUser(username, passwordHash) {
  const db = getDb();
  const info = db.prepare(
    "INSERT INTO users (username, password_hash) VALUES (?, ?)"
  ).run(username, passwordHash);

  return info.lastInsertRowid;
}

module.exports = {
  getUserById,
  getUserByUsername,
  isEmailTaken,
  isPhoneTaken,
  updateUserProfile,
  updateUserPassword,
  bindUserContact,
  createUser,
};
