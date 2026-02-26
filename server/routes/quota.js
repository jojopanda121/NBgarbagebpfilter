// server/routes/quota.js — 额度路由
const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const { getQuota } = require("../controllers/quotaController");

const router = Router();

router.get("/", requireAuth, getQuota);

module.exports = router;
