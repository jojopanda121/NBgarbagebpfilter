// ============================================================
// server/middleware/errorHandler.js — 全局错误处理
// ============================================================

function errorHandler(err, _req, res, _next) {
  console.error("[Error]", err.message);

  const status = err.status || 500;
  const message = status === 500 ? "服务器内部错误" : err.message;

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
}

module.exports = { errorHandler };
