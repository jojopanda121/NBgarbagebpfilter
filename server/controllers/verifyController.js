// ============================================================
// server/controllers/verifyController.js — 验证码控制器
// ============================================================

const { sendVerificationCode, verifyCode, canSendCode } = require("../services/smsService");
const { sendEmailCode, verifyEmailCode, canSendEmailCode } = require("../services/emailService");

/** POST /api/verify/send — 发送验证码（手机或邮箱） */
async function sendCode(req, res) {
  const { phone, email, type = "bind" } = req.body;

  // 手机号验证码
  if (phone) {
    // 手机号格式验证（中国大陆）
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({ error: "手机号格式不正确" });
    }

    // 检查发送频率
    if (!canSendCode(phone)) {
      return res.status(429).json({ error: "发送过于频繁，请 1 分钟后再试" });
    }

    try {
      const formattedPhone = `+86${phone}`;
      const result = await sendVerificationCode(formattedPhone);
      return res.json(result);
    } catch (err) {
      console.error("[Verify] 发送短信验证码失败:", err.message);
      return res.status(500).json({ error: err.message || "发送失败，请稍后重试" });
    }
  }

  // 邮箱验证码
  if (email) {
    // 邮箱格式验证
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "邮箱格式不正确" });
    }

    // 检查发送频率
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

  return res.status(400).json({ error: "请提供手机号或邮箱" });
}

/** POST /api/verify/check — 验证验证码 */
function checkCode(req, res) {
  const { phone, email, code, type = "bind" } = req.body;

  if (!code) {
    return res.status(400).json({ error: "请输入验证码" });
  }

  // 验证手机号验证码
  if (phone) {
    const formattedPhone = `+86${phone}`;
    if (verifyCode(formattedPhone, code)) {
      return res.json({ valid: true, message: "验证成功" });
    }
  }

  // 验证邮箱验证码
  if (email) {
    if (verifyEmailCode(email, code)) {
      return res.json({ valid: true, message: "验证成功" });
    }
  }

  return res.status(400).json({ valid: false, error: "验证码错误或已过期" });
}

module.exports = { sendCode, checkCode };
