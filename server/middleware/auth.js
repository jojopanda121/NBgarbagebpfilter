// ============================================================
// server/middleware/auth.js — JWT 认证中间件（含黑名单/吊销）
// ============================================================

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config");
const { getDb } = require("../db");

/** 检查 jti 是否在吊销黑名单中（启动失败时返回 false，避免锁死） */
function isRevoked(jti) {
  if (!jti) return false;
  try {
    const row = getDb()
      .prepare("SELECT 1 FROM revoked_tokens WHERE jti = ? AND expires_at > datetime('now')")
      .get(jti);
    return !!row;
  } catch {
    return false;
  }
}

/** 查询用户基本状态（is_banned/role），DB 异常时返回 null 不锁死 */
function loadUserState(userId) {
  if (!userId) return null;
  try {
    return getDb()
      .prepare("SELECT id, is_banned, role FROM users WHERE id = ?")
      .get(userId);
  } catch {
    return null;
  }
}

/** 必须登录：验证 JWT token，将 user 信息注入 req.user */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "未登录，请先登录" });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    if (isRevoked(payload.jti)) {
      return res.status(401).json({ error: "登录已失效，请重新登录" });
    }
    const state = loadUserState(payload.sub);
    if (state && state.is_banned) {
      return res.status(403).json({ error: "账号已被封禁，请联系管理员" });
    }
    req.user = {
      id: payload.sub,
      username: payload.username,
      jti: payload.jti,
      exp: payload.exp,
      role: state?.role || "user",
    };
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "登录已过期，请重新登录" });
    }
    return res.status(401).json({ error: "无效的认证令牌" });
  }
}

/** 可选登录 */
function optionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    if (isRevoked(payload.jti)) {
      req.user = null;
    } else {
      const state = loadUserState(payload.sub);
      if (state && state.is_banned) {
        req.user = null;
      } else {
        req.user = {
          id: payload.sub,
          username: payload.username,
          jti: payload.jti,
          exp: payload.exp,
          role: state?.role || "user",
        };
      }
    }
  } catch {
    req.user = null;
  }
  next();
}

/** 生成 JWT token（包含 jti 以便吊销） */
function signToken(user) {
  const jti = crypto.randomBytes(16).toString("hex");
  return jwt.sign(
    { sub: user.id, username: user.username, jti },
    config.jwtSecret,
    { algorithm: "HS256", expiresIn: config.jwtExpiresIn }
  );
}

/** 吊销 token（登出/封禁时调用） */
function revokeToken(jti, userId, expSeconds) {
  if (!jti) return;
  try {
    // M11: 严格校验 expSeconds，避免 NaN/undefined/Infinity 导致 Invalid Date 写入
    const validExp = Number.isFinite(expSeconds) && expSeconds > 0;
    const expIso = validExp
      ? new Date(expSeconds * 1000).toISOString()
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    getDb()
      .prepare("INSERT OR IGNORE INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, ?)")
      .run(jti, userId || null, expIso);
  } catch (err) {
    console.warn("[Auth] revokeToken failed:", err.message);
  }
}

module.exports = { requireAuth, optionalAuth, signToken, revokeToken };
