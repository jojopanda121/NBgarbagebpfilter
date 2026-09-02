// ============================================================
// tests/llm/capabilities.test.js
//
// 能力矩阵是多模型支持的地基：它说"这个模型最多能输出多少 token / 认不认
// thinking / 认不认 reasoning_effort"，上层据此在**请求发出前**裁剪参数。
// 这里守住三条不变量：
//   1. 认识的模型给出正确能力
//   2. 不认识的 provider / 模型一律拿到保守兜底，绝不抛错
//      （用户填了个我们没见过的模型名，应该少用能力，而不是分析崩掉）
//   3. 用户覆盖只能改容量，不能把布尔能力位打开（打开也不会让模型真支持）
// ============================================================

const { resolveCapabilities, inputCharBudget, FALLBACK } = require("../../services/llm/capabilities");

describe("能力矩阵解析", () => {
  test("DeepSeek V4 拿到大上下文 + 支持 reasoning_effort", () => {
    const caps = resolveCapabilities("deepseek", "deepseek-v4-flash");
    expect(caps.maxOutputTokens).toBeGreaterThanOrEqual(32000);
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.thinkingStyle).toBe("deepseek");
    expect(caps.supportsReasoningEffort).toBe(true);
  });

  test("Claude 4/5 走 anthropic 思考风格，且没有 JSON mode", () => {
    const caps = resolveCapabilities("anthropic", "claude-opus-5");
    expect(caps.thinkingStyle).toBe("anthropic");
    expect(caps.supportsJsonMode).toBe(false);
  });

  test("老 Claude 3.5 不支持扩展思考", () => {
    expect(resolveCapabilities("anthropic", "claude-3-5-sonnet-20241022").thinkingStyle).toBe("none");
  });

  test("OpenAI 推理模型：思考不可关、不认 temperature、要用 max_completion_tokens", () => {
    const caps = resolveCapabilities("openai", "o3");
    expect(caps.thinkingStyle).toBe("always");
    expect(caps.supportsTemperature).toBe(false);
    expect(caps.tokenParam).toBe("max_completion_tokens");
  });

  test("gpt-4o 不认 reasoning_effort（发过去会 400）", () => {
    expect(resolveCapabilities("openai", "gpt-4o").supportsReasoningEffort).toBe(false);
  });

  test("qwen3 的思考开关是 enable_thinking，不是 thinking 对象", () => {
    expect(resolveCapabilities("qwen", "qwen3-max").thinkingStyle).toBe("qwen");
  });

  test("未知厂商 / 未知模型 → 保守兜底，不抛错", () => {
    expect(resolveCapabilities("no-such-vendor", "whatever")).toMatchObject({
      maxOutputTokens: FALLBACK.maxOutputTokens,
      thinkingStyle: "none",
    });
    // 认识厂商但不认识模型 → 用该厂商的默认档
    const caps = resolveCapabilities("openai", "gpt-future-9000");
    expect(caps.maxOutputTokens).toBeGreaterThan(0);
    expect(caps.contextWindow).toBeGreaterThan(0);
  });

  test("用户覆盖只吃容量字段，布尔能力位改不动", () => {
    const caps = resolveCapabilities("moonshot", "moonshot-v1-8k", {
      maxOutputTokens: 16000,
      contextWindow: 200000,
      supportsReasoningEffort: true, // 应被忽略
      thinkingStyle: "deepseek",     // 应被忽略
    });
    expect(caps.maxOutputTokens).toBe(16000);
    expect(caps.contextWindow).toBe(200000);
    expect(caps.supportsReasoningEffort).toBe(false);
    expect(caps.thinkingStyle).toBe("none");
  });

  test("离谱的覆盖值被丢弃（负数 / 过小）", () => {
    const caps = resolveCapabilities("deepseek", "deepseek-v4-flash", { maxOutputTokens: -1, contextWindow: 10 });
    expect(caps.maxOutputTokens).toBeGreaterThan(0);
    expect(caps.contextWindow).toBe(1000000);
  });
});

describe("输入预算换算", () => {
  test("大上下文模型给出大预算", () => {
    const caps = resolveCapabilities("deepseek", "deepseek-v4-flash");
    expect(inputCharBudget(caps, 8192)).toBeGreaterThan(500000);
  });

  test("小上下文模型给出小预算，且永远为正", () => {
    const caps = resolveCapabilities("moonshot", "moonshot-v1-8k");
    const budget = inputCharBudget(caps, 4096);
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThan(caps.contextWindow);
  });
});
