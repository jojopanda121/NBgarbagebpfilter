// ============================================================
// skills/companyOnepager.js — 「公司一页纸」快捷投研报告
//
// 输入公司名/股票代码 → 博查联网检索接地 → 10 模块买方投研报告 → Word(docx)。
// 市场无关（A股/港股/美股 搜到什么用什么）；不依赖上传 BP 项目。
// ============================================================

const { COMPANY_MODULES, COMPANY_METHODOLOGY } = require("./_onepagerMethodology");
const { runOnepager, makeSchema, buildSections } = require("./_onepagerCommon");

module.exports = {
  id: "company_onepager",
  title: "公司一页纸",
  description:
    "输入上市公司名或股票代码，自动联网检索（博查 web_search）生成买方视角的公司速览投研报告（10 大模块：近况/投资逻辑/竞争力/业务拆分/产销链/管理层/财务/调研大纲/估值/风险），导出 Word。数据全部检索接地，搜不到标待核实。",
  category: "research",
  outputArtifactKind: "docx",
  inputSchema: {
    type: "object",
    required: ["company"],
    properties: {
      company: { type: "string", minLength: 1, maxLength: 80, description: "公司名或股票代码，如 澜起科技 / 688008.SH / NVDA / 腾讯控股" },
    },
    additionalProperties: false,
  },

  async run({ params = {}, ctx = {}, userId }) {
    const company = String(params.company || "").trim();
    if (!company) return { ok: false, error: "需要公司名或股票代码 company" };
    return runOnepager({
      subject: company,
      subjectLabel: "目标公司",
      system: COMPANY_METHODOLOGY,
      modules: COMPANY_MODULES,
      docTitle: (s) => `${s} · 公司一页纸`,
      skillId: "company_onepager",
      ctx,
      userId,
    });
  },

  _private: { SCHEMA: makeSchema(COMPANY_MODULES), buildSections, COMPANY_MODULES },
};
