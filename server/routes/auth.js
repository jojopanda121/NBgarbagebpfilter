// server/routes/auth.js — 认证路由
const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const { register, login, getMe, bindContact } = require("../controllers/authController");

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", requireAuth, getMe);
router.post("/bind-contact", requireAuth, bindContact);

module.exports = router;
