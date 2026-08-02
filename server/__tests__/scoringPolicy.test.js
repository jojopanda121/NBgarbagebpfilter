const { scorePolicyFit, isHardtechTrack } = require("../scoring/policy");

describe("scorePolicyFit — 政策融入 S1/S3（不设独立维度）", () => {
  test("第一档关键核心技术：高 readout + 大需求侧加成", () => {
    const r = scorePolicyFit({ tier: "第一档" });
    expect(r.coverage).toBe(1);
    expect(r.readout_score).toBeGreaterThanOrEqual(90);
    expect(r.s1_demand_adj).toBeGreaterThan(0);
  });

  test("第五档产能过剩：需求侧负向（压天花板）", () => {
    const r = scorePolicyFit({ tier: "第五档" });
    expect(r.s1_demand_adj).toBeLessThan(0);
    expect(r.readout_score).toBeLessThan(40);
  });

  test("卡脖子/国产替代刚需 → 追加需求侧加成", () => {
    const base = scorePolicyFit({ tier: "第二档" });
    const choke = scorePolicyFit({ tier: "第二档", chokepointSubstitution: true });
    expect(choke.s1_demand_adj).toBeGreaterThan(base.s1_demand_adj);
  });

  test("地缘/出口管制敞口大 → 资本侧诚实扣分（s3_capital<0）", () => {
    const r = scorePolicyFit({ tier: "第一档", geoExposure: "high" });
    expect(r.s3_capital_adj).toBeLessThan(0);
  });

  test("无法归类 → coverage=0，零注入（不默认中性）", () => {
    const r = scorePolicyFit({});
    expect(r.coverage).toBe(0);
    expect(r.s1_demand_adj).toBe(0);
    expect(r.s3_capital_adj).toBe(0);
    expect(r.readout_score).toBeNull();
  });

  test("赛道大类派生档位（无显式 tier 时）", () => {
    const r = scorePolicyFit({ industryCategory: "芯片半导体" });
    expect(r.tier).toBe("第一档");
  });

  test("纯概念无产业化 → 取档下沿（需求侧打折）", () => {
    const full = scorePolicyFit({ tier: "第三档", industrialization: true });
    const concept = scorePolicyFit({ tier: "第三档", industrialization: false });
    expect(concept.s1_demand_adj).toBeLessThan(full.s1_demand_adj);
  });

  test("s1_demand 钳制在范围内", () => {
    const r = scorePolicyFit({ tier: "第一档", chokepointSubstitution: true });
    expect(r.s1_demand_adj).toBeLessThanOrEqual(18);
  });

  test("triggered_rules 每条带逻辑解释", () => {
    const r = scorePolicyFit({ tier: "第一档", chokepointSubstitution: true, geoExposure: "high" });
    expect(r.triggered_rules.length).toBeGreaterThanOrEqual(2);
    for (const rule of r.triggered_rules) {
      expect(rule).toHaveProperty("logic");
      expect(rule).toHaveProperty("effect");
    }
  });

  test("isHardtechTrack：第一/二/三档走硬科技档，其余 general", () => {
    expect(isHardtechTrack("第一档")).toBe(true);
    expect(isHardtechTrack("第二档")).toBe(true);
    expect(isHardtechTrack("第三档")).toBe(true);
    expect(isHardtechTrack("第四档")).toBe(false);
    expect(isHardtechTrack(null)).toBe(false);
  });

  test("确定性：同输入两次一致", () => {
    const inp = { tier: "第一档", chokepointSubstitution: true, geoExposure: "medium" };
    expect(scorePolicyFit(inp)).toEqual(scorePolicyFit(inp));
  });
});
