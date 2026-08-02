const helmet = require("helmet");
const compression = require("compression");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const config = require("../config");

// P3-3: 全局兜底限流 — 各敏感路由已有精细限流，这里只挡住无限流的公开
// GET（论坛列表/teaser 等）被脚本打爆的情况。默认 300 次/分钟/IP，足够宽松，
// 正常用户不会触碰；可用 RATE_LIMIT_GLOBAL_MAX 调整，0 表示关闭。
function buildGlobalApiLimiter() {
  const max = config.rateLimitGlobalMax;
  if (!max) return null;
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    message: { error: "请求过于频繁，请稍后再试" },
    skip: (req) => req.path.startsWith("/health"),
  });
}

function buildCorsOptions() {
  if (config.env === "production" && config.allowedOrigins) {
    const whitelist = config.allowedOrigins.split(",").map((s) => s.trim()).filter(Boolean);
    // iOS/Android 原生 app（Capacitor WKWebView）的固定 origin，始终放行。
    whitelist.push("capacitor://localhost", "https://localhost", "ionic://localhost");
    return {
      origin(origin, callback) {
        if (!origin || whitelist.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS refused origin: ${origin}`));
        }
      },
      credentials: false,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    };
  }

  return { origin: true, credentials: false };
}

function writeContentTypeGuard(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  const contentType = (req.headers["content-type"] || "").toLowerCase();
  if (!contentType) return next();
  if (contentType.startsWith("application/json")) return next();
  if (contentType.startsWith("multipart/form-data")) return next();

  return res.status(415).json({ error: "Unsupported Content-Type" });
}

function helmetOptions() {
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // CRA 构建已设 INLINE_RUNTIME_CHUNK=false，无需放行 unsafe-inline 脚本。
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
        // framer-motion / Recharts 运行时写内联样式，保留 unsafe-inline。
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  };
}

function applySecurityMiddleware(app) {
  app.use(compression());
  app.use(helmet(helmetOptions()));
  app.use(cors(buildCorsOptions()));
  app.use(writeContentTypeGuard);
  const globalLimiter = buildGlobalApiLimiter();
  if (globalLimiter) app.use("/api", globalLimiter);
}

module.exports = {
  applySecurityMiddleware,
  buildCorsOptions,
  writeContentTypeGuard,
  helmetOptions,
};
