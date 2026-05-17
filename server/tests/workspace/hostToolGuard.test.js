// ============================================================
// Host tool-call 守卫 · validateToolCalls
//
// 防护 4 类 LLM 跑偏:
//   1) 单轮塞多个 TOOL_CALL          → 整批驳回
//   2) 编造不存在的 skill_id          → 单条驳回
//   3) PPT 模板 args 塞版式字段        → 单条驳回
//   4) 旧工具名 generate_pptx          → 单条禁用 (legacy alias = null)
// 同时验证:
//   - generate_onepager (legacy) → 归一为 onepager_pptx
//   - 合法单条调用 → accepted
// ============================================================

const {
  validateToolCalls,
  validateNativeToolUses,
  guardSingleToolCall,
  MAX_TOOL_CALLS_PER_TURN,
  PPT_TEMPLATE_IDS,
  PPT_BANNED_ARG_KEYS,
} = require("../../agents/workspace/hostToolGuard");

describe("validateToolCalls · 单轮总量", () => {
  test("空数组 → ok=true, 无 errors", () => {
    const r = validateToolCalls([]);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.accepted).toEqual([]);
  });

  test("非数组 (undefined / null) → ok=true, 容错处理", () => {
    expect(validateToolCalls(undefined).ok).toBe(true);
    expect(validateToolCalls(null).ok).toBe(true);
  });

  test("超过单轮上限 → 整批驳回 (paipai 单轮 1 个工具调用规则)", () => {
    const r = validateToolCalls(
      [
        { id: "onepager_pptx", args: {} },
        { id: "investment_snapshot", args: { materials: "公司材料超过 200 字" } },
      ],
      { maxCalls: 1 }
    );
    expect(r.ok).toBe(false);
    expect(r.accepted).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].reason).toMatch(/单轮最多 1 个/);
  });

  test("MAX_TOOL_CALLS_PER_TURN 常量为 1", () => {
    expect(MAX_TOOL_CALLS_PER_TURN).toBe(1);
  });
});

describe("validateToolCalls · skill_id 合法性", () => {
  test("合法 PPT 模板单条调用 → accepted", () => {
    const r = validateToolCalls([{ id: "onepager_pptx", args: {} }]);
    expect(r.ok).toBe(true);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].id).toBe("onepager_pptx");
    expect(r.accepted[0].tool).toBe("onepager_pptx"); // 归一双字段
  });

  test("不存在的 skill_id → 单条驳回", () => {
    const r = validateToolCalls([{ id: "fancy_imaginary_pptx", args: {} }]);
    expect(r.ok).toBe(false);
    expect(r.accepted).toEqual([]);
    expect(r.errors[0].tool).toBe("fancy_imaginary_pptx");
    expect(r.errors[0].reason).toMatch(/不在 catalog/);
  });

  test("空 id / 非字符串 id → 单条驳回, reason 写明", () => {
    // 注意: 这里 2 条都 < maxCalls=1? 不, 总数 2 > 1, 走总量驳回, 不到细粒度.
    // 单独测每条:
    expect(validateToolCalls([{ args: {} }]).errors[0].reason).toMatch(/为空|非字符串/);
    expect(validateToolCalls([{ id: 123 }]).errors[0].reason).toMatch(/为空|非字符串/);
  });

  test("通过 opts.skillCatalog 注入自定义 catalog (测试隔离)", () => {
    const r = validateToolCalls(
      [{ id: "custom_skill_x", args: {} }],
      { skillCatalog: new Set(["custom_skill_x"]) }
    );
    expect(r.ok).toBe(true);
    expect(r.accepted).toHaveLength(1);
  });

  test("非 skill 白名单工具 (web_search / generate_docx / generate_xlsx) → accepted", () => {
    expect(validateToolCalls([{ id: "web_search", args: { query: "Q" } }]).ok).toBe(true);
    expect(validateToolCalls([{ id: "generate_docx", args: { title: "x", sections: [] } }]).ok).toBe(true);
    expect(validateToolCalls([{ id: "generate_xlsx", args: { sheets: [] } }]).ok).toBe(true);
  });

  test("组合 skill dd_checklist_xlsx → accepted, 不需要放宽单轮工具上限", () => {
    const r = validateToolCalls([{ id: "dd_checklist_xlsx", args: { stage_context: "A 轮投决前" } }]);
    expect(r.ok).toBe(true);
    expect(r.accepted[0].id).toBe("dd_checklist_xlsx");
    expect(MAX_TOOL_CALLS_PER_TURN).toBe(1);
  });

  test("highlight_visual → accepted, 不套用 PPT 版式字段禁令", () => {
    const r = validateToolCalls([{ id: "highlight_visual", args: { materials: "公司材料足够生成视觉图" } }]);
    expect(r.ok).toBe(true);
    expect(r.accepted[0].id).toBe("highlight_visual");
  });
});

