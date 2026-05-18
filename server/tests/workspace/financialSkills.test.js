// ============================================================
// tests/workspace/financialSkills.test.js
//
// 覆盖三个金融 skill 的 schema / 后处理逻辑:
//   - icMemo._normalizeReturnsScenarios  自洽排序
//   - dealScreening._enforceVerdictConsistency  fail>=3 强制下调
//   - unitEconomicsReview._pickFields/_mergeInputs  正确从 structured 抽字段
//   - 三个 skill 的 input schema 都能被 jsonSchema.validate 接受
// 不调用真实 LLM / DB。
// ============================================================

const icMemo = require("../../skills/icMemo");
const dealScreening = require("../../skills/dealScreening");
const ueReview = require("../../skills/unitEconomicsReview");
const grounding = require("../../skills/_groundingAudit");
const { validate } = require("../../utils/jsonSchema");

describe("icMemo · returns_scenarios 自洽", () => {
  test("LLM 乱序时按 MOIC 升序重排为 downside/base/upside", () => {
    const input = [
      { scenario: "upside", moic: 1.2, irr_pct: 5, exit_year: "2030", key_assumptions: ["a", "b"], source_refs: [] },
      { scenario: "downside", moic: 4.5, irr_pct: 35, exit_year: "2030", key_assumptions: ["a", "b"], source_refs: [] },
      { scenario: "base", moic: 2.8, irr_pct: 22, exit_year: "2030", key_assumptions: ["a", "b"], source_refs: [] },
    ];
    const out = icMemo._private._normalizeReturnsScenarios(input);
    expect(out.map((s) => s.scenario)).toEqual(["downside", "base", "upside"]);
    expect(out.map((s) => s.moic)).toEqual([1.2, 2.8, 4.5]);
  });
  test("非三条数组时原样返回(不抛错)", () => {
    expect(icMemo._private._normalizeReturnsScenarios([])).toEqual([]);
    expect(icMemo._private._normalizeReturnsScenarios(null)).toBeNull();
  });
  test("含 null moic 时不重排,只补 scenario 标签,不抛", () => {
    const input = [
      { scenario: "downside", moic: null, irr_pct: null, exit_year: "2030", key_assumptions: ["待补充"], source_refs: [] },
      { scenario: "base", moic: 2.5, irr_pct: 20, exit_year: "2030", key_assumptions: ["a", "b"], source_refs: [] },
      { scenario: "upside", moic: null, irr_pct: null, exit_year: "2030", key_assumptions: ["待补充"], source_refs: [] },
    ];
    const out = icMemo._private._normalizeReturnsScenarios(input);
    // 原顺序保留,标签也保留
    expect(out.map((s) => s.scenario)).toEqual(["downside", "base", "upside"]);
    expect(out[0].moic).toBeNull();
    expect(out[1].moic).toBe(2.5);
  });
  test("LLM 漏写 scenario 字段且含 null moic 时,按下标补默认标签", () => {
    const input = [
      { moic: null, irr_pct: null, exit_year: "2030", key_assumptions: ["待补充"], source_refs: [] },
      { moic: null, irr_pct: null, exit_year: "2030", key_assumptions: ["待补充"], source_refs: [] },
      { moic: null, irr_pct: null, exit_year: "2030", key_assumptions: ["待补充"], source_refs: [] },
    ];
    const out = icMemo._private._normalizeReturnsScenarios(input);
    expect(out.map((s) => s.scenario)).toEqual(["downside", "base", "upside"]);
  });
});

describe("icMemo · returns_scenarios schema 允许 null", () => {
  test("RETURNS_SCENARIO 单元 schema 接受 null moic / null irr_pct", () => {
    const scenarioSchema = icMemo._private.SCHEMA.properties.returns_scenarios.items;
    const ok = {
      scenario: "base",
      moic: null,
      irr_pct: null,
      exit_year: "2030",
      key_assumptions: ["退出假设待补充", "缺投资金额"],
      source_refs: [],
    };
    expect(validate(ok, scenarioSchema).valid).toBe(true);
    const okNumeric = { ...ok, moic: 2.5, irr_pct: 22 };
    expect(validate(okNumeric, scenarioSchema).valid).toBe(true);
  });
});

describe("icMemo · input schema 接受合法参数", () => {
  test("空对象通过", () => {
    expect(validate({}, icMemo.inputSchema).valid).toBe(true);
  });
  test("vote_lean + check_size_rmb_mn 通过", () => {
    expect(validate({ vote_lean: "lean_yes", check_size_rmb_mn: 30 }, icMemo.inputSchema).valid).toBe(true);
  });
  test("非法 vote_lean 被拒", () => {
    expect(validate({ vote_lean: "bullish" }, icMemo.inputSchema).valid).toBe(false);
  });
});

