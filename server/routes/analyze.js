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
// 双重保险：仅当 NODE_ENV !== production 且显式设置 ALLOW_ANON_ANALYZE=1 时才允许匿名访问，
// 防止误把 NODE_ENV 配错而暴露免登录入口。
const ALLOW_ANON =
  config.env !== "production" && process.env.ALLOW_ANON_ANALYZE === "1";
if (ALLOW_ANON) {
  console.warn("[Security] /api/analyze 允许未登录访问（ALLOW_ANON_ANALYZE=1），切勿在公网启用！");
}
const authMiddleware = ALLOW_ANON ? optionalAuth : requireAuth;

router.post("/", upload.single("file"), authMiddleware, (req, res, _next) => {
  // 如果用户已登录，检查额度
  if (req.user) {
    return checkQuota(req, res, () => analyze(req, res));
  }
  if (!ALLOW_ANON) {
    return res.status(401).json({ error: "未登录，请先登录" });
  }
  analyze(req, res);
});

module.exports = router;
