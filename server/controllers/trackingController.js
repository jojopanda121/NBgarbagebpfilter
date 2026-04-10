// ============================================================
// trackingController.js — 追踪数据看板控制器（管理员专用）
// ============================================================

const trackingService = require("../services/trackingService");
const qccService = require("../services/qccService");
const logger = require("../utils/logger");

/**
 * GET /api/admin/tracking/dashboard
 * 获取追踪仪表板汇总数据
 */
const getDashboard = (req, res) => {
  try {
    const data = trackingService.getTrackingDashboardData();
    res.json({ success: true, data });
  } catch (err) {
    logger.error("获取追踪仪表板失败", { error: err.message });
    res.status(500).json({ error: "获取仪表板数据失败" });
  }
};

/**
 * GET /api/admin/tracking/companies
 * 获取所有企业实体列表（支持分页和筛选）
 */
const getCompanies = (req, res) => {
  try {
    const { getDb } = require("../db");
    const db = getDb();
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const status = req.query.status || null;
    const search = req.query.search || null;
    const offset = (page - 1) * pageSize;

    let where = "1=1";
    const params = [];

    if (status) {
      where += " AND current_status = ?";
      params.push(status);
    }
    if (search) {
      where += " AND (company_name LIKE ? OR industry_tags LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    const total = db.prepare(
      `SELECT COUNT(*) as count FROM company_entities WHERE ${where}`
    ).get(...params).count;

    const companies = db.prepare(
      `SELECT ce.*,
              (SELECT COUNT(*) FROM bp_company_links WHERE company_id = ce.id) as bp_count,
              (SELECT COUNT(*) FROM company_snapshots WHERE company_id = ce.id) as snapshot_count,
              (SELECT MAX(snapshot_date) FROM company_snapshots WHERE company_id = ce.id) as last_snapshot_date
       FROM company_entities ce
       WHERE ${where}
       ORDER BY ce.created_at DESC
       LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset);

    res.json({ success: true, data: companies, total, page, pageSize });
  } catch (err) {
    logger.error("获取企业列表失败", { error: err.message });
    res.status(500).json({ error: "获取企业列表失败" });
  }
};

/**
 * GET /api/admin/tracking/companies/:id
 * 获取单个企业详情（含快照和验证记录）
 */
const getCompanyDetail = (req, res) => {
  try {
    const { getDb } = require("../db");
    const db = getDb();
    const companyId = req.params.id;

    const company = db.prepare("SELECT * FROM company_entities WHERE id = ?").get(companyId);
    if (!company) {
      return res.status(404).json({ error: "企业不存在" });
    }

    const snapshots = db.prepare(
      "SELECT * FROM company_snapshots WHERE company_id = ? ORDER BY snapshot_date DESC LIMIT 20"
    ).all(companyId);

    const bpLinks = db.prepare(
      "SELECT * FROM bp_company_links WHERE company_id = ? ORDER BY analysis_date DESC"
    ).all(companyId);

    const validations = db.prepare(
      "SELECT * FROM prediction_validations WHERE company_id = ? ORDER BY validation_date DESC"
    ).all(companyId);

    res.json({
      success: true,
      data: { company, snapshots, bp_links: bpLinks, validations },
    });
  } catch (err) {
    logger.error("获取企业详情失败", { error: err.message, companyId: req.params.id });
    res.status(500).json({ error: "获取企业详情失败" });
  }
};

/**
 * POST /api/admin/tracking/companies/:id/toggle
 * 切换企业追踪状态
 */
const toggleTracking = (req, res) => {
  try {
    const { getDb } = require("../db");
    const db = getDb();
    const companyId = req.params.id;

    const company = db.prepare("SELECT tracking_enabled FROM company_entities WHERE id = ?").get(companyId);
    if (!company) {
      return res.status(404).json({ error: "企业不存在" });
    }

    const newStatus = company.tracking_enabled ? 0 : 1;
    db.prepare("UPDATE company_entities SET tracking_enabled = ? WHERE id = ?").run(newStatus, companyId);

    res.json({ success: true, tracking_enabled: !!newStatus });
  } catch (err) {
    logger.error("切换追踪状态失败", { error: err.message });
    res.status(500).json({ error: "操作失败" });
  }
};

/**
 * POST /api/admin/tracking/run-quarterly
 * 手动触发季度追踪批处理
 */
const runQuarterlyTracking = async (req, res) => {
  try {
    const stats = await trackingService.runQuarterlyTracking();
    res.json({ success: true, stats });
  } catch (err) {
    logger.error("季度追踪执行失败", { error: err.message });
    res.status(500).json({ error: "季度追踪执行失败：" + err.message });
  }
};

/**
 * GET /api/admin/tracking/export
 * 导出训练数据
 */
const exportTrainingData = (req, res) => {
  try {
    const months = parseInt(req.query.months) || 12;
    const data = trackingService.exportTrainingData(months);

    // 如果请求 JSON 格式
    if (req.query.format === "json") {
      res.setHeader("Content-Disposition", `attachment; filename=training_data_${Date.now()}.json`);
      res.setHeader("Content-Type", "application/json");
      return res.json(data);
    }

    // 默认返回 JSONL 格式（微调常用）
    res.setHeader("Content-Disposition", `attachment; filename=training_data_${Date.now()}.jsonl`);
    res.setHeader("Content-Type", "application/x-ndjson");
    const lines = data.map((row) => JSON.stringify(row)).join("\n");
    res.send(lines);
  } catch (err) {
    logger.error("训练数据导出失败", { error: err.message });
    res.status(500).json({ error: "导出失败" });
  }
};

/**
 * GET /api/admin/tracking/validations
 * 获取预测验证列表（回测数据）
 */
const getValidations = (req, res) => {
  try {
    const { getDb } = require("../db");
    const db = getDb();
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;

    const total = db.prepare("SELECT COUNT(*) as count FROM prediction_validations").get().count;

    const validations = db.prepare(
      `SELECT pv.*, ce.company_name
       FROM prediction_validations pv
       JOIN company_entities ce ON pv.company_id = ce.id
       ORDER BY pv.validation_date DESC
       LIMIT ? OFFSET ?`
    ).all(pageSize, offset);

    res.json({ success: true, data: validations, total, page, pageSize });
  } catch (err) {
    logger.error("获取验证列表失败", { error: err.message });
    res.status(500).json({ error: "获取验证列表失败" });
  }
};

/**
 * GET /api/admin/tracking/qcc-status
 * 获取企查查服务状态
 */
const getQCCStatus = (req, res) => {
  res.json({
    success: true,
    enabled: qccService.isEnabled(),
  });
};

module.exports = {
  getDashboard,
  getCompanies,
  getCompanyDetail,
  toggleTracking,
  runQuarterlyTracking,
  exportTrainingData,
  getValidations,
  getQCCStatus,
};
