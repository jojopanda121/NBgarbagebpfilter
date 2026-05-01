// ============================================================
// server/services/dataLakeService.js — 数据飞轮沉淀服务
// 将 multiagent 结构化输出写入各数据库表
// ============================================================

const { getDb } = require("../db");
const logger = require("../utils/logger");

/**
 * 沉淀项目摘要数据到 projects_datalake
 */
function sinkProjectSummary({ taskId, userId, agentResult, score, isAnonymized = 1 }) {
  if (!agentResult || agentResult.partial) return;
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO projects_datalake
        (task_id, user_id, company_name, industry, sub_industry, business_model,
         stage, region, claimed_valuation, claimed_revenue, claimed_users,
         funding_round, funding_amount, score, is_anonymized)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      taskId,
      userId || null,
      agentResult.company_name || null,
      agentResult.industry || null,
      agentResult.sub_industry || null,
      agentResult.business_model || null,
      agentResult.stage || null,
      agentResult.region || null,
      agentResult.claimed_valuation_rmb || 0,
      agentResult.claimed_revenue_rmb || 0,
      agentResult.claimed_users || 0,
      agentResult.funding_round || null,
      agentResult.funding_amount_rmb || 0,
      score || null,
      isAnonymized
    );
    logger.info("[DataLake] projects_datalake 写入成功", { taskId });
  } catch (err) {
    logger.warn("[DataLake] projects_datalake 写入失败:", err.message);
  }
}

/**
 * 沉淀创始人数据到 founders_datalake
 * PRIVACY: name/email/phone 均已在 founderAgent 中 hash/加密，此处直接存入
 */
function sinkFounderData({ taskId, agentResult }) {
  if (!agentResult || agentResult.partial || !Array.isArray(agentResult.founders)) return;
  try {
    const db = getDb();
    const insert = db.prepare(`
      INSERT INTO founders_datalake
        (task_id, name_hash, phone_hash, email_hash, full_name_encrypted,
         past_companies, past_projects, risk_flags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const f of agentResult.founders) {
      // PRIVACY: email_hashes 和 phone_hashes 数组取第一个作为主 hash
      insert.run(
        taskId,
        f.full_name_encrypted ? f.full_name_encrypted.slice(0, 64) : null,
        f.phone_hashes?.[0] || null,
        f.email_hashes?.[0] || null,
        f.full_name_encrypted || null,
        JSON.stringify(f.past_companies || []),
        JSON.stringify(f.past_projects || []),
        JSON.stringify(f.risk_flags || agentResult.team_risk_flags || [])
      );
    }
    logger.info("[DataLake] founders_datalake 写入成功", { taskId, count: agentResult.founders.length });
  } catch (err) {
    logger.warn("[DataLake] founders_datalake 写入失败:", err.message);
  }
}

/**
 * 沉淀财务异常数据到 financial_anomalies
 */
function sinkFinancialAnomalies({ taskId, agentResult, industry, stage }) {
  if (!agentResult || agentResult.partial || !Array.isArray(agentResult.anomalies)) return;
  try {
    const db = getDb();
    const insert = db.prepare(`
      INSERT INTO financial_anomalies (task_id, anomaly_type, description, severity, industry, stage)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const anomaly of agentResult.anomalies) {
      insert.run(
        taskId,
        anomaly.anomaly_type || "unknown",
        anomaly.description || "",
        anomaly.severity || 1,
        industry || null,
        stage || null
      );
    }
    logger.info("[DataLake] financial_anomalies 写入成功", { taskId, count: agentResult.anomalies.length });
  } catch (err) {
    logger.warn("[DataLake] financial_anomalies 写入失败:", err.message);
  }
}

/**
 * 沉淀竞品数据到 competitors_datalake
 */
