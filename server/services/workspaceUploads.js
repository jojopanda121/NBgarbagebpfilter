// ============================================================
// workspaceUploads — task-level / project-level 上传持久化共享逻辑
//
// 提取/sidecar/artifact 写入 在一个地方实现, 避免 project-level chat 上传
// 不写 sidecar 导致 buildProjectContext 读不到正文摘录.
//
// scope:
//   "task"    → 触发 processUploadMemory (写记忆); 调用方负责 taskId/userId
//   "project" → 只写 artifact + sidecar, 不写记忆 (记忆是 task 级)
// 调用方可以拿到 { artifact, text, summary } 后自行 appendMessage / 返回响应.
// ============================================================

const fs = require("fs");
const path = require("path");
const ws = require("./workspaceService");
const { extractDocText } = require("./extractionService");
const { getDb } = require("../db");
const uploadStructured = require("./extraction/uploadStructuredExtraction");
const logger = require("../utils/logger");

const EXTRACT_MODES = new Set(["pdf", "pptx", "docx", "xlsx", "csv"]);

// 同步抽取的文件大小阈值（字符数）。超过这个阈值就走后台异步，避免阻塞上传响应。
// 4 vCPU / 4GB 机型 LLM 调用 5-15s 量级，小文档同步可接受。
const SYNC_EXTRACTION_MAX_CHARS = 6000;

// 是否启用上传后结构化抽取。env UPLOAD_STRUCTURED_EXTRACTION_DISABLED=1 显式关闭。
function _structuredExtractionEnabled() {
  return process.env.UPLOAD_STRUCTURED_EXTRACTION_DISABLED !== "1";
}

function decodeUploadName(name = "") {
  if (!name) return name;
  // multer/busboy 在某些环境会把 UTF-8 文件名按 latin1 暴露, 表现为 ä¸å¸...
  if (!/[À-ÿ]/.test(name)) return name;
  try {
    const decoded = Buffer.from(name, "latin1").toString("utf8");
    return decoded.includes("�") ? name : decoded;
  } catch {
    return name;
  }
}

/**
 * 持久化一份上传材料 (task 或 project scope 共享).
 *
 * @param {object}  args
 * @param {object}  args.file           multer file 对象 ({ path, originalname, mimetype, size })
 * @param {string}  args.conversationId 必填, 用于产物归属
 * @param {"task"|"project"} args.scope
 * @param {string}  [args.taskId]       scope==="task" 时启用记忆提炼
 * @param {string}  [args.userId]       scope==="task" 时启用记忆提炼
 * @returns {Promise<{artifact:object|null, text:string, summary:string}>}
 */
async function persistWorkspaceUpload({ file, conversationId, scope, taskId, userId }) {
  if (!file) return { artifact: null, text: "", summary: "" };
  if (!conversationId) {
    throw new Error("persistWorkspaceUpload: conversationId 必填");
  }

  const tmpPath = file.path;
  const originalName = decodeUploadName(file.originalname);
  const ext = (path.extname(originalName) || "").slice(1).toLowerCase();
  const mode = EXTRACT_MODES.has(ext) ? ext : null;

  let text = "";
  if (mode) {
    try { text = await extractDocText(tmpPath, mode); }
    catch (err) { console.warn("[WorkspaceUpload] 提取失败:", err.message); }
  } else if (file.mimetype?.startsWith("text/")) {
    text = fs.readFileSync(tmpPath, "utf-8");
  }
  const summary = text
    ? await ws.summarizeUploadedText(text, originalName)
    : "（无法提取文本，仅记录文件名）";

  const convDir = path.join(ws.ARTIFACTS_ROOT, conversationId);
  if (!fs.existsSync(convDir)) fs.mkdirSync(convDir, { recursive: true });
  const safeName = originalName.replace(/[\\/:*?"<>|]+/g, "_");
  const dest = path.join(convDir, `${Date.now()}-${safeName}`);
  fs.copyFileSync(tmpPath, dest);
  if (text) ws.saveArtifactExtractedText(dest, text);

  const artifact = ws.insertArtifact({
    conversationId,
    kind: "upload",
    filename: originalName,
    storagePath: dest,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    summary,
    userId,
  });

  if (scope === "task" && taskId && userId && summary) {
    ws.processUploadMemory({ taskId, userId, filename: originalName, summary })
      .catch((err) => console.warn("[WorkspaceUpload] 记忆提炼失败:", err.message));
  }

  // 触发上传资料结构化抽取（替代旧的"BP 深度解析"）。
  // - 短文本同步跑，方便首次 skill 立刻拿到结构化证据。
  // - 长文本异步跑，不阻塞上传响应；下游 skill 若先于抽取完成调用，
  //   会拿不到 upload_structured fact，自动降级到 upload sidecar + external_search。
  // - 任何错误都吞掉、记入 workspace_artifact_structured_extracts.error，
  //   不影响 persistWorkspaceUpload 自身的返回成功。
  if (artifact?.id && text && _structuredExtractionEnabled()) {
    const trimmed = text.length > 24000 ? text.slice(0, 24000) : text;
    const runArgs = {
      db: getDb(),
      artifactId: artifact.id,
      conversationId,
      filename: originalName,
      uploadText: trimmed,
      mimeType: file.mimetype,
    };
    if (text.length <= SYNC_EXTRACTION_MAX_CHARS) {
      try {
        await uploadStructured.runAndPersist(runArgs);
      } catch (err) {
        logger.warn?.(`[WorkspaceUpload] 同步结构化抽取失败: ${err.message}`);
      }
    } else {
      // fire-and-forget；任何 reject 都吞掉
      uploadStructured.runAndPersist(runArgs).catch((err) => {
        logger.warn?.(`[WorkspaceUpload] 异步结构化抽取失败: ${err.message}`);
      });
    }
  }

  return { artifact, text, summary };
}

module.exports = {
  persistWorkspaceUpload,
  decodeUploadName,
};
