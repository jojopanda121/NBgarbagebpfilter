// ============================================================
// server/controllers/taskController.js — 任务状态控制器
// ============================================================

const crypto = require("crypto");
const { getDb } = require("../db");
const { getTask, getTasksByUser } = require("../services/taskService");

/** GET /api/task/:taskId — 查询任务状态（需登录，owner 或 admin） */
function getTaskStatus(req, res) {
  const task = getTask(req.params.taskId);
  if (!task) {
    return res.status(404).json({ error: "任务不存在或已过期" });
  }

  // 权限检查：owner 或 admin
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "请先登录" });
  }

  const db = getDb();
  const userRow = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  const isAdmin = userRow?.role === "admin";

  if (task.user_id !== userId && !isAdmin) {
    return res.status(403).json({ error: "无权查看此报告" });
  }

  res.json(task);
}

/** GET /api/task/shared/:shareToken — 通过分享 token 查看报告（公开） */
function getSharedTask(req, res) {
  const { shareToken } = req.params;
  if (!shareToken) {
    return res.status(400).json({ error: "缺少分享 token" });
  }

  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM tasks WHERE share_token = ?"
  ).get(shareToken);

  if (!row) {
    return res.status(404).json({ error: "分享链接无效" });
  }

  // 检查过期
  if (row.share_expires_at && new Date(row.share_expires_at) < new Date()) {
    return res.status(410).json({ error: "分享链接已过期" });
  }

  // 解析 result
  if (row.result && typeof row.result === "string") {
    try { row.result = JSON.parse(row.result); } catch {}
  }

  res.json(row);
}

/** POST /api/task/:taskId/share — 生成分享链接（需登录 + owner） */
function shareTask(req, res) {
  const { taskId } = req.params;
  const userId = req.user.id;

  const task = getTask(taskId);
  if (!task) {
    return res.status(404).json({ error: "任务不存在" });
  }

  if (task.user_id !== userId) {
    return res.status(403).json({ error: "只能分享自己的报告" });
  }

  if (task.status !== "complete") {
    return res.status(400).json({ error: "只能分享已完成的报告" });
  }

  // 如果已有未过期的 share_token，直接返回
  if (task.share_token && task.share_expires_at && new Date(task.share_expires_at) > new Date()) {
    return res.json({ share_token: task.share_token });
  }

  // 生成新的 share_token（64位十六进制 = 256位熵）
  const shareToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(); // 3天

  const db = getDb();
  db.prepare(
    "UPDATE tasks SET share_token = ?, share_expires_at = ? WHERE id = ?"
  ).run(shareToken, expiresAt, taskId);

  res.json({ share_token: shareToken });
}

/** GET /api/tasks — 查询用户的任务列表 */
function getUserTasks(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: "请先登录" });
  }
  const tasks = getTasksByUser(req.user.id);
  res.json({ tasks });
}

module.exports = { getTaskStatus, getSharedTask, shareTask, getUserTasks };
