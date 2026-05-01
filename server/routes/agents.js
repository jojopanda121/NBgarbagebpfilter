// ============================================================
// server/routes/agents.js — Multiagent 状态查询路由
// ============================================================

const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { getDb } = require("../db");
const { getAgentRunStatus } = require("../agents/orchestrator");

/**
 * GET /api/agents/run/:taskId/status
 * 查询某个任务下 6 个 agent 的运行状态
 * 只能查自己的任务（除管理员外）
 */
router.get("/run/:taskId/status", requireAuth, (req, res) => {
  const { taskId } = req.params;
  const userId = req.user.id;

  try {
    const db = getDb();

    // 权限校验：确认这个 task 属于当前用户（或管理员）
    const task = db.prepare("SELECT user_id FROM tasks WHERE id = ?").get(taskId);
    if (!task) {
      return res.status(404).json({ error: "任务不存在" });
    }
    const isAdmin = db.prepare("SELECT role FROM users WHERE id = ?").get(userId)?.role === "admin";
    if (!isAdmin && task.user_id !== userId) {
      return res.status(403).json({ error: "无权访问此任务" });
    }

    const agents = getAgentRunStatus(taskId);

    // 返回精简摘要（不暴露完整 result JSON，只暴露状态和摘要）
    const summary = agents.map((a) => {
      let resultSummary = null;
      if (a.status === "complete" && a.result) {
        try {
          const parsed = JSON.parse(a.result);
          // 各 agent 的一句话摘要
          switch (a.agent_name) {
            case "project_summary":
              resultSummary = parsed.one_line_pitch || parsed.company_name || null;
              break;
            case "founder":
              resultSummary = parsed.team_strength_summary || (parsed.founders?.length ? `${parsed.founders.length} 位创始人` : null);
              break;
            case "financial":
              resultSummary = parsed.financial_summary || null;
              break;
            case "competitor":
              resultSummary = parsed.competitive_landscape_summary || (parsed.competitors?.length ? `识别 ${parsed.competitors.length} 家竞品` : null);
              break;
            case "red_flag":
              resultSummary = parsed.risk_summary || (parsed.red_flags?.length ? `发现 ${parsed.red_flags.length} 个风险信号` : null);
              break;
            case "valuation":
              resultSummary = parsed.valuation_summary || parsed.benchmark_analysis?.valuation_vs_benchmark || null;
              break;
          }
        } catch (_) { /* ignore */ }
      }
      return {
        agent_name: a.agent_name,
        status: a.status,
        error: a.error || null,
        summary: resultSummary,
        started_at: a.started_at,
        completed_at: a.completed_at,
      };
    });

    res.json({ taskId, agents: summary });
  } catch (err) {
    res.status(500).json({ error: "查询失败" });
  }
});

/**
 * GET /api/agents/run/:taskId/report
 * 获取某个任务完整的 multiagent 报告（从 task.result 中提取）
 */
router.get("/run/:taskId/report", requireAuth, (req, res) => {
  const { taskId } = req.params;
  const userId = req.user.id;

  try {
    const db = getDb();
    const task = db.prepare("SELECT user_id, result, status FROM tasks WHERE id = ?").get(taskId);
    if (!task) return res.status(404).json({ error: "任务不存在" });

    const isAdmin = db.prepare("SELECT role FROM users WHERE id = ?").get(userId)?.role === "admin";
    if (!isAdmin && task.user_id !== userId) {
      return res.status(403).json({ error: "无权访问此任务" });
    }

    if (task.status !== "complete") {
      return res.status(202).json({ status: task.status, message: "分析尚未完成" });
    }

    let result;
    try { result = JSON.parse(task.result); } catch { return res.status(500).json({ error: "结果解析失败" }); }

    res.json({ taskId, multiagent: result.multiagent || null });
  } catch (err) {
    res.status(500).json({ error: "查询失败" });
  }
});

module.exports = router;
