// ============================================================
// server/middleware/requestId.js — 请求 ID 中间件
// 为每个请求分配唯一 ID，注入 req.requestId
// ============================================================

const crypto = require("crypto");

function requestId(req, _res, next) {
  req.requestId = req.headers["x-request-id"] || crypto.randomUUID().slice(0, 8);
  next();
}

module.exports = { requestId };
