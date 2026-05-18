// ============================================================
// tests/workspace/conflictJudge.test.js
//
// 覆盖 services/conflictJudge.runConflictJudgeForProject 的契约：
//   1) facts < 2 条 → return { skipped: "not_enough_facts" }，不调 LLM
//   2) LLM 返回 N 条 conflicts → conflicts 表先 DELETE 旧 open 行再 INSERT N 行
//   3) 缺 projectId → return { skipped: "missing_project_id" }
//   4) 不存在 conflicts 表 → _upsertConflicts 返回 0，不抛错
//
// 不调真实 LLM；全靠 mock callLLMJson。
// ============================================================

describe("conflictJudge · runConflictJudgeForProject", () => {
  let factsRows;
  let conflictsTable;
  let deletedOpenRowsByProject;
  let hasConflictsTable;
  let llmFixture;

  beforeEach(() => {
    jest.resetModules();
    factsRows = [];
    conflictsTable = [];
    deletedOpenRowsByProject = new Map();
    hasConflictsTable = true;
    llmFixture = { conflicts: [] };

    jest.doMock("../../services/llmService", () => ({
      callLLMJson: jest.fn(async (system, user, schema) => {
        // 校验我们确实在用 conflict judge schema
        expect(schema.required).toContain("conflicts");
        return { data: llmFixture, repairs: 0 };
      }),
      LLMJsonValidationError: class extends Error {},
    }));

    jest.doMock("../../services/evidenceStore", () => ({
      tableExists: (db, name) => {
        if (name === "structured_facts") return factsRows !== null;
        if (name === "conflicts") return hasConflictsTable;
        return false;
      },
    }));
  });

  afterEach(() => {
    jest.dontMock("../../services/llmService");
    jest.dontMock("../../services/evidenceStore");
  });

  function buildFakeDb() {
    return {
      prepare: (sql) => {
        if (sql.includes("FROM structured_facts") && sql.includes("WHERE project_id")) {
          return { all: (projectId) => factsRows.filter((r) => r.project_id === projectId) };
        }
        if (sql.includes("DELETE FROM conflicts WHERE project_id")) {
          return { run: (projectId) => {
            const before = conflictsTable.length;
            const removed = conflictsTable.filter((c) => c.project_id === projectId && ["open", "needs_review"].includes(c.status));
            conflictsTable = conflictsTable.filter((c) => !(c.project_id === projectId && ["open", "needs_review"].includes(c.status)));
            deletedOpenRowsByProject.set(projectId, (deletedOpenRowsByProject.get(projectId) || 0) + removed.length);
            return { changes: before - conflictsTable.length };
          }};
        }
        if (sql.includes("INSERT INTO conflicts")) {
          return { run: (...args) => {
            conflictsTable.push({
              conflict_id: args[0], project_id: args[1], field: args[2],
              sources: args[3], severity: args[4], status: args[5], conflict_json: args[6],
            });
            return { lastInsertRowid: conflictsTable.length };
          }};
        }
        return { run: () => ({}), get: () => null, all: () => [] };
      },
    };
  }

  test("缺 projectId → skipped: missing_project_id，不调 LLM", async () => {
    const judge = require("../../services/conflictJudge");
    const { callLLMJson } = require("../../services/llmService");
    const out = await judge.runConflictJudgeForProject({ projectId: null, db: buildFakeDb() });
    expect(out.ok).toBe(false);
    expect(out.skipped).toBe("missing_project_id");
    expect(callLLMJson).not.toHaveBeenCalled();
  });

  test("facts < 2 条 → skipped: not_enough_facts，不调 LLM", async () => {
    factsRows = [
      { fact_id: "f-1", project_id: 42, field: "upload.financials.revenue", label: "营收", value: "800 万", source_ref: "P3", artifact_id: "art-1", confidence: "high", evidence_level: 1, updated_at: "2026-05-19" },
    ];
    const judge = require("../../services/conflictJudge");
    const { callLLMJson } = require("../../services/llmService");
    const out = await judge.runConflictJudgeForProject({ projectId: 42, db: buildFakeDb() });
    expect(out.ok).toBe(true);
    expect(out.skipped).toBe("not_enough_facts");
    expect(out.count).toBe(0);
    expect(callLLMJson).not.toHaveBeenCalled();
  });

  test("LLM 返回 2 条 conflicts → DELETE 旧 open + INSERT 2 行", async () => {
    factsRows = [
      { fact_id: "f-1", project_id: 42, field: "upload.financials.revenue", label: "营收", value: "800", source_ref: "P3", artifact_id: "art-1", confidence: "high", evidence_level: 1, updated_at: "2026-05-19" },
      { fact_id: "f-2", project_id: 42, field: "extracted_data.BP_Revenue", label: "BP 收入", value: "3000", source_ref: "", artifact_id: null, confidence: "medium", evidence_level: 4, updated_at: "2026-05-19" },
      { fact_id: "f-3", project_id: 42, field: "upload.customers.concentration_top3_pct", label: "Top3 占比", value: "72", source_ref: "P5", artifact_id: "art-2", confidence: "high", evidence_level: 1, updated_at: "2026-05-19" },
    ];
    // 预先塞一条 status=open 的旧 conflict，验证会被 DELETE
    conflictsTable.push({ conflict_id: "old-conf", project_id: 42, field: "revenue", sources: "[]", severity: "high", status: "open", conflict_json: "{}" });
    // 另一条 resolved 的不能被删
    conflictsTable.push({ conflict_id: "resolved-conf", project_id: 42, field: "valuation", sources: "[]", severity: "low", status: "resolved", conflict_json: "{}" });
    // 不同 project 的 open 也不能被删
    conflictsTable.push({ conflict_id: "other-proj", project_id: 999, field: "x", sources: "[]", severity: "low", status: "open", conflict_json: "{}" });

    llmFixture = {
      conflicts: [
        { field: "revenue", summary: "收入 800 vs BP 3000", severity: "high", sources: ["f-1", "f-2"], recommended_status: "open" },
        { field: "customer_concentration", summary: "Top3 72% 超过阈值", severity: "medium", sources: ["f-3"], recommended_status: "needs_review" },
      ],
    };
    const judge = require("../../services/conflictJudge");
    const { callLLMJson } = require("../../services/llmService");
    const out = await judge.runConflictJudgeForProject({ projectId: 42, db: buildFakeDb() });

    expect(out.ok).toBe(true);
    expect(out.count).toBe(2);
    expect(callLLMJson).toHaveBeenCalledTimes(1);
    // 旧 open 行被删，resolved 保留，其他 project 不受影响
    expect(conflictsTable.find((c) => c.conflict_id === "old-conf")).toBeUndefined();
    expect(conflictsTable.find((c) => c.conflict_id === "resolved-conf")).toBeDefined();
    expect(conflictsTable.find((c) => c.conflict_id === "other-proj")).toBeDefined();
    // 2 条新 conflict 写入
    const newRows = conflictsTable.filter((c) => c.project_id === 42 && c.conflict_id !== "resolved-conf");
    expect(newRows.length).toBe(2);
    expect(newRows[0].severity).toBe("high");
    expect(newRows[0].status).toBe("open");
    expect(newRows[1].status).toBe("needs_review");
  });

  test("conflicts 表不存在 → _upsertConflicts 返回 0，不抛错", async () => {
    hasConflictsTable = false;
    factsRows = [
      { fact_id: "f-1", project_id: 42, field: "x", value: "a", source_ref: "", artifact_id: null, confidence: "high", evidence_level: 1, updated_at: "" },
      { fact_id: "f-2", project_id: 42, field: "y", value: "b", source_ref: "", artifact_id: null, confidence: "high", evidence_level: 1, updated_at: "" },
    ];
    llmFixture = { conflicts: [{ field: "x", summary: "...", severity: "low", sources: ["f-1"], recommended_status: "open" }] };
    const judge = require("../../services/conflictJudge");
    const out = await judge.runConflictJudgeForProject({ projectId: 42, db: buildFakeDb() });
    expect(out.ok).toBe(true);
    expect(out.count).toBe(0); // table missing → no inserts
  });
});
