// ============================================================
// server/controllers/projectController.js — 项目管理控制器
//
// 将每个 BP 分析结果作为可持续跟踪的"项目"管理：
//   - 项目阶段流转
//   - 备注、标签、跟进日期
//   - 尽调问卷生成/答案保存/重新评分
//   - IMemo 生成
// ============================================================

const { getDb } = require("../db");
const { getTask } = require("../services/taskService");
const { generateDDQuestionnaire, saveDDAnswers, rescoreAfterDD } = require("../services/ddService");
const { getOrGenerateIMemo, regenerateIMemo } = require("../services/iMemoService");

// 合法的项目阶段枚举
const VALID_STAGES = ["new", "reviewed", "dd_pending", "dd_in_progress", "dd_done", "decided", "passed", "rejected"];

/**
 * 权限检查：只有项目 owner 或 admin 可以操作
 */
function checkOwner(task, userId, db) {
  if (!task) return "任务不存在";
  const userRow = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  const isAdmin = userRow?.role === "admin";
  if (task.user_id !== userId && !isAdmin) return "无权操作此项目";
  return null;
}

/** GET /api/projects/:taskId — 获取项目完整信息 */
function getProject(req, res) {
  const { taskId } = req.params;
  const userId = req.user.id;
  const db = getDb();

  const task = getTask(taskId);
  const err = checkOwner(task, userId, db);
  if (err) return res.status(err === "任务不存在" ? 404 : 403).json({ error: err });

  // 解析 result JSON
  let result = null;
  try {
    result = typeof task.result === "string" ? JSON.parse(task.result) : task.result;
  } catch {}

  // 解析 dd_questionnaire / dd_answers
  let ddQuestionnaire = null;
  let ddAnswers = null;
  try { ddQuestionnaire = task.dd_questionnaire ? JSON.parse(task.dd_questionnaire) : null; } catch {}
  try { ddAnswers = task.dd_answers ? JSON.parse(task.dd_answers) : null; } catch {}
  let tags = null;
  try { tags = task.project_tags ? JSON.parse(task.project_tags) : []; } catch {}

  res.json({
    id: task.id,
    archive_number: task.archive_number,
    title: task.title,
    industry: result?.industry || null,
    industry_category: task.industry_category,
    project_location: task.project_location,
    status: task.status,
    total_score: task.total_score,
    adjusted_score: task.adjusted_score ?? null,
    project_stage: task.project_stage || "new",
    project_notes: task.project_notes || "",
    project_tags: tags || [],
    next_followup_date: task.next_followup_date || null,
    dd_questionnaire: ddQuestionnaire,
    dd_answers: ddAnswers,
    created_at: task.created_at,
    updated_at: task.updated_at,
    result,
  });
}

/** PUT /api/projects/:taskId/stage — 更新投资流程阶段 */
function updateStage(req, res) {
  const { taskId } = req.params;
  const { stage } = req.body;
  const userId = req.user.id;
  const db = getDb();

  if (!VALID_STAGES.includes(stage)) {
    return res.status(400).json({ error: `无效的阶段值，合法值：${VALID_STAGES.join(", ")}` });
  }

  const task = getTask(taskId);
  const err = checkOwner(task, userId, db);
  if (err) return res.status(err === "任务不存在" ? 404 : 403).json({ error: err });

  db.prepare("UPDATE tasks SET project_stage = ?, updated_at = datetime('now') WHERE id = ?")
    .run(stage, taskId);

  res.json({ success: true, project_stage: stage });
}

/** PUT /api/projects/:taskId/notes — 保存项目备注 */
function updateNotes(req, res) {
  const { taskId } = req.params;
  const { notes } = req.body;
  const userId = req.user.id;
  const db = getDb();

  const task = getTask(taskId);
  const err = checkOwner(task, userId, db);
  if (err) return res.status(err === "任务不存在" ? 404 : 403).json({ error: err });

  db.prepare("UPDATE tasks SET project_notes = ?, updated_at = datetime('now') WHERE id = ?")
    .run(notes || "", taskId);

  res.json({ success: true });
}

