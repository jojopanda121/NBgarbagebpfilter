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
const workspaceRoutes = require("./routes/workspace");
const agentsRoutes = require("./routes/agents");

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

// M10: 写接口强制 Content-Type 校验，作为 CSRF 第二道防线
// （CORS 已禁用 credentials，配合 application/json 要求可阻断绝大多数浏览器表单 CSRF）
app.use((req, res, next) => {
  const method = req.method;
  if (method !== "POST" && method !== "PUT" && method !== "PATCH" && method !== "DELETE") {
    return next();
  }
  // multipart 上传与 SSE 不在此校验范围
  const ct = (req.headers["content-type"] || "").toLowerCase();
  if (!ct) return next(); // 例如 DELETE 无 body
  if (ct.startsWith("application/json")) return next();
  if (ct.startsWith("multipart/form-data")) return next();
  if (ct.startsWith("application/x-www-form-urlencoded")) {
    // 表单 POST 通常意味着浏览器跨站发起，直接拒绝
    return res.status(415).json({ error: "Unsupported Content-Type" });
  }
  return res.status(415).json({ error: "Unsupported Content-Type" });
});

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
app.use("/api/workspace", workspaceRoutes);
app.use("/api/agents", agentsRoutes);
app.use("/api/workspace-projects", require("./routes/workspaceProjects"));
app.use("/api/skills", require("./routes/skills"));
app.use("/api/teaser", require("./routes/teaser"));

