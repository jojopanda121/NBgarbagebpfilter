// ============================================================
// server/controllers/taskController.js — 任务状态控制器
// ============================================================

const { getTask, getTasksByUser } = require("../services/taskService");

/** GET /api/task/:taskId — 查询任务状态 */
function getTaskStatus(req, res) {
  const task = getTask(req.params.taskId);
  if (!task) {
    return res.status(404).json({ error: "任务不存在或已过期" });
  }
  res.json(task);
}

/** GET /api/tasks — 查询用户的任务列表 */
function getUserTasks(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: "请先登录" });
  }
  const tasks = getTasksByUser(req.user.id);
  res.json({ tasks });
}

module.exports = { getTaskStatus, getUserTasks };
