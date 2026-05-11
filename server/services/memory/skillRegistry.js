const { getDb } = require("../../db");
const { MEMORY_LIMITS } = require("./constants");
const { uuid, safeJsonParse, json, clampText } = require("./utils");

function rowToSkill(row) {
  if (!row) return null;
  return {
    ...row,
    trigger: safeJsonParse(row.trigger, {}),
    required_inputs: safeJsonParse(row.required_inputs, []),
    steps: safeJsonParse(row.steps, []),
    success_criteria: safeJsonParse(row.success_criteria, []),
    failure_modes: safeJsonParse(row.failure_modes, []),
    created_from_run_ids: safeJsonParse(row.created_from_run_ids, []),
    success_rate: row.usage_count > 0 ? row.success_count / row.usage_count : 0,
  };
}

function matchSkills({ userId, taskType, userMessage = "", limit = MEMORY_LIMITS.skills.defaultQueryLimit }) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM workspace_skills
     WHERE status = 'active' AND (user_id IS NULL OR user_id = ?)
     ORDER BY user_id DESC, success_count DESC, usage_count DESC, updated_at DESC
     LIMIT ?`
  ).all(userId || null, limit * 5);
  const text = `${taskType || ""} ${userMessage}`.toLowerCase();
  return rows.map(rowToSkill)
    .filter((skill) => {
      const trigger = skill.trigger || {};
      const types = Array.isArray(trigger.task_type) ? trigger.task_type : [];
      const keywords = Array.isArray(trigger.keywords) ? trigger.keywords : [];
      return (
        types.length === 0 ||
        types.includes(taskType) ||
        keywords.some((k) => text.includes(String(k).toLowerCase()))
      );
    })
    .slice(0, limit);
}

function upsertSkill(skill) {
  const db = getDb();
  const id = skill.id || uuid();
  const name = clampText(skill.name, 80);
  if (!name) return null;
  const userScope = skill.user_id ? `user:${skill.user_id}` : "global";
  db.prepare(
    `INSERT INTO workspace_skills
      (id, user_id, user_scope, name, description, trigger, required_inputs, steps, success_criteria, failure_modes, created_from_run_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_scope, name) DO UPDATE SET
       description = excluded.description,
       trigger = excluded.trigger,
       required_inputs = excluded.required_inputs,
       steps = excluded.steps,
       success_criteria = excluded.success_criteria,
       failure_modes = excluded.failure_modes,
       version = workspace_skills.version + 1,
       status = 'active',
       updated_at = datetime('now')`
  ).run(
    id,
    skill.user_id || null,
    userScope,
    name,
    clampText(skill.description || "", 400),
    json(skill.trigger || {}),
    json(skill.required_inputs || []),
    json(skill.steps || []),
    json(skill.success_criteria || []),
    json(skill.failure_modes || []),
    json(skill.created_from_run_ids || [])
  );
  enforceSkillLimits(skill.user_id || null);
  return db.prepare("SELECT * FROM workspace_skills WHERE name = ? AND user_scope = ?").get(name, userScope);
}

function enforceSkillLimits(userId) {
  const db = getDb();
  const cap = userId ? MEMORY_LIMITS.skills.maxPrivateSkillsPerUser : MEMORY_LIMITS.skills.maxGlobalSkills;
  const rows = db.prepare(
    `SELECT id FROM workspace_skills
     WHERE status = 'active' AND user_scope = ?
     ORDER BY success_count ASC, usage_count ASC, updated_at ASC
     LIMIT -1 OFFSET ?`
  ).all(userId ? `user:${userId}` : "global", cap);
  for (const row of rows) db.prepare("UPDATE workspace_skills SET status = 'archived' WHERE id = ?").run(row.id);
}

function recordSkillUse(skillId, outcome = "used") {
  return getDb().prepare(
    `UPDATE workspace_skills
     SET usage_count = usage_count + 1,
         success_count = success_count + CASE WHEN ? = 'success' THEN 1 ELSE 0 END,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(outcome, skillId);
}

function maybeCreateSkillFromRun({ userId, taskType, userMessage = "", toolCalls = [], artifactResults = [], runId }) {
  const generated = artifactResults.some((r) => r.artifact);
  if (!generated || !["generate_pptx", "generate_docx", "generate_xlsx"].includes(taskType)) return null;
  const isOnePage = /一\s*页|1\s*页|one\s*page/i.test(userMessage);
  const tool = toolCalls.find((c) => c.tool)?.tool || taskType;
  const name = isOnePage && tool === "generate_pptx" ? "one_page_investment_ppt" : `${tool}_workspace_artifact`;
  return upsertSkill({
    user_id: userId,
    name,
    description: isOnePage ? "把复杂投资材料压缩成一页 PPT，并强制 slides.length = 1。" : "基于多 Agent 输出生成工作区文档产物。",
    trigger: {
      task_type: [taskType],
      keywords: isOnePage ? ["一页纸", "one page", "单页"] : ["生成", "导出"],
    },
    required_inputs: ["用户目标", "共享记忆证据", "专家结论"],
    steps: [
      { order: 1, action: "查询 Shared Context Memory 和 Long-term Memory" },
      { order: 2, action: "调度相关专家生成结构化要点" },
      { order: 3, action: "Host 调用文档工具生成 artifact", tool },
    ],
    success_criteria: isOnePage ? ["slides.length === 1", "包含投资建议", "包含核心风险"] : ["生成 artifact", "内容可下载"],
    failure_modes: ["只输出文字但没有 artifact", "页数不符合用户要求", "缺少风险或证据"],
    created_from_run_ids: runId ? [runId] : [],
  });
}

module.exports = {
  matchSkills,
  upsertSkill,
  recordSkillUse,
  maybeCreateSkillFromRun,
  rowToSkill,
};
