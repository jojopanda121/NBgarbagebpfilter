// ============================================================
// server/services/emailService.js — 邮箱验证码服务
// ============================================================

const nodemailer = require("nodemailer");
const crypto = require("crypto");

// 邮箱配置
const EMAIL_CONFIG = {
  host: process.env.EMAIL_HOST || "",
  port: parseInt(process.env.EMAIL_PORT, 10) || 465,
  secure: true,
  user: process.env.EMAIL_USER || "",
  pass: process.env.EMAIL_PASS || "",
};

// 验证码缓存
const verificationCodes = new Map();
const CODE_EXPIRE_TIME = 10 * 60 * 1000; // 10分钟

/**
 * 发送邮箱验证码
 */
async function sendEmailCode(toEmail) {
  if (!EMAIL_CONFIG.host || !EMAIL_CONFIG.user) {
    throw new Error("邮箱服务未配置");
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();

  // 存储验证码
  verificationCodes.set(toEmail, {
    code,
    expiresAt: Date.now() + CODE_EXPIRE_TIME,
    attempts: 0,
  });

  // 创建 transporter
  const transporter = nodemailer.createTransport({
    host: EMAIL_CONFIG.host,
    port: EMAIL_CONFIG.port,
    secure: EMAIL_CONFIG.secure,
    auth: {
      user: EMAIL_CONFIG.user,
      pass: EMAIL_CONFIG.pass,
    },
  });

  // 发送邮件
  await transporter.sendMail({
    from: `"垃圾BP过滤机" <${EMAIL_CONFIG.user}>`,
    to: toEmail,
    subject: "验证码 - 垃圾BP过滤机",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">验证码</h2>
        <p>您的验证码是：<strong style="font-size: 24px; color: #2563eb;">${code}</strong></p>
        <p style="color: #666; font-size: 14px;">有效期 10 分钟，请尽快完成验证。</p>
        <p style="color: #999; font-size: 12px; margin-top: 20px;">如果这不是您的操作，请忽略此邮件。</p>
      </div>
    `,
  });

  return { success: true, expiresIn: CODE_EXPIRE_TIME / 1000 };
}

/**
 * 验证邮箱验证码
 */
function verifyEmailCode(email, code) {
  const record = verificationCodes.get(email);

  if (!record) {
    return false;
  }

  if (Date.now() > record.expiresAt) {
    verificationCodes.delete(email);
    return false;
  }

  if (record.code === code) {
    verificationCodes.delete(email);
    return true;
  }

  record.attempts += 1;
  if (record.attempts >= 3) {
    verificationCodes.delete(email);
  }

  return false;
}

/**
 * 检查是否可以发送验证码
 */
function canSendEmailCode(email) {
  const record = verificationCodes.get(email);
  if (!record) return true;

  const cooldown = 60 * 1000;
  return Date.now() - (record.expiresAt - CODE_EXPIRE_TIME) >= cooldown;
}

module.exports = {
  sendEmailCode,
  verifyEmailCode,
  canSendEmailCode,
  EMAIL_CONFIG,
};
