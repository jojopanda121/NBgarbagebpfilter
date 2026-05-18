// ============================================================
// tests/workspace/conflictFact.test.js
//
// 证据冲突 fact 端到端测试（双通路）：
//   Case A · 规则冲突 (appendConflictFacts)
//           上传财务表收入 800 万 vs 旧 BP 提取字段 BP_Revenue=3000 →
//           buildEvidencePack 产出 C 编号 evidence_conflict fact。
//   Case B · 持久化冲突 (appendPersistedConflictFacts)
//           直接往 conflicts 表塞一行 (模拟 AI Judge 产出) →
//           buildEvidencePack 把它注入成 C 编号 fact。
//   Case C · 降级
//           没有上传 / 没有 conflicts 表行 → conflictFactCount=0，buildEvidencePack
//           不抛错，evidence_policy 仍生成。覆盖 I.6 无上传降级要求。
// ============================================================

describe("证据冲突 fact · 端到端", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.dontMock("../../skills/_projectContext");
    jest.dontMock("../../services/evidenceStore");
    jest.dontMock("../../db");
    jest.dontMock("../../services/webSearchService");
  });

  // ── Helper：构造一个全功能 fake DB
  function buildFakeDb({ conflictsRows = [], hasConflictsTable = true } = {}) {
    return {
      prepare: (sql) => {
        // tableExists
        if (sql.includes("FROM sqlite_master") && sql.includes("workspace_artifact")) {
          return { get: () => null, all: () => [] };
        }
        // appendUploadFacts legacy 路径 SELECT
        if (sql.includes("FROM workspace_artifacts") && sql.includes("kind = 'upload'")) {
          return { all: () => [] };
        }
        // appendUploadStructuredFacts legacy fallback 路径
        if (sql.includes("FROM workspace_artifact_structured_extracts")) {
          return { all: () => [], get: () => ({ c: 0 }) };
        }
        // appendPersistedConflictFacts 的 SELECT
        if (sql.includes("FROM conflicts") && sql.includes("status IN ('open', 'needs_review')")) {
          return { all: () => hasConflictsTable ? conflictsRows : [] };
        }
        return { get: () => null, all: () => [], run: () => ({}) };
      },
    };
  }

  test("Case A · 规则冲突：上传收入 800 与旧 BP_Revenue 3000 → C 编号 evidence_conflict fact", async () => {
    jest.doMock("../../skills/_projectContext", () => ({
      buildContext: () => ({
        project: { name: "测试公司" },
        extracted_data: { BP_Revenue: 3000, company_name: "测试公司" },
        latest_version: { claimed_revenue: 3000 },
        verdict: {},
        claim_verdicts: [],
        deep_research_excerpt: "",
      }),
    }));
    // mock evidenceStore：listStructuredFactsForEvidencePack 返回 upload 收入 800
    jest.doMock("../../services/evidenceStore", () => ({
      listStructuredFactsForEvidencePack: () => [
        {
          field: "upload.financials.revenue",
          label: "上传资料-营业收入",
          value: "800 万元 (2024)",
          source_type: "upload_structured",
          source_name: "上传资料-财务表.xlsx",
          source_ref: "P3",
          source_url: "",
          artifact_id: "art-fin-1",
          filename: "财务表.xlsx",
          confidence: "high",
          evidence_level: 1,
        },
      ],
      searchUploadExcerpts: () => [],
      tableExists: (db, name) => name === "conflicts",
      evidenceLevelForSource: (st) => st === "upload_structured" ? 1 : st === "upload" ? 2 : st === "external_search" ? 3 : st === "bp_self_report" ? 5 : 4,
    }));
    jest.doMock("../../db", () => ({ getDb: () => buildFakeDb({ hasConflictsTable: false }) }));
    jest.doMock("../../services/webSearchService", () => ({
      runWebSearch: async () => [],
      buildSearchQueries: () => [],
      formatSearchContext: () => "",
    }));

    const fp = require("../../skills/_factPack");
    const out = await fp.buildEvidencePack(
      { id: 99, name: "测试公司" },
      { useSearch: false, conversationId: "conv-A" },
    );

    expect(out.conflictFactCount).toBeGreaterThanOrEqual(1);
    const cFacts = out.factPack.facts.filter((f) => f.id?.startsWith("C"));
    expect(cFacts.length).toBeGreaterThanOrEqual(1);
    expect(cFacts[0].source_type).toBe("evidence_conflict");
    expect(cFacts[0].field).toMatch(/conflict\.revenue/);
    // value 必须同时含上传值和 BP 值，且声明上传胜出
    expect(cFacts[0].value).toContain("800");
    expect(cFacts[0].value).toContain("3000");
    expect(cFacts[0].value).toContain("上传资料胜出");
    // C 编号必须排在 facts 数组**最前**（unshift 行为）
    expect(out.factPack.facts[0].id).toMatch(/^C/);
  });

  test("Case B · 持久化冲突：conflicts 表已有行 → 注入 C 编号 fact", async () => {
    jest.doMock("../../skills/_projectContext", () => ({
      buildContext: () => ({
        project: { name: "测试公司" },
        extracted_data: {},
        latest_version: {},
        verdict: {},
        claim_verdicts: [],
        deep_research_excerpt: "",
      }),
    }));
    // listStructuredFactsForEvidencePack 返回空 → 不会走规则冲突通道
    jest.doMock("../../services/evidenceStore", () => ({
      listStructuredFactsForEvidencePack: () => [],
      searchUploadExcerpts: () => [],
      tableExists: (db, name) => name === "conflicts",
      evidenceLevelForSource: () => 4,
    }));
    jest.doMock("../../db", () => ({ getDb: () => buildFakeDb({
      hasConflictsTable: true,
      conflictsRows: [
        {
          conflict_id: "judge-001",
          field: "customer_concentration",
          sources: '["upload_structured:F004","bp_self_report:F012"]',
          severity: "high",
          status: "open",
          conflict_json: JSON.stringify({
            field: "customer_concentration",
            summary: "客户集中度上传 72% vs BP 自报 35%",
            severity: "high",
            sources: ["upload_structured:F004", "bp_self_report:F012"],
            recommended_status: "open",
          }),
          updated_at: "2026-05-19",
        },
      ],
    }) }));
    jest.doMock("../../services/webSearchService", () => ({
      runWebSearch: async () => [],
      buildSearchQueries: () => [],
      formatSearchContext: () => "",
    }));

    const fp = require("../../skills/_factPack");
    const out = await fp.buildEvidencePack(
      { id: 42, name: "测试公司" },
      { useSearch: false, projectId: 42, conversationId: "conv-B" },
    );

    const cFacts = out.factPack.facts.filter((f) => f.id?.startsWith("C"));
    expect(cFacts.length).toBeGreaterThanOrEqual(1);
    const cf = cFacts.find((f) => f.source_name?.includes("AI Judge"));
    expect(cf).toBeDefined();
    expect(cf.source_type).toBe("evidence_conflict");
    expect(cf.value).toContain("客户集中度上传 72% vs BP 自报 35%");
    expect(cf.confidence).toBe("high"); // severity=high → confidence=high
    // C 编号在 facts 数组**最前**（unshift）
    expect(out.factPack.facts[0].id).toMatch(/^C/);
    // 顺带验证 conflictFacts 数组里也包含它（用于上层调试）
    expect(out.conflictFactCount).toBeGreaterThanOrEqual(1);
    expect(out.conflictFacts.some((c) => c.conflict_id === "judge-001")).toBe(true);
  });

  test("Case C · 降级：无上传、无 conflicts 行 → conflictFactCount=0，buildEvidencePack 不抛错", async () => {
    jest.doMock("../../skills/_projectContext", () => ({
      buildContext: () => ({
        project: { name: "纯 BP 项目" },
        extracted_data: { BP_Revenue: 1000 },
        latest_version: { claimed_revenue: 1000 },
        verdict: {},
        claim_verdicts: [],
        deep_research_excerpt: "",
      }),
    }));
    jest.doMock("../../services/evidenceStore", () => ({
      listStructuredFactsForEvidencePack: () => [],
      searchUploadExcerpts: () => [],
      tableExists: () => false, // conflicts 表都"不存在"
      evidenceLevelForSource: () => 4,
    }));
    jest.doMock("../../db", () => ({ getDb: () => buildFakeDb({ hasConflictsTable: false }) }));
    jest.doMock("../../services/webSearchService", () => ({
      runWebSearch: async () => [],
      buildSearchQueries: () => [],
      formatSearchContext: () => "",
    }));

    const fp = require("../../skills/_factPack");
    const out = await fp.buildEvidencePack(
      { id: 1, name: "纯 BP 项目" },
      { useSearch: false, conversationId: "conv-C" },
    );

    // 无冲突
    expect(out.conflictFactCount).toBe(0);
    expect(out.factPack.facts.filter((f) => f.id?.startsWith("C")).length).toBe(0);
    // 但 evidence_policy 必须仍然生成（降级不报错、不空白）
    expect(out.factPack.evidence_policy).toBeTruthy();
    expect(out.factPack.evidence_policy).toMatch(/upload_structured/);
    expect(out.factPack.evidence_policy).toMatch(/bp_self_report/);
    // 上传相关 metadata 是 false / 0，但不抛错
    expect(out.uploadStructuredUsed).toBe(false);
    expect(out.uploadStructuredFactCount).toBe(0);
    expect(out.uploadCount).toBe(0);
    // bp_self_report fact 仍存在 (因为 latest_version.claimed_revenue 走 bp_self_report 通道)
    const bpFacts = out.factPack.facts.filter((f) => f.source_type === "bp_self_report");
    expect(bpFacts.length).toBeGreaterThan(0);
  });
});
