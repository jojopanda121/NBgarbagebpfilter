// ============================================================
// server/services/emailService.js — 邮箱发送服务
// 使用腾讯云 SES API 发送邮件（TC3-HMAC-SHA256 签名）
//   - sendEmailCode：验证码（模板模式，TriggerType=1）
//   - sendForumNotificationEmail：论坛通知（Simple 内容模式，best-effort）
// ============================================================

const crypto = require("crypto");
const config = require("../config");
const { saveCode, verifyCode: dbVerifyCode, canSend } = require("./verificationStore");

// 腾讯云 SES 配置（从集中配置读取，不直接读 process.env）
const SES_CONFIG = {
  secretId: config.tencentSesSecretId,
  secretKey: config.tencentSesSecretKey,
  fromEmail: config.tencentSesFromEmail,
  region: config.tencentSesRegion,
  templateId: config.tencentSesTemplateId,
};

const CODE_EXPIRE_TIME = 5 * 60 * 1000; // 5 分钟

function isSesConfigured() {
  return !!(SES_CONFIG.secretId && SES_CONFIG.secretKey && SES_CONFIG.fromEmail);
}

/**
 * 发送邮箱验证码
 */
async function sendEmailCode(toEmail) {
  if (!isSesConfigured()) {
    throw new Error("邮箱服务未配置，请联系管理员设置腾讯云 SES");
  }
  if (!SES_CONFIG.templateId) {
    throw new Error("邮箱模板未配置，请在腾讯云 SES 控制台创建模板并设置 TENCENT_SES_TEMPLATE_ID");
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();

  // 存储验证码到 SQLite
  saveCode(toEmail, code, CODE_EXPIRE_TIME);

  // 调用腾讯云 SES API 发送（使用模板）
  try {
    await sesSendEmail({
      FromEmailAddress: SES_CONFIG.fromEmail,
      Destination: [toEmail],
      Template: {
        TemplateID: SES_CONFIG.templateId,
        TemplateData: JSON.stringify({ code }),
      },
      Subject: "验证码",
      TriggerType: 1, // 触发类邮件（验证码）
    });
    return { success: true, expiresIn: CODE_EXPIRE_TIME / 1000 };
  } catch (err) {
    // H7: 仅记录消息文本，避免把含 Authorization 头的 err 对象整体写入日志
    console.error("[EmailService] 发送失败:", err && err.message);
    // 抛出脱敏后的新错误，杜绝调用方再次序列化原始 err 时泄露密钥
    const safe = new Error(err?.message || "邮件发送失败");
    safe.code = err?.code;
    throw safe;
  }
}

/**
 * 发送论坛通知邮件（Simple 内容模式，best-effort）。
 * 未配置 SES 时静默跳过（返回 {skipped:true}），绝不抛错 —— 调用方按 best-effort 处理。
 * 注意：Simple 模式需发件域已在腾讯云 SES 审核通过。
 * @param {string} toEmail
 * @param {{subject:string, body:string}} opts  body 为纯文本（也用作 HTML 段落）
 */
async function sendForumNotificationEmail(toEmail, { subject, body }) {
  if (!isSesConfigured()) return { skipped: true, reason: "ses_not_configured" };
  if (!toEmail) return { skipped: true, reason: "no_recipient" };
  const text = String(body || "");
  const html = `<div style="font-family:sans-serif;line-height:1.7;color:#222">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
  return sesSendEmail({
    FromEmailAddress: SES_CONFIG.fromEmail,
    Destination: [toEmail],
    Subject: String(subject || "论坛通知"),
    Simple: {
      Html: Buffer.from(html, "utf-8").toString("base64"),
      Text: Buffer.from(text, "utf-8").toString("base64"),
    },
    TriggerType: 2, // 非触发类（通知）
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * 腾讯云 SES SendEmail 通用实现（TC3-HMAC-SHA256 签名）。
 * payload 由调用方按模板/Simple 模式构造。
 */
async function sesSendEmail(payload) {
  const endpoint = "ses.tencentcloudapi.com";
  const service = "ses";
  const action = "SendEmail";
  const version = "2020-10-02";

  const payloadStr = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10); // YYYY-MM-DD

  // ── Step 1: 拼接规范请求 (CanonicalRequest) ──
  const httpRequestMethod = "POST";
  const canonicalUri = "/";
  const canonicalQueryString = "";
  const canonicalHeaders =
    `content-type:application/json; charset=utf-8\n` +
    `host:${endpoint}\n` +
    `x-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const hashedPayload = sha256Hex(payloadStr);

  const canonicalRequest = [
    httpRequestMethod,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join("\n");

  // ── Step 2: 拼接待签名字符串 (StringToSign) ──
  const algorithm = "TC3-HMAC-SHA256";
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonicalRequest = sha256Hex(canonicalRequest);

  const stringToSign = [
    algorithm,
    timestamp.toString(),
    credentialScope,
    hashedCanonicalRequest,
  ].join("\n");

  // ── Step 3: 计算签名 ──
  const secretDate = hmacSha256("TC3" + SES_CONFIG.secretKey, date);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = hmacSha256Hex(secretSigning, stringToSign);

  // ── Step 4: 拼接 Authorization ──
  const authorization =
    `${algorithm} ` +
    `Credential=${SES_CONFIG.secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, ` +
    `Signature=${signature}`;

  // ── Step 5: 发送请求 ──
  const response = await fetch(`https://${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Host: endpoint,
      Authorization: authorization,
      "X-TC-Action": action,
      "X-TC-Version": version,
      "X-TC-Timestamp": timestamp.toString(),
      "X-TC-Region": SES_CONFIG.region,
    },
    body: payloadStr,
  });

  const result = await response.json();

  if (result.Response?.Error) {
    const errMsg = `[SES Error] ${result.Response.Error.Code}: ${result.Response.Error.Message}`;
    console.error(errMsg);
    throw new Error("邮件发送失败，请稍后重试");
  }

  console.log(`[EmailService] 邮件已发送, MessageId: ${result.Response?.MessageId}`);
  return result;
}

// ── 签名辅助函数 ──

function sha256Hex(message) {
  return crypto.createHash("sha256").update(message, "utf-8").digest("hex");
}

function hmacSha256(key, message) {
  return crypto.createHmac("sha256", key).update(message, "utf-8").digest();
}

function hmacSha256Hex(key, message) {
  return crypto.createHmac("sha256", key).update(message, "utf-8").digest("hex");
}

/**
 * 验证邮箱验证码
 */
function verifyEmailCode(email, code) {
  return dbVerifyCode(email, code);
}

/**
 * 检查是否可以发送验证码
 */
function canSendEmailCode(email) {
  return canSend(email);
}

module.exports = {
  sendEmailCode,
  sendForumNotificationEmail,
  verifyEmailCode,
  canSendEmailCode,
  SES_CONFIG,
};
