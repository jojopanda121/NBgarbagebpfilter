// ============================================================
// server/routes/skills.js — Skill 调用 + 历史 + Teaser 分享管理
// ============================================================

const { Router } = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { requireAuth } = require("../middleware/auth");
const { getDb } = require("../db");
const skills = require("../skills");
const teaserService = require("../services/teaserService");
const { recordFeatureUsage } = require("../services/featureUsageTracker");
const asyncHandler = require("../utils/asyncHandler");

skills.init();

const router = Router();

// 调用 LLM 的 skill 较贵,加个限流(每用户每分钟 30 次)
const skillRunLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (
    req.user?.id ? `u:${req.user.id}` : `ip:${ipKeyGenerator(req.ip)}`
  ),
  message: { error: "请求过于频繁,请稍后重试" },
});

// ── 列出所有 skill(配合前端渲染按钮) ───────────────────────
router.get("/", requireAuth, (_req, res) => {
  res.json({ skills: skills.registry.list() });
});

// ── 项目维度的 skill 历史 ──────────────────────────────────
router.get("/runs", requireAuth, (req, res) => {
  const { project_id, limit } = req.query;
  const userId = req.user.id;
  const db = getDb();

  if (project_id) {
    const proj = db.prepare(`SELECT id FROM projects WHERE id = ? AND user_id = ?`).get(project_id, userId);
    if (!proj) return res.status(404).json({ error: "项目不存在或无权访问" });
    const rows = db.prepare(
      `SELECT id, skill_id, status, error, duration_ms, created_at, finished_at, artifact_json
       FROM skill_runs WHERE project_id = ? AND user_id = ?
       ORDER BY created_at DESC LIMIT ?`
    ).all(project_id, userId, Math.min(parseInt(limit, 10) || 50, 200));
    return res.json({ runs: rows.map(_decodeRun) });
  }
  const rows = db.prepare(
    `SELECT id, skill_id, status, error, duration_ms, created_at, finished_at, artifact_json, project_id
     FROM skill_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(userId, Math.min(parseInt(limit, 10) || 50, 200));
  res.json({ runs: rows.map(_decodeRun) });
});

function _decodeRun(r) {
  let artifact = null;
  try { artifact = r.artifact_json ? JSON.parse(r.artifact_json) : null; } catch { /* ignore */ }
  // pptx base64 体积大,列表里裁掉
  if (artifact?.bufferBase64) artifact = { ...artifact, bufferBase64: undefined };
  return { ...r, artifact, artifact_json: undefined };
}

// ── 调用 skill ─────────────────────────────────────────────
router.post("/:skillId/run", requireAuth, skillRunLimiter, asyncHandler(async (req, res) => {
  const { skillId } = req.params;
  const { project_id, params = {} } = req.body || {};
  const userId = req.user.id;

  let project = null;
  if (project_id) {
    const db = getDb();
    project = db.prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`).get(project_id, userId);
    if (!project) return res.status(404).json({ error: "项目不存在或无权访问" });
  }

  let ctx = { userId };
  if (project) {
    try {
      const ws = require("../services/workspaceService");
      const conv = ws.createOrGetConversationByProject(project.id, userId);
      ctx = { ...ctx, conversationId: conv.id };
    } catch (_) {
      // 没有 conversation 时 skill 仍可返回 JSON/base64；不阻断执行。
    }
  }

  const startedAt = Date.now();
  const out = await skills.registry.execute({ skillId, params, project, userId, ctx });
  // 功能使用埋点（fire-and-forget）：技能按钮直接调用，区别于 host 对话中调用。
  recordFeatureUsage({
    userId,
    feature: skillId,
    source: "skill_button",
    status: out.ok ? "success" : "failed",
    durationMs: Date.now() - startedAt,
    projectId: project?.id || null,
  });
  if (!out.ok) return res.status(400).json(out);
  res.json(out);
}));

// ── 取一次 skill 运行的产物(用于异步/历史回看) ───────────
router.get("/runs/:runId", requireAuth, (req, res) => {
  const { runId } = req.params;
  const userId = req.user.id;
  const db = getDb();
  const row = db.prepare(
    `SELECT * FROM skill_runs WHERE id = ? AND user_id = ?`
  ).get(runId, userId);
  if (!row) return res.status(404).json({ error: "记录不存在" });
  res.json({ run: _decodeRun(row) });
});

// ── Teaser 分享管理(owner 视角) ──────────────────────────
router.get("/teaser/shares", requireAuth, (req, res) => {
  const { project_id } = req.query;
  if (!project_id) return res.status(400).json({ error: "缺少 project_id" });
  try {
    const list = teaserService.listSharesForProject(req.user.id, project_id);
    res.json({ shares: list });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

router.post("/teaser/shares/:token/revoke", requireAuth, (req, res) => {
  try {
    teaserService.revokeShare(req.user.id, req.params.token);
    res.json({ ok: true });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

router.get("/teaser/shares/:token/access-log", requireAuth, (req, res) => {
  try {
    res.json({ entries: teaserService.listAccessLog(req.user.id, req.params.token) });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

module.exports = router;
