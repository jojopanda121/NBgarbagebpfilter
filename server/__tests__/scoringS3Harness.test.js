const { scoreS3Harness } = require("../scoring/s3Harness");
const { scoreProject } = require("../scoring");

// 三个标的（设计目标的 sanity check 基准），固化成回归用例：
//   A 长鑫存储(DRAM IDM)：2200亿，全球4家，CAGR15%，良率驱动指数级规模 → 60-75
//   B SaaS：毛利80%，双边网络，轻资产，高增长                          → 85-95
//   C 钢铁厂：200亿，200家竞争，CAGR2%，线性规模效应                    → 15-25
//   排序必须 B > A > C，且 (A−C) 间距 > (B−A) 间距。
const DRAM = {
  s3Rubric: {
    capital_archetype: "重资产制造",
    scale_type: "规模经济",
    cost_curve_steepness: "指数级",
    global_player_count: 4,
    market_cagr: 15,
    policy_tier: "国家级",
    capital_source: "大基金主导",
  },
  grossMargin: 0.45,
};
const SAAS = {
  s3Rubric: {
    capital_archetype: "纯软件SaaS",
    scale_type: "双边网络效应",
    cost_curve_steepness: "边际成本趋零",
    market_cagr: 20,
    policy_tier: "无",
    capital_source: "市场化",
  },
  grossMargin: 0.80,
};
const STEEL = {
  s3Rubric: {
    capital_archetype: "重资产制造",
    scale_type: "规模经济",
    cost_curve_steepness: "普通规模经济",
    global_player_count: 200,
    market_cagr: 2,
    policy_tier: "无",
    capital_source: "国资参与",
  },
  grossMargin: 0.12,
};

describe("scoreS3Harness — 三标的 sanity check", () => {
  const a = scoreS3Harness(DRAM).S3;
  const b = scoreS3Harness(SAAS).S3;
  const c = scoreS3Harness(STEEL).S3;

  test("A 长鑫存储(DRAM) 落在 60-75", () => {
    expect(a).toBeGreaterThanOrEqual(60);
    expect(a).toBeLessThanOrEqual(75);
  });

  test("B SaaS 落在 85-95", () => {
    expect(b).toBeGreaterThanOrEqual(85);
    expect(b).toBeLessThanOrEqual(95);
  });

  test("C 钢铁厂 落在 15-25", () => {
    expect(c).toBeGreaterThanOrEqual(15);
    expect(c).toBeLessThanOrEqual(25);
  });

  test("排序 B > A > C", () => {
    expect(b).toBeGreaterThan(a);
    expect(a).toBeGreaterThan(c);
  });

  test("(A−C) 间距 > (B−A) 间距（资本壁垒+新质把重资产顶上来，但好坏重资产被拉开）", () => {
    expect(a - c).toBeGreaterThan(b - a);
  });
});

describe("scoreS3Harness — 核心机制", () => {
  test("资本壁垒溢价：同为重资产 IDM，玩家少(4家)显著高于玩家多(200家)", () => {
    const few = scoreS3Harness({ s3Rubric: { ...DRAM.s3Rubric, global_player_count: 4 }, grossMargin: 0.45 });
    const many = scoreS3Harness({ s3Rubric: { ...DRAM.s3Rubric, global_player_count: 200 }, grossMargin: 0.45 });
    expect(few.detail.CBP).toBe(16);
    expect(many.detail.CBP).toBe(0);
    expect(few.S3 - many.S3).toBe(16);
  });

  test("资本密集闸门：轻资产(SaaS)即便玩家很少也拿不到资本壁垒溢价", () => {
    const r = scoreS3Harness({ s3Rubric: { ...SAAS.s3Rubric, global_player_count: 2 }, grossMargin: 0.80 });
    expect(r.detail.gate).toBe(0);
    expect(r.detail.CBP).toBe(0);
  });

  test("成本曲线陡峭度：同为'规模经济'类型，指数级 k 远高于近线性 k", () => {
    const steep = scoreS3Harness({ s3Rubric: { ...STEEL.s3Rubric, cost_curve_steepness: "指数级" } });
    const flat = scoreS3Harness({ s3Rubric: { ...STEEL.s3Rubric, cost_curve_steepness: "近线性" } });
    expect(steep.detail.G).toBeGreaterThan(flat.detail.G);
    expect(steep.detail.k).toBe(3.8);
    expect(flat.detail.k).toBe(1.0);
  });

  test("资本耐心 gating：战略赛道(国家级)豁免资本效率惩罚，非战略(无)不豁免", () => {
    const strategic = scoreS3Harness({ s3Rubric: { capital_archetype: "重资产制造", policy_tier: "国家级", capital_source: "大基金主导" } });
    const commodity = scoreS3Harness({ s3Rubric: { capital_archetype: "重资产制造", policy_tier: "无", capital_source: "大基金主导" } });
    expect(strategic.detail.lambda).toBe(0.20);
    expect(commodity.detail.lambda).toBe(0); // 非战略：即使大基金也不豁免，避免给产能过剩放水
    expect(strategic.detail.CE).toBeGreaterThan(commodity.detail.CE);
  });

  test("新质生产力：高增速+国家战略 显著高于 低增速+非战略", () => {
    const newProd = scoreS3Harness({ s3Rubric: { ...DRAM.s3Rubric } });
    const traditional = scoreS3Harness({ s3Rubric: { ...STEEL.s3Rubric } });
    expect(newProd.detail.N).toBe(13); // 成长6 + 政策7
    expect(traditional.detail.N).toBe(0); // 成长0 + 政策0
  });

  test("毛利修正保留：≥70%→+6，<30%→−6，缺失→0", () => {
    expect(scoreS3Harness({ s3Rubric: SAAS.s3Rubric, grossMargin: 0.80 }).detail.GM_adj).toBe(6);
    expect(scoreS3Harness({ s3Rubric: STEEL.s3Rubric, grossMargin: 0.12 }).detail.GM_adj).toBe(-6);
    expect(scoreS3Harness({ s3Rubric: DRAM.s3Rubric }).detail.GM_adj).toBe(0);
  });
});

