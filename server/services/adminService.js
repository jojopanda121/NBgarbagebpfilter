// ============================================================
// adminService.js — 管理员服务层
// ============================================================

const { getDb } = require("../db");

// 用户管理
const getUsers = (options = {}) => {
  const db = getDb();
  const { page = 1, pageSize = 20, search = "", status = "" } = options;
  const offset = (page - 1) * pageSize;

  // 先检查 is_banned 列是否存在
  const tableInfo = db.prepare("PRAGMA table_info(users)").all();
  const hasBanned = tableInfo.some((col) => col.name === "is_banned");

  let whereClause = "1=1";
  const params = [];

  if (search) {
    whereClause += " AND (u.username LIKE ? OR u.email LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }

  if (status === "active" && hasBanned) {
    whereClause += " AND u.is_banned = 0";
  } else if (status === "banned" && hasBanned) {
    whereClause += " AND u.is_banned = 1";
  }

  // 获取总数 - 使用参数化查询
  const countQuery = `SELECT COUNT(*) as total FROM users u WHERE ${whereClause}`;
  const { total } = db.prepare(countQuery).get(...params);

  // 获取列表 - 使用条件列名和参数化查询
  const isBannedSelect = hasBanned ? "u.is_banned," : "0 as is_banned,";
  const listQuery = `
    SELECT
      u.id, u.username, u.email, u.phone, u.usage_count, ${isBannedSelect} u.created_at, u.updated_at,
      COALESCE(q.free_quota, 0) + COALESCE(q.paid_quota, 0) as total_quota,
      COALESCE(q.paid_quota, 0) as paid_quota
    FROM users u
    LEFT JOIN quotas q ON u.id = q.user_id
    WHERE ${whereClause}
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `;
  const users = db.prepare(listQuery).all(...params, pageSize, offset);

  return { users, total, page, pageSize };
};

const getUserById = (id) => {
  const db = getDb();

  // 动态检测 is_banned 列
  const tableInfo = db.prepare("PRAGMA table_info(users)").all();
  const hasBanned = tableInfo.some((col) => col.name === "is_banned");
  const isBannedSelect = hasBanned ? "u.is_banned," : "0 as is_banned,";

  const user = db.prepare(`
    SELECT
      u.id, u.username, u.email, u.phone, u.usage_count, ${isBannedSelect} u.created_at, u.updated_at,
      COALESCE(q.free_quota, 0) as free_quota,
      COALESCE(q.paid_quota, 0) as paid_quota
    FROM users u
    LEFT JOIN quotas q ON u.id = q.user_id
    WHERE u.id = ?
  `).get(id);

  if (!user) return null;

  // 获取最近订单
  const orders = db.prepare(`
    SELECT id, order_no, amount_cents, quota_amount, status, paid_at, created_at
    FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
  `).all(id);

  // 获取最近分析记录
  const tasks = db.prepare(`
    SELECT id, status, percentage, stage, created_at
    FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
  `).all(id);

  return { user, orders, tasks };
};

const banUser = (userId, banned) => {
  const db = getDb();
  // 先确保 is_banned 列存在
  const tableInfo = db.prepare("PRAGMA table_info(users)").all();
  const hasBanned = tableInfo.some((col) => col.name === "is_banned");
  if (!hasBanned) {
    db.prepare("ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0").run();
  }
  const stmt = db.prepare("UPDATE users SET is_banned = ? WHERE id = ?");
  return stmt.run(banned ? 1 : 0, userId);
};

// 统计数据
const getStats = () => {
  const db = getDb();

  // 总用户数
  const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users").get().count;

  // 活跃用户（最近7天有登录）
  const activeUsers = db.prepare(`
    SELECT COUNT(DISTINCT user_id) as count FROM tasks
    WHERE created_at >= datetime('now', '-7 days')
  `).get().count;

  // 累计收入
  const totalRevenue = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) as total FROM orders WHERE status = 'PAID'
  `).get().total;

  // 总分析次数
  const totalAnalyzes = db.prepare(`
    SELECT COUNT(*) as count FROM tasks WHERE status = 'complete'
  `).get().count;

  // 分析状态分布
  const taskStatusDist = db.prepare(`
    SELECT status, COUNT(*) as count FROM tasks GROUP BY status
  `).all();

  // 每日新增用户趋势（最近30天）
  const userTrend = db.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM users
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY DATE(created_at)
    ORDER BY date
  `).all();

  // 收入趋势（最近30天）
  const revenueTrend = db.prepare(`
    SELECT DATE(paid_at) as date, SUM(amount_cents) as total
    FROM orders
    WHERE status = 'PAID' AND paid_at >= datetime('now', '-30 days')
    GROUP BY DATE(paid_at)
    ORDER BY date
  `).all();

  // 评分等级分布（从 result JSON 中提取 grade）
  let gradeDist = [];
  try {
    const completeTasks = db.prepare(`
      SELECT result FROM tasks WHERE status = 'complete' AND result IS NOT NULL
    `).all();
    const gradeCount = { A: 0, B: 0, C: 0, D: 0 };
    for (const task of completeTasks) {
      try {
        const result = typeof task.result === "string" ? JSON.parse(task.result) : task.result;
        const grade = result?.verdict?.grade;
        if (grade && gradeCount[grade] !== undefined) {
          gradeCount[grade]++;
        }
      } catch (_) { /* ignore parse errors */ }
    }
    gradeDist = Object.entries(gradeCount).map(([grade, count]) => ({ grade, count }));
  } catch (_) { /* ignore */ }

  // 日均分析量趋势（最近30天）
  const dailyAnalysisTrend = db.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM tasks
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY DATE(created_at)
    ORDER BY date
  `).all();

  // 行业分布（从 industry_category 字段）
  let industryDist = [];
  try {
    // 动态检测列是否存在
    const tableInfo = db.prepare("PRAGMA table_info(tasks)").all();
    const hasIndustryCategory = tableInfo.some((col) => col.name === "industry_category");
    if (hasIndustryCategory) {
      industryDist = db.prepare(`
        SELECT industry_category as category, COUNT(*) as count
        FROM tasks
        WHERE status = 'complete' AND industry_category IS NOT NULL AND industry_category != ''
        GROUP BY industry_category
        ORDER BY count DESC
      `).all();
    }
  } catch (_) { /* ignore */ }

  // 套餐销售占比
  let packageSalesDist = [];
  try {
    packageSalesDist = db.prepare(`
      SELECT quota_amount, COUNT(*) as count, SUM(amount_cents) as revenue
      FROM orders
      WHERE status = 'PAID' AND payment_channel != 'REDEEM'
      GROUP BY quota_amount
      ORDER BY count DESC
    `).all();
  } catch (_) { /* ignore */ }

  // 兑换码使用率
  let tokenStats = { total: 0, used: 0, expired: 0, available: 0 };
  try {
    const total = db.prepare("SELECT COUNT(*) as count FROM tokens").get().count;
    const used = db.prepare("SELECT COUNT(*) as count FROM tokens WHERE used_at IS NOT NULL").get().count;
    const expired = db.prepare("SELECT COUNT(*) as count FROM tokens WHERE used_at IS NULL AND expires_at < datetime('now')").get().count;
    tokenStats = { total, used, expired, available: total - used - expired };
  } catch (_) { /* ignore */ }

  // 用户留存率（注册后7天内是否再次使用）
  let retentionRate = 0;
  try {
    const recentUsers = db.prepare(`
      SELECT COUNT(*) as count FROM users
      WHERE created_at >= datetime('now', '-30 days')
    `).get().count;
    const retainedUsers = db.prepare(`
      SELECT COUNT(DISTINCT u.id) as count
      FROM users u
      INNER JOIN tasks t ON u.id = t.user_id
      WHERE u.created_at >= datetime('now', '-30 days')
        AND t.created_at > datetime(u.created_at, '+1 day')
    `).get().count;
    retentionRate = recentUsers > 0 ? Math.round((retainedUsers / recentUsers) * 100) : 0;
  } catch (_) { /* ignore */ }

  return {
    totalUsers,
    activeUsers,
    totalRevenue,
    totalAnalyzes,
    taskStatusDist,
    userTrend,
    revenueTrend,
    gradeDist,
    dailyAnalysisTrend,
    industryDist,
    packageSalesDist,
    tokenStats,
    retentionRate,
  };
};

// 反馈管理
const getFeedbackList = (options = {}) => {
  const db = getDb();
  const { page = 1, pageSize = 20, status = "" } = options;
  const offset = (page - 1) * pageSize;

  let whereClause = "1=1";
  const params = [];

  if (status && status !== "all") {
    whereClause += " AND f.status = ?";
    params.push(status);
  }

  const countQuery = `SELECT COUNT(*) as total FROM feedback f WHERE ${whereClause}`;
  const { total } = db.prepare(countQuery).get(...params);

  const listQuery = `
    SELECT f.*, u.username
    FROM feedback f
    LEFT JOIN users u ON f.user_id = u.id
    WHERE ${whereClause}
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `;
  const feedback = db.prepare(listQuery).all(...params, pageSize, offset);

  return { feedback, total, page, pageSize };
};

const replyFeedback = (feedbackId, reply) => {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE feedback
    SET admin_reply = ?, status = 'processed', replied_at = datetime('now')
    WHERE id = ?
  `);
  return stmt.run(reply, feedbackId);
};

