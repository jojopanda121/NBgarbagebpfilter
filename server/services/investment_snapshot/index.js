// ============================================================
// server/services/investment_snapshot/index.js
//
// 一页纸投决速览 · 服务入口
// 通过 pptxTemplate.createTemplate() 实现, 这是所有 PPT 模板共享的 harness 范式.
// 加新模板只需 fill 4 个文件 + 一行 createTemplate 调用,详见
// server/services/_HOW_TO_ADD_PPTX_TEMPLATE.md
// ============================================================

const path = require("path");
const { createTemplate, TemplateSchemaError, TemplateRenderError } = require("../pptxTemplate");

const tmpl = createTemplate({
  name: "investment_snapshot",
  assetsDir: __dirname,
  exampleFile: "example_xsky.json",
  endpoint: "/generate/investment_snapshot",
  filenameOf: (json) => {
    const safe = String(json?.company_full_name || "未命名")
      .replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    return `投资速览_${safe}_${ymd}.pptx`;
  },
});

module.exports = {
  // 模板对外 API(保持原有命名以兼容已有调用方)
  generateSnapshotJson: tmpl.generateJson,
  validateSnapshotJson: tmpl.validate,
  renderSnapshotPptx:   tmpl.render,
  generateSnapshotPptx: tmpl.generate,
  buildFilename:        tmpl.filename,
  SCHEMA:               tmpl.schema,
  // 错误类型 —— 沿用旧名(指向共享类型, instanceof 仍 work)
  SnapshotSchemaError:  TemplateSchemaError,
  SnapshotRenderError:  TemplateRenderError,
};
