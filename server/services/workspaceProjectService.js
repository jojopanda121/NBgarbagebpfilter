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
 * 上传完成后:按 confidence 走三档策略 — 见 projectMatchService.
 *   - auto_merge(≥0.92):静默挂到现有项目
 *   - suggest(0.5~0.92):新建项目 + 记一条 merge_suggestion(pending),让用户事后决定
 *   - create_new(<0.5):新建项目,什么都不记
 *
 * @returns {{ projectId, versionNumber, isNew, confidence, matchScore, suggestionId? }}
 */
function createOrAttachProject({
  userId,
  taskId,
  agentRunId,
  agentOutputs,
}) {
  const db = getDb();
  const meta = _extractProjectMeta(agentOutputs);

  const { matched, confidence, score, signals } = matchService.findMatchingProject(
    userId,
    { projectName: meta.projectName, founders: meta.founders }
  );

  let projectId;
  let isNew = false;
  let suggestionId = null;

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

    // suggest 档:记录待确认的合并建议 — 不静默合并,用户可在项目列表页一键接受/驳回
    if (confidence === "suggest" && matched) {
      const insRes = db.prepare(
        `INSERT INTO project_merge_suggestions
           (user_id, new_project_id, candidate_project_id, match_score, match_signals)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        userId, projectId, matched.id, score,
        signals ? JSON.stringify(signals) : null
      );
      suggestionId = insRes.lastInsertRowid;
      // 在新项目时间线里记一条,让用户在项目页直接看到
      addTimelineEntry({
        projectId,
        userId,
        entryType: "merge_suggested",
        content: `系统检测到与已有项目 "${matched.name}" 高度相似(${(score * 100).toFixed(0)}%),已挂在新项目下;请在项目列表确认是否合并。`,
        metadata: { candidate_project_id: matched.id, match_score: score, signals },
      });
    }
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

  return { projectId, versionNumber, isNew, confidence, matchScore: score, suggestionId };
}

// ── 合并建议 CRUD ─────────────────────────────────────────

function listPendingMergeSuggestions(userId) {
  const db = getDb();
  return db.prepare(
    `SELECT s.id, s.new_project_id, s.candidate_project_id, s.match_score, s.match_signals,
            s.created_at,
            np.name AS new_project_name,
            cp.name AS candidate_project_name,
            cp.industry AS candidate_industry,
            cp.stage AS candidate_stage
       FROM project_merge_suggestions s
       JOIN projects np ON np.id = s.new_project_id
       JOIN projects cp ON cp.id = s.candidate_project_id
      WHERE s.user_id = ? AND s.status = 'pending'
      ORDER BY s.created_at DESC`
  ).all(userId).map((r) => ({
    ...r,
    match_signals: _safeJsonParse(r.match_signals, null),
  }));
}

/**
 * 接受合并建议:把"新项目"的所有版本/笔记/task/对话挪到"候选项目"下,然后软删除新项目。
 * 全程在事务里,失败回滚。
 */
function acceptMergeSuggestion(userId, suggestionId) {
  const db = getDb();
  const sugg = db.prepare(
    `SELECT * FROM project_merge_suggestions WHERE id = ? AND user_id = ? AND status = 'pending'`
  ).get(suggestionId, userId);
  if (!sugg) throw new Error("建议不存在或已处理");

  const newProj = db.prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`).get(sugg.new_project_id, userId);
  const candidate = db.prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`).get(sugg.candidate_project_id, userId);
  if (!newProj || !candidate) throw new Error("项目已不存在,无法合并");

  const tx = db.transaction(() => {
    // 把新项目下的版本号在候选项目里续编
    const maxV = db.prepare(`SELECT COALESCE(MAX(version_number),0) AS v FROM project_versions WHERE project_id = ?`).get(candidate.id).v;
    const versions = db.prepare(`SELECT id, version_number FROM project_versions WHERE project_id = ?`).all(newProj.id);
    let next = maxV;
    for (const v of versions) {
      next++;
      db.prepare(`UPDATE project_versions SET project_id = ?, version_number = ? WHERE id = ?`).run(candidate.id, next, v.id);
    }
    // 关联的 tasks 也改回 candidate
    db.prepare(`UPDATE tasks SET workspace_project_id = ? WHERE workspace_project_id = ?`).run(candidate.id, newProj.id);
    // 笔记 / 时间线
    db.prepare(`UPDATE project_notes SET project_id = ? WHERE project_id = ?`).run(candidate.id, newProj.id);
    // 对话也挪过去
    db.prepare(`UPDATE workspace_conversations SET project_id = ? WHERE project_id = ?`).run(candidate.id, newProj.id);
    // skill_runs 也跟过去
    try { db.prepare(`UPDATE skill_runs SET project_id = ? WHERE project_id = ?`).run(candidate.id, newProj.id); } catch (_) {}
    // teaser shares
    try { db.prepare(`UPDATE teaser_shares SET project_id = ? WHERE project_id = ?`).run(candidate.id, newProj.id); } catch (_) {}
    // 用 newProj 的最新评分/任务覆盖 candidate(因为合并意味着 newProj 是更新一版)
    db.prepare(
      `UPDATE projects
         SET latest_score = COALESCE(?, latest_score),
             latest_run_id = COALESCE(?, latest_run_id),
             latest_task_id = COALESCE(?, latest_task_id),
             updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`
    ).run(newProj.latest_score, newProj.latest_run_id, newProj.latest_task_id, candidate.id, userId);
    // 软删除新项目
    db.prepare(`UPDATE projects SET is_archived = 1, updated_at = datetime('now') WHERE id = ?`).run(newProj.id);
    // 关闭建议
    db.prepare(`UPDATE project_merge_suggestions SET status='accepted', resolved_at=datetime('now'), resolved_by=? WHERE id = ?`).run(userId, suggestionId);
    // 在 candidate 时间线写一条
    addTimelineEntry({
      projectId: candidate.id,
      userId,
      entryType: "project_merged",
      content: `合并自 "${newProj.name}"(评分 ${newProj.latest_score ?? "—"},${versions.length} 版 BP)`,
      metadata: { merged_from: newProj.id, suggestion_id: suggestionId, match_score: sugg.match_score },
    });
  });
  tx();

  return { mergedInto: candidate.id, archivedProjectId: newProj.id };
}

function dismissMergeSuggestion(userId, suggestionId) {
  const db = getDb();
  const r = db.prepare(
    `UPDATE project_merge_suggestions
        SET status='dismissed', resolved_at=datetime('now'), resolved_by=?
      WHERE id = ? AND user_id = ? AND status = 'pending'`
  ).run(userId, suggestionId, userId);
  if (r.changes === 0) throw new Error("建议不存在或已处理");
  return { ok: true };
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
  listPendingMergeSuggestions,
  acceptMergeSuggestion,
  dismissMergeSuggestion,
  _extractProjectMeta, // exported for tests
};
