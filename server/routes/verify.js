// ============================================================
// server/routes/verify.js — 验证码路由
// ============================================================

const { Router } = require("express");
const { sendCode, checkCode } = require("../controllers/verifyController");

const router = Router();

router.post("/send", sendCode);
router.post("/check", checkCode);

module.exports = router;
