// ============================================================
// server/controllers/analyzeController.js — 分析控制器
// ============================================================

const fs = require("fs");
const crypto = require("crypto");
const { getDb } = require("../db");
const { extractDocText } = require("../services/extractionService");
const { runPipeline } = require("../services/pipelineService");
const { createTask, updateTask } = require("../services/taskService");
const { deductQuota, refundQuota } = require("../middleware/quota");

/** 计算文件内容的 SHA256 哈希 */
function computeFileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

/** 查找同一用户已完成的相同文件分析结果 */
function findExistingResult(userId, fileHash) {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT id, result FROM tasks WHERE user_id = ? AND file_hash = ? AND status = 'complete' ORDER BY created_at DESC LIMIT 1"
    ).get(userId, fileHash);
    if (row && row.result) {
      try { row.result = JSON.parse(row.result); } catch {}
      return row;
    }
  } catch {}
  return null;
}

/** 查找同一用户正在运行中的相同文件分析任务 */
function findRunningTask(userId, fileHash) {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT id FROM tasks WHERE user_id = ? AND file_hash = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1"
    ).get(userId, fileHash);
    return row || null;
  } catch {}
  return null;
}

/** POST /api/analyze — 上传文件并启动分析 */
function analyze(req, res) {
  // 输入验证
  if (!req.file && !(req.body && req.body.text)) {
    return res.status(400).json({ error: "请上传 PDF 文件或提供文本" });
  }

  if (req.file) {
    const mime = req.file.mimetype || "";
    const name = (req.file.originalname || "").toLowerCase();
    const isPdf = mime === "application/pdf" || name.endsWith(".pdf");
    const isPptx = mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || name.endsWith(".pptx");
    if (!isPdf && !isPptx) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "请上传 PDF 或 PPTX 格式的文件" });
    }
  }

  // 扣减额度（原子操作）；管理员无限次使用，跳过扣减
  const userId = req.user?.id || null;
  let isAdmin = false;
  if (userId) {
    const db = getDb();
    const userRow = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
    isAdmin = userRow?.role === "admin";
  }

  // 文件去重：计算哈希，检查是否有已完成的相同文件结果
  let fileHash = null;
  if (req.file) {
    try {
      fileHash = computeFileHash(req.file.path);
      if (userId && fileHash) {
        // 检查是否有正在运行中的相同文件任务
        const running = findRunningTask(userId, fileHash);
        if (running) {
          // 相同文件正在分析中，直接返回已有的 taskId（不扣额度）
          fs.unlink(req.file.path, () => {});
          return res.json({ taskId: running.id, cached: false, resuming: true });
        }

        const existing = findExistingResult(userId, fileHash);
        if (existing) {
          // 相同文件已分析过，直接返回之前的结果（不扣额度）
          fs.unlink(req.file.path, () => {});
          // 创建一个新任务记录指向旧结果，方便历史记录追踪
          const task = createTask(userId);
          updateTask(task.id, {
            status: "complete",
            percentage: 100,
            stage: "complete",
            message: "检测到相同文件，已复用之前的分析结果",
            result: existing.result,
            file_hash: fileHash,
          });
          return res.json({ taskId: task.id, cached: true });
        }
      }
    } catch {}
  }

  if (!isAdmin && userId) {
    const deductResult = deductQuota(userId);
    if (!deductResult.success) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(403).json({
        error: "额度不足，请充值",
        code: 4032,
        require_payment: true,
      });
    }
  }

  // 创建任务并立即返回
  const task = createTask(userId);
  // 提前写入 file_hash，这样重复文件检测能发现正在分析中的任务
  if (fileHash) {
    try { updateTask(task.id, { file_hash: fileHash }); } catch {}
  }
  res.json({ taskId: task.id });

  // 后台异步执行
  const filePath = req.file ? req.file.path : null;
  const fileMode = req.file
    ? ((req.file.originalname || "").toLowerCase().endsWith(".pptx") ? "pptx" : "pdf")
    : null;
  const directText = req.body?.text || null;

  (async () => {
    let bpText = "";
    try {
      if (filePath) {
        try {
          bpText = await extractDocText(filePath, fileMode);
        } catch (pyErr) {
          const errMsg = pyErr.message || "未知错误";
          let userMessage = errMsg;
          try {
            const p = JSON.parse(errMsg);
            if (p.error) userMessage = p.error;
          } catch {}
          throw new Error("文档解析失败: " + userMessage);
        } finally {
          try { fs.unlinkSync(filePath); } catch {}
        }
      } else {
        bpText = directText;
      }

      if (!bpText || bpText.length < 50) {
        throw new Error("提取的文本过短（仅 " + (bpText?.length || 0) + " 字符），请检查文件");
      }

      const onProgress = ({ type, stage, percentage, message }) => {
        if (type === "progress") updateTask(task.id, { stage, percentage, message });
      };

      const result = await runPipeline(bpText, onProgress);

      // 保存额外的任务元数据（title, industry_category, client_ip, file_hash）
      const extraFields = {
        status: "complete",
        percentage: 100,
        stage: "complete",
        message: "分析完成！",
        result,
      };

      // 安全写入新字段（列可能尚未通过迁移创建）
      try {
        if (result.title) extraFields.title = result.title;
        // 多标签分类：以 JSON 数组存储
        if (result.industry_categories) {
          extraFields.industry_category = JSON.stringify(result.industry_categories);
        } else if (result.industry_category) {
          extraFields.industry_category = result.industry_category;
        }
        if (fileHash) extraFields.file_hash = fileHash;
        // total_score 独立字段（便于排行榜查询）
        if (result.verdict?.total_score != null) {
          extraFields.total_score = result.verdict.total_score;
        }
        // 项目所在地
        if (result.project_location) {
          extraFields.project_location = result.project_location;
        }
        // 获取客户端 IP
        const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || req.socket?.remoteAddress;
        if (clientIp) extraFields.client_ip = clientIp;
      } catch (_) { /* ignore - new columns may not exist yet */ }

      updateTask(task.id, extraFields);
    } catch (err) {
      console.error(`[任务 ${task.id.slice(0, 8)}] 错误:`, err.message);
      updateTask(task.id, { status: "error", error: err.message || "服务器内部错误" });
      // 分析失败时退还额度（管理员无需退还）
      if (userId && !isAdmin) {
        refundQuota(userId);
      }
    }
  })();
}

module.exports = { analyze };
