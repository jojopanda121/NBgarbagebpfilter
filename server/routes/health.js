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
      model: getModelName(),
      llm_stats: getLlmStats(),
      search: {
        provider: "minimax_coding_plan_search",
        configured: !!config.minimaxApiKey,
        keySource: process.env.MINIMAX_API_KEY ? "MINIMAX_API_KEY" : "",
        tool: "coding_plan/search",
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
