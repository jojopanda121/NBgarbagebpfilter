// ============================================================
// OnePager 双模式 · onepager_pptx.run() 单元测试
//
// 覆盖:
//   1) 默认 source_mode = "bp_analysis", 缺 latest_task_id 时返回友好错误
//   2) source_mode = "materials" + 空 materials → 拒绝
//   3) source_mode = "materials" + materials 过短 (precheck 字数下限) → 拒绝
//   4) 隐式切换: 显式传 materials 但忘了 source_mode → 自动走 materials 模式
//   5) inputSchema 暴露 source_mode / materials / company_hint 字段
//   6) pptxTemplate catalog argsHint 含 materials 模式示例
//
// 通过 jest.mock 隔离 pptService.* 实际 LLM / DB / 渲染调用.
// ============================================================

jest.mock("../../services/pptService", () => ({
  getOrGenerateOnePager: jest.fn(),
  regenerateOnePager: jest.fn(),
  generateOnePagerFromMaterials: jest.fn(),
  renderOnePagerPptx: jest.fn(),
  buildPptxFilename: jest.fn((name) => `投资要点速览_${name || "未命名"}_20260515.pptx`),
}));

jest.mock("../../services/workspaceService", () => ({
  ARTIFACTS_ROOT: "/tmp/test-artifacts",
  insertArtifact: jest.fn(),
}));

const path = require("path");
const fs = require("fs");
const skill = require("../../skills/onepagerPptx");
const pptService = require("../../services/pptService");

const FAKE_CACHE = {
  json: {
    company_name: "测试科技股份有限公司",
    headline: "下一代 AI 基础设施龙头",
    company_overview: { summary: "...", products: [] },
    market_opportunity: { kpis: [], drivers: [], competition: "" },
    highlights: [],
    risks: [],
    footer: {},
  },
  generated_at: "2026-05-15T00:00:00Z",
  search_used: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  pptService.renderOnePagerPptx.mockResolvedValue(Buffer.from("PK\x03\x04mock-pptx-bytes"));
});

describe("inputSchema · 双模式字段暴露", () => {
  test("schema 含 source_mode / materials / company_hint", () => {
    const props = skill.inputSchema.properties;
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(["source_mode", "materials", "company_hint", "user_overrides", "regenerate"])
    );
    expect(props.source_mode.enum).toEqual(["bp_analysis", "materials"]);
  });

  test("pptxTemplate.argsHint 同时给出两种模式范例", () => {
    expect(skill.pptxTemplate.argsHint).toMatch(/bp_analysis/);
    expect(skill.pptxTemplate.argsHint).toMatch(/materials/);
    expect(skill.pptxTemplate.argsHint).toMatch(/company_hint/);
  });
});

describe("run() · bp_analysis 模式 (默认)", () => {
  test("缺 latest_task_id 时返回友好错误, 不调 LLM", async () => {
    const r = await skill.run({ project: null, params: {}, ctx: null });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/bp_analysis/);
    expect(r.error).toMatch(/source_mode='materials'/);
    expect(pptService.getOrGenerateOnePager).not.toHaveBeenCalled();
    expect(pptService.generateOnePagerFromMaterials).not.toHaveBeenCalled();
  });

  test("带 latest_task_id 走 getOrGenerateOnePager, sourceMode 标 bp_analysis", async () => {
    pptService.getOrGenerateOnePager.mockResolvedValueOnce(FAKE_CACHE);
    const r = await skill.run({
      project: { latest_task_id: "task-123" },
      params: {},
      ctx: null,
    });
    expect(r.ok).toBe(true);
    expect(r.artifact.sourceMode).toBe("bp_analysis");
    expect(pptService.getOrGenerateOnePager).toHaveBeenCalledWith("task-123", null, false);
    expect(pptService.generateOnePagerFromMaterials).not.toHaveBeenCalled();
  });

  test("regenerate=true 走 regenerateOnePager 清缓存", async () => {
    pptService.regenerateOnePager.mockResolvedValueOnce(FAKE_CACHE);
    await skill.run({
      project: { latest_task_id: "task-456" },
      params: { regenerate: true, user_overrides: { funding_round: "B+" } },
      ctx: null,
    });
    expect(pptService.regenerateOnePager).toHaveBeenCalledWith("task-456", { funding_round: "B+" });
  });
});

