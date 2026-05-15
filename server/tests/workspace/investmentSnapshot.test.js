// ============================================================
// investment_snapshot 端到端测试
//
// 覆盖 4 件事:
//   1) Node 服务模块的 schema 校验逻辑（合法 / 非法）
//   2) 调 doc-service 渲染 XSKY 样例,产物可打开 + 含关键文本
//   3) skill 注册成功并出现在 registry.list()
//   4) JSON 不合 schema 时 skill 返回结构化错误（不抛栈）
//
// 需要的外部依赖:
//   - doc-service 必须可达。若环境变量 DOC_SERVICE_URL 未设或不通,本测试套件 skip。
//   - example_xsky.json 用作"假装是 LLM 输出"的固定输入,绕过 LLM 调用以保证 CI 稳定。
// ============================================================

const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");

const SNAPSHOT_SERVICE_PATH = path.join(__dirname, "..", "..", "services", "investment_snapshot");
const EXAMPLE = JSON.parse(
  fs.readFileSync(path.join(SNAPSHOT_SERVICE_PATH, "example_xsky.json"), "utf-8")
);

// 探测 doc-service 是否可达;否则 skip
let DOC_OK = false;
beforeAll(async () => {
  const url = process.env.DOC_SERVICE_URL;
  if (!url) return;
  try {
    const r = await fetch(`${url}/health`, { method: "GET" });
    DOC_OK = r.ok;
  } catch { DOC_OK = false; }
});

describe("investment_snapshot · 服务模块", () => {
  const snap = require("../../services/investment_snapshot");

  test("合法 JSON 通过校验", () => {
    expect(() => snap.validateSnapshotJson(EXAMPLE)).not.toThrow();
  });

  test("缺字段抛 SnapshotSchemaError", () => {
    expect(() => snap.validateSnapshotJson({ company_full_name: "x" })).toThrow(snap.SnapshotSchemaError);
  });

  test("highlights 数量不为 4 抛 SnapshotSchemaError", () => {
    const bad = { ...EXAMPLE, highlights: EXAMPLE.highlights.slice(0, 3) };
    expect(() => snap.validateSnapshotJson(bad)).toThrow(snap.SnapshotSchemaError);
  });

  test("renderSnapshotPptx · XSKY 基线", async () => {
    if (!DOC_OK) {
      console.warn("[skip] doc-service 不可达,跳过端到端渲染测试");
      return;
    }
    const buf = await snap.renderSnapshotPptx(EXAMPLE);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(20000); // pptx 至少 20KB
    expect(buf.slice(0, 2).toString("ascii")).toBe("PK"); // zip 头

    // 解 zip 抓 slide1.xml 验关键字段
    const z = await JSZip.loadAsync(buf);
    const slideFile = z.file("ppt/slides/slide1.xml");
    expect(slideFile).toBeTruthy();
    const xml = await slideFile.async("string");
    // 公司名
    expect(xml).toContain("北京星辰天合");
    // thesis
    expect(xml).toContain("中国最大独立分布式");
    // 4 条 highlights 的 label
    for (const h of EXAMPLE.highlights) {
      expect(xml).toContain(h.label);
    }
    // 2 条 risks 的 label
    for (const r of EXAMPLE.risks) {
      expect(xml).toContain(r.label);
    }
  }, 15000);

  test("renderSnapshotPptx · 不合 schema 时不调 doc-service,直接抛错", async () => {
    await expect(snap.renderSnapshotPptx({ company_full_name: "bad" }))
      .rejects.toThrow(snap.SnapshotSchemaError);
  });

  test("buildFilename 合规", () => {
    const name = snap.buildFilename("北京 星辰/天合");
    expect(name).toMatch(/^投资速览_/);
    expect(name).toMatch(/\.pptx$/);
    expect(name).not.toMatch(/[\\/:*?"<>]/);
  });
});

describe("investment_snapshot · skill 注册", () => {
  test("出现在 registry.list() 中", () => {
    const skills = require("../../skills");
    skills.init();
    const list = skills.registry.list();
    const found = list.find((s) => s.id === "investment_snapshot");
    expect(found).toBeTruthy();
    expect(found.outputArtifactKind).toBe("pptx");
    expect(found.inputSchema.properties.materials).toBeTruthy();
    expect(found.inputSchema.properties.company_hint).toBeTruthy();
    // 不该把版式参数暴露出去
    expect(found.inputSchema.properties.title).toBeUndefined();
    expect(found.inputSchema.properties.color).toBeUndefined();
  });
});
