// 标杆/反例的"投资窗口期画像"输入向量（validated_data 形态）。
// 数字为窗口期已查证的真实数据 —— **专家定标版（2026-06-19）**：营收同比增速、毛利、
// 全球玩家数、护城河、BP 声明诚信度均按投资人专家提供的招股书/同花顺ifind口径覆盖。
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
// 声明集构造：honest general、honest material(financial)，加上专家点名的问题声明
function hon(n, category = "other") { return Array(n).fill(0).map(() => ({ verdict: "诚实", category })); }
function claim(verdict, category, text) { return { verdict, category, original_claim: text || "" }; }

const VECTORS = {
  // 寒武纪 2019：营收同比 +279%（小基数高斜率），毛利 68%，存疑（思元270性能对标T4选择性披露，非财务→不触veto）
  寒武纪: {
    TAM_Million_RMB: 80000, CAGR: 40, Company_Revenue_Growth_YoY: 279,
    TRL_Evidence: trlLadder(8, 8), Chokepoint_Score: 85, Moat_Rubric: moat(95, 80, 90, 85),
    S3_Rubric: { capital_archetype: "软硬结合", scale_type: "规模经济", cost_curve_steepness: "指数级",
      global_player_count: 4, market_cagr: 30, policy_tier: "国家级", capital_source: "大基金主导", gross_margin: 0.68 },
    ...team(9, 10, 9, 9, 10),
    claim_verdicts: [...hon(8), ...hon(3, "financial"), claim("存疑", "product", "思元270云端芯片性能对标英伟达T4，技术参数选择性披露")],
    Policy_Rubric: { tier: "第一档", chokepoint_substitution: true, state_capital: true, geo_exposure: "medium", industrialization: true },
    industry_category: "芯片半导体",
  },
  // 摩尔线程 2024：营收 +253%，毛利 72%，竞争密度上调95（全功能GPU仅摩尔+沐曦），信息不对称（市场地位+客户集中度98%未充分揭示，financial→material）
  摩尔线程: {
    TAM_Million_RMB: 100000, CAGR: 40, Company_Revenue_Growth_YoY: 253,
    TRL_Evidence: trlLadder(7, 8), Chokepoint_Score: 85, Moat_Rubric: moat(90, 75, 85, 95),
    S3_Rubric: { capital_archetype: "软硬结合", scale_type: "规模经济", cost_curve_steepness: "指数级",
      global_player_count: 5, market_cagr: 30, policy_tier: "国家级", capital_source: "大基金主导", gross_margin: 0.72 },
    ...team(9, 10, 9, 9, 9),
    claim_verdicts: [...hon(8), ...hon(2, "financial"), claim("信息不对称", "financial", "客户集中度98%与早期'国产GPU领军者'市场地位表述未充分揭示")],
    Policy_Rubric: { tier: "第一档", chokepoint_substitution: true, state_capital: true, geo_exposure: "high", industrialization: true },
    industry_category: "芯片半导体",
  },
  // 长鑫 2024：营收 +166%（百亿级体量），毛利 35%（2025Q3才达到），全球玩家3（三星/海力士/美光），夸大（估值预期+盈利时间线乐观，valuation→material）
  长鑫存储: {
    TAM_Million_RMB: 60000, CAGR: 15, Company_Revenue_Growth_YoY: 166,
    TRL_Evidence: trlLadder(8, 8), Chokepoint_Score: 85, Moat_Rubric: moat(88, 80, 90, 90),
    S3_Rubric: { capital_archetype: "重资产制造", scale_type: "规模经济", cost_curve_steepness: "指数级",
      global_player_count: 3, market_cagr: 15, policy_tier: "国家级", capital_source: "大基金主导", gross_margin: 0.35 },
    ...team(9, 9, 8, 8, 10),
    claim_verdicts: [...hon(8), ...hon(2, "financial"), claim("夸大", "valuation", "盈利拐点时间预估乐观（实际2025年才盈利），估值预期偏高")],
    Policy_Rubric: { tier: "第一档", chokepoint_substitution: true, state_capital: true, geo_exposure: "low", industrialization: true },
    industry_category: "芯片半导体",
  },
  // 长江 2025：营收 +100%（三百亿体量产能爬坡），毛利 45%，全球玩家6（NAND），咽喉上调88（国产唯一IDM），夸大（"万亿"预期脱节，valuation→material）
  长江存储: {
    TAM_Million_RMB: 55000, CAGR: 15, Company_Revenue_Growth_YoY: 100,
    TRL_Evidence: trlLadder(8, 8), Chokepoint_Score: 88, Moat_Rubric: moat(86, 78, 88, 88),
    S3_Rubric: { capital_archetype: "重资产制造", scale_type: "规模经济", cost_curve_steepness: "指数级",
      global_player_count: 6, market_cagr: 15, policy_tier: "国家级", capital_source: "大基金主导", gross_margin: 0.45 },
    ...team(9, 9, 8, 8, 9),
    claim_verdicts: [...hon(8), ...hon(2, "financial"), claim("夸大", "valuation", "市场'万亿'预期与当时财务现实（净利仅5.31亿）脱节")],
    Policy_Rubric: { tier: "第一档", chokepoint_substitution: true, state_capital: true, geo_exposure: "low", industrialization: true },
    industry_category: "芯片半导体",
  },
  // 宁德 2016：营收 +161%，毛利 43.7%（早期远高于25%假设），团队过往成绩10（曾毓群ATL出身全球顶级），保守低估（兑现度超BP承诺，financial→material正面）
  宁德时代: {
    TAM_Million_RMB: 50000, CAGR: 40, Company_Revenue_Growth_YoY: 161,
    TRL_Evidence: trlLadder(8, 8), Chokepoint_Score: 80, Moat_Rubric: moat(88, 80, 90, 80),
    S3_Rubric: { capital_archetype: "重资产制造", scale_type: "规模经济", cost_curve_steepness: "强学习曲线",
      global_player_count: 10, market_cagr: 30, policy_tier: "国家级", capital_source: "大基金主导", gross_margin: 0.437 },
    ...team(10, 10, 9, 10, 8),
    claim_verdicts: [...hon(8), ...hon(2, "financial"), claim("保守低估", "financial", "动力电池出货量预测偏保守，最终兑现度超BP承诺")],
    Policy_Rubric: { tier: "第二档", chokepoint_substitution: true, state_capital: true, geo_exposure: "low", industrialization: true },
    industry_category: "新能源",
  },
  // 反例A 钢铁厂：全球玩家上调300+（粗钢产能更分散），其余确认
  反例A_钢铁厂: {
    TAM_Million_RMB: 200000, CAGR: 2,
    TRL_Evidence: trlLadder(9, 9), Chokepoint_Score: 50, Moat_Rubric: moat(20, 30, 30, 15),
    S3_Rubric: { capital_archetype: "重资产制造", scale_type: "规模经济", cost_curve_steepness: "普通规模经济",
      global_player_count: 300, market_cagr: 2, policy_tier: "无", capital_source: "国资参与", gross_margin: 0.12 },
    ...team(5, 7, 6, 5, 6),
    claim_verdicts: [...Array(4).fill({ verdict: "存疑", category: "other" })],
    Policy_Rubric: { tier: "第五档", chokepoint_substitution: false, state_capital: false, geo_exposure: "low", industrialization: true },
    industry_category: "其他",
  },
  // 反例B 平庸SaaS：毛利下调72%（价格战/客户流失难维持80%），其余确认
  反例B_平庸SaaS: {
    TAM_Million_RMB: 5000, CAGR: 15,
    TRL_Evidence: trlLadder(9, 9), Chokepoint_Score: 50, Moat_Rubric: moat(30, 45, 40, 20),
    S3_Rubric: { capital_archetype: "纯软件SaaS", scale_type: "双边网络效应", cost_curve_steepness: "边际成本趋零",
      market_cagr: 15, policy_tier: "无", capital_source: "市场化", gross_margin: 0.72 },
    ...team(6, 7, 6, 5, 7),
    claim_verdicts: [...hon(4), ...Array(4).fill({ verdict: "存疑", category: "other" }), claim("夸大", "market", "红海赛道 TAM 夸大")],
    Policy_Rubric: { tier: "第四档", chokepoint_substitution: false, state_capital: false, geo_exposure: "low", industrialization: true },
    industry_category: "企业服务/SaaS",
  },
  // 反例C 财务造假：财务"证伪"触发一票否决（专家补充：估值主动造假同样按 严重夸大/证伪 论处）
  反例C_财务造假: {
    TAM_Million_RMB: 80000, CAGR: 40, Company_Revenue_Growth_YoY: 200,
    TRL_Evidence: trlLadder(8, 8), Chokepoint_Score: 85, Moat_Rubric: moat(90, 80, 90, 85),
    S3_Rubric: { capital_archetype: "软硬结合", scale_type: "规模经济", cost_curve_steepness: "指数级",
      global_player_count: 4, market_cagr: 30, policy_tier: "国家级", capital_source: "大基金主导", gross_margin: 0.60 },
    ...team(9, 10, 9, 9, 10),
    claim_verdicts: [...hon(9), { verdict: "证伪", category: "financial", severity: "严重", original_claim: "宣称已盈利但审计为亏损" }],
    Policy_Rubric: { tier: "第一档", chokepoint_substitution: true, state_capital: true, geo_exposure: "low", industrialization: true },
    industry_category: "芯片半导体",
  },
};

const ON = { modeOverride: "on", s3ModeOverride: "on", aggModeOverride: "on" };

module.exports = { VECTORS, ON, trlLadder, moat, team, hon, claim };
