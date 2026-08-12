// ============================================================
// tests/workspace/deepseekBody.test.js
//
// 覆盖 Anthropic 风格 → DeepSeek OpenAI 兼容协议的翻译层关键差异：
//   - thinking.budget_tokens 必须被裁掉（DeepSeek 不认，带上会 400）
//   - reasoning_effort / response_format 等 DeepSeek 参数正常透传
//   - reasoning_content 与内联 <think> 都能翻回 thinking block
// ============================================================

const {
  buildLLMBody,
  normalizeThinking,
  toAnthropicLikeResponse,
} = require("../../utils/llmClient");

describe("DeepSeek 请求体翻译", () => {
  test("thinking 只保留 type，budget_tokens 被裁掉", () => {
    expect(normalizeThinking({ type: "enabled", budget_tokens: 8000 })).toEqual({ type: "enabled" });
    expect(normalizeThinking({ type: "disabled" })).toEqual({ type: "disabled" });
    expect(normalizeThinking(undefined)).toBeUndefined();

    const body = buildLLMBody({
      model: "deepseek-v4-flash",
      max_tokens: 1000,
      thinking: { type: "enabled", budget_tokens: 4000 },
      messages: [{ role: "user", content: "hi" }],
    });
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(JSON.stringify(body)).not.toContain("budget_tokens");
  });

  test("system 提示折叠成 system message，reasoning_effort 透传", () => {
    const body = buildLLMBody({
      model: "deepseek-v4-pro",
      max_tokens: 500,
      system: "你是投资分析师",
      reasoning_effort: "high",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: "分析这家公司" }],
    });
    expect(body.messages[0]).toEqual({ role: "system", content: "你是投资分析师" });
    expect(body.reasoning_effort).toBe("high");
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  test("未传的可选参数不出现在请求体里", () => {
    const body = buildLLMBody({
      model: "deepseek-v4-flash",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    for (const k of ["thinking", "reasoning_effort", "temperature", "top_p", "stop", "response_format", "tools"]) {
      expect(body).not.toHaveProperty(k);
    }
  });

  test("Anthropic 工具声明翻成 OpenAI function 形状", () => {
    const body = buildLLMBody({
      model: "deepseek-v4-flash",
      max_tokens: 100,
      tools: [{ name: "web_search", description: "搜索", input_schema: { type: "object", properties: {} } }],
      messages: [{ role: "user", content: "hi" }],
    });
    expect(body.tools[0]).toEqual({
      type: "function",
      function: { name: "web_search", description: "搜索", parameters: { type: "object", properties: {} } },
    });
  });
});

describe("DeepSeek 响应翻译", () => {
  test("reasoning_content → thinking block", () => {
    const resp = toAnthropicLikeResponse({
      id: "x",
      choices: [{
        finish_reason: "stop",
        message: { content: "结论是 A", reasoning_content: "先想一想" },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    expect(resp.content).toEqual([
      { type: "thinking", thinking: "先想一想" },
      { type: "text", text: "结论是 A" },
    ]);
    expect(resp.stop_reason).toBe("end_turn");
    expect(resp.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  test("正文内联 <think> 也被剥成 thinking block", () => {
    const resp = toAnthropicLikeResponse({
      choices: [{ finish_reason: "stop", message: { content: "<think>推理</think>正式答案" } }],
    });
    expect(resp.content).toEqual([
      { type: "thinking", thinking: "推理" },
      { type: "text", text: "正式答案" },
    ]);
  });

  test("tool_calls → tool_use，finish_reason 映射为 tool_use", () => {
    const resp = toAnthropicLikeResponse({
      choices: [{
        finish_reason: "tool_calls",
        message: {
          content: "",
          tool_calls: [{ id: "c1", function: { name: "web_search", arguments: '{"query":"茅台"}' } }],
        },
      }],
    });
    expect(resp.stop_reason).toBe("tool_use");
    expect(resp.content).toEqual([
      { type: "tool_use", id: "c1", name: "web_search", input: { query: "茅台" } },
    ]);
  });

  test("finish_reason=length → max_tokens", () => {
    const resp = toAnthropicLikeResponse({ choices: [{ finish_reason: "length", message: { content: "半截" } }] });
    expect(resp.stop_reason).toBe("max_tokens");
  });
});
