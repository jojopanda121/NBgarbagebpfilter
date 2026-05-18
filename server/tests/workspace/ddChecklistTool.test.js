const ws = require("../../services/workspaceService");

describe("dd_checklist_xlsx workspace tool wiring", () => {
  test("Host native tool schema exposes dd_checklist_xlsx", () => {
    const names = ws.HOST_TOOL_SCHEMAS.map((t) => t.name);
    expect(names).toContain("dd_checklist_xlsx");
  });

  test("尽调清单 routing uses composite Excel skill", () => {
    const r = ws.inferRoutingFromText("帮我生成一份 A 轮投决前尽调清单 Excel");
    expect(r.task_type).toBe("generate_dd_checklist");
    expect(r.tools).toEqual(["dd_checklist_xlsx"]);
    expect(ws.taskTypeToTool(r.task_type)).toBe("dd_checklist_xlsx");
  });

  test("publicArtifact strips server storage_path", () => {
    const row = {
      id: "a1",
      filename: "x.xlsx",
      storage_path: "/srv/private/workspace/x.xlsx",
      kind: "generated_xlsx",
    };
    expect(ws.publicArtifact(row)).toEqual({
      id: "a1",
      filename: "x.xlsx",
      kind: "generated_xlsx",
    });
  });

  test("dd_checklist_xlsx keeps JSON artifact when Excel rendering fails", async () => {
    jest.resetModules();
    const payload = {
      summary: "基于风险信号生成的尽调问题清单",
      categories: [{ key: "financial", label: "财务/估值", focus: "收入与估值核验" }],
      questions: [{
        category: "financial",
        priority: 1,
        question: "你们能否提供收入确认明细与客户回款凭证?",
        evidence: "收入与估值假设需要核验",
        expected_format: "文件",
        verification_method: "核对合同、发票、银行流水与回款台账",
        decision_standard: "关键收入可被第三方凭证闭环验证",
        owner: "财务尽调",
        status: "待收集",
        source_refs: ["F1"],
      }],
    };

    jest.doMock("../../skills/ddQuestions", () => ({
      run: jest.fn().mockResolvedValue({
        ok: true,
        artifact: { kind: "json", summary: "1 条尽调问题", payload },
        metadata: { llm_repairs: 1 },
      }),
    }));
    jest.doMock("../../services/workspaceService", () => ({
      executeDocumentTool: jest.fn().mockRejectedValue(new Error("fetch failed")),
    }));

    const skill = require("../../skills/ddChecklistXlsx");
    const out = await skill.run({
      project: { id: 1, name: "TestCo" },
      params: {},
      ctx: { conversationId: "conv-1", userId: 7 },
      userId: 7,
    });

    expect(out.ok).toBe(true);
    expect(out.artifact.kind).toBe("json");
    expect(out.artifact.payload.questions).toHaveLength(1);
    expect(out.metadata.degraded).toBe(true);
    expect(out.metadata.xlsx_error).toBe("fetch failed");

    jest.dontMock("../../skills/ddQuestions");
    jest.dontMock("../../services/workspaceService");
  });

  test("dd_questions rule-based fallback satisfies output schema", () => {
    const skill = require("../../skills/ddQuestions");
    const { validate } = require("../../utils/jsonSchema");
    const factPack = {
      facts: Array.from({ length: 4 }).map((_, idx) => ({
        id: `F00${idx + 1}`,
        field: idx === 0 ? "latest_version.claimed_revenue" : "verdict.risk_flags",
        label: idx === 0 ? "BP 声称收入" : `风险信号 ${idx}`,
        value: idx === 0 ? "2025 年收入 5000 万元" : "关键经营指标需要进一步核验",
      })),
    };

    const payload = skill._private.buildRuleBasedChecklist(factPack);
    const res = validate(payload, skill._private.SCHEMA);

    expect(res.valid).toBe(true);
    expect(payload.questions).toHaveLength(8);
    expect(payload.questions.every((q) => q.source_refs.length === 1)).toBe(true);
  });
});
