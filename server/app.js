const express = require("express");

const { getDb } = require("./db");
const { errorHandler } = require("./middleware/errorHandler");
const { requestId } = require("./middleware/requestId");
const { applySecurityMiddleware, buildCorsOptions, writeContentTypeGuard } = require("./middleware/security");
const { mountApiRoutes } = require("./routes/apiRoutes");
const { createHealthRouter } = require("./routes/health");
const { mountStaticAssets } = require("./staticAssets");

function initializeDatabase() {
  getDb();
}

function configureMiddleware(app) {
  app.set("trust proxy", 1);

  applySecurityMiddleware(app);
  app.use(requestId);
  // P0-2: 全局 body 上限收紧到 1MB。50MB × 并发解析放大足以把 1.4G 堆打穿（OOM → 全部在途任务失败）。
  // 唯一合法的大 JSON 入口是 /api/analyze 的文本直传模式（req.body.text），单独放宽到 10MB；
  // body-parser 对已解析的请求会跳过，因此先挂路由级、再挂全局不会重复解析。
  app.use("/api/analyze", express.json({ limit: "10mb" }));
  app.use(express.json({ limit: "1mb" }));
}

function registerRoutes(app, { getShutdownState }) {
  mountApiRoutes(app);
  app.use("/api/health", createHealthRouter({ getShutdownState }));
  mountStaticAssets(app);
}

function registerErrorHandling(app) {
  app.use(errorHandler);
}

function createApp({ getShutdownState = () => false } = {}) {
  initializeDatabase();

  const app = express();
  configureMiddleware(app);
  registerRoutes(app, { getShutdownState });
  registerErrorHandling(app);

  return app;
}

module.exports = {
  createApp,
  buildCorsOptions,
  writeContentTypeGuard,
};
