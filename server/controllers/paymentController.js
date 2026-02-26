// ============================================================
// server/controllers/paymentController.js — 支付控制器
// ============================================================

const {
  createPaymentOrder,
  handlePaymentCallback,
  getOrderStatus,
  getUserOrders,
} = require("../services/paymentService");

/** POST /api/payment/create — 创建支付订单 */
async function createOrder(req, res) {
  const { channel, quota_amount } = req.body;

  if (!channel || !["wechat", "alipay"].includes(channel)) {
    return res.status(400).json({ error: "请选择支付方式（wechat/alipay）" });
  }

  const quotaAmount = parseInt(quota_amount, 10);
  if (!quotaAmount || quotaAmount < 1 || quotaAmount > 100) {
    return res.status(400).json({ error: "购买数量需要 1-100 之间" });
  }

  try {
    const result = await createPaymentOrder(req.user.id, channel, quotaAmount);
    res.json(result);
  } catch (err) {
    console.error("[Payment] 创建订单失败:", err.message);
    res.status(500).json({ error: "创建支付订单失败" });
  }
}

/** POST /api/payment/callback/:channel — 支付回调（幂等处理） */
function paymentCallback(req, res) {
  const { channel } = req.params;

  try {
    const result = handlePaymentCallback(channel, JSON.stringify(req.body), req.headers);
    // 向支付平台返回成功
    if (channel === "wechat") {
      res.json({ code: "SUCCESS", message: "成功" });
    } else {
      res.send("success");
    }
  } catch (err) {
    console.error(`[Payment] ${channel} 回调处理失败:`, err.message);
    res.status(400).json({ error: err.message });
  }
}

/** GET /api/payment/order/:orderNo — 查询订单状态 */
function queryOrder(req, res) {
  const order = getOrderStatus(req.params.orderNo, req.user.id);
  if (!order) {
    return res.status(404).json({ error: "订单不存在" });
  }
  res.json(order);
}

/** GET /api/payment/orders — 查询用户订单列表 */
function listOrders(req, res) {
  const orders = getUserOrders(req.user.id);
  res.json({ orders });
}

module.exports = { createOrder, paymentCallback, queryOrder, listOrders };
