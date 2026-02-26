// ============================================================
// adminController.js — 管理员控制器
// ============================================================

const { getDb } = require("../db");
const adminService = require("../services/adminService");

// 验证是否为管理员
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "未登录" });
  }
  // 检查用户是否为管理员
  const db = getDb();
  const user = db.prepare("SELECT role FROM users WHERE id = ?").get(req.user.id);
  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "需要管理员权限" });
  }
  next();
};

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
    const result = adminService.getUserById(parseInt(req.params.id));
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
    const userId = parseInt(req.params.id);
    const { banned } = req.body;
    adminService.banUser(userId, banned);
    res.json({ success: true, banned });
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
    const id = parseInt(req.params.id);
    adminService.updatePackage(id, req.body);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

const deletePackage = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
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
    next(err);
  }
};

// 分析记录管理
const getAllTasks = async (req, res, next) => {
  try {
    const { page, pageSize, status, search } = req.query;
    const result = adminService.getAllTasks({
      page: parseInt(page) || 1,
      pageSize: parseInt(pageSize) || 20,
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

module.exports = {
  requireAdmin,
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
