// ============================================================
// server/services/investment_deck/index.js
// 可变页数投决材料 deck · 服务入口
// ============================================================

const { createTemplate } = require("../pptxTemplate");

module.exports = createTemplate({
  name: "investment_deck",
  assetsDir: __dirname,
  endpoint: "/generate/investment_deck",
  maxTokens: 12000,
  filenameOf: (json) => {
    const safe = String(json?.company_full_name || "未命名")
      .replace(/[\\/:*?"<>|\s]+/g, "_")
      .slice(0, 40);
    const pages = Array.isArray(json?.slides) ? json.slides.length : json?.target_pages || "N";
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    return `投决材料_${safe}_${pages}页_${ymd}.pptx`;
  },
});
