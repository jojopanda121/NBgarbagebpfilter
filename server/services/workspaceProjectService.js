// ============================================================
// server/services/workspaceProjectService.js
// Sprint 2: 项目工作台主服务
//
// 命名说明：现有 controllers/projectController.js 把单个 task 当作 project，
// 此处的 "workspace project" 是真正的项目容器（聚合多个 task 作为版本）。
// 所有查询都带 user_id 过滤（PRIVACY）。
// ============================================================

const { getDb } = require("../db");
const logger = require("../utils/logger");
const matchService = require("./projectMatchService");

const STATUS_FLOW = [
  "screening",
  "met",
  "shortlisted",
  "dd",
  "ic",
  "ts",
  "invested",
  "passed",
];

function _safeJsonParse(raw, fallback = null) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

/** 从 agent 输出聚合中提取项目元信息。 */
function _extractProjectMeta(agentOutputs = {}) {
  const summary = agentOutputs.project_summary || {};
  const founderOut = agentOutputs.founder || {};
  const valuation = agentOutputs.valuation || {};
  const financial = agentOutputs.financial || {};

  const founderList = Array.isArray(founderOut.founders)
    ? founderOut.founders
        .map((f) => (typeof f === "string" ? f : f && f.name) || null)
        .filter(Boolean)
    : [];

  return {
    projectName:
      summary.project_name ||
      summary.projectName ||
      summary.company_name ||
      summary.one_liner ||
      "未命名项目",
    oneLiner: summary.one_liner || summary.oneLiner || null,
    industry: summary.industry || null,
    subIndustry: summary.sub_industry || summary.subIndustry || null,
    businessModel: summary.business_model || summary.businessModel || null,
    stage: summary.stage || null,
    region: summary.region || null,
    founders: founderList,
    claimedValuation:
      valuation.claimed_valuation ||
      summary.claimed_valuation ||
      summary.valuation ||
      null,
    claimedRevenue:
      financial.claimed_revenue ||
      summary.claimed_revenue ||
      summary.revenue ||
      null,
    claimedUsers: summary.claimed_users || summary.users || null,
    fundingRound: summary.funding_round || summary.round || null,
    fundingAmount: summary.funding_amount || summary.amount || null,
    coreMetrics: summary.core_metrics || financial.core_metrics || [],
    score: agentOutputs.score || null,
  };
}

function addTimelineEntry({ projectId, userId, entryType, content, metadata }) {
  const db = getDb();
  db.prepare(
    `INSERT INTO project_notes (project_id, user_id, entry_type, content, metadata)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    projectId,
    userId,
    entryType,
    content,
    metadata ? JSON.stringify(metadata) : null
  );
}

function _nextVersionNumber(projectId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(version_number), 0) AS max_v
       FROM project_versions WHERE project_id = ?`
    )
    .get(projectId);
  return (row?.max_v || 0) + 1;
}

/**
 * 上传完成后：自动创建或挂载到现有项目，并写入版本快照。
 * @returns {{ projectId, versionNumber, isNew, confidence, matchScore }}
 */
function createOrAttachProject({
  userId,
  taskId,
  agentRunId,
  agentOutputs,
}) {
  const db = getDb();
  const meta = _extractProjectMeta(agentOutputs);

  const { matched, confidence, score } = matchService.findMatchingProject(
    userId,
    { projectName: meta.projectName, founders: meta.founders }
  );

  let projectId;
  let isNew = false;

  if (confidence === "auto_merge" && matched) {
    projectId = matched.id;
    db.prepare(
      `UPDATE projects
         SET latest_score = COALESCE(?, latest_score),
             latest_run_id = ?,
             latest_task_id = ?,
             one_liner = COALESCE(?, one_liner),
             industry = COALESCE(?, industry),
             sub_industry = COALESCE(?, sub_industry),
             business_model = COALESCE(?, business_model),
             stage = COALESCE(?, stage),
             region = COALESCE(?, region),
             updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`
    ).run(
      meta.score,
      agentRunId || null,
      taskId || null,
      meta.oneLiner,
      meta.industry,
      meta.subIndustry,
      meta.businessModel,
      meta.stage,
      meta.region,
      projectId,
      userId
    );
  } else {
    isNew = true;
    const result = db
      .prepare(
        `INSERT INTO projects
           (user_id, name, one_liner, industry, sub_industry, business_model,
            stage, region, founder_names, latest_score, latest_run_id, latest_task_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        meta.projectName,
        meta.oneLiner,
        meta.industry,
        meta.subIndustry,
        meta.businessModel,
        meta.stage,
        meta.region,
        JSON.stringify(meta.founders),
        meta.score,
        agentRunId || null,
        taskId || null
      );
    projectId = result.lastInsertRowid;
  }

  const versionNumber = _nextVersionNumber(projectId);

  db.prepare(
    `INSERT INTO project_versions
       (project_id, user_id, version_number, task_id, agent_run_id,
        claimed_valuation, claimed_revenue, claimed_users,
        funding_round, funding_amount, total_score, core_metrics)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    projectId,
    userId,
    versionNumber,
    taskId || null,
    agentRunId || null,
    meta.claimedValuation,
    meta.claimedRevenue,
    meta.claimedUsers,
    meta.fundingRound,
    meta.fundingAmount,
    meta.score,
    JSON.stringify(meta.coreMetrics || [])
  );

  if (taskId) {
    db.prepare(
      `UPDATE tasks
         SET workspace_project_id = ?, workspace_version_number = ?
       WHERE id = ?`
    ).run(projectId, versionNumber, taskId);
  }

  addTimelineEntry({
    projectId,
    userId,
    entryType: isNew ? "project_created" : "version_uploaded",
    content: isNew
      ? `项目 “${meta.projectName}” 创建`
      : `上传了第 ${versionNumber} 版 BP`,
    metadata: { versionNumber, agentRunId, taskId, matchScore: score },
  });

  logger.info("[WorkspaceProject] attach", {
    projectId,
    versionNumber,
    isNew,
    confidence,
    score,
  });

  return { projectId, versionNumber, isNew, confidence, matchScore: score };
}

function listByUser(userId, opts = {}) {
  const db = getDb();
  const { status, industry, includeArchived = false } = opts;
  let sql = `SELECT * FROM projects WHERE user_id = ?`;
  const params = [userId];
  if (!includeArchived) sql += ` AND is_archived = 0`;
  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }
  if (industry) {
    sql += ` AND industry = ?`;
    params.push(industry);
  }
  sql += ` ORDER BY updated_at DESC`;
  return db.prepare(sql).all(...params);
}

