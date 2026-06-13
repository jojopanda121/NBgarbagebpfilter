const helmet = require("helmet");
const compression = require("compression");
const cors = require("cors");

const config = require("../config");

function buildCorsOptions() {
  if (config.env === "production" && config.allowedOrigins) {
    const whitelist = config.allowedOrigins.split(",").map((s) => s.trim()).filter(Boolean);
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
}

module.exports = {
  applySecurityMiddleware,
  buildCorsOptions,
  writeContentTypeGuard,
  helmetOptions,
};
