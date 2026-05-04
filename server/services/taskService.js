// ============================================================
// server/services/taskService.js — 任务管理服务
// 存储策略：SQLite 为权威数据源 + 内存 Map 作为读缓存
//
// 故障恢复：进程启动时自动将数据库中滞留的 running 任务标记为
// failed，避免它们永久卡死在"进行中"状态。
// ============================================================

const crypto = require("crypto");
const { getDb } = require("../db");

// 内存缓存（读加速，DB 为权威数据源）
const memoryTasks = new Map();

function generateArchiveNumber() {
  try {
    const db = getDb();
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
    const prefix = `DA-${dateStr}-`;

    // 查找今天已有的最大序号
    const row = db.prepare(
      `SELECT archive_number FROM tasks
       WHERE archive_number LIKE ? || '%'
       ORDER BY archive_number DESC LIMIT 1`
    ).get(prefix);

    let seq = 1;
    if (row && row.archive_number) {
      const lastSeq = parseInt(row.archive_number.split("-").pop(), 10);
      if (!isNaN(lastSeq)) seq = lastSeq + 1;
    }

    return `${prefix}${String(seq).padStart(4, "0")}`;
  } catch (err) {
    // 降级：使用时间戳
    return `DA-${Date.now()}`;
  }
}

function createTask(userId = null) {
  const id = crypto.randomBytes(16).toString("hex");
  const now = new Date().toISOString();
  const archiveNumber = generateArchiveNumber();
  const task = {
    id,
    user_id: userId,
    archive_number: archiveNumber,
    status: "running",
    percentage: 0,
    stage: "queued",
    message: "任务已提交，等待处理...",
    result: null,
    error: null,
    created_at: now,
    updated_at: now,
  };

  // 先写入数据库（权威数据源），再写缓存
  const db = getDb();
  db.prepare(
    `INSERT INTO tasks (id, user_id, archive_number, status, percentage, stage, message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, archiveNumber, task.status, task.percentage, task.stage, task.message, now, now);

  // 写入内存缓存
  memoryTasks.set(id, task);

  return task;
}

// 允许通过 updateTask 更新的列白名单（防止 SQL 注入）
const ALLOWED_TASK_COLUMNS = new Set([
  "status", "percentage", "stage", "message", "result", "error",
  "title", "industry_category", "file_hash", "total_score",
  "project_location", "client_ip", "project_stage", "adjusted_score",
  "next_followup_date", "archive_number",
]);

function updateTask(taskId, fields) {
  const now = new Date().toISOString();

  // M2: DB 为权威数据源 — 先写 DB，成功后再回写内存缓存，避免 DB 失败导致缓存与持久层不一致
  try {
    const db = getDb();
    const updates = [];
    const values = [];

    for (const [key, value] of Object.entries(fields)) {
      if (!ALLOWED_TASK_COLUMNS.has(key)) {
        console.warn(`[TaskService] Rejected unknown column: ${key}`);
        continue;
      }
      if (key === "result") {
        updates.push("result = ?");
        values.push(typeof value === "string" ? value : JSON.stringify(value));
      } else {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (updates.length === 0) return;

    updates.push("updated_at = ?");
    values.push(now);
    values.push(taskId);

    db.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).run(...values);

    // DB 写入成功后再更新内存缓存
    const task = memoryTasks.get(taskId);
    if (task) {
      Object.assign(task, fields, { updated_at: now });
    }
  } catch (err) {
    // 关键失败 — DB 与内存均不更新，避免脏缓存
    console.warn(`[TaskService] DB update failed for task ${taskId}: ${err.message}`);
    // 失效内存缓存：下次 getTask 会强制走 DB（即便落后也是真值）
    memoryTasks.delete(taskId);
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
    // 动态检测可选列是否存在
    const tableInfo = db.prepare("PRAGMA table_info(tasks)").all();
    const colNames = tableInfo.map((col) => col.name);
    const hasTitle = colNames.includes("title");
    const hasIndustryCategory = colNames.includes("industry_category");
    const hasArchiveNumber = colNames.includes("archive_number");

    const hasProjectStage = colNames.includes("project_stage");
    const hasAdjustedScore = colNames.includes("adjusted_score");
    const hasNextFollowup = colNames.includes("next_followup_date");
    const hasTotalScore = colNames.includes("total_score");
    const hasProjectLocation = colNames.includes("project_location");

    const extraCols = [
      hasTitle ? "title" : null,
      hasIndustryCategory ? "industry_category" : null,
      hasArchiveNumber ? "archive_number" : null,
      hasProjectStage ? "project_stage" : null,
      hasAdjustedScore ? "adjusted_score" : null,
      hasNextFollowup ? "next_followup_date" : null,
      hasTotalScore ? "total_score" : null,
      hasProjectLocation ? "project_location" : null,
      "result",
    ].filter(Boolean).map(c => `, ${c}`).join("");

    const rows = db.prepare(
      `SELECT id, status, percentage, stage, message, created_at, updated_at${extraCols} FROM tasks WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50`
    ).all(userId);

    // 从 result JSON 中提取 total_score 和 industry，然后移除 result 原始字段（太大）
    return rows.map((row) => {
      let total_score = row.total_score ?? null;
      let industry = null;
      if (row.result) {
        try {
          const r = typeof row.result === "string" ? JSON.parse(row.result) : row.result;
          if (total_score == null) total_score = r?.verdict?.total_score ?? null;
          industry = r?.extracted_data?.industry ?? r?.industry ?? null;
        } catch {}
      }
      const { result, ...rest } = row;
      return { ...rest, total_score, industry };
    });
  } catch {
    return [];
  }
}

// ── 启动时故障恢复 ────────────────────────────────────────────
// 进程崩溃或重启后，将数据库中所有处于 running 状态的任务标记为
// failed，防止它们永远卡在"进行中"。
function recoverStaleTasks() {
  try {
    const db = getDb();
    const now = new Date().toISOString();

    // 查找需要恢复的任务（包含 user_id 以便退还额度）
    const staleTasks = db
      .prepare("SELECT id, user_id FROM tasks WHERE status = 'running'")
      .all();

    if (staleTasks.length === 0) return;

    db.transaction(() => {
      // 标记所有 running 任务为 failed
      db.prepare(
        `UPDATE tasks SET status = 'failed', error = '进程重启，任务中断', updated_at = ?
         WHERE status = 'running'`
      ).run(now);

      // 为每个有 user_id 的任务退还免费额度
      const refundStmt = db.prepare(
        "UPDATE quotas SET free_quota = free_quota + 1, updated_at = datetime('now') WHERE user_id = ?"
      );
      let refunded = 0;
      for (const task of staleTasks) {
        if (task.user_id) {
          // 检查用户是否为管理员（管理员不需要退还）
          const user = db.prepare("SELECT role FROM users WHERE id = ?").get(task.user_id);
          if (user && user.role !== "admin") {
            refundStmt.run(task.user_id);
            refunded++;
          }
        }
      }
      if (refunded > 0) {
        console.log(`[TaskService] 故障恢复：已退还 ${refunded} 个用户的额度`);
      }
    })();

    console.log(`[TaskService] 故障恢复：${staleTasks.length} 个滞留任务已标记为 failed`);
  } catch (err) {
    console.warn("[TaskService] 故障恢复失败（DB 可能尚未初始化）:", err.message);
  }
}

// 在模块加载（即进程启动）时立即执行一次恢复
recoverStaleTasks();
// ──────────────────────────────────────────────────────────────

// 定期清理：内存中超过 1 小时的旧任务
setInterval(() => {
  const cutoff = Date.now() - 3_600_000;
  for (const [id, t] of memoryTasks) {
    const createdAt = new Date(t.created_at).getTime();
    if (createdAt < cutoff) memoryTasks.delete(id);
  }
}, 600_000);

module.exports = { createTask, updateTask, getTask, getTasksByUser };
