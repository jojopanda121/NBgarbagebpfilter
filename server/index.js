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
const paymentRoutes = require("./routes/payment");
const userRoutes = require("./routes/user");
const verifyRoutes = require("./routes/verify");
const tokenRoutes = require("./routes/token");
const adminRoutes = require("./routes/admin");
const feedbackRoutes = require("./routes/feedback");
const packagesRoutes = require("./routes/packages");

// 中间件
const { errorHandler } = require("./middleware/errorHandler");
const { getModelName } = require("./services/llmService");

const app = express();

// ── 全局中间件 ──
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// ── API 路由 ──
app.use("/api/auth", authRoutes);
app.use("/api/analyze", analyzeRoutes);
app.use("/api/task", taskRoutes);
app.use("/api/quota", quotaRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/user", userRoutes);
app.use("/api/verify", verifyRoutes);
app.use("/api/token", tokenRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/packages", packagesRoutes);

// ── 健康检查 ──
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", model: getModelName(), search: "minimax_builtin", version: "3.0.0" });
});

// ── 搜索状态（兼容旧前端） ──
app.get("/api/search-status", (_req, res) => {
  res.json({ enabled: true, provider: "minimax_builtin" });
});

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

// 优雅关闭
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully...");
  server.close(() => {
    const { closeDb } = require("./db");
    closeDb();
    process.exit(0);
  });
});
