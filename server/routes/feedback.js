// ============================================================
// feedback.js — 反馈路由（用户端）
// ============================================================

const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const adminController = require("../controllers/adminController");

// 提交反馈（需登录）
router.post("/", requireAuth, adminController.createFeedback);

// 我的反馈列表（需登录）
router.get("/my", requireAuth, adminController.getMyFeedback);

module.exports = router;
