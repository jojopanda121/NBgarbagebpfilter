// ============================================================
// tests/live/routing.live.test.js — 任务路由的真实行为验证
//
// coreTierRouting.test.js 验的是"路由表算得对不对"（纯逻辑，无网络）。
// 这里验的是"路由出来的配置打到真 API 上，是不是真能拿到可用结果"——
// 尤其是判断档强制思考之后，正文有没有被思考挤没。
//
// 跑法：npm run test:live （需 DEEPSEEK_API_KEY，会产生真实费用）
// ============================================================

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", "..", ".env") });

const API_KEY = (process.env.DEEPSEEK_API_KEY || "").trim();
const d = API_KEY ? describe : describe.skip;

const llmService = API_KEY ? require("../../services/llmService") : null;

d("任务路由的真实产出", () => {
  test("机械档（bp_extraction）：关思考，能吐出可解析 JSON", async () => {
    const raw = await llmService.callLLM(
      "只输出 JSON，不要 markdown 围栏。",
      '按 {"company":"","revenue_wan":0} 抽取：星途智能科技 2024 年营收 5000 万元。',
      { maxTokens: 2000, taskHint: "bp_extraction" }
    );
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    expect(parsed).toHaveProperty("company");
  });

  // 判断档强制开思考 + THINKING_MIN_TOKENS 兜底。
  // 这条如果红了，说明 token 下限不够，正文又被思考吃光了。
  test("判断档（claim_verdict）：强制思考后仍能拿到非空正文", async () => {
    const raw = await llmService.callLLM(
      "你是事实核查专家。只输出 JSON 数组。",
      '判断这条声明并输出 [{"verdict":"诚实|夸大|存疑","reason":"..."}]：' +
        "「我们是国内首家实现车规级激光雷达量产的企业」",
      { maxTokens: 3000, taskHint: "claim_verdict" }   // 故意给小，验证下限保护生效
    );
    expect(raw.trim().length).toBeGreaterThan(0);
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    expect(Array.isArray(parsed) ? parsed[0] : parsed).toHaveProperty("verdict");
  });

  test("工作台对话默认关思考：onDelta 必须真的收到文字，而不是全程空白", async () => {
    const chunks = [];
    const full = await llmService.callLLMChat(
      "你是投资分析助手，回答简短。",
      [{ role: "user", content: "一句话说明 ARR 和 MRR 的区别。" }],
      { maxTokens: 800, onDelta: (t) => chunks.push(t) }
    );
    expect(full.length).toBeGreaterThan(0);
    expect(chunks.join("").length).toBeGreaterThan(0);   // 用户端看得到字
  });

  test("getTaskProfile 声明的配置与实际行为一致", () => {
    const mech = llmService.getTaskProfile({ taskHint: "bp_extraction" });
    expect(mech.thinking).toBe(false);

    const judge = llmService.getTaskProfile({ taskHint: "claim_verdict" });
    expect(judge.thinking).toBe(true);
    expect(judge.minTokens).toBeGreaterThanOrEqual(12000);
  });
});
