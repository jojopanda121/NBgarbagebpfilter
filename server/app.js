const express = require("express");

const { getDb } = require("./db");
const { errorHandler } = require("./middleware/errorHandler");
const { requestId } = require("./middleware/requestId");
const { applySecurityMiddleware, buildCorsOptions, writeContentTypeGuard } = require("./middleware/security");
const { mountApiRoutes } = require("./routes/apiRoutes");
const { createHealthRouter } = require("./routes/health");
const { mountStaticAssets } = require("./staticAssets");

function createApp({ getShutdownState = () => false } = {}) {
  getDb();

  const app = express();
  app.set("trust proxy", 1);

  applySecurityMiddleware(app);
  app.use(requestId);
  app.use(express.json({ limit: "50mb" }));

  mountApiRoutes(app);
  app.use("/api/health", createHealthRouter({ getShutdownState }));
  mountStaticAssets(app);
  app.use(errorHandler);

  return app;
}

module.exports = {
  createApp,
  buildCorsOptions,
  writeContentTypeGuard,
};
