// S2 产品与壁垒 harness 子系统 + scoreProject 灰度行为测试。
const { computeTrl, computeMoat, scoreS2Harness, trlGapVerdict, MOAT_WEIGHTS } = require("../../scoringHarness");
const { scoreProject } = require("../../scoring");

describe("computeTrl — 证据阶梯折扣", () => {
  test("无阶梯 → 退回 legacy", () => {
    const r = computeTrl(undefined, 6);
    expect(r.basis).toBe("legacy");
    expect(r.effective_trl).toBe(6);
  });

  test("verified L7 + claimed L9 → 实证满信任、自报半额", () => {
    const r = computeTrl({
      bp_claimed_trl: 9,
      ladder: [
        { level: 4, status: "verified" },
        { level: 7, status: "verified" },
        { level: 9, status: "claimed" },
      ],
    }, 5);
    expect(r.trl_verified).toBe(7);
    expect(r.trl_claimed).toBe(9);
    expect(r.effective_trl).toBe(8); // 7 + 0.5*(9-7)
    expect(r.gap).toBe(2);
    expect(r.basis).toBe("harness");
  });

  test("全凭自报无实证 → 腰斩 + 大 gap（反注水）", () => {
    const r = computeTrl({
      bp_claimed_trl: 8,
      ladder: [{ level: 8, status: "claimed" }],
    }, 5);
    expect(r.trl_verified).toBe(0);
    expect(r.trl_claimed).toBe(8);
    expect(r.effective_trl).toBe(4); // round(0.5*8)
    expect(r.gap).toBe(8);
  });

  test("阶梯全 absent 且无自报 → 退回 legacy", () => {
    const r = computeTrl({ ladder: [{ level: 5, status: "absent" }] }, 3);
    expect(r.basis).toBe("legacy");
    expect(r.effective_trl).toBe(3);
  });
});

describe("computeMoat — 护城河子因子(咽喉为其一)", () => {
  test("无 rubric 无咽喉 → 退回 legacy rank", () => {
    const r = computeMoat(null, undefined, 7);
    expect(r.basis).toBe("legacy");
    expect(r.moat_score).toBe(70);
  });

  test("权重和为 1", () => {
    const sum = Object.values(MOAT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  test("咽喉分作为子因子注入，软件型高差异化不被咽喉缺失误杀", () => {
    // 软件公司：差异化/转换成本高，咽喉=0
    const r = computeMoat({
      differentiation: { score: 90, evidence_tier: "verified" },
      switching_cost: { score: 85, evidence_tier: "verified" },
      traction_position: { score: 70, evidence_tier: "verified" },
      competitive_density: { score: 60, evidence_tier: "claimed" },
    }, 0, 5);
    // 咽喉只占 0.15，其余护城河撑住分数，不会塌到地板
    expect(r.moat_score).toBeGreaterThan(60);
    expect(r.subfactors.chokepoint).toBe(0);
  });

  test("evidence_tier=claimed 向中性 50 收敛打折", () => {
    const verified = computeMoat({ differentiation: { score: 100, evidence_tier: "verified" } }, 50, 5);
    const claimed = computeMoat({ differentiation: { score: 100, evidence_tier: "claimed" } }, 50, 5);
    expect(claimed.subfactors.differentiation).toBeLessThan(verified.subfactors.differentiation);
    expect(claimed.subfactors.differentiation).toBe(Math.round(50 + 50 * 0.85)); // 93
  });
});

describe("scoreS2Harness — 合成 S2", () => {
  test("强技术+强护城河 → 高 S2", () => {
    const r = scoreS2Harness({
      trlEvidence: { ladder: [{ level: 8, status: "verified" }] },
      moatRubric: {
        differentiation: { score: 90, evidence_tier: "verified" },
        switching_cost: { score: 80, evidence_tier: "verified" },
      },
      chokepointScore: 80,
    });
    expect(r.basis).toBe("harness");
    expect(r.S2).toBeGreaterThan(70);
  });

  test("两边都缺 → 退回 legacy 等价旧分", () => {
    const r = scoreS2Harness({ legacyTrl: 6, legacyRank: 7 });
    expect(r.basis).toBe("legacy");
  });
});

describe("trlGapVerdict — TRL gap 喂 S5", () => {
  test("legacy basis → 不产 verdict", () => {
    expect(trlGapVerdict({ basis: "legacy", gap: 5 })).toBeNull();
  });
  test("gap 分档", () => {
    expect(trlGapVerdict({ basis: "harness", gap: 0, trl_claimed: 5, trl_verified: 5 })).toBeNull();
    expect(trlGapVerdict({ basis: "harness", gap: 2, trl_claimed: 7, trl_verified: 5 }).verdict).toBe("存疑");
    expect(trlGapVerdict({ basis: "harness", gap: 3, trl_claimed: 8, trl_verified: 5 }).verdict).toBe("夸大");
    expect(trlGapVerdict({ basis: "harness", gap: 6, trl_claimed: 9, trl_verified: 3 }).verdict).toBe("严重夸大");
  });
});

describe("scoreProject — 灰度开关行为", () => {
  const harnessData = {
    TAM_Million_RMB: 3000, CAGR: 20, TRL: 8, Competitor_Rank_Score: 8,
    Industry_Capital_Score: 7, Industry_Scale_Score: 7, Founder_Exp_Years: 8,
    // harness 输入：BP 吹 TRL8 但只实证到 4
    TRL_Evidence: { bp_claimed_trl: 8, ladder: [{ level: 4, status: "verified" }, { level: 8, status: "claimed" }] },
    Moat_Rubric: { differentiation: { score: 40, evidence_tier: "claimed" } },
    Chokepoint_Score: 30,
  };

  afterEach(() => { delete process.env.SCORING_HARNESS; });

  test("off → 纯 legacy，无 shadow 块", () => {
    process.env.SCORING_HARNESS = "off";
    const r = scoreProject(harnessData);
    expect(r.scoring_shadow).toBeUndefined();
    expect(r.dimensions.product_moat.subtitle).toBe("TRL + 竞品排名");
  });

  test("shadow → 旧分生效 + 附 scoring_shadow 对照", () => {
    process.env.SCORING_HARNESS = "shadow";
    const r = scoreProject(harnessData);
    expect(r.scoring_basis).toBe("legacy");
    expect(r.scoring_shadow).toBeDefined();
    expect(typeof r.scoring_shadow.delta_total).toBe("number");
    // 注水项目：harness 应把 S2 拉低（实证 TRL 远低于自报）
    expect(r.scoring_shadow.delta_S2).toBeLessThan(0);
    expect(r.scoring_shadow.trl_gap_verdict.verdict).toBe("夸大"); // gap=4
  });

  test("on → harness 分生效，product_moat 走 harness 元数据", () => {
    process.env.SCORING_HARNESS = "on";
    const r = scoreProject(harnessData);
    expect(r.scoring_basis).toBe("harness");
    expect(r.dimensions.product_moat.subtitle).toContain("护城河");
    expect(r.dimensions.product_moat.inputs.effective_trl).toBe(6); // 4 + 0.5*4
  });

  test("无 harness 输入 → 即使 on 也走 legacy", () => {
    process.env.SCORING_HARNESS = "on";
    const r = scoreProject({ TAM_Million_RMB: 1000, CAGR: 15, TRL: 6, Competitor_Rank_Score: 6 });
    expect(r.scoring_shadow).toBeUndefined();
    expect(r.dimensions.product_moat.subtitle).toBe("TRL + 竞品排名");
  });
});
