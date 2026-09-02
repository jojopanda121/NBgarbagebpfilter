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

  // ── LLM 后端（中立命名）──────────────────────────────────
  // 历史：Kimi → MiniMax → DeepSeek。现在厂商可插拔：换主力后端只改这几个
  // 环境变量，不改任何调用点代码（厂商适配见 services/llm/providers）。
  //   LLM_PROVIDER   deepseek | anthropic | openai | gemini | minimax | moonshot | qwen | zhipu
  //   LLM_API_KEY / LLM_API_HOST / LLM_MODEL / LLM_MODEL_HEAVY / LLM_MODEL_LIGHT
  // 下面的 DEEPSEEK_* 是向后兼容别名：生产 .env 不动也能继续跑。
  llmProvider: (process.env.LLM_PROVIDER || "deepseek").trim().toLowerCase(),
  llmApiKey: process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || "",
  llmApiHost: process.env.LLM_API_HOST || process.env.DEEPSEEK_API_HOST || process.env.DEEPSEEK_BASE_URL || "",
  llmModel: process.env.LLM_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
  llmModelHeavy: process.env.LLM_MODEL_HEAVY || process.env.DEEPSEEK_MODEL_HEAVY || "deepseek-v4-pro",
  llmModelLight: process.env.LLM_MODEL_LIGHT || process.env.DEEPSEEK_MODEL_LIGHT || "",
  llmReasoningEffort: process.env.LLM_REASONING_EFFORT || process.env.DEEPSEEK_REASONING_EFFORT || "",

  // ── 用户自带模型 BYOK ────────────────────────────────────
  // 允许用户在分析时使用自己的 API Key。关掉后前端不再展示该入口，
  // 后端也拒绝携带 llm 参数的请求。
  byokEnabled: process.env.BYOK_ENABLED !== "0",
  // 允许用户填写官方域名白名单以外的接口地址。
  // 默认关闭：开了等于把本服务器变成任人驱使的请求跳板（SSRF）。
  // 只有在需要接自建网关/代理时，由部署方显式打开。
  allowCustomLlmEndpoint: process.env.ALLOW_CUSTOM_LLM_ENDPOINT === "1",

  // DeepSeek 别名（向后兼容，勿在新代码中使用，一律走上面的 llm*）
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
  deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
  // per-skill 模型路由 (可选)：
  //   heavy  → deck / memo / investmentDeckPptx / icQuestions 等重任务
  //   light  → snapshot / brief / one-pager / 语义抽样审计 等轻任务
  //   default→ 其他所有 skill（兜底）
  // heavy 默认上 deepseek-v4-pro（贵约 3 倍但推理更强）；light 未配置时回落 deepseekModel。
  deepseekModelHeavy: process.env.DEEPSEEK_MODEL_HEAVY || "deepseek-v4-pro",
  deepseekModelLight: process.env.DEEPSEEK_MODEL_LIGHT || "",
  deepseekApiHost: process.env.DEEPSEEK_API_HOST || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
  // 推理档位：deepseek-v4-flash 支持 low/high/max，deepseek-v4-pro 目前只支持 high/max。
  // 留空 = 不发送该字段，用服务端默认。
  deepseekReasoningEffort: process.env.DEEPSEEK_REASONING_EFFORT || "",

  // 联网检索（博查 Bocha Web Search）
  // DeepSeek API 本身不提供检索能力，公开信息检索独立走博查：
  // https://open.bochaai.com → POST {host}/v1/web-search
  // 未配置 key 时全站检索静默降级为“无检索结果”，不阻塞分析流程。
  searchApiKey: process.env.BOCHA_API_KEY || "",
  searchApiHost: process.env.BOCHA_API_HOST || "https://api.bochaai.com/v1",

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

  // ── P2-2: 运行时调优参数统一收编（原先散落在各模块直读 process.env）──
  // 动态灰度/行为开关（测试会运行时切换的）在 config/featureFlags.js，不在这里。
  // 全局 API 兜底限流（次/分钟/IP），0 = 关闭
  rateLimitGlobalMax: parseInt(process.env.RATE_LIMIT_GLOBAL_MAX, 10) >= 0
    ? parseInt(process.env.RATE_LIMIT_GLOBAL_MAX, 10)
    : 300,
  // 工作区每日对话额度
  workspaceDailyChatLimit: parseInt(process.env.WORKSPACE_DAILY_CHAT_LIMIT, 10) || 3,
  // SSE 心跳间隔
  sseHeartbeatIntervalMs: parseInt(process.env.SSE_HEARTBEAT_INTERVAL, 10) || 15000,
  // 进程内轻量队列默认并发
  lightweightQueueConcurrency: parseInt(process.env.LIGHTWEIGHT_QUEUE_CONCURRENCY, 10) || 1,
  // 证据库原文截断上限（字符）
  evidenceRawTextMaxChars: parseInt(process.env.EVIDENCE_RAW_TEXT_MAX_CHARS, 10) || 240000,

  // ── BP 原文投喂上限（字符）─────────────────────────────────
  // 这三个数原本是 30000 / 3000 / 12000，是 MiniMax 时代上下文吃紧留下的。
  // DeepSeek V4 是 1M token 上下文（约 70~100 万中文字），这些限制已无必要。
  //   extraction   抽取环节能读到的 BP 长度 —— 这是全局天花板，
  //                超出部分对整条流水线永久不可见
  //   scoringCtx   评分裁判 + 五维分析能看到的 BP 原文（此前仅 3000 字，
  //                裁判只能盲信抽取结果，无法回原文复核）
  //   deepResearch 深度研究能看到的 BP 原文
  // 调大 = 质量升、成本和延迟略升。想压成本就调小这三个值，不用改代码。
  bpExtractionMaxChars: parseInt(process.env.BP_EXTRACTION_MAX_CHARS, 10) || 200000,
  bpScoringContextMaxChars: parseInt(process.env.BP_SCORING_CONTEXT_MAX_CHARS, 10) || 50000,
  bpDeepResearchMaxChars: parseInt(process.env.BP_DEEP_RESEARCH_MAX_CHARS, 10) || 50000,
  // 上传结构化抽取
  uploadStructuredExtractionDisabled: process.env.UPLOAD_STRUCTURED_EXTRACTION_DISABLED === "1",
  uploadExtractionConcurrency: parseInt(process.env.UPLOAD_EXTRACTION_CONCURRENCY, 10) || 1,
  // 冲突裁决
  conflictJudgeDisabled: process.env.CONFLICT_JUDGE_DISABLED === "1",
  conflictJudgeConcurrency: parseInt(process.env.CONFLICT_JUDGE_CONCURRENCY, 10) || 1,
  // 仅开发环境允许匿名分析（生产忽略此开关，analyze 路由二次校验）
  allowAnonAnalyze: process.env.ALLOW_ANON_ANALYZE === "1",

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

  // 平台自己的 LLM key。DEEPSEEK_API_KEY 与 LLM_API_KEY 二者有其一即可，
  // 这样把主力后端换成别家时不必再保留一个名不副实的 DEEPSEEK_ 变量。
  if (!config.llmApiKey) {
    console.error(
      "\n[FATAL] 生产环境必须设置 LLM_API_KEY（或向后兼容的 DEEPSEEK_API_KEY）！\n" +
      `  当前 LLM_PROVIDER=${config.llmProvider}\n` +
      "  DeepSeek 申请: https://platform.deepseek.com/api_keys\n"
    );
    process.exit(1);
  }

  // 检索 key 缺失不致命：检索层会静默降级，但要让运维知道分析质量会下降。
  if (!config.searchApiKey) {
    console.warn(
      "\n[WARN] 未设置 BOCHA_API_KEY，联网检索将全程返回空结果。\n" +
      "  深度研究报告 / 公司行业速览 / Agent 预检索会退化为“仅基于上传材料 + 模型知识”。\n" +
      "  申请: https://open.bochaai.com\n"
    );
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
