// ============================================================
// tests/workspace/uploadStructuredExtraction.test.js
//
// 覆盖 上传结构化抽取 3 agent 的 normalize / fallback / flattenStructuredToFacts 逻辑。
// 不调用真实 LLM；只验证：
//   - LLM 返回脏数据时 normalize 能强制兜回 schema
//   - extract 失败时 buildExtractionFailedPayload 给出可消费的结构
//   - flattenToFacts 能产 fact pack 兼容数据
// ============================================================

const fin = require("../../services/extraction/financialStatementsAgent");
const ue = require("../../services/extraction/unitEconomicsAgent");
const cust = require("../../services/extraction/customerListAgent");
const orchestrator = require("../../services/extraction");

describe("上传结构化抽取 · normalize 强制兜底", () => {
  test("financialStatementsAgent.normalize 处理 LLM 自然语言占位", () => {
    const raw = {
      pl: {
        revenue: { value: "未披露", unit: "万元", confidence: "high" }, // 应被强制 null + 仍保留 confidence
        cogs: { value: "1234.5", unit: "万元", period: "2024", source_ref: "P15" }, // 字符串数字应转 number
        gross_profit: null, // missing 整段
        gross_margin_pct: { value: 75.2, confidence: "medium" },
        opex: { value: null, confidence: "missing" },
        ebitda: { value: -120, confidence: "low" },
        net_income: { value: 0, confidence: "high" },
      },
      bs: { total_assets: { value: 8000 }, cash: { value: 2000 }, total_liabilities: { value: 3000 }, equity: { value: 5000 } },
      cf: { operating_cf: { value: -800 }, investing_cf: null, financing_cf: { value: 5000 }, free_cash_flow: { value: -1200 }, runway_months: { value: 14 } },
      fiscal_periods: ["2024 全年", "2025 Q1-Q3"],
      notes: { currency: { value: "CNY", confidence: "high" }, consistency: null, warnings: ["xxx"] },
    };
    const out = fin.normalize(raw);
    expect(out.pl.revenue.value).toBeNull();
    expect(out.pl.cogs.value).toBe(1234.5);
    expect(out.pl.gross_profit.value).toBeNull();
    expect(out.pl.gross_profit.confidence).toBe("missing");
    expect(out.pl.gross_margin_pct.value).toBe(75.2);
    expect(out.cf.runway_months.value).toBe(14);
    expect(out.notes.currency.value).toBe("CNY");
    expect(out.notes.consistency.value).toBeNull();
    expect(out.fiscal_periods).toEqual(["2024 全年", "2025 Q1-Q3"]);
  });

  test("unitEconomicsAgent.normalize 处理 cohort_evidence 不规范输入", () => {
    const raw = {
      ltv: { value: 12000, unit: "USD", confidence: "high" },
      cac: { value: 3500, unit: "USD", confidence: "high" },
      ltv_cac_ratio: { value: 3.4, confidence: "medium" },
      payback_months: { value: "未披露" },
      gross_margin_pct: { value: 75 },
      churn_monthly_pct: null,
      nrr_pct: { value: 118 },
      arpa: { value: 4200 },
      cohort_evidence: [
        { cohort_id: "2024-Q1", month_offset: 6, metric: "retention", value: 0.92, confidence: "high" },
        { cohort_id: "BAD", month_offset: "not a number", metric: "fake", value: "x", confidence: "weird" },
        "completely invalid",
      ],
      notes: { business_model_hint: { value: "B2B SaaS" }, warnings: [] },
    };
    const out = ue.normalize(raw);
    expect(out.ltv.value).toBe(12000);
    expect(out.payback_months.value).toBeNull();
    // 第 3 项 "completely invalid" 是字符串被过滤掉，剩 2 个 object
    expect(out.cohort_evidence.length).toBe(2);
    expect(out.cohort_evidence[1].metric).toBe("other"); // unknown metric → "other"
    expect(out.cohort_evidence[1].confidence).toBe("missing"); // unknown confidence → "missing"
  });

  test("customerListAgent.normalize 按收入占比降序排列且过滤无效项", () => {
    const raw = {
      top_customers: [
        { name: "客户 B", revenue_share_pct: 12, contract_status: "已签约付款", since: "2023", source_ref: "P22", confidence: "high" },
        { name: "客户 A", revenue_share_pct: 45, contract_status: "已签约付款", since: "2022", source_ref: "P22", confidence: "high" },
        { name: "", revenue_share_pct: 5, contract_status: "MOU/意向", since: "2025", source_ref: "", confidence: "low" }, // 空名应过滤
        { name: "客户 C", revenue_share_pct: 8, contract_status: "未知状态枚举", since: "2024", source_ref: "P22", confidence: "high" },
      ],
      concentration_top3_pct: { value: 65, confidence: "high" },
      concentration_top10_pct: { value: 92, confidence: "medium" },
      industry_breakdown: [
        { industry: "金融", share_pct: 40 },
        { industry: "", share_pct: 10 },
      ],
      notes: { customer_disclosure_quality: { value: "公开" }, warnings: [] },
    };
    const out = cust.normalize(raw);
    // 按 revenue_share_pct 降序：A(45) → B(12) → C(8)
    expect(out.top_customers.length).toBe(3);
    expect(out.top_customers[0].name).toBe("客户 A");
    expect(out.top_customers[1].name).toBe("客户 B");
    expect(out.top_customers[2].name).toBe("客户 C");
    expect(out.top_customers[2].contract_status).toBe("待核实"); // unknown status → "待核实"
    expect(out.industry_breakdown.length).toBe(1);
  });
});