function sinkCompetitors({ taskId, agentResult, industry }) {
  if (!agentResult || agentResult.partial || !Array.isArray(agentResult.competitors)) return;
  try {
    const db = getDb();
    const insert = db.prepare(`
      INSERT INTO competitors_datalake
        (task_id, subject_industry, competitor_name, funding_stage,
         valuation_usd, team_size, founded_year, latest_news)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of agentResult.competitors) {
      // 将团队规模范围转为中间值整数
      let teamSize = null;
      if (c.team_size_range) {
        const nums = c.team_size_range.match(/\d+/g);
        if (nums && nums.length >= 2) teamSize = Math.round((parseInt(nums[0]) + parseInt(nums[1])) / 2);
        else if (nums && nums.length === 1) teamSize = parseInt(nums[0]);
      }
      insert.run(
        taskId,
        industry || null,
        c.name || null,
        c.funding_stage || null,
        c.estimated_valuation_usd || null,
        teamSize,
        c.founded_year || null,
        c.key_differentiator || null
      );
    }
    logger.info("[DataLake] competitors_datalake 写入成功", { taskId, count: agentResult.competitors.length });
  } catch (err) {
    logger.warn("[DataLake] competitors_datalake 写入失败:", err.message);
  }
}

/**
 * 沉淀风险模式到 risk_patterns
 */
function sinkRiskPatterns({ taskId, agentResult }) {
  if (!agentResult || agentResult.partial || !Array.isArray(agentResult.red_flags)) return;
  try {
    const db = getDb();
    const insert = db.prepare(`
      INSERT INTO risk_patterns (task_id, pattern_type, description, severity)
      VALUES (?, ?, ?, ?)
    `);
    for (const flag of agentResult.red_flags) {
      insert.run(
        taskId,
        flag.flag_type || "unknown",
        flag.description || "",
        flag.severity || 1
      );
    }
    logger.info("[DataLake] risk_patterns 写入成功", { taskId, count: agentResult.red_flags.length });
  } catch (err) {
    logger.warn("[DataLake] risk_patterns 写入失败:", err.message);
  }
}

/**
 * 沉淀行业 benchmark 数据到 industry_benchmarks
 */
function sinkIndustryBenchmarks({ taskId, agentResult, industry, stage }) {
  if (!agentResult || agentResult.partial) return;
  try {
    const db = getDb();
    const insert = db.prepare(`
      INSERT INTO industry_benchmarks (task_id, industry, stage, metric_type, metric_value)
      VALUES (?, ?, ?, ?, ?)
    `);
    const industryKey = industry || null;
    const stageKey = stage || null;

    const claimed = agentResult.claimed_valuation_rmb;
    if (claimed && claimed > 0) {
      insert.run(taskId, industryKey, stageKey, "valuation", claimed);
    }
    const ba = agentResult.benchmark_analysis;
    if (ba?.industry_avg_ps_multiple) {
      insert.run(taskId, industryKey, stageKey, "ps_multiple", ba.industry_avg_ps_multiple);
    }
  } catch (err) {
    logger.warn("[DataLake] industry_benchmarks 写入失败:", err.message);
  }
}

/**
 * 主入口：multiagent 完成后统一写入所有数据库表
 */
function sinkAllAgentData({ taskId, userId, multiagent, score, isAnonymized = 1 }) {
  if (!multiagent) return;

  const industry = multiagent.project_summary?.industry || null;
  const stage = multiagent.project_summary?.stage || null;

  sinkProjectSummary({ taskId, userId, agentResult: multiagent.project_summary, score, isAnonymized });
  sinkFounderData({ taskId, agentResult: multiagent.founder_profile });
  sinkFinancialAnomalies({ taskId, agentResult: multiagent.financial_analysis, industry, stage });
  sinkCompetitors({ taskId, agentResult: multiagent.competitor_analysis, industry });
  sinkRiskPatterns({ taskId, agentResult: multiagent.red_flags });
  sinkIndustryBenchmarks({ taskId, agentResult: multiagent.valuation_analysis, industry, stage });

  logger.info("[DataLake] 全部数据沉淀完成", { taskId });
}

module.exports = {
  sinkAllAgentData,
  sinkProjectSummary,
  sinkFounderData,
  sinkFinancialAnomalies,
  sinkCompetitors,
  sinkRiskPatterns,
  sinkIndustryBenchmarks,
};
