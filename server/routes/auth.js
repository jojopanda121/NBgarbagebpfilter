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
  validate: { ipKeyGenerator: false },
});

// 注册速率限制：防止恶意批量注册（基于IP限制）
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 小时
  max: 10, // 同一 IP 最多 10 次注册/小时
  message: { error: "注册次数过多，请 1 小时后再试" },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ipKeyGenerator: false },
});

router.post("/register", registerLimiter, register);
router.post("/login", loginLimiter, login);
router.get("/me", requireAuth, getMe);
router.post("/bind-contact", requireAuth, bindContact);

module.exports = router;
