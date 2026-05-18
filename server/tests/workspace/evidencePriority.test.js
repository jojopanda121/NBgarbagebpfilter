// ============================================================
// tests/workspace/evidencePriority.test.js
//
// 覆盖 P3 fix 改造后的证据优先级流：
//   1) evidence_policy 文本里"用户上传 > 外部检索 > 旧 BP 分析 > BP 深度解析"
//   2) formatFactPackForPrompt 按 source_type 分组渲染
//   3) appendBpDeepFacts 不会用短 hint 文本 (stage_context / focus_dimension) 触发
//   4) _evidenceMaterial 把 enableBpDeepParsing 透传到 buildEvidencePack
//   5) registry 把 skill metadata 写入 skill_runs.metadata_json
// ============================================================

describe("P3 fix · evidence_policy 优先级文本", () => {
  test("buildEvidencePack 写出的 evidence_policy 顺序正确 (上传 > 外部检索 > 旧 BP > BP 深度解析)", async () => {
    jest.resetModules();
    jest.doMock("../../skills/_projectContext", () => ({
      buildContext: () => ({ project: { name: "X" }, extracted_data: {}, verdict: {}, claim_verdicts: [], deep_research_excerpt: "" }),
    }));
    const fp = require("../../skills/_factPack");
    const out = await fp.buildEvidencePack({ id: 1, name: "X" }, { useSearch: false });
    const policy = out.factPack.evidence_policy;
    // 必须包含完整优先级链
    expect(policy).toMatch(/用户上传材料 > 外部检索\/实时搜索交叉验证 > 上一轮 BP 分析\/项目结构化数据 > BP 原文\/BP 深度解析/);
    // 必须把 BP 标为被审查对象
    expect(policy).toMatch(/BP 本身是被审查对象，不是可信事实源/);
    // 必须明确说 D 编号本质 = 公司自报
    expect(policy).toMatch(/D 编号.*来源仍是 BP.*公司自报/s);
    // K 编号必须标注为参考
    expect(policy).toMatch(/K 编号.*仅作为.*思考参考/s);
    jest.dontMock("../../skills/_projectContext");
  });
});

describe("P3 fix · formatFactPackForPrompt 按 source_type 分组", () => {
  test("各 source_type 输出为独立分段且按优先级排序", () => {
    const { formatFactPackForPrompt } = require("../../skills/_factPack");
    const factPack = {
      project_name: "Test",
      facts: [
        { id: "F003", label: "上一轮分析-行业", value: "AI SaaS", source_type: "project_context", source_name: "WS", confidence: "high" },
        { id: "F001", label: "上传摘要", value: "某 PDF", source_type: "upload", source_name: "bp.pdf", confidence: "high" },
        { id: "F002", label: "外部搜索-tam", value: "TAM 800 亿", source_type: "external_search", source_name: "report", confidence: "medium" },
        { id: "D001", label: "营收", value: "1.2 亿", source_type: "bp_deep_parsing", source_name: "BP 深度解析", confidence: "low" },
        { id: "K001", label: "历史先例", value: "公司 X invested 2023", source_type: "institutional_memory", source_name: "机构知识库", confidence: "medium" },
      ],
      evidence_policy: "policy",
      missing_policy: "missing",
    };
    const text = formatFactPackForPrompt(factPack);
    // 必须包含 5 个分组 header
    expect(text).toMatch(/用户上传资料/);
    expect(text).toMatch(/外部搜索交叉验证/);
    expect(text).toMatch(/上一轮 BP 分析 \/ 项目结构化数据/);
    expect(text).toMatch(/BP 原文深度解析/);
    expect(text).toMatch(/机构历史先例/);
    // upload section 必须出现在 external_search 之前 (用 ## 【 prefix 精确定位 section header,
    // 避免 policy 文本里其它处出现关键词造成误判)
    const idx = (kw) => text.indexOf(`## 【${kw}`);
    expect(idx("用户上传资料")).toBeGreaterThan(-1);
    expect(idx("用户上传资料")).toBeLessThan(idx("外部搜索交叉验证"));
    expect(idx("外部搜索交叉验证")).toBeLessThan(idx("上一轮 BP 分析"));
    expect(idx("上一轮 BP 分析")).toBeLessThan(idx("BP 原文深度解析"));
    expect(idx("BP 原文深度解析")).toBeLessThan(idx("机构历史先例"));
    // F/D/K 编号引用规则必须出现
    expect(text).toMatch(/F = 用户上传 \/ 外部搜索 \/ 项目结构化/);
  });

  test("空 fact pack 不崩 且输出'（暂无可用事实）'", () => {
    const { formatFactPackForPrompt } = require("../../skills/_factPack");
    const text = formatFactPackForPrompt({ project_name: "X", facts: [] });
    expect(text).toMatch(/（暂无可用事实）/);
  });
});

