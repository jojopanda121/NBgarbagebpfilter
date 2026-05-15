// ============================================================
// 品牌视觉一致性 · 跨公司渲染产物结构等价测试
//
// 目的:
//   1) 验证 investment_snapshot 与 project_brief 渲染产物用的是新品牌色
//      (深海军蓝 0D2145 + 品牌蓝 1B4FD8), 不再含旧砖红 (9A341C / A8292A) /
//      米黄 (FAF7F2 / EFE8DF) 等已废弃 hex.
//   2) 验证同一模板对 3 份不同公司材料生成的 PPT, 在"结构 + 颜色 + 字体"
//      层面 byte-equal — 真正"框架一致, 内容动态". 见 stripTextKeepGeom.
//
// 依赖:
//   - DOC_SERVICE_URL 必须配置且 /health 可达, 否则整套 skip.
//   - 用 example_xsky.json 作 baseline, 程序化派生出 2 份"假公司" fixture,
//     保证不引入新固化样例文件.
// ============================================================

const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");

const SNAPSHOT_DIR = path.join(__dirname, "..", "..", "services", "investment_snapshot");
const BRIEF_DIR = path.join(__dirname, "..", "..", "services", "project_brief");

const SNAP_BASE = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, "example_xsky.json"), "utf-8"));
const BRIEF_BASE = JSON.parse(fs.readFileSync(path.join(BRIEF_DIR, "example_xsky.json"), "utf-8"));

// 新品牌色 (hex 在 PPT XML 中以无前缀 6 位字符串出现, drawingML 强制大写)
const NEW_COLORS_REQUIRED = ["0D2145", "1B4FD8"];
// 废弃旧色, 一个都不能再出现
const LEGACY_COLORS_BANNED = [
  "9A341C", // 砖红主色 (investment_snapshot)
  "A8292A", // 砖红 banner (onepager)
  "8B6F3F", // 金棕 (onepager 标题)
  "C9A96E", // 金棕分隔线 (onepager)
  "C6952F", "C69552", // 金细线 (snapshot)
  "D0B182", // 金虚线 (snapshot)
  "EFE8DF", // 米色胶囊
  "F3EEE8", // 米色风险块
  "F1E9DB", // 米色板块 (onepager)
  "EEEAE2", // 灰底风险板 (onepager)
  "FAF7F2", // 米白页底 (onepager)
];

let DOC_OK = false;
beforeAll(async () => {
  const url = process.env.DOC_SERVICE_URL;
  if (!url) return;
  try {
    const r = await fetch(`${url}/health`, { method: "GET" });
    DOC_OK = r.ok;
  } catch { DOC_OK = false; }
});

// 派生 fixture: 深拷贝后只改公司名 + 关键数字, 不改字段结构.
// 这正是 "agent 在 schema 约束下填空" 的行为模拟.
function derive(base, { company, suffix }) {
  const clone = JSON.parse(JSON.stringify(base));
  clone.company_full_name = company;
  // 在所有顶层字符串值后追加 suffix, 验证字符长度变化不影响版式结构
  // (此处只动 thesis / overview / tagline 这种自由文本字段)
  if (typeof clone.thesis === "string") clone.thesis = clone.thesis + suffix;
  if (typeof clone.tagline === "string") clone.tagline = clone.tagline + suffix;
  if (typeof clone.overview === "string") clone.overview = clone.overview + suffix;
  if (clone.company_overview?.summary) {
    clone.company_overview.summary = clone.company_overview.summary + suffix;
  }
  return clone;
}

// 把 slide xml 里所有 <a:t>...</a:t> 文本节点替换为空, 保留几何 + 颜色 +
// 字体 + 段落节点. 用作"结构等价"的精确定义.
function stripTextKeepGeom(xml) {
  return xml
    // 文本节点
    .replace(/<a:t>[\s\S]*?<\/a:t>/g, "<a:t></a:t>")
    // 创建时间等会产生噪音的 metadata (PPT/xml 不含, 仅保险)
    .replace(/dcterms:created="[^"]*"/g, "")
    .replace(/dcterms:modified="[^"]*"/g, "");
}

