const { buildImagePrompt } = require("../../services/highlight_visual/buildImagePrompt");
const { buildTree, CANVAS_W, CANVAS_H } = require("../../services/highlight_visual/render/layout");

const SAMPLE_JSON = {
  brand: {
    company_name: "测试科技",
    english_name: "Test Tech",
    title: "国产工业智能核心资产",
    subtitle: "高毛利软件订阅 + 标杆客户复制",
  },
  top_metrics: [
    { title: "收入", value: "1.2 亿元", description: "同比增长 80%" },
    { title: "毛利率", value: "72%" },
    { title: "客户", value: "50+" },
    { title: "融资", value: "B 轮" },
  ],
  sections: {
    technology_flow: [
      { label: "数据", summary: "工业现场采集，覆盖 200+ 设备型号" },
      { label: "模型", summary: "自研工业大模型，参数 10B" },
    ],
    team_capital: [
      { label: "核心团队", summary: "来自头部厂商 15 年工业经验" },
      { label: "资本背书", summary: "红杉、高瓴、产业方共同领投" },
    ],
    clients: ["头部制造客户", "央企能源集团", "上市装备厂商", "汽车 Tier1"],
    ipo_milestones: ["2026 年启动规范化", "2027 年完成股改", "2028 年申报科创板"],
    investment_highlights: [
      "标杆客户高度可复制",
      "软件订阅毛利率行业领先",
      "国产替代窗口确定性强",
      "团队工业 know-how 深",
    ],
    financial_table: [
      { metric: "ARR", value: "5000 万" },
      { metric: "毛利率", value: "72%" },
      { metric: "Net Retention", value: "128%" },
      { metric: "估值", value: "8 亿元" },
    ],
  },
};

describe("highlight_visual prompt", () => {
  test("buildImagePrompt 控制在 1500 字符内（保留作调试回显）", () => {
    const prompt = buildImagePrompt(SAMPLE_JSON);
    expect(prompt.length).toBeLessThanOrEqual(1500);
    expect(prompt).toMatch(/测试科技/);
  });
});

describe("highlight_visual layout tree", () => {
  test("buildTree 生成合法的 satori 节点树，含中文文本", () => {
    const tree = buildTree(SAMPLE_JSON);
    expect(tree.type).toBe("div");
    expect(tree.props.style.width).toBe(CANVAS_W);
    expect(tree.props.style.height).toBe(CANVAS_H);
    const flat = JSON.stringify(tree);
    expect(flat).toMatch(/测试科技/);
    expect(flat).toMatch(/国产工业智能核心资产/);
    expect(flat).toMatch(/核心投资亮点/);
    expect(flat).toMatch(/财务 \/ 交易/);
  });

  test("空数据下 buildTree 不抛错，并兜底显示「暂无信息」", () => {
    const tree = buildTree({ brand: { company_name: "X", title: "Y", subtitle: "Z" }, top_metrics: [], sections: {} });
    const flat = JSON.stringify(tree);
    expect(flat).toMatch(/暂无信息/);
  });
});
