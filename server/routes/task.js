// server/routes/task.js — 任务路由
const { Router } = require("express");
const { optionalAuth, requireAuth } = require("../middleware/auth");
const { getTaskStatus, getUserTasks } = require("../controllers/taskController");

const router = Router();

router.get("/list", requireAuth, getUserTasks);
router.get("/:taskId", getTaskStatus);

module.exports = router;
