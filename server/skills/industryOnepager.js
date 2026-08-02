// ============================================================
// skills/industryOnepager.js — 「行业一页纸」快捷投研报告
//
// 输入一个行业名 → 博查联网检索接地 → 9 模块结构化报告 → Word(docx)。
// 不依赖上传 BP 项目；唯一数据源是 web_search。
// ============================================================

const { INDUSTRY_MODULES, INDUSTRY_METHODOLOGY } = require("./_onepagerMethodology");
const { runOnepager, makeSchema, buildSections } = require("./_onepagerCommon");

module.exports = {
  id: "industry_onepager",
  title: "行业一页纸",
  description:
    "输入一个行业名，自动联网检索（博查 web_search）生成买方视角的行业速览投研报告（9 大模块：定义/产业链/市场规模/竞争格局/壁垒/驱动/主要上市公司/风险/景气指标），导出 Word。数据全部检索接地，搜不到标待核实。",
  category: "research",
  outputArtifactKind: "docx",
  inputSchema: {
    type: "object",
    required: ["industry"],
    properties: {
      industry: { type: "string", minLength: 1, maxLength: 60, description: "行业名，如 工业母机 / 创新药 / 光伏组件 / 高速互联芯片" },
    },
    additionalProperties: false,
  },

  async run({ params = {}, ctx = {}, userId }) {
    const industry = String(params.industry || "").trim();
    if (!industry) return { ok: false, error: "需要行业名 industry" };
    return runOnepager({
      subject: industry,
      subjectLabel: "目标行业",
      system: INDUSTRY_METHODOLOGY,
      modules: INDUSTRY_MODULES,
      docTitle: (s) => `${s} · 行业一页纸`,
      skillId: "industry_onepager",
      ctx,
      userId,
    });
  },

  _private: { SCHEMA: makeSchema(INDUSTRY_MODULES), buildSections, INDUSTRY_MODULES },
};
