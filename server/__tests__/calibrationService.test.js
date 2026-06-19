const {
  labelToRank, rankingConcordance, systematicBias, ruleBacktest, driftReport, summarizeDiagnostics, pickScore,
} = require("../services/calibrationService");

describe("calibrationService — 纯诊断函数（不依赖 DB）", () => {
  test("labelToRank：中英文标签 → 偏好序数", () => {
    expect(labelToRank("投")).toBe(3);
    expect(labelToRank("观望")).toBe(1);
    expect(labelToRank("放弃")).toBe(0);
    expect(labelToRank("fast_track")).toBe(3);
    expect(labelToRank("未知标签")).toBeNull();
  });

  test("rankingConcordance：分数序与偏好序完全一致 → τ=1", () => {
    const r = rankingConcordance([
      { score: 90, rank: 3 }, { score: 70, rank: 2 }, { score: 50, rank: 1 }, { score: 30, rank: 0 },
    ]);
    expect(r.tau).toBe(1);
    expect(r.discordant).toBe(0);
  });

  test("rankingConcordance：完全反序 → τ=-1", () => {
    const r = rankingConcordance([
      { score: 90, rank: 0 }, { score: 70, rank: 1 }, { score: 50, rank: 2 }, { score: 30, rank: 3 },
    ]);
    expect(r.tau).toBe(-1);
    expect(r.concordant).toBe(0);
  });

  test("systematicBias：投>观望>放弃 的均分序正确 → ordering_ok", () => {
    const r = systematicBias([
      { score: 90, label: "投" }, { score: 88, label: "投" },
      { score: 70, label: "观望" }, { score: 45, label: "放弃" },
    ]);
    expect(r.ordering_ok).toBe(true);
    expect(r.by_label["投"].mean).toBe(89);
  });

  test("systematicBias：放弃项目均分反而更高 → ordering 不通过（暴露系统性偏差）", () => {
    const r = systematicBias([
      { score: 50, label: "投" }, { score: 90, label: "放弃" },
    ]);
    expect(r.ordering_ok).toBe(false);
  });

  test("ruleBacktest：某规则只出现在 GP 想投的项目 → alpha候选(lift>0)", () => {
    const r = ruleBacktest([
      { tags: ["policy_chokepoint_substitution"], rank: 3 },
      { tags: ["policy_chokepoint_substitution"], rank: 3 },
      { tags: [], rank: 1 },
      { tags: [], rank: 0 },
    ]);
    const tag = r.by_tag["policy_chokepoint_substitution"];
    expect(tag.lift).toBeGreaterThan(0);
    expect(tag.verdict).toBe("alpha候选");
  });

  test("ruleBacktest：某规则集中在 GP 放弃的项目 → 偏见候选(lift<0)", () => {
    const r = ruleBacktest([
      { tags: ["spurious"], rank: 0 }, { tags: ["spurious"], rank: 0 },
      { tags: [], rank: 3 }, { tags: [], rank: 2 },
    ]);
    expect(r.by_tag["spurious"].verdict).toBe("偏见候选");
  });

  test("driftReport：均值/中位偏移", () => {
    const r = driftReport([80, 82, 84], [70, 72, 74]);
    expect(r.mean_shift).toBe(10);
    expect(r.median_shift).toBe(10);
  });

  test("pickScore：切 on 前必须用新聚合分（agg_shadow.total_median）而非旧 live 分", () => {
    const shadowRow = { total_score: 72, agg_shadow_json: JSON.stringify({ total_median: 91 }), scoring_agg_basis: "legacy" };
    expect(pickScore(shadowRow, false)).toBe(72); // 旧 live（错误对象）
    expect(pickScore(shadowRow, true)).toBe(91);  // 新聚合（正确对象）
  });

  test("pickScore：已切 on 的记录，live 本身就是新分", () => {
    const onRow = { total_score: 88, agg_shadow_json: null, scoring_agg_basis: "aggregate_v3" };
    expect(pickScore(onRow, true)).toBe(88);
  });

  test("pickScore：off/legacy 记录无新分 → null（useShadow 时被忽略）", () => {
    const legacyRow = { total_score: 70, agg_shadow_json: null, scoring_agg_basis: "legacy" };
    expect(pickScore(legacyRow, true)).toBeNull();
  });

  test("summarizeDiagnostics：只统计有标签的样本", () => {
    const r = summarizeDiagnostics([
      { score: 90, label: "投", tags: ["a"] },
      { score: 40, label: "放弃", tags: ["b"] },
      { score: 70, label: null, tags: ["c"] }, // 无标签 → 不计入
    ]);
    expect(r.total_records).toBe(3);
    expect(r.labeled_records).toBe(2);
    expect(r.ranking_concordance.tau).toBe(1);
    expect(r.note).toContain("不自动反解");
  });
});