/** PUT /api/projects/:taskId/tags — 更新标签 */
function updateTags(req, res) {
  const { taskId } = req.params;
  const { tags } = req.body;
  const userId = req.user.id;
  const db = getDb();

  if (!Array.isArray(tags)) {
    return res.status(400).json({ error: "tags 必须是数组" });
  }

  const task = getTask(taskId);
  const err = checkOwner(task, userId, db);
  if (err) return res.status(err === "任务不存在" ? 404 : 403).json({ error: err });

  db.prepare("UPDATE tasks SET project_tags = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(tags), taskId);

  res.json({ success: true, tags });
}

/** PUT /api/projects/:taskId/location — 更新项目所在省份 */
function updateLocation(req, res) {
  const { taskId } = req.params;
  const { location } = req.body;
  const userId = req.user.id;
  const db = getDb();

  const task = getTask(taskId);
  const err = checkOwner(task, userId, db);
  if (err) return res.status(err === "任务不存在" ? 404 : 403).json({ error: err });

  const value = (location && location !== "未知") ? location : null;
  db.prepare("UPDATE tasks SET project_location = ?, updated_at = datetime('now') WHERE id = ?")
    .run(value, taskId);

  res.json({ success: true, project_location: value });
}

/** PUT /api/projects/:taskId/followup — 设置下次跟进日期 */
function updateFollowup(req, res) {
  const { taskId } = req.params;
  const { date } = req.body;
  const userId = req.user.id;
  const db = getDb();

  const task = getTask(taskId);
  const err = checkOwner(task, userId, db);
  if (err) return res.status(err === "任务不存在" ? 404 : 403).json({ error: err });

  db.prepare("UPDATE tasks SET next_followup_date = ?, updated_at = datetime('now') WHERE id = ?")
    .run(date || null, taskId);

  res.json({ success: true, next_followup_date: date || null });
}

/** POST /api/projects/:taskId/dd/start — 开启尽调（生成问卷，幂等，设置阶段） */
async function startDD(req, res) {
  const { taskId } = req.params;
  const userId = req.user.id;
  const db = getDb();

  const task = getTask(taskId);
  const err = checkOwner(task, userId, db);
  if (err) return res.status(err === "任务不存在" ? 404 : 403).json({ error: err });

  if (task.status !== "complete") {
    return res.status(400).json({ error: "只能对已完成分析的项目开启尽调" });
  }

  try {
    const questionnaire = await generateDDQuestionnaire(taskId);

    // 设置阶段为 dd_pending（若已在更高阶段则不降级）
    const currentStage = task.project_stage || "new";
    const ddStages = ["dd_pending", "dd_in_progress", "dd_done"];
    if (!ddStages.includes(currentStage)) {
      db.prepare("UPDATE tasks SET project_stage = ?, updated_at = datetime('now') WHERE id = ?")
        .run("dd_pending", taskId);
    }

    res.json({
      success: true,
      questionnaire,
      project_stage: ddStages.includes(currentStage) ? currentStage : "dd_pending",
    });
  } catch (e) {
    console.error("[projectController] startDD 失败:", e.message);
    res.status(500).json({ error: "生成尽调问卷失败：" + e.message });
  }
}

/** PUT /api/projects/:taskId/dd/answers — 保存尽调答案（随时可保存） */
function saveDDAnswersHandler(req, res) {
  const { taskId } = req.params;
  const { answers } = req.body;
  const userId = req.user.id;
  const db = getDb();

  if (!answers || typeof answers !== "object") {
    return res.status(400).json({ error: "answers 必须是对象" });
  }

  const task = getTask(taskId);
  const err = checkOwner(task, userId, db);
  if (err) return res.status(err === "任务不存在" ? 404 : 403).json({ error: err });

  // 校验答案值
  const validChoices = ["A", "B", "C"];
  for (const [k, v] of Object.entries(answers)) {
    if (isNaN(parseInt(k))) return res.status(400).json({ error: `答案 key 必须是数字索引` });
    if (!validChoices.includes(v)) return res.status(400).json({ error: `答案值必须是 A/B/C` });
  }

  try {
    const merged = saveDDAnswers(taskId, answers);

    // 更新阶段为 dd_in_progress
    const currentStage = task.project_stage || "new";
    if (currentStage === "dd_pending") {
      db.prepare("UPDATE tasks SET project_stage = ?, updated_at = datetime('now') WHERE id = ?")
        .run("dd_in_progress", taskId);
    }

    res.json({ success: true, answers: merged });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/** POST /api/projects/:taskId/dd/rescore — 重新评分（纯 JS） */
function rescoreHandler(req, res) {
  const { taskId } = req.params;
  const userId = req.user.id;
  const db = getDb();

  const task = getTask(taskId);
  const err = checkOwner(task, userId, db);
  if (err) return res.status(err === "任务不存在" ? 404 : 403).json({ error: err });

  try {
    const result = rescoreAfterDD(taskId);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

/** GET /api/projects/:taskId/imemo — 获取 IMemo */
function getIMemo(req, res) {
  const { taskId } = req.params;
  const userId = req.user.id;
  const db = getDb();

  const task = getTask(taskId);
  const err = checkOwner(task, userId, db);
  if (err) return res.status(err === "任务不存在" ? 404 : 403).json({ error: err });

  if (task.status !== "complete") {
    return res.status(400).json({ error: "报告未完成，无法生成 IMemo" });
  }

  try {
    const memo = getOrGenerateIMemo(taskId);
    res.json(memo);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/** POST /api/projects/:taskId/imemo/regenerate — 强制重新生成 IMemo */
function regenerateIMemoHandler(req, res) {
  const { taskId } = req.params;
  const userId = req.user.id;
  const db = getDb();

  const task = getTask(taskId);
  const err = checkOwner(task, userId, db);
  if (err) return res.status(err === "任务不存在" ? 404 : 403).json({ error: err });

  try {
    const memo = regenerateIMemo(taskId);
    res.json(memo);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  getProject,
  updateStage,
  updateLocation,
  updateNotes,
  updateTags,
  updateFollowup,
  startDD,
  saveDDAnswersHandler,
  rescoreHandler,
  getIMemo,
  regenerateIMemoHandler,
};
