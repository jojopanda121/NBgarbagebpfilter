// ============================================================
// server/controllers/verifyController.js — 验证码控制器
// 仅支持邮箱验证（已移除手机号验证）
// ============================================================

const { sendEmailCode, verifyEmailCode, canSendEmailCode } = require("../services/emailService");
const { isValidEmail } = require("../utils/validation");

/** POST /api/verify/send — 发送邮箱验证码 */
async function sendCode(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "请提供邮箱地址" });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "邮箱格式不正确" });
  }

  if (!canSendEmailCode(email)) {
    return res.status(429).json({ error: "发送过于频繁，请 1 分钟后再试" });
  }

  try {
    const result = await sendEmailCode(email);
    return res.json(result);
  } catch (err) {
    console.error("[Verify] 发送邮箱验证码失败:", err.message);
    return res.status(500).json({ error: err.message || "发送失败，请稍后重试" });
  }
}

/** POST /api/verify/check — 验证邮箱验证码 */
function checkCode(req, res) {
  const { email, code } = req.body;

  if (!code) {
    return res.status(400).json({ error: "请输入验证码" });
  }

  if (!email) {
    return res.status(400).json({ error: "请提供邮箱地址" });
  }

  if (verifyEmailCode(email, code)) {
    return res.json({ valid: true, message: "验证成功" });
  }

  return res.status(400).json({ valid: false, error: "验证码错误或已过期" });
}

module.exports = { sendCode, checkCode };
