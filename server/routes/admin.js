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
const forumAdmin = require("../services/forumAdminService");
const { jsonHandler } = require("./routeUtils");

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

// Workspace 功能使用统计：全站功能热度排行 + 按用户下钻
// query: ?days=30 (默认 30, 1~365)
router.get("/feature-usage", adminController.requireAdmin, (req, res) => {
  try {
    const { aggregateFeatureUsage } = require("../services/featureUsageAggregator");
    const summary = aggregateFeatureUsage({ days: req.query.days });
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// query: ?days=30 &feature=onepager_pptx (可选过滤) &limit=50
router.get("/feature-usage/by-user", adminController.requireAdmin, (req, res) => {
  try {
    const { aggregateFeatureUsageByUser } = require("../services/featureUsageAggregator");
    const summary = aggregateFeatureUsageByUser({
      days: req.query.days,
      feature: req.query.feature,
      limit: req.query.limit,
    });
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 反馈管理
router.get("/feedback", adminController.requireAdmin, adminController.getFeedbackList);
router.post("/feedback/:id/reply", adminController.requireAdmin, adminController.replyFeedback);

// 论坛管理
router.get("/forum/analytics", adminController.requireAdmin, jsonHandler((req) =>
  forumAdmin.analytics({ days: req.query.days })
));
router.get("/forum/reports", adminController.requireAdmin, jsonHandler((req) =>
  forumAdmin.listReports({
    status: req.query.status || "pending",
    page: req.query.page,
    pageSize: req.query.pageSize,
  })
));
router.post("/forum/reports/:id/resolve", adminController.requireAdmin, jsonHandler((req) =>
  forumAdmin.resolveReport({
    reportId: Number(req.params.id),
    adminId: req.user.id,
    action: req.body.action,
    reason: req.body.reason,
  })
));
router.get("/forum/posts", adminController.requireAdmin, jsonHandler((req) =>
  forumAdmin.listAdminPosts({
    status: req.query.status || "all",
    category: req.query.category,
    q: req.query.q,
    page: req.query.page,
    pageSize: req.query.pageSize,
  })
));
router.post("/forum/posts/:id/moderate", adminController.requireAdmin, jsonHandler((req) =>
  forumAdmin.moderatePost({
    postId: Number(req.params.id),
    op: req.body.op,
    reason: req.body.reason,
  })
));
router.get("/forum/comments", adminController.requireAdmin, jsonHandler((req) =>
  forumAdmin.listAdminComments({
    status: req.query.status || "all",
    page: req.query.page,
    pageSize: req.query.pageSize,
  })
));
router.post("/forum/comments/:id/moderate", adminController.requireAdmin, jsonHandler((req) =>
  forumAdmin.moderateComment({
    commentId: Number(req.params.id),
    op: req.body.op,
  })
));
router.get("/forum/identity", adminController.requireAdmin, jsonHandler((req) =>
  forumAdmin.listIdentity({
    verified: req.query.verified,
    page: req.query.page,
    pageSize: req.query.pageSize,
  })
));
router.post("/forum/identity/:id/verify", adminController.requireAdmin, jsonHandler((req) =>
  forumAdmin.setIdentityVerified({
    userId: Number(req.params.id),
    verified: !!req.body.verified,
  })
));
router.get("/forum/deals", adminController.requireAdmin, jsonHandler((req) =>
  forumAdmin.listDeals({
    status: req.query.status || "all",
    page: req.query.page,
    pageSize: req.query.pageSize,
  })
));
router.post("/forum/deals/:id/intervene", adminController.requireAdmin, jsonHandler((req) =>
  forumAdmin.interveneDeal({
    dealId: Number(req.params.id),
    op: req.body.op,
    reason: req.body.reason,
  })
));

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
