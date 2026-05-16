// ============================================================
// PPT catalog 机制 + generate_pptx guard + project_brief e2e
// ============================================================

const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");

const PB_DIR = path.join(__dirname, "..", "..", "services", "project_brief");
const PB_EXAMPLE = JSON.parse(fs.readFileSync(path.join(PB_DIR, "example_xsky.json"), "utf-8"));

let DOC_OK = false;
beforeAll(async () => {
  const url = process.env.DOC_SERVICE_URL;
  if (!url) return;
  try { DOC_OK = (await fetch(`${url}/health`)).ok; } catch { DOC_OK = false; }
});

describe("registry.listPptxTemplates() · catalog", () => {
  test("PPT 模板都在 catalog, 非 PPT skill 不在", () => {
    const skills = require("../../skills");
    skills.init();
    const templates = skills.registry.listPptxTemplates();
    const ids = templates.map((t) => t.id);

    expect(ids).toContain("investment_snapshot");
    expect(ids).toContain("project_brief");
    expect(ids).toContain("onepager_pptx");
    expect(ids).toContain("investment_deck_pptx");
    // 非 PPT skill 不应出现
    expect(ids).not.toContain("dd_questions");
    expect(ids).not.toContain("ic_memo");
    expect(ids).not.toContain("teaser_generate");
  });

  test("每个 catalog 项有 useCase / pageCount / argsHint", () => {
    const skills = require("../../skills");
    skills.init();
    const templates = skills.registry.listPptxTemplates();
    for (const t of templates) {
      expect(typeof t.useCase).toBe("string");
      expect(t.useCase.length).toBeGreaterThan(10);
      expect(t.pageCount).toBeTruthy();
      expect(t.argsHint).toMatch(/<TOOL_CALL>/);
    }
  });
});

describe("executeToolCalls · generate_pptx guard", () => {
  test("host 调 generate_pptx → 不渲染, 返回带 catalog 提示的 error", async () => {
    const ws = require("../../services/workspaceService");
    const out = await ws.executeToolCalls(
      [{ tool: "generate_pptx", args: { title: "X", slides: [{ title: "Y", bullets: ["a"] }] } }],
      { conversationId: null, messageId: null, projectId: null, userId: null }
    );
    expect(out).toHaveLength(1);
    const r = out[0];
    expect(r.tool).toBe("generate_pptx");
    expect(r.artifact).toBeUndefined();
    expect(r.error).toMatch(/已禁用|generate_pptx/);
    // 错误信息里要列出 catalog
    expect(r.error).toMatch(/investment_snapshot/);
    expect(r.error).toMatch(/project_brief/);
    expect(r.error).toMatch(/investment_deck_pptx/);
  });
});

