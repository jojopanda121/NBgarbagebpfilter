// workspace onepager 路由 / 工具 schema / fallback 单测
// 修 8 页"投资亮点"的回归测试集
const ws = require("../../services/workspaceService");
const reg = require("../../utils/workspaceRegistry");

describe("isOnePagerRequest", () => {
  test.each([
    ["投资亮点 PPT", true],
    ["做一份投资亮点单页", true],
    ["生成一页纸 PPT", true],
    ["one pager 投资材料", true],
    ["one-pager", true],
    ["单页 PPT", true],
    ["项目速览", true],
    ["pitch deck", true],
    ["1 页 ppt", true],
    // 否定：明确是多页/正式材料
    ["做一份投委会 5 页材料", false],
    ["生成完整投决报告 PPT", false],
    ["写一份投资分析备忘录", false],
    ["市场情况怎么样", false],
    ["", false],
  ])("%s → %s", (msg, expected) => {
    expect(ws.isOnePagerRequest(msg)).toBe(expected);
  });
});

describe("inferRoutingFromText", () => {
  test("'投资亮点' 路由到 onepager_pptx 模板（不被通用 PPT 规则吃掉）", () => {
    const r = ws.inferRoutingFromText("生成一份投资亮点 PPT");
    expect(r.task_type).toBe("generate_pptx_template");
    expect(r.tools).toContain("onepager_pptx");
  });

  test("'一页纸' 路由到 investment_snapshot 模板", () => {
    const r = ws.inferRoutingFromText("帮我做一页纸 PPT");
    expect(r.task_type).toBe("generate_pptx_template");
    expect(r.tools).toContain("investment_snapshot");
  });

  test("'one-pager' 英文也识别", () => {
    const r = ws.inferRoutingFromText("Make me a one-pager deck");
    expect(r.task_type).toBe("generate_pptx_template");
    expect(r.tools).toContain("investment_snapshot");
  });

  test("'投委会演示 PPT' 走 PPT 模板任务，不走自由 generate_pptx", () => {
    // 注：原路由顺序里"材料/附件"会先匹配到 analyze_file，因此用明确的 PPT 关键词
    const r = ws.inferRoutingFromText("做一份投委会演示 PPT");
    expect(r.task_type).toBe("generate_pptx_template");
    expect(r.tools).toEqual([]);
  });

  test("纯问答路由到 answer", () => {
    const r = ws.inferRoutingFromText("这个项目的财务情况怎么样？");
    expect(r.task_type).toBe("answer");
  });

  test("Word 路由不被影响", () => {
    const r = ws.inferRoutingFromText("生成投资备忘录 docx");
    expect(r.task_type).toBe("generate_docx");
  });
});

describe("taskTypeToTool", () => {
  test("legacy generate_onepager → onepager_pptx", () => {
    expect(ws.taskTypeToTool("generate_onepager")).toBe("onepager_pptx");
  });
  test("legacy generate_pptx → project_brief", () => {
    expect(ws.taskTypeToTool("generate_pptx")).toBe("project_brief");
  });
  test("未知任务 → null", () => {
    expect(ws.taskTypeToTool("answer")).toBeNull();
  });
});

describe("HOST_TOOL_SCHEMAS", () => {
  test("包含 web_search，供主持人执行联网检索", () => {
    const op = ws.HOST_TOOL_SCHEMAS.find((s) => s.name === "web_search");
    expect(op).toBeTruthy();
    expect(op.description).toMatch(/联网|检索|MiniMax/);
    expect(op.input_schema.required).toContain("query");
  });

  test("包含 PPT 模板工具，不包含自由 generate_pptx", () => {
    const names = ws.HOST_TOOL_SCHEMAS.map((s) => s.name);
    expect(names).toContain("onepager_pptx");
    expect(names).toContain("investment_snapshot");
    expect(names).toContain("project_brief");
    expect(names).not.toContain("generate_pptx");
  });

  test("onepager_pptx schema 只接受模板参数，不接受 slides", () => {
    const op = ws.HOST_TOOL_SCHEMAS.find((s) => s.name === "onepager_pptx");
    expect(op).toBeTruthy();
    expect(op.description).toMatch(/1 页|模板/);
    expect(op.description).toMatch(/严禁传 slides/);
    expect(op.input_schema.properties).toHaveProperty("user_overrides");
    expect(op.input_schema.properties).not.toHaveProperty("slides");
  });

  test("project_brief description 明确走模板视觉", () => {
    const pp = ws.HOST_TOOL_SCHEMAS.find((s) => s.name === "project_brief");
    expect(pp.description).toMatch(/3 页|模板|视觉/);
    expect(pp.description).toMatch(/严禁传 slides/);
  });
});

