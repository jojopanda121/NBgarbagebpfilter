// ============================================================
// server/services/evidenceStore.js
//
// Project-scoped lightweight evidence store:
// SQLite tables + FTS5 chunks + structured facts. This is deliberately
// boring infrastructure so it stays happy on a 4 vCPU / 4GB box.
// ============================================================

const crypto = require("crypto");
const { getDb } = require("../db");

const FREE_UPLOAD_TTL_DAYS = 3;
const GENERATED_ARTIFACT_TTL_DAYS = 7;
const MAX_RAW_TEXT_CHARS = Number(process.env.EVIDENCE_RAW_TEXT_MAX_CHARS || 240000);
const CHUNK_SIZE = 2048;
const CHUNK_OVERLAP = 20;

function tableExists(db, name) {
  try {
    return !!db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?").get(name);
  } catch (_) {
    return false;
  }
}

function getConversationMeta(db, conversationId) {
  if (!conversationId) return null;
  try {
    return db.prepare(
      `SELECT c.id, c.project_id, c.user_id, p.industry, p.sub_industry
       FROM workspace_conversations c
       LEFT JOIN projects p ON p.id = c.project_id
       WHERE c.id = ?`
    ).get(conversationId);
  } catch (_) {
    return null;
  }
}

function getUserPlan(db, userId) {
  if (!userId) return { role: "user", isVip: false, vipExpiresAt: null };
  try {
    const cols = db.prepare("PRAGMA table_info(users)").all();
    const hasVip = cols.some((c) => c.name === "is_vip");
    const fields = hasVip ? "role, is_vip, vip_expires_at" : "role, 0 as is_vip, NULL as vip_expires_at";
    const u = db.prepare(`SELECT ${fields} FROM users WHERE id = ?`).get(userId);
    const isVip = !!u?.is_vip && (!u.vip_expires_at || new Date(u.vip_expires_at) > new Date());
    return { role: u?.role || "user", isVip, vipExpiresAt: u?.vip_expires_at || null };
  } catch (_) {
    return { role: "user", isVip: false, vipExpiresAt: null };
  }
}

function addDaysIso(base, days) {
  const d = base ? new Date(base) : new Date();
  if (Number.isNaN(d.getTime())) return new Date(Date.now() + days * 86400000).toISOString();
  return new Date(d.getTime() + days * 86400000).toISOString();
}

function computeArtifactExpiresAt({ db = getDb(), userId, kind = "upload", createdAt = null }) {
  const plan = getUserPlan(db, userId);
  if (plan.role === "admin") return null;
  if (plan.isVip) return null;
  if (kind === "upload") return addDaysIso(createdAt || new Date().toISOString(), FREE_UPLOAD_TTL_DAYS);
  return addDaysIso(createdAt || new Date().toISOString(), GENERATED_ARTIFACT_TTL_DAYS);
}

function computeLapsedVipUploadExpiresAt({ vipExpiresAt, createdAt }) {
  if (vipExpiresAt && new Date(vipExpiresAt) <= new Date()) {
    return addDaysIso(vipExpiresAt, FREE_UPLOAD_TTL_DAYS);
  }
  return addDaysIso(createdAt || new Date().toISOString(), FREE_UPLOAD_TTL_DAYS);
}

