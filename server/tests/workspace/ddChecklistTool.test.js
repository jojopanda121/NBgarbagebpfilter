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
});