// ── 健康检查（含 DB 探活）──
app.get("/api/health", (_req, res) => {
  const checks = { database: { status: "ok" } };
  try {
    getDb().prepare("SELECT 1").get();
  } catch (err) {
    checks.database = { status: "down", error: err.message };
  }
  // M9: 关闭期间返回 503，让 LB / Docker / PM2 停止派发新流量
  const ok = checks.database.status === "ok" && !shuttingDown;
  const status = shuttingDown ? "shutting_down" : (ok ? "ok" : "degraded");
  if (config.env === "production") {
    return res.status(ok ? 200 : 503).json({ status, version: "3.0.0", timestamp: new Date().toISOString() });
  }
  res.status(ok ? 200 : 503).json({
    status,
    model: getModelName(),
    search: {
      provider: "minimax_coding_plan",
      configured: !!(config.minimaxCodePlanKey || config.minimaxApiKey),
      keySource: config.minimaxCodePlanKey ? "MINIMAX_CODE_PLAN_KEY" : "MINIMAX_API_KEY",
      openclawReady: !!config.minimaxCodePlanKey,
    },
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

// ── 启动前自检：未配置 DOC_SERVICE_URL 时本地 Python 依赖必须就绪 ──
function checkPythonDeps() {
  if (config.docServiceUrl) return; // 走远程文档微服务，无需本地 Python
  const { spawn } = require("child_process");
  const probe = spawn("python3", [
    "-c",
    "import fitz, pptx, rapidocr_onnxruntime, numpy, PIL",
  ]);
  let stderr = "";
  probe.stderr.on("data", (d) => (stderr += d));
  probe.on("close", (code) => {
    if (code !== 0) {
      console.warn(
        "\n[启动自检] 本地 Python 文档提取依赖缺失，PDF/PPT/DOC 上传将失败。"
      );
      console.warn(
        "  解决方案: 运行 `npm run install:python`，或在 .env 中设置 DOC_SERVICE_URL 走远程提取微服务。"
      );
      if (stderr) console.warn("  详情:", stderr.trim().split("\n").pop());
      console.warn("");
    }
  });
  probe.on("error", () => {
    console.warn(
      "\n[启动自检] 未找到 python3，PDF/PPT/DOC 提取不可用。请安装 Python 3.10+ 或配置 DOC_SERVICE_URL。\n"
    );
  });
}
checkPythonDeps();

// ── doc-service 自启动 ──
// 没有 pm2 / 没有外部部署的场景（npm run dev、单机 node 起服务）下,
// 自动 fork 一个 uvicorn 子进程, 避免投决速览/竞品矩阵/IC 问题清单/xlsx/docx
// 这些依赖 doc-service 的产出因为「忘了起 Python」而集体失败.
//
// 仅当 docServiceUrl 指向 localhost:8001 (默认 dev 值) 时才启动;
// 显式配置远程 url 则跳过, 由部署侧自己保证.
let _docServiceChild = null;
function bootDocServiceIfLocal() {
  const url = config.docServiceUrl || "";
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1):8001\/?$/.test(url);
  if (!isLocal) return;

  const http = require("http");
  // 先 probe: 已经在跑就别重复启
  const probeReq = http.get(`${url.replace(/\/$/, "")}/health`, { timeout: 1500 }, (res) => {
    res.resume();
    if (res.statusCode === 200) {
      console.log("[doc-service] 已检测到 8001 端口在运行, 跳过自启");
    } else {
      spawnDocService();
    }
  });
  probeReq.on("timeout", () => { probeReq.destroy(new Error("timeout")); });
  probeReq.on("error", () => { spawnDocService(); });
}

function spawnDocService() {
  const { spawn } = require("child_process");
  const docDir = path.join(__dirname, "..", "doc-service");
  if (!fs.existsSync(path.join(docDir, "main.py"))) {
    console.warn(`[doc-service] 未找到 ${docDir}/main.py, 跳过自启`);
    return;
  }
  console.log("[doc-service] 自启 uvicorn 子进程 ...");
  const child = spawn(
    "python3",
    ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8001"],
    { cwd: docDir, stdio: ["ignore", "pipe", "pipe"], env: process.env }
  );
  _docServiceChild = child;

  child.stdout.on("data", (d) => process.stdout.write(`[doc-service] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[doc-service] ${d}`));
  child.on("error", (err) => {
    console.error(
      `[doc-service] 启动失败: ${err.message}\n` +
      "  这会导致投决速览/竞品矩阵/IC 问题清单/xlsx/docx 产出全部不可用.\n" +
      "  解决: 安装 Python 3.10+ 并执行 npm run install:doc-service"
    );
  });
  child.on("exit", (code, signal) => {
    _docServiceChild = null;
    if (!shuttingDown) {
      console.warn(`[doc-service] 子进程退出 (code=${code}, signal=${signal})`);
    }
  });
}
bootDocServiceIfLocal();

// ── 启动 ──
const PORT = config.port;
const server = app.listen(PORT, () => {
  console.log(`\n  GarbageBPFilter v3.0 后端已启动: http://localhost:${PORT}`);
  console.log(`  模型: ${getModelName()}`);
  console.log(`  数据库: ${config.dbPath}`);
  console.log(`  环境: ${config.env}`);
  console.log(`  通信模式: 异步任务轮询\n`);
});

// ── 定时清理过期 workspace artifacts ──
const { runWorkspaceMemoryGc } = require("./services/workspaceService");
setTimeout(() => { try { runWorkspaceMemoryGc(); } catch (e) { console.error("[Cleanup]", e.message); } }, 60_000);
setInterval(() => {
  try { const r = runWorkspaceMemoryGc(); if (r.artifactsDeleted) console.log(`[Cleanup] 清理 ${r.artifactsDeleted} 个过期文件`); }
  catch (e) { console.error("[Cleanup]", e.message); }
}, 24 * 60 * 60 * 1000);

const HTTP_TIMEOUT = 2 * 60 * 1000;
server.timeout = HTTP_TIMEOUT;
server.requestTimeout = HTTP_TIMEOUT;
server.keepAliveTimeout = HTTP_TIMEOUT + 1000;

// 优雅关闭（M9）：超时与 LLM 调用对齐（5min），避免在长时间分析中途强行终止；
// 关闭期间健康检查返回 503，让上游（Nginx/Docker/PM2）停止把流量打到本实例
let shuttingDown = false;
const GRACEFUL_TIMEOUT_MS = parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS, 10) || 5 * 60 * 1000;
function isShuttingDown() { return shuttingDown; }
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully (timeout=${GRACEFUL_TIMEOUT_MS}ms)...`);
  server.close(() => {
    console.log("All connections closed, exiting...");
    try { const { closeDb } = require("./db"); closeDb(); } catch {}
    try { if (_docServiceChild && !_docServiceChild.killed) _docServiceChild.kill("SIGTERM"); } catch {}
    process.exit(0);
  });
  setTimeout(() => {
    console.error(`Graceful shutdown timed out (${GRACEFUL_TIMEOUT_MS}ms), forcing exit...`);
    try { const { closeDb } = require("./db"); closeDb(); } catch {}
    process.exit(1);
  }, GRACEFUL_TIMEOUT_MS).unref();
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
module.exports = { isShuttingDown };

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
