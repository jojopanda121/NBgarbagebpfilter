const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const config = require("./config");
const { getDb } = require("./db");
const { errorHandler } = require("./middleware/errorHandler");
const { requestId } = require("./middleware/requestId");
const { getModelName } = require("./services/llmService");

const apiRoutes = [
  ["/api/auth", "./routes/auth"],
  ["/api/analyze", "./routes/analyze"],
  ["/api/task", "./routes/task"],
  ["/api/quota", "./routes/quota"],
  ["/api/user", "./routes/user"],
  ["/api/verify", "./routes/verify"],
  ["/api/token", "./routes/token"],
  ["/api/admin", "./routes/admin"],
  ["/api/feedback", "./routes/feedback"],
  ["/api/packages", "./routes/packages"],
  ["/api/announcement", "./routes/announcement"],
  ["/api/leaderboard", "./routes/leaderboard"],
  ["/api/projects", "./routes/projects"],
  ["/api/stats", "./routes/stats"],
  ["/api/workspace", "./routes/workspace"],
  ["/api/agents", "./routes/agents"],
  ["/api/workspace-projects", "./routes/workspaceProjects"],
  ["/api/skills", "./routes/skills"],
  ["/api/teaser", "./routes/teaser"],
];

function buildCorsOptions() {
  if (config.env === "production" && config.allowedOrigins) {
    const whitelist = config.allowedOrigins.split(",").map((s) => s.trim()).filter(Boolean);
    return {
      origin(origin, callback) {
        if (!origin || whitelist.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS refused origin: ${origin}`));
        }
      },
      credentials: false,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    };
  }

  return { origin: true, credentials: false };
}

function writeContentTypeGuard(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  const contentType = (req.headers["content-type"] || "").toLowerCase();
  if (!contentType) return next();
  if (contentType.startsWith("application/json")) return next();
  if (contentType.startsWith("multipart/form-data")) return next();

  return res.status(415).json({ error: "Unsupported Content-Type" });
}

function mountHealthRoute(app, getShutdownState) {
  app.get("/api/health", (_req, res) => {
    const checks = { database: { status: "ok" } };
    try {
      getDb().prepare("SELECT 1").get();
    } catch (err) {
      checks.database = { status: "down", error: err.message };
    }

    const shuttingDown = getShutdownState();
    const ok = checks.database.status === "ok" && !shuttingDown;
    const status = shuttingDown ? "shutting_down" : (ok ? "ok" : "degraded");

    if (config.env === "production") {
      return res.status(ok ? 200 : 503).json({
        status,
        version: "3.0.0",
        timestamp: new Date().toISOString(),
      });
    }

    return res.status(ok ? 200 : 503).json({
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
}

function mountStaticAssets(app) {
  const uploadsDir = path.join(__dirname, "..", "client", "public", "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  app.use("/uploads", express.static(uploadsDir));

  const clientBuildDir = path.join(__dirname, "..", "client", "build");
  if (fs.existsSync(clientBuildDir)) {
    app.use(express.static(clientBuildDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(clientBuildDir, "index.html"));
    });
    return;
  }

  app.get("*", (_req, res) => {
    res.status(503).send(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>前端未构建</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0}.box{text-align:center;padding:2rem;border:1px solid #334155;border-radius:1rem;max-width:480px}h1{color:#f87171}code{background:#1e293b;padding:.2em .5em;border-radius:.3em}</style></head><body><div class="box"><h1>前端尚未构建</h1><p>请执行：<code>npm run build</code></p></div></body></html>`);
  });
}

function createApp({ getShutdownState = () => false } = {}) {
  getDb();

  const app = express();
  app.set("trust proxy", 1);

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
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors(buildCorsOptions()));
  app.use(requestId);
  app.use(writeContentTypeGuard);
  app.use(express.json({ limit: "50mb" }));

  for (const [mountPath, routePath] of apiRoutes) {
    app.use(mountPath, require(routePath));
  }

  mountHealthRoute(app, getShutdownState);
  mountStaticAssets(app);
  app.use(errorHandler);

  return app;
}

module.exports = {
  createApp,
  buildCorsOptions,
  writeContentTypeGuard,
};
