const {
  resolveKimiApiRoot,
  resolveKimiChatEndpoint,
} = require("../../utils/kimiEndpoints");

describe("Kimi endpoint helpers", () => {
  test("默认使用 Moonshot Open Platform v1 host", () => {
    expect(resolveKimiApiRoot()).toBe("https://api.moonshot.ai/v1");
  });

  test("未带 /v1 时自动补齐", () => {
    expect(resolveKimiApiRoot("https://api.moonshot.ai")).toBe("https://api.moonshot.ai/v1");
  });

  test("chat endpoint 从同一个 root 派生", () => {
    expect(resolveKimiChatEndpoint("https://api.moonshot.ai/v1")).toBe("https://api.moonshot.ai/v1/chat/completions");
  });
});
