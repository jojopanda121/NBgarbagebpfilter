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
const { PIPELINE_VERSION } = require("../config/versions");
const inflightTasks = require("../runtime/inflightTasks");

/** 计算文件内容的 SHA256 哈希（流式，避免 readFileSync 大文件阻塞事件循环） */
function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Magic number 校验：扩展名/MIME 可伪造，读文件头交叉验证真实格式。
 *   PDF        → "%PDF"
 *   PPTX/DOCX  → OOXML 均为 ZIP 容器，局部文件头 "PK\x03\x04"
 *   DOC        → CFB 容器头 D0 CF 11 E0
 */
async function verifyFileMagic(filePath, fileMode) {
  const fd = await fs.promises.open(filePath, "r");
  try {
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fd.read(buf, 0, 4, 0);
    if (bytesRead < 4) return false;
    if (fileMode === "pdf") return buf.toString("latin1") === "%PDF";
    // pptx / docx 都是 ZIP 容器
    if (fileMode === "pptx" || fileMode === "docx") {
      return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
    }
    if (fileMode === "doc") {
      return buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
    }
    return false;
  } finally {
    await fd.close();
  }
}

function buildAnalysisFallbackText({ filePath, fileMode, originalName, fileSize, reason, extractedText }) {
  let size = 0;
  if (Number.isFinite(Number(fileSize))) {
    size = Number(fileSize);
  } else {
    try { size = filePath ? fs.statSync(filePath).size : 0; } catch (_) { /* ignore */ }
  }
  const lines = [
    "【上传材料解析结果】",
    `文件名：${originalName || "document"}`,
    `文件格式：${fileMode || "text"}`,
    `文件大小：${size} 字节`,
    `解析提示：${reason || "自动解析只能取得有限文本。"}`,
    "系统已接收该文件，但自动解析得到的正文有限。请基于已提取片段、文件名和材料类型谨慎分析；不要声称已读取到文件中未实际提取出的具体事实。",
  ];
  if (extractedText && String(extractedText).trim()) {
    lines.push("【已提取片段】", String(extractedText).trim().slice(0, 1000));
  }
  return lines.join("\n");
}

/**
 * 查找同一用户已完成的相同文件分析结果。
 * 仅复用 pipeline_version 与当前一致的结果——算法/prompt/模型升级后旧结果作废。
 */
function findExistingResult(db, userId, fileHash) {
  const row = db.prepare(
    "SELECT id, result FROM tasks WHERE user_id = ? AND file_hash = ? AND status = 'complete' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1"
  ).get(userId, fileHash);
  if (!row || !row.result) return null;
  let parsed;
  try {
    parsed = JSON.parse(row.result);
  } catch (e) {
    console.warn("[Analyze] Failed to parse cached result JSON:", e.message);
    return null; // 解析不了的结果不复用
  }
  if (parsed?.pipeline_version !== PIPELINE_VERSION) return null; // 版本不一致不复用
  return { id: row.id, result: parsed };
}

/** 查找同一用户正在运行中的相同文件分析任务 */
function findRunningTask(db, userId, fileHash) {
  return db.prepare(
    "SELECT id FROM tasks WHERE user_id = ? AND file_hash = ? AND status = 'running' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1"
  ).get(userId, fileHash) || null;
}

/**
 * 准入事务：去重检查 → 扣额度 → 建任务（含 file_hash），单事务原子执行。
 * 消除"并发上传同文件双扣额度 / 扣了额度任务没建出来"两类竞态。
 *
 * @returns {{ kind: "resuming"|"cached"|"no_quota"|"created", ... }}
 */
function admitAnalysis({ userId, isAdmin, fileHash }) {
  const db = getDb();
  return db.transaction(() => {
    if (userId && fileHash) {
      const running = findRunningTask(db, userId, fileHash);
      if (running) return { kind: "resuming", taskId: running.id };

      const existing = findExistingResult(db, userId, fileHash);
      if (existing) return { kind: "cached", existing };
    }

    let quotaDeductType = null;
    if (!isAdmin && userId) {
      const deductResult = deductQuota(userId); // 内部事务 → 此处自动降级为 savepoint
      if (!deductResult.success) return { kind: "no_quota" };
      quotaDeductType = deductResult.type; // "free" 或 "paid"
    }

    const task = createTask(userId);
    if (fileHash) {
      db.prepare("UPDATE tasks SET file_hash = ? WHERE id = ?").run(fileHash, task.id);
    }
    return { kind: "created", task, quotaDeductType };
  })();
}