describe("run() · materials 模式 (显式)", () => {
  const RICH_MATERIALS = (
    "北京星辰天合科技股份有限公司是国内独立分布式 AI 存储供应商, 服务超百家中国 500 强企业. " +
    "公司主营产品包括 AI 数据湖存储与 AI 训推存储解决方案. " +
    "创始人胥昕来自前 EMC 中国研究院, CTO 贾东东曾深耕开源存储社区 Ceph, 团队整体技术背景扎实. " +
    "2023 年营业收入 1.66 亿, 2024 年 1.72 亿, 2025 年前三季度 1.95 亿, 毛利率 63.7%, 净利率由 -48.8% 转正至 4.2%. " +
    "2024 年完成 D 轮融资, 主要股东包括君联资本与招商局创投, Pre-money 估值约 80 亿人民币."
  );

  test("空 materials → 友好错误, 不调 precheck/LLM", async () => {
    const r = await skill.run({
      project: null,
      params: { source_mode: "materials" },
      ctx: null,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/需要 params.materials/);
    expect(pptService.generateOnePagerFromMaterials).not.toHaveBeenCalled();
  });

  test("materials 太短 → precheck 拒绝 (含字数 error)", async () => {
    const r = await skill.run({
      project: null,
      params: { source_mode: "materials", materials: "XSKY 是一家做 AI 存储的公司, 在北京." },
      ctx: null,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/materialPrecheck/);
    expect(r.error).toMatch(/字数/);
    expect(pptService.generateOnePagerFromMaterials).not.toHaveBeenCalled();
  });

  test("合格 materials → 走 generateOnePagerFromMaterials, sourceMode 标 materials", async () => {
    pptService.generateOnePagerFromMaterials.mockResolvedValueOnce(FAKE_CACHE);
    const r = await skill.run({
      project: null,
      params: {
        source_mode: "materials",
        materials: RICH_MATERIALS,
        company_hint: "北京星辰天合",
      },
      ctx: null,
    });
    expect(r.ok).toBe(true);
    expect(r.artifact.sourceMode).toBe("materials");
    expect(pptService.generateOnePagerFromMaterials).toHaveBeenCalledWith(
      RICH_MATERIALS,
      expect.objectContaining({ companyHint: "北京星辰天合" })
    );
    // 不应回退到 BP 模式
    expect(pptService.getOrGenerateOnePager).not.toHaveBeenCalled();
  });
});

describe("run() · 隐式 materials 模式 (LLM 忘传 source_mode)", () => {
  const RICH = (
    "示例 Alpha 科技股份有限公司是一家做企业服务的 SaaS 公司, 总部位于上海. " +
    "公司核心产品为 AI 协作平台, 服务超 200 家世界 500 强客户. " +
    "创始人 Alice 来自前 Google, CTO Bob 来自 Meta, 团队学历技术背景扎实. " +
    "2024 年营业收入 8000 万, 同比增长 120%, 毛利率 75%. " +
    "2024 年完成 B 轮融资, 红杉中国领投, 估值约 50 亿人民币."
  );

  test("显式传 materials 但忘了 source_mode → 自动切 materials 模式 (不需要 task)", async () => {
    pptService.generateOnePagerFromMaterials.mockResolvedValueOnce(FAKE_CACHE);
    const r = await skill.run({
      project: null,  // 没 task
      params: { materials: RICH, company_hint: "示例 Alpha" },
      ctx: null,
    });
    expect(r.ok).toBe(true);
    expect(r.artifact.sourceMode).toBe("materials");
    expect(pptService.generateOnePagerFromMaterials).toHaveBeenCalled();
    expect(pptService.getOrGenerateOnePager).not.toHaveBeenCalled();
  });

  test("同时有 latest_task_id 和 materials → 显式 materials 优先 (尊重用户当下意图)", async () => {
    pptService.generateOnePagerFromMaterials.mockResolvedValueOnce(FAKE_CACHE);
    const r = await skill.run({
      project: { latest_task_id: "task-X" },
      params: { materials: RICH, company_hint: "示例 Alpha" },
      ctx: null,
    });
    expect(r.ok).toBe(true);
    expect(r.artifact.sourceMode).toBe("materials");
    expect(pptService.getOrGenerateOnePager).not.toHaveBeenCalled();
  });

  test("显式 source_mode='bp_analysis' 即使带了 materials 也走 BP 路径 (用户意图优先)", async () => {
    pptService.getOrGenerateOnePager.mockResolvedValueOnce(FAKE_CACHE);
    const r = await skill.run({
      project: { latest_task_id: "task-X" },
      params: { source_mode: "bp_analysis", materials: "不该被用到的材料文本" },
      ctx: null,
    });
    expect(r.ok).toBe(true);
    expect(r.artifact.sourceMode).toBe("bp_analysis");
    expect(pptService.getOrGenerateOnePager).toHaveBeenCalled();
    expect(pptService.generateOnePagerFromMaterials).not.toHaveBeenCalled();
  });
});

describe("Host tool schema · onepager_pptx 双模式字段暴露", () => {
  test("HOST_TOOL_SCHEMAS 包含 source_mode/materials/company_hint", () => {
    // 不能 require workspaceService 因为它被 mock 了, 而 mock 没暴露 HOST_TOOL_SCHEMAS.
    // 改为直接读源文件文本断言, 这样 mock 不影响.
    const txt = fs.readFileSync(
      path.join(__dirname, "../../services/workspaceService.js"),
      "utf-8"
    );
    const onepagerBlockStart = txt.indexOf('name: "onepager_pptx"');
    expect(onepagerBlockStart).toBeGreaterThan(0);
    const block = txt.slice(onepagerBlockStart, onepagerBlockStart + 900);
    expect(block).toMatch(/source_mode/);
    expect(block).toMatch(/materials/);
    expect(block).toMatch(/company_hint/);
    expect(block).toMatch(/bp_analysis/);
  });
});
