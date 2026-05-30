// ============================================================
// server/routes/skillReview.js
//
// 管理员审核 Hermes curator 提交的跨用户共享技能/知识。
//
// 挂载在 /api/admin/skill-review/ 下（在 admin.js 引入）。
//
// 端点：
//   GET    /                 列表（默认筛 needs_human / pending）
//   GET    /:id              详情
//   POST   /:id/approve      admin 批准 → 写入目标表，status=published
//   POST   /:id/reject       admin 拒绝
//   GET    /stats            审核状态统计
// ============================================================

const { Router } = require("express");
const { getDb } = require("../db");
const adminController = require("../controllers/adminController");

const router = Router();

router.use(adminController.requireAdmin);

router.get("/stats", (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT status, target_table, COUNT(*) AS n
      FROM shared_skill_approvals
      GROUP BY status, target_table
    `).all();
    res.json({ counts: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/", (req, res) => {
  try {
    const db = getDb();
    const status = req.query.status || null;
    const target = req.query.target || null;
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
    const where = [];
    const params = [];
    if (status) { where.push("status = ?"); params.push(status); }
    if (target) { where.push("target_table = ?"); params.push(target); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    params.push(limit);
    const rows = db.prepare(`
      SELECT id, target_table, status, reviewer_verdict, reviewer_risk_tags,
             source_run_ids, admin_user_id, admin_decision_at,
             created_at, updated_at
      FROM shared_skill_approvals
      ${whereSql}
      ORDER BY id DESC
      LIMIT ?
    `).all(...params);
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM shared_skill_approvals WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: "审核条目不存在" });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

router.post("/:id/approve", (req, res) => {
  const adminId = req.user.id;
  try {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM shared_skill_approvals WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: "审核条目不存在" });
    if (row.status === "published" || row.status === "rejected") {
      return res.status(409).json({ error: `条目状态为 ${row.status}，无法批准` });
    }

    const payload = safeJson(row.candidate_payload, {});
    let publishedId = null;

    if (row.target_table === "workspace_skills") {
      const stmt = db.prepare(`
        INSERT INTO workspace_skills
          (user_id, name, description, trigger, required_inputs, steps,
           success_criteria, failure_modes, status, version,
           created_at, updated_at)
        VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 'active', 1,
                datetime('now'), datetime('now'))
      `);
      const r = stmt.run(
        payload.name || "未命名共享技能",
        payload.description || "",
        JSON.stringify(payload.trigger || {}),
        JSON.stringify(payload.required_inputs || []),
        JSON.stringify(payload.steps || []),
        JSON.stringify(payload.success_criteria || []),
        JSON.stringify(payload.failure_modes || []),
      );
      publishedId = r.lastInsertRowid;
    } else if (row.target_table === "institutional_memory") {
      const r = db.prepare(`
        INSERT INTO institutional_memory
          (title, body, industry, business_model, stage, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'active', datetime('now'))
      `).run(
        payload.title || "未命名共享知识",
        payload.body || "",
        payload.industry || null,
        payload.business_model || null,
        payload.stage || null,
      );
      publishedId = r.lastInsertRowid;
    }

    db.prepare(`
      UPDATE shared_skill_approvals
      SET status = 'published',
          admin_user_id = ?, admin_decision_at = datetime('now'),
          admin_notes = ?, published_target_id = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(adminId, req.body?.notes || null, publishedId, row.id);

    res.json({ ok: true, published_target_id: publishedId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/reject", (req, res) => {
  const adminId = req.user.id;
  try {
    const db = getDb();
    const row = db.prepare(`SELECT id, status FROM shared_skill_approvals WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: "审核条目不存在" });
    if (row.status === "published" || row.status === "rejected") {
      return res.status(409).json({ error: `条目状态为 ${row.status}，无法再次拒绝` });
    }
    getDb().prepare(`
      UPDATE shared_skill_approvals
      SET status = 'rejected',
          admin_user_id = ?, admin_decision_at = datetime('now'),
          admin_notes = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(adminId, req.body?.notes || null, row.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