describe("dealScreening · verdict 自洽", () => {
  function makeCriteria(failCount, grayCount = 0) {
    const total = 10;
    const passCount = total - failCount - grayCount;
    const items = [];
    const dims = [
      "sector_fit", "geography_fit", "stage_fit", "revenue_size", "revenue_growth",
      "gross_margin", "customer_concentration", "check_size_fit", "valuation_fit", "team_quality",
    ];
    for (let i = 0; i < total; i++) {
      let status = "pass";
      if (i < failCount) status = "fail";
      else if (i < failCount + grayCount) status = "gray";
      items.push({
        dimension: dims[i], target: "x", actual: "y", status,
        rationale: "r", source_refs: [],
      });
    }
    return items;
  }
  test("fail>=3 且 LLM 给 proceed → 强制下调为 further_diligence", () => {
    const payload = {
      criteria_assessment: makeCriteria(4, 1),
      verdict: { recommendation: "proceed", headline: "go", rationale: "r", fail_count: 0, gray_count: 0 },
    };
    dealScreening._private._enforceVerdictConsistency(payload);
    expect(payload.verdict.recommendation).toBe("further_diligence");
    expect(payload.verdict.fail_count).toBe(4);
    expect(payload.verdict.gray_count).toBe(1);
    expect(payload.verdict.headline.startsWith("[自动下调]")).toBe(true);
  });
  test("fail<3 不强制下调,只刷新 count", () => {
    const payload = {
      criteria_assessment: makeCriteria(2, 3),
      verdict: { recommendation: "further_diligence", headline: "ok", rationale: "r", fail_count: 9, gray_count: 9 },
    };
    dealScreening._private._enforceVerdictConsistency(payload);
    expect(payload.verdict.recommendation).toBe("further_diligence");
    expect(payload.verdict.fail_count).toBe(2);
    expect(payload.verdict.gray_count).toBe(3);
  });
  test("无 criteria_assessment 时不抛", () => {
    const payload = { verdict: { recommendation: "pass", headline: "h", rationale: "r", fail_count: 0, gray_count: 0 } };
    expect(() => dealScreening._private._enforceVerdictConsistency(payload)).not.toThrow();
  });
  test("fail in {1,2} + proceed → 保留 proceed 但 headline 标 '需补充尽调'", () => {
    const payload = {
      criteria_assessment: makeCriteria(2, 1),
      verdict: { recommendation: "proceed", headline: "可继续", rationale: "整体良好", fail_count: 0, gray_count: 0 },
    };
    dealScreening._private._enforceVerdictConsistency(payload);
    expect(payload.verdict.recommendation).toBe("proceed");
    expect(payload.verdict.headline.includes("需补充尽调")).toBe(true);
    expect(payload.verdict.rationale.includes("[系统注]")).toBe(true);
    expect(payload.verdict.fail_count).toBe(2);
  });
  test("fail == 0 时不动 LLM 判定", () => {
    const payload = {
      criteria_assessment: makeCriteria(0, 2),
      verdict: { recommendation: "proceed", headline: "ok", rationale: "ok", fail_count: 9, gray_count: 9 },
    };
    dealScreening._private._enforceVerdictConsistency(payload);
    expect(payload.verdict.recommendation).toBe("proceed");
    expect(payload.verdict.headline).toBe("ok");
    expect(payload.verdict.rationale).toBe("ok");
  });
});

describe("grounding · countMissingRefs 软约束", () => {
  test("数组项里 source_refs 为空数组的位置被收集", () => {
    const payload = {
      risks_mitigants: [
        { risk: "a", source_refs: ["F001"] },
        { risk: "b", source_refs: [] },
        { risk: "c", source_refs: [] },
      ],
    };
    const out = grounding.countMissingRefs(payload, ["risks_mitigants"]);
    expect(out.count).toBe(2);
    expect(out.paths).toEqual(["risks_mitigants[1]", "risks_mitigants[2]"]);
  });
  test("单对象里 source_refs 为空时也算一条", () => {
    const payload = { thesis: { statement: "x", source_refs: [] } };
    const out = grounding.countMissingRefs(payload, ["thesis"]);
    expect(out.count).toBe(1);
    expect(out.paths).toEqual(["thesis"]);
  });
  test("没有 source_refs 字段时不算 miss (只看显式存在但为空的)", () => {
    const payload = { thesis: { statement: "x" } };
    const out = grounding.countMissingRefs(payload, ["thesis"]);
    expect(out.count).toBe(0);
  });
  test("路径不存在 / null 时不抛", () => {
    expect(grounding.countMissingRefs({}, ["a.b.c"]).count).toBe(0);
    expect(grounding.countMissingRefs(null, ["a"]).count).toBe(0);
  });
});

