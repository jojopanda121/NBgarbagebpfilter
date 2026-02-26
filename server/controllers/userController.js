// ============================================================
// server/controllers/userController.js — 用户信息控制器
// ============================================================

const bcrypt = require("bcryptjs");
const { getDb } = require("../db");
const { getUserById, isEmailTaken, isPhoneTaken, updateUserProfile, updateUserPassword } = require("../services/userService");
const { getUserQuota } = require("../services/quotaService");
const { getOrCreateInviteCode, getReferralStats } = require("../services/referralService");

/** GET /api/user/profile — 获取当前用户信息 */
function getProfile(req, res) {
  const user = getUserById(req.user.id);

  if (!user) {
    return res.status(404).json({ error: "用户不存在" });
  }

  // 获取额度信息
  const quota = getUserQuota(req.user.id);

  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    contact_bound: !!user.contact_bound,
    usage_count: user.usage_count,
    created_at: user.created_at,
    quota,
  });
}

/** PUT /api/user/profile — 更新用户信息 */
function updateProfile(req, res) {
  const { email, phone, nickname } = req.body;

  // 检查邮箱是否已被其他用户使用
  if (email && isEmailTaken(email, req.user.id)) {
    return res.status(400).json({ error: "邮箱已被其他用户使用" });
  }

  // 检查手机号是否已被其他用户使用
  if (phone && isPhoneTaken(phone, req.user.id)) {
    return res.status(400).json({ error: "手机号已被其他用户使用" });
  }

  const updates = {};

  if (email !== undefined) updates.email = email;
  if (phone !== undefined) updates.phone = phone;
  if (nickname !== undefined) updates.nickname = nickname;

  // 如果绑定了邮箱或手机，更新 contact_bound 状态
  if (email || phone) {
    updates.contact_bound = 1;
  }

  if (Object.keys(updates).length === 0) {
    return res.json({ message: "没有需要更新的信息" });
  }

  updateUserProfile(req.user.id, updates);

  res.json({ message: "更新成功" });
}

/** PUT /api/user/password — 修改密码 */
async function updatePassword(req, res) {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: "请提供旧密码和新密码" });
  }

  if (newPassword.length < 6 || newPassword.length > 128) {
    return res.status(400).json({ error: "新密码长度需在 6-128 个字符之间" });
  }

  const user = getUserById(req.user.id);

  if (!user) {
    return res.status(404).json({ error: "用户不存在" });
  }

  // 需要获取密码哈希
  const db = getDb();
  const userWithHash = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);

  // 验证旧密码（异步，避免阻塞事件循环）
  const match = await bcrypt.compare(oldPassword, userWithHash.password_hash);
  if (!match) {
    return res.status(400).json({ error: "旧密码错误" });
  }

  // 更新密码（异步，避免阻塞事件循环）
  const newHash = await bcrypt.hash(newPassword, 12);
  updateUserPassword(req.user.id, newHash);

  res.json({ message: "密码修改成功" });
}

/** GET /api/user/orders — 获取订单历史 */
function getOrders(req, res) {
  const db = getDb();
  const orders = db.prepare(`
    SELECT id, order_no, amount_cents, quota_amount, payment_channel, status, paid_at, created_at
    FROM orders
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(req.user.id);

  res.json(orders.map(o => ({
    id: o.id,
    order_no: o.order_no,
    amount: o.amount_cents / 100,
    quota_amount: o.quota_amount,
    channel: o.payment_channel,
    status: o.status,
    paid_at: o.paid_at,
    created_at: o.created_at,
  })));
}

/** GET /api/user/usage — 获取消费明细 */
function getUsage(req, res) {
  const db = getDb();
  const usage = db.prepare(`
    SELECT id, status, percentage, stage, message, created_at, updated_at
    FROM tasks
    WHERE user_id = ? AND status IN ('complete', 'error')
    ORDER BY created_at DESC
    LIMIT 50
  `).all(req.user.id);

  res.json(usage.map(t => ({
    id: t.id,
    type: "分析",
    amount: 1,
    status: t.status,
    created_at: t.created_at,
  })));
}

/** GET /api/user/stats — 用户个人数据看板 */
function getStats(req, res) {
  const db = getDb();
  const userId = req.user.id;

  const tasks = db.prepare(`
    SELECT id, title, industry_category, result, created_at
    FROM tasks
    WHERE user_id = ? AND status = 'complete'
    ORDER BY created_at DESC
    LIMIT 100
  `).all(userId);

  const industryMap = {};
  const gradeMap = {};
  const scores = [];
  const recent = [];

  tasks.forEach((task, idx) => {
    const cat = task.industry_category || "其他";
    industryMap[cat] = (industryMap[cat] || 0) + 1;

    if (task.result) {
      try {
        const parsed = JSON.parse(task.result);
        const verdict = parsed.verdict;
        if (verdict) {
          if (verdict.grade) gradeMap[verdict.grade] = (gradeMap[verdict.grade] || 0) + 1;
          if (typeof verdict.total_score === "number") scores.push(verdict.total_score);
        }
      } catch {}
    }

    if (idx < 5) {
      recent.push({
        id: task.id,
        title: task.title || "BP 尽调分析",
        industry_category: task.industry_category || "其他",
        created_at: task.created_at,
      });
    }
  });

  const avg_score = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null;

  res.json({
    total_count: tasks.length,
    industry_dist: Object.entries(industryMap)
      .map(([industry, count]) => ({ industry, count }))
      .sort((a, b) => b.count - a.count),
    grade_dist: Object.entries(gradeMap)
      .map(([grade, count]) => ({ grade, count })),
    avg_score,
    recent,
  });
}

/** GET /api/user/invite-code — 获取邀请码 */
function getInviteCode(req, res) {
  const code = getOrCreateInviteCode(req.user.id);
  res.json({ invite_code: code });
}

/** GET /api/user/referral-stats — 获取邀请统计 */
function getReferralStatsHandler(req, res) {
  const stats = getReferralStats(req.user.id);
  res.json(stats);
}

module.exports = {
  getProfile,
  updateProfile,
  updatePassword,
  getOrders,
  getUsage,
  getStats,
  getInviteCode,
  getReferralStats: getReferralStatsHandler,
};
