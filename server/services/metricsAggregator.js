// ============================================================
// server/services/metricsAggregator.js
//
// P3-4 生产环境 metric 监控聚合器。
// 从 skill_runs.metadata_json 跑 SQL 出"健康度看板"，覆盖：
//   - fallback ratio: preferred 字段缺失率（data room 缺口监控）
//   - semantic audit verdict 分布: entailed / contradicted / unclear
//   - bp_deep_parsing 使用率 + 平均 fact count
//   - institutional_memory 检索命中率 + 平均 match count
//   - sector_compliance 触发分布
//   - cache 间接信号: 通过 search_used 与 upload_facts_used 替代
//   - grounding 通过率
//   - LLM repair 平均次数
//   - skill_id × tier (heavy/light/default) 的运行成功率 + 延时
//
// 用法（CLI 或 admin API）：
//   const summary = aggregateSkillMetrics({ days: 7, skillId: null });
//   console.log(summary);
// ============================================================

const { getDb } = require("../db");

function _safeJson(text, fallback = null) {
  if (!text || typeof text !== "string") return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

function _avg(arr) {
  const vals = arr.filter((x) => Number.isFinite(x));
  if (!vals.length) return null;
  return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100;
}

function _pct(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10; // 1 位小数
}

// 主聚合：从 skill_runs 拉过去 N 天的数据，按 skill_id 分组
function aggregateSkillMetrics(opts = {}) {
  const { days = 7, skillId = null, limit = 10000 } = opts;
  const db = getDb();
  const params = [];
  let where = `WHERE created_at >= datetime('now', ?)`;
  params.push(`-${days} days`);
  if (skillId) {
    where += ` AND skill_id = ?`;
    params.push(skillId);
  }
  let rows;
  try {
    rows = db.prepare(`
      SELECT id, skill_id, status, duration_ms, metadata_json, error, created_at
      FROM skill_runs
      ${where}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...params, limit);
  } catch (e) {
    // 旧 schema 无 metadata_json 列时降级
    rows = db.prepare(`
      SELECT id, skill_id, status, duration_ms, error, created_at
      FROM skill_runs
      ${where}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...params, limit);
  }

  // 按 skill_id 分组
  const bySkill = new Map();
  for (const r of rows) {
    const sid = r.skill_id || "(unknown)";
    if (!bySkill.has(sid)) bySkill.set(sid, []);
    bySkill.get(sid).push(r);
  }

  const skills = [];
  for (const [sid, runs] of bySkill.entries()) {
    const totals = {
      skill_id: sid,
      total_runs: runs.length,
      succeeded: 0,
      failed: 0,
      durations: [],
      preferred_missing_sum: 0,
      preferred_total_sum: 0,
      semantic_sampled: 0,
      semantic_entailed: 0,
      semantic_contradicted: 0,
      semantic_unclear: 0,
      bp_deep_used_count: 0,
      bp_deep_fact_total: 0,
      institutional_memory_used_count: 0,
      institutional_memory_count_total: 0,
      sector_compliance_hits_count: 0,
      sector_compliance_categories: new Map(),
      search_used_count: 0,
      upload_facts_total: 0,
      llm_repairs_total: 0,
      llm_repairs_runs: 0,
      grounding_ok_count: 0,
      grounding_evaluated_count: 0,
      grounding_ref_total: 0,
      grounding_ref_runs: 0,
      error_signatures: new Map(),
    };
    for (const r of runs) {
      if (r.status === "succeeded") totals.succeeded++;
      else if (r.status === "failed") totals.failed++;
      if (Number.isFinite(r.duration_ms)) totals.durations.push(r.duration_ms);
      if (r.error) {
        const sig = r.error.split(":")[0].slice(0, 80);
        totals.error_signatures.set(sig, (totals.error_signatures.get(sig) || 0) + 1);
      }
      const meta = _safeJson(r.metadata_json);
      if (!meta) continue;
      if (meta.fallback) {
        totals.preferred_missing_sum += Number(meta.fallback.preferred_missing) || 0;
        totals.preferred_total_sum += Number(meta.fallback.preferred_total) || 0;
      }
      if (meta.semantic_audit) {
        totals.semantic_sampled += Number(meta.semantic_audit.sampled) || 0;
        totals.semantic_entailed += Number(meta.semantic_audit.entailed) || 0;
        totals.semantic_contradicted += Number(meta.semantic_audit.contradicted) || 0;
        totals.semantic_unclear += Number(meta.semantic_audit.unclear) || 0;
      }
      if (meta.bp_deep_parsing_used) {
        totals.bp_deep_used_count++;
        totals.bp_deep_fact_total += Number(meta.bp_deep_fact_count) || 0;
      }
      if (meta.institutional_memory_used) {
        totals.institutional_memory_used_count++;
        totals.institutional_memory_count_total += Number(meta.institutional_memory_count) || 0;
      }
      if (Array.isArray(meta.sector_compliance_hits) && meta.sector_compliance_hits.length) {
        totals.sector_compliance_hits_count++;
        for (const cat of meta.sector_compliance_hits) {
          totals.sector_compliance_categories.set(cat, (totals.sector_compliance_categories.get(cat) || 0) + 1);
        }
      }
      if (meta.evidence_search_used) totals.search_used_count++;
      totals.upload_facts_total += Number(meta.upload_facts_used) || 0;
      if (Number.isFinite(meta.llm_repairs)) {
        totals.llm_repairs_total += meta.llm_repairs;
        totals.llm_repairs_runs++;
      } else if (meta.llm_repairs && typeof meta.llm_repairs === "object") {
        // 多步 pipeline (icQuestions): 把 bull/bear/synth/val_exit 加总
        for (const v of Object.values(meta.llm_repairs)) {
          if (Number.isFinite(v)) totals.llm_repairs_total += v;
        }
        totals.llm_repairs_runs++;
      }
      if (meta.grounding_ok === true) {
        totals.grounding_ok_count++;
        totals.grounding_evaluated_count++;
      } else if (meta.grounding_ok === false) {
        totals.grounding_evaluated_count++;
      }
      if (Number.isFinite(meta.grounding_referenced_count)) {
        totals.grounding_ref_total += meta.grounding_referenced_count;
        totals.grounding_ref_runs++;
      }
    }

    skills.push({
      skill_id: sid,
      total_runs: totals.total_runs,
      success_rate_pct: _pct(totals.succeeded, totals.total_runs),
      failure_rate_pct: _pct(totals.failed, totals.total_runs),
      latency_p50_ms: _percentile(totals.durations, 0.5),
      latency_p95_ms: _percentile(totals.durations, 0.95),
      latency_avg_ms: _avg(totals.durations),
      fallback: {
        preferred_missing_ratio_pct: _pct(totals.preferred_missing_sum, totals.preferred_total_sum),
        preferred_missing_total: totals.preferred_missing_sum,
        preferred_total: totals.preferred_total_sum,
      },
      semantic_audit: totals.semantic_sampled > 0 ? {
        sampled_total: totals.semantic_sampled,
        entailed_pct: _pct(totals.semantic_entailed, totals.semantic_sampled),
        contradicted_pct: _pct(totals.semantic_contradicted, totals.semantic_sampled),
        unclear_pct: _pct(totals.semantic_unclear, totals.semantic_sampled),
      } : null,
      bp_deep_parsing: {
        usage_rate_pct: _pct(totals.bp_deep_used_count, totals.total_runs),
        avg_fact_count: totals.bp_deep_used_count > 0
          ? Math.round((totals.bp_deep_fact_total / totals.bp_deep_used_count) * 100) / 100
          : null,
      },
      institutional_memory: {
        usage_rate_pct: _pct(totals.institutional_memory_used_count, totals.total_runs),
        avg_match_count: totals.institutional_memory_used_count > 0
          ? Math.round((totals.institutional_memory_count_total / totals.institutional_memory_used_count) * 100) / 100
          : null,
      },
      sector_compliance: {
        hit_rate_pct: _pct(totals.sector_compliance_hits_count, totals.total_runs),
        top_categories: Array.from(totals.sector_compliance_categories.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([cat, n]) => ({ category: cat, count: n })),
      },
      web_search_usage_pct: _pct(totals.search_used_count, totals.total_runs),
      avg_upload_facts: _pct(totals.upload_facts_total, totals.total_runs)
        ? Math.round((totals.upload_facts_total / totals.total_runs) * 100) / 100
        : 0,
      avg_llm_repairs: totals.llm_repairs_runs > 0
        ? Math.round((totals.llm_repairs_total / totals.llm_repairs_runs) * 100) / 100
        : null,
      grounding: {
        evaluated_runs: totals.grounding_evaluated_count,
        ok_rate_pct: _pct(totals.grounding_ok_count, totals.grounding_evaluated_count),
        avg_referenced_count: totals.grounding_ref_runs > 0
          ? Math.round((totals.grounding_ref_total / totals.grounding_ref_runs) * 100) / 100
          : null,
      },
      top_errors: Array.from(totals.error_signatures.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([signature, count]) => ({ signature, count })),
    });
  }

  // 排序：按 total_runs 倒序
  skills.sort((a, b) => b.total_runs - a.total_runs);

  return {
    window_days: days,
    sample_size: rows.length,
    generated_at: new Date().toISOString(),
    skills,
  };
}

function _percentile(arr, p) {
  if (!arr.length) return null;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

module.exports = { aggregateSkillMetrics, _private: { _safeJson, _avg, _pct, _percentile } };
