// ============================================================
// server/controllers/analyzeController.js — 分析控制器
// ============================================================

const fs = require("fs");
const { extractDocText } = require("../services/extractionService");
const { runPipeline } = require("../services/pipelineService");
const { createTask, updateTask } = require("../services/taskService");
const { deductQuota, refundQuota } = require("../middleware/quota");

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

  // 扣减额度（原子操作）
  const userId = req.user?.id || null;
  if (userId) {
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

      updateTask(task.id, {
        status: "complete",
        percentage: 100,
        stage: "complete",
        message: "分析完成！",
        result,
      });
    } catch (err) {
      console.error(`[任务 ${task.id.slice(0, 8)}] 错误:`, err.message);
      updateTask(task.id, { status: "error", error: err.message || "服务器内部错误" });
      // 分析失败时退还额度
      if (userId) {
        refundQuota(userId);
      }
    }
  })();
}

module.exports = { analyze };
