// ============================================================
// server/services/conflictJudge.js
//
// Optional AI Judge for multi-source structured facts. Rule conflicts in
// _factPack remain the fast path; this persists broader red flags for later
// review without blocking uploads or artifact generation.
// ============================================================

const crypto = require("crypto");
const { getDb } = require("../db");
const evidenceStore = require("./evidenceStore");

const SYSTEM = `你是 PE/VC 尽调里的证据冲突裁判。你只判断输入事实之间是否互相冲突、是否构成红旗。

硬性要求：
- 只输出 JSON。
- 不要补充输入中没有的事实。
- 冲突包括：同一字段数值差异明显、同一客户/合同状态互斥、估值/融资轮次不一致、合规状态互斥。
- 红旗包括：异常增长、单一客户依赖、合同多为 LOI/pipeline、现金跑道不足、诉讼/资质缺口。
- severity 只能是 low / medium / high / critical。
- 没有冲突时输出空数组。`;

const SCHEMA = {
  type: "object",
  required: ["conflicts"],
  additionalProperties: false,
  properties: {
    conflicts: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        required: ["field", "summary", "severity", "sources", "recommended_status"],
        additionalProperties: false,
        properties: {
          field: { type: "string", maxLength: 120 },
          summary: { type: "string", maxLength: 500 },
          severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
          sources: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: { type: "string", maxLength: 120 },
          },
          recommended_status: { type: "string", enum: ["open", "needs_review", "resolved"] },
        },
      },
    },
  },
};

function _hasTable(db, name) {
  return evidenceStore.tableExists(db, name);
}

function _loadCandidateFacts(db, projectId, limit = 80) {
  if (!projectId || !_hasTable(db, "structured_facts")) return [];
  return db.prepare(
    `SELECT fact_id, field, label, value, source_ref, artifact_id, confidence, evidence_level, updated_at
     FROM structured_facts
     WHERE project_id = ?
     ORDER BY evidence_level ASC, updated_at DESC
     LIMIT ?`
  ).all(projectId, limit);
}

function _upsertConflicts(db, projectId, conflicts) {
  if (!_hasTable(db, "conflicts")) return 0;
  db.prepare("DELETE FROM conflicts WHERE project_id = ? AND status IN ('open', 'needs_review')").run(projectId);
  const stmt = db.prepare(
    `INSERT INTO conflicts
      (conflict_id, project_id, field, sources, severity, status, conflict_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  let count = 0;
  for (const c of conflicts || []) {
    stmt.run(
      crypto.randomUUID(),
      projectId,
      c.field || "unknown",
      JSON.stringify(c.sources || []),
      c.severity || "medium",
      c.recommended_status || "open",
      JSON.stringify(c),
    );
    count++;
  }
  return count;
}

async function runConflictJudgeForProject({ projectId, db = getDb() }) {
  if (!projectId) return { ok: false, skipped: "missing_project_id", count: 0 };
  const facts = _loadCandidateFacts(db, projectId);
  if (facts.length < 2) return { ok: true, skipped: "not_enough_facts", count: 0 };

  const { callLLMJson } = require("./llmService");
  const userMsg = [
    "【项目结构化事实】",
    JSON.stringify(facts.map((f) => ({
      id: f.fact_id,
      field: f.field,
      label: f.label,
      value: f.value,
      source_ref: f.source_ref,
      artifact_id: f.artifact_id,
      confidence: f.confidence,
      evidence_level: f.evidence_level,
    })), null, 2),
    "",
    "请找出冲突事实和红旗信号。",
  ].join("\n");

  const out = await callLLMJson(SYSTEM, userMsg, SCHEMA, {
    maxTokens: 4096,
    maxRepairs: 1,
    skillId: "conflict_judge",
    taskHint: "semantic_audit",
  });
  const count = _upsertConflicts(db, projectId, out.data.conflicts || []);
  return { ok: true, count, repairs: out.repairs };
}

module.exports = {
  runConflictJudgeForProject,
  _private: { _loadCandidateFacts, _upsertConflicts, SCHEMA },
};
