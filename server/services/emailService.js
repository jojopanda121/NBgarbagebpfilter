// ============================================================
// server/services/emailService.js — 邮箱验证码服务
// 使用腾讯云 SES API 发送邮件（TC3-HMAC-SHA256 签名）
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

/**
 * 发送邮箱验证码
 */
async function sendEmailCode(toEmail) {
  if (!SES_CONFIG.secretId || !SES_CONFIG.secretKey || !SES_CONFIG.fromEmail) {
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
    await sendViaTencentSES(toEmail, code);
    return { success: true, expiresIn: CODE_EXPIRE_TIME / 1000 };
  } catch (err) {
    console.error("[EmailService] 发送失败:", err.message);
    throw err;
  }
}

/**
 * 腾讯云 SES SendEmail 实现（模板发送模式）
 */
async function sendViaTencentSES(toEmail, code) {
  const endpoint = "ses.tencentcloudapi.com";
  const service = "ses";
  const action = "SendEmail";
  const version = "2020-10-02";

  // 请求体：使用 Template 代替 Simple，满足腾讯云 SES 模板发送要求
  const payload = {
    FromEmailAddress: SES_CONFIG.fromEmail,
    Destination: [toEmail],
    Template: {
      TemplateID: SES_CONFIG.templateId,
      TemplateData: JSON.stringify({ code }),
    },
    TriggerType: 1, // 触发类邮件（验证码）
  };

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

  console.log(`[EmailService] 邮件已发送至 ${toEmail}, MessageId: ${result.Response?.MessageId}`);
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
  verifyEmailCode,
  canSendEmailCode,
  SES_CONFIG,
};
