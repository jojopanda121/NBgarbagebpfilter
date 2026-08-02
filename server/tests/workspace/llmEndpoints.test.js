const {
  resolveLLMApiRoot,
  resolveLLMChatEndpoint,
  resolveSearchApiRoot,
  resolveSearchEndpoint,
} = require("../../utils/llmEndpoints");

describe("endpoint helpers", () => {
  test("LLM 默认使用 DeepSeek v1 host", () => {
    expect(resolveLLMApiRoot()).toBe("https://api.deepseek.com/v1");
  });

  test("未带 /v1 时自动补齐", () => {
    expect(resolveLLMApiRoot("https://api.deepseek.com")).toBe("https://api.deepseek.com/v1");
  });

  test("chat endpoint 从同一个 root 派生", () => {
    expect(resolveLLMChatEndpoint("https://api.deepseek.com/v1")).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  test("检索是独立供应商，默认走博查 v1", () => {
    expect(resolveSearchApiRoot()).toBe("https://api.bochaai.com/v1");
    expect(resolveSearchEndpoint()).toBe("https://api.bochaai.com/v1/web-search");
  });

  test("检索 host 可覆盖且同样自动补 /v1", () => {
    expect(resolveSearchEndpoint("https://search.internal.test")).toBe("https://search.internal.test/v1/web-search");
  });
});