describe("scoreS3Harness — 确定性 / 回退 / 边界", () => {
  test("确定性：同输入两次结果一致", () => {
    expect(scoreS3Harness(DRAM)).toEqual(scoreS3Harness(DRAM));
  });

  test("0-100 钳制", () => {
    const r = scoreS3Harness(SAAS);
    expect(r.S3).toBeLessThanOrEqual(100);
    expect(r.S3).toBeGreaterThanOrEqual(0);
  });

  test("回退：无 S3_Rubric 时用 legacy 枚举，basis=legacy", () => {
    const r = scoreS3Harness({ archetype: "纯软件SaaS", scaleMechanism: "双边网络效应", grossMargin: 0.80, fallbackCagr: 20 });
    expect(r.basis).toBe("legacy");
    expect(r.detail.archetype).toBe("纯软件SaaS");
    expect(r.S3).toBeGreaterThan(0);
  });

  test("basis=harness 仅当含新维度输入（玩家数/政策/陡峭度/资本来源）", () => {
    expect(scoreS3Harness({ s3Rubric: { capital_archetype: "重资产制造" } }).basis).toBe("legacy");
    expect(scoreS3Harness({ s3Rubric: { capital_archetype: "重资产制造", global_player_count: 4 } }).basis).toBe("harness");
  });

  test("玩家数缺失：不给资本壁垒溢价（无证据保守）", () => {
    const r = scoreS3Harness({ s3Rubric: { capital_archetype: "重资产制造", policy_tier: "国家级" } });
    expect(r.detail.CBP).toBe(0);
  });

  test("CAGR 回退到 fallbackCagr（S1 已算出）", () => {
    const r = scoreS3Harness({ s3Rubric: { capital_archetype: "软硬结合", policy_tier: "省级" }, fallbackCagr: 30 });
    expect(r.detail.cagr).toBe(30);
    expect(r.detail.growth_score).toBe(9); // CAGR≥25
  });

  test("全空输入不崩，落中性区间", () => {
    const r = scoreS3Harness({});
    expect(typeof r.S3).toBe("number");
    expect(r.S3).toBeGreaterThanOrEqual(0);
    expect(r.S3).toBeLessThanOrEqual(100);
  });
});

describe("scoreProject — S3 harness 灰度集成", () => {
  // 用 DRAM 画像构造一份最小 project 数据（其余维度给中性）
  const baseData = {
    TAM_Million_RMB: 50000, CAGR: 15,
    Industry_Capital_Score: 2, Industry_Scale_Score: 6, // legacy：重资产 → 旧 S3≈40
    Capital_Archetype: "重资产制造", Scale_Mechanism: "规模经济",
    S3_Rubric: { ...DRAM.s3Rubric, gross_margin: 0.45 },
    Founder_Exp_Years: 10,
  };

  test("off：S3 走 legacy（裸分 2/6 → 2*5+6*5=40，重资产被旧公式压低）", () => {
    const r = scoreProject(baseData, { modeOverride: "off", s3ModeOverride: "off" });
    expect(r.dimensions.business_validation.score).toBe(40);
    expect(r.scoring_s3_shadow).toBeUndefined();
  });

  test("on：S3 走 harness（资本壁垒+新质把 DRAM 顶到 60-75）", () => {
    const r = scoreProject(baseData, { modeOverride: "off", s3ModeOverride: "on" });
    expect(r.dimensions.business_validation.score).toBeGreaterThanOrEqual(60);
    expect(r.dimensions.business_validation.score).toBeLessThanOrEqual(75);
    expect(r.dimensions.business_validation.inputs).toHaveProperty("CBP", 16);
  });

  test("shadow：live 仍是 legacy，附 scoring_s3_shadow 对照块", () => {
    const r = scoreProject(baseData, { modeOverride: "off", s3ModeOverride: "shadow" });
    const legacyS3 = r.dimensions.business_validation.score;
    expect(r.scoring_s3_shadow).toBeDefined();
    expect(r.scoring_s3_shadow.S3).toBeGreaterThanOrEqual(60);
    expect(r.scoring_s3_shadow.delta_S3).toBe(r.scoring_s3_shadow.S3 - legacyS3);
  });

  test("S3 harness 与 S2 harness 灰度互不干扰（S2 off + S3 on）", () => {
    const r = scoreProject(baseData, { modeOverride: "off", s3ModeOverride: "on" });
    expect(r.dimensions.business_validation.score).toBeGreaterThanOrEqual(60);
    // S2 仍走 legacy
    expect(r.dimensions.product_moat.subtitle).toContain("TRL");
  });

  test("无 S3_Rubric：即使 s3 on 也安全回退 legacy 不报错", () => {
    const noRubric = { ...baseData };
    delete noRubric.S3_Rubric;
    const r = scoreProject(noRubric, { modeOverride: "off", s3ModeOverride: "on" });
    expect(typeof r.dimensions.business_validation.score).toBe("number");
    expect(r.scoring_s3_shadow).toBeUndefined();
  });
});
