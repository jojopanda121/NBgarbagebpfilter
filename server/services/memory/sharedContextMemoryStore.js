const { getDb } = require("../../db");
const { MEMORY_LIMITS } = require("./constants");
const { uuid, safeJsonParse, json, clampText, normalizeKey, rankMemory } = require("./utils");

function rowToShared(row) {
  if (!row) return null;
  return {
    ...row,
    evidence: safeJsonParse(row.evidence, []),
    tags: safeJsonParse(row.tags, []),
    supersedes: safeJsonParse(row.supersedes, []),
    rank_score: rankMemory(row),
  };
}

function querySharedMemory(taskId, opts = {}) {
  const db = getDb();
  const categories = Array.isArray(opts.category) && opts.category.length ? opts.category : null;
  const limit = Math.min(Number(opts.limit || MEMORY_LIMITS.layer2.defaultQueryLimit), 20);
  let rows;

  if (categories) {
    const placeholders = categories.map(() => "?").join(",");
    rows = db.prepare(
      `SELECT * FROM workspace_memory_shared
       WHERE task_id = ? AND status = 'active' AND category IN (${placeholders})
       ORDER BY confidence DESC, updated_at DESC
       LIMIT ?`
    ).all(taskId, ...categories, limit * 2);
  } else {
    rows = db.prepare(
      `SELECT * FROM workspace_memory_shared
       WHERE task_id = ? AND status = 'active'
       ORDER BY confidence DESC, updated_at DESC
       LIMIT ?`
    ).all(taskId, limit * 2);
  }

  return rows.map(rowToShared)
    .sort((a, b) => b.rank_score - a.rank_score)
    .slice(0, limit);
}

function upsertSharedMemory(taskId, memory) {
  const db = getDb();
  const category = memory.category || "company_fact";
  const claim = clampText(memory.claim, MEMORY_LIMITS.layer2.maxCharsPerMemory);
  if (!claim) return null;
  const claimKey = normalizeKey(memory.claim_key || claim);
  const id = memory.id || uuid();
  const evidence = Array.isArray(memory.evidence) ? memory.evidence.slice(0, 6) : [];
  const tags = Array.isArray(memory.tags) ? memory.tags.slice(0, 8) : [];

  db.prepare(
    `INSERT INTO workspace_memory_shared
      (id, task_id, scope, category, claim_key, claim, evidence, implication, confidence, freshness, status, supersedes, owner_agent, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT(task_id, category, claim_key) DO UPDATE SET
       claim = excluded.claim,
       evidence = excluded.evidence,
       implication = excluded.implication,
       confidence = MAX(workspace_memory_shared.confidence, excluded.confidence),
       freshness = excluded.freshness,
       status = 'active',
       owner_agent = excluded.owner_agent,
       tags = excluded.tags,
       updated_at = datetime('now')`
  ).run(
    id,
    taskId,
    memory.scope || "project",
    category,
    claimKey,
    claim,
    json(evidence),
    clampText(memory.implication || "", 800),
    Math.max(0, Math.min(1, Number(memory.confidence ?? 0.55))),
    memory.freshness || new Date().toISOString().slice(0, 10),
    json(memory.supersedes || []),
    memory.owner_agent || null,
    json(tags)
  );

  enforceSharedLimits(taskId, category);
  return db.prepare(
    "SELECT * FROM workspace_memory_shared WHERE task_id = ? AND category = ? AND claim_key = ?"
  ).get(taskId, category, claimKey);
}

function enforceSharedLimits(taskId, category) {
  const db = getDb();
  const perCategory = MEMORY_LIMITS.layer2.maxActiveMemoriesPerCategory;
  const total = MEMORY_LIMITS.layer2.maxActiveMemoriesPerTask;

  const overCategory = db.prepare(
    `SELECT id FROM workspace_memory_shared
     WHERE task_id = ? AND category = ? AND status = 'active'
     ORDER BY confidence ASC, usage_count ASC, updated_at ASC
     LIMIT -1 OFFSET ?`
  ).all(taskId, category, perCategory);
  for (const row of overCategory) {
    db.prepare("UPDATE workspace_memory_shared SET status = 'stale', updated_at = datetime('now') WHERE id = ?").run(row.id);
  }

  const overTask = db.prepare(
    `SELECT id FROM workspace_memory_shared
     WHERE task_id = ? AND status = 'active'
     ORDER BY confidence ASC, usage_count ASC, updated_at ASC
     LIMIT -1 OFFSET ?`
  ).all(taskId, total);
  for (const row of overTask) {
    db.prepare("UPDATE workspace_memory_shared SET status = 'stale', updated_at = datetime('now') WHERE id = ?").run(row.id);
  }
}

function recordSharedUse(memoryIds, { taskId, userId, agentName, outcome = "used" } = {}) {
  const db = getDb();
  for (const id of memoryIds || []) {
    db.prepare(
      `INSERT INTO workspace_memory_usage (id, memory_layer, memory_id, task_id, user_id, agent_name, outcome)
       VALUES (?, 'shared', ?, ?, ?, ?, ?)`
    ).run(uuid(), id, taskId || null, userId || null, agentName || null, outcome);
    db.prepare(
      `UPDATE workspace_memory_shared
       SET usage_count = usage_count + 1,
           success_count = success_count + CASE WHEN ? = 'success' THEN 1 ELSE 0 END,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(outcome, id);
  }
}

function deleteSharedMemoryForTask(taskId) {
  return getDb().prepare("DELETE FROM workspace_memory_shared WHERE task_id = ?").run(taskId);
}

module.exports = {
  querySharedMemory,
  upsertSharedMemory,
  recordSharedUse,
  deleteSharedMemoryForTask,
  rowToShared,
};
