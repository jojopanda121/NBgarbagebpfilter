const express = require("express");

const config = require("../config");
const { getDb } = require("../db");
const { getModelName } = require("../services/llmService");

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
        version: "3.0.0",
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
        provider: "kimi_builtin_web_search",
        configured: !!(process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY),
        keySource: process.env.KIMI_API_KEY ? "KIMI_API_KEY" : (process.env.MOONSHOT_API_KEY ? "MOONSHOT_API_KEY" : ""),
        tool: "$web_search",
      },
      version: "3.0.0",
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

module.exports = {
  createHealthRouter,
};
