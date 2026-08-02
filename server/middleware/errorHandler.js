// ============================================================
// server/middleware/errorHandler.js — 全局错误处理
// ============================================================

const config = require("../config");
const logger = require("../utils/logger");

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

function errorHandler(err, req, res, _next) {
  // P1-3: 生产环境也必须落 stack + requestId，否则线上 500 无法定位。
  // stack 只包含代码位置不含请求体，H7 的脱敏顾虑不适用于它；
  // 其余元信息仍走 sanitizeForLog 脱敏。
  logger.error(`[Error] ${err.message}`, sanitizeForLog({
    requestId: req?.requestId,
    method: req?.method,
    path: req?.originalUrl,
    code: err.code,
    status: err.status,
    stack: err.stack,
  }));

  const status = err.status || 500;
  const message = status === 500 ? "服务器内部错误" : err.message;

  res.status(status).json({
    error: message,
    // 生产环境绝不回显 stack；开发环境也仅返回 stack 摘要，不返回 err 完整对象
    ...(config.env === "development" && { stack: err.stack }),
  });
}

/**
 * async 路由包装器：Express 4 不会捕获 async handler 的 rejection
 * （会变成 unhandledRejection 并触发进程级处理）。
 * async 控制器一律用本函数包装，把异常导入 errorHandler。
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { errorHandler, asyncHandler };
