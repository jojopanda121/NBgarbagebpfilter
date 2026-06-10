// 行业/公司一页纸 research skill —— 纯 JS 部分（schema / 渲染 / 形状）。
const { makeSchema, buildSections, _formatPoint } = require("../../skills/_onepagerCommon");
const { INDUSTRY_MODULES, COMPANY_MODULES } = require("../../skills/_onepagerMethodology");
const industry = require("../../skills/industryOnepager");
const company = require("../../skills/companyOnepager");

describe("makeSchema — 强制模块覆盖", () => {
  test("行业 9 模块锁死 minItems=maxItems", () => {
    const s = makeSchema(INDUSTRY_MODULES);
    expect(s.properties.modules.minItems).toBe(9);
    expect(s.properties.modules.maxItems).toBe(9);
    expect(s.properties.modules.items.properties.key.enum).toEqual(INDUSTRY_MODULES.map((m) => m.key));
  });
  test("公司 10 模块", () => {
    const s = makeSchema(COMPANY_MODULES);
    expect(s.properties.modules.minItems).toBe(10);
  });
  test("data_tier 限定三层", () => {
    const s = makeSchema(INDUSTRY_MODULES);
    expect(s.properties.modules.items.properties.key_points.items.properties.data_tier.enum)
      .toEqual(["原始", "计算", "推理"]);
  });
});

describe("_formatPoint — 干净研报行文（无标签/无待核实）", () => {
  test("只出要点本身，不堆分层/来源标签", () => {
    expect(_formatPoint({ point: "市占率约37%", data_tier: "原始", sources: ["2024年报"] }))
      .toBe("市占率约37%");
  });
  test("无来源也不写'待核实'", () => {
    expect(_formatPoint({ point: "渗透率有望提升", data_tier: "推理", sources: [] }))
      .toBe("渗透率有望提升");
  });
});

describe("buildSections — JSON → docx sections", () => {
  const payload = {
    subject: "高速互联芯片",
    modules: [
      { key: "definition", heading: "行业定义与边界", analysis: "数据交通枢纽。", key_points: [{ point: "覆盖全层级连接", data_tier: "原始", sources: ["研报X"] }] },
      { key: "market_size", heading: "市场规模与空间", analysis: "空间巨大。", key_points: [] },
    ],
    open_questions: ["国产SerDes量产时点"],
  };

  test("按模块定义顺序渲染；open_questions 作为'需持续跟踪的关键变量'节", () => {
    const sections = buildSections(payload, INDUSTRY_MODULES);
    const headings = sections.map((s) => s.heading);
    expect(headings[0]).toBe("行业定义与边界");
    expect(headings).toContain("市场规模与空间");
    expect(headings[headings.length - 1]).toBe("需持续跟踪的关键变量");
    expect(sections[sections.length - 1].bullets).toContain("国产SerDes量产时点");
  });

  test("analysis → paragraphs，key_points → 干净 bullets", () => {
    const sections = buildSections(payload, INDUSTRY_MODULES);
    const def = sections.find((s) => s.heading === "行业定义与边界");
    expect(def.paragraphs).toEqual(["数据交通枢纽。"]);
    expect(def.bullets).toEqual(["覆盖全层级连接"]);
  });

  test("open_questions 为空 → 不追加该节（不留半成品免责堆）", () => {
    const sections = buildSections({ subject: "x", modules: [], open_questions: [] }, INDUSTRY_MODULES);
    expect(sections.map((s) => s.heading)).not.toContain("需持续跟踪的关键变量");
  });
});

describe("skill 形状", () => {
  test("industry_onepager 注册字段", () => {
    expect(industry.id).toBe("industry_onepager");
    expect(industry.outputArtifactKind).toBe("docx");
    expect(industry.inputSchema.required).toEqual(["industry"]);
    expect(typeof industry.run).toBe("function");
  });
  test("company_onepager 注册字段", () => {
    expect(company.id).toBe("company_onepager");
    expect(company.inputSchema.required).toEqual(["company"]);
  });
  test("缺必填入参 → 返回 ok:false 不抛错", async () => {
    const r = await industry.run({ params: {}, ctx: {} });
    expect(r.ok).toBe(false);
    const r2 = await company.run({ params: { company: "  " }, ctx: {} });
    expect(r2.ok).toBe(false);
  });
});