function refreshUploadRetention(db = getDb()) {
  const result = { updated: 0 };
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT a.id, a.kind, a.created_at, a.expires_at, c.user_id,
              u.role, u.is_vip, u.vip_expires_at
       FROM workspace_artifacts a
       JOIN workspace_conversations c ON c.id = a.conversation_id
       LEFT JOIN users u ON u.id = c.user_id
       WHERE a.kind = 'upload'`
    ).all();
  } catch (_) {
    return result;
  }

  const updateArtifact = db.prepare("UPDATE workspace_artifacts SET expires_at = ? WHERE id = ?");
  const hasDocs = tableExists(db, "workspace_documents");
  const updateDoc = hasDocs
    ? db.prepare("UPDATE workspace_documents SET expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE artifact_id = ?")
    : null;

  for (const row of rows) {
    const activeVip = row.role === "admin" || (!!row.is_vip && (!row.vip_expires_at || new Date(row.vip_expires_at) > new Date()));
    const next = activeVip
      ? null
      : computeLapsedVipUploadExpiresAt({ vipExpiresAt: row.vip_expires_at, createdAt: row.created_at });
    if ((row.expires_at || null) !== (next || null)) {
      updateArtifact.run(next, row.id);
      if (updateDoc) updateDoc.run(next, row.id);
      result.updated++;
    }
  }
  return result;
}

function evidenceLevelForSource(sourceType) {
  const s = sourceType || "";
  if (s === "upload_structured") return 1;
  if (s === "upload") return 2;
  if (s === "external_search") return 3;
  if (s === "project_context" || s === "institutional_memory") return 4;
  if (s === "bp_self_report") return 5;
  return 4;
}

function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const safe = String(text || "");
  if (!safe) return [];
  const paragraphs = safe.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let buffer = "";
  for (const p of paragraphs) {
    if ((buffer + "\n\n" + p).length <= chunkSize) {
      buffer = buffer ? `${buffer}\n\n${p}` : p;
      continue;
    }
    if (buffer) chunks.push(buffer);
    if (p.length <= chunkSize) {
      buffer = p;
    } else {
      buffer = "";
      for (let start = 0; start < p.length; start += chunkSize - overlap) {
        chunks.push(p.slice(start, start + chunkSize));
      }
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

function safeFtsQuery(query) {
  const tokens = String(query || "")
    .match(/[一-鿿㐀-䶿]|[a-zA-Z0-9_]+/g);
  if (!tokens || !tokens.length) return "";
  return tokens.slice(0, 12).map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}

function upsertUploadDocument({ db = getDb(), artifact, conversationId, userId, text, expiresAt }) {
  if (!artifact?.id || !conversationId || !tableExists(db, "workspace_documents")) return null;
  const meta = getConversationMeta(db, conversationId);
  const projectId = meta?.project_id || null;
  const effectiveUserId = userId || meta?.user_id || null;
  const docId = crypto.randomUUID();
  const rawText = String(text || "").slice(0, MAX_RAW_TEXT_CHARS);
  const industryTags = [meta?.industry, meta?.sub_industry].filter(Boolean);
  const finalExpiresAt = expiresAt ?? computeArtifactExpiresAt({
    db,
    userId: effectiveUserId,
    kind: "upload",
    createdAt: artifact.created_at,
  });

  const existing = db.prepare("SELECT document_id FROM workspace_documents WHERE artifact_id = ?").get(artifact.id);
  const documentId = existing?.document_id || docId;
  db.prepare(
    `INSERT INTO workspace_documents
       (document_id, project_id, conversation_id, artifact_id, user_id, file_name, raw_text,
        status, source_type, evidence_level, industry_tags, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', 'upload', 2, ?, ?)
     ON CONFLICT(artifact_id) DO UPDATE SET
       project_id = excluded.project_id,
       conversation_id = excluded.conversation_id,
       user_id = excluded.user_id,
       file_name = excluded.file_name,
       raw_text = excluded.raw_text,
       status = 'ready',
       evidence_level = 2,
       industry_tags = excluded.industry_tags,
       expires_at = excluded.expires_at,
       updated_at = CURRENT_TIMESTAMP`
  ).run(
    documentId,
    projectId,
    conversationId,
    artifact.id,
    effectiveUserId,
    artifact.filename || null,
    rawText,
    JSON.stringify(industryTags),
    finalExpiresAt,
  );

  if (tableExists(db, "workspace_chunks_fts")) {
    db.prepare("DELETE FROM workspace_chunks_fts WHERE document_id = ?").run(documentId);
    const insertChunk = db.prepare(
      `INSERT INTO workspace_chunks_fts
        (chunk_id, document_id, project_id, artifact_id, chunk_text, source_ref)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    chunkText(rawText).forEach((chunk, idx) => {
      insertChunk.run(
        `${documentId}:${idx + 1}`,
        documentId,
        projectId == null ? "" : String(projectId),
        artifact.id,
        chunk,
        `${artifact.filename || "upload"}#chunk-${idx + 1}`,
      );
    });
  }
  return { documentId, projectId, expiresAt: finalExpiresAt };
}

