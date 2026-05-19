// ============================================================
// server/controllers/authController.js — 认证控制器
// 处理注册、登录、联系方式绑定
// ============================================================

const bcrypt = require("bcryptjs");
const { signToken, revokeToken } = require("../middleware/auth");
const { isValidUsername, isValidPassword, isValidEmail } = require("../utils/validation");
const { createUser, getUserByUsername, bindUserContact, getUserById, getUserByEmail, updateLastLogin, updateUserPassword } = require("../services/userService");
const { initializeQuota, getUserQuota } = require("../services/quotaService");
const { getUserByInviteCode, processReferral, rewardReferral } = require("../services/referralService");
const { sendEmailCode, verifyEmailCode, canSendEmailCode } = require("../services/emailService");
const { getDb } = require("../db");

const SALT_ROUNDS = 12;

/** POST /api/auth/register — 极简注册（仅需 username + password，可选 invite_code） */
async function register(req, res) {
  try {
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
    // M3: 用 try/catch 包裹，避免抛错冒泡到外层 catch 误报"注册失败"
    if (invite_code) {
      try {
        const inviter = getUserByInviteCode(invite_code);
        if (inviter) {
          processReferral(inviter.id, result.id, "invite_link");
        }
      } catch (refErr) {
        console.warn("[Register] 邀请关系处理失败（不影响注册）:", refErr && refErr.message);
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
        role: "user",
        usage_count: 0,
      },
      quota: {
        free: defaultFreeQuota,
        paid: 0,
      },
    });
  } catch (err) {
    console.error("[Register Error]", err);
    res.status(500).json({ error: "注册失败，请稍后再试" });
  }
}

/** POST /api/auth/login — 登录 */
async function login(req, res) {
  try {
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

    if (user.is_banned) {
      return res.status(403).json({ error: "账号已被封禁，请联系管理员" });
    }

    // 记录最后登录时间
    updateLastLogin(user.id);

    const token = signToken({ id: user.id, username: user.username });
    const quota = getUserQuota(user.id);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        contact_bound: !!user.contact_bound,
        usage_count: user.usage_count || 0,
        role: user.role || "user",
      },
      quota: {
        free: quota.free,
        paid: quota.paid,
      },
    });
  } catch (err) {
    console.error("[Login Error]", err);
    res.status(500).json({ error: "登录失败，请稍后再试" });
  }
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
      contact_bound: !!user.contact_bound,
      usage_count: user.usage_count || 0,
      role: user.role || "user",
      created_at: user.created_at,
    },
    quota: {
      free: quota.free,
      paid: quota.paid,
    },
  });
}

/** POST /api/auth/bind-contact — 绑定邮箱（渐进式认证） */
function bindContact(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "请提供邮箱地址" });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "邮箱格式不正确" });
  }

  // 检查邮箱是否已被其他用户绑定
  const db = getDb();
  const existingUser = db.prepare(
    "SELECT id FROM users WHERE email = ? AND id != ?"
  ).get(email, req.user.id);
  if (existingUser) {
    return res.status(409).json({ error: "该邮箱已被其他账号绑定" });
  }

  bindUserContact(req.user.id, { email });

  // 绑定邮箱后，才给邀请人发放奖励（防止批量注册刷额度）
  rewardReferral(req.user.id);

  res.json({ success: true, message: "邮箱绑定成功" });
}

/** POST /api/auth/forgot-password — 发送密码重置验证码 */
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "请输入邮箱地址" });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "邮箱格式不正确" });
    }

    // 检查邮箱是否已绑定用户
    const user = getUserByEmail(email);
    if (!user) {
      // 为防止邮箱枚举攻击，统一返回成功提示
      return res.json({ success: true, message: "如果该邮箱已绑定账号，验证码将发送至该邮箱" });
    }

    if (!canSendEmailCode(email)) {
      return res.status(429).json({ error: "发送过于频繁，请 1 分钟后再试" });
    }

    await sendEmailCode(email);
    res.json({ success: true, message: "验证码已发送至您的邮箱" });
  } catch (err) {
    console.error("[ForgotPassword Error]", err);
    res.status(500).json({ error: "发送失败，请稍后再试" });
  }
}

/** POST /api/auth/reset-password — 验证码验证 + 重置密码 */
async function resetPassword(req, res) {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: "请填写完整信息" });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "邮箱格式不正确" });
    }

    if (!isValidPassword(newPassword)) {
      return res.status(400).json({ error: "新密码需要 6-128 个字符" });
    }

    // 验证验证码
    const valid = verifyEmailCode(email, code);
    if (!valid) {
      return res.status(400).json({ error: "验证码错误或已过期" });
    }

    // 查找用户
    const user = getUserByEmail(email);
    if (!user) {
      return res.status(400).json({ error: "该邮箱未绑定任何账号" });
    }

    // 更新密码
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    updateUserPassword(user.id, passwordHash);

    res.json({ success: true, message: "密码重置成功，请使用新密码登录" });
  } catch (err) {
    console.error("[ResetPassword Error]", err);
    res.status(500).json({ error: "密码重置失败，请稍后再试" });
  }
}

/** POST /api/auth/logout — 登出，吊销当前 token */
function logout(req, res) {
  try {
    if (req.user?.jti) {
      revokeToken(req.user.jti, req.user.id, req.user.exp);
    }
  } catch (err) {
    console.warn("[Logout] revoke error:", err.message);
  }
  res.json({ success: true });
}

module.exports = { register, login, getMe, bindContact, forgotPassword, resetPassword, logout };
