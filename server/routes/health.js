const express = require("express");

const config = require("../config");
const { getDb } = require("../db");
const { getModelName } = require("../services/llmService");

// P3-5: 版本号以 server/package.json 为唯一事实源，不再硬编码
const VERSION = require("../package.json").version;

function createHealthRouter({ getShutdownState = () => false } = {}) {
  const router = express.Router();

  router.get("/", (_req, res) => {
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
        version: VERSION,
        timestamp: new Date().toISOString(),
      });
    }

    const { getLlmStats } = require("../services/llmService");
    return res.status(ok ? 200 : 503).json({
      status,
      provider: config.llmProvider,
      model: getModelName(),
      llm_stats: getLlmStats(),
      search: {
        provider: "bocha_web_search",
        configured: !!config.searchApiKey,
        keySource: config.searchApiKey ? "BOCHA_API_KEY" : "",
        tool: "web-search",
      },
      version: VERSION,
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

module.exports = {
  createHealthRouter,
};
