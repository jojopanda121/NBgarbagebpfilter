// ============================================================
// scoringCoverage.test.js — Phase 3：覆盖度/置信度（修复"缺失默认中性把分数往中心拽"）
// ============================================================

const { scoreProject } = require("../scoring");
const ON = { modeOverride: "on", s3ModeOverride: "on", aggModeOverride: "on" };

// 一个信息齐全的优秀硬科技项目
const FULL = {
  TAM_Million_RMB: 60000, CAGR: 30, Company_Revenue_Growth_YoY: 200,
  TRL_Evidence: { bp_claimed_trl: 8, ladder: [{ level: 8, status: "verified" }] },
  Chokepoint_Score: 85,
  Moat_Rubric: {
    differentiation: { score: 90, evidence_tier: "verified" },
    switching_cost: { score: 80, evidence_tier: "verified" },
    traction_position: { score: 88, evidence_tier: "verified" },
    competitive_density: { score: 85, evidence_tier: "verified" },
  },
  S3_Rubric: { capital_archetype: "软硬结合", scale_type: "规模经济", cost_curve_steepness: "指数级",
    global_player_count: 4, market_cagr: 30, policy_tier: "国家级", capital_source: "大基金主导", gross_margin: 0.55 },
  Team_Experience_Score: 9, Team_Domain_Match_Score: 10, Team_Completeness_Score: 9,
  Team_Track_Record_Score: 9, Team_Education_Score: 10,
  claim_verdicts: [...Array(8).fill({ verdict: "诚实", category: "other" })],
  Policy_Rubric: { tier: "第一档", chokepoint_substitution: true, state_capital: true, geo_exposure: "low", industrialization: true },
  industry_category: "芯片半导体",
};

describe("覆盖度真实反映缺失信息", () => {
  test("信息齐全 → 平均覆盖高、置信度高", () => {
    const r = scoreProject(FULL, ON);
    expect(r.total_distribution.confidence).toBe("高");
    expect(r.aggregation.avg_coverage).toBeGreaterThanOrEqual(0.9);
  });

  test("TAM 缺失 → S1 覆盖下降并标低置信", () => {
    const r = scoreProject({ ...FULL, TAM_Million_RMB: 0 }, ON);
    expect(r.dimensions.timing_ceiling.coverage).toBeLessThan(1);
  });

  test("无可核查声明 → S5 覆盖很低（无声明≠不诚信，但确属低置信）", () => {
    const r = scoreProject({ ...FULL, claim_verdicts: [] }, ON);
    expect(r.dimensions.external_risk.coverage).toBeLessThanOrEqual(0.3);
    expect(r.dimensions.external_risk.low_confidence).toBe(true);
  });

  test("信息稀疏的项目 → 置信度降到中/低，区间变宽", () => {
    const sparse = {
      TAM_Million_RMB: 0, CAGR: 0,
      Founder_Exp_Years: 3,
      claim_verdicts: [],
      industry_category: "其他",
    };
    const r = scoreProject(sparse, ON);
    expect(["中", "低"]).toContain(r.total_distribution.confidence);
    const width = r.total_distribution.range[1] - r.total_distribution.range[0];
    expect(width).toBeGreaterThan(8); // 满覆盖时 ±4=8，低覆盖应更宽
  });
});

describe("低覆盖维不再把总分往中心拽（修复根因②）", () => {
  test("优秀项目即使 S5 无声明（低覆盖），总分仍高（S5 中性默认被让权，不拖累）", () => {
    const withClaims = scoreProject(FULL, ON);
    const noClaims = scoreProject({ ...FULL, claim_verdicts: [] }, ON);
    // 无声明的 S5≈70 中性默认，但因覆盖低被让权 → 不应把一个其余卓越的项目显著拽下
    expect(noClaims.total_score).toBeGreaterThanOrEqual(withClaims.total_score - 6);
    expect(noClaims.grade).toBe("A");
  });

  test("每维覆盖度都出现在判断卡维度数据里", () => {
    const r = scoreProject(FULL, ON);
    for (const key of ["timing_ceiling", "product_moat", "business_validation", "team", "external_risk"]) {
      expect(typeof r.dimensions[key].coverage).toBe("number");
    }
  });
});
