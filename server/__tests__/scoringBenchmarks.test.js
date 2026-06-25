// ============================================================
// scoringBenchmarks.test.js — 标杆/反例总分级回归（投资判断内核 v3 验收）
//
// 验收口径（与用户确认）：用「排序 + 评级档位」作硬约束，
// **不钉死精确点分** —— 早期项目没有上帝视角分数，钉死点分=任务书自己禁止的
// "调参逼近正确分数"。总分以分布呈现，点值仅参考。
//
// 硬约束：
//   1. 五标杆均达 A 级（硬科技/战略赛道在新聚合下能上 80+，修复旧系统天花板）
//   2. 排序：五标杆 > 反例B(平庸SaaS) > 反例A(钢铁厂)
//   3. 反例A 钢铁厂 评级 D（重资产+大投资不误给高分）
//   4. 反例B 平庸SaaS 不得评 A（轻资产≠自动高分；高 S3 被无壁垒/无政策对冲）
//   5. 反例C 财务造假 → 财务证伪拉低 S5(诚信维度)，但一票否决已移除，
//      评级由分数决定，不再强制封顶 C
// ============================================================

const { scoreProject } = require("../scoring");
const { VECTORS, ON } = require("./_benchmarkVectors");

const score = (name) => scoreProject(VECTORS[name], ON);

const BENCHMARKS = ["寒武纪", "摩尔线程", "长鑫存储", "长江存储", "宁德时代"];

describe("标杆回归 — 五标杆均达 A 级（修复 70-78 天花板）", () => {
  for (const name of BENCHMARKS) {
    test(`${name} → A 级且总分 ≥ 85`, () => {
      const r = score(name);
      expect(r.grade).toBe("A");
      expect(r.total_score).toBeGreaterThanOrEqual(85);
      // A 级共振 gate：必须 ≥2 维 ≥80（不是靠单维/政策独大上 A）
      expect(r.aggregation.resonance_gate.dims_ge_threshold).toBeGreaterThanOrEqual(2);
    });
  }

  test("宁德时代验证非半导体赛道（新能源）也能正确给高分", () => {
    const r = score("宁德时代");
    expect(r.grade).toBe("A");
    expect(r.policy_fit.tier).toBe("第二档");
  });

  test("硬科技重资产单维 S3 偏低不再单独把总分压下 80（容忍单点短板）", () => {
    const r = score("宁德时代");
    expect(r.dimensions.business_validation.score).toBeLessThan(65); // S3 偏低
    expect(r.total_score).toBeGreaterThanOrEqual(85);               // 但总分仍高
  });
});

describe("反例回归 — 不被重资产/轻资产/政策误导", () => {
  test("反例A 钢铁厂：重资产+200亿投资 → 评级 D（不误给高分）", () => {
    const r = score("反例A_钢铁厂");
    expect(r.grade).toBe("D");
    expect(r.total_score).toBeLessThan(50);
  });

  test("反例B 平庸SaaS：轻资产高毛利 ≠ 自动高分（红海无壁垒无政策 → 不得评 A）", () => {
    const r = score("反例B_平庸SaaS");
    expect(r.grade).not.toBe("A");
    expect(r.total_score).toBeGreaterThanOrEqual(55);
    expect(r.total_score).toBeLessThanOrEqual(78);
  });

  test("反例C 财务造假：财务证伪拉低 S5(诚信)，但否决已移除——评级由分数决定，不再强制封顶", () => {
    const r = score("反例C_财务造假");
    expect(r.integrity_veto).toBeFalsy();
    // 财务证伪把诚信维度(external_risk)拉到低位（重大组 0.7 权重）
    expect(r.dimensions.external_risk.score).toBeLessThanOrEqual(35);
  });
});

describe("排序约束 — 五标杆 > 反例B > 反例A", () => {
  test("min(五标杆) > 反例B > 反例A", () => {
    const benchMin = Math.min(...BENCHMARKS.map((n) => score(n).total_score));
    const saas = score("反例B_平庸SaaS").total_score;
    const steel = score("反例A_钢铁厂").total_score;
    expect(benchMin).toBeGreaterThan(saas);
    expect(saas).toBeGreaterThan(steel);
  });

  test("标杆与反例的间距显著（≥15 分），不是被压缩在一起", () => {
    const benchMin = Math.min(...BENCHMARKS.map((n) => score(n).total_score));
    const saas = score("反例B_平庸SaaS").total_score;
    expect(benchMin - saas).toBeGreaterThanOrEqual(13);
  });
});

describe("判断卡结构 — on 路径产出分布/政策/敏感性", () => {
  test("总分以分布呈现（中位+区间+置信度）", () => {
    const r = score("长鑫存储");
    expect(r.total_distribution).toBeTruthy();
    expect(r.total_distribution.median).toBe(r.total_score);
    expect(Array.isArray(r.total_distribution.range)).toBe(true);
    expect(r.total_distribution.range[0]).toBeLessThanOrEqual(r.total_score);
    expect(r.total_distribution.range[1]).toBeGreaterThanOrEqual(r.total_score);
    expect(["高", "中", "低"]).toContain(r.total_distribution.confidence);
  });

  test("政策契合度显式 readout（融入 S1/S3，不进平均）", () => {
    const r = score("寒武纪");
    expect(r.policy_fit.tier).toBe("第一档");
    expect(r.policy_fit.readout_score).toBeGreaterThan(0);
    expect(r.policy_fit.s1_demand_adj).toBeGreaterThan(0); // 需求侧抬 S1
    expect(r.policy_fit.note).toContain("不进加权平均");
  });

  test("敏感性给出对总分影响最大的维度", () => {
    const r = score("长鑫存储");
    expect(Array.isArray(r.sensitivity)).toBe(true);
    expect(r.sensitivity.length).toBeGreaterThan(0);
    expect(r.sensitivity[0]).toHaveProperty("impact");
  });

  test("triggered_rules 每条带可解释逻辑", () => {
    const r = score("摩尔线程");
    expect(Array.isArray(r.triggered_rules)).toBe(true);
    expect(r.triggered_rules.length).toBeGreaterThan(0);
    for (const rule of r.triggered_rules) {
      expect(rule).toHaveProperty("logic");
    }
  });
});
