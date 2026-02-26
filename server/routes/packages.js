// ============================================================
// packages.js — 套餐路由（公开）
// ============================================================

const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");

// 获取套餐列表（公开）
router.get("/", adminController.getPackages);

module.exports = router;
