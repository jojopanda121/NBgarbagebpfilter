// server/routes/analyze.js — 分析路由
const { Router } = require("express");
const multer = require("multer");
const os = require("os");
const config = require("../config");
const { optionalAuth, requireAuth } = require("../middleware/auth");
const { checkQuota } = require("../middleware/quota");
const { analyze } = require("../controllers/analyzeController");

const router = Router();
// H6: 限制扩展名 + mime + 大小，避免越权类型上传
const ALLOWED_UPLOAD_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/octet-stream", // 部分浏览器对 .pdf/.pptx 给出 octet-stream
]);
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname || "").toLowerCase();
    const okExt = name.endsWith(".pdf") || name.endsWith(".pptx");
    const okMime = ALLOWED_UPLOAD_MIMES.has(file.mimetype);
    if (okExt && okMime) return cb(null, true);
    return cb(new Error("仅支持 PDF / PPTX 文件"));
  },
});

// 兜底：multer 抛错时返回 4xx 而不是 500
function handleUpload(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "文件过大，最多 50MB" });
    }
    return res.status(400).json({ error: err.message || "文件上传失败" });
  });
}

// 分析端点：强制认证 + 额度检查
// 仅 development 模式允许未登录访问（开发/演示），并打印安全警告
if (config.env === "development") {
  console.warn("[Security] 开发模式：/api/analyze 允许未登录访问，请勿在公网环境使用！");
}
const authMiddleware = config.env === "development" ? optionalAuth : requireAuth;

// 已登录用户级速率限制（M8）：同一用户/IP 每小时最多 20 次分析请求
const rateLimit = require("express-rate-limit");
const analyzeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: "分析请求过于频繁，请稍后再试" },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => (req.user && req.user.id ? `u:${req.user.id}` : `ip:${req.ip}`),
});

router.post("/", handleUpload, authMiddleware, analyzeLimiter, (req, res, next) => {
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