describe("P3 fix · BP 深度解析拒绝短 hint 文本", () => {
  test("_collectBpRawText: stage_context 这种短字符串不会被当成 BP 原文", () => {
    const fp = require("../../skills/_factPack");
    const out = fp._private._collectBpRawText(
      { id: 1 },
      { bpText: "首次 IC", conversationId: null }, // 只有短 hint
      { deep_research_excerpt: "" },
    );
    expect(out.text).toBe("");
    expect(out.source).toBeNull();
  });

  test("_collectBpRawText: 显式 bpText 够长走 explicit_opts", () => {
    const fp = require("../../skills/_factPack");
    const longText = "BP 原文 ".repeat(50); // > 200 字符
    const out = fp._private._collectBpRawText(
      { id: 1 },
      { bpText: longText },
      null,
    );
    expect(out.source).toBe("explicit_opts");
    expect(out.text.length).toBeGreaterThan(200);
  });

  test("_collectBpRawText: 兜底用 context.deep_research_excerpt", () => {
    const fp = require("../../skills/_factPack");
    const dr = "深度研究输出 ".repeat(60);
    const out = fp._private._collectBpRawText(
      { id: 1 },
      { bpText: "", conversationId: null },
      { deep_research_excerpt: dr },
    );
    expect(out.source).toBe("deep_research_excerpt");
    expect(out.text.length).toBeGreaterThan(200);
  });
});

describe("P3 fix · _evidenceMaterial 透传 enableBpDeepParsing", () => {
  test("augmentMaterialsWithEvidence 把 enableBpDeepParsing/enableInstitutionalMemory 传到 buildEvidencePack", async () => {
    jest.resetModules();
    let capturedOpts = null;
    jest.doMock("../../skills/_factPack", () => ({
      buildEvidencePack: async (project, opts) => {
        capturedOpts = opts;
        return {
          factPack: { facts: [], project_name: "X" },
          uploadCount: 0,
          searchUsed: false,
          searchQueries: [],
          searchResults: [],
          bpDeepUsed: false,
          bpDeepCount: 0,
          institutionalMemoryUsed: false,
        };
      },
      buildSearchPlan: () => [],
      formatFactPackForPrompt: () => "fp",
    }));
    const evm = require("../../skills/_evidenceMaterial");
    await evm.augmentMaterialsWithEvidence({
      project: { id: 1 },
      ctx: {},
      skillId: "investment_deck_pptx",
      materials: "users material",
      enableBpDeepParsing: true,
      enableInstitutionalMemory: true,
      maxFacts: 200,
    });
    expect(capturedOpts.enableBpDeepParsing).toBe(true);
    expect(capturedOpts.enableInstitutionalMemory).toBe(true);
    expect(capturedOpts.maxFacts).toBe(200);
    jest.dontMock("../../skills/_factPack");
  });
});

describe("P3 fix · registry 写 skill_runs.metadata_json", () => {
  test("execute 成功路径把 result.metadata 抽取后写入 metadata_json", async () => {
    jest.resetModules();
    const updates = [];
    jest.doMock("../../db", () => ({
      getDb: () => ({
        prepare: (sql) => ({
          run: (...args) => {
            if (sql.includes("UPDATE skill_runs SET status='succeeded'") && sql.includes("metadata_json")) {
              updates.push({ sql, args });
            }
            return { lastInsertRowid: 1 };
          },
          all: () => [],
          get: () => null,
        }),
      }),
    }));

    const registry = require("../../skills/registry");
    registry.register({
      id: "test_metric_skill",
      title: "x", description: "x", category: "report", outputArtifactKind: "json",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => ({
        ok: true,
        artifact: { kind: "json", payload: { ok: true } },
        metadata: {
          evidence_search_used: true,
          upload_facts_used: 2,
          bp_deep_parsing_used: true,
          bp_deep_fact_count: 7,
          institutional_memory_used: false,
          institutional_memory_count: 0,
          fallback: { preferred_missing: 1, preferred_total: 12 },
          grounding: { ok: true, referenced_count: 9 },
        },
      }),
    });
    const out = await registry.execute({
      skillId: "test_metric_skill",
      params: {},
      project: null,
      ctx: {},
      userId: 1,
    });
    expect(out.ok).toBe(true);
    expect(updates.length).toBe(1);
    const [artifactJson, metadataJson] = updates[0].args;
    void artifactJson;
    const meta = JSON.parse(metadataJson);
    expect(meta.evidence_search_used).toBe(true);
    expect(meta.upload_facts_used).toBe(2);
    expect(meta.bp_deep_parsing_used).toBe(true);
    expect(meta.bp_deep_fact_count).toBe(7);
    expect(meta.fallback.preferred_missing).toBe(1);
    expect(meta.grounding_ok).toBe(true);
    expect(meta.grounding_referenced_count).toBe(9);
    jest.dontMock("../../db");
  });
});
