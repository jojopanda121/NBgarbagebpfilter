// ============================================================
// server/routes/token.js — 兑换码路由
// ============================================================

const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("../middleware/auth");
const { generate, redeem, list, myTokens, getUserRole } = require("../controllers/tokenController");

const router = Router();

// 兑换接口限流：每分钟最多 5 次
const redeemLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "操作过于频繁，请 1 分钟后再试" },
  standardHeaders: true,
  legacyHeaders: false,
});

// 生成接口限流：每分钟最多 10 次
const generateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "操作过于频繁，请 1 分钟后再试" },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/generate", requireAuth, generateLimiter, generate);
router.post("/redeem", requireAuth, redeemLimiter, redeem);
router.get("/list", requireAuth, list);
router.get("/my", requireAuth, myTokens);
router.get("/role", requireAuth, getUserRole);

module.exports = router;
