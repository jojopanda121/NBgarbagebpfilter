// ============================================================
// admin.js — 管理员路由
// ============================================================

const express = require("express");
const os = require("os");
const multer = require("multer");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const adminController = require("../controllers/adminController");

const imageUpload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("仅支持图片文件"));
  },
});

// 公开接口：获取站点内容（无需登录）
router.get("/site-content/:slug", adminController.getSiteContent);

// 所有路由需要登录
router.use(requireAuth);

// 站点内容管理（管理员）
router.put("/site-content/:slug", adminController.requireAdmin, adminController.updateSiteContent);
router.post("/site-content/:slug/image", adminController.requireAdmin, imageUpload.single("image"), adminController.uploadSiteImage);
router.delete("/site-content/:slug/image", adminController.requireAdmin, adminController.deleteSiteImage);

// 用户管理
router.get("/users", adminController.requireAdmin, adminController.getUsers);
router.get("/users/:id", adminController.requireAdmin, adminController.getUserById);
router.post("/users/:id/ban", adminController.requireAdmin, adminController.banUser);

// 统计数据
router.get("/stats", adminController.requireAdmin, adminController.getStats);

// 反馈管理
router.get("/feedback", adminController.requireAdmin, adminController.getFeedbackList);
router.post("/feedback/:id/reply", adminController.requireAdmin, adminController.replyFeedback);

// 套餐管理
router.get("/packages", adminController.requireAdmin, adminController.getPackages);
router.post("/packages", adminController.requireAdmin, adminController.createPackage);
router.put("/packages/:id", adminController.requireAdmin, adminController.updatePackage);
router.delete("/packages/:id", adminController.requireAdmin, adminController.deletePackage);

// 系统设置
router.get("/settings", adminController.requireAdmin, adminController.getSettings);
router.put("/settings", adminController.requireAdmin, adminController.updateSettings);

// 分析记录管理
router.get("/tasks", adminController.requireAdmin, adminController.getAllTasks);
router.get("/tasks/:taskId", adminController.requireAdmin, adminController.getTaskDetail);

// 兑换码管理
router.get("/tokens", adminController.requireAdmin, adminController.getTokenList);
router.delete("/tokens/:token", adminController.requireAdmin, adminController.deleteToken);

// 审计日志
router.get("/audit-logs", adminController.requireAdmin, adminController.getAuditLogs);

module.exports = router;
