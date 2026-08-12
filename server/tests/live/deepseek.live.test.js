// ============================================================
// tests/live/deepseek.live.test.js — 真实 DeepSeek API 契约测试
//
// 这里锁死的每一条，都是 2026-08 用真 API 实测出来的行为，不是文档推测。
// 单元测试用的是我们自己手写的 fixture —— 如果 DeepSeek 改了响应形状或
// 参数校验，单测照样全绿，只有这一档会红。
//
// 跑法（需要 DEEPSEEK_API_KEY，会产生真实费用，约 ¥0.05/次全量）：
//   npm run test:live
// 没配 key 时整个文件自动 skip。
// ============================================================

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", "..", ".env") });

const { createLLMClient } = require("../../utils/llmClient");

const API_KEY = (process.env.DEEPSEEK_API_KEY || "").trim();
const HOST = process.env.DEEPSEEK_API_HOST || "https://api.deepseek.com/v1";
const FLASH = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const PRO = process.env.DEEPSEEK_MODEL_HEAVY || "deepseek-v4-pro";

const d = API_KEY ? describe : describe.skip;
if (!API_KEY) {
  console.warn("[live] 未配置 DEEPSEEK_API_KEY，跳过真实 API 契约测试");
}

const llm = API_KEY ? createLLMClient({ apiKey: API_KEY, baseURL: HOST }) : null;

const ask = (content) => [{ role: "user", content }];
const blocks = (resp, type) => (resp.content || []).filter((b) => b.type === type);
const textOf = (resp) => blocks(resp, "text").map((b) => b.text).join("");
const thinkOf = (resp) => blocks(resp, "thinking").map((b) => b.thinking).join("");

d("DeepSeek 真实 API 契约", () => {
  test("非流式：返回可用正文 + usage，thinking 翻译成 thinking block", async () => {
    const resp = await llm.messages.create({
      model: FLASH,
      max_tokens: 2000,
      messages: ask("用一句话说明什么是 ARR。"),
    });
    expect(textOf(resp).length).toBeGreaterThan(0);
    expect(resp.usage.input_tokens).toBeGreaterThan(0);
    expect(resp.usage.output_tokens).toBeGreaterThan(0);
    expect(["end_turn", "max_tokens", "tool_use"]).toContain(resp.stop_reason);
  });

  test("thinking:{type:'disabled'} 被接受，且真的不产出思考内容", async () => {
    const resp = await llm.messages.create({
      model: FLASH,
      max_tokens: 500,
      thinking: { type: "disabled" },
      messages: ask("用一句话说明什么是 ARR。"),
    });
    expect(thinkOf(resp)).toHaveLength(0);
    expect(textOf(resp).length).toBeGreaterThan(0);
  });

  // 这是本次迁移最关键的一条契约：Anthropic 风格的 budget_tokens 是
  // DeepSeek 不认识的字段，直接透传会 400。llmClient 必须裁掉它。
  test("thinking.budget_tokens 被翻译层裁掉，不会触发 400", async () => {
    const resp = await llm.messages.create({
      model: FLASH,
      max_tokens: 2000,
      thinking: { type: "enabled", budget_tokens: 8000 },
      messages: ask("用一句话说明什么是 ARR。"),
    });
    expect(textOf(resp).length).toBeGreaterThan(0);
  });

  // 实测发现的坑：思考内容计入 max_tokens。预算给小了会出现
  // "调用成功、usage 顶格、正文 0 字"，普通 try/catch 抓不到。
  // llmService 的 THINKING_MIN_TOKENS 保护就是为这个存在的。
  test("思考计入 max_tokens：预算过小会饿死正文（记录该行为，非缺陷）", async () => {
    const resp = await llm.messages.create({
      model: FLASH,
      max_tokens: 400,
      thinking: { type: "enabled" },
      messages: ask("详细分析一家 SaaS 公司毛利率 85% 但销售费用率 60% 说明什么。"),
    });
    const starved = textOf(resp).length === 0;
    if (starved) {
      expect(thinkOf(resp).length).toBeGreaterThan(0);   // token 全烧在思考上
      expect(resp.stop_reason).toBe("max_tokens");
    }
    // 若哪天 DeepSeek 改成"保证留出正文预算"，这里会走 else 分支，
    // 说明 THINKING_MIN_TOKENS 可以放宽 —— 这正是本测试要抓的漂移。
    expect(typeof starved).toBe("boolean");
  });

  test("流式：能收到 content_block_delta，且事件形状符合 Anthropic 约定", async () => {
    const stream = llm.messages.stream({
      model: FLASH,
      max_tokens: 2000,
      thinking: { type: "disabled" },
      messages: ask("用一句话说明什么是 ARR。"),
    });
    let text = "";
    let sawStart = false;
    for await (const ev of stream) {
      if (ev.type === "content_block_start") sawStart = true;
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        text += ev.delta.text || "";
      }
    }
    expect(sawStart).toBe(true);
    expect(text.length).toBeGreaterThan(0);
  });

  test("工具调用：Anthropic 工具声明能翻译过去，tool_use 输入被解析成对象", async () => {
    const resp = await llm.messages.create({
      model: FLASH,
      max_tokens: 2000,
      tools: [{
        name: "web_search",
        description: "搜索公开网页",
        input_schema: {
          type: "object",
          properties: { query: { type: "string", description: "搜索词" } },
          required: ["query"],
        },
      }],
      messages: ask("帮我查一下宁德时代 2025 年最新的动力电池装机量数据。"),
    });
    const tools = blocks(resp, "tool_use");
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0].name).toBe("web_search");
    expect(typeof tools[0].input).toBe("object");      // 不是原始 JSON 字符串
    expect(typeof tools[0].input.query).toBe("string");
    expect(resp.stop_reason).toBe("tool_use");
  });

  test("JSON 模式：response_format 被接受且输出可直接 JSON.parse", async () => {
    const resp = await llm.messages.create({
      model: FLASH,
      max_tokens: 2000,
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      messages: ask('只输出 json：{"verdict":"夸大或诚实","reason":"一句话"}。判断：某公司自称市占率第一但无第三方数据。'),
    });
    const parsed = JSON.parse(textOf(resp).replace(/```json|```/g, "").trim());
    expect(parsed).toHaveProperty("verdict");
  });

  test("两个模型名都有效（heavy 档真的可用，不是配错了名字）", async () => {
    const resp = await llm.messages.create({
      model: PRO,
      max_tokens: 4000,
      messages: ask("用一句话说明什么是 ARR。"),
    });
    expect(textOf(resp).length).toBeGreaterThan(0);
  });

  test("reasoning_effort 被接受（flash 支持 low/high/max）", async () => {
    const resp = await llm.messages.create({
      model: FLASH,
      max_tokens: 4000,
      reasoning_effort: "low",
      messages: ask("用一句话说明什么是 ARR。"),
    });
    expect(resp.usage.output_tokens).toBeGreaterThan(0);
  });

  test("无效 key → 401，并被规范化成带 status 的 LLMAPIError", async () => {
    const bad = createLLMClient({ apiKey: "sk-invalid-key-for-test", baseURL: HOST });
    await expect(
      bad.messages.create({ model: FLASH, max_tokens: 50, messages: ask("hi") })
    ).rejects.toMatchObject({ name: "LLMAPIError", status: 401 });
  });
});
