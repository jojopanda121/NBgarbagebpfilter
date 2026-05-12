// ============================================================
// server/skills/_projectContext.js
// 给 skill 用的统一项目上下文加载器。
// 输入:project(workspace_projects 行)
// 输出:压缩后的 JSON,供 LLM 输入或 skill 渲染用
//
// 数据来源(按优先级):
//   1) project_versions 最新一版的 core_metrics + claimed_*
//   2) latest_task_id → tasks.result(extracted_data + verdict + claim_verdicts + deep_research)
//   3) agent_runs / agent_results(多 agent 输出聚合)
// ============================================================

const { getDb } = require("../db");

function _safeParse(s, fb) {
  if (!s) return fb;
  try { return JSON.parse(s); } catch { return fb; }
}

/**
 * @param {object} project — projects 表行
 * @returns {object} 紧凑投研上下文
 */
function buildContext(project) {
  if (!project) return { project: null };
  const db = getDb();

  const versions = db.prepare(
    `SELECT * FROM project_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 5`
  ).all(project.id);
  const latestVersion = versions[0] || null;

  let task = null;
  let taskResult = null;
  if (project.latest_task_id) {
    task = db.prepare(
      `SELECT id, title, archive_number, total_score, adjusted_score, project_location, result, created_at
       FROM tasks WHERE id = ?`
    ).get(project.latest_task_id);
    if (task?.result) taskResult = _safeParse(task.result, null);
  }

  const extracted = taskResult?.extracted_data || {};
  const verdict = taskResult?.verdict || {};
  const claimVerdicts = Array.isArray(taskResult?.claim_verdicts) ? taskResult.claim_verdicts : [];
  const deepResearch = typeof taskResult?.deep_research === "string" ? taskResult.deep_research : "";

  // agent_results 多 agent 结构化输出(若 035 之后落了库)
  let agentOutputs = {};
  if (project.latest_run_id) {
    try {
      const rows = db.prepare(
        `SELECT agent_name, user_output FROM agent_results WHERE run_id = ?`
      ).all(project.latest_run_id);
      for (const r of rows) agentOutputs[r.agent_name] = _safeParse(r.user_output, {});
    } catch (_) { /* 表可能不存在,忽略 */ }
  }

  return {
    project: {
      id: project.id,
      name: project.name,
      one_liner: project.one_liner,
      industry: project.industry,
      sub_industry: project.sub_industry,
      business_model: project.business_model,
      stage: project.stage,
      region: project.region,
      status: project.status,
      latest_score: project.latest_score,
      founder_names: _safeParse(project.founder_names, []),
    },
    latest_version: latestVersion ? {
      version_number: latestVersion.version_number,
      claimed_valuation: latestVersion.claimed_valuation,
      claimed_revenue: latestVersion.claimed_revenue,
      claimed_users: latestVersion.claimed_users,
      funding_round: latestVersion.funding_round,
      funding_amount: latestVersion.funding_amount,
      total_score: latestVersion.total_score,
      core_metrics: _safeParse(latestVersion.core_metrics, []),
      uploaded_at: latestVersion.uploaded_at,
    } : null,
    task: task ? {
      id: task.id,
      title: task.title,
      total_score: task.adjusted_score ?? task.total_score,
      project_location: task.project_location,
    } : null,
    extracted_data: {
      company_name: extracted.company_name,
      industry: extracted.industry,
      product_name: extracted.product_name,
      Business_Model: extracted.Business_Model,
      Growth_Engine: extracted.Growth_Engine,
      Network_Effect: extracted.Network_Effect,
      TAM_Million_RMB: extracted.TAM_Million_RMB,
      CAGR: extracted.CAGR,
      TRL: extracted.TRL,
      BP_Valuation: extracted.BP_Valuation,
      BP_Revenue: extracted.BP_Revenue,
      Founder_Exp_Years: extracted.Founder_Exp_Years,
      project_location: extracted.project_location,
    },
    verdict: {
      grade: verdict.grade,
      grade_label: verdict.grade_label,
      total_score: verdict.total_score,
      strengths: verdict.strengths || [],
      risk_flags: verdict.risk_flags || [],
      valuation_comparison: verdict.valuation_comparison || null,
      dimensions: _compactDims(verdict.dimensions || {}),
    },
    claim_verdicts: claimVerdicts
      .filter((c) => ["夸大", "严重夸大", "信息不对称", "证伪", "存疑"].includes(c.verdict))
      .slice(0, 12)
      .map((c) => ({
        category: c.category,
        verdict: c.verdict,
        claim: c.original_claim || c.claim,
        diff: c.diff,
        severity: c.severity,
      })),
    deep_research_excerpt: deepResearch.length > 6000
      ? deepResearch.slice(0, 6000) + "\n...(已截断)"
      : deepResearch,
    agent_outputs: agentOutputs,
  };
}

function _compactDims(dims) {
  const out = {};
  for (const [k, v] of Object.entries(dims || {})) {
    if (!v) continue;
    out[k] = {
      score: v.score ?? null,
      finding: v.finding || "",
      positive_signals: (v.positive_signals || []).slice(0, 3),
      risk_factors: (v.risk_factors || []).slice(0, 3),
    };
  }
  return out;
}

module.exports = { buildContext };
