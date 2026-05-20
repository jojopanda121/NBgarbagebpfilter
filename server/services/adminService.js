// ============================================================
// adminService.js — 管理员服务层
// ============================================================

const { getDb } = require("../db");
const { buildVipSelectFragment } = require("../utils/userPlan");

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

  // 动态检测 last_login_at 列
  const hasLastLogin = tableInfo.some((col) => col.name === "last_login_at");
  const lastLoginSelect = hasLastLogin ? "u.last_login_at," : "NULL as last_login_at,";

  // 获取列表 - 使用条件列名和参数化查询
  const isBannedSelect = hasBanned ? "u.is_banned," : "0 as is_banned,";
  const { vipSelect } = buildVipSelectFragment(db, "u");
  const listQuery = `
    SELECT
      u.id, u.username, u.email, u.phone, u.usage_count, ${isBannedSelect} ${vipSelect} ${lastLoginSelect} u.contact_bound, u.created_at, u.updated_at,
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

  // 动态检测列
  const tableInfo = db.prepare("PRAGMA table_info(users)").all();
  const hasBanned = tableInfo.some((col) => col.name === "is_banned");
  const hasLastLogin = tableInfo.some((col) => col.name === "last_login_at");
  const isBannedSelect = hasBanned ? "u.is_banned," : "0 as is_banned,";
  const lastLoginSelect = hasLastLogin ? "u.last_login_at," : "NULL as last_login_at,";

  const user = db.prepare(`
    SELECT
      u.id, u.username, u.email, u.phone, u.usage_count, ${isBannedSelect} ${lastLoginSelect} u.contact_bound, u.created_at, u.updated_at,
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

  // 评分等级分布（M4: 用 SQLite json_extract 在 DB 层聚合，避免把全部 result JSON 加载到内存）
  let gradeDist = [];
  try {
    const rows = db.prepare(`
      SELECT json_extract(result, '$.verdict.grade') AS grade, COUNT(*) AS count
      FROM tasks
      WHERE status = 'complete' AND result IS NOT NULL
      GROUP BY grade
    `).all();
    const gradeCount = { A: 0, B: 0, C: 0, D: 0 };
    for (const row of rows) {
      if (row.grade && gradeCount[row.grade] !== undefined) {
        gradeCount[row.grade] = row.count;
      }
    }
    gradeDist = Object.entries(gradeCount).map(([grade, count]) => ({ grade, count }));
  } catch (_) { /* ignore — older SQLite without JSON1 extension */ }

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

// 仅允许这些字段被白名单修改，防止任意列注入
const PACKAGE_UPDATABLE_FIELDS = ["name", "quota_amount", "price_cents", "is_active", "sort_order"];

const updatePackage = (id, data) => {
  const db = getDb();
  const fields = [];
  const params = [];

  for (const key of PACKAGE_UPDATABLE_FIELDS) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(data[key]);
    }
  }

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
// 列表只选必要的元数据列；不要 SELECT *，因为 result / onepager_cache / imemo_cache /
// dd_questionnaire / dd_answers 是大 JSON，一页 20 条全拉会拖慢到几 MB 响应。
const TASK_LIST_COLUMNS = [
  "t.id",
  "t.archive_number",
  "t.user_id",
  "t.status",
  "t.percentage",
  "t.stage",
  "t.message",
  "t.title",
  "t.industry_category",
  "t.total_score",
  "t.project_stage",
  "t.project_location",
  "t.file_role",
  "t.deleted_at",
  "t.created_at",
  "t.updated_at",
];

// 排序字段白名单，防止注入
const TASK_SORT_FIELDS = new Set([
  "created_at",
  "updated_at",
  "total_score",
  "percentage",
  "status",
]);