const createFeedback = (userId, data) => {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO feedback (user_id, type, title, content)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(userId, data.type || "suggestion", data.title, data.content);
  return result.lastInsertRowid;
};

const getMyFeedback = (userId) => {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC
  `).all(userId);
};

// 套餐管理
const getPackages = () => {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM packages WHERE is_active = 1 ORDER BY sort_order
  `).all();
};

const createPackage = (data) => {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO packages (name, quota_amount, price_cents, sort_order)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(data.name, data.quota_amount, data.price_cents, data.sort_order || 0);
  return result.lastInsertRowid;
};

const updatePackage = (id, data) => {
  const db = getDb();
  const fields = [];
  const params = [];

  if (data.name !== undefined) { fields.push("name = ?"); params.push(data.name); }
  if (data.quota_amount !== undefined) { fields.push("quota_amount = ?"); params.push(data.quota_amount); }
  if (data.price_cents !== undefined) { fields.push("price_cents = ?"); params.push(data.price_cents); }
  if (data.is_active !== undefined) { fields.push("is_active = ?"); params.push(data.is_active); }
  if (data.sort_order !== undefined) { fields.push("sort_order = ?"); params.push(data.sort_order); }

  if (fields.length === 0) {
    throw new Error("No fields to update");
  }

  params.push(id);
  const query = `UPDATE packages SET ${fields.join(", ")} WHERE id = ?`;
  return db.prepare(query).run(...params);
};

