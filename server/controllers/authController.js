// ============================================================
// server/controllers/authController.js — 认证控制器
// 处理注册、登录、联系方式绑定
// ============================================================

const bcrypt = require("bcryptjs");
const { signToken } = require("../middleware/auth");
const { isValidUsername, isValidPassword, isValidEmail, isValidPhone } = require("../utils/validation");
const { createUser, getUserByUsername, bindUserContact, getUserById } = require("../services/userService");
const { initializeQuota, getUserQuota } = require("../services/quotaService");
const { getUserByInviteCode, processReferral } = require("../services/referralService");
const { getDb } = require("../db");

const SALT_ROUNDS = 12;

/** POST /api/auth/register — 极简注册（仅需 username + password，可选 invite_code） */
async function register(req, res) {
  const { username, password, invite_code } = req.body;

  // 入参校验
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: "用户名需要 2-32 个字符，只能包含字母、数字、下划线或中文" });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: "密码需要 6-128 个字符" });
  }

  // 检查用户名是否已存在
  const existing = getUserByUsername(username);
  if (existing) {
    return res.status(409).json({ error: "用户名已被占用" });
  }

  // bcrypt 加盐哈希（严禁明文存储）
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // 从数据库读取默认免费额度配置
  const db = getDb();
  const quotaSetting = db.prepare("SELECT value FROM settings WHERE key = 'default_free_quota'").get();
  const defaultFreeQuota = quotaSetting ? parseInt(quotaSetting.value, 10) : 3;

  // 事务：创建用户 + 初始化额度
  const result = db.transaction(() => {
    const userId = createUser(username, passwordHash);
    initializeQuota(userId, defaultFreeQuota);
    return { id: userId, username };
  })();

  // 处理邀请关系（事务外，失败不影响注册）
  if (invite_code) {
    const inviter = getUserByInviteCode(invite_code);
    if (inviter) {
      processReferral(inviter.id, result.id, "invite_link");
    }
  }

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
      free: defaultFreeQuota,
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

  const user = getUserByUsername(username);

  if (!user) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }

  const token = signToken({ id: user.id, username: user.username });
  const quota = getUserQuota(user.id);

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
      free: quota.free,
      paid: quota.paid,
    },
  });
}

/** GET /api/auth/me — 获取当前用户信息 */
function getMe(req, res) {
  const user = getUserById(req.user.id);

  if (!user) {
    return res.status(401).json({ error: "用户不存在" });
  }

  const quota = getUserQuota(user.id);

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
      free: quota.free,
      paid: quota.paid,
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
  if (email && !isValidEmail(email)) {
    return res.status(400).json({ error: "邮箱格式不正确" });
  }
  if (phone && !isValidPhone(phone)) {
    return res.status(400).json({ error: "手机号格式不正确" });
  }

  const contact = {};
  if (email) contact.email = email;
  if (phone) contact.phone = phone;

  bindUserContact(req.user.id, contact);

  res.json({ success: true, message: "联系方式绑定成功" });
}

module.exports = { register, login, getMe, bindContact };