function getById(projectId, userId) {
  const db = getDb();
  // PRIVACY: 必须带 user_id 过滤
  const project = db
    .prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`)
    .get(projectId, userId);
  if (!project) return null;

  const versions = db
    .prepare(
      `SELECT * FROM project_versions
       WHERE project_id = ?
       ORDER BY version_number DESC`
    )
    .all(projectId);

  const timeline = db
    .prepare(
      `SELECT * FROM project_notes
       WHERE project_id = ?
       ORDER BY created_at DESC LIMIT 100`
    )
    .all(projectId);

  // 关联 tasks（每个版本的报告入口）
  const tasks = db
    .prepare(
      `SELECT id, status, total_score, project_stage, archive_number, title,
              created_at, updated_at
       FROM tasks
       WHERE workspace_project_id = ? AND user_id = ?
       ORDER BY workspace_version_number DESC`
    )
    .all(projectId, userId);

  return {
    ...project,
    founder_names: _safeJsonParse(project.founder_names, []),
    versions: versions.map((v) => ({
      ...v,
      core_metrics: _safeJsonParse(v.core_metrics, []),
    })),
    timeline: timeline.map((t) => ({
      ...t,
      metadata: _safeJsonParse(t.metadata, null),
    })),
    tasks,
  };
}

function updateStatus(projectId, userId, newStatus) {
  if (!STATUS_FLOW.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}`);
  }
  const db = getDb();
  const project = db
    .prepare(`SELECT id, status FROM projects WHERE id = ? AND user_id = ?`)
    .get(projectId, userId);
  if (!project) throw new Error("项目不存在或无权访问");

  const oldStatus = project.status;
  db.prepare(
    `UPDATE projects
       SET status = ?, status_changed_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`
  ).run(newStatus, projectId);

  addTimelineEntry({
    projectId,
    userId,
    entryType: "status_change",
    content: `状态：${oldStatus} → ${newStatus}`,
    metadata: { from: oldStatus, to: newStatus },
  });
  return { from: oldStatus, to: newStatus };
}

function updateBasic(projectId, userId, patch = {}) {
  const db = getDb();
  const allowed = [
    "name",
    "one_liner",
    "industry",
    "sub_industry",
    "business_model",
    "stage",
    "region",
    "next_action",
    "remind_at",
    "is_archived",
  ];
  const sets = [];
  const params = [];
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) {
      sets.push(`${k} = ?`);
      params.push(patch[k]);
    }
  }
  if (!sets.length) return { changed: 0 };
  sets.push(`updated_at = datetime('now')`);
  params.push(projectId, userId);
  const sql = `UPDATE projects SET ${sets.join(
    ", "
  )} WHERE id = ? AND user_id = ?`;
  const r = db.prepare(sql).run(...params);
  return { changed: r.changes };
}

function addNote(projectId, userId, content) {
  if (!content || !content.trim()) throw new Error("内容不能为空");
  // PRIVACY: 校验所有权
  const db = getDb();
  const exists = db
    .prepare(`SELECT id FROM projects WHERE id = ? AND user_id = ?`)
    .get(projectId, userId);
  if (!exists) throw new Error("项目不存在或无权访问");
  addTimelineEntry({
    projectId,
    userId,
    entryType: "note",
    content: content.trim(),
  });
  return { ok: true };
}

module.exports = {
  STATUS_FLOW,
  createOrAttachProject,
  listByUser,
  getById,
  updateStatus,
  updateBasic,
  addNote,
  addTimelineEntry,
  _extractProjectMeta, // exported for tests
};