describe("project_brief · 服务模块", () => {
  const tmpl = require("../../services/project_brief");

  test("合法 JSON 通过校验", () => {
    expect(() => tmpl.validate(PB_EXAMPLE)).not.toThrow();
  });

  test("缺字段抛 TemplateSchemaError", () => {
    expect(() => tmpl.validate({ company_full_name: "x" })).toThrow(tmpl.SchemaError);
  });

  test("highlights 数量不为 4 抛 TemplateSchemaError", () => {
    const bad = { ...PB_EXAMPLE, highlights: PB_EXAMPLE.highlights.slice(0, 3) };
    expect(() => tmpl.validate(bad)).toThrow(tmpl.SchemaError);
  });

  test("risks 数量不为 3 抛 TemplateSchemaError", () => {
    const bad = { ...PB_EXAMPLE, risks: PB_EXAMPLE.risks.slice(0, 2) };
    expect(() => tmpl.validate(bad)).toThrow(tmpl.SchemaError);
  });

  test("team 少于 2 人抛 TemplateSchemaError", () => {
    const bad = { ...PB_EXAMPLE, team: PB_EXAMPLE.team.slice(0, 1) };
    expect(() => tmpl.validate(bad)).toThrow(tmpl.SchemaError);
  });

  test("financials_compact rows 不为 3 行抛 TemplateSchemaError", () => {
    const bad = {
      ...PB_EXAMPLE,
      financials_compact: {
        ...PB_EXAMPLE.financials_compact,
        rows: PB_EXAMPLE.financials_compact.rows.slice(0, 2),
      },
    };
    expect(() => tmpl.validate(bad)).toThrow(tmpl.SchemaError);
  });

  test("缺 dealroom_meta 抛 TemplateSchemaError (PE/VC 专属字段)", () => {
    const bad = { ...PB_EXAMPLE };
    delete bad.dealroom_meta;
    expect(() => tmpl.validate(bad)).toThrow(tmpl.SchemaError);
  });

  test("render · XSKY 基线, 3 页含关键字段", async () => {
    if (!DOC_OK) {
      console.warn("[skip] doc-service 不可达");
      return;
    }
    const buf = await tmpl.render(PB_EXAMPLE);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(20000);
    expect(buf.slice(0, 2).toString("ascii")).toBe("PK");

    const z = await JSZip.loadAsync(buf);
    // 必须恰好 3 页
    const slideFiles = Object.keys(z.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slideFiles.length).toBe(3);

    // 拼三页 xml 校验关键字段(允许字段分布在不同页)
    const allXml = (await Promise.all(
      slideFiles.sort().map((n) => z.file(n).async("string"))
    )).join("\n");

    expect(allXml).toContain("北京星辰天合");
    expect(allXml).toContain("中国最大独立分布式");  // tagline
    expect(allXml).toContain("Pre-IPO");                // metadata.stage
    expect(allXml).toContain("项目概况");
    expect(allXml).toContain("投资亮点");
    // PE/VC 版 P3: 团队 + 财务 + 估值视角
    expect(allXml).toContain("核心团队");
    expect(allXml).toContain("财务速览");
    expect(allXml).toContain("估值视角");
    for (const h of PB_EXAMPLE.highlights) expect(allXml).toContain(h.label);
    for (const r of PB_EXAMPLE.risks)      expect(allXml).toContain(r.label);
    for (const m of PB_EXAMPLE.team)       expect(allXml).toContain(m.name);
    // valuation_view 的关键字段在最底页
    expect(allXml).toContain(PB_EXAMPLE.valuation_view.recommended_range);
  }, 15000);

  test("filename 合规", () => {
    const name = tmpl.filename(PB_EXAMPLE);
    expect(name).toMatch(/^项目简报_/);
    expect(name).toMatch(/\.pptx$/);
    expect(name).not.toMatch(/[\\/:*?"<>]/);
  });
});

describe("project_brief · skill 注册", () => {
  test("出现在 catalog, inputSchema 只暴露内容字段", () => {
    const skills = require("../../skills");
    skills.init();
    const list = skills.registry.list();
    const found = list.find((s) => s.id === "project_brief");
    expect(found).toBeTruthy();
    expect(found.outputArtifactKind).toBe("pptx");
    expect(found.inputSchema.properties.materials).toBeTruthy();
    expect(found.inputSchema.properties.company_hint).toBeTruthy();
    // 不暴露版式参数 ★
    expect(found.inputSchema.properties.title).toBeUndefined();
    expect(found.inputSchema.properties.color).toBeUndefined();
    expect(found.inputSchema.properties.slides).toBeUndefined();
    expect(found.inputSchema.properties.pageCount).toBeUndefined();
  });
});

describe("investment_deck_pptx · skill 注册", () => {
  test("出现在 catalog, inputSchema 只暴露内容字段和业务参数", () => {
    const skills = require("../../skills");
    skills.init();
    const list = skills.registry.list();
    const found = list.find((s) => s.id === "investment_deck_pptx");
    expect(found).toBeTruthy();
    expect(found.outputArtifactKind).toBe("pptx");
    expect(found.inputSchema.properties.materials).toBeTruthy();
    expect(found.inputSchema.properties.company_hint).toBeTruthy();
    expect(found.inputSchema.properties.target_pages).toBeTruthy();
    expect(found.inputSchema.properties.deck_type).toBeTruthy();
    expect(found.inputSchema.properties.title).toBeUndefined();
    expect(found.inputSchema.properties.color).toBeUndefined();
    expect(found.inputSchema.properties.slides).toBeUndefined();
    expect(found.inputSchema.properties.pageCount).toBeUndefined();
  });
});
