const {
  resolveLLMApiRoot,
  resolveLLMChatEndpoint,
  resolveLLMSearchEndpoint,
} = require("../../utils/llmEndpoints");

describe("MiniMax endpoint helpers", () => {
  test("默认使用国内站 minimaxi v1 host", () => {
    expect(resolveLLMApiRoot()).toBe("https://api.minimaxi.com/v1");
  });

  test("未带 /v1 时自动补齐", () => {
    expect(resolveLLMApiRoot("https://api.minimax.io")).toBe("https://api.minimax.io/v1");
  });

  test("chat endpoint 从同一个 root 派生", () => {
    expect(resolveLLMChatEndpoint("https://api.minimax.io/v1")).toBe("https://api.minimax.io/v1/chat/completions");
  });

  test("search endpoint 走 coding_plan/search", () => {
    expect(resolveLLMSearchEndpoint("https://api.minimaxi.com/v1")).toBe("https://api.minimaxi.com/v1/coding_plan/search");
  });
});