describe("validateToolCalls · legacy alias", () => {
  test("generate_onepager → 归一为 onepager_pptx", () => {
    const r = validateToolCalls([{ id: "generate_onepager", args: {} }]);
    expect(r.ok).toBe(true);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].id).toBe("onepager_pptx");
    expect(r.accepted[0].tool).toBe("onepager_pptx");
  });

  test("generate_pptx (自由 PPT) → 显式禁用, accept 为空", () => {
    const r = validateToolCalls([
      { id: "generate_pptx", args: { title: "X", slides: [{ title: "Y" }] } },
    ]);
    expect(r.ok).toBe(false);
    expect(r.accepted).toEqual([]);
    expect(r.errors[0].tool).toBe("generate_pptx");
    expect(r.errors[0].reason).toMatch(/已禁用|版式不可控/);
  });
});

describe("validateToolCalls · PPT 模板版式字段拒绝", () => {
  test("onepager_pptx 传 title → 单条驳回, reason 列出被禁字段", () => {
    const r = validateToolCalls([
      { id: "onepager_pptx", args: { title: "投资亮点", user_overrides: { x: 1 } } },
    ]);
    expect(r.ok).toBe(false);
    expect(r.accepted).toEqual([]);
    expect(r.errors[0].reason).toMatch(/严禁传版式字段/);
    expect(r.errors[0].reason).toMatch(/title/);
  });

  test("investment_snapshot 传 slides + color → 单条驳回, 两字段都报出", () => {
    const r = validateToolCalls([
      {
        id: "investment_snapshot",
        args: { slides: [{ title: "x" }], color: "red", materials: "公司材料..." },
      },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors[0].reason).toMatch(/slides/);
    expect(r.errors[0].reason).toMatch(/color/);
  });

  test("project_brief 只传 materials/company_hint → accepted (合法字段)", () => {
    const r = validateToolCalls([
      {
        id: "project_brief",
        args: { materials: "XSKY 是一家...", company_hint: "北京星辰天合" },
      },
    ]);
    expect(r.ok).toBe(true);
    expect(r.accepted).toHaveLength(1);
  });

  test("investment_deck_pptx 只传材料/页数/报告类型 → accepted", () => {
    const r = validateToolCalls([
      {
        id: "investment_deck_pptx",
        args: {
          materials: "公司财务数据、业务材料、行业分析摘要...",
          company_hint: "星动纪元",
          target_pages: 16,
          deck_type: "investment_committee",
        },
      },
    ]);
    expect(r.ok).toBe(true);
    expect(r.accepted).toHaveLength(1);
  });

  test("非 PPT 模板的 generate_docx 即使传 title 也不拒 (docx 合法字段)", () => {
    const r = validateToolCalls([
      { id: "generate_docx", args: { title: "IC Memo", sections: [{ heading: "x" }] } },
    ]);
    expect(r.ok).toBe(true);
    expect(r.accepted).toHaveLength(1);
  });

  test("PPT_BANNED_ARG_KEYS 覆盖 paipai 设计中的常见版式字段", () => {
    for (const k of ["title", "subtitle", "color", "font", "slides", "layout", "theme"]) {
      expect(PPT_BANNED_ARG_KEYS.has(k)).toBe(true);
    }
  });

  test("PPT_TEMPLATE_IDS 与 catalog 一致", () => {
    expect(PPT_TEMPLATE_IDS.has("onepager_pptx")).toBe(true);
    expect(PPT_TEMPLATE_IDS.has("investment_snapshot")).toBe(true);
    expect(PPT_TEMPLATE_IDS.has("project_brief")).toBe(true);
    expect(PPT_TEMPLATE_IDS.has("investment_deck_pptx")).toBe(true);
  });
});

describe("validateNativeToolUses · anthropic SDK 形状", () => {
  test("单个 native tool_use, 合法 → accepted 保持原 shape (name/input)", () => {
    const tu = [{ id: "tu_1", name: "onepager_pptx", input: { materials: "..." } }];
    const r = validateNativeToolUses(tu);
    expect(r.ok).toBe(true);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]).toEqual(tu[0]);
  });

  test("两个 native tool_use → 整批驳回, accepted 为空 (即所有 tool_use 都不会被执行)", () => {
    const tu = [
      { id: "tu_1", name: "onepager_pptx", input: {} },
      { id: "tu_2", name: "investment_snapshot", input: { materials: "..." } },
    ];
    const r = validateNativeToolUses(tu);
    expect(r.ok).toBe(false);
    expect(r.accepted).toEqual([]);
    expect(r.errors[0].reason).toMatch(/单轮最多 1 个/);
  });

  test("native tool_use 给 PPT 模板传 slides → 整批 ok=false, accepted 不含该 call", () => {
    const tu = [{ id: "tu_1", name: "onepager_pptx", input: { slides: [], color: "red" } }];
    const r = validateNativeToolUses(tu);
    expect(r.ok).toBe(false);
    expect(r.accepted).toEqual([]);
    expect(r.errors[0].reason).toMatch(/slides/);
  });

  test("legacy alias generate_onepager → accepted 项 name 改写成 onepager_pptx", () => {
    const tu = [{ id: "tu_1", name: "generate_onepager", input: { materials: "..." } }];
    const r = validateNativeToolUses(tu);
    expect(r.ok).toBe(true);
    expect(r.accepted[0].name).toBe("onepager_pptx");
    expect(r.accepted[0].id).toBe("tu_1");
    expect(r.accepted[0].input).toEqual({ materials: "..." });
  });
});

