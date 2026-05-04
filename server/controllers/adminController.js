// ============================================================
// adminController.js — 管理员控制器
// ============================================================

const path = require("path");
const fs = require("fs");
const { getDb } = require("../db");
const adminService = require("../services/adminService");

// 图片上传目录
const UPLOAD_DIR = path.join(__dirname, "..", "..", "client", "public", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 验证是否为管理员 + 审计日志
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "未登录" });
  }
  // 检查用户是否为管理员
  const db = getDb();
  const user = db.prepare("SELECT role, username FROM users WHERE id = ?").get(req.user.id);
  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "需要管理员权限" });
  }

  // 对写操作记录审计日志（GET 请求不记录，避免日志过多）
  if (req.method !== "GET") {
    const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
    const action = deriveAction(req.method, req.path);
    const targetId = req.params.id || req.params.taskId || req.params.token || null;

    // 使用 res.on('finish') 在请求完成后记录，这样可以捕获完整的请求体
    const bodySnapshot = JSON.stringify(req.body || {});
    res.on("finish", () => {
      try {
        db.prepare(
          `INSERT INTO admin_audit_logs (admin_id, admin_username, action, method, path, ip, target_id, after_value)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(req.user.id, user.username, action, req.method, req.originalUrl, ip, targetId, bodySnapshot);
      } catch (err) {
        console.error("[Audit] 审计日志写入失败:", err.message);
      }
    });
  }

  next();
};

// 根据请求方法和路径推导操作类型
function deriveAction(method, path) {
  if (path.includes("/ban")) return "ban_user";
  if (path.includes("/feedback") && path.includes("/reply")) return "reply_feedback";
  if (path.includes("/packages")) return method === "POST" ? "create_package" : method === "PUT" ? "update_package" : "delete_package";
  if (path.includes("/settings")) return "update_settings";
  if (path.includes("/tokens")) return "delete_token";
  if (path.includes("/users") && method === "DELETE") return "delete_user";
  if (path.includes("/users")) return "manage_user";
  return `${method.toLowerCase()}_operation`;
}

// 用户管理
const getUsers = async (req, res, next) => {
  try {
    const { page, pageSize, search, status } = req.query;
    const result = adminService.getUsers({
      page: parseInt(page) || 1,
      pageSize: parseInt(pageSize) || 20,
      search,
      status,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const getUserById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "用户 ID 非法" });
    const result = adminService.getUserById(id);
    if (!result) {
      return res.status(404).json({ error: "用户不存在" });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const banUser = async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "用户 ID 非法" });
    const { banned } = req.body;
    adminService.banUser(userId, banned);
    res.json({ success: true, banned });
  } catch (err) {
    next(err);
  }
};

// 删除用户
const deleteUser = async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "用户 ID 非法" });
    if (userId === req.user.id) {
      return res.status(400).json({ error: "不能删除自己的账号" });
    }
    const success = adminService.deleteUser(userId);
    if (!success) {
      return res.status(404).json({ error: "用户不存在" });
    }
    res.json({ success: true });
  } catch (err) {
    if (err.message === "不能删除管理员账号") {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
};

// 批量删除用户
const deleteUsers = async (req, res, next) => {
  try {
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: "请提供要删除的用户ID列表" });
    }
    // 过滤掉自己的ID
    const filteredIds = userIds.filter((id) => id !== req.user.id);
    const result = adminService.deleteUsers(filteredIds);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

// 统计数据
const getStats = async (req, res, next) => {
  try {
    const stats = adminService.getStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
};

// 反馈管理
const getFeedbackList = async (req, res, next) => {
  try {
    const { page, pageSize, status } = req.query;
    const result = adminService.getFeedbackList({
      page: parseInt(page) || 1,
      pageSize: parseInt(pageSize) || 20,
      status,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const replyFeedback = async (req, res, next) => {
  try {
    const feedbackId = parseInt(req.params.id);
    const { reply } = req.body;
    if (!reply) {
      return res.status(400).json({ error: "回复内容不能为空" });
    }
    adminService.replyFeedback(feedbackId, reply);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// 用户提交反馈
const createFeedback = async (req, res, next) => {
  try {
    const { type, title, content } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: "标题和内容不能为空" });
    }
    const id = adminService.createFeedback(req.user.id, { type, title, content });
    res.json({ success: true, id });
  } catch (err) {
    next(err);
  }
};

// 我的反馈列表
const getMyFeedback = async (req, res, next) => {
  try {
    const feedback = adminService.getMyFeedback(req.user.id);
    res.json({ feedback });
  } catch (err) {
    next(err);
  }
};

// 套餐管理
const getPackages = async (req, res, next) => {
  try {
    const packages = adminService.getPackages();
    res.json({ packages });
  } catch (err) {
    next(err);
  }
};

const createPackage = async (req, res, next) => {
  try {
    const { name, quota_amount, price_cents, sort_order } = req.body;
    if (!name || !quota_amount || !price_cents) {
      return res.status(400).json({ error: "缺少必要参数" });
    }
    const id = adminService.createPackage({ name, quota_amount, price_cents, sort_order });
    res.json({ success: true, id });
  } catch (err) {
    next(err);
  }
};

const updatePackage = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "套餐 ID 非法" });
    }
    adminService.updatePackage(id, req.body);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

const deletePackage = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "套餐 ID 非法" });
    }
    adminService.deletePackage(id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// 系统设置
const getSettings = async (req, res, next) => {
  try {
    const settings = adminService.getSettings();
    res.json({ settings });
  } catch (err) {
    next(err);
  }
};

const updateSettings = async (req, res, next) => {
  try {
    const results = adminService.updateSettings(req.body);
    res.json({ success: true, results });
  } catch (err) {
    if (err.message && (err.message.startsWith("不允许修改设置项") || err.message.includes("settings 必须") || err.message.includes("类型非法"))) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
};

// 分析记录管理
const getAllTasks = async (req, res, next) => {
  try {
    const { page, pageSize, status, search } = req.query;
    // M12: 严格 clamp pageSize，避免 ?pageSize=99999999 触发 OOM
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safePageSize = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    const result = adminService.getAllTasks({
      page: safePage,
      pageSize: safePageSize,
      status,
      search,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const getTaskDetail = async (req, res, next) => {
  try {
    const task = adminService.getTaskDetail(req.params.taskId);
    if (!task) {
      return res.status(404).json({ error: "任务不存在" });
    }
    res.json({ task });
  } catch (err) {
    next(err);
  }
};

// 兑换码管理
const getTokenList = async (req, res, next) => {
  try {
    const { page, pageSize } = req.query;
    const result = adminService.getTokenList({
      page: parseInt(page) || 1,
      pageSize: parseInt(pageSize) || 50,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const deleteToken = async (req, res, next) => {
  try {
    const { token } = req.params;
    const success = adminService.deleteToken(token);
    if (!success) {
      return res.status(404).json({ error: "兑换码不存在" });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// 审计日志查询
const getAuditLogs = async (req, res, next) => {
  try {
    const { page, pageSize, action, admin_id } = req.query;
    const db = getDb();
    const limit = parseInt(pageSize) || 50;
    const offset = ((parseInt(page) || 1) - 1) * limit;

    let where = "1=1";
    const params = [];
    if (action) { where += " AND action = ?"; params.push(action); }
    if (admin_id) { where += " AND admin_id = ?"; params.push(parseInt(admin_id)); }

    const total = db.prepare(`SELECT COUNT(*) as count FROM admin_audit_logs WHERE ${where}`).get(...params).count;
    const logs = db.prepare(`SELECT * FROM admin_audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

    res.json({ logs, total, page: parseInt(page) || 1, pageSize: limit });
  } catch (err) {
    next(err);
  }
};

// ── 站点内容管理 ──

// 获取站点内容（公开接口，无需管理员权限）
const getSiteContent = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const db = getDb();
    const content = db.prepare("SELECT * FROM site_content WHERE slug = ?").get(slug);
    if (!content) {
      return res.json({ slug, title: "", body: "", images: [] });
    }
    res.json({
      ...content,
      images: JSON.parse(content.images || "[]"),
    });
  } catch (err) {
    next(err);
  }
};

// 更新站点内容（管理员）
const updateSiteContent = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { title, body } = req.body;
    const db = getDb();

    const existing = db.prepare("SELECT id FROM site_content WHERE slug = ?").get(slug);
    if (existing) {
      db.prepare(
        "UPDATE site_content SET title = ?, body = ?, updated_at = datetime('now') WHERE slug = ?"
      ).run(title || "", body || "", slug);
    } else {
      db.prepare(
        "INSERT INTO site_content (slug, title, body) VALUES (?, ?, ?)"
      ).run(slug, title || "", body || "");
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// 上传站点内容图片（管理员，最多5张）
const SAFE_SLUG = /^[a-zA-Z0-9_-]{1,64}$/;
const uploadSiteImage = async (req, res, next) => {
  try {
    const { slug } = req.params;
    if (!SAFE_SLUG.test(slug || "")) {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
      return res.status(400).json({ error: "slug 非法" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "请上传图片文件" });
    }

    const db = getDb();
    const content = db.prepare("SELECT images FROM site_content WHERE slug = ?").get(slug);
    const images = content ? JSON.parse(content.images || "[]") : [];

    if (images.length >= 5) {
      // 删除上传的临时文件
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "最多上传 5 张图片" });
    }

    // 校验扩展名白名单 + magic bytes（H6）
    const ALLOWED_IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
    const rawExt = (path.extname(req.file.originalname) || ".png").toLowerCase();
    const ext = ALLOWED_IMG_EXT.has(rawExt) ? rawExt : null;
    if (!ext) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: "仅支持 PNG/JPG/GIF/WEBP 图片" });
    }
    try {
      const fd = fs.openSync(req.file.path, "r");
      const head = Buffer.alloc(12);
      fs.readSync(fd, head, 0, 12, 0);
      fs.closeSync(fd);
      const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
      const isJpg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
      const isGif = head.slice(0, 6).toString("ascii") === "GIF87a" || head.slice(0, 6).toString("ascii") === "GIF89a";
      const isWebp = head.slice(0, 4).toString("ascii") === "RIFF" && head.slice(8, 12).toString("ascii") === "WEBP";
      if (!isPng && !isJpg && !isGif && !isWebp) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ error: "图片内容校验失败" });
      }
    } catch (e) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: "图片读取失败" });
    }

    // 移动文件到 uploads 目录（文件名仅由服务端生成，不含原文件名）
    const filename = `site_${slug}_${Date.now()}${ext}`;
    const destPath = path.join(UPLOAD_DIR, filename);
    fs.renameSync(req.file.path, destPath);

    const imageUrl = `/uploads/${filename}`;
    images.push(imageUrl);

    if (content) {
      db.prepare(
        "UPDATE site_content SET images = ?, updated_at = datetime('now') WHERE slug = ?"
      ).run(JSON.stringify(images), slug);
    } else {
      db.prepare(
        "INSERT INTO site_content (slug, images) VALUES (?, ?)"
      ).run(slug, JSON.stringify(images));
    }

    res.json({ success: true, imageUrl, images });
  } catch (err) {
    next(err);
  }
};

// 删除站点内容图片（管理员）
const deleteSiteImage = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { imageUrl } = req.body;
    if (!imageUrl) {
      return res.status(400).json({ error: "请指定要删除的图片" });
    }

    const db = getDb();
    const content = db.prepare("SELECT images FROM site_content WHERE slug = ?").get(slug);
    if (!content) {
      return res.status(404).json({ error: "内容不存在" });
    }

    const images = JSON.parse(content.images || "[]").filter((img) => img !== imageUrl);
    db.prepare(
      "UPDATE site_content SET images = ?, updated_at = datetime('now') WHERE slug = ?"
    ).run(JSON.stringify(images), slug);

    // 删除文件
    const filename = path.basename(imageUrl);
    const filePath = path.join(UPLOAD_DIR, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({ success: true, images });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  requireAdmin,
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
  getTaskDetail,
  getTokenList,
  deleteToken,
  getAuditLogs,
  getSiteContent,
  updateSiteContent,
  uploadSiteImage,
  deleteSiteImage,
};
