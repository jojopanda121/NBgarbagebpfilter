// server/routes/analyze.js — 分析路由
const { Router } = require("express");
const multer = require("multer");
const os = require("os");
const { optionalAuth, requireAuth } = require("../middleware/auth");
const { checkQuota } = require("../middleware/quota");
const { analyze } = require("../controllers/analyzeController");

const router = Router();
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 50 * 1024 * 1024 } });

// 分析端点：需要认证 + 额度检查
// optionalAuth 用于兼容未登录模式（开发/演示）
router.post("/", upload.single("file"), optionalAuth, (req, res, next) => {
  // 如果用户已登录，检查额度
  if (req.user) {
    return checkQuota(req, res, () => analyze(req, res));
  }
  // 未登录：直接执行（开发模式）
  analyze(req, res);
});

module.exports = router;
