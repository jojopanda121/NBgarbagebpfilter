// ============================================================
// server/utils/validation.js — 共享验证规则
// ============================================================

// 邮箱格式验证正则
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 中国大陆手机号验证正则（1开头，第二位3-9，共11位）
const PHONE_REGEX = /^1[3-9]\d{9}$/;

// 用户名格式验证正则（字母、数字、下划线、中文）
const USERNAME_REGEX = /^[\w\u4e00-\u9fa5]+$/;

/**
 * 验证邮箱格式
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email);
}

/**
 * 验证手机号格式
 * @param {string} phone
 * @returns {boolean}
 */
function isValidPhone(phone) {
  return typeof phone === 'string' && PHONE_REGEX.test(phone);
}

/**
 * 验证用户名格式
 * @param {string} username
 * @returns {boolean}
 */
function isValidUsername(username) {
  return typeof username === 'string' &&
         username.length >= 2 &&
         username.length <= 32 &&
         USERNAME_REGEX.test(username);
}

/**
 * 验证密码格式
 * @param {string} password
 * @returns {boolean}
 */
function isValidPassword(password) {
  return typeof password === 'string' &&
         password.length >= 6 &&
         password.length <= 128;
}

module.exports = {
  EMAIL_REGEX,
  PHONE_REGEX,
  USERNAME_REGEX,
  isValidEmail,
  isValidPhone,
  isValidUsername,
  isValidPassword,
};
