// ============================================================
// server/controllers/userController.js — 用户信息控制器
// ============================================================

const bcrypt = require("bcryptjs");
const { getDb } = require("../db");

/** GET /api/user/profile — 获取当前用户信息 */
function getProfile(req, res) {
  const db = getDb();
  const user = db.prepare(
    "SELECT id, username, email, phone, contact_bound, usage_count, created_at FROM users WHERE id = ?"
  ).get(req.user.id);

  if (!user) {
    return res.status(404).json({ error: "用户不存在" });
  }

  // 获取额度信息
  const quota = db.prepare(
    "SELECT free_quota, paid_quota FROM quotas WHERE user_id = ?"
  ).get(req.user.id);

  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    contact_bound: !!user.contact_bound,
    usage_count: user.usage_count,
    created_at: user.created_at,
    quota: quota ? {
      free: quota.free_quota,
      paid: quota.paid_quota,
      total: quota.free_quota + quota.paid_quota,
    } : { free: 0, paid: 0, total: 0 },
  });
}

/** PUT /api/user/profile — 更新用户信息 */
function updateProfile(req, res) {
  const { email, phone, nickname } = req.body;
  const db = getDb();

  // 检查邮箱是否已被其他用户使用
  if (email) {
    const existing = db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(email, req.user.id);
    if (existing) {
      return res.status(400).json({ error: "邮箱已被其他用户使用" });
    }
  }

  // 检查手机号是否已被其他用户使用
  if (phone) {
    const existing = db.prepare("SELECT id FROM users WHERE phone = ? AND id != ?").get(phone, req.user.id);
    if (existing) {
      return res.status(400).json({ error: "手机号已被其他用户使用" });
    }
  }

  const updates = [];
  const values = [];

  if (email !== undefined) {
    updates.push("email = ?");
    values.push(email);
  }
  if (phone !== undefined) {
    updates.push("phone = ?");
    values.push(phone);
  }

  // 如果绑定了邮箱或手机，更新 contact_bound 状态
  if ((email && email !== req.user.email) || (phone && phone !== req.user.phone)) {
    updates.push("contact_bound = 1");
  }

  if (updates.length === 0) {
    return res.json({ message: "没有需要更新的信息" });
  }

  updates.push("updated_at = datetime('now')");
  values.push(req.user.id);

  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);

  res.json({ message: "更新成功" });
}

/** PUT /api/user/password — 修改密码 */
function updatePassword(req, res) {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: "请提供旧密码和新密码" });
  }

  if (newPassword.length < 6 || newPassword.length > 128) {
    return res.status(400).json({ error: "新密码长度需在 6-128 个字符之间" });
  }

  const db = getDb();
  const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);

  if (!user) {
    return res.status(404).json({ error: "用户不存在" });
  }

  // 验证旧密码
  const match = bcrypt.compareSync(oldPassword, user.password_hash);
  if (!match) {
    return res.status(400).json({ error: "旧密码错误" });
  }

  // 更新密码
  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newHash, req.user.id);

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

module.exports = {
  getProfile,
  updateProfile,
  updatePassword,
  getOrders,
  getUsage,
};
