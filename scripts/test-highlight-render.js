#!/usr/bin/env node
// 端到端渲染验证：不调 LLM，直接喂样例 JSON，输出 PNG 到本地以便人眼检查。
const fs = require("fs");
const path = require("path");
const { renderHighlightPng } = require("../server/services/highlight_visual/render");

const SAMPLE = {
  brand: {
    company_name: "星尘智造",
    english_name: "Stardust Robotics",
    title: "国产工业具身智能核心资产",
    subtitle: "高毛利软件订阅 + 头部制造客户深度复制 + 国产替代窗口确定",
  },
  top_metrics: [
    { title: "年度经常性收入", value: "1.28 亿", description: "同比 +82%" },
    { title: "毛利率", value: "71.5%", description: "软件订阅主导" },
    { title: "标杆客户", value: "53 家", description: "央企/Tier1/上市公司" },
    { title: "估值轮次", value: "B+ 轮", description: "Pre-money 9.6 亿" },
  ],
  sections: {
    technology_flow: [
      { label: "数据底座", summary: "工业现场实时采集，覆盖 240+ 设备型号" },
      { label: "工业大模型", summary: "10B 参数自研模型，专精机械臂控制" },
      { label: "部署平台", summary: "信创全栈适配，边缘 + 私有云双形态" },
      { label: "应用闭环", summary: "AOI 质检 / 装配引导 / 预测维护" },
    ],
    team_capital: [
      { label: "CEO 王启明", summary: "前发那科中国 CTO，15 年工业 AI 经验" },
      { label: "CTO 林韵秋", summary: "清华自动化博士，IEEE Fellow" },
      { label: "资本背书", summary: "红杉中国领投，高瓴/产业方跟投" },
      { label: "顾问委员会", summary: "三位院士 + 两位上市公司董事长" },
    ],
    clients: ["三一重工", "宁德时代", "比亚迪", "国家电网", "中航工业", "海尔卡奥斯"],
    ipo_milestones: [
      "2026 H2 启动股份制改造",
      "2027 Q2 提交科创板辅导备案",
      "2028 H1 提交 A 股 IPO 申报材料",
      "2029 预计登陆科创板",
    ],
    investment_highlights: [
      "国产工业具身智能稀缺标的，TAM 2000 亿，TRL6 已规模商用",
      "软件订阅毛利率 71.5%，远高于硬件集成同行",
      "标杆客户高度可复制，单客户 ARR 半年内复购 2.3x",
      "信创 + 国产替代政策窗口明确，2026-2028 是抢份额关键期",
      "团队工业 know-how 深厚，技术壁垒 + 客户壁垒双重护城河",
    ],
    financial_table: [
      { metric: "ARR", value: "1.28 亿" },
      { metric: "Net Retention", value: "131%" },
      { metric: "毛利率", value: "71.5%" },
      { metric: "Burn Multiple", value: "0.9x" },
    ],
  },
};

(async () => {
  const start = Date.now();
  console.log("[render-test] 开始渲染（首次会下载字体，约 18MB）...");
  try {
    const png = await renderHighlightPng(SAMPLE);
    const out = path.join(__dirname, "../logs/highlight-render-preview.png");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, png);
    console.log(`[render-test] OK | ${png.length} bytes | ${Date.now() - start}ms | ${out}`);
  } catch (err) {
    console.error("[render-test] FAIL:", err);
    process.exit(1);
  }
})();
