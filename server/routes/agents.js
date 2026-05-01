// ============================================================
// server/routes/agents.js — Multiagent 状态查询路由
// ============================================================

const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { getDb } = require("../db");
const agentRunService = require("../services/agentRunService");
const sseService = require("../services/sseService");

/**
 * GET /api/agents/run/:runId/status
 * 轻量状态轮询（SSE 不可用时的降级方案）
 */
router.get("/run/:runId/status", requireAuth, (req, res) => {
  const { runId } = req.params;
  const userId = req.user.id;
  try {
    // PRIVACY: only the owner (or admin) can query
    const db = getDb();
    const isAdmin = db.prepare("SELECT role FROM users WHERE id = ?").get(userId)?.role === "admin";
    if (!isAdmin && !agentRunService.runBelongsToUser(runId, userId)) {
      return res.status(403).json({ error: "无权访问" });
    }
    const runStatus = agentRunService.getRunStatus(runId, isAdmin ? 0 : userId);
    if (!runStatus) return res.status(404).json({ error: "run 不存在" });
    res.json(runStatus);
  } catch (err) {
    res.status(500).json({ error: "查询失败" });
  }
});

/**
 * GET /api/agents/run/:runId/stream
 * SSE 实时推送 agent 进度
 * PRIVACY: 仅 runId 所有者可订阅
 */
router.get("/run/:runId/stream", requireAuth, (req, res) => {
  const { runId } = req.params;
  const userId = req.user.id;
  try {
    const db = getDb();
    const isAdmin = db.prepare("SELECT role FROM users WHERE id = ?").get(userId)?.role === "admin";
    if (!isAdmin && !agentRunService.runBelongsToUser(runId, userId)) {
      return res.status(403).json({ error: "无权访问" });
    }
    sseService.subscribe(runId, res);
  } catch (err) {
    res.status(500).end();
  }
});

/**
 * GET /api/agents/run/:runId/report
 * 获取完整 agent 报告（从 agent_results 表提取 user_output）
 */
router.get("/run/:runId/report", requireAuth, (req, res) => {
  const { runId } = req.params;
  const userId = req.user.id;
  try {
    const db = getDb();
    const isAdmin = db.prepare("SELECT role FROM users WHERE id = ?").get(userId)?.role === "admin";
    if (!isAdmin && !agentRunService.runBelongsToUser(runId, userId)) {
      return res.status(403).json({ error: "无权访问" });
    }
    const report = agentRunService.getFullReport(runId, isAdmin ? 0 : userId);
    if (!report) return res.status(404).json({ error: "run 不存在" });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: "查询失败" });
  }
});

module.exports = router;
