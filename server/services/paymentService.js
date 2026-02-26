// ============================================================
// server/services/paymentService.js — 支付网关抽象（策略模式）
//
// 设计原则：
//   1. 严禁将微信/支付宝 API 写死在业务逻辑中
//   2. 统一 PaymentService 接口，按需调用子策略
//   3. 回调处理必须保证幂等性（订单号唯一索引）
//   4. 必须进行回调签名验签
// ============================================================

const crypto = require("crypto");
const { getDb } = require("../db");
const config = require("../config");

// ── 支付策略接口 ──

class PaymentStrategy {
  /** 创建支付订单，返回支付参数（二维码URL等） */
  async createOrder(/* orderNo, amountCents, description */) {
    throw new Error("Not implemented");
  }

  /** 验证回调签名 */
  verifyCallback(/* rawBody, headers */) {
    throw new Error("Not implemented");
  }

  /** 解析回调数据 */
  parseCallback(/* rawBody */) {
    throw new Error("Not implemented");
  }
}

// ── 微信支付策略 ──
class WechatPayStrategy extends PaymentStrategy {
  async createOrder(orderNo, amountCents, description) {
    // TODO: 接入微信支付 Native 支付 API
    // 文档：https://pay.weixin.qq.com/doc/v3/merchant/4012791858
    return {
      channel: "wechat",
      order_no: orderNo,
      qr_url: `weixin://wxpay/bizpayurl?pr=${orderNo}`,
      amount_cents: amountCents,
      description,
    };
  }

  verifyCallback(rawBody, headers) {
    // TODO: 微信支付 V3 签名验证
    // 使用平台证书公钥验证 Wechatpay-Signature
    if (!config.wechatPayApiKey) return false;
    return true; // placeholder
  }

  parseCallback(rawBody) {
    // TODO: 解密微信支付回调数据
    return JSON.parse(rawBody);
  }
}

// ── 支付宝策略 ──
class AlipayStrategy extends PaymentStrategy {
  async createOrder(orderNo, amountCents, description) {
    // TODO: 接入支付宝当面付 API
    // 文档：https://opendocs.alipay.com/open/194
    return {
      channel: "alipay",
      order_no: orderNo,
      qr_url: `https://qr.alipay.com/${orderNo}`,
      amount_cents: amountCents,
      description,
    };
  }

  verifyCallback(rawBody, headers) {
    // TODO: 支付宝异步通知签名验证
    if (!config.alipayPublicKey) return false;
    return true; // placeholder
  }

  parseCallback(rawBody) {
    // TODO: 解析支付宝回调表单数据
    return {};
  }
}

// ── 策略工厂 ──
const strategies = {
  wechat: new WechatPayStrategy(),
  alipay: new AlipayStrategy(),
};

function getStrategy(channel) {
  const strategy = strategies[channel];
  if (!strategy) throw new Error(`不支持的支付渠道: ${channel}`);
  return strategy;
}

// ── 订单服务 ──

/** 生成唯一订单号 */
function generateOrderNo() {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString("hex");
  return `BP${timestamp}${random}`.toUpperCase();
}

/** 创建支付订单 */
async function createPaymentOrder(userId, channel, quotaAmount) {
  const db = getDb();
  const orderNo = generateOrderNo();

  // 定价逻辑（可配置化）
  const pricePerQuota = 990; // 9.90 元 / 次，单位：分
  const amountCents = quotaAmount * pricePerQuota;

  // 写入数据库
  db.prepare(
    `INSERT INTO orders (order_no, user_id, amount_cents, quota_amount, payment_channel, status)
     VALUES (?, ?, ?, ?, ?, 'PENDING')`
  ).run(orderNo, userId, amountCents, quotaAmount, channel);

  // 调用支付渠道创建订单
  const strategy = getStrategy(channel);
  const paymentInfo = await strategy.createOrder(
    orderNo, amountCents, `BP分析额度 x ${quotaAmount}`
  );

  return { order_no: orderNo, ...paymentInfo };
}

/**
 * 处理支付回调（核心幂等逻辑）
 *
 * 关键安全措施：
 *   1. 先验证签名，防止伪造
 *   2. 检查订单状态是否为 PENDING（幂等保护）
 *   3. 事务内完成：订单状态更新 + 额度增加
 *   4. 订单号唯一索引保证幂等性
 */
function handlePaymentCallback(channel, rawBody, headers) {
  const strategy = getStrategy(channel);

  // 1. 签名验证（绝对红线）
  if (!strategy.verifyCallback(rawBody, headers)) {
    throw new Error("签名验证失败，拒绝处理");
  }

  // 2. 解析回调数据
  const callbackData = strategy.parseCallback(rawBody);
  const orderNo = callbackData.out_trade_no || callbackData.order_no;
  if (!orderNo) throw new Error("回调缺少订单号");

  const db = getDb();

  // 3. 幂等处理（事务保证原子性）
  const result = db.transaction(() => {
    // 查询订单（仅处理 PENDING 状态）
    const order = db.prepare(
      "SELECT * FROM orders WHERE order_no = ? AND status = 'PENDING'"
    ).get(orderNo);

    if (!order) {
      // 订单不存在或已处理 → 幂等返回成功
      return { success: true, idempotent: true };
    }

    // 更新订单状态为 PAID
    db.prepare(
      `UPDATE orders SET status = 'PAID', paid_at = datetime('now'),
       callback_raw = ?, updated_at = datetime('now')
       WHERE order_no = ? AND status = 'PENDING'`
    ).run(JSON.stringify(callbackData), orderNo);

    // 增加用户付费额度
    db.prepare(
      `UPDATE quotas SET paid_quota = paid_quota + ?, updated_at = datetime('now')
       WHERE user_id = ?`
    ).run(order.quota_amount, order.user_id);

    return { success: true, idempotent: false, order_no: orderNo };
  })();

  return result;
}

/** 查询订单状态 */
function getOrderStatus(orderNo, userId) {
  const db = getDb();
  return db.prepare(
    "SELECT order_no, amount_cents, quota_amount, payment_channel, status, paid_at, created_at FROM orders WHERE order_no = ? AND user_id = ?"
  ).get(orderNo, userId);
}

/** 查询用户订单列表 */
function getUserOrders(userId) {
  const db = getDb();
  return db.prepare(
    "SELECT order_no, amount_cents, quota_amount, payment_channel, status, paid_at, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20"
  ).all(userId);
}

module.exports = {
  createPaymentOrder,
  handlePaymentCallback,
  getOrderStatus,
  getUserOrders,
  PaymentStrategy,
  WechatPayStrategy,
  AlipayStrategy,
};
