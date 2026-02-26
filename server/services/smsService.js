// ============================================================
// server/services/smsService.js — 短信验证码服务
// 腾讯云短信发送
// ============================================================

const config = require("../config");
const crypto = require("crypto");
const { saveCode, verifyCode: dbVerifyCode, canSend } = require("./verificationStore");

// 腾讯云 SMS 配置
const SMS_CONFIG = {
  secretId: process.env.TENCENT_SMS_SECRET_ID || "",
  secretKey: process.env.TENCENT_SMS_SECRET_KEY || "",
  sdkAppId: process.env.TENCENT_SMS_SDK_APP_ID || process.env.TENCENT_SMS_APP_ID || "", // 兼容两种写法
  signName: process.env.TENCENT_SMS_SIGN_NAME || "", // 短信签名
  templateId: process.env.TENCENT_SMS_TEMPLATE_ID || "", // 验证码模板 ID
  region: process.env.TENCENT_SMS_REGION || "ap-guangzhou",
};

// 验证码有效期（5分钟）
const CODE_EXPIRE_TIME = 5 * 60 * 1000;

/**
 * 生成随机验证码
 */
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * 发送短信验证码
 * @param {string} phoneNumber - 手机号（格式：+86138xxxxxxxx）
 */
async function sendVerificationCode(phoneNumber) {
  // 检查配置
  if (!SMS_CONFIG.secretId || !SMS_CONFIG.secretKey) {
    throw new Error("短信服务未配置，请联系管理员");
  }

  const code = generateCode();

  // 存储验证码到 SQLite
  saveCode(phoneNumber, code, CODE_EXPIRE_TIME);

  // 调用腾讯云短信 API
  try {
    await sendSmsTencentCloud(phoneNumber, [code, "5"]);
    return { success: true, expiresIn: CODE_EXPIRE_TIME / 1000 };
  } catch (err) {
    // 发送失败时无需手动清理，验证码会自动过期
    throw err;
  }
}

/**
 * 腾讯云短信发送实现
 */
async function sendSmsTencentCloud(phoneNumber, params) {
  const endpoint = "sms.tencentcloudapi.com";
  const action = "SendSms";
  const version = "2021-01-11";
  const service = "sms";

  // 构建请求参数
  const requestParams = {
    SdkAppId: SMS_CONFIG.sdkAppId,
    SignName: SMS_CONFIG.signName,
    TemplateId: SMS_CONFIG.templateId,
    PhoneNumberSet: [phoneNumber],
    TemplateParamSet: params,
  };

  // 生成签名
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = generateSignature(
    SMS_CONFIG.secretId,
    SMS_CONFIG.secretKey,
    timestamp,
    SMS_CONFIG.region,
    action,
    requestParams
  );

  // 发送请求
  const response = await fetch(
    `https://${endpoint}/?Action=${action}&Version=${version}&SdkAppId=${SMS_CONFIG.sdkAppId}&SignName=${encodeURIComponent(SMS_CONFIG.signName)}&TemplateId=${SMS_CONFIG.templateId}&PhoneNumberSet=${encodeURIComponent(phoneNumber)}&TemplateParamSet=${params.join(",")}&Timestamp=${timestamp}&Signature=${encodeURIComponent(signature)}`,
    { method: "GET" }
  ).catch(err => {
    console.error("[SMS] 请求失败:", err);
    throw new Error("短信服务调用失败");
  });

  const result = await response.json();

  if (result.Response?.Error) {
    throw new Error(result.Response.Error.Message);
  }

  return result;
}

/**
 * 生成腾讯云 API 签名（HMAC-SHA1）
 */
function generateSignature(secretId, secretKey, timestamp, region, action, params) {
  // 1. 拼接规范请求串
  const httpRequestMethod = "GET";
  const canonicalUri = "/";
  const canonicalQueryString = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const canonicalHeaders = `content-type:application/json\nhost:${endpoint}\n`;
  const signedHeaders = "content-type;host";
  const hashedRequestPayload = crypto
    .createHash("sha256")
    .update("{}")
    .digest("hex");

  const canonicalRequest = [
    httpRequestMethod,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    hashedRequestPayload,
  ].join("\n");

  // 2. 拼接待签名字符串
  const algorithm = "TC3-HMAC-SHA256";
  const credentialScope = `${timestamp}/sms/tc3_request`;
  const hashedCanonicalRequest = crypto
    .createHash("sha256")
    .update(canonicalRequest)
    .digest("hex");

  const stringToSign = [
    algorithm,
    timestamp,
    credentialScope,
    hashedCanonicalRequest,
  ].join("\n");

  // 3. 计算签名
  const secretDate = crypto
    .createHmac("sha256", "TC3" + secretKey)
    .update(timestamp.toString())
    .digest();
  const secretSigning = crypto
    .createHmac("sha256", secretDate)
    .update("sms")
    .digest();
  const signature = crypto
    .createHmac("sha256", secretSigning)
    .update(stringToSign)
    .digest("hex");

  return signature;
}

/**
 * 验证验证码
 * @param {string} phoneNumber - 手机号
 * @param {string} code - 用户输入的验证码
 * @returns {boolean}
 */
function verifyCode(phoneNumber, code) {
  return dbVerifyCode(phoneNumber, code);
}

/**
 * 检查验证码是否已发送（防刷）
 * @param {string} phoneNumber
 * @returns {boolean}
 */
function canSendCode(phoneNumber) {
  return canSend(phoneNumber);
}

module.exports = {
  sendVerificationCode,
  verifyCode,
  canSendCode,
  SMS_CONFIG,
};
