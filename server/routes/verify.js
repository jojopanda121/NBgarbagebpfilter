// ============================================================
// server/routes/verify.js — 验证码路由
// ============================================================

const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { sendCode, checkCode } = require("../controllers/verifyController");

const router = Router();

// 发送验证码限流：防止短信/邮件轰炸
const sendCodeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分钟
  max: 3, // 每分钟最多 3 次
  message: { error: "发送过于频繁，请 1 分钟后再试" },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

// 验证码校验限流：防止暴力枚举
const checkCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 10, // 最多 10 次尝试
  message: { error: "验证尝试次数过多，请 15 分钟后再试" },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

router.post("/send", sendCodeLimiter, sendCode);
router.post("/check", checkCodeLimiter, checkCode);

module.exports = router;
