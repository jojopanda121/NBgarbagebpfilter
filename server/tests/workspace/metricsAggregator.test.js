// ============================================================
// tests/workspace/metricsAggregator.test.js
//
// 覆盖 P3-4 metrics aggregator:
//   - 从 mock 的 skill_runs 行聚合各项指标
//   - fallback ratio / semantic_audit 分布 / bp_deep_parsing 使用率
//   - 处理无 metadata_json 的旧行（不崩溃）
//   - top_errors / sector_compliance_categories 排序
//   - percentile / avg / pct 辅助函数
// ============================================================

describe("P3-4 metricsAggregator · 聚合主流程", () => {
  let agg;
  let mockRows;

  beforeEach(() => {
    jest.resetModules();
    mockRows = [];
    jest.doMock("../../db", () => ({
      getDb: () => ({
        prepare: () => ({
          all: () => mockRows,
        }),
      }),
    }));
    agg = require("../../services/metricsAggregator");
  });

  afterEach(() => {
    jest.dontMock("../../db");
    jest.resetModules();
  });

  test("空数据返回空 skills 数组", () => {
    const summary = agg.aggregateSkillMetrics({ days: 7 });
    expect(summary.skills).toEqual([]);
    expect(summary.sample_size).toBe(0);
    expect(summary.window_days).toBe(7);
  });

  test("按 skill_id 分组 + 计算成功率 / 延时分布", () => {
    mockRows = [
      { id: "1", skill_id: "onepager_pptx", status: "succeeded", duration_ms: 1000, metadata_json: null, created_at: "2026-05-17" },
      { id: "2", skill_id: "onepager_pptx", status: "succeeded", duration_ms: 2000, metadata_json: null, created_at: "2026-05-17" },
      { id: "3", skill_id: "onepager_pptx", status: "failed", duration_ms: 500, metadata_json: null, error: "LLM timeout: socket hangup", created_at: "2026-05-17" },
      { id: "4", skill_id: "ic_questions_xlsx", status: "succeeded", duration_ms: 8000, metadata_json: null, created_at: "2026-05-17" },
    ];
    const summary = agg.aggregateSkillMetrics({ days: 7 });
    expect(summary.skills.length).toBe(2);
    const onepager = summary.skills.find((s) => s.skill_id === "onepager_pptx");
    expect(onepager.total_runs).toBe(3);
    expect(onepager.success_rate_pct).toBe(66.7);
    expect(onepager.failure_rate_pct).toBe(33.3);
    expect(onepager.latency_avg_ms).toBe(1166.67);
    expect(onepager.top_errors[0].signature).toContain("LLM timeout");
    expect(onepager.top_errors[0].count).toBe(1);
    // ic_questions_xlsx 排在 onepager 后面（runs 少）
    expect(summary.skills[0].skill_id).toBe("onepager_pptx");
  });

  test("聚合 fallback ratio: preferred_missing / preferred_total", () => {
    mockRows = [
      {
        skill_id: "onepager_pptx", status: "succeeded", duration_ms: 1000,
        metadata_json: JSON.stringify({ fallback: { preferred_missing: 3, preferred_total: 12 } }),
        created_at: "2026-05-17",
      },
      {
        skill_id: "onepager_pptx", status: "succeeded", duration_ms: 1000,
        metadata_json: JSON.stringify({ fallback: { preferred_missing: 5, preferred_total: 12 } }),
        created_at: "2026-05-17",
      },
    ];
    const summary = agg.aggregateSkillMetrics({ days: 7 });
    const s = summary.skills[0];
    expect(s.fallback.preferred_missing_total).toBe(8);
    expect(s.fallback.preferred_total).toBe(24);
    expect(s.fallback.preferred_missing_ratio_pct).toBeCloseTo(33.3, 1);
  });

  test("聚合 semantic_audit verdict 分布", () => {
    mockRows = [
      {
        skill_id: "ic_questions_xlsx", status: "succeeded", duration_ms: 1000,
        metadata_json: JSON.stringify({
          semantic_audit: { sampled: 10, entailed: 7, contradicted: 1, unclear: 2 },
        }),
        created_at: "2026-05-17",
      },
      {
        skill_id: "ic_questions_xlsx", status: "succeeded", duration_ms: 1000,
        metadata_json: JSON.stringify({
          semantic_audit: { sampled: 10, entailed: 9, contradicted: 0, unclear: 1 },
        }),
        created_at: "2026-05-17",
      },
    ];
    const s = agg.aggregateSkillMetrics({ days: 7 }).skills[0];
    expect(s.semantic_audit.sampled_total).toBe(20);
    expect(s.semantic_audit.entailed_pct).toBe(80);
    expect(s.semantic_audit.contradicted_pct).toBe(5);
    expect(s.semantic_audit.unclear_pct).toBe(15);
  });

  test("bp_deep_parsing / institutional_memory 使用率 + 平均 count", () => {
    mockRows = [
      {
        skill_id: "ic_questions_xlsx", status: "succeeded", duration_ms: 1000,
        metadata_json: JSON.stringify({ bp_deep_parsing_used: true, bp_deep_fact_count: 18, institutional_memory_used: true, institutional_memory_count: 4 }),
        created_at: "2026-05-17",
      },
      {
        skill_id: "ic_questions_xlsx", status: "succeeded", duration_ms: 1000,
        metadata_json: JSON.stringify({ bp_deep_parsing_used: false, institutional_memory_used: true, institutional_memory_count: 2 }),
        created_at: "2026-05-17",
      },
    ];
    const s = agg.aggregateSkillMetrics({ days: 7 }).skills[0];
    expect(s.bp_deep_parsing.usage_rate_pct).toBe(50);
    expect(s.bp_deep_parsing.avg_fact_count).toBe(18);
    expect(s.institutional_memory.usage_rate_pct).toBe(100);
    expect(s.institutional_memory.avg_match_count).toBe(3);
  });

  test("sector_compliance_hits 排序 + top 5", () => {
    mockRows = [
      {
        skill_id: "dd_questions", status: "succeeded", duration_ms: 1000,
        metadata_json: JSON.stringify({ sector_compliance_hits: ["medical_device", "ai_genai"] }),
        created_at: "2026-05-17",
      },
      {
        skill_id: "dd_questions", status: "succeeded", duration_ms: 1000,
        metadata_json: JSON.stringify({ sector_compliance_hits: ["ai_genai"] }),
        created_at: "2026-05-17",
      },
      {
        skill_id: "dd_questions", status: "succeeded", duration_ms: 1000,
        metadata_json: JSON.stringify({ sector_compliance_hits: ["ai_genai", "cross_border_data"] }),
        created_at: "2026-05-17",
      },
    ];
    const s = agg.aggregateSkillMetrics({ days: 7 }).skills[0];
    expect(s.sector_compliance.hit_rate_pct).toBe(100);
    const top = s.sector_compliance.top_categories;
    expect(top[0].category).toBe("ai_genai");
    expect(top[0].count).toBe(3);
    expect(top.length).toBe(3);
  });

  test("llm_repairs 数字 vs object 都支持", () => {
    mockRows = [
      {
        skill_id: "onepager_pptx", status: "succeeded", duration_ms: 1000,
        metadata_json: JSON.stringify({ llm_repairs: 2 }),
        created_at: "2026-05-17",
      },
      {
        skill_id: "onepager_pptx", status: "succeeded", duration_ms: 1000,
        metadata_json: JSON.stringify({ llm_repairs: { bull: 0, bear: 1, synth: 0, val_exit: 3 } }),
        created_at: "2026-05-17",
      },
    ];
    const s = agg.aggregateSkillMetrics({ days: 7 }).skills[0];
    // bull+bear+synth+val_exit = 4, 加上数字 2 = 6 / 2 runs = 3
    expect(s.avg_llm_repairs).toBe(3);
  });

  test("grounding ok_rate 聚合", () => {
    mockRows = [
      {
        skill_id: "x", status: "succeeded", duration_ms: 1000,
        metadata_json: JSON.stringify({ grounding_ok: true, grounding_referenced_count: 12 }),
        created_at: "2026-05-17",
      },
      {
        skill_id: "x", status: "succeeded", duration_ms: 1000,
        metadata_json: JSON.stringify({ grounding_ok: true, grounding_referenced_count: 8 }),
        created_at: "2026-05-17",
      },
      {
        skill_id: "x", status: "succeeded", duration_ms: 1000,
        metadata_json: JSON.stringify({ grounding_ok: false }),
        created_at: "2026-05-17",
      },
    ];
    const s = agg.aggregateSkillMetrics({ days: 7 }).skills[0];
    expect(s.grounding.evaluated_runs).toBe(3);
    expect(s.grounding.ok_rate_pct).toBeCloseTo(66.7, 1);
    expect(s.grounding.avg_referenced_count).toBe(10);
  });

  test("旧行无 metadata_json 不崩溃", () => {
    mockRows = [
      { skill_id: "old_skill", status: "succeeded", duration_ms: 500, created_at: "2026-05-17" },
      { skill_id: "old_skill", status: "succeeded", duration_ms: 700, created_at: "2026-05-17" },
    ];
    const s = agg.aggregateSkillMetrics({ days: 7 }).skills[0];
    expect(s.total_runs).toBe(2);
    expect(s.fallback.preferred_missing_ratio_pct).toBeNull();
    expect(s.semantic_audit).toBeNull();
  });
});

describe("P3-4 metricsAggregator · helpers", () => {
  const agg = require("../../services/metricsAggregator");
  test("_percentile p50 / p95", () => {
    expect(agg._private._percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(agg._private._percentile([1, 2, 3, 4, 5], 0.95)).toBe(5);
    expect(agg._private._percentile([], 0.5)).toBeNull();
  });
  test("_pct 处理 0 分母", () => {
    expect(agg._private._pct(0, 0)).toBeNull();
    expect(agg._private._pct(3, 12)).toBe(25);
  });
});
