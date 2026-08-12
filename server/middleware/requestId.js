// ============================================================
// server/middleware/requestId.js — 请求 ID 中间件
// 为每个请求分配唯一 ID，注入 req.requestId
// ============================================================

const crypto = require("crypto");

function requestId(req, res, next) {
  const clientId = req.headers["x-request-id"];
  const isValid = clientId && /^[\w\-]{1,64}$/.test(clientId);
  req.requestId = isValid ? clientId : crypto.randomUUID().slice(0, 8);
  // P3-4: 回写响应头，用户报障时可直接提供 ID 与服务端日志串联
  res.setHeader("X-Request-Id", req.requestId);
  next();
}

module.exports = { requestId };