describe("workspaceRegistry PPT 模板工具登记", () => {
  test("web_search 登记为 host 可调工具", () => {
    const def = reg.TOOL_REGISTRY.web_search;
    expect(def.callableByModel).toBe(true);
    expect(def.allowedCallers).toContain("host");
    expect(() => reg.assertToolAllowed("web_search", "host")).not.toThrow();
  });

  test("TOOL_REGISTRY 有 onepager_pptx 且 host 可调", () => {
    const def = reg.TOOL_REGISTRY.onepager_pptx;
    expect(def).toBeTruthy();
    expect(def.callableByModel).toBe(true);
    expect(def.allowedCallers).toContain("host");
    expect(def.executor).toBe("skill_template");
  });

  test("assertToolAllowed(onepager_pptx, host) 通过", () => {
    expect(() => reg.assertToolAllowed("onepager_pptx", "host")).not.toThrow();
  });

  test("非 host 调用方被拒绝", () => {
    expect(() => reg.assertToolAllowed("onepager_pptx", "market_deal")).toThrow(/不允许/);
  });
});

describe("buildFallbackOnepagerArgs", () => {
  const sampleExperts = [
    { agent: "market", content: "市场 TAM 200 亿元，CAGR 25%。\n增量空间显著。" },
    { agent: "tech", content: "团队具备核心算法 IP，技术栈成熟。" },
    { agent: "finance", content: "ARR 5000 万，单位经济为正。" },
    { agent: "risk", content: "客户集中度偏高，需补充第二大客户合同。" },
  ];

  test("产出含全部必填字段", () => {
    const args = ws.buildFallbackOnepagerArgs({
      userMsg: "做《某 AI 项目》的投资亮点单页",
      cleanContent: "综合判断：值得跟进。",
      expertOutputs: sampleExperts,
    });
    expect(args.company_name).toMatch(/某 AI 项目/);
    expect(args.headline).toBeTruthy();
    expect(args.company_overview).toHaveProperty("summary");
    expect(args.market_opportunity).toHaveProperty("competition");
    expect(Array.isArray(args.highlights)).toBe(true);
    expect(args.highlights).toHaveLength(4);
    expect(Array.isArray(args.risks)).toBe(true);
    expect(args.risks).toHaveLength(2);
    expect(args.footer).toHaveProperty("founded");
  });

  test("highlights 不含审查口吻关键词", () => {
    const args = ws.buildFallbackOnepagerArgs({
      userMsg: "投资亮点单页",
      cleanContent: "",
      expertOutputs: sampleExperts,
    });
    const all = JSON.stringify(args.highlights);
    expect(all).not.toMatch(/D级|不建议投资|风险红旗|★|否决/);
  });
});

describe("buildFallbackToolCall: 安全网", () => {
  test("用户说'一页纸'但 routing 退化为 generate_pptx 时，依然兜回模板", () => {
    const call = ws.buildFallbackToolCall({
      routing: { task_type: "generate_pptx" }, // 模拟 routing LLM 失败
      userMsg: "做一份投资亮点一页纸",
      cleanContent: "",
      expertOutputs: [],
    });
    expect(call).toBeTruthy();
    expect(call.tool).toBe("onepager_pptx");
    expect(call.args).toEqual({});
  });

  test("用户要正常多页 PPT 时也不走自由 slides", () => {
    const call = ws.buildFallbackToolCall({
      routing: { task_type: "generate_pptx" },
      userMsg: "做一份投委会 5 页演示材料",
      cleanContent: "",
      expertOutputs: [{ agent: "market", content: "市场分析" }],
    });
    expect(call.tool).toBe("project_brief");
    expect(call.args).not.toHaveProperty("slides");
  });
});

describe("normalizeToolCalls: 路由 onepager 但 LLM 给了 generate_pptx", () => {
  test("LLM 错调 generate_pptx，会被替换为 onepager_pptx", () => {
    const calls = [
      {
        tool: "generate_pptx",
        args: { title: "投资亮点", slides: [{ title: "亮点", bullets: ["a", "b"] }] },
      },
    ];
    const normalized = ws.normalizeToolCalls(calls, {
      routing: { task_type: "generate_onepager" },
      userMsg: "投资亮点单页",
      cleanContent: "",
      expertOutputs: [],
    });
    expect(normalized).toHaveLength(1);
    expect(normalized[0].tool).toBe("onepager_pptx");
  });

  test("LLM 旧调用 generate_onepager 时升级为 onepager_pptx", () => {
    const goodArgs = {
      company_name: "X",
      headline: "Y",
      company_overview: { summary: "s", products: [] },
      market_opportunity: { kpis: [], drivers: [], competition: "c" },
      highlights: [
        { title: "h1", desc: "d1" },
        { title: "h2", desc: "d2" },
        { title: "h3", desc: "d3" },
        { title: "h4", desc: "d4" },
      ],
      risks: [{ title: "r1", desc: "rd1" }, { title: "r2", desc: "rd2" }],
      footer: { founded: "2020", team_size: "30", funding_total: "1亿", ai_grade: "B" },
    };
    const calls = [{ tool: "generate_onepager", args: goodArgs }];
    const normalized = ws.normalizeToolCalls(calls, {
      routing: { task_type: "generate_onepager" },
      userMsg: "投资亮点单页",
      cleanContent: "",
      expertOutputs: [],
    });
    expect(normalized).toHaveLength(1);
    expect(normalized[0].tool).toBe("onepager_pptx");
  });
});
