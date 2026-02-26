// ============================================================
// server/controllers/authController.js — 认证控制器
// 处理注册、登录、联系方式绑定
// ============================================================

const bcrypt = require("bcryptjs");
const { getDb } = require("../db");
const { signToken } = require("../middleware/auth");
const config = require("../config");

const SALT_ROUNDS = 12;

/** POST /api/auth/register — 极简注册（仅需 username + password） */
async function register(req, res) {
  const { username, password } = req.body;

  // 入参校验
  if (!username || typeof username !== "string" || username.length < 2 || username.length > 32) {
    return res.status(400).json({ error: "用户名需要 2-32 个字符" });
  }
  if (!password || typeof password !== "string" || password.length < 6 || password.length > 128) {
    return res.status(400).json({ error: "密码需要 6-128 个字符" });
  }
  // 用户名格式：字母、数字、下划线、中文
  if (!/^[\w\u4e00-\u9fa5]+$/.test(username)) {
    return res.status(400).json({ error: "用户名只能包含字母、数字、下划线或中文" });
  }

  const db = getDb();

  // 检查用户名是否已存在
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) {
    return res.status(409).json({ error: "用户名已被占用" });
  }

  // bcrypt 加盐哈希（严禁明文存储）
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // 事务：创建用户 + 初始化额度
  const result = db.transaction(() => {
    const info = db.prepare(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)"
    ).run(username, passwordHash);

    const userId = info.lastInsertRowid;

    // 初始化免费额度
    db.prepare(
      "INSERT INTO quotas (user_id, free_quota, paid_quota) VALUES (?, ?, 0)"
    ).run(userId, config.defaultFreeQuota);

    return { id: userId, username };
  })();

  // 颁发 JWT
  const token = signToken(result);

  res.status(201).json({
    token,
    user: {
      id: result.id,
      username: result.username,
      contact_bound: false,
    },
    quota: {
      free: config.defaultFreeQuota,
      paid: 0,
    },
  });
}

/** POST /api/auth/login — 登录 */
async function login(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "请输入用户名和密码" });
  }

  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (!user) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }

  const token = signToken({ id: user.id, username: user.username });
  const quota = db.prepare("SELECT free_quota, paid_quota FROM quotas WHERE user_id = ?").get(user.id);

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      contact_bound: !!user.contact_bound,
      usage_count: user.usage_count,
    },
    quota: {
      free: quota?.free_quota || 0,
      paid: quota?.paid_quota || 0,
    },
  });
}

/** GET /api/auth/me — 获取当前用户信息 */
function getMe(req, res) {
  const db = getDb();
  const user = db.prepare(
    "SELECT id, username, email, phone, contact_bound, usage_count, created_at FROM users WHERE id = ?"
  ).get(req.user.id);

  if (!user) {
    return res.status(401).json({ error: "用户不存在" });
  }

  const quota = db.prepare("SELECT free_quota, paid_quota FROM quotas WHERE user_id = ?").get(user.id);

  res.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      contact_bound: !!user.contact_bound,
      usage_count: user.usage_count,
      created_at: user.created_at,
    },
    quota: {
      free: quota?.free_quota || 0,
      paid: quota?.paid_quota || 0,
    },
  });
}

/** POST /api/auth/bind-contact — 绑定手机或邮箱（渐进式认证） */
function bindContact(req, res) {
  const { email, phone } = req.body;

  if (!email && !phone) {
    return res.status(400).json({ error: "请提供邮箱或手机号" });
  }

  // 简单格式校验
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "邮箱格式不正确" });
  }
  if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ error: "手机号格式不正确" });
  }

  const db = getDb();
  const updates = [];
  const values = [];

  if (email) { updates.push("email = ?"); values.push(email); }
  if (phone) { updates.push("phone = ?"); values.push(phone); }
  updates.push("contact_bound = 1");
  updates.push("updated_at = datetime('now')");
  values.push(req.user.id);

  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);

  res.json({ success: true, message: "联系方式绑定成功" });
}

module.exports = { register, login, getMe, bindContact };
