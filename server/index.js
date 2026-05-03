// ============================================================
// server/index.js — GarbageBPFilter 后端入口（v3.0 重构版）
//
// 架构升级：
//   - 分层架构：routes → controllers → services
//   - SQLite 持久化（用户、额度、订单、任务）
//   - JWT 认证 + bcrypt 密码哈希
//   - 渐进式账户系统 + 计费引擎
//   - 支付网关策略模式抽象
// ============================================================

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

// 加载配置（内含 dotenv 初始化）
const config = require("./config");

// 初始化数据库（自动运行迁移）
const { getDb } = require("./db");
getDb();

// 路由
const authRoutes = require("./routes/auth");
const analyzeRoutes = require("./routes/analyze");
const taskRoutes = require("./routes/task");
const quotaRoutes = require("./routes/quota");
const userRoutes = require("./routes/user");
const verifyRoutes = require("./routes/verify");
const tokenRoutes = require("./routes/token");
const adminRoutes = require("./routes/admin");
const feedbackRoutes = require("./routes/feedback");
const packagesRoutes = require("./routes/packages");
const announcementRoutes = require("./routes/announcement");
const leaderboardRoutes = require("./routes/leaderboard");
const projectRoutes = require("./routes/projects");
const statsRoutes = require("./routes/stats");

// 中间件
const { errorHandler } = require("./middleware/errorHandler");
const { requestId } = require("./middleware/requestId");
const { getModelName } = require("./services/llmService");

const app = express();

// ── 信任代理（修复 express-rate-limit 的 X-Forwarded-For 校验） ──
app.set("trust proxy", 1);

// ── 全局中间件 ──
// CORS：生产严格白名单；并禁用 credentials 以彻底规避 CSRF（项目使用 Bearer Token）
const corsOptions = (() => {
  if (config.env === "production" && config.allowedOrigins) {
    const whitelist = config.allowedOrigins.split(",").map((s) => s.trim()).filter(Boolean);
    return {
      origin(origin, callback) {
        if (!origin || whitelist.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS 拒绝来源: ${origin}`));
        }
      },
      credentials: false,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    };
  }
  // 开发模式：允许任意来源，但同样禁用 credentials
  return { origin: true, credentials: false };
})();
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // 允许嵌入外部资源
}));
app.use(cors(corsOptions));
app.use(requestId);
app.use(express.json({ limit: "50mb" }));

// ── API 路由 ──
app.use("/api/auth", authRoutes);
app.use("/api/analyze", analyzeRoutes);
app.use("/api/task", taskRoutes);
app.use("/api/quota", quotaRoutes);
app.use("/api/user", userRoutes);
app.use("/api/verify", verifyRoutes);
app.use("/api/token", tokenRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/packages", packagesRoutes);
app.use("/api/announcement", announcementRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/stats", statsRoutes);

// ── 健康检查（含 DB 探活）──
app.get("/api/health", (_req, res) => {
  const checks = { database: { status: "ok" } };
  try {
    getDb().prepare("SELECT 1").get();
  } catch (err) {
    checks.database = { status: "down", error: err.message };
  }
  const ok = checks.database.status === "ok";
  res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "degraded",
    model: getModelName(),
    search: "minimax_builtin",
    version: "3.0.0",
    checks,
    timestamp: new Date().toISOString(),
  });
});

// ── 静态文件：上传的图片 ──
const uploadsDir = path.join(__dirname, "..", "client", "public", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir));

// ── 静态文件服务（生产模式：SPA）──
const clientBuildDir = path.join(__dirname, "..", "client", "build");
if (fs.existsSync(clientBuildDir)) {
  app.use(express.static(clientBuildDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientBuildDir, "index.html"));
  });
} else {
  app.get("*", (_req, res) => {
    res.status(503).send(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>前端未构建</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0}.box{text-align:center;padding:2rem;border:1px solid #334155;border-radius:1rem;max-width:480px}h1{color:#f87171}code{background:#1e293b;padding:.2em .5em;border-radius:.3em}</style></head><body><div class="box"><h1>前端尚未构建</h1><p>请执行：<code>npm run build</code></p></div></body></html>`);
  });
}

// ── 全局错误处理 ──
app.use(errorHandler);

// ── 启动 ──
const PORT = config.port;
const server = app.listen(PORT, () => {
  console.log(`\n  GarbageBPFilter v3.0 后端已启动: http://localhost:${PORT}`);
  console.log(`  模型: ${getModelName()}`);
  console.log(`  数据库: ${config.dbPath}`);
  console.log(`  环境: ${config.env}`);
  console.log(`  通信模式: 异步任务轮询\n`);
});

const HTTP_TIMEOUT = 2 * 60 * 1000;
server.timeout = HTTP_TIMEOUT;
server.requestTimeout = HTTP_TIMEOUT;
server.keepAliveTimeout = HTTP_TIMEOUT + 1000;

// 优雅关闭：停止接受新连接，等待现有请求完成（最多 30s）
let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(() => {
    console.log("All connections closed, exiting...");
    try { const { closeDb } = require("./db"); closeDb(); } catch {}
    process.exit(0);
  });
  setTimeout(() => {
    console.error("Graceful shutdown timed out (30s), forcing exit...");
    try { const { closeDb } = require("./db"); closeDb(); } catch {}
    process.exit(1);
  }, 30_000).unref();
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// 全局兜底：避免后台异步任务的未捕获异常静默拖垮进程
process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error("[FATAL] Unhandled Rejection:", err.stack || err.message);
});
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught Exception:", err.stack || err.message);
  // 触发优雅关闭，让 PM2/Docker 拉起新进程
  gracefulShutdown("uncaughtException");
});
