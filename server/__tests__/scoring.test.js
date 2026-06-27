const {
  calculateDimension1_TimingAndCeiling,
  calculateDimension2_ProductAndMoat,
  calculateDimension3_CapitalEfficiencyAndScale,
  calculateDimension4_Team,
  calculateDimension5_Integrity,
  calculateTotalScore,
  getGrade,
  scoreProject,
  VERDICT_SCORE_MAP,
} = require("../scoring");

describe("calculateDimension1_TimingAndCeiling (S1)", () => {
  // v4.3: TAM 缺失（0/NaN/undefined）不再得 0 分，改为中性 30 分——
  // 信息缺失 ≠ 市场小，与 S3/S4 的中性兜底哲学对齐
  test("TAM missing (=0) gives neutral 30, not 0", () => {
    expect(calculateDimension1_TimingAndCeiling(0, 0)).toBe(30);
  });

  test("TAM=3000 gives about 61 tamScore", () => {
    const score = calculateDimension1_TimingAndCeiling(3000, 0);
    expect(score).toBeGreaterThanOrEqual(59);
    expect(score).toBeLessThanOrEqual(62);
  });

  test("CAGR is capped at 40 (on top of neutral TAM fallback)", () => {
    // TAM=1 → log10(1)=0 分；CAGR 封顶 40
    const score = calculateDimension1_TimingAndCeiling(1, 100);
    expect(score).toBe(40);
  });

  test("total is capped at 100", () => {
    expect(calculateDimension1_TimingAndCeiling(1e9, 100)).toBe(100);
  });

  test("handles NaN/undefined inputs gracefully (neutral 30)", () => {
    expect(calculateDimension1_TimingAndCeiling(undefined, undefined)).toBe(30);
    expect(calculateDimension1_TimingAndCeiling(NaN, NaN)).toBe(30);
    expect(calculateDimension1_TimingAndCeiling(null, null)).toBe(30);
  });

  test("negative CAGR treated as 0", () => {
    expect(calculateDimension1_TimingAndCeiling(100, -10)).toBe(
      calculateDimension1_TimingAndCeiling(100, 0)
    );
  });

  // v3 二阶加速：公司营收同比增速优先（奖励小基数高斜率），市场 CAGR 退为天花板
  test("二阶加速：公司营收同比高增速 → 增速分高于同等市场 CAGR", () => {
    // TAM=3000（tamScore≈61）；CAGR=15 但公司营收同比 +200% → 增速分应远高
    const withRevGrowth = calculateDimension1_TimingAndCeiling(3000, 15, 200);
    const cagrOnly = calculateDimension1_TimingAndCeiling(3000, 15);
    expect(withRevGrowth).toBeGreaterThan(cagrOnly);
  });

  test("二阶加速：+300% 以上拿满增速分 40", () => {
    // TAM=1 → tamScore=0，便于隔离增速分
    expect(calculateDimension1_TimingAndCeiling(1, 30, 400)).toBe(40);
  });

  test("市场天花板辅助：停滞赛道（CAGR<5）里公司爆发增速被封顶", () => {
    // 公司同比 +400%（本应 40），但市场 CAGR=2（停滞）→ 封顶 16
    expect(calculateDimension1_TimingAndCeiling(1, 2, 400)).toBe(16);
  });

  test("向后兼容：无公司增速时回退用市场 CAGR（旧 2 参调用不变）", () => {
    expect(calculateDimension1_TimingAndCeiling(3000, 25)).toBe(
      calculateDimension1_TimingAndCeiling(3000, 25, undefined)
    );
  });

  test("负增长不给增速分", () => {
    expect(calculateDimension1_TimingAndCeiling(1, 20, -30)).toBe(0);
  });
});

describe("calculateDimension2_ProductAndMoat (S2)", () => {
  test("TRL=9, Rank=10 gives max-ish score", () => {
    const score = calculateDimension2_ProductAndMoat(9, 10);
    expect(score).toBe(100);
  });

  test("TRL=1, Rank=1 gives low score", () => {
    const score = calculateDimension2_ProductAndMoat(1, 1);
    expect(score).toBeLessThan(20);
  });

  test("defaults TRL to 3 and Rank to 5 when missing", () => {
    const score = calculateDimension2_ProductAndMoat(null, null);
    const expected = calculateDimension2_ProductAndMoat(3, 5);
    expect(score).toBe(expected);
  });

  test("clamps TRL to 1-9 and Rank to 1-10", () => {
    const score = calculateDimension2_ProductAndMoat(100, 100);
    const clamped = calculateDimension2_ProductAndMoat(9, 10);
    expect(score).toBe(clamped);
  });
});

describe("calculateDimension3_CapitalEfficiencyAndScale (S3)", () => {
  test("both 10 gives 100", () => {
    expect(calculateDimension3_CapitalEfficiencyAndScale(10, 10)).toBe(100);
  });

  test("both 1 gives 10", () => {
    expect(calculateDimension3_CapitalEfficiencyAndScale(1, 1)).toBe(10);
  });

  test("defaults to 5 when missing (formula: 5*5+5*5=50)", () => {
    expect(calculateDimension3_CapitalEfficiencyAndScale(null, null)).toBe(50);
  });
});

