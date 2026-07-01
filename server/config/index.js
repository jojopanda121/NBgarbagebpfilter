// ============================================================
// server/config/index.js — 集中配置管理
// 所有环境变量在此统一读取，其他模块不直接读 process.env
// ============================================================

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

// 开发模式下自动生成 JWT Secret，并持久化到 .dev-jwt-secret，避免每次重启使所有 token 失效（M19）
const devJwtSecret = (() => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const crypto = require("crypto");
  const fs = require("fs");
  const path = require("path");
  const secretPath = path.join(__dirname, "..", "..", ".dev-jwt-secret");
  try {
    if (fs.existsSync(secretPath)) {
      const cached = fs.readFileSync(secretPath, "utf-8").trim();
      if (cached && cached.length >= 32) return cached;
    }
  } catch (_) { /* fallthrough to regenerate */ }
  const secret = crypto.randomBytes(32).toString("hex");
  try {
    fs.writeFileSync(secretPath, secret, { mode: 0o600 });
    console.warn(`[Config] 未设置 JWT_SECRET，已生成并写入 ${secretPath}（仅开发用途，请加入 .gitignore）`);
  } catch (err) {
    console.warn("[Config] JWT 密钥落盘失败，本次重启会使全部 token 失效:", err.message);
  }
  return secret;
})();

const config = {
  env: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT, 10) || 3001,

  // JWT
  jwtSecret: devJwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "24h",

  // Database
  dbPath: process.env.DB_PATH || require("path").join(__dirname, "..", "..", "data", "app.db"),

  // Uploads (公开上传：头像、站点图片)。容器中映射到 /app/data/uploads，与数据卷一同持久化。
  uploadsDir: process.env.UPLOADS_DIR || require("path").join(__dirname, "..", "..", "data", "uploads"),

  // MiniMax LLM（OpenAI 兼容接口；M3 为默认模型）
  // 一个 MINIMAX_API_KEY（Token Plan 订阅 key）同时用于 M3 推理与 coding_plan/search 联网检索。
  minimaxApiKey: process.env.MINIMAX_API_KEY || "",
  minimaxModel: process.env.MINIMAX_MODEL || "MiniMax-M3",
  llmProvider: "minimax",
  llmApiKey: process.env.MINIMAX_API_KEY || "",
  llmModel: process.env.MINIMAX_MODEL || "MiniMax-M3",
  // P2-4 per-skill 模型路由 (可选)：
  //   heavy  → deck / memo / investmentDeckPptx / icQuestions 等重任务
  //   light  → snapshot / brief / one-pager / 语义抽样审计 等轻任务
  //   default→ 其他所有 skill（兜底）
  // 任一字段未配置时回落到 minimaxModel，保持单模型行为不变。
  minimaxModelHeavy: process.env.MINIMAX_MODEL_HEAVY || "",
  minimaxModelLight: process.env.MINIMAX_MODEL_LIGHT || "",
  // 国内站 api.minimaxi.com（注意域名是 minimaxi）；国际站用 MINIMAX_API_HOST=https://api.minimax.io/v1 覆盖。
  minimaxApiHost: process.env.MINIMAX_API_HOST || process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1",
  llmModelHeavy: process.env.MINIMAX_MODEL_HEAVY || "",
  llmModelLight: process.env.MINIMAX_MODEL_LIGHT || "",
  llmApiHost: process.env.MINIMAX_API_HOST || process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1",
  // 兼容旧调用点命名；实际后端统一走 MiniMax。
  kimiApiKey: process.env.MINIMAX_API_KEY || "",
  kimiModel: process.env.MINIMAX_MODEL || "MiniMax-M3",
  kimiModelHeavy: process.env.MINIMAX_MODEL_HEAVY || "",
  kimiModelLight: process.env.MINIMAX_MODEL_LIGHT || "",
  kimiApiHost: process.env.MINIMAX_API_HOST || process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1",

  // 企查查 Agent（企业追踪数据源）
  qccApiKey: process.env.QCC_API_KEY || "",
  qccEnabled: !!process.env.QCC_API_KEY,

  // Document extraction / generation service
  docServiceUrl:
    process.env.DOC_SERVICE_URL ||
    ((process.env.NODE_ENV || "development") === "development" ? "http://localhost:8001" : ""),
  // doc-service 共享密钥：两端同时配置后，所有 doc-service 端点要求
  // Authorization: Bearer <token>，防止端口误暴露时被白嫖解析/渲染算力
  docServiceToken: process.env.DOC_SERVICE_TOKEN || "",

  // Object Storage (OSS/S3)
  ossEndpoint: process.env.OSS_ENDPOINT || "",
  ossBucket: process.env.OSS_BUCKET || "",
  ossAccessKey: process.env.OSS_ACCESS_KEY || "",
  ossSecretKey: process.env.OSS_SECRET_KEY || "",

  // Quota defaults
  defaultFreeQuota: parseInt(process.env.DEFAULT_FREE_QUOTA, 10) || 3,

  // [已移除] 微信/支付宝支付配置 — 改为线下兑换码模式

  // 腾讯云 SES 邮件服务
  tencentSesSecretId: process.env.TENCENT_SES_SECRET_ID || "",
  tencentSesSecretKey: process.env.TENCENT_SES_SECRET_KEY || "",
  tencentSesFromEmail: process.env.TENCENT_SES_FROM_EMAIL || "",
  tencentSesRegion: process.env.TENCENT_SES_REGION || "ap-hongkong",
  tencentSesTemplateId: parseInt(process.env.TENCENT_SES_TEMPLATE_ID, 10) || 0,

  // CORS 允许的域名（逗号分隔，生产环境必须配置）
  allowedOrigins: process.env.ALLOWED_ORIGINS || "",

  // Admin（自动初始化管理员账号）
  adminUsername: process.env.ADMIN_USERNAME || "",
  adminPassword: process.env.ADMIN_PASSWORD || "",

  // PII 加密（可选，仅在启用相关功能时校验）
  encryptionKey: process.env.ENCRYPTION_KEY || "",
  piiSalt: process.env.PII_SALT || "",
  enablePiiEncryption: process.env.ENABLE_PII_ENCRYPTION === "1",

  // 站点规范域名（SEO：canonical / og:url / sitemap 用）。与前端 siteMeta 默认一致。
  siteUrl: (process.env.SITE_URL || process.env.REACT_APP_SITE_URL || "https://www.garbagebpfilter.cn").replace(/\/+$/, ""),

  // 论坛附件上传上限（字节）。图片与文档分别限制；数量在 service 层强制。
  forumUpload: {
    imageMaxBytes: parseInt(process.env.FORUM_IMAGE_MAX_BYTES, 10) || 5 * 1024 * 1024,   // 图片 5MB
    fileMaxBytes: parseInt(process.env.FORUM_FILE_MAX_BYTES, 10) || 20 * 1024 * 1024,    // 文档 20MB
    postMaxImages: 9,
    postMaxFiles: 3,
    commentMaxImages: 1,
  },
};

