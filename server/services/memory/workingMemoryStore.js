const { getDb } = require("../../db");
const { MEMORY_LIMITS } = require("./constants");
const { uuid, safeJsonParse, json, clampText } = require("./utils");

function rowToWorking(row) {
  if (!row) return null;
  return {
    ...row,
    hypotheses: safeJsonParse(row.hypotheses, []),
    evidence_refs: safeJsonParse(row.evidence_refs, []),
    intermediate_findings: safeJsonParse(row.intermediate_findings, []),
    open_questions: safeJsonParse(row.open_questions, []),
  };
}

function createWorkingMemory(runId, taskId, agentName, objective = "") {
  const db = getDb();
  const id = uuid();
  const ttl = MEMORY_LIMITS.layer1.ttlMinutes;
  db.prepare(
    `INSERT INTO workspace_agent_working_memory
      (id, run_id, task_id, agent_name, objective, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', ?))`
  ).run(id, runId, taskId, agentName, clampText(objective, 600), `+${ttl} minutes`);
  return db.prepare("SELECT * FROM workspace_agent_working_memory WHERE id = ?").get(id);
}

function appendWorkingFinding(runId, agentName, finding) {
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM workspace_agent_working_memory WHERE run_id = ? AND agent_name = ? ORDER BY created_at DESC LIMIT 1"
  ).get(runId, agentName);
  if (!row) return null;
  const findings = safeJsonParse(row.intermediate_findings, []);
  findings.push(clampText(finding, 300));
  const clipped = findings.slice(-MEMORY_LIMITS.layer1.maxItemsPerAgentRun);
  db.prepare(
    `UPDATE workspace_agent_working_memory
     SET intermediate_findings = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(json(clipped), row.id);
  return getWorkingMemory(runId, agentName);
}

function getWorkingMemory(runId, agentName) {
  return rowToWorking(getDb().prepare(
    "SELECT * FROM workspace_agent_working_memory WHERE run_id = ? AND agent_name = ? ORDER BY created_at DESC LIMIT 1"
  ).get(runId, agentName));
}

function clearWorkingMemory(runId) {
  return getDb().prepare("DELETE FROM workspace_agent_working_memory WHERE run_id = ?").run(runId);
}

function cleanupExpiredWorkingMemory() {
  return getDb().prepare("DELETE FROM workspace_agent_working_memory WHERE expires_at < datetime('now')").run();
}

module.exports = {
  createWorkingMemory,
  appendWorkingFinding,
  getWorkingMemory,
  clearWorkingMemory,
  cleanupExpiredWorkingMemory,
  rowToWorking,
};
