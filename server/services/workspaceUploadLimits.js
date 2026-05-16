const { execFileSync } = require("child_process");
const { getDb } = require("../db");

const UPLOAD_DAILY_LIMIT = 50;
const USER_STORAGE_LIMIT_BYTES = 500 * 1024 * 1024;
const DISK_WARN_FREE_BYTES = 8 * 1024 * 1024 * 1024;
const DISK_CRITICAL_FREE_BYTES = 4 * 1024 * 1024 * 1024;

function todayStartSqlite() {
  return `${new Date().toISOString().slice(0, 10)} 00:00:00`;
}

function getUserPlan(userId) {
  try {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(users)").all();
    const hasVip = cols.some((c) => c.name === "is_vip");
    const fields = hasVip ? "role, is_vip, vip_expires_at" : "role, 0 as is_vip, NULL as vip_expires_at";
    const u = db.prepare(`SELECT ${fields} FROM users WHERE id = ?`).get(userId);
    const isVip = !!u?.is_vip && (!u.vip_expires_at || new Date(u.vip_expires_at) > new Date());
    return { role: u?.role || "user", isVip };
  } catch {
    return { role: "user", isVip: false };
  }
}

function countUploadsToday(userId) {
  return getDb().prepare(`
    SELECT COUNT(*) as cnt FROM workspace_artifacts a
    JOIN workspace_conversations c ON c.id = a.conversation_id
    WHERE c.user_id = ? AND a.kind = 'upload' AND a.created_at >= ?
  `).get(userId, todayStartSqlite()).cnt || 0;
}

function totalWorkspaceBytes(userId) {
  return getDb().prepare(`
    SELECT COALESCE(SUM(a.size_bytes), 0) as total_bytes FROM workspace_artifacts a
    JOIN workspace_conversations c ON c.id = a.conversation_id
    WHERE c.user_id = ?
  `).get(userId).total_bytes || 0;
}

function freeDiskBytes(path) {
  try {
    const out = execFileSync("df", ["-Pk", path || "."], { encoding: "utf8", timeout: 1000 });
    const line = out.trim().split("\n").pop();
    const parts = line.trim().split(/\s+/);
    return Number(parts[3]) * 1024;
  } catch {
    return null;
  }
}

function limitError(message, status = 429, code = "WORKSPACE_UPLOAD_LIMIT") {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function enforceDiskRoom({ userId, incomingBytes = 0, artifactRoot }) {
  const free = freeDiskBytes(artifactRoot);
  if (free == null) return;
  const after = free - (incomingBytes || 0);
  const plan = getUserPlan(userId);
  if (after < DISK_CRITICAL_FREE_BYTES) {
    throw limitError("服务器存储空间不足，请先清理 workspace 材料或联系管理员。", 507, "WORKSPACE_DISK_CRITICAL");
  }
  if (after < DISK_WARN_FREE_BYTES && plan.role !== "admin" && !plan.isVip) {
    throw limitError("服务器剩余空间偏低，普通用户暂时不能上传或生成文件；请清理旧材料或联系管理员开通 VIP。", 507, "WORKSPACE_DISK_LOW");
  }
}

function enforceWorkspaceUploadLimits({ userId, fileSize = 0, artifactRoot }) {
  const plan = getUserPlan(userId);
  enforceDiskRoom({ userId, incomingBytes: fileSize, artifactRoot });

  if (plan.role !== "admin" && countUploadsToday(userId) >= UPLOAD_DAILY_LIMIT) {
    throw limitError(`每日上传限额已达 ${UPLOAD_DAILY_LIMIT} 个文件`);
  }

  if (plan.role !== "admin" && !plan.isVip && totalWorkspaceBytes(userId) + (fileSize || 0) > USER_STORAGE_LIMIT_BYTES) {
    throw limitError("存储空间已满（500MB），请清理旧材料后再上传");
  }
}

function enforceWorkspaceOutputLimits({ userId, sizeBytes = 0, artifactRoot }) {
  enforceDiskRoom({ userId, incomingBytes: sizeBytes, artifactRoot });
}

module.exports = {
  UPLOAD_DAILY_LIMIT,
  USER_STORAGE_LIMIT_BYTES,
  enforceWorkspaceUploadLimits,
  enforceWorkspaceOutputLimits,
};
