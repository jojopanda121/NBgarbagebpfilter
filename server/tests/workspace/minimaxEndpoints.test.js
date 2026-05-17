const {
  resolveMinimaxApiRoot,
  resolveAnthropicBaseURL,
  resolveMinimaxSearchEndpoint,
  resolveMinimaxImageEndpoint,
} = require("../../utils/minimaxEndpoints");

describe("MiniMax endpoint helpers", () => {
  test("默认使用国内版 Token Plan host", () => {
    expect(resolveMinimaxApiRoot()).toBe("https://api.minimaxi.com");
  });

  test("误填 /anthropic 时，root 会被规整回来", () => {
    expect(resolveMinimaxApiRoot("https://api.minimaxi.com/anthropic")).toBe("https://api.minimaxi.com");
  });

  test("各端点从同一个 root 派生", () => {
    const host = "https://api.minimaxi.com/anthropic";
    expect(resolveAnthropicBaseURL(host)).toBe("https://api.minimaxi.com/anthropic");
    expect(resolveMinimaxSearchEndpoint(host)).toBe("https://api.minimaxi.com/v1/coding_plan/search");
    expect(resolveMinimaxImageEndpoint(host)).toBe("https://api.minimaxi.com/v1/image_generation");
  });
});