// ── 生产环境安全检查 ──
if (config.env === "production") {
  const secret = process.env.JWT_SECRET;
  const looksPlaceholder = secret && /请修改|change.?me|placeholder|example/i.test(secret);
  if (!secret || secret.length < 32 || looksPlaceholder) {
    console.error(
      "\n[FATAL] 生产环境必须设置 JWT_SECRET 环境变量！\n" +
      "  要求：长度 ≥ 32 且不得使用示例占位符。\n" +
      "  生成: JWT_SECRET=$(openssl rand -hex 32)\n"
    );
    process.exit(1);
  }

  if (!config.allowedOrigins) {
    console.error(
      "\n[FATAL] 生产环境必须设置 ALLOWED_ORIGINS 环境变量！\n" +
      "  否则 CORS 将拒绝所有跨域请求。\n" +
      "  示例: ALLOWED_ORIGINS=https://your-domain.com\n"
    );
    process.exit(1);
  }

  if (!config.minimaxApiKey) {
    console.error(
      "\n[FATAL] 生产环境必须设置 MINIMAX_API_KEY 环境变量！\n"
    );
    process.exit(1);
  }

  // 拒绝通配符 ALLOWED_ORIGINS（CORS 安全）
  const origins = config.allowedOrigins.split(",").map((s) => s.trim()).filter(Boolean);
  if (origins.includes("*") || origins.some((o) => o.includes("*"))) {
    console.error(
      "\n[FATAL] ALLOWED_ORIGINS 不允许使用通配符 *！\n" +
      "  请显式列出所有允许的源，逗号分隔。\n"
    );
    process.exit(1);
  }

  // M20: 启用 PII 加密时强制要求密钥就绪
  if (config.enablePiiEncryption) {
    if (!config.encryptionKey || config.encryptionKey.length < 32) {
      console.error("\n[FATAL] ENABLE_PII_ENCRYPTION=1 但 ENCRYPTION_KEY 缺失或过短（要求 ≥ 32 字符）。\n");
      process.exit(1);
    }
  }

  // PII_SALT 生产环境必配：founderAgent / 数据沉淀对手机号/邮箱做加盐 hash，
  // 默认盐等于没有盐（彩虹表可逆）。生成: openssl rand -hex 16
  if (!config.piiSalt || config.piiSalt.length < 16) {
    console.error("\n[FATAL] 生产环境必须设置 PII_SALT（≥ 16 字符）！\n  生成: PII_SALT=$(openssl rand -hex 16)\n");
    process.exit(1);
  }
}

module.exports = config;
