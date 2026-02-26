// ============================================================
// server/controllers/tokenController.js — 兑换码控制器
// ============================================================

const { getDb } = require("../db");
const { generateToken, generateTokens, redeemToken, getTokenList, getUserRedeemedTokens, getAvailableTokenCount } = require("../services/tokenService");

/**
 * 检查是否为管理员
 */
function isAdmin(userId) {
  const db = getDb();
  const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  return user?.role === "admin";
}

/** POST /api/token/generate — 生成兑换码（仅管理员） */
function generate(req, res) {
  const { quotaAmount = 1, expireDays = 30, count = 1 } = req.body;

  if (!req.user) {
    return res.status(401).json({ error: "请先登录" });
  }

  // 检查管理员权限
  if (!isAdmin(req.user.id)) {
    return res.status(403).json({ error: "权限不足，仅管理员可用" });
  }

  try {
    let result;
    if (count > 1) {
      result = generateTokens(count, quotaAmount, expireDays);
    } else {
      result = generateToken(quotaAmount, expireDays);
    }
    res.json(result);
  } catch (err) {
    console.error("[Token] 生成失败:", err);
    res.status(500).json({ error: "生成失败" });
  }
}

/** POST /api/token/redeem — 兑换 */
function redeem(req, res) {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: "请输入兑换码" });
  }

  if (!req.user) {
    return res.status(401).json({ error: "请先登录" });
  }

  try {
    const result = redeemToken(token, req.user.id);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json({
      success: true,
      message: `成功兑换 ${result.quotaAmount} 次额度`,
      quotaAmount: result.quotaAmount,
    });
  } catch (err) {
    console.error("[Token] 兑换失败:", err);
    res.status(500).json({ error: "兑换失败" });
  }
}

/** GET /api/token/list — 兑换码列表（仅管理员） */
function list(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: "请先登录" });
  }

  if (!isAdmin(req.user.id)) {
    return res.status(403).json({ error: "权限不足" });
  }

  try {
    const tokens = getTokenList();
    const available = getAvailableTokenCount();
    res.json({ tokens, available });
  } catch (err) {
    console.error("[Token] 获取列表失败:", err);
    res.status(500).json({ error: "获取失败" });
  }
}

/** GET /api/token/my — 我的兑换记录 */
function myTokens(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: "请先登录" });
  }

  try {
    const tokens = getUserRedeemedTokens(req.user.id);
    res.json(tokens);
  } catch (err) {
    console.error("[Token] 获取记录失败:", err);
    res.status(500).json({ error: "获取失败" });
  }
}

/** GET /api/user/role — 获取当前用户角色 */
function getUserRole(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: "请先登录" });
  }

  const isAdminUser = isAdmin(req.user.id);
  res.json({
    id: req.user.id,
    username: req.user.username,
    role: isAdminUser ? "admin" : "user",
    isAdmin: isAdminUser,
  });
}

module.exports = { generate, redeem, list, myTokens, getUserRole };
