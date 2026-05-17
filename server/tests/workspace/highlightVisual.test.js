const config = require("../../config");
const { buildImagePrompt } = require("../../services/highlight_visual/buildImagePrompt");
const { callMiniMaxImage } = require("../../services/highlight_visual");

describe("highlight_visual prompt", () => {
  test("buildImagePrompt 控制在 MiniMax 1500 字符限制内", () => {
    const json = {
      brand: {
        company_name: "测试科技",
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
        technology_flow: [{ label: "数据", summary: "工业现场采集" }],
        team_capital: [{ label: "团队", summary: "核心成员来自头部厂商" }],
        clients: ["头部制造客户"],
        ipo_milestones: ["2026 年启动规范化"],
        investment_highlights: ["标杆客户可复制", "软件毛利率高", "国产替代窗口明确"],
        financial_table: [{ metric: "ARR", value: "5000 万" }],
      },
    };
    const prompt = buildImagePrompt(json);
    expect(prompt.length).toBeLessThanOrEqual(1500);
    expect(prompt).toMatch(/测试科技/);
    expect(prompt).toMatch(/16:9/);
  });
});

describe("callMiniMaxImage", () => {
  const oldFetch = global.fetch;
  const oldKey = config.minimaxApiKey;
  const oldHost = config.minimaxApiHost;

  afterEach(() => {
    global.fetch = oldFetch;
    config.minimaxApiKey = oldKey;
    config.minimaxApiHost = oldHost;
  });

  test("解析 base64 图片响应为 Buffer", async () => {
    config.minimaxApiKey = "test-token";
    config.minimaxApiHost = "https://api.minimaxi.com/anthropic";
    const encoded = Buffer.from("jpeg-bytes").toString("base64");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { image_base64: [encoded] },
        base_resp: { status_code: 0, status_msg: "success" },
      }),
    });

    const buf = await callMiniMaxImage("生成一张投资亮点视觉图");
    expect(buf.toString()).toBe("jpeg-bytes");
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.minimaxi.com/v1/image_generation");
  });
});