async function unzipSlide(buffer, slideIdx = 1) {
  const z = await JSZip.loadAsync(buffer);
  const f = z.file(`ppt/slides/slide${slideIdx}.xml`);
  expect(f).toBeTruthy();
  return f.async("string");
}

describe("视觉一致性 · investment_snapshot", () => {
  const snap = require("../../services/investment_snapshot");

  test("XSKY 基线 PPT 含新品牌色, 不含废弃旧色", async () => {
    if (!DOC_OK) { console.warn("[skip] doc-service 不可达"); return; }
    const buf = await snap.renderSnapshotPptx(SNAP_BASE);
    const xml = await unzipSlide(buf, 1);
    for (const c of NEW_COLORS_REQUIRED) {
      expect(xml.toUpperCase()).toContain(c);
    }
    for (const banned of LEGACY_COLORS_BANNED) {
      expect(xml.toUpperCase()).not.toContain(banned);
    }
    // 字体: 西文必须是 DM Sans, 中文 ea 必须是 PingFang SC
    expect(xml).toMatch(/typeface="DM Sans"/);
    expect(xml).toMatch(/typeface="PingFang SC"/);
  }, 20000);

  test("跨 3 家公司, 结构 (去文本后) byte-equal", async () => {
    if (!DOC_OK) { console.warn("[skip] doc-service 不可达"); return; }
    const fixtures = [
      SNAP_BASE,
      derive(SNAP_BASE, { company: "示例科技 Alpha 有限公司", suffix: "α" }),
      derive(SNAP_BASE, { company: "Beta Biotech 创新股份公司", suffix: "—β的长长后缀以测试文本伸缩" }),
    ];
    const xmls = await Promise.all(fixtures.map(async (f) => {
      const buf = await snap.renderSnapshotPptx(f);
      return await unzipSlide(buf, 1);
    }));
    const normalized = xmls.map(stripTextKeepGeom);
    expect(normalized[0]).toEqual(normalized[1]);
    expect(normalized[1]).toEqual(normalized[2]);
  }, 30000);
});

describe("视觉一致性 · project_brief", () => {
  const brief = require("../../services/project_brief");

  test("XSKY 基线 PPT 含新品牌色, 不含废弃旧色", async () => {
    if (!DOC_OK) { console.warn("[skip] doc-service 不可达"); return; }
    const buf = await brief.render(BRIEF_BASE);
    const xml = await unzipSlide(buf, 1); // 封面页
    for (const c of NEW_COLORS_REQUIRED) {
      expect(xml.toUpperCase()).toContain(c);
    }
    for (const banned of LEGACY_COLORS_BANNED) {
      expect(xml.toUpperCase()).not.toContain(banned);
    }
    expect(xml).toMatch(/typeface="DM Sans"/);
  }, 20000);

  test("跨 3 家公司, 3 页结构 (去文本后) byte-equal", async () => {
    if (!DOC_OK) { console.warn("[skip] doc-service 不可达"); return; }
    const fixtures = [
      BRIEF_BASE,
      derive(BRIEF_BASE, { company: "示例科技 Alpha 有限公司", suffix: "α" }),
      derive(BRIEF_BASE, { company: "Beta Biotech 创新股份公司", suffix: "—β的长长后缀以测试文本伸缩" }),
    ];
    const allPages = await Promise.all(fixtures.map(async (f) => {
      const buf = await brief.render(f);
      const z = await JSZip.loadAsync(buf);
      const xmls = [];
      for (let i = 1; i <= 3; i++) {
        const file = z.file(`ppt/slides/slide${i}.xml`);
        expect(file).toBeTruthy();
        xmls.push(await file.async("string"));
      }
      return xmls.map(stripTextKeepGeom);
    }));
    // 逐页对比
    for (let p = 0; p < 3; p++) {
      expect(allPages[0][p]).toEqual(allPages[1][p]);
      expect(allPages[1][p]).toEqual(allPages[2][p]);
    }
  }, 45000);
});
