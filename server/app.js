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
  app.use(express.json({ limit: "50mb" }));
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