function replaceStructuredFactsForArtifact({ db = getDb(), artifactId, conversationId, projectId, flatFacts }) {
  if (!artifactId || !tableExists(db, "structured_facts")) return { count: 0 };
  const meta = getConversationMeta(db, conversationId);
  const finalProjectId = projectId || meta?.project_id || null;
  const doc = tableExists(db, "workspace_documents")
    ? db.prepare("SELECT document_id FROM workspace_documents WHERE artifact_id = ?").get(artifactId)
    : null;

  db.prepare("DELETE FROM structured_facts WHERE artifact_id = ?").run(artifactId);
  const stmt = db.prepare(
    `INSERT INTO structured_facts
      (fact_id, project_id, document_id, artifact_id, fact_type, field, label, value,
       fact_json, source_type, source_ref, evidence_level, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let count = 0;
  for (const fact of flatFacts || []) {
    const sourceType = fact.source_type || "upload_structured";
    const field = fact.field || "";
    stmt.run(
      crypto.randomUUID(),
      finalProjectId,
      doc?.document_id || null,
      artifactId,
      field.split(".").slice(0, 2).join(".") || "upload",
      field,
      fact.label || field,
      fact.value == null ? "" : String(fact.value),
      JSON.stringify(fact),
      sourceType,
      fact.source_ref || "",
      evidenceLevelForSource(sourceType),
      fact.confidence || "medium",
    );
    count++;
  }
  return { count, projectId: finalProjectId };
}

function listStructuredFactsForEvidencePack({ db = getDb(), projectId, conversationId, limit = 80 }) {
  if (!tableExists(db, "structured_facts")) return [];
  const params = [];
  let where = "";
  if (projectId) {
    where = "sf.project_id = ?";
    params.push(projectId);
  } else if (conversationId && tableExists(db, "workspace_documents")) {
    where = "d.conversation_id = ?";
    params.push(conversationId);
  } else {
    return [];
  }
  params.push(Math.max(1, Math.min(200, limit)));
  const rows = db.prepare(
    `SELECT sf.*, d.file_name
     FROM structured_facts sf
     LEFT JOIN workspace_documents d ON d.document_id = sf.document_id
     WHERE ${where}
     ORDER BY sf.evidence_level ASC, sf.updated_at DESC
     LIMIT ?`
  ).all(...params);
  return rows.map((r) => {
    let parsed = null;
    try { parsed = JSON.parse(r.fact_json); } catch (_) { parsed = null; }
    return {
      field: r.field,
      label: r.label || r.field,
      value: r.value,
      source_type: r.source_type,
      source_name: parsed?.source_name || `上传资料-${r.file_name || "结构化抽取"}`,
      source_ref: r.source_ref || "",
      source_url: "",
      artifact_id: r.artifact_id,
      filename: parsed?.filename || r.file_name || null,
      confidence: r.confidence || "medium",
      evidence_level: r.evidence_level,
    };
  });
}

function searchUploadExcerpts({ db = getDb(), projectId, conversationId, query, limit = 8 }) {
  if (!tableExists(db, "workspace_documents")) return [];
  const capped = Math.max(1, Math.min(20, limit));
  if (tableExists(db, "workspace_chunks_fts")) {
    const match = safeFtsQuery(query);
    if (match) {
      try {
        const rows = projectId
          ? db.prepare(
              `SELECT chunk_id, document_id, artifact_id, chunk_text, source_ref,
                      bm25(workspace_chunks_fts) AS score
               FROM workspace_chunks_fts
               WHERE workspace_chunks_fts MATCH ? AND project_id = ?
               ORDER BY score ASC LIMIT ?`
            ).all(match, String(projectId), capped)
          : db.prepare(
              `SELECT workspace_chunks_fts.chunk_id, workspace_chunks_fts.document_id,
                      workspace_chunks_fts.artifact_id, workspace_chunks_fts.chunk_text,
                      workspace_chunks_fts.source_ref, bm25(workspace_chunks_fts) AS score
               FROM workspace_chunks_fts
               JOIN workspace_documents d ON d.document_id = workspace_chunks_fts.document_id
               WHERE workspace_chunks_fts MATCH ? AND d.conversation_id = ?
               ORDER BY score ASC LIMIT ?`
            ).all(match, conversationId, capped);
        if (rows.length) return rows;
      } catch (_) {
        // FTS query syntax can be picky; fall back to latest upload chunks.
      }
    }
    try {
      return projectId
        ? db.prepare(
            `SELECT f.chunk_id, f.document_id, f.artifact_id, f.chunk_text, f.source_ref, 0 AS score
             FROM workspace_chunks_fts f
             JOIN workspace_documents d ON d.document_id = f.document_id
             WHERE d.project_id = ?
             ORDER BY d.updated_at DESC LIMIT ?`
          ).all(projectId, capped)
        : db.prepare(
            `SELECT f.chunk_id, f.document_id, f.artifact_id, f.chunk_text, f.source_ref, 0 AS score
             FROM workspace_chunks_fts f
             JOIN workspace_documents d ON d.document_id = f.document_id
             WHERE d.conversation_id = ?
             ORDER BY d.updated_at DESC LIMIT ?`
          ).all(conversationId, capped);
    } catch (_) {
      return [];
    }
  }
  const rows = projectId
    ? db.prepare(
        `SELECT document_id, artifact_id, raw_text AS chunk_text, file_name AS source_ref, 0 AS score
         FROM workspace_documents WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?`
      ).all(projectId, capped)
    : db.prepare(
        `SELECT document_id, artifact_id, raw_text AS chunk_text, file_name AS source_ref, 0 AS score
         FROM workspace_documents WHERE conversation_id = ? ORDER BY updated_at DESC LIMIT ?`
      ).all(conversationId, capped);
  return rows;
}

function deleteEvidenceForArtifact(db = getDb(), artifactId) {
  if (!artifactId) return;
  let docIds = [];
  if (tableExists(db, "workspace_documents")) {
    docIds = db.prepare("SELECT document_id FROM workspace_documents WHERE artifact_id = ?").all(artifactId);
  }
  if (tableExists(db, "workspace_chunks_fts")) {
    for (const d of docIds) db.prepare("DELETE FROM workspace_chunks_fts WHERE document_id = ?").run(d.document_id);
  }
  if (tableExists(db, "structured_facts")) {
    db.prepare("DELETE FROM structured_facts WHERE artifact_id = ?").run(artifactId);
  }
  if (tableExists(db, "workspace_documents")) {
    db.prepare("DELETE FROM workspace_documents WHERE artifact_id = ?").run(artifactId);
  }
  if (tableExists(db, "workspace_artifact_structured_extracts")) {
    db.prepare("DELETE FROM workspace_artifact_structured_extracts WHERE artifact_id = ?").run(artifactId);
  }
}

module.exports = {
  FREE_UPLOAD_TTL_DAYS,
  GENERATED_ARTIFACT_TTL_DAYS,
  computeArtifactExpiresAt,
  evidenceLevelForSource,
  refreshUploadRetention,
  upsertUploadDocument,
  replaceStructuredFactsForArtifact,
  listStructuredFactsForEvidencePack,
  searchUploadExcerpts,
  deleteEvidenceForArtifact,
  getConversationMeta,
  tableExists,
  _private: { chunkText, safeFtsQuery, computeLapsedVipUploadExpiresAt },
};
