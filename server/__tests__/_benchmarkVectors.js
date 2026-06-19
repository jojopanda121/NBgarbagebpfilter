// 标杆/反例的"投资窗口期画像"输入向量（validated_data 形态）。
// 数字为窗口期已查证的近似真实数据；用户若后续提供精确六维向量表则覆盖。
// 供 scoringBenchmarks.test.js 与 scratch 复算共用。

function trlLadder(verified, claimed) {
  const ladder = [];
  for (let i = 1; i <= claimed; i++) {
    ladder.push({ level: i, status: i <= verified ? "verified" : "claimed", evidence: "" });
  }
  return { bp_claimed_trl: claimed, ladder };
}
function moat(diff, sw, trac, dens, tier = "verified") {
  return {
    differentiation: { score: diff, evidence_tier: tier },
    switching_cost: { score: sw, evidence_tier: tier },
    traction_position: { score: trac, evidence_tier: tier },
    competitive_density: { score: dens, evidence_tier: tier },
  };
}
function team(exp, dom, comp, track, edu) {
  return {
    Team_Experience_Score: exp, Team_Domain_Match_Score: dom,
    Team_Completeness_Score: comp, Team_Track_Record_Score: track, Team_Education_Score: edu,
  };
}
function honest(n) { return Array(n).fill({ verdict: "诚实", category: "other" }); }
function doubt(n) { return Array(n).fill({ verdict: "存疑", category: "other" }); }

