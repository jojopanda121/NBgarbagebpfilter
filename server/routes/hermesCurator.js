// ============================================================
// server/routes/hermesCurator.js
//
// Hermes curator / reviewer 的反向 callback 端点。
//
// 挂载在 /api/hermes/curator/ 下（在 hermesTools 同一 prefix）。
//
// 端点：
//   POST /submit    Hermes memory_curator skill 提交候选
//   POST /review    Hermes skill_reviewer skill 提交自动审核结果
//
// 默认 OFF：HERMES_SHARED_LEARNING=off 时所有端点返回 403。
// ============================================================

const { Router } = require("express");
const { getDb } = require("../db");
const { flags } = require("../config/featureFlags");

const router = Router();

function requireHermesAuth(req, res, next) {
  if (!flags.hermesApiKey) {
    return res.status(500).json({ ok: false, error: { reason: "config", message: "HERMES_API_KEY 未配置" } });
  }
  const header = req.get("authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  const provided = m ? m[1].trim() : null;
  if (!provided || provided !== flags.hermesApiKey) {
    return res.status(401).json({ ok: false, error: { reason: "auth_failed" } });
  }
  next();
}

function requireSharedLearning(req, res, next) {
  if (!flags.hermesSharedLearning) {
    return res.status(403).json({
      ok: false,
      error: { reason: "shared_learning_disabled", message: "HERMES_SHARED_LEARNING=off" },
    });
  }
  next();
}

router.use(requireHermesAuth);
router.use(requireSharedLearning);

// curator 提交候选
router.post("/submit", (req, res) => {
  try {
    const body = req.body || {};
    const target = body.target_table;
    if (!["workspace_skills", "institutional_memory"].includes(target)) {
      return res.status(400).json({ ok: false, error: { reason: "bad_target_table" } });
    }
    if (!body.candidate_payload || typeof body.candidate_payload !== "object") {
      return res.status(400).json({ ok: false, error: { reason: "missing_payload" } });
    }
    const sourceRunIds = Array.isArray(body.source_run_ids) ? body.source_run_ids : [];

    const db = getDb();
    const r = db.prepare(`
      INSERT INTO shared_skill_approvals
        (target_table, candidate_payload, source_run_ids, status, reviewer_verdict)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(
      target,
      JSON.stringify(body.candidate_payload),
      JSON.stringify(sourceRunIds),
      body.rationale ? String(body.rationale).slice(0, 1000) : null,
    );
    res.json({ ok: true, approval_id: r.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ ok: false, error: { reason: "internal", message: err.message } });
  }
});

// reviewer 提交审核结果
router.post("/review", (req, res) => {
  try {
    const body = req.body || {};
    const id = parseInt(body.approval_id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: { reason: "missing_approval_id" } });
    }
    const verdictMap = {
      auto_approve: "auto_approved",
      needs_human: "needs_human",
      reject: "rejected",
    };
    const newStatus = verdictMap[body.verdict];
    if (!newStatus) {
      return res.status(400).json({ ok: false, error: { reason: "bad_verdict" } });
    }

    const db = getDb();
    const row = db.prepare(`SELECT id, status FROM shared_skill_approvals WHERE id = ?`).get(id);
    if (!row) return res.status(404).json({ ok: false, error: { reason: "not_found" } });
    if (row.status !== "pending") {
      return res.status(409).json({ ok: false, error: { reason: "already_reviewed", current: row.status } });
    }

    const riskTags = Array.isArray(body.risk_tags) ? body.risk_tags : [];
    db.prepare(`
      UPDATE shared_skill_approvals
      SET status = ?,
          reviewer_verdict = ?,
          reviewer_risk_tags = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      newStatus,
      body.rationale ? String(body.rationale).slice(0, 1000) : null,
      JSON.stringify(riskTags),
      id,
    );
    res.json({ ok: true, status: newStatus });
  } catch (err) {
    res.status(500).json({ ok: false, error: { reason: "internal", message: err.message } });
  }
});

module.exports = router;
