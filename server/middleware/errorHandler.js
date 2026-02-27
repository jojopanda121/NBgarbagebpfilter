// ============================================================
// server/middleware/errorHandler.js — 全局错误处理
// ============================================================

const config = require("../config");

function errorHandler(err, _req, res, _next) {
  if (config.env === "production") {
    console.error("[Error]", err.message);
  } else {
    console.error("[Error]", err);
  }

  const status = err.status || 500;
  const message = status === 500 ? "服务器内部错误" : err.message;

  res.status(status).json({
    error: message,
    ...(config.env === "development" && { stack: err.stack }),
  });
}

module.exports = { errorHandler };
