// ============================================================
// tests/llm/providerAdapters.test.js
//
// 各厂商协议适配的关键差异。这些不是"锦上添花"的兼容性——每一条不做，
// 用户换上对应的模型后**每一次调用都会 400**，整份分析直接失败：
//   - max_tokens 超模型上限 → 必须裁到上限
//   - 不支持 reasoning_effort / temperature 的模型 → 必须不发这些字段
//   - o 系模型 → 必须发 max_completion_tokens 而不是 max_tokens
//   - 各家思考开关字段名不同 → 必须按 thinkingStyle 翻译
//   - Anthropic → budget_tokens 必须小于 max_tokens；无签名 thinking block
//     回传会被拒；连续同角色消息会被拒
// ============================================================

const { buildLLMBody } = require("../../services/llm/providers/openaiCompatible");
const { buildAnthropicBody, sanitizeMessages } = require("../../services/llm/providers/anthropic");
const { resolveCapabilities } = require("../../services/llm/capabilities");
const { buildEndpoint, validateHost, getProvider, listProviders } = require("../../services/llm/providers");

const baseBody = { model: "m", max_tokens: 20000, messages: [{ role: "user", content: "hi" }] };

describe("OpenAI 兼容：按能力裁剪请求体", () => {
  test("max_tokens 裁到模型上限", () => {
    const caps = resolveCapabilities("moonshot", "moonshot-v1-8k"); // 上限 4096
    const body = buildLLMBody(baseBody, caps);
    expect(body.max_tokens).toBe(caps.maxOutputTokens);
    expect(body.max_tokens).toBeLessThan(20000);
  });

  test("能力足够时不裁", () => {
    const caps = resolveCapabilities("deepseek", "deepseek-v4-flash");
    expect(buildLLMBody(baseBody, caps).max_tokens).toBe(20000);
  });

  test("不支持 reasoning_effort 的模型不发该字段", () => {
    const caps = resolveCapabilities("openai", "gpt-4o");
    const body = buildLLMBody({ ...baseBody, reasoning_effort: "high" }, caps);
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  test("o 系模型：用 max_completion_tokens，且不发 temperature", () => {
    const caps = resolveCapabilities("openai", "o3");
    const body = buildLLMBody({ ...baseBody, temperature: 0.3 }, caps);
    expect(body).toHaveProperty("max_completion_tokens");
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("temperature");
  });

  test("thinkingStyle=none 的模型不发任何思考字段", () => {
    const caps = resolveCapabilities("openai", "gpt-4o");
    const body = buildLLMBody({ ...baseBody, thinking: { type: "enabled" } }, caps);
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("enable_thinking");
  });

  test("thinkingStyle=qwen → enable_thinking 布尔字段", () => {
    const caps = resolveCapabilities("qwen", "qwen3-max");
    expect(buildLLMBody({ ...baseBody, thinking: { type: "enabled" } }, caps).enable_thinking).toBe(true);
    expect(buildLLMBody({ ...baseBody, thinking: { type: "disabled" } }, caps).enable_thinking).toBe(false);
  });

  test("thinkingStyle=always（推理模型）不发开关字段，发了会 400", () => {
    const caps = resolveCapabilities("openai", "o4-mini");
    const body = buildLLMBody({ ...baseBody, thinking: { type: "enabled" } }, caps);
    expect(body).not.toHaveProperty("thinking");
  });

  test("不支持 JSON mode 的模型不发 response_format", () => {
    const caps = resolveCapabilities("anthropic", "claude-sonnet-5");
    const body = buildLLMBody({ ...baseBody, response_format: { type: "json_object" } }, caps);
    expect(body).not.toHaveProperty("response_format");
  });

  test("不支持工具的模型不发 tools", () => {
    const caps = { ...resolveCapabilities("deepseek", "deepseek-v4-flash"), supportsTools: false };
    const body = buildLLMBody({ ...baseBody, tools: [{ name: "web_search", input_schema: {} }] }, caps);
    expect(body).not.toHaveProperty("tools");
  });

  test("不传 caps 时保持迁移前的放行行为（老调用点不受影响）", () => {
    const body = buildLLMBody({ ...baseBody, reasoning_effort: "high", thinking: { type: "enabled", budget_tokens: 9 } });
    expect(body.max_tokens).toBe(20000);
    expect(body.reasoning_effort).toBe("high");
    expect(body.thinking).toEqual({ type: "enabled" });
  });
});

describe("Anthropic 原生协议", () => {
  const caps = resolveCapabilities("anthropic", "claude-sonnet-5");

  test("budget_tokens 严格小于 max_tokens，正文预算不会被思考吃光", () => {
    const body = buildAnthropicBody({ ...baseBody, thinking: { type: "enabled", budget_tokens: 99999 } }, caps);
    expect(body.thinking.budget_tokens).toBeLessThan(body.max_tokens);
    expect(body.thinking.budget_tokens).toBeLessThanOrEqual(Math.floor(body.max_tokens / 2));
  });

  test("开思考时不发 temperature（Anthropic 会拒）", () => {
    const body = buildAnthropicBody({ ...baseBody, temperature: 0.5, thinking: { type: "enabled", budget_tokens: 2000 } }, caps);
    expect(body).not.toHaveProperty("temperature");
  });

  test("max_tokens 裁到能力上限", () => {
    const small = resolveCapabilities("anthropic", "claude-3-haiku-20240307"); // 4096
    expect(buildAnthropicBody(baseBody, small).max_tokens).toBe(small.maxOutputTokens);
  });

  test("无签名的 thinking block 被剔除（回传会被 API 拒绝）", () => {
    const msgs = sanitizeMessages([
      { role: "user", content: "问题" },
      { role: "assistant", content: [
        { type: "thinking", thinking: "无签名，必须剔掉" },
        { type: "text", text: "答案" },
      ] },
    ]);
    const assistant = msgs.find((m) => m.role === "assistant");
    expect(assistant.content.some((b) => b.type === "thinking")).toBe(false);
    expect(assistant.content.some((b) => b.type === "text")).toBe(true);
  });

  test("带签名的 thinking block 保留", () => {
    const msgs = sanitizeMessages([
      { role: "user", content: "问题" },
      { role: "assistant", content: [{ type: "thinking", thinking: "x", signature: "sig" }] },
    ]);
    expect(msgs[1].content[0].type).toBe("thinking");
  });

  test("连续同角色消息被合并（Anthropic 要求交替）", () => {
    const msgs = sanitizeMessages([
      { role: "user", content: "第一句" },
      { role: "user", content: "第二句" },
      { role: "assistant", content: "回答" },
    ]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toHaveLength(2);
  });

  test("工具声明转成 Anthropic 的 input_schema 形状", () => {
    const body = buildAnthropicBody({
      ...baseBody,
      tools: [{ type: "function", function: { name: "web_search", description: "搜", parameters: { type: "object" } } }],
    }, caps);
    expect(body.tools[0]).toMatchObject({ name: "web_search", input_schema: { type: "object" } });
  });
});

describe("端点拼接与域名白名单", () => {
  test("host 已带 /v1 时不重复拼", () => {
    expect(buildEndpoint("https://api.deepseek.com/v1", "/v1/chat/completions"))
      .toBe("https://api.deepseek.com/v1/chat/completions");
  });

  test("host 不带路径时正常拼", () => {
    expect(buildEndpoint("https://api.deepseek.com", "/v1/chat/completions"))
      .toBe("https://api.deepseek.com/v1/chat/completions");
  });

  test("Gemini 的 OpenAI 兼容路径", () => {
    expect(buildEndpoint("https://generativelanguage.googleapis.com", "/v1beta/openai/chat/completions"))
      .toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  });

  test("SSRF：非官方域名被拒", () => {
    expect(validateHost("openai", "https://evil.example.com/v1").ok).toBe(false);
    expect(validateHost("openai", "https://169.254.169.254/latest/meta-data").ok).toBe(false);
  });

  test("SSRF：http 明文被拒", () => {
    expect(validateHost("deepseek", "http://api.deepseek.com").ok).toBe(false);
  });

  test("官方域名与其子域放行", () => {
    expect(validateHost("openai", "https://api.openai.com/v1").ok).toBe(true);
    expect(validateHost("qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1").ok).toBe(true);
  });

  test("显式开启自定义端点后放行任意 https（部署方自担风险）", () => {
    expect(validateHost("openai", "https://my-gateway.internal/v1", { allowCustom: true }).ok).toBe(true);
  });

  test("留空 baseURL 合法（用厂商默认端点）", () => {
    expect(validateHost("openai", "").ok).toBe(true);
  });
});

describe("Provider 注册表", () => {
  test("八家主流厂商都在册且有默认模型", () => {
    const ids = listProviders().map((p) => p.id);
    for (const id of ["deepseek", "anthropic", "openai", "gemini", "minimax", "moonshot", "qwen", "zhipu"]) {
      expect(ids).toContain(id);
      expect(getProvider(id).defaultModels.default).toBeTruthy();
    }
  });

  test("MiniMax 保留完整适配（将来可切回，只改 env）", () => {
    expect(getProvider("minimax").kind).toBe("openai");
    expect(getProvider("minimax").allowedHostSuffixes.length).toBeGreaterThan(0);
  });

  test("清单不泄漏内部字段（如域名白名单）给前端", () => {
    for (const p of listProviders()) {
      expect(p).not.toHaveProperty("allowedHostSuffixes");
      expect(p).not.toHaveProperty("chatPath");
    }
  });
});
