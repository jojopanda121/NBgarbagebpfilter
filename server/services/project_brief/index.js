// ============================================================
// server/services/project_brief/index.js
// 项目简报 3 页 deck · 服务入口
// ============================================================

const { createTemplate } = require("../pptxTemplate");

module.exports = createTemplate({
  name: "project_brief",
  assetsDir: __dirname,
  exampleFile: "example_xsky.json",
  endpoint: "/generate/project_brief",
  filenameOf: (json) => {
    const safe = String(json?.company_full_name || "未命名")
      .replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    return `项目简报_${safe}_${ymd}.pptx`;
  },
});