describe("上传结构化抽取 · extraction_failed payload 结构稳定", () => {
  test("financialStatementsAgent 三表骨架完整", () => {
    const p = fin.buildExtractionFailedPayload("test_reason");
    expect(p.pl.revenue.confidence).toBe("missing");
    expect(p.bs.cash.confidence).toBe("missing");
    expect(p.cf.runway_months.confidence).toBe("missing");
    expect(p.notes.warnings).toEqual(["test_reason"]);
  });

  test("orchestrator extractUploadStructured 在空输入下不抛错且结构完整", async () => {
    const out = await orchestrator.extractUploadStructured("");
    expect(out.structured.financials.pl.revenue.value).toBeNull();
    expect(out.structured.unit_economics.ltv.value).toBeNull();
    expect(out.structured.customers.top_customers).toEqual([]);
    expect(out.status).toBe("skipped");
  });
});

describe("上传结构化抽取 · flattenToFacts 兼容 Fact Pack", () => {
  test("跳过 null value，输出 upload_structured facts", () => {
    const deep = {
      financials: {
        pl: {
          revenue: { value: 12000, unit: "万元", period: "2024", source_ref: "P15", confidence: "high" },
          gross_margin_pct: { value: null, unit: "%", period: "", source_ref: "", confidence: "missing" },
          ebitda: { value: -120, unit: "万元", period: "2024", source_ref: "", confidence: "medium" },
        },
        bs: { cash: { value: 2000, unit: "万元", period: "2025-03", source_ref: "", confidence: "medium" } },
        cf: { runway_months: { value: 14, unit: "月", period: "", source_ref: "", confidence: "medium" } },
      },
      unit_economics: {
        ltv_cac_ratio: { value: 3.8, unit: "x", period: "TTM", source_ref: "", confidence: "medium" },
        cac: { value: null, confidence: "missing" },
      },
      customers: {
        concentration_top3_pct: { value: 78, unit: "%", period: "2024", source_ref: "P22", confidence: "high" },
        top_customers: [
          { name: "客户 A", revenue_share_pct: 45, contract_status: "已签约付款", source_ref: "P22", confidence: "high" },
          { name: "客户 B", revenue_share_pct: 18, contract_status: "已签约付款", source_ref: "P22", confidence: "high" },
        ],
      },
    };
    const facts = orchestrator.flattenStructuredToFacts(deep);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts[0].source_type).toBe("upload_structured");
    // null value 应被跳过 (gross_margin_pct, cac)
    const labels = facts.map((f) => f.label);
    expect(labels).toContain("上传资料-营业收入");
    expect(labels).not.toContain("上传资料-毛利率 %"); // null 跳过
    expect(labels).not.toContain("CAC");
    expect(labels).toContain("上传资料-LTV/CAC");
    expect(labels).toContain("上传资料-前 3 大客户占比 %");
    expect(labels.filter((l) => l === "上传资料-Top 1 客户").length).toBe(1);
  });

  test("空结构不抛错", () => {
    expect(orchestrator.flattenStructuredToFacts(null)).toEqual([]);
  });
});