const getAllTasks = (options = {}) => {
  const db = getDb();
  const {
    page = 1,
    pageSize = 20,
    status = "",
    search = "",
    startDate = "",
    endDate = "",
    industry = "",
    sortBy = "created_at",
    sortDir = "desc",
  } = options;
  const offset = (page - 1) * pageSize;

  let whereClause = "1=1";
  const params = [];

  if (status) {
    whereClause += " AND t.status = ?";
    params.push(status);
  }

  if (search) {
    whereClause += " AND (u.username LIKE ? OR t.id LIKE ? OR t.archive_number LIKE ? OR t.title LIKE ?)";
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  // 日期范围（按本地日期，闭区间）
  if (startDate) {
    whereClause += " AND DATE(t.created_at) >= DATE(?)";
    params.push(startDate);
  }
  if (endDate) {
    whereClause += " AND DATE(t.created_at) <= DATE(?)";
    params.push(endDate);
  }

  if (industry) {
    whereClause += " AND t.industry_category = ?";
    params.push(industry);
  }

  const sortField = TASK_SORT_FIELDS.has(sortBy) ? sortBy : "created_at";
  const sortDirection = String(sortDir).toLowerCase() === "asc" ? "ASC" : "DESC";

  const countQuery = `SELECT COUNT(*) as total FROM tasks t LEFT JOIN users u ON t.user_id = u.id WHERE ${whereClause}`;
  const { total } = db.prepare(countQuery).get(...params);

  const listQuery = `
    SELECT ${TASK_LIST_COLUMNS.join(", ")}, u.username
    FROM tasks t
    LEFT JOIN users u ON t.user_id = u.id
    WHERE ${whereClause}
    ORDER BY t.${sortField} ${sortDirection}
    LIMIT ? OFFSET ?
  `;
  const tasks = db.prepare(listQuery).all(...params, pageSize, offset);

  return { tasks, total, page, pageSize };
};

// 行业分类下拉选项（去重，按出现频次排序）
const getTaskIndustries = () => {
  const db = getDb();
  try {
    return db.prepare(`
      SELECT industry_category as category, COUNT(*) as count
      FROM tasks
      WHERE industry_category IS NOT NULL AND industry_category != ''
      GROUP BY industry_category
      ORDER BY count DESC
    `).all();
  } catch (_) {
    return [];
  }
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

// 系统设置白名单（H7）：仅允许这些键被前端修改，防止越权写入任意配置
const ALLOWED_SETTING_KEYS = new Set([
  "default_free_quota",
  "verification_max_attempts",
  "verification_code_expire_seconds",
  "default_paid_quota",
  "site_title",
  "site_announcement",
  "referral_reward_inviter",
  "referral_reward_invitee",
  "task_retain_days",
  "share_link_ttl_hours",
]);

const updateSettings = (updates) => {
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    throw new Error("settings 必须是对象");
  }
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
  `);

  const results = [];
  for (const [key, rawValue] of Object.entries(updates)) {
    if (!ALLOWED_SETTING_KEYS.has(key)) {
      throw new Error(`不允许修改设置项: ${key}`);
    }
    if (rawValue !== null && typeof rawValue !== "string" && typeof rawValue !== "number" && typeof rawValue !== "boolean") {
      throw new Error(`设置 ${key} 的值类型非法`);
    }
    const value = rawValue == null ? "" : String(rawValue);
    const result = stmt.run(key, value, value);
    results.push({ key, value, changes: result.changes });
  }
  return results;
};

/**
 * 删除用户（及其关联数据）
 * @param {number} userId
 * @returns {boolean}
 */
const deleteUser = (userId) => {
  const db = getDb();

  // 不允许删除管理员
  const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  if (!user) return false;
  if (user.role === "admin") {
    throw new Error("不能删除管理员账号");
  }

  db.transaction(() => {
    db.prepare("DELETE FROM quotas WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM referrals WHERE inviter_id = ? OR invitee_id = ?").run(userId, userId);
    db.prepare("DELETE FROM verification_codes WHERE contact IN (SELECT email FROM users WHERE id = ?)").run(userId);
    // tasks 和 orders 保留历史记录，只解除关联
    db.prepare("UPDATE tasks SET user_id = NULL WHERE user_id = ?").run(userId);
    db.prepare("UPDATE orders SET user_id = NULL WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  })();

  return true;
};

/**
 * 批量删除用户
 * @param {number[]} userIds
 * @returns {{ deleted: number, skipped: number }}
 */
const deleteUsers = (userIds) => {
  let deleted = 0;
  let skipped = 0;

  for (const userId of userIds) {
    try {
      const success = deleteUser(userId);
      if (success) deleted++;
      else skipped++;
    } catch {
      skipped++;
    }
  }

  return { deleted, skipped };
};

module.exports = {
  getUsers,
  getUserById,
  banUser,
  deleteUser,
  deleteUsers,
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
  getTaskIndustries,
  getTaskDetail,
  getTokenList,
  deleteToken,
};
