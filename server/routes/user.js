// ============================================================
// server/routes/user.js — 用户信息路由
// ============================================================

const { Router } = require("express");
const os = require("os");
const multer = require("multer");
const { requireAuth } = require("../middleware/auth");
const {
  getProfile,
  updateProfile,
  updatePassword,
  getOrders,
  getUsage,
  getStats,
  getMonthlyStats,
  getMapData,
  getInviteCode,
  getReferralStats,
  uploadAvatar,
} = require("../controllers/userController");

const avatarUpload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("仅支持图片文件"));
  },
});

const router = Router();

// 所有路由都需要登录
router.get("/profile", requireAuth, getProfile);
router.put("/profile", requireAuth, updateProfile);
router.put("/password", requireAuth, updatePassword);
router.post("/avatar", requireAuth, avatarUpload.single("avatar"), uploadAvatar);
router.get("/orders", requireAuth, getOrders);
router.get("/usage", requireAuth, getUsage);
router.get("/stats", requireAuth, getStats);
router.get("/monthly-stats", requireAuth, getMonthlyStats);
router.get("/map-data", requireAuth, getMapData);
router.get("/invite-code", requireAuth, getInviteCode);
router.get("/referral-stats", requireAuth, getReferralStats);

module.exports = router;
