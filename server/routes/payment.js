// server/routes/payment.js — 支付路由
const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const { createOrder, paymentCallback, queryOrder, listOrders } = require("../controllers/paymentController");

const router = Router();

// 需要登录的接口
router.post("/create", requireAuth, createOrder);
router.get("/order/:orderNo", requireAuth, queryOrder);
router.get("/orders", requireAuth, listOrders);

// 支付回调（不需要登录，由支付平台发起）
router.post("/callback/:channel", paymentCallback);

module.exports = router;
