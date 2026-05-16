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
    if (!err) {
      // M6: 客户端中断时 multer 可能仍把文件落到 tmp，注册兜底清理避免 tmp 累积
      if (req.file) {
        const fs = require("fs");
        const tmpPath = req.file.path;
        const cleanupOnAbort = () => {
          fs.promises.unlink(tmpPath).catch(() => { /* file already removed by handler */ });
        };
        req.on("aborted", cleanupOnAbort);
        // 响应结束时自动解绑（避免内存泄漏）
        res.on("close", () => req.removeListener("aborted", cleanupOnAbort));
      }
      return next();
    }
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "文件过大，最多 50MB" });
    }
    return res.status(400).json({ error: err.message || "文件上传失败" });
  });
}

// 分析端点：强制认证 + 额度检查
// 双重保险：仅当 NODE_ENV !== production 且显式设置 ALLOW_ANON_ANALYZE=1 时才允许匿名访问，
// 防止误把 NODE_ENV 配错而暴露免登录入口。
const ALLOW_ANON =
  config.env !== "production" && process.env.ALLOW_ANON_ANALYZE === "1";
if (ALLOW_ANON) {
  console.warn("[Security] /api/analyze 允许未登录访问（ALLOW_ANON_ANALYZE=1），切勿在公网启用！");
}
const authMiddleware = ALLOW_ANON ? optionalAuth : requireAuth;

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

router.post("/", authMiddleware, analyzeLimiter, handleUpload, (req, res, _next) => {
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
