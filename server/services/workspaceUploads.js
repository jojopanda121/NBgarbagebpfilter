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

const EXTRACT_MODES = new Set(["pdf", "pptx", "docx", "xlsx", "csv"]);

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

  return { artifact, text, summary };
}

module.exports = {
  persistWorkspaceUpload,
  decodeUploadName,
};
