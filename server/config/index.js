// ============================================================
// server/config/index.js — 集中配置管理
// 所有环境变量在此统一读取，其他模块不直接读 process.env
// ============================================================

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

const config = {
  env: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT, 10) || 3001,

  // JWT
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-in-production",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",

  // Database
  dbPath: process.env.DB_PATH || require("path").join(__dirname, "..", "..", "data", "app.db"),

  // MiniMax LLM
  minimaxApiKey: process.env.MINIMAX_API_KEY || "",
  minimaxModel: process.env.MINIMAX_MODEL || "MiniMax-M2.5",

  // Serper (web search)
  serperApiKey: process.env.SERPER_API_KEY || "",

  // Redis (task queue)
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",

  // Document extraction service
  docServiceUrl: process.env.DOC_SERVICE_URL || "",

  // Object Storage (OSS/S3)
  ossEndpoint: process.env.OSS_ENDPOINT || "",
  ossBucket: process.env.OSS_BUCKET || "",
  ossAccessKey: process.env.OSS_ACCESS_KEY || "",
  ossSecretKey: process.env.OSS_SECRET_KEY || "",

  // Quota defaults
  defaultFreeQuota: parseInt(process.env.DEFAULT_FREE_QUOTA, 10) || 3,

  // Payment
  wechatPayAppId: process.env.WECHAT_PAY_APP_ID || "",
  wechatPayMchId: process.env.WECHAT_PAY_MCH_ID || "",
  wechatPayApiKey: process.env.WECHAT_PAY_API_KEY || "",
  alipayAppId: process.env.ALIPAY_APP_ID || "",
  alipayPrivateKey: process.env.ALIPAY_PRIVATE_KEY || "",
  alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY || "",
};

module.exports = config;
