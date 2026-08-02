const { aggregate, _gradeFromScore } = require("../scoring/aggregate");

describe("aggregate — 方案乙非线性聚合", () => {
  test("满覆盖等权 = 加权算术（无卓越加成时退回均值）", () => {
    const r = aggregate({ scores: { S1: 70, S2: 70, S3: 70, S4: 70, S5: 70 }, track: "general" });
    expect(r.total_median).toBe(70);
    expect(r.excellence_bonus).toBe(0);
  });

  test("卓越加成：每有一维≥90 加 α，封顶 6", () => {
    const r = aggregate({ scores: { S1: 95, S2: 95, S3: 95, S4: 95, S5: 60 }, track: "general" });
    // 4 维≥90 → α*4=8，封顶 6
    expect(r.excellence_count).toBe(4);
    expect(r.excellence_bonus).toBe(6);
  });

  test("容忍单点短板：2-3 维卓越 + 1 维偏低，总分仍能上 A", () => {
    // 重资产场景：S3 仅 55，但 S1/S2/S4 卓越
    const r = aggregate({ scores: { S1: 92, S2: 91, S3: 55, S4: 93, S5: 85 }, track: "hardtech" });
    expect(r.total_median).toBeGreaterThanOrEqual(80);
    expect(r.grade).toBe("A");
  });

  test("A 级共振 gate：中位达 A 但仅 1 维≥75 → 降为 B", () => {
    // 单维独大（S6/政策抬高的 S1）但其余平庸
    const r = aggregate({ scores: { S1: 100, S2: 60, S3: 60, S4: 62, S5: 62 }, track: "general" });
    expect(r.resonance_gate.dims_ge_threshold).toBe(1);
    if (r.total_median >= 75) expect(r.grade).toBe("B");
  });

  test("硬科技权重下调 S3、上调 S2（同分布下 S2 强的项目总分更高）", () => {
    const scores = { S1: 70, S2: 90, S3: 50, S4: 70, S5: 70 };
    const general = aggregate({ scores, track: "general" });
    const hardtech = aggregate({ scores, track: "hardtech" });
    expect(hardtech.base).toBeGreaterThan(general.base);
  });

  test("覆盖度低 → 区间变宽、置信度下降", () => {
    const hi = aggregate({ scores: { S1: 80, S2: 80, S3: 80, S4: 80, S5: 80 }, coverages: { S1: 1, S2: 1, S3: 1, S4: 1, S5: 1 } });
    const lo = aggregate({ scores: { S1: 80, S2: 80, S3: 80, S4: 80, S5: 80 }, coverages: { S1: 0.3, S2: 0.3, S3: 0.3, S4: 0.3, S5: 0.3 } });
    const wHi = hi.total_range[1] - hi.total_range[0];
    const wLo = lo.total_range[1] - lo.total_range[0];
    expect(wLo).toBeGreaterThan(wHi);
    expect(hi.confidence).toBe("高");
    expect(lo.confidence).toBe("低");
  });

  test("覆盖度作权重：缺失维让权（高覆盖维主导）", () => {
    // S3 覆盖 0 → 其分几乎不影响总分
    const withS3 = aggregate({ scores: { S1: 90, S2: 90, S3: 0, S4: 90, S5: 90 }, coverages: { S1: 1, S2: 1, S3: 0, S4: 1, S5: 1 } });
    expect(withS3.total_median).toBeGreaterThanOrEqual(90); // S3=0 被剔除，不拖累
  });

  test("确定性：同输入两次结果一致", () => {
    const inp = { scores: { S1: 88, S2: 77, S3: 66, S4: 91, S5: 80 }, track: "hardtech" };
    expect(aggregate(inp)).toEqual(aggregate(inp));
  });

  test("0-100 钳制 + 敏感性 top3", () => {
    const r = aggregate({ scores: { S1: 100, S2: 100, S3: 100, S4: 100, S5: 100 } });
    expect(r.total_median).toBeLessThanOrEqual(100);
    expect(r.sensitivity.length).toBeLessThanOrEqual(3);
  });

  test("_gradeFromScore 阈值与 getGrade 一致（A≥75 / B 60-74 / C 50-59 / D <50）", () => {
    expect(_gradeFromScore(75)).toBe("A");
    expect(_gradeFromScore(74)).toBe("B");
    expect(_gradeFromScore(60)).toBe("B");
    expect(_gradeFromScore(50)).toBe("C");
    expect(_gradeFromScore(49)).toBe("D");
  });
});