const VECTORS = {
  寒武纪: {
    TAM_Million_RMB: 80000, CAGR: 40,
    TRL_Evidence: trlLadder(8, 8), Chokepoint_Score: 85, Moat_Rubric: moat(95, 80, 90, 85),
    S3_Rubric: { capital_archetype: "软硬结合", scale_type: "规模经济", cost_curve_steepness: "指数级",
      global_player_count: 4, market_cagr: 30, policy_tier: "国家级", capital_source: "大基金主导", gross_margin: 0.60 },
    ...team(9, 10, 9, 9, 10),
    claim_verdicts: [...honest(9), ...doubt(3), { verdict: "保守低估", category: "financial" }],
    Policy_Rubric: { tier: "第一档", chokepoint_substitution: true, state_capital: true, geo_exposure: "medium", industrialization: true },
    industry_category: "芯片半导体",
  },
  摩尔线程: {
    TAM_Million_RMB: 100000, CAGR: 40,
    TRL_Evidence: trlLadder(7, 8), Chokepoint_Score: 85, Moat_Rubric: moat(90, 75, 85, 80),
    S3_Rubric: { capital_archetype: "软硬结合", scale_type: "规模经济", cost_curve_steepness: "指数级",
      global_player_count: 5, market_cagr: 30, policy_tier: "国家级", capital_source: "大基金主导", gross_margin: 0.40 },
    ...team(9, 10, 9, 9, 9),
    claim_verdicts: [...honest(8), ...doubt(3)],
    Policy_Rubric: { tier: "第一档", chokepoint_substitution: true, state_capital: true, geo_exposure: "high", industrialization: true },
    industry_category: "芯片半导体",
  },
  长鑫存储: {
    TAM_Million_RMB: 60000, CAGR: 15,
    TRL_Evidence: trlLadder(8, 8), Chokepoint_Score: 85, Moat_Rubric: moat(88, 80, 90, 90),
    S3_Rubric: { capital_archetype: "重资产制造", scale_type: "规模经济", cost_curve_steepness: "指数级",
      global_player_count: 4, market_cagr: 15, policy_tier: "国家级", capital_source: "大基金主导", gross_margin: 0.45 },
    ...team(9, 9, 8, 8, 10),
    claim_verdicts: [...honest(9), ...doubt(2)],
    Policy_Rubric: { tier: "第一档", chokepoint_substitution: true, state_capital: true, geo_exposure: "low", industrialization: true },
    industry_category: "芯片半导体",
  },
  长江存储: {
    TAM_Million_RMB: 55000, CAGR: 15,
    TRL_Evidence: trlLadder(8, 8), Chokepoint_Score: 82, Moat_Rubric: moat(86, 78, 88, 88),
    S3_Rubric: { capital_archetype: "重资产制造", scale_type: "规模经济", cost_curve_steepness: "指数级",
      global_player_count: 5, market_cagr: 15, policy_tier: "国家级", capital_source: "大基金主导", gross_margin: 0.42 },
    ...team(9, 9, 8, 8, 9),
    claim_verdicts: [...honest(9), ...doubt(2)],
    Policy_Rubric: { tier: "第一档", chokepoint_substitution: true, state_capital: true, geo_exposure: "low", industrialization: true },
    industry_category: "芯片半导体",
  },
  宁德时代: {
    TAM_Million_RMB: 50000, CAGR: 40,
    TRL_Evidence: trlLadder(8, 8), Chokepoint_Score: 80, Moat_Rubric: moat(88, 80, 90, 80),
    S3_Rubric: { capital_archetype: "重资产制造", scale_type: "规模经济", cost_curve_steepness: "强学习曲线",
      global_player_count: 10, market_cagr: 30, policy_tier: "国家级", capital_source: "大基金主导", gross_margin: 0.25 },
    ...team(10, 10, 9, 9, 8),
    claim_verdicts: [...honest(9), ...doubt(2)],
    Policy_Rubric: { tier: "第二档", chokepoint_substitution: true, state_capital: true, geo_exposure: "low", industrialization: true },
    industry_category: "新能源",
  },
  反例A_钢铁厂: {
    TAM_Million_RMB: 200000, CAGR: 2,
    TRL_Evidence: trlLadder(9, 9), Chokepoint_Score: 50, Moat_Rubric: moat(20, 30, 30, 15),
    S3_Rubric: { capital_archetype: "重资产制造", scale_type: "规模经济", cost_curve_steepness: "普通规模经济",
      global_player_count: 200, market_cagr: 2, policy_tier: "无", capital_source: "国资参与", gross_margin: 0.12 },
    ...team(5, 7, 6, 5, 6),
    claim_verdicts: [...doubt(4)],
    Policy_Rubric: { tier: "第五档", chokepoint_substitution: false, state_capital: false, geo_exposure: "low", industrialization: true },
    industry_category: "其他",
  },
  反例B_平庸SaaS: {
    TAM_Million_RMB: 5000, CAGR: 15,
    TRL_Evidence: trlLadder(9, 9), Chokepoint_Score: 50, Moat_Rubric: moat(30, 45, 40, 20),
    S3_Rubric: { capital_archetype: "纯软件SaaS", scale_type: "双边网络效应", cost_curve_steepness: "边际成本趋零",
      market_cagr: 15, policy_tier: "无", capital_source: "市场化", gross_margin: 0.80 },
    ...team(6, 7, 6, 5, 7),
    claim_verdicts: [...honest(4), ...doubt(4), { verdict: "夸大", category: "market" }],
    Policy_Rubric: { tier: "第四档", chokepoint_substitution: false, state_capital: false, geo_exposure: "low", industrialization: true },
    industry_category: "企业服务/SaaS",
  },
  反例C_财务造假: {
    TAM_Million_RMB: 80000, CAGR: 40,
    TRL_Evidence: trlLadder(8, 8), Chokepoint_Score: 85, Moat_Rubric: moat(90, 80, 90, 85),
    S3_Rubric: { capital_archetype: "软硬结合", scale_type: "规模经济", cost_curve_steepness: "指数级",
      global_player_count: 4, market_cagr: 30, policy_tier: "国家级", capital_source: "大基金主导", gross_margin: 0.60 },
    ...team(9, 10, 9, 9, 10),
    claim_verdicts: [...honest(9), { verdict: "证伪", category: "financial", severity: "严重", original_claim: "宣称已盈利但审计为亏损" }],
    Policy_Rubric: { tier: "第一档", chokepoint_substitution: true, state_capital: true, geo_exposure: "low", industrialization: true },
    industry_category: "芯片半导体",
  },
};

const ON = { modeOverride: "on", s3ModeOverride: "on", aggModeOverride: "on" };

module.exports = { VECTORS, ON, trlLadder, moat, team, honest, doubt };