describe("grounding · assertGrounded 软约束语义", () => {
  const factPack = { facts: [{ id: "F001" }, { id: "F002" }] };
  test("空 source_refs 不触发失败(软约束)", () => {
    const payload = { risks_mitigants: [{ risk: "x", source_refs: [] }] };
    expect(() => grounding.assertGrounded(payload, factPack, {})).not.toThrow();
  });
  test("引用不存在的 F 编号仍然抛错", () => {
    const payload = { thesis: { source_refs: ["F999"] } };
    expect(() => grounding.assertGrounded(payload, factPack, {})).toThrow();
  });
  test("引用真实存在的编号通过", () => {
    const payload = { thesis: { source_refs: ["F001", "F002"] } };
    const out = grounding.assertGrounded(payload, factPack, {});
    expect(out.ok).toBe(true);
    expect(out.referenced_count).toBe(2);
  });
});

describe("dealScreening · input schema", () => {
  test("空对象通过", () => {
    expect(validate({}, dealScreening.inputSchema).valid).toBe(true);
  });
  test("自定义 fund_criteria 通过", () => {
    expect(validate({ fund_criteria: { revenue_min_rmb_mn: 30 } }, dealScreening.inputSchema).valid).toBe(true);
  });
});

describe("unitEconomicsReview · _pickFields", () => {
  test("从 upload_structured JSON 抽出 financials/ue/customers 紧凑视图", () => {
    const structured = {
      financials: {
        pl: {
          revenue: { value: 1234, unit: "万元", period: "2024", source_ref: "P15", confidence: "high" },
          gross_margin_pct: { value: 68, confidence: "high" },
          ebitda: { value: -12, confidence: "medium" },
          net_income: { value: -50, confidence: "medium" },
        },
        cf: {
          operating_cf: { value: -100, confidence: "medium" },
          runway_months: { value: 14, confidence: "medium" },
        },
        fiscal_periods: ["2024 全年", "2025 Q1-Q3"],
      },
      unit_economics: {
        ltv: { value: 12000, confidence: "high" },
        cac: { value: 3500, confidence: "high" },
        ltv_cac_ratio: { value: 3.4, confidence: "medium" },
        payback_months: { value: null, confidence: "missing" },
        nrr_pct: { value: 118, confidence: "high" },
        notes: { business_model_hint: { value: "B2B SaaS" }, warnings: ["x"] },
      },
      customers: {
        top_customers: [
          { name: "客户 A", revenue_share_pct: 45, contract_status: "已签约付款", confidence: "high" },
          { name: "客户 B", revenue_share_pct: 12, contract_status: "已签约付款", confidence: "high" },
        ],
        concentration_top3_pct: { value: 65, confidence: "high" },
        concentration_top10_pct: { value: 92, confidence: "medium" },
        notes: { warnings: [] },
      },
    };
    const out = ueReview._private._pickFields(structured);
    expect(out.financials.revenue.value).toBe(1234);
    expect(out.financials.fiscal_periods.length).toBe(2);
    expect(out.unit_economics.ltv_cac_ratio.value).toBe(3.4);
    expect(out.unit_economics.payback_months.confidence).toBe("missing");
    expect(out.unit_economics.business_model_hint).toBe("B2B SaaS");
    expect(out.customers.top_customers_count).toBe(2);
    expect(out.customers.concentration_top3_pct.value).toBe(65);
  });
  test("null structured → null", () => {
    expect(ueReview._private._pickFields(null)).toBeNull();
  });
});

describe("unitEconomicsReview · _mergeInputs", () => {
  test("多份上传取最新一份为主, 并标注 _sources", () => {
    const rows = [
      { artifactId: "A1", filename: "fin_2025q1.xlsx", structured: { financials: { pl: { revenue: { value: 100, confidence: "high" } } } } },
      { artifactId: "A2", filename: "fin_2024.xlsx", structured: { financials: { pl: { revenue: { value: 80, confidence: "high" } } } } },
    ];
    const merged = ueReview._private._mergeInputs(rows);
    expect(merged.financials.revenue.value).toBe(100);
    expect(merged._sources.length).toBe(2);
    expect(merged._sources[0].artifact_id).toBe("A1");
  });
  test("空数组 → null", () => {
    expect(ueReview._private._mergeInputs([])).toBeNull();
  });
});

describe("skill registration smoke test", () => {
  test("三个 skill 都被 builtins 导入", () => {
    // 直接 require index 触发 init 行为,确保 require chain 不抛错。
    const skillsIndex = require("../../skills");
    skillsIndex.init();
    const ids = skillsIndex.registry.list().map((s) => s.id);
    expect(ids).toContain("ic_memo");
    expect(ids).toContain("deal_screening");
    expect(ids).toContain("unit_economics_review");
  });
});
