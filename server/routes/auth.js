// server/routes/auth.js — 认证路由
const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("../middleware/auth");
const { register, login, getMe, bindContact } = require("../controllers/authController");

const router = Router();

// 登录速率限制：防止暴力破解
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 5, // 最多 5 次尝试
  message: { error: "登录尝试次数过多，请 15 分钟后再试" },
  standardHeaders: true,
  legacyHeaders: false,
});

// 注册速率限制：防止恶意批量注册（基于IP限制）
// 不同IP不限制注册人数，只限制同一IP的恶意注册行为
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 小时
  max: 10, // 同一 IP 最多 10 次注册/小时（防止恶意注册）
  message: { error: "注册次数过多，请 1 小时后再试" },
  standardHeaders: true,
  legacyHeaders: false,
  // 明确使用 IP 作为 key，确保是按 IP 限制而不是全局限制
  keyGenerator: (req) => {
    // 优先使用 X-Forwarded-For（反向代理环境），否则使用 IP
    return req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
  },
  // 跳过成功请求的计数，只计数失败的（可选优化）
  skipSuccessfulRequests: false,
});

router.post("/register", registerLimiter, register);
router.post("/login", loginLimiter, login);
router.get("/me", requireAuth, getMe);
router.post("/bind-contact", requireAuth, bindContact);

module.exports = router;
