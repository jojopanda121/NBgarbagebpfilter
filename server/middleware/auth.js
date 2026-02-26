// ============================================================
// server/middleware/auth.js — JWT 认证中间件
// ============================================================

const jwt = require("jsonwebtoken");
const config = require("../config");

/**
 * 必须登录：验证 JWT token，将 user 信息注入 req.user
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "未登录，请先登录" });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.sub, username: payload.username };
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "登录已过期，请重新登录" });
    }
    return res.status(401).json({ error: "无效的认证令牌" });
  }
}

/**
 * 可选登录：如果携带了有效 token 则注入 req.user，否则跳过
 */
function optionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.sub, username: payload.username };
  } catch {
    req.user = null;
  }
  next();
}

/**
 * 生成 JWT token
 */
function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

module.exports = { requireAuth, optionalAuth, signToken };
