const fs = require("fs");
const path = require("path");
const { getDb } = require("../../db");
const { cleanupExpiredWorkingMemory } = require("./workingMemoryStore");

function runMemoryGc({ artifactRoot, artifactMaxAgeDays = 30 } = {}) {
  const db = getDb();
  const result = {
    workingDeleted: 0,
    messagesDeleted: 0,
    artifactsDeleted: 0,
    uploadRetentionUpdated: 0,
    staleShared: 0,
    archivedLongTerm: 0,
  };

  result.workingDeleted = cleanupExpiredWorkingMemory().changes || 0;

  const oldMessages = db.prepare(
    `SELECT id FROM workspace_messages
     WHERE id IN (
       SELECT id FROM workspace_messages
       WHERE conversation_id = ?
       ORDER BY created_at DESC LIMIT -1 OFFSET 120
     )`
  );
  const conversations = db.prepare("SELECT id FROM workspace_conversations").all();
  const deleteMsg = db.prepare("DELETE FROM workspace_messages WHERE id = ?");
  for (const conv of conversations) {
    for (const row of oldMessages.all(conv.id)) {
      deleteMsg.run(row.id);
      result.messagesDeleted++;
    }
  }

  result.staleShared = db.prepare(
    `UPDATE workspace_memory_shared
     SET status = 'stale', updated_at = datetime('now')
     WHERE status = 'active' AND freshness IS NOT NULL AND freshness < date('now', '-180 days')`
  ).run().changes || 0;

  result.archivedLongTerm = db.prepare(
    `UPDATE workspace_memory_longterm
     SET status = 'archived', updated_at = datetime('now')
     WHERE status = 'active' AND usage_count = 0 AND created_at < datetime('now', '-180 days')`
  ).run().changes || 0;

  if (artifactRoot && fs.existsSync(artifactRoot)) {
    let evidenceStore = null;
    try {
      evidenceStore = require("../evidenceStore");
      result.uploadRetentionUpdated = evidenceStore.refreshUploadRetention(db).updated || 0;
    } catch (_) {}
    const cols = db.prepare("PRAGMA table_info(workspace_artifacts)").all();
    const hasExpires = cols.some((c) => c.name === "expires_at");

    const rows = hasExpires
      ? db.prepare(
          `SELECT id, storage_path FROM workspace_artifacts
           WHERE expires_at IS NOT NULL AND expires_at < datetime('now')`
        ).all()
      : db.prepare(
          `SELECT id, storage_path FROM workspace_artifacts
           WHERE created_at < datetime('now', ?)`
        ).all(`-${artifactMaxAgeDays} days`);

    for (const row of rows) {
      try {
        if (row.storage_path && fs.existsSync(row.storage_path)) fs.unlinkSync(row.storage_path);
        const sidecar = `${row.storage_path}.extracted.txt`;
        if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
      } catch {}
      try { evidenceStore?.deleteEvidenceForArtifact(db, row.id); } catch (_) {}
      db.prepare("DELETE FROM workspace_artifacts WHERE id = ?").run(row.id);
      result.artifactsDeleted++;
    }
    try {
      for (const name of fs.readdirSync(artifactRoot)) {
        const full = path.join(artifactRoot, name);
        if (fs.statSync(full).isDirectory() && fs.readdirSync(full).length === 0) fs.rmdirSync(full);
      }
    } catch {}
  }

  return result;
}

module.exports = {
  runMemoryGc,
};
