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
  test("returns 0 when TAM=0 and CAGR=0", () => {
    expect(calculateDimension1_TimingAndCeiling(0, 0)).toBe(0);
  });

  test("TAM=3000 gives about 61 tamScore", () => {
    const score = calculateDimension1_TimingAndCeiling(3000, 0);
    expect(score).toBeGreaterThanOrEqual(59);
    expect(score).toBeLessThanOrEqual(62);
  });

  test("CAGR is capped at 40", () => {
    const score = calculateDimension1_TimingAndCeiling(1, 100);
    expect(score).toBeLessThanOrEqual(40);
  });

  test("total is capped at 100", () => {
    expect(calculateDimension1_TimingAndCeiling(1e9, 100)).toBe(100);
  });

  test("handles NaN/undefined inputs gracefully", () => {
    expect(calculateDimension1_TimingAndCeiling(undefined, undefined)).toBe(0);
    expect(calculateDimension1_TimingAndCeiling(NaN, NaN)).toBe(0);
    expect(calculateDimension1_TimingAndCeiling(null, null)).toBe(0);
  });

  test("negative CAGR treated as 0", () => {
    expect(calculateDimension1_TimingAndCeiling(100, -10)).toBe(
      calculateDimension1_TimingAndCeiling(100, 0)
    );
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

  test("defaults to 5 when missing", () => {
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

  test("defaults missing factors to 5", () => {
    const score = calculateDimension4_Team({});
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
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
  test("returns 60 for empty input", () => {
    expect(calculateDimension5_Integrity([])).toBe(60);
    expect(calculateDimension5_Integrity(null)).toBe(60);
    expect(calculateDimension5_Integrity(undefined)).toBe(60);
  });

  test("all honest verdicts gives 100", () => {
    const verdicts = Array(10).fill({ verdict: "诚实" });
    expect(calculateDimension5_Integrity(verdicts)).toBe(100);
  });

  test("all falsified verdicts gives 0", () => {
    const verdicts = Array(10).fill({ verdict: "证伪" });
    expect(calculateDimension5_Integrity(verdicts)).toBe(0);
  });

  test("all uncertain verdicts gives 60", () => {
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
});

describe("calculateTotalScore", () => {
  test("simple average of five dimensions", () => {
    expect(calculateTotalScore(80, 80, 80, 80, 80)).toBe(80);
  });

  test("S5=0 defaults to 60, so all-zero is not 0", () => {
    // S5 defaults to 60 when falsy (0 is falsy)
    expect(calculateTotalScore(0, 0, 0, 0, 0)).toBe(12);
  });

  test("capped at 100", () => {
    expect(calculateTotalScore(100, 100, 100, 100, 100)).toBe(100);
  });

  test("S5 defaults to 60 when falsy", () => {
    expect(calculateTotalScore(50, 50, 50, 50, 0)).toBe(
      Math.round((50 + 50 + 50 + 50 + 60) / 5)
    );
  });
});

describe("getGrade", () => {
  test("A grade for score >= 85", () => {
    expect(getGrade(85).grade).toBe("A");
    expect(getGrade(100).grade).toBe("A");
  });

  test("B grade for score 70-84", () => {
    expect(getGrade(70).grade).toBe("B");
    expect(getGrade(84).grade).toBe("B");
  });

  test("C grade for score 60-69", () => {
    expect(getGrade(60).grade).toBe("C");
    expect(getGrade(69).grade).toBe("C");
  });

  test("D grade for score < 60", () => {
    expect(getGrade(59).grade).toBe("D");
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

  test("handles completely missing data gracefully", () => {
    const result = scoreProject({});
    expect(result.total_score).toBeGreaterThanOrEqual(0);
    expect(result.total_score).toBeLessThanOrEqual(100);
    expect(result.grade).toBeDefined();
  });
});