/** POST /api/analyze — 上传文件并启动分析 */
async function analyze(req, res) {
  // 输入验证
  if (!req.file && !(req.body && req.body.text)) {
    return res.status(400).json({ error: "请上传 PDF 文件或提供文本" });
  }

  const cleanupUpload = () => {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
  };

  // 文件类型：扩展名/MIME 初判 + fileMode 严格白名单
  let fileMode = null;
  if (req.file) {
    const mime = req.file.mimetype || "";
    const name = (req.file.originalname || "").toLowerCase();
    const isPdf = mime === "application/pdf" || name.endsWith(".pdf");
    const isPptx = mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || name.endsWith(".pptx");
    const isDocx = mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || name.endsWith(".docx");
    const isDoc = mime === "application/msword" || name.endsWith(".doc");
    if (!isPdf && !isPptx && !isDocx && !isDoc) {
      cleanupUpload();
      return res.status(400).json({ error: "请上传 PDF / Word(.doc/.docx) / PPT(.pptx) 格式的文件" });
    }
    if (name.endsWith(".pptx")) fileMode = "pptx";
    else if (name.endsWith(".docx")) fileMode = "docx";
    else if (name.endsWith(".doc")) fileMode = "doc";
    else if (name.endsWith(".pdf")) fileMode = "pdf";
    if (!fileMode) {
      cleanupUpload();
      return res.status(400).json({ error: "不支持的文件类型" });
    }
  }

  // 用户角色查询；用户不存在（如已被删除）时直接拒绝，避免给"幽灵用户"扣额度
  const userId = req.user?.id || null;
  let isAdmin = false;
  if (userId) {
    let userRow = null;
    try {
      userRow = getDb().prepare("SELECT role FROM users WHERE id = ?").get(userId);
    } catch (err) {
      console.error("[Analyze] 用户查询失败:", err.message);
      cleanupUpload();
      return res.status(500).json({ error: "服务器内部错误，请重试" });
    }
    if (!userRow) {
      cleanupUpload();
      return res.status(401).json({ error: "用户不存在或已被删除，请重新登录" });
    }
    isAdmin = userRow.role === "admin";
  }

  // Magic number 校验 + 文件哈希（均为异步流式，不阻塞事件循环）
  let fileHash = null;
  if (req.file) {
    try {
      const magicOk = await verifyFileMagic(req.file.path, fileMode);
      if (!magicOk) {
        cleanupUpload();
        return res.status(400).json({ error: "文件内容与格式不符，请上传真实的 PDF / Word(.doc/.docx) / PPT(.pptx) 文件" });
      }
      fileHash = await computeFileHash(req.file.path);
    } catch (err) {
      console.warn("[Analyze] 文件校验/哈希失败:", err.message);
      cleanupUpload();
      return res.status(400).json({ error: "文件读取失败，请重试" });
    }
  }

  // 准入事务：去重 → 扣额度 → 建任务（原子）
  let admission;
  try {
    admission = admitAnalysis({ userId, isAdmin, fileHash });
  } catch (err) {
    console.error("[Analyze] 准入事务失败:", err.message);
    cleanupUpload();
    return res.status(500).json({ error: "服务器内部错误，请重试" });
  }

  if (admission.kind === "resuming") {
    // 相同文件正在分析中，直接返回已有的 taskId（不扣额度）
    cleanupUpload();
    return res.json({ taskId: admission.taskId, cached: false, resuming: true });
  }

  if (admission.kind === "cached") {
    // 相同文件 + 相同管线版本已分析过，复用结果（不扣额度）
    cleanupUpload();
    const task = createTask(userId);
    updateTask(task.id, {
      status: "complete",
      percentage: 100,
      stage: "complete",
      message: "检测到相同文件，已复用之前的分析结果",
      result: admission.existing.result,
      file_hash: fileHash,
    });
    return res.json({ taskId: task.id, cached: true });
  }

  if (admission.kind === "no_quota") {
    cleanupUpload();
    return res.status(403).json({
      error: "额度不足，请充值",
      code: 4032,
      require_payment: true,
    });
  }

  const { task, quotaDeductType } = admission;

  // 在响应前提取所有需要的 req 数据（响应后 req 对象可能被 GC）
  const filePath = req.file ? req.file.path : null;
  const originalName = req.file ? req.file.originalname : null;
  const fileSize = req.file ? req.file.size : 0;
  const directText = req.body?.text || null;
  const clientIp = req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || req.socket?.remoteAddress || null;

  res.json({ taskId: task.id });

  // H1: 立即链式注册 .catch，确保 IIFE 任何同步/异步异常都不会触发 unhandledRejection
  inflightTasks.register(task.id);
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
          console.warn(`[Analyze] 文档解析失败，使用兜底文本继续分析: ${userMessage}`);
          bpText = buildAnalysisFallbackText({
            filePath,
            fileMode,
            originalName,
            fileSize,
            reason: userMessage,
          });
        } finally {
          // M5: 异步清理临时文件，避免阻塞事件循环
          fs.promises.unlink(filePath).catch((err) => {
            console.warn(`[Analyze] 临时文件清理失败: ${filePath}`, err.message);
          });
        }
      } else {
        bpText = directText;
      }

      if (!bpText || bpText.length < 50) {
        bpText = buildAnalysisFallbackText({
          filePath,
          fileMode,
          originalName,
          fileSize,
          reason: `提取文本较短（${bpText?.length || 0} 字符），已使用兜底材料说明继续分析。`,
          extractedText: bpText,
        });
      }

      const onProgress = ({ type, stage, percentage, message }) => {
        if (type === "progress") updateTask(task.id, { stage, percentage, message });
      };

      const result = await runPipeline(bpText, onProgress, task.id, userId);

      // 保存额外的任务元数据（title, industry_category, client_ip, file_hash）
      const extraFields = {
        status: "complete",
        percentage: 100,
        stage: "complete",
        message: "分析完成！",
        result,
        // 持久化 BP 原文：深度尽调 6 Agent 改为按需触发，需要能取回原文重跑
        bp_text: bpText,
      };

      // 安全写入新字段（列可能尚未通过迁移创建；M13: 严格类型检查防 verdict=null 导致空指针）
      try {
        if (result && typeof result === "object") {
          if (typeof result.title === "string" && result.title) extraFields.title = result.title;
          // 多标签分类：以 JSON 数组存储
          if (Array.isArray(result.industry_categories) && result.industry_categories.length > 0) {
            extraFields.industry_category = JSON.stringify(result.industry_categories);
          } else if (typeof result.industry_category === "string" && result.industry_category) {
            extraFields.industry_category = result.industry_category;
          }
          if (fileHash) extraFields.file_hash = fileHash;
          // total_score 独立字段（便于排行榜查询）
          const totalScore = result.verdict && typeof result.verdict === "object"
            ? result.verdict.total_score
            : null;
          if (totalScore != null && Number.isFinite(Number(totalScore))) {
            extraFields.total_score = Number(totalScore);
          }
          // 项目所在地
          if (typeof result.project_location === "string" && result.project_location) {
            extraFields.project_location = result.project_location;
          }
        }
        // 客户端 IP（已在响应前提取）
        if (clientIp) extraFields.client_ip = clientIp;
      } catch (_) { /* ignore - new columns may not exist yet */ }

      updateTask(task.id, extraFields);
    } catch (err) {
      console.error(`[任务 ${task.id.slice(0, 8)}] 错误:`, err.message);
      updateTask(task.id, { status: "error", error: err.message || "服务器内部错误" });
      // 分析失败时退还额度（管理员无需退还）
      if (userId && !isAdmin && quotaDeductType) {
        refundQuota(userId, quotaDeductType);
      }
    } finally {
      inflightTasks.unregister(task.id);
    }
  })().catch((err) => {
    // H1 兜底：链式注册，确保即便 IIFE 在 await 之前同步抛出也能被捕获
    console.error(`[任务 ${task.id.slice(0, 8)}] 未捕获异常:`, err && err.stack ? err.stack : err);
    try {
      inflightTasks.unregister(task.id);
      updateTask(task.id, { status: "error", error: "服务器内部错误" });
      if (userId && !isAdmin && quotaDeductType) refundQuota(userId, quotaDeductType);
    } catch (_) { /* ignore */ }
  });
}

module.exports = { analyze, computeFileHash, verifyFileMagic, admitAnalysis };
