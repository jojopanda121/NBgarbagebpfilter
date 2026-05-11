const { getDb } = require("../../db");
const { MEMORY_LIMITS } = require("./constants");
const { uuid, safeJsonParse, json, clampText, rankMemory } = require("./utils");

function rowToLongTerm(row) {
  if (!row) return null;
  return {
    ...row,
    examples: safeJsonParse(row.examples, []),
    rank_score: rankMemory(row) * Number(row.decay_score || 1),
  };
}

function queryLongTermMemory(userId, opts = {}) {
  const db = getDb();
  const limit = Math.min(Number(opts.limit || MEMORY_LIMITS.layer3.defaultQueryLimit), 10);
  const trigger = String(opts.trigger || opts.taskType || "").toLowerCase();
  const rows = db.prepare(
    `SELECT * FROM workspace_memory_longterm
     WHERE user_id = ? AND status = 'active'
     ORDER BY confidence DESC, usage_count DESC, updated_at DESC
     LIMIT ?`
  ).all(userId, limit * 3);

  return rows.map(rowToLongTerm)
    .filter((m) => !trigger || `${m.trigger} ${m.type} ${m.rule}`.toLowerCase().includes(trigger) || m.type !== "report_style")
    .sort((a, b) => b.rank_score - a.rank_score)
    .slice(0, limit);
}

function upsertLongTermMemory(userId, memory) {
  const db = getDb();
  const type = memory.type || "decision_preference";
  const trigger = clampText(memory.trigger || "general", 160);
  const rule = clampText(memory.rule, MEMORY_LIMITS.layer3.maxCharsPerMemory);
  const action = clampText(memory.action, 600);
  if (!rule || !action) return null;
  const id = memory.id || uuid();

  db.prepare(
    `INSERT INTO workspace_memory_longterm
      (id, user_id, type, trigger, rule, action, examples, confidence, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
     ON CONFLICT(user_id, type, trigger, rule) DO UPDATE SET
       action = excluded.action,
       examples = excluded.examples,
       confidence = MAX(workspace_memory_longterm.confidence, excluded.confidence),
       status = 'active',
       updated_at = datetime('now')`
  ).run(
    id,
    userId,
    type,
    trigger,
    rule,
    action,
    json(Array.isArray(memory.examples) ? memory.examples.slice(0, 4) : []),
    Math.max(0, Math.min(1, Number(memory.confidence ?? 0.6)))
  );

  enforceLongTermLimits(userId);
  return db.prepare(
    "SELECT * FROM workspace_memory_longterm WHERE user_id = ? AND type = ? AND trigger = ? AND rule = ?"
  ).get(userId, type, trigger, rule);
}

function enforceLongTermLimits(userId) {
  const rows = getDb().prepare(
    `SELECT id FROM workspace_memory_longterm
     WHERE user_id = ? AND status = 'active'
     ORDER BY confidence ASC, usage_count ASC, updated_at ASC
     LIMIT -1 OFFSET ?`
  ).all(userId, MEMORY_LIMITS.layer3.maxActiveMemoriesPerUser);
  const stmt = getDb().prepare("UPDATE workspace_memory_longterm SET status = 'archived', updated_at = datetime('now') WHERE id = ?");
  for (const row of rows) stmt.run(row.id);
}

function recordLongTermUse(memoryIds, { taskId, userId, agentName, outcome = "used" } = {}) {
  const db = getDb();
  for (const id of memoryIds || []) {
    db.prepare(
      `INSERT INTO workspace_memory_usage (id, memory_layer, memory_id, task_id, user_id, agent_name, outcome)
       VALUES (?, 'long_term', ?, ?, ?, ?, ?)`
    ).run(uuid(), id, taskId || null, userId || null, agentName || null, outcome);
    db.prepare(
      `UPDATE workspace_memory_longterm
       SET usage_count = usage_count + 1,
           success_count = success_count + CASE WHEN ? = 'success' THEN 1 ELSE 0 END,
           last_used_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(outcome, id);
  }
}

function decayLongTermMemory(userId) {
  return getDb().prepare(
    `UPDATE workspace_memory_longterm
     SET decay_score = MAX(0.1, decay_score * 0.98)
     WHERE user_id = ? AND status = 'active' AND (last_used_at IS NULL OR last_used_at < datetime('now', '-30 days'))`
  ).run(userId);
}

module.exports = {
  queryLongTermMemory,
  upsertLongTermMemory,
  recordLongTermUse,
  decayLongTermMemory,
  rowToLongTerm,
};
