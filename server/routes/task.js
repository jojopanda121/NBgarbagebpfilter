// server/routes/task.js — 任务路由
const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("../middleware/auth");
const { getTaskStatus, getSharedTask, shareTask, getUserTasks, softDeleteTask, revokeShare } = require("../controllers/taskController");

const router = Router();

// H6: 公开分享接口加 IP 级限流，防止 share_token 被遍历枚举
const sharedTaskLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "请求过于频繁，请稍后再试" },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => `shared-task:${req.ip}`,
});

router.get("/list", requireAuth, getUserTasks);
// 分享 token 访问（公开，必须在 :taskId 之前）
router.get("/shared/:shareToken", sharedTaskLimiter, getSharedTask);
// 生成分享链接
router.post("/:taskId/share", requireAuth, shareTask);
// 撤销分享链接
router.delete("/:taskId/share", requireAuth, revokeShare);
// 软删除报告
router.delete("/:taskId", requireAuth, softDeleteTask);
// 查看任务（需登录，owner 或 admin）
router.get("/:taskId", requireAuth, getTaskStatus);

module.exports = router;
