// ============================================================
// server/services/bpPipelineSchema.js
//
// BP pipeline 输出 schema（Hermes 必须严格兼容）。
//
// 当前 legacy orchestrator.runAllAgents 返回:
//   {
//     run_id,
//     workspace_project_id,
//     workspace_version_number,
//     project_summary,    founder_profile,    financial_analysis,
//     competitor_analysis, valuation_analysis, red_flags
//   }
//
// 下游消费者：
//   - server/services/workspaceProjectService.js
//   - server/services/projectMigrationService.js
//   - server/services/dataLakeService.js
//   - 前端 report 页面
//
// 这里采用"轻 schema"——只校验关键字段的存在性和类型，不做语义校验，
// 让 Hermes 有充足空间演化输出细节。校验失败的 BP → fallback orchestrator。
// ============================================================

const REQUIRED_KEYS = [
  "project_summary",
  "founder_profile",
  "financial_analysis",
  "competitor_analysis",
  "valuation_analysis",
  "red_flags",
];

function isObj(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

/**
 * 校验 Hermes 返回的 multiagent 对象是否兼容 legacy schema。
 *
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validate(multiagent) {
  const errors = [];
  if (!isObj(multiagent)) {
    return { ok: false, errors: ["multiagent 不是对象"] };
  }

  for (const k of REQUIRED_KEYS) {
    if (!(k in multiagent)) {
      errors.push(`缺少必需字段: ${k}`);
      continue;
    }
    if (!isObj(multiagent[k])) {
      errors.push(`字段 ${k} 必须是对象，实际类型=${typeof multiagent[k]}`);
    }
  }

  // project_summary 软性必要字段（缺会让 workspace_project 显示空）
  const ps = multiagent.project_summary;
  if (isObj(ps)) {
    if (!ps.one_liner && !ps.project_name) {
      errors.push("project_summary 至少需有 one_liner 或 project_name 之一");
    }
  }

  // founder_profile 期望 founders 数组
  const fp = multiagent.founder_profile;
  if (isObj(fp) && !Array.isArray(fp.founders)) {
    errors.push("founder_profile.founders 应为数组");
  }

  // red_flags 期望 red_flags 数组
  const rf = multiagent.red_flags;
  if (isObj(rf) && !Array.isArray(rf.red_flags)) {
    errors.push("red_flags.red_flags 应为数组");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 给 Hermes 看的 JSON schema（嵌入 prompt 用，让 LLM 知道要返什么）。
 * 不做生成式 schema 强约束，只列字段名 + 期望类型。
 */
function describeForPrompt() {
  return {
    type: "object",
    required: REQUIRED_KEYS,
    properties: {
      project_summary: {
        type: "object",
        required: ["one_liner"],
        properties: {
          one_liner: { type: "string" },
          project_name: { type: "string" },
          industry: { type: "string" },
          stage: { type: "string" },
          business_model: { type: "string" },
          moat_summary: { type: "string" },
        },
      },
      founder_profile: {
        type: "object",
        required: ["founders"],
        properties: {
          founders: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                title: { type: "string" },
                past_ventures: { type: "array" },
                strengths: { type: "string" },
                gaps: { type: "string" },
              },
            },
          },
          team_assessment: { type: "string" },
          risk_flags: { type: "array" },
        },
      },
      financial_analysis: {
        type: "object",
        properties: {
          revenue: { type: "object" },
          unit_economics: { type: "object" },
          burn_runway: { type: "object" },
          anomalies: { type: "array" },
          overall_credibility: { type: "string" },
        },
      },
      competitor_analysis: {
        type: "object",
        properties: {
          competitors: { type: "array" },
          track_definition: { type: "string" },
          differentiation: { type: "string" },
        },
      },
      valuation_analysis: {
        type: "object",
        properties: {
          claimed_valuation: { type: "object" },
          consensus_range: { type: "object" },
          implied_dilution: { type: "object" },
          verdict: { type: "object" },
        },
      },
      red_flags: {
        type: "object",
        required: ["red_flags"],
        properties: {
          red_flags: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: { type: "string" },
                severity: { type: "string", enum: ["critical", "major", "minor"] },
                description: { type: "string" },
                evidence: { type: "string" },
              },
            },
          },
          overall_recommendation: {
            type: "object",
            properties: {
              verdict: { type: "string", enum: ["Go", "Follow-up", "Pass", "Archive"] },
              deal_breaker_count: { type: "integer" },
            },
          },
        },
      },
    },
  };
}

module.exports = { validate, describeForPrompt, REQUIRED_KEYS };
