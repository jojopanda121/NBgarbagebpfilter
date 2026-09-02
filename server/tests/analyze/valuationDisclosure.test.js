// ============================================================
// tests/analyze/valuationDisclosure.test.js
// 估值温度计接地回归：BP 没自述估值/收入时，不得凭推断值算出倍数与溢价。
//
// 背景：曾出现过 Agent A 对一份通篇没有财务章节的 BP 推断出
// "估值 10 亿 / 收入 0.5 亿"，前端据此展示"溢价 +150%"，深度尽调再据此
// 开出"估值与收入严重倒挂"的红旗——整条结论建在凭空生成的数字上。
// ============================================================

const {
  buildValuationComparison,
} = require("../../services/pipelineService");
const { flattenPriorForTest } = require("../../agents/redFlagAgent");

const scoringResult = { grade_action: "建议尽调" };

describe("buildValuationComparison — 未披露不推断", () => {
  test("估值与收入都未披露 → 倍数/溢价归零并说明原因", () => {
    const vc = buildValuationComparison(
      {},
      { BP_Valuation: null, BP_Revenue: null, industry: "工业机器人" },
      scoringResult
    );
    expect(vc.bp_multiple).toBe(0);
    expect(vc.overvalued_pct).toBe(0);
    expect(vc.data_source).toContain("未披露");
  });

  test("只披露估值、没有收入 → 仍然不算 PS", () => {
    const vc = buildValuationComparison(
      {},
      { BP_Valuation: 10, BP_Revenue: null, industry: "工业机器人" },
      scoringResult
    );
    expect(vc.bp_multiple).toBe(0);
    expect(vc.data_source).toContain("收入/ARR");
  });

  test("BP 明确写了尚无收入(0) → 同样不算倍数", () => {
    const vc = buildValuationComparison(
      {},
      { BP_Valuation: 10, BP_Revenue: 0, industry: "工业机器人" },
      scoringResult
    );
    expect(vc.bp_multiple).toBe(0);
  });

  test("未披露时，即使模型给了 valuation_comparison 也不采信", () => {
    const modelOutput = {
      valuation_comparison: {
        bp_multiple: 20,
        industry_avg_multiple: 8,
        overvalued_pct: 150,
        data_source: "估算：BP 隐含估值 10 亿/收入 0.5 亿（均未披露，为提取推断值）",
      },
    };
    const vc = buildValuationComparison(
      modelOutput,
      { BP_Valuation: null, BP_Revenue: null, industry: "工业机器人" },
      scoringResult
    );
    expect(vc.bp_multiple).toBe(0);
    expect(vc.overvalued_pct).toBe(0);
  });

  test("两者都自述了 → 正常算倍数", () => {
    const vc = buildValuationComparison(
      {},
      { BP_Valuation: 10, BP_Revenue: 2, industry: "工业机器人" },
      scoringResult
    );
    expect(vc.bp_multiple).toBe(5);
  });

  test("模型给了完整对标时按模型结果走", () => {
    const vc = buildValuationComparison(
      { valuation_comparison: { bp_multiple: 5, industry_avg_multiple: 4, overvalued_pct: 25 } },
      { BP_Valuation: 10, BP_Revenue: 2, industry: "工业机器人" },
      scoringResult
    );
    expect(vc.overvalued_pct).toBe(25);
  });
});

describe("redFlagAgent 前置输出摊平 — 不得出现 [object Object]", () => {
  test("对象型字段取可读文本而非 [object Object]", () => {
    const summary = flattenPriorForTest({
      founder: {
        userOutput: {
          team_assessment: { completeness_score: 2, summary: "团队信息严重缺失" },
          risk_flags: [{ founder_name: "未披露", flag_type: "团队失衡", evidence: "BP 无团队章节" }],
        },
      },
      competitor: {
        userOutput: {
          track_definition: { narrow_track: "爬壁焊接机器人", track_maturity: "快速增长" },
          competitors: [{ name: "A" }, { name: "B" }],
        },
      },
      financial: {
        userOutput: {
          overall_credibility: 0,
          anomalies: [{ anomaly_type: "数据缺失", description: "无财务章节" }],
        },
      },
    });

    expect(summary).not.toContain("[object Object]");
    expect(summary).toContain("团队信息严重缺失");
    expect(summary).toContain("团队失衡：BP 无团队章节");
    expect(summary).toContain("爬壁焊接机器人");
    expect(summary).toContain("数据缺失：无财务章节");
    // credibility=0 是合法评分，不能被 || 吞成空字符串
    expect(summary).toContain("可信度：0");
  });
});
