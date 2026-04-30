// server/routes/analyze.js — 分析路由
const { Router } = require("express");
const multer = require("multer");
const os = require("os");
const config = require("../config");
const { optionalAuth, requireAuth } = require("../middleware/auth");
const { checkQuota } = require("../middleware/quota");
const { analyze } = require("../controllers/analyzeController");

const router = Router();
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 50 * 1024 * 1024 } });

// 分析端点：强制认证 + 额度检查
// 仅 development 模式允许未登录访问（开发/演示），并打印安全警告
if (config.env === "development") {
  console.warn("[Security] 开发模式：/api/analyze 允许未登录访问，请勿在公网环境使用！");
}
const authMiddleware = config.env === "development" ? optionalAuth : requireAuth;

router.post("/", upload.single("file"), authMiddleware, (req, res, _next) => {
  // 如果用户已登录，检查额度
  if (req.user) {
    return checkQuota(req, res, () => analyze(req, res));
  }
  if (config.env !== "development") {
    return res.status(401).json({ error: "未登录，请先登录" });
  }
  // 仅开发模式下可到达此处（未登录直接执行）
  analyze(req, res);
});

module.exports = router;