describe("guardSingleToolCall · service 入口守卫", () => {
  test("合法工具名 + 合法 args → ok=true", () => {
    const r = guardSingleToolCall("onepager_pptx", { materials: "x" });
    expect(r.ok).toBe(true);
    expect(r.accepted).toHaveLength(1);
  });

  test("PPT 模板传 title → ok=false, reason 列出字段", () => {
    const r = guardSingleToolCall("onepager_pptx", { title: "X" });
    expect(r.ok).toBe(false);
    expect(r.errors[0].reason).toMatch(/title/);
  });

  test("legacy generate_onepager → accepted 项 id 已归一为 onepager_pptx", () => {
    const r = guardSingleToolCall("generate_onepager", { materials: "x" });
    expect(r.ok).toBe(true);
    expect(r.accepted[0].id).toBe("onepager_pptx");
  });

  test("generate_pptx → ok=false, 显式禁用", () => {
    const r = guardSingleToolCall("generate_pptx", { slides: [] });
    expect(r.ok).toBe(false);
    expect(r.errors[0].reason).toMatch(/已禁用|版式不可控/);
  });

  test("不存在的工具名 → ok=false, 不在 catalog", () => {
    const r = guardSingleToolCall("imaginary_tool", {});
    expect(r.ok).toBe(false);
    expect(r.errors[0].reason).toMatch(/不在 catalog/);
  });
});

describe("executeWorkspaceTool 集成 · 入口 guard 拦截 native 路径", () => {
  const ws = require("../../services/workspaceService");

  test("native 路径 PPT 模板传 slides → executeWorkspaceTool 抛 host_tool_guard", async () => {
    await expect(
      ws.executeWorkspaceTool({
        tool: "onepager_pptx",
        args: { slides: [{ title: "x" }], materials: "..." },
        conversationId: null,
        messageId: null,
        projectId: null,
        userId: null,
      })
    ).rejects.toThrow(/host_tool_guard.*slides/);
  });

  test("native 路径 generate_pptx (legacy 禁用) → 抛 host_tool_guard", async () => {
    await expect(
      ws.executeWorkspaceTool({
        tool: "generate_pptx",
        args: { slides: [] },
        conversationId: null,
        messageId: null,
        projectId: null,
        userId: null,
      })
    ).rejects.toThrow(/host_tool_guard.*已禁用|host_tool_guard.*版式不可控/);
  });
});

describe("executeToolCalls 集成 · 守卫错误进 results", () => {
  // executeToolCalls 走真实代码路径; skill registry 会在导入时 init, 但所有逻辑无副作用.
  const ws = require("../../services/workspaceService");

  test("多个 TOOL_CALL 进入 → 守卫整批驳回, results 含单条 host_tool_guard 错误", async () => {
    const out = await ws.executeToolCalls(
      [
        { tool: "onepager_pptx", args: {} },
        { tool: "investment_snapshot", args: { materials: "公司 X 是一家 AI 存储企业..." } },
      ],
      { conversationId: null, messageId: null, projectId: null, userId: null }
    );
    expect(out).toHaveLength(1);
    expect(out[0].artifact).toBeUndefined();
    expect(out[0].error).toMatch(/host_tool_guard/);
    expect(out[0].error).toMatch(/单轮最多/);
  });

  test("onepager_pptx 传非法 title 字段 → 守卫拒绝, results 含字段提示", async () => {
    const out = await ws.executeToolCalls(
      [{ tool: "onepager_pptx", args: { title: "投资亮点", slides: [] } }],
      { conversationId: null, messageId: null, projectId: null, userId: null }
    );
    expect(out).toHaveLength(1);
    expect(out[0].artifact).toBeUndefined();
    expect(out[0].error).toMatch(/host_tool_guard/);
    expect(out[0].error).toMatch(/title/);
    expect(out[0].error).toMatch(/slides/);
  });
});
