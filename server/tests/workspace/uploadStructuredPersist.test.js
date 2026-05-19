// ============================================================
// tests/workspace/uploadStructuredPersist.test.js
//
// 覆盖 services/extraction/uploadStructuredExtraction.runAndPersist 的持久化合约：
//   1) 成功路径：同时写 legacy 表 workspace_artifact_structured_extracts 和新的
//      structured_facts 表（经 evidenceStore.replaceStructuredFactsForArtifact）。
//   2) LLM 失败路径：4 个 agent 全报错 → status='error'，**不**写 structured_facts。
//   3) 短文本路径：< 200 字 → status='skipped'，不调 LLM、不写任何表。
//   4) 降级：evidence_store 模块加载/调用失败时不抛错，主流程仍 return 成功结果。
//
// 严格 mock llmService.callLLMJson，不调真实 LLM。
// ============================================================

describe("uploadStructured · runAndPersist 持久化合约", () => {
  let factsByArtifact;
  let llmCalls;
  let conflictJudgeFires;

  beforeEach(() => {
    jest.resetModules();
    factsByArtifact = new Map();
    llmCalls = 0;
    conflictJudgeFires = 0;

    // ── Mock llmService.callLLMJson：每个 schema 返回最小但合规的 payload
    jest.doMock("../../services/llmService", () => ({
      callLLMJson: jest.fn(async (system, user, schema) => {
        llmCalls++;
        const required = (schema && schema.required) || [];
        // 4 个 agent 各自的最小合规返回
        if (required.includes("pl") && required.includes("bs") && required.includes("cf")) {
          // financialStatementsAgent
          return { data: {
            pl: { revenue: { value: 800, unit: "万元", period: "2024", source_ref: "P3", confidence: "high" },
                  cogs: { value: null, unit: "", period: "", source_ref: "", confidence: "missing" },
                  gross_profit: { value: null, unit: "", period: "", source_ref: "", confidence: "missing" },
                  opex: { value: null, unit: "", period: "", source_ref: "", confidence: "missing" },
                  ebitda: { value: null, unit: "", period: "", source_ref: "", confidence: "missing" },
                  net_income: { value: null, unit: "", period: "", source_ref: "", confidence: "missing" } },
            bs: { total_assets: { value: null, unit: "", period: "", source_ref: "", confidence: "missing" },
                  cash: { value: null, unit: "", period: "", source_ref: "", confidence: "missing" },
                  total_liabilities: { value: null, unit: "", period: "", source_ref: "", confidence: "missing" },
                  equity: { value: null, unit: "", period: "", source_ref: "", confidence: "missing" } },
            cf: { operating_cf: { value: null, unit: "", period: "", source_ref: "", confidence: "missing" },
                  investing_cf: { value: null, unit: "", period: "", source_ref: "", confidence: "missing" },
                  financing_cf: { value: null, unit: "", period: "", source_ref: "", confidence: "missing" },
                  free_cash_flow: { value: null, unit: "", period: "", source_ref: "", confidence: "missing" },
                  runway_months: { value: 12, unit: "月", period: "", source_ref: "", confidence: "medium" } },
            fiscal_periods: ["2024 全年"],
            notes: { currency: { value: "CNY", source_ref: "", confidence: "high" },
                     consistency: { value: null, source_ref: "", confidence: "missing" },
                     warnings: [] },
          }, repairs: 0 };
        }
        if (required.includes("ltv") && required.includes("cac")) {
          // unitEconomicsAgent
          const emptyN = { value: null, unit: "", period: "", source_ref: "", confidence: "missing" };
          return { data: {
            ltv: emptyN, cac: emptyN, ltv_cac_ratio: emptyN, payback_months: emptyN,
            gross_margin_pct: emptyN, churn_monthly_pct: emptyN, nrr_pct: emptyN, arpa: emptyN,
            cohort_evidence: [],
            notes: { business_model_hint: { value: null, source_ref: "", confidence: "missing" }, warnings: [] },
          }, repairs: 0 };
        }
        if (required.includes("top_customers") || required.includes("concentration_top3_pct")) {
          // customerListAgent
          return { data: {
            top_customers: [
              { name: "客户 A", revenue_share_pct: 45, contract_status: "已签约付款", since: "2024", source_ref: "P5", confidence: "high" },
            ],
            concentration_top3_pct: { value: 72, unit: "%", period: "2024", source_ref: "P5", confidence: "high" },
            concentration_top10_pct: { value: null, unit: "", period: "", source_ref: "", confidence: "missing" },
            industry_breakdown: [],
            notes: { customer_disclosure_quality: { value: null, source_ref: "", confidence: "missing" }, warnings: [] },
          }, repairs: 0 };
        }
        if (required.includes("cap_table") && required.includes("red_flags")) {
          // extrasAgent
          return { data: {
            cap_table: {
              entries: [],
              pre_money_valuation: { value: null, currency: null, round: null, source_quote: "", confidence: "missing" },
              post_money_valuation: { value: null, currency: null, round: null, source_quote: "", confidence: "missing" },
              esop_pct: null,
            },
            legal_compliance_signals: [],
            contracts_and_evidence: [],
            claims_to_verify: [],
            red_flags: [{ flag: "客户集中度过高", severity: "high", source_quote: "Top1 = 45%" }],
            notes: { doc_type_guess: "financials", evidence_quality: "audited", warnings: [] },
          }, repairs: 0 };
        }
        return { data: {}, repairs: 0 };
      }),
      LLMJsonValidationError: class extends Error {},
    }));

    // ── Mock evidenceStore：拦截 replaceStructuredFactsForArtifact 调用
    jest.doMock("../../services/evidenceStore", () => ({
      replaceStructuredFactsForArtifact: jest.fn(({ artifactId, flatFacts, projectId }) => {
        factsByArtifact.set(artifactId, flatFacts);
        return { count: flatFacts.length, projectId };
      }),
      tableExists: () => true,
    }));

    // ── Mock taskQueue：把 fire-and-forget 改成 sync 记录
    jest.doMock("../../services/taskQueue", () => ({
      fireAndForget: (name) => {
        if (name === "conflict_judge") conflictJudgeFires++;
        // 不实际跑 fn，避免被 conflictJudge 真链路拖累
      },
      enqueue: (name, fn) => Promise.resolve(fn()),
    }));

    // ── Mock conflictJudge 避免 require 时拉一堆 dep
    jest.doMock("../../services/conflictJudge", () => ({
      runConflictJudgeForProject: jest.fn(async () => ({ ok: true, count: 0 })),
    }));
  });

  afterEach(() => {
    jest.dontMock("../../services/llmService");
    jest.dontMock("../../services/evidenceStore");
    jest.dontMock("../../services/taskQueue");
    jest.dontMock("../../services/conflictJudge");
  });

  function buildFakeDb({ extractsTable = [] } = {}) {
    return {
      prepare: (sql) => {
        if (sql.startsWith("PRAGMA table_info(workspace_artifact_structured_extracts)")) {
          // 假装 project_id / evidence_level 都存在
          return { all: () => [
            { name: "artifact_id" }, { name: "conversation_id" }, { name: "project_id" },
            { name: "filename" }, { name: "doc_type" }, { name: "structured_json" },
            { name: "extraction_status" }, { name: "error" }, { name: "fact_count" },
            { name: "evidence_level" },
          ]};
        }
        if (sql.includes("FROM sqlite_master") && sql.includes("workspace_artifact_structured_extracts")) {
          return { get: () => ({ name: "workspace_artifact_structured_extracts" }) };
        }
        if (sql.includes("SELECT id FROM workspace_artifact_structured_extracts WHERE artifact_id")) {
          return { get: (artifactId) => {
            const r = extractsTable.find((x) => x.artifact_id === artifactId);
            return r ? { id: r.id } : null;
          }};
        }
        if (sql.includes("UPDATE workspace_artifact_structured_extracts")) {
          return { run: (...args) => {
            // 最后一个参数是 artifact_id
            const artifactId = args[args.length - 1];
            const existing = extractsTable.find((x) => x.artifact_id === artifactId);
            if (existing) {
              existing.extraction_status = args[args.length - 4]; // status
              existing.error = args[args.length - 3];
              existing.fact_count = args[args.length - 2];
            }
            return { changes: 1 };
          }};
        }
        if (sql.includes("INSERT INTO workspace_artifact_structured_extracts")) {
          return { run: (...args) => {
            extractsTable.push({
              id: extractsTable.length + 1,
              artifact_id: args[0], conversation_id: args[1],
              extraction_status: args[args.findIndex((a) => ["pending", "running", "success", "error", "skipped"].includes(a))] || "unknown",
              fact_count: 0,
            });
            return { lastInsertRowid: extractsTable.length };
          }};
        }
        return { run: () => ({ changes: 0 }), get: () => null, all: () => [] };
      },
    };
  }

  test("成功路径：同时写 legacy 表 + structured_facts (经 evidenceStore)", async () => {
    const upload = require("../../services/extraction/uploadStructuredExtraction");
    const evidenceStore = require("../../services/evidenceStore");
    const extractsTable = [];
    const db = buildFakeDb({ extractsTable });
    // 准备一段足够长 (> 200 字符) 的"财务表"文本
    const text = "公司 2024 营业收入 800 万元，主要来自客户 A 签订的年框合同。前 3 大客户合计占收入 72%。".repeat(5);

    const out = await upload.runAndPersist({
      db,
      artifactId: "art-1",
      conversationId: "conv-1",
      projectId: 42,
      filename: "财务表.xlsx",
      uploadText: text,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    expect(out.status).toBe("success");
    expect(llmCalls).toBe(4); // 4 agent 各调一次
    // legacy 表有一行 status=success
    expect(extractsTable.length).toBe(1);
    expect(extractsTable[0].extraction_status).toBe("success");
    // evidenceStore.replaceStructuredFactsForArtifact 被调用过，flatFacts 非空
    expect(evidenceStore.replaceStructuredFactsForArtifact).toHaveBeenCalled();
    const stored = factsByArtifact.get("art-1");
    expect(stored).toBeDefined();
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((f) => f.source_type === "upload_structured")).toBe(true);
    // 必须包含至少一条收入 fact
    expect(stored.some((f) => f.field === "upload.financials.revenue")).toBe(true);
    // 必须包含 customers.top1 客户 fact
    expect(stored.some((f) => f.field.startsWith("upload.customers.top_"))).toBe(true);
    // 必须包含 extras 的 red_flag
    expect(stored.some((f) => f.field.startsWith("upload.red_flags."))).toBe(true);
    // 触发 conflictJudge fire-and-forget
    expect(conflictJudgeFires).toBe(1);
  });

  test("LLM 失败路径：抽取层抛错 → status=error，不写 structured_facts", async () => {
    // 重置 llmService mock 让所有 callLLMJson 抛错
    jest.resetModules();
    jest.doMock("../../services/llmService", () => ({
      callLLMJson: jest.fn(async () => { throw new Error("llm_outage_simulated"); }),
      LLMJsonValidationError: class extends Error {},
    }));
    jest.doMock("../../services/evidenceStore", () => ({
      replaceStructuredFactsForArtifact: jest.fn(),
      tableExists: () => true,
    }));
    jest.doMock("../../services/taskQueue", () => ({ fireAndForget: jest.fn(), enqueue: () => Promise.resolve() }));
    jest.doMock("../../services/conflictJudge", () => ({ runConflictJudgeForProject: jest.fn() }));

    const upload = require("../../services/extraction/uploadStructuredExtraction");
    const evidenceStore = require("../../services/evidenceStore");
    const text = "x".repeat(500);
    const extractsTable = [];
    const db = buildFakeDb({ extractsTable });

    const out = await upload.runAndPersist({
      db, artifactId: "art-err", conversationId: "conv-1", projectId: 42,
      filename: "f.xlsx", uploadText: text,
    });
    // 4 个 agent 各自 catch 内部 llm_error 写 fallback payload；orchestrator 看 errors 全有就标 status=error
    expect(out.status).toBe("error");
    // 不应该往 structured_facts 写
    expect(evidenceStore.replaceStructuredFactsForArtifact).not.toHaveBeenCalled();
  });

  test("短文本路径：< 200 字 → status=skipped，不调 LLM，不写 structured_facts", async () => {
    const upload = require("../../services/extraction/uploadStructuredExtraction");
    const evidenceStore = require("../../services/evidenceStore");
    const extractsTable = [];
    const db = buildFakeDb({ extractsTable });

    const out = await upload.runAndPersist({
      db, artifactId: "art-short", conversationId: "conv-1", projectId: 42,
      filename: "tiny.txt", uploadText: "太短了 only 9 chars",
    });
    expect(out.status).toBe("skipped");
    expect(out.reason).toBe("input_too_short");
    expect(llmCalls).toBe(0);
    expect(evidenceStore.replaceStructuredFactsForArtifact).not.toHaveBeenCalled();
  });

  test("evidenceStore 调用失败时主流程不崩，仍 return result", async () => {
    jest.resetModules();
    jest.doMock("../../services/llmService", () => ({
      callLLMJson: jest.fn(async () => ({ data: {}, repairs: 0 })),
      LLMJsonValidationError: class extends Error {},
    }));
    jest.doMock("../../services/evidenceStore", () => ({
      replaceStructuredFactsForArtifact: () => { throw new Error("evidence_store_explode"); },
      tableExists: () => true,
    }));
    jest.doMock("../../services/taskQueue", () => ({ fireAndForget: jest.fn(), enqueue: () => Promise.resolve() }));
    jest.doMock("../../services/conflictJudge", () => ({ runConflictJudgeForProject: jest.fn() }));

    const upload = require("../../services/extraction/uploadStructuredExtraction");
    const text = "x".repeat(500);
    const extractsTable = [];
    const db = buildFakeDb({ extractsTable });

    const out = await upload.runAndPersist({
      db, artifactId: "art-x", conversationId: "conv-1", projectId: 42,
      filename: "x.xlsx", uploadText: text,
    });
    // evidenceStore 异常被 catch；status 仍来自抽取层
    expect(["success", "error"]).toContain(out.status);
    expect(out).toBeDefined();
  });
});
