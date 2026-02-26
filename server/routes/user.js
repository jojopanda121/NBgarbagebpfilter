// ============================================================
// server/routes/user.js — 用户信息路由
// ============================================================

const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const {
  getProfile,
  updateProfile,
  updatePassword,
  getOrders,
  getUsage,
  getStats,
  getInviteCode,
  getReferralStats,
} = require("../controllers/userController");

const router = Router();

// 所有路由都需要登录
router.get("/profile", requireAuth, getProfile);
router.put("/profile", requireAuth, updateProfile);
router.put("/password", requireAuth, updatePassword);
router.get("/orders", requireAuth, getOrders);
router.get("/usage", requireAuth, getUsage);
router.get("/stats", requireAuth, getStats);
router.get("/invite-code", requireAuth, getInviteCode);
router.get("/referral-stats", requireAuth, getReferralStats);

module.exports = router;
