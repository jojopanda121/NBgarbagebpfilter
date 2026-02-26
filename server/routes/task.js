// server/routes/task.js — 任务路由
const { Router } = require("express");
const { optionalAuth, requireAuth } = require("../middleware/auth");
const { getTaskStatus, getSharedTask, shareTask, getUserTasks } = require("../controllers/taskController");

const router = Router();

router.get("/list", requireAuth, getUserTasks);
// 分享 token 访问（公开，必须在 :taskId 之前）
router.get("/shared/:shareToken", getSharedTask);
// 生成分享链接
router.post("/:taskId/share", requireAuth, shareTask);
// 查看任务（需登录，owner 或 admin）
router.get("/:taskId", requireAuth, getTaskStatus);

module.exports = router;