describe("calculateDimension4_Team (S4)", () => {
  test("multi-factor scoring with all 10s gives 100", () => {
    const score = calculateDimension4_Team({
      Team_Experience_Score: 10,
      Team_Domain_Match_Score: 10,
      Team_Completeness_Score: 10,
      Team_Track_Record_Score: 10,
      Team_Education_Score: 10,
    });
    expect(score).toBe(100);
  });

  test("multi-factor scoring with all 1s gives 10", () => {
    const score = calculateDimension4_Team({
      Team_Experience_Score: 1,
      Team_Domain_Match_Score: 1,
      Team_Completeness_Score: 1,
      Team_Track_Record_Score: 1,
      Team_Education_Score: 1,
    });
    expect(score).toBe(10);
  });

  test("defaults missing factors to 6 (v4.1: raised from 5)", () => {
    const score = calculateDimension4_Team({});
    // v3：经验完全缺失（无 Team_Experience_Score 也无 Founder_Exp_Years）→ 中性 6，
    // 其余子因子缺失也默认 6 → weighted = 6 → 60（不再用假设 5 年算低分）
    expect(score).toBeGreaterThanOrEqual(50);
    expect(score).toBeLessThanOrEqual(60);
  });

  test("backward-compatible with numeric input (Founder_Exp_Years)", () => {
    const score = calculateDimension4_Team(10);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test("handles null input", () => {
    const score = calculateDimension4_Team(null);
    expect(score).toBeGreaterThan(0);
  });
});

describe("calculateDimension5_Integrity (S5)", () => {
  test("returns 70 for empty input (v4.1: raised from 60)", () => {
    expect(calculateDimension5_Integrity([])).toBe(70);
    expect(calculateDimension5_Integrity(null)).toBe(70);
    expect(calculateDimension5_Integrity(undefined)).toBe(70);
  });

  test("all honest verdicts gives 100", () => {
    const verdicts = Array(10).fill({ verdict: "诚实" });
    expect(calculateDimension5_Integrity(verdicts)).toBe(100);
  });

  test("all falsified verdicts gives 0", () => {
    const verdicts = Array(10).fill({ verdict: "证伪" });
    expect(calculateDimension5_Integrity(verdicts)).toBe(0);
  });

  test("all uncertain verdicts gives 60 (存疑=6)", () => {
    const verdicts = Array(10).fill({ verdict: "存疑" });
    expect(calculateDimension5_Integrity(verdicts)).toBe(60);
  });

  test("unknown verdicts treated as uncertain (6)", () => {
    const verdicts = [{ verdict: "未知类型" }];
    expect(calculateDimension5_Integrity(verdicts)).toBe(60);
  });

  test("mixed verdicts produce expected average", () => {
    const verdicts = [
      { verdict: "诚实" },     // 10
      { verdict: "证伪" },     // 0
    ];
    // avg = 5, score = 50
    expect(calculateDimension5_Integrity(verdicts)).toBe(50);
  });

  test("verdict score map has correct values (v4.1)", () => {
    expect(VERDICT_SCORE_MAP["存疑"]).toBe(6);
    expect(VERDICT_SCORE_MAP["诚实"]).toBe(10);
    expect(VERDICT_SCORE_MAP["保守低估"]).toBe(10);
    expect(VERDICT_SCORE_MAP["夸大"]).toBe(3);
    expect(VERDICT_SCORE_MAP["严重夸大"]).toBe(1);
    expect(VERDICT_SCORE_MAP["证伪"]).toBe(0);
  });

  test("realistic BP claim distribution scores reasonably (v5: 存疑剔除 + 阶段计权)", () => {
    // Typical good BP: 40% honest, 35% uncertain, 20% exaggerated, 5% info asymmetry
    const verdicts = [
      ...Array(8).fill({ verdict: "诚实" }),       // 计分 8 × 10
      ...Array(7).fill({ verdict: "存疑" }),       // v5: 剔除，不计分，只降覆盖率
      ...Array(4).fill({ verdict: "夸大" }),       // v5: early 阶段 4 分/条
      ...Array(1).fill({ verdict: "信息不对称" }), // 2 分
    ];
    const score = calculateDimension5_Integrity(verdicts);
    // v5: 可核实 13/20（覆盖率 0.65 ≥ 0.6 → 满置信）；
    //     raw = (8×10 + 4×4 + 1×2) / 13 × 10 ≈ 75 → 75（存疑不再把分数拖到 68）
    expect(score).toBeGreaterThanOrEqual(70);
    expect(score).toBeLessThanOrEqual(80);
  });
});

describe("calculateTotalScore", () => {
  test("simple average of five dimensions", () => {
    expect(calculateTotalScore(80, 80, 80, 80, 80)).toBe(80);
  });

  // v4.3 回归：S5 合法得 0 分（所有声明被证伪）必须按 0 计入，
  // 不能被 `|| 70` 顶成 70——否则最严重的造假 BP 反而拿中性诚信分
  test("S5=0 counts as 0 (regression: must NOT default to 70)", () => {
    expect(calculateTotalScore(0, 0, 0, 0, 0)).toBe(0);
    expect(calculateTotalScore(50, 50, 50, 50, 0)).toBe(40);
  });

  test("S5 missing (undefined/NaN) defaults to neutral 70", () => {
    expect(calculateTotalScore(50, 50, 50, 50, undefined)).toBe(
      Math.round((50 + 50 + 50 + 50 + 70) / 5)
    );
    expect(calculateTotalScore(50, 50, 50, 50, NaN)).toBe(54);
  });

  test("capped at 100", () => {
    expect(calculateTotalScore(100, 100, 100, 100, 100)).toBe(100);
  });
});

describe("getGrade (v5 adjusted boundaries: A≥75 / B 60-74 / C 50-59 / D <50)", () => {
  test("A grade for score >= 75", () => {
    expect(getGrade(75).grade).toBe("A");
    expect(getGrade(100).grade).toBe("A");
  });

  test("B grade for score 60-74", () => {
    expect(getGrade(60).grade).toBe("B");
    expect(getGrade(74).grade).toBe("B");
  });

  test("C grade for score 50-59", () => {
    expect(getGrade(50).grade).toBe("C");
    expect(getGrade(59).grade).toBe("C");
  });

  test("D grade for score < 50", () => {
    expect(getGrade(49).grade).toBe("D");
    expect(getGrade(0).grade).toBe("D");
  });
});

describe("scoreProject (integration)", () => {
  test("produces valid output structure", () => {
    const result = scoreProject({
      TAM_Million_RMB: 5000,
      CAGR: 25,
      TRL: 7,
      Competitor_Rank_Score: 8,
      Industry_Capital_Score: 8,
      Industry_Scale_Score: 7,
      Founder_Exp_Years: 10,
      Team_Experience_Score: 8,
      Team_Domain_Match_Score: 7,
      Team_Completeness_Score: 8,
      Team_Track_Record_Score: 6,
      Team_Education_Score: 7,
      claim_verdicts: [
        { verdict: "诚实" },
        { verdict: "存疑" },
        { verdict: "夸大" },
      ],
    });

    expect(result).toHaveProperty("dimensions");
    expect(result).toHaveProperty("total_score");
    expect(result).toHaveProperty("grade");
    expect(result.total_score).toBeGreaterThanOrEqual(0);
    expect(result.total_score).toBeLessThanOrEqual(100);
    expect(["A", "B", "C", "D"]).toContain(result.grade);

    // Check all 5 dimensions exist
    const dims = Object.keys(result.dimensions);
    expect(dims).toEqual(expect.arrayContaining([
      "timing_ceiling", "product_moat", "business_validation", "team", "external_risk",
    ]));
  });

  test("excellent project can score 80+ (Grade A)", () => {
    const result = scoreProject({
      TAM_Million_RMB: 5000,
      CAGR: 25,
      TRL: 8,
      Competitor_Rank_Score: 8,
      Industry_Capital_Score: 8,
      Industry_Scale_Score: 8,
      Team_Experience_Score: 8,
      Team_Domain_Match_Score: 8,
      Team_Completeness_Score: 8,
      Team_Track_Record_Score: 7,
      Team_Education_Score: 8,
      claim_verdicts: [
        ...Array(10).fill({ verdict: "诚实" }),
        ...Array(5).fill({ verdict: "存疑" }),
        ...Array(2).fill({ verdict: "夸大" }),
      ],
    });

    expect(result.total_score).toBeGreaterThanOrEqual(80);
    expect(result.grade).toBe("A");
  });

  test("mediocre project stays in C/D range", () => {
    const result = scoreProject({
      TAM_Million_RMB: 500,
      CAGR: 10,
      TRL: 4,
      Competitor_Rank_Score: 4,
      Industry_Capital_Score: 4,
      Industry_Scale_Score: 4,
      Team_Experience_Score: 4,
      Team_Domain_Match_Score: 4,
      Team_Completeness_Score: 4,
      Team_Track_Record_Score: 3,
      Team_Education_Score: 4,
      claim_verdicts: [
        ...Array(3).fill({ verdict: "诚实" }),
        ...Array(5).fill({ verdict: "存疑" }),
        ...Array(5).fill({ verdict: "夸大" }),
        ...Array(2).fill({ verdict: "严重夸大" }),
      ],
    });

    expect(result.total_score).toBeLessThan(65);
    expect(["C", "D"]).toContain(result.grade);
  });

  test("handles completely missing data gracefully", () => {
    const result = scoreProject({});
    expect(result.total_score).toBeGreaterThanOrEqual(0);
    expect(result.total_score).toBeLessThanOrEqual(100);
    expect(result.grade).toBeDefined();
  });
});
