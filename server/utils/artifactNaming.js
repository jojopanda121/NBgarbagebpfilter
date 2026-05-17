const fs = require("fs");
const path = require("path");

function safeFilenamePart(value, fallback = "未命名") {
  const s = String(value || fallback)
    .replace(/[\\/:*?"<>|%\s]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return s || fallback;
}

function filenameExt(filename = "") {
  const ext = path.extname(String(filename || "")).replace(/^\./, "");
  return ext || "dat";
}

function formatArtifactDate(d = new Date()) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function chineseVersion(n) {
  const labels = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  if (n >= 1 && n <= 10) return `第${labels[n]}版`;
  return `第${n}版`;
}

function isGeneratedArtifactKind(kind = "") {
  return String(kind || "").startsWith("generated_") || ["pptx", "docx", "xlsx"].includes(kind);
}

function resolveConversationProjectName(db, conversationId) {
  const conv = db.prepare(
    "SELECT project_id, task_id, title FROM workspace_conversations WHERE id = ?"
  ).get(conversationId);
  if (!conv) return "未命名项目";

  if (conv.project_id) {
    const p = db.prepare("SELECT name FROM projects WHERE id = ?").get(conv.project_id);
    if (p?.name) return p.name;
  }
  if (conv.task_id) {
    const t = db.prepare("SELECT title FROM tasks WHERE id = ?").get(conv.task_id);
    if (t?.title) return t.title;
  }
  return conv.title || "未命名项目";
}

function buildStandardArtifactFilename(db, { conversationId, kind, filename, artifactTitle }) {
  if (!isGeneratedArtifactKind(kind)) return filename;

  const projectName = safeFilenamePart(resolveConversationProjectName(db, conversationId));
  const outputName = safeFilenamePart(artifactTitle || path.basename(String(filename || ""), path.extname(String(filename || ""))) || "AI产出");
  const ext = filenameExt(filename);
  const prefix = `${projectName}_${outputName}_`;
  const existing = db.prepare(
    `SELECT filename FROM workspace_artifacts
     WHERE conversation_id = ? AND kind LIKE 'generated_%' AND filename LIKE ?`
  ).all(conversationId, `${prefix}%`);
  const version = existing.length + 1;
  return `${prefix}${chineseVersion(version)}_${formatArtifactDate()}.${ext}`;
}

function standardizeArtifactFile({ db, conversationId, kind, filename, storagePath, artifactTitle }) {
  const finalFilename = buildStandardArtifactFilename(db, { conversationId, kind, filename, artifactTitle });
  if (!storagePath || finalFilename === filename) {
    return { filename: finalFilename, storagePath };
  }

  const dir = path.dirname(storagePath);
  const finalPath = path.join(dir, finalFilename);
  try {
    moveFileWithoutOverwrite(storagePath, finalPath);
    return { filename: finalFilename, storagePath: finalPath };
  } catch (_) {
    const ext = path.extname(finalFilename);
    const base = path.basename(finalFilename, ext);
    const fallback = path.join(dir, `${base}_${Date.now()}${ext}`);
    try {
      moveFileWithoutOverwrite(storagePath, fallback);
      return { filename: path.basename(fallback), storagePath: fallback };
    } catch (e2) {
      console.warn("[Workspace] 标准化 artifact 文件名失败:", e2.message);
      return { filename, storagePath };
    }
  }
}

function moveFileWithoutOverwrite(source, target) {
  if (!fs.existsSync(source)) return;
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  fs.unlinkSync(source);
}

module.exports = {
  buildStandardArtifactFilename,
  isGeneratedArtifactKind,
  standardizeArtifactFile,
};
