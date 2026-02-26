// ============================================================
// server/services/taskService.js — 任务管理服务
// 支持两种存储后端：
//   1. 内存 Map（开发/单实例模式）
//   2. SQLite（生产模式，支持持久化）
// ============================================================

const crypto = require("crypto");
const { getDb } = require("../db");

// 内存存储（兼容原有逻辑，单实例模式下性能最优）
const memoryTasks = new Map();

function createTask(userId = null) {
  const id = crypto.randomBytes(16).toString("hex");
  const now = new Date().toISOString();
  const task = {
    id,
    user_id: userId,
    status: "running",
    percentage: 0,
    stage: "queued",
    message: "任务已提交，等待处理...",
    result: null,
    error: null,
    created_at: now,
    updated_at: now,
  };

  // 写入内存
  memoryTasks.set(id, task);

  // 同时写入数据库（持久化）
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO tasks (id, user_id, status, percentage, stage, message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, userId, task.status, task.percentage, task.stage, task.message, now, now);
  } catch (err) {
    console.warn("[TaskService] DB write failed, using memory only:", err.message);
  }

  return task;
}

function updateTask(taskId, fields) {
  const now = new Date().toISOString();

  // 更新内存
  const task = memoryTasks.get(taskId);
  if (task) {
    Object.assign(task, fields, { updated_at: now });
  }

  // 更新数据库
  try {
    const db = getDb();
    const updates = [];
    const values = [];

    for (const [key, value] of Object.entries(fields)) {
      if (key === "result") {
        updates.push("result = ?");
        values.push(typeof value === "string" ? value : JSON.stringify(value));
      } else {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    }

    updates.push("updated_at = ?");
    values.push(now);
    values.push(taskId);

    db.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  } catch (err) {
    // DB update is best-effort; memory is authoritative for real-time
  }
}

function getTask(taskId) {
  // 优先从内存读取（实时性更高）
  const memTask = memoryTasks.get(taskId);
  if (memTask) return memTask;

  // 降级从数据库读取
  try {
    const db = getDb();
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (row && row.result) {
      try { row.result = JSON.parse(row.result); } catch {}
    }
    return row || null;
  } catch {
    return null;
  }
}

function getTasksByUser(userId) {
  try {
    const db = getDb();
    return db.prepare(
      "SELECT id, status, percentage, stage, message, created_at, updated_at FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 20"
    ).all(userId);
  } catch {
    return [];
  }
}

// 定期清理：内存中超过 1 小时的旧任务
setInterval(() => {
  const cutoff = Date.now() - 3_600_000;
  for (const [id, t] of memoryTasks) {
    const createdAt = new Date(t.created_at).getTime();
    if (createdAt < cutoff) memoryTasks.delete(id);
  }
}, 600_000);

module.exports = { createTask, updateTask, getTask, getTasksByUser };