const deletePackage = (id) => {
  const db = getDb();
  return db.prepare("DELETE FROM packages WHERE id = ?").run(id);
};

// 分析记录管理
const getAllTasks = (options = {}) => {
  const db = getDb();
  const { page = 1, pageSize = 20, status = "", search = "" } = options;
  const offset = (page - 1) * pageSize;

  let whereClause = "1=1";
  const params = [];

  if (status) {
    whereClause += " AND t.status = ?";
    params.push(status);
  }

  if (search) {
    whereClause += " AND (u.username LIKE ? OR t.id LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }

  const countQuery = `SELECT COUNT(*) as total FROM tasks t LEFT JOIN users u ON t.user_id = u.id WHERE ${whereClause}`;
  const { total } = db.prepare(countQuery).get(...params);

  const listQuery = `
    SELECT t.*, u.username
    FROM tasks t
    LEFT JOIN users u ON t.user_id = u.id
    WHERE ${whereClause}
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `;
  const tasks = db.prepare(listQuery).all(...params, pageSize, offset);

  return { tasks, total, page, pageSize };
};

const getTaskDetail = (taskId) => {
  const db = getDb();
  const task = db.prepare(`
    SELECT t.*, u.username
    FROM tasks t
    LEFT JOIN users u ON t.user_id = u.id
    WHERE t.id = ?
  `).get(taskId);

  return task;
};

// 兑换码管理
const getTokenList = (options = {}) => {
  const db = getDb();
  const { page = 1, pageSize = 50 } = options;
  const offset = (page - 1) * pageSize;

  const { total } = db.prepare("SELECT COUNT(*) as total FROM tokens").get();

  const tokens = db.prepare(`
    SELECT * FROM tokens ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(pageSize, offset);

  return { tokens, total, page, pageSize };
};

const deleteToken = (token) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM tokens WHERE token = ?").run(token.toUpperCase());
  return result.changes > 0;
};

// 系统设置
const getSettings = () => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM settings").all();
  const settings = {};
  rows.forEach((row) => {
    settings[row.key] = row.value;
  });
  return settings;
};

const updateSettings = (updates) => {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
  `);

  const results = [];
  for (const [key, value] of Object.entries(updates)) {
    const result = stmt.run(key, value, value);
    results.push({ key, value, changes: result.changes });
  }
  return results;
};

module.exports = {
  getUsers,
  getUserById,
  banUser,
  getStats,
  getFeedbackList,
  replyFeedback,
  createFeedback,
  getMyFeedback,
  getPackages,
  createPackage,
  updatePackage,
  deletePackage,
  getSettings,
  updateSettings,
  getAllTasks,
  getTaskDetail,
  getTokenList,
  deleteToken,
};
