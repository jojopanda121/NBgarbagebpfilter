// ============================================================
// admin.js — 管理员路由
// ============================================================

const express = require("express");
const os = require("os");
const multer = require("multer");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const adminController = require("../controllers/adminController");
const trackingController = require("../controllers/trackingController");

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
router.delete("/users/:id", adminController.requireAdmin, adminController.deleteUser);
router.post("/users/batch-delete", adminController.requireAdmin, adminController.deleteUsers);
router.post("/users/:id/vip", adminController.requireAdmin, adminController.toggleVip);

// 统计数据
router.get("/stats", adminController.requireAdmin, adminController.getStats);

// P3-4 skill 运行健康度看板：fallback / semantic_audit / bp_deep / institutional_memory
// query: ?days=7 (默认 7) &skillId=onepager_pptx (可选过滤)
router.get("/skill-metrics", adminController.requireAdmin, (req, res) => {
  try {
    const { aggregateSkillMetrics } = require("../services/metricsAggregator");
    const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 7));
    const skillId = typeof req.query.skillId === "string" && req.query.skillId.trim()
      ? req.query.skillId.trim() : null;
    const summary = aggregateSkillMetrics({ days, skillId });
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
router.get("/task-industries", adminController.requireAdmin, adminController.getTaskIndustries);
router.get("/tasks/:taskId", adminController.requireAdmin, adminController.getTaskDetail);

// 兑换码管理
router.get("/tokens", adminController.requireAdmin, adminController.getTokenList);
router.delete("/tokens/:token", adminController.requireAdmin, adminController.deleteToken);

// 审计日志
router.get("/audit-logs", adminController.requireAdmin, adminController.getAuditLogs);

// 共享技能/知识审核（Hermes curator → reviewer → admin）
router.use("/skill-review", require("./skillReview"));

// ── 追踪数据看板（管理员）──
router.get("/tracking/dashboard", adminController.requireAdmin, trackingController.getDashboard);
router.get("/tracking/companies", adminController.requireAdmin, trackingController.getCompanies);
router.get("/tracking/companies/:id", adminController.requireAdmin, trackingController.getCompanyDetail);
router.post("/tracking/companies/:id/toggle", adminController.requireAdmin, trackingController.toggleTracking);
router.post("/tracking/run-quarterly", adminController.requireAdmin, trackingController.runQuarterlyTracking);
router.get("/tracking/export", adminController.requireAdmin, trackingController.exportTrainingData);
router.get("/tracking/validations", adminController.requireAdmin, trackingController.getValidations);
router.get("/tracking/qcc-status", adminController.requireAdmin, trackingController.getQCCStatus);

module.exports = router;
