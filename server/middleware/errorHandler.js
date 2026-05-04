// ============================================================
// server/middleware/errorHandler.js — 全局错误处理
// ============================================================

const config = require("../config");

// H7: 敏感字段脱敏 - 防止意外回显请求体/响应头中的 API Key
const SENSITIVE_KEY_RE = /authorization|api[-_]?key|secret|password|token|cookie/i;
function sanitizeForLog(obj, depth = 0) {
  if (depth > 3 || obj == null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => sanitizeForLog(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEY_RE.test(k)) out[k] = "[REDACTED]";
    else if (v && typeof v === "object") out[k] = sanitizeForLog(v, depth + 1);
    else out[k] = v;
  }
  return out;
}

function errorHandler(err, _req, res, _next) {
  if (config.env === "production") {
    console.error("[Error]", err.message);
  } else {
    // H7: 即便在开发环境也只输出 message + 脱敏后的元信息，避免 dump 到 stdout 时泄露
    console.error("[Error]", err.message, sanitizeForLog({
      code: err.code,
      status: err.status,
      stack: err.stack,
    }));
  }

  const status = err.status || 500;
  const message = status === 500 ? "服务器内部错误" : err.message;

  res.status(status).json({
    error: message,
    // 生产环境绝不回显 stack；开发环境也仅返回 stack 摘要，不返回 err 完整对象
    ...(config.env === "development" && { stack: err.stack }),
  });
}

module.exports = { errorHandler };
